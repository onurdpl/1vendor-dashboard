# Dashboard Signal Truth Model

## Purpose

The dashboard must be trusted as an operational command center. A dashboard count should name exactly what object is counted, use the same visibility scope as the page it links to, and avoid mixing raw history, unread notifications, grouped alerts, and work items under one label.

This audit documents the current dashboard signal sources and the semantic mismatches that explain why dashboard counts can differ from Orders, Returns, Support, Automation, and Finance pages.

This document is investigation only. It does not change backend calculations, normalize data, remove historical records, or alter business logic.

## Files Inspected

- `src/lib/api/dashboard.ts`
- `src/pages/DashboardPage.tsx`
- `src/pages/OrdersPage.tsx`
- `src/pages/ReturnsPage.tsx`
- `src/pages/AutomationPage.tsx`
- `src/pages/FinancePage.tsx`
- `src/pages/AdminSupportTicketsPage.tsx`
- `src/pages/VendorSupportTicketsPage.tsx`
- `src/pages/VendorInboxPage.tsx`
- `src/lib/communicationCenter.ts`
- `src/services/real/automation.ts`
- `src/services/real/finance.ts`
- `src/services/real/returns.ts`
- `src/services/real/signals.ts`
- `src/services/real/notifications.ts`
- `src/services/runtime-services.ts`
- `src/lib/api/contracts.ts`
- `src/lib/api/queryKeys.ts`
- `backend/src/modules/automation/automation.service.ts`
- `backend/src/modules/rules/rules.service.ts`
- `backend/src/modules/rules/rules.routes.ts`
- `backend/src/modules/notifications/notifications.service.ts`
- `backend/src/modules/support/support.service.ts`
- `backend/src/modules/operations/operations.service.ts`
- `docs/DASHBOARD_OPERATIONAL_MODEL.md`
- `docs/ROLE_AWARE_OPERATIONAL_MODEL.md`
- `docs/UNIFIED_OPERATIONAL_WORKSPACE_MODEL.md`

## Executive Summary

The dashboard is currently assembled on the frontend from several destination services. It does not have a backend-native dashboard aggregate contract. The main trust issue is that multiple visible dashboard cards are labeled like queues, but the values come from different semantic domains:

- Support queue is unread notification count, not open support tickets.
- Automation queue is unresolved automation alerts plus raw operational rule signals, while the Automation page shows only automation alerts and suggestions.
- Finance review queue is a currency settlement estimate, not a queue item count.
- Needs attention is the sum of heterogeneous work types, including raw signals and record counts.
- Notification history is grouped visually, but its summary still counts raw notification rows.

These values are not necessarily wrong individually. They become misleading when a dashboard card links to a page that uses a different default object model or filter.

## Current Data Flow

`getDashboardOverview` in `src/lib/api/dashboard.ts` builds the dashboard with `Promise.allSettled` over:

| Dashboard dependency | Runtime call | Scope |
| --- | --- | --- |
| Orders | `runtimeServices.orders.list(currentVendorId)` | selected vendor |
| Returns | `runtimeServices.returns.list(currentVendorId)` | selected vendor |
| Finance | `runtimeServices.finance.dashboard(currentVendorId)` | selected vendor |
| Automation | `runtimeServices.automation.dashboard(currentVendorId)` | selected vendor |
| Admin operations | `runtimeServices.operations.list()` | admin only |
| Operational rules signals | `runtimeServices.signals.list(currentVendorId)` | selected vendor |
| Notifications | `runtimeServices.notifications.list(notificationScopeVendorId)` | vendor or admin global |
| Diagnostics | `runtimeServices.diagnostics.reconciliation()` | admin only |
| Observability | `runtimeServices.observability.summary()` | admin only |

The dashboard degrades with partial warnings when non-auth dependencies fail. That resilience is useful, but it also means dashboard counts are derived client-side from whichever service results are available.

## Source-of-Truth Matrix

