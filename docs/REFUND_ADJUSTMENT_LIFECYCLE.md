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
  -> PARTIALLY_APPLIED
  -> APPLIED
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

## Phase 3.5B Application Preview

Phase 3.5B adds read-only visibility into how `PENDING` adjustments would reduce a future vendor settlement.

Endpoints and surfaces:

```text
GET /admin/finance/refund-adjustments/application-preview?vendorId=<vendorId>
POST /admin/finance/settlement-approvals/preview
```

The settlement approval preview includes a `Pending Refund Adjustments` section with:

- pending adjustment count,
- pending adjustment total,
- current candidate net payable,
- preview-only net after pending adjustments,
- safe adjustment references.

This phase still does not:

- create settlement adjustment lines,
- mark adjustments `APPLIED`,
- change `SettlementApproval` totals,
- change payout preparation,
- change vendor debt,
- call Shopify, Logo, or any provider.

The preview prepares Phase 3.5C, where adjustment lines can become part of a settlement approval through an explicit application flow.

## Phase 3.5C Settlement Application

Phase 3.5C applies eligible `PENDING` adjustments when a new settlement approval draft is created for the same vendor.

Application rules:

- only `PENDING` adjustments are considered,
- adjustment amount must be positive,
- currency must match the settlement currency,
- already applied, blocked, or cancelled adjustments are excluded,
- adjustment-only settlement drafts are blocked,
- adjustments that exceed the current settlement payable are partially applied in Phase 3.5D.

Applied line behavior:

- `SettlementApprovalLine.lineType = REFUND_ADJUSTMENT`,
- `amountMinor` stores the positive adjustment amount,
- `commissionMinor = 0`,
- `commissionVatMinor = 0`,
- `payableImpactMinor = -amountMinor`,
- the approval line stores `settlementRefundAdjustmentId`,
- the adjustment is updated to `APPLIED` with the applied settlement approval and line ids.

Existing Logo commission invoices remain unchanged. Phase 3.5C does not create Logo credit invoices, cancel Logo invoices, call Logo, call Shopify, or mutate original sale/refund ledger amounts.

## Phase 3.5D Partial Application

Phase 3.5D allows a pending refund adjustment to be applied over multiple future settlement drafts.

Example:

```text
Adjustment: 9,726
Current settlement payable: 6,000

Draft creation:
- apply 6,000
- keep 3,726 remaining
- adjustment status = PARTIALLY_APPLIED

Next settlement payable: 10,000

Draft creation:
- apply 3,726
- keep 0 remaining
- adjustment status = APPLIED
```

Application rules:

- `remainingAmountMinor` is the source for future application.
- `applyAmountMinor = min(remainingAmountMinor, availablePayableMinor)`.
- adjustment-only drafts remain blocked.
- settlement net payable is not allowed to go negative.
- adjustment overflow does not create vendor debt.
- vendor debt is reserved for refund-after-payout or refund-after-settled-payment scenarios.

Application history:

- every applied slice creates a `SettlementRefundAdjustmentApplication`,
- each application links one `SettlementApprovalLine` to the parent `SettlementRefundAdjustment`,
- active applications can be cancelled only through settlement approval cancellation,
- cancellation restores only the cancelled application amount to the parent adjustment and marks that application `CANCELLED`.

Visibility:

- preview and diagnostics show original, applied, and remaining amounts,
- Finance Detail and Return Detail show application history,
- `GET /admin/finance/refund-adjustments` includes `applications[]`.

## Phase 3.5E Audit Trail & UX

Phase 3.5E adds operator-facing audit trail visibility without changing settlement, refund, payout, vendor debt, or Logo behavior.

Adjustment timeline:

```text
CREATED
  -> PARTIALLY_APPLIED
  -> APPLIED
  -> APPLICATION_CANCELLED
  -> ADJUSTMENT_CANCELLED
```

Operators can trace:

```text
Order #1086
  -> Refund #1080642666833
  -> SettlementRefundAdjustment
  -> Settlement application rows
  -> Final remaining balance / APPLIED state
```

UI behavior:

- Settlement Workspace shows business-readable order, refund, and invoice labels before raw ids.
- Finance Detail shows status, original amount, applied amount, remaining amount, next settlement impact, application history, and timeline.
- Return Detail shows the same adjustment state next to the return context.
- Raw ids remain available as diagnostics, not as the primary operator language.

Diagnostics:

```text
GET /admin/finance/refund-adjustments
GET /admin/finance/refund-adjustments/:id
```

The detail endpoint is read-only and returns the adjustment, applications, and audit events. It does not write data or call external providers.

## Phase 3.5F Edge Case Hardening

Phase 3.5F verifies and hardens edge cases before closing the refund-adjustment phase.

Verified guardrails:

- partial refunds use the same refund payable reversal formula as refund ledger events,
- multiple refunds for the same order remain separate by refund ledger row,
- duplicate webhook/reconciliation replay remains idempotent through the unique refund-ledger adjustment constraint,
- adjustment preview excludes currency mismatches and performs no currency conversion,
- zero, negative, and invalid adjustment amounts are blocked by diagnostics,
- `APPLIED`, `BLOCKED`, `CANCELLED`, and zero-remaining adjustments are excluded from application preview,
- `PARTIALLY_APPLIED` adjustments use only `remainingAmountMinor`,
- payable smaller than adjustment creates a partial application and never creates vendor debt,
- adjustment-only settlement drafts remain unsupported and blocked,
- settlement cancellation cancels active applications and restores only the application amount,
- paid or settled sale refunds use vendor debt, not settlement refund adjustments.

Unsupported cases:

- adjustment-only settlement drafts,
- negative settlement drafts,
- automatic Logo credit invoices,
- automatic commission invoice cancellation,
- currency conversion for refund adjustments.

Vendor debt boundary:

```text
Refund after approved/invoiced settlement before vendor payment
  -> SettlementRefundAdjustment

Refund after vendor payout / settled payment
  -> VendorBalanceEvent debt path

Adjustment overflow
  -> Carry remaining adjustment forward
  -> Never create vendor debt
```

Diagnostics:

- eligibility diagnostics show missing linkage, vendor debt required, already existing adjustment, and invalid amount reasons,
- application preview diagnostics show currency mismatch, zero/invalid, already applied, blocked, cancelled, pending, and partially applied counts.
