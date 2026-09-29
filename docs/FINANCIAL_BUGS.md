# Financial Bugs & Automation Blockers

Status:
- Living discovery document.
- Implementation is currently frozen.
- Findings are evidence from repository audits unless otherwise stated.
- UNKNOWN means unknown.
- Product decisions are not treated as bugs.
- Do not mark an item fixed without implementation and validation evidence.

Current audited repository baseline: `456a7ec9d759b48649057ff01f4be53c315ad281`.
This SHA is where the current findings were identified; it is not necessarily a future HEAD. Production incidence is **UNKNOWN** unless explicitly stated otherwise. Evidence paths below refer to this audited baseline. Initial entries are `OPEN`, except the potential multi-return issue, which is `NEEDS_RUNTIME_PROOF`. Allowed statuses are `OPEN`, `NEEDS_RUNTIME_PROOF`, `BLOCKED_BY_PRODUCT_DECISION`, `BLOCKED_BY_EXTERNAL_INFO`, `FIXED_NOT_VERIFIED`, and `CLOSED`. IDs are stable and must not be renumbered.

## Confirmed functional defects

### FIN-BUG-001 — SALE refund impact bypasses settlement delay

- **Domain:** Settlement eligibility.
- **Classification:** CONFIRMED_BUG.
- **Status:** OPEN.
- **Finding:** A SALE with positive refund impact can become `partially_refunded` before delivery/delay evaluation in preview or DRAFT selection; `rowIsEligible` accepts it. Approval later evaluates delivery delay for every SALE.
- **Exact current behavior:** The same source can enter a DRAFT before delivery/waiting-period maturity and then be rejected at approval. An existing test expects an unfulfilled refunded SALE to be included; this is not just missing coverage.
- **Current impact:** Preview/DRAFT and approval give conflicting eligibility answers.
- **Automation impact:** BLOCKER; preview/DRAFT is not final economic authority.
- **Evidence / relevant code locations:** `backend/src/modules/finance/settlement-approval.service.ts` (`rowIsEligible`, preview candidate filtering, approval revalidation); `backend/src/modules/finance/finance.service.ts` (settlement status derivation); settlement eligibility tests under `src/`.
- **Production incidence:** UNKNOWN.
- **Product decision required?** No decision established for this predicate mismatch; preserve legitimate REFUND authority.
- **External clarification required?** No identified external question for the local mismatch.
- **Minimum future repair boundary:** Align SALE refund-impact eligibility with the authoritative delivery-delay predicate without altering legitimate REFUND authority; implementation is not chosen here.
- **Validation required before CLOSED:** Paired preview/DRAFT/approval regression, including unfulfilled and refunded SALE cases and applicable real-DB validation.

### FIN-BUG-002 — Cancelled scheduled cycle appears reusable but its DB key remains reserved

- **Domain:** Settlement scheduling and cycle identity.
- **Classification:** CONFIRMED_BUG.
- **Status:** OPEN.
- **Finding:** Schedule preview and DRAFT precheck ignore CANCELLED approvals, but cancellation retains `scheduledCycleKey` and the schema enforces unconditional uniqueness.
- **Exact current behavior:** A cancelled cycle may appear READY while an attempted replacement fails on PostgreSQL insertion.
- **Current impact:** Operator-facing readiness contradicts durable cycle identity.
- **Automation impact:** BLOCKER for unattended DRAFT creation and cycle retry.
- **Evidence / relevant code locations:** `backend/src/modules/finance/settlement-schedule.service.ts` (`findExistingScheduledApproval`, dry-run and create flow); `backend/src/modules/finance/settlement-approval.service.ts` (scheduled precheck, cancellation); `backend/prisma/schema.prisma` (`SettlementApproval.scheduledCycleKey @unique`).
- **Production incidence:** UNKNOWN.
- **Product decision required?** Yes: permanently consumed identity, a new replacement identity, or active-only uniqueness are unresolved alternatives.
- **External clarification required?** No.
- **Minimum future repair boundary:** Decide cycle replacement semantics, then align preview, cancellation, DB identity, and retry behavior. No strategy is selected here.
- **Validation required before CLOSED:** Approved decision, focused cancelled-cycle regression, actual PostgreSQL uniqueness/race proof, and relevant operational verification.

### FIN-BUG-003 — Delivery eligibility timestamp can move after delivery

- **Domain:** Delivery to settlement eligibility.
- **Classification:** CONFIRMED_BUG.
- **Status:** OPEN.
- **Finding:** Delay calculation uses `Fulfillment.shipmentUpdatedAt` as delivery-time basis, while provider refresh can update that timestamp after the shipment is delivered.
- **Exact current behavior:** `delivery + settlementDelayDays` can move forward after a delivered shipment refresh.
- **Current impact:** Previously matured sources can appear not yet mature.
- **Automation impact:** BLOCKER until a stable delivery-time authority is established.
- **Evidence / relevant code locations:** `backend/src/modules/finance/settlement-approval.service.ts` (SALE timing); `backend/src/modules/shopify/fulfillment-ingestion.service.ts` (`shipmentUpdatedAt` writes); `backend/prisma/schema.prisma` (`Fulfillment.shipmentUpdatedAt`).
- **Production incidence:** UNKNOWN.
- **Product decision required?** A stable authoritative delivered-event rule needs approval if the repository does not already establish one.
- **External clarification required?** UNKNOWN if provider evidence cannot establish the original delivered event locally; do not invent it.
- **Minimum future repair boundary:** Establish/preserve authoritative delivered-event time separately from subsequent refresh time.
- **Validation required before CLOSED:** Repeated-delivered-refresh regression proving cutoff stability, integration/real-DB evidence where applicable, and approved authority rule.

### FIN-BUG-004 — Selected-order diagnostic can contradict actual preview inclusion

