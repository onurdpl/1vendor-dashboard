# Phase 20B - Shipping Execution Foundation

Phase 20B adds the first merchant-of-record shipping execution foundation. The platform remains the canonical operational and finance truth, while carriers execute shipment creation and return tracking, label, and cost evidence.

This phase does not add a WMS, carrier rate shopping, label printing infrastructure, return shipments, procurement accounting, or automatic carrier reconciliation.

## Merchant-Of-Record Shipping Model

- The platform owns the customer commerce operation and coordinates fulfillment visibility.
- Vendors remain fulfillment and supply operators.
- External shipping providers execute carrier-specific shipment creation.
- Carrier responses are evidence captured by the platform; they do not replace Shopify canonical state or local reconciliation.
- Shopify fulfillment mutations remain controlled by the existing fulfillment paths. Phase 20B does not bypass Shopify fulfillment rules.

## Provider Abstraction

Shipping providers are accessed through a provider adapter contract:

- `ShippingProviderAdapter`
- `createShipment()`
- `getShipmentStatus()`
- `getTrackingInfo()`
- `cancelShipment()` placeholder

The initial adapters are `HepsijetAdapter` and `KargoEntegratorAdapter`. The schema is intentionally provider-neutral and includes future-ready provider values for MNG, Yurtiçi, and Aras.

Kargo Entegratör execution is gated by environment flags. Vendor branch identifiers are not env values:

- `SHIPPING_EXECUTION_ENABLED=false`
- `SHIPPING_PROVIDER=kargo_entegrator`
- `KARGO_ENTEGRATOR_ENABLED=false`
- `KARGO_ENTEGRATOR_BASE_URL`
- `KARGO_ENTEGRATOR_API_KEY`

When execution is disabled, the adapter returns a dry-run pending response and does not call Kargo Entegratör.

## Dummy Kargo Sandbox Flow

Dummy Kargo execution is explicit sandbox/test behavior:

- `SHIPPING_SANDBOX_MODE=true` enables Dummy Kargo payload construction.
- `KARGO_ENTEGRATOR_WEBHOOK_INGEST_ENABLED=true` allows sandbox webhook ingestion.
- Dummy creation uses the documented Kargo Entegratör shipment endpoint (`POST /api/shipments`) through the existing adapter base URL.
- Dummy payloads include `cargo_company.id = "dummy"` plus the documented customer, warehouse, package, payment, desi, platform, notification, and line fields.
- Required receiver fields (`name`, `surname`, `phone`, `email`, `country`, `postcode`, `city`, `district`, `address`) are validated before the provider is called. Missing fields block shipment creation with an actionable error.
- Sandbox webhooks update only local `ShipmentExecution` evidence and timeline data. They do not create Shopify fulfillments, submit tracking to Shopify, mark orders delivered, or mutate finance state.
- The Kargo helper endpoint `POST /api/helpers/test-status-webhook` is documented by the Postman collection, but the local platform does not call it yet because the helper request contract is not stored in the repo.

## Vendor Carrier Configuration

`VendorShippingConfig` stores vendor-level carrier preferences:

- preferred provider
- shipping enabled flag
- default desi
- cargo integration id
- default warehouse id
- shipping VAT percent
- provider metadata for future carrier-specific settings

`VendorShippingWarehouse` stores vendor-scoped warehouse/branch records:

- vendor id
- provider
- warehouse id
- default marker
- optional name/address/metadata

This supports one default warehouse now while allowing multiple warehouses per vendor later.

Sporjinal seed configuration:

- provider: `kargo_entegrator`
- cargo integration id: `2547`
- default warehouse id: `1774`
- default desi: `3`
- shipping VAT: `18%`

If a vendor has no explicit config, the platform defaults to Hepsijet, shipping enabled, and 3.00 desi. Kargo Entegratör live creation is blocked until the selected vendor has a cargo integration id and default warehouse.

## Shipment Execution Records

`ShipmentExecution` stores carrier execution evidence:

- allocation and vendor scope
- provider and provider shipment identifier
- tracking number and tracking URL
- label URL when returned
- shipment status
- desi
- cargo integration id used
- warehouse id used
- shipping cost, shipping VAT, and currency when returned
- request and response snapshots

Duplicate creation is prevented by the allocation/provider uniqueness rule. Replays or repeat clicks return the existing shipment execution instead of creating another carrier shipment.

## Desi Heuristics

Phase 20B includes simple deterministic desi rules:

- shoes: 3 desi
- bags: 3 desi
- apparel: 3 desi
- fallback: vendor default desi

These are intentionally lightweight and easy to replace with provider/category-specific rules later.

## Finance Shipping-Cost Linkage

When a carrier returns a confirmed shipping cost, Phase 20B creates or updates the existing `ShipmentShippingCost` input:

- source type: `EXTERNAL_PROVIDER`
- status: `CONFIRMED`
- provider name and reference
- shipping cost and 18% VAT if the provider did not return VAT

This links carrier execution to the Phase 18E shipping-cost foundation. It does not mutate immutable finance ledger snapshots retroactively. Existing sale rows keep their historical calculation snapshots until a future explicit reconciliation policy is designed.

## Visibility

Order detail responses include the latest shipment execution for the allocation. Vendor and admin users can see:

- provider
- shipment status
- tracking number and URL
- label URL
- selected/default warehouse
- shipping cost linkage

Vendors can create shipments for their own allocations only. Admins can inspect shipment executions and update vendor shipping configuration.

## Safety Boundaries

Phase 20B preserves:

- vendor isolation
- immutable finance snapshots
- settlement and payout correctness
- Shopify canonical behavior
- duplicate-safe execution
- provider abstraction

Phase 20B does not:

- create return shipments
- perform carrier cancellation
- run automatic shipment creation
- implement label printing infrastructure
- update customer-facing Shopify fulfillment without the existing fulfillment safeguards
- expose carrier secrets or raw sensitive payloads

## Future Work

Future phases can add:

- provider contract confirmation using `docs/KARGO_ENTEGRATOR_CONTRACT_CHECKLIST.md`
- live Hepsijet payload hardening against the official production contract
- MNG/Yurtiçi/Aras adapters
- carrier status polling
- return shipment orchestration
- provider rate tables
- manual shipping label workflows
- explicit finance reconciliation for late-arriving carrier cost evidence
