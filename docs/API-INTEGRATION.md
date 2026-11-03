# API integration

## HIOBuy public product APIs

Base origin: `https://api.hiobuy.com`. The server attaches `Authorization: Bearer <your key>` and requests `channel: "1688"`, `response_format: "standard"`. Only these documented endpoints are implemented:

| Operation                            | Endpoint                            | Request fields used                                      | Result consumed                                |
| ------------------------------------ | ----------------------------------- | -------------------------------------------------------- | ---------------------------------------------- |
| Keyword search / connection test     | `POST /v1/products/search`          | keyword, page, page_size=20, language=en, optional sort  | StandardProductList items/page/page_size/total |
| Detail / URL lookup / draft creation | `POST /v1/products/detail`          | id, language=en                                          | `{product: StandardProductDetail, request_id}` |
| Image upload                         | `POST /v1/products/upload-image`    | raw image_base64 (no data URL prefix)                    | image_id                                       |
| Image search                         | `POST /v1/products/search-by-image` | image_id, page, page_size=20, language=en, optional sort | StandardProductList                            |

Image search uploads once and reuses image_id for pagination. Browser and server enforce 4 MB images so base64 plus JSON remains below the documented 6 MB gateway request ceiling. The file MIME and signature must agree. Search responses are summary cards; full details load only when opened. Entering the editor re-fetches a current authoritative detail snapshot rather than trusting browser-supplied product JSON; this is an additional quota-bearing detail request.

CNY catalog prices are major yuan units. Prefer `promotion_amount`, including zero, then `display_amount`, then `original_amount`; missing values remain unavailable. Source variants use `sku_id` identity; option dimensions prefer `prop_id` and fall back to original names. Localized labels are editable display data, not guessed attribute semantics. Missing translations, supplier metadata, stock or media are not fabricated.

Each draft preserves the key's environment at creation. Sandbox and Production use the same origin; `hio_test_…` requests receive documented fixture/simulated data. Existing drafts do not become production data after key rotation. Active imports of Sandbox snapshots are blocked.

No request is automatically retried against HIOBuy: billable operations can consume quota even if a response is lost. The UI presents a curated message and bounded public code/request ID. Raw upstream error messages and credentials are not reflected. Subscription access, 1688 channel authorization, image-search entitlement and quota are decided by HIOBuy, not this demo.

## Shopify authentication

Use the official `@shopify/shopify-app-react-router` `authenticate.admin` context and its Admin GraphQL client. Session-token exchange and managed installation follow the official library. Store expiring offline access/refresh token fields in the official Prisma session schema, encrypted by the wrapper. There is no manually entered Admin access token and no client credential exposed beyond Shopify's public Client ID.

Required scopes: `read_products`, `write_products`, `read_files`, `write_files`. The UI reads granted scopes from `currentAppInstallation`. All app-owned database lookups use the session's shop. Uninstall and scope-change webhooks are authenticated before mutations.

## Shopify publishing — Admin GraphQL 2026-10

| Editor data                                      | Shopify mapping                                                                                   |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Title, safe HTML description, type, vendor, tags | ProductSetInput corresponding fields                                                              |
| Edited product attributes                        | Escaped Product details table appended to descriptionHtml                                         |
| Manual collection selections                     | collections: Shopify Collection GIDs; selector paginates manual collections                       |
| SEO description                                  | seo.description                                                                                   |
| Draft / Active                                   | status: DRAFT / ACTIVE                                                                            |
| Option names/values                              | productOptions with unique values and stable order, max 3 dimensions                              |
| Selected SKU combinations                        | variants[].optionValues with exact optionName/name pairs                                          |
| SKU and price                                    | variants[].sku and price in shop base currency                                                    |
| Selected ordered images                          | files[] referencing READY Shopify file IDs; first is the cover                                    |
| Variant image                                    | variants[].file with the same file ID present in product files[]                                  |
| Uploaded local image                             | stagedUploadsCreate → authenticated server byte upload → fileCreate                               |
| Supplier CDN image                               | fileCreate originalSource approved HTTPS URL; Shopify fetches and stores the file                 |
| Supplier stock                                   | Informational only; inventoryItem.tracked=false, no fake location or quantity                     |
| Product identity                                 | deterministic handle `hiobuy-1688-<draft UUID>`; resolve existing product and upsert by ID/handle |

Single-variant offers use the default Title / Default Title option when no source dimensions exist. Unknown costs do not get an invented price; every selected variant must have a positive valid price. All variants must share option dimensions in the same order, with unique selected combinations. The store currency must match the draft currency; rates may be manually configured and prices explicitly recalculated.

`fileCreate` is asynchronous. Successful file registration does not mean pixels are ready; check `fileStatus`. Cached file IDs are reused on retry. Failed file IDs are removed from the retry cache so a new attempt can replace them. A lost fileCreate response may leave an unused Shopify file; this cannot duplicate a product. The demo does not delete unconfirmed remote files automatically.

