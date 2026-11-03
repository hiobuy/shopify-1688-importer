import { randomUUID } from "node:crypto";
import db from "../../db.server";
import { getDraft } from "../drafts.server";
import { AppError } from "../errors";
import { HIOBUY_ORIGIN } from "../hiobuy.server";
import { cacheAiAccount, getAiCredential } from "../settings.server";
import { capabilitySchema, editorSchema, type AiCapability } from "../schema";
import {
  aiTask,
  isPublicAiCapability,
  type PublicAiCapability,
} from "./capabilities";
import { HiobuyAiCallError, HiobuyAiClient } from "./hiobuy-ai.server";
import { MockAiProvider } from "./mock.server";
import type { AiInput, AiResult } from "./provider";

const mock = new MockAiProvider();
const RESULT_IMAGE_BYTES = 10 * 1024 * 1024;
let transport: typeof fetch = fetch;

export function setAiTransportForTests(next?: typeof fetch) {
  transport = next || fetch;
}

async function aiAccount(shop: string, refresh = false) {
  const credential = await getAiCredential(shop);
  if (credential.cachedAccount && !refresh)
    return { key: credential.key, shopDomain: credential.cachedAccount };
  const found = await new HiobuyAiClient(
    credential.key,
    "",
    transport,
  ).account();
  await cacheAiAccount(shop, credential.keyEncrypted, found.shop);
  return { key: credential.key, shopDomain: found.shop, found };
}

type TextSlot = { index: number; field: "name" | "value" };
type StoredInput = AiInput & {
  texts?: string[];
  slots?: TextSlot[];
};

export async function createJob(
  shop: string,
  draftId: string,
  capability: AiCapability,
  imageId?: string,
) {
  capabilitySchema.parse(capability);
  if (!isPublicAiCapability(capability))
    throw new AppError(
      "Commerce AI V1 does not include this operation. Edit the field manually.",
      400,
      "AI_FEATURE_NOT_PUBLIC",
    );
  const draft = await getDraft(shop, draftId);
  if (await db.importRecord.findUnique({ where: { draftId } }))
    throw new AppError(
      "Reopen the import as a new draft before running AI tools.",
      409,
    );
  if (
    (await db.aiJob.count({
      where: { shop, status: { in: ["QUEUED", "RUNNING"] } },
    })) >= 8
  )
    throw new AppError("Wait for your current AI tasks to finish.", 429);
  if (imageId) await assertImageAvailable(shop, draftId, imageId);
  const editor = editorSchema.parse(JSON.parse(draft.editorJson));
  const prepared = prepare(capability, editor, imageId);
  const account = await aiAccount(shop);
  const client = new HiobuyAiClient(account.key, account.shopDomain, transport);
  const estimate = await client.estimate(prepared.estimate);
  if (!estimate.canAfford)
    throw new AppError(
      `Not enough AI Credits. This task needs ${formatCredits(estimate.creditsRequired)} and the balance is ${formatCredits(estimate.creditsBalance)}. Top up in the HIOBuy developer center. Product API quota is separate and was not used.`,
      402,
      "INSUFFICIENT_CREDITS",
    );
  const job = await db.aiJob.create({
    data: {
      shop,
      draftId,
      provider: "hiobuy",
      capability,
      inputJson: JSON.stringify(prepared.input),
      requestJson: JSON.stringify(prepared.body),
      idempotencyKey: randomUUID(),
      aiAccount: account.shopDomain,
      readyAt: new Date(),
      nextPollAt: new Date(),
    },
  });
  await submit(job.id, client);
  return job;
}

export async function listJobs(shop: string, draftId?: string) {
  const jobs = await db.aiJob.findMany({
    where: { shop, ...(draftId ? { draftId } : {}) },
    orderBy: { createdAt: "desc" },
    take: 40,
  });
  for (const job of jobs) {
    if (!["QUEUED", "RUNNING"].includes(job.status)) continue;
    if (job.provider === "mock") {
      await settleMock(job);
      continue;
    }
    if (job.remoteJobId) await poll(job);
    else if (job.errorCode === "RATE_LIMITED") await resumeRateLimit(job);
  }
  return jobs.map(present);
}

