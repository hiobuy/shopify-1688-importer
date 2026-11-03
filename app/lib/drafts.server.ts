import db from "../db.server";
import { editorSchema, type Editor, type Pricing } from "./schema";
import { makeEditor, type SourceProduct } from "./products";
import { AppError } from "./errors";
import { safeImageUrl, sanitizeDescription } from "./validation.server";
export async function getDraft(shop: string, id: string) {
  const draft = await db.draft.findFirst({ where: { id, shop } });
  if (!draft) throw new AppError("This draft was not found.", 404, "NOT_FOUND");
  return draft;
}
export async function createDraft(
  shop: string,
  product: SourceProduct,
  environment: string,
  pricing: Pricing,
) {
  const editor = makeEditor(product, pricing);
  if (editor.variants.some((v) => v.options.length > 3))
    throw new AppError(
      "This product has more than 3 option dimensions. Shopify supports up to 3; choose another product.",
    );
  return db.draft.create({
    data: {
      shop,
      sourceId: product.source_product_id,
      sourceUrl: product.source_url,
      environment,
      sourceJson: JSON.stringify(product),
      editorJson: JSON.stringify(editor),
    },
  });
}
function aiSourceUrl(value?: string) {
  if (!value) return undefined;
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
    /* Drop a source that is not a HIOBuy result asset. */
  }
  return undefined;
}
export function cleanEditor(editor: Editor): Editor {
  return {
    ...editor,
    descriptionHtml: sanitizeDescription(editor.descriptionHtml),
    images: editor.images.map((i) => {
      if (i.assetId) {
        const path = `/app/api/assets/${i.assetId}`;
        if (i.url !== path)
          throw new AppError("An uploaded image has an invalid reference.");
        if (i.originalUrl === path)
          return { ...i, aiSourceUrl: aiSourceUrl(i.aiSourceUrl) };
        const originalUrl = safeImageUrl(i.originalUrl);
        if (!originalUrl)
          throw new AppError(
            "An image is not hosted on a supported marketplace or Shopify CDN.",
          );
        return {
          ...i,
          url: path,
          originalUrl,
          aiSourceUrl: aiSourceUrl(i.aiSourceUrl),
        };
      }
      const url = safeImageUrl(i.url);
      const originalUrl = safeImageUrl(i.originalUrl);
      if (!url || !originalUrl)
        throw new AppError(
          "An image is not hosted on a supported marketplace or Shopify CDN.",
        );
      return {
        ...i,
        url,
        originalUrl,
        aiSourceUrl: aiSourceUrl(i.aiSourceUrl),
      };
    }),
  };
}
export async function saveDraft(
  shop: string,
  id: string,
  version: number,
  input: unknown,
) {
  const editor = cleanEditor(editorSchema.parse(input));
  return db.$transaction(async (tx) => {
    const draft = await tx.draft.findFirst({ where: { id, shop } });
    if (!draft) throw new AppError("This draft was not found.", 404);
    const importing = await tx.importRecord.findUnique({
      where: { draftId: id },
    });
    if (importing)
      throw new AppError(
        "This draft has an import snapshot. Reopen it as a new draft to make changes; retries use the original snapshot.",
        409,
        "IMPORT_SNAPSHOT_LOCKED",
      );
    const assetIds = editor.images.flatMap((i) =>
      i.assetId ? [i.assetId] : [],
    );
    if (
      assetIds.length &&
      (await tx.asset.count({
        where: { id: { in: assetIds }, draftId: id, shop },
      })) !== new Set(assetIds).size
    )
      throw new AppError("An image does not belong to this draft.", 403);
    const result = await tx.draft.updateMany({
      where: { id, shop, version },
      data: { editorJson: JSON.stringify(editor), version: { increment: 1 } },
    });
    if (!result.count)
      throw new AppError(
        "This draft changed in another tab. Reload before saving; your local edits have not overwritten it.",
        409,
        "DRAFT_CONFLICT",
      );
    return { editor, version: version + 1 };
  });
}
export async function duplicateDraft(shop: string, id: string) {
  const original = await getDraft(shop, id);
  // Uploaded assets are copied to the new owner draft, not referenced across drafts.
  return db.$transaction(async (tx) => {
    const next = await tx.draft.create({
      data: {
        shop,
        sourceId: original.sourceId,
        sourceUrl: original.sourceUrl,
        environment: original.environment,
        sourceJson: original.sourceJson,
        editorJson: original.editorJson,
      },
    });
    const editor = editorSchema.parse(JSON.parse(original.editorJson));
    for (const image of editor.images)
      if (image.assetId) {
        const asset = await tx.asset.findFirst({
          where: { id: image.assetId, shop, draftId: id },
        });
        if (!asset) throw new AppError("An uploaded image is missing.");
        const copy = await tx.asset.create({
          data: {
            shop,
            draftId: next.id,
            mime: asset.mime,
            filename: asset.filename,
            data: asset.data,
          },
        });
        image.assetId = copy.id;
        image.url = image.originalUrl = `/app/api/assets/${copy.id}`;
      }
    return tx.draft.update({
      where: { id: next.id },
      data: { editorJson: JSON.stringify(editor) },
    });
  });
}
