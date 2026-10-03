# FIN-BUG-003 — Observed Delivery Authority Specification

Status: design record with Phase 3 local implementation notes below. This document does not authorize production deployment or the Phase 4 finance cutover. Original evidence baseline: `main` at `eb1f3f6efc38021aeaefb783b4bff5cf60f1c326`. [FIN-BUG-003](FINANCIAL_BUGS.md) remains **OPEN**. The register is the status authority.

**Approved source-selection foundation, later than this document's evidence baseline:** each vendor has one current outbound method (KARGONOMI or VENDOR_INTEGRATION), with one stable provider identity when Vendor Integration is selected; outbound and return configuration are separate. The vendor-level Phase 1 design is [specified separately](FIN_BUG_003_VENDOR_OUTBOUND_CONFIG_SPEC.md) and production-verified at `cc4e3d848d831d17fecdc6f06a36c955b772c38d` per supplied deployment evidence. Phase 2 now snapshots that selection on new allocation creation in the repository. This does not resolve delivery evidence conflicts, partial/multiple shipments, provider actual-time precedence, legacy finance cutover, or authorize a finance reader change.

## 1. Problem

The SALE settlement-delay clock can move after an allocation is delivered. A later shipment refresh may push `Fulfillment.shipmentUpdatedAt` forward and make a previously mature SALE appear immature. This affects future settlement membership and payout-readiness presentation. It does not authorize changing historical APPROVED settlements, PAID payouts, SALE amount/rate snapshots, or the separate FIN-BUG-001 rule.

## 2. Proven behavior at this specification's original evidence baseline

- `settlement-delay-eligibility.service.ts` requires allocation `shippingStatus` containing `delivered`, then uses `fulfillment.shipmentUpdatedAt` as `deliveryDate`. It adds the SALE's frozen `settlementDelayDaysSnapshot` in 24-hour days and includes at the exact cutoff (`eligibleAt <= now`). Missing delivery date fails closed. `fulfilledAt` is not the evaluator's clock.
- `fulfillment-ingestion.service.ts` can set delivered status from a matching Shopify fulfillment event or canonical fulfillment-event status. It rewrites `shipmentUpdatedAt` from the latest event `happenedAt`, fulfillment `updatedAt`, and fulfillment `createdAt`; cancellation writes the current time. `reconciliation.service.ts` can rewrite the same field during canonical repair, including a current-time fallback.
- `fulfillments/fulfillment.service.ts` writes `shipmentUpdatedAt` on outbound fulfillment submission; `shipping/shipping-execution.service.ts` writes it on provider shipment creation and refresh. These are shipment/update times, not dedicated first-delivered observations. The schema has one mutable `Fulfillment` per allocation and no frozen delivery observation.
- `VendorAllocation.shippingStatus` is a shared projection written by Shopify fulfillment ingestion/reconciliation, Kargonomi shipment execution, and Vendor Integration shipment writeback. At this document's original baseline there was no explicit per-allocation outbound source selector; Phase 2 now persists a creation-time selector for new allocations, but a projected `delivered` string alone still does not identify which source established it.
- Audit F reported 43 of 58 fulfilled rows with `shipmentUpdatedAt` later than `fulfilledAt`; 32 shifted fulfilled SALE pairs had a positive frozen delay. These retained fields did not reconstruct exact historical monetary impact. This is production exposure, not proof of a specific prematurely or belatedly settled row.

## 3. Approved business decision

If the **approved outbound shipment evidence** verifies DELIVERED but does not provide a trustworthy actual customer-delivery timestamp, Sporgym may start the delay clock at the time Sporgym **first verified** that DELIVERED state. This is an observation time, not an asserted customer delivery time. Replays, polls, tracking edits, or unrelated shipment metadata must not replace it. No earlier time may be reconstructed by guess from `order_date`, `shippedAt`, `fulfilledAt`, or `shipmentUpdatedAt`.

The supplied external Sopyo observation found status `2` while shipped and status `6` after the panel was marked delivered, with `cargo_info` retained. Sopyo support reportedly said its API exposes status but no delivery time. This documents the approved status-only fallback use case; it does **not** establish a Sopyo adapter, a new generic API contract, or source authority for finance.

