# Verification report

Manual testing has imported a real 1688 product into Shopify. Commerce AI translation and image tools are part of the app and call HIOBuy's public Credits API. AI Credits are billed separately from product API quota. The sections below separate that manual result from automated checks. Automation does not re-run a live import or spend Credits.

## Release preparation — 2026-11-02

| Check | Result |
| --- | --- |
| Real 1688 product imported into Shopify | **Confirmed manually** by the maintainer on a configured Shopify app, HIOBuy production key, and development store. Not an automated test. Not every media, quota, Active, or sales-channel case was exercised. |
| Commerce AI translation and image processing | **Implemented** on public Commerce AI V1. Tasks are estimated, then billed in AI Credits. Text is applied after preview. Image replacement waits for confirmation. Automated tests do not call the live Credits API. Provider rate limits and missing result files remain possible and are surfaced in the editor. |
| `npm run typecheck` | Passed |
| `npm test` | Passed: 69 tests, 3 files, Vitest 5.0.5 |
| `npm run build` | Passed. React Router printed v8 future-flag advisories. Empty client chunks for resource routes are expected. |
| `npm run check:security` | Passed. One local commit was scanned. No Shopify secret, HIOBuy key, private key, or cloud credential pattern was found. `client_id` in that commit is empty. `.env` and SQLite files are not tracked. |
| `npm run check:licenses` | Passed for 408 locked package versions |
| `npm audit --omit=dev` | Passed after locking transitive `body-parser` at 1.20.9, inside Express's existing `~1.20.5` range. The previous 1.20.8 lock matched GHSA-27r3-jxmh-p828. |
| Docker image build and restart | **Not verified** in this pass |
| GitHub Actions on `hiobuy/shopify-1688-importer` | **Not verified** in this pass. The workflow file is present. This documentation update was not pushed. |

## Historical local checks — 2026-10-18

The notes below are the first local implementation pass. They predate the confirmed manual import. Where they say live import or publication had not happened, use the 2026-11-02 section instead.

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

## Still not verified

These items were not established by the 2026-10-18 local suite, and the 2026-11-02 pass did not turn them into automated results. The successful manual import does not close them.

- Signed webhook delivery, token refresh, and a full reinstall of a brand-new Shopify app created from this repository by someone else.
- Every HIOBuy quota, image-search permission, and optional product-field combination.
- Every media-processing delay, Shopify throttle, and ambiguous `productSet` outcome.
- Docker image build, container restart, and SQLite volume persistence.
- A green GitHub Actions run.

Use the acceptance checklist in SETUP.md on your own store. Do not treat synthetic fixtures as 1688 products.
