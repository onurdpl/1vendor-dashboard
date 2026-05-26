# Finance Event Timeline Model

## Purpose

This document defines the foundation for finance-related operational timelines on Order Detail and future Finance pages.

It is discovery and design only. It does not add schema, persist new events, implement payout execution, integrate accounting providers, change settlement calculations, or invent fake finance events.

The goal is to make finance history readable while preserving the current truth boundary:

- persisted finance rows and payout batch artifacts are operational evidence.
- generated finance preview entries are explanatory simulations.
- provider, Shopify, support, and reconciliation records can add context but do not automatically become settlement authority.

## Files And Sources Inspected

- `docs/FINANCE_SETTLEMENT_MODEL.md`
- `docs/MARKETPLACE_FINANCE_WORKFLOW.md`
- `docs/ORDER_FINANCE_DRILLDOWN_MODEL.md`
- `backend/prisma/schema.prisma`
  - `VendorAllocation`
  - `VendorAllocationLineItem`
  - `ReturnRecord`
  - `RefundRecord`
  - `FinanceLedgerEntry`
  - `ShipmentShippingCost`
  - `PayoutBatch`
  - `PayoutBatchLine`
  - `SupportTicket`
  - `OperationalSignal`
  - `OperationalJob`
- `backend/src/modules/finance/finance-ledger.types.ts`
- `backend/src/modules/finance/finance-ledger.ts`
- `backend/src/modules/finance/finance-ledger-preview.service.ts`
- `backend/src/modules/finance/sale-ledger.service.ts`
- `backend/src/modules/finance/finance.service.ts`
- `backend/src/modules/shopify/refund-ingestion.service.ts`
- `backend/src/modules/orders/orders.service.ts`
- `backend/src/modules/returns/returns.service.ts`
- `src/pages/OrderDetailPage.tsx`
- `src/pages/FinancePage.tsx`
- `src/pages/ReturnDetailPage.tsx`
- `src/components/OperationalTimeline.tsx`
- `src/lib/operationalCrossLinks.ts`

## Current Event Sources

### Durable Finance Evidence

`FinanceLedgerEntry` is the current durable finance row model. It is vendor-scoped and optionally allocation-scoped.

Currently persisted rows are coarse-grained:

- `entryType = sale`
  - created/upserted by `upsertSaleLedgerForAllocation`.
  - amount comes from allocation line item sums.
  - commission, VAT, shipping profile, and shipping cost evidence can be snapshotted.
  - settlement fields can carry `PENDING`, `ACCRUING`, `PAYABLE`, `PARTIALLY_REFUNDED`, `HELD`, `SETTLED`, or `DISPUTED`.
- `entryType = refund`
  - created/upserted from Shopify `refunds/create`.
  - amount comes from vendor-scoped refund allocation.
  - payout status is currently held.

The durable row does not currently store the fine-grained `FinanceLedgerEventType` values used by the in-memory preview ledger.

### Generated Finance Preview Entries

`finance-ledger.ts` and `finance-ledger-preview.service.ts` generate explanatory preview entries:

- `ORDER_CREATED`
- `PAYMENT_CAPTURED`
- `MARKETPLACE_COMMISSION_RESERVED`
- `VENDOR_PAYABLE_RESERVED`
- `SHIPPING_COST_RESERVED`
- `RETURN_CREATED`
- `REFUND_APPROVED`
- `REFUND_COMPLETED`
- `COMMISSION_REVERSED`
- `VENDOR_PAYABLE_REVERSED`
- `VENDOR_DEBT_CREATED`
- `MANUAL_ADJUSTMENT`

These are not durable events today. They are useful for admin diagnostics and future UI language, but they must be labeled as preview/inferred unless backed by persisted finance rows or another durable record.

### Shopify Operational Events

Current Shopify-derived operational evidence includes:

- order/allocation creation from order ingestion.
- return lifecycle records in `ReturnRecord`.
- refund records and refund line items from `refunds/create`.

Rules:

- A return request is not a finance deduction by itself.
- A Shopify refund is finance evidence.
- Shopify webhook payloads are event envelopes. Canonical GraphQL state is preferred before destructive or authoritative operations.

### Provider And Shipping Evidence

Current provider/shipping finance evidence includes:

- `ShipmentShippingCost`
  - status: `PENDING`, `CONFIRMED`, `DISPUTED`, `IGNORED`.
  - source type: `MANUAL`, `IMPORTED`, `EXTERNAL_PROVIDER`.
- `ShipmentExecution`
  - provider shipment status, shipping cost, shipping VAT, and response snapshots.

Rules:

- confirmed shipping cost evidence can support a shipping deduction event.
- provider snapshots can support an estimated or pending deduction event.
- missing provider cost in external-provider mode must render as pending or unknown, not zero.

