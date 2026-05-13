# Phase 18E — External Shipping Cost Foundation

## Purpose

Phase 18E adds the first vendor-scoped shipment cost ingestion foundation so payout calculations can eventually use real provider shipping costs.

This phase remains ingestion-only. It does not call live carrier APIs, generate shipment labels, integrate ERP/accounting providers, or execute payout settlement.

## Shipping Cost Philosophy

Shipping deduction remains deterministic and ledger-backed:
- `disabled` mode deducts nothing.
- `fixed` mode deducts the vendor profile fixed fee after fulfillment/shipment.
- `external_provider` mode deducts confirmed provider cost only when a shipment cost snapshot exists.
- if no confirmed provider cost exists, the deduction remains `0.00`.
- refunds still fully reduce vendor payout.

Shipping costs are vendor-scoped and tied to the local vendor allocation. They must never be applied across vendors or unrelated allocations.

## Shipment Cost Model

`ShipmentShippingCost` stores provider/manual shipment cost inputs:
- vendor
- vendor allocation
- Shopify order id
- optional Shopify fulfillment id
- provider name
- optional provider reference
- shipping cost
- optional shipping VAT
- currency
- status
- source type

Supported source types:
- `manual`
- `imported`
- `external_provider`

Supported statuses:
- `pending`
- `confirmed`
- `disputed`
- `ignored`

Only confirmed costs are eligible for payout snapshot usage.

## Immutable Shipping Snapshots

Sale ledger rows can store immutable shipping cost context:
- shipping cost used
- shipping VAT used
- cost source
- provider name
- shipment cost record id

Existing finance rows are not rewritten when a provider cost is attached later. A sale row uses the shipping snapshot captured at ledger creation time, with fallback behavior for older rows that do not have snapshots.

This matches the Phase 18A/18B immutable finance profile behavior: historical payout rows keep the calculation inputs known when they were created.

## Admin Ingestion

Admins can attach a confirmed shipment cost to a vendor allocation or sale ledger reference through the lightweight ingestion endpoint:

`POST /admin/shipping-costs`

The endpoint:
- requires admin authentication
- validates vendor ownership of the finance row/allocation
- upserts a deterministic provider/reference record
- avoids duplicate ingestion for the same vendor, allocation, provider, and reference
- does not mutate existing finance ledger snapshots

Vendor users can see shipping deduction/source state in Finance but cannot edit shipment costs.

## Finance Visibility

Finance detail displays:
- shipping deduction amount
- shipping deduction source
- provider/source label when available
- whether a ledger row has a shipping cost snapshot
- pending provider cost state for fulfilled external-provider rows without a snapshot

For `external_provider` mode, a missing confirmed cost is operationally visible but does not create a deduction.

## Future Direction

Future phases can add:
- provider import jobs
- carrier/ERP adapters
- provider cost reconciliation
- shipment cost approval workflows
- payout execution integration
- accounting export support

Those are intentionally outside Phase 18E.
