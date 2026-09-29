# Finance Automation Master Roadmap

**Status:** Planning document for decision review; no implementation or rollout is authorized.
**Evidence base:** [Financial Bugs & Automation Blockers](FINANCIAL_BUGS.md) (Audits A–G), [Shopify Discoveries](SHOPIFY_DISCOVERIES.md), and repository state at `f8bbd27f1a887cfce305648e01af27dc652fd19e`. FIN IDs are stable register references, not a numerical work queue. An audit finding, a preferred design, and a product approval are different things. UNKNOWN remains UNKNOWN.

## Target operating model and boundaries

```text
Order / financial evidence
  → delivery, return, refund, cancellation evidence
  → economic eligibility
  → Settlement DRAFT → validation → Settlement APPROVED / FROZEN
                                          ├→ Logo commission-invoice preparation,
                                          │  execution and reconciliation
                                          └→ Payout DRAFT from approved financial authority
                                              → final payment-readiness revalidation
                                              → PAYMENT READY Admin queue
                                              → manual external EFT
                                              → explicit Admin Mark Paid → PAID
```

Settlement APPROVED is frozen economic authority. The Logo invoice and payout are downstream consumers of that authority; a Logo response never sets payout mathematics. **Preferred, not yet approved:** prepare a payout DRAFT independently from Logo execution, then require verified Logo evidence at PAYMENT READY rather than at payout DRAFT. The product/accounting gate in the decision table must choose the actual boundary. PAYMENT READY is a proposed **derived operational condition**, not an authorized new payout status or database enum. The existing DRAFT/REVIEW/PAID transitions remain their current contracts until separately changed. External EFT and Mark Paid stay manual; no bank API, automatic EFT, or auto-PAID is in this roadmap.

Every phase preserves original SALE/REFUND ledgers, accepted refund evidence, approved settlements, and terminal PAID payouts. Financial Corrections remain additive. Later Shopify reads cannot reconstruct an earlier observed refund state; legacy RefundRecords do not become canonical evidence by assumption. Historical financial snapshots outrank mutable current vendor profiles. Retired integration data stays historical. Insufficient authority, uncertain external outcomes, and cross-vendor ambiguity fail closed and become visible Admin exceptions. A future write worker needs durable idempotency, replay/recovery evidence, vendor isolation, an explicit activation/kill switch, and controlled rollback behavior. No phase depends on destructive historical cleanup or silent production backfill. Automation is for a proven happy path; exceptions require Admin attention.

The phase ordering is a dependency proposal, not permission to begin a phase. Product, accounting, external-provider, and operational decisions below must be approved at the relevant gate. An unresolved gate blocks only the affected future activation; safe read-only discovery may continue.

## Phase 0 — Historical compatibility and production safety

- **Objective and order:** Establish a safe compatibility/remediation contract before any new automation encounters existing finance records. FIN-BUG-009 is the first concrete transition exposure: Audit F found three production DRAFT payouts, 11 payout lines with `settlementApprovalLineId = NULL`, and deterministic, unambiguous settlement-line lineage through `financeLedgerEntryId`; current DRAFT → REVIEW validation requires the direct link. A production transition was **not** attempted. Start here rather than silently normalizing records.
- **Register:** FIN-BUG-009; FIN-DESIGN-004; FIN-TEST-009 and FIN-TEST-014. Later phases retain their own linked findings.
- **Approved/current boundary:** Preserve payout amounts, original ledger, settlement authority and audit history; PAID remains terminal. Current direct-link requirement is implementation fact, not proof historical payouts are invalid.
- **Decisions/external information:** Approve an auditable compatibility/remediation procedure before production mutation; decide whether deterministic derived lineage can be used at transition or a separately authorized migration is required. External EFT status of those DRAFTs is UNKNOWN; obtain operator evidence before any payment-related action. No Shopify or Logo reconstruction is authorized.
- **Likely areas and data:** Payout REVIEW/Mark Paid revalidation in `backend/src/modules/finance/finance.service.ts`, payout-line/settlement-line lineage, historical fixture and Admin diagnostics. A migration is **possible, not presumed**. Do not backfill from guesses or alter the three payouts in this roadmap.
- **Historical compatibility inventory:** Preserve 96/155 SALE frozen delays different from current profile; 11 null-linked payout lines; five locally CREATED Logo records lacking retained provider monetary/document evidence; two outstanding `SettlementRefundAdjustment` obligations; 29 old RefundRecords without canonical `RefundEvidenceSnapshot`; old Odoo/provider fields; and production payout enum values. None requires blanket migration or deletion. The five Logo records are not proven legally invalid; absent fields stay unknown.
- **Expected future package / exclusions:** Write a compatibility design and isolated legacy fixture first; consider a narrowly scoped transition path only after approval. Exclude production edits, amount recalculation, synthetic refund snapshots, enum cleanup, and destructive record rewrites.
- **Tests / PostgreSQL / shadow:** Prove each ledger-derived match is unique and stable; exercise REVIEW and Mark Paid compatibility on isolated historical NULL-link fixtures, including ambiguous/orphan rejection and pooled payout. Use real PostgreSQL and transition tests. Read-only production preflight verifies the exact affected rows and unchanged economic totals; compare before/after only under separately authorized remediation.
- **Rollout gate, kill switch, success/failure, DoD:** Gate on approved procedure, isolated DB proof and fresh read-only production evidence. Keep any compatibility action off by default with an explicit operational stop; failure is ambiguity, amount drift, loss of history, or blocked transition. Done means the approved path is tested, auditable, controlled, and separately verified—not that this roadmap repaired production. **Unlocks:** trustworthy historical payout progression and migration-safe design for later phases.

