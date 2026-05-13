# Phase 18A — Vendor Finance Foundation

## Purpose

Phase 18A creates the first deterministic vendor-level finance foundation for the payout engine. The platform now has production-grade ingestion, reconciliation, diagnostics, retry lifecycle, scheduled reconciliation, observability, and performance hardening. Finance can therefore move from reporting-only ledger visibility toward vendor payout calculation.

This phase is intentionally narrow:
- vendor-level financial profile only
- one configured profile per vendor
- commission and commission VAT calculation
- shipping deduction configuration
- allocation/ledger payout estimate visibility

This phase does not execute payouts, create bank transfers, export accounting data, calculate tax, generate invoices, generate shipping labels, or integrate external shipping/accounting providers.

## Vendor Financial Profile

`VendorFinancialProfile` stores the active finance configuration for a vendor:
- `vendorId`
- `commissionPercent`
- `commissionVatPercent`
- `deductShippingEnabled`
- `shippingMode`
- `fixedShippingFee`
- `active`
- `createdAt`
- `updatedAt`

The model is keyed by `vendorId`, which keeps the Phase 18A rule simple: one configured profile per vendor. If no configured profile exists, finance reads use a deterministic default:
- commission: `10.00%`
- commission VAT: `0.00%`
- shipping deduction: disabled
- shipping mode: disabled

## Commission Model

Commission is vendor-level only:

```text
commission = gross amount * commission percent
commission VAT = commission * commission VAT percent
```

There is no category, SKU, marketplace, campaign, or vendor-tier matrix in this phase.

## Refund Policy

Refunds fully reduce vendor payout:

```text
estimated payout = gross - commission - commission VAT - shipping deduction - refund impact
```

There is no refund shielding, partial protection, or commission protection in Phase 18A.

## Shipping Deduction

Shipping deduction is configurable per vendor:
- `disabled`: no deduction
- `fixed`: deduct the configured fixed fee
- `external_provider`: reserved for future carrier/provider cost ingestion

Shipping deduction applies only after fulfillment/shipping lifecycle evidence exists. Phase 18A does not invent shipping costs and does not call an external carrier/provider.

## API Surface

Vendor-scoped finance dashboard:
- `GET /finance`

The response now includes:
- existing finance `summary`
- `profile`
- per-record `payoutCalculation`

Admin profile configuration:
- `GET /admin/vendors/:vendorId/financial-profile`
- `PUT /admin/vendors/:vendorId/financial-profile`

Admin profile writes are intentionally minimal and deterministic. Vendor users continue to receive only vendor-scoped finance visibility.

## Operational Safety

Phase 18A preserves:
- vendor isolation through existing backend vendor context middleware
- existing finance ledger behavior
- refund ingestion behavior
- reconciliation philosophy
- replay/recover/diagnostics behavior
- no money movement
- no settlement scheduling

Payout values are estimates and preparation for the future settlement engine.

## Phase 18A Fix — Sale Ledger Creation

Real `orders/create` ingestion now creates idempotent vendor-scoped sale ledger rows for each accepted vendor allocation:
- ledger id: `fin-{vendorId}-sale-{sourceShopifyOrderId}`
- `entryType`: `sale`
- `vendorId`: assigned allocation vendor
- `vendorAllocationId`: allocation id
- `amount`: summed allocation line amount for that vendor
- `payoutStatus`: `PENDING`

Duplicate webhook delivery, replay, or recovery reuses the deterministic ledger id and updates the existing sale row instead of creating duplicates.

Reconciliation can also repair missing sale ledger rows for already-ingested orders. This is intentionally scoped to local allocation state and does not invent Shopify state.

## Phase 18A Fix 2 — Profile UX and Return Mapping

Vendor finance profile controls now live once at the vendor finance workspace level instead of inside each ledger row detail panel.
- Admins can edit the selected vendor profile once.
- Vendors see the same profile read-only.
- Saving a profile refetches finance data so commission and payout estimates reflect the current profile without a full reload.

Return request attribution now prefers local ingested order line-item vendor mapping before falling back to Shopify `seller_info`.
This stabilizes cases where a real order was already allocated correctly, but later return-request processing cannot re-fetch or parse the original `seller_info` metafield. Return visibility remains vendor-scoped and line-item scoped.

Finance refund ledger behavior remains unchanged:
- pending return requests appear in Returns
- refund ledger rows are created only after `refunds/create`
- refunds fully reduce payout estimates once posted

## Future Evolution

Future phases can build on this foundation with:
- settlement batches
- payout lifecycle states
- external shipping cost ingestion
- payout provider integrations
- accounting exports
- ERP synchronization
- tax engine
- category/SKU commission matrix if the business model later requires it

## Phase 18B Handoff

Phase 18B adds the first settlement ledger foundation on top of these immutable profile snapshots. Active vendor profile edits remain future-effective only; historical sale rows keep their original snapshot inputs while settlement readiness and vendor balances are calculated from the ledger.
