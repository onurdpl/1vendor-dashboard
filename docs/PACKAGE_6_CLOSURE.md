# Package 6 — Vendor Architecture Final Release Closure

**Proposed classification** — `PACKAGE_6_CLOSED_WITH_DOCUMENTED_LIMITATIONS_AND_DEFERRALS`

**Evidence date** — 2026-11-17, Europe/Vienna (CET).

**Evidence baseline (`main`)** — `efd6cda24f37843ee26d13b7439fe3d8e588f012`.

**Record state** — Proposed documentation for review in a Draft PR. Formal repository-recorded closure takes effect after review and merge into `main`. Preparation of this document does not itself complete closure or authorize deployment.

## A. Objective and approved scope

The owner's `SPORGYM_P6_FORMAL_CLOSURE` task authorizes preparation of this bounded release record using the P6-01 through P6-06 evidence. Package 6 covers Final Release readiness of the six-package Vendor architecture program, including authorized Vendor Workspace reads, Admin selected-Vendor context, Vendor membership boundaries, deployment identity, production migration metadata and the exercised authenticated production smoke.

The detailed original Package 6 acceptance checklist could not be recovered by P6-01 through P6-03. That historical approval evidence remains **UNKNOWN**. Existing deployment and operational checklists provide guidance within their documented scope. This record introduces no additional mandatory release gates. Review of this PR is the Package 6 decision point for accepting the specific evidence, exclusions and carried-forward findings below.

## B. Package 1–5 dependency overview