## Phase 1 — Economic eligibility authority

- **Objective and order:** Make “can this source enter settlement now?” consistent across preview, DRAFT and approval before any automatic economic write.
- **Register:** FIN-BUG-001, FIN-BUG-003, FIN-BUG-004, FIN-BUG-006, FIN-RISK-001; FIN-UI-001, FIN-UI-003, FIN-UI-009, FIN-UI-010; FIN-TEST-002 through FIN-TEST-006.
- **Approved/current boundary:** Canonical Shopify monetary refund gate and persisted evidence rules remain; historical SALE delay snapshot governs that SALE rather than current profile. Cancellation holds, return holds, refund/cancel review, terminal evidence conflict, unresolved FinanceIntegrityAlert, outstanding refund adjustments, and authorized Financial Correction sources must not be silently discarded. The exact reachability of the multiple-return scenario is unproven.
- **Decision classes:** **Technical defects** are the refunded-SALE delay bypass, mutable delivery-time basis, misleading candidate diagnostic, and inactive-profile reactivation. **Product rules needed** include stable delivered-event authority if not already established, return-hold meaning for each actual lifecycle state, future/end-of-day maturity, and whether unresolved terminal conflict blocks new automated progression. **Shopify uncertainty** must be resolved only where the documented canonical behavior does not answer a needed question; webhook envelopes or a later refund read are not proof of earlier state. **Historical evidence unavailable** includes old RefundRecords without canonical snapshots and any delivery event not retained; fail closed or follow a separately approved historical compatibility policy.
- **Likely areas and data:** Settlement preview/approval service, fulfillment ingestion timestamps, VendorFinancialProfile read/edit, hold/alert projection and eligibility API/UI. A stable delivery timestamp might require an additive schema change, but no column or backfill is chosen here. No mutable-profile recalculation of historical finance.
- **Expected future package / exclusions:** Align predicates and diagnostics, preserve inactive policy, establish delivery event evidence, prove multi-return behavior. Exclude redefining returns from status names, repairing old finance by inference, or treating Shopify calls as immutable historical snapshots.
- **Tests / PostgreSQL / shadow:** Paired boundary tests for pre/exact/post cutoff, refunded and unfulfilled SALE, repeated delivered refresh, inactive-profile edit, selected-order alert, multi-return fixture, cancellation and correction/adjustment holds. Real DB proof for authority and concurrent stage revalidation. In production read-only evaluation, compare historical snapshots and current profile without changing either; surface unclassified/legacy cases.
- **Rollout gate, kill switch, success/failure, DoD:** No automated write while cross-stage eligibility disagrees. Any new evaluator is disabled for writes and can be stopped independently. Success is one authoritative reasoned decision at each stage with no silent source omission; failure is preview/write contradiction, timestamp drift, unclassified hold, or profile reactivation. Done after approved rules, focused tests, DB proof, and shadow acceptance in Phase 2. **Unlocks:** credible read-only shadow evaluation.

## Phase 2 — Read-only production shadow mode

- **Objective and order:** Observe the proposed eligibility and cycle decisions against current production behavior before a worker may create settlement or payout records.
- **Register:** Verification surface for FIN-BUG-001/003/004/005/006, FIN-RISK-001, FIN-DESIGN-003/008 and FIN-UI-010; it closes none merely by observation.
- **Approved/current boundary:** Advisory evaluation only. No settlement or payout creation, Logo call, Shopify/provider mutation, or financial DB write. If read-only observations cannot be safely captured, do not turn on shadow collection by assumption.
- **Decisions/external information:** Define numerical acceptance thresholds, duration, exception ownership, and which uncertain cases remain excluded. Shopify questions only if a required fact remains undocumented; never fill missing historical evidence with current reads.
- **Likely areas and data:** Read-only finance candidate evaluator, scheduled preview diagnostics, operational metrics/reports. Prefer existing evidence; any telemetry persistence needs separate review and must not become monetary authority. Historical legacy groups remain distinguishable.
- **Expected future package / exclusions:** Bounded, vendor-isolated comparison of proposed and current results, with reason codes; no automated DRAFT, approval or retries. No external calls for the comparison itself.
- **Tests / PostgreSQL / shadow:** Deterministic replay fixtures and API tests; read-only DB permission/transaction proof; ensure shadow cannot call write functions. Track candidate agreement rate; blocked-reason distribution; delivery timestamp divergence; refund/return disagreement; frozen/current delay disagreement; detected outstanding adjustments/corrections; unclassified exception count; vendor-by-vendor and cutoff-boundary differences. Review samples, not just aggregate success percentage.
- **Rollout gate, kill switch, success/failure, DoD:** Explicit shadow flag/off switch; no finance-write capability. Acceptance criteria must be approved **before** measuring pass/fail. Success is explained, bounded disagreement with zero unclassified high-risk inclusion; failure is unexplained candidate inclusion, hidden obligation, cross-vendor leak, or missing metrics. Done after production read-only period and signed-off discrepancy register. **Unlocks:** consideration of automated settlement DRAFT—not automatic approval.

