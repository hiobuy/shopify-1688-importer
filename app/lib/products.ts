import type { Editor, Pricing } from "./schema";
import { calculatePrice } from "./pricing";
export interface LocalizedText {
  original: string;
  translated?: string | null;
  language?: string;
}
export interface ProductPrice {
  display_amount?: number | null;
  promotion_amount?: number | null;
  original_amount?: number | null;
}
export interface SourceAttribute {
  name: string;
  value: string;
  original_name?: string;
  original_value?: string;
  prop_id?: string | null;
  value_id?: string | null;
  image?: string | null;
}
export interface SourceProduct {
  id: string;
  channel: "1688";
  source_product_id: string;
  source_url: string;
  title: LocalizedText;
  description?: LocalizedText | null;
  price?: ProductPrice;
  images: { url: string; type?: string }[];
  variants: {
    sku_id: string;
    attributes: SourceAttribute[];
    price: ProductPrice;
    image?: string | null;
    stock?: number;
  }[];
  attributes?: SourceAttribute[];
  seller?: { name?: string };
  metadata?: { raw_category?: string | null; brand?: string | null };
  min_order_quantity?: number | null;
}
export interface ProductSummary {
  id: string;
  sourceUrl: string;
  title: string;
  originalTitle: string;
  priceCny: number | null;
  image: string;
  supplier: string;
}
export function sourcePrice(price?: ProductPrice): number | null {
  for (const p of [
    price?.promotion_amount,
    price?.display_amount,
    price?.original_amount,
  ])
    if (typeof p === "number" && Number.isFinite(p) && p >= 0) return p;
  return null;
}
export function makeEditor(product: SourceProduct, pricing: Pricing): Editor {
  const images: Editor["images"] = [];
  function addImage(url: string) {
    let image = images.find((i) => i.url === url);
    if (!image) {
      image = {
        id: `image-${images.length + 1}`,
        url,
        originalUrl: url,
        selected: true,
        alt: product.title.translated || product.title.original,
      };
      images.push(image);
    }
    return image.id;
  }
  product.images.forEach((i) => addImage(i.url));
  const dimensions = new Map<string, string>();
  const variants = product.variants.map((variant, i) => ({
    id: variant.sku_id || `variant-${i}`,
    sku: variant.sku_id || "",
    selected: true,
    costCny: sourcePrice(variant.price),
    price: calculatePrice(sourcePrice(variant.price), pricing),
    imageId:
      variant.image || variant.attributes.find((a) => a.image)?.image
        ? addImage(
            (variant.image || variant.attributes.find((a) => a.image)?.image)!,
          )
        : null,
    stock: variant.stock ?? null,
    options: variant.attributes.map((a) => {
      const key = a.prop_id || a.original_name || a.name;
      const name = dimensions.get(key) || a.name || a.original_name || key;
      dimensions.set(key, name);
      return { key, name, value: a.value || a.original_value || "" };
    }),
  }));
  const dimensionOrder = [...dimensions.keys()];
  variants.forEach((v) =>
    v.options.sort(
      (a, b) => dimensionOrder.indexOf(a.key) - dimensionOrder.indexOf(b.key),
    ),
  );
  if (!variants.length)
    variants.push({
      id: "default",
      sku: "",
      selected: true,
      costCny: sourcePrice(product.price),
      price: calculatePrice(sourcePrice(product.price), pricing),
      imageId: null,
      stock: null,
      options: [],
    });
  return {
    title: product.title.translated || product.title.original,
    productType: "",
    vendor: product.seller?.name || "",
    tags: [],
    collections: [],
    descriptionHtml:
      product.description?.translated || product.description?.original || "",
    seoDescription: "",
    attributes: (product.attributes || []).map((a) => ({
      name: a.name || a.original_name || "",
      value: a.value || a.original_value || "",
    })),
    pricing,
    variants,
    images,
  };
}
