# Kargo Entegrator Contract Checklist

This checklist captures the current Kargo Entegrator contract gaps before real or Dummy Kargo shipment creation is expanded. It is intentionally a list of unknowns; do not treat any item here as confirmed provider behavior until the provider documentation or support response confirms it.

## Current Safety Boundary

- The platform may build a shipment preview and persist shipment execution evidence.
- The platform must not infer undocumented provider behavior from UI labels or previous responses.
- Shopify fulfillment submission remains separate and must continue through the existing guarded fulfillment flow.
- Dummy Kargo creation, Kargo status webhooks, polling, cancellation, and Shopify fulfillment updates from Kargo responses are not implemented yet.

## Contract Gaps To Confirm

- Exact shipment create endpoint and HTTP method.
- Required receiver address fields.
- Required receiver phone field.
- Sender and warehouse requirements.
- Meaning of `cargo_integration_id`.
- Meaning of `warehouse_id`.
- Whether `platform_id` and `platform_d_id` are required aliases or distinct provider concepts.
- Carrier identifier for Dummy Kargo.
- Carrier identifier for Surat/Sürat.
- Allowed `payment_type` values and which one should be used for merchant-of-record shipments.
- Required package, desi, weight, and dimension fields.
- Label, barcode, PDF, or waybill response shape.
- Tracking number timing: create response, later polling, or webhook only.
- Webhook endpoint payload shape.
- Webhook signature or authentication requirements.
- Polling/status endpoint path, method, and response shape.
- Idempotency behavior for repeated create requests using the same order/allocation reference.

## Questions For Kargo Entegrator Support

1. What is the exact create-shipment endpoint path and method?
2. Which fields are required for sender, receiver, warehouse, and package data?
3. Is `POST /api/shipments` valid for creating a shipment, or only for listing/searching?
4. Which field selects the carrier, and what values identify Dummy Kargo and Sürat?
5. What values are allowed for `payment_type`?
6. When are barcode, label/PDF URL, tracking number, and provider shipment id generated?
7. What response keys should be considered canonical identifiers?
8. How are shipment status updates delivered: webhook, polling, or both?
9. What authentication or signature verification is required for status webhooks?
10. Is the create endpoint idempotent when the same reference is sent more than once?

## Current Implementation Notes

- Admin diagnostics report Kargo readiness booleans only and never expose API keys or raw payloads.
- `/webhooks/shipping/kargo-entegrator` currently returns `501 Not Implemented` and does not parse or mutate provider data.
- Shipment preview includes readiness warnings for admins and keeps the existing payload unchanged.
