# Package 5 — Security and Regression Closure

**Approved closure status:** `PACKAGE_5_CLOSED_WITH_DOCUMENTED_DEFERRALS`

**Evidence date:** 2026-11-17

**Evidence baseline (`main`):** `4c59c67a2f012933973f926a9bdeb1bde698e42b`

**Final audit:** `SPORGYM_P5_FINAL_CLOSURE_AUDIT_RESULT` classified the verified scope as `PACKAGE_5_READY_WITH_DOCUMENTED_DEFERRALS`.

**Approval and record state:** The user explicitly approved formal closure with the open findings below in `SPORGYM_P5_FORMAL_CLOSURE`. This closure record is proposed in a Draft PR. Repository-recorded closure takes effect when the documentation PR is reviewed and merged into `main`.

## Objective and approved boundary

Package 5 covers the verified Security / Regression work after Package 4. The individually approved tasks covered authentication, Vendor/Admin access, critical writes, integration security, and regression coverage. The merged changes below address the approved replay, CI, Finance operational history, Support, and login findings. Package 6 / Final Release is a separate decision. [Package 4 progress and boundaries](P4_PROGRESS_AND_DISCOVERIES.md)

P5-01 through P5-05 were read-only investigations of the security baseline, authentication and sessions, Vendor/Admin authorization, critical writes, and integration security. The available P5-02 report documents source and test evidence for session and CSRF controls and records the historical Admin incident limitation. P5-05A separately authorized the targeted replay correction. Full original results for every early audit and a single approved Package 5 acceptance checklist could not be recovered. Their independent verification is `INSUFFICIENT_EVIDENCE`, as recorded in the final audit.

## Closure evidence

