import { privateJson } from "../lib/response.server";
import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { authenticate } from "../shopify.server";
import { AppError, safeError } from "../lib/errors";
import {
  assertMutation,
  boundedRequest,
  MAX_IMAGE_BYTES,
  validateImage,
} from "../lib/validation.server";
import { getDraft } from "../lib/drafts.server";
import { getApiCredential } from "../lib/settings.server";
import { HiobuyClient } from "../lib/hiobuy.server";
import { normalizeList } from "../lib/normalize.server";
export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  try {
    assertMutation(request);
    if (!request.headers.get("content-type")?.startsWith("multipart/form-data"))
      throw new AppError("Expected an image upload.", 415);
    const form = await (
      await boundedRequest(request, MAX_IMAGE_BYTES + 65536)
    ).formData();
    const file = form.get("image");
    if (!(file instanceof File))
      throw new AppError("Choose an image to upload.");
    const image = await validateImage(file);
    if (form.get("purpose") === "search") {
      const credential = await getApiCredential(session.shop);
      const client = new HiobuyClient(credential.key);
      const imageId = await client.uploadImage(image.bytes);
      const result = await client.imageSearch(imageId);
      return privateJson({
        ...normalizeList(result.body),
        imageId,
        environment: credential.environment,
        requestId: result.requestId,
      });
    }
    const draftId = String(form.get("draftId") || "");
    await getDraft(session.shop, draftId);
    if (await db.importRecord.findUnique({ where: { draftId } }))
      throw new AppError(
        "Reopen the imported snapshot as a new draft before uploading.",
        409,
      );
    if (
      (await db.asset.count({ where: { shop: session.shop, draftId } })) >= 100
    )
      throw new AppError(
        "This draft has reached its upload limit. Create a new draft.",
      );
    const asset = await db.asset.create({
      data: {
        shop: session.shop,
        draftId,
        data: new Uint8Array(image.bytes),
        mime: image.mime,
        filename: image.filename,
      },
    });
    return privateJson({
      image: {
        id: `upload-${asset.id}`,
        assetId: asset.id,
        url: `/app/api/assets/${asset.id}`,
        originalUrl: `/app/api/assets/${asset.id}`,
        selected: true,
        alt: "",
      },
    });
  } catch (error) {
    if (error instanceof Response) throw error;
    return privateJson(safeError(error), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}
