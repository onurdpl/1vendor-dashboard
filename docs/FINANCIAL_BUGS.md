# Financial Bugs & Automation Blockers

Status:
- Living discovery document.
- Implementation is currently frozen.
- Findings are evidence from repository audits unless otherwise stated.
- UNKNOWN means unknown.
- Product decisions are not treated as bugs.
- Do not mark an item fixed without implementation and validation evidence.

Current audited repository baseline: `456a7ec9d759b48649057ff01f4be53c315ad281`.
This SHA is where the initial findings were identified; it is not necessarily a future HEAD. Production incidence is **UNKNOWN** unless explicitly stated otherwise. Evidence paths for initial findings refer to this audited baseline. Initial entries are `OPEN`, except the potential multi-return issue, which is `NEEDS_RUNTIME_PROOF`. Allowed statuses are `OPEN`, `NEEDS_RUNTIME_PROOF`, `BLOCKED_BY_PRODUCT_DECISION`, `BLOCKED_BY_EXTERNAL_INFO`, `FIXED_NOT_VERIFIED`, and `CLOSED`. IDs are stable and must not be renumbered.

Audit C added Logo İşbaşı/accounting findings at repository baseline `f4e92d37de4465ab50a514d64a6ebe55c922ae83`. That SHA identifies the evidence reviewed for those additions; it does not replace the original audited baseline or assert a future HEAD.

Audit D added payment-operations evidence at repository baseline `783064da24bb62150609b85cc3c274bd239b87b1`. It did not establish bank/EFT facts or approve a payment-ready rule.

Audit E added finance-orchestration evidence at repository baseline `af59454e0084f20473e3a64a6cff38b5779d4712`. It did not enable a scheduler, approve unattended financial transitions, or establish provider/bank retry guarantees.

Audit F supplied read-only production-state findings for this register. The reported inspection used `BEGIN READ ONLY` / `ROLLBACK` with `transaction_read_only = on`; this documentation update does not reconnect to production. Production counts below are Audit F-reported observations, not independent queries performed for this edit. Absence of a current instance does not close a static finding.

## Confirmed functional defects

### FIN-BUG-001 — SALE refund impact bypasses settlement delay

- **Domain:** Settlement eligibility.
- **Classification:** CONFIRMED_BUG.
- **Status:** OPEN.
- **Finding:** A SALE with positive refund impact can become `partially_refunded` before delivery/delay evaluation in preview or DRAFT selection; `rowIsEligible` accepts it. Approval later evaluates delivery delay for every SALE.
- **Exact current behavior:** The same source can enter a DRAFT before delivery/waiting-period maturity and then be rejected at approval. An existing test expects an unfulfilled refunded SALE to be included; this is not just missing coverage.
- **Current impact:** Preview/DRAFT and approval give conflicting eligibility answers.
- **Automation impact:** BLOCKER; preview/DRAFT is not final economic authority.
- **Audit F production evidence — CANNOT_PROVE_FROM_RETAINED_DATA:** Thirteen refunded SALE ledgers participate in settlements; ten had a RefundRecord before settlement creation. None of those ten settlements was created before its currently retained `settlementEligibleAt`, and none of their APPROVED subset was approved before it. Historical snapshots recorded refund detected/included and `partially_refunded`, but omit `refundOffsetAppliedBeforeSettlement`. No delay-bypass monetary incident was proven; the code defect remains OPEN.
- **Audit E evidence:** A future worker cannot safely promote scheduled preview or DRAFT inclusion to approval authority; approval still performs its own revalidation and can reject this same refunded SALE.
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
- **Audit F production evidence — NO_CURRENT_INSTANCE_FOUND:** Eleven settlements include two scheduled DRAFTs, but no CANCELLED scheduled cycle or duplicate `scheduledCycleKey` was found. This does not change the service/unique-constraint contradiction or close the defect.
- **Audit E evidence:** The scheduled DRAFT transaction rechecks active approvals, but cancellation retains the unconditionally unique cycle key. Neither a repeated job date nor a fresh preview can make that key reusable.
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
- **Audit F production evidence — CONFIRMED_PRODUCTION_EXPOSURE:** Of 67 fulfillments, 58 fulfilled rows retain both `fulfilledAt` and `shipmentUpdatedAt`; the latter is later on 43 (maximum observed difference 1 day 16:25:44). Thirty-two shifted fulfilled SALE pairs have positive historical delay. Tested retained `settlementEligibleAt` values matched neither simple timestamp-plus-delay formula, so exact historical monetary impact cannot be reconstructed from these fields.
- **Audit E evidence:** Replaying scheduled selection cannot stabilize an eligibility cutoff whose underlying delivery timestamp may move after provider refresh.
- **Evidence / relevant code locations:** `backend/src/modules/finance/settlement-approval.service.ts` (SALE timing); `backend/src/modules/shopify/fulfillment-ingestion.service.ts` (`shipmentUpdatedAt` writes); `backend/prisma/schema.prisma` (`Fulfillment.shipmentUpdatedAt`).
- **Production incidence:** UNKNOWN.
- **Product decision required?** A stable authoritative delivered-event rule needs approval if the repository does not already establish one.
- **External clarification required?** UNKNOWN if provider evidence cannot establish the original delivered event locally; do not invent it.
- **Minimum future repair boundary:** Establish/preserve authoritative delivered-event time separately from subsequent refresh time.
- **Validation required before CLOSED:** Repeated-delivered-refresh regression proving cutoff stability, integration/real-DB evidence where applicable, and approved authority rule.

### FIN-BUG-004 — Selected-order diagnostic can contradict actual preview inclusion

- **Domain:** Settlement preview diagnostics.
- **Classification:** CONFIRMED_BUG.
- **Status:** FIXED_NOT_VERIFIED — implementation and focused/full local tests passed; production deployment was verified, but case-specific runtime verification remains outstanding.
- **Finding:** The selected-order diagnostic previously set `candidateIncluded = true` while a blocking `FinanceIntegrityAlert` removed the row from actual preview candidates.
- **Exact current behavior:** Diagnostic inclusion now derives from final filtered preview-line membership. A selected row removed by the existing integrity-alert filter reports excluded through the existing `excludedReason` field, using the observed alert category; a surviving row reports included. Economic eligibility, line membership, and settlement amounts are unchanged.
- **Current impact:** The local diagnostic/preview contradiction is repaired; historical production incidence and live alert-filtered behavior remain UNKNOWN.
- **Automation impact:** Explanation/triage blocker; not itself proof of duplicate monetary authority.
- **Evidence / relevant code locations:** `backend/src/modules/finance/settlement-approval.service.ts` (final line IDs and observed alert category passed to selected-order diagnostics); `src/settlement-approval.test.ts` (selected alert, same-order multi-row, and DRAFT membership regressions); `backend/prisma/schema.prisma` (`FinanceIntegrityAlert`). No API shape, Prisma schema, migration, or production-data change.
- **Reported production deployment and read-only discovery:** The supplied deployment check directly verified production `git rev-parse HEAD` as implementation commit `9d8d778053c00a35af1e7251d0b65566e434e13d`. A separate production PostgreSQL inspection used `BEGIN READ ONLY` and `ROLLBACK`; it found one `FinanceIntegrityAlert`, linked through both `vendorAllocationId` and `allocationEconomicTransferId`, with `status=resolved`, `category=transfer_failed`, `severity=critical`, and `resolvedAt` present. Zero active/unresolved alerts were observed. No synthetic alert, reopened alert, settlement/order mutation, or financial-history mutation was used for verification. These are supplied observations, not production access performed for this documentation update.
- **Production incidence:** UNKNOWN.
- **Product decision required?** No identified new product rule.
- **External clarification required?** No.
- **Minimum future repair boundary:** Implemented locally within selected-order diagnostics; no economic-selection repair was made.
- **Validation required before CLOSED:** Focused selected-order/blocking-alert and broader preview/DRAFT tests passed locally, and deployment of the implementation commit was verified. No suitable active/unresolved alert case existed in the reported production inspection, so the live diagnostic/preview comparison was not exercised. Read-only runtime comparison of diagnostic, resulting preview lines, and totals remains pending until a safe naturally occurring case exists; do not manufacture a production finance mutation.

### FIN-BUG-005 — One correction deduction can abort a whole scheduled dry-run

- **Domain:** Settlement scheduling and Financial Correction.
- **Classification:** CONFIRMED functional failure.
- **Status:** OPEN.
- **Finding:** Scheduled settlement uses date-range scope. A pending before-settlement deduction requires vendor-wide scope and causes preview to throw; the multi-vendor dry-run does not isolate that exception per vendor.
- **Exact current behavior:** One affected vendor can prevent useful results for unrelated vendors.
- **Current impact:** Scheduled visibility fails across vendors rather than isolating the exception.
- **Automation impact:** BLOCKER for robust multi-vendor automation. This is not permission to ignore the correction.
- **Audit E evidence:** Individual DRAFT-creation exceptions are caught and later vendors continue. The preliminary dry-run, and the second dry-run before creation, have no per-vendor exception boundary; an exception there aborts the multi-vendor execution before later vendors are reached.
- **Evidence / relevant code locations:** `backend/src/modules/finance/settlement-schedule.service.ts` (multi-vendor dry-run loop); `backend/src/modules/finance/settlement-approval.service.ts` (date-range preview and correction scope checks).
- **Production incidence:** UNKNOWN.
- **Product decision required?** Yes for how correction sources enter future scheduling; exception isolation itself does not authorize bypassing them.
- **External clarification required?** No.
- **Minimum future repair boundary:** Isolate vendor errors in schedule reporting and resolve correction-scope policy without dropping economic sources.
- **Validation required before CLOSED:** Multi-vendor test with one pending deduction, unaffected-vendor result, and correction still blocked/visible; relevant real-DB validation.

### FIN-BUG-006 — Inactive VendorFinancialProfile can be unintentionally reactivated