- **Domain:** Settlement preview diagnostics.
- **Classification:** CONFIRMED_BUG.
- **Status:** OPEN.
- **Finding:** Selected-order diagnostic can set `candidateIncluded = true` while a blocking `FinanceIntegrityAlert` later removes the row from actual preview candidates.
- **Exact current behavior:** Diagnostic and financial preview disagree for the same selected source.
- **Current impact:** Admin cannot reliably see why a source was excluded.
- **Automation impact:** Explanation/triage blocker; not itself proof of duplicate monetary authority.
- **Evidence / relevant code locations:** `backend/src/modules/finance/settlement-approval.service.ts` (selected-order diagnostic construction and candidate selection/filtering); `backend/prisma/schema.prisma` (`FinanceIntegrityAlert`).
- **Production incidence:** UNKNOWN.
- **Product decision required?** No identified new product rule.
- **External clarification required?** No.
- **Minimum future repair boundary:** Derive diagnostic inclusion from the same final blocker-aware candidate decision as preview.
- **Validation required before CLOSED:** Selected-order plus blocking-alert regression comparing diagnostic and resulting candidate list.

### FIN-BUG-005 — One correction deduction can abort a whole scheduled dry-run

- **Domain:** Settlement scheduling and Financial Correction.
- **Classification:** CONFIRMED functional failure.
- **Status:** OPEN.
- **Finding:** Scheduled settlement uses date-range scope. A pending before-settlement deduction requires vendor-wide scope and causes preview to throw; the multi-vendor dry-run does not isolate that exception per vendor.
- **Exact current behavior:** One affected vendor can prevent useful results for unrelated vendors.
- **Current impact:** Scheduled visibility fails across vendors rather than isolating the exception.
- **Automation impact:** BLOCKER for robust multi-vendor automation. This is not permission to ignore the correction.
- **Evidence / relevant code locations:** `backend/src/modules/finance/settlement-schedule.service.ts` (multi-vendor dry-run loop); `backend/src/modules/finance/settlement-approval.service.ts` (date-range preview and correction scope checks).
- **Production incidence:** UNKNOWN.
- **Product decision required?** Yes for how correction sources enter future scheduling; exception isolation itself does not authorize bypassing them.
- **External clarification required?** No.
- **Minimum future repair boundary:** Isolate vendor errors in schedule reporting and resolve correction-scope policy without dropping economic sources.
- **Validation required before CLOSED:** Multi-vendor test with one pending deduction, unaffected-vendor result, and correction still blocked/visible; relevant real-DB validation.

### FIN-BUG-006 — Inactive VendorFinancialProfile can be unintentionally reactivated

- **Domain:** Vendor financial profile.
- **Classification:** CONFIRMED_BUG.
- **Status:** OPEN.
- **Finding:** Normal profile GET selects active profiles only. An existing inactive profile appears to the edit flow as no active profile; UI omits `active`; upsert uses `input.active ?? true` and may save defaults/form values over existing policy.
- **Exact current behavior:** Saving finance settings can silently reactivate an intentionally inactive profile and replace prior settings.
- **Current impact:** Vendor finance policy can change beyond the Admin's stated edit.
- **Automation impact:** CRITICAL BLOCKER before any scheduler relies on `active=true`.
- **Evidence / relevant code locations:** `backend/src/modules/finance/finance.service.ts` (`getVendorFinancialProfile`, `upsertVendorFinancialProfile`, `input.active ?? true`); `src/pages/VendorProfilePage.tsx` (finance-policy form/payload); `backend/prisma/schema.prisma` (`VendorFinancialProfile`).
- **Production incidence:** UNKNOWN.
- **Product decision required?** No identified new business rule; inactive-state preservation is required.
- **External clarification required?** No.
- **Minimum future repair boundary:** Correct inactive-profile read/update semantics and add targeted regression coverage; no implementation chosen here.
- **Validation required before CLOSED:** Inactive profile read/edit/save regression with real persistence, unchanged inactive state and policy unless explicitly changed.

## Potential defect requiring proof

### FIN-RISK-001 — Multiple-return hold may be released by unrelated refund evidence

- **Domain:** Return hold and settlement eligibility.
- **Classification:** LIKELY_BUG_NEEDS_RUNTIME_PROOF.
- **Status:** NEEDS_RUNTIME_PROOF.
- **Finding:** Approved-return hold logic appears to treat any refund evidence on an allocation as sufficient to suppress the hold.
- **Exact current behavior:** Code suggests that with one refunded return and another approved-but-unrefunded return on the same allocation, the latter might not hold the SALE. Whether this state is reachable is unproven.
- **Current impact:** Potential premature settlement; not confirmed.
- **Automation impact:** Potential eligibility blocker pending proof; do not turn it into a confirmed bug without evidence.
- **Evidence / relevant code locations:** `backend/src/modules/finance/settlement-approval.service.ts` (return/hold candidate logic); return/refund models in `backend/prisma/schema.prisma`.
- **Production incidence:** UNKNOWN.
- **Product decision required?** UNKNOWN until the multi-return state and existing rule are proven.
- **External clarification required?** UNKNOWN; use local/schema evidence first.
- **Minimum future repair boundary:** Establish a valid multi-return fixture and test hold behavior before choosing any code change.
- **Validation required before CLOSED:** Runtime or production-safe schema/fixture proof of reachability, focused hold test, then implementation/integration validation if defect confirmed.

## Design gaps and current-architecture facts

These entries identify missing or unresolved contracts. They are **not** authorization to implement a new rule.

### FIN-DESIGN-001 — Biweekly means global even ISO week, not vendor 14-day cadence

- **Domain:** Settlement cadence.
- **Classification:** BUSINESS_RULE_MISMATCH / DESIGN_GAP.
- **Status:** OPEN.
- **Finding:** `BIWEEKLY` means configured UTC weekday in an even ISO week; no vendor-specific anchor exists.
- **Exact current behavior:** ISO week 53/year boundaries can create a 21-day gap. Current profile does not prove “every 14 days.”
- **Current impact:** Cadence expectations can diverge from schedule.
- **Automation impact:** Blocks an exact biweekly/every-14-day promise.
- **Evidence / relevant code locations:** `backend/src/modules/finance/settlement-schedule.service.ts` (due calculation); `backend/prisma/schema.prisma` (`settlementFrequencyType`, `weeklySettlementDay`).
- **Production incidence:** UNKNOWN.
- **Product decision required?** Yes: calendar/parity versus anchored 14-day semantics.
- **External clarification required?** No.
- **Minimum future repair boundary:** Approve semantics before altering due-date calculation or labels.
- **Validation required before CLOSED:** Approved decision, ISO week-53/year rollover and vendor configuration tests.

