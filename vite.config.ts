import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";
const raw =
  process.env.SHOPIFY_APP_URL ||
  process.env.APP_URL ||
  process.env.HOST ||
  "http://localhost:3000";
const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
export default defineConfig({
  plugins: [reactRouter()],
  server: {
    port: Number(process.env.PORT || 3000),
    allowedHosts: [url.hostname, ".trycloudflare.com"],
  },
  build: { assetsInlineLimit: 0 },
});
