# HIOBuy 1688 → Shopify

An independently implemented, open-source Shopify Embedded App for discovering 1688 products, editing persistent drafts, and creating real Shopify products with your own Shopify app and HIOBuy Public API key. This is a standalone demo, not an export of the commercial 1688 AI Importer.

**Product discovery and publishing use the public product APIs. Commerce AI uses the separate public V1 Credits API for four capabilities.** SEO generation and general image optimization are not in that contract. No internal HIOBuy token, private endpoint, billing bypass, company service binding, or customer data is required or included.

## What you can do

- Search 1688 by keyword, uploaded image, or validated product URL; paginate results and load details on demand.
- Edit Product, Description, Variants & Pricing, and Images tabs with database-backed autosave and optimistic concurrency checks.
- Edit options and SKUs, exclude variants, set prices from CNY cost, reorder/select/upload images, set a cover and associate SKU images.
- Import real Draft or Active products using Shopify Admin GraphQL `2026-10`, including options, variants, manual collections and images.
- Translate titles, descriptions and attributes, and run image text removal, image translation or white-background jobs through public Commerce AI V1. Each task is estimated first, billed in AI Credits, and applied only after you confirm it.
- Track imports, inspect errors, safely retry an interrupted import, or reopen a snapshot as a new draft.

The demo currently bounds each synchronous import to **100 selected variants, 3 options and 50 images**. It does not synchronize inventory, fulfillment or sales channels. Active is a product status; choose sales channel availability in Shopify Admin. Sandbox source data is visibly labeled and can only be imported as real Shopify Drafts.

## Quick start

You need Node.js 22.12 or newer (24 LTS is fine) and a Shopify account. A HIOBuy API key is only needed when you search real 1688 products. Do not run `npm init @shopify/app@latest` inside this folder. This repository is already the app. Shopify CLI creates your app the first time you start it.

**1. Install**

```sh
npm ci
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Open `.env`. Paste the printed line after `ENCRYPTION_KEY=`. Leave `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, and `SHOPIFY_APP_URL` empty.

**2. Start**

```sh
npm run dev
```

**3. Answer the prompts**

1. A browser opens so you can log in to Shopify. Approve it. You are already logged in if the terminal says `Logged in.`
2. **Create this project as a new app on Shopify?** Choose **Yes, create it as a new app**.
3. If you have no development store, create one when asked, finish that page, then return to the terminal and confirm.
4. **Have Shopify override your app URLs?** Choose **Yes**.
5. Press `p`, or open the Preview URL printed in the terminal. Use that Shopify Admin link. Do not open `localhost` yourself.

The CLI writes the Client ID into `shopify.app.toml` and the key, secret, and tunnel URL into `.env`. Do not commit those values.

**4. Connect HIOBuy**

In the app, open **Settings**. Paste your HIOBuy API key and choose **Save and test connection**. The currency follows your Shopify store automatically. If the store does not sell in CNY, set the exchange rate before the first import.

If the terminal says `no app was found for the provided apiKey`, `shopify.app.toml` still has a fake `client_id`, or `.env` still has a fake `SHOPIFY_API_KEY`. Clear both, then run `npm run dev` again.

If the app frame is blank, open the `trycloudflare.com` URL directly. An empty `404` means `~/.cloudflared/config.yml` is overriding the tunnel. Rename that file and restart `npm run dev`. More fixes are in [docs/SETUP.md](docs/SETUP.md).

Full configuration, Docker, and troubleshooting: **[docs/SETUP.md](docs/SETUP.md)**.

## First import

1. Search, upload a product photo, or paste `https://detail.1688.com/offer/<id>.html`.
2. Open a product, inspect actual supplier fields and SKUs, then select **Edit & import**.
3. Edit all four tabs. Check prices and selected variants. Missing source prices must be entered manually; supplier stock is informational.
4. Select **Draft** first, then **Import to Shopify** and confirm the real store write.
5. If Shopify is processing media, wait briefly and use **Safe retry** in Import history. It resumes the same immutable import snapshot and product identifier.
6. Open the Shopify product and verify options, prices, SKU pictures, cover/order, description and status.

A deliberate **Re-edit** creates a new draft. Importing it creates a separate product; safe retry resumes the original import. The UI explains this distinction before a new import.

## Docker

```sh
docker compose up --build -d
```

Configure `.env` first. Compose binds to `127.0.0.1:3000`; put an HTTPS reverse proxy in front and set the public URL and OAuth callback accordingly. `/data` is a persistent named SQLite volume. Back up the volume and encryption key together. Run one application replica for this SQLite demo. See [deployment instructions](docs/SETUP.md#docker-deployment).

## Development and verification

```sh
npm run typecheck
npm test
npm run build
npm run check:security
npm run check:licenses
npm audit --omit=dev --registry=https://registry.npmjs.org
```

Optional synthetic browser checks (no credentials or real API calls):

```sh
npx playwright install chromium
npm run test:visual
```

The test-only harness is separate from production routes and labels all fixtures. It exercises the actual page/editor components at desktop and phone widths. Results go to ignored `artifacts/ui/`. No authentication bypass is shipped in the app.

**Verification status:** local tests and builds are documented in [docs/VERIFICATION.md](docs/VERIFICATION.md). Live installation, actual HIOBuy account access, real Shopify media processing and a real product import still require your own configured credentials and a development-store acceptance run. Docker runtime verification depends on a running local Docker daemon. The runtime dependency audit is clean; the known upstream Shopify CLI development-tool advisory is recorded in the verification report.

## Documentation

- [Setup and deployment](docs/SETUP.md)
- [Architecture and security boundaries](docs/ARCHITECTURE.md)
- [Public API integration and Shopify mapping](docs/API-INTEGRATION.md)
- [Implemented, simulated, pending and limitations](docs/TODO.md)
- [Inspection and implementation plan](docs/PLAN.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)

MIT licensed; retain the Shopify template attribution and dependency notices. Product media and descriptions come from the account holder's own API requests and are not shipped with the source.