- **Domain:** Vendor financial profile.
- **Classification:** CONFIRMED_BUG.
- **Status:** FIXED_NOT_VERIFIED.
- **Finding:** Before the fix, normal profile GET selected active profiles only. An existing inactive profile appeared to the edit flow as no active profile; UI omitted `active`; upsert used `input.active ?? true` and could save defaults/form values over existing policy.
- **Pre-fix behavior:** Saving finance settings could silently reactivate an intentionally inactive profile and replace prior settings.
- **Current impact:** Vendor finance policy can change beyond the Admin's stated edit.
- **Automation impact:** CRITICAL BLOCKER before any scheduler relies on `active=true`.
- **Audit F production evidence — NO_CURRENT_INSTANCE_FOUND:** Both production VendorFinancialProfile rows are active; no inactive profile currently exposes this edit-flow bug. Historical silent reactivation was not proven. The static defect remains OPEN.
- **Audit E evidence:** Schedule profile enumeration filters for `active=true`; the inactive-profile edit/reactivation defect therefore directly affects which vendors a future worker would consider.
- **Evidence / relevant code locations:** `backend/src/modules/finance/finance.service.ts` (`getVendorFinancialProfile`, `upsertVendorFinancialProfile`, `input.active ?? true`); `src/pages/VendorProfilePage.tsx` (finance-policy form/payload); `backend/prisma/schema.prisma` (`VendorFinancialProfile`).
- **Production incidence:** UNKNOWN.
- **Product decision required?** No identified new business rule; inactive-state preservation is required.
- **External clarification required?** No.
- **Minimum future repair boundary:** Correct inactive-profile read/update semantics and add targeted regression coverage; no implementation chosen here.
- **Validation required before CLOSED:** Inactive profile read/edit/save regression with real persistence, unchanged inactive state and policy unless explicitly changed.
- **Implementation evidence:** The Admin-specific GET now reads the persisted row regardless of `active`; the Admin page uses that GET and keeps its cache separate from the vendor-facing read. Ordinary upsert reads persisted settings and omits `active` from an existing-row update when input omits it, while new-row default and explicit Admin input remain unchanged. Focused service/route/UI tests and an isolated PostgreSQL 16 read/edit/reload/scheduler regression passed. The scheduler's `active=true` predicate and historical finance records were not changed; there was no schema change, migration, or backfill. Production runtime verification remains pending; do not treat Audit F's absence of inactive rows as a live regression case.

### FIN-BUG-007 — Concurrent Logo create can send the same invoice request more than once

- **Domain:** Logo İşbaşı invoice execution.
- **Classification:** CONFIRMED_BUG.
- **Status:** OPEN.
- **Finding:** Two create operations can load the same executable `PENDING` or `FAILED` local invoice record before either external request completes. No pre-send row lock, atomic execution claim, `EXECUTING` state, or demonstrated provider idempotency key prevents both HTTP requests from leaving the application.
- **Exact current behavior:** The partial unique DB index protects against a second active **local** invoice record for the settlement/provider, not a second provider POST for the same record.
- **Current impact:** Duplicate external create requests are possible. Whether Logo actually issues two invoices is UNKNOWN.
- **Automation impact:** CRITICAL BLOCKER before unattended Logo create.
- **Audit E evidence:** The external POST has no durable exclusive pre-send claim. A crash after provider send but before local result persistence can leave apparently executable local state despite an UNKNOWN external outcome; unattended replay is unsafe. Provider idempotency remains UNKNOWN.
- **Evidence / relevant code locations:** `backend/src/modules/finance/settlement-logo-commission-invoice-create.service.ts` (status read, validation, provider send); `backend/src/modules/finance/settlement-commission-invoice-record.service.ts` (status updates); `backend/prisma/migrations/20260610170000_add_settlement_commission_invoice_model/migration.sql` (active-record partial unique index).
- **Production incidence:** UNKNOWN.
- **Product decision required?** No new business rule established by this concurrency defect.
- **External clarification required?** Yes: Logo provider idempotency and duplicate-create behavior.
- **Minimum future repair boundary:** Durable exclusive execution ownership plus provider-safe idempotency/reconciliation semantics.
- **Validation required before CLOSED:** Focused service tests, real PostgreSQL concurrency test, provider contract evidence, and relevant integration verification.

### FIN-BUG-008 — Aggregated Logo line VAT can diverge from settlement line-rounded VAT

- **Domain:** Commission invoice monetary representation.
- **Classification:** CONFIRMED_BUG — local contract mismatch.
- **Status:** OPEN.
- **Finding:** Settlement commission VAT is calculated and rounded at financial-line level, then summed. The Logo payload sends one aggregate commission line and one VAT rate. VAT calculated on that aggregate is not guaranteed to equal the frozen sum of individually rounded VAT amounts.
- **Exact current behavior:** Two small commission lines can each round to a VAT amount whose sum differs from VAT rounded once on their aggregate commission. Actual Logo rounding behavior remains UNKNOWN.
- **Current impact:** Potential invoice-total mismatch between frozen settlement economics and the provider document; actual production mismatch is unproven.
- **Automation impact:** BLOCKER before treating invoice monetary equivalence as authoritative.
- **Audit F production evidence — CANNOT_PROVE_FROM_RETAINED_DATA:** All five locally CREATED production Logo invoice rows lack stored `invoiceTotalMinor` and `invoiceCurrency`; the proposed provider-total comparison cannot be performed from retained data. No production monetary mismatch is established, and the local contract finding remains OPEN.
- **Evidence / relevant code locations:** `backend/src/modules/finance/payout-calculator.ts` (per-line commission VAT rounding); `backend/src/modules/finance/settlement-approval.service.ts` (line totals summed); `backend/src/modules/finance/settlement-logo-request-snapshot-builder.service.ts` and `backend/src/modules/logo-isbasi/logo-isbasi-commission-preview.ts` (single aggregate Logo line and VAT rate).
- **Production incidence:** UNKNOWN.
- **Product decision required?** Yes: accounting-approved invoice representation and tolerance.
- **External clarification required?** Yes: Logo VAT rounding behavior.
- **Minimum future repair boundary:** Define approved invoice arithmetic representation and reconcile provider result against frozen settlement authority.
- **Validation required before CLOSED:** Focused small-amount/multiple-line rounding tests, approved accounting contract, Logo behavior evidence, and provider-total reconciliation verification.

### FIN-BUG-009 — Historical DRAFT payout lines cannot satisfy current REVIEW lineage validation

- **Domain:** Payout transition and historical settlement lineage.
- **Classification:** CONFIRMED_BUG — CODE-BACKED PRODUCTION EXPOSURE; no production transition attempt was observed.
- **Status:** FIXED_NOT_VERIFIED — compatibility is deployed and production read-only lineage verification passed; controlled production transition/cancellation verification remains outstanding.
- **Finding:** At the audited pre-implementation baseline, payout transition revalidation rejected any `PayoutBatchLine` without `settlementApprovalLineId`. Audit F reported three production DRAFT payouts whose 11 lines all have that direct link NULL.
- **Audited pre-implementation behavior:** DRAFT → REVIEW invoked revalidation and returned the `settlement_approval_line_missing` blocker for those historical lines. Mark Paid required REVIEW, invoked the same revalidation, and its paid-event builder also required the direct settlement-line ID. An existing focused test expected REVIEW rejection when approved settlement backing was missing. No production REVIEW or Mark Paid attempt was executed, so an actual production HTTP/database failure is **not** claimed.
- **Implementation safety regression (isolated PostgreSQL, before the cancellation fix):** A strict runtime resolver let a uniquely linked historical NULL-line payout reach REVIEW and PAID without backfilling its direct field. `cancelSettlementApproval` then cancelled the backing approval because its PAID guard joined only through that still-NULL direct field. The regression expected rejection but observed cancellation success. This is not a production transition/cancellation observation; paid-linked settlement protection is part of this same lineage-compatibility repair, not the separate payout-grouping question in FIN-DESIGN-004.
- **Local implementation evidence:** Modern non-NULL settlement-line IDs remain authoritative. A historical NULL ordinary payout line resolves only from one total local ledger-derived settlement-line candidate, with missing/ambiguous or inconsistent lineage rejected and no historical backfill. REVIEW and Mark Paid reuse the effective line for validation and paid-event identity. Settlement cancellation now locks potential historical payout batches, applies the same unique-lineage/scope/type/frozen-amount checks to PAID/`paidAt` lines, and rejects cancellation of their backing approval. The isolated FIN-BUG-009 PostgreSQL suite passes 21 tests, including the formerly failing PAID cancellation case and both cancellation/Mark Paid race orderings; existing Financial Correction PostgreSQL suites pass 113 tests.
- **Production deployment and read-only verification (reported):** Production was confirmed running implementation commit `e225956e8fff3a94673632e83ae26ea59e70410a`. A PostgreSQL `BEGIN READ ONLY` / `ROLLBACK` inspection found three DRAFT payouts and 11 relevant lines: all 11 retain NULL `settlementApprovalLineId`, all have `financeLedgerEntryId` and an existing ledger row, and all 11 resolve to exactly one ledger-derived settlement line (zero missing, zero ambiguous; maximum candidate count one). All 11 backing settlements are APPROVED. Two payouts derive from one settlement each and one pools two. No historical link was backfilled and no production mutation was performed. This verifies structural lineage prerequisites, not every remaining REVIEW or Mark Paid blocker.
- **Controlled production write verification:** No production payout was transitioned to REVIEW or PAID, and no settlement cancellation was attempted. The three DRAFT payouts cannot be treated as test-only data: for their nine backing Shopify orders, no matching WebhookEvent or retained raw payload/test flag was found; test-only provenance for all nine remains UNKNOWN. A controlled REVIEW → PAID → cancellation test was intentionally not performed. Actual production transition behavior remains unobserved.
- **Audited production impact:** The three existing DRAFT payouts had a code-backed incompatibility with the pre-implementation REVIEW transition requirement. The deployed compatibility's lineage assumptions match the current 11-line production shape, but whether each payout passes every other transition check remains UNKNOWN without a separately authorized controlled action.
- **Automation impact:** BLOCKER for progression of these historical payouts and any automated payment-ready workflow that assumes all DRAFTs can enter REVIEW.
- **Evidence / relevant code locations:** `backend/src/modules/finance/finance.service.ts` (`validatePayoutBatchBeforeTransitionWithClient`, `markPayoutBatchReview`, `markPayoutBatchPaid`, `buildPayoutPaidEvents`); `backend/src/modules/finance/settlement-approval.service.ts` (`cancelSettlementApproval`); `src/payout-batch-preparation.test.ts`, `src/settlement-approval.test.ts`, and `src/fin-bug-009-legacy-payout.postgres.test.ts`; Audit F production-state evidence in this register. FIN-DESIGN-004 separately covers pooling and migration compatibility, not this current transition consequence.
- **Production incidence:** CODE-BACKED PRODUCTION EXPOSURE for 3 DRAFT payouts / 11 lines; actual transition failure unobserved.
- **Product decision required?** An auditable compatibility/remediation procedure must be approved before production mutation; no new finance amount or payment rule is selected here.
- **External clarification required?** No provider behavior is needed to establish the local lineage mismatch. External EFT state remains UNKNOWN and must not be inferred.
- **Minimum future repair boundary:** Preserve payout amounts, approved settlement and ledger authority, and audit history. Do not guess or silently backfill settlement lineage or mutate the three production DRAFT payouts. Any compatibility/remediation path must use the already proven deterministic ledger-derived lineage or another explicitly approved mechanism, with an auditable procedure before touching production.
- **Validation required before CLOSED:** Approved remediation/compatibility design; isolated historical fixture with NULL `settlementApprovalLineId`; proof that ledger-derived lineage remains unique and unambiguous; REVIEW transition regression; Mark Paid transition compatibility test where applicable; isolated PostgreSQL proof that a uniquely linked historical PAID payout blocks backing-settlement cancellation while modern direct-linked PAID protection and unrelated cancellation behavior remain unchanged; relevant cancellation-versus-PAID concurrency proof; production read-only verification before mutation; and controlled production verification after any separately authorized remediation.

