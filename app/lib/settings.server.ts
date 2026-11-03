import db from "../db.server";
import { encrypt, decrypt } from "./crypto.server";
import { AppError } from "./errors";
import { pricingSchema, settingsInputSchema, type Pricing } from "./schema";
import { alignCurrency } from "./pricing";

export function keyEnvironment(key: string): "sandbox" | "production" {
  if (key.startsWith("hio_test_") && key.length >= 15) return "sandbox";
  if (key.startsWith("hio_live_") && key.length >= 15) return "production";
  throw new AppError(
    "Use a HIOBuy Public API key issued by the developer portal (hio_test_… or hio_live_…).",
  );
}
export async function getSettings(shop: string, currency?: string) {
  const seed = process.env.HIOBUY_API_KEY?.trim();
  const settings = await db.shopSettings.upsert({
    where: { shop },
    update: {},
    create: {
      shop,
      ...(currency ? { currency } : {}),
      ...(seed
        ? {
            apiKeyEncrypted: encrypt(seed),
            keyConfigured: true,
            environment: keyEnvironment(seed),
          }
        : {}),
    },
  });
  return settings;
}
export function publicSettings(
  settings: Awaited<ReturnType<typeof getSettings>>,
) {
  return {
    ...pricingSchema.parse(settings),
    keyConfigured: settings.keyConfigured,
    environment: settings.environment,
    aiAccount: settings.aiShopDomain || "",
  };
}
export async function getApiCredential(shop: string) {
  const settings = await getSettings(shop);
  if (!settings.apiKeyEncrypted)
    throw new AppError(
      "Save your HIOBuy API key in Settings first.",
      400,
      "API_KEY_REQUIRED",
    );
  return {
    key: decrypt(settings.apiKeyEncrypted),
    environment: settings.environment,
  };
}
export async function getAiCredential(shop: string) {
  const settings = await getSettings(shop);
  const credential = await getApiCredential(shop);
  return {
    key: credential.key,
    keyEncrypted: settings.apiKeyEncrypted!,
    cachedAccount: settings.aiShopDomain,
  };
}
// Only cache when the key has not been replaced while discovery was running.
export async function cacheAiAccount(
  shop: string,
  keyEncrypted: string,
  account: string,
) {
  await db.shopSettings.updateMany({
    where: { shop, apiKeyEncrypted: keyEncrypted },
    data: { aiShopDomain: account },
  });
}
export async function syncStoreCurrency(shop: string, storeCurrency: string) {
  const settings = await getSettings(shop, storeCurrency);
  if (settings.currency === storeCurrency) return settings;
  const { currency, exchangeRate } = alignCurrency(settings, storeCurrency);
  return db.shopSettings.update({
    where: { shop },
    data: { currency, exchangeRate },
  });
}
export async function saveSettings(
  shop: string,
  input: unknown,
  storeCurrency?: string,
) {
  const value = settingsInputSchema.parse(input);
  const { apiKey, removeKey, ...rest } = value;
  const pricing = storeCurrency ? alignCurrency(rest, storeCurrency) : rest;
  // Validate currency without making an exchange-rate network request.
  if (!Intl.supportedValuesOf("currency").includes(pricing.currency))
    throw new AppError("Choose a supported ISO 4217 currency.");
  const keyData = removeKey
    ? {
        apiKeyEncrypted: null,
        keyConfigured: false,
        environment: "unconfigured",
        aiShopDomain: null,
      }
    : apiKey?.trim()
      ? {
          apiKeyEncrypted: encrypt(apiKey.trim()),
          keyConfigured: true,
          environment: keyEnvironment(apiKey.trim()),
          aiShopDomain: null,
        }
      : {};
  return publicSettings(
    await db.shopSettings.upsert({
      where: { shop },
      create: { shop, ...pricing, ...keyData },
      update: { ...pricing, ...keyData },
    }),
  );
}
export async function getPricing(
  shop: string,
  storeCurrency: string,
): Promise<Pricing> {
  return pricingSchema.parse(await syncStoreCurrency(shop, storeCurrency));
}