| Dashboard surface | Current source | Current counted object | Grouped or raw | Hidden/history included | Destination page | Trust classification |
| --- | --- | --- | --- | --- | --- | --- |
| Needs attention total | Sum of `priorityWork` values in `DashboardPage` | Mixed: blocked allocations, awaiting shipments, active return/refund rows, unresolved automation alerts, raw signals | Raw sum across different domains | Depends on each source | Multiple | Overloaded |
| Blocked allocations | Orders list filtered by `allocationStatus === pending_reassignment || vendor_blocked` | Order allocation rows | Raw rows | Only current Orders list rows | `/orders` | Mostly trustworthy if destination filter matches |
| Awaiting shipment | Orders list filtered by `shippingStatus === "Awaiting Shipment"` | Order allocation rows | Raw rows | Only current Orders list rows | `/orders` | Mostly trustworthy if status casing is consistent |
| Refund attention | Returns list filtered by `status === "Pending" || "In Review"` | Return/refund summary rows | Raw rows | Excludes `Requested`, which Returns page treats as attention | `/returns` | Misaligned |
| Automation signals | `(automation.alerts where status !== "Resolved") + signals.summary.total` | Two different objects: automation alert rows plus operational rule signal rows | Raw sum | Active signals only; alerts are generated from automation service | `/automation` | Misleading/overloaded |
| Fulfillment queue | `priorityWork["Awaiting shipment"]` | Awaiting shipment order allocation rows | Raw rows | Same as Orders list | `/orders` | Mostly trustworthy |
| Returns queue | `priorityWork["Refund attention"]` | Return/refund rows using dashboard's narrower status filter | Raw rows | Does not match Returns page attention model | `/returns` | Misaligned |
| Finance review queue | `financeSnapshot.payoutEstimate` or dashboard stat `Payout estimate` | Money estimate | Not a count | Current finance summary only | `/finance` | Misleading label |
| Support queue | `notificationView.summary.unread` or literal `Open` | Unread in-app notifications | Raw notification rows after dismissed filtering in UI | Read/dismissed behavior differs from support ticket state | `/support` | Misleading |
| Automation queue | `priorityWork["Automation signals"]` | Unresolved automation alerts plus active rule signals | Raw sum | Not grouped by issue | `/automation` | Misleading |
| Notification history | `runtimeServices.notifications.list(...)` | NotificationIntent rows | UI groups by title/source/severity | Read rows included in total; dismissed rows filtered in `notificationView` | dashboard only | Trustworthy only when labeled as notification history |
| Recent operational events | First two raw signals + first order + first return + first automation alert | Mixed text events | Grouped only by exact title string in UI | Latest record only for each source | dashboard only | Passive context, not a queue |
| Workspace status | String composed from orders length, active refunds, automation alerts/signals, admin operations length | Mixed summary sentence | Raw mixed values | Depends on role/source availability | dashboard only | Informational only |
| Passive KPI `Vendor orders` | Orders list length | Order allocation rows | Raw rows | Current vendor scope | `/orders` | Trustworthy |
| Passive KPI `Blocked / attention` | `blockedCount + activeRefundCount` | Mixed blocked allocations plus refund attention rows | Raw sum | Depends on dashboard return filter | Multiple | Overloaded |
| Passive KPI `Payout estimate` | Finance summary `payoutEstimate` | Currency estimate | Aggregate money | Current vendor finance ledger | `/finance` | Trustworthy if labeled estimate |
| Passive KPI `Refund amount` | Finance summary `refunds`, fallback return amount sum | Currency amount | Aggregate money | Fallback source can differ from finance ledger | `/finance` or `/returns` | Needs source clarity |

## Destination Page Comparison

### Orders

The Orders page uses the same selected-vendor order list and computes:

- total orders from `orders.length`
- awaiting shipment from `shippingStatus === "Awaiting Shipment"`
- tracking missing from missing carrier/tracking
- blocked from `allocationStatus === "pending_reassignment" || "vendor_blocked"`
- fulfilled from `fulfillmentStatus === "Fulfilled"`

Dashboard awaiting shipment and blocked allocation counts are therefore close to Orders page semantics. The remaining mismatch risk is destination filtering: dashboard links currently open `/orders` without applying the matching quick filter.

### Returns

The Returns page treats attention as:

- `status === "requested"`
- `status === "pending"`
- `status === "in review"`

It also distinguishes Shopify return requests from processed refund records. The dashboard currently counts only statuses mapped to `"Pending"` or `"In Review"`. That can undercount rows that the Returns page surfaces as attention, especially Shopify return request rows mapped to `"Requested"` / "Awaiting review".

### Support

Support has three different models:

- Admin Support page: unresolved support tickets by default, excluding `RESOLVED` and `CLOSED`, with optional needs-response and escalated filters.
- Vendor Support page: vendor-scoped support tickets, optionally unread only.
- Vendor Inbox page: a communication feed built from support tickets, orders, returns, and finance records.

Dashboard Support queue does not use any support ticket list. It uses unread in-app notifications. This explains a count such as dashboard Support queue `48` while Support page shows only a few visible tickets.

### Automation

Automation page calls `getAutomationDashboard` and shows:

- `automation.alerts.length`
- critical/needs-attention alert count
- suggestion count
- read-only/restricted suggestion count

