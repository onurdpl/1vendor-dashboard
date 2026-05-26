# Marketplace Finance Operational Workflow

## Purpose

This document defines the operational finance workflow before payout UX, payout execution, accounting integration, or settlement-state changes are implemented.

It complements `docs/FINANCE_SETTLEMENT_MODEL.md` by describing how marketplace finance work should move through operations. It does not change schema, UI, calculations, Shopify behavior, provider behavior, payout behavior, or accounting behavior.

## Hard Boundaries

- Do not assume the platform is Seller of Record.
- Do not treat estimated values as payable money.
- Do not execute payouts from this workflow.
- Do not integrate banks, accounting providers, or invoice providers from this workflow.
- Do not mutate current finance calculations without a separate implementation decision.
- Do not create finance deductions from a customer return request until refund or approved deduction evidence exists.
- Do not call values `balance` unless the amount is approved payable or the text is documenting a current legacy field name.

## Current Implementation Map

### Finance Entry Points

Current finance data enters the platform through these operational events:

1. Shopify order ingestion
   - Accepted vendor allocations create idempotent sale finance ledger rows.
   - Sale rows are vendor-scoped and allocation-related.
   - Active or default vendor finance profile values are snapshotted.

2. Shopify refund ingestion
   - `refunds/create` creates vendor-scoped refund records and refund finance ledger rows.
   - Refund rows use `payoutStatus = HOLD`.
   - Pending return requests do not create finance refund rows.

3. Fulfillment/shipping evidence
   - Fulfillment or shipping lifecycle evidence changes payout-readiness interpretation.
   - Current readiness is inferred from allocation/fulfillment/shipping state.

4. Shipping cost attachment
   - Admin-only `POST /admin/shipping-costs` persists shipment/provider cost evidence.
   - External-provider shipping deduction depends on confirmed or snapshotted cost evidence.

5. Payout batch preparation
   - Admin-only `POST /admin/payout-batches/prepare` creates a draft batch from eligible rows.
   - This is preparation/review only, not payment execution.

6. Invoice/accounting visibility
   - Existing invoice execution references are visibility/sync artifacts.
   - They do not finalize vendor settlement or payout state.

### Current Persisted Objects

- `VendorFinancialProfile`
  - commission percent
  - commission VAT percent
  - shipping deduction enabled flag
  - shipping deduction mode
  - fixed shipping fee

- `FinanceLedgerEntry`
  - sale/refund rows
  - payout status
  - commission/shipping snapshots
  - settlement readiness fields
  - payout batch references through `PayoutBatchLine`

- `ShipmentShippingCost`
  - provider/manual/imported shipping cost evidence

- `PayoutBatch`
  - draft/review preparation artifact
  - totals and line snapshots

- `PayoutBatchLine`
  - rows included in a payout batch artifact

### Current Calculations

Current sale payout preview calculation:

```text
gross amount
- commission
- commission VAT
- shipping deduction
- refund impact
= estimated payout
```

Current implementation details:

- Default profile is 10 percent commission, 0 percent commission VAT, shipping deduction disabled.
- Commission and commission VAT are calculated from gross sale amount.
- Shipping deduction applies only when shipping deduction is enabled and fulfillment/shipping evidence exists.
- Fixed shipping mode uses the configured fixed fee.
- External-provider shipping mode uses provider cost and VAT only when present in the calculation profile/snapshot.
- Refund impact fully reduces the vendor payout preview.
- Refund ledger rows reduce payout preparation by negative net amount.

### Current Estimated Values

The following current values are estimated or review-oriented:

- `payoutEstimate`
- per-row `estimatedPayout`
- draft payout batch `netAmount`
- payout batch eligible net amount
- current legacy summary fields named `accruedBalance`, `payableBalance`, `heldBalance`, and `pendingSettlement`
- order detail finance preview values
- dashboard finance snapshot values

### Current Confirmed Values

The following are confirmed operational facts, but not final payout authority:

- ingested Shopify order allocation amount
- persisted refund amount from `refunds/create`
- stored vendor financial profile values
- immutable profile snapshots on ledger rows
- persisted shipping cost evidence
- payout batch row membership
- fulfillment/shipping evidence timestamps or statuses

### Current Missing Capabilities

- approved payable amount
- payout execution
- bank transfer record
- payment confirmation
- payment reversal
- accounting export authority
- final vendor statement
- manual adjustment ledger workflow
- Seller of Record decision
- tax/VAT treatment decision
- chargeback/dispute policy
- return-window hold policy

## Operational Lifecycle

### High-Level Lifecycle Diagram

