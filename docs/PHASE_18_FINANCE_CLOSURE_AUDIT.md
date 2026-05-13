# Phase 18 — Finance Closure Audit

## Purpose

Phase 18F closes the finance and settlement foundation before future payout execution, ERP export, and live provider integration work begins.

This audit confirms the current finance subsystem is production-ready for:
- vendor-scoped ledger visibility
- payout estimation
- immutable calculation snapshots
- settlement readiness
- payout batch preparation
- vendor payout understanding
- external shipping cost readiness

It does not introduce payout execution, bank transfers, accounting exports, shipment labels, or provider API integrations.

## Architecture Snapshot

Completed finance layers:
- Phase 18A: vendor financial profiles, commission/VAT rules, immutable sale snapshots, sale/refund ledger visibility.
- Phase 18B: settlement lifecycle, accrued/payable balances, payout readiness fields.
- Phase 18C: payout batch drafts, payable-row eligibility, duplicate active-batch prevention.
- Phase 18D: vendor-facing balance workspace and read-only payout visibility.
- Phase 18E: shipment cost ingestion foundation and immutable shipping cost snapshots.

Core production routes:
- `GET /finance`
- `GET /admin/vendors/:vendorId/financial-profile`
- `PUT /admin/vendors/:vendorId/financial-profile`
- `GET /admin/payout-batches`
- `POST /admin/payout-batches/prepare`
- `GET /admin/payout-batches/:id`
- `POST /admin/payout-batches/:id/cancel`
- `POST /admin/payout-batches/:id/mark-review`
- `POST /admin/shipping-costs`

## Immutable Ledger Philosophy

Sale ledger rows preserve calculation inputs from creation time:
- commission percent
- commission VAT percent
- shipping deduction mode
- fixed shipping fee
- optional provider shipping cost
- optional provider shipping VAT
- provider/source context

Updating the current vendor profile affects future sale rows only. It must not rewrite historical sale ledger snapshots.

Provider shipping costs follow the same rule. Attaching or importing a cost later does not retroactively mutate existing finance rows unless a future explicit reconciliation policy is designed and approved.

## Finance Rules Audited

Commission:
- vendor-level only
- one configured profile per vendor
- no SKU/category/marketplace matrix

Refunds:
- fully reduce vendor payout
- do not create protection/shielding offsets
- refund ledger rows are created from `refunds/create`, not from pending return requests

Shipping:
- disabled mode deducts nothing
- fixed mode deducts configured fixed fee after fulfillment/shipment
- external-provider mode deducts confirmed provider cost only when snapshotted
- missing provider cost remains a `0.00` deduction with visible pending state

Settlement:
- unfulfilled sales remain accruing/pending
- fulfilled/shipped sales can become payable
- refunds reduce accrued/payable balance deterministically
- held/disputed states are future-ready operational states

Payout batches:
- preparation only
- vendor-scoped
- payable rows only
- duplicate active inclusion is blocked
- cancellation releases rows for future preparation
- no real payment execution occurs

## Production Read-Only Verification

Read-only production verification was run against:

`https://vendor-dashboard-backend-398h.onrender.com`

Verified on May 13, 2026:
- `npm run real-api:dry-run` passed against the production backend.
- `/finance` returned HTTP 200 for `yalispor` and `sporjinal`.
- Finance response included profile data, settlement balance fields, payout batch summary, and finance records.
- `sporjinal` production sample returned:
  - `profileSource: snapshot`
  - `commissionPercent: 10.00`
  - `commissionVatPercent: 18.00`
  - `settlement: payable`
  - `shippingCostStatus: pending_provider_cost`
  - payout batch reference in `draft`
- `yalispor` production sample returned:
  - `profileSource: snapshot`
  - `settlement: accruing`
  - `shippingCostStatus: not_applicable`
- `GET /admin/vendors/sporjinal/financial-profile` returned configured profile values.
- `GET /admin/payout-batches` returned existing batch records.
- `POST /admin/shipping-costs` with an empty body returned a validation error after admin auth, confirming the route is deployed without creating a shipment cost.

No production mutation was performed during this closure audit.

## Production Migration Verification

Production route behavior indicates the finance schema expected by the deployed backend is available for:
- vendor financial profiles
- settlement lifecycle fields
- payout batch summary and references
- shipping cost route/DTO handling

Direct Render Postgres migration inspection was not performed from the local workspace because production database credentials are managed outside the repo. Operators should still verify Render migration logs for the Phase 18 migrations after deploy.

## Admin Visibility

Admins can:
- view vendor-scoped finance ledgers
- edit current vendor finance profile
- prepare payout batch drafts
- review payout batch references
- attach shipment costs for provider-readiness
- inspect calculation profile/snapshot details
- see settlement readiness and payout batch state

Admin actions remain auth-protected and vendor-scoped.

## Vendor Visibility

Vendor users can:
- see their own balances and ledger rows
- see upcoming payout context
- see settlement state
- see shipping deduction/source state
- see payout batch references read-only

Vendor users cannot:
- edit financial profiles
- prepare/cancel/review payout batches
- attach shipping costs
- access diagnostics/replay/recover controls
- see other vendors' finance rows

## Known Boundaries

Phase 18 remains preparation-only:
- no bank transfer execution
- no payout confirmation
- no ERP/accounting export
- no invoice generation
- no carrier API ingestion
- no shipment label generation
- no tax engine
- no provider reconciliation policy for late shipping costs

## Future Phase Entry Criteria

Before payout execution:
- define payout approval and payment confirmation semantics
- decide how late provider shipping costs should be handled
- add explicit payout statement/audit export format
- define accounting/ERP integration ownership
- add production operator runbooks for failed/negative payout batches

Before provider integration:
- choose provider source-of-truth fields
- define provider import idempotency keys
- define cost dispute/ignore workflow
- define whether provider cost corrections can create adjustment rows

Before ERP/accounting integration:
- define chart-of-accounts mapping
- define invoice/receipt ownership
- define payout tax/VAT reporting requirements
- confirm export format and reconciliation workflow
