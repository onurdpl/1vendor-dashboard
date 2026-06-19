# Order Finance Drilldown Model

## Purpose

This document defines the foundation for a future order-level finance drilldown. It is discovery and design only. It does not add schema, change calculations, implement payout execution, integrate accounting providers, mutate Shopify/provider state, or expose fake precision.

The drilldown should explain how an order settlement estimate is derived for one vendor allocation. It must stay honest about which values are persisted facts, which values are calculated previews, which values are missing, and which values require manual review before payout language is safe.

## Current Surfaces Inspected

- `src/pages/FinancePage.tsx`
  - vendor-scoped finance workspace
  - finance ledger rows, settlement estimates, draft payout review artifacts
- `src/pages/OrderDetailPage.tsx`
  - compact financial summary for order detail
  - admin-only `financeLedgerPreview` diagnostic card
- `src/lib/api/contracts.ts`
  - frontend DTOs for `FinanceTransaction`, `PayoutCalculation`, `FinanceLedgerPreview`, and `OrderDetail`
- `backend/src/modules/finance/finance.service.ts`
  - vendor-scoped `/finance` summary and ledger row mapping
  - payout calculation and settlement readiness mapping
- `backend/src/modules/finance/finance.types.ts`
  - backend finance DTO definitions
- `backend/src/modules/finance/finance-ledger-preview.service.ts`
  - order allocation finance preview builder
- `backend/src/modules/finance/finance-ledger-preview.types.ts`
  - preview DTO and input model
- `backend/src/modules/finance/finance-ledger.ts`
  - in-memory preview ledger event/balance calculation
- `backend/src/modules/orders/orders.service.ts`
  - order detail includes finance preview only for admin requests
- `backend/src/modules/orders/orders.routes.ts`
  - `includeFinanceLedgerPreview: request.authUser?.role === 'admin'`
- `backend/prisma/schema.prisma`
  - `FinanceLedgerEntry`, `VendorFinancialProfile`, `ShipmentShippingCost`, `PayoutBatch`, `PayoutBatchLine`, `ShipmentExecution`
- Finance docs:
  - `docs/FINANCE_SETTLEMENT_MODEL.md`
  - `docs/MARKETPLACE_FINANCE_WORKFLOW.md`
  - `docs/PHASE_18A_VENDOR_FINANCE_FOUNDATION.md`
  - `docs/PHASE_18B_SETTLEMENT_LEDGER.md`

## Current Architecture Summary

Order-level finance is split across two concepts:

1. Persisted vendor-scoped finance ledger rows.
   - Source: `FinanceLedgerEntry`.
   - Exposed through `GET /finance`.
   - Contains sale/refund rows, immutable commission/shipping profile snapshots, settlement readiness fields, payout batch references, and invoice execution references.
   - This is the current operational finance record source.

2. Admin-only order detail finance ledger preview.
   - Source: `getFinanceLedgerPreviewForAllocation(vendorId, allocationId)`.
   - Exposed only on admin `GET /orders/:orderId` responses.
   - Rebuilds a read-only simulation from allocation line items, return records, refund records, active vendor finance profile, shipping cost evidence, and payout batch placeholder evidence.
   - The UI explicitly says it is "Read-only simulation. Not payout, refund, invoice, or tax truth."

The future drilldown should not invent a third finance truth. It should present a reconciled explanation over these existing sources:

- persisted finance ledger row when available.
- order allocation preview when admin/debug visibility is needed.
- explicit unknown states where neither source has evidence.

## Available Order-Level Field Inventory