export async function retryJob(shop: string, jobId: string) {
  const job = await db.aiJob.findFirst({ where: { id: jobId, shop } });
  if (!job) throw new AppError("AI task not found.", 404);
  if (await db.importRecord.findUnique({ where: { draftId: job.draftId } }))
    throw new AppError(
      "The imported snapshot is locked. Reopen it as a new draft.",
      409,
    );
  if (job.provider === "mock") return retryMock(shop, jobId);
  if (job.status !== "FAILED")
    throw new AppError("Only failed AI tasks can be retried.", 409);
  if (job.errorCode === "REJECTED" || job.errorCode === "REFUNDED")
    throw new AppError(
      job.error || "Start a new AI task. This one cannot be replayed.",
      409,
    );
  if (
    job.nextPollAt &&
    job.nextPollAt.getTime() > Date.now() &&
    job.errorCode === "RETRY_SAME"
  )
    throw new AppError(
      `Wait ${Math.ceil((job.nextPollAt.getTime() - Date.now()) / 1000)} seconds before retrying this same AI task.`,
      429,
      "RATE_LIMITED",
    );
  const claimed = await db.aiJob.updateMany({
    where: { id: jobId, shop, status: "FAILED" },
    data: {
      status: job.remoteJobId ? "RUNNING" : "QUEUED",
      error: null,
      errorCode: null,
      attempts: { increment: 1 },
      nextPollAt: new Date(),
    },
  });
  if (!claimed.count)
    throw new AppError("Only failed AI tasks can be retried.", 409);
  if (!job.remoteJobId) {
    const account = await aiAccount(shop);
    await submit(
      jobId,
      new HiobuyAiClient(
        account.key,
        job.aiAccount || account.shopDomain,
        transport,
      ),
    );
  }
}

export async function readAiStatus(shop: string) {
  const account = await aiAccount(shop, true);
  const client = new HiobuyAiClient(account.key, account.shopDomain, transport);
  const pricing = await client.pricing();
  const balance = account.found!;
  const allowed = new Set([
    "text.translate",
    "image.remove_chinese_text",
    "image.replace_chinese_text",
    "image.background",
  ]);
  return {
    shopDomain: balance.shop || account.shopDomain,
    creditsBalance: balance.creditsBalance,
    rules: pricing.rules
      .filter((rule) => allowed.has(rule.feature))
      .map((rule) => ({
        feature: rule.feature,
        credits: rule.credits,
        enabled: rule.enabled,
      })),
  };
}

async function assertImageAvailable(
  shop: string,
  draftId: string,
  imageId: string,
) {
  const jobs = await db.aiJob.findMany({
    where: {
      shop,
      draftId,
      applied: false,
      status: { in: ["QUEUED", "RUNNING", "SUCCEEDED"] },
    },
    select: { status: true, inputJson: true },
  });
  const blocking = jobs.find((job) => {
    try {
      return JSON.parse(job.inputJson).imageId === imageId;
    } catch {
      return false;
    }
  });
  if (!blocking) return;
  throw new AppError(
    blocking.status === "SUCCEEDED"
      ? "Confirm this image before running another tool on it."
      : "This image already has an AI task in progress.",
    409,
    "IMAGE_REVIEW_REQUIRED",
  );
}

function prepare(
  capability: PublicAiCapability,
  editor: ReturnType<typeof editorSchema.parse>,
  imageId?: string,
) {
  const task = aiTask(capability);
  if (task.kind === "text") {
    const packed = packText(capability, editor);
    const body = {
      texts: packed.texts,
      source_language: "auto",
      target_language: "en",
      format_type: task.format_type,
      scene: task.scene,
    };
    return {
      input: {
        targetLanguage: "en",
        texts: packed.texts,
        slots: packed.slots,
        attributes: packed.attributes,
        text: packed.texts.length === 1 ? packed.texts[0] : undefined,
      } satisfies StoredInput,
      estimate: body.texts.length
        ? { feature: task.feature, ...body }
        : { feature: task.feature },
      body,
    };
  }
  const image = editor.images.find((item) => item.id === imageId);
  if (!image) throw new AppError("Choose an image for this AI operation.");
  const imageUrl = publicImageUrl(image);
  const body: Record<string, unknown> = {
    type: task.type,
    image_url: imageUrl,
    ...(capability === "image_translation" ? { target_language: "en" } : {}),
  };
  return {
    input: {
      imageId: image.id,
      imageUrl,
      targetLanguage: "en",
    } satisfies StoredInput,
    estimate: { feature: task.feature, count: 1 },
    body,
  };
}

