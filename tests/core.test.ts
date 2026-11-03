import { describe, it, expect, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { encrypt, decrypt } from "../app/lib/crypto.server";
import {
  parse1688Url,
  safeImageUrl,
  sanitizeDescription,
  validateImage,
  assertMutation,
  readJson,
  MAX_IMAGE_BYTES,
} from "../app/lib/validation.server";
import { alignCurrency, calculatePrice } from "../app/lib/pricing";
import { normalizeDetail, normalizeList } from "../app/lib/normalize.server";
import {
  descriptionWithAttributes,
  productSetInput,
  validatePublish,
} from "../app/lib/publish-mapping";
import { HiobuyClient } from "../app/lib/hiobuy.server";
import { HiobuyAiClient } from "../app/lib/ai/hiobuy-ai.server";
import { MockAiProvider } from "../app/lib/ai/mock.server";
import { capabilities } from "../app/lib/schema";
import { makeEditor } from "../app/lib/products";
import { source, pricing, editorFixture } from "./fixtures";
describe("credential encryption", () => {
  it("uses randomized authenticated encryption and detects tampering", () => {
    const secret = randomBytes(24).toString("hex");
    const a = encrypt(secret);
    expect(a).not.toContain(secret);
    expect(encrypt(secret)).not.toBe(a);
    expect(decrypt(a)).toBe(secret);
    const parts = a.split(".");
    parts[3] = Buffer.from("tampered").toString("base64");
    expect(() => decrypt(parts.join("."))).toThrow();
  });
  it("rejects missing or weak encryption keys", () => {
    const previous = process.env.ENCRYPTION_KEY;
    delete process.env.ENCRYPTION_KEY;
    expect(() => encrypt("x")).toThrow("32 random bytes");
    process.env.ENCRYPTION_KEY = previous;
  });
});
describe("input boundaries", () => {
  it("canonicalizes 1688 offer URLs without fetching them", () => {
    expect(
      parse1688Url(
        "https://detail.1688.com/offer/123456789012.html?utm_source=test#x",
      ),
    ).toEqual({ id: source.id, url: source.source_url });
  });
  it.each([
    "http://detail.1688.com/offer/123456789012.html",
    "https://detail.1688.com.evil.test/offer/123456789012.html",
    "https://localhost/offer/123456789012.html",
    "https://detail.1688.com:9000/offer/123456789012.html",
    "https://user:pass@detail.1688.com/offer/123456789012.html",
    "https://1688.com/path",
    "file:///etc/passwd",
    "https://detail.1688.com/offer/123456789012.html/extra",
  ])("rejects unsafe product URL %s", (url) =>
    expect(() => parse1688Url(url)).toThrow(),
  );
  it("only accepts HTTPS image CDN URLs", () => {
    expect(safeImageUrl("//img.alicdn.com/a.jpg")).toBe(
      "https://img.alicdn.com/a.jpg",
    );
    expect(safeImageUrl("https://alicdn.com.evil.test/a")).toBe("");
    expect(safeImageUrl("https://127.0.0.1/a")).toBe("");
    expect(safeImageUrl("data:image/svg+xml,x")).toBe("");
  });
  it("removes scripts, event handlers, unsafe links and image hosts", () => {
    const clean = sanitizeDescription(
      '<p onclick="evil()">Hi<script>alert(1)</script><img src="https://127.0.0.1/x"><a href="javascript:evil()">link</a><img src="https://img.alicdn.com/ok.jpg" onerror="evil()"></p>',
    );
    expect(clean).not.toMatch(/script|onclick|onerror|127\.0\.0\.1/);
    expect(clean).toContain("https://img.alicdn.com/ok.jpg");
    expect(clean).toContain('referrerpolicy="no-referrer"');
  });
  it("checks signatures, MIME type and size", async () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jXu4AAAAASUVORK5CYII=",
      "base64",
    );
    expect(
      (await validateImage(new File([png], "x.png", { type: "image/png" })))
        .mime,
    ).toBe("image/png");
    await expect(
      validateImage(new File([png], "bad.jpg", { type: "image/jpeg" })),
    ).rejects.toThrow("does not match");
    await expect(
      validateImage(
        new File([new Uint8Array(MAX_IMAGE_BYTES + 1)], "large.png", {
          type: "image/png",
        }),
      ),
    ).rejects.toThrow("4 MB");
  });
  it("requires same-origin POST and bounds JSON bodies", async () => {
    const req = new Request("https://importer.example.com/app/api", {
      method: "POST",
      headers: {
        Origin: "https://evil.test",
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    expect(() => assertMutation(req)).toThrow("origin");
    await expect(
      readJson(
        new Request("https://importer.example.com/app/api", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ x: "x".repeat(1024 * 1024) }),
        }),
      ),
    ).rejects.toThrow("large");
  });
});
describe("documented HIOBuy standard models", () => {
  it("normalizes detail and keeps variant identity separate from display properties", () => {
    const product = normalizeDetail({
      product: { ...source, private_secret: "must disappear" },
    });
    expect(product.id).toBe(source.id);
    expect(product).not.toHaveProperty("private_secret");
    expect(editorFixture().variants[0].options.map((o) => o.key)).toEqual([
      "1",
      "2",
    ]);
  });
  it("uses zero promotional prices and does not invent missing source costs", () => {
    const p = normalizeDetail({
      product: {
        ...source,
        variants: [
          {
            ...source.variants[0],
            price: { promotion_amount: 0, display_amount: 9 },
          },
        ],
      },
    });
    expect(p.variants[0].price.promotion_amount).toBe(0);
    expect(calculatePrice(null, pricing)).toBe("");
  });
  it("rejects undocumented upstream envelopes instead of guessing", () => {
    expect(() => normalizeDetail({ upstream: { result: {} } })).toThrow(
      "standard model",
    );
    expect(() => normalizeList({ data: [] })).toThrow("standard model");
  });
  it("maps summary data without fetching full details", () => {
    expect(
      normalizeList({
        channel: "1688",
        page: 2,
        page_size: 20,
        total: 25,
        items: [
          {
            id: source.id,
            title: source.title,
            image: source.images[0].url,
            price: source.price,
          },
        ],
      }).items[0].priceCny,
    ).toBe(12.8);
  });
});
describe("pricing and Shopify mapping", () => {
  it("follows the store currency and drops the rate for CNY stores", () => {
    expect(alignCurrency(pricing, "CNY")).toMatchObject({
      currency: "CNY",
      exchangeRate: "1",
    });
    expect(alignCurrency({ ...pricing, currency: "USD" }, "EUR")).toMatchObject(
      { currency: "EUR", exchangeRate: pricing.exchangeRate },
    );
    const same = { ...pricing, currency: "USD" };
    expect(alignCurrency(same, "USD")).toBe(same);
  });
  it("calculates decimal prices and rounds upward to .99", () => {
    expect(calculatePrice(12.8, pricing)).toBe("4.48");
    expect(calculatePrice(12.8, { ...pricing, rounding: "ending_99" })).toBe(
      "4.99",
    );
    expect(
      calculatePrice(10, {
        ...pricing,
        currency: "JPY",
        exchangeRate: "20",
        multiplier: "1.1",
      }),
    ).toBe("220");
  });
  it("maps multiple options, variant SKUs, collections and picture association", () => {
    const editor = editorFixture();
    editor.collections = ["gid://shopify/Collection/123"];
    const input = productSetInput(editor, "fixed-handle", {
      "image-1": "gid://shopify/MediaImage/1",
      "image-2": "gid://shopify/MediaImage/2",
    });
    expect(input.variants[0]).toMatchObject({
      sku: "test-sku-green-s",
      price: "4.48",
      file: { id: "gid://shopify/MediaImage/1" },
      optionValues: [
        { optionName: "Color", name: "Green" },
        { optionName: "Size", name: "Small" },
      ],
      inventoryItem: { tracked: false },
    });
    expect(input.productOptions[1].values).toEqual([
      { name: "Small" },
      { name: "Large" },
    ]);
    expect(input.collections).toEqual(editor.collections);
  });
  it("preserves existing variant IDs when safely replaying an upsert", () => {
    const editor = editorFixture();
    expect(
      productSetInput(editor, "x", {}, [
        {
          id: "gid://shopify/ProductVariant/1",
          selectedOptions: [
            { name: "Size", value: "Small" },
            { name: "Color", value: "Green" },
          ],
        },
      ]).variants[0].id,
    ).toBe("gid://shopify/ProductVariant/1");
  });
  it("prevents sandbox active imports, currency mistakes and duplicate option combinations", () => {
    const editor = editorFixture();
    editor.pricing.publishStatus = "ACTIVE";
    expect(() => validatePublish(editor, "sandbox", "USD")).toThrow("Sandbox");
    expect(() => validatePublish(editor, "production", "EUR")).toThrow(
      "store currency",
    );
    editor.variants[1].options = structuredClone(editor.variants[0].options);
    expect(() => validatePublish(editor, "production", "USD")).toThrow(
      "same option",
    );
  });
  it("requires selected images for referenced SKU pictures", () => {
    const editor = editorFixture();
    editor.images[0].selected = false;
    expect(() => validatePublish(editor, "production", "USD")).toThrow(
      "excluded",
    );
  });
});
describe("public API client", () => {
  it("uses only public paths, Bearer auth and standard format without automatic retries", async () => {
    const transport = vi.fn().mockResolvedValue(Response.json({ items: [] }));
    const client = new HiobuyClient("test-key", transport);
    await client.search("plants", 2);
    expect(transport).toHaveBeenCalledTimes(1);
    const [url, options] = transport.mock.calls[0];
    expect(url).toBe("https://api.hiobuy.com/v1/products/search");
    expect(options.headers.Authorization).toBe("Bearer test-key");
    expect(JSON.parse(options.body)).toEqual({
      channel: "1688",
      response_format: "standard",
      keyword: "plants",
      page: 2,
      page_size: 20,
      language: "en",
    });
  });
  it("returns bounded public errors and request IDs without reflecting secrets", async () => {
    const transport = vi.fn().mockResolvedValue(
      Response.json(
        {
          error: {
            code: "QUOTA_EXCEEDED",
            message: "private upstream token = something",
          },
          request_id: "req_test",
        },
        { status: 429 },
      ),
    );
    await expect(
      new HiobuyClient("test-key", transport).search("x"),
    ).rejects.toMatchObject({
      code: "QUOTA_EXCEEDED",
      requestId: "req_test",
      message: expect.not.stringContaining("private upstream"),
    });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("uploads bare base64 and reuses image ID for paginated search", async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ image_id: "image-fixture" }))
      .mockResolvedValueOnce(Response.json({ items: [] }));
    const client = new HiobuyClient("test-key", transport);
    const id = await client.uploadImage(Buffer.from("image"));
    await client.imageSearch(id, 3);
    expect(JSON.parse(transport.mock.calls[0][1].body).image_base64).toBe(
      "aW1hZ2U=",
    );
    expect(JSON.parse(transport.mock.calls[1][1].body)).toMatchObject({
      image_id: "image-fixture",
      page: 3,
    });
  });
});
describe("Commerce AI V1 client", () => {
  it("sends the billing shop and idempotency key only where the contract requires them", async () => {
    const transport = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/v1/ai/credits/pricing"))
        return Response.json({
          request_id: "price_1",
          rules: [
            {
              feature: "text.translate",
              credits: 2,
              default_credits: 9,
              enabled: true,
              source: "default",
            },
            { feature: "private.operation", credits: 99, enabled: true, source: "default", default_credits: 99 },
          ],
        });
      return Response.json({
        request_id: "bal_1",
        workspace_id: "ws_hidden",
        shop: "billing.example.test",
        credits_balance: 40,
      });
    });
    const client = new HiobuyAiClient(
      "test-key",
      "billing.example.test",
      transport as typeof fetch,
    );
    await client.credits();
    await client.pricing();
    const firstHeaders = transport.mock.calls[0]?.[1]?.headers as Record<
      string,
      string
    >;
    const priceHeaders = transport.mock.calls[1]?.[1]?.headers as Record<
      string,
      string
    >;
    expect(firstHeaders["X-Shop-Domain"]).toBe("billing.example.test");
    expect(priceHeaders["X-Shop-Domain"]).toBeUndefined();
    const image = await client.createImageJob(
      {
        type: "white_background",
        image_url: "https://img.alicdn.com/test-fixture.jpg",
      },
      "intent-1",
    );
    expect(image.credits_balance).toBe(40);
    const imageCall = transport.mock.calls[2];
    expect(String(imageCall?.[0])).toBe(
      "https://api.hiobuy.com/v1/ai/image/jobs",
    );
    expect(imageCall?.[1]?.headers).toMatchObject({
      Authorization: "Bearer test-key",
      "X-Shop-Domain": "billing.example.test",
      "X-Idempotency-Key": "intent-1",
    });
    expect(JSON.parse(String(imageCall?.[1]?.body))).toEqual({
      type: "white_background",
      image_url: "https://img.alicdn.com/test-fixture.jpg",
    });
  });
  it("hides upstream error text and keeps a recorded job id", async () => {
    const transport = vi.fn(async (_url: string, _init?: RequestInit) =>
      Response.json(
        {
          error: {
            code: "AI_REQUEST_IN_PROGRESS",
            message: "private upstream secret",
            request_id: "req_ai",
            details: { job_id: "job_recorded" },
          },
        },
        { status: 409 },
      ),
    );
    const client = new HiobuyAiClient(
      "test-key",
      "billing.example.test",
      transport as typeof fetch,
    );
    await expect(
      client.translate({ texts: ["水壶"] }, "intent-1"),
    ).rejects.toMatchObject({
      code: "AI_REQUEST_IN_PROGRESS",
      remoteJobId: "job_recorded",
      requestId: "req_ai",
      message: expect.not.stringContaining("private upstream"),
    });
    const idempotency = (
      transport.mock.calls[0]?.[1]?.headers as Record<string, string>
    )["X-Idempotency-Key"];
    expect(idempotency).toBe("intent-1");
  });
});