| Field | Current Availability | Classification | Source | Notes |
| --- | --- | --- | --- | --- |
| `grossOrderAmount` | Partially available | Real for allocation line sums, preview when rendered as drilldown | Shopify allocation line item records / `VendorAllocationLineItem.lineAmount` / `FinanceLedgerEntry.amount` for sale rows | Current preview sums allocation line amounts, not necessarily every order-level Shopify charge. Use "Gross allocation amount" unless whole-order scope is proven. |
| `subtotal` | Partially available | Real if line item subtotal exists; not consistently modeled as separate subtotal | Shopify order line item / allocation line amount | The preview currently uses `lineAmount`. A separate subtotal field is not a first-class drilldown field. |
| `shippingPaidByCustomer` | Not modeled for drilldown | Unknown | Shopify would be source, but not present in current finance DTOs | Do not show as zero. Requires canonical Shopify order shipping line allocation policy. |
| `marketplaceCommission` | Available | Estimated or snapshot-derived, not approved payable | `VendorFinancialProfile.commissionPercent`, sale row commission snapshots, preview `commissionBps` | Finance rows can use immutable snapshots. Order preview uses active profile if present and marks missing commission as `commission_rate` unknown. |
| `commissionVat` | Available in `/finance`; absent from order preview ledger | Estimated or snapshot-derived | `FinanceLedgerEntry.commissionVatPercentSnapshot`, `PayoutCalculation.commissionVat` | The order detail `financeLedgerPreview` currently models marketplace commission only, not VAT as a separate preview ledger event. |
| `shippingDeduction` | Available when cost evidence exists | Real operational evidence when confirmed, preview when provider snapshot | `ShipmentShippingCost` with `CONFIRMED`, or latest `ShipmentExecution.shippingCost/shippingVat` provider snapshot | If no evidence, current preview adds `shipping_cost` unknown. External-provider shipping policy must not silently render zero. |
| `refundDeduction` | Available after refund ledger/records exist | Real posted refund evidence, preview allocation impact | `RefundRecord`, refund line items, `FinanceLedgerEntry` refund rows | Pending returns do not create refund finance impact. `refunds/create` remains the source for posted refund finance impact. |
| `returnImpact` | Available as operational context | Not a deduction until refund evidence exists | `ReturnRecord` | Current preview creates `RETURN_CREATED` entries with zero amount and no payout impact. |
| `manualAdjustment` | Event type exists, storage/workflow not implemented | Not modeled | Future manual finance event / adjustment line | Do not show unless backed by future adjustment records. |
| `netSettlementEstimate` | Available | Estimated | `/finance` `PayoutCalculation.estimatedPayout`, preview `balance.netVendorPosition` | Must be labeled estimate or preview until explicit approval/payment evidence exists. |
| `payoutStatus` | Available | Operational status, not payment guarantee | `FinanceLedgerEntry.payoutStatus`, mapped frontend finance row status | `PAID` or `PAID_PLACEHOLDER` must not be shown as paid unless payment confirmation exists. |
| `financeReviewStatus` | Partially available | Derived review state | `settlement.status`, payout batch status, preview `status` and `unknowns` | Current conservative UI mapping should remain: estimated, pending review, approved, scheduled, blocked, reversed, paid only with evidence. |
| `settlementCurrency` | Available | Real operational currency if source evidence exists, otherwise defaulted | `ShipmentShippingCost.currency`, `ShipmentExecution.currency`, preview fallback `TRY`, payout batch currency | Preview currently defaults to `TRY` when no source currency exists. Label fallback as inferred/defaulted if surfaced. |
| `financeEventsHistory` | Partially available | Preview events, not persisted event history | `finance-ledger.ts` preview entries; `FinanceLedgerEntry` persisted rows; timeline uses finance rows | Preview events are generated in memory. A durable finance event/audit model is not yet implemented. |
| `payoutBatchId` | Available on finance rows when included | Real review artifact reference | `PayoutBatchLine` / `PayoutBatch` | Draft/review artifact only. Not payment evidence. |
| `payoutTransferEvidence` | Not modeled | Unknown | Future payout provider/bank reconciliation | Required before showing paid/confirmed payout. |
| `settlementExportId` | Not modeled | Unknown | Future export/accounting integration | Do not imply export exists. |
| `taxVatOwnership` | Not modeled | Unknown business/legal decision | Future tax policy | Existing commission VAT snapshot is not a full tax engine. |