```text
Shopify order created
  |
  v
Vendor allocation accepted
  |
  v
Sale finance row recorded
  |
  v
Awaiting fulfillment/shipping evidence
  |
  v
Fulfillment or shipment confirmed
  |
  v
Return/refund window monitored
  |
  v
Estimated payout row becomes pending review
  |
  v
Operator review
  |
  +--> blocked / needs reconciliation
  |
  v
Approved for payout
  |
  v
Payout scheduled
  |
  v
Payout sent
  |
  v
Paid confirmation recorded
```

### Exception Lifecycle Diagram

```text
Return requested
  |
  v
Return shipment / inspection workflow
  |
  v
Refund decision
  |
  +--> no refund: no refund deduction
  |
  +--> refund created in Shopify
          |
          v
        Refund ledger row recorded
          |
          v
        Deduct from unpaid estimate or create future recovery workflow
```

### Adjustment Lifecycle Diagram

```text
Operator identifies mismatch
  |
  v
Support / finance review ticket
  |
  v
Evidence collected
  |
  +--> no adjustment
  |
  v
Manual adjustment proposal
  |
  v
Admin approval
  |
  v
Adjustment finance event / settlement line
```

Manual adjustment persistence is not implemented today.

## Proposed Finance Phases

### 1. `order_created`

Trigger:

- Shopify order ingestion creates or updates local order/allocation data.

Operational meaning:

- Order amount is known for the allocated vendor scope.
- No fulfillment or payout readiness is implied.

Finance output:

- Sale ledger row can be recorded.
- Commission profile snapshot should be captured.
- Value is an estimated sale position.

Who sees it:

- Vendor: order amount and estimated payout preview when exposed.
- Admin: full ledger row, profile snapshot, source Shopify references.
- Support: read-only context if tied to a support issue.

### 2. `awaiting_fulfillment`

Trigger:

- Sale row exists but fulfillment/shipping evidence is absent.

Operational meaning:

- Vendor amount is not ready for payout review.
- Shipping deduction may be unknown or not applicable.

Finance output:

- Estimated payout preview only.
- Unknown shipping/provider cost must show as pending or unknown, not zero, if policy requires provider evidence.

### 3. `fulfillment_confirmed`

Trigger:

- Fulfillment, shipment, in-transit, or delivery evidence exists.

Operational meaning:

- The sale may become eligible for settlement review.
- This is not automatic payment approval.

Finance output:

- Row can move from accruing estimate to pending review.
- Shipping deduction policy is evaluated.
- External-provider shipping cost may still block or flag review if missing.

### 4. `return_window_open`

Trigger:

- Business policy keeps a return/refund risk period open.

Operational meaning:

- This platform has not finalized whether the return window delays payout.
- Current code does not enforce a return-window hold.

Finance output:

- Until policy is decided, show review caution rather than final payable language.

Decision required:

- Whether payout review waits for the return window.
- Whether certain vendors/categories bypass this hold.
- Whether delivered date or order date controls the hold.

### 5. `estimated_payout`

Trigger:

- Sale/refund/shipping evidence is sufficient to calculate a current preview.

Operational meaning:

- The amount is calculated but not approved.

Finance output:

- `netPayoutEstimate`
- separated deduction rows:
  - marketplace commission
  - commission VAT
  - shipping deduction
  - refund deduction
  - manual adjustment, future

UI rule:

- Always label as estimate or preview.

### 6. `pending_review`

Trigger:

- Row has enough evidence for operator review.
- Existing current examples: settlement status is `payable` or `partially_refunded`, and row is not already in an active payout batch.

Operational meaning:

- Finance operations should review before approval.
- Negative or refund-heavy rows require extra attention.

Finance output:

- Eligible rows can be collected into draft payout review artifacts.
- Draft batch is not a payment promise.

### 7. `approved_for_payout`

Trigger:

- Future explicit admin approval.

Operational meaning:

- Amount is approved payable.
- This is the first phase where payable language can be used without caveat.

Finance output:

- `approvedPayableAmount`
- approval actor
- approval timestamp
- immutable included line snapshot

Not implemented today.

### 8. `payout_scheduled`

Trigger:

- Future payout provider, banking workflow, or operator schedule action.

Operational meaning:

- Approved amount is queued for payment.
- Payment is still not confirmed.

Finance output:

- scheduled timestamp
- expected payment date
- payment provider reference if known

Not implemented today.

### 9. `payout_sent`

Trigger:

- Future payment execution attempt.

Operational meaning:

- Money movement was attempted.
- Confirmation may still be pending.

Finance output:

- provider execution reference
- sent timestamp
- failure/return reason if any

Not implemented today.

### 10. `paid`

Trigger:

- Explicit payment confirmation evidence.

Operational meaning:

- Payment is confirmed.

Finance output:

- paid timestamp
- payment reference
- immutable final statement line references

Rule:

- `PAID_PLACEHOLDER` is not enough.