| Package | Evidence carried into this release review | Recorded boundary |
| --- | --- | --- |
| 1 / 1D — Settings and Shipping | [PR #16](https://github.com/onurdpl/1vendor-dashboard/pull/16), [PR #23](https://github.com/onurdpl/1vendor-dashboard/pull/23), and P4-17/P4-18 evidence for selected-Vendor reads, authorized saves, persistence and context isolation. | A separate formal closure record covering all of Package 1 was not recovered. |
| 2 — Session and Vendor Context | [PR #24](https://github.com/onurdpl/1vendor-dashboard/pull/24), session/context regressions, and later authenticated production smoke. | A separate formal Package 2 closure record was not recovered. The smoke exercises the recorded roles and flows. |
| 3 — Global Admin Vendor Access | [PR #33](https://github.com/onurdpl/1vendor-dashboard/pull/33) and [Package 3 closure](PACKAGE_3_CLOSURE.md) record `PACKAGE_3_CLOSED_WITH_DOCUMENTED_VERIFICATION_LIMITATIONS`. | Historical Signals production verification limitations, positive failed-webhook ownership projection and standalone Shipment Detail expansion retain their recorded boundaries. |
| 4 — Workspace Integration | [PR #57](https://github.com/onurdpl/1vendor-dashboard/pull/57) merged the [Package 4 closure evidence](P4_PROGRESS_AND_DISCOVERIES.md). Orders, Returns, Finance, Support and Settings/Shipping have scoped implementation and historical test evidence. | Pagination, historical relationship, performance and evidence limitations remain documented. |
| 5 — Security / Regression | [PR #66](https://github.com/onurdpl/1vendor-dashboard/pull/66) merged [Package 5 closure](PACKAGE_5_CLOSURE.md). [PR #67](https://github.com/onurdpl/1vendor-dashboard/pull/67) recovered the subsequent CI infrastructure failure. | `PACKAGE_5_CLOSED_WITH_DOCUMENTED_DEFERRALS`. The open findings in section I retain their status. |

## C. GitHub baseline and CI evidence

Both required jobs in [post-merge run 44133035421](https://github.com/onurdpl/1vendor-dashboard/actions/runs/44133035421) succeeded on the exact evidence baseline. The following execution lines were independently retrieved from GitHub while preparing this document.

| Evidence | Actual result |
| --- | --- |
| [build-and-test](https://github.com/onurdpl/1vendor-dashboard/actions/runs/44133035421/job/134214999826) | SUCCESS. PostgreSQL 16 baseline verified through `20261115120000_add_payout_preparation_failure_resolution`. General tests recorded 4,495 passed and 724 skipped. |
| [postgres-18-finance](https://github.com/onurdpl/1vendor-dashboard/actions/runs/44133035421/job/134214999036) | SUCCESS. PostgreSQL 18 baseline verified through the same migration. Vendor replay ownership executed 3 PASS, 0 FAIL, 0 SKIPPED and 0 PENDING. |
| Docker browser regression | 15 mock browser tests passed, with zero failed, flaky or skipped. Six real Finance browser scenarios and six database post-checks passed. |
| Support and payout failure regressions | Support reply atomicity executed 9/9 and payout failure history/resolution 13/13 on each PostgreSQL major, with zero failed, skipped or pending in those gates. |

The 724 skipped general tests are not counted as PASS. Dedicated PostgreSQL gates have their own execution evidence. Historical local/disposable browser reports retain their original evidence type. The CI browser cases establish their tested Finance scenarios in isolated infrastructure. Production smoke is recorded separately below. The documentation PR's own CI must be checked against its actual head when reviewing it.

## D. Production deployment identities

The connected Render deployment records were independently rechecked during document preparation and matched the P6-06 evidence pair.

| Component | Live commit | Deployment record |
| --- | --- | --- |
| Frontend `srv-d81h233bc2fs7390gvpg` | `efd6cda24f37843ee26d13b7439fe3d8e588f012` | [Live frontend deployment](https://dashboard.render.com/static/srv-d81h233bc2fs7390gvpg/deploys/dep-dbu8ih7b9u1s73a6v9t0) |
| Backend `srv-d81h5a8sfn5c73a7g2p0` | `4c59c67a2f012933973f926a9bdeb1bde698e42b` | [Live backend deployment](https://dashboard.render.com/web/srv-d81h5a8sfn5c73a7g2p0/deploys/dep-dbtprf3bc2fs73fdp800) |

The [comparison between those commits](https://github.com/onurdpl/1vendor-dashboard/compare/4c59c67a2f012933973f926a9bdeb1bde698e42b...efd6cda24f37843ee26d13b7439fe3d8e588f012) contains only `.github/ci/Dockerfile`, `.github/ci/pgdg-ACCC4CF8.asc`, `.github/workflows/ci.yml` and `docs/PACKAGE_5_CLOSURE.md`. Application, API and Prisma sources are identical across the pair. `SOURCE_COMPATIBILITY_VERIFIED` applies. The authenticated runtime evidence is limited to the exercised P6-06 flows. No recovered release rule requires identical deployment SHAs.

## E. Production database verification

`SPORGYM_P6_04_PRODUCTION_EVIDENCE_RESULT` records read-only production metadata verification of [vendor-dashboard-db](https://dashboard.render.com/d/dpg-d81holv7f7vs73dkrjsg-a), a PostgreSQL 18 service. The backend's startup datasource log identified the same Render database instance and database name returned by the metadata query, establishing the backend binding. No credentials or private connection details are reproduced here.

| Metadata comparison with the deployed backend | Result |
| --- | --- |
| Expected migration inventory | 134 |
| Applied, completed migrations | 134 |
| Missing expected names | 0 |
| Unexpected migration names | 0 |
| Unresolved failed or unfinished records | 0 |
| Rolled-back records | 0 |
| Migration checksum mismatches | 0 |
| Latest migration | `20261115120000_add_payout_preparation_failure_resolution` |

The complete name and checksum set matched the [deployed backend migration inventory](https://github.com/onurdpl/1vendor-dashboard/tree/4c59c67a2f012933973f926a9bdeb1bde698e42b/backend/prisma/migrations). P6-04's final metadata summary was checked at 20:29:58 CET on 2026-11-17. The latest migration completed at 09:03:52 CET on 2026-11-15. The backend deployment logs additionally recorded 134 migrations found and no pending migrations to apply.

The metadata connection reported `transaction_read_only = on`. Only migration and connection metadata were queried. The final summary used a transaction-local five-second statement timeout. The initial 400-row inventory query used the connection's default timeout of zero. Migration application and recorded checksums are verified. An independent physical schema drift comparison was not performed. See the [production migration runbook](RENDER_PRODUCTION_MIGRATIONS.md).

## F. Authenticated production Admin/Vendor smoke

The supplied `SPORGYM_P6_06_INDEPENDENT_BROWSER_SMOKE_RESULT`, including its Vendor-role continuation, records production browser execution on 2026-11-17. Admin checks ran approximately 21:46–21:53 CET and Vendor checks approximately 21:54–21:56 CET against the deployment pair in section D. Chromium 148.0.7778.96 was controlled through installed Playwright 1.60.0. The owner entered authorized credentials directly into visible Chromium windows. Admin and Vendor used separate browser contexts. No session export or sensitive trace was retained.

| Scenario | Observed production result | Evidence boundary |
| --- | --- | --- |
| Admin authentication | PASS. Authenticated `/auth/me` returned HTTP 200 and role `admin`. | Existing authorized Admin account. |
| Admin Vendor A → B → A | PASS. Both existing Vendors were selectable, scoped Dashboard responses identified the selected Vendor, and A was restored. | Two existing Vendor contexts, anonymized as A/B. |
| Previous-Vendor clearing | PASS for observed transitions. Previous Dashboard heading disappeared before the new heading appeared. Settings switching also removed A's heading and displayed B's. | Deterministic delayed responses and rapid switching were not reproduced. |
| Vendor authentication and membership | PASS. `/auth/me` returned HTTP 200, role `vendor`, one membership, A included and B excluded. | Separate context with no copied Admin session. |
| Orders | PASS. A returned 77 records, all A-owned. B returned 96 records, all B-owned. The Vendor-role A list also returned 77 A-owned records and rendered. | Returned list results only. |
| Returns | PASS. A returned 24 records and B 31, each with the expected ownership. Vendor-role A returned 24 A-owned records and rendered 24 detail links. | Details were not opened. |
| Finance Overview | PASS. Admin A/B views rendered and matching financial profiles were returned. The Vendor-role A view rendered with its matching profile. | No Finance mutation or independent arithmetic audit. |
| Finance Transactions | PASS. Admin A/B/A responses had matching Vendor envelopes. Vendor-role A returned 82 transactions with matching scope and ownership. | Exercised read path and visible Transactions tab. |
| Shipping configuration | PASS. Admin A/B configuration responses and Vendor-role A configuration returned HTTP 200 with matching Vendor ownership. | Read-only configuration. |
| Shipment/tracking visibility | PASS within the Admin Orders list. B's response contained shipping state for 96 records and tracking evidence for 36. | Dedicated shipment details and carrier operations were not exercised. |
| Settings | PASS for rendering and authorized reads. Admin A/B Billing responses identified their corresponding Vendor. Vendor-role Billing self-view returned HTTP 200. | The Vendor Billing self-view DTO omits Vendor identity, so independent response-level ownership verification is unavailable for that response. |
| Support list | PASS. A returned five tickets and B eight, all with the expected ownership. Vendor-role A returned five A-owned tickets and rendered five links. | Ticket details were not opened because they can modify unread state. |
| Vendor access to Admin Directory | PASS for denial. `GET /admin/vendors` returned 403. | One tested Admin read boundary. |
| Vendor access to Admin Global Support | PASS for denial. `GET /admin/support/tickets/page` returned 403. | One tested Admin read boundary. |
| Vendor access to foreign Orders | PASS for denial. An Orders request explicitly targeting B returned 403 from the A-only Vendor session. | One tested cross-Vendor negative read. |
| Vendor UI role separation | PASS for inspected controls. The Vendor session displayed no Admin-view selector. | Inspected UI and the two server-side Admin denials above. |

## G. Vendor isolation and evidence provenance

P6-06 compared selected/requested scope with returned Vendor ownership metadata and membership evidence. No foreign owner was observed in the scoped responses inspected. These assertions support the exercised Admin and Vendor reads and the specific negative requests above.

The evidence sources have different retention boundaries.

| Source | Retrieval and retention boundary |
| --- | --- |
| GitHub baseline, merged PRs and CI | Independently retrievable PR, commit and job links are included in this document. CI logs were rechecked for the evidence baseline. |
| Render deployment identity | Independently retrievable authorized deployment records were rechecked during preparation. |
| P6-04 database metadata | Raw read-only tool results and the migration comparison were available in the originating Codex conversation. This document summarizes them. No standalone metadata export is committed. The Render deployment log corroborates the pre-deploy migration result. |
| P6-06 live browser | Supplied originating Codex report and sanitized execution outputs support the matrix. No standalone screenshot, trace, authenticated body dump or session artifact is committed. The browser smoke was not rerun to prepare this documentation. |
| P6-01 through P6-05 | Supplied audit reports explain scope recovery and access progression. P6-01 reported insufficient evidence, P6-02 no verified blocker with gaps, and P6-03/P6-04 partial verification. Earlier P6-05 attempts were blocked by the built-in browser connection; the subsequent investigation established independent Chromium availability. |

The absence of standalone browser artifacts remains a retention limitation. CI, historical isolated tests and production browser observations each retain their own scope.

## H. Known test limitations

- No actual rollback exercise was performed.
- Authorization was not tested exhaustively across every route, role, parameter or record.
- Signals/Automation and some detail pages were excluded from the live smoke. Earlier accepted Package 3 production verification limits remain visible.
- Physical schema drift was not independently compared with the declared schema. Migration names, completion states and checksums were verified.
- Deterministic delayed-response and rapid-switch scenarios were not reproduced in the current production smoke. Earlier isolated tests remain historical evidence within their documented coverage.
- Production business mutations were deliberately excluded. Save, reply, fulfillment, refund, settlement, payout and external provider operations have no new production PASS from this smoke.
- Vendor Billing self-view ownership cannot be independently asserted from its response identity because that DTO omits Vendor identity.
- Production large-history performance retains the limitations documented in the Package 4 record.

## I. Package 5 carried-forward findings

The [Package 5 closure record](PACKAGE_5_CLOSURE.md#documented-deferrals-and-open-evidence) remains authoritative for its own decisions. The following statuses are preserved.

- **P5-07A — Support.** Atomic replies and concurrent status protection are `COMPLETED_AND_VERIFIED`. A client retry after an ambiguous network response can create a duplicate public reply. An idempotency policy remains unapproved.
- **P5-07B — Billing / Shipping.** `DEFERRED_BY_USER`. Configuration writes and their audit records still use separate transaction boundaries. An audit write can fail after the configuration changes, and concurrent edits can produce inaccurate old/new audit value sequences. The confirmed defect remains open.
- **P5-07C — Returns.** `INSUFFICIENT_EVIDENCE`. The audit did not establish a reachable cross-Vendor ownership race through supported operations. Reviewed economic transfer paths reject transfers when Return evidence is present. Other possible races remain unverified.
- **P5-07D — Login.** Expiration cleanup and same-process admission are `COMPLETED_AND_VERIFIED`. Production proxy/IP trust and multi-instance behavior are **UNKNOWN**. The authentication-service exception counting policy remains unapproved. A global cap on active keys has not been established. P6-04 observed one configured backend instance at that time; this observation leaves the stated topology and policy limits intact.
- **P5-07E — Admin incidents.** The legacy payout failure lifecycle is `COMPLETED_AND_VERIFIED`. Historical Admin session incident closure is `INSUFFICIENT_EVIDENCE`. P4-08D documented natural token expiration. Explicit revocation, absence of historical misuse, and the incident owner's formal closure remain unverified.

The user's earlier Package 5 deferral approval applies to Package 5. Package 6 release-risk acceptance is the separate review decision for this PR. The production read smoke provides no evidence that these findings are fixed. No recovered Package 6 criterion makes every deferred or unknown finding a mandatory release blocker.

## J. Rollback readiness and limitations

The frontend candidate `a648062293b058655699204056bda5be0395e681` has a [previous successful deployment](https://dashboard.render.com/static/srv-d81h233bc2fs7390gvpg/deploys/dep-dbu599942hec73e44n70). Its application source matches the current frontend; intervening changes affect CI only. Artifact configuration and rollback execution remain unverified.

The backend candidate `d83ec4ee204fe0e0e13f073daaa82b0f45d0f5f0` has a [previous successful deployment](https://dashboard.render.com/web/srv-d81h5a8sfn5c73a7g2p0/deploys/dep-dbspere8bjmc73eq3drg). It has the same repository schema and migration inventory as the live backend, now matched to production migration metadata. No intervening checked-in migration barrier was identified. Rolling back to it would restore the login limiter expiration and concurrent-admission defects fixed by [PR #65](https://github.com/onurdpl/1vendor-dashboard/pull/65). Operational compatibility, configuration and actual rollback behavior remain unverified.

Follow the existing [rollback guidance](DEPLOYMENT_CHECKLIST.md#rollback-guidance), including backend compatibility review against the current schema. No approved mandatory rollback-drill requirement was recovered. This record documents candidates and risks without executing or approving a rollback.

## K. Explicit release exclusions

This closure scope is the six-package Vendor architecture program. Future SPORGYM initiatives retain their separate approval and release decisions. Automatic Payout DRAFT preparation remains a separate future objective. Manual EFT, Mark Paid, PAID terminality, approved settlement authority, refund authority and payout calculations retain their existing contracts. No Shopify, carrier, Finance, Return or Support mutation is authorized by this record. [Package 5 Finance boundaries](PACKAGE_5_CLOSURE.md#finance-safety-and-exclusions) · [Finance architecture](product/ADMIN_FINANCE_ARCHITECTURE.md)

## L. Confirmed blockers

P6-01 through P6-06 identified no verified mandatory release blocker within the reviewed Vendor architecture scope. Document preparation found no new evidence invalidating the recorded baseline or deployment pair. The open confirmed Billing/Shipping audit defect and the other limitations remain recorded in sections H–J. Unexecuted checks retain their unverified status.

## M. Closure decision and approval boundary

The proposed decision is **`PACKAGE_6_CLOSED_WITH_DOCUMENTED_LIMITATIONS_AND_DEFERRALS`** for the bounded Vendor architecture scope and evidence baseline above. Review must address the evidence-retention limits, known rollback regression risk and Package 5 findings as a Package 6 release decision. Formal repository-recorded closure requires review and merge of this document. Until then, the closure record remains proposed.

On approved merge, this record closes the six-package Vendor architecture program within the documented scope. Unresolved findings, historical incident questions, unverified workflows and future objectives retain their stated status. Further fixes, production writes, deployments and expanded verification require their applicable separate authorization.