function packText(
  capability: PublicAiCapability,
  editor: ReturnType<typeof editorSchema.parse>,
) {
  if (capability === "attribute_translation") {
    const slots: TextSlot[] = [];
    const texts: string[] = [];
    editor.attributes.forEach((attribute, index) => {
      for (const field of ["name", "value"] as const) {
        const value = attribute[field].trim();
        if (!value) continue;
        slots.push({ index, field });
        texts.push(value);
      }
    });
    assertTexts(texts);
    return { texts, slots, attributes: editor.attributes };
  }
  const source =
    capability === "title_translation" ? editor.title : editor.descriptionHtml;
  const texts = [source.trim()];
  assertTexts(texts);
  return { texts, slots: undefined, attributes: undefined };
}

function assertTexts(texts: string[]) {
  if (!texts.length || texts.some((text) => !text))
    throw new AppError("Enter text before translating it.");
  if (texts.length > 50)
    throw new AppError(
      "Commerce AI accepts at most 50 text values at once. Reduce the attributes and try again.",
    );
  const units = texts.reduce((sum, text) => sum + text.length, 0);
  if (units > 50000)
    throw new AppError(
      "This text exceeds 50,000 characters. Shorten it before translating.",
    );
}

function publicImageUrl(image: {
  url: string;
  originalUrl: string;
  aiSourceUrl?: string;
}) {
  const candidate = [image.aiSourceUrl, image.url, image.originalUrl].find(
    (value) =>
      !!value &&
      value.startsWith("https://") &&
      !value.includes("/app/api/assets/"),
  );
  if (!candidate)
    throw new AppError(
      "Commerce AI needs an approved HTTPS image URL. Local uploads are not sent to HIOBuy.",
      400,
      "IMAGE_HOST_NOT_ALLOWED",
    );
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new AppError(
      "Choose an approved HTTPS product image.",
      400,
      "UNSAFE_IMAGE_URL",
    );
  }
  const blocked =
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.hostname === "localhost" ||
    url.hostname.endsWith(".local") ||
    /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.|0\.0\.0\.0)/.test(
      url.hostname,
    );
  if (blocked)
    throw new AppError(
      "Choose an approved public HTTPS product image.",
      400,
      "UNSAFE_IMAGE_URL",
    );
  return url.href;
}

async function submit(jobId: string, client: HiobuyAiClient) {
  const job = await db.aiJob.findUniqueOrThrow({ where: { id: jobId } });
  if (!job.idempotencyKey || !job.requestJson)
    throw new AppError("This AI task has no saved request.", 409);
  const body = JSON.parse(job.requestJson) as Record<string, unknown>;
  const capability = capabilitySchema.parse(job.capability);
  try {
    const response =
      isPublicAiCapability(capability) && aiTask(capability).kind === "image"
        ? await client.createImageJob(body, job.idempotencyKey)
        : await client.translate(body, job.idempotencyKey);
    await applyRemote(job, response, client);
  } catch (error) {
    if (!(error instanceof HiobuyAiCallError)) throw error;
    if (error.remoteJobId) {
      await db.aiJob.update({
        where: { id: job.id },
        data: {
          remoteJobId: error.remoteJobId,
          status: "RUNNING",
          error: null,
          errorCode: null,
          nextPollAt: new Date(),
        },
      });
      return;
    }
    if (error.status === 429 || error.status === 503) {
      await db.aiJob.update({
        where: { id: job.id },
        data: {
          status: "QUEUED",
          error:
            "HIOBuy is limiting new tasks. This one will start again shortly, and it has not been charged again.",
          errorCode: "RATE_LIMITED",
          nextPollAt: new Date(Date.now() + (error.retryAfterMs || 20000)),
        },
      });
      throw error;
    }
    const delay = error.retryAfterMs || 0;
    await db.aiJob.update({
      where: { id: job.id },
      data: {
        status: "FAILED",
        error: error.message,
        errorCode: terminal(error) ? "REJECTED" : "RETRY_SAME",
        nextPollAt: delay ? new Date(Date.now() + delay) : null,
      },
    });
    throw error;
  }
}

