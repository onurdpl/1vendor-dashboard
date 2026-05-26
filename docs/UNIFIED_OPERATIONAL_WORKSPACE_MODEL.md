# Unified Operational Workspace Model

## Purpose

The product has matured into a set of operational workspaces for orders, returns, finance, support, vendor configuration, and dashboard triage. Each surface now works, but the product should feel like one command system rather than separate page implementations.

This document defines the common workspace architecture:

1. Primary list or queue
2. Right inspector
3. Deep detail workspace

It is a UX/system architecture guide only. It does not change backend contracts, provider behavior, finance calculations, vendor isolation, Shopify ingestion, or route ownership.

## Files Audited

- `src/components/OperationalPrimitives.tsx`
- `src/components/OperationalTimeline.tsx`
- `src/hooks/useQueryResource.ts`
- `src/pages/DashboardPage.tsx`
- `src/pages/OrdersPage.tsx`
- `src/pages/OrderDetailPage.tsx`
- `src/pages/ReturnsPage.tsx`
- `src/pages/ReturnDetailPage.tsx`
- `src/pages/FinancePage.tsx`
- `src/pages/VendorInboxPage.tsx`
- `src/pages/VendorSupportTicketsPage.tsx`
- `src/pages/VendorProfilePage.tsx`
- `docs/DASHBOARD_OPERATIONAL_MODEL.md`
- `docs/OPERATIONAL_STABILITY_GUIDELINES.md`
- `docs/ORDER_DETAIL_UNIFICATION.md`
- `docs/FINANCE_EVENT_TIMELINE_MODEL.md`

## Current Surface Audit

| Surface | Current Shape | What Works | Inconsistency To Reduce |
| --- | --- | --- | --- |
| Dashboard | Action-first command center with Needs attention, queues, passive insights, notifications, finance, and admin health. | Recently moved toward "what requires attention now". | Not a list/inspector page; should still use the same loading, grouping, terminology, and actionable-vs-passive rules. |
| Orders | Primary order queue, right inspector, deep `/orders/:orderId` workspace. | Strongest list-inspector-detail implementation. Uses shared table, side panel, empty/error primitives. | Inspector timeline still uses older `TimelineBlock` while detail uses `OperationalTimeline`; secondary insights below list can feel separate from inspector model. |
| Order Detail | Dense routed workspace for shipment, support, settlement preview, finance timeline, linked records, and admin diagnostics. | Best deep-detail example. Has vendor/admin visibility boundaries and finance/support grouping. | Uses custom detail-specific sections; should align labels and timeline hierarchy with Finance and Returns. |
| Returns | Return queue, right summary inspector, routed Return Detail workspace. | Uses shared table and side panel. Returned items and timeline are operationally useful. | Timeline styling and support/finance grouping are less unified than Orders/Finance; empty/loading copy varies. |
| Return Detail | Deep return workspace with returned items, summary, timeline, operations, Navlungo return pickup, linked context, and diagnostics. | Has render-first frame, local section fallbacks, and richer return lifecycle. | More diagnostic/provider-heavy than the canonical pattern; secondary diagnostics need consistent collapsed hierarchy. |
| Finance | Finance queue/table, right inspector, settlement preview, finance timeline, support grouping, deep link to Order Detail settlement section. | Best finance terminology alignment. Uses `SideDetailPanel`, `OperationalTimeline`, grouped support activity, and role-aware hints. | Finance-specific cards should become the reference pattern for settlement/support grouping elsewhere. |
| Support/Inbox | Communication/support lists and selected message context. | Uses shared loading/error/empty primitives and vendor-safe wording. | Lacks the same inspector grammar as Orders/Returns/Finance; support activity grouping should match finance/detail patterns. |
| Vendor Profile | Read-only marketplace seller profile summary with support correction workflow. | Good role-aware configuration/readiness surface. | Not a queue page; should use the same section state, terminology, and diagnostic de-emphasis rules without forcing list/inspector structure. |

## Canonical Workspace Pattern

### A. Primary List Or Queue

Use this for operational work that can be selected, filtered, searched, and triaged.

Expected behavior:

- Render header, filters, and table/list frame immediately.
- Keep rows compact and scan-friendly.
- Show actionable status, owner/scope, last update, and next action in the row.
- Keep passive analytics below the work queue or in a secondary band.
- Use local skeleton rows only inside the list body.
- Use local retry when list data fails.

Canonical examples:

- Orders queue
- Returns queue
- Finance table
- Support ticket list
- Inbox communication list

Dashboard is not a queue, but its "Needs attention" and "Operational queues" sections should follow the same action-first rules.

### B. Right Inspector

Use this for selected-row context without leaving the list.

Expected order:

1. Header: entity title, vendor/source badge, primary status badges.
2. Actionable state: current blocker, next step, or "stable" state.
3. Primary metadata: compact key/value rows.
4. Lifecycle/timeline: grouped, vendor-safe operational events.
5. Linked records: order, return, finance, support, and settlement links.
6. Support activity: grouped and secondary unless it is the active blocker.
7. Finance grouping: settlement preview language only; no fake certainty.
8. Footer actions: one primary action row, not scattered buttons.

