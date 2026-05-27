# Operationally Trustworthy System Model

## Purpose

This document defines the next trust layer for the operational workspace. The product is already moving from a raw operations panel toward a command system: dashboard counts are normalized, operational signals are grouped, finance language is estimate-safe, support history is grouped, and render failures are handled locally.

The next refinement is not a redesign or a new workflow engine. It is a set of rules that keeps the system operationally believable:

- counts mean what their labels say;
- one real issue has one primary actionable representation;
- passive history remains visible but secondary;
- unknown data is shown honestly;
- review states do not imply approval or payout finality;
- vendor and admin users see the right level of evidence;
- malformed data degrades safely without inventing certainty.

This document does not add schema, change routes, implement payout/accounting behavior, change provider or Shopify logic, or hide historical evidence.

## Files Inspected

- `docs/DASHBOARD_SIGNAL_TRUTH_MODEL.md`
- `docs/OPERATIONAL_SIGNAL_DEDUPLICATION_MODEL.md`
- `docs/UNIFIED_OPERATIONAL_WORKSPACE_MODEL.md`
- `docs/ROLE_AWARE_OPERATIONAL_MODEL.md`
- `docs/OPERATIONAL_STABILITY_GUIDELINES.md`
- `docs/FINANCE_SETTLEMENT_MODEL.md`
- `src/lib/api/dashboard.ts`
- `src/lib/api/contracts.ts`
- `src/pages/DashboardPage.tsx`
- `src/pages/OrdersPage.tsx`
- `src/pages/ReturnsPage.tsx`
- `src/pages/FinancePage.tsx`
- `src/pages/VendorInboxPage.tsx`
- `src/pages/VendorSupportTicketsPage.tsx`
- `src/pages/VendorProfilePage.tsx`
- `src/pages/OrderDetailPage.tsx`
- `src/pages/ReturnDetailPage.tsx`

## Current Trust Wins

Recent work already establishes several important trust patterns:

- Dashboard operational counts now support normalized semantic fields: `openSupportIssueCount`, `groupedAutomationIssueCount`, `financeReviewItemCount`, and `staleFulfillmentGroupCount`.
- Dashboard action sections separate grouped actionable issues from passive insights, recent activity, and notification history.
- Repeated dashboard activity and notification rows can be grouped with expandable detail instead of repeated as equal-priority rows.
- Finance surfaces use settlement preview, estimated payout, pending review, and unknown wording instead of final balance/payable language.
- Order Detail and Finance both expose settlement preview and finance timeline concepts with vendor/admin visibility differences.
- Support history is increasingly presented as grouped activity rather than duplicate-looking ticket spam.
- Vendor Profile presents admin-owned configuration as read-only operational truth and offers a support correction workflow.
- Return Detail keeps provider diagnostics admin-oriented and has a clearer return pickup flow state model.
- Operational pages use section-level skeleton, empty, and retry states more consistently than route-blocking loaders.

These are the foundation. The remaining risk is not one broken page; it is inconsistency in how evidence, issues, queue items, actions, and history are projected across surfaces.

## Remaining Trust-Breaking Patterns To Watch

| Surface | Current trust risk | Trust rule |
| --- | --- | --- |
| Dashboard | Counts can still feel ambiguous if source metadata is not clear to the user. | Action counts must name the counted workflow entity, not just the source system. |
| Orders | Status, action cards, timeline, and detail links can repeat the same shipment issue with equal visual weight. | The selected order row/inspector state is primary; timeline and linked records are context. |
| Returns | Return status, refund status, provider pickup diagnostics, and support context can compete. | Return lifecycle is primary; provider diagnostics are admin evidence unless they block the next step. |
| Finance | Settlement estimate, pending review, draft payout review, support activity, and invoice/accounting hints can imply more certainty than exists. | Settlement preview is not payout truth; admin-only reconciliation stays visually secondary. |
| Support/Inbox | Unread replies, open tickets, communication feed items, and linked records can be mistaken for the same count. | Support queue counts support entities; notification unread counts notification artifacts. |
| Vendor Profile | Internal IDs are useful but can look like raw configuration dumps. | Business-readable location/status is primary; IDs remain visible as support evidence. |
| Order Detail | Shipment, settlement, support, provider diagnostics, and admin traces create dense evidence. | One current blocker gets the primary action; other sections explain or preserve history. |
| Return Detail | Missing pickup fields, provider validation, addressId diagnostics, and live create state can reset perceived truth. | Return pickup prerequisite state is primary; provider response is evidence, not a new workflow state unless persisted. |

