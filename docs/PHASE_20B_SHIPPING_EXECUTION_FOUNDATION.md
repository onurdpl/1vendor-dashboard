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

The initial adapter is `HepsijetAdapter`. The schema is intentionally provider-neutral and includes future-ready provider values for MNG, Yurtiçi, and Aras.

Hepsijet execution is gated by environment flags:

- `SHIPPING_EXECUTION_ENABLED=false`
- `SHIPPING_PROVIDER=hepsijet`
- `HEPSIJET_ENABLED=false`
- `HEPSIJET_BASE_URL`
- `HEPSIJET_API_KEY`

When execution is disabled, the adapter returns a dry-run pending response and does not call Hepsijet.

## Vendor Carrier Configuration

`VendorShippingConfig` stores vendor-level carrier preferences:

- preferred provider
- shipping enabled flag
- default desi
- provider metadata for future carrier-specific settings

If a vendor has no explicit config, the platform defaults to Hepsijet, shipping enabled, and 3.00 desi.

## Shipment Execution Records

`ShipmentExecution` stores carrier execution evidence:

- allocation and vendor scope
- provider and provider shipment identifier
- tracking number and tracking URL
- label URL when returned
- shipment status
- desi
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

- live Hepsijet payload hardening against the official production contract
- MNG/Yurtiçi/Aras adapters
- carrier status polling
- return shipment orchestration
- provider rate tables
- manual shipping label workflows
- explicit finance reconciliation for late-arriving carrier cost evidence