## 4. Meaning of first observed DELIVERED

The clock is the database-recorded time of the **first successful, source-validated local verification**, not a provider event's unspecified timestamp, the request's client-supplied time, a later polling time, or the first time a mutable projection happened to say `delivered`. A verification must identify the allocation and the evidence source and prove that the source was permitted to speak for that allocation. The chosen source-authorization policy is unresolved (§8); until then a new observation must not be treated as canonical finance authority.

For the first authorized DELIVERED observation, insert the authority once. A repeated identical event, later DELIVERED poll, duplicate worker, carrier/tracking edit, or unrelated metadata update returns/retains the first authority without changing its observation time. A conflicting source or changed source identity is not silently merged; it requires an explicit conflict/reconciliation path. A later non-delivered state does not erase historical evidence, but whether it suspends future eligibility requires the source/lifecycle policy in §8.

| Input after source validation | Durable observation result | Finance implication |
| --- | --- | --- |
| First verified DELIVERED | Insert one first-observed authority with server time and provenance. | May be used only after source and legacy gates are approved. |
| Same event replay or duplicate idempotency retry | Return the same authority; no update to observed time. | No new cutoff. |
| Later poll still DELIVERED | Retain the first observation; optionally retain separate operational poll evidence. | No cutoff movement. |
| Tracking/carrier edit or unrelated new shipment metadata | Do not update the observation. | No cutoff movement. |
| Competing delivered source/reference | Surface a conflict; do not overwrite or silently select the later/earlier source. | Fail closed pending the source-authority decision. |

## 5. Smallest durable evidence authority

**Recommendation:** one new, allocation-scoped, insert-once delivery-observation record, rather than a mutable timestamp on `Fulfillment` or `VendorAllocation`. It must preserve allocation ID, normalized DELIVERED state, first-verified observed time set by the server/database, source kind/provider, stable source reference/event identity when supplied, local recorded time, and whether a proven actual provider-delivery timestamp was supplied (with its value when available). The record must distinguish `OBSERVED_DELIVERED` from any future `PROVIDER_ACTUAL_DELIVERED` basis; recording an actual timestamp does not yet select it as the finance clock. No raw provider payload, customer PII, tracking-management fields, or monetary fields belong in this authority.

An allocation-unique authority is the smallest safe v1 shape **only after** the authorized outbound source and single-allocation-delivery scope are resolved. An additive observation/source event can preserve later contradictions without overwriting the first authority; it must not become a second simultaneous finance clock. Multiple shipments, partial quantities, reassignment, and source replacement are not specified by this record and must fail closed for finance if they make allocation-wide delivery ambiguous.

**Tradeoff:** adding fields to mutable `Fulfillment` minimizes tables but its present upsert/update writers can overwrite them and its row does not identify which coexisting source authorized delivery. A separate immutable row makes uniqueness, provenance, replay and historical non-rewrite reviewable. A full generic shipment-event framework would be broader than FIN-BUG-003. Exact column names, keys and migration SQL are engineering decisions for the implementation package, subject to the unresolved product boundaries below.

## 6. Concurrent first-observation invariant

Use a database-enforced unique claim for one canonical first observation per allocation (or its approved shipment scope), not an application-only `findFirst` check. Validate the authorized source and observed DELIVERED state, then attempt insert in one transaction. Generate the observation time server-side at the verification/insert point, not from a client clock or an earlier transaction-start timestamp. On a unique collision, re-read the committed record: an exact replay may return it; mismatched source/evidence is a conflict, not permission to change its timestamp. Serialize with the existing allocation/order locking convention where source projection and observation are committed together. A rollback leaves neither a new projection nor a canonical observation. No `upsert` update arm may rewrite the first time. Real PostgreSQL concurrent-worker proof is required before finance cutover.

## 7. Provider-neutral integration boundary

