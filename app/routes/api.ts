import { privateJson } from "../lib/response.server";
import { z, ZodError } from "zod";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { authenticate } from "../shopify.server";
import { AppError, safeError } from "../lib/errors";
import {
  assertMutation,
  parse1688Url,
  readJson,
} from "../lib/validation.server";
import {
  getApiCredential,
  getPricing,
  getSettings,
  publicSettings,
  saveSettings,
} from "../lib/settings.server";
import { HiobuyClient } from "../lib/hiobuy.server";
import { normalizeDetail, normalizeList } from "../lib/normalize.server";
import {
  createDraft,
  duplicateDraft,
  getDraft,
  saveDraft,
} from "../lib/drafts.server";
import {
  createJob,
  listJobs,
  readAiStatus,
  retryJob,
} from "../lib/ai/jobs.server";
import { capabilitySchema } from "../lib/schema";
import { listCollections, shopContext } from "../lib/shopify-graphql.server";
import { publishDraft } from "../lib/publish.server";
const idSchema = z.string().uuid();
export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  if (url.searchParams.get("resource") === "ai-credits") {
    try {
      return privateJson(await readAiStatus(session.shop), {
        headers: { "Cache-Control": "no-store" },
      });
    } catch (error) {
      if (error instanceof Response) throw error;
      return privateJson(safeError(error), {
        status: error instanceof AppError ? error.status : 500,
      });
    }
  }
  if (url.searchParams.get("resource") === "jobs")
    return privateJson(
      {
        jobs: await listJobs(
          session.shop,
          url.searchParams.get("draftId") || undefined,
        ),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  return privateJson({ error: "Unknown resource." }, { status: 404 });
}
export async function action({ request }: ActionFunctionArgs) {
  const { session, admin } = await authenticate.admin(request);
  try {
    assertMutation(request);
    const input = z
      .object({ intent: z.string() })
      .passthrough()
      .parse(await readJson(request));
    const shop = session.shop;
    switch (input.intent) {
      case "search": {
        const value = z
          .object({
            keyword: z.string().trim().min(1).max(200),
            page: z.number().int().min(1).max(400).default(1),
            sort: z
              .enum(["", "PRICE_ASC", "PRICE_DESC", "SALE_QTY_DESC"])
              .default(""),
          })
          .parse(input);
        const credential = await getApiCredential(shop);
        const result = await new HiobuyClient(credential.key).search(
          value.keyword,
          value.page,
          value.sort,
        );
        return privateJson({
          ...normalizeList(result.body),
          environment: credential.environment,
          requestId: result.requestId,
        });
      }
      case "imageSearch": {
        const value = z
          .object({
            imageId: z.string().min(1).max(500),
            page: z.number().int().min(1).max(400).default(1),
            sort: z
              .enum(["", "PRICE_ASC", "PRICE_DESC", "SALE_QTY_DESC"])
              .default(""),
          })
          .parse(input);
        const credential = await getApiCredential(shop);
        const result = await new HiobuyClient(credential.key).imageSearch(
          value.imageId,
          value.page,
          value.sort,
        );
        return privateJson({
          ...normalizeList(result.body),
          environment: credential.environment,
          imageId: value.imageId,
          requestId: result.requestId,
        });
      }
      case "detail": {
        const value = z
          .object({
            id: z
              .string()
              .regex(/^\d{6,25}$/)
              .optional(),
            url: z.string().max(2000).optional(),
          })
          .parse(input);
        const id = value.url ? parse1688Url(value.url).id : value.id;
        if (!id)
          throw new AppError("Choose a product or enter a 1688 listing URL.");
        const credential = await getApiCredential(shop);
        const result = await new HiobuyClient(credential.key).detail(id);
        return privateJson({
          product: normalizeDetail(result.body),
          environment: credential.environment,
          requestId: result.requestId,
        });
      }
      case "createDraft": {
        // Re-fetch authoritative source. Never trust product snapshots supplied by a browser.
        const id = z
          .string()
          .regex(/^\d{6,25}$/)
          .parse(input.sourceId);
        const credential = await getApiCredential(shop);
        const result = await new HiobuyClient(credential.key).detail(id);
        const draft = await createDraft(
          shop,
          normalizeDetail(result.body),
          credential.environment,
          await getPricing(shop, (await shopContext(admin)).currency),
        );
        return privateJson({ id: draft.id });
      }
      case "saveDraft": {
        const value = z
          .object({
            draftId: idSchema,
            version: z.number().int().positive(),
            editor: z.unknown(),
          })
          .parse(input);
        return privateJson(
          await saveDraft(shop, value.draftId, value.version, value.editor),
        );
      }
      case "duplicateDraft": {
        const draft = await duplicateDraft(shop, idSchema.parse(input.draftId));
        return privateJson({ id: draft.id });
      }
      case "saveSettings":
        return privateJson({
          settings: await saveSettings(
            shop,
            input.settings,
            (await shopContext(admin)).currency,
          ),
        });
      case "testConnection": {
        const credential = await getApiCredential(shop);
        // A real documented request proves this key's 1688 search permission. It may consume quota.
        const result = await new HiobuyClient(credential.key).search(
          "water bottle",
          1,
        );
        normalizeList(result.body);
        return privateJson({
          message: "Connected: this API key can search 1688 products.",
          environment: credential.environment,
          requestId: result.requestId,
        });
      }
      case "collections":
        return privateJson(
          await listCollections(
            admin,
            z.string().max(500).optional().parse(input.after),
          ),
        );
      case "createJob": {
        const value = z
          .object({
            draftId: idSchema,
            capability: capabilitySchema,
            imageId: z.string().max(150).optional(),
          })
          .parse(input);
        await createJob(shop, value.draftId, value.capability, value.imageId);
        return privateJson({ jobs: await listJobs(shop) });
      }
      case "aiCredits":
        return privateJson(await readAiStatus(shop));
      case "retryJob": {
        await retryJob(shop, idSchema.parse(input.jobId));
        return privateJson({ jobs: await listJobs(shop) });
      }
      case "markJobApplied": {
        const jobId = idSchema.parse(input.jobId);
        const job = await db.aiJob.findFirst({
          where: { id: jobId, shop, status: "SUCCEEDED" },
        });
        if (!job) throw new AppError("AI result not found.", 404);
        await getDraft(shop, job.draftId);
        await db.aiJob.updateMany({
          where: { id: jobId, shop },
          data: { applied: true },
        });
        return privateJson({ ok: true });
      }
      case "publish": {
        const result = await publishDraft(
          shop,
          idSchema.parse(input.draftId),
          admin,
          z.number().int().positive().optional().parse(input.version),
        );
        return privateJson({
          id: result.id,
          status: result.status,
          productId: result.productId,
          warnings: result.warnings,
        });
      }
      default:
        throw new AppError("Unknown operation.", 404);
    }
  } catch (error) {
    if (error instanceof Response) throw error;
    if (error instanceof ZodError)
      return privateJson(
        {
          error: error.issues
            .map((e) => `${e.path.join(".")}: ${e.message}`)
            .join("; ")
            .slice(0, 1500),
          code: "VALIDATION_ERROR",
        },
        { status: 400 },
      );
    if (!(error instanceof AppError)) {
      console.error(error);
      if (
        error instanceof Error &&
        (error.name === "PrismaClientValidationError" ||
          error.name === "PrismaClientKnownRequestError")
      )
        return privateJson(
          {
            error:
              "The app server is still running the previous database client. Stop shopify app dev, start it again, then retry this AI task.",
            code: "SERVER_RESTART_REQUIRED",
          },
          { status: 500 },
        );
    }
    return privateJson(safeError(error), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}