## Operational Trust Principles

### 1. Count What The Label Says

A visible count must map to one clear object type or issue group. If the count mixes objects, the label must say so.

Good labels:

- Open support issues
- Unread support notifications
- Automation issue groups
- Finance review items
- Stale fulfillment groups
- Return review items

Weak labels:

- Support queue when it counts notifications
- Automation queue when it counts raw signals
- Finance review when it displays currency
- Needs attention when the total mixes unrelated raw objects without explanation

### 2. One Issue, One Primary Actionable Representation

One operational issue can appear on multiple surfaces, but only one projection should be primary in a given context.

Example: a stale fulfillment issue may appear as:

- Dashboard action card: grouped count and link to Orders
- Orders row: actionable work item
- Order Detail status: current shipment state
- Notification history: passive evidence
- Timeline: contextual history

It should not appear as three equal-priority dashboard rows, two inspector alerts, and multiple timeline events on the same screen.

### 3. Preserve Evidence Without Promoting Noise

Historical evidence must remain accessible. It should not inflate current workload or compete visually with active work.

Rules:

- raw provider responses stay in admin diagnostics;
- notification history stays passive;
- linked records preserve navigation context;
- duplicate support tickets can be grouped without deleting records;
- timelines explain chronology, not queue size.

### 4. Unknown Is Better Than Fake Precision

Unknown, not configured, not synced, pending review, and preview are valid operational states.

Rules:

- Missing finance inputs render `Unknown`, not `0`.
- Missing dates render `-` or a section-specific fallback.
- Missing provider evidence renders `Not synced` or `Not available`.
- Review states never imply approval, payout, invoice finality, or accounting truth.
- A fallback must not broaden vendor access or hide authorization failures.

### 5. Role Determines Evidence Depth

Vendor users need safe operational truth and next steps. Admin users need deeper evidence and recovery context.

Rules:

- Vendors see active work, settlement previews, support activity, and read-only configuration.
- Vendors do not see raw provider payloads, webhook internals, accounting sync internals, or replay/recovery details.
- Admins may see reconciliation hints, provider diagnostics, unknown input reasons, and internal linked records.
- Admin diagnostics should still be redacted, scoped, and usually collapsed.

### 6. Degraded Rendering Must Stay Honest

Partial or malformed production data should not crash the route and should not create fake certainty.

Rules:

- Optional sections fail locally.
- Primary entity fetch failure shows a local error inside the page frame.
- Invalid dates, currencies, arrays, and statuses use safe display helpers.
- Mutation uncertainty must fail loudly if a provider or Shopify operation might have run.
- Route error boundaries are reserved for unexpected render exceptions, not normal data gaps.

## Actionable Vs Passive Rules

| Projection | Purpose | Visual priority | Countable as work? |
| --- | --- | --- | --- |
| Operational issue group | Deduplicated user-facing issue | Primary on Dashboard and queues | Yes |
| Queue item | Entity requiring workflow action | Primary in list/inspector pages | Yes |
| Action card | Summary of current work | Primary on Dashboard | Yes, if backed by issue group or queue item |
| Notification | Delivery/read/dismiss artifact | Passive history | No, unless labeled unread notifications |
| Timeline event | Contextual history | Secondary inside details | No |
| Linked record | Navigation and evidence context | Secondary | No |
| Provider diagnostic | Admin investigation evidence | Collapsed/admin-only | No |
| Finance preview | Estimate over available evidence | Secondary/actionable only when review is required | Not unless review item exists |

