import {
  beforeAll,
  beforeEach,
  afterAll,
  afterEach,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { Session } from "@shopify/shopify-api";
import db from "../app/db.server";
import { EncryptedSessionStorage } from "../app/lib/session-storage.server";
import {
  createDraft,
  getDraft,
  saveDraft,
  duplicateDraft,
} from "../app/lib/drafts.server";
import {
  getApiCredential,
  getSettings,
  publicSettings,
  saveSettings,
  syncStoreCurrency,
} from "../app/lib/settings.server";
import {
  createJob,
  listJobs,
  readAiStatus,
  retryJob,
  setAiTransportForTests,
} from "../app/lib/ai/jobs.server";
import { publishDraft, setMediaWaitForTests } from "../app/lib/publish.server";
import type { AdminClient } from "../app/lib/shopify-graphql.server";
import { source, pricing, editorFixture } from "./fixtures";
const shop = "test-shop.myshopify.com";
const other = "other-shop.myshopify.com";
beforeAll(() => {
  setMediaWaitForTests(0);
  execFileSync(process.execPath, ["scripts/setup.mjs"], {
    cwd: resolve("."),
    env: process.env,
    stdio: "pipe",
  });
});
beforeEach(async () => {
  await db.draft.deleteMany();
  await db.shopSettings.deleteMany();
  await db.session.deleteMany();
});
afterAll(async () => {
  await db.$disconnect();
});
function fakeAdmin({
  processing = false,
  failProduct = false,
}: { processing?: boolean; failProduct?: boolean } = {}) {
  let product: any = null;
  let fileCounter = 0;
  const calls: { query: string; variables: any }[] = [];
  const admin: AdminClient = {
    graphql: vi.fn(async (query, options) => {
      const variables = options?.variables || {};
      calls.push({ query, variables });
      let data: any;
      if (query.includes("ImporterShopContext"))
        data = {
          shop: {
            name: "Test shop",
            myshopifyDomain: shop,
            currencyCode: "USD",
          },
          currentAppInstallation: {
            accessScopes: [
              "read_products",
              "write_products",
              "read_files",
              "write_files",
            ].map((handle) => ({ handle })),
          },
        };
      else if (query.includes("ImporterStage"))
        data = {
          stagedUploadsCreate: {
            stagedTargets: [
              {
                url: "https://shopify-staged-uploads.storage.googleapis.com/",
                resourceUrl:
                  "https://shopify-staged-uploads.storage.googleapis.com/synthetic/image.png",
                parameters: [{ name: "key", value: "synthetic/image.png" }],
              },
            ],
            userErrors: [],
          },
        };
      else if (query.includes("ImporterFile("))
        data = {
          fileCreate: {
            files: [
              {
                id: `gid://shopify/MediaImage/${++fileCounter}`,
                fileStatus: "PROCESSING",
              },
            ],
            userErrors: [],
          },
        };
      else if (query.includes("ImporterFiles"))
        data = {
          nodes: (variables.ids as string[]).map((id) => ({
            id,
            fileStatus: processing ? "PROCESSING" : "READY",
          })),
        };
      else if (query.includes("ImporterExisting"))
        data = { productByIdentifier: product };
      else if (query.includes("ImporterPublish")) {
        product = {
          id: "gid://shopify/Product/123",
          handle: (variables.input as any).handle,
          status: "DRAFT",
          variants: { nodes: [] },
        };
        if (failProduct) {
          failProduct = false;
          throw new Error(
            "Simulated response loss after Shopify created the product.",
          );
        }
        data = { productSet: { product, userErrors: [] } };
      } else throw new Error(`Unhandled query: ${query}`);
      return Response.json({ data });
    }),
  };
  return {
    admin,
    calls,
    setProcessing: (next: boolean) => {
      processing = next;
    },
  };
}
describe("persistent settings, drafts and encrypted sessions", () => {
  it("round trips secrets server-side and exposes no key material", async () => {
    const secret = [
      "hio",
      "test",
      "synthetic_public_api_key_for_test_only",
    ].join("_");
    const result = await saveSettings(shop, { ...pricing, apiKey: secret });
    expect(JSON.stringify(result)).not.toContain(secret);
    const row = await getSettings(shop);
    expect(row.apiKeyEncrypted).not.toContain(secret);
    expect((await getApiCredential(shop)).key).toBe(secret);
    expect(publicSettings(row)).not.toHaveProperty("apiKeyEncrypted");
    expect((await getSettings(other)).keyConfigured).toBe(false);
  });
  it("keeps saved pricing in the Shopify store currency", async () => {
    await getSettings(other);
    expect((await syncStoreCurrency(other, "CNY")).exchangeRate).toBe("1");
    const saved = await saveSettings(
      other,
      { ...pricing, currency: "USD", exchangeRate: "0.14" },
      "CNY",
    );
    expect(saved).toMatchObject({ currency: "CNY", exchangeRate: "1" });
  });
  it("encrypts Shopify access and refresh tokens while preserving official Session behavior", async () => {
    const storage = new EncryptedSessionStorage(db);
    const session = new Session({
      id: `offline_${shop}`,
      shop,
      state: "test-state",
      isOnline: false,
    });
    session.accessToken = "synthetic-access-token";
    session.refreshToken = "synthetic-refresh-token";
    session.refreshTokenExpires = new Date(Date.now() + 600000);
    await storage.storeSession(session);
    expect(session.accessToken).toBe("synthetic-access-token");
    const raw = await db.session.findUniqueOrThrow({
      where: { id: session.id },
    });
    expect(raw.accessToken).not.toContain("synthetic-access-token");
    expect(raw.refreshToken).not.toContain("synthetic-refresh-token");
    expect((await storage.loadSession(session.id))?.accessToken).toBe(
      "synthetic-access-token",
    );
    expect((await storage.findSessionsByShop(shop))[0].refreshToken).toBe(
      "synthetic-refresh-token",
    );
  });
  it("persists editor state and rejects stale saves or cross-shop access", async () => {
    const draft = await createDraft(shop, source, "production", pricing);
    const editor = editorFixture();
    editor.title = "Edited title";
    expect(await saveDraft(shop, draft.id, 1, editor)).toMatchObject({
      version: 2,
    });
    expect(JSON.parse((await getDraft(shop, draft.id)).editorJson).title).toBe(
      "Edited title",
    );
    await expect(saveDraft(shop, draft.id, 1, editor)).rejects.toMatchObject({
      code: "DRAFT_CONFLICT",
    });
    await expect(getDraft(other, draft.id)).rejects.toMatchObject({
      status: 404,
    });
    await expect(saveDraft(other, draft.id, 2, editor)).rejects.toMatchObject({
      status: 404,
    });
  });
  it("prevents cross-draft upload references and clones uploaded bytes for re-editing", async () => {
    const draft = await createDraft(shop, source, "production", pricing);
    const asset = await db.asset.create({
      data: {
        shop,
        draftId: draft.id,
        mime: "image/png",
        filename: "test.png",
        data: new Uint8Array([137, 80, 78, 71]),
      },
    });
    const editor = editorFixture();
    editor.images.push({
      id: "local",
      assetId: asset.id,
      url: `/app/api/assets/${asset.id}`,
      originalUrl: `/app/api/assets/${asset.id}`,
      selected: true,
      alt: "test",
    });
    await saveDraft(shop, draft.id, 1, editor);
    const next = await duplicateDraft(shop, draft.id);
    const copy = JSON.parse(next.editorJson).images.at(-1);
    expect(copy.assetId).not.toBe(asset.id);
    expect(
      (await db.asset.findUniqueOrThrow({ where: { id: copy.assetId } })).data,
    ).toEqual(asset.data);
    const foreign = await createDraft(other, source, "production", pricing);
    await expect(saveDraft(other, foreign.id, 1, editor)).rejects.toMatchObject(
      { status: 403 },
    );
  });
});
describe("Commerce AI jobs use the public contract and one idempotency key", () => {
  const apiKey = ["hio", "test", "synthetic_public_api_key_for_test_only"].join(
    "_",
  );
  afterEach(() => setAiTransportForTests());
  async function configure() {
    await saveSettings(shop, { ...pricing, apiKey });
    await db.shopSettings.update({
      where: { shop },
      data: { aiShopDomain: "billing.example.test" },
    });
  }
  it("translates with the saved billing shop and refuses operations outside V1", async () => {
    await configure();
    const draft = await createDraft(shop, source, "production", pricing);
    const transport = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/estimate"))
        return Response.json({
          request_id: "est_1",
          feature: "text.translate",
          count: 1,
          unit_credits: 2,
          credits_required: 2,
          credits_balance: 20,
          can_afford: true,
          credits_shortfall: 0,
        });
      const body = JSON.parse(String(init?.body));
      expect(init?.headers).toMatchObject({
        "X-Shop-Domain": "billing.example.test",
        Authorization: `Bearer ${apiKey}`,
      });
      expect(body).toMatchObject({
        source_language: "auto",
        target_language: "en",
        format_type: "text",
        scene: "e-commerce-cpv",
        texts: ["Material", "Plastic"],
      });
      return Response.json({
        request_id: "req_text",
        job_id: "job_text",
        credits_used: 2,
        credits_balance: 18,
        character_count: body.texts.join("").length,
        translations: [
          {
            translated_text: "Material EN",
            detected_language: "en",
            characters: 8,
          },
          {
            translated_text: "Plastic EN",
            detected_language: "en",
            characters: 8,
          },
        ],
      });
    });
    setAiTransportForTests(transport as typeof fetch);
    await createJob(shop, draft.id, "attribute_translation");
    const done = (await listJobs(shop))[0];
    expect(done).toMatchObject({
      status: "SUCCEEDED",
      provider: "hiobuy",
      simulated: false,
      result: {
        simulated: false,
        creditsUsed: 2,
        attributes: [{ name: "Material EN", value: "Plastic EN" }],
      },
    });
    expect(done.result.notice).not.toContain("SIMULATED");
    await expect(
      createJob(shop, draft.id, "seo_description"),
    ).rejects.toMatchObject({ code: "AI_FEATURE_NOT_PUBLIC" });
    await expect(
      createJob(shop, draft.id, "image_optimization", "image-1"),
    ).rejects.toMatchObject({ code: "AI_FEATURE_NOT_PUBLIC" });
  });
  it("does not start a paid task when the estimate cannot be afforded", async () => {
    await configure();
    const draft = await createDraft(shop, source, "production", pricing);
    const transport = vi.fn(async () =>
      Response.json({
        request_id: "est_2",
        feature: "text.translate",
        count: 1,
        unit_credits: 2,
        credits_required: 2,
        credits_balance: 0,
        can_afford: false,
        credits_shortfall: 2,
      }),
    );
    setAiTransportForTests(transport as typeof fetch);
    await expect(
      createJob(shop, draft.id, "title_translation"),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_CREDITS" });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(await db.aiJob.count()).toBe(0);
  });
  it("retries a lost response with the same key and copies only HIOBuy asset images", async () => {
    await configure();
    const draft = await createDraft(shop, source, "production", pricing);
    let imageCreates = 0;
    const transport = vi.fn(async (url: string, init?: RequestInit) => {
      const target = String(url);
      if (target.endsWith("/estimate"))
        return Response.json({
          request_id: "est_3",
          feature: "image.background",
          count: 1,
          unit_credits: 1,
          credits_required: 1,
          credits_balance: 5,
          can_afford: true,
          credits_shortfall: 0,
        });
      if (target.endsWith("/v1/ai/image/jobs")) {
        imageCreates += 1;
        if (imageCreates === 1) throw new Error("socket reset");
        expect(JSON.parse(String(init?.body))).toMatchObject({
          type: "white_background",
          image_url: "https://img.alicdn.com/test-fixture.jpg",
        });
        return Response.json({
          request_id: "req_img",
          job: {
            id: "job_img",
            status: "completed",
            credits_reserved: 1,
            credits_used: 1,
            output: { url: "https://evil.example/stolen.webp" },
          },
        });
      }
      if (target === "https://api.hiobuy.com/v1/ai/assets/job_img.webp")
        return new Response(
          Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1]),
          { status: 200, headers: { "Content-Type": "image/png" } },
        );
      throw new Error(`Unexpected AI URL ${target}`);
    });
    setAiTransportForTests(transport as typeof fetch);
    await expect(
      createJob(shop, draft.id, "image_background", "image-1"),
    ).rejects.toMatchObject({ code: "HIOBUY_NETWORK_ERROR" });
    const failed = await db.aiJob.findFirstOrThrow({ where: { shop } });
    expect(failed.errorCode).toBe("RETRY_SAME");
    await retryJob(shop, failed.id);
    const done = (await listJobs(shop))[0];
    expect(done).toMatchObject({
      status: "SUCCEEDED",
      attempts: 2,
      result: { simulated: false, imageId: "image-1" },
    });
    expect(done.result.imageUrl).toMatch(/^\/app\/api\/assets\//);
    expect(done.result.assetId).toBeTruthy();
    const keys = transport.mock.calls
      .filter((call) => String(call[0]).endsWith("/v1/ai/image/jobs"))
      .map((call) => {
        const headers = call[1]?.headers as Record<string, string>;
        return headers["X-Idempotency-Key"];
      });
    expect(keys).toEqual([failed.idempotencyKey, failed.idempotencyKey]);
    expect(
      transport.mock.calls.some((call) =>
        String(call[0]).includes("evil.example"),
      ),
    ).toBe(false);
    await expect(retryJob(other, failed.id)).rejects.toMatchObject({
      status: 404,
    });
  });
  it("copies the image when the provider has succeeded while the job is still running", async () => {
    await configure();
    const draft = await createDraft(shop, source, "production", pricing);
    const transport = vi.fn(async (url: string) => {
      const target = String(url);
      if (target.endsWith("/estimate"))
        return Response.json({
          request_id: "est_ready",
          feature: "image.remove_chinese_text",
          count: 1,
          unit_credits: 1,
          credits_required: 1,
          credits_balance: 5,
          can_afford: true,
          credits_shortfall: 0,
        });
      if (target.endsWith("/v1/ai/image/jobs"))
        return Response.json({
          request_id: "req_ready",
          job: {
            id: "job_ready",
            status: "running",
            billing_state: "provider_succeeded",
            credits_reserved: 1,
            credits_used: 1,
            output: {
              url: "https://api.hiobuy.com/v1/ai/assets/job_ready.webp",
            },
          },
        });
      if (target === "https://api.hiobuy.com/v1/ai/assets/job_ready.webp")
        return new Response(
          Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1]),
          { status: 200, headers: { "Content-Type": "image/png" } },
        );
      throw new Error(`Unexpected AI URL ${target}`);
    });
    setAiTransportForTests(transport as typeof fetch);
    await createJob(shop, draft.id, "image_text", "image-1");
    const done = (await listJobs(shop))[0];
    expect(done).toMatchObject({
      status: "SUCCEEDED",
      imageId: "image-1",
      result: { simulated: false, imageId: "image-1" },
    });
    expect(done.result.remoteUrl).toBe(
      "https://api.hiobuy.com/v1/ai/assets/job_ready.webp",
    );
    const assetCall = transport.mock.calls.find((call) =>
      String(call[0]).includes("/v1/ai/assets/job_ready.webp"),
    ) as [string, { headers?: Record<string, string> }] | undefined;
    expect(assetCall?.[1]?.headers).toMatchObject({
      Authorization: `Bearer ${apiKey}`,
      "X-Shop-Domain": "billing.example.test",
    });
  });
  it("keeps an in-progress task instead of paying for a replacement", async () => {
    await configure();
    const draft = await createDraft(shop, source, "production", pricing);
    const transport = vi.fn(async (url: string) => {
      const target = String(url);
      if (target.endsWith("/estimate"))
        return Response.json({
          request_id: "est_4",
          feature: "text.translate",
          count: 1,
          unit_credits: 2,
          credits_required: 2,
          credits_balance: 8,
          can_afford: true,
          credits_shortfall: 0,
        });
      if (target.endsWith("/translate"))
        return Response.json(
          {
            error: {
              code: "AI_REQUEST_IN_PROGRESS",
              message: "private upstream secret",
              request_id: "req_busy",
              details: { job_id: "job_busy" },
            },
          },
          { status: 409 },
        );
      if (target.endsWith("/jobs/job_busy"))
        return Response.json({
          request_id: "req_poll",
          job: {
            id: "job_busy",
            status: "completed",
            credits_used: 2,
            output: {
              character_count: 11,
              translations: [
                {
                  translated_text: "Watering can",
                  detected_language: "zh",
                  characters: 4,
                },
              ],
            },
          },
        });
      throw new Error(`Unexpected AI URL ${target}`);
    });
    setAiTransportForTests(transport as typeof fetch);
    await createJob(shop, draft.id, "title_translation");
    const done = (await listJobs(shop))[0];
    expect(done.result.text).toBe("Watering can");
    expect(JSON.stringify(done)).not.toContain("private upstream");
    expect(
      transport.mock.calls.filter((call) =>
        String(call[0]).endsWith("/translate"),
      ),
    ).toHaveLength(1);
  });
});
describe("real publishing service with a controlled Shopify GraphQL transport", () => {
  it("persists product ID, maps files and makes repeated clicks idempotent", async () => {
    const draft = await createDraft(shop, source, "production", pricing);
    const { admin, calls } = fakeAdmin();
    const first = await publishDraft(shop, draft.id, admin, 1);
    const second = await publishDraft(shop, draft.id, admin, 1);
    expect(first).toMatchObject({
      status: "SUCCEEDED",
      productId: "gid://shopify/Product/123",
      attempts: 1,
    });
    expect(second.id).toBe(first.id);
    expect(
      calls.filter((c) => c.query.includes("ImporterPublish")),
    ).toHaveLength(1);
    await expect(
      saveDraft(shop, draft.id, 1, editorFixture()),
    ).rejects.toMatchObject({ code: "IMPORT_SNAPSHOT_LOCKED" });
  });
  it("waits for Shopify media processing inside one import request", async () => {
    setMediaWaitForTests(5000);
    try {
      const draft = await createDraft(shop, source, "production", pricing);
      const fake = fakeAdmin({ processing: true });
      setTimeout(() => fake.setProcessing(false), 100);
      await expect(
        publishDraft(shop, draft.id, fake.admin, 1),
      ).resolves.toMatchObject({ status: "SUCCEEDED", attempts: 1 });
    } finally {
      setMediaWaitForTests(0);
    }
  });
  it("does not report success while Shopify is still processing images", async () => {
    const draft = await createDraft(shop, source, "production", pricing);
    const fake = fakeAdmin({ processing: true });
    await expect(
      publishDraft(shop, draft.id, fake.admin, 1),
    ).rejects.toMatchObject({ code: "SHOPIFY_MEDIA_PROCESSING" });
    expect(
      await db.importRecord.findUnique({ where: { draftId: draft.id } }),
    ).toMatchObject({ status: "NEEDS_RETRY", productId: null });
    fake.setProcessing(false);
    const result = await publishDraft(shop, draft.id, fake.admin);
    expect(result).toMatchObject({ status: "SUCCEEDED", attempts: 2 });
    expect(
      fake.calls.filter((c) => c.query.includes("ImporterFile(")),
    ).toHaveLength(2);
  });
  it("reconciles a response lost after remote creation using the same identifier", async () => {
    const draft = await createDraft(shop, source, "production", pricing);
    const fake = fakeAdmin({ failProduct: true });
    await expect(
      publishDraft(shop, draft.id, fake.admin, 1),
    ).rejects.toMatchObject({ code: "SHOPIFY_CONNECTION_ERROR" });
    await publishDraft(shop, draft.id, fake.admin);
    const calls = fake.calls.filter((c) => c.query.includes("ImporterPublish"));
    expect(calls).toHaveLength(2);
    expect(calls[0].variables.identifier.handle).toBe(
      `hiobuy-1688-${draft.id}`,
    );
    expect(calls[1].variables.identifier).toEqual({
      id: "gid://shopify/Product/123",
    });
    expect(calls[1].variables.input).toEqual(calls[0].variables.input);
  });
  it("rejects a second running request, stale initial version, and cross-shop imports", async () => {
    const draft = await createDraft(shop, source, "production", pricing);
    const fake = fakeAdmin({ processing: true });
    await expect(
      publishDraft(shop, draft.id, fake.admin, 99),
    ).rejects.toMatchObject({ code: "DRAFT_CONFLICT" });
    await expect(
      publishDraft(other, draft.id, fake.admin, 1),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      publishDraft(shop, draft.id, fake.admin, 1),
    ).rejects.toMatchObject({ code: "SHOPIFY_MEDIA_PROCESSING" });
    await db.importRecord.update({
      where: { draftId: draft.id },
      data: { status: "RUNNING", lockedAt: new Date(), lockToken: "held" },
    });
    await expect(
      publishDraft(shop, draft.id, fake.admin),
    ).rejects.toMatchObject({ code: "IMPORT_RUNNING" });
  });
});