## Potential defect requiring proof

### FIN-RISK-001 — Multiple-return hold may be released by unrelated refund evidence

- **Domain:** Return hold and settlement eligibility.
- **Classification:** LIKELY_BUG_NEEDS_RUNTIME_PROOF.
- **Status:** NEEDS_RUNTIME_PROOF.
- **Finding:** Approved-return hold logic appears to treat any refund evidence on an allocation as sufficient to suppress the hold.
- **Exact current behavior:** Code suggests that with one refunded return and another approved-but-unrefunded return on the same allocation, the latter might not hold the SALE. Whether this state is reachable is unproven.
- **Current impact:** Potential premature settlement; not confirmed.
- **Automation impact:** Potential eligibility blocker pending proof; do not turn it into a confirmed bug without evidence.
- **Audit F production evidence:** One allocation has at least two returns and a refund; zero combine multiple returns, an approved return, and a refund in the candidate configuration. One allocation has an approved return and a refund. The hypothesized hold failure remains unproven. Open-looking return/settlement overlap is reported separately below and is not automatically classified as a blocker.
- **Evidence / relevant code locations:** `backend/src/modules/finance/settlement-approval.service.ts` (return/hold candidate logic); return/refund models in `backend/prisma/schema.prisma`.
- **Production incidence:** UNKNOWN.
- **Product decision required?** UNKNOWN until the multi-return state and existing rule are proven.
- **External clarification required?** UNKNOWN; use local/schema evidence first.
- **Minimum future repair boundary:** Establish a valid multi-return fixture and test hold behavior before choosing any code change.
- **Validation required before CLOSED:** Runtime or production-safe schema/fixture proof of reachability, focused hold test, then implementation/integration validation if defect confirmed.

### FIN-RISK-002 — Non-2xx Logo create response is retryable FAILED without proven non-creation

- **Domain:** Logo external execution and recovery.
- **Classification:** NEEDS_EXTERNAL_PROOF / DESIGN RISK.
- **Status:** BLOCKED_BY_EXTERNAL_INFO.
- **Finding:** Thrown network/timeout ambiguity maps to `UNKNOWN`, but every explicit non-2xx provider response is persisted as `FAILED` and may be retried. Repository evidence does not prove that every non-2xx means Logo did not create an invoice.
- **Exact current behavior:** A `FAILED` record can be retried; whether a prior non-2xx response followed an external creation is UNKNOWN.
- **Current impact:** A retry may theoretically duplicate an externally created invoice; no production duplicate is established.
- **Automation impact:** BLOCKER for automatic `FAILED` retry.
- **Audit F production evidence — NO_CURRENT_INSTANCE_FOUND:** The five production Logo invoice records are CREATED; no FAILED record was found. Provider non-2xx/non-creation semantics remain unproven.
- **Audit E evidence:** Crash-after-send and non-2xx outcomes require different treatment from a proven pre-send failure; the current finance job has no general retry classification that can establish safe provider resend.
- **Evidence / relevant code locations:** `backend/src/modules/finance/settlement-logo-commission-invoice-create.service.ts` (non-2xx, timeout, and retry handling).
- **Production incidence:** UNKNOWN.
- **Product decision required?** No retry policy should be selected before provider semantics are established.
- **External clarification required?** Yes: Logo error taxonomy and timeout/create semantics.
- **Minimum future repair boundary:** Classify provider outcomes using proven non-creation or reconcile ambiguous results before retry.
- **Validation required before CLOSED:** Provider contract evidence, focused response-classification tests, and safe retry/reconciliation integration verification.

### FIN-RISK-003 — Logo request snapshot creation versus settlement cancellation serialization is unproven

- **Domain:** Settlement and invoice reservation concurrency.
- **Classification:** NEEDS_RUNTIME_PROOF.
- **Status:** NEEDS_RUNTIME_PROOF.
- **Finding:** Logo request snapshot build/insert and settlement cancellation are not proven to share an atomic serialization boundary. A newly created `PENDING` record immediately becomes a settlement cancellation blocker.
- **Exact current behavior:** A concurrent cancellation/request-snapshot race is possible from the separate checks, but its durable outcome has not been reproduced against PostgreSQL; this is not classified as a confirmed bug.
- **Current impact:** Potential inconsistency in settlement cancellation versus invoice reservation; production incidence is unproven.
- **Automation impact:** Proof requirement for unattended snapshot creation, not a confirmed blocker until reproduced; automation design must account for it.
- **Audit E evidence:** A PENDING snapshot is a durable local intent and active-invoice uniqueness prevents another active record, but that constraint alone does not prove snapshot insertion and settlement cancellation serialize correctly.
- **Evidence / relevant code locations:** `backend/src/modules/finance/settlement-logo-request-snapshot-builder.service.ts`; `backend/src/modules/finance/settlement-commission-invoice-record.service.ts` (record insertion); `backend/src/modules/finance/settlement-approval.service.ts` (cancellation invoice check).
- **Production incidence:** UNKNOWN.
- **Product decision required?** Reservation/cancellation policy remains unresolved if the race is confirmed.
- **External clarification required?** No; establish local DB behavior first.
- **Minimum future repair boundary:** Reproduce the race in a real PostgreSQL fixture before selecting serialization changes.
- **Validation required before CLOSED:** Real PostgreSQL concurrent snapshot/cancellation test and, if a defect is confirmed, focused regression after approved repair.

### FIN-RISK-004 — Payout `paidAt` may not represent actual EFT execution time

- **Domain:** Payment time and PAID evidence.
- **Classification:** NEEDS_RUNTIME_PROOF / POLICY_GAP.
- **Status:** NEEDS_RUNTIME_PROOF.
- **Finding:** Payment Preparation sends browser click-time as `paidAt`; Admin cannot enter the actual EFT execution time in that UI. Backend accepts any syntactically parseable date, with no established future-date or historical-distance bound.
- **Audit E evidence:** No local retry or orchestration state can reconstruct an external EFT sent while the application was unavailable. Bank/operator evidence remains necessary; PAID remains an explicit Admin action.
- **Exact current behavior:** The supplied timestamp becomes `PayoutBatch.paidAt` and ledger `settledAt`. Whether it matches the external transfer event is not verified by the application.
- **Current impact:** Historical local payment time may differ from actual bank time; production incidence is UNKNOWN. The field is not labeled wrong until its intended semantics are approved.
- **Automation impact:** `paidAt` cannot be treated as authoritative external-bank execution time without a contract and evidence.
- **Audit F production evidence — NO_CURRENT_INSTANCE_FOUND:** All three production payouts are DRAFT; none is PAID, so no local `paidAt`/payment-reference population can resolve this bank-time question.
- **Evidence / relevant code locations:** `src/features/finance/paymentPreparationApi.ts` (`markPayoutBatchPaid`); `src/pages/AdminPaymentPreparationPage.tsx` (no time input); `backend/src/modules/finance/finance.service.ts` (`parseMarkPayoutBatchPaidInput`, `markPayoutBatchPaid`).
- **Production incidence:** UNKNOWN.
- **Product decision required?** Yes: whether `paidAt` means Admin confirmation, EFT initiation, EFT completion, or another event.
- **External clarification required?** Yes: bank/operator time evidence and reconciliation practice.
- **Minimum future repair boundary:** Establish the intended time authority and validation/presentation before altering persistence or historical records.
- **Validation required before CLOSED:** Approved time contract, focused API/UI/real-DB tests, and operational evidence where applicable.

## Design gaps and current-architecture facts

These entries identify missing or unresolved contracts. They are **not** authorization to implement a new rule.

### FIN-DESIGN-001 — Biweekly means global even ISO week, not vendor 14-day cadence

- **Domain:** Settlement cadence.
- **Classification:** BUSINESS_RULE_MISMATCH / DESIGN_GAP.
- **Status:** OPEN.
- **Finding:** `BIWEEKLY` means configured UTC weekday in an even ISO week; no vendor-specific anchor exists.
- **Audit F production evidence — NO_CURRENT_INSTANCE_FOUND:** Both current finance profiles are WEEKLY/WEDNESDAY; no BIWEEKLY vendor is present. The future cadence contract remains unresolved.
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
- **Audit F production evidence — CONFIRMED_PRODUCTION_EXPOSURE:** Both scheduled DRAFT settlements have `periodStart = NULL`, span at least 14 days of included ledger `createdAt`, and cross calendar-week boundaries. This is actual cumulative source coverage, not a closed weekly period.
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
- **Audit F production evidence — CONFIRMED_PRODUCTION_EXPOSURE:** Of three DRAFT payouts, ledger-derived lineage maps two to one settlement each and one to two settlements. All 11 historical payout lines retain `financeLedgerEntryId` but have `settlementApprovalLineId = NULL`; each maps to exactly one settlement line/settlement through retained ledger evidence, with no ambiguity or orphan ledger link. Any future direct non-null settlement-line authority needs explicit backward compatibility or safe migration for these 11 rows.
- **Audit G cross-reference:** FIN-BUG-009 records the distinct current REVIEW transition consequence of those NULL direct links; this entry remains about payout grouping and historical compatibility.
- **Exact current behavior:** It can pool eligible APPROVED sources across multiple manual/scheduled settlements, cycles, correction-source settlements, and dates.
- **Current impact:** A payout is not cycle-bound even when UI language might suggest a payment period. Audit C established that pooled settlements can have different Logo invoice states—`CREATED`, `FAILED`, `UNKNOWN`, or no record. Audit D confirmed that the payment screen shows aggregate amounts and a source count, not complete per-settlement lineage or Logo evidence. This does not establish an invoice gate.
- **Automation impact:** Grouping must be chosen before payment-ready automation.
- **Evidence / relevant code locations:** `backend/src/modules/finance/finance.service.ts` (`preparePayoutBatch` source selection and payout transitions); `src/features/finance/paymentPreparationApi.ts`; `src/pages/AdminPaymentPreparationPage.tsx` (no pooled Logo invoice readiness view); `backend/prisma/schema.prisma` (`SettlementCommissionInvoice`).
- **Production incidence:** UNKNOWN.
- **Product decision required?** Yes: vendor-wide versus cycle-bound, including multi-cycle pooling.
- **External clarification required?** No.
- **Minimum future repair boundary:** Approve grouping contract before altering source selection or period UI.
- **Validation required before CLOSED:** Approved contract and multi-settlement/mixed-cycle real-DB payout plus payment-dossier UI verification.

