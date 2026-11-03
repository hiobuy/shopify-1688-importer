# Setup and deployment

## 1. Create the Shopify app with the CLI

Do not create the app by hand, and do not run `npm init @shopify/app@latest` in this folder. This repository is already the app. `npm run dev` runs Shopify CLI, which creates a new app in your Shopify account, writes its Client ID, and opens a development tunnel.

```sh
npm ci
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Paste the printed value into `.env` as `ENCRYPTION_KEY`. Leave `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, and `SHOPIFY_APP_URL` empty. Leave `client_id` in `shopify.app.toml` empty. A placeholder in either file makes the CLI search for an app that does not exist (`no app was found for the provided apiKey`).

```sh
npm run dev
```

Answer the prompts:

1. Log in to Shopify in the browser and approve the device code.
2. **Create this project as a new app on Shopify?** Choose **Yes, create it as a new app**.
3. Create a development store if you do not have one, then confirm in the terminal.
4. Let Shopify update the app URLs for the tunnel.
5. Press `p` and open the printed Preview URL inside Shopify Admin.

The scopes shipped in `shopify.app.toml` are `read_products,write_products,read_files,write_files`. The CLI keeps the tunnel URL, `application_url`, and `/auth/callback` in sync while `automatically_update_urls_on_dev` is true. Webhooks use `/webhooks/app` and API version `2026-10`.

This source uses Shopify's official React Router package and expiring offline sessions. Do not point it at an existing commercial app. An app created in a shop's legacy custom-app screen uses a different token flow and will not run this embedded app.

## 2. Configure the server

```sh
npm ci
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

| Variable             | Required | Meaning                                                                               |
| -------------------- | -------- | ------------------------------------------------------------------------------------- |
| `SHOPIFY_API_KEY`    | Dev: written by the CLI | Public Client ID. Leave blank before the first `npm run dev`                         |
| `SHOPIFY_API_SECRET` | Dev: written by the CLI | App Secret; server-side only. Leave blank before the first `npm run dev`             |
| `SHOPIFY_APP_URL`    | Dev: written by the CLI | Public HTTPS app origin. The CLI sets the tunnel URL                                 |
| `SCOPES`             | Yes      | The four scopes above, also set in app TOML                                           |
| `ENCRYPTION_KEY`     | Yes      | Exactly 32 random bytes encoded as base64; stable across restarts                     |
| `DATABASE_URL`       | Yes      | Local: `file:./dev.sqlite`; Docker: `file:/data/importer.sqlite`                      |
| `HIOBUY_API_KEY`     | Optional | First-run seed for this deployment; Settings stores an encrypted per-shop replacement |
| `PORT`               | Optional | Defaults to 3000                                                                      |

Relative SQLite paths resolve from `prisma/`. `setup` creates a missing database with restricted file permissions, generates Prisma Client and applies committed migrations. Do not run `prisma migrate dev` on deployment data.

The optional HIOBuy environment seed applies when a shop's settings are first created. Removing a stored key in Settings does not reseed it while that settings row exists. If multiple stores install this self-hosted app, an environment seed is shared by the deployment owner; use per-shop Settings if different keys are required.

`npm run dev` runs `npm run setup` before the web server starts, so a separate setup command is optional. `npm run dev:app` runs only the web server and expects `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, and `SHOPIFY_APP_URL` to already be real values. For a server you host yourself, copy the Client ID and Secret from the Dev Dashboard into `.env` and set `SHOPIFY_APP_URL` to that server's public HTTPS origin.

For a persistent Node host:

```sh
npm run setup
npm run build
npm start
```

`setup`, `start` and `dev:app` load a local `.env` when present; already-provided process environment takes precedence. Never commit `.env`, session databases, backups, tokens or deployment secrets.

## 3. Configure HIOBuy