async function resumeRateLimit(job: {
  id: string;
  shop: string;
  aiAccount: string | null;
  status: string;
  nextPollAt: Date | null;
}) {
  if (job.status !== "QUEUED" || (job.nextPollAt && job.nextPollAt > new Date()))
    return;
  const claimed = await db.aiJob.updateMany({
    where: {
      id: job.id,
      status: "QUEUED",
      remoteJobId: null,
      errorCode: "RATE_LIMITED",
      nextPollAt: { lte: new Date() },
    },
    data: {
      nextPollAt: new Date(Date.now() + 30000),
      error: null,
    },
  });
  if (!claimed.count) return;
  try {
    const account = await aiAccount(job.shop);
    await submit(
      job.id,
      new HiobuyAiClient(
        account.key,
        job.aiAccount || account.shopDomain,
        transport,
      ),
    );
  } catch (error) {
    if (error instanceof HiobuyAiCallError) return;
    await db.aiJob.update({
      where: { id: job.id },
      data: {
        status: "FAILED",
        error: "This AI task could not be sent again. Use Retry.",
        errorCode: "RETRY_SAME",
      },
    });
  }
}

function terminal(error: HiobuyAiCallError) {
  return [400, 401, 403, 404, 409, 413].includes(error.status);
}

async function poll(job: {
  id: string;
  shop: string;
  draftId: string;
  capability: string;
  inputJson: string;
  remoteJobId: string | null;
  aiAccount: string | null;
  status: string;
  error: string | null;
  errorCode: string | null;
  resultJson: string | null;
  nextPollAt: Date | null;
}) {
  if (!job.remoteJobId || (job.nextPollAt && job.nextPollAt > new Date()))
    return;
  const claimed = await db.aiJob.updateMany({
    where: {
      id: job.id,
      status: { in: ["QUEUED", "RUNNING"] },
      nextPollAt: { lte: new Date() },
    },
    data: { nextPollAt: new Date(Date.now() + 30000) },
  });
  if (!claimed.count) return;
  try {
    const account = await aiAccount(job.shop);
    const client = new HiobuyAiClient(
      account.key,
      job.aiAccount || account.shopDomain,
      transport,
    );
    const body = await client.getJob(job.remoteJobId);
    await applyRemote(job, body, client);
  } catch (error) {
    if (error instanceof AppError && !(error instanceof HiobuyAiCallError)) {
      await db.aiJob.update({
        where: { id: job.id },
        data: {
          status: "FAILED",
          error: error.message,
          errorCode: "RETRY_SAME",
        },
      });
      Object.assign(job, {
        status: "FAILED",
        error: error.message,
        errorCode: "RETRY_SAME",
      });
      return;
    }
    if (!(error instanceof HiobuyAiCallError)) {
      await db.aiJob.update({
        where: { id: job.id },
        data: {
          error:
            "This AI task could not be checked. It stays open and will be checked again.",
          errorCode: "RETRY_SAME",
          nextPollAt: new Date(Date.now() + 8000),
        },
      });
      return;
    }
    if (error.status === 429 || error.status === 503 || error.status >= 500) {
      await db.aiJob.update({
        where: { id: job.id },
        data: {
          nextPollAt: new Date(Date.now() + (error.retryAfterMs || 15000)),
        },
      });
      return;
    }
    await db.aiJob.update({
      where: { id: job.id },
      data: {
        status: "FAILED",
        error: error.message,
        errorCode: terminal(error) ? "REJECTED" : "RETRY_SAME",
      },
    });
    Object.assign(job, {
      status: "FAILED",
      error: error.message,
      errorCode: terminal(error) ? "REJECTED" : "RETRY_SAME",
    });
  }
}