## Count Semantics

Dashboard and queue counts should follow these semantics:

| Count | Source entity | Must not count | Destination expectation |
| --- | --- | --- | --- |
| Open support issues | Open/current support tickets or grouped support issues | unread notifications, dismissed alerts, duplicate history rows | `/support` shows the same open support issue model or clearly filtered equivalent |
| Unread support notifications | Notification artifacts tied to support | open tickets with no unread reply | Notification history or support unread filter |
| Automation issue groups | Grouped active automation/rule issue groups | raw rule signal rows by themselves | `/automation` shows grouped or explainable issue groups |
| Finance review items | Finance rows/items requiring review | settlement currency totals | `/finance` shows review rows or a review-pending state |
| Settlement estimate | Currency estimate from finance evidence | queue count, final payable balance | Finance snapshot or settlement preview |
| Stale fulfillment groups | Grouped fulfillment/shipment issues | every historical stale event | `/orders` shows affected allocations/orders |
| Return review items | Return/refund records requiring review | completed historical refunds | `/returns` shows the same attention status set |
| Notification history | Notification rows grouped for readability | active work totals | Dashboard passive history only |

If an exact destination filter does not exist yet, the dashboard card must use language such as "grouped issues" or "review pending" instead of implying an exact row count match.

## Workflow Truth Model

Operational truth should flow through this conceptual pipeline:

```text
raw evidence
-> normalized signal
-> operational issue group
-> queue item or action card
-> workflow action
-> timeline/history evidence
```

### Raw Evidence

Examples: Shopify webhook payload, provider snapshot, finance ledger row, support reply, automation rule signal, diagnostics response.

Raw evidence is auditable and may be admin-visible. It is not the default user-facing count.

### Normalized Signal

Examples: tracking missing, return aging, shipping cost missing, support unread, finance review required.

Signals should be deterministic and idempotent. A signal can be active or resolved.

### Operational Issue Group

Examples: 3 stale fulfillment groups, 2 open support issues for one order, 1 finance review item.

Groups are the preferred dashboard action unit.

### Queue Item

Examples: one order allocation awaiting shipment, one return request awaiting review, one support ticket requiring response, one finance row pending review.

Queue items must link to visible workflow surfaces.

### Workflow Action

Examples: create shipment label, open return detail, reply to support, review settlement estimate, inspect automation issue.

Every primary issue should have either one clear action or a truthful reason no action is currently available.

### Timeline And History

Timelines, linked records, and notifications preserve evidence. They should explain the issue and outcome, not inflate the active workload.

## Source-Of-Truth Visibility

Every major queue/status should imply its source entity:

| Status or queue | Source-of-truth wording |
| --- | --- |
| Support | Support ticket or grouped support issue |
| Automation | Grouped active automation/rule issue |
| Finance | Finance review row or settlement preview |
| Fulfillment | Order allocation/shipment issue |
| Returns | Return request/refund record |
| Notifications | Notification artifact |
| Provider diagnostics | Redacted provider snapshot/response |
| Vendor configuration | Admin-owned provider/marketplace configuration |

The UI should expose the source at the right depth:

- Dashboard: semantic label and destination link.
- Inspector: selected entity and current state.
- Detail page: full context and history.
- Admin diagnostics: redacted source fields and raw evidence keys.

## Action Clarity Rules

Primary actions should be few, contextual, and non-duplicative.

Rules:

- Do not render "No actions available" panels unless the absence of action teaches the operator something important.
- If a shipment label already exists, the action opens the existing label instead of creating another shipment.
- If a support ticket already exists, "Contact support" opens/reuses it instead of creating duplicates.
- If escalation requires an existing ticket, the UI says so instead of creating a new ticket.
- If live provider create prerequisites are missing, show the prerequisite step before the live action.
- If a detail page already represents the record, remove redundant "view detail" buttons from that header.
- When multiple actions exist, present one primary action row and move secondary actions into grouped controls or details.