### Payout Review Artifacts

Current payout-related durable objects:

- `PayoutBatch`
  - statuses: `DRAFT`, `REVIEW`, `APPROVED`, `CANCELLED`, `EXECUTION_PENDING`, `PAID_PLACEHOLDER`.
- `PayoutBatchLine`
  - links finance rows into batch review artifacts.

Rules:

- draft/review batches are preparation artifacts.
- `PAID_PLACEHOLDER` is not bank/payment confirmation.
- future UI may show batch events, but must not call them final payment unless real payment evidence exists.

### Support And Manual Review Context

`SupportTicket`, `SupportTicketNote`, and `SupportTicketReply` can provide context around finance issues:

- support ticket opened.
- support reply added.
- support ticket escalated.
- support ticket resolved.

These are collaboration/review events, not finance mutations.

There is no durable manual finance adjustment workflow today. The preview type `MANUAL_ADJUSTMENT` exists as a future event concept, not an implemented adjustment source.

### Operational Signals And Jobs

`OperationalSignal`, `OperationalJob`, notifications, and automation actions can flag finance risk:

- stale payout review.
- negative payout draft.
- missing shipping cost for external-provider deduction.
- refund-heavy vendor risk.
- reconciliation gaps such as missing refund ledger.

These can appear as admin/review timeline context. They should not be shown as settlement facts.

## Current UI Timeline Behavior

### Order Detail

`OrderDetailPage` builds a unified operational timeline from:

- native order timeline entries.
- shipment/provider lifecycle events.
- return records.
- finance records from the finance dashboard.
- support tickets and replies.

Finance records currently appear as:

- `Finance entry created`
- `Refund processed`

These are admin-visible in the Order Detail timeline today.

### Finance Page

`FinancePage` has `getFinanceTimelineItems(record)` for a selected finance row:

- `Order recorded` or `Refund recorded`
- `Settlement estimate pending` or `Pending review`
- `Included in draft review` or `Payment evidence pending` when payout batch data exists

This is a UI-derived timeline, not a persisted event history.

### Return Detail

`ReturnDetailPage` builds a return timeline from:

- return lifecycle records.
- related finance records.
- support tickets.

Refund finance rows appear as refund/finance context for the return.

## Event Inventory

| Event | Current state | Source | Vendor visibility | Admin visibility | Notes |
| --- | --- | --- | --- | --- | --- |
| Order created | Real existing event | Shopify order ingestion / order timeline | Yes | Yes | Operational order event. Not by itself a settlement event. |
| Sale finance row recorded | Real existing finance row | `FinanceLedgerEntry.entryType = sale` | Yes, as finance row/estimate | Yes | Durable finance evidence, but not a final payout. |
| Commission estimated | Inferred | finance row calculation or finance preview entry `MARKETPLACE_COMMISSION_RESERVED` | Yes, as estimate | Yes, with source hints | Not a separate persisted event today. |
| Vendor settlement estimate calculated | Inferred | payout calculation / order finance preview | Yes | Yes | Must say estimated. |
| Shipping deduction pending | Inferred | finance calculation with external provider and missing cost | Yes | Yes | Use pending/unknown, not zero. |
| Shipping deduction estimated | Inferred or provider-backed | shipment snapshot or payout calculation | Yes, if vendor-safe | Yes | If only snapshot-backed, label as estimate. |
| Shipping cost confirmed | Real existing evidence | `ShipmentShippingCost.status = CONFIRMED` | Yes, if scoped to vendor/order | Yes | Stronger than provider snapshot but still not payment execution. |
| Return requested | Real existing operational event | `ReturnRecord` / Shopify return lifecycle | Yes | Yes | Finance-neutral until refund or approved deduction evidence exists. |
| Refund recorded | Real existing finance row | `RefundRecord` and `FinanceLedgerEntry.entryType = refund` | Yes | Yes | This is finance-impacting evidence. |
| Refund approved | Inferred preview event today | preview `REFUND_APPROVED` | No by default | Yes | Not persisted separately. Future event should be backed by Shopify refund/refund lifecycle evidence. |
| Refund completed | Inferred preview event today | preview `REFUND_COMPLETED` | No by default | Yes | Not persisted separately. |
| Commission reversed | Inferred preview event today | preview `COMMISSION_REVERSED` | Yes only as summarized refund impact | Yes | No durable line-level reversal event yet. |
| Vendor settlement reversed | Inferred preview event today | preview `VENDOR_PAYABLE_REVERSED` or `VENDOR_DEBT_CREATED` | Yes only as summarized refund impact | Yes | Requires careful wording if payout already happened. |
| Settlement pending review | Inferred | `settlement.payoutReady`, payout calculation, UI mapping | Yes | Yes | Current Finance UI derives this state. |
| Settlement held | Real existing state when persisted | `FinanceLedgerEntry.settlementStatus = HELD` or payout status `HOLD` | Yes, with high-level reason | Yes, with hold reason | Vendor should not see raw reconciliation internals. |
| Payout draft created | Real existing artifact | `PayoutBatch.status = DRAFT` | Possibly high-level only | Yes | Review artifact, not payment promise. |
| Payout review started | Real existing artifact | `PayoutBatch.status = REVIEW` | Possibly high-level only | Yes | Admin workflow state. |
| Payout approved | Real existing artifact state, not payment | `PayoutBatch.status = APPROVED` | Use carefully | Yes | Approved review is not bank transfer evidence. |
| Payout scheduled | Real existing artifact state, not payment | `PayoutBatch.status = EXECUTION_PENDING` | Use carefully | Yes | Requires future execution semantics before stronger wording. |
| Payout sent | Future concept | future payout provider/bank evidence | No until implemented | No until implemented | Not modeled. |
| Payment evidence pending | Real placeholder state | `PayoutBatch.status = PAID_PLACEHOLDER` | Maybe hidden or explicitly caveated | Yes | Must not be displayed as paid. |
| Payout reversed | Future concept | future reversal/adjustment workflow | No | No until implemented | Not modeled. |
| Manual adjustment proposed | Future concept | future admin adjustment workflow | No until implemented | No until implemented | `MANUAL_ADJUSTMENT` exists only as preview type. |
| Manual adjustment applied | Future concept | future durable adjustment line | No until implemented | No until implemented | Requires audit trail and actor. |
| Finance support ticket opened | Real collaboration event | `SupportTicket` | Yes if scoped to vendor/order | Yes | Context only, not settlement mutation. |
| Operational signal raised | Real review signal | `OperationalSignal` | Vendor-safe subset only | Yes | Review/risk signal, not a finance event by itself. |