### FIN-DESIGN-005 — Missed/failed settlement-run recovery is undefined

- **Domain:** Scheduled job recovery.
- **Classification:** DESIGN_GAP.
- **Status:** OPEN.
- **Finding:** Job-run identity is unique by run date; failed/processing dates are not simply rerun.
- **Audit F production evidence — NO_CURRENT_INSTANCE_FOUND:** `SettlementScheduleJobRun` has zero rows. No persisted production PROCESSING, FAILED, or duplicate-run instance was found; the static recovery gap remains OPEN.
- **Exact current behavior:** A later due run can cumulatively collect older unclaimed sources, but this is not an explicit retry/catch-up contract.
- **Audit E evidence:** `SettlementScheduleJobRun.runDate` is unique by UTC date. PROCESSING and FAILED runs cannot resume through the same job command: any duplicate date is returned as already processed regardless of persisted status. The finance job has no lease, heartbeat, stale timeout, takeover, per-vendor checkpoint, or same-date resume. A crash before the final run update can leave committed vendor DRAFTs with a PROCESSING run and no durable per-vendor result. Later cumulative selection is not a defined recovery contract; see FIN-UI-015 and FIN-TEST-015.
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
- **Audit F production evidence — NO_CURRENT_INSTANCE_FOUND:** `VendorBalanceEvent` has zero rows, so no production debt-after-DRAFT timing case was found. The cutoff decision remains unresolved.
- **Exact current behavior:** Vendor debt offset is calculated and frozen at payout preparation. New debt after DRAFT does not recalculate that batch. REVIEW and Mark Paid revalidate its attached sources but do not perform a fresh vendor-wide debt calculation.
- **Current impact:** The batch can progress with its original offset although the vendor's current outstanding debt differs. Whether that makes the batch stale, or requires cancellation/rebuild, remains an unresolved product decision.
- **Automation impact:** BLOCKER for payment-ready semantics.
- **Audit E evidence:** Payout preparation uses a vendor row lock and Serializable transaction with active-source checks, protecting local selection. It has no deterministic preparation-request identity: a retry after a successful but unobserved commit cannot identify its prior batch from a logical run key, and newly approved sources or debt can change the selection.
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
- **Audit F production evidence — NO_CURRENT_INSTANCE_FOUND:** No Financial Correction authority, claim, credit, deduction, zero-net acknowledgement, or checked downstream correction row was found. This does not weaken the static scheduling-scope mismatch.
- **Exact current behavior:** Correction sources have no scheduled-cycle attribution, and scheduled date-range cannot truthfully include complete vendor economics by silently ignoring them.
- **Current impact:** Scheduled processing cannot include every authorized correction under current scope rules.
- **Automation impact:** BLOCKER.
- **Audit E evidence:** A pending deduction's vendor-wide requirement can raise during the scheduled date-range dry-run before a job-run row or per-vendor failure record is created; this is an exception-isolation problem as well as a scope mismatch (FIN-BUG-005).
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
- **Audit F production evidence — NO_CURRENT_INSTANCE_FOUND:** All three production payouts have positive net amounts; no zero-net payout was observed. This does not select a zero-payout policy.
- **Exact current behavior:** No approved contract establishes whether a zero batch should progress to REVIEW/PAID as accounting evidence or stop before payment workflow. Audit D confirmed that REVIEW and Mark Paid are status-driven, with no zero-net transition gate; this does not prove an external EFT exists for a zero batch.
- **Current impact:** A zero-value batch can be presented within a payment process without clear meaning.
- **Automation impact:** BLOCKER until disposition is approved.
- **Audit E evidence:** The orchestration layer provides no structured policy blocker or retry class that would safely distinguish a zero accounting batch from an external payment instruction. No disposition is selected here.
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
- **Audit F production evidence — NO_CURRENT_INSTANCE_FOUND:** All three production payouts have positive net amounts; no negative payout was observed. This does not select a negative-payout policy.
- **Exact current behavior:** Preparation can represent negative ordinary payout amounts, and REVIEW/Mark Paid have no general negative-net gate. Correction-deduction preparation has its own insufficient-payable check. The authorized downstream disposition of a negative ordinary batch remains unresolved; full real-DB progression has not been proven.
- **Current impact:** Admin/payment interpretation is ambiguous.
- **Automation impact:** BLOCKER.
- **Audit E evidence:** A future worker cannot infer automatic retry, REVIEW, or payment handling from a negative batch amount. No external negative-payment behavior is assumed.
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
- **Audit F production evidence — CONFIRMED_PRODUCTION_EXPOSURE:** Both vendors have billing profiles and Logo customer-code/customer-ID bindings with e-invoice eligibility, but current IBAN presence is 0/2. Three DRAFT payouts exist. This strengthens the destination-evidence gap; it does **not** establish an IBAN-mandatory rule or prove an EFT was attempted.
- **Exact current behavior:** Audit C confirmed IBAN is outside the frozen settlement billing snapshot used for Logo invoice requests. Audit D found IBAN to be optional, mutable `VendorBillingProfile` data. Payout preparation does not require or snapshot it; PAID payout history and events do not establish which payment destination was actually used. A later profile edit can differ from that historical destination. Payment Preparation does not show IBAN.
- **Current impact:** “Payment ready” cannot be inferred solely from payout creation, and historical payout records do not prove the EFT destination.
- **Automation impact:** Future payment-ready definition needs an approved identity/completeness rule.
- **Evidence / relevant code locations:** `backend/prisma/schema.prisma` (vendor billing/payment fields); `backend/src/modules/finance/settlement-billing-snapshot.service.ts` (snapshot omits IBAN); `backend/src/modules/finance/finance.service.ts` (`preparePayoutBatch`); `src/pages/VendorProfilePage.tsx` (billing profile).
- **Production incidence:** UNKNOWN.
- **Product decision required?** Yes for a future payment-ready gate.
- **External clarification required?** UNKNOWN if external bank requirements become in scope; none are asserted here.
- **Minimum future repair boundary:** Define readiness separately from payout DRAFT and identify authoritative payment identity.
- **Validation required before CLOSED:** Approved policy and backend/UI readiness tests; no real EFT test implied.

### FIN-DESIGN-012 — Logo UNKNOWN state lacks a reachable Admin resolution workflow

- **Domain:** Logo reconciliation and operations.
- **Classification:** DESIGN_GAP.
- **Status:** OPEN.
- **Finding:** `UNKNOWN` blocks create retry and settlement cancellation. Record-service helpers can resolve `UNKNOWN` as created or failed, but Audit C found no production Admin route/UI invoking them.
- **Audit F production evidence — NO_CURRENT_INSTANCE_FOUND:** No UNKNOWN or FAILED invoice record exists among the five production Logo rows. The missing resolution workflow remains OPEN.
- **Exact current behavior:** An `UNKNOWN` invoice record may remain operationally stranded; provider existence or non-existence is not inferred.
- **Current impact:** Admin cannot complete a proven resolution through the current invoice workspace.
- **Automation impact:** BLOCKER for automated Logo workflow and exception recovery.
- **Audit E evidence:** UNKNOWN blocks create retry and has no complete reachable operator-resolution workflow; autonomous recovery after an ambiguous provider send is therefore unavailable.
- **Evidence / relevant code locations:** `backend/src/modules/finance/settlement-commission-invoice-record.service.ts` (`resolveUnknownAsCreated`, `resolveUnknownAsFailed`); `backend/src/modules/finance/settlement-logo-commission-invoice-create.service.ts` (`UNKNOWN` retry block); `backend/src/modules/finance/finance.routes.ts` and `src/pages/AdminSettlementApprovalsPage.tsx` (no resolution action); `backend/src/modules/finance/settlement-approval.service.ts` (cancellation block).
- **Production incidence:** UNKNOWN.
- **Product decision required?** Operational disposition and evidence standard remain unresolved.
- **External clarification required?** Yes: provider lookup and issuance semantics are needed to define resolution evidence.
- **Minimum future repair boundary:** Explicit authorized reconciliation workflow with durable evidence and safe state transition.
- **Validation required before CLOSED:** Provider contract evidence; Admin authorization, state-transition, retry, and cancellation-path tests, including relevant integration verification.

### FIN-DESIGN-013 — Provider monetary and issuance evidence is informational rather than authoritative