describe("publication edge cases", () => {
  it("serializes simultaneous requests into one product write", async () => {
    const draft = await createDraft(shop, source, "production", pricing);
    const fake = fakeAdmin();
    const results = await Promise.allSettled([
      publishDraft(shop, draft.id, fake.admin, 1),
      publishDraft(shop, draft.id, fake.admin, 1),
    ]);
    expect(results.some((r) => r.status === "fulfilled")).toBe(true);
    expect(await db.importRecord.count({ where: { draftId: draft.id } })).toBe(
      1,
    );
    expect(
      fake.calls.filter((c) => c.query.includes("ImporterPublish")),
    ).toHaveLength(1);
  });
  it("uploads draft-owned local bytes only to a Shopify-provided staged target", async () => {
    const draft = await createDraft(shop, source, "production", pricing);
    const bytes = new Uint8Array([137, 80, 78, 71]);
    const asset = await db.asset.create({
      data: {
        shop,
        draftId: draft.id,
        mime: "image/png",
        filename: "upload.png",
        data: bytes,
      },
    });
    const editor = editorFixture();
    editor.images.push({
      id: `upload-${asset.id}`,
      assetId: asset.id,
      url: `/app/api/assets/${asset.id}`,
      originalUrl: `/app/api/assets/${asset.id}`,
      selected: true,
      alt: "Local PNG",
    });
    await saveDraft(shop, draft.id, 1, editor);
    const transport = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }));
    try {
      const fake = fakeAdmin();
      expect(await publishDraft(shop, draft.id, fake.admin, 2)).toMatchObject({
        status: "SUCCEEDED",
      });
      expect(transport).toHaveBeenCalledTimes(1);
      const [url, request] = transport.mock.calls[0];
      expect(url).toBe(
        "https://shopify-staged-uploads.storage.googleapis.com/",
      );
      const file = (request?.body as FormData).get("file") as File;
      expect(file.type).toBe("image/png");
      expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes);
      expect(request?.redirect).toBe("error");
      expect(
        fake.calls.find((c) => c.query.includes("ImporterStage"))?.variables
          .input[0],
      ).toMatchObject({
        filename: "upload.png",
        mimeType: "image/png",
        resource: "IMAGE",
      });
    } finally {
      transport.mockRestore();
    }
  });
});
describe("Commerce AI account discovery", () => {
  const key = (name: string) =>
    ["hio", "live", `synthetic_${name}_key_for_test_only`].join("_");
  const pricingRules = { request_id: "p", rules: [] };
  afterEach(() => setAiTransportForTests());
  function account(shopName: string, balance = 0) {
    return Response.json({
      request_id: "req_account",
      workspace_id: "ws_1",
      shop: shopName,
      account_type: "prepaid",
      status: "active",
      currency: "USD",
      credits_balance: balance,
    });
  }
  it("finds the account from the key alone and rediscovers after a key change", async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    let next = "first.ai.example.test";
    setAiTransportForTests((async (url: string, init?: RequestInit) => {
      calls.push({
        url: String(url),
        headers: init?.headers as Record<string, string>,
      });
      return String(url).endsWith("/v1/ai/account")
        ? account(next)
        : Response.json(pricingRules);
    }) as typeof fetch);
    await saveSettings(shop, { ...pricing, apiKey: key("first") });
    const status = await readAiStatus(shop);
    expect(status).toMatchObject({
      shopDomain: "first.ai.example.test",
      creditsBalance: 0,
    });
    const lookup = calls.find((call) => call.url.endsWith("/v1/ai/account"))!;
    expect(lookup.headers).not.toHaveProperty("X-Shop-Domain");
    expect(lookup.headers.Authorization).toBe(`Bearer ${key("first")}`);
    expect(publicSettings(await getSettings(shop)).aiAccount).toBe(
      "first.ai.example.test",
    );
    expect(JSON.stringify(status)).not.toContain(key("first"));
    next = "second.ai.example.test";
    await saveSettings(shop, { ...pricing, apiKey: key("second") });
    expect(publicSettings(await getSettings(shop)).aiAccount).toBe("");
    expect((await readAiStatus(shop)).shopDomain).toBe(
      "second.ai.example.test",
    );
    expect(publicSettings(await getSettings(other)).aiAccount).toBe("");
  });
  it("explains a missing account without inventing a billing shop", async () => {
    setAiTransportForTests((async () =>
      Response.json(
        {
          error: {
            code: "AI_ACCOUNT_NOT_FOUND",
            message: "not found",
            request_id: "req_missing",
          },
        },
        { status: 404 },
      )) as typeof fetch);
    await saveSettings(shop, { ...pricing, apiKey: key("missing") });
    await expect(readAiStatus(shop)).rejects.toMatchObject({
      code: "AI_ACCOUNT_NOT_FOUND",
      requestId: "req_missing",
      message: expect.stringContaining("AI Enhancement"),
    });
    expect((await getSettings(shop)).aiShopDomain).toBeNull();
  });
  it("keeps the original AI account for an existing task", async () => {
    await saveSettings(shop, { ...pricing, apiKey: key("keep") });
    await db.shopSettings.update({
      where: { shop },
      data: { aiShopDomain: "new.ai.example.test" },
    });
    const draft = await createDraft(shop, source, "production", pricing);
    const job = await db.aiJob.create({
      data: {
        shop,
        draftId: draft.id,
        provider: "hiobuy",
        capability: "title_translation",
        status: "RUNNING",
        inputJson: JSON.stringify({ texts: ["标题"] }),
        requestJson: "{}",
        idempotencyKey: "idem-keep",
        aiAccount: "old.ai.example.test",
        remoteJobId: "job_keep",
        readyAt: new Date(),
        nextPollAt: new Date(0),
      },
    });
    const seen: string[] = [];
    setAiTransportForTests((async (_url: string, init?: RequestInit) => {
      seen.push((init?.headers as Record<string, string>)["X-Shop-Domain"]);
      return Response.json({
        request_id: "req_poll",
        job_id: "job_keep",
        status: "processing",
      });
    }) as typeof fetch);
    await listJobs(shop, draft.id);
    expect(seen).toEqual(["old.ai.example.test"]);
    await db.aiJob.delete({ where: { id: job.id } });
  });
});
