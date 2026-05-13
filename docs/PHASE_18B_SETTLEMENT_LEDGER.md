# Phase 18B — Settlement Ledger Foundation

## Purpose

Phase 18B moves finance from reporting-only payout estimates toward a deterministic settlement ledger foundation. It introduces vendor balance visibility, settlement lifecycle states, and payout-readiness semantics without executing payouts or integrating external banking, ERP, invoice, tax, or carrier systems.

## Settlement Philosophy

Settlement is ledger-backed and vendor-scoped:
- sale ledger rows accrue value when created
- fulfilled or shipped sale rows become payable
- refund ledger rows fully reduce vendor balances
- held, settled, and disputed states are reserved for operator and future payout workflows

The platform still does not move money. Settlement fields describe operational readiness only.

## Ledger Lifecycle

`FinanceLedgerEntry` now carries settlement metadata:
- `settlementStatus`
- `settlementEligibleAt`
- `accruedAt`
- `payableAt`
- `settledAt`
- `settlementHoldReason`

Initial lifecycle states:
- `ACCRUING`: sale exists but fulfillment/shipping evidence is not present
- `PAYABLE`: sale is fulfilled, shipped, in transit, or delivered
- `PARTIALLY_REFUNDED`: refund impact exists for the ledger context
- `HELD`: payout status or future operator state blocks settlement
- `SETTLED`: future payout execution can mark completed settlement
- `DISPUTED`: future operator workflow can block settlement for review

## Accrued vs Payable Model

Vendor balance aggregation is deterministic:
- gross sales are summed from sale ledger rows
- commission, commission VAT, and shipping deductions use each row's immutable profile snapshot
- refunds fully reduce accrued or payable balances
- unfulfilled sale net amounts contribute to accrued balance
- fulfilled/shipped sale net amounts contribute to payable balance
- held/disputed values are isolated into held balance

`GET /finance` now returns settlement-oriented balance fields:
- `accruedBalance`
- `payableBalance`
- `heldBalance`
- `refundedBalance`
- `pendingSettlement`

## Immutable Ledger Rules

Phase 18A profile snapshots remain immutable. Updating `VendorFinancialProfile` only affects future sale ledger rows. Settlement state transitions must not mutate:
- commission snapshot
- commission VAT snapshot
- shipping mode snapshot
- fixed shipping fee snapshot
- financial profile snapshot id

This preserves historical finance meaning even when vendor commercial terms change.

## Refund Impact Rules

Refunds fully reduce vendor balance. A refund ledger row does not invent settlement or payout execution; it reduces the relevant accrued/payable view using the existing vendor allocation lifecycle where available.

Pending return requests still do not create finance refund ledger rows. `refunds/create` remains the source of posted refund finance impact.

## Future Evolution

Future phases can add:
- payout batches
- payout provider execution
- settlement approval workflows
- ERP/accounting exports
- invoice provider integration
- external shipping provider cost ingestion
- tax/compliance reporting

Those are intentionally outside Phase 18B.
