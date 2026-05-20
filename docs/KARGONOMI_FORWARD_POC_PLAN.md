# Kargonomi Forward Shipment PoC Plan

## Scope

This plan now tracks the forward-only Kargonomi implementation. It does not implement return shipment creation, reverse labels, Shopify reverse delivery, production switching, dashboard redesign, or Try OTO removal.

## Sources Reviewed

- `/Users/onur/Desktop/Cv and Jobs for mac/companies/lomography/Kargonomi API .docx`
- `docs/SHOPIFY_DISCOVERIES.md`
- `backend/src/modules/shipping/shipping-provider.adapter.ts`
- `backend/src/modules/shipping/shipping-execution.service.ts`
- `backend/src/modules/shipping/shipping-execution.types.ts`

`docs/KARGONOMI_DISCOVERY.md` now contains the broader Kargonomi contract discovery summary.

## Confirmed API Basics

- Base URL: `https://app.kargonomi.com.tr/api/v1`
- Authentication: `Authorization: Bearer <token>`
- `X-App-Key` is confirmed not required for this account.
- The uploaded Word document does not define token issuance, token lifetime, refresh behavior, sandbox URL, or production-vs-sandbox environment separation. These remain unknown.

## Environment Variables

Required / likely required:

```text
KARGONOMI_BASE_URL=https://app.kargonomi.com.tr/api/v1
KARGONOMI_API_TOKEN=<Render secret value>
KARGONOMI_DEFAULT_WAREHOUSE_ID=<optional fallback, e.g. 112668 for testing>
```

Optional / not required for this account:

```text
KARGONOMI_APP_KEY=<optional>
```

Notes:

- The user currently only has an API token.
- Kargonomi documentation states partner integrations must also send `X-App-Key`, but this account does not require it.
- Multi-warehouse support is confirmed.
- Testing warehouse IDs: `112668`, `112666`.
- Do not hardcode warehouse IDs into business logic; use vendor config or `KARGONOMI_DEFAULT_WAREHOUSE_ID`.
- Do not assume OAuth exists.
- Never hardcode secrets.
- Render env configuration will likely be required later.

## Exact Forward Shipment Candidate Flow

The uploaded Kargonomi document supports this candidate forward shipment flow:

1. Create draft shipment:
   `POST /shipments`
2. Fetch carrier price options:
   `GET /shipment-price-comparison/{id}`
3. Confirm selected carrier price:
   `POST /confirm-shipping-price`
4. Fetch barcode PDF:
   `GET /shipments/{id}/barcode?format=pdf`
5. Receive lifecycle updates through:
   `shipment.updated` webhook

The document also includes `GET /shipments`, `GET /shipments/{id}`, `PUT /shipments/{id}`, `PATCH /shipments/{id}`, `DELETE /shipments/{id}`, `POST /shipments/cancel`, warehouse registration, state/city lookup, user credit lookup, and webhook management endpoints. Those are outside the minimal forward PoC except where needed for address ID discovery or diagnostics.

## Request Mapping

Kargonomi `POST /shipments` expects a top-level `shipment` object.

### Internal Order / Shipment Fields

- Internal allocation id: no documented Kargonomi field. Candidate use as internal-only diagnostics. Unknown whether it should map to `ecommerce_provider_order_no`.
- Shopify order number: possible candidate for `ecommerce_provider_order_no`, but the create request example does not include this field. Unknown.
- Package count: derived from `shipment.packages.length`.
- Shipment content: can map to `shipment.packages.*.content` if available.
- Internal package barcode/reference: can map to `shipment.packages.*.barcode` if available. Optional in the document.

### Vendor Warehouse / Sender Fields

The document supports two sender approaches:

- Send `shipment.warehouse_id`; Kargonomi pulls sender address data from the warehouse.
- Or send sender fields directly.

Confirmed sender fields:

- `shipment.sender_name`
- `shipment.sender_email`
- `shipment.sender_tax_number`
- `shipment.sender_tax_place`
- `shipment.sender_phone`
- `shipment.sender_address`
- `shipment.sender_state_id`
- `shipment.sender_city_id`
- `shipment.warehouse_id`

When `warehouse_id` is sent, the document marks sender fields as not required. For a multi-vendor platform, the safer PoC shape is to use a vendor warehouse mapping to `shipment.warehouse_id` when available.

