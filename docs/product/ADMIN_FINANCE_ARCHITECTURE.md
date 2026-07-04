# Admin Finance Architecture

## Purpose

This document is the single source of truth for the Admin Finance product architecture.

Future Admin Finance work must follow this document before introducing new routes, pages, workflow labels, queue states, or finance navigation.

## Design Principle

Admin Finance is not an accounting screen.

Admin Finance is not a reporting screen.

Admin Finance is an Operations Workspace.

Its primary purpose is helping finance operators make daily financial decisions.

Accounting evidence exists only to support those decisions.

## Permanent Finance Release Architecture

The permanent Admin Finance release workflow is:

```text
Shopify Financial Event
↓
Automatic Finance Ledger
↓
Automatic Refund Adjustment
↓
Settlement Review
↓
Approve Settlement Snapshot
↓
Payment Preparation
↓
Final Payment Release Gate
↓
Payment Execution
↓
Payment History
```

Rules:

1. Shopify is the financial source of truth.
2. Refund Adjustments are automatic and read-only operational evidence.
3. Finance operators do not manually apply, block, cancel, or reopen refund adjustments during normal operations.
4. Settlement Review approves or cancels settlement snapshots.
5. Settlement Review is not the final payment release gate.
6. Payment Preparation is the intended final financial release gate.
7. Every vendor payment must pass Payment Preparation before money can leave the marketplace.

### Current Backend Status

Already implemented:

- Automatic refund adjustments
- Settlement approve/cancel
- Scheduled draft creation
- Payment batch preparation
- Payment review transition
- Payment batch cancellation
- Approved Settlement Guard before payout batching and mark-review
- Manual EFT Mark Paid lifecycle
- Payment confirmation evidence on payout batches
- Paid timeline backed by payment confirmation evidence
- Vendor paid visibility backed by payment confirmation evidence
- Payment history from Mark Paid evidence

Launch future:

- None for the approved Manual EFT launch model.

Long-term future:

- Separate final payment approval lifecycle, if the business introduces one after launch
- Bank/provider payment execution lifecycle
- Expanded payment blocker aggregation and reporting
- Payment reversal or rollback policy beyond idempotent Mark Paid rejection
- Immutable payout traceability via `PayoutBatchLine.settlementApprovalLineId`
- ERP payment automation

### Approved Settlement Guard Status and Rollout History

Target rule:

Every payout batch candidate must eventually be backed by an `APPROVED` settlement snapshot.

Current implementation status:

- Implemented.
- Payment Preparation requires approved settlement backing before payout batch preparation.
- Mark-review revalidates approved settlement backing before moving a payout batch into review.
- The shared eligibility flow validates:

```text
FinanceLedgerEntry
↓
SettlementApprovalLine
↓
SettlementApproval.status == APPROVED
```

Rollout history:

The approved-settlement guard was originally documented as unsafe to hard-enable until launch data assumptions were proven.

Historical rollout sequence:

1. Read-only diagnostic report / audit mode
2. Production data compatibility check
3. Backfill or legacy handling if needed
4. Soft warning mode
5. Hard enforcement for new payout batch preparation
6. Hard enforcement for mark-review/final release
7. Future immutable traceability via `PayoutBatchLine.settlementApprovalLineId`

Historical reason:

Hard enforcement may block legacy production payout rows because `PayoutBatch` existed before `SettlementApproval`. Legacy rows may lack approved settlement linkage, `PayoutBatchLine` does not yet store `settlementApprovalLineId`, and production compatibility is `UNKNOWN` until verified.

Rule:

Any future change to the approved-settlement guard must first prove production compatibility or include an explicit legacy strategy.

Initial production launch assumption:

- Initial production launch will use fresh vendor profiles and fresh finance data.
- Legacy payout batch / settlement approval backfill is not required for launch if no historical finance rows are imported.
- Approved-settlement guard is implemented as hard enforcement for new payout preparation and mark-review.
- If historical finance data is ever imported later, the diagnostic/backfill flow becomes mandatory before enabling/importing payment preparation.

## Manual EFT Payment Lifecycle

The approved production launch model uses manual EFT outside the application.

Workflow:

```text
Settlement Review
↓
Approve Settlement Snapshot
↓
Payment Preparation
↓
Prepare Batch
↓
Mark Review
↓
Manual EFT
(outside the application)
↓
Mark Paid
↓
Vendor Finance
↓
Payment History
```

Rules:

1. The application does not execute bank transfers.
2. Accounting performs EFT outside the system.
3. The application records and audits payment confirmation.
4. Payment Preparation remains the final financial release gate.
5. Manual EFT Mark Paid is a payment-confirmation workflow.
6. Manual EFT Mark Paid is not settlement approval, bank transfer execution, automatic payout execution, or a refund adjustment action.