## Phase 3 — Settlement cycle and DRAFT orchestration

- **Objective and order:** Only after eligibility/shadow proof, make scheduled DRAFT creation recoverable and vendor-isolated; a schedule run is not payment cadence or approval.
- **Register:** FIN-BUG-002/005; FIN-DESIGN-001/002/003/005/006/008; FIN-UI-001/007/011/015; FIN-TEST-001/007/008/015.
- **Approved/current boundary:** Current weekly/biweekly fields govern DRAFT due-ness; current BIWEEKLY is even ISO-week parity without vendor anchor, and current scheduled selection is cumulative through UTC periodEnd. Neither is an approved future 14-day/payment promise. Current job is Admin-triggered and not a startup scheduler.
- **Decisions/external information:** Choose cadence/calendar/timezone, period semantics, cancelled-cycle replacement identity, missed-run catch-up, manual-vs-automated precedence, correction-source scope, stale/FAILED/PROCESSING takeover, exception ownership and abandoned DRAFT policy. These are product/operational decisions, not to be hidden in retry code. No provider answer is needed for local DRAFT orchestration.
- **Likely areas and data:** Schedule service/job, `SettlementScheduleJobRun`, `scheduledCycleKey`, settlement selection, Admin run status. Additive run identity/checkpoint/lease/attempt evidence may be needed; exact schema awaits contract. Preserve historic cycle rows and source claims.
- **Expected future package / exclusions:** Separate cycle-contract tests, truthful run diagnostics, vendor-isolated preview, durable per-vendor execution/recovery, and guarded DRAFT worker. Exclude auto-approval, Logo, payout, and PAID.
- **Tests / PostgreSQL / shadow:** Real PostgreSQL cancelled-cycle uniqueness, manual/scheduled overlap, two-worker same-date claims, retries after uncertain response, partial vendor A/B/C outcomes, stale PROCESSING, FAILED replay, crash before final run update, idempotent same-source claim. Shadow-run due dates and dry-run source sets first; no silent correction exclusion.
- **Rollout gate, kill switch, success/failure, DoD:** Initially disabled write worker with per-stage/global stop and drain semantics; canary by approved vendor scope only. Success: one durable cycle/source claim, truthful status, recoverable per-vendor checkpoints, unaffected vendors continue while one fails. Failure: duplicate DRAFT, misleading ALREADY_PROCESSED, stranded run, lost correction, or unbounded retry. Done after contract approval, PG concurrency/crash proof, shadow pass, and rollback/stop rehearsal. **Unlocks:** reliable automatic DRAFT creation and separate approval design.

## Phase 4 — Settlement validation and approval boundary

- **Objective and order:** Separate automatic DRAFT from any future automatic APPROVED/FROZEN transition. Approval must revalidate source authority and record who/what approved it.
- **Register:** FIN-BUG-001/003; FIN-DESIGN-003/006/008; FIN-UI-002/003/010; FIN-TEST-002/005/006/008, plus applicable hold/alert findings.
- **Approved/current boundary:** Approved settlement is frozen financial history; local approval revalidation is authoritative. A DRAFT or shadow READY label is not approval. Existing manual Admin approval remains until a narrower automation policy is approved.
- **Decisions/external information:** Whether any settlement may be auto-approved; exact deterministic subset and exception exclusions; system actor/audit semantics; whether current/new holds after DRAFT force rework; whether date-range maturity can be assessed before real-time cutoff. No implicit blanket auto-approval.
- **Likely areas and data:** Settlement approval service, source/hold revalidation, approval audit, Admin state labels. An actor/audit model may need additive data; no schema chosen here. Preserve all APPROVED rows and historic snapshots.
- **Expected future package / exclusions:** Cross-stage predicate parity and a narrowly gated approval worker only after policy; no invoice create, payout or payment action in this phase.
- **Tests / PostgreSQL / shadow:** Paired preview→DRAFT→APPROVED cases for refund/return/cancellation/alert/correction, intervening changes and concurrent approvals; real DB uniqueness/immutability. Shadow-classify which historical DRAFTs would qualify without advancing them.
- **Rollout gate, kill switch, success/failure, DoD:** Manual approval is the fallback; independent auto-approval off switch. Success: only approved subset advances with durable actor and frozen values; failure: unsupported case approved, stale source accepted, or history rewritten. Done after explicit subset/actor approval, DB tests and observed shadow match. **Unlocks:** two downstream consumers of approved authority—Logo and payout—subject to their own gates.