## Source-of-Truth Analysis

### Shopify

Current Shopify-derived order-level facts:

- source Shopify order id and order number.
- allocation line items and line amounts.
- refund records created from `refunds/create`.
- return records from return webhooks.

Current Shopify-related unknowns for finance drilldown:

- customer-paid shipping allocation by vendor.
- discount allocation and tax allocation at vendor/allocation level.
- partial refund allocation policy when Shopify refund lines are incomplete or do not map cleanly to vendor allocation lines.
- whether order total, subtotal, shipping, duties, discounts, and taxes should be shown as whole-order values or vendor allocation values.

Rule: use canonical Shopify GraphQL before adding destructive or authoritative finance behavior. For drilldown display, label Shopify-derived values by scope: "allocation", "order", or "unknown".

### Provider / Shipment Evidence

Current provider-derived finance facts:

- confirmed shipping cost records in `ShipmentShippingCost`.
- provider shipment snapshot cost in `ShipmentExecution.shippingCost` and `shippingVat`.
- provider name/source metadata.

Current provider-related unknowns:

- delayed shipping cost reconciliation policy.
- whether provider snapshot should become confirmed settlement evidence without operator review.
- late cost adjustment after draft review or payout approval.

Rule: if shipping deduction mode depends on provider evidence and no cost exists, show `Unknown` or `Pending provider cost`, not zero.

### Admin Config

Current admin-configured finance facts:

- active `VendorFinancialProfile`.
- commission percent.
- commission VAT percent.
- shipping deduction enabled flag.
- shipping deduction mode.
- fixed shipping fee.

Current limitations:

- active profile can change over time.
- persisted sale rows have immutable snapshots, but the order detail preview uses the active profile when building simulation.
- no category/SKU-level commission matrix exists.

Rule: prefer persisted snapshots for historical finance truth. Use active profile only for preview calculations and label as preview.

### Inferred / Hardcoded

Current inferred or defaulted behavior:

- default finance profile if no configured profile exists: 10 percent commission, 0 percent commission VAT, shipping deduction disabled.
- order preview currency falls back to `TRY`.
- settlement readiness is inferred from fulfillment/shipping evidence and settlement status.
- preview events are generated from current relational state and are not persisted as durable finance events.

Rule: defaulted or inferred values must be labeled as such in admin diagnostics and must not be shown to vendors as final payable truth.

## Existing Order Detail Finance Behavior

### Vendor View

Vendor order detail currently receives no `financeLedgerPreview` because the backend includes it only for admin users. Vendor users see a compact financial summary and linked finance records where available, but admin-only preview diagnostics are hidden.

Recommended interpretation:

- vendor view can show a small settlement estimate if backed by vendor-scoped `/finance` rows or safe order summary fields.
- vendor view should not show raw preview assumptions, unknown keys, event internals, or admin reconciliation diagnostics.
- if no vendor-visible estimate is available, show "Finance preview pending" or "Unknown", not zero.

### Admin View

Admin order detail can see:

- compact financial summary.
- admin-only `Finance ledger preview`.
- unknown fields.
- assumptions.
- generated preview entries.

Recommended interpretation:

- keep admin preview diagnostic wording explicit.
- make it clearer that preview entries are simulated and may differ from persisted ledger snapshots.
- link to finance row detail where persisted `FinanceLedgerEntry` exists.

## Proposed Future UI Structure

### Section 1: Order Finance Breakdown

Use a compact row/card layout:

- Gross allocation amount
  - source: Shopify allocation line items or finance sale row.
  - label as real operational amount if persisted.
- Marketplace commission estimate
  - source: finance snapshot if available, otherwise active profile preview.
  - show rate and source: snapshot, active profile, default, or unknown.
- Commission VAT estimate
  - source: finance snapshot or active profile preview.
  - if unavailable in order preview, show `Unknown` in drilldown.