Payment Preparation responsibilities:

- validate blockers
- prepare payout batches
- review payout batches
- record payment completion
- provide payment history

Payment Preparation is not responsible for executing bank transfers.

### Manual EFT Mark Paid Evidence Model

Manual EFT Mark Paid confirms that accounting has completed an external EFT for an entire payout batch.

It is a payment-confirmation workflow. It is not:

- settlement approval
- bank transfer execution
- automatic payout execution
- refund adjustment apply/block/cancel/reopen

Status semantics:

When settlement is approved but money has not been sent:

- do not set `payoutStatus = PAID`
- do not set `settlementStatus = SETTLED`
- do not set `settledAt`

When manual EFT has been completed and an admin confirms Mark Paid:

- set `payoutStatus = PAID`
- set `settlementStatus = SETTLED`
- set `settledAt = paidAt`

Meaning:

- `PAID` means actual vendor payment evidence exists.
- `SETTLED` means the ledger row is financially closed after payment evidence.
- `settledAt` represents payment confirmation time for paid ledger rows.

Required payment evidence:

- `paidAt` is required.
- `paidByUserId` is required.
- `paymentSource = manual_eft` is required.
- `payoutBatchId` is required.
- paid amount and currency must be retained.
- included payout batch lines and ledger rows are retained through payout batch membership.
- `paymentReference` is optional.
- internal finance note is optional.

Idempotency and rejection rules:

- Mark Paid must be idempotency-safe.
- A payout batch cannot be marked paid twice.
- Already paid batches must be rejected.
- Cancelled batches must be rejected.

Batch scope:

- Mark Paid operates on the entire payout batch.
- Admin UI must not mark individual payout lines paid.
- Included ledger rows are updated through payout batch membership.

Vendor Finance paid visibility:

- Vendor Finance must show paid status only after real payment evidence exists.
- `PAID_PLACEHOLDER` is not real paid evidence.
- Vendor-facing paid status must come from payment confirmation evidence together with `payoutStatus = PAID`, `settlementStatus = SETTLED`, and `settledAt`.

Future compatibility:

- Manual EFT is the launch payment source.
- Future bank/provider integration can replace the payment source and reference origin without changing the meaning of Mark Paid.
- Bank execution and automatic payment execution remain future work.

### Current Launch Scope

Implemented:

- Prepare Batch
- Mark Review
- Cancel Batch
- Approved Settlement Guard
- Mark Paid
- Payment confirmation evidence
- Paid timeline
- Vendor paid visibility
- Payment history from Mark Paid evidence

Remaining launch scope:

- None for the approved Manual EFT launch model.

Future, not launch:

- Bank integration
- Automatic payment execution
- ERP payment automation
- Immutable payout traceability
- Payment reversal policy

## Primary Question

Every Admin Finance screen must answer:

> What financial decisions require my attention today?

Admin Finance must not make the first question:

> How is the accounting system implemented?

## Admin Workspace Structure

The long-term Admin Finance structure is:

```text
Admin Workspace
↓
Finance Operations
↓
Settlement Approvals
↓
Scheduled Settlements
↓
Payments
↓
Evidence & Invoices
↓
Diagnostics
```

Finance Operations is the primary Finance home.

## Page Responsibilities

### Finance Operations

Purpose:

Single operational finance queue.

Contains:

- Decision items
- Workflow tabs
- Advanced filters
- Decision table
- Persistent detail panel

Does not contain accounting evidence by default.

Finance Operations answers:

- What needs review?
- Why?
- What is the money impact?
- What is the next action?
- Where is the evidence link?

### Settlement Approvals

Purpose:

Settlement workflow.

Contains:

- Preview
- Approve
- Cancel
- Evidence only when a settlement is selected

Settlement Approvals approves or cancels settlement snapshots only. It is not the final payment release decision.

Settlement Approvals is a secondary workflow and detail workspace. It is not the primary Admin Finance home.

### Scheduled Settlements

Purpose:

Draft generation and schedule management.

Scheduled Settlements is not the daily finance queue.

It supports finance operations by identifying vendors that are due for draft settlement creation.

### Payments

Purpose:

Payment lifecycle and Payment Preparation.

Contains:

- Ready
- Blocked
- Paid
- Manual EFT payment confirmation
- Payment history

Payment Preparation is the target final financial release gate. Every vendor payment must pass Payment Preparation before money can leave the marketplace.

For launch, accounting performs EFT outside the application and Payment Preparation records payment completion inside the application.

