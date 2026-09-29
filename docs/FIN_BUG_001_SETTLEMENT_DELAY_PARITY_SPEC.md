# FIN-BUG-001 — Settlement Delay Parity for Refund-Aware SALE Eligibility

**Status:** implementation specification only; no implementation is authorized by this document. **Evidence baseline:** `main` at `86fc373591f5dab33393536f943bdff63b87b0e9`. The canonical findings [FIN-BUG-001 and FIN-TEST-002](FINANCIAL_BUGS.md) remain `OPEN`. This package follows the ordering and authority boundary in the [Phase 1 eligibility plan](PHASE_1_ELIGIBILITY_PLAN.md).

## 1. Confirmed root cause

The settlement-delay evaluator already provides one local rule for a SALE: `evaluateSaleSettlementDelay` in `backend/src/modules/finance/settlement-delay-eligibility.service.ts` requires delivered shipping state, takes the delivery basis from `Fulfillment.shipmentUpdatedAt`, adds the SALE ledger's `settlementDelayDaysSnapshot` (defaulting to 21 only when the snapshot is absent/invalid), and considers the delay satisfied at `eligibleAt <= comparison time`.

The inconsistency is ordering, not a different formula:

1. `resolveSettlementStatus` in `backend/src/modules/finance/settlement-approval.service.ts` returns `partially_refunded` for any row whose allocation has positive `refundRecords` impact **before** its SALE branch calls `evaluateSaleSettlementDelay`.
2. `rowIsEligible` accepts both `payable` and `partially_refunded`. A SALE with refund evidence can therefore bypass the delivery/delay result in manual or scheduled preview.
3. `createDraftApproval` calls the same `buildApprovalPreview`, so the same row can become a DRAFT line. DRAFT creation does not independently restore the skipped delay check.
4. `validateApprovalLineAgainstCurrentLedger`, called during approval revalidation, independently evaluates the delay for every SALE and adds `settlement_delay_not_satisfied` when it is not eligible. Approval therefore rejects a DRAFT admitted through the earlier refund branch.

The resulting code-backed state is `preview included -> DRAFT included -> approval rejected` for the same unsatisfied SALE delay. Existing test coverage explicitly expects an unfulfilled refund-aware SALE to derive `partially_refunded`, so this is a confirmed behavioral mismatch rather than an untested hypothetical.

`getSettlementStatus` in `backend/src/modules/finance/finance.service.ts` repeats the same early positive-refund branch before its SALE delay evaluation. `buildSettlement` then treats `partially_refunded` as `payoutReady` when there is no active review. This is a read projection rather than DRAFT authority, but leaving it unchanged would let the Finance API/UI continue presenting an immature refund-aware SALE as ready after preview/DRAFT is corrected.

## 2. Current authority and data flow

| Stage | Ordinary SALE | Refund-aware SALE | Required package behavior |
| --- | --- | --- | --- |
| Ledger authority | `FinanceLedgerEntry(entryType=SALE)` freezes commission, commission VAT, shipping policy and `settlementDelayDaysSnapshot`. | The same SALE ledger remains the SALE authority. Associated allocation `refundRecords` make status derivation refund-aware; they do not replace the SALE ledger or its delay snapshot. | Preserve the SALE ledger and all snapshots. |
| Delivery/delay | `evaluateSaleSettlementDelay` uses delivered `shippingStatus`, `fulfillment.shipmentUpdatedAt`, and the frozen delay snapshot. | Current status resolution returns `partially_refunded` before reaching this evaluator. | Evaluate the same existing SALE delay before allowing refund-awareness to produce an eligible SALE status. |
| Preview | `buildApprovalPreview` selects active SALE/REFUND rows, then `rowIsEligible`, integrity-alert filtering and active-approval filtering. | `rowIsEligible` accepts the prematurely derived `partially_refunded` status. | Exclude the SALE while its existing delay result is ineligible; expose the existing missing-delivery or delay-pending reason. |
| DRAFT | `createDraftApproval` runs `buildApprovalPreview` inside its Serializable transaction and persists the returned lines. | The preview bypass carries directly into the DRAFT. | Persist no ordinary line for the immature refund-aware SALE. Do not add a second predicate. |
| Approval | `validateSettlementApprovalBeforeApprove` reloads sources; `validateApprovalLineAgainstCurrentLedger` applies `evaluateSaleSettlementDelay` to each SALE using current time. | Already fails closed with `settlement_delay_not_satisfied`. | Preserve this revalidation and its current stale-DRAFT protection. |
| Finance projection | `getSettlementStatus` eventually maps an immature SALE to `accruing`; `buildSettlement` sets `payoutReady=false`. | The early refund branch maps it to `partially_refunded`; absent a review, `payoutReady=true`. | Align the duplicate backend status derivation with the same existing delay authority; keep the DTO shape and frontend unchanged. |

