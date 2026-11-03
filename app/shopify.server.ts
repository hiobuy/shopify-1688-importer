import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import db from "./db.server";
import { EncryptedSessionStorage } from "./lib/session-storage.server";
// `shopify app dev` injects the tunnel as APP_URL and HOST. SHOPIFY_APP_URL is for a hosted server.
const configuredAppUrl = [
  process.env.SHOPIFY_APP_URL,
  process.env.APP_URL,
  process.env.HOST,
].find((value) => value?.trim());
const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY || "",
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.October26,
  appUrl: configuredAppUrl
    ? /^https?:\/\//i.test(configuredAppUrl)
      ? configuredAppUrl
      : `https://${configuredAppUrl}`
    : "",
  scopes: (
    process.env.SCOPES || "read_products,write_products,read_files,write_files"
  ).split(","),
  authPathPrefix: "/auth",
  sessionStorage: new EncryptedSessionStorage(db),
  distribution: AppDistribution.AppStore,
  future: { expiringOfflineAccessTokens: true },
});
export default shopify;
export const {
  authenticate,
  login,
  addDocumentResponseHeaders,
  sessionStorage,
} = shopify;
export const apiVersion = ApiVersion.October26;