- **Domain:** Logo reconciliation and payment readiness.
- **Classification:** DESIGN_GAP.
- **Status:** BLOCKED_BY_EXTERNAL_INFO.
- **Finding:** Provider invoice identity, total, currency, and document metadata may be synced, but current finance progression does not require provider monetary equality or a proven legally issued provider state. A near-equal provider total is a candidate signal, not a mandatory acceptance gate.
- **Audit F production evidence — CONFIRMED_PRODUCTION_EXPOSURE / BLOCKED_BY_EXTERNAL_INFO:** Five CREATED invoices, all older than 30 days and linked to APPROVED settlements, have provider invoice ID and UUID, but none has stored provider total/currency, ETTN, provider sync time, GIB/document status, or fetched document evidence; four have invoice number and reconciliation metadata/time. This does not invalidate the invoices or establish legal issuance criteria. One invoice-linked settlement participates in a DRAFT payout; none is linked to REVIEW/PAID.
- **Exact current behavior:** Payout DRAFT, REVIEW, and PAID remain independent of Logo invoice completion; REVIEW and Mark Paid do not gate on per-settlement Logo state. A pooled payout can therefore progress while member settlements have unresolved or mixed invoice states. That independence is not classified as a bug before an invoice-gating policy is approved.
- **Current impact:** Current data cannot by itself substantiate an invoice-backed `PAYMENT READY` claim.
- **Automation impact:** BLOCKER for claiming invoice-backed payment readiness.
- **Evidence / relevant code locations:** `backend/src/modules/finance/settlement-logo-outgoing-invoice-sync-preview.service.ts` (provider matching, metadata, near-total signal); `backend/src/modules/finance/finance.service.ts` (payout transitions); `src/pages/AdminPaymentPreparationPage.tsx`.
- **Production incidence:** UNKNOWN.
- **Product decision required?** Yes: whether/when invoice evidence gates payout progression.
- **External clarification required?** Yes: Logo issuance/status and monetary field contracts; accounting/tax confirmation is also required.
- **Minimum future repair boundary:** Define required provider evidence and approved monetary tolerance before implementing a payout gate or payment-ready claim.
- **Validation required before CLOSED:** Provider and accounting contracts, approved product gate, mismatch/issuance tests, and pooled-payout integration/UI verification.

### FIN-DESIGN-014 — Payout REVIEW has no durable reviewer identity or review timestamp

- **Domain:** Payout human review gate.
- **Classification:** DESIGN_GAP.
- **Status:** OPEN.
- **Finding:** DRAFT → REVIEW performs local revalidation and a status change, but `PayoutBatch` does not persist `reviewedBy` or `reviewedAt`; no dedicated durable REVIEW event was established.
- **Audit F production evidence — NO_CURRENT_INSTANCE_FOUND:** No production payout is in REVIEW or PAID; all three are DRAFT and older than 30 days. Reviewer evidence remains an OPEN design gap, not a currently observed REVIEW-row incident.
- **Exact current behavior:** The creating and paying Admin can be persisted, but the reviewing Admin and exact review time are not. `updatedAt` is mutable and is not an authoritative review event.
- **Current impact:** The system cannot later prove who performed the human review gate or exactly when.
- **Automation impact:** BLOCKER if REVIEW remains a meaningful future human control boundary.
- **Audit E evidence:** REVIEW is currently an Admin-triggered operational boundary. Calling the same transition from a worker would materially alter its meaning while still leaving no durable reviewer/time evidence; no automatic REVIEW rule is approved.
- **Evidence / relevant code locations:** `backend/src/modules/finance/finance.service.ts` (`markPayoutBatchReview`); `backend/prisma/schema.prisma` (`PayoutBatch`); `backend/src/modules/finance/finance.routes.ts` (Admin route).
- **Production incidence:** UNKNOWN.
- **Product decision required?** Yes: REVIEW's intended future semantic role remains unresolved.
- **External clarification required?** No for local reviewer evidence; external EFT state remains a separate question.
- **Minimum future repair boundary:** After REVIEW semantics are approved, give any retained human review boundary durable actor/time evidence.
- **Validation required before CLOSED:** Approved REVIEW contract, focused actor/time and transition tests, relevant real-DB validation, and UI/audit verification.

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
- **Exact current behavior:** The period key comes from the payout batch creation month, not its source dates. The batch may pool multiple settlement/cycle periods, while the screen shows a source count rather than complete per-settlement lineage. Audit C also found no payout-wide presentation of Logo readiness.
- **Current impact:** Admin may misunderstand which sales/cycles are included and cannot infer invoice readiness for every included settlement from Payment Preparation.
- **Automation impact:** Payment-ready explanations lack reliable period identity.
- **Evidence / relevant code locations:** `src/pages/AdminPaymentPreparationPage.tsx` (`getPaymentPeriodKey`, “Payment Period”, no pooled Logo invoice view); `backend/src/modules/finance/finance.service.ts` (`preparePayoutBatch`); `backend/prisma/schema.prisma` (`SettlementCommissionInvoice`).
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
- **Exact current behavior:** Wording can overstate refund origin. The payment screen also presents batch-frozen debt offset/remaining-debt values without clearly distinguishing them from the current vendor balance after later debt arrives.
- **Current impact:** Admin may misdiagnose payment reduction or read a frozen batch offset as the vendor's current balance.
- **Automation impact:** Exception reason needs provenance before unattended routing.
- **Evidence / relevant code locations:** `src/pages/AdminPaymentPreparationPage.tsx` and `src/pages/AdminScheduledSettlementsPage.tsx` (copy); `backend/src/modules/finance/finance.service.ts` (debt offset); VendorBalance source records.
- **Production incidence:** UNKNOWN.
- **Product decision required?** No new monetary rule.
- **External clarification required?** No.
- **Minimum future repair boundary:** Use source-accurate debt/adjustment terminology and distinguish batch-frozen amounts from any separately proven current balance.
- **Validation required before CLOSED:** UI tests for refund-origin and correction-origin debt, including new debt after a DRAFT.

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
- **Status:** FIXED_NOT_VERIFIED.
- **Finding:** Before the fix, policy activity could be displayed, but the Admin used an active-only GET while the edit payload had no explicit `active` field.
- **Pre-fix behavior:** This contributed to FIN-BUG-006 reactivation risk.
- **Current impact:** Admin cannot reliably preserve or intentionally edit inactive state in this flow.
- **Automation impact:** CRITICAL when `active` controls scheduling.
- **Evidence / relevant code locations:** `backend/src/modules/finance/finance.service.ts` (`getVendorFinancialProfile`, upsert); `src/pages/VendorProfilePage.tsx` (form/payload).
- **Production incidence:** UNKNOWN.
- **Product decision required?** No new activity rule identified.
- **External clarification required?** No.
- **Minimum future repair boundary:** Resolve FIN-BUG-006 and represent activity honestly in GET/edit flow.
- **Validation required before CLOSED:** Inactive-profile API/UI/real-DB regression.
- **Implementation evidence:** Admin profile reads now use the existing Admin GET and display the persisted inactive policy; ordinary form submissions still omit `active` and the server preserves it. Focused UI/route tests and the isolated PostgreSQL regression passed. Vendor-facing read behavior is unchanged. Production runtime verification remains pending.

### FIN-UI-010 — Current profile delay may not be candidate source delay

- **Domain:** Scheduled settlement UI.
- **Classification:** MISSING_UI_EVIDENCE.
- **Status:** OPEN.
- **Finding:** Scheduled UI displays current vendor delay while historical SALE rows can retain individual delay snapshots.
- **Audit F production evidence — CONFIRMED_PRODUCTION_EXPOSURE:** Both current profiles have delay zero. Among 155 SALE ledgers, frozen delay is zero on 59, 18 on 8, and 21 on 88; 96/155 differ from the current profile. Historical SALE delay authority must not be reinterpreted from mutable current settings.
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

### FIN-UI-012 — Logo CREATED/Completed presentation can overstate proven invoice completion

- **Domain:** Admin settlement and Logo UI.
- **Classification:** MISSING_UI_EVIDENCE / MISLEADING_UI.
- **Status:** OPEN.
- **Finding:** A 2xx JSON create response can produce local `CREATED` without an extracted provider identifier, and subsequent provider-list reconciliation can still fail. The UI can show successful/green Logo creation messaging. Readiness preview can also mark “Logo Ready” as completed before provider issuance is established.
- **Audit F production evidence — CONFIRMED_PRODUCTION_EXPOSURE:** All five production Logo rows are locally CREATED with provider invoice ID and UUID, while stored provider monetary, status, and document evidence is incomplete as detailed in FIN-DESIGN-013. Missing fields alone do not establish invalidity or legal issuance status.
- **Exact current behavior:** Local readiness, accepted create response, identified provider invoice, reconciled invoice, and legally issued invoice are not presented as proven equivalent states; legal issuance evidence remains UNKNOWN.
- **Current impact:** Admin may interpret local success/readiness as stronger invoice evidence than currently established.
- **Automation impact:** Payment-ready UI cannot use these labels as issuance authority.
- **Evidence / relevant code locations:** `backend/src/modules/finance/settlement-logo-commission-invoice-create.service.ts` (2xx to `CREATED`, post-create reconciliation); `src/pages/AdminSettlementApprovalsPage.tsx` (success/green messaging and “Logo Ready” workflow status).
- **Production incidence:** UNKNOWN.
- **Product decision required?** Yes for the future invoice-completion threshold; accurate stage wording alone adds no monetary rule.
- **External clarification required?** Yes: Logo create response and legal issuance semantics.
- **Minimum future repair boundary:** Once the provider contract is known, distinguish readiness, request persisted, create response accepted, provider invoice identified, reconciled/matched, and legally issued where such evidence exists. No new DB state is specified here.
- **Validation required before CLOSED:** Provider contract evidence and focused UI/API tests for missing IDs, failed reconciliation, and each approved completion label.

### FIN-UI-013 — Payment timeline presents non-authoritative event history

- **Domain:** Payment Preparation and payout timeline.
- **Classification:** MISLEADING_UI.
- **Status:** OPEN.
- **Finding:** The timeline uses mutable `updatedAt` as “Review started” and can show an “Approved” milestone for PAID even though the normal payout lifecycle has no payout APPROVED transition.
- **Exact current behavior:** A later status update can change the displayed review time; the “Approved” date is also derived from `updatedAt`, not a persisted payout approval event.
- **Current impact:** Admin may interpret derived timestamps and unsupported milestones as durable payment history.
- **Automation impact:** Blocks reliable operator/audit presentation for a future payment-ready flow.
- **Evidence / relevant code locations:** `src/pages/AdminPaymentPreparationPage.tsx` (timeline); `backend/src/modules/finance/finance.service.ts` (`markPayoutBatchReview`, `markPayoutBatchPaid`); `backend/prisma/schema.prisma` (`PayoutBatch`).
- **Production incidence:** UNKNOWN.
- **Product decision required?** REVIEW's future meaning remains open; accurate labeling of current evidence requires no new money rule.
- **External clarification required?** No.
- **Minimum future repair boundary:** Render only persisted/authoritative payout events or explicitly label derived presentation values; replacement design is not chosen here.
- **Validation required before CLOSED:** Focused timeline tests for DRAFT, REVIEW, and PAID against durable event/time authority.

### FIN-UI-014 — Payment Preparation lacks a complete pooled-payout payment dossier