| Current path | Can it establish DELIVERED state today? | Boundary |
| --- | --- | --- |
| Shopify fulfillment event/canonical reconciliation | **Yes, conditionally:** code maps a matched fulfillment's delivered event/status to allocation `shippingStatus=delivered`; the event must be scoped to the allocation's line/fulfillment. | Does not prove a stable actual customer-delivery time. Source selection against other outbound paths is unresolved. |
| Kargonomi outbound `ShipmentExecution` | **Yes, conditionally:** the adapter maps `webservice_shipment_delivered` to `DELIVERED`, and execution refresh projects `delivered`. | No dedicated proven immutable actual-delivery timestamp in the inspected execution model. Provider API event-time semantics remain NOT PROVEN. Customer-return shipping is out of scope and unchanged. |
| Generic Vendor Integration shipment writeback | **No:** the current authenticated `shipment:write` POST accepts carrier/tracking/optional `shippedAt`, persists a shipment event, and sets `shippingStatus='In Transit'`. | It has no generic DELIVERED writeback or `deliveredAt` contract. A provider-specific adapter would map provider status outside finance; provider-neutral intake would validate and persist delivery observation; finance would consume only approved normalized authority. |
| Sopyo | **External status-only evidence supplied; no local adapter is established by this spec.** | Do not place Sopyo status codes in finance or infer actual delivery time. |

**Minimum API change recommendation:** a dedicated provider-neutral DELIVERED-observation writeback is safer than extending the existing shipment/tracking POST. The current POST requires carrier and tracking and replaces the allocation's shipping projection with `In Transit`; a later delivery-only message should not have to resubmit or rewrite those fields. Reuse existing client/vendor isolation, shipment-write authorization and bounded idempotency conventions, but require allocation correlation, explicit DELIVERED state, server-observed time, and source reference where available. Exact route and payload remain implementation details. Persisting an observation is **not** permission to make it the finance-selected source when another outbound source is present. If future providers supply actual `deliveredAt`, retain it as evidence; its finance precedence is unresolved.

## 8. Source-authority unresolved points

The vendor-current outbound method/provider and creation-time allocation snapshot are approved as the intended source-selection foundation; see the separate Phase 1 specification above. Phase 1 is production-verified per supplied evidence; Phase 2 adds nullable `VendorAllocation.outboundMethodSnapshot` and `outboundIntegrationProviderSnapshot` on the three live creation paths. Existing allocations are not backfilled. Before any source writes **canonical** delivery authority or finance consumes it, Product/operations must still decide how conflicting Vendor Integration, Kargonomi, and Shopify/manual evidence is handled, including later cancellation/return-to-sender, vendor reassignment, and multiple shipments/partial quantities. Shared projections can currently be overwritten. Neither “first DELIVERED wins” nor “latest source wins” is approved. Unknown or conflicting lineage fails closed rather than selecting a provider by code path or arrival order.

For a provider with a trustworthy **actual** deliveredAt, Product must decide whether finance uses that actual time or Sporgym's observed time, and how a later correction to the provider time affects already prepared/approved finance. The approved observed fallback applies only when the source lacks a trustworthy actual time. Do not silently replace an immutable observed authority with a later provider time.

## 9. Legacy/missing-evidence boundary

Existing delivered allocations may have only `shippingStatus` and mutable `shipmentUpdatedAt`; neither proves the first verified observation. No historical observed time is backfilled or inferred from `fulfilledAt`, `shippedAt`, `order_date`, `createdAt`, or current receipt time. Choose an explicit rollout policy before finance cutover: (a) fail closed for no-evidence SALEs and send them to supervised review, or (b) a separately approved compatibility boundary for pre-cutover records with stated evidence and risk. Existing APPROVED/PAID authority must not be rewritten. The policy must distinguish old DRAFT revalidation from new SALEs and preserve immutable history. Until approved, new app + old evidence is not safe to promote automatically.

## 10. Connected-path migration map

Change the **one shared** `resolveSettlementDeliveryDate` / `evaluateSaleSettlementDelay` clock authority, not parallel formulas. Every finance query shape supplying that evaluator must load the new evidence, and all SALE uses must move in the same guarded cutover:

| Finance use | Current path | Required parity |
| --- | --- | --- |
| Manual preview/explanation and DRAFT | `settlement-approval.service.ts`: `buildApprovalPreview`, `rowIsEligible`, `buildSettlementEligibilityExplanation`, `createDraftApproval` | Same source/evidence and frozen SALE delay at the same `asOfDate`. |
| Scheduled preview/DRAFT | `settlement-schedule.service.ts` calls the same preview/DRAFT with UTC period-end `asOfDate` | No independent timestamp fallback or READY shortcut. |
| Approval/revalidation | `settlement-approval.service.ts`: `validateSettlementApprovalBeforeApprove`, current SALE delay check | Re-read approved authority; reject missing/conflicting/stale evidence without rewriting DRAFT/APPROVED history. |
| Finance projection and `payoutReady` | `finance.service.ts`: `getSettlementStatus`, `buildSettlement`, `isEntryEligibleForPayoutBatch`, ledger selection queries | Eligible date, status and `payoutReady` derive from the same clock. Existing APPROVED-settlement/payout source protections remain. |
| Refund-aware SALE | `settlement-approval.service.ts` and `finance.service.ts` after FIN-BUG-001 | Evaluate the same SALE delay **before** deriving `partially_refunded`; independent REFUND ledger authority remains unchanged. |
| Initial or transferred SALE ledger snapshots | `sale-ledger.service.ts`, `economic-transfer.service.ts` | Stop materializing new eligible-at values from mutable shipment time; retain frozen rate/delay economics and do not recompute old authoritative rows by assumption. |

`allocation-finance-summary.service.ts` supplies finance projections and must load the new relation if its downstream builder needs it. `finance.service.ts` has several ledger selection/query shapes; all must be inspected, not only the Admin summary read. A repository-wide check must show no remaining **SALE settlement or payout eligibility** reader of `shipmentUpdatedAt` after cutover. Nonfinancial order detail, vendor-integration order reads, fulfillment diagnostics, carrier/tracking UI, and reconciliation may continue showing/using `shipmentUpdatedAt` as a shipment-update timestamp; changing those operational uses is out of scope. `customer-checkout-shipping-refund.service.ts` separately treats its presence as concrete shipment evidence for a pre-shipment customer-refund decision; that monetary path is intentionally isolated from this SALE settlement-clock change and is **not** silently migrated. A later scoped audit may assess that separate use.

## 11. Test plan

**Mock/service tests:** first verified DELIVERED creates one observation; exact replay, later still-delivered poll, later tracking/carrier edit, and unrelated metadata refresh preserve its timestamp; an unapproved/mismatched source does not create finance authority; status-only source uses server observed time, not `shippedAt`; a supplied actual deliveredAt is retained but not consumed before its precedence decision. Test missing/conflicting evidence as non-eligible according to the approved rollout policy. Pair before/exact/after cutoff, refund-aware SALE, current-profile-versus-frozen-delay, and manual/scheduled/approval/projection parity for the same evidence.

**Real PostgreSQL tests:** canonical fresh isolated DB; insert-once uniqueness and source reference; simultaneous first observations from two workers; replay/idempotency and conflicting-source loser; transaction rollback; repeated delivered refresh leaves cutoff fixed; full persisted preview → DRAFT → approval (including stale evidence) and payout-readiness projection; no historical APPROVED/PAID mutation. Test that no competing provider projection bypasses selected authority. Do not test against production.

**Production read-only verification:** before cutover, inventory delivered allocations by current outbound evidence and source conflicts, count missing new evidence and historical DRAFT/APPROVED/PAID dependencies without customer PII; compare current versus proposed eligibility in read-only shadow and explain differences. After separately approved deployment, verify schema/version, naturally occurring status-only observations retain a fixed first time across later polls, and preview/approval explanations agree without creating a real settlement as a synthetic test. Production mutation requires separate authorization.

## 12. Incremental implementation plan

1. **Authority boundary gate:** implement the approved vendor outbound selection and allocation snapshot in their separate phases; approve conflicting-source handling and legacy/no-evidence policy before finance cutover. Resolve actual-time precedence separately if that source type will be enabled. No finance activation before these gates.
2. **Durable evidence foundation:** additive table/constraint and server-side insert-once service; no backfill, no finance reader switch. Review database-concurrent behavior in isolation.
3. **Provider-neutral intake:** add a bounded DELIVERED path for authorized Vendor Integration clients and adapters; wire only sources whose delivered-state mapping and allocation lineage are proven. Preserve Kargonomi and Shopify operations; no Sopyo-specific finance branch.
4. **Shared finance cutover:** migrate the common evaluator and all projections/query shapes together behind a controlled gate; preserve SALE delay snapshot and existing refund/correction arithmetic. Missing/conflicting evidence follows the separately approved legacy policy.
5. **Parity/integration validation:** mock and real-PostgreSQL tests for replay, concurrency, cutoff, refund-aware SALE, manual/scheduled/DRAFT/approval/payout-readiness parity; inspect all remaining shipment-time readers.
6. **Read-only rollout check:** inventory affected production rows and compare shadow decisions before any activation. Approve deployment/rollback separately; do not synthesize delivery evidence in production.