- Shipping deduction
  - source: confirmed shipping cost, provider snapshot, fixed profile, disabled, pending provider cost, or unknown.
- Refund impact
  - source: posted refund ledger/records only.
  - pending returns should appear as "Return pending, no refund deduction yet."
- Manual adjustments
  - show only if future adjustment records exist.
  - otherwise omit or show "Not modeled" in admin-only diagnostics.
- Estimated settlement
  - source: `PayoutCalculation.estimatedPayout`, `financeLedgerPreview.balance.netVendorPosition`, or future `OrderFinancePreview.netPayoutEstimate`.
  - must say "Estimated".

### Section 2: Evidence And Unknowns

Use expandable diagnostics:

- source evidence:
  - Shopify allocation line count.
  - return count.
  - refund count.
  - commission profile source.
  - shipping cost source.
  - payout batch reference if present.
- unknowns:
  - `commission_rate`
  - `vendor_payable`
  - `shipping_cost`
  - `refund_reversal_amount`
  - future tax/shipping/customer-paid-shipping unknowns.
- assumptions:
  - preview is read-only.
  - no payout/refund/Shopify/invoice/tax mutation.
  - active profile vs immutable snapshot distinction.

### Section 3: Settlement Timeline

Recommended events:

- Order sale recorded.
- Payment captured or order accepted.
- Commission reserved.
- Vendor settlement estimate reserved.
- Shipping cost attached or pending.
- Return requested.
- Refund completed.
- Refund impact applied.
- Draft payout review created.
- Approval/scheduled/paid events only after future implementation with evidence.

Use persisted events where available. Until a durable `FinanceEvent` exists, preview events must be marked as generated preview entries.

### Section 4: Pending Review Reasons

Show reasons such as:

- shipping cost pending.
- commission profile missing.
- refund allocation ambiguous.
- vendor payout already paid placeholder exists.
- negative estimated settlement.
- settlement held/disputed.

Vendor wording should stay operational and non-internal. Admin wording may include raw keys.

### Section 5: Admin Reconciliation Notes

Admin-only section:

- linked finance row id.
- payout batch id/status if present.
- invoice execution visibility.
- shipping cost source/id if present.
- raw enum labels in compact diagnostics.
- support/collaboration notes.

Do not expose full provider payloads, accounting secrets, or customer PII.

## Visibility Rules

### Vendor

Vendors may see:

- gross allocation/order amount that belongs to their allocation.
- estimated settlement amount.
- commission estimate and rate if business policy allows it.
- refund impact once refund evidence exists.
- shipping deduction status in readable form.
- review state: estimated, pending review, blocked.
- support-oriented explanations for missing evidence.

Vendors must not see:

- another vendor's allocation, finance row, refund, or payout data.
- admin-only preview assumptions as raw internal keys.
- payout batch internals beyond safe review status unless a future vendor statement model permits it.
- raw provider/accounting diagnostics.
- final payable/paid wording without approval/payment evidence.

### Admin

Admins may see:

- all vendor-scoped drilldown fields for the selected vendor/allocation.
- raw finance row ids, payout batch ids, invoice execution refs, shipping cost ids.
- preview unknown keys and assumptions.
- unresolved reconciliation diagnostics.
- support/collaboration context.

Admins must still not see:

- fake payout confirmation.
- unverified tax or accounting conclusions.
- unrelated vendor data in vendor-scoped routes.

## Estimate Honesty Rules

- Use "Estimated" for calculated values that are not approved.
- Use "Preview" for simulated order detail values.
- Use "Pending review" for rows eligible for operator review.
- Use "Blocked" for held/disputed/missing-evidence states.
- Use "Unknown" when source data is absent or not modeled.
- Use "Approved" only after a future explicit payout approval state exists.
- Use "Scheduled" only after a future payout schedule state exists.
- Use "Paid" only with real payment confirmation evidence, not `PAID_PLACEHOLDER`.
- Do not show unknown numeric amounts as `0.00`.
- Do not call a value "balance" unless it is approved payable or explicitly identified as a legacy compatibility field.
- Pending returns are not refund deductions until posted refund evidence exists.
- Provider shipping cost snapshots should be marked as snapshots until confirmed/reconciled.