- **Domain:** Payment Preparation and Admin payment review.
- **Classification:** MISSING_UI_EVIDENCE.
- **Status:** OPEN.
- **Finding:** For a vendor-wide pooled payout, Payment Preparation shows aggregate amount and source count but does not consolidate all relevant settlement IDs, scheduled/manual origin, cycle identity, source-date coverage, per-settlement Logo state and identity, current versus batch-frozen debt, payment destination/IBAN, and blocker evidence.
- **Audit F production evidence — CONFIRMED_PRODUCTION_EXPOSURE:** One current DRAFT payout derives from two settlements. Its historical lines lack direct settlement-line IDs but have unambiguous ledger-derived lineage, which a future dossier or migration must account for without silently changing payout history.
- **Exact current behavior:** Some information exists elsewhere or in backend line references, but this payment surface does not present one complete payment dossier.
- **Current impact:** Admin cannot substantiate a future “READY FOR PAYMENT” claim from this screen alone.
- **Automation impact:** BLOCKER for a marketplace-style payment-ready queue.
- **Evidence / relevant code locations:** `src/pages/AdminPaymentPreparationPage.tsx` (Payment Impact and Related Records); `backend/src/modules/finance/finance.service.ts` (`mapPayoutBatch`, `preparePayoutBatch`); `backend/prisma/schema.prisma` (`PayoutBatchLine`, `VendorBillingProfile`).
- **Production incidence:** UNKNOWN.
- **Product decision required?** Yes for the eventual payment-ready evidence threshold and grouping; no final UI is prescribed.
- **External clarification required?** Yes where Logo issuance or bank destination evidence is required by the eventual policy.
- **Minimum future repair boundary:** Define the approved payment-ready evidence contract, then expose its provenance coherently without changing historical finance authority.
- **Validation required before CLOSED:** Approved contract and pooled-payout backend/UI/browser evidence across mixed settlement and invoice states.

### FIN-UI-015 — Duplicate finance job request can misrepresent FAILED/PROCESSING as already processed

- **Domain:** Settlement schedule job and Admin API.
- **Classification:** BACKEND_UI_MISMATCH.
- **Status:** OPEN.
- **Finding:** `SettlementScheduleJobRun.runDate` is unique. A duplicate-date request can return `ok: true` and vendor state `ALREADY_PROCESSED` without distinguishing an existing COMPLETED, FAILED, or PROCESSING run.
- **Audit F production evidence — NO_CURRENT_INSTANCE_FOUND:** No schedule-job run row exists, so no production FAILED/PROCESSING collision was available to inspect. The code/API mismatch remains OPEN.
- **Exact current behavior:** The collision path reads the existing run status but builds vendor results from a fresh dry-run, marking them `ALREADY_PROCESSED` rather than returning authoritative persisted vendor outcomes.
- **Current impact:** An operator or client may interpret unfinished, failed, or stale work as completed.
- **Automation impact:** BLOCKER for truthful unattended recovery and operator status.
- **Evidence / relevant code locations:** `backend/src/modules/finance/settlement-schedule-job.service.ts` (`runSettlementScheduleAutoDraftJob`, `buildVendorResults`); `backend/prisma/schema.prisma` (`SettlementScheduleJobRun.runDate @unique`).
- **Production incidence:** UNKNOWN. **Predates proposed automation?** Yes.
- **Product decision required?** Yes for failed/stale-run recovery semantics; accurate status reporting does not select them.
- **External clarification required?** No.
- **Minimum future repair boundary:** Report authoritative persisted run status and vendor outcome instead of collapsing every run-date collision into successful already-processed behavior. Do not choose retry or takeover semantics here.
- **Validation required before CLOSED:** Real PostgreSQL duplicate-run tests for COMPLETED, FAILED, and PROCESSING; approved stale-run recovery behavior; API/UI status verification.

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
- **Domain:** Preview diagnostic tests. **Classification:** TEST_COVERAGE_GAP. **Status:** FIXED_NOT_VERIFIED — focused regression exists and passed locally; deployed parent-defect verification remains outstanding.
- **Finding / exact current behavior:** `src/settlement-approval.test.ts` now pairs a blocking allocation alert with final preview lines and selected-order diagnostics, including unaffected and same-order sibling rows; a DRAFT regression checks unchanged membership and money.
- **Current impact:** This local test gap is covered; FIN-BUG-004 remains pending deployed runtime verification. **Automation impact:** No automation is authorized by this test.
- **Evidence / relevant code locations:** `backend/src/modules/finance/settlement-approval.service.ts` (diagnostic/filter); `src/settlement-approval.test.ts` (focused regression).
- **Reported deployment/runtime evidence:** Implementation commit `9d8d778053c00a35af1e7251d0b65566e434e13d` was directly verified as deployed. The supplied read-only production inspection found one resolved integrity alert and zero active/unresolved cases, so FIN-TEST-005 remains local regression proof; no live FIN-BUG-004 alert-filtering case was exercised or synthesized.
- **Production incidence:** UNKNOWN. **Product decision required?** No. **External clarification required?** No.
- **Minimum future repair boundary:** Completed in focused local tests without a monetary-predicate change.
- **Validation required before CLOSED:** Focused diagnostic/final-line and DRAFT membership tests passed; parent case-specific runtime verification remains outstanding until a safe naturally occurring alert case can be observed read-only.

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
- **Audit E evidence:** Manual and scheduled DRAFT creation share a vendor row lock and Serializable creation transaction, but the preview-to-write interval and cycle result after manual consumption remain unproven in a real DB race.

### FIN-TEST-009 — No real-DB multiple-cycle-to-pooled-payout test
- **Domain:** Payout grouping tests. **Classification:** TEST_COVERAGE_GAP. **Status:** OPEN.
- **Finding / exact current behavior:** No proven real-DB test builds multiple scheduled/manual approvals then one pooled payout with a complete payment-review dossier or source-period lineage.
- **Audit F production evidence:** One production DRAFT payout pools two settlements, confirming actual pooling but not replacing the missing controlled real-DB regression or UI dossier test.
- **Current impact:** Current vendor-wide grouping lacks integrated proof. **Automation impact:** Payment-period claims remain unvalidated.
- **Evidence / relevant code locations:** `backend/src/modules/finance/finance.service.ts` (`preparePayoutBatch`); payout tests under `src/`.
- **Production incidence:** UNKNOWN. **Product decision required?** Yes, FIN-DESIGN-004. **External clarification required?** No.
- **Minimum future repair boundary:** Add integrated fixture without choosing future grouping semantics by assumption.
- **Validation required before CLOSED:** Real-DB pooled mixed-cycle sources and UI payment-dossier/source-reference verification under approved contract.
- **Audit E evidence:** Vendor-locked payout preparation protects local candidate selection but has no logical payment-run idempotency key; the proposed fixture should distinguish economic source non-duplication from replaying the same preparation request.

### FIN-TEST-010 — No real-DB debt-after-DRAFT progression proof
- **Domain:** Debt/payout timing tests. **Classification:** TEST_COVERAGE_GAP. **Status:** OPEN.
- **Finding / exact current behavior:** No complete real-DB proof for new debt arriving between payout DRAFT and REVIEW/PAID, while the batch's frozen offset remains unchanged and transition revalidation checks attached sources rather than fresh vendor-wide debt.
- **Current impact:** Staleness/revalidation behavior is not fully established at transition boundary. **Automation impact:** Payment-ready blocker.
- **Evidence / relevant code locations:** `backend/src/modules/finance/finance.service.ts` (debt offset, payout transitions); vendor-balance tests.
- **Production incidence:** UNKNOWN. **Product decision required?** Yes, FIN-DESIGN-007. **External clarification required?** External EFT state UNKNOWN.
- **Minimum future repair boundary:** Test transition with intervening debt under approved cutoff policy.
- **Validation required before CLOSED:** Real-DB DRAFT→REVIEW→PAID behavior and stale-money disposition.

### FIN-TEST-011 — No complete real-DB zero/negative payout progression contract test
- **Domain:** Payout amount disposition tests. **Classification:** TEST_COVERAGE_GAP. **Status:** OPEN.
- **Finding / exact current behavior:** Mocked amount cases do not prove a full PostgreSQL DRAFT → REVIEW → PAID lifecycle for zero and negative batches under approved disposition rules.
- **Current impact:** Status-based actions and operator meaning remain uncertain. **Automation impact:** Blocks unattended progression.
- **Evidence / relevant code locations:** `backend/src/modules/finance/finance.service.ts` (prepare and transitions); payout tests; `src/pages/AdminSettlementApprovalsPage.tsx` (zero copy).
- **Production incidence:** UNKNOWN. **Product decision required?** Yes, FIN-DESIGN-009/010. **External clarification required?** External EFT behavior UNKNOWN.
- **Minimum future repair boundary:** Decide zero/negative disposition before writing transition expectations.
- **Validation required before CLOSED:** Approved rule and full real-DB transition/UI proof.

### FIN-TEST-012 — No real-DB Logo concurrent-create or crash-boundary coverage

- **Domain:** Logo create execution tests.
- **Classification:** TEST_COVERAGE_GAP.
- **Status:** OPEN.
- **Finding:** Current Logo tests are principally mocked/service-level. No dedicated real PostgreSQL proof was found for two create attempts on one record, external-send/local-persistence crash boundaries, or local state after competing transitions.
- **Exact current behavior:** Test coverage does not establish exclusive provider-send ownership or crash-safe persistence.
- **Current impact:** FIN-BUG-007 and ambiguous create recovery lack DB-real regression proof.
- **Automation impact:** Blocks confidence in unattended create/retry.
- **Evidence / relevant code locations:** `src/settlement-logo-commission-invoice-create.test.ts`; `src/settlement-commission-invoice-record.test.ts`; `backend/src/modules/finance/settlement-logo-commission-invoice-create.service.ts`.
- **Production incidence:** UNKNOWN.
- **Product decision required?** No new business rule for the concurrency test; provider recovery policy remains separate.
- **External clarification required?** Yes for provider-safe retries, not for reproducing local concurrency.
- **Minimum future repair boundary:** Add real-DB concurrency and crash-boundary coverage after an approved execution repair.
- **Validation required before CLOSED:** Relevant real PostgreSQL concurrent-create and competing-transition tests plus provider-safe integration evidence.
- **Audit E evidence:** Include the send-before-local-persistence crash window and confirm whether the same PENDING/FAILED record remains executable; do not treat a mocked provider response as proof of provider idempotency.

