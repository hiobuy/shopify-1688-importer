import { makeEditor, type SourceProduct } from "../app/lib/products";
import type { Pricing } from "../app/lib/schema";
export const pricing: Pricing = {
  currency: "USD",
  exchangeRate: "0.14",
  multiplier: "2.5",
  rounding: "two_decimals",
  publishStatus: "DRAFT",
};
// Synthetic test fixture only. No customer or commercial-project data.
export const source: SourceProduct = {
  id: "123456789012",
  channel: "1688",
  source_product_id: "123456789012",
  source_url: "https://detail.1688.com/offer/123456789012.html",
  title: { original: "测试浇水壶", translated: "Everyday watering can" },
  description: {
    original: "<p>测试商品说明</p>",
    translated: "<p>A simple watering can for your plants.</p>",
  },
  price: { display_amount: 12.8 },
  images: [
    { url: "https://img.alicdn.com/test-fixture.jpg", type: "main" },
    { url: "https://img.alicdn.com/test-fixture-2.jpg", type: "gallery" },
  ],
  seller: { name: "Synthetic test supplier" },
  attributes: [
    {
      name: "Material",
      value: "Plastic",
      original_name: "材质",
      original_value: "塑料",
    },
  ],
  variants: [
    {
      sku_id: "test-sku-green-s",
      attributes: [
        {
          name: "Color",
          value: "Green",
          original_name: "颜色",
          original_value: "绿色",
          prop_id: "1",
        },
        {
          name: "Size",
          value: "Small",
          original_name: "尺寸",
          original_value: "小",
          prop_id: "2",
        },
      ],
      price: { display_amount: 12.8 },
      image: "https://img.alicdn.com/test-fixture.jpg",
      stock: 5,
    },
    {
      sku_id: "test-sku-green-l",
      attributes: [
        {
          name: "Color",
          value: "Green",
          original_name: "颜色",
          original_value: "绿色",
          prop_id: "1",
        },
        {
          name: "Size",
          value: "Large",
          original_name: "尺寸",
          original_value: "大",
          prop_id: "2",
        },
      ],
      price: { display_amount: 16 },
      image: "https://img.alicdn.com/test-fixture-2.jpg",
      stock: 12,
    },
  ],
};
export function editorFixture() {
  return makeEditor(structuredClone(source), { ...pricing });
}