## 13. Explicit non-goals

No implementation, Shopify/Sopyo/Kargonomi request, return-shipping change, external EFT, payout rule, new finance formula, historical timestamp guess/backfill, approved/paid history rewrite, provider-priority inference, automatic partial-shipment allocation, UI redesign, or FIN-BUG-003 closure. Kargonomi remains a supported outbound/return-shipping integration.

## 14. Remaining product/external questions

1. Given the approved creation-time allocation outbound-source snapshot, how are coexisting/conflicting Shopify, Kargonomi, and Vendor Integration delivery states reconciled without overriding that snapshot?
2. Does one allocation-wide delivered observation suffice where multiple shipments, partial quantities, reassignment or replacement shipment occurs? If not, what shipment/quantity scope is required?
3. For a source with proven actual deliveredAt, which time starts the clock, and how are later corrections handled without silently changing frozen financial history?
4. What is the exact fail-closed or controlled-compatibility rule for pre-cutover delivered rows without first-observation evidence, including existing DRAFTs?
5. Which provider/API evidence proves actual delivery time, if any? For Shopify specifically, only if its event timestamp is proposed as **actual** authority: ask Shopify AI/official docs whether a line/fulfillment-scoped delivered event's `happenedAt` and identity are immutable or can be edited, removed, supplemented, or reordered on later canonical reads. This question is unnecessary for the approved status-only first-observation fallback.

## Phase 3 implemented evidence boundary (local code; not production-verified)

`AllocationDeliveredObservation` is a separate, allocation-unique record. It stores `firstObservedDeliveredAt`, the frozen outbound method/provider provenance, a bounded provider source reference, and either the Kargonomi `ShipmentExecution` or the explicitly coded Vendor Integration client that supplied the normalized evidence. Database constraints and an insert guard check the allocation snapshot and source linkage; an UPDATE/DELETE trigger preserves the first record. The database generates the first timestamp at insert with a UTC clock. It is Sporgym's **first verified observation**, not a claim about actual customer-delivery time.

The internal `recordVerifiedDeliveredObservation` service validates the frozen allocation snapshot and the source record, attempts an allocation-unique insert, and re-reads the winner. Exact source replay retains its first timestamp and provenance, including after integration-token rotation; a competing reference/source fails closed. A missing NULL/NULL historical snapshot is not inferred from current vendor settings. No history is backfilled.

The existing Kargonomi provider-data refresh is connected only when its response has the exact `webservice_shipment_delivered` status, the persisted execution is KARGONOMI/DELIVERED with the same provider shipment ID, and the allocation snapshot is KARGONOMI. A matching delivered result returned during shipment creation uses the same gate. Kargonomi return-shipment flows are not connected. Other local `delivered` projections alone do not insert authority. The Kargonomi response status is a status-only observation; no actual provider delivery timestamp is asserted.

Sopyo `order_status=6` remains an established external fact but there is no repository Sopyo polling/adapter or sufficiently precise generic Vendor Integration DELIVERED endpoint. The internal service can validate an active, same-vendor, explicitly `SOPYO`-coded client; this is a **future adapter boundary**, not live Sopyo authoritative ingestion. Legacy `providerCode=NULL` clients and free-text `providerName` cannot establish that authority. Shopify fulfillment/reconciliation, ordinary Vendor Integration status/shipment writeback, and manual tracking paths do not call the recording service.

Finance still uses its existing `Fulfillment.shipmentUpdatedAt` evaluator. No settlement, payout, refund, or Financial Correction reader consumes the new record. Phase 4 still needs source-conflict/partial-shipment and legacy no-evidence decisions, an actual Sopyo adapter if used, and a shared finance cutover with cross-stage parity proof.