Dashboard Automation queue uses `unresolved automation alerts + active operational rule signals`. Raw rule signals are fetched from `/signals` and are not displayed as rows on the Automation page. This explains a dashboard Automation queue value such as `31` while Automation page shows only a few grouped alerts.

### Finance

Finance page is a settlement preview workspace. It shows finance ledger records and summary values:

- `payoutEstimate`
- eligible row count
- blocked row count
- transaction records
- support grouping for the selected finance row

Dashboard Finance review queue currently displays a money value (`payoutEstimate`), not a count of finance records requiring review. This is useful as a finance snapshot, but the queue label is semantically wrong.

### Admin Operations

The admin operations attention center does have a backend-derived queue model. It includes active support tickets, shipment issues, return backlog, finance review rows, operational signals, and recommendations. Dashboard currently calls `runtimeServices.operations.list()` only to append admin queue length to the workspace status sentence, not to back dashboard queue cards.

## Metric Classifications

### Operationally Trustworthy

- Vendor orders: counts current vendor-scoped order list rows.
- Awaiting shipment: matches Orders page status check when casing is consistent.
- Blocked allocations: matches Orders page blocked allocation status check.
- Payout estimate: trustworthy only as a settlement estimate, not as a queue count.
- Notification unread: trustworthy only when labeled as unread notifications, not as support queue.

### Misleading

- Support queue: counts unread notifications but links to Support tickets/workspace.
- Automation queue: combines automation alerts with raw operational rule signals.
- Finance review queue: displays a currency value under a queue label.
- Refund attention / Returns queue: dashboard status filter is narrower than Returns page attention logic.

### Overloaded

- Needs attention total: sums unrelated object types.
- Blocked / attention KPI: combines allocation blockers with return/refund attention.
- Workspace status: mixes orders, refunds, automation alerts, rule signals, and admin operation count.

### Raw/Internal Only

- `signals.summary.total` from `/signals`.
- Admin diagnostics summary.
- Observability retry pressure, dead-letter readiness, reconciliation backlog, stale-state counts.
- NotificationIntent row counts when used as operational work counts.

### Should Be Grouped

- Operational rule signals by source area, rule key, related entity, and suggested action.
- Automation alerts by issue type and affected entity.
- Notification history by signal id/source/title/severity.
- Historical duplicate support tickets by linked order/return/profile context while preserving drilldown access.

### Should Be Hidden or Subordinated for Vendors

- Raw diagnostics and reconciliation signals.
- Admin global notifications.
- Provider/recovery internals that do not translate into vendor action.
- Finance reconciliation/debug hints unless already expressed as vendor-safe settlement preview language.

## Normalized Semantics Proposal

The next implementation should define a small dashboard semantic contract before changing counts.

| Proposed metric | Definition | Destination consistency rule |
| --- | --- | --- |
| Awaiting shipment allocations | Count vendor-scoped order allocation rows where shipping status means awaiting shipment progress. | Link to Orders with the same quick filter or show count as "all Orders list rows". |
| Blocked allocations | Count vendor-scoped allocation rows in reassignment or vendor-blocked state. | Link to Orders with blocked filter. |
| Return review items | Count return/refund rows that the Returns page marks attention: requested, pending, or in review. | Link to Returns with matching attention filter. |
| Open support tickets | Count unresolved support ticket rows visible on the Support page. | Link to Support default unresolved view. |
| Unread support replies | Count vendor/admin unread support replies, not general notifications. | Link to Support unread filter. |
| Active automation issue groups | Count grouped operational issue groups, not raw signal rows. | Link to Automation with the same grouping model. |
| Raw automation signals | Count active raw operational signals. | Use only in admin diagnostics or a secondary "raw signals" label. |
| Finance review items | Count finance ledger rows requiring review: held/disputed/failed invoice/blocked batch rows. | Link to Finance with review filter. |
| Settlement estimate | Currency estimate from finance summary. | Show as finance snapshot, not queue count. |
| Notification unread | Count unread in-app notification rows. | Keep in Notification history, not Support queue. |

## Grouping Model

### Automation and Rules

Current raw behavior can produce:

```text
31 raw operational signals
```

Dashboard should present:

```text
4 active automation issue groups
31 raw signals in details
```

Suggested grouping key:

```text
sourceArea + ruleKey + relatedEntityType + suggestedAction
```

Examples:

- stale fulfillment allocations
- missing shipping cost rows
- return/refund review backlog
- failed diagnostic jobs

The group count should drive the dashboard queue. The raw count should remain available in admin drilldown.

### Support

Support count should use support ticket truth, not notification truth:

- Vendor: unresolved vendor tickets or unread vendor replies, depending label.
- Admin: unresolved tickets, needs response, or escalated tickets, depending label.

