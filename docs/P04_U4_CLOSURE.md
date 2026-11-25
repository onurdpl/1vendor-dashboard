# P04-U4 — Order Detail Activity closure record

**Record date:** 2026-11-25

**Proposed classification:** `P04_U4_CLOSED_WITH_DOCUMENTED_LIMITATIONS_AND_DEFERRALS`

**Record state:** Documentation-only Draft PR preparation. This classification does **not** take effect on `main` until the closure PR is reviewed and merged. It does not close all of P04 or authorize panel removal, deployment, or a new workflow.

## Purpose, approved decision, and baseline

P04-U4 stabilized the existing Order Detail Activity presentation: canonical operational state, persisted history identity, audience filtering, and timestamp provenance. U3 refund timestamp work is included as a prerequisite. The owner explicitly approved formal U4 closure without further code changes, accepted the `Shipment created` timestamp-provenance limitation, and accepted the U4-F5 audit's no-change recommendation. The owner did not approve a timestamp migration, UI copy change, Shopify/provider implementation, or production operation.

The verified `origin/main` baseline is `3594858e60e206327bd87b9edf9a6bcf6d47d91e`, the merge commit of PR #90. [Post-merge CI](https://github.com/onurdpl/1vendor-dashboard/actions/runs/45606505026) on that commit passed both `build-and-test` and `postgres-18-finance`. Each PR-head CI linked below also passed those two jobs. Earlier local test counts are historical validation records in [UI_REDESIGN_PROGRESS.md](UI_REDESIGN_PROGRESS.md), not tests rerun for this closure document.

## Completed work and GitHub evidence