## Phase 5 — Logo İşbaşı commission invoice authority and recovery

- **Objective and order:** Treat Logo as a first-class external financial document branch from frozen settlement economics. It must not be rushed into the payout calculation path.
- **Register:** FIN-BUG-007/008; FIN-RISK-002/003; FIN-DESIGN-012/013; FIN-UI-012; FIN-TEST-012/013; payment-dossier FIN-UI-014.
- **Approved/current boundary:** Logo İşbaşı remains active. Current locally CREATED is not by itself proof of monetary match or legal issuance. One active local invoice record does not prevent duplicate provider POST. Five historic CREATED rows have incomplete retained monetary/document evidence; do not label them invalid or fabricate provider outcomes. **Never blindly resend an ambiguous create.**
- **Decisions/external information:** Product/accounting must set commission invoice timing, payout/ready gate point, zero/negative commission, refund/Financial Correction documentation, settlement cancellation after invoice and allowed VAT/total representation/tolerance. Logo must clarify repeated-create idempotency, timeout/reference lookup, non-2xx meaning, unique IDs/tenant scope, CREATED versus legally issued, document/GIB evidence, total/currency, VAT rounding, cancellation/credit note. Accountant must approve tax treatment. See question packs.
- **Likely areas and data:** Logo snapshot builder, create service, invoice record/sync preview, settlement cancellation, Admin invoice UI. Additive execution claim, immutable request snapshot and reconciliation evidence may be needed; exact schema awaits contracts. Preserve historical invoices and settlements.
- **Expected future package / exclusions:** Distinct stages: (A) eligibility, (B) immutable request snapshot, (C) exclusive external execution claim, (D) create, (E) ambiguous-result quarantine, (F) provider reconciliation, (G) frozen-versus-provider monetary comparison, (H) document/issuance evidence, (I) refund/correction/cancellation-after-invoice treatment. Do not convert Logo totals into payout amounts or auto-retry UNKNOWN/non-2xx without proof.
- **Tests / PostgreSQL / shadow:** Real DB concurrent-create and snapshot/cancellation race, crash after send before local persist, retry classification, provider contract fixtures, aggregate versus line-rounded VAT, mismatch and mixed-invoice pooled payout. Use provider sandbox/controlled integration only after provider answers; no live external call during shadow. Read-only production assessment distinguishes local CREATED from verified issuance, with five legacy rows marked incomplete/unknown.
- **Rollout gate, kill switch, success/failure, DoD:** Independent Logo-create off switch; reconciliation reads must not imply permission to send. Success: one claimed request, provable provider identity/economics and operator-resolvable ambiguity; failure: possible duplicate send, unresolved UNKNOWN promoted to success, unsupported tax representation, or silent old-invoice normalization. Done after provider/accounting sign-off, PG race proof, safe failure drills and controlled canary. **Unlocks:** use of verified invoice evidence at whichever later gate is explicitly approved.

## Phase 6 — Payout DRAFT preparation from frozen authority

- **Objective and order:** Prepare payout DRAFTs only from approved, exclusive economic sources after grouping, debt timing, correction and amount-disposition contracts are settled. Logo remains a parallel documentary branch.
- **Register:** FIN-BUG-009; FIN-DESIGN-002/004/007/008/009/010/011; FIN-UI-004/005/006/007/010/014; FIN-TEST-009/010/011/014.
- **Approved/current boundary:** Today preparation is manual vendor-wide and may pool settlements. Debt offset freezes at preparation. Financial Correction credit/deduction and outstanding refund adjustments are real separate sources/obligations, not optional noise. The original PAID history cannot be reopened. No Logo-response amount can override approved authority.
- **Decisions/external information:** Vendor-wide versus cycle-bound grouping, multi-cycle/manual mixing, logical preparation replay identity, debt cutoff and after-DRAFT staleness, correction/adjustment cycle treatment, zero/negative payout disposition, stale/abandoned DRAFT policy, payment identity requirements. Whether Logo gates DRAFT is unresolved. EFT state remains external UNKNOWN.
- **Likely areas and data:** `preparePayoutBatch`, VendorBalance, correction/adjustment source selection, payout-line lineage, Admin payment preparation. Additive request/source identity or destination snapshot may be needed; no columns chosen. Phase 0 historical NULL-link compatibility is prerequisite.
- **Expected future package / exclusions:** Define source/grouping contract, preserve source exclusivity, implement guarded replay and stale-money checks, then canary payout DRAFT. Exclude REVIEW, EFT, Mark Paid, source-level debt allocation not already approved, and payout amounts derived from Logo.
- **Tests / PostgreSQL / shadow:** Real DB pooled manual/scheduled/correction settlement, concurrent/replayed preparation, debt before/after DRAFT, outstanding adjustment, zero/negative paths under approved rule, cancellation/rebuild, historic NULL-link fixture, PAID terminality. Read-only shadow compares candidate set, exact frozen totals, source provenance and debt/credit obligations with current manual preparation, without creating payouts.
- **Rollout gate, kill switch, success/failure, DoD:** Independent auto-payout-DRAFT off switch. Success: one exclusive source claim and explainable frozen DRAFT with all obligations; failure: double claim, silent exclusion, stale debt ignored contrary to approved rule, negative/zero case promoted without policy, or old payout stranded. Done after approvals, PG concurrency and shadow reconciliation, then controlled canary. **Unlocks:** final payment-readiness evaluation, not automatic payment.