Here, **refund-aware SALE** means a SALE row whose allocation has positive locally persisted `refundRecords` impact and therefore enters the `sumRefundImpact(...) > 0` status branch. It does not mean that the SALE monetary line absorbs a REFUND ledger amount. `buildLine` still calculates a SALE from the SALE amount and frozen financial profile snapshots. A separate `FinanceLedgerEntry(entryType=REFUND)` remains subject to `getRefundOffsetEligibility` and `calculateRefundOffsetAmounts`, including its relation to the original SALE authority. This package must not merge those authorities or change either calculation.

## 3. Required invariant and smallest behavioral change

For the same SALE source, evidence, comparison instant, and other blockers, the settlement-delay answer must be identical at preview, DRAFT construction, and approval revalidation:

- If the current evaluator reports missing delivery evidence or a pending delay, the SALE is not currently eligible, even when allocation refund evidence exists. Preview must exclude it, DRAFT must not include it, and approval must continue to reject an equivalent stale DRAFT.
- At the exact cutoff (`eligibleAt <= comparison time`) and after it, delay alone does not exclude the SALE. Existing refund-aware status, return, cancellation, integrity-alert, active-approval and other blockers continue to apply independently.
- An ordinary non-refunded SALE retains its existing behavior.

The smallest implementation is to make SALE delay eligibility a prerequisite to the positive-refund `partially_refunded` outcome in both duplicate backend status resolvers:

- `resolveSettlementStatus` in `backend/src/modules/finance/settlement-approval.service.ts`, which is shared by preview and DRAFT; and
- `getSettlementStatus` in `backend/src/modules/finance/finance.service.ts`, which produces the Finance API/UI readiness projection.

Do not change the separate REFUND-ledger shortcut, `getRefundOffsetEligibility`, `rowIsEligible`'s other blockers, line construction, or approval's delay evaluator. The implementation may use a small shared ordering guard if that makes the two resolvers impossible to diverge, but it must not centralize unrelated status policy or broaden into a finance refactor.

Manual preview uses the current time. Scheduled dry-run and scheduled DRAFT pass their existing `asOfDate` (`periodEnd`, currently end of the UTC run date) through the same resolver. Approval revalidates against current time. This package removes the refund bypass at each existing comparison point; it does **not** approve or change scheduled future/end-of-day semantics, cycle policy, or clock policy.

## 4. Frozen delay authority and FIN-BUG-003 separation

The persisted authority for this package is `FinanceLedgerEntry.settlementDelayDaysSnapshot`. A historical SALE must continue to use that value even when the vendor's current `VendorFinancialProfile.settlementDelayDays` differs. No current-profile lookup may be introduced into preview, DRAFT, projection or approval eligibility for an existing SALE.

The delivery side remains exactly what `evaluateSaleSettlementDelay` currently proves: delivered shipping state plus `Fulfillment.shipmentUpdatedAt`. [FIN-BUG-003](FINANCIAL_BUGS.md) records that this timestamp can move after delivery and remains `OPEN`. FIN-BUG-001 neither endorses that source as a final product design nor replaces it. It must not introduce `fulfilledAt`, a Shopify event timestamp, a new snapshot, or altered ingestion/reconciliation behavior. Because parity can be achieved by reusing the current evaluator, FIN-BUG-003 is not an implementation dependency for this bounded repair.

If implementation discovers that the existing evaluator cannot be called without choosing a new delivery timestamp, stop: that would move the package into FIN-BUG-003 and require separate product/possibly Shopify authority work.

## 5. SettlementRefundAdjustment interaction

`SettlementRefundAdjustment` is not the reason the SALE bypass occurs. The bypass is caused by refund records changing the SALE's derived status. Adjustments participate downstream:

- `buildApprovalPreview` calculates ordinary lines first, then calls `previewPendingRefundAdjustmentApplication` with the resulting candidate net payable.
- `createDraftApproval` allocates `PENDING` or `PARTIALLY_APPLIED` adjustment remainder only up to the available positive candidate payable, creates adjustment lines/applications, and updates adjustment state transactionally.
- Under the bug, an immature refund-aware SALE can incorrectly contribute payable capacity against which an adjustment is previewed or applied.