### FIN-TEST-013 — No aggregate VAT, provider mismatch, or mixed-invoice pooled-payout coverage

- **Domain:** Logo monetary and payout-readiness tests.
- **Classification:** TEST_COVERAGE_GAP.
- **Status:** OPEN.
- **Finding:** No focused coverage proves intended equivalence between aggregate Logo-line VAT and frozen settlement economics, provider-total mismatch handling, or a real PostgreSQL pooled payout containing settlements with mixed Logo invoice states and a payment-screen dossier.
- **Exact current behavior:** Existing tests do not establish the future accounting or pooled-payment readiness contract.
- **Current impact:** Monetary and operator-facing mismatches may remain unobserved; no payout invoice gate is inferred.
- **Automation impact:** Blocks confidence in invoice-backed payment-ready automation.
- **Evidence / relevant code locations:** `src/settlement-logo-request-snapshot-builder.test.ts`; `src/settlement-logo-outgoing-invoice-sync-preview.test.ts`; `backend/src/modules/finance/settlement-logo-request-snapshot-builder.service.ts`; `backend/src/modules/finance/finance.service.ts`; `src/pages/AdminPaymentPreparationPage.tsx`.
- **Production incidence:** UNKNOWN.
- **Product decision required?** Yes: accounting arithmetic/tolerance and pooled-payout invoice policy.
- **External clarification required?** Yes: Logo VAT arithmetic and provider monetary/issuance semantics.
- **Minimum future repair boundary:** Add focused and integrated tests only after corresponding accounting/product contracts are approved.
- **Validation required before CLOSED:** Approved contracts, aggregate-rounding and provider-mismatch regressions, and mixed-state pooled-payout real-DB/UI proof.

### FIN-TEST-014 — No complete payment-evidence, reviewer, and destination workflow test

- **Domain:** General payout and Admin payment workflow.
- **Classification:** TEST_COVERAGE_GAP.
- **Status:** OPEN.
- **Finding:** No complete test proves DRAFT, human REVIEW actor/time, historical payment destination, payment reference, `paidAt` semantics, pooled settlement lineage, and explicit PAID across a real PostgreSQL-backed general payout flow and Admin browser workflow.
- **Exact current behavior:** Existing Financial Correction PostgreSQL/browser tests cover their correction paths, not this complete generic payment-evidence chain. Some desired evidence is not persisted yet; this entry does not make it a current business requirement.
- **Current impact:** A future payment-ready claim would lack integrated evidence and regression proof.
- **Automation impact:** BLOCKER for confidence in an approved payment-ready workflow.
- **Evidence / relevant code locations:** `src/payout-batch-preparation.test.ts`; Financial Correction PostgreSQL suites under `src/`; real browser specs under `tests/e2e/`; `backend/src/modules/finance/finance.service.ts`; `src/pages/AdminPaymentPreparationPage.tsx`.
- **Production incidence:** UNKNOWN.
- **Product decision required?** Yes for REVIEW, destination, reference, and time semantics before complete expected outcomes can be asserted.
- **External clarification required?** Yes for EFT evidence semantics; local test infrastructure does not itself establish bank truth.
- **Minimum future repair boundary:** After those contracts are approved, add targeted real-DB and Admin browser coverage without using mocked bank success as proof of EFT.
- **Validation required before CLOSED:** Approved contract, focused backend tests, real PostgreSQL generic payout flow, relevant browser verification, and operational evidence where applicable.

### FIN-TEST-015 — No real-DB finance job crash/replay/two-instance coverage

- **Domain:** Finance orchestration testing.
- **Classification:** TEST_COVERAGE_GAP.
- **Status:** OPEN.
- **Finding:** Current finance job tests use mocked persistence and do not establish real PostgreSQL behavior for stale PROCESSING, FAILED same-date replay, crash after PROCESSING insertion, partial vendor success A/failure B/success C, crash before final run update, simultaneous starts from two backend instances, authoritative collision status, or per-vendor recovery.
- **Exact current behavior:** Existing local finance-transition tests do not prove this job orchestration layer; no per-vendor checkpoint or same-date recovery is implemented.
- **Current impact:** Duplicate-start and partial-run behavior cannot be treated as DB-verified operational recovery.
- **Automation impact:** Required validation gap for unattended finance execution; this is not a new production bug classification.
- **Evidence / relevant code locations:** `src/settlement-schedule-job.test.ts` (mocked job persistence); `backend/src/modules/finance/settlement-schedule-job.service.ts`; `backend/prisma/schema.prisma` (`SettlementScheduleJobRun`).
- **Production incidence:** UNKNOWN.
- **Product decision required?** Yes for expected retry and recovery results before closure tests can assert them.
- **External clarification required?** No.
- **Minimum future repair boundary:** Isolated PostgreSQL orchestration and crash/replay tests after recovery semantics are approved, including relevant multi-instance/concurrency coverage.
- **Validation required before CLOSED:** Approved recovery contract plus passing isolated PostgreSQL tests for the listed states and truthful API results.

## External-information-only observations

- **Audit C — Logo postal-code fallback:** The production Logo payload builder uses a hardcoded `34000` postal-code fallback because `billingPostalCode` is not modeled. **Status: EXTERNAL INFORMATION REQUIRED.** This is not classified as a legal or accounting defect without Logo/provider and accountant confirmation that the fallback is unacceptable. Evidence: `backend/src/modules/logo-isbasi/logo-isbasi-commission-preview.ts` (`readTemporaryBillingPostalCode`). No change to invoice or billing behavior is approved here.
- **Audit D — bank/EFT evidence:** Repository state does not prove whether an external EFT was sent, completed, cancelled, rejected, returned, or duplicated. FIN-RISK-004 is an evidence/policy clarification, not a confirmed monetary bug. Repository-side design can continue while the bank/operator questions below are collected, but final EFT exception and reconciliation semantics require their answers.

## Audit E orchestration facts — no automation approval

- The finance auto-draft job is triggered through an authenticated Admin route. No finance startup scheduler registration was found. It creates settlement DRAFTs only; it does not approve settlements, create Logo invoices, prepare payouts, enter REVIEW, or mark PAID.
- Settlement DRAFT creation and payout preparation use PostgreSQL-backed vendor row locks and Serializable transactions. These local economic protections are useful foundations, not an end-to-end orchestrator.
- Current classification: **PARTIAL_JOB_STATE; NO_END_TO_END_STATE**. A date-keyed job row records aggregate results, but no durable cross-step execution state correlates settlement, approval, Logo, and payout. There is no per-vendor checkpoint or finance lease/heartbeat.
- The maximum evidence-supported unattended boundary is **READ-ONLY SCHEDULE SELECTION / DRY-RUN AS ADVISORY DIAGNOSTICS ONLY**. Even dry-run may fail to return a complete all-vendor result when one vendor preview throws. This is **not** permission to enable the existing write job or any later financial transition.
- No general finance retry taxonomy reliably chooses AUTO RETRY versus ADMIN RESOLUTION for every failure. Schedule job metadata primarily persists error strings rather than complete structured failure classes. Deterministic validation, DB serialization or uniqueness collisions, stale PROCESSING, Logo UNKNOWN/non-2xx, payout source conflicts, new debt, zero/negative payout, and EFT uncertainty require distinct treatment; no new retry policy is selected here.
- Roadmap-input capability categories: durable run and per-vendor execution identities, per-vendor checkpoints, exclusive claims, lease/ownership and stale takeover, structured failure classes, safe command replay, cross-step correlation, provider reconciliation, manual takeover, operator-visible exception queue, explicit kill-switch semantics, and retry-attempt evidence. **These are capability categories only; no schema or API design is approved.**
- Evidence: `backend/src/modules/finance/finance.routes.ts` (Admin trigger); `backend/src/modules/finance/settlement-schedule-job.service.ts` (run state/replay); `backend/src/modules/finance/settlement-schedule.service.ts` (dry-run/create); `backend/src/modules/finance/settlement-approval.service.ts` and `backend/src/modules/finance/finance.service.ts` (local transactions); `backend/src/app.ts` (startup registrations); `backend/prisma/schema.prisma` (`SettlementScheduleJobRun`).

## Audit F production-state and migration compatibility — observation only

The following are Audit F-reported aggregates from a production PostgreSQL inspection conducted with `BEGIN READ ONLY` / `ROLLBACK` and `transaction_read_only = on`. Core finance schema and the recent refund-terminal and Financial Correction migrations were present; 103 applied migrations were observed earlier in that audit. This update makes no independent production connection and approves no backfill, migration, automation, or business rule.