### 11. `reversed_or_adjusted`

Trigger:

- Refund, chargeback, correction, or operator-approved adjustment after approval/payment.

Operational meaning:

- Do not rewrite old approved/paid history.
- Add reversal or adjustment evidence.

Finance output:

- reversal event
- adjustment line
- future vendor recovery workflow if already paid

Not implemented today.

## Deduction Model

### Marketplace Commission

Source:

- vendor financial profile or ledger snapshot.

Current behavior:

- commission = gross amount x commission percent.
- active profile edits apply to future calculations unless a row already has a snapshot.

Operational rule:

- Show snapshot source to admins.
- Show readable commission deduction to vendors.

### Commission VAT

Source:

- vendor financial profile or ledger snapshot.

Current behavior:

- commission VAT = commission x commission VAT percent.

Unknown:

- Tax authority and Seller of Record treatment are not finalized.

Operational rule:

- Treat as a configured deduction preview until tax/accounting policy is approved.

### Shipping Deduction

Source options:

- disabled
- fixed configured fee
- confirmed provider cost
- imported/manual shipping cost evidence

Current behavior:

- applies only after fulfillment/shipping evidence.
- external-provider mode requires provider cost evidence in the profile/snapshot.

Operational rule:

- Separate shipping deduction from commission and refund.
- Missing provider cost should show `pending_provider_cost` or `Unknown`, not a quiet final zero.
- Late provider cost after payout approval requires a future adjustment policy.

### Refund Deduction

Source:

- Shopify `refunds/create` or future explicit refund workflow.

Current behavior:

- refund rows reduce payout preparation.
- pending return requests are finance-neutral.

Operational rule:

- Refund impact must be separated from sale estimate.
- Refund after payout requires future recovery or reversal workflow.

### Manual Adjustment

Source:

- future admin-approved finance operation.

Current behavior:

- no formal manual finance adjustment model exists.
- support tickets and operational recommendations can capture investigation context, but they do not mutate finance.

Operational rule:

- Manual adjustment must require reason, evidence, actor, vendor scope, allocation/order references, and approval.

### Tax / VAT Unknowns

Unknown:

- Seller of Record.
- whether platform commission, shipping, refund, and vendor payout VAT require separate statement lines.
- whether accounting provider output is authoritative.

Operational rule:

- Keep tax/VAT language conservative.
- Do not create tax-final labels until confirmed.

## Payout Philosophy

### Are Payouts Estimated Until Manual Approval?

Yes. Under the proposed workflow, payouts remain estimated until explicit admin approval creates an approved payable amount.

Current code can identify rows that are ready for review, but it does not create final approved payable money.

### Does The Return Window Delay Payout?

Unknown. The workflow reserves a `return_window_open` phase, but no rule is finalized.

Recommended operating stance until policy is approved:

- show return/refund risk as review context.
- do not silently approve payout just because fulfillment exists.
- avoid final payable wording during unresolved return-risk periods.

### Can Negative Vendor Amounts Exist?

Yes, operationally. Refund-heavy rows or batches can create negative draft net amounts.

Current code already warns when draft payout batch net amount is negative.

Recommended future rule:

- negative amounts become blocked or pending review.
- recovery from future payouts requires explicit policy.

### Can Refunds Reverse Paid Payouts?

They should not mutate paid history.

If refund happens after a confirmed payout, use a future recovery or adjustment workflow:

- create a reversal/adjustment event
- tie it to the original paid payout
- decide whether to recover from next payout, invoice the vendor, or absorb as platform cost

This is not implemented today.

### How Should Pending And Approved States Work?

Recommended distinction:

- `estimated`: calculated from current evidence.
- `pending_review`: enough evidence for finance review.
- `approved_for_payout`: admin has approved a payable amount.
- `payout_scheduled`: approved amount queued for payment.
- `payout_sent`: payment attempt made.
- `paid`: payment confirmed.
- `blocked`: missing evidence, dispute, negative amount, or manual hold.
- `reversed_or_adjusted`: correction after approval/payment.

## Responsibility Boundaries

### Vendor View

Vendors should see:

- their own vendor-scoped finance rows.
- estimated payout previews with clear labels.
- separated commission, shipping, and refund deductions.
- return/refund impact.
- payout review status when available.
- support path for questions or corrections.

Vendors should not see:

- other vendors' finance rows.
- admin diagnostics or cross-vendor payout batches.
- internal provider response payloads.
- controls to approve, schedule, mark paid, or manually adjust finance rows.

### Admin View

Admins should see:

- vendor-scoped finance rows and summaries.
- finance profile configuration.
- profile snapshot source.
- settlement readiness and missing evidence.
- shipping cost attachment/import status.
- payout batch preparation and review artifacts.
- invoice/accounting visibility references.
- support and operational recommendations.