Payment Preparation does not execute bank transfers.

Mark-paid behavior, payment confirmation evidence, paid timeline, vendor paid visibility, and payment history are implemented for the approved Manual EFT launch model.

Automatic payment execution, bank integration, ERP payment automation, immutable payout traceability, and payment reversal policy are future work, not launch scope.

### Evidence & Invoices

Purpose:

Accounting evidence.

Contains:

- Logo
- İşbaşı
- Commission invoices
- Snapshots
- Audit

Evidence & Invoices supports decisions. It must not become the primary daily operations queue.

### Diagnostics

Purpose:

Internal troubleshooting and provider/runtime diagnostics.

Diagnostics may expose implementation detail because it is admin-only evidence. It must remain separate from the primary decision queue.

## Finance Operations

Finance Operations becomes the primary Admin Finance page.

Its only responsibility is the Decision Queue.

It must answer:

- What needs review?
- Why is it waiting or blocked?
- Which vendor, order, or return is affected?
- What is the money impact?
- What action should the admin take?
- Where is the supporting evidence?

Finance Operations must not default to ledger rows, source snapshots, provider diagnostics, or invoice payloads.

## Decision Types

Use only existing concepts.

The supported decision types are:

- Settlement Approval
- Refund Review
- Shipping Review
- Balance Adjustment Review
- Finance Integrity Alert
- Blocked Payment
- Ready For Payment
- Scheduled Draft
- Commission Invoice Readiness

Refund Review represents read-only operational evidence for automatic Refund Adjustments. It must not imply manual refund adjustment apply, block, cancel, or reopen work during normal operations. Refund Adjustments remain automatic read-only evidence for daily Finance work.

Each decision item must contain:

- Decision Type
- Vendor
- Order
- Return
- Money Impact
- Reason
- Recommended Action
- Detail Link
- Evidence Link

If a field cannot be populated from current backend data, the value must be `UNKNOWN` until a backend contract supplies it.

## Workflow Tabs

Finance Operations workflow tabs are:

- All
- Needs Decision
- Settlement Approval
- Refund Review
- Shipping Review
- Blocked Payments
- Finance Alerts
- Ready For Payment
- Accounting Evidence

Workflow tabs are primary operational states. They are not ordinary filters.

## Page Classification

### Primary Workspace

- Finance Operations

### Secondary Workflows

- Settlement Approvals
- Scheduled Settlements
- Payments

### Detail Pages

- Settlement Detail
- Refund Detail
- Shipping Detail
- Finance Alert Detail

### Evidence Pages

- Logo
- İşbaşı
- Invoices
- Audit
- Diagnostics

## Backend

Future backend target:

```http
GET /admin/finance/decision-queue
```

Current backend remains unchanged.

No backend work is part of AF-1.

The unified decision queue backend contract is not implemented yet.

The following backend behavior is UNKNOWN:

- Whether future automatic payout execution should feed the unified Finance Decision Queue.
- Whether global settlement approval listing exists without a vendor filter.
- Whether scheduled draft readiness is stored persistently or only generated by dry run.
- Whether finance integrity alerts expose verified money impact in a queue-ready DTO.
- Whether commission invoice readiness should be surfaced globally or only inside settlement detail.

## Decision Queue Backend Contract

The future decision queue contract must provide one finance decision item shape across all supported decision types.

Required fields:

- `id`
- `decisionType`
- `status`
- `severity`
- `vendorId`
- `vendorName`
- `orderId`
- `orderNumber`
- `returnId`
- `refundId`
- `moneyImpact`
- `currency`
- `reason`
- `recommendedAction`
- `detailLink`
- `evidenceLink`
- `createdAt`
- `updatedAt`

Missing or unavailable fields must be returned as `UNKNOWN` or `null`, depending on the API convention selected during implementation.

No new business workflow should be invented for this contract. It should aggregate existing finance concepts first.

## Migration

### AF-1

Architecture document.

### AF-2

Finance Operations shell.

### AF-3

Decision queue backend aggregator.

### AF-4

Workflow tabs.

### AF-5

Decision table.

### AF-6

Right detail panel.

### AF-7

Settlement pages become detail workflows.

### AF-8

Admin `/finance` transaction review migration.

## Non-Goals

Do not redesign Vendor Finance.

Do not redesign accounting.

Do not redesign the settlement engine.

Do not redesign the payout engine.

Do not introduce new finance business logic.

Do not create new backend states without updating this document first.

This document only defines Admin Finance architecture.

## Golden Rule

Admin Finance screens help operators decide what to do with money today.

Accounting evidence explains the decision only after the operator needs proof.