### FIN-DESIGN-002 — Settlement frequency is not payment cadence

- **Domain:** Vendor finance policy and payout.
- **Classification:** DESIGN_GAP.
- **Status:** OPEN.
- **Finding:** Weekly/biweekly settings govern scheduled settlement DRAFT due-ness, not payout/EFT frequency or due date.
- **Exact current behavior:** Payout preparation is a separate manual vendor-wide operation; no profile-driven payment cadence is established.
- **Current impact:** Settlement weekday cannot be promised as payment timing.
- **Automation impact:** Payment-ready automation lacks a cadence contract.
- **Evidence / relevant code locations:** `backend/src/modules/finance/settlement-schedule.service.ts`; `backend/src/modules/finance/finance.service.ts` (`preparePayoutBatch`); `src/pages/FinancePage.tsx` (weekday fallback).
- **Production incidence:** UNKNOWN.
- **Product decision required?** Yes if a real payment cadence is desired.
- **External clarification required?** No.
- **Minimum future repair boundary:** Decide whether payment cadence exists and distinguish it from settlement scheduling in API/UI.
- **Validation required before CLOSED:** Approved contract and tests/UI verification of resulting scheduling and payment labels.

### FIN-DESIGN-003 — Scheduled settlement is cumulative, not a closed period

- **Domain:** Settlement period.
- **Classification:** DESIGN_GAP.
- **Status:** OPEN.
- **Finding:** Scheduled DRAFT has `periodStart = null` and `periodEnd` at end of UTC run date; older unclaimed eligible sources can be selected.
- **Exact current behavior:** “Weekly” describes a DRAFT opportunity, not necessarily a week of sales.
- **Current impact:** One settlement can cover multiple older source periods.
- **Automation impact:** Period reporting/payment claims need a decision before automation.
- **Evidence / relevant code locations:** `backend/src/modules/finance/settlement-schedule.service.ts` (run date/preview); `backend/src/modules/finance/settlement-approval.service.ts` (period filters and DRAFT creation).
- **Production incidence:** UNKNOWN.
- **Product decision required?** Yes: cumulative catch-up versus closed economic periods.
- **External clarification required?** No.
- **Minimum future repair boundary:** Define period ownership and reconcile selection, identity, and labels.
- **Validation required before CLOSED:** Approved period contract and boundary/missed-run tests, including actual source coverage.

### FIN-DESIGN-004 — Payout is vendor-wide and can pool settlement cycles

- **Domain:** Payout grouping.
- **Classification:** DESIGN_GAP / CURRENT_ARCHITECTURE_FACT.
- **Status:** OPEN.
- **Finding:** `preparePayoutBatch({ vendorId })` receives no settlement IDs, cycle key, period, or payment date.
- **Exact current behavior:** It can pool eligible APPROVED sources across multiple manual/scheduled settlements, cycles, correction-source settlements, and dates.
- **Current impact:** A payout is not cycle-bound even when UI language might suggest a payment period.
- **Automation impact:** Grouping must be chosen before payment-ready automation.
- **Evidence / relevant code locations:** `backend/src/modules/finance/finance.service.ts` (`preparePayoutBatch` source selection); `src/features/finance/paymentPreparationApi.ts`.
- **Production incidence:** UNKNOWN.
- **Product decision required?** Yes: vendor-wide versus cycle-bound, including multi-cycle pooling.
- **External clarification required?** No.
- **Minimum future repair boundary:** Approve grouping contract before altering source selection or period UI.
- **Validation required before CLOSED:** Approved contract and multi-settlement real-DB/payout/UI verification.

### FIN-DESIGN-005 — Missed/failed settlement-run recovery is undefined

- **Domain:** Scheduled job recovery.
- **Classification:** DESIGN_GAP.
- **Status:** OPEN.
- **Finding:** Job-run identity is unique by run date; failed/processing dates are not simply rerun.
- **Exact current behavior:** A later due run can cumulatively collect older unclaimed sources, but this is not an explicit retry/catch-up contract.
- **Current impact:** Operators cannot infer whether a missed run is retried, skipped, or folded into the next cycle.
- **Automation impact:** BLOCKER for unattended scheduler recovery.
- **Evidence / relevant code locations:** `backend/src/modules/finance/settlement-schedule.service.ts` (job run, cycle key, dry-run/create); `backend/prisma/schema.prisma` (`SettlementScheduleJobRun`).
- **Production incidence:** UNKNOWN.
- **Product decision required?** Yes: recovery/catch-up semantics.
- **External clarification required?** No.
- **Minimum future repair boundary:** Decide recovery behavior, then align job identity, retries, and cumulative selection.
- **Validation required before CLOSED:** Failed/missed/repeated-run tests and real-DB uniqueness verification.

### FIN-DESIGN-006 — Manual settlement can split a scheduled cycle

- **Domain:** Settlement grouping.
- **Classification:** DESIGN_GAP.
- **Status:** OPEN.
- **Finding:** Manual vendor-wide/date-range/selected-order/selected-allocation settlements do not carry a scheduled cycle key.
- **Exact current behavior:** They can consume sources before the scheduled run; the scheduled run sees fewer available rows.
- **Current impact:** `scheduledCycleKey` does not express complete ownership of an economic period.
- **Automation impact:** Cycle completeness cannot be assumed.
- **Evidence / relevant code locations:** `backend/src/modules/finance/settlement-approval.service.ts` (selection scopes, active-line exclusion); `backend/src/modules/finance/settlement-schedule.service.ts` (scheduled key).
- **Production incidence:** UNKNOWN.
- **Product decision required?** Yes if cycles should be complete economic periods.
- **External clarification required?** No.
- **Minimum future repair boundary:** Decide manual/scheduled overlap policy before changing source claims.
- **Validation required before CLOSED:** Approved policy and real-DB overlap/race test.