The CI evidence in this table comes from [post-merge CI #1612](https://github.com/onurdpl/1vendor-dashboard/actions/runs/43986790772) on the exact baseline above.

| Work | Verified PR and merge commit | Relevant CI evidence | Classification and remaining boundary |
| --- | --- | --- | --- |
| P5-05A — Vendor Integration replay ownership | [PR #58](https://github.com/onurdpl/1vendor-dashboard/pull/58), `d49e5a21a04d7563ad2654ed6ec2db21834bd084` | PostgreSQL 18 replay suite 3/3. | `COMPLETED_AND_VERIFIED`. Status and invoice replay check current allocation ownership before returning stored results. |
| P5-06A — Mandatory replay regression | [PR #59](https://github.com/onurdpl/1vendor-dashboard/pull/59), `13b7bd0ec38dd7f53e7bc925e4ebbab492976830` | 3 passed, 0 skipped or pending. Disposable database cleanup verified. | `COMPLETED_AND_VERIFIED` for the three required scenarios. |
| P5-06 browser CI — Docker checks | [PR #60](https://github.com/onurdpl/1vendor-dashboard/pull/60), `101daaff6ae88e749306a4afd3da7fad436f6520` | 15 mock browser tests, 6 real browser tests, and 6 database post-checks passed. | `COMPLETED_AND_VERIFIED` in CI test environments. |
| P5-06B — Legacy payout conflict retry | [PR #61](https://github.com/onurdpl/1vendor-dashboard/pull/61), `d90fcd48be8512cafcaba3ba9f0599471593f14d` | Payout preparation 92/92. Approved-settlement deduction and concurrency on disposable PostgreSQL 16, 25/25. | `COMPLETED_AND_VERIFIED`. One additional Serializable attempt after a qualifying rollback. Uncertain commit outcomes remain outside retry. |
| P5-06C-1 — Payout preparation failure history | [PR #62](https://github.com/onurdpl/1vendor-dashboard/pull/62), `3678da3ba7425fa53f6418d0f99dba0b75078bbf` | Combined C1/C2 suite 13/13 on each of PostgreSQL 16 and 18, 0 skipped, with cleanup verified. | `COMPLETED_AND_VERIFIED`. History is scoped to verified legacy retry exhaustion and the original operation's Vendor. |
| P5-06C-2 — Admin failure resolution | [PR #63](https://github.com/onurdpl/1vendor-dashboard/pull/63), `0aebdf866782e09f155b052580413da308e83233` | Same 13-case suite verifies authorization, concurrency, rollback and event immutability on both majors. | `COMPLETED_AND_VERIFIED`. Manual operational follow-up records actor, reason and server time in one transaction with the transition. |
| P5-07A — Support public reply integrity | [PR #64](https://github.com/onurdpl/1vendor-dashboard/pull/64), `d83ec4ee204fe0e0e13f073daaa82b0f45d0f5f0` | PostgreSQL 16 and 18 each 9/9, 0 skipped, with cleanup verified. | `COMPLETED_AND_VERIFIED` for atomic replies and concurrent status protection. Ambiguous-response retry remains open. |
| P5-07D A/B — Login limiter | [PR #65](https://github.com/onurdpl/1vendor-dashboard/pull/65), `4c59c67a2f012933973f926a9bdeb1bde698e42b` | Login route and state suites 54/54, 0 skipped. | `COMPLETED_AND_VERIFIED` for expiration cleanup and same-process admission. Deployment and policy questions remain below. |

Both required jobs, `build-and-test` and `postgres-18-finance`, succeeded. The general run recorded **4,495 tests passed and 724 opt-in tests skipped**. Mandatory PostgreSQL suites executed in separate CI steps. Only tests recorded as executed and passed count toward `GITHUB_CI_VERIFIED` evidence. Earlier disposable database and local Chromium reports are `LOCAL_TEST_VERIFIED` within their recorded scopes. Production deployment and workflow verification for the final main SHA are **UNKNOWN**. [Build and test log](https://github.com/onurdpl/1vendor-dashboard/actions/runs/43986790772/job/133716896904) · [PostgreSQL 18 log](https://github.com/onurdpl/1vendor-dashboard/actions/runs/43986790772/job/133716896422)

## Documented Deferrals and Open Evidence

- **P5-07A — Support.** Atomic replies and concurrent status protection are `COMPLETED_AND_VERIFIED`. A client retry after an ambiguous network response can create a duplicate public reply. An idempotency policy remains unapproved.
- **P5-07B — Billing / Shipping.** `DEFERRED_BY_USER`. Configuration writes and their audit records still use separate transaction boundaries. An audit write can fail after the configuration changes, and concurrent edits can produce inaccurate old/new audit value sequences. The confirmed defect remains open.
- **P5-07C — Returns.** `INSUFFICIENT_EVIDENCE`. The audit did not establish a reachable cross-Vendor ownership race through supported operations. Reviewed economic transfer paths reject transfers when Return evidence is present. Other possible races remain unverified.
- **P5-07D — Login.** Expiration cleanup and same-process admission are `COMPLETED_AND_VERIFIED`. Production proxy/IP trust and multi-instance behavior are **UNKNOWN**. The authentication-service exception counting policy remains unapproved. A global cap on active keys has not been established.
- **P5-07E — Admin incidents.** The legacy payout failure lifecycle is `COMPLETED_AND_VERIFIED`. Historical Admin session incident closure is `INSUFFICIENT_EVIDENCE`. P4-08D documented natural token expiration. Explicit revocation, absence of historical misuse, and the incident owner's formal closure remain unverified. [P4-08D evidence](P4_PROGRESS_AND_DISCOVERIES.md)

## Finance safety and exclusions

The Package 5 Finance diff confines behavior changes to legacy payout preparation retry and its operational evidence. Approved settlement authority, payout amounts, PAID terminality, manual EFT, Admin Mark Paid, refund monetary authority, and Financial Correction authority retain their existing contracts. CI #1612 verified the PAID terminality suite 25/25, R1 payout authority 3/3, and approved-settlement deduction and concurrency 25/25. The payout failure lifecycle tests verify that resolution leaves payout and financial state intact. [Finance settlement model](FINANCE_SETTLEMENT_MODEL.md) · [Manual EFT and Mark Paid](product/ADMIN_FINANCE_ARCHITECTURE.md) · [Payout failure API](API_CONTRACTS.md#legacy-payout-preparation-failure-history-p5-06c-1)

Automatic Payout DRAFT preparation remains a separately agreed future objective outside Package 5. Manual bank EFT and Mark Paid are separate steps from future automatic DRAFT preparation. Package 6 / Final Release requires its own decision. Production release readiness, open security findings, and historical incident disposition retain their separate evidence requirements.

## Closure decision

The final audit identified no proven mandatory closure blocker for the verified technical scope. The user explicitly accepted closure with the documented open findings. The approved conclusion is **`PACKAGE_5_CLOSED_WITH_DOCUMENTED_DEFERRALS`**. The open defects and evidence gaps remain visible and retain their stated status. Review and merge of the documentation PR records this decision on `main`. Further implementation and production release require separate authorization.
