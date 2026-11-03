# Delivery status and remaining work

## 1. Implemented using real integrations

- Official Shopify Embedded App authentication, App Bridge, persistent expiring offline sessions, encrypted access/refresh token storage, scope checks and authenticated uninstall/scope webhooks.
- Fixed-origin HIOBuy Public API client; real keyword search, image upload/search with image-ID pagination, URL identity parsing and product details. Subscription/permission/quota failures remain explicit.
- Product detail dialog and supplier link. Four editor tabs; source title/attributes/description; editable title/type/vendor/manual collections/tags/SEO; rich-text description; SKU selection, shared option names and per-variant values, cost display, manual currency/rate/multiplier/rounding and batch pricing; image ordering, cover, exclusion, alt text, upload and visual SKU picture selection.
- Database persistence, debounce/serialized autosave, version conflicts, navigation guards, immutable import snapshots and per-shop ownership.
- Real Shopify GraphQL publishing service, Draft/Active, options and variants, ordered image files and variant image mapping, staged local uploads, media readiness checks, product ID storage, errors, locked duplicate submissions and deterministic-handle safe retry.
- Settings, key rotation/removal, real connection test, environment labels and server-side restriction on Active Sandbox imports.
- Persisted import history, detail, Shopify product link, safe retry and explicit re-edit as a separate new draft/product.
- Node/Docker source, committed SQLite migration, environment example, MIT/Shopify attribution, dependency license inventory, tests and security scanner.

These are implemented code paths. Their live account acceptance is a separate pending item below; synthetic transports do not prove real external integration.

## 2. Commerce AI

- Public V1 text translation and three image operations call `https://api.hiobuy.com` with the saved API key, AI account discovered from that key, and a persisted idempotency key.
- Estimates run before execution. Insufficient Credits stop the task before it is created. Product API quota is not treated as AI Credits.
- Image results are copied from the HIOBuy asset host into the draft before they can be applied. Other result URLs are not fetched.
- SEO generation and general image optimization are not called. Commerce AI V1 does not publish those operations.
- There is no in-app payment or credit-grant call. Purchases stay in the HIOBuy developer center.

## 3. Earlier simulated jobs

- Jobs already stored with the mock provider can still be listed. New jobs are not simulated.
- Mock text had an explicit prefix. Mock images kept the original pixels and a simulation notice.

## 4. Configuration the user must supply

- A Shopify account. `npm run dev` creates the app, Client ID, Secret, tunnel URL, and development-store install. Do not commit the values it writes.
- Stable random ENCRYPTION_KEY, persistent SQLite URL/volume and secure backups.
- Legal HIOBuy Public API key, subscription/key permissions and 1688 authorization. Image search must be permitted for the account.
- Commerce AI access on that same app, the `product:translate` scope for prepaid Credits, and a prepaid AI account created in Developer Center → AI Enhancement. The app finds the account from the key. AI Credits are separate from product API quota.
- Pricing currency matching the store, manual CNY rate, markup and desired default product status.
- HTTPS proxy/tunnel, host access and deployment secrets for self-hosting. No production deployment was performed.

## 5. Unresolved acceptance items and current limits

- **Live credentials were not supplied.** Complete the documented development-store acceptance flow: OAuth installation, real HIOBuy search/image/detail, real Shopify media, multi-option variants, cover/order and Draft/Active results. Current tests use a controlled GraphQL transport and synthetic fixtures.
- The runtime dependency audit is clean. The complete development dependency audit reports four moderate entries caused by one upstream `sprintf-js` advisory through Shopify CLI 4.9.4 → global-agent → roarr. No patched sprintf-js release was available in the inspected registry; do not blindly force a Shopify CLI downgrade. These tools are excluded from the Docker runtime. Details are in VERIFICATION.md.
- Docker CLI is installed locally, but its daemon was unavailable during initial validation. The image/Compose files are provided; a real Linux image build and restart/persistence smoke test remain pending unless the verification report records a later successful check.
- This synchronous demo limits imports to 100 selected variants, 3 dimensions and 50 selected images. More than 3 source dimensions cannot be drafted; larger selected sets need reducing or an asynchronous bulk implementation.
- Supplier stock is informational and Shopify inventory is untracked. There is no inventory/location sync, fulfillment, tax, shipping or procurement flow.
- Active is the product status, not a promise of sales-channel publication. Manage channels in Shopify Admin.
- Very slow Shopify file processing (over about 50 seconds) still needs **Finish import** on the draft or Safe retry in history. Failed/expired source media may need Re-edit as a new draft to exclude or replace the image.
- A lost fileCreate response can leave an unreferenced Shopify file. Automatic remote file garbage collection is not implemented.
- Do not manually change the deterministic handle until an unconfirmed import is resolved. A merchant rename in that interval can prevent handle-based recovery.
- Uploaded bytes live in SQLite, limited to 100 uploaded files per draft. Removed local media remains until draft deletion/uninstall; there is no dedicated cleanup UI.
- Source fields vary. Unsupported media hosts are omitted; contract mismatches fail visibly with request IDs. Real-account optional-field coverage still needs acceptance evidence.
- Draft history shows the 20 most recently edited unfinished drafts; imported records paginate. A full draft management screen and deletion UI are future work.
- One SQLite application replica is supported. No distributed job queue, scalable shared asset service or operational key rotation is implemented.

## 6. Recommended improvements

- Add account-specific contract fixtures captured and redacted from a real permitted test run.
- Add a durable publish worker/queue with progress milestones, cancellation and >100-variant asynchronous productSet support.
- Add guarded remote file cleanup, image retention/expiry handling and shared object storage for larger libraries.
- Add an operator recovery tool for externally renamed/deleted Shopify products and unusual ambiguous outcomes.
- Add dedicated Shopify sales-channel publishing only if explicitly required, with its own scopes and UI choices.
- Add currency presets, localized UI and keyboard arrow navigation between custom tab controls.
- Run the included GitHub Actions workflow for clean install, database migrations, tests, build, license inventory, secret scan, runtime audit and Docker build after intentionally publishing the repository. No remote CI has been run.