## Proposed FinanceEvent Model

This is a future model proposal only. Do not implement until finance event persistence is explicitly requested.

```ts
type FinanceEvent = {
  id: string;
  type: FinanceEventType;
  timestamp: string;
  source: FinanceEventSource;
  actorType: 'system' | 'admin' | 'vendor' | 'support' | 'provider' | 'shopify' | 'automation';
  actorName: string | null;
  amountImpact: string | null;
  currency: string | null;
  visibility: 'vendor' | 'admin' | 'support';
  relatedOrderId: string | null;
  relatedAllocationId: string | null;
  relatedFinanceLedgerEntryId: string | null;
  relatedPayoutBatchId: string | null;
  relatedReturnId: string | null;
  relatedRefundId: string | null;
  metadata: Record<string, unknown>;
};
```

Suggested `FinanceEventType` values:

- `order_sale_recorded`
- `commission_estimated`
- `shipping_deduction_pending`
- `shipping_cost_confirmed`
- `refund_recorded`
- `refund_impact_estimated`
- `settlement_estimate_updated`
- `settlement_pending_review`
- `settlement_held`
- `payout_batch_created`
- `payout_batch_review_started`
- `payout_batch_approved`
- `payout_batch_scheduled`
- `payment_evidence_pending`
- `manual_adjustment_proposed`
- `manual_adjustment_applied`
- `finance_support_opened`
- `finance_signal_raised`

Suggested `FinanceEventSource` values:

- `shopify_order`
- `shopify_refund`
- `shopify_return`
- `finance_ledger`
- `finance_preview`
- `shipping_cost`
- `shipment_provider_snapshot`
- `payout_batch`
- `support`
- `operational_signal`
- `manual_review`
- `system`

## Visibility Rules

### Vendor

Vendor timelines should show operational lifecycle, not raw reconciliation internals:

- sale finance row recorded.
- commission estimate.
- shipping deduction pending/estimated/confirmed when scoped to their allocation.
- refund recorded and refund impact estimated.
- settlement estimate pending or pending review.
- payout batch review state only if wording avoids payment certainty.
- support ticket context when linked to that vendor/order/finance row.

Vendor timelines should not show:

- raw unknown keys such as `shipping_cost` or `commission_rate`.
- internal rule keys.
- raw provider response payloads.
- admin-only reconciliation signals unless converted to vendor-safe language.
- future-only payout sent/reversed events before implementation.

### Admin

Admin timelines may show:

- everything visible to vendors.
- raw finance unknown keys.
- source type and source record id.
- operational signal rule key.
- payout batch status transitions.
- missing shipping cost, stale payout review, negative payout draft, and missing refund ledger signals.
- support notes/replies when linked and permitted.

Admin timelines still must not expose:

- raw customer PII.
- provider secrets or raw API payloads.
- Shopify webhook bodies.
- unverified bank/payment claims.

### Support

