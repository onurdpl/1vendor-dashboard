# FIN-BUG-004 — Selected-Order Diagnostic Consistency

**Status:** implementation specification only; no implementation authorized by this document. **Register:** [FIN-BUG-004 and FIN-TEST-005](FINANCIAL_BUGS.md). **Sequence:** first diagnostic-only package in the [Phase 1 eligibility plan](PHASE_1_ELIGIBILITY_PLAN.md). **Evidence baseline:** repository `main` at `9e265daec185e2ab7dcb0655f85a71b9a32fc421`. Later code must be rechecked before implementation.

## Root cause and current flow

1. The Admin-only `POST /admin/finance/settlement-approvals/preview` route in `backend/src/modules/finance/finance.routes.ts` accepts `selectedOrderIds` and `selectedShopifyOrderIds` and calls `previewApproval`. The DRAFT route calls `createDraftApproval` with the same selection input. The frontend request/response contract is in `src/features/finance/settlementApprovalsApi.ts`; `src/pages/AdminSettlementApprovalsPage.tsx` supplies selected-order inputs and displays the response.
2. In `backend/src/modules/finance/settlement-approval.service.ts`, `buildApprovalPreview` loads the vendor's ledger rows and runs `filterRowsByCandidateSelection`. It then applies `rowIsEligible`, removes rows for which `getBlockingIntegrityAlertsForRow` returns alerts, and removes rows with an active approval. Only the resulting `unapprovedRows` become ordinary monetary `lines`. Correction effects and downstream summaries are computed separately.
3. `getBlockingIntegrityAlertsForRow` queries `findBlockingFinanceIntegrityAlerts` by **vendor allocation ID**. The blocker is not an order-wide or ledger-ID-wide inference. The existing approval revalidation calls this alert authority too and can return `finance_integrity_alert_open` with a category-specific explanation.
4. The preview currently calls `buildSelectedOrderDiagnostics` with the original `rows`, not the final `unapprovedRows` or an alert-exclusion result. For a matched row, that helper chooses an apparent included row using `rowIsEligible && !rowHasActiveApproval`; `buildMatchedOrderDiagnostic` recomputes `candidateIncluded` from `rowIsEligible && !activeApprovalLine`. Neither condition sees the alert filter. Thus an otherwise-eligible selected SALE with a blocking allocation alert can yield `candidateIncluded=true` and `excludedReason=null` while its ledger ID is absent from `lines`.

`candidateSelectionSummary.candidateRowCount` describes an earlier selection stage and is **not** final monetary membership. The final ordinary preview `lines` (derived from `unapprovedRows`) are the relevant membership authority. A correction-only line must not make an unrelated selected order appear included.

## Required diagnostic contract

