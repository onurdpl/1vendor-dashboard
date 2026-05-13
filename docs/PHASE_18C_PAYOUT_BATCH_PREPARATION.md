# Phase 18C — Payout Batch Preparation

## Purpose

Phase 18C adds the first payout batch preparation foundation for payable vendor finance rows. It lets admins group eligible ledger rows into draft payout batches for review while keeping the platform strictly preparation-only.

No money moves in this phase. There is no bank transfer, ERP export, invoice generation, provider integration, or payment confirmation.

## Batch Philosophy

Payout batches are ledger-backed and vendor-scoped:
- only payable or refund-impact ledger rows for the selected vendor are eligible
- immutable sale calculation snapshots remain unchanged
- refund rows fully reduce the draft net amount
- cancelled batches release rows for future preparation
- active batches prevent the same ledger row from being included twice

The batch is an operational review artifact, not a settlement execution record.

## Data Model

`PayoutBatch` stores draft-level totals:
- `vendorId`
- `status`
- `grossAmount`
- `commissionAmount`
- `commissionVatAmount`
- `shippingDeductionAmount`
- `refundAmount`
- `netAmount`
- `currency`
- optional `createdByUserId`

`PayoutBatchLine` links a finance ledger row to a batch and stores an `amountSnapshot` for the row's contribution to the draft.

Batch statuses:
- `DRAFT`
- `REVIEW`
- `APPROVED`
- `CANCELLED`
- `EXECUTION_PENDING`
- `PAID_PLACEHOLDER`

`PAID_PLACEHOLDER` is intentionally not real payment execution.

## Eligibility Rules

A finance ledger row is eligible when:
- it belongs to the requested vendor
- it is a `sale` or `refund` ledger row
- its settlement state is `PAYABLE` or `PARTIALLY_REFUNDED`
- it is not already linked to an active payout batch
- it is not held, disputed, settled, or already paid

Unfulfilled/accruing rows remain excluded until fulfillment or shipping evidence makes them payable.

## Admin API

Admin-only endpoints:
- `GET /admin/payout-batches`
- `POST /admin/payout-batches/prepare`
- `GET /admin/payout-batches/:id`
- `POST /admin/payout-batches/:id/cancel`
- `POST /admin/payout-batches/:id/mark-review`

`POST /admin/payout-batches/prepare` accepts `vendorId`, selects eligible ledger rows, snapshots row contributions, and returns a draft batch.

## Finance UI

`GET /finance` now includes `payoutBatchSummary`:
- eligible row count
- eligible net amount
- blocked row count
- latest batch summary

Finance ledger records also include an optional payout batch reference so the detail drawer can show whether a row is unbatched or linked to a draft/review batch.

Admins see a compact "Prepare draft payout" panel. Vendor users see the same upcoming payout information read-only.

## Future Evolution

Future phases can add:
- approval gates
- export files
- external payment provider execution
- accounting/ERP synchronization
- payout confirmation and settlement completion
- richer negative-balance workflows

Those remain intentionally outside Phase 18C.
