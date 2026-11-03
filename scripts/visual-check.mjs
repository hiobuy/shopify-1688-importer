import { build } from "esbuild";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
const out = resolve("artifacts/ui");
mkdirSync(out, { recursive: true });
await build({
  entryPoints: ["tests/visual/entry.tsx"],
  bundle: true,
  outdir: out,
  format: "esm",
  platform: "browser",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"test"' },
  plugins: [
    {
      name: "test-server-stubs",
      setup(b) {
        b.onResolve({ filter: /\.server$/ }, (args) => ({
          path: args.path,
          namespace: "server-stub",
        }));
        b.onLoad({ filter: /.*/, namespace: "server-stub" }, () => ({
          contents:
            "export const authenticate={}; export const getSettings=()=>{}; export const publicSettings=()=>{}; export const syncStoreCurrency=()=>{}; export const getDraft=()=>{}; export const listCollections=()=>{}; export const shopContext=()=>{}; export default {};",
          loader: "js",
        }));
      },
    },
  ],
});
const html =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/entry.css"></head><body><div id="root"></div><script type="module" src="/entry.js"></script></body></html>';
const server = createServer((req, res) => {
  if (req.url === "/entry.js" || req.url === "/entry.css") {
    res.setHeader(
      "Content-Type",
      req.url.endsWith(".js") ? "application/javascript" : "text/css",
    );
    res.end(readFileSync(resolve(out, req.url.slice(1))));
  } else {
    res.setHeader("Content-Type", "text/html");
    res.end(html);
  }
});
await new Promise((r) => server.listen(4178, "127.0.0.1", r));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const art = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="580" viewBox="0 0 640 580"><rect width="640" height="580" fill="#f0f1e7"/><ellipse cx="320" cy="455" rx="160" ry="20" fill="#dce0cb"/><path d="M210 260h190l-20 170H225z" fill="#b1c589"/><path d="M395 295l110-100 32 20-142 147" fill="#a0b777"/><path d="M213 285c-145-80-114 130 8 110" fill="none" stroke="#8ea66a" stroke-width="30"/><path d="M245 255c20-110 105-110 126 0" fill="none" stroke="#90a869" stroke-width="20"/><text x="320" y="515" text-anchor="middle" font-family="sans-serif" font-size="18" fill="#829169">SYNTHETIC TEST IMAGE</text></svg>`;
  await page.route("https://img.alicdn.com/**", (route) =>
    route.fulfill({ contentType: "image/svg+xml", body: art }),
  );
  await page.route("**/app/api**", async (route) => {
    const req = route.request();
    if (req.method() === "GET") return route.fulfill({ json: { jobs: [] } });
    let input = {};
    try {
      input = req.postDataJSON();
    } catch {}
    if (input.intent === "saveDraft")
      return route.fulfill({
        json: { editor: input.editor, version: input.version + 1 },
      });
    if (input.intent === "search")
      return route.fulfill({
        json: {
          items: Array.from({ length: 8 }, (_, i) => ({
            id: String(123456789012 + i),
            title: [
              "Everyday watering can",
              "Garden spray bottle",
              "Minimal plant mister",
              "Indoor watering essentials",
            ][i % 4],
            originalTitle: "合成测试商品",
            priceCny: 12.8 + i * 2,
            image: `https://img.alicdn.com/test-${i}.jpg`,
            supplier: "Synthetic test supplier",
            sourceUrl: "https://detail.1688.com/offer/123456789012.html",
          })),
          page: 1,
          pageSize: 20,
          total: 8,
          environment: "production",
        },
      });
    return route.fulfill({ json: { ok: true, jobs: [] } });
  });
  const report = [];
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("http://127.0.0.1:4178/app");
    await page.getByLabel("Search keywords").fill("plant watering");
    await page
      .getByRole("button", { name: "Search", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Results for “plant watering”" })
      .waitFor();
    await page.screenshot({
      path: resolve(out, `discover-${viewport.width}.png`),
      fullPage: true,
    });
    await page.goto(
      "http://127.0.0.1:4178/app/editor/00000000-0000-4000-8000-000000000001",
    );
    await page.getByRole("heading", { name: "Edit product" }).waitFor();
    await page.getByLabel(/^Shopify title/).fill("Edited in browser");
    for (const tab of [
      "Product",
      "Description",
      "Variants & Pricing",
      "Images (2)",
    ]) {
      await page.getByRole("tab", { name: tab, exact: true }).click();
      if (tab.startsWith("Variants")) {
        const picker = page.getByRole("button", { name: /image$/ }).first();
        await picker.click();
        await page.screenshot({
          path: resolve(out, `editor-variants-images-${viewport.width}.png`),
        });
        await picker.click();
      }
      if (tab.startsWith("Images")) {
        const tool = page.getByRole("button", {
          name: "Erase Chinese text on image 1",
        });
        await tool.hover();
        await page.screenshot({
          path: resolve(out, `editor-images-tip-${viewport.width}.png`),
        });
      }
      await page.screenshot({
        path: resolve(
          out,
          `editor-${tab.split(" ")[0].toLowerCase()}-${viewport.width}.png`,
        ),
        fullPage: true,
      });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1,
      );
      report.push({ screen: `editor ${tab}`, width: viewport.width, overflow });
    }
    await page.getByRole("tab", { name: "Product", exact: true }).click();
    if (
      (await page.getByLabel(/^Shopify title/).inputValue()) !==
      "Edited in browser"
    )
      throw new Error("Title did not survive tab switches.");
    for (const screen of ["settings", "history"]) {
      await page.goto(`http://127.0.0.1:4178/app/${screen}`);
      await page
        .getByRole("heading", {
          name: screen === "settings" ? "Settings" : "Import history",
          exact: true,
        })
        .waitFor();
      await page.screenshot({
        path: resolve(out, `${screen}-${viewport.width}.png`),
        fullPage: true,
      });
      report.push({
        screen,
        width: viewport.width,
        overflow: await page.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth + 1,
        ),
      });
    }
  }
  writeFileSync(
    resolve(out, "report.json"),
    JSON.stringify(
      { mode: "synthetic-test-harness", screens: report, errors },
      null,
      2,
    ),
  );
  if (errors.length || report.some((r) => r.overflow))
    throw new Error(
      JSON.stringify({ errors, overflow: report.filter((r) => r.overflow) }),
    );
  console.log(
    `Browser checks passed at 1440px and 390px; screenshots saved to ${out}. Synthetic fixtures only.`,
  );
} finally {
  await browser?.close();
  server.close();
}
