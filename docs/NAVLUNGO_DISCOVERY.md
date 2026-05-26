# Navlungo Discovery

## Purpose

This document captures docs-only discovery for a possible Navlungo domestic shipping provider integration.

Navlungo forward shipment provider code is now enabled as a controlled PoC behind explicit provider selection and required configuration. Navlungo return/reverse shipment and webhook handling are not implemented.

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

Uploaded Navlungo HTML docs list the v2.1 access URLs:

```text
QA: https://domestic-api-qa.navlungo.com/v2.1/
Prod: https://domestic-api.navlungo.com/v2.1/
```

Implementation notes:

- This integration targets v2.1, so `NAVLUNGO_BASE_URL` must use the documented `/v2.1/` path.
- The old `/v2` base URL is deprecated/wrong for this integration and should be treated as a configuration problem.
- Runtime readiness warns when `NAVLUNGO_BASE_URL` still points at `/v2`.

Confirmed Render base URL plan:

- `NAVLUNGO_BASE_URL=https://domestic-api.navlungo.com/v2.1/`

Implementation note:

- Use QA only for explicit test/sandbox work: `https://domestic-api-qa.navlungo.com/v2.1/`.
- Old Carrtell URLs should not be used as API base URLs unless Navlungo confirms them.

## 5.1. Environment Variables Planning

Likely required:

```text
NAVLUNGO_BASE_URL=https://domestic-api.navlungo.com/v2.1/
NAVLUNGO_API_USERNAME=<Render secret>
NAVLUNGO_API_PASSWORD=<Render secret>
NAVLUNGO_DEFAULT_SENDER_ADDRESS_ID=55574
NAVLUNGO_DEFAULT_CARRIER_ID=9
NAVLUNGO_DEFAULT_BARCODE_FORMAT=pdf-A6
```

Likely generated/runtime:

```text
NAVLUNGO_ACCESS_TOKEN
NAVLUNGO_REFRESH_TOKEN
```

Optional/unknown:

```text
NAVLUNGO_PLATFORM=<unknown>
```

Notes:

- API version target is user-confirmed as `v2.1`.
- Sender address id for testing is user-confirmed as `55574`.
- Current Create Post probe target carrier is user-confirmed as `carrier_id = 9` for Sürat Kargo.
- Do not hardcode credentials.
- Do not add these env vars to runtime validation yet.
- Do not implement token refresh yet.
- `/v2` should not be used for this integration; use the documented `/v2.1/` base URL.
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
- New Navlungo shipments use a short customer-safe `reference_id` format:
  - `<storeShort>-<shopifyOrderNumber>-<shortUnique>`
  - `storeShort` is exactly 2 uppercase alphanumeric characters.
  - `shortUnique` is exactly 6 uppercase alphanumeric characters.
  - Example shape: `SP-1057-N8K2Q1`.
  - Internal allocation IDs, execution IDs, timestamps, and full vendor identifiers must not be embedded in new `reference_id` values.
  - Existing stored provider references are not migrated or rewritten.
- `carrier_id`, `post_type`, sender fields, recipient fields, `post.desi`, and `post.package_count` are documented as required.
- Runtime validation confirmed that Standard/Same Day shipments require the configured sender address number as `posts.0.sender.addressId`. A `422` validation error for `posts.0.sender.addressId` means the configured Navlungo sender address ID is missing, invalid, or was not sent in the real shipment payload.
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
- `carrier_id = 1` means Automatic / By Coverage Area according to the official Create Post table.
- Observed values:
  - `9` = Sürat Kargo
  - `10` = HepsiJet
  - `11` = Kolay Gelsin
- The official Create Post sample code uses `carrier_id = 7`, but `7` is not listed in the official carrier table. Do not use `7` unless Navlungo confirms it.
- Current PoC/manual Create Post probe default:
  - `NAVLUNGO_DEFAULT_CARRIER_ID=9`
  - fallback when env is missing: `9`
- v2.1 docs include Carriers:
  - My Carriers
  - List Carriers
- Re-review on 2026-05-21 found the official English page HTML for both carrier pages renders only the page heading and an empty paragraph:
  - `https://domestic-docs.navlungo.com/en/v2-1/carriers/my-carriers`
  - `https://domestic-docs.navlungo.com/en/v2-1/carriers/list-carriers`
- Exact carrier endpoint paths are therefore **unknown**.
- Previously attempted guessed paths returned `404`:
  - `GET /carrier/my-carriers`
  - `GET /carrier/getAll`
