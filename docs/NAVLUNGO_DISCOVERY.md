# Navlungo Discovery

## Purpose

This document captures docs-only discovery for a possible Navlungo domestic shipping provider integration.

No runtime provider code has been implemented. Navlungo is not added to live provider selection, shipment execution, return execution, or webhook handling.

Sources reviewed:

- `/Users/onur/Downloads/Create a Token _ API Docs - Domestic Navlungo.html`
- Official Domestic Navlungo introduction: `https://domestic-docs.navlungo.com/en`
- Official v2.1 Create Token: `https://domestic-docs.navlungo.com/en/v2-1/create-token`
- Official v2.1 Create Post: `https://domestic-docs.navlungo.com/en/v2-1/posts/create-post`
- Official v2.1 navigation entries for Create Return Post, Address Book, Carriers, and Barcode.

If behavior is not explicitly documented in those sources, it is marked as unknown.

## 1. Provider Identity

- Provider display name in this platform should be: `Navlungo`.
- The reviewed docs are Domestic Navlungo docs.
- Some official docs and response samples still reference Carrtell branding/infrastructure:
  - The introduction page displays a Carrtell logo.
  - Create Post sample response returns tracking/barcode URLs under `track.carrtell.co` and `barcode.carrtell.co`.
- Treat `Carrtell` as legacy/infrastructure naming only unless Navlungo confirms otherwise.
- Do not use `Carrtell` as the provider display name in our UI.

## 2. API Versions

Confirmed from official docs navigation:

- `v2` exists.
- `v2.1 (Beta)` exists.
- v2.1 docs include:
  - Create Token
  - Create Post
  - Create Return Post
  - Update Post
  - Check Post
  - Cancel Post
  - Check Post Multiple
  - Address Book
  - Carriers
  - Barcode

Unknown:

- Whether v2.1 Beta is production-ready.
- Whether v2 and v2.1 differ in endpoint base paths, payloads, response shapes, or production support guarantees.

Confirmed user-provided implementation target:

- API version target for the next PoC/planning step: `v2.1`.

## 3. Authentication

Confirmed from uploaded HTML and official v2.1 Create Token docs:

```text
POST auth/api
Content-Type: application/json
```

Required request fields:

- `username`
- `password`

Token response sample includes:

- `token_type`
- `expires_in`
- `access_token`
- `refresh_token`

Important contradiction:

- Docs text says generated token validity is 8 hours.
- Sample response shows `expires_in = 86400`.

Therefore:

- Exact token lifetime is unknown and needs confirmation.
- Token refresh behavior is unknown.
- Whether `refresh_token` can be used directly, and through which endpoint, is unknown.

## 4. Required Headers

Confirmed for protected endpoints:

```text
Authorization: Bearer <token>
Content-Type: application/json
```

Observed in Create Post examples:

```text
X-localization: en
```

Notes:

- `X-localization` appears in examples and should be treated as likely useful/expected for localized responses.
- Whether `X-localization` is strictly required is unknown.

## 5. Base URL

Official docs examples use `__APIURL__` placeholders.

Official introduction page lists v2 access URLs:

```text
Test Server: https://domestic-api-qa.navlungo.com/v2/
Live Server: https://domestic-api.navlungo.com/v2/
```

Unknown:

- Final production base URL for v2.1.
- Whether v2.1 uses the same base URLs as v2.
- Whether `__APIURL__` should include `/v2/`, `/v2-1/`, or another path for v2.1.

User-provided Render base URL plan:

- `NAVLUNGO_BASE_URL=https://domestic-api.navlungo.com/v2`

Implementation note:

- Confirm the final production base URL with Navlungo before runtime adapter work.
- Old Carrtell URLs should not be used as API base URLs unless Navlungo confirms them.

## 5.1. Environment Variables Planning

Likely required:

```text
NAVLUNGO_BASE_URL=https://domestic-api.navlungo.com/v2
NAVLUNGO_API_USERNAME=<Render secret>
NAVLUNGO_API_PASSWORD=<Render secret>
NAVLUNGO_DEFAULT_SENDER_ADDRESS_ID=55574
NAVLUNGO_DEFAULT_BARCODE_FORMAT=pdf-A6
```

Likely generated/runtime:

```text
NAVLUNGO_ACCESS_TOKEN
NAVLUNGO_REFRESH_TOKEN
```

Optional/unknown:

```text
NAVLUNGO_DEFAULT_CARRIER_ID=<unknown>
NAVLUNGO_PLATFORM=<unknown>
```

Notes:

- API version target is user-confirmed as `v2.1`.
- Sender address id for testing is user-confirmed as `55574`.
- Do not hardcode credentials.
- Do not add these env vars to runtime validation yet.
- Do not implement token refresh yet.
- Confirm any mismatch between v2.1 docs and the planned `/v2` base URL before adapter work.
- If live-only testing charges balance, use one manually selected test order only.

## 6. Confirmed Forward Shipment Endpoint

Confirmed from official v2.1 Create Post docs:

```text
POST post/create
Content-Type: application/json
```

Description:

- Creates a new shipment/post.
- Request body includes a top-level `posts` array.

Required/observed request fields:

- `platform`
- `posts[].reference_id`
- `posts[].carrier_id`
- `posts[].post_type`
- `posts[].cod_payment_type`
- `posts[].sender.name`
- `posts[].sender.phone`
- `posts[].sender.email`
- `posts[].sender.address`
- `posts[].sender.country`
- `posts[].sender.city`
- `posts[].sender.district`
- `posts[].sender.post_code`
- `posts[].recipient.name`
- `posts[].recipient.phone`
- `posts[].recipient.email`
- `posts[].recipient.address`
- `posts[].recipient.country`
- `posts[].recipient.city`
- `posts[].recipient.district`
- `posts[].recipient.post_code`
- `posts[].post.desi`
- `posts[].post.package_count`
- `posts[].post.price`
- `posts[].post.note`
- `posts[].barcode_format`
- `posts[].custom_data_1`
- `posts[].custom_data_2`
- `posts[].custom_data_3`
- `posts[].custom_data_4`

Notes:

- `reference_id` is documented as not required, but must be unique if sent. The sample validation error says already-registered `reference_id` is rejected.
- `carrier_id`, `post_type`, sender fields, recipient fields, `post.desi`, and `post.package_count` are documented as required.
- Phone examples specify format like `+90 532 123 45 67`.
- `post.price` is sent when `cod_payment_type` is `1` or `2`.

## 7. Confirmed Response Fields From Create Post Docs

The v2.1 Create Post sample response returns:

- `post_number`
- `reference_id`
- `tracking_url`
- `barcode_url`
- `post.carrier_id`
- `post.carrier_name`
- `post.post_type`
- `post.post_type_name`
- `post.cod_payment_type`
- `post.sender.*`
- `post.recipient.*`
- `post.post.desi`
- `post.post.package_count`
- `post.post.price`
- `post.post.note`
- `post.custom_data_1`
- `post.custom_data_2`
- `post.custom_data_3`
- `post.custom_data_4`
- `post.created_at`
- `post.updated_at`

Important:

- Create Post sample appears to return `tracking_url` and `barcode_url` directly.
- Sample `tracking_url` and `barcode_url` use Carrtell infrastructure domains; treat those as returned provider URLs, not provider display naming.

Unknown:

- Whether real production responses always include `tracking_url` and `barcode_url` immediately.
- Whether `barcode_url` is a direct PDF link for all `barcode_format` values.
- Whether response shape differs for multiple posts in one request.
- Whether `post_number` is the primary provider shipment id.

## 8. Carrier Model

Confirmed/observed from Create Post docs:

- `carrier_id` is required.
- `carrier_id = 1` may mean carrier settings automatic/by coverage area.
- Observed values:
  - `9` = Sürat Kargo
  - `10` = HepsiJet
  - `11` = Kolay Gelsin
- v2.1 docs include Carriers:
  - My Carriers
  - List Carriers

Unknown:

- Full carrier list response shape.
- Whether carrier IDs are stable per account/environment.
- Whether `carrier_id = 1` is safe for production automatic selection.
- Whether automatic selection can be constrained by sender warehouse, destination, or service level.
- Whether carrier eligibility should be fetched before Create Post.

## 9. Post Types

Observed values from Create Post docs:

- `post_type = 1`: Same Day Delivery
- `post_type = 2`: Standard Delivery
- `post_type = 3`: Return

The docs also state allowed values are `1`, `2`, `3`, `4`.

Unknown:

- Meaning of `post_type = 4`.
- Whether forward domestic shipments should normally use `2` or another value.
- Whether `post_type = 3` is sufficient for return flow or whether Create Return Post has additional contract rules.

## 10. Barcode / Label

Confirmed from Create Post docs:

`barcode_format` supports:

- `html`
- `pdf-A5`
- `pdf-A6`
- `pdf-A6Y`
- `pdf-A7`

Create Post docs state:

- For `barcode_format = html`, Base64 type will be returned.
- Create Post sample returns `barcode_url`.
- v2.1 docs include Barcode > Get Barcode.

Unknown:

- Exact Get Barcode endpoint request path and parameters.
- Whether Get Barcode returns raw file, URL, Base64, or JSON envelope.
- Whether `barcode_url` is returned for PDF formats only or all formats.
- Whether generated barcode is immediately available after Create Post.

## 11. Return / Reverse

Confirmed from docs navigation and Create Post notes:

- v2.1 docs include Create Return Post.
- `post_type = 3` appears to mean Return.
- The Create Return Post page exists in v2.1 navigation.

Unknown:

- Exact Create Return Post endpoint and request contract.
- Exact production return contract.
- Whether Create Return Post differs materially from Create Post.
- Whether return labels/tracking are returned immediately.
- Whether Shopify reverse-delivery tracking/PDF upload can be supported.
- Whether Navlungo supports customer-facing return shipment lifecycle/status separate from forward shipment lifecycle.

Implementation rule:

- Do not implement Navlungo return/reverse shipment yet.

## 12. Address Book / Warehouse Model

Confirmed from v2.1 docs navigation:

- Address Book exists.
- Address Book includes:
  - Create Address
  - Update Address
  - List Address
  - Address Detail
  - Delete Address

Likely implication:

- Address Book may support sender warehouses or reusable sender addresses.

Unknown:

- Exact Address Book request/response contract.
- Whether Address Book entries can be used directly as sender warehouses in Create Post.
- Multi-warehouse support.
- Whether one Navlungo account can hold multiple vendor sender addresses safely.
- Whether warehouse/address records can be scoped per marketplace vendor.

## 13. Tracking / Status

Confirmed from v2.1 docs navigation:

- Check Post endpoint exists.
- Check Post Multiple endpoint exists.
- Create Post sample returns `tracking_url`.

Unknown:

- Check Post request contract.
- Check Post response shape.
- Status lifecycle values.
- Whether status values are localized or stable enum-like values.
- Whether Check Post Multiple can be used for reconciliation/backfill.

## 14. Webhooks

Unknown:

- Whether Navlungo supports webhooks/status callbacks.
- Whether webhook signatures exist.
- Whether retries/idempotency keys exist.
- Whether webhook payloads include `post_number`, `reference_id`, status, tracking, and barcode fields.

No webhook implementation should be added until this is confirmed.

## 15. Comparison vs Kargonomi

Confirmed/observed differences:

- Navlungo Create Post uses text city/district fields in the request.
- Kargonomi requires numeric `buyer_state_id` and `buyer_city_id`, which caused lookup/network blockers.
- Navlungo may avoid Kargonomi's destination ID lookup blocker.
- Navlungo Create Post sample appears to return `tracking_url` and `barcode_url` directly.
- Navlungo docs include Create Return Post, Carriers, Address Book, and Barcode, which is a stronger discovery signal than Kargonomi for return, carrier, and label workflows.

Still unknown:

- IP allowlist requirements.
- Final v2.1 production base URL.
- Webhook/status callback support.
- v2.1 production readiness.
- Real Create Post response consistency.
- Return Post production behavior.

Do not recommend replacing Kargonomi or Try OTO based on this discovery alone.

## 16. Adapter Compatibility

Future implementation guidance:

- Existing shipping provider abstraction should be reused.
- Navlungo should remain a separate adapter.
- Provider key/display should be handled separately:
  - key: `navlungo`
  - display name: `Navlungo`
- Forward shipment adapter likely maps existing order/vendor/shipping data to `POST post/create`.
- Sender data could map from vendor warehouse config or Address Book after its contract is confirmed.
- Recipient data can likely map from Shopify shipping address because Navlungo accepts text city/district fields.
- Create Post response can likely normalize:
  - provider shipment id: `post_number`
  - tracking URL: `tracking_url`
  - label URL: `barcode_url`
  - carrier name: `post.carrier_name`
  - carrier id: `post.carrier_id`

Non-goals for this discovery step:

- No provider switch.
- No runtime implementation.
- No return/reverse implementation.
- No webhook implementation.
- No Kargonomi changes.
- No Try OTO changes.

## 16.1. Dormant Adapter Status

Current scaffold status:

- Provider constants exist:
  - key: `navlungo`
  - display name: `Navlungo`
- Optional env parsing exists for:
  - `NAVLUNGO_BASE_URL`
  - `NAVLUNGO_API_USERNAME`
  - `NAVLUNGO_API_PASSWORD`
  - `NAVLUNGO_DEFAULT_SENDER_ADDRESS_ID`
  - `NAVLUNGO_DEFAULT_BARCODE_FORMAT`