Support visibility can mirror vendor-safe lifecycle plus ticket context unless a future support role is granted admin finance permissions.

## Timeline UX Proposal

### Order Detail Finance Timeline Section

Future Order Detail can include a compact, collapsed-by-default `Finance timeline` below the settlement preview or inside advanced finance details.

Example vendor-safe labels:

```text
Commission estimated
Shipping deduction pending
Refund impact estimated
Settlement awaiting review
Payout review prepared
```

Example admin labels:

```text
Sale finance row recorded
Commission estimated from profile snapshot
External-provider shipping cost missing
Refund ledger row recorded
Draft payout batch created
Operational signal raised: missing shipping cost
```

UX rules:

- Put `Estimated`, `Pending`, `Review`, `Blocked`, or `Evidence pending` badges next to uncertain events.
- Use `Unknown` when source evidence is missing.
- Never use `Paid`, `Confirmed payout`, or `Balance settled` unless future payment/reconciliation evidence exists.
- Link event rows to Finance, Return, Support, or Shipping evidence when safe.
- Show amount impact only when backed by persisted finance rows or clearly labeled preview values.
- Sort chronologically by source timestamp.
- Deduplicate repeated inferred events by source record id and event type.

### Future Finance Page Timeline

The Finance page already has a row-level operational timeline. Future work can replace or enrich `getFinanceTimelineItems(record)` with event objects derived from the proposed source model:

- finance row created.
- settlement estimate state changed.
- payout batch linked.
- review state changed.
- support/reconciliation signal linked.

Until a durable `FinanceEvent` model exists, the UI should continue to call this an operational timeline, not an audit trail.

## Event Source Boundaries

### Shopify

Use Shopify sources for:

- order/allocation facts.
- refund records.
- return lifecycle context.

Do not use Shopify return requests as refund deductions until refund evidence exists.

### Shipping Provider

Use provider/shipping sources for:

- shipment cost evidence.
- delivery/fulfillment context that affects settlement readiness.

Do not treat provider cost snapshots as confirmed settlement deductions unless policy or `ShipmentShippingCost.status = CONFIRMED` supports it.

### Finance Ledger

Use finance ledger rows for:

- sale finance row recorded.
- refund finance row recorded.
- settlement status.
- payout status.
- profile and shipping cost snapshots.

Do not split a coarse persisted row into multiple "real" events unless those events are explicitly generated as inferred preview events.

### Payout Batch

Use payout batch sources for:

- draft review created.
- review started.
- approved review artifact.
- execution pending artifact.
- payment evidence pending placeholder.

Do not use payout batch sources as bank transfer evidence.

### Manual Admin Action

Future manual actions require:

- actor id/name.
- reason.
- amount impact.
- reversal/adjustment linkage.
- vendor visibility classification.
- immutable audit record.

No current durable manual adjustment source exists.

## Recommended Incremental Implementation Path

1. Add pure frontend derivation only.
   - Build a `buildFinanceTimelineEvents` helper from existing `FinanceTransaction`, `financeLedgerPreview`, `ReturnRecord`, `ShipmentShippingCost`, `PayoutBatch`, `SupportTicket`, and `OperationalSignal` DTOs.
   - Label inferred preview events clearly.
   - No schema change.

2. Add backend DTO aggregation.
   - Return a vendor-safe `financeTimeline` array from detail endpoints.
   - Keep raw diagnostics admin-only.
   - Still no new persistence.

3. Add durable event persistence only after workflow decisions.
   - Introduce `FinanceEvent` when manual adjustments, payout approval, or accounting/bank evidence need immutable audit history.

4. Wire timeline to Order Detail and Finance page.
   - Use the existing `OperationalTimeline` component.
   - Keep finance events collapsed or compact on Order Detail.

## Unresolved Business Decisions

- Whether payout approval should be visible to vendors before payment evidence exists.
- Whether `PayoutBatch.status = APPROVED` means finance approved only or vendor-visible approved settlement.
- Whether `EXECUTION_PENDING` is a scheduled payout or only an internal preparation state.
- Whether `PAID_PLACEHOLDER` should ever be visible to vendors.
- How manual adjustments are requested, approved, reversed, and exposed.
- How negative vendor positions should be recovered.
- Whether return-window holds are required before settlement review.
- Whether provider shipping snapshots can become confirmed deductions without admin review.
- Whether finance events should be order-scoped, allocation-scoped, ledger-row-scoped, or all three.
- Whether support users should see admin reconciliation events.
- Tax/VAT ownership and seller-of-record policy.

## Non-Goals For This Phase

- No `FinanceEvent` table.
- No event persistence.
- No payout engine.
- No accounting integration.
- No changes to settlement calculations.
- No fake payout or adjustment events.
- No new UI behavior.