### FIN-DESIGN-007 — Debt has no cycle cutoff and freezes at payout preparation

- **Domain:** Vendor balance and payout.
- **Classification:** DESIGN_GAP.
- **Status:** OPEN.
- **Finding:** Debt is applied when payout is prepared; there is no established debt-cycle ownership/cutoff.
- **Exact current behavior:** New debt after a DRAFT does not automatically recalculate that frozen payout.
- **Current impact:** Payout amount and later debt position can differ until an explicit revalidation/cancellation/rebuild path is used.
- **Automation impact:** BLOCKER for payment-ready semantics.
- **Evidence / relevant code locations:** `backend/src/modules/finance/finance.service.ts` (`preparePayoutBatch`, debt offset, REVIEW/PAID revalidation); vendor-balance service.
- **Production incidence:** UNKNOWN.
- **Product decision required?** Yes: debt cutoff and stale-payout disposition.
- **External clarification required?** No established external EFT state; that operational state remains UNKNOWN.
- **Minimum future repair boundary:** Decide cutoff/rebuild semantics without modifying PAID history.
- **Validation required before CLOSED:** Real-DB debt-before/after-DRAFT transition tests plus approved policy.

### FIN-DESIGN-008 — Financial Correction sources do not map cleanly to scheduled date ranges

- **Domain:** Financial Correction and settlement scheduling.
- **Classification:** DESIGN_GAP.
- **Status:** OPEN.
- **Finding:** Before-settlement correction credits are vendor-wide; pending deductions require vendor-wide scope/full coverage; scheduled settlement is date-range scoped.
- **Exact current behavior:** Correction sources have no scheduled-cycle attribution, and scheduled date-range cannot truthfully include complete vendor economics by silently ignoring them.
- **Current impact:** Scheduled processing cannot include every authorized correction under current scope rules.
- **Automation impact:** BLOCKER.
- **Evidence / relevant code locations:** `backend/src/modules/finance/settlement-approval.service.ts` (correction scope/selection); `backend/src/modules/finance/settlement-schedule.service.ts` (date-range call).
- **Production incidence:** UNKNOWN.
- **Product decision required?** Yes: correction source attribution and treatment in scheduled cycles.
- **External clarification required?** No.
- **Minimum future repair boundary:** Approve attribution/scope policy; preserve Financial Correction authority and fail-closed checks.
- **Validation required before CLOSED:** Approved contract and credit/deduction/scheduled real-DB regression.

### FIN-DESIGN-009 — Zero payout disposition is unresolved

- **Domain:** Payout.
- **Classification:** DESIGN_GAP / BACKEND_UI_MISMATCH.
- **Status:** OPEN.
- **Finding:** Settlement UI can say “Accounting Review” and “No payout amount,” yet payout preparation can create a `0.00` DRAFT and payout actions are primarily status-driven.
- **Exact current behavior:** No approved contract establishes whether a zero batch should progress to REVIEW/PAID as accounting evidence or stop before payment workflow.
- **Current impact:** A zero-value batch can be presented within a payment process without clear meaning.
- **Automation impact:** BLOCKER until disposition is approved.
- **Evidence / relevant code locations:** `src/pages/AdminSettlementApprovalsPage.tsx` (zero-payable copy); `backend/src/modules/finance/finance.service.ts` (`preparePayoutBatch`, payout transitions); payout tests under `src/`.
- **Production incidence:** UNKNOWN.
- **Product decision required?** Yes.
- **External clarification required?** No.
- **Minimum future repair boundary:** Decide zero-batch purpose and allowed transitions; then align backend/UI.
- **Validation required before CLOSED:** Approved disposition and real-DB full-transition/browser tests as applicable.

### FIN-DESIGN-010 — Negative payout disposition is unresolved

- **Domain:** Payout.
- **Classification:** DESIGN_GAP.
- **Status:** OPEN.
- **Finding:** Negative payout paths appear in code/tests as operator-review conditions; there is no approved external negative-payment policy.
- **Exact current behavior:** Preparation can represent negative amounts, but their authorized downstream disposition is unresolved.
- **Current impact:** Admin/payment interpretation is ambiguous.
- **Automation impact:** BLOCKER.
- **Evidence / relevant code locations:** `backend/src/modules/finance/finance.service.ts` (`preparePayoutBatch`, payout status transitions); payout tests under `src/`.
- **Production incidence:** UNKNOWN; real-DB progression is not proven.
- **Product decision required?** Yes.
- **External clarification required?** External EFT behavior is UNKNOWN and must not be invented.
- **Minimum future repair boundary:** Approve negative-amount disposition before automation or transition changes.
- **Validation required before CLOSED:** Approved rule plus real-DB negative preparation/transition coverage.

### FIN-DESIGN-011 — IBAN/payment identity is not a proven payout-readiness gate

- **Domain:** Vendor billing/payment identity.
- **Classification:** DESIGN_GAP.
- **Status:** OPEN.
- **Finding:** IBAN exists in billing profile data, but payout preparation does not establish its completeness as a prerequisite.
- **Exact current behavior:** A DRAFT payout is not proof an external EFT can be executed.
- **Current impact:** “Payment ready” cannot be inferred solely from payout creation.
- **Automation impact:** Future payment-ready definition needs an approved identity/completeness rule.
- **Evidence / relevant code locations:** `backend/prisma/schema.prisma` (vendor billing/payment fields); `backend/src/modules/finance/finance.service.ts` (`preparePayoutBatch`); `src/pages/VendorProfilePage.tsx` (billing profile).
- **Production incidence:** UNKNOWN.
- **Product decision required?** Yes for a future payment-ready gate.
- **External clarification required?** UNKNOWN if external bank requirements become in scope; none are asserted here.
- **Minimum future repair boundary:** Define readiness separately from payout DRAFT and identify authoritative payment identity.
- **Validation required before CLOSED:** Approved policy and backend/UI readiness tests; no real EFT test implied.

## UI and API consistency findings

### FIN-UI-001 — Scheduled READY is not authoritative