Historical duplicate tickets should remain available, but dashboard should group them by context:

```text
Support activity
3 linked tickets
Latest status: In review
```

### Notifications

Notifications are a delivery/history layer, not the source of support or automation queue truth.

Recommended dashboard wording:

- "Unread notifications"
- "High-priority notifications"
- "Notification history"

Avoid using notification counts for:

- "Support queue"
- "Needs attention"
- "Automation queue"

### Returns

Return review count should use the same attention predicate as the Returns page:

```text
requested OR pending OR in review
```

The dashboard can separately show processed/refunded history lower on the page if needed.

### Finance

Separate money values from work item counts:

- "Settlement estimate" is currency.
- "Rows pending review" is count.
- "Needs review" is count.
- "Refund deductions" is currency.

Finance review queue should never display a currency amount as if it were a number of queue items.

## Vendor/Admin Visibility

### Vendor Dashboard

Vendor-visible dashboard counts should answer "what do I need to do?"

Allowed primary counts:

- Awaiting shipment allocations.
- Return review items.
- Open support tickets or unread support replies.
- Settlement estimate and pending review rows with estimate language.
- Vendor-safe automation issue groups only when the vendor can understand or act on them.

Avoid primary vendor counts for:

- raw rule signal totals.
- admin global notification totals.
- diagnostics/reconciliation internals.
- finance debug/reconciliation hints.

### Admin Dashboard

Admin dashboard can include broader operational oversight:

- cross-vendor or selected-vendor support workload.
- automation issue groups plus raw signal drilldown.
- diagnostics and observability summaries.
- finance review rows and blocked settlement rows.
- replay/recover/reconciliation health.

Admin still needs label precision. Raw internal counts are acceptable only when explicitly labeled raw/internal.

## Trust Model Principles

1. A metric must name its counted object.
2. A dashboard queue count must match the destination page's default visible rows or link to an equivalent filter.
3. A currency value must not be labeled as a queue.
4. A raw record count must not be labeled as grouped operational work.
5. Read/dismissed notification history must not inflate active queue counts.
6. Historical records must remain available but should not be confused with current workload.
7. Vendor dashboard counts must be vendor-scoped and vendor-actionable.
8. Admin diagnostics can expose internals, but they must be visually and semantically separate from vendor workflow.
9. Unknown or partially unavailable sources should degrade with source-specific warnings, not fake aligned totals.
10. Source-of-truth ownership should live in one dashboard aggregate contract before further dashboard polish.

## Recommended Implementation Roadmap

### Phase A: Low-Risk Label and Routing Corrections

- Rename Finance review queue to "Settlement estimate" unless it is backed by a row count.
- Rename Support queue to "Unread notifications" or replace its value with support ticket count.
- Rename Automation queue to "Automation alerts + raw signals" only as an interim label.
- Link Awaiting shipment, Blocked allocations, Returns, Support, Automation, and Finance cards to matching filters where possible.
- Keep Notification history passive and separate from queue cards.

### Phase B: Dashboard Aggregate Contract

Create a backend or shared frontend aggregate with explicit fields:

```ts
type DashboardSignalTruth = {
  awaitingShipmentAllocations: { count: number; source: 'orders'; filter: string };
  blockedAllocations: { count: number; source: 'orders'; filter: string };
  returnReviewItems: { count: number; source: 'returns'; filter: string };
  openSupportTickets: { count: number; source: 'support'; filter: string };
  unreadSupportReplies: { count: number; source: 'support'; filter: string };
  automationIssueGroups: { count: number; rawSignalCount: number; source: 'automation_and_rules' };
  financeReviewRows: { count: number; source: 'finance'; filter: string };
  settlementEstimate: { amount: string; source: 'finance' };
  unreadNotifications: { count: number; source: 'notifications' };
};
```

This can initially wrap existing services. It should not change business logic.

### Phase C: Operational Grouping

- Add grouped automation issue summaries.
- Add support context grouping for historical duplicate tickets.
- Add dashboard destination filters.
- Add dashboard tests comparing each queue count to the same predicate used by its destination page.

## Remaining Unknowns

- Whether the production dashboard should be selected-vendor scoped for admins or global by default.
- Whether vendor users should see any automation/rules signal count or only specific vendor-safe issue groups.
- Whether Support queue should prioritize open tickets, unread replies, or SLA/escalation count.
- Whether Finance review queue should count eligible review rows, blocked rows, failed invoice rows, or a separate future settlement-review model.
- Whether Returns queue should include only Shopify return requests or also refund webhook records requiring reconciliation.

These are product semantics decisions, not implementation blockers. The current code evidence is enough to explain the observed count mismatches.