async function applyRemote(
  job: {
    id: string;
    shop: string;
    draftId: string;
    capability: string;
    inputJson: string;
    remoteJobId: string | null;
    resultJson?: string | null;
    error?: string | null;
  },
  body: Record<string, unknown>,
  client?: HiobuyAiClient,
) {
  const remote = (body.job || null) as Record<string, any> | null;
  const remoteJobId = String(
    remote?.id || body.job_id || job.remoteJobId || "",
  );
  if (Array.isArray(body.translations)) {
    const result = textResult(
      capabilitySchema.parse(job.capability),
      JSON.parse(job.inputJson),
      body.translations,
      body,
    );
    await db.aiJob.update({
      where: { id: job.id },
      data: {
        remoteJobId: remoteJobId || null,
        status: "SUCCEEDED",
        resultJson: JSON.stringify(result),
        error: null,
        errorCode: null,
      },
    });
    Object.assign(job, {
      status: "SUCCEEDED",
      resultJson: JSON.stringify(result),
      error: null,
    });
    return;
  }
  if (!remote)
    throw new AppError("HIOBuy returned an incomplete AI response.", 502);
  const status = String(remote.status || "");
  const billingState = remote.billing_state
    ? String(remote.billing_state)
    : null;
  const output = remote.output || {};
  const outputUrl = typeof output.url === "string" ? output.url : "";
  const providerDone =
    billingState === "provider_succeeded" || billingState === "completed";
  const stillRunning = status === "queued" || status === "running" || !status;
  if (stillRunning && !providerDone) {
    const data = {
      remoteJobId: remoteJobId || null,
      status: status === "queued" ? "QUEUED" : "RUNNING",
      resultJson: JSON.stringify({ billingState }),
      error: null,
      errorCode: null,
      nextPollAt: new Date(Date.now() + 4000),
    };
    await db.aiJob.update({ where: { id: job.id }, data });
    Object.assign(job, data);
    return;
  }
  if (status === "refunded") {
    const data = {
      remoteJobId: remoteJobId || null,
      status: "FAILED",
      error:
        "HIOBuy refunded this AI task. Start a new one if you still want the result.",
      errorCode: "REFUNDED",
    };
    await db.aiJob.update({ where: { id: job.id }, data });
    Object.assign(job, data);
    return;
  }
  if (status === "failed") {
    const data = {
      remoteJobId: remoteJobId || null,
      status: "FAILED",
      error:
        "HIOBuy could not finish this AI task. Review the input before starting a new one.",
      errorCode: "REJECTED",
    };
    await db.aiJob.update({ where: { id: job.id }, data });
    Object.assign(job, data);
    return;
  }
  if (status !== "completed" && !providerDone)
    throw new AppError("HIOBuy returned an unknown AI task status.", 502);
  const input = JSON.parse(job.inputJson) as StoredInput;
  if (Array.isArray(output.translations)) {
    const result = textResult(
      capabilitySchema.parse(job.capability),
      input,
      output.translations,
      { ...remote, character_count: output.character_count },
    );
    await db.aiJob.update({
      where: { id: job.id },
      data: {
        remoteJobId: remoteJobId || null,
        status: "SUCCEEDED",
        resultJson: JSON.stringify(result),
        error: null,
        errorCode: null,
      },
    });
    Object.assign(job, {
      status: "SUCCEEDED",
      resultJson: JSON.stringify(result),
    });
    return;
  }
  let downloaded: Awaited<ReturnType<typeof storeResultImage>>;
  try {
    downloaded = await storeResultImage(
      job.shop,
      job.draftId,
      remoteJobId,
      outputUrl,
      client?.assetHeaders(),
    );
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    const data = {
      remoteJobId: remoteJobId || null,
      status: "FAILED",
      error: error.message,
      errorCode: "RETRY_SAME",
    };
    await db.aiJob.update({ where: { id: job.id }, data });
    Object.assign(job, data);
    return;
  }
  if (!downloaded.ok) {
    const previous = job.resultJson ? JSON.parse(job.resultJson) : {};
    const copyAttempts = Number(previous.copyAttempts || 0) + 1;
    const refused = [401, 403].includes(downloaded.status);
    const giveUp = refused || status === "completed" || copyAttempts >= 8;
    const data = {
      remoteJobId: remoteJobId || null,
      status: giveUp ? "FAILED" : "RUNNING",
      resultJson: JSON.stringify({
        billingState,
        copyStatus: downloaded.status,
        copyAttempts,
      }),
      error: giveUp ? imageCopyError(downloaded.status) : null,
      errorCode: giveUp ? "RETRY_SAME" : null,
      nextPollAt: giveUp ? null : new Date(Date.now() + 4000),
    };
    await db.aiJob.update({ where: { id: job.id }, data });
    Object.assign(job, data);
    return;
  }
  const stored = downloaded.image;
  const credits = finite(remote.credits_used);
  const result: AiResult = {
    simulated: false,
    notice: `Commerce AI image copied into this draft.${creditNote(credits)} The draft image has been replaced. The comparison keeps the supplier original.`,
    imageId: input.imageId,
    imageUrl: stored.url,
    assetId: stored.assetId,
    remoteUrl: stored.remoteUrl,
    ...(credits === undefined ? {} : { creditsUsed: credits }),
  };
  await db.aiJob.update({
    where: { id: job.id },
    data: {
      remoteJobId: remoteJobId || null,
      status: "SUCCEEDED",
      resultJson: JSON.stringify(result),
      error: null,
      errorCode: null,
    },
  });
  Object.assign(job, {
    status: "SUCCEEDED",
    resultJson: JSON.stringify(result),
    error: null,
  });
}