## Phase 7 — PAYMENT READY, REVIEW and Admin exception operations

- **Objective and order:** Build a trustworthy, explainable Admin decision surface only after settlement, invoice, payout and source provenance are independently reliable. Readiness is derived from current authoritative checks; no new status enum is assumed.
- **Register:** FIN-DESIGN-004/007/011/013/014; FIN-RISK-004; FIN-UI-004/006/012/013/014; FIN-TEST-010/013/014, and unresolved stage-specific blockers.
- **Approved/current boundary:** Current payout REVIEW is an Admin transition but lacks durable reviewer/time. UI timeline uses mutable `updatedAt` for purported review and an unsupported Approved milestone. External EFT and explicit Admin Mark Paid remain manual; no bank-state inference. The payment screen cannot currently prove a pooled payout's complete invoice, source and destination dossier.
- **Decisions/external information:** Define REVIEW meaning, durable reviewer/time, payment destination and whether to freeze it, payment reference, `paidAt` meaning, stale REVIEW/DRAFT disposition, EFT-not-sent/sent/unknown procedures, required Logo evidence and where it gates. The **preferred, not approved** design gates PAYMENT READY rather than payout DRAFT. Bank/operator and accounting input is needed before final readiness semantics.
- **Likely areas and data:** Payout revalidation, Admin payment screen/API, invoice/status projections, exception queue, audit events. Possible additive reviewer/destination/evidence fields are not specified here. Preserve historic payout/settlement/Logo facts; never infer missing bank events.
- **Expected future package / exclusions:** Define a read-only readiness projection and coherent payment dossier; add durable human review/audit only after policy. Each exception should identify blocked stage, vendor, economic/order/allocation authority where appropriate, settlement, invoice, payout, amount/currency, frozen versus current/conflicting evidence, age, retryability, reconciliation need, safe Admin action, whether money changes, and audit trail. Reuse existing evidence; do not duplicate raw payloads or design the visual layout yet. No automatic EFT or PAID.
- **Tests / PostgreSQL / shadow:** Real DB mixed-invoice pooled payout, new debt/correction after DRAFT, stale source, reviewer actor/time, zero/negative behavior under approved policy, destination/reference and Mark Paid compatibility. Browser/Admin tests prove blocked reason and safe action. Read-only shadow compares computed readiness with actual dossier completeness; do not send EFT as a test.
- **Rollout gate, kill switch, success/failure, DoD:** Keep readiness publication/automatic queueing off until product/accounting/bank gates resolve; fallback to existing manual workflow. Success: Admin can verify lineage, frozen math, invoice evidence, destination and current blockers without a false READY label. Failure: unresolved Logo UNKNOWN, hidden stale money, unsupported payment identity, fabricated review/bank time, or paid history mutation. Done after approved evidence contract and integration/browser proof. **Unlocks:** controlled payment-ready queue; never unattended EFT/PAID.

## Phase 8 — Controlled rollout and ongoing assurance

- **Objective and order:** Activate only separately authorized, proven stages in sequence; verify production evidence without using real financial mutations as synthetic tests.
- **Register:** All still-open FIN-* findings remain tracked in [the register](FINANCIAL_BUGS.md); rollout does not close them without the register's closure evidence. FIN-TEST-015 and FIN-TEST-014 are key end-to-end gates.
- **Approved/current boundary:** Manual PAID, immutable paid/approved history, vendor isolation and fail-closed authority persist. “Green CI” is necessary but not sufficient for business or external-provider approval.
- **Decisions/external information:** Sign off each activation scope, canary vendors, thresholds, exception owner, rollback/stop procedure and production verification method. Provider/accountant/bank answers remain gates where used. No production mutation is authorized by this document.
- **Likely areas and data:** Stage flags/kill switches, runbook/metrics, Admin exception flow and operational logs. No destructive migration or blanket backfill. Existing production records require their own controlled handling.
- **Expected future package / exclusions:** Roll out in increasing authority: read-only shadow → guarded DRAFT → separately approved auto-approval → Logo create → payout DRAFT → derived payment-ready queue. A phase may stay manual indefinitely. Exclude auto-EFT/auto-PAID and provider retry by guess.
- **Tests / PostgreSQL / shadow:** CI and fresh isolated DB validation for each changed stage, concurrency/failure injection, rollback rehearsals and staged read-only production comparisons; canary observation includes duplicate-source/provider-send counts, missed obligations, exceptions, stale batches, invoice mismatch, and Admin action trace. Do not create real corrections or invoices merely for smoke.
- **Rollout gate, kill switch, success/failure, DoD:** Independent stage stop, no in-flight blind replay, documented manual fallback and incident procedure. Success is sustained measured agreement with approved thresholds and no unresolved monetary/authority exceptions; failure triggers stage stop, evidence preservation and Admin reconciliation. Done only when each activated stage meets its own approval and monitoring criteria. **Unlocks:** ongoing operational governance, not automatic payment.