- For each requested selected-order identifier, keep the existing matched/unmatched lookup and per-ledger-row identity. A diagnostic may report `candidateIncluded=true` only when its reported `financeLedgerEntryId` is in the final ordinary preview line set. If multiple rows match, prefer a row actually included in that final set; do not invent an order-wide inclusion rule.
- If a matched, otherwise-eligible row was removed by the **existing** integrity-alert filter, report `candidateIncluded=false`. Use the existing `excludedReason: string | null` field to say that a blocking finance integrity alert excluded it, using safe existing alert category information (consistent with approval's `finance_integrity_alert_open` explanation). Do not expose raw alert payloads or invent a new status/permission. The final line set must remain unchanged.
- If a row fails an earlier eligibility predicate, is locked by an active approval, is cross-vendor, has an identifier-format mismatch, or has no match, preserve its current diagnostic semantics and reason/lock fields unless needed to avoid a false inclusion. A generic eligibility reason that says a row is eligible is **not** an accurate reason for a row actually removed by an alert.
- If several rows match and none is finally included, the reported row and reason must describe a real exclusion affecting that row. Preserve existing row-selection priority where compatible; do not claim that one row's alert applies to all rows for the order. Repeated selected identifiers that resolve to the same ledger row must agree with its final membership.
- Derive membership from the final already-filtered ordinary candidate set (or its exact line IDs), not by adding another independent economic predicate. Capture the alert category from the already-performed filter pass if an alert-specific reason is needed; do not change which alerts block or add a second query with possibly different timing.

The public DTO already represents this outcome: `candidateIncluded=false` plus an `excludedReason` string and the existing row/status fields. **No DTO shape or endpoint change is expected.** The category-specific reason is a new *value* in the existing free-text field, not a new reason enum. `SelectedOrderDiagnostics` in `AdminSettlementApprovalsPage.tsx` already renders `Included`/`Excluded` and `excludedReason`; `buildDraftFailureSummary` also reads excluded diagnostics. No frontend code change is expected. Review existing API and UI tests for any exact-text expectations before implementation.

## Narrow implementation package

**Name:** FIN-BUG-004 Selected-Order Diagnostic Consistency.

| Area | Expected future change |
| --- | --- |
| Backend | `backend/src/modules/finance/settlement-approval.service.ts`: thread final ordinary membership and the already-observed alert exclusion through `buildApprovalPreview` into `buildSelectedOrderDiagnostics`/`buildMatchedOrderDiagnostic`; retain existing selected-order matching and monetary pipeline. |
| Tests | `src/settlement-approval.test.ts`: add FIN-TEST-005 and focused neighboring cases. Add route/API serialization coverage only if the actual implementation changes the DTO contract, which this specification does not require. |
| API/UI | Existing `selectedOrderDiagnostics` response and `src/features/finance/settlementApprovalsApi.ts` type remain; `src/pages/AdminSettlementApprovalsPage.tsx` should render corrected values without a component change. |
| Storage | No Prisma schema change, migration, backfill, or production-data mutation. |
| Rollback | Revert the diagnostic code/tests if necessary. This restores prior diagnostic output only; it must not require settlement, ledger, or payout reversal. |

If truthful selected-order diagnostics cannot be achieved within this bounded helper/call-site change, stop for scope review: **IMPLEMENTATION SCOPE REQUIRES REVIEW**. Do not expand into all preview diagnostics, economic eligibility, or UI redesign by assumption.

## Focused validation specification

1. **Included:** a selected order surviving selection, eligibility, alert filtering and active-approval exclusion has a matching final ordinary line and `candidateIncluded=true`, `excludedReason=null`. Preserve its amount and totals.
2. **FIN-TEST-005 regression:** a selected, otherwise-eligible row with a blocking alert on its allocation has no final ordinary line, `candidateIncluded=false`, and a truthful blocking-alert reason. Assert the final line set and totals are the same safe result that current filtering already produces. This test must fail against the present diagnostic implementation.
3. **Earlier ineligibility:** a selected row rejected by an existing pre-alert predicate remains excluded with its existing eligibility explanation; it must not become included from a new diagnostic shortcut.
4. **Other exclusion:** an active-approved/locked selected row remains excluded with its current lock evidence. Existing unmatched, cross-vendor and order-number-format reasons remain intact.
5. **Multiple matching rows:** when one matched ledger row survives and another is alert-filtered, report the actual surviving row as included; when none survives, report an actual excluded row and reason. Do not treat an allocation alert as a blanket order alert.
6. **Non-selected parity:** with the same fixture, compare ordinary `lines`, amount fields, summary and correction effects before/after the diagnostic change (logically or byte-equivalent where stable). No added/removed settlement source, changed amount, or changed DRAFT selection is permitted.
7. **Shared preview path:** verify manual selected-order preview and selected-order DRAFT use the same final membership. Scheduled preview calls the same helper with `date_range` scope, for which selected-order diagnostics remain empty; no scheduled economic or diagnostic change is intended.

Existing selected-order cases in `src/settlement-approval.test.ts` cover included/unmatched and other selection outcomes; the approval-time integrity-alert test covers a DRAFT rejection, **not** this selected-order preview mismatch. Run those focused tests and broader settlement-preview tests, then the applicable normal validation from `AGENTS.md` during implementation. This document does not run write-capable tests.

## Economic and authority boundary

This package must not change `filterRowsByCandidateSelection`, `rowIsEligible`, delivery/delay evaluation, refund or return treatment, line amounts, commission or commission VAT calculations, integrity-alert creation or blocking semantics, active-approval exclusion, manual/scheduled settlement semantics, DRAFT creation, or approval/revalidation. No currently included settlement may be excluded, and no currently excluded settlement may be included, because of the diagnostic repair. Existing finance history remains immutable. No Shopify read or new Shopify assumption is involved: the case uses persisted local ledger and integrity-alert evidence. [Shopify discoveries](SHOPIFY_DISCOVERIES.md) remain a boundary reference, not a new authority for this diagnostic.

## Closure and remaining unknowns

FIN-BUG-004/FIN-TEST-005 can be marked CLOSED only after an approved implementation, a regression proving alert-filtered selected rows are reported excluded, included-row/final-line parity, unchanged monetary preview and DRAFT membership, relevant broader tests, and runtime verification as applicable. After a separately approved deployment, use a **read-only** selected-order preview for a naturally existing alert case if available; compare diagnostic, line list and totals. Do not manufacture a production settlement or alter historical finance merely to verify this. If no suitable production case exists, production incidence and runtime verification remain **UNKNOWN**, not implicitly passed.

No product decision or Shopify clarification is required for this diagnostic-only contract. The exact final wording of the safe alert reason is an engineering presentation detail within the existing `excludedReason` field; it must be accurate and tested. This specification does not change the canonical register's OPEN status or authorize broader Phase 1 automation.
