# Kargonomi Discovery

## Purpose

This document captures confirmed Kargonomi API behavior from the uploaded Word document for a future forward shipment PoC. It is documentation-only and does not enable runtime Kargonomi shipment creation, return shipment creation, provider switching, or changes to Try OTO.

Anything not explicitly documented in the uploaded Kargonomi API document is marked as unknown.

## 1. Confirmed Base URL And Authentication

Confirmed base URL:

```text
https://app.kargonomi.com.tr/api/v1
```

Confirmed request authentication:

```text
Authorization: Bearer <token>
```

Partner integrations:

- Kargonomi documentation states partner firms must also send `X-App-Key` with every request.
- Whether this integration is considered a partner integration requiring `X-App-Key` is unknown.

Unknown:

- Sandbox base URL.
- Token lifecycle / expiration.
- Token refresh or rotation behavior.
- OAuth support.
- API rate limits.
- Whether `X-App-Key` is required for this account.

## Environment Variables

Required / likely required:

```text
KARGONOMI_BASE_URL=https://app.kargonomi.com.tr/api/v1
KARGONOMI_API_TOKEN=<Render secret value>
```

Possibly required for partner integrations:

```text
KARGONOMI_APP_KEY=<unknown>
```

Notes:

- The user currently only has an API token.
- Kargonomi documentation states partner integrations must also send `X-App-Key`.
- Whether this integration requires `X-App-Key` is currently unknown.
- Do not implement runtime auth logic yet.
- Do not assume OAuth exists.
- Never hardcode secrets.
- Render env configuration will likely be required later.

## 2. Confirmed Shipment Endpoints

Confirmed shipment and related endpoints:

- `GET /shipments`
- `GET /shipments/{id}`
- `POST /shipments`
- `PUT /shipments/{id}`
- `PATCH /shipments/{id}`
- `DELETE /shipments/{id}`
- `GET /shipment-price-comparison/{id}`
- `POST /confirm-shipping-price`
- `POST /shipments/cancel`
- `GET /shipments/{id}/barcode?format=pdf`
- `GET /user/credit`
- `GET /states/{countryId?}`
- `GET /cities/{stateId}`
- `GET /webhooks`
- `GET /webhooks/{id}`
- `POST /webhooks`
- `PUT /webhooks/{id}`
- `DELETE /webhooks/{id}`

`GET /shipments` is paginated and the document states 50 shipments per page.

## 3. Confirmed Forward Shipment Lifecycle

Confirmed forward shipment candidate flow:

```text
POST /shipments
  -> GET /shipment-price-comparison/{id}
  -> POST /confirm-shipping-price
  -> GET /shipments/{id}/barcode?format=pdf
  -> shipment.updated webhook lifecycle
```

Confirmed `POST /shipments` shape:

- Top-level body contains `shipment`.
- A shipment can include one or more packages.
- The initial response example shows status `draft`.

Confirmed sender options:

- Sender fields can be provided directly.
- If `shipment.warehouse_id` is sent, sender address data is pulled from the warehouse.

Confirmed required buyer fields:

- `shipment.buyer_name`
- `shipment.buyer_phone`
- `shipment.buyer_address`
- `shipment.buyer_state_id`
- `shipment.buyer_city_id`

Confirmed required package fields:

- `shipment.packages`
- `shipment.packages.*.desi`

Unknown:

- Idempotency behavior for `POST /shipments`.
- Whether an external order reference can be supplied during create.
- Whether `ecommerce_provider_order_no` can be set by clients during create.
- Whether shipment creation alone has any billing side effect before price confirmation.

## 4. Confirmed Pricing Workflow

Confirmed price comparison endpoint:

```text
GET /shipment-price-comparison/{id}
```

Confirmed response includes:

- `shipping_provider_with_price[]`
- `shipping_provider_with_price[].id`
- `shipping_provider_with_price[].name`
- `shipping_provider_with_price[].slug`
- `shipping_provider_with_price[].price`
- `shipment`

Confirmed price confirmation endpoint:

```text
POST /confirm-shipping-price
```

Confirmed required fields:

- `shipment_id`
- `shipping_provider_id`

Confirmed behavior:

- `shipping_provider_id` must come from the price comparison response.
- `shipping_provider_id = -1` selects the lowest-price carrier automatically.

Unknown:

- Whether `POST /confirm-shipping-price` accepts JSON or only form data.
- Whether automatic carrier selection is operationally safe for this marketplace.
- Whether each warehouse can be constrained to a specific carrier.
- Whether price strings are always machine-parseable.

## 5. Confirmed Barcode Workflow

Confirmed barcode endpoint:

```text
GET /shipments/{id}/barcode?format=pdf
```

Confirmed behavior:

- The endpoint is used to retrieve barcode output for created shipments.
- The document states the barcode output is base64.
- The document states only PDF is currently supported.

Unknown:

- Barcode response exact JSON shape.
- Whether the response is raw base64, JSON with a field, or another envelope.
- Whether ZPL can be used despite only PDF being documented as currently supported.
- Whether barcode is available immediately after `POST /confirm-shipping-price` or only after status updates.

## 6. Confirmed Webhook Model

Confirmed webhook management endpoints:

- `GET /webhooks`
- `GET /webhooks/{id}`
- `POST /webhooks`
- `PUT /webhooks/{id}`
- `DELETE /webhooks/{id}`

Confirmed webhook creation fields:

- `name`
- `url`
- `event_type`
- `is_active`

Confirmed event:

- `shipment.updated`

Confirmed webhook payload envelope:

- `meta.webhook`
- `meta.idempotency_key`
- `meta.attempt_number`
- `meta.executed_at`
- `shipment`

Confirmed `shipment.updated` trigger:

- It fires when shipment information changes, including status, tracking code, package count, or price.

## 7. Confirmed Webhook Signature Verification

Confirmed webhook signature header:

```text
X-Webhook-Signature: <HMAC-SHA256>
```

Confirmed verification model:

- Use the raw request body.
- Generate HMAC-SHA256 using `secret_key`.
- Compare the generated signature with `X-Webhook-Signature`.
- Reject the request if the signature does not match.

Unknown:

- Where `secret_key` is configured or retrieved.
- Signature encoding, such as hex or base64.
- Whether any timestamp tolerance is expected.
- Whether webhook management responses include the webhook secret.

## 8. Confirmed Webhook Retry Policy

Confirmed retry behavior:

- Retries occur on non-2xx responses.
- Retry delays:
  - `60s`
  - `120s`
  - `300s`
  - `600s`
  - `1200s`
- Total of 5 additional attempts.

Confirmed no-retry status codes:

- `400`
- `401`
- `403`
- `404`
- `409`
- `410`
- `422`

## 9. Confirmed Shipment Status Codes

Confirmed shipment statuses:

- `draft`
- `ready`
- `webservice_order_failed`
- `webservice_order_creating`
- `webservice_order_created`
- `webservice_checking_shipment`
- `webservice_shipment_started`
- `webservice_shipment_delivered`
- `webservice_shipment_not_delivered`
- `webservice_shipment_returning`
- `webservice_shipment_missing`
- `cancelled`
- `request_for_cancellation`

Draft local mapping:

| Kargonomi status | Draft local meaning |
| --- | --- |
| `draft` | Draft shipment created, carrier not finalized |
| `ready` | Ready for processing |
| `webservice_order_failed` | Provider order creation failed |
| `webservice_order_creating` | Provider order creation in progress |
| `webservice_order_created` | Provider order created |
| `webservice_checking_shipment` | Shipment record being checked |
| `webservice_shipment_started` | In transit / delivery process started |
| `webservice_shipment_delivered` | Delivered |
| `webservice_shipment_not_delivered` | Not delivered |
| `webservice_shipment_returning` | Returning |
| `webservice_shipment_missing` | Missing/lost |
| `cancelled` | Cancelled |
| `request_for_cancellation` | Cancellation requested |

Unknown:

- Which statuses guarantee tracking code presence.
- Which statuses guarantee barcode availability.
- Whether `webservice_shipment_returning` represents carrier return-to-sender only or customer returns too.

## 10. Provider-Selection Workflow

Confirmed workflow:

1. Create shipment.
2. Fetch price options using the shipment id.
3. Confirm a selected `shipping_provider_id`.

Confirmed provider option fields:

- `id`
- `name`
- `slug`
- `price`