- **Domain:** Scheduled settlement UI.
- **Classification:** BACKEND_UI_MISMATCH.
- **Status:** OPEN.
- **Finding:** Scheduled UI can show READY despite cancelled-cycle uniqueness, premature refunded-SALE inclusion, or later approval rejection.
- **Exact current behavior:** READY is preview-level, not durable creation/approval authority.
- **Current impact:** Admin may act on a misleading readiness label.
- **Automation impact:** BLOCKER if automation treats READY as final.
- **Evidence / relevant code locations:** `src/pages/AdminScheduledSettlementsPage.tsx`; `backend/src/modules/finance/settlement-schedule.service.ts`; `backend/src/modules/finance/settlement-approval.service.ts`; FIN-BUG-001/002.
- **Production incidence:** UNKNOWN.
- **Product decision required?** For cancelled-cycle semantics, yes; otherwise align UI with proven stage.
- **External clarification required?** No.
- **Minimum future repair boundary:** Make readiness stage/known blockers explicit after underlying predicates are resolved.
- **Validation required before CLOSED:** UI/API/backend paired tests and real-DB cancelled-cycle proof.

### FIN-UI-002 — APPROVED scheduled settlement can display “In Review”

- **Domain:** Scheduled settlement UI.
- **Classification:** MISLEADING_UI.
- **Status:** OPEN.
- **Finding:** DRAFT and APPROVED states map to the same “In Review” wording.
- **Exact current behavior:** Admin cannot infer approval authority from the displayed status.
- **Current impact:** Settlement state is obscured.
- **Automation impact:** Payment-ready triage may misclassify approvals.
- **Evidence / relevant code locations:** `src/pages/AdminScheduledSettlementsPage.tsx` (status mapping).
- **Production incidence:** UNKNOWN.
- **Product decision required?** No new finance rule.
- **External clarification required?** No.
- **Minimum future repair boundary:** Distinguish DRAFT and APPROVED labels without changing authority.
- **Validation required before CLOSED:** Focused status rendering tests for both states.

### FIN-UI-003 — Settlement Refund tab can miss detail-level refund issues

- **Domain:** Settlement approval UI.
- **Classification:** BACKEND_UI_MISMATCH.
- **Status:** OPEN.
- **Finding:** Queue-tab summary issue filtering does not emit the same Refund issue represented in detail logic.
- **Exact current behavior:** Refund-affected rows may be absent from the expected Refund tab.
- **Current impact:** Admin may miss a relevant exception.
- **Automation impact:** Exception queues are not reliable as complete classification.
- **Evidence / relevant code locations:** `src/pages/AdminSettlementApprovalsPage.tsx` (tab filters, summary issues, detail issues); settlement approvals API types.
- **Production incidence:** UNKNOWN.
- **Product decision required?** No identified new rule.
- **External clarification required?** No.
- **Minimum future repair boundary:** Align summary/tab and detail issue classification.
- **Validation required before CLOSED:** Refund-affected fixture asserting queue tab and detail consistency.

### FIN-UI-004 — “Payment Period” is not a real source/payment period

- **Domain:** Payment preparation UI.
- **Classification:** MISLEADING_UI.
- **Status:** OPEN.
- **Finding:** Existing batch “Payment Period” can derive from batch creation month, while backend payout has no period/cycle input and may pool settlements.
- **Exact current behavior:** Displayed month does not prove source coverage.
- **Current impact:** Admin may misunderstand which sales/cycles are included.
- **Automation impact:** Payment-ready explanations lack reliable period identity.
- **Evidence / relevant code locations:** `src/pages/AdminPaymentPreparationPage.tsx` (`getPaymentPeriodKey`, “Payment Period”); `backend/src/modules/finance/finance.service.ts` (`preparePayoutBatch`).
- **Production incidence:** UNKNOWN.
- **Product decision required?** Yes if a true period must be represented.
- **External clarification required?** No.
- **Minimum future repair boundary:** Label the actual date meaning or implement only an approved period contract.
- **Validation required before CLOSED:** Multi-settlement payout UI/backend coverage and approved wording/period rule.

### FIN-UI-005 — Settlement weekday appears in payment-date context

- **Domain:** Finance overview UI.
- **Classification:** MISLEADING_UI.
- **Status:** OPEN.
- **Finding:** With no payout, finance overview uses profile `weeklySettlementDay` as a payment-date-style fallback.
- **Exact current behavior:** That field controls settlement DRAFT schedule, not EFT date.
- **Current impact:** UI implies an undefined payment cadence.
- **Automation impact:** Cannot be treated as payment-ready schedule.
- **Evidence / relevant code locations:** `src/pages/FinancePage.tsx` (weekday fallback); `backend/src/modules/finance/settlement-schedule.service.ts`.
- **Production incidence:** UNKNOWN.
- **Product decision required?** Yes if future payment timing is to be shown.
- **External clarification required?** No.
- **Minimum future repair boundary:** Separate settlement schedule copy from actual payment timing.
- **Validation required before CLOSED:** No-payout UI test against backend cadence semantics.

### FIN-UI-006 — “Refund adjustment pending” may describe non-refund debt

- **Domain:** Payment waiting UI.
- **Classification:** MISLEADING_UI.
- **Status:** OPEN.
- **Finding:** Outstanding debt/debt offset can be labeled refund adjustment even when VendorBalance debt has Financial Correction or another supported provenance.
- **Exact current behavior:** Wording can overstate refund origin.
- **Current impact:** Admin may misdiagnose payment reduction.
- **Automation impact:** Exception reason needs provenance before unattended routing.
- **Evidence / relevant code locations:** `src/pages/AdminPaymentPreparationPage.tsx` and `src/pages/AdminScheduledSettlementsPage.tsx` (copy); `backend/src/modules/finance/finance.service.ts` (debt offset); VendorBalance source records.
- **Production incidence:** UNKNOWN.
- **Product decision required?** No new monetary rule.
- **External clarification required?** No.
- **Minimum future repair boundary:** Use source-accurate debt/adjustment terminology.
- **Validation required before CLOSED:** UI tests for refund-origin and correction-origin debt.