- Provider response said: `The route v2/carrier/my-carriers could not be found.`

Unknown:

- Exact My Carriers endpoint path.
- Exact List Carriers endpoint path.
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
- Re-review on 2026-05-21 found the official English `Barcode > Get Barcode` page renders only the heading and does not expose method/path/identifier requirements.

Unknown:

- Exact Get Barcode endpoint request path and parameters.
- Whether Get Barcode uses `post_number`, `reference_id`, or another identifier.
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
- Navlungo support guidance: Return Pickup (`POST /post/return`) `posts.0.recipient.addressId` should point to the warehouse/address number where the original forward shipment was created. The integration resolves this from the successful forward shipment context first, then falls back to explicit return recipient config (`navlungoReturnRecipientAddressId` / `NAVLUNGO_RETURN_RECIPIENT_ADDRESS_ID`) only when the original shipment address number is unavailable.

Likely implication:

- Address Book may support sender warehouses or reusable sender addresses.
- Return pickup recipient address IDs must be confirmed from the Navlungo account/address book before live create. Numeric local shape is necessary but does not prove the ID is valid for the authenticated account.

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
- Navlungo district is optional for the forward shipment PoC. If Shopify provides a district, it can be forwarded as text; if it is missing, the adapter must not block solely for district.
- Kargonomi requires numeric `buyer_state_id` and `buyer_city_id`, which caused lookup/network blockers.
- The shipment-only District override remains Kargonomi-specific because it feeds Kargonomi's numeric state/city lookup flow.
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

Non-goals for this forward PoC step:

- No return/reverse implementation.
- No webhook implementation.
- No Kargonomi changes.
- No Try OTO changes.

## 16.1. Forward Adapter PoC Status

Current adapter status:

- Provider constants exist:
  - key: `navlungo`
  - display name: `Navlungo`
- Env parsing exists for:
  - `NAVLUNGO_BASE_URL`
  - `NAVLUNGO_API_USERNAME`
  - `NAVLUNGO_API_PASSWORD`
  - `NAVLUNGO_DEFAULT_SENDER_ADDRESS_ID`
  - `NAVLUNGO_DEFAULT_BARCODE_FORMAT`
  - `NAVLUNGO_DEFAULT_CARRIER_ID`
- Navlungo can be selected as a live forward shipment provider when:
  - `SHIPPING_PROVIDER=navlungo`
  - global `SHIPPING_EXECUTION_ENABLED=true`
  - Navlungo base URL, username, and password are configured
  - vendor config selects `navlungo`
  - sender address ID and default desi are configured
- Forward adapter flow:
  - authenticate with `POST /auth/api`
  - create shipment with `POST /post/create`
  - immediately probe status with `GET /post/check/{postNumber}` when `post_number` is returned
- Runtime Create Post payload uses:
  - `carrier_id` from vendor metadata/env/default `9`
  - `post_type=2`
  - `sender: { addressId: <configured Navlungo sender address ID> }`
  - `barcode_format` from vendor metadata/env/default `pdf-A6`
  - no `cod_payment_type`
  - no `post.price`
- Current PoC requires a configured positive numeric sender address ID for readiness. Real shipment payloads use only `sender.addressId` and do not send full sender name, phone, email, or address fields.
- Response normalization maps:
  - `data.post_number` to provider shipment id
  - `data.carrier_tracking_code` or `post_number` to tracking number
  - `data.carrier_tracking_url` or `tracking_url` to tracking URL
  - `data.barcode` to label/barcode availability
  - `data.post.carrier_name`/`carrier_id` to carrier diagnostics
- Successful Create Post normalization is confirmed for the live/test response shape. `post_number`, `tracking_url`, and `barcode` are treated as valid provider success evidence even if the optional immediate Check Post enrichment fails.
- Return/reverse shipment is not implemented.
- Carrier list endpoints remain unknown.
- Separate Barcode endpoint remains unknown because the docs page did not expose an endpoint path.
- Webhook/status callback ingest is not implemented.

## 16.1.1. Cancel Post Status

Current cancel status:

- Navlungo forward shipment cancellation is implemented for existing forward shipment executions only.
- Runtime cancel flow uses:
  - authenticate with `POST /auth/api`
  - cancel with `POST /post/cancel`
  - request body: `{ "post_number": "<stored providerShipmentId>" }`
