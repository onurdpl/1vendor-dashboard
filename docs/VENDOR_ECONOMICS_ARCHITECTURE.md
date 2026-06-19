# Vendor Economics Architecture

## Current Status

This document describes the current vendor economics and settlement execution architecture as implemented in the repository. It consolidates finance, settlement approval, Logo Isbasi commission invoice readiness, immutable snapshot, and payout boundaries.

Current production status:

- Controlled Logo Create for settlement commission invoices is implemented through `SettlementCommissionInvoice` records and immutable request snapshots.
- Vendor payout execution is NOT implemented yet.
- Marketplace Economics / Operational Cost Ledger is NOT implemented yet.

Existing Logo Isbasi provider routes include discovery, readiness, preview, binding, and test/probe flows. They are not the controlled settlement Logo Create path.

Existing payout batch code creates draft/review artifacts. It does not execute bank transfers, mark real payment completion, or create final vendor statements.

## Core Flow

```text
Vendor Profile
  -> Finance Ledger
  -> Settlement Approval
  -> Settlement Billing Snapshot
  -> Immutable Request Snapshot
  -> Logo Create
  -> Invoice Lifecycle
  -> Vendor Payout
```

Persisted immutable request snapshots, execution safety guards, controlled Logo Create, and read-only outgoing invoice sync preview are implemented today. Invoice number/GIB status persistence and vendor payout execution remain future phases.

## Truth Model

Vendor Profile = future policy source.

`VendorFinancialProfile` and `VendorBillingProfile` describe current vendor policy and billing data. They must not be treated as historical execution truth after a settlement is approved.

Finance Ledger = order-time financial snapshot.

`FinanceLedgerEntry` stores vendor-scoped sale/refund rows and policy snapshots such as commission percent, commission VAT percent, shipping deduction flags, shipping mode, fixed shipping fee, external shipping cost evidence, and financial profile id.

Settlement Approval = approved financial truth.

`SettlementApproval` stores approved settlement totals and source selection context. `SettlementApprovalLine` stores immutable line-level amount and source snapshots.

Settlement Billing Snapshot = approved billing truth.

Draft settlement creation captures `sourceSnapshotJson.settlementBillingSnapshot` from `VendorBillingProfile`. Logo readiness blocks existing approvals that do not have this snapshot.

Settlement Commission Invoice Request Snapshot = immutable execution artifact.

`SettlementCommissionInvoice.requestSnapshotJson` stores the immutable request snapshot. Future Logo Create must use `requestSnapshotJson.logoPayload` and must not rebuild the payload from current vendor, billing, finance policy, or ledger data.

## Implemented Components

- `FinanceLedgerEntry` snapshots:
  - `commissionPercentSnapshot`
  - `commissionVatPercentSnapshot`
  - shipping deduction snapshots
  - financial profile id snapshot
  - settlement readiness fields
- `FinanceEvent` as an append-oriented finance event record with idempotency key.
- `SettlementApproval` for draft/approved/cancelled settlement state.
- `SettlementApprovalLine` for immutable settlement line amounts and source snapshots.
- Candidate scope filtering:
  - vendor-wide
  - date-range
  - selected-order
  - selected-allocation
- Selected-order diagnostics that explain unmatched rows, ineligible rows, active approval locks, vendor/order mismatch, and locked approval references.
- Candidate quality summary:
  - commission rates
  - commission VAT rates
  - shipping modes
  - financial profile snapshot groups
  - quality warnings
- Settlement billing snapshot captured during draft settlement creation.
- Logo readiness preview that reads settlement billing snapshots instead of current `VendorBillingProfile`.
- Execution snapshot guard for approved settlement line snapshots.
- Immutable Logo request snapshot builder:
  - `buildSettlementLogoCommissionInvoiceRequestSnapshot(...)`
  - payload builder version: `settlement-logo-request-v1`
  - visible Logo invoice description format:
    - `Sporgym Pazaryeri Komisyon Hizmeti`
    - `Dönem: <startDate> - <endDate>` when a reliable approval period or line/ledger date range exists
    - `Vendor: <vendor display name>` with vendor id fallback
    - `Referans: SET-<YYYYMMDD>-<VENDORID>-<short approval id>`
  - raw `SettlementApproval.id` remains in immutable request snapshot metadata, but it is not the primary visible invoice description.
- Persisted immutable request snapshot:
  - `createPendingRecordFromImmutableRequestSnapshot(...)`
  - `SettlementCommissionInvoice.status = PENDING`
  - `requestSnapshotJson.logoPayload`
