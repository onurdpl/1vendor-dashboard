# Finance Settlement Model

## Purpose

This document defines the finance settlement foundation for marketplace-style vendor operations. It is a design and terminology document only. It does not add a payout engine, accounting integration, schema migration, provider behavior, or finance UI behavior.

The platform remains an operational control center. It records operational finance evidence, produces payout previews, and prepares review workflows. It is not yet the authority for moving money, generating accounting documents, or deciding tax treatment.

## Terminology Rules

- Use `estimated`, `preview`, or `projected` for values that are calculated but not reviewed and approved.
- Use `payable` only when the platform has explicit settlement readiness or approval evidence.
- Do not call a value `balance` unless it is a confirmed payable or a legacy API field being described by its current name.
- Unknown fields must render as `Unknown`, `Pending`, or `Not configured`, not `0`.
- Refund impact must be shown separately from sales, commission, and shipping deductions.
- Draft payout batches are review artifacts, not payment promises.
- `PAID_PLACEHOLDER` is not real payment confirmation.

## Current State

### Persisted Operational Finance Data

The current backend already persists finance-relevant records:

- `VendorFinancialProfile`
  - commission percent
  - commission VAT percent
  - shipping deduction enabled flag
  - shipping deduction mode: `DISABLED`, `FIXED`, or `EXTERNAL_PROVIDER`
  - optional fixed shipping fee
  - active profile flag
- `FinanceLedgerEntry`
  - vendor-scoped sale and refund rows
  - amount
  - payout status
  - immutable commission, VAT, and shipping profile snapshots
  - settlement status and readiness timestamps
  - optional payout batch references through `PayoutBatchLine`
- `ShipmentShippingCost`
  - confirmed or pending shipping cost evidence
  - provider/source metadata
- `PayoutBatch`
  - vendor-scoped draft or review batch totals
  - gross, commission, VAT, shipping deduction, refund, and net amount snapshots
- `PayoutBatchLine`
  - links eligible finance ledger rows into payout batch drafts

### Real Values Today

These values are based on persisted operational records:

- vendor allocation sale amounts ingested from accepted Shopify order allocation data
- refund ledger rows created from `refunds/create`
- active or snapshot vendor commission profile values
- stored settlement lifecycle fields on finance ledger rows
- stored payout batch draft/review rows
- stored external shipping cost records when confirmed or manually attached

These values are real operational records, but they are not automatically final payout authority.

### Estimated Or Preview Values Today

These values are calculations over current persisted evidence:

- `payoutEstimate`
- per-record `estimatedPayout`
- payout batch `netAmount` before approval/payment execution
- `accruedBalance`, `payableBalance`, `heldBalance`, and `pendingSettlement` as currently named legacy API fields
- order detail finance ledger preview output
- dashboard finance snapshots

Until a payout is explicitly approved and paid by a future payout workflow, these must be presented as estimates or review amounts.

### Currently Hardcoded Or Inferred

The current implementation includes deterministic defaults and inferred readiness:

- default finance profile when no profile exists:
  - 10 percent commission
  - 0 percent commission VAT
  - shipping deduction disabled
- shipping deduction applies only after fulfillment/shipping lifecycle evidence exists.
- refund impact fully reduces the vendor payout preview.
- sale settlement readiness is inferred from fulfillment/shipping evidence.
- draft payout batch eligibility is inferred from settlement status, payout status, vendor scope, and active batch membership.
- missing provider shipping cost in external-provider mode remains pending evidence and must not be treated as a final zero unless policy confirms it.

### Missing Or Not Yet Finalized

The following are not implemented or not confirmed as final authority:

- payout execution
- bank transfer integration
- payout payment confirmation
- final vendor statement generation
- accounting/ERP export
- invoice or e-fatura authority for vendor payouts
- tax reporting treatment
- chargeback/dispute settlement policy
- negative payout recovery policy
- payout reversal workflow
- late provider shipping cost reconciliation policy
- manual finance adjustment workflow
- seller-of-record responsibility

## Proposed Minimal Domain Model

The next finance model should make the existing implicit concepts explicit while preserving vendor isolation and allocation-level traceability.

### OrderFinancePreview

Purpose: show a per-order or per-allocation estimate before final settlement.

Suggested fields:

- `orderId`
- `allocationId`
- `vendorId`
- `currency`
- `grossAmount`
- `commissionRateSnapshot`
- `commissionAmount`
- `commissionVatRateSnapshot`
- `commissionVatAmount`
- `shippingDeduction`
- `refundDeduction`
- `netPayoutEstimate`
- `status`
- `unknowns`
- `calculatedAt`

Rules:

- It is read-only.
- It must be labeled as a preview.
- It must not be used as a payment instruction.
- Missing commission, shipping, refund, or allocation evidence must be listed in `unknowns`.

### SettlementLine

Purpose: represent one vendor-scoped settlement-relevant line derived from an order, refund, shipping cost, or future adjustment.

Suggested fields:

- `id`
- `vendorId`
- `allocationId`
- `shopifyOrderId`
- `shopifyOrderLineItemId`
- `sourceType`: `sale`, `refund`, `shipping_deduction`, `manual_adjustment`
- `sourceReference`
- `currency`
- `grossAmount`
- `commissionRateSnapshot`
- `commissionAmount`
- `commissionVatAmount`
- `shippingDeduction`
- `refundDeduction`
- `netPayoutEstimate`
- `settlementStatus`
- `payoutStatus`
- `createdAt`
- `evidenceSnapshot`

Rules:

- Lines are vendor-scoped.
- Lines should be allocation-scoped whenever possible.
- Existing lines should not be rewritten to change financial history.
- Corrections should use reversal or adjustment lines.
- Snapshots must preserve the rules used at the time the line was created.

### PayoutActivity

Purpose: represent the admin-controlled workflow around grouping, reviewing, approving, scheduling, and recording payout activity.

Suggested fields:

- `id`
- `vendorId`
- `status`
- `currency`
- `lineIds`
- `grossAmount`
- `commissionAmount`
- `commissionVatAmount`
- `shippingDeduction`
- `refundDeduction`
- `netPayoutEstimate`
- `approvedPayableAmount`
- `createdByUserId`
- `approvedByUserId`
- `scheduledAt`
- `paidAt`
- `paymentReference`
- `blockedReason`

Rules:

- Draft and review states remain estimates.
- `approvedPayableAmount` can exist only after admin approval.
- `paidAt` requires an explicit payment confirmation source.
- A future accounting or bank provider may attach references, but this model does not require one.

### FinanceEvent

Purpose: append-only audit of finance decisions and operational finance evidence.

Suggested event types:

- `order_sale_recorded`
- `fulfillment_evidence_received`
- `refund_recorded`
- `shipping_cost_confirmed`
- `settlement_line_reviewed`
- `payout_activity_created`
- `payout_approved`
- `payout_scheduled`
- `payout_paid`
- `payout_blocked`
- `payout_reversed`
- `manual_adjustment_recorded`

Rules:

- Events must be idempotent where sourced from webhooks or provider callbacks.
- Events must not expose full sensitive payloads.
- Events should include actor/source context.
- Events should reference the affected vendor and allocation where available.

## Core Field Definitions

### commissionRateSnapshot

The commission rate captured when a sale or adjustment line is created. It protects historical calculations from later vendor profile edits.

### shippingDeduction

The amount reserved or deducted for shipping cost according to a configured policy and available provider evidence.

Allowed states:

- `not_applicable`
- `pending_provider_cost`
- `estimated_fixed`
- `confirmed_provider_cost`
- `unknown`

### refundDeduction

The refund amount that reduces the vendor payout estimate for the affected allocation or line item. Pending return requests are not refund deductions until money refund evidence exists.

### netPayoutEstimate

Calculated preview:

`grossAmount - commissionAmount - commissionVatAmount - shippingDeduction - refundDeduction`

This is not a payable amount until reviewed and approved by the payout workflow.

## Proposed Payout Status Enum

The target payout workflow should use these business-facing statuses:

- `estimated`
  - calculated from available evidence, not reviewed
- `pending_review`
  - eligible for operator review, but not approved
- `approved`
  - reviewed and approved as payable
- `scheduled`
  - approved and queued for payment execution
- `paid`
  - payment confirmation recorded
- `blocked`
  - cannot proceed due to missing evidence, dispute, hold, negative amount, or operator block
- `reversed`
  - previous approved or paid activity was reversed by a correction workflow

### Mapping From Current Statuses

Current state should be interpreted conservatively:

- `FinanceLedgerEntry.settlementStatus = PENDING` -> `estimated`
- `ACCRUING` -> `estimated`
- `PAYABLE` -> `pending_review`, not automatically approved
- `PARTIALLY_REFUNDED` -> `pending_review` with refund impact shown separately
- `HELD` or `DISPUTED` -> `blocked`
- `SETTLED` -> only `paid` if payment confirmation exists; otherwise treat as legacy settled evidence requiring audit
- `PayoutBatchStatus.DRAFT` -> `estimated`
- `REVIEW` -> `pending_review`
- `APPROVED` -> `approved`
- `EXECUTION_PENDING` -> `scheduled`
- `PAID_PLACEHOLDER` -> not final paid; show as placeholder until payment evidence exists
- `PayoutStatus.HOLD` -> `blocked`
- `PayoutStatus.PAID` -> `paid` only if paired with payment confirmation evidence