- Local cancellation is allowed only when:
  - provider is `navlungo`
  - stored provider shipment id / `post_number` exists
  - local shipment status is not `cancelled`
  - local shipment status is not `delivered`
- On provider cancel success:
  - local shipment status is persisted as `cancelled`
  - historical tracking and barcode/label evidence is retained for audit
  - cancel diagnostics and timestamp are persisted
- On provider `422` or `500`:
  - local shipment status is not changed to cancelled
  - sanitized validation fields/messages or provider tracking ID are persisted for diagnostics
- Shopify fulfillment cancellation/deletion is not implemented in this phase. Diagnostics explicitly set `shopifyFulfillmentCancelSyncSkippedReason=not_implemented`.
- Status-sync polling, return/reverse cancellation, and webhook cancellation handling remain out of scope.

## 16.1.2. Update Post Status

Current update status:

- Navlungo forward shipment update is implemented for existing forward shipment executions only.
- Runtime update flow uses:
  - authenticate with `POST /auth/api`
  - update with `POST /post/update`
  - request body includes stored `post_number`, `sender: { addressId }`, full recipient fields, `post.note`, `barcode_format`, and empty `custom_data_1..4`
- Local update is allowed only when:
  - provider is `navlungo`
  - stored provider shipment id / `post_number` exists
  - local shipment status is not `cancelled`
  - local shipment status is not `delivered`
  - shipment is a forward shipment, not return/reverse
- Update payload intentionally does not allow editing:
  - sender details beyond configured sender address id
  - carrier id
  - post type
  - price/COD
  - provider shipment id / `post_number`
- On provider update success:
  - local shipment remains active
  - refreshed tracking/barcode fields are persisted only if returned by Navlungo
  - update diagnostics and `navlungoUpdatedAt` are persisted
- On provider `422` or `500`:
  - local shipment remains active
  - sanitized validation fields/messages or provider tracking ID are persisted for diagnostics
- Shopify fulfillment update sync is not implemented in this phase. Diagnostics explicitly set `shopifyFulfillmentUpdateSyncSkippedReason=not_implemented`.

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
- Admin-only deployed diagnostics endpoint exists for Render environments without shell:
  - `POST /admin/diagnostics/navlungo/create-post-probe`
- Guard required:
  - `NAVLUNGO_CREATE_POST_PROBE_CONFIRM=YES`
- UI/API confirmation is also required:
  - request body `{ "confirm": "YES" }`
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
  - switch any live provider selection

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

Current observed deployed Create Post probe results:

- Auth succeeds.
- `POST /post/create` reaches Navlungo.
- Previous provider response returned `400` with: `No price list definition exists for your company and the selected carrier.`
- Most likely explanation: the old static probe `carrier_id` was not configured/valid for this Navlungo account.
- Operator confirmed first target carrier should be `NAVLUNGO_DEFAULT_CARRIER_ID=9` because this account should use Sürat Kargo.
- The manual Create Post probe now uses `NAVLUNGO_DEFAULT_CARRIER_ID` and defaults to `9` when the env var is missing.
- Invalid/non-numeric carrier ids block before provider calls.
- Normal manual probe payload omits `cod_payment_type` because COD is not being tested.
- Normal manual probe payload omits `post.price`; docs indicate price is sent when `cod_payment_type` is `1` or `2`.
- Static test sender/recipient phone values use the documented Turkish spacing style, for example `+90 532 123 45 67`.
- Later deployed Create Post probe succeeded with HTTP `201`.
- Observed success response shape:
  - top-level keys: `status`, `message`, `data`
  - data keys: `post_number`, `reference_id`, `tracking_url`, `barcode`, `post`
  - `post_number` present
  - `tracking_url` present
  - `barcode` field present
  - `barcode_url` missing
  - `post.carrier_id` and `post.carrier_name` present
  - provider message: `Your transaction will be successfully created if your wallet balance is sufficient.`
- This indicates Create Post can provide customer tracking immediately, but barcode handling must use the observed `barcode` field or a confirmed Barcode endpoint contract.
- Runtime shipment normalization accepts `tracking_url` as a valid shipment tracking signal and uses the observed `barcode` string as the current label/barcode source.

## 16.4. Check Post And Barcode Diagnostics Probe Status

Current probe status:

- Admin-only Check Post endpoint exists:
  - `POST /admin/diagnostics/navlungo/check-post`
- It authenticates first and then calls the exact documented Check Post endpoint:
  - `GET /post/check/{postNumber}`
