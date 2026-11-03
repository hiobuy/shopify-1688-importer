# Inspection and implementation plan — 2026-10-18

This file is the original plan. The app that was built is a working importer: real 1688 products can be imported into Shopify, and Commerce AI calls the public Credits API. HIOBuy no longer provides a separate Sandbox API. Prefer `hio_live_…`. Current behavior is documented in the README and [API-INTEGRATION.md](API-INTEGRATION.md). The notes below are historical and are not instructions to mock imports or AI.

The destination was empty and was not a Git repository. The supplied HTML v6 prototype was inspected for discovery, product modal, four editor tabs, jobs, settings, and history. Its sample-only behavior is a visual reference, not an instruction to simulate core imports. The old commercial project was inspected read-only: React Router 7, React, App Bridge, official Shopify authentication, Drizzle/D1, internal AI and billing. No old source, secrets, assets, database, or configuration has been copied.

Use React Router 7, TypeScript, official Shopify React Router auth/App Bridge, Prisma SQLite sessions and data, encrypted credentials, Node 24 Docker. The Node database adapter replaces the old platform-specific D1 deployment because the destination is empty and this demo must support independent Docker hosting. Follow the official Shopify MIT template for authentication scaffolding, retaining its notice.

1. Foundation: independent app configuration placeholders, official token exchange/managed installation, encrypted persistent sessions, authenticated routes and webhooks.
2. HIOBuy: fixed public API origin, Bearer API key, standard-format keyword search, base64 image upload + paginated image search, detail by validated 1688 identity. No upstream/private endpoints or automatic paid request retries. Persist source snapshots and editor drafts.
3. Publishing: pinned Shopify 2026-10 productSet upsert, deterministic handle, atomic import locks and immutable retry snapshots, product/option/variant/file mapping, collections and SKU pictures, authenticated staged upload for local media. Poll media readiness; record partial outcomes.
4. AI: provider contract covering 8 capabilities, persistent mock jobs with explicit simulation markings, deterministic failure/retry, preview and explicit apply. No speculative real adapter.
5. Verification: request/normalization, pricing, sanitization, tenancy, concurrency, ambiguous publishing, database round trips, UI behavior, build, dependency licensing and secret scan; write setup, architecture, API, deployment and TODO documentation.

## Public contract evidence

- https://api.hiobuy.com/openapi.json (retrieved for inspection)
- https://hiobuy.com/en/api-docs/product-response-models
- https://hiobuy.com/en/api-docs/product-upload-image
- https://hiobuy.com/en/api-docs/product-image-search
- https://hiobuy.com/en/api-docs/authentication
- https://shopify.dev/docs/api/shopify-app-react-router/latest
- https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/productSet
- https://shopify.dev/docs/api/admin-graphql/2026-10/input-objects/ProductSetIdentifiers
- https://shopify.dev/docs/api/admin-graphql/2026-10/input-objects/ProductVariantSetInput
- https://github.com/Shopify/shopify-app-template-react-router (MIT)

Product API fields have varying optional availability; never invent costs, inventory, translations, or supplier metadata. Existing subscription and channel authorizations apply. The shipped AI adapter calls public Commerce AI V1 instead of the mock-only approach first written here. `hio_test_…` drafts remain labeled and cannot be imported as Active. That is a local safeguard, not the discontinued HIOBuy Sandbox API.