`productSet` list fields synchronize the complete snapshot, including selected variants and files. Frozen snapshots and a draft-specific handle prevent retry drift. Resolve existing variants by their option signature and preserve IDs when recovering. The returned Product ID is stored only after an acknowledged result. Partial errors and uncertain outcomes remain visible in history. Active status does not automatically publish to Online Store or any sales channel.

## AI provider boundary

Commerce AI V1 is a separate Credits account from product API quota. The merchant enters only the HIOBuy API key. The server calls `GET /v1/ai/account` with that key and no `X-Shop-Domain`, then caches the returned `shop` per Shopify installation and sends it as `X-Shop-Domain` on credits, estimate, execution and polling calls. The Shopify store domain is never used as a substitute. Saving a new key or removing the key clears the cache, so the account is found again. Each AI task stores the account it was created with; polling and retries of that task keep that account, its request body and its idempotency key. A zero balance still links the account, and Settings asks for a top-up. `AI_ACCOUNT_NOT_FOUND`, `INSUFFICIENT_SCOPE`, `AI_ACCESS_DISABLED`, `AI_TEST_KEY_NOT_ALLOWED`, `AI_ACCOUNT_INACTIVE`, `AI_ACCOUNT_AMBIGUOUS` and `401` each show a specific message with the request ID. Requests run only on the server and the key is never returned to the browser.

Public capabilities, and the editor actions that call them:

| Editor action | Feature key | Request |
| --- | --- | --- |
| Translate title | `text.translate` | `POST /v1/ai/text/translate`, scene `e-commerce-title`, format `text`, target `en` |
| Translate description | `text.translate` | same endpoint, scene `e-commerce-description`, format `html` |
| Translate attributes | `text.translate` | same endpoint, scene `e-commerce-cpv`, format `text`, names and values in order |
| Remove image text | `image.remove_chinese_text` | `POST /v1/ai/image/jobs`, type `remove_chinese_text` |
| Translate image text | `image.replace_chinese_text` | same endpoint, type `replace_chinese_text`, `target_language: en` |
| White background | `image.background` | same endpoint, type `white_background` |

`seo_description` and `image_optimization` stay in the editor model for older rows, and the server rejects them with `AI_FEATURE_NOT_PUBLIC`. There is no SEO generator and no general image-optimization call.

Each new task is estimated with `POST /v1/ai/credits/estimate` using the same text payload, or `count: 1` for one image. Estimation does not reserve Credits. If `can_afford` is false, no task is created. Execution sends a persisted `X-Idempotency-Key`. A lost response is retried with that same key and body. A `409` that includes `details.job_id` is polled; it does not start a replacement charge. `reconciliation` stays in progress. `provider_succeeded` is copied as soon as the result image can be downloaded, even if `job.status` is still `running`.

Text results are the returned `translations[].translated_text` values in input order. Image results are copied only from `https://api.hiobuy.com/v1/ai/assets/…` before they can be applied. Other result hosts are not fetched. Local uploads are not sent, because the image API accepts an approved HTTPS URL rather than bytes. Gateway host approval is decided by HIOBuy.

Balance and effective prices come from `GET /v1/ai/credits` and `GET /v1/ai/credits/pricing`. The UI shows `credits` and `enabled` for the four public features. Purchases stay in the developer center; this app has no payment or credit-grant call. Standard published prices are 2 Credits per 1,000 UTF-16 text units and 1 Credit per image, but the pricing response is authoritative.

Contract: [Commerce AI V1](https://hiobuy.com/en/api-docs/commerce-ai) and [openapi.json](https://api.hiobuy.com/openapi.json).

## Authoritative references

Contracts were inspected against the public pages/spec, not inferred from the commercial app:

- [HIOBuy OpenAPI](https://api.hiobuy.com/openapi.json)
- [Standard response models](https://hiobuy.com/en/api-docs/product-response-models)
- [Keyword search](https://hiobuy.com/en/api-docs/product-search)
- [Product detail](https://hiobuy.com/en/api-docs/product-detail)
- [Image upload](https://hiobuy.com/en/api-docs/product-upload-image)
- [Image search](https://hiobuy.com/en/api-docs/product-image-search)
- [Authentication](https://hiobuy.com/en/api-docs/authentication) and [Sandbox](https://hiobuy.com/en/api-docs/sandbox)
- [Shopify React Router package](https://shopify.dev/docs/api/shopify-app-react-router/latest)
- [productSet](https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/productSet), [ProductSetIdentifiers](https://shopify.dev/docs/api/admin-graphql/2026-10/input-objects/ProductSetIdentifiers)
- [ProductVariantSetInput](https://shopify.dev/docs/api/admin-graphql/2026-10/input-objects/ProductVariantSetInput), [FileSetInput](https://shopify.dev/docs/api/admin-graphql/2026-10/input-objects/FileSetInput)
- [fileCreate](https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/fileCreate), [stagedUploadsCreate](https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/stagedUploadsCreate)