Confirmed account-specific notes:

- Multi-warehouse support is available.
- Testing warehouse IDs `112668` and `112666` exist.

Unknowns:

- Whether each vendor warehouse must first be created in Kargonomi.
- Whether one Kargonomi account can safely represent multiple vendor warehouses.
- Whether warehouse ownership/scoping is enforced by Kargonomi.
- Whether a Kargonomi warehouse can be constrained to a carrier.

### Buyer Address Fields

Confirmed required buyer fields:

- `shipment.buyer_name`
- `shipment.buyer_phone`
- `shipment.buyer_address`
- `shipment.buyer_state_id`
- `shipment.buyer_city_id`

Confirmed optional buyer fields:

- `shipment.buyer_email`
- `shipment.buyer_tax_number`
- `shipment.buyer_tax_place`

Shopify mapping notes:

- Shopify customer/order address data must stay backend-only according to `docs/SHOPIFY_DISCOVERIES.md`.
- Buyer name can be composed from existing Shopify shipping/customer name fields when present.
- Buyer phone can map from existing Shopify shipping/customer/billing phone fields if available.
- Buyer address can map from existing Shopify shipping address lines.
- Kargonomi requires numeric city/state IDs, not city/district free text. Mapping from Shopify city/district text to Kargonomi `state_id` and `city_id` requires either stored vendor/admin mapping or a lookup against `/states/{countryId?}` and `/cities/{stateId}`. Exact matching rules are unknown.

### Package / Desi Fields

Confirmed package fields:

- `shipment.packages` is required and must contain at least one item.
- `shipment.packages.*.desi` is required and must be numeric and greater than zero.
- `shipment.packages.*.content` is optional.
- `shipment.packages.*.barcode` is optional.

Current internal `defaultDesi` / package weight configuration can likely supply `desi`, but Kargonomi requires `desi`; weight-specific fields are not shown in the shipment create request.

## Response Mapping

Confirmed response fields from shipment, price comparison, confirm, barcode, and webhook examples:

- Kargonomi shipment id: `id`
- Kargonomi type: `type`
- Webservice order id: `shipping_webservice_order_id`
- Barcode: `shipping_webservice_barcode`
- Tracking code: `shipping_webservice_tracking_code`
- Carrier/provider name: `shipping_provider_name`
- Carrier/provider slug: `shipping_provider_slug`
- Barcode order id: `barcode_of_order_id`
- Shipment status: `status`
- Human status label: `status_label`
- Webservice created timestamp: `shipping_webservice_created_at`
- External/ecommerce order number: `ecommerce_provider_order_no`
- External/ecommerce provider: `ecommerce_provider`
- Package count: `package_count`
- Estimated price: `estimated_price`
- Real price: `real_price`
- Extra shipping price: `extra_shipping_price`
- Price difference: `pricing.price_diff`
- Delivery date to shipment office: `delivery_date_to_shipment_office`
- Carrier customer delivery date: `shipping_provider_customer_delivery_date`
- Sender object: `sender`
- Buyer object: `buyer`
- Warehouse object: `warehouse`
- Shipment package rows: `shipment_packages`
- Carrier price options: `shipping_provider_with_price[]`
- Price option fields: `id`, `name`, `slug`, `price`

Barcode endpoint:

- `GET /shipments/{id}/barcode?format=pdf` returns barcode output in base64 format according to the document.
- The document states only PDF is currently supported.
- Exact barcode endpoint response JSON shape is unknown because no response example is included.

## Price Confirmation

`POST /confirm-shipping-price` requires:

- `shipment_id`
- `shipping_provider_id`

The `shipping_provider_id` must come from `GET /shipment-price-comparison/{id}`.

Special documented behavior:

- `shipping_provider_id = -1` means Kargonomi automatically chooses the lowest-price carrier.

Unknowns:

- Whether automatic selection is acceptable for production operations.
- Whether a specific carrier can be configured per vendor/warehouse.
- Whether failed or out-of-service price options should be filtered client-side or server-side.
- Whether `POST /confirm-shipping-price` expects form data only, as shown in the curl example, or also accepts JSON.

## Status Mapping Draft