- Duplicate protection for active settlement commission invoice records.
- Cancellation lock: settlement approval cancellation is blocked when an active commission invoice record exists.
- Environment guard:
  - `LOGO_ISBASI_CREATE_ENABLED`
  - `LOGO_ISBASI_CREATE_ENVIRONMENT`
  - optional `LOGO_ISBASI_EXPECTED_TENANT_ID` tenant validation when Logo login returns a tenant id
  - `LOGO_ISBASI_BASE_URL`
- Execution contract validator requiring:
  - `SettlementCommissionInvoice.status = PENDING`
  - request snapshot present
  - `logoPayload` present
  - snapshot source = `immutable_settlement_truth`
- UNKNOWN lifecycle foundation:
  - `PENDING -> UNKNOWN`
  - `UNKNOWN -> CREATED`
  - `UNKNOWN -> FAILED`
  - explicit reconciliation evidence required before resolving UNKNOWN
- Retry foundation:
  - FAILED can retry
  - UNKNOWN cannot retry before reconciliation

## Not Implemented Yet

- Logo invoice number/GIB status persistence.
- Refund-after-invoice lifecycle.
- Vendor payout execution.
- Bank transfer execution or confirmation.
- Final vendor statement generation.
- Marketplace Economics / Operational Cost Ledger.
- Return shipping cost accounting ledger.
- Automatic operational cost allocation to marketplace or vendor.

## Critical Rules

- Current Vendor Profile must not alter historical settlements.
- Current `VendorBillingProfile` must not be used for historical Logo execution when a settlement billing snapshot is required.
- Logo Create must use persisted `requestSnapshotJson.logoPayload`.
- Logo Create must not rebuild payloads from mutable vendor, billing, finance policy, or ledger data.
- Mixed VAT settlements must block single Logo commission invoice readiness.
- Existing approvals without `settlementBillingSnapshot` must block Logo readiness.
- `UNKNOWN` status must not be retried before reconciliation.
- Environment guard must fail closed.
- Provider responses and diagnostics must not expose secrets.
- Settlement approval lifecycle and finance math must remain separate from provider execution.

## Settlement Candidate Strategy

Candidate modes currently supported:

- Vendor-wide mode.
  - Operationally broad.
  - Current candidate quality warning: vendor-wide preview can include historical or test rows.
  - Risk: can mix historical policy snapshots, VAT rates, shipping modes, or test data.
- Date-range mode.
  - Narrows candidates by ledger `createdAt` period.
  - Still can include mixed policy snapshots inside the period.
- Selected-order mode.
  - Accepts selected order numbers or Shopify order ids.
  - Returns per-request diagnostics for matching and exclusion.
  - Preferred for validation because it limits scope to known orders and explains zero-row outcomes.
- Selected-allocation mode.
  - Accepts selected allocation ids.
  - Useful when order-level selection is too broad for multi-vendor or allocation-specific review.

Candidate quality classification in the Settlement Workspace uses:

- CLEAN: candidate snapshots are uniform for VAT, shipping mode, and financial profile group.
- WARNING: candidate includes mixed shipping modes or multiple financial profile snapshot groups.
- BLOCKED: candidate includes mixed commission VAT rates.

The UI also has empty/no-match states for selected-order diagnostics. These are not clean settlement candidates.

## Logo Create Readiness

Required chain before controlled Logo Create:

```text
Clean new order
  -> Fulfillment
  -> Finance ledger
  -> Selected-order settlement preview
  -> Draft
  -> Approve
  -> Logo readiness
  -> Persist request snapshot
  -> Execution contract PASS
  -> Environment guard PASS
  -> Controlled Logo Create
```

Readiness must pass all hard guards:

- `SettlementApproval` exists.
- `SettlementApproval.status = APPROVED`.
- Settlement billing snapshot is present.
- Required billing fields are present.
- Logo customer code and id are present in the settlement billing snapshot.
- Currency is TRY.
- Commission amount is greater than zero.
- Commission VAT rate is uniform across settlement lines.
- Execution snapshot guard passes.
- Immutable request snapshot builder returns READY.
- No active non-cancelled `SettlementCommissionInvoice` already exists for the settlement/provider.
- Environment guard allows execution.

Controlled create behavior:

- Logo readiness is read-only and must not call Logo create.
- The immutable request snapshot route stores a local `SettlementCommissionInvoice` artifact only; it does not call Logo.
- `POST /admin/finance/commission-invoices/:id/logo-isbasi/create` is the controlled provider-write boundary.
- Execution uses only persisted `SettlementCommissionInvoice.requestSnapshotJson.logoPayload`; payloads are not rebuilt during create.
- `PENDING` records can execute once.
- `FAILED` records can retry through the same stored payload and increment retry metadata before the provider call.
- `UNKNOWN`, `CREATED`, and `CANCELLED` records cannot execute.
- `UNKNOWN` means the provider outcome or local persistence outcome is ambiguous and requires reconciliation before any retry.
- The create endpoint requires the Logo execution environment guard before provider write. Tenant validation is conditional: when `LOGO_ISBASI_EXPECTED_TENANT_ID` is configured, Logo login must return a matching tenant id; when it is not configured, diagnostics report tenant validation as skipped.

## Return Shipping Policy

Current implementation facts:

- Vendor outbound shipping may be vendor-owned depending on `VendorFinancialProfile` shipping deduction policy and the snapshots stored on finance ledger and settlement approval lines.
- Return label creation and return tracking/label evidence exist in return/shipping workflows.
- Return shipping cost currently does not affect vendor payout or settlement in the settlement approval and payout batch foundations.
- Marketplace Economics / Operational Cost Ledger is future scope.

Current operations policy for settlement purposes:

- Marketplace absorbs Kargonomi return label cost.
- That cost is not currently posted into vendor settlement or vendor payout.

UNKNOWN:

- The future accounting source of truth for marketplace-absorbed return label costs.
- Whether return label cost should become a separate operational cost ledger entry, invoice line, internal expense, or reconciliation item.
- Whether return shipping ownership varies by return reason after Marketplace Economics is implemented.

## Open Risks / Next Phases

Phase 3.3B - Controlled Logo Create foundation.

- Controlled provider create exists for an existing `PENDING` or retryable `FAILED` `SettlementCommissionInvoice`.
- Provider success persists provider identifiers and safe response snapshot.
- Clear provider failures persist `FAILED`.
- Timeout, network ambiguity, successful non-JSON responses, and local persistence ambiguity persist or report `UNKNOWN`.
- Admin UI exposes create only after diagnostics show environment guard and execution contract are ready and an explicit operator confirmation is checked.

Phase 3.4 - Invoice Status Sync.

- Query Logo invoice status and document state.
- Reconcile UNKNOWN outcomes before retry.
- Persist status/document metadata without changing settlement truth.

Phase 3.5 - Refund After Invoice Policy.

- Define accountant-approved handling for refunds after commission invoice creation.
- Define cancellation, return invoice, credit/reversal, or recovery treatment.

Phase 4 - Vendor Payout Execution.

- Convert review artifacts into controlled payment execution only after approval, bank/provider design, and reconciliation rules are defined.

Phase 5 - Marketplace Economics / Operational Cost Ledger.

- Model marketplace-owned operational costs.
- Include return label cost accounting.
- Define allocation, reporting, and reconciliation rules without rewriting settlement history.

## Repository References

- `AGENTS.md`
- `docs/FINANCE_LEDGER_MODEL.md`
- `docs/FINANCE_SETTLEMENT_MODEL.md`
- `docs/MARKETPLACE_FINANCE_WORKFLOW.md`
- `docs/PHASE_18A_VENDOR_FINANCE_FOUNDATION.md`
- `docs/PHASE_18B_SETTLEMENT_LEDGER.md`
- `docs/PHASE_18C_PAYOUT_BATCH_PREPARATION.md`
- `docs/PHASE_18D_VENDOR_BALANCE_WORKSPACE.md`
- `docs/PHASE_18E_EXTERNAL_SHIPPING_COSTS.md`
- `docs/archive/legacy-finance/PHASE_20A_INVOICE_EXECUTION_FOUNDATION.md`
- `docs/archive/legacy-finance/PHASE_20A_CUSTOMER_INVOICE_VISIBILITY.md`
- `docs/DATABASE_SOURCE_CONSISTENCY.md`
- `backend/prisma/schema.prisma`
- `backend/src/modules/finance/settlement-approval.service.ts`
- `backend/src/modules/finance/settlement-billing-snapshot.service.ts`
- `backend/src/modules/finance/settlement-execution-snapshot-guard.service.ts`
- `backend/src/modules/finance/settlement-logo-request-snapshot-builder.service.ts`
- `backend/src/modules/finance/settlement-commission-invoice-preview.service.ts`
- `backend/src/modules/finance/settlement-commission-invoice-record.service.ts`
- `backend/src/modules/finance/settlement-logo-execution-contract.service.ts`
- `backend/src/modules/logo-isbasi/logo-execution-environment-guard.service.ts`