Admins may perform:

- profile configuration.
- shipping cost evidence attachment.
- draft payout batch preparation.
- future payout approval only after a separate implementation.
- future manual adjustments only after a separate implementation.

### Support View

Support should see:

- read-only finance explanation.
- refund/shipping/commission status in safe language.
- linked tickets and operational context.
- escalation path to admin/finance operations.

Support should not:

- approve payouts.
- change finance profiles.
- create manual finance adjustments unless a future role permits it.
- mark paid.

### Automated System Responsibilities

The system may auto-calculate:

- sale estimate from ingested allocation amount.
- commission preview from profile/snapshot.
- shipping deduction preview from configured rule and available evidence.
- refund deduction from refund ledger evidence.
- eligibility for review.

The system should not auto-decide:

- final payable approval.
- bank payment execution.
- tax/accounting authority.
- dispute resolution.
- negative payout recovery.

## Operational Workflow

### Daily Finance Review

```text
Open Finance workspace
  |
  v
Review rows by vendor and status
  |
  +--> missing shipping cost: attach/import evidence or leave pending
  |
  +--> refund impact: verify refund row and affected allocation
  |
  +--> negative draft: investigate before approval
  |
  +--> clean eligible rows: prepare draft payout batch
  |
  v
Move draft to review
  |
  v
Future approval workflow
```

### Return/Refund Impact Review

```text
Return request received
  |
  v
No finance deduction yet
  |
  v
Refund created or approved refund workflow completes
  |
  v
Refund ledger row recorded
  |
  v
Affected sale estimate/review amount updated
  |
  v
If already paid: future recovery workflow required
```

### Shipping Deduction Review

```text
Shipment or fulfillment evidence exists
  |
  v
Check vendor shipping deduction policy
  |
  +--> disabled: no shipping deduction
  |
  +--> fixed: apply fixed fee estimate
  |
  +--> external provider: require provider cost evidence
          |
          +--> cost missing: pending provider cost
          |
          +--> cost confirmed: include deduction
```

### Payout Batch Preparation

```text
Eligible rows identified
  |
  v
Admin prepares draft batch
  |
  v
Rows snapshot into batch
  |
  v
Batch reviewed
  |
  +--> cancelled: rows released
  |
  +--> approved: future explicit approval state
  |
  v
Future scheduling/payment workflow
```

Current implementation supports draft preparation, review marking, cancellation, and placeholder statuses. It does not execute or confirm payment.

## Future Integration Boundaries

### Accounting Providers

Future accounting integration may:

- export reviewed settlement lines.
- sync invoice/statement visibility.
- provide accounting document identifiers.

It must not silently become payout truth unless product/legal policy confirms it.

### Payout Providers

Future payout provider integration may:

- schedule approved payout activities.
- return execution references.
- confirm payment.
- report failed payment or reversal.

It must require approved payable input.

### Bank Transfer Reconciliation

Future bank reconciliation may:

- match approved payout activities to bank transactions.
- confirm `paid`.
- detect partial/failed payments.

It must be idempotent and auditable.

### Vendor Invoice Visibility

Future vendor statements/invoices may:

- show approved payout activity.
- show deductions and refund impacts.
- expose provider/accounting references.

They must not expose unapproved estimates as payable commitments.

### Settlement Exports

Future exports should include:

- vendor id
- allocation/order references
- line-level gross amount
- commission deduction
- shipping deduction
- refund deduction
- manual adjustment lines
- approved payable amount
- payout status
- evidence timestamps

## Unresolved Business Decisions

- Seller of Record responsibility.
- Whether payout waits for return window.
- Return-window duration and source date.
- Whether delivered date, fulfillment date, or order date drives payout review.
- Who pays forward shipping under each provider and vendor policy.
- Who pays return shipping under each return reason.
- Commission refund policy.
- Commission VAT and shipping VAT treatment.
- Treatment of chargebacks and Shopify payment disputes.
- Negative vendor amount recovery.
- Manual adjustment approval roles.
- Payment confirmation source.
- Whether accounting provider records are authoritative or visibility-only.
- Whether payout batches can include multiple currencies.
- Whether vendors receive formal statements before or after payment.

## Implementation Entry Criteria

Before implementing payout UX or payout states, confirm:

- final terminology for estimated vs approved payable values.
- payout review and approval roles.
- return-window hold policy.
- negative payout policy.
- refund-after-paid policy.
- shipping deduction source-of-truth policy.
- whether current legacy `balance` field labels should be renamed or compatibility-mapped.

Before implementing payout execution, additionally confirm:

- payment provider or bank workflow.
- payment confirmation evidence.
- failure/retry/reversal semantics.
- audit export requirements.
- tax/accounting ownership.