Confirmed Kargonomi status codes from the document:

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
| `webservice_shipment_not_delivered` | Delivery failed / not delivered |
| `webservice_shipment_returning` | Returning |
| `webservice_shipment_missing` | Missing/lost |
| `cancelled` | Cancelled |
| `request_for_cancellation` | Cancellation requested |

Unknowns:

- Whether `ready` implies a billable carrier label has been created.
- Whether `webservice_order_created` always includes tracking/barcode.
- Whether `webservice_shipment_returning` is only carrier-initiated return-to-sender or also customer returns.
- Whether cancellation can be requested through our platform safely during all pre-carrier states.

## Webhook Lifecycle

Confirmed webhook event type:

- `shipment.updated`

Confirmed webhook envelope fields:

- `meta.webhook.name`
- `meta.webhook.url`
- `meta.webhook.event_type`
- `meta.webhook.is_active`
- `meta.idempotency_key`
- `meta.attempt_number`
- `meta.executed_at`
- `shipment`

Confirmed webhook signature header:

- `X-Webhook-Signature: <HMAC-SHA256>`

Confirmed signature method:

- Use raw payload body.
- Compute HMAC-SHA256 with `secret_key`.
- Compare with `X-Webhook-Signature`.
- Reject if it does not match.

Unknowns:

- Where `secret_key` is configured or retrieved.
- Whether the HMAC digest is hex, base64, or another encoding.
- Whether signatures include any timestamp protection beyond `meta.executed_at`.

Confirmed retry behavior:

- Non-2xx responses are retried.
- Retry delays: `60s`, `120s`, `300s`, `600s`, `1200s`.
- Total of 5 additional attempts.
- Retries are not sent for `400`, `401`, `403`, `404`, `409`, `410`, `422`.

## Adapter Compatibility Notes

Existing adapter shape:

- `createShipment(input)` returns provider shipment id, tracking number, tracking URL, label URL, status, shipping cost, VAT, currency, and response snapshot.
- `getShipmentStatus(providerShipmentId)` exists for status refresh.
- Current orchestration persists request/response snapshots and timeline information.

Likely reusable:

- Request snapshot diagnostics.
- Provider response snapshot storage.
- Timeline event pattern.
- Tracking/label/status normalization.
- Shipping cost fields.
- Webhook idempotency concepts.

Implemented / likely adjusted adapter behavior:

- Kargonomi forward create is a multi-step create/price/confirm/barcode flow rather than a single create call.
- The adapter records internal step diagnostics:
  - create shipment called/succeeded
  - price comparison called/succeeded
  - selected shipping provider id
  - confirm shipping price called/succeeded
  - barcode fetch called/succeeded
- Preferred `shipping_provider_id` can be supplied through provider metadata; otherwise `-1` requests automatic cheapest selection.
- Warehouse and Kargonomi city/state ID mappings are required before provider execution.
- Webhook signature verification must be implemented with raw-body access before enabling ingest.

Unknown fields needing provider or PoC confirmation:

- Sandbox base URL.
- Token issuance and rotation.
- Whether other Kargonomi accounts require `X-App-Key`.
- Exact barcode PDF response shape.
- Whether tracking URL is returned anywhere.
- Whether `shipping_webservice_tracking_code` is assigned immediately after confirmation or later by webhook.
- Whether `shipping_webservice_barcode`, `barcode_of_order_id`, and package `barcode` are semantically distinct.
- Whether Kargonomi supports idempotency keys on create/confirm requests.
- Whether `ecommerce_provider_order_no` can be set on create.
- Whether one shipment can contain packages for multiple warehouses.

## Adapter Scaffold Status

- Kargonomi forward execution is implemented through the existing provider abstraction.
- It is selectable only through explicit `SHIPPING_PROVIDER=kargonomi` plus required Kargonomi env.
- It is exposed through existing provider diagnostics when Kargonomi env/provider selection is present.
- It calls Kargonomi APIs only from the explicit forward shipment execution path.
- It implements price comparison, price confirmation, and defensive barcode fetching for forward shipment only.
- It does not implement webhook ingest, return shipment creation, reverse labels, or cancellation.
- Return and reverse shipment methods remain unsupported.
- `KARGONOMI_APP_KEY` is optional/not required for this account.
- `KARGONOMI_DEFAULT_WAREHOUSE_ID` is a fallback only; vendor warehouse config remains preferred.