### FIN-UI-007 — Period labels imply bounded coverage although selection is cumulative

- **Domain:** Settlement period UI.
- **Classification:** MISLEADING_UI.
- **Status:** OPEN.
- **Finding:** Scheduled `periodStart` is null and older unpaid sources can enter, but “Settlement Period”/“Through” can read as bounded coverage.
- **Exact current behavior:** Display does not establish a closed start-to-end source period.
- **Current impact:** Admin may misunderstand included history.
- **Automation impact:** Period-based reporting claims need product contract.
- **Evidence / relevant code locations:** `src/pages/AdminSettlementApprovalsPage.tsx` (period label); `backend/src/modules/finance/settlement-schedule.service.ts`; `backend/src/modules/finance/settlement-approval.service.ts`.
- **Production incidence:** UNKNOWN.
- **Product decision required?** Yes if bounded periods are desired.
- **External clarification required?** No.
- **Minimum future repair boundary:** Clarify cumulative meaning or adopt an approved closed-period model.
- **Validation required before CLOSED:** UI test with older source included and approved period semantics.

### FIN-UI-008 — Finance-policy helper overstates “future ledger rows only”

- **Domain:** Vendor finance-profile UI.
- **Classification:** MISLEADING_UI.
- **Status:** OPEN.
- **Finding:** Some policy values are snapshotted on SALE rows, but frequency, weekday, and automation flags affect future schedule evaluation immediately.
- **Exact current behavior:** Blanket “future ledger rows only” copy is false for every field taken together.
- **Current impact:** Admin may misunderstand when policy edits take effect.
- **Automation impact:** Schedule expectations can be wrong after profile edits.
- **Evidence / relevant code locations:** `src/pages/VendorProfilePage.tsx` (helper/success copy); `backend/src/modules/finance/settlement-schedule.service.ts` (current profile read); `backend/src/modules/finance/finance.service.ts` (SALE snapshots).
- **Production incidence:** UNKNOWN.
- **Product decision required?** No new rule for accurately describing existing behavior.
- **External clarification required?** No.
- **Minimum future repair boundary:** Explain field-specific timing without altering history.
- **Validation required before CLOSED:** Profile UI copy test against schedule/snapshot behavior.

### FIN-UI-009 — Inactive finance-profile state is not safely represented/editable

- **Domain:** Vendor finance-profile UI/API.
- **Classification:** BACKEND_UI_MISMATCH.
- **Status:** OPEN.
- **Finding:** Policy activity can be displayed, but normal GET filters inactive records and edit payload has no explicit `active` field.
- **Exact current behavior:** This contributes to FIN-BUG-006 reactivation risk.
- **Current impact:** Admin cannot reliably preserve or intentionally edit inactive state in this flow.
- **Automation impact:** CRITICAL when `active` controls scheduling.
- **Evidence / relevant code locations:** `backend/src/modules/finance/finance.service.ts` (`getVendorFinancialProfile`, upsert); `src/pages/VendorProfilePage.tsx` (form/payload).
- **Production incidence:** UNKNOWN.
- **Product decision required?** No new activity rule identified.
- **External clarification required?** No.
- **Minimum future repair boundary:** Resolve FIN-BUG-006 and represent activity honestly in GET/edit flow.
- **Validation required before CLOSED:** Inactive-profile API/UI/real-DB regression.

### FIN-UI-010 — Current profile delay may not be candidate source delay

- **Domain:** Scheduled settlement UI.
- **Classification:** MISSING_UI_EVIDENCE.
- **Status:** OPEN.
- **Finding:** Scheduled UI displays current vendor delay while historical SALE rows can retain individual delay snapshots.
- **Exact current behavior:** Displayed profile value is not proof all candidates use it.
- **Current impact:** Admin may assume a uniform delay that is not used for every row.
- **Automation impact:** Eligibility explanation needs source-specific evidence.
- **Evidence / relevant code locations:** `src/pages/AdminScheduledSettlementsPage.tsx` (schedule delay); `backend/src/modules/finance/settlement-approval.service.ts` (SALE eligibility); `backend/prisma/schema.prisma` (`settlementDelayDaysSnapshot`).
- **Production incidence:** UNKNOWN.
- **Product decision required?** No new delay rule merely to show evidence accurately.
- **External clarification required?** No.
- **Minimum future repair boundary:** Distinguish current policy from per-source historical delay.
- **Validation required before CLOSED:** Mixed-snapshot candidate fixture and UI/API consistency test.

### FIN-UI-011 — UTC schedule date may display as another local day

- **Domain:** Scheduled settlement date presentation.
- **Classification:** MISLEADING_UI / PRESENTATION_MISMATCH.
- **Status:** OPEN.
- **Finding:** Schedule identity and period end are UTC; browser-local formatting can render a different calendar date around UTC midnight.
- **Exact current behavior:** Display can diverge from the UTC run-date identity in some timezones.
- **Current impact:** Admin may misidentify a cycle.
- **Automation impact:** Calendar/cutoff communication needs an authoritative timezone decision.
- **Evidence / relevant code locations:** `backend/src/modules/finance/settlement-schedule.service.ts` (UTC run date); `src/pages/AdminScheduledSettlementsPage.tsx` and shared date formatting.
- **Production incidence:** UNKNOWN.
- **Product decision required?** Yes: authoritative business timezone is unresolved.
- **External clarification required?** No.
- **Minimum future repair boundary:** Approve business calendar and align date labels/formatting to it.
- **Validation required before CLOSED:** Cross-timezone boundary display tests under approved rule.

## Test-quality gaps

Each entry describes absent or insufficiently proven coverage at this baseline, not a new business requirement.