## Decision gates — unresolved

Statuses below are `OPEN` unless a cited source establishes approval; none here is approved by this roadmap. Options describe alternatives visible in current evidence, **not** selected rules. Product owns business semantics, engineering owns proof/implementation, and external parties answer only their own domain questions.

| ID / category | Question and why required | Evidence-supported options (not decisions) | Answer owner | Blocks phase | Status |
| --- | --- | --- | --- | --- | --- |
| P01 PRODUCT | Which return lifecycle states hold each allocation? FIN-RISK-001 and production overlaps cannot be inferred from status names. | Existing hold policy after reachability proof; separately approved revised policy. | Product + finance operations | 1 | OPEN |
| P02 PRODUCT | What is authoritative delivered/maturity time when refresh timestamp moves? FIN-BUG-003. | Persist proven delivered event; another explicitly proven historical authority; fail closed where absent. | Product + operations | 1 | OPEN |
| P03 PRODUCT | What do weekly/biweekly, period, timezone and cutoff mean? Current even-ISO-week/cumulative UTC behavior is not a payment promise. | Preserve explicitly approved current calendar/cumulative behavior; or approve anchored/closed-period semantics. | Product + finance operations | 3 | OPEN |
| P04 PRODUCT | Can a cancelled cycle be replaced, and with what identity? DB key remains reserved. | Permanent consumption; new replacement identity; active-only identity, each with audited history. | Product + finance operations | 3 | OPEN |
| P05 PRODUCT | How do missed/FAILED/PROCESSING runs catch up and who owns exceptions? | Explicit retry/resume; later cumulative pickup; manual resolution—none currently guaranteed. | Product + operations | 3 | OPEN |
| P06 PRODUCT | What wins when manual and automatic actors race for a settlement/payout? | Manual precedence; worker precedence; explicit serialized claim plus conflict handling. | Product + operations | 3, 6 | OPEN |
| P07 PRODUCT | May settlement approval run automatically; which deterministic subset and system actor? | Keep manual; authorize a narrow subset with durable actor; broader scope only by separate decision. | Product + finance controller | 4 | OPEN |
| P08 PRODUCT | Is payout vendor-wide or cycle-bound, and may multiple/manual/scheduled cycles pool? | Current vendor-wide pool; approved cycle-bound model; restricted pooling. | Product + finance controller | 6 | OPEN |
| P09 PRODUCT | When is debt cut off and what happens to DRAFT/REVIEW after new debt/source/correction? | Freeze at preparation with explicit disclosure; stale cancellation/rebuild; another approved revalidation rule. | Product + finance controller | 6, 7 | OPEN |
| P10 PRODUCT | What happens with zero or negative payout amounts? | Accounting-only stop/review; approved transition path; explicit debt handling; no external negative EFT assumed. | Product + finance controller | 6, 7 | OPEN |
| P11 PRODUCT | How do correction credits/deductions and refund adjustments enter a cycle? | Vendor-wide obligation handling; approved attribution; explicit exception—never silent omission. | Product + finance controller | 3, 6 | OPEN |
| P12 PRODUCT | Does unresolved terminal refund evidence block new automated finance; can future/end-of-day maturity be drafted early? | Fail-closed hold; explicitly bounded exception policy, only with proven evidence. | Product + finance controller | 1, 4 | OPEN |
| P13 PRODUCT | Does verified Logo invoice evidence gate payout DRAFT or PAYMENT READY/EFT? The parallel branch can share frozen settlement authority. | Gate DRAFT; gate derived PAYMENT READY; explicit independence. **Preferred: PAYMENT READY, NOT APPROVED.** | Product + finance controller, with accountant | 5–7 | OPEN |
| P14 PRODUCT | What does REVIEW mean and what must the Admin see to call a payout payment-ready? | Retain human control with durable evidence; redefine only by separate approval. | Product + finance operations | 7 | OPEN |
| P15 PRODUCT | What destination/IBAN and reference evidence is required, and what does `paidAt` mean? | Current mutable profile/click time; approved frozen destination and event-time contract. | Product + finance operations | 7 | OPEN |
| P16 PRODUCT | How are abandoned DRAFT/REVIEW batches handled? | Explicit cancellation/rebuild; retain until supervised action; approved expiry only with evidence. | Product + finance operations | 6, 7 | OPEN |
| L01 LOGO_PROVIDER | Can repeated create be safely deduplicated or queried after timeout/non-2xx? Prevent duplicate external issue. | Provider idempotency/reference lookup if proven; otherwise quarantine and human reconciliation. | Logo İşbaşı | 5 | OPEN |
| L02 LOGO_PROVIDER | What IDs, tenant scope, status and document/GIB evidence prove issuance, and what total/currency fields are authoritative? | Provider-defined identities/states/fields; local CREATED alone is insufficient. | Logo İşbaşı | 5, 7 | OPEN |
| L03 LOGO_PROVIDER | How does Logo round aggregate VAT, handle zero/negative/mixed rates, cancellation and credit notes? | Provider-documented behavior only; no inferred treatment. | Logo İşbaşı | 5 | OPEN |
| A01 ACCOUNTING_TAX | When should commission invoice issue and what evidence must precede vendor payment? | At an approved settlement/payment boundary; no timing selected. | Accountant/tax advisor + product | 5, 7 | OPEN |
| A02 ACCOUNTING_TAX | How should aggregate versus line-rounded VAT, total tolerance, refund/correction and cancelled-settlement documents be represented? | Accountant-approved reconciliation/document policy only. | Accountant/tax advisor | 5 | OPEN |
| A03 ACCOUNTING_TAX | What is the disposition of zero/negative commission and mixed invoice states in a pooled payout? | Explicit accounting policy; no local shortcut. | Accountant/tax advisor + product | 5, 7 | OPEN |
| S01 SHOPIFY | Is any unresolved Shopify behavior actually needed to define a new authority, especially earlier-vs-later refund equivalence or return state? | Use persisted canonical observation; request Shopify clarification only for an unresolved necessary fact. A stable Refund ID is not full evidence immutability. | Shopify AI/official source if needed | 1 | OPEN |
| B01 BANK_EFT | What proves EFT sent/completed/returned, reversibility, unique reference, and sent-but-local-REVIEW handling? | Bank/operator evidence and approved manual procedure; no API behavior assumed. | Bank/EFT operations + product | 7 | OPEN |
| B02 BANK_EFT | How are local PAID vs failed/returned EFT and payment time reconciled? | Approved exception/reconciliation procedure; never rewrite PAID by assumption. | Bank/EFT operations + product | 7 | OPEN |
| T01 TECHNICAL | Can deterministic ledger-derived lineage safely support historical DRAFT transitions without changing economics? | Isolated compatibility validation; separately approved controlled migration if necessary. | Engineering + finance controller | 0 | OPEN |
| T02 TECHNICAL | What durable worker claim, checkpoint, retry identity and kill-switch mechanics satisfy approved cycle semantics? | Small additive implementation after P03–P06; validate in PostgreSQL/two-worker tests. | Engineering | 3 | OPEN |
| T03 TECHNICAL | What proof threshold and duration qualify shadow results for write activation? | Measured, signed-off thresholds; not a default chosen by engineering alone. | Engineering + product/operations | 2 | OPEN |