Inspector rules:

- Use one vertical flow. Do not split inspector content into internal narrow columns.
- Keep status badge placement consistent: title/header first, badges adjacent or just below.
- Keep support/admin/reconciliation activity visually secondary to the primary lifecycle.
- Do not put raw diagnostics in the inspector unless the user is admin and the section is collapsed or clearly secondary.
- When no row is selected, render an operational empty state such as "Select an order to inspect shipment and settlement context."

Canonical examples:

- Orders right inspector
- Returns right inspector
- Finance right inspector

### C. Deep Detail Workspace

Use routed detail pages for full operational history and actions.

Expected structure:

1. Header with back navigation, entity title, source badge, and status chips.
2. Compact metadata strip.
3. Current operational state and next action.
4. Main operational workspace: items, shipment/return/finance/support detail.
5. Timeline and linked records.
6. Admin diagnostics, collapsed or visually subordinate.

Detail pages should not duplicate every inspector interaction. The inspector is for quick triage; the detail workspace is for durable operational decisions, full history, and admin diagnostics.

Canonical examples:

- `/orders/:orderId`
- `/returns/:returnId`
- support ticket detail
- future finance drilldown sections linked from Finance rows

## Loading, Empty, And Error Philosophy

The render-first rule remains product-wide:

- The app shell and page frame render immediately.
- Cached/stale data stays visible during background refresh.
- Loading appears as section skeletons in the real layout, not as a full-page blocker.
- Disabled readiness-gated queries render an explicit waiting state, not endless skeletons.
- Optional sections fail locally.
- Route boundaries catch unexpected React exceptions only.

### Loading

Use:

- table row skeletons for lists;
- compact card skeletons for inspectors;
- timeline skeleton rows for detail pages;
- stable headers, filters, tabs, and action bars before data arrives.

Avoid:

- full-page `DataStatePanel` for recoverable API loading;
- replacing a loaded page with a loading card during background refetch;
- showing "Loading..." without naming what is loading.

### Empty

Use operational copy:

- "No orders match this filter."
- "No return requests require review."
- "No support activity linked to this order."
- "No finance events available yet."

Avoid:

- generic "No data";
- empty states that imply the system failed when the queue is simply clear;
- hiding the section if the empty state teaches the operator what is expected there.

### Error

Use local retry surfaces for section failures:

- list fetch failed;
- selected inspector detail failed;
- secondary finance/support/provider diagnostics failed;
- optional linked records failed.

Fail loudly for:

- missing route id;
- unauthenticated or unauthorized access;
- unresolved vendor scope;
- mutation uncertainty where a provider or Shopify operation may have run;
- backend 4xx/5xx with no stale data.

## Timeline Architecture

All timelines should share the same hierarchy:

1. Primary operational lifecycle
   - order captured
   - shipment created
   - tracking synced
   - return requested
   - return pickup created
   - refund recorded
   - settlement preview generated

2. Secondary support/admin/reconciliation activity
   - support ticket opened/escalated/resolved
   - manual review note
   - reconciliation warning
   - provider diagnostics, admin-only

3. Raw diagnostics
   - webhook payload parsing
   - provider request/response keys
   - validation messages
   - retry/replay evidence

Timeline rules:

- Use `OperationalTimeline` as the long-term shared component.
- Group repeated events by type, status, and useful time bucket.
- Show finance events as preview/estimated unless backed by durable finance evidence.
- Never show payout scheduled, payout paid, confirmed settlement, or final balance unless future backend state explicitly proves it.
- Keep support activity accessible but visually lower priority than the operational lifecycle.
- Hide raw provider and Shopify implementation terms from vendor timelines.
- Do not expose PII in timeline subtitles.

## Terminology Standard

Use the same concept labels across Orders, Returns, Finance, Support, and detail pages.

| Concept | Preferred Label | Avoid Unless Proven |
| --- | --- | --- |
| Finance estimate | Settlement preview | Balance |
| Vendor expected payout estimate | Estimated settlement / Estimated payout | Payable |
| Review state | Pending review / Awaiting review | Confirmed |
| Refund effect | Refund impact | Refund debt unless modeled |
| Support grouping | Support activity | Raw ticket dump |
| Missing data | Unknown | 0 |
| Passive diagnostics | Provider configuration status / Diagnostics | Provider metadata dump |
| Operational issue | Needs attention | Error, unless it is a true failure |

Page-specific wording may vary for Turkish action labels, but the English operational concepts should remain stable in headings, tests, and docs.

## Actionable Vs Passive Information

Actionable information should be visually primary:

- current blockers;
- shipment/return actions;
- support ticket requiring response;
- failed automation requiring retry;
- tracking missing;
- refund or settlement review required.

Passive information should be lower in the hierarchy:

- historical notifications;
- diagnostics;
- configuration source;
- raw metadata;
- old support history;
- passive finance snapshots.

Rules:

- Put action cards and queues above passive insights.
- Group repeated passive events before rendering them.
- Collapse raw metadata when it is not needed for the immediate workflow.
- Prefer one clear action row over duplicated action buttons in multiple cards.
- Keep "No actions available" hidden unless the absence of action is operationally meaningful.

## Finance And Support Grouping

Finance grouping should use the same pattern in Finance and Order Detail:

- `Settlement preview`
- `Finance timeline`
- `Linked records`
- `Support activity`

Vendor finance views may show:

- estimated settlement;
- commission estimate;
- shipping deduction estimate or unknown;
- refund impact estimate or pending;
- pending review status.

Admin finance views may additionally show safe reconciliation hints and unknown input reasons.

Support grouping should avoid repeated raw ticket cards:

- group historical duplicate support records;
- show count, latest status, and latest activity;
- keep expandable history available where useful;
- do not delete or mutate historical support evidence.

## Role-Aware Visibility

Vendor-facing surfaces may show:

- vendor-scoped orders, returns, support, and finance preview information;
- estimated settlement language;
- support/profile correction context;
- provider-facing operational statuses translated into vendor-safe labels.

Vendor-facing surfaces must not show:

- other vendors' records;
- raw ledger internals;
- payment evidence internals;
- accounting sync internals;
- provider secrets, tokens, payload bodies, or full sensitive webhook payloads;
- raw Shopify GraphQL or webhook implementation details;
- admin-only recovery/replay controls.

Admin surfaces may show:

- diagnostics summaries;
- reconciliation hints;
- unknown input reasons;
- linked internal records;
- provider validation details when redacted;
- replay/recovery context.

Admin diagnostics still must remain redacted, scoped, and subordinate to the operational workflow.

## Diagnostic Dump Reduction

Diagnostics remain important, but they should not define the normal workspace.

Guidelines:

- Put diagnostics after the operational state.
- Collapse large provider snapshots and request summaries by default.
- Show safe status summaries before raw keys.
- Keep IDs visible when they are useful for support, but visually subordinate to readable business labels.
- Do not repeat the same status in KPI, badge, timeline, inspector, and linked records with equal weight.

## Phase A Quick Wins

These are small, low-risk UX unification changes:

- Replace remaining generic empty copy such as "No records available" with operational empty-state wording.
- Use `OperationalTimeline` instead of page-local timeline blocks where the data shape already matches.
- Align inspector section order across Orders, Returns, and Finance.
- Normalize labels for `Settlement preview`, `Finance timeline`, `Linked records`, and `Support activity`.
- Collapse or de-emphasize repeated diagnostics in Return Detail and Order Detail.
- Keep action rows in inspectors visually consistent.
- Group support history consistently in Order Detail and Finance.
- Add tests for disabled/idle query states rendering explicit waiting states rather than skeleton loops.

## Phase B Medium Refactors

These require coordinated but still incremental frontend work:

- Extract a shared `OperationalInspector` wrapper from the existing `SideDetailPanel` pattern.
- Extract shared inspector subcomponents:
  - `InspectorHeader`
  - `InspectorActionState`
  - `InspectorActionBar`
  - `InspectorLinkedRecords`
  - `InspectorSupportActivity`
  - `InspectorSettlementPreview`
- Make `OperationalTimeline` support grouped primary/secondary sections explicitly.
- Create a small `SectionState` convention for loading, empty, retry, and waiting states.
- Move support grouping logic into a shared helper used by Finance, Order Detail, and Support surfaces.
- Define frontend-only section ownership metadata for dashboard sections: `action`, `queue`, `passive`, `history`, `admin`.
- Audit detail pages so secondary diagnostics hydrate lazily and never block primary content.

## Phase C Future Architecture

These are longer-term architecture directions, not immediate tasks:

- Introduce a formal workspace route model describing each page's list, inspector, detail, and role visibility.
- Add typed operational lifecycle event categories so timeline grouping is data-driven rather than page-local.
- Split admin/vendor dashboards only if role-specific workflows keep diverging after role-aware sections are exhausted.
- Move heavy diagnostics to explicit detail/diagnostic endpoints when payload size becomes a bottleneck.
- Define a durable finance/support/reconciliation event model when the finance lifecycle moves beyond preview.
- Add design-system-level tests for inspector order, timeline grouping, section state behavior, and role visibility.

## Open Questions

- Whether Support/Inbox should grow a persistent right inspector or keep its current selected-message context.
- Whether Vendor Profile should remain a profile page only or eventually become a vendor settings workspace with admin-owned sections.
- Whether Finance should get a routed order-level drilldown or continue deep-linking to the Order Detail settlement section.
- Whether dashboard should remain one shared route with role-aware sections or become separate admin/vendor dashboard routes.
- Which provider diagnostics are still too prominent in Return Detail for vendor users.