Documented carrier examples:

- Kolay Gelsin
- Aras Kargo
- Sürat Kargo
- Hepsijet
- PTT Kargo
- Otomatik

Unknown:

- Whether each warehouse can use a different carrier.
- Whether carrier selection should be user-selected, admin-configured, or automatic.
- Whether out-of-service options are always represented as strings like `Hizmet Dışı Bölge`.

## 11. Marketplace / Multi-Warehouse Unknowns

The following are unknown:

- Multi-vendor marketplace account model.
- Whether each vendor needs a separate Kargonomi account/token.
- Whether one account can hold warehouses for multiple vendors safely.
- Whether each warehouse can use a different carrier.
- Whether Kargonomi supports one shipment with packages from multiple warehouses.
- Whether Kargonomi warehouse ids should be stored per vendor, per store, or per allocation.

## 12. Return / Reverse Shipment Unknowns

The following are unknown:

- Return shipment creation API.
- Reverse barcode / return label endpoint.
- Reverse shipment workflow.
- Return tracking lifecycle.
- Return webhook events.
- Shopify reverse-delivery compatibility.

No return or reverse shipment implementation should be planned beyond discovery until these are confirmed by Kargonomi.

## 13. Adapter Compatibility Vs Existing Provider Abstraction

Existing provider abstraction should be preserved.

Kargonomi should later be added only as a new adapter. The existing Try OTO and Kargo Entegrator behavior should remain unchanged.

Likely reusable:

- Existing shipment execution orchestration.
- Existing provider adapter result shape.
- Existing response snapshot diagnostics.
- Existing webhook ingestion and idempotency concepts.
- Existing tracking/label/status display surfaces.

Potential adapter requirements:

- The Kargonomi adapter likely needs to orchestrate multiple provider API calls inside forward create:
  - `POST /shipments`
  - `GET /shipment-price-comparison/{id}`
  - `POST /confirm-shipping-price`
  - `GET /shipments/{id}/barcode?format=pdf`
- The adapter needs safe diagnostics for each step.
- Existing webhook ingestion system should likely be reused.
- Existing dashboard should not be redesigned.
- Existing return orchestration should remain untouched until reverse flow is confirmed.

Unknown:

- Whether Kargonomi status refresh should use `GET /shipments/{id}` only or rely primarily on webhooks.
- Whether barcode retrieval should happen during create or during a later refresh.
- Whether shipping cost should be parsed from price comparison, confirm response, shipment detail, or webhook.

## 14. Comparison Vs Try OTO

- Try OTO forward shipment flow is already operational.
- Try OTO return tracking MVP exists.
- Kargonomi forward flow appears compatible with the existing provider abstraction, but it is a multi-step forward flow rather than a simple one-call create.
- Kargonomi reverse/return flow remains unknown.
- Kargonomi requires city/district numeric ids, while Try OTO accepts freer customer city/district text in the current implementation context.
- Kargonomi barcode PDF retrieval is documented as base64, but exact response shape is unknown.
- Try OTO return tracking has already been validated in the current platform; Kargonomi return tracking is unknown.
- Do not recommend replacing Try OTO yet.

## 15. Migration Risk Analysis

Primary risks:

- Missing `X-App-Key` requirement could block runtime requests.
- Unknown sandbox behavior may make safe PoC setup harder.
- Unknown token lifecycle could affect Render secret management and recovery.
- Kargonomi requires numeric state/city ids, so Shopify address text needs a robust mapping layer.
- Unknown `POST /shipments` idempotency behavior creates duplicate-shipment risk.
- Price confirmation is a separate step and could create partial draft shipments if later steps fail.
- Barcode response exact JSON shape is unknown.
- Webhook signature details are incomplete until `secret_key` source and signature encoding are confirmed.
- Multi-vendor warehouse/account model is unknown.
- Return/reverse flow is unknown, so Kargonomi cannot replace Try OTO return operations yet.

Migration posture:

- Prepare Kargonomi as an additional provider adapter only.
- Keep Try OTO as the working operational provider.
- Run a forward-only PoC before any production switch.
- Do not implement return automation until Kargonomi return/reverse contract is confirmed.
- Do not redesign dashboard or provider abstractions for Kargonomi.