## External question packs — to ask later, not answered here

- **Logo İşbaşı:** Is create idempotent by merchant key/reference and tenant; can that reference locate an invoice after timeout; can non-2xx still mean created; which identifiers/status/document/GIB evidence prove issue; where are authoritative total/currency; how is VAT rounded for an aggregated line; how are zero/negative/mixed rates, cancellation, amendment and credit notes represented? These target the unanswered questions in the register, not a request to resend an ambiguous invoice.
- **Accountant/tax advisor:** At what event must commission invoice issue relative to settlement approval and payment; what evidence is mandatory before EFT; how should per-line frozen commission/VAT reconcile with provider aggregate; permitted variance if any; how are refund reversals, Financial Corrections, cancellation-after-issue and zero/negative commission documented; can pooled settlements with mixed invoice states ever be payment-ready?
- **Shopify AI / official source, only if needed:** Does any Shopify-supported immutable revision/event/hash bind a later historical Refund read to the precise earlier observed transactions and refund lines? This remains UNKNOWN in `SHOPIFY_DISCOVERIES.md`; current canonical observations and persisted incoming conflict evidence are the available local authority. Ask separately about a return state only if a concrete eligibility contract cannot be established from existing documented/local evidence. Do not re-ask already documented refund monetary-gate or vendor-mapping behavior.
- **Bank/EFT operations:** What evidence establishes sent, completed, cancelled, rejected or returned transfer; is there a unique reliable reference and irreversible point; what to do if EFT was sent while local payout remains REVIEW or local PAID later fails; what timestamp should `paidAt` represent; is a zero-value payout a payment operation? No automatic bank action is proposed.

## Small future implementation packages

