import Decimal from "decimal.js";
import type { Pricing } from "./schema";
export function alignCurrency<T extends Pick<Pricing, "currency" | "exchangeRate">>(
  pricing: T,
  storeCurrency: string,
): T {
  if (pricing.currency === storeCurrency) return pricing;
  return {
    ...pricing,
    currency: storeCurrency,
    exchangeRate: storeCurrency === "CNY" ? "1" : pricing.exchangeRate,
  };
}
export function calculatePrice(
  costCny: number | null,
  pricing: Pricing,
): string {
  if (costCny === null || !Number.isFinite(costCny) || costCny < 0) return "";
  if (
    !/^[A-Z]{3}$/.test(pricing.currency) ||
    !/^\d+(\.\d+)?$/.test(pricing.exchangeRate) ||
    !/^\d+(\.\d+)?$/.test(pricing.multiplier)
  )
    return "";
  const raw = new Decimal(costCny)
    .mul(pricing.exchangeRate)
    .mul(pricing.multiplier);
  const decimals =
    new Intl.NumberFormat("en", {
      style: "currency",
      currency: pricing.currency,
    }).resolvedOptions().maximumFractionDigits ?? 2;
  if (pricing.rounding === "whole" || decimals === 0)
    return raw.ceil().toFixed(decimals);
  if (pricing.rounding === "ending_99")
    return raw.add("0.01").ceil().sub("0.01").toFixed(decimals);
  return raw.toFixed(decimals, Decimal.ROUND_HALF_UP);
}
