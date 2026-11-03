import Decimal from "decimal.js";
import type { Editor } from "./schema";
import { AppError } from "./errors";
export function validatePublish(
  editor: Editor,
  environment: string,
  shopCurrency: string,
) {
  if (environment === "sandbox" && editor.pricing.publishStatus === "ACTIVE")
    throw new AppError(
      "Sandbox products are simulated data. Import them only as Shopify Drafts.",
    );
  if (editor.pricing.currency !== shopCurrency)
    throw new AppError(
      `Shopify product prices use the store currency (${shopCurrency}). Choose “Switch to ${shopCurrency} and recalculate” at the top of the editor, then import again.`,
    );
  const variants = editor.variants.filter((v) => v.selected);
  // Bounded synchronous demo imports; Shopify supports more with an asynchronous implementation.
  if (!variants.length || variants.length > 100)
    throw new AppError("Select between 1 and 100 variants for one import.");
  const images = editor.images.filter((i) => i.selected);
  if (images.length > 50)
    throw new AppError("Select at most 50 images per import.");
  if (
    new Set(editor.images.map((i) => i.id)).size !== editor.images.length ||
    new Set(variants.map((v) => v.id)).size !== variants.length
  )
    throw new AppError("Image and variant identifiers must be unique.");
  const dimensions = variants[0].options;
  if (
    dimensions.length > 3 ||
    new Set(dimensions.map((o) => o.key)).size !== dimensions.length ||
    new Set(dimensions.map((o) => o.name)).size !== dimensions.length
  )
    throw new AppError("Use at most 3 unique product options.");
  const combos = new Set<string>();
  const decimals =
    new Intl.NumberFormat("en", {
      style: "currency",
      currency: shopCurrency,
    }).resolvedOptions().maximumFractionDigits ?? 2;
  for (const variant of variants) {
    if (
      !variant.price ||
      !new Decimal(variant.price).isFinite() ||
      new Decimal(variant.price).lte(0) ||
      new Decimal(variant.price).gt("999999999")
    )
      throw new AppError(
        `Enter a positive Shopify price for SKU ${variant.sku || variant.id}.`,
      );
    if (new Decimal(variant.price).decimalPlaces() > decimals)
      throw new AppError(
        `Prices in ${shopCurrency} can have at most ${decimals} decimal places.`,
      );
    if (
      variant.options.length !== dimensions.length ||
      variant.options.some(
        (o, i) => o.key !== dimensions[i].key || o.name !== dimensions[i].name,
      )
    )
      throw new AppError(
        "Each variant must use the same option names and order.",
      );
    const signature = JSON.stringify(variant.options.map((o) => o.value));
    if (combos.has(signature))
      throw new AppError(
        "Two selected variants have the same option combination. Edit or exclude one.",
      );
    combos.add(signature);
    if (variant.imageId && !images.some((i) => i.id === variant.imageId))
      throw new AppError(
        `The image for SKU ${variant.sku || variant.id} is excluded. Select its image or clear the SKU image.`,
      );
  }
}
export function descriptionWithAttributes(editor: Editor): string {
  const escape = (value: string) =>
    value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  const attributes = editor.attributes.filter(
    (a) => a.name.trim() && a.value.trim(),
  );
  return (
    editor.descriptionHtml +
    (attributes.length
      ? "<h3>Product details</h3><table><tbody>" +
        attributes
          .map(
            (a) =>
              `<tr><th>${escape(a.name)}</th><td>${escape(a.value)}</td></tr>`,
          )
          .join("") +
        "</tbody></table>"
      : "")
  );
}
export function optionSignature(options: { name: string; value: string }[]) {
  return JSON.stringify(
    [...options].sort((a, b) => a.name.localeCompare(b.name)),
  );
}
export function productSetInput(
  editor: Editor,
  handle: string,
  files: Record<string, string>,
  existingVariants: {
    id: string;
    selectedOptions: { name: string; value: string }[];
  }[] = [],
) {
  const selected = editor.variants.filter((v) => v.selected);
  const dimensions = selected[0].options;
  const productOptions = dimensions.length
    ? dimensions.map((o, i) => ({
        name: o.name,
        position: i + 1,
        values: [...new Set(selected.map((v) => v.options[i].value))].map(
          (name) => ({ name }),
        ),
      }))
    : [{ name: "Title", position: 1, values: [{ name: "Default Title" }] }];
  return {
    title: editor.title,
    descriptionHtml: descriptionWithAttributes(editor),
    productType: editor.productType,
    vendor: editor.vendor,
    tags: editor.tags,
    collections: editor.collections,
    handle,
    status: editor.pricing.publishStatus,
    seo: { description: editor.seoDescription },
    productOptions,
    files: editor.images
      .filter((i) => i.selected)
      .map((i) => ({ id: files[i.id], alt: i.alt })),
    variants: selected.map((v, index) => {
      const options = v.options.length
        ? v.options.map((o) => ({ name: o.name, value: o.value }))
        : [{ name: "Title", value: "Default Title" }];
      const existing = existingVariants.find(
        (e) => optionSignature(e.selectedOptions) === optionSignature(options),
      );
      return {
        ...(existing ? { id: existing.id } : {}),
        position: index + 1,
        sku: v.sku,
        price: v.price,
        // Marketplace stock is informational. No warehouse/location inventory is invented.
        inventoryItem: { tracked: false },
        optionValues: options.map((o) => ({
          optionName: o.name,
          name: o.value,
        })),
        ...(v.imageId && files[v.imageId]
          ? { file: { id: files[v.imageId] } }
          : {}),
      };
    }),
  };
}