After the repair, an immature SALE contributes no payable capacity. Adjustment preview/application may therefore be smaller or absent, and an adjustment-only DRAFT continues to fail with the existing `Adjustment-only settlement drafts are not supported yet.` behavior. This is a consequence of correcting membership, not a change to adjustment arithmetic or lifecycle. A different mature eligible SALE may still supply legitimate payable capacity. Do not change adjustment status transitions, remaining/applied amounts, reservation records, cancellation reversal, or refund finance formulas.

## 6. Existing DRAFT and historical boundary

A DRAFT already created through the buggy path is not rewritten. Current approval revalidation reloads the SALE and fails closed if the delay is not satisfied. Current Admin cancellation exists; cancellation also reverses active refund-adjustment applications under the existing transaction logic. There is no automatic rebuild, automatic line removal, or historical correction authorized here.

This package prevents new inconsistent DRAFT membership only. It must not update or backfill existing `SettlementApproval`, `SettlementApprovalLine`, `SettlementRefundAdjustment`, `SettlementRefundAdjustmentApplication`, ledger, payout, refund evidence, or Financial Correction rows. APPROVED/PAID history remains immutable.

## 7. FIN-TEST-002 regression specification

Extend the current focused settlement suites with deterministic times; do not rely on the wall clock.

1. **Ordinary SALE, delay pending:** preview excludes the SALE with the existing delay-pending reason; DRAFT contains no line (and fails with the existing no-eligible-row outcome if it is the only source). A deliberately constructed stale DRAFT line is rejected at approval with `settlement_delay_not_satisfied`.
2. **Refund-aware SALE, delay pending — critical regression:** associate positive refund evidence with the SALE but keep the evaluator before cutoff. Preview excludes it, diagnostics do not call it included, and DRAFT does not persist it. This test must replace the current expectation that an unfulfilled refunded SALE is included/`partially_refunded`; the old expectation documents the bug and is not an approved exception.
3. **Refund-aware SALE, exact cutoff and elapsed:** at `eligibleAt`, and after it, delay does not exclude the SALE. With no other blocker it may retain the current `partially_refunded` presentation and normal SALE monetary line.
4. **Frozen snapshot:** give the historical SALE a frozen delay that differs from the current profile. Test both a case where the frozen value keeps it pending and the inverse where the frozen value makes it eligible. The result must follow the ledger snapshot, and no current-profile value may replace it.
5. **PENDING adjustment:** with an immature refund-aware SALE, assert it contributes no candidate payable and no adjustment is applied because of it. If another mature SALE exists, assert only that legitimate payable funds the existing adjustment application.
6. **PARTIALLY_APPLIED adjustment:** create the state through the current reachable application history/fixture. Its remainder must obey the same available-payable result; the immature SALE cannot fund another application. Do not manufacture an invalid enum/state combination merely to satisfy coverage.
7. **Manual parity:** exercise `previewApproval` and `createDraftApproval` with the same fixture and effective time. Their ordinary line membership must agree.
8. **Scheduled parity:** through `getSettlementScheduleDryRun` and `createSettlementScheduleDrafts`, prove the date-range wrappers pass the same `asOfDate` and do not restore the refund bypass. This does not test or change cancelled-cycle/correction orchestration.
9. **Approval preservation:** an equivalent stale DRAFT still fails closed before cutoff; an eligible DRAFT is not rejected by delay at/after cutoff. Do not weaken approval revalidation.
10. **Monetary invariance:** for an actually eligible SALE, compare gross, commission, commission VAT, shipping and net payable components before/after the ordering change. REFUND and adjustment amounts must be unchanged. Only membership/totals for an ineligible row may differ.
11. **Finance projection:** the immature refund-aware SALE is `accruing`/not payout-ready using current DTO semantics; at/after the cutoff the existing eligible/refund-aware projection remains available. No frontend-specific decision rule is added.

Expected focused files are `src/settlement-approval.test.ts`, `src/settlement-schedule.test.ts`, and `src/finance-persisted-calculation.test.ts`. Add route serialization coverage only if implementation unexpectedly changes a contract; no such change is specified.

## 8. Isolated PostgreSQL regression

A real PostgreSQL regression is **required and supported**. This defect crosses persisted ledger/evidence, DRAFT writes, adjustment reservations, and approval revalidation; mocked Prisma coverage alone cannot prove that an excluded source leaves no DRAFT line/application.

Add one focused suite, using the repository's existing `TEST_DATABASE_URL`, localhost-only/exact-isolated-database guard and explicit enable-flag conventions. The fixture should persist a vendor/allocation, SALE ledger with a frozen delay, delivered-state evidence under the current evaluator, positive refund/refund-ledger evidence, and—where needed—real `PENDING` and reachable `PARTIALLY_APPLIED` adjustment state. It must prove:

- before cutoff: preview excludes the refund-aware SALE; an attempted DRAFT does not persist a line for it or consume an adjustment because of it;
- stale historical DRAFT fixture: approval fails closed and history is unchanged;
- at/after cutoff: the same source can proceed subject to existing blockers and formulas;
- frozen delay, not current profile delay, decides the boundary; and
- no production database or external provider is contacted.

The likely new file is `src/fin-bug-001-settlement-delay-parity.postgres.test.ts`. CI integration should follow current isolated finance PostgreSQL conventions only if the implementation task authorizes it; no schema/bootstrap regeneration is needed.

## 9. Implementation package

**Package name:** FIN-BUG-001 Settlement Delay Parity.

| Area | Exact boundary |
| --- | --- |
| Backend selection | `backend/src/modules/finance/settlement-approval.service.ts`: `resolveSettlementStatus` ordering, with `rowIsEligible`, `buildSettlementEligibilityExplanation`, `buildApprovalPreview`, `createDraftApproval`, and approval revalidation verified but otherwise unchanged. |
| Backend projection | `backend/src/modules/finance/finance.service.ts`: align `getSettlementStatus`; verify `buildSettlement` derives truthful existing `status`, `eligibleAt` and `payoutReady` without changing the DTO. |
| Shared authority | `backend/src/modules/finance/settlement-delay-eligibility.service.ts` is reused. A change is not expected; alter it only if needed to expose the same current calculation without changing its inputs or semantics. |
| Scheduled wrappers | `backend/src/modules/finance/settlement-schedule.service.ts` should require no production change because it delegates to preview/DRAFT with `asOfDate`; add wrapper tests. |
| Refund adjustments | Verify `previewPendingRefundAdjustmentApplication` and DRAFT application consume only the corrected eligible payable. No production adjustment-service change. |
| Focused tests | `src/settlement-approval.test.ts`, `src/settlement-schedule.test.ts`, `src/finance-persisted-calculation.test.ts`, plus the isolated PostgreSQL suite above. |
| API/UI | No endpoint, request/response shape, permission, frontend component or workflow change. Existing eligibility reason fields should report `Missing delivery date for settlement eligibility` or `Settlement delay period has not elapsed`; Finance API values become truthful under the existing contract. |
| Storage | No Prisma schema, migration, bootstrap, index, backfill, or production-data mutation. |
| Money | Newly computed preview/DRAFT totals may exclude a row that was never delay-eligible. No SALE, commission, commission VAT, shipping, REFUND, adjustment, payout, debt, credit, or Financial Correction formula changes. |
| Rollback | Revert the bounded resolver/test changes. No data rollback is required because implementation must not rewrite existing records; rollback would reintroduce the admission mismatch for future previews/DRAFTs. |

If the package requires changing delivery evidence, Shopify ingestion, refund authority, monetary formulas, schema, historical rows, or scheduled cycle policy, stop for scope review rather than expanding it.

## 10. Closure criteria and remaining unknowns

FIN-BUG-001 and FIN-TEST-002 may close only after:

- refund-aware SALEs cannot bypass the existing frozen delay in preview or DRAFT;
- ordinary SALE behavior and the separate REFUND-ledger path remain correct;
- approval delay revalidation agrees at the same evidence/comparison instant and remains fail-closed;
- frozen historical delay snapshots remain authoritative;
- manual and scheduled wrapper regressions pass;
- `PENDING` and reachable `PARTIALLY_APPLIED` adjustment interactions prove no premature payable capacity or state consumption;
- eligible-row monetary components are unchanged;
- focused, normal, build/typecheck and isolated PostgreSQL validation pass;
- deployment at the intended commit is verified; and
- a safe read-only production comparison is performed if a naturally occurring pre-cutoff refund-aware SALE exists. Do not create a settlement, refund, adjustment, or production mutation solely for verification.

FIN-BUG-003 must remain explicitly separate/open. Production incidence remains **UNKNOWN**: Audit F found refunded SALE ledgers in settlements but no row observed earlier than the currently retained `settlementEligibleAt`, and historical snapshots do not prove the original pre-settlement refund timing. A naturally available runtime case may therefore be absent; lack of one must not be reported as production proof or manufactured.

No product decision is required for this parity repair, because approval already establishes the existing fail-closed delay rule. No Shopify clarification is required, because the package reuses persisted local evidence and the current evaluator without choosing new Shopify semantics.