function textResult(
  capability: AiCapability,
  input: StoredInput,
  translations: any[],
  body: any,
): AiResult {
  const texts = translations.map((item) =>
    typeof item?.translated_text === "string" ? item.translated_text : "",
  );
  const expected = input.texts?.length || (input.text ? 1 : 0);
  if (!texts.length || texts.length !== expected)
    throw new AppError("HIOBuy returned an incomplete translation.", 502);
  const credits = finite(body.credits_used);
  const characterCount = finite(body.character_count);
  const notice = `Commerce AI translation.${creditNote(credits)} Review it before applying. Product API quota was not used.`;
  const shared = {
    simulated: false as const,
    notice,
    ...(credits === undefined ? {} : { creditsUsed: credits }),
    ...(characterCount === undefined ? {} : { characterCount }),
  };
  if (
    capability === "attribute_translation" &&
    input.attributes &&
    input.slots
  ) {
    const attributes = input.attributes.map((attribute) => ({ ...attribute }));
    input.slots.forEach((slot, index) => {
      attributes[slot.index][slot.field] = texts[index];
    });
    return { ...shared, attributes };
  }
  return { ...shared, text: texts[0] };
}

function imageCopyError(statusCode: number) {
  if (statusCode === 401)
    return "HIOBuy refused the finished image. Check that the API key is active and includes product:translate, then run the tool again.";
  if (statusCode === 403)
    return "HIOBuy would not release the finished image for this account. Check AI access, then run the tool again.";
  if (statusCode === 404)
    return "HIOBuy finished the task, but the image file is not available. Run the tool again.";
  return "The finished image could not be copied into this draft. Run the tool again. This does not start another charge until you do.";
}

async function storeResultImage(
  shop: string,
  draftId: string,
  remoteJobId: string,
  outputUrl: string,
  headers?: Record<string, string>,
): Promise<
  | {
      ok: true;
      image: { assetId: string; url: string; remoteUrl: string };
    }
  | { ok: false; status: number }
> {
  const canonical = remoteJobId
    ? `${HIOBUY_ORIGIN}/v1/ai/assets/${encodeURIComponent(remoteJobId)}.webp`
    : "";
  const source = approvedAssetUrl(outputUrl) || approvedAssetUrl(canonical);
  if (!source) return { ok: false, status: 0 };
  if ((await db.asset.count({ where: { shop, draftId } })) >= 100)
    throw new AppError(
      "This draft has reached its stored image limit. Remove a local image before copying the AI result.",
      409,
    );
  const read = await readAsset(source, headers);
  if (!read.ok) return read;
  const mime = imageMime(read.bytes);
  if (!mime) return { ok: false, status: 415 };
  const asset = await db.asset.create({
    data: {
      shop,
      draftId,
      data: new Uint8Array(read.bytes),
      mime,
      filename: `ai-result.${mime === "image/png" ? "png" : mime === "image/jpeg" ? "jpg" : "webp"}`,
    },
  });
  return {
    ok: true,
    image: {
      assetId: asset.id,
      url: `/app/api/assets/${asset.id}`,
      remoteUrl: source,
    },
  };
}