describe("mock AI provider contract", () => {
  it.each(capabilities)(
    "clearly labels %s as simulated and never uses the network",
    async (capability) => {
      const transport = vi.spyOn(globalThis, "fetch");
      const result = await new MockAiProvider().run(capability, {
        text: "Supplier title",
        imageId: "image-1",
        imageUrl: "https://img.alicdn.com/x.jpg",
        attributes: [{ name: "Color", value: "Green" }],
      });
      expect(result.simulated).toBe(true);
      expect(result.notice).toContain("SIMULATED");
      expect(transport).not.toHaveBeenCalled();
      transport.mockRestore();
    },
  );
});

describe("source option ordering and editable attributes", () => {
  it("orders option dimensions consistently and uses documented swatch images", () => {
    const product = structuredClone(source);
    product.variants[1].attributes.reverse();
    product.variants[1].image = null;
    product.variants[1].attributes[0].image = source.images[1].url;
    const editor = makeEditor(product, pricing);
    expect(editor.variants.map((v) => v.options.map((o) => o.name))).toEqual([
      ["Color", "Size"],
      ["Color", "Size"],
    ]);
    expect(editor.variants[1].imageId).toBe("image-2");
  });
  it("publishes edited attributes as escaped description content", () => {
    const editor = editorFixture();
    editor.attributes = [{ name: "Material <b>", value: "Cotton & linen" }];
    const html = descriptionWithAttributes(editor);
    expect(html).toContain("Material &lt;b&gt;");
    expect(html).toContain("Cotton &amp; linen");
    expect(html).toContain(editor.descriptionHtml);
  });
});
