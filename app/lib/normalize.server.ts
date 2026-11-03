import { z } from "zod";
import { AppError } from "./errors";
import { safeImageUrl, sanitizeDescription } from "./validation.server";
import {
  sourcePrice,
  type SourceProduct,
  type ProductSummary,
} from "./products";
const text = z.object({
  original: z.string(),
  translated: z.string().nullable().optional(),
  language: z.string().optional(),
});
const amount = z.number().finite().nonnegative().nullable().optional();
const price = z.object({
  display_amount: amount,
  promotion_amount: amount,
  original_amount: amount,
});
const attr = z.object({
  name: z.string(),
  value: z.string(),
  original_name: z.string().optional(),
  original_value: z.string().optional(),
  prop_id: z.string().nullable().optional(),
  value_id: z.string().nullable().optional(),
  image: z.string().nullable().optional(),
});
const identity = z.string().min(1).max(100);
const detail = z.object({
  id: identity,
  channel: z.literal("1688"),
  source_product_id: identity,
  source_url: z.string().optional(),
  title: text,
  description: text.nullable().optional(),
  price: price.optional(),
  images: z
    .array(z.object({ url: z.string(), type: z.string().optional() }))
    .default([]),
  variants: z
    .array(
      z.object({
        sku_id: z.string(),
        attributes: z.array(attr),
        price,
        image: z.string().nullable().optional(),
        stock: z.number().finite().optional(),
      }),
    )
    .max(2048),
  attributes: z.array(attr).optional(),
  seller: z.object({ name: z.string().optional() }).optional(),
  metadata: z
    .object({
      raw_category: z.string().nullable().optional(),
      brand: z.string().nullable().optional(),
    })
    .optional(),
  min_order_quantity: z.number().nullable().optional(),
});
export function normalizeDetail(body: unknown): SourceProduct {
  const parsed = z.object({ product: detail }).safeParse(body);
  if (!parsed.success)
    throw new AppError(
      "HIOBuy product detail does not match the documented standard model. Keep the request ID for support.",
      502,
      "HIOBUY_CONTRACT_ERROR",
    );
  const p = parsed.data.product;
  return {
    ...p,
    source_url: /^\d{6,25}$/.test(p.source_product_id)
      ? `https://detail.1688.com/offer/${p.source_product_id}.html`
      : "",
    description: p.description
      ? {
          ...p.description,
          original: sanitizeDescription(p.description.original),
          translated: p.description.translated
            ? sanitizeDescription(p.description.translated)
            : null,
        }
      : null,
    images: p.images
      .map((i) => ({ ...i, url: safeImageUrl(i.url) }))
      .filter((i) => i.url),
    variants: p.variants.map((v) => ({
      ...v,
      image: safeImageUrl(v.image || ""),
      attributes: v.attributes.map((a) => ({
        ...a,
        image: safeImageUrl(a.image || ""),
      })),
    })),
  };
}
export function normalizeList(body: unknown): {
  items: ProductSummary[];
  page: number;
  total: number;
  pageSize: number;
} {
  const result = z
    .object({
      channel: z.literal("1688"),
      items: z.array(
        z.object({
          id: identity,
          source_product_id: identity.optional(),
          title: text,
          price: price.optional(),
          image: z.string().optional(),
          seller: z.object({ name: z.string().optional() }).optional(),
        }),
      ),
      page: z.number().int().positive(),
      page_size: z.number().int().positive(),
      total: z.number().nonnegative(),
    })
    .safeParse(body);
  if (!result.success)
    throw new AppError(
      "HIOBuy search did not match the documented standard model.",
      502,
      "HIOBUY_CONTRACT_ERROR",
    );
  const { items, page, page_size, total } = result.data;
  return {
    page,
    pageSize: page_size,
    total,
    items: items.map((p) => ({
      id: p.id,
      sourceUrl: /^\d{6,25}$/.test(p.source_product_id || p.id)
        ? `https://detail.1688.com/offer/${p.source_product_id || p.id}.html`
        : "",
      title: p.title.translated || p.title.original,
      originalTitle: p.title.original,
      priceCny: sourcePrice(p.price),
      image: safeImageUrl(p.image || ""),
      supplier: p.seller?.name || "",
    })),
  };
}
