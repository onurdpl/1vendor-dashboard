# Refund Adjustment Lifecycle

Phase 3.5A adds the refund adjustment foundation for refunds that arrive after a settlement is approved or after a settlement commission invoice exists.

## Policy

- Existing Logo commission invoices remain unchanged.
- No automatic Logo credit invoice is created.
- No automatic commission invoice cancellation or reversal is performed.
- Refunds after invoice are tracked for future settlement deduction.
- Vendor debt remains reserved for refund-after-paid scenarios.

## Lifecycle

```text
PENDING
  -> APPLIED   (future Phase 3.5C)
  -> BLOCKED   (future operational review)
  -> CANCELLED (future administrative cancellation)
```

## Phase 3.5A Scope

Phase 3.5A only creates traceable `SettlementRefundAdjustment` records.

It does not:

- deduct money from future settlements,
- change settlement preview or approval totals,
- change payout batch preparation,
- change vendor debt behavior,
- change Logo invoice lifecycle.

## Audit Purpose

Each adjustment records the refund ledger row, vendor, original order, amount, currency, reason, and any reliable original settlement or commission invoice link. Future phases can use the record to apply the deduction without guessing from historical invoice or settlement state.