- Check Post uses the `post_number` returned by the successful Create Post probe.
- Admin-only Barcode endpoint exists:
  - `POST /admin/diagnostics/navlungo/barcode`
- Barcode probe is gated by `post_number`, but it does not call Navlungo because the official Barcode > Get Barcode page does not expose an endpoint path or identifier contract.
- Barcode probe returns:
  - `barcodeEndpointPathKnown=false`
  - `skippedReason=barcode_endpoint_path_unknown`
- Confirmed by deployed diagnostics:
  - Check Post works at `GET /post/check/{postNumber}`
  - Check response `data` keys include `post_number`, `reference_id`, `tracking_url`, `carrier_post_number`, `carrier_tracking_code`, `carrier_tracking_url`, `barcode`, `post`, `status`, and `logs`
  - `barcode` is returned as a string field
- Pending verification:
  - whether the `barcode` string is always directly usable as the printable label/barcode content
  - exact Barcode endpoint path and required identifier

## 16.5. Carrier Diagnostics Probe Status

Current probe status:

- Admin-only endpoint exists:
  - `GET /admin/diagnostics/navlungo/carriers`
- The endpoint authenticates first with:
  - `POST /auth/api`
- Carrier endpoint paths are currently **unknown** because the official carrier pages do not expose method/path blocks in the page HTML.
- The endpoint does **not** call carrier-list paths until Navlungo confirms the exact paths.
- The probe does not:
  - call guessed carrier endpoints
  - call `POST /post/create`
  - write to the app database
  - create a local shipment execution
  - sync Shopify fulfillment
  - enable Navlungo as a live shipping provider

Sanitized carrier diagnostics output includes only:

- auth HTTP status and token presence boolean
- carrier endpoint path known yes/no
- skipped reason when paths are unknown
- carrier endpoint HTTP statuses, response shape summaries, counts, and safe carrier ids/names only after exact paths are confirmed
- provider messages/errors

The output must never include:

- API username
- API password
- access token
- refresh token
- customer/order data

## 16.6. Detailed Status Sync Status

Implemented for forward Navlungo shipments as a manual action only:

- Endpoint used:
  - `POST /post/check`
- Base URL behavior:
  - Detailed Check Post belongs to the v2.1 docs set.
  - If the configured `NAVLUNGO_BASE_URL` still ends in legacy `/v2`, only this detailed status sync request is resolved to the sibling `/v2.1/post/check` path.
  - Create Post, Update Post, and Cancel Post behavior is unchanged.
- Payload:
  - `post.post_number` from the stored Navlungo `providerShipmentId`
  - `limit = 1`
- The sync parses and stores safe shipment lifecycle fields:
  - provider status code/name
  - normalized operational status
  - tracking URL/code enrichment
  - barcode string when returned
  - carrier status/geo status/bad-address flag
  - safe log entries from `logs[]`
  - carrier barcode numbers from `carrierBarcodes[]`
- Timeline events are created from provider `logs[]` and deduped by provider action plus timestamp.
- Unknown provider status codes are preserved in diagnostics and are not over-mapped.
- Shopify delivery-state sync is intentionally not implemented in this phase:
  - `shopifyDeliveryStatusSyncSkippedReason = not_implemented`

No cron, webhook, or automatic background status sync has been added.

## 17. Critical Unknowns Before Implementation

- Final production base URL.
- Whether v2.1 Beta is safe for production.
- Whether IP allowlist is required for Render/cloud backend.
- API username/password availability.
- Token refresh strategy.
- Exact token lifetime.
- Carrier endpoint response shape.
- Whether Create Post and Check Post response shape is stable across all carriers.
- Barcode endpoint contract.
- Full production status lifecycle beyond the currently mapped Check Post Detailed status codes.
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
6. Does Create Post always return `tracking_url` and/or `barcode` immediately in production?
7. How do we fetch valid `carrier_id` values for our account?
8. What are the exact v2.1 carrier list endpoint paths?
9. Can `carrier_id = 1` be used for automatic/by coverage-area carrier selection in production?
10. Are webhooks/status callbacks supported?
11. Can one account manage multiple sender addresses/warehouses?
12. Can one account support a marketplace/multi-vendor flow?
13. What is the exact token lifetime, given the docs text says 8 hours but sample response says `expires_in = 86400`?
14. How should `refresh_token` be used, if at all?
15. What is the exact Get Barcode endpoint contract and response shape?
16. What does `post_type = 4` mean?