### FIN-TEST-001 — Cancelled-cycle test misses PostgreSQL uniqueness
- **Domain:** Scheduled settlement tests. **Classification:** TEST_COVERAGE_GAP. **Status:** OPEN.
- **Finding / exact current behavior:** Mocked cancelled-cycle expectations do not execute the unconditional `scheduledCycleKey` unique constraint.
- **Current impact:** Test may give false confidence in replacement. **Automation impact:** Blocks confidence in retry.
- **Evidence / relevant code locations:** `backend/prisma/schema.prisma` (`scheduledCycleKey @unique`); schedule tests under `src/`; `backend/src/modules/finance/settlement-schedule.service.ts`.
- **Production incidence:** UNKNOWN. **Product decision required?** Yes, FIN-BUG-002. **External clarification required?** No.
- **Minimum future repair boundary:** Add real-DB test after cycle policy is chosen.
- **Validation required before CLOSED:** PostgreSQL cancelled-key/replacement/concurrency result matching approved semantics.

### FIN-TEST-002 — No paired refunded-SALE preview/DRAFT/approval delay test
- **Domain:** Settlement eligibility tests. **Classification:** TEST_COVERAGE_GAP. **Status:** OPEN.
- **Finding / exact current behavior:** Existing inclusion expectation is not paired with approval delivery-delay authority.
- **Current impact:** FIN-BUG-001 mismatch is not guarded end to end. **Automation impact:** Eligibility regression risk.
- **Evidence / relevant code locations:** `backend/src/modules/finance/settlement-approval.service.ts` (`rowIsEligible`, approval checks); settlement tests under `src/`.
- **Production incidence:** UNKNOWN. **Product decision required?** No new rule. **External clarification required?** No.
- **Minimum future repair boundary:** Add same-fixture preview/DRAFT/approval assertions.
- **Validation required before CLOSED:** Focused boundary test plus applicable real-DB transition.

### FIN-TEST-003 — No delivered-refresh cutoff stability regression
- **Domain:** Delivery eligibility tests. **Classification:** TEST_COVERAGE_GAP. **Status:** OPEN.
- **Finding / exact current behavior:** No dedicated repeated delivered-shipment refresh test proves original cutoff remains stable.
- **Current impact:** FIN-BUG-003 can recur unnoticed. **Automation impact:** Maturity-date uncertainty.
- **Evidence / relevant code locations:** `backend/src/modules/shopify/fulfillment-ingestion.service.ts`; `backend/src/modules/finance/settlement-approval.service.ts`.
- **Production incidence:** UNKNOWN. **Product decision required?** Stable delivery-time authority may require approval. **External clarification required?** UNKNOWN.
- **Minimum future repair boundary:** Test original delivered timestamp through repeated refresh.
- **Validation required before CLOSED:** Provider-ingestion plus finance-eligibility regression under approved authority.

### FIN-TEST-004 — No proven multi-return hold fixture
- **Domain:** Return/settlement tests. **Classification:** TEST_COVERAGE_GAP. **Status:** OPEN.
- **Finding / exact current behavior:** No proven fixture combines a refunded return and an approved unrefunded return on one allocation.
- **Current impact:** FIN-RISK-001 remains unproven. **Automation impact:** Potential hold gap.
- **Evidence / relevant code locations:** `backend/src/modules/finance/settlement-approval.service.ts`; return/refund schema and tests.
- **Production incidence:** UNKNOWN. **Product decision required?** UNKNOWN pending reachability proof. **External clarification required?** UNKNOWN.
- **Minimum future repair boundary:** Establish valid schema/runtime fixture before behavioral assertion.
- **Validation required before CLOSED:** Reachability proof and focused hold regression.

### FIN-TEST-005 — No selected-order/alert diagnostic consistency test
- **Domain:** Preview diagnostic tests. **Classification:** TEST_COVERAGE_GAP. **Status:** OPEN.
- **Finding / exact current behavior:** No paired assertion proves `candidateIncluded` matches final preview after a blocking FinanceIntegrityAlert.
- **Current impact:** FIN-BUG-004 is unguarded. **Automation impact:** Exception explanation risk.
- **Evidence / relevant code locations:** `backend/src/modules/finance/settlement-approval.service.ts` (diagnostic/filter); preview tests.
- **Production incidence:** UNKNOWN. **Product decision required?** No. **External clarification required?** No.
- **Minimum future repair boundary:** Add blocking-alert selected-order fixture.
- **Validation required before CLOSED:** Diagnostic and actual candidate list agree in focused test.

### FIN-TEST-006 — Refund-tab classification not proven against detail issues
- **Domain:** Admin settlement UI tests. **Classification:** TEST_COVERAGE_GAP. **Status:** OPEN.
- **Finding / exact current behavior:** No proven Refund-tab test matches detail-level refund issue classification.
- **Current impact:** FIN-UI-003 can hide rows. **Automation impact:** Exception queue confidence gap.
- **Evidence / relevant code locations:** `src/pages/AdminSettlementApprovalsPage.tsx` and its tests.
- **Production incidence:** UNKNOWN. **Product decision required?** No. **External clarification required?** No.
- **Minimum future repair boundary:** Use one refund-affected fixture for both summary tab and detail.
- **Validation required before CLOSED:** UI test proves matching classification.

### FIN-TEST-007 — No ISO week-53 biweekly rollover test
- **Domain:** Schedule calendar tests. **Classification:** TEST_COVERAGE_GAP. **Status:** OPEN.
- **Finding / exact current behavior:** Current parity implementation lacks a dedicated ISO week-53/year rollover expectation.
- **Current impact:** 21-day gap may surprise operators. **Automation impact:** Cadence promise cannot rely on untested boundary.
- **Evidence / relevant code locations:** `backend/src/modules/finance/settlement-schedule.service.ts` (biweekly due calculation); schedule tests.
- **Production incidence:** UNKNOWN. **Product decision required?** Yes, FIN-DESIGN-001. **External clarification required?** No.
- **Minimum future repair boundary:** Add rollover test only against approved cadence contract.
- **Validation required before CLOSED:** ISO week-53 and year-transition assertions.

