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

## Phase 3.5A.1 Diagnostics

Phase 3.5A.1 adds read-only eligibility diagnostics and backfill preview for existing refund ledger rows.

Endpoint:

```text
GET /admin/finance/refund-adjustments/eligibility-preview
```

This endpoint:

- classifies refund ledger rows by recommended action,
- explains why an adjustment can or cannot be created,
- returns safe linkage evidence only,
- reports `writesPerformed: false`,
- does not create `SettlementRefundAdjustment` rows,
- does not modify refund ingestion, settlement math, payout math, vendor debt, or Logo behavior.

The preview is intended to decide Phase 3.5A.2 controlled backfill. It is not the backfill itself.

## Phase 3.5A.2 Controlled Backfill

Phase 3.5A.2 adds an explicit admin-only backfill action:

```text
POST /admin/finance/refund-adjustments/backfill
```

The request must include:

```json
{
  "confirmRefundAdjustmentBackfill": true
}
```

This action:

- reuses the eligibility preview,
- creates `PENDING` adjustment records only for `CREATE_PENDING_ADJUSTMENT` rows,
- skips rows that already have an adjustment,
- skips vendor-debt, missing-linkage, and ineligible rows,
- is idempotent through the unique refund-ledger adjustment constraint,
- does not apply deductions to settlements,
- does not affect payout preparation,
- does not change vendor debt,
- does not call Shopify, Logo, or any provider.

The backfilled `PENDING` records prepare Phase 3.5B preview and Phase 3.5C application.