## Visibility Rules

### Vendor View

Vendors may see:

- their own vendor-scoped finance lines
- estimated payout previews clearly labeled as estimates
- refund impact separated from payout preview
- shipping deduction status
- review or payout activity status
- support-oriented explanations for blocked or unknown amounts

Vendors must not see:

- another vendor's finance lines
- cross-vendor payout batches
- raw internal diagnostic payloads
- admin-only manual adjustment controls
- accounting provider credentials or raw export artifacts

### Admin View

Admins may see:

- vendor-scoped and cross-vendor finance summaries where the route permits it
- vendor financial profile configuration
- profile snapshot values
- settlement readiness and unknown evidence
- payout batch draft/review records
- blocked or negative payout drivers
- audit events and support context

Admin controls should remain explicit and review-based. Preparing a batch must not imply payment.

### Support View

Support may see:

- read-only finance explanations
- refund impact and shipping deduction status
- support ticket context
- blocked/pending reasons safe for operational support

Support should not be able to approve payouts, mutate finance profiles, or execute payment workflows unless a future role model explicitly grants that capability.

## UI Rules

- Label all non-final amounts as `Estimated`, `Preview`, `Pending review`, or `Projected`.
- Do not show a payable amount as a final value until payout activity reaches `approved`.
- Unknown commission, shipping, tax, refund, or provider cost fields must show `Unknown`, `Pending`, or `Not configured`.
- Do not render unknown numeric values as `0`.
- Refund impact must appear as its own row or section.
- Shipping deduction must show its source:
  - fixed profile
  - confirmed provider cost
  - pending provider cost
  - disabled
  - unknown
- Draft payout batches must read as `Draft payout preview`.
- `Paid` must require payment confirmation evidence, not only local placeholder status.
- Vendor-facing pages should avoid internal jargon such as raw enum names unless paired with readable labels.
- Admin-facing pages may expose raw IDs and enum names in compact diagnostics.

## Recommended Incremental Phases

### Phase 1: Terminology And Documentation

- Add this model as the finance terminology baseline.
- Audit UI copy that uses `balance` for estimate-only values.
- Add helper labels for `estimated`, `pending review`, and `approved payable`.
- No schema change.

### Phase 2: API Compatibility Aliases

- Keep existing finance response fields for compatibility.
- Add clearer aliases such as:
  - `estimatedAccruedAmount`
  - `payablePreviewAmount`
  - `approvedPayableAmount`
  - `refundDeductionAmount`
  - `shippingDeductionStatus`
- Mark legacy balance-like fields as compatibility fields in API docs.

### Phase 3: SettlementLine And FinanceEvent Formalization

- Either evolve `FinanceLedgerEntry` into the explicit `SettlementLine` model or add a compatibility mapper.
- Add append-only `FinanceEvent` records for operational finance decisions.
- Preserve idempotency for Shopify and provider-sourced events.

### Phase 4: Payout Review Workflow

- Make payout approval explicit.
- Require admin approval before any amount is described as payable.
- Add blocked/reversed states before payment execution exists.
- Continue avoiding bank/accounting provider integration in this phase.

### Phase 5: Payment And Accounting Integrations

- Integrate bank/accounting providers only after payout approval semantics, tax ownership, and seller-of-record responsibility are confirmed.
- Add provider reconciliation, payment confirmation, reversal handling, and export audit trails.

## Open Questions

These must be answered before payout execution or accounting integration:

- Is the platform, vendor, or Shopify store the seller of record for each transaction?
- Which party owns VAT/tax reporting for vendor payouts, commissions, refunds, and shipping?
- Who pays forward shipping and return shipping under each return reason?
- Are commission refunds proportional, fixed, or policy-driven?
- How are chargebacks, failed payments, or Shopify payment disputes represented?
- Can a vendor payout be negative, and how should recovery work?
- What is the payout cadence and approval authority?
- What evidence confirms that a payout was paid?
- Which accounting provider, if any, becomes the system of record for invoices/statements?
- How should late provider shipping costs be reconciled after payout approval or payment?

## Non-Goals

This document does not:

- create or migrate database schema
- rename existing API fields
- change finance calculations
- execute payouts
- mark payouts as paid
- create bank transfers
- generate invoices or tax documents
- integrate accounting providers
- change Shopify, return, refund, fulfillment, or shipping provider behavior
- decide seller-of-record or tax policy
