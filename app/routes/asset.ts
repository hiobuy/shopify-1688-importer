import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { authenticate } from "../shopify.server";
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const asset = await db.asset.findFirst({
    where: { id: params.id, shop: session.shop },
  });
  if (!asset) throw new Response("Image not found.", { status: 404 });
  return new Response(new Uint8Array(asset.data), {
    headers: {
      "Content-Type": asset.mime,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
    },
  });
}