## Missing Critical Pieces Before Real Drilldown

The following should be modeled or explicitly resolved before the drilldown becomes settlement authority:

- Order-level vs allocation-level display policy for:
  - subtotal.
  - discounts.
  - taxes.
  - shipping paid by customer.
  - duties or fees.
- Partial refund allocation rules when Shopify refund line items are incomplete.
- Durable `FinanceEvent` or settlement event history.
- Manual adjustment records.
- Approved payable amount.
- Payout transfer/payment evidence.
- Payout statement/export id.
- Accounting export status.
- Tax/VAT ownership and display policy.
- Late shipping cost reconciliation policy.
- Negative settlement recovery policy.
- Refund-after-payout reversal policy.
- Return-window delay policy.

## Suggested Future DTO Shape

This is not an implementation request. It is a shape to guide future work:

```ts
type OrderFinanceDrilldown = {
  orderId: string;
  allocationId: string;
  vendorId: string;
  currency: string;
  status: 'estimated' | 'pending_review' | 'approved' | 'scheduled' | 'paid' | 'blocked' | 'reversed';
  rows: Array<{
    key:
      | 'gross_allocation_amount'
      | 'marketplace_commission'
      | 'commission_vat'
      | 'shipping_deduction'
      | 'refund_impact'
      | 'manual_adjustment'
      | 'estimated_settlement';
    label: string;
    amount: string | null;
    quality: 'real' | 'estimated' | 'unknown' | 'not_modeled';
    source: 'shopify' | 'provider' | 'finance_ledger' | 'admin_config' | 'inferred' | 'future_manual_adjustment';
    sourceDetail?: string;
    visibleToVendor: boolean;
  }>;
  evidence: {
    financeLedgerEntryId?: string;
    payoutBatchId?: string;
    shippingCostId?: string;
    settlementCommissionInvoiceId?: string;
    previewUnknowns: string[];
    assumptions: string[];
  };
  events: Array<{
    id: string;
    label: string;
    at: string | null;
    source: 'persisted' | 'preview';
    visibleToVendor: boolean;
  }>;
};
```

## Recommended Implementation Phases

### Phase 1: Read-Only Mapper

- Build a mapper that merges one order allocation, relevant `/finance` row(s), and admin-only preview into a single drilldown DTO.
- No schema changes.
- No calculation changes.
- Unknown fields remain unknown.

### Phase 2: UI Drilldown

- Add an order detail "Finance breakdown" panel.
- Vendor view uses readable estimates only.
- Admin view adds expandable diagnostics.
- Link each persisted finance row to `/finance?ledgerId=...`.

### Phase 3: Durable Finance Events

- Add append-only finance events if required.
- Reuse preview event language but persist only real events.
- Preserve idempotency and vendor isolation.

### Phase 4: Settlement Authority

- Add explicit payout approval/payment evidence only after business policy and accounting ownership are confirmed.
- Only then introduce final payable/paid terminology.

## Unresolved Business Decisions

- Is the displayed amount whole-order or vendor-allocation scoped?
- Should customer-paid shipping affect vendor settlement?
- How are Shopify discounts allocated across vendors?
- How are taxes/VAT displayed and who owns tax reporting?
- Does the return window delay payout review?
- What evidence makes a shipping provider cost confirmed?
- Who can approve payout amounts?
- What evidence confirms actual payment?
- How are negative vendor positions recovered?
- Can a refund reverse a paid payout, and through which mechanism?

## Do Not Do Yet

- Do not implement a payout engine.
- Do not add accounting/provider integrations.
- Do not rename persisted fields.
- Do not change existing finance calculations.
- Do not add fake order finance data.
- Do not expose admin preview diagnostics to vendors.
- Do not describe estimates as confirmed payable money.
