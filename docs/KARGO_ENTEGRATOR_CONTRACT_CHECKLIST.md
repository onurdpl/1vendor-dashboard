# Kargo Entegrator Contract Checklist

This checklist captures the current Kargo Entegrator contract gaps before real or Dummy Kargo shipment creation is expanded. It is intentionally a list of unknowns; do not treat any item here as confirmed provider behavior until the provider documentation or support response confirms it.

## Current Safety Boundary

- The platform may build a shipment preview and persist shipment execution evidence.
- The platform must not infer undocumented provider behavior from UI labels or previous responses.
- Shopify fulfillment submission remains separate and must continue through the existing guarded fulfillment flow.
- Dummy Kargo creation is sandbox-only.
- Kargo status webhooks are sandbox-only and update local shipment execution evidence only.
- Polling, cancellation, and Shopify fulfillment updates from Kargo responses are not implemented yet.

## Confirmed From Postman Collection

- Shipment create endpoint: `POST /api/shipments`.
- Dummy carrier id: `cargo_company.id = "dummy"`.
- `notification_url` is supported.
- Test webhook helper exists: `POST /api/helpers/test-status-webhook`.
- Required customer fields:
  - `name`
  - `surname`
  - `phone`
  - `email`
  - `country`
  - `postcode`
  - `city`
  - `district`
  - `address`
- Required shipment fields:
  - `cargo_integration_id`
  - `warehouse_id`
  - `payment_type`
  - `package_type`
  - `payor_type`
  - `desi`
  - `platform_id`
  - `platform_d_id`

## Contract Gaps To Confirm

- Sender and warehouse requirements.
- Meaning of `cargo_integration_id`.
- Meaning of `warehouse_id`.
- Whether `platform_id` and `platform_d_id` are required aliases or distinct provider concepts.
- Carrier identifier for Surat/Sürat.
- Allowed `payment_type` values and which one should be used for merchant-of-record shipments.
- Required package, desi, weight, and dimension fields.
- Label, barcode, PDF, or waybill response shape.
- Tracking number timing: create response, later polling, or webhook only.
- Full webhook endpoint payload shape.
- Webhook signature or authentication requirements.
- Polling/status endpoint path, method, and response shape.
- Idempotency behavior for repeated create requests using the same order/allocation reference.

## Questions For Kargo Entegrator Support

1. Which sender fields are required beyond warehouse selection?
2. What values identify Sürat and other real carriers?
3. What values are allowed for `payment_type`, `package_type`, and `payor_type`?
4. When are barcode, label/PDF URL, tracking number, and provider shipment id generated?
5. What response keys should be considered canonical identifiers?
6. What is the complete shipment webhook payload shape?
7. What authentication or signature verification is required for status webhooks?
8. What request body does `POST /api/helpers/test-status-webhook` require?
9. What polling/status endpoint should be used after create?
10. Is the create endpoint idempotent when the same reference is sent more than once?

## Current Implementation Notes

- Admin diagnostics report Kargo readiness booleans only and never expose API keys or raw payloads.
- `/webhooks/shipping/kargo-entegrator` ingests sandbox webhooks only when `SHIPPING_SANDBOX_MODE=true` and `KARGO_ENTEGRATOR_WEBHOOK_INGEST_ENABLED=true`.
- Sandbox webhook ingest updates local `ShipmentExecution` fields and does not create Shopify fulfillments.
- Shipment preview includes readiness warnings for admins.