Obtain a legitimate key from the [HIOBuy developer portal](https://developers.hiobuy.com/en/developer/api-keys). Complete the documented [1688 channel authorization](https://hiobuy.com/en/api-docs/authentication) and choose a subscription/key with access to search, detail and image search. This demo cannot grant permissions or bypass quotas.

Save the key in **Settings → HIOBuy**. The saved key is encrypted with AES-256-GCM and never returned to the browser. The UI only receives a configured flag and environment label. Changing the key changes future requests; existing drafts keep their original environment provenance.

Both key types use `https://api.hiobuy.com`:

- `hio_live_…`: the public production API. Trial and paid keys both return real 1688 product data, subject to your authorization and quota. Commerce AI uses the same key when that app has a prepaid AI account. Credits are billed separately from product API quota.
- `hio_test_…`: still recognized by this demo. Drafts are labeled, and Active import is blocked. HIOBuy no longer offers a separate Sandbox API. Do not treat this key shape, or the synthetic fixtures under `tests/`, as official sandbox product data. New setups should use `hio_live_…`.

**Test connection** performs a real `products/search` request. It verifies 1688 search access; it does not certify separate image-search permissions. A 403 or quota response is shown honestly. A newly entered key is saved first. Do not send keys to support; send the public endpoint, returned code and request ID.

## 4. Pricing and first acceptance run

The currency always follows the Shopify store's base currency and cannot be edited. CNY stores need no exchange rate. Other stores set a manual rate in **store-currency units per 1 CNY**. Then choose a multiplier; the page shows a live price example. Defaults apply only to new drafts. In the Variants tab you may override those defaults and explicitly recalculate all prices. Existing manual SKU prices do not change silently when a rate is edited.

Use a development store and a permitted production HIOBuy key to validate:

1. Keyword search and next/previous page; permission and quota error handling.
2. JPEG/PNG/WebP upload, image search and image-ID pagination; mismatched or oversized images fail.
3. Product URL and details: source title, real fields and SKU matrix.
4. Edit all four tabs, wait for Saved, reload, and confirm edits persist.
5. Select a few SKU combinations and images, edit option labels and prices, then import as Draft.
6. If Shopify is still processing images, the app waits and finishes the import automatically. Confirm a single Shopify product ID across attempts.
7. Inspect the real Shopify product: fields, manual collections, attributes appended to description, options, variants, SKU images, image order/cover and prices.
8. Test Active with a product loaded through an `hio_live_…` key. Select sales channels in Shopify Admin separately.
9. In Settings, choose **Find AI account** under Commerce AI. The app looks up the prepaid account from the saved API key and shows the balance; there is nothing to copy. If no account exists yet, create it in HIOBuy Developer Center → AI Enhancement first. Translate a title, preview the result and apply it only if it is right. Image tools need an approved HTTPS image URL; local uploads are not sent.
10. Reopen an import as a new draft. The UI explains that importing that new draft creates a separate product.

Record request IDs and Shopify product IDs privately. A later manual run confirmed that a real 1688 product can be imported into Shopify. That run is not an automated suite and does not cover every failure mode. See [VERIFICATION.md](VERIFICATION.md).

## Docker deployment

```sh
docker compose up --build -d
docker compose logs -f importer
```

The image uses Node 24, OpenSSL, a non-root runtime user and a persistent `/data` volume. Startup runs committed migrations before the server. Prisma CLI remains a production dependency because it is needed for deployment migrations. `.dockerignore` excludes local databases, environment files, Git and test artifacts.

Expose the app with your own HTTPS reverse proxy. Preserve the real Host and request headers, accept uploads larger than 4 MB including multipart overhead, and allow sufficiently long import requests. Set the public Shopify URL and callback before installation. The container port binds to localhost in Compose; configure your proxy to forward to it. `/healthz` reports process liveness, not Shopify authorization or database readiness.

Run one application replica with this SQLite volume. Do not mount the SQLite file over a shared network filesystem. For a multi-instance deployment, migrate to a supported server database, shared asset storage, and a durable publish queue first. Back up the database volume and encryption key securely; losing the encryption key requires reauthorizing Shopify sessions and replacing HIOBuy credentials. There is no automatic key-rotation workflow yet.

Docker Desktop/daemon must be running before build and runtime checks. See the current verification report for what was actually executed.

## Troubleshooting

| Symptom                              | Action                                                                                                                                             |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `no app was found for the provided apiKey` | `client_id` or `SHOPIFY_API_KEY` is still a placeholder. Set both to empty, then run `npm run dev` and choose **Yes, create it as a new app**. |
| App frame is blank and the `trycloudflare.com` URL returns an empty `404` | `~/.cloudflared/config.yml` exists. The CLI's quick tunnel loads it, and its `http_status:404` catch-all replaces `--url`. Rename the file (for example `mv ~/.cloudflared/config.yml ~/.cloudflared/my-tunnel.yml`, then start that tunnel with `--config`), and restart `npm run dev`. |
| `trycloudflare.com` URL fails with "unexpectedly closed the connection" | A proxy in TUN or fake-IP mode (Clash, Surge) is intercepting the tunnel. Add `DOMAIN-SUFFIX,trycloudflare.com,DIRECT` and `PROCESS-NAME,cloudflared,DIRECT` rules, and add `+.trycloudflare.com` to the fake-IP filter. |
| Blank embedded frame / redirect loop | Open via the CLI Preview URL inside Shopify Admin. Do not open localhost yourself. Do not bypass auth. |
| `ENCRYPTION_KEY` error               | Set a stable generated 32-byte base64 key and restart. Do not paste a short password.                                                              |
| Missing scope                        | Update the independent app's configuration and reauthorize/reinstall on the dev store.                                                             |
| `CHANNEL_NOT_AUTHORIZED`             | Authorize 1688 for your HIOBuy app in the developer portal.                                                                                        |
| HIOBuy quota or 403                  | Check actual subscription/key permissions; no hidden fallback exists.                                                                              |
| Invalid standard response            | Preserve request ID; compare with public response-model docs. The app fails closed.                                                                |
| Images processing                    | The app waits and retries on its own. If you left the page, open the draft again and choose **Finish import**; cached file IDs and the same product are reused. |
| Image failed                         | Check whether the supplier URL is public and still available. Re-edit as a new draft to remove/replace bad media.                                  |
| Draft conflict                       | Reload before editing further; another tab's data was not overwritten. Copy unsaved text if needed.                                                |
| Currency mismatch                    | Drafts made before the store currency changed show a warning in the editor. Choose **Switch to … and recalculate**, then check the SKU prices.        |
| Stuck import after process crash     | History permits recovery after the 10-minute stale-lock window. Do not delete the record to force a new product.                                   |
| Missing catalogue image              | Only documented HTTPS marketplace/HIOBuy/Shopify CDN URLs are accepted. Unsupported images are omitted instead of server-fetching arbitrary hosts. |
