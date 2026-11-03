# Verification report — 2026-10-18

This report separates local implementation evidence from live account acceptance. Shopify and HIOBuy credentials were not supplied; the user explicitly selected placeholder app configuration.

## Completed local checks

| Check                                     | Result                                                                                                                           |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Clean dependency installation             | `npm ci --no-audit --no-fund` passed using the committed lockfile                                                                |
| Fresh database                            | Created a new isolated SQLite file, generated Prisma Client and applied the committed migration successfully                     |
| TypeScript                                | `npm run typecheck` passed                                                                                                       |
| Unit / database / UI integration tests    | `npm test`: **53 tests passed across 3 files**, Vitest 5.0.5                                                                     |
| Production build                          | `npm run build` passed for client and SSR bundles                                                                                |
| Actual HTTP authentication smoke          | `npm run test:smoke` passed against the built Node server                                                                        |
| Browser interaction and responsive checks | `npm run test:visual` passed at 1440 × 1000 and 390 × 844 using actual page components and explicitly labeled synthetic fixtures |
| Secret/private-integration patterns       | `npm run check:security` passed; no app reference to private auth or private endpoints; the new repository has 0 commits         |
| License metadata                          | `npm run check:licenses` passed for **408 locked package versions**; Shopify MIT attribution retained                            |
| Runtime dependency audit                  | `npm audit --omit=dev --registry=https://registry.npmjs.org`: **0 vulnerabilities**                                              |
| Shopify CLI invocation                    | The installed CLI reports 4.9.4                                                                                                  |

Tests cover public request format, CNY pricing and currency precision, response-model rejection, source option ordering, escaped edited attributes, safe URLs/HTML/uploads, encrypted settings and session tokens, shop/draft ownership, optimistic save conflicts, Commerce AI estimate/idempotency/asset copy behavior, SKU/picture mapping, simultaneous publication, media processing, frozen retries and a response lost after remote product creation. Local uploaded bytes are verified against a controlled Shopify staged-upload transport.

The HTTP smoke uses invalid synthetic session tokens: protected app/settings/history/jobs/assets and mutation endpoints return 401. Unsigned webhooks return 400 through the official verifier. The public login page returns 200. It starts and stops its own local process and creates no external products.

The browser harness runs only from tests/visual and is absent from production routes. It intercepts API/image requests with synthetic fixtures, checks editor data across tab changes and checks page overflow. Four editor panels, discovery, Settings and History have screenshots in ignored `artifacts/ui/`; no browser page errors were reported. This is UI evidence, not live Shopify installation evidence.

React Router prints advisory messages about future v8 flags and empty resource-route chunks during a successful build. These are not current build failures.

## Dependency follow-up

The full development-tree audit reports **4 moderate entries, 0 high and 0 critical**. All four entries trace to one [sprintf-js advisory](https://github.com/advisories/GHSA-hp3w-g68c-fv3c) through Shopify CLI 4.9.4 → global-agent → roarr → sprintf-js. The inspected registry has no patched sprintf-js release. This is retained as an upstream development-tool issue, rather than forcing an older Shopify CLI outside the selected toolchain. The Docker runtime prunes all development dependencies, including Shopify CLI.

Earlier audit findings in test/build tooling and Prisma's config dependency were addressed: Vitest 5.0.5, esbuild 0.28.2, and deepmerge-ts 8.0.0. The lockfile overrides are explicit. Fresh migration, tests and build were rerun with those versions. Revisit the Prisma override when an appropriate upstream release includes the patched dependency, and review new audits before publishing.

Dependency inventory is metadata-based, not a legal opinion. Upstream LICENSE/NOTICE files remain in their packages. The local scanner is a bounded pattern check, not a guarantee against every possible secret. No commercial Git history was copied into this new repository.

## Not verified externally

- Actual installation/token exchange, refreshed offline sessions and signed webhook delivery for the user's independent Shopify app.
- A real HIOBuy account's subscription, 1688 authorization, image-search permissions, optional product fields, request IDs and quota behavior.
- A real development-store product with remote images, uploaded PNG/JPEG/WebP, multiple options, variant image association, cover/order and Draft/Active status.
- Real media processing latency, Shopify throttling and live ambiguous-outcome recovery.
- Docker Linux image build, container startup, restart and persistent volume behavior: the local Docker CLI is present but its daemon was unavailable.
- GitHub Actions: the workflow is included but the repository has not been pushed, published or run remotely.

Use the acceptance checklist in SETUP.md after configuring legal credentials. The commercial project was left unchanged. No Git commit, push, public repository creation or production deployment was performed.
