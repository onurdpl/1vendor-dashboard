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

Not yet implemented:

- Approved-settlement guard before payout batching
- Final payment approve lifecycle
- Payment execution lifecycle
- Mark-paid lifecycle
- Detailed payment blocker aggregation
- Audit/idempotency/rollback policy for final payment actions

### Approved Settlement Guard Rollout

Target rule:

Every payout batch candidate must eventually be backed by an `APPROVED` settlement snapshot.

Current rollout decision:

Do not hard-enable this guard immediately.

Required rollout sequence:

1. Read-only diagnostic report / audit mode
2. Production data compatibility check
3. Backfill or legacy handling if needed
4. Soft warning mode
5. Hard enforcement for new payout batch preparation
6. Hard enforcement for mark-review/final release
7. Future immutable traceability via `PayoutBatchLine.settlementApprovalLineId`

Reason:

Hard enforcement may block legacy production payout rows because `PayoutBatch` existed before `SettlementApproval`. Legacy rows may lack approved settlement linkage, `PayoutBatchLine` does not yet store `settlementApprovalLineId`, and production compatibility is `UNKNOWN` until verified.

Rule:

Any implementation of the approved-settlement guard must first prove production compatibility or include an explicit legacy strategy.

Initial production launch assumption:

- Initial production launch will use fresh vendor profiles and fresh finance data.
- Legacy payout batch / settlement approval backfill is not required for launch if no historical finance rows are imported.
- Approved-settlement guard can be implemented as hard enforcement for new payout preparation after a final read-only code audit confirms no historical finance data will be migrated.
- If historical finance data is ever imported later, the diagnostic/backfill flow becomes mandatory before enabling/importing payment preparation.

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
- Future payout execution

Payment Preparation is the target final financial release gate. Every vendor payment must pass Payment Preparation before money can leave the marketplace.

Final payment approval, execution, mark-paid behavior, and rollback policy are not implemented yet.

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

Refund Review represents read-only operational evidence for automatic Refund Adjustments. It must not imply manual refund adjustment apply, block, cancel, or reopen work during normal operations.

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

- Whether final payout execution exists.
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