- **HEALTHY_STRUCTURAL_EVIDENCE:** Eleven SettlementApproval rows comprise eight APPROVED manual, one DRAFT manual, and two DRAFT scheduled. No APPROVED row lacked `approvedAt`; no CANCELLED row lacked `cancelledAt`; and no DRAFT row had either timestamp. `SettlementApprovalLine` has 63 rows with no missing ledger reference. Eleven PayoutBatchLine rows have no missing ledger reference or dangling non-null settlement-line reference. Five Logo invoice rows have no missing settlement; eight SettlementRefundAdjustment rows have no missing refund-ledger or referenced settlement.
- **CONFIRMED_PRODUCTION_EXPOSURE:** Both active financial profiles are WEEKLY/WEDNESDAY with current delay zero and `autoSettlementDraftEnabled=true`; both auto-approval and auto-invoice flags are false. Both billing profiles have Logo customer code/ID and e-invoice eligibility. Current IBAN presence is 0/2, without any decision that IBAN is mandatory. The 155 SALE ledger rows include 96 frozen delay snapshots different from current profile delay; see FIN-UI-010.
- **CONFIRMED_PRODUCTION_EXPOSURE / migration compatibility:** All three payouts are positive TRY DRAFTs older than 30 days; one pools two settlements. Their 11 historical lines have null direct `settlementApprovalLineId` while retaining unambiguous ledger-derived settlement lineage. Preserve or safely migrate those rows if direct settlement-line linkage later becomes authoritative; null linkage is not automatically a bug.
- **CONFIRMED_PRODUCTION_EXPOSURE / outstanding obligation:** Eight SettlementRefundAdjustment rows comprise six APPLIED with zero remaining, one PARTIALLY_APPLIED with positive remaining, and one PENDING with positive remaining. The two outstanding records are older than 30 days, have original settlement lineage, no applied-settlement lineage yet, and their refund ledgers are not in active payouts. They must not be silently dropped or normalized by future work.
- **Legacy evidence boundary:** There are 29 RefundRecord rows (28 processed, one pending), but zero RefundEvidenceSnapshot, RefundTerminalConflictEvidence, RefundTerminalEvidenceReview, and LegacyRefundFinanceReview rows. This is a real legacy refund population predating canonical terminal evidence persistence. Do not infer or backfill historical canonical evidence from those rows by assumption. FinancialCorrectionAuthority, FinancialCorrectionBaselineClaim, FinancialCorrectionCredit, FinancialCorrectionDeduction, FinancialCorrectionZeroNetAcknowledgement, and checked related correction settlement/payout/coverage rows are all zero; deployed schema does not imply an applied production correction population or make the feature unnecessary.
- **Return/cancellation observations — BLOCKED_BY_PRODUCT_DECISION for interpretation:** Fifty-five ReturnRecord rows exist. Twenty-seven allocations have open-looking return records; 21 of those have DRAFT/APPROVED settlement linkage and five have active DRAFT/REVIEW payout linkage. In the reported return-status groups, settlement creation/approval occurred after return-known for 12 of 17 `approved/approved`, the one `approved/NULL`, the one `pending/NULL`, the one `requested/requested` with vendorDecision approved, and five of seven `requested/requested` without vendorDecision; active payout after return-known occurred in zero, one, one, one, and two respectively. These are temporal observations, **not** proof that each state is finance-blocking or a bug. The exact lifecycle/hold contract remains unresolved. Two allocations have `cancelRefundReviewStatus=PENDING_REVIEW` and finance ledgers, but neither has DRAFT/APPROVED settlement or active DRAFT/REVIEW payout linkage; these observed cases fail closed.
- **NO_CURRENT_INSTANCE_FOUND:** SettlementScheduleJobRun has zero rows; no cancelled scheduled cycle, zero/negative payout, REVIEW/PAID payout, VendorBalanceEvent, Logo FAILED/UNKNOWN invoice, or applied Financial Correction population was found. The associated static findings remain open where applicable.
- **HEALTHY_STRUCTURAL_EVIDENCE:** One critical `transfer_failed` FinanceIntegrityAlert exists and is resolved; unresolved alert count is zero. No new defect follows from that record alone.
- **Retired-integration residue / migration compatibility:** Of 162 VendorAllocation rows, 64 retain legacy Odoo sale-order ID/name/sync fields. Historical ShipmentExecution provider counts are KARGONOMI 22, NAVLUNGO 14, TRY_OTO 11, KARGO_ENTEGRATOR 6, HEPSIJET 1; ShipmentShippingCost providers are `kargonomi` 21 and manual 1. Of 55 returns, three have provider `kargonomi`, 52 have null provider, and none has `navlungoReturnCreatedAt`. Vendor integration provider is `ayensoftware-smoke-681a536b` on one allocation and null on 161. These values do not reactivate retired integrations; the current business meaning of HEPSIJET and the smoke value is UNKNOWN. Preserve history absent a separately approved migration.
- **Schema compatibility:** Production PostgreSQL still defines PayoutBatchStatus `DRAFT`, `REVIEW`, `APPROVED`, `CANCELLED`, `EXECUTION_PENDING`, `PAID_PLACEHOLDER`, and `PAID`; current payout rows use only DRAFT. Zero rows do not authorize enum removal. Observed constraints include unique `SettlementApproval.scheduledCycleKey`, unique `SettlementScheduleJobRun.runDate`, one active Logo invoice per settlement/provider via partial unique index, unique refund-evidence lineage, and unique per-vendor financial/billing profiles.
- **CANNOT_PROVE_FROM_RETAINED_DATA / BLOCKED_BY_EXTERNAL_INFO:** Provider monetary mismatch for FIN-BUG-008 cannot be evaluated because all five CREATED Logo records lack stored provider total/currency. Historical refunded-SALE snapshots omit `refundOffsetAppliedBeforeSettlement`, and shifted fulfillment timestamps do not reconstruct exact historical monetary impact. No absent field or zero current incidence closes those findings or proves external invoice/EFT behavior.

## Known automation blockers

Current blockers include FIN-BUG-001, FIN-BUG-002, FIN-BUG-003, FIN-BUG-006, FIN-DESIGN-001, FIN-DESIGN-002, FIN-DESIGN-003, FIN-DESIGN-004, FIN-DESIGN-005, FIN-DESIGN-007, FIN-DESIGN-008, FIN-DESIGN-009, and FIN-DESIGN-010. FIN-BUG-005 blocks robust multi-vendor scheduling; FIN-RISK-001 still requires runtime proof. Audit C adds FIN-BUG-007, FIN-BUG-008, FIN-RISK-002, FIN-DESIGN-012, and FIN-DESIGN-013 for Logo/invoice-backed automation. Audit D adds FIN-DESIGN-014 and FIN-UI-014 for a future payment-ready human gate/dossier. Audit E adds FIN-UI-015 as an orchestration/operator-truth blocker and FIN-TEST-015 as required validation coverage, **not** a production bug. FIN-RISK-003 remains a proof requirement rather than a confirmed blocker until reproduced; FIN-RISK-004 requires time/evidence policy clarification, not a presumed monetary fix. Later Audits F–G may add blockers.

**This list is not an implementation queue yet.** Roadmap placement happens only after discovery is complete.

## Unresolved product decisions — not bugs

No answer is assigned here. The product owner must explicitly decide:

- What vendor weekly/biweekly should mean in the future, including exact 14-day versus ISO-week semantics and whether a vendor-specific anchor exists.
- Whether a real vendor payment cadence exists separately from settlement DRAFT cadence.
- Whether payout is vendor-wide or cycle-bound, and whether multiple settlement cycles may be pooled.
- Whether cancelled cycles can be replaced and how their identity is preserved.
- Whether missed/failed cycles are retried, skipped, or caught up in a later run.
- Which finance stages, if any, may operate unattended; whether automatic settlement approval has an eligible subset and a system actor.
- Whether REVIEW remains a human boundary or has another explicitly approved meaning.
- How a FAILED or stale PROCESSING run is retried or taken over, and who owns its exceptions; the current date-unique row does not define this.
- Whether manual work or automation takes precedence when both attempt the same settlement, Logo, or payout step.
- How abandoned Settlement DRAFTs and Payout DRAFT/REVIEW batches are handled; no expiry is assumed.
- What durable payout preparation replay/grouping identity, if any, represents one logical payment run.
- Who owns reconciliation and resolution of ambiguous Logo outcomes before another external send.
- How zero and negative payout amounts are disposed of and whether either enters REVIEW/PAID.
- The debt cutoff after payout DRAFT and how stale unpaid batches are handled.
- How Financial Correction sources are attributed to a settlement cycle, if at all.
- The authoritative business timezone/calendar for cycles, due dates, and display.
- Whether future/end-of-day eligibility may be drafted before real-time maturity.
- Whether unresolved terminal refund evidence must block new automation.
- What, if anything, constitutes payment-ready identity/completeness, including IBAN.
- At which approved boundary, if any, Logo invoice evidence is required: before payout DRAFT, before REVIEW, before external EFT, another boundary, or independent of payout.
- What provider evidence counts as invoice completion, and whether mixed invoice states may exist in one payment-ready pooled payout.
- The operational disposition of Logo `FAILED` and `UNKNOWN` outcomes.
- How zero or negative commission is documented for invoicing.
- How later refund commission reversals and Financial Corrections are documented/accounted for in Logo.
- Whether and how a settlement may be cancelled after an invoice is created.
- What provider-total and VAT tolerance, if any, is permissible against frozen settlement economics.
- What payout REVIEW means and whether it remains the future human control boundary.
- What evidence authoritatively makes a payout READY FOR PAYMENT; no new DB state is assumed.
- Whether new debt or newly approved settlement/correction sources after payout DRAFT make that batch stale.
- Whether stale DRAFT payouts expire or require explicit cancellation/rebuild.
- Whether payout must freeze its payment destination/IBAN and whether a payment reference is mandatory.
- What `paidAt` represents: Admin confirmation, EFT initiation, EFT completion, or another event.
- How to handle an EFT sent externally while the local payout remains REVIEW.

**THESE DECISIONS MUST NOT BE IMPLEMENTED BY ASSUMPTION.** These are not bug fixes. PAID remains explicit Admin confirmation of external payment.

## External questions register — unanswered

Logo İşbaşı clarification required:

1. Does invoice create support a client idempotency key?
2. Is there a unique external or merchant reference field?
3. What happens when an identical create POST is repeated?
4. Can an invoice be queried reliably by our reference after a timeout?
5. Can provider creation succeed despite a timeout or non-2xx response?
6. What does a successful 2xx create response mean?
7. Which identifier and status prove actual/legal issuance?
8. Which identifiers are guaranteed unique, and within what tenant scope?
9. Which cancellation, void, amendment, credit-note, and refund-document operations exist?
10. How does Logo round VAT for one aggregated line?
11. How are zero/negative totals and mixed VAT rates handled?
12. Is the current hardcoded `34000` postal-code fallback acceptable for a production invoice?

Accounting/tax clarification required:

- What event triggers the marketplace commission invoice, and how does its timing relate to vendor payment?
- How must Logo `FAILED` and `UNKNOWN` outcomes be treated operationally/accountingly?
- What documentation is required for a later refund commission reversal or Financial Correction?
- What happens to an issued invoice when its settlement is cancelled?
- How are zero/negative commission and mixed VAT handled?
- What VAT/total variance, if any, is acceptable between the frozen settlement and provider document?
- May a pooled payout have multiple settlement invoices in different states and still be considered payment-ready?
- Is the hardcoded `34000` postal-code fallback acceptable on an invoice?

No provider or accounting answer is assumed by recording these questions.

Bank/operator clarification required:

1. What operational evidence proves EFT was SENT?
2. What evidence proves EFT COMPLETED?
3. Is a unique bank/EFT reference reliably available?
4. At what point is an EFT considered irreversible?
5. Can a sent transfer still be cancelled?
6. How are rejected or returned transfers handled?
7. What is the procedure when EFT was sent but the local payout remains REVIEW?
8. What is the procedure if local PAID was recorded but EFT later failed or was returned?
9. What payment evidence/reference should be stored for reconciliation?
10. Is a zero-value payout ever considered a payment operation?

These questions remain unanswered. Repository-side design may continue while answers are collected; final EFT exception and reconciliation semantics require them.

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