async function readAsset(
  source: string,
  headers?: Record<string, string>,
): Promise<{ ok: true; bytes: Buffer } | { ok: false; status: number }> {
  let current = source;
  for (let hop = 0; hop < 4; hop++) {
    let response: Response;
    try {
      response = await transport(current, {
        headers,
        redirect: "manual",
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      return { ok: false, status: 0 };
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      let next = "";
      try {
        if (location) next = new URL(location, current).href;
      } catch {
        next = "";
      }
      if (!next || !approvedAssetUrl(next))
        return { ok: false, status: response.status };
      current = next;
      continue;
    }
    if (!response.ok || !response.body)
      return { ok: false, status: response.status };
    const bytes = await readLimited(response, RESULT_IMAGE_BYTES);
    if (!bytes.byteLength) return { ok: false, status: 413 };
    return { ok: true, bytes };
  }
  return { ok: false, status: 310 };
}

function approvedAssetUrl(value: string) {
  try {
    const url = new URL(value);
    if (
      url.protocol === "https:" &&
      url.hostname === "api.hiobuy.com" &&
      url.pathname.startsWith("/v1/ai/assets/") &&
      !url.username &&
      !url.password &&
      !url.port
    )
      return url.href;
  } catch {
    /* The result is left remote until HIOBuy returns an approved asset URL. */
  }
  return "";
}

async function readLimited(response: Response, max: number) {
  const reader = response.body!.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return Buffer.alloc(0);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

function imageMime(bytes: Buffer) {
  if (
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return "image/jpeg";
  if (
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  )
    return "image/webp";
  return "";
}

async function settleMock(job: {
  id: string;
  capability: string;
  inputJson: string;
  status: string;
  shouldFail: boolean;
  readyAt: Date;
  resultJson: string | null;
  error: string | null;
}) {
  const now = new Date();
  if (job.readyAt > now) {
    if (job.status === "QUEUED") {
      await db.aiJob.updateMany({
        where: { id: job.id, status: "QUEUED" },
        data: { status: "RUNNING" },
      });
      job.status = "RUNNING";
    }
    return;
  }
  const failed = job.shouldFail;
  const result = failed
    ? null
    : await mock.run(
        capabilitySchema.parse(job.capability),
        JSON.parse(job.inputJson),
      );
  const data = {
    status: failed ? "FAILED" : "SUCCEEDED",
    resultJson: result ? JSON.stringify(result) : null,
    error: failed
      ? "Simulated failure. Retry completes successfully without calling any AI API."
      : null,
  };
  await db.aiJob.updateMany({
    where: { id: job.id, status: { in: ["QUEUED", "RUNNING"] } },
    data,
  });
  Object.assign(job, data);
}

async function retryMock(shop: string, jobId: string) {
  const result = await db.aiJob.updateMany({
    where: { id: jobId, shop, status: "FAILED", provider: "mock" },
    data: {
      status: "QUEUED",
      shouldFail: false,
      error: null,
      resultJson: null,
      attempts: { increment: 1 },
      readyAt: new Date(Date.now() + 3500),
    },
  });
  if (!result.count)
    throw new AppError("Only failed tasks can be retried.", 409);
}

function present(job: {
  id: string;
  draftId: string;
  capability: string;
  status: string;
  provider: string;
  attempts: number;
  applied: boolean;
  error: string | null;
  errorCode: string | null;
  inputJson: string;
  resultJson: string | null;
  createdAt: Date;
}) {
  const parsed = job.resultJson ? JSON.parse(job.resultJson) : null;
  const succeeded = job.status === "SUCCEEDED";
  let imageId: string | null = null;
  try {
    const input = JSON.parse(job.inputJson) as { imageId?: unknown };
    if (typeof input.imageId === "string") imageId = input.imageId;
  } catch {
    imageId = null;
  }
  return {
    id: job.id,
    draftId: job.draftId,
    capability: job.capability,
    status: job.status,
    provider:
      job.provider === "hiobuy" ? ("hiobuy" as const) : ("mock" as const),
    simulated: job.provider !== "hiobuy",
    attempts: job.attempts,
    applied: job.applied,
    error: job.error,
    errorCode: job.errorCode,
    imageId,
    billingState:
      !succeeded && parsed && typeof parsed.billingState === "string"
        ? parsed.billingState
        : null,
    result: succeeded ? parsed : null,
    createdAt: job.createdAt.toISOString(),
  };
}

function finite(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function formatCredits(value: number) {
  return Number.isInteger(value)
    ? String(value)
    : String(Math.round(value * 100) / 100);
}

function creditNote(credits?: number) {
  return credits === undefined
    ? ""
    : ` ${formatCredits(credits)} credits settled.`;
}