## Cross-Page Language Standard

Use the same labels for the same concept across Dashboard, inspectors, and detail pages.

| Concept | Preferred wording | Avoid |
| --- | --- | --- |
| Operational workload | Needs attention | Alert spam |
| Finance estimate | Settlement preview | Balance |
| Vendor expected estimate | Estimated payout / Estimated settlement | Payable, final payout |
| Review state | Pending review / Awaiting review | Confirmed |
| Missing value | Unknown / Not configured / Not synced | 0, if not truly zero |
| Support grouping | Support activity / Open support issues | Raw ticket dump |
| Automation grouping | Automation issue groups | Raw signals, unless admin diagnostics |
| Passive feed | Notification history / Recent activity | Queue, if not actionable |
| Provider evidence | Diagnostics / Provider response summary | Primary status, unless it blocks current work |

## Role-Aware Trust Boundaries

### Vendor Users

Vendor users may see:

- orders and returns in their vendor scope;
- shipment and return workflow states;
- estimated settlement and refund impact;
- pending review status;
- support tickets and correction workflows;
- read-only shipping, return, and marketplace configuration summaries;
- source IDs when useful for support, visually subordinate to readable context.

Vendor users must not see:

- raw provider payloads;
- replay/recovery controls;
- other vendors' records;
- accounting sync internals;
- payment evidence internals;
- admin-only review hints;
- webhook diagnostics;
- fake payout certainty.

### Admin Users

Admin users may see:

- reconciliation and diagnostic hints;
- provider request/response summaries;
- unknown input reasons;
- cross-workspace linked records;
- internal support/review/admin notes where modeled;
- operational health and automation diagnostics.

Admin users still need:

- redaction;
- scoped evidence;
- collapsed raw diagnostics;
- clear distinction between preview, review, approval, and payment.

## Safe Degraded Rendering Philosophy

Operational trust is lost when a page crashes, but also when a fallback lies. Degraded rendering must be explicit and constrained.

Use local fallback states for:

- invalid timestamps;
- malformed optional diagnostics;
- null nested relations;
- partial support/finance/return records;
- empty arrays where the parent entity is valid;
- background refresh failures with stale data present.

Use explicit error states for:

- unauthorized access;
- missing vendor context;
- missing route id;
- primary API failure with no cached data;
- mutation ambiguity where external side effects may have occurred.

Never use fallback values to:

- broaden vendor scope;
- hide failed permissions;
- imply settlement approval;
- imply shipment creation;
- imply provider success;
- treat unknown money as zero.

## Surface-Specific Trust Guidance

### Dashboard

- Keep Needs attention and Operational queues as the only primary action zones.
- Prefer backend-normalized operational counts when available.
- Keep frontend grouping as a fallback for older/mixed payloads.
- Notification history remains passive, even when unread.
- Finance snapshot stays below action work and uses estimate language.
- Admin diagnostics and observability remain admin-only or visually subordinate.

### Orders

- The table row and right inspector are the primary shipment work surfaces.
- Metrics and passive insights should not outrank current shipment blockers.
- Tracking missing/provider pending labels must not conflict; if both appear, one should be primary and the other explanatory.
- Smart label action must preserve duplicate guards and clear pending/error states.

### Returns

- Return lifecycle and returned items are primary.
- Refund status and provider pickup state should be adjacent but distinct.
- Provider diagnostics should remain admin evidence unless they define the current blocker.
- Return pickup completion steps should preserve saved state and never reset perceived endpoint/address truth after refetch.

### Finance

- Settlement preview is an estimate workspace, not a payout engine.
- Finance review counts count review rows, not money.
- Vendor view remains operational and estimate-safe.
- Admin view may include invoice/accounting/provider evidence, but only as reconciliation context.
- Support activity should be grouped and secondary unless a support action blocks review.

### Support And Inbox

- Support request counts are support entities.
- Unread counts are message/notification artifacts.
- Communication feed items can aggregate orders, returns, finance, and support, but should not redefine those source entities.
- Duplicate historical support records remain accessible through grouped history.

