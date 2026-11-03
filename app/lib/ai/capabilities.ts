import type { AiCapability } from "../schema";

export const publicAiCapabilities = [
  "title_translation",
  "description_translation",
  "attribute_translation",
  "image_background",
  "image_text",
  "image_translation",
] as const;

export type PublicAiCapability = (typeof publicAiCapabilities)[number];

export function isPublicAiCapability(
  capability: AiCapability,
): capability is PublicAiCapability {
  return (publicAiCapabilities as readonly string[]).includes(capability);
}

export const aiCapabilityLabel: Record<AiCapability, string> = {
  title_translation: "Translate title",
  description_translation: "Translate description",
  attribute_translation: "Translate attributes",
  seo_description: "SEO description",
  image_background: "White background",
  image_text: "Remove image text",
  image_translation: "Translate image text",
  image_optimization: "Image optimization",
};

type TextTask = {
  kind: "text";
  feature: "text.translate";
  scene: "e-commerce-title" | "e-commerce-description" | "e-commerce-cpv";
  format_type: "text" | "html";
};

type ImageTask = {
  kind: "image";
  feature:
    | "image.background"
    | "image.remove_chinese_text"
    | "image.replace_chinese_text";
  type: "white_background" | "remove_chinese_text" | "replace_chinese_text";
};

export function aiTask(capability: PublicAiCapability): TextTask | ImageTask {
  switch (capability) {
    case "title_translation":
      return {
        kind: "text",
        feature: "text.translate",
        scene: "e-commerce-title",
        format_type: "text",
      };
    case "description_translation":
      return {
        kind: "text",
        feature: "text.translate",
        scene: "e-commerce-description",
        format_type: "html",
      };
    case "attribute_translation":
      return {
        kind: "text",
        feature: "text.translate",
        scene: "e-commerce-cpv",
        format_type: "text",
      };
    case "image_background":
      return {
        kind: "image",
        feature: "image.background",
        type: "white_background",
      };
    case "image_text":
      return {
        kind: "image",
        feature: "image.remove_chinese_text",
        type: "remove_chinese_text",
      };
    case "image_translation":
      return {
        kind: "image",
        feature: "image.replace_chinese_text",
        type: "replace_chinese_text",
      };
  }
}

export const publicAiFeatures = [
  "text.translate",
  "image.remove_chinese_text",
  "image.replace_chinese_text",
  "image.background",
] as const;

export const aiFeatureLabel: Record<(typeof publicAiFeatures)[number], string> =
  {
    "text.translate": "Text translation",
    "image.remove_chinese_text": "Remove image text",
    "image.replace_chinese_text": "Translate image text",
    "image.background": "White background",
  };