- A dormant Navlungo adapter scaffold exists.
- Runtime shipment execution is not enabled yet.
- Navlungo is not selectable as a live shipping provider.
- Create Post is not implemented or called.
- Return/reverse shipment is not implemented.
- Carrier selection, barcode fetch, Check Post, and webhook ingest are not implemented.

## 16.2. Auth Probe Status

Current diagnostics status:

- Admin-only diagnostics endpoint exists:
  - `GET /admin/diagnostics/navlungo/auth`
- The endpoint calls only:
  - `POST /auth/api`
- The endpoint returns sanitized diagnostics only:
  - base URL host/path
  - username/password presence booleans
  - auth HTTP status
  - response shape summary
  - nested `data` shape summary, when present
  - token presence booleans
  - token-like key location booleans (`root.access_token`, `data.access_token`, `data.token`)
  - `expires_in`, when present
  - fetch/network error diagnostics
- The endpoint never returns:
  - password
  - access token
  - refresh token
- The auth probe does not create shipments, write to the DB, or use customer/order data.

Observed auth response shape:

- Official docs still show token fields at the response root.
- Deployed diagnostics observed HTTP 200 with top-level keys:
  - `status`
  - `message`
  - `data`
- The exact live token field inside `data` must be confirmed by rerunning the sanitized auth diagnostic after deployment.
- Parser support now keeps the documented root shape and also accepts `data.access_token` or `data.token` if present.

## 16.3. Manual Create Post Probe Status

Current probe status:

- Manual-only command exists:
  - `npm run navlungo:create-post-probe`
- Guard required:
  - `NAVLUNGO_CREATE_POST_PROBE_CONFIRM=YES`
- Required env:
  - `NAVLUNGO_BASE_URL`
  - `NAVLUNGO_API_USERNAME`
  - `NAVLUNGO_API_PASSWORD`
  - `NAVLUNGO_DEFAULT_SENDER_ADDRESS_ID`
  - `NAVLUNGO_DEFAULT_BARCODE_FORMAT`
- The probe authenticates with:
  - `POST /auth/api`
- The probe creates exactly one clearly marked test post with:
  - `POST /post/create`
- The probe does not:
  - write to the app database
  - create a local shipment execution
  - sync Shopify fulfillment
  - retry automatically
  - register webhooks
  - enable Navlungo as a live shipping provider

Sanitized Create Post probe output includes only:

- HTTP status
- response top-level keys
- nested `data` keys, when present
- `post_number` presence/value
- `reference_id` presence/value
- `tracking_url` presence boolean
- `barcode_url` presence boolean
- carrier field presence
- provider error/message if returned

The output must never include:

- API username
- API password
- access token
- refresh token
- full customer PII

Response shape is still pending live probe execution and must be recorded after one intentional test-account run.

## 17. Critical Unknowns Before Implementation

- Final production base URL.
- Whether v2.1 Beta is safe for production.
- Whether IP allowlist is required for Render/cloud backend.
- API username/password availability.
- Token refresh strategy.
- Exact token lifetime.
- Carrier endpoint response shape.
- Create Post real response shape.
- Whether Create Post returns tracking and barcode URLs immediately in production.
- Barcode endpoint contract.
- Check Post response/status lifecycle.
- Return Post contract.
- Webhook support.
- Multi-vendor / marketplace model.
- Address Book warehouse mapping.
- Whether `carrier_id = 1` automatic carrier selection is safe for production.
- Whether all supported carriers require prior activation per account.

## 18. Provider Questions

1. Which API version should we use for production: v2 or v2.1?
2. What is the production base URL for the selected API version?
3. Is v2.1 Beta production-ready?
4. Is IP allowlist required for a Render/cloud backend?
5. Do you support return/reverse shipments in production?
6. Does Create Post return `tracking_url` and `barcode_url` immediately in production?
7. How do we fetch valid `carrier_id` values for our account?
8. Can `carrier_id = 1` be used for automatic/by coverage-area carrier selection in production?
9. Are webhooks/status callbacks supported?
10. Can one account manage multiple sender addresses/warehouses?
11. Can one account support a marketplace/multi-vendor flow?
12. What is the exact token lifetime, given the docs text says 8 hours but sample response says `expires_in = 86400`?
13. How should `refresh_token` be used, if at all?
14. What is the exact Get Barcode endpoint contract and response shape?
15. What does `post_type = 4` mean?