## Mapping Scaffold Status

- Isolated Kargonomi request/response mapping helpers exist for future PoC tests.
- The create-payload helper covers documented sender fields, `warehouse_id`, buyer fields, and package `content` / `barcode` / `desi`.
- The response parser captures documented shipment id, webservice order id, barcode, tracking code, provider name/slug, status, status label, pricing fields, and shipment packages.
- The status mapper covers documented Kargonomi statuses.
- `webservice_shipment_returning` is intentionally not treated as confirmed return shipment support.
- Unknown/unrecognized provider statuses map to a safe pending state.
- These helpers do not call Kargonomi APIs.
- These helpers are wired only into Kargonomi forward shipment execution.
- Return/reverse remains unsupported.
- Kargonomi is available only through explicit live `SHIPPING_PROVIDER=kargonomi` selection and required env.

## HTTP Client Scaffold Status

- An isolated Kargonomi HTTP client scaffold exists near the dormant adapter.
- It supports documented forward endpoint methods for later manual/sandbox PoC work:
  - draft shipment create
  - shipment price comparison
  - shipping price confirmation
  - shipment barcode PDF fetch
  - shipment detail fetch
- Tests use mocked `fetch` only.
- The client is wired only into explicit Kargonomi forward shipment execution.
- There is no default Kargonomi provider switch and no Try OTO behavior change.
- Barcode response shape remains unknown and is treated as raw provider response data.
- Kargonomi return/reverse remains unsupported.

## Manual Probe Status

- A manual development-only probe script exists for future intentional Kargonomi forward-flow testing.
- Script command:
  - `npm run backend:kargonomi:probe`
- The script is not called automatically.
- The script is not wired into order/shipment orchestration.
- The script does not write to the application database.
- The script does not sync Shopify, create fulfillments, upload labels, or switch providers.
- The script uses clearly fake/test shipment data only.
- Console output is sanitized and must not print API tokens or app keys.
- This probe can create a provider draft shipment when intentionally confirmed.

Required env vars:

```text
KARGONOMI_PROBE_CONFIRM=YES
KARGONOMI_API_TOKEN=<Render/local secret value>
```

Optional env vars:

```text
KARGONOMI_BASE_URL=https://app.kargonomi.com.tr/api/v1
KARGONOMI_APP_KEY=<optional>
KARGONOMI_PROBE_CONFIRM_PRICE=YES
KARGONOMI_PROBE_SHIPPING_PROVIDER_ID=<id from price comparison>
KARGONOMI_PROBE_FETCH_BARCODE=YES
```

Default behavior:

- Stop after `POST /shipments` and `GET /shipment-price-comparison/{id}`.
- `POST /confirm-shipping-price` runs only when `KARGONOMI_PROBE_CONFIRM_PRICE=YES` and an explicit `KARGONOMI_PROBE_SHIPPING_PROVIDER_ID` is provided.
- `GET /shipments/{id}/barcode?format=pdf` runs only when `KARGONOMI_PROBE_FETCH_BARCODE=YES`.
- Return/reverse shipment remains unsupported.
- Kargonomi can be enabled for runtime only through explicit provider config; the probe remains manual/dev only.

## PoC Validation Checklist

1. Confirm account credentials, Bearer token, and webhook `secret_key`. `X-App-Key` is not required for this account.
2. Confirm warehouse setup for at least one vendor.
3. Confirm Kargonomi state/city ID mapping for a Turkish Shopify shipping address.
4. Create shipment with `POST /shipments`.
5. Fetch carrier options with `GET /shipment-price-comparison/{id}`.
6. Choose carrier option from returned `shipping_provider_with_price[]`.
7. Confirm carrier with `POST /confirm-shipping-price`.
8. Fetch PDF barcode with `GET /shipments/{id}/barcode?format=pdf`.
9. Register and receive `shipment.updated` webhook.
10. Verify HMAC signature handling against a real webhook.
11. Verify tracking/barcode/status timing.
12. Verify failure responses and validation error shapes.

## Explicit Non-Goals

- No return shipment implementation.
- No reverse label implementation.
- No Shopify reverse delivery implementation.
- No production provider switch.
- No dashboard redesign.
- No Try OTO removal or behavior change.
- No runtime Kargonomi adapter implementation in this phase.