| Work | Verified merged PR | Merge commit | Result and boundary |
| --- | --- | --- | --- |
| U3 | [#81](https://github.com/onurdpl/1vendor-dashboard/pull/81) · [CI](https://github.com/onurdpl/1vendor-dashboard/actions/runs/45366946996) | `11028a494705d8d309cc3de53e86f03db7c1de1c` | Refund-terminal canonical events retain `—` without event-specific time; separate Finance records retain their dates. |
| U4-A1 | [#82](https://github.com/onurdpl/1vendor-dashboard/pull/82) · [CI](https://github.com/onurdpl/1vendor-dashboard/actions/runs/45375568246) | `01f4664f4961c2044a5991064acb40ef624030c6` | Hidden Admin-only native history cannot suppress Vendor-visible refund-terminal Activity. |
| U4-B1 | [#83](https://github.com/onurdpl/1vendor-dashboard/pull/83) · [CI](https://github.com/onurdpl/1vendor-dashboard/actions/runs/45381457103) | `9bf1e95f5a51a560fc4ad7789a77ce3e48e9a19d` | Distinct linked Return IDs retain separate Activity rows and detail links. |
| U4-D1 | [#84](https://github.com/onurdpl/1vendor-dashboard/pull/84) · [CI](https://github.com/onurdpl/1vendor-dashboard/actions/runs/45405352240) | `41ace90cd9773e3721be2fd9d37f5927ab6017c4` | Canonical cancellation evidence is protected from the literal native cancellation label. |
| U4-C1 | [#85](https://github.com/onurdpl/1vendor-dashboard/pull/85) · [CI](https://github.com/onurdpl/1vendor-dashboard/actions/runs/45415155016) | `1da22c8a165c327d902aa0581bf51b18fc78657e` | Persisted assignment-history IDs reach Activity; distinct Tracking and Shipment records remain distinct. |
| U4-E1 | [#86](https://github.com/onurdpl/1vendor-dashboard/pull/86) · [CI](https://github.com/onurdpl/1vendor-dashboard/actions/runs/45428605737) | `53382b6b73741264dc9f6b16f7caff28668e1e82` | Audience filtering precedes grouping, preventing hidden Admin rows from replacing Vendor-visible rows. |
| U4-F3 | [#87](https://github.com/onurdpl/1vendor-dashboard/pull/87) · [CI](https://github.com/onurdpl/1vendor-dashboard/actions/runs/45451527773) | `901b66697210d59588d9165276c35200d94cd9f2` | Distinct persisted Admin return-to-Vendor history IDs remain separate. |
| U4-F1 | [#88](https://github.com/onurdpl/1vendor-dashboard/pull/88) · [CI](https://github.com/onurdpl/1vendor-dashboard/actions/runs/45493825069) | `b0c646c07a407d2006538d9174a9679d8246f` | Native-only cancellation is presented as history; its record time is not asserted to be Shopify cancellation time. |
| U4-F2 | [#89](https://github.com/onurdpl/1vendor-dashboard/pull/89) · [CI](https://github.com/onurdpl/1vendor-dashboard/actions/runs/45575581904) | `80e451d02a1ce482fa82913449969b113abc970f` | Current Vendor-blocked state stays separate from persisted Admin-only block history; source IDs and timestamps remain qualified. |
| U4-F4 | [#90](https://github.com/onurdpl/1vendor-dashboard/pull/90) · [CI](https://github.com/onurdpl/1vendor-dashboard/actions/runs/45597888503) | `3594858e60e206327bd87b9edf9a6bcf6d47d91e` | First verified delivery observation and unknown derived Tracking time are presented without borrowing unrelated event times. |
| U4-F5 | Audit only; no implementation PR | — | `P04_U4_F5_AUDIT_NO_CHANGE_RECOMMENDED`; conditional historical-title risk remains documented below. |

## Activity integrity and Admin/Vendor boundary

The merged changes retain allocation-scoped Order Detail data and existing backend authorization. Native assignment-history IDs are preserved separately from presentation IDs. The local Activity grouping filters the audience before choosing a representative; verified distinct source IDs are not collapsed merely because titles and UTC days match. The current Vendor-blocked explanation remains visible independently of its Admin-only history row. U4-A1 preserves Vendor refund evidence without revealing hidden native content. U4 did not change Vendor permissions, order rejection or reassignment, Shopify cancellation/refund/fulfillment mutations, shipment execution, Finance settlement clocks, Return ownership, Support authorization, or provider polling/writers. These are verified source and CI boundaries, not claims of exhaustive production behavior.

## Timestamp authority and accepted limitation

- U3: `Refund completed` and `Fulfillment not required` canonical refund-terminal events remain undated (`—`) unless their own event-specific time exists. A Finance ledger creation or Vendor-block time does not establish refund completion time.
- U4-F1: a native cancellation-history timestamp is the persisted history-record time, not automatically Shopify cancellation time. Canonical cancellation remains governed by its separate evidence.
- U4-F2: current blocked state and persisted block history are distinct. The current-state row qualifies any displayed time as latest block-history record time, not an independently measured transition.
- U4-F4: `firstObservedDeliveredAt` means SPORGYM's first verified delivery observation for the allocation, not physical delivery occurrence. Without a valid observation, the date is `—`. Derived Tracking time is also `—` where no verified tracking-event time exists; native history retains its own verified record time.
- **Owner-accepted limitation:** the existing `Shipment created` Activity date has heterogeneous provenance. The Order Detail DTO may derive `shipmentCreatedAt` from Shopify fulfillment creation, local shipment processing, or Vendor integration `shippedAt`. This value does not universally prove physical carrier handover and does not identify one uniform event across sources. The owner accepted the current title, timestamp, mapping, and Activity behavior without a code correction. This limitation is **documented, not fixed**.

## U4-F5 disposition and remaining unknowns

The U4-F5 source audit concluded `P04_U4_F5_AUDIT_NO_CHANGE_RECOMMENDED`. It found no active assignment-history writer for the six secondary canonical titles `Awaiting admin resolution`, `Finance hold activated`, `Vendor rejected allocation`, `Fulfillment not required`, `Existing operational evidence`, or `Refund completed`. The unrestricted historical `AllocationAssignmentHistory.action` string leaves exact-title legacy collisions conditionally possible. Historical production counts are **UNKNOWN**. No production database aggregate query was executed; it is not a prerequisite to this owner-approved closure path. A future verified collision merits its own narrow review, not a claim that a production incident was already established.

Production deployment identity, production execution of the merged Activity behavior, historical F5 action counts, and production availability of first delivery observations are **UNKNOWN**. CI PASS is not production verification. Navlungo and TryOto remain inactive and were not reactivated, modified, or counted as active U4 paths. Full P04 Orders panel removal, other redesign phases, and any new Shopify/provider behavior remain outside this U4 closure.

## Formal closure acceptance checklist and proposed result

- [x] U3 and U4-A1/B1/C1/D1/E1/F1/F2/F3/F4 PRs are merged into the verified main baseline.
- [x] PR-head CI and the PR #90 merge-commit CI passed both required jobs.
- [x] Source and prior tests document Admin/Vendor audience and persisted-identity protections; no confirmed remaining U4 authorization regression was found in the pre-closure audit.
- [x] Timestamp provenance, the owner-accepted `Shipment created` limitation, and F5's no-change rationale are recorded without implying a fix.
- [x] Deferred, conditional, and production-unknown items remain explicit; no production PASS is claimed.
- [x] The owner approved preparing documentation-only formal closure with these limitations.
- [ ] This documentation-only Draft PR is reviewed and merged into `main`.

On the verified baseline and with the stated owner decision, the **proposed** classification is `P04_U4_CLOSED_WITH_DOCUMENTED_LIMITATIONS_AND_DEFERRALS`. It becomes a repository-recorded formal closure only after this documentation PR is merged. No deployment or broader P04 completion follows from that merge.
