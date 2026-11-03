import { z } from "zod";
export const roundingSchema = z.enum(["two_decimals", "ending_99", "whole"]);
export const pricingSchema = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/),
  exchangeRate: z
    .string()
    .regex(/^\d+(\.\d{1,8})?$/)
    .refine(
      (v) => Number(v) > 0 && Number(v) < 100000,
      "Enter a positive CNY exchange rate.",
    ),
  multiplier: z
    .string()
    .regex(/^\d+(\.\d{1,4})?$/)
    .refine(
      (v) => Number(v) > 0 && Number(v) <= 1000,
      "Enter a multiplier between 0 and 1000.",
    ),
  rounding: roundingSchema,
  publishStatus: z.enum(["DRAFT", "ACTIVE"]),
});
export type Pricing = z.infer<typeof pricingSchema>;
export const imageSchema = z.object({
  id: z.string().max(150),
  url: z.string().max(3000),
  originalUrl: z.string().max(3000),
  selected: z.boolean(),
  alt: z.string().max(512),
  assetId: z.string().optional(),
  aiSourceUrl: z.string().max(3000).optional(),
  mockApplied: z.boolean().optional(),
});
export const optionSchema = z.object({
  key: z.string().max(150),
  name: z.string().trim().min(1).max(255),
  value: z.string().trim().min(1).max(255),
});
export const editorSchema = z.object({
  title: z.string().trim().min(1).max(255),
  productType: z.string().max(255),
  vendor: z.string().max(255),
  tags: z.array(z.string().trim().min(1).max(255)).max(250),
  collections: z
    .array(z.string().regex(/^gid:\/\/shopify\/Collection\/\d+$/))
    .max(50),
  descriptionHtml: z.string().max(150000),
  seoDescription: z.string().max(320),
  attributes: z
    .array(z.object({ name: z.string().max(255), value: z.string().max(2000) }))
    .max(250),
  pricing: pricingSchema,
  variants: z
    .array(
      z.object({
        id: z.string().max(150),
        sku: z.string().max(255),
        selected: z.boolean(),
        costCny: z.number().nonnegative().nullable(),
        price: z
          .string()
          .regex(/^\d+(\.\d{1,3})?$/)
          .or(z.literal("")),
        imageId: z.string().nullable(),
        options: z.array(optionSchema).max(3),
        stock: z.number().nullable(),
      }),
    )
    .max(2048),
  images: z.array(imageSchema).max(100),
});
export type Editor = z.infer<typeof editorSchema>;
export const capabilities = [
  "title_translation",
  "description_translation",
  "attribute_translation",
  "seo_description",
  "image_background",
  "image_text",
  "image_translation",
  "image_optimization",
] as const;
export const capabilitySchema = z.enum(capabilities);
export type AiCapability = z.infer<typeof capabilitySchema>;
export const settingsInputSchema = pricingSchema.extend({
  apiKey: z.string().max(250).optional(),
  removeKey: z.boolean().optional(),
});