These are planning-sized units, not implementation prompts or authorizations. `Possible` migration means assess after contract approval; never modify historical authority merely to satisfy a package.

| Package | Phase / dependency | Approximate domain | DB migration expected? | Behavior change? | Shadow proof before activation? |
| --- | --- | --- | --- | --- | --- |
| H1 Historical lineage compatibility design/fixture | 0 / none | Payout transition, Audit G | Possible only after approved design | No for design; possible later | Read-only production preflight |
| E1 Eligibility predicate parity and hold proof | 1 / H1 safety inventory | Settlement, refund/return/cancel/alerts | Possible stable delivery evidence | Yes after approved rules | Yes |
| E2 Inactive profile and diagnostic accuracy | 1 / E1 evidence | Profile, preview/Admin explanation | No expected | Yes, targeted | Yes for scheduling |
| S1 Shadow evaluator and discrepancy report | 2 / E1–E2 | Read-only finance observability | Not assumed | No monetary change | Is the shadow stage |
| C1 Cycle/calendar/identity contract tests | 3 / S1 + P03–P05 | Schedule | Possible | Not until approved | Yes |
| C2 Recoverable per-vendor DRAFT worker | 3 / C1 + P06/P11 | Schedule job/settlement | Likely additive, unselected | Yes | Yes |
| A1 Approval subset/audit gate | 4 / C2 + P07 | Settlement approval | Possible audit evidence | Yes | Yes |
| L1 Logo snapshot and local exclusive claim | 5 / A1 + L01–L03/A01–A03 | Logo/settlement | Possible additive | Yes to execution safety | Read-only invoice inventory |
| L2 Logo reconciliation and Admin exception resolution | 5 / L1 | Logo/Admin | Possible additive | Yes | Yes; provider integration separately gated |
| P1 Payout grouping/source/debt contract tests | 6 / H1, A1, P08–P11 | Payout/correction/balance | Possible | No until contract approved | Yes |
| P2 Guarded payout DRAFT worker | 6 / P1 | Payout | Possible replay identity | Yes | Yes |
| R1 Derived readiness and pooled payment dossier | 7 / P2, L2, P13–P16 | Admin finance/API | Possible only for approved audit facts | No money; possible control change | Yes |
| R2 Human REVIEW/payment evidence and exception flow | 7 / R1 + B01–B02 | Payout/Admin | Possible actor/destination evidence | Yes | Yes |
| O1 Stage canary, kill-switch and incident runbook | 8 / each relevant package | Operations/CI | Not inherent | Activation only | Yes, per stage |

No package should bundle a finance rule decision, schema change, provider send and payment activation into one unreviewable release. Tests must distinguish local DB invariants from external/provider truth. The current register remains the closure authority for each FIN item.

## Critical path and manual boundary

| Milestone | Minimum dependency chain before activation |
| --- | --- |
| **A. Any automated settlement write** | Phase 0 historical safety → Phase 1 eligibility/hold authority → Phase 2 accepted read-only shadow → P03–P06/P11 cycle and recovery decisions → Phase 3 real-DB race/replay proof and kill switch. |
| **B. Automatic settlement APPROVED** | A → P07 approved subset/system actor → Phase 4 stale-source/hold revalidation and frozen-history proof. Manual approval remains otherwise. |
| **C. Automatic Logo create** | B or separately approved manual-approved settlement source → L01–L03 + A01–A03 → Phase 5 exclusive send, provider reconciliation and ambiguous-outcome quarantine → independent kill switch. Never blind resend. |
| **D. Automatic payout DRAFT** | Phase 0 lineage → approved settlement authority (manual or B) → P08–P11/P16 payout grouping, debt/correction/zero/negative policy → Phase 6 replay/source-exclusivity/shadow proof. P13 decides whether C is also a prerequisite; it is **not yet approved**. |
| **E. Trusted PAYMENT READY** | D + final source/amount/hold revalidation + P13–P15 and A01–A03 invoice/destination policy + verified required Logo evidence from C + Phase 7 pooled dossier, human control and exception tests. A READY label must not outrun evidence. |
| **F. Always manual under this roadmap** | External bank/EFT execution and explicit authenticated Admin Mark Paid. Ambiguous Logo/bank outcomes, unsupported source authority and exception reconciliation also remain human-supervised until separately approved; no automatic EFT or PAID package exists. |

## Final roadmap status

DISCOVERY STATUS
- Audit A: COMPLETE
- Audit B: COMPLETE
- Audit C: COMPLETE
- Audit D: COMPLETE
- Audit E: COMPLETE
- Audit F: COMPLETE
- Audit G: COMPLETE

IMPLEMENTATION STATUS
- NOT STARTED

IMPLEMENTATION AUTHORIZATION
- NOT GRANTED

**Roadmap-readiness verdict: READY FOR DECISION REVIEW.** This verdict approves review of the dependency plan and question packs only. It does not close a FIN finding, select an unresolved business rule, approve external behavior, or authorize implementation or deployment.