### FIN-TEST-008 — No real-DB manual/scheduled overlap test
- **Domain:** Settlement grouping tests. **Classification:** TEST_COVERAGE_GAP. **Status:** OPEN.
- **Finding / exact current behavior:** No proven PostgreSQL fixture tests manual consumption followed by scheduled selection and source-lock/race behavior.
- **Current impact:** Cycle-splitting behavior lacks durable proof. **Automation impact:** Cycle ownership uncertainty.
- **Evidence / relevant code locations:** `backend/src/modules/finance/settlement-approval.service.ts`; `backend/src/modules/finance/settlement-schedule.service.ts`; settlement PG tests.
- **Production incidence:** UNKNOWN. **Product decision required?** Yes if cycle completeness desired. **External clarification required?** No.
- **Minimum future repair boundary:** Add overlap/race fixture after grouping policy is clear.
- **Validation required before CLOSED:** Real PostgreSQL source-claim and resulting cycle behavior.

### FIN-TEST-009 — No real-DB multiple-cycle-to-pooled-payout test
- **Domain:** Payout grouping tests. **Classification:** TEST_COVERAGE_GAP. **Status:** OPEN.
- **Finding / exact current behavior:** No proven real-DB test builds multiple scheduled/manual approvals then one pooled payout.
- **Current impact:** Current vendor-wide grouping lacks integrated proof. **Automation impact:** Payment-period claims remain unvalidated.
- **Evidence / relevant code locations:** `backend/src/modules/finance/finance.service.ts` (`preparePayoutBatch`); payout tests under `src/`.
- **Production incidence:** UNKNOWN. **Product decision required?** Yes, FIN-DESIGN-004. **External clarification required?** No.
- **Minimum future repair boundary:** Add integrated fixture without choosing future grouping semantics by assumption.
- **Validation required before CLOSED:** Real-DB pooled sources and UI/source-reference verification under approved contract.

### FIN-TEST-010 — No real-DB debt-after-DRAFT progression proof
- **Domain:** Debt/payout timing tests. **Classification:** TEST_COVERAGE_GAP. **Status:** OPEN.
- **Finding / exact current behavior:** No complete real-DB proof for new debt arriving between payout DRAFT and REVIEW/PAID.
- **Current impact:** Staleness/revalidation behavior is not fully established at transition boundary. **Automation impact:** Payment-ready blocker.
- **Evidence / relevant code locations:** `backend/src/modules/finance/finance.service.ts` (debt offset, payout transitions); vendor-balance tests.
- **Production incidence:** UNKNOWN. **Product decision required?** Yes, FIN-DESIGN-007. **External clarification required?** External EFT state UNKNOWN.
- **Minimum future repair boundary:** Test transition with intervening debt under approved cutoff policy.
- **Validation required before CLOSED:** Real-DB DRAFT→REVIEW→PAID behavior and stale-money disposition.

### FIN-TEST-011 — No complete real-DB zero/negative payout progression contract test
- **Domain:** Payout amount disposition tests. **Classification:** TEST_COVERAGE_GAP. **Status:** OPEN.
- **Finding / exact current behavior:** Mocked amount cases do not prove a full PostgreSQL lifecycle for zero and negative batches under approved disposition rules.
- **Current impact:** Status-based actions and operator meaning remain uncertain. **Automation impact:** Blocks unattended progression.
- **Evidence / relevant code locations:** `backend/src/modules/finance/finance.service.ts` (prepare and transitions); payout tests; `src/pages/AdminSettlementApprovalsPage.tsx` (zero copy).
- **Production incidence:** UNKNOWN. **Product decision required?** Yes, FIN-DESIGN-009/010. **External clarification required?** External EFT behavior UNKNOWN.
- **Minimum future repair boundary:** Decide zero/negative disposition before writing transition expectations.
- **Validation required before CLOSED:** Approved rule and full real-DB transition/UI proof.

## Known automation blockers

Current blockers include FIN-BUG-001, FIN-BUG-002, FIN-BUG-003, FIN-BUG-006, FIN-DESIGN-001, FIN-DESIGN-002, FIN-DESIGN-003, FIN-DESIGN-004, FIN-DESIGN-005, FIN-DESIGN-007, FIN-DESIGN-008, FIN-DESIGN-009, and FIN-DESIGN-010. FIN-BUG-005 blocks robust multi-vendor scheduling; FIN-RISK-001 still requires runtime proof. Findings from future Audits C–G are unresolved and may add blockers.

**This list is not an implementation queue yet.** Roadmap placement happens only after discovery is complete.

## Unresolved product decisions — not bugs

No answer is assigned here. The product owner must explicitly decide:

- What vendor weekly/biweekly should mean in the future, including exact 14-day versus ISO-week semantics and whether a vendor-specific anchor exists.
- Whether a real vendor payment cadence exists separately from settlement DRAFT cadence.
- Whether payout is vendor-wide or cycle-bound, and whether multiple settlement cycles may be pooled.
- Whether cancelled cycles can be replaced and how their identity is preserved.
- Whether missed/failed cycles are retried, skipped, or caught up in a later run.
- How zero and negative payout amounts are disposed of and whether either enters REVIEW/PAID.
- The debt cutoff after payout DRAFT and how stale unpaid batches are handled.
- How Financial Correction sources are attributed to a settlement cycle, if at all.
- The authoritative business timezone/calendar for cycles, due dates, and display.
- Whether future/end-of-day eligibility may be drafted before real-time maturity.
- Whether unresolved terminal refund evidence must block new automation.
- What, if anything, constitutes payment-ready identity/completeness, including IBAN.

**UNRESOLVED PRODUCT DECISIONS MUST NOT BE IMPLEMENTED BY ASSUMPTION.** PAID remains explicit Admin confirmation of external payment.

## Maintenance rule

For every future finance audit:

1. Read this file before beginning.
2. Do not duplicate an existing finding under a new ID.
3. Update existing evidence when a later audit strengthens or weakens it.
4. Add newly discovered issues using the next stable ID.
5. Never mark an issue CLOSED from static inspection alone.
6. A bug can become CLOSED only after approved implementation, focused regression tests, relevant real-DB/integration validation where applicable, and production verification where applicable.
7. Product decisions belong in the unresolved-decisions section until explicitly approved.
8. UNKNOWN stays UNKNOWN until evidence exists.
9. Do not change existing finance business rules merely to make automation easier.
10. PAID remains explicit Admin confirmation of external payment.
