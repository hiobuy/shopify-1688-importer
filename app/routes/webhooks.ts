import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { authenticate } from "../shopify.server";
export async function action({ request }: ActionFunctionArgs) {
  const { topic, shop, payload } = await authenticate.webhook(request);
  if (topic === "APP_UNINSTALLED") {
    await db.$transaction([
      db.session.deleteMany({ where: { shop } }),
      db.shopSettings.deleteMany({ where: { shop } }),
      db.draft.deleteMany({ where: { shop } }),
    ]);
  } else if (topic === "APP_SCOPES_UPDATE") {
    const scopes = Array.isArray(payload.current)
      ? payload.current.join(",")
      : "";
    await db.session.updateMany({ where: { shop }, data: { scope: scopes } });
  }
  return new Response(null, { status: 200 });
}