### Vendor Profile

- Readable business location/status is primary.
- Operational IDs remain visible for support/debugging.
- Admin-owned fields remain read-only to vendors.
- The correction CTA should reuse/open the vendor profile support workflow instead of creating duplicates.

### Order Detail

- Shipment/return current state is primary.
- Settlement preview and finance timeline are contextual estimates.
- Admin finance ledger traces and provider diagnostics remain admin-only or collapsed.
- Linked records preserve evidence but do not become additional blockers unless the current state says so.

### Return Detail

- Return summary, returned items, and pickup lifecycle are primary.
- Missing pickup fields are prerequisite work.
- Provider validation response is evidence; it should not erase saved prerequisites or reset the flow.
- Navlungo/Shopify diagnostics are admin evidence and should stay redacted.

## Immediate UX Wins

These are low-risk refinements that can be implemented without schema or business logic changes:

1. Add small source labels to dashboard queue cards where counts are normalized, such as "Open tickets" or "Grouped issues".
2. Replace generic empty copy such as "No records available" with workflow-specific empty states where it still appears.
3. Hide empty action panels unless they explain a meaningful blocked state.
4. Keep support/notification distinction visible in Dashboard, Support, and Inbox labels.
5. Add consistent "Source: ..." helper text for admin-only diagnostics sections.
6. Audit any remaining `0` finance displays and ensure they are true zero, not unknown.
7. Group repeated linked support records wherever they appear as secondary context.
8. Keep provider diagnostics collapsed by default on vendor-adjacent deep detail pages.

## Medium-Term Operational Integrity Improvements

These require coordinated frontend/backend contract work but not a workflow engine:

1. Add filterable destination links for normalized dashboard cards, so the destination page opens with the same semantic filter.
2. Add normalized issue-group metadata to dashboard DTOs beyond counts: label, source entity type, grouped count, raw count, and destination filter.
3. Make support grouping a shared helper used by Finance, Order Detail, Return Detail, and Support/Inbox projections.
4. Make timeline event hierarchy shared: primary lifecycle, secondary support/admin activity, raw diagnostics.
5. Add source-of-truth badges for admin diagnostics that state whether evidence came from Shopify, provider, local DB, or inferred preview.
6. Expand malformed fixture tests across all operational pages for invalid dates, unknown statuses, null relations, and partial finance/support records.
7. Audit dashboard and page tests for forbidden finance certainty words in vendor-visible settlement sections.

## Future Workflow Orchestration Opportunities

These are future directions and should not be implemented as part of this phase:

1. Persist an `OperationalIssueGroup` model that owns dedupe keys, lifecycle, assignment, and resolution.
2. Promote dashboard normalized counts from DTO fields to first-class issue group queries.
3. Add admin drilldown from issue group to raw signals, notifications, provider evidence, and timeline history.
4. Add explicit workflow states for acknowledged, in review, resolved, dismissed, and historical issue groups.
5. Add settlement approval and payout execution states only when real finance authority exists.
6. Add role-specific dashboards only after shared role-aware filtering proves insufficient.
7. Add issue ownership and SLA orchestration for support, returns, fulfillment, finance review, and automation.

## Non-Goals

- No new database schema in this phase.
- No payout, accounting, or invoice execution behavior.
- No provider payload changes.
- No Shopify ingestion changes.
- No route redesign or app split.
- No fake metrics to make counts match.
- No deletion or mutation of historical support, notification, provider, or finance evidence.

## Unresolved Decisions

- Whether dashboard destination links should carry route query params for each normalized issue group.
- Whether support counts should prioritize open ticket count or grouped support issue count when duplicates exist.
- Whether automation should keep separate vendor-safe operational issue labels from admin raw signal labels.
- Whether finance review item count should include only blocked/held rows or all rows eligible for review.
- Whether return attention should count requested returns, in-review refunds, or separate return and refund queues.
- When to introduce a persisted issue-group lifecycle rather than frontend/backend projection only.
