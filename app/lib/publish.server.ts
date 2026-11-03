import { randomUUID } from "node:crypto";
import db from "../db.server";
import { AppError, safeError } from "./errors";
import { editorSchema, type Editor } from "./schema";
import { getDraft, cleanEditor } from "./drafts.server";
import {
  graphql,
  assertUserErrors,
  shopContext,
  type AdminClient,
} from "./shopify-graphql.server";
import { productSetInput, validatePublish } from "./publish-mapping";
const LOCK_MS = 10 * 60 * 1000;
const MEDIA_POLL_MS = 2000;
let mediaWaitMs = 20000;
export function setMediaWaitForTests(ms: number) {
  mediaWaitMs = ms;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function heartbeat(id: string, token: string) {
  const lock = await db.importRecord.updateMany({
    where: { id, lockToken: token, status: "RUNNING" },
    data: { lockedAt: new Date() },
  });
  if (!lock.count)
    throw new AppError(
      "This import is being recovered by another request. Refresh Import history.",
      409,
    );
}
async function stagedSource(
  admin: AdminClient,
  assetId: string,
  shop: string,
  draftId: string,
) {
  const asset = await db.asset.findFirst({
    where: { id: assetId, shop, draftId },
  });
  if (!asset) throw new AppError("An uploaded image could not be found.", 404);
  const data = await graphql(
    admin,
    `
      mutation ImporterStage($input: [StagedUploadInput!]!) {
        stagedUploadsCreate(input: $input) {
          stagedTargets {
            url
            resourceUrl
            parameters {
              name
              value
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `,
    {
      input: [
        {
          resource: "IMAGE",
          filename: asset.filename,
          mimeType: asset.mime,
          httpMethod: "POST",
          fileSize: String(asset.data.byteLength),
        },
      ],
    },
  );
  assertUserErrors(data.stagedUploadsCreate.userErrors);
  const target = data.stagedUploadsCreate.stagedTargets?.[0];
  if (!target)
    throw new AppError("Shopify did not supply an upload target.", 502);
  const url = new URL(target.url);
  // Only Shopify-provided storage endpoints. Never accept an upload target from the browser.
  if (
    url.protocol !== "https:" ||
    !["shopify.com", "shopifycdn.com", "googleapis.com", "amazonaws.com"].some(
      (h) => url.hostname === h || url.hostname.endsWith(`.${h}`),
    )
  )
    throw new AppError("Shopify returned an unsupported upload host.", 502);
  const form = new FormData();
  for (const p of target.parameters) form.append(p.name, p.value);
  form.append(
    "file",
    new Blob([new Uint8Array(asset.data)], { type: asset.mime }),
    asset.filename,
  );
  let response: Response;
  try {
    response = await fetch(target.url, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(45000),
      redirect: "error",
    });
  } catch {
    throw new AppError(
      "Image upload to Shopify timed out. Use safe retry.",
      502,
    );
  }
  if (!response.ok)
    throw new AppError("Shopify image upload failed. Use safe retry.", 502);
  return String(target.resourceUrl);
}
export async function publishDraft(
  shop: string,
  draftId: string,
  admin: AdminClient,
  expectedVersion?: number,
) {
  const draft = await getDraft(shop, draftId);
  const editor = cleanEditor(editorSchema.parse(JSON.parse(draft.editorJson)));
  const context = await shopContext(admin);
  if (context.missingScopes.length)
    throw new AppError(
      `Reauthorize this app with scopes: ${context.missingScopes.join(", ")}.`,
      403,
      "MISSING_SHOPIFY_SCOPES",
    );
  validatePublish(editor, draft.environment, context.currency);
  const now = new Date();
  const record = await db.$transaction(async (tx) => {
    const existing = await tx.importRecord.findUnique({ where: { draftId } });
    if (existing) return existing;
    const fresh = await tx.draft.findFirst({ where: { id: draftId, shop } });
    if (!fresh) throw new AppError("Draft not found.", 404);
    if (expectedVersion === undefined || fresh.version !== expectedVersion)
      throw new AppError(
        "Save and reload the current draft before importing.",
        409,
        "DRAFT_CONFLICT",
      );
    const snapshot = cleanEditor(
      editorSchema.parse(JSON.parse(fresh.editorJson)),
    );
    validatePublish(snapshot, fresh.environment, context.currency);
    return tx.importRecord.create({
      data: {
        shop,
        draftId,
        sourceId: fresh.sourceId,
        sourceUrl: fresh.sourceUrl,
        title: snapshot.title,
        publishStatus: snapshot.pricing.publishStatus,
        productHandle: `hiobuy-1688-${draftId}`,
        snapshotJson: JSON.stringify(snapshot),
      },
    });
  });
  if (record.shop !== shop) throw new AppError("Import not found.", 404);
  if (record.status === "SUCCEEDED") return record;
  const token = randomUUID();
  const acquired = await db.importRecord.updateMany({
    where: {
      id: record.id,
      shop,
      OR: [
        { status: { in: ["PENDING", "FAILED", "NEEDS_RETRY"] } },
        {
          status: "RUNNING",
          lockedAt: { lt: new Date(now.getTime() - LOCK_MS) },
        },
      ],
    },
    data: {
      status: "RUNNING",
      lockToken: token,
      lockedAt: now,
      attempts: { increment: 1 },
      error: null,
    },
  });
  if (!acquired.count)
    throw new AppError(
      "This import is already running. Follow its progress in Import history.",
      409,
      "IMPORT_RUNNING",
    );
  try {
    const snapshot: Editor = editorSchema.parse(
      JSON.parse(record.snapshotJson),
    );
    validatePublish(snapshot, draft.environment, context.currency);
    const files: Record<string, string> = Object.assign(
      Object.create(null),
      JSON.parse(record.filesJson),
    );
    for (const image of snapshot.images.filter((i) => i.selected)) {
      await heartbeat(record.id, token);
      if (files[image.id]) continue;
      const source = image.assetId
        ? await stagedSource(admin, image.assetId, shop, draftId)
        : image.url;
      const result = await graphql(
        admin,
        `
          mutation ImporterFile($files: [FileCreateInput!]!) {
            fileCreate(files: $files) {
              files {
                id
                fileStatus
              }
              userErrors {
                field
                message
              }
            }
          }
        `,
        {
          files: [
            {
              originalSource: source,
              contentType: "IMAGE",
              alt: image.alt,
            },
          ],
        },
      );
      assertUserErrors(result.fileCreate.userErrors);
      const file = result.fileCreate.files?.[0];
      if (!file?.id)
        throw new AppError("Shopify did not return an image file ID.", 502);
      files[image.id] = String(file.id);
      await db.importRecord.updateMany({
        where: { id: record.id, lockToken: token },
        data: { filesJson: JSON.stringify(files) },
      });
    }
    const deadline = Date.now() + mediaWaitMs;
    while (Object.keys(files).length) {
      const result = await graphql(
        admin,
        `
          query ImporterFiles($ids: [ID!]!) {
            nodes(ids: $ids) {
              ... on MediaImage {
                id
                fileStatus
                fileErrors {
                  message
                }
              }
            }
          }
        `,
        { ids: Object.values(files) },
      );
      const failed = result.nodes.some(
        (n: any) => !n || n.fileStatus === "FAILED",
      );
      if (failed) {
        const good: Record<string, string> = {};
        for (const [key, id] of Object.entries(files))
          if (
            result.nodes.find(
              (n: any) => n?.id === id && n.fileStatus !== "FAILED",
            )
          )
            good[key] = id;
        await db.importRecord.updateMany({
          where: { id: record.id, lockToken: token },
          data: { filesJson: JSON.stringify(good) },
        });
        throw new AppError(
          "Shopify could not process an image. Verify source images, then use safe retry.",
          422,
          "SHOPIFY_MEDIA_FAILED",
        );
      }
      if (result.nodes.every((n: any) => n.fileStatus === "READY")) break;
      if (Date.now() + MEDIA_POLL_MS > deadline)
        throw new AppError(
          "Shopify is still processing the images. The import will finish once they are ready.",
          409,
          "SHOPIFY_MEDIA_PROCESSING",
        );
      await sleep(MEDIA_POLL_MS);
      await heartbeat(record.id, token);
    }
    await heartbeat(record.id, token);
    const found = await graphql(
      admin,
      `
        query ImporterExisting($identifier: ProductIdentifierInput!) {
          productByIdentifier(identifier: $identifier) {
            id
            variants(first: 100) {
              nodes {
                id
                selectedOptions {
                  name
                  value
                }
              }
            }
          }
        }
      `,
      { identifier: { handle: record.productHandle } },
    );
    const existing = found.productByIdentifier;
    const input = productSetInput(
      snapshot,
      record.productHandle,
      files,
      existing?.variants?.nodes || [],
    );
    const result = await graphql(
      admin,
      `
        mutation ImporterPublish(
          $input: ProductSetInput!
          $identifier: ProductSetIdentifiers
        ) {
          productSet(
            input: $input
            identifier: $identifier
            synchronous: true
          ) {
            product {
              id
              handle
              status
            }
            userErrors {
              field
              message
            }
          }
        }
      `,
      {
        input,
        identifier: existing?.id
          ? { id: existing.id }
          : { handle: record.productHandle },
      },
    );
    assertUserErrors(result.productSet.userErrors);
    const product = result.productSet.product;
    if (!product?.id)
      throw new AppError(
        "Shopify did not confirm a product ID. Use safe retry to reconcile the existing product.",
        502,
        "SHOPIFY_UNCONFIRMED",
      );
    const updated = await db.importRecord.updateMany({
      where: { id: record.id, lockToken: token },
      data: {
        status: "SUCCEEDED",
        productId: String(product.id),
        publishStatus: String(product.status),
        lockedAt: null,
        lockToken: null,
        warnings:
          snapshot.pricing.publishStatus === "ACTIVE"
            ? "ACTIVE is the product status. Select sales channels in Shopify Admin to make it available on a storefront."
            : null,
      },
    });
    if (!updated.count)
      throw new AppError(
        "The import was recovered by another request. Check Import history.",
        409,
      );
    return (await db.importRecord.findUnique({ where: { id: record.id } }))!;
  } catch (error) {
    const pending =
      error instanceof AppError && error.code === "SHOPIFY_MEDIA_PROCESSING";
    await db.importRecord.updateMany({
      where: { id: record.id, lockToken: token },
      data: {
        status: pending ? "NEEDS_RETRY" : "FAILED",
        error: safeError(error).error,
        lockedAt: null,
        lockToken: null,
      },
    });
    throw error;
  }
}
