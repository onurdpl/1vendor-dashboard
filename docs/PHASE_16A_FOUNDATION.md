# Phase 16A Foundation System

## Purpose
- Establish the reusable operational UI foundation for the Shopify multi-vendor control center.
- Prepare Returns, Finance, Diagnostics, and Operations Queue for deeper Phase 16B/16C/16D page work without redesigning every page in this phase.
- Preserve existing routing, API integrations, mock mode behavior, and vendor isolation.

## Design Direction
- Inspired by Linear, Stripe Dashboard, Shopify Admin, and modern operational SaaS tooling.
- The interface should favor dense scanning, table-first workflows, quiet hierarchy, and clear operational states.
- Visual styling should stay restrained: white/near-white surfaces, sharp enough borders, light shadows, compact spacing, and muted metadata.

## Token Foundation
- Spacing tokens:
  - `--space-1` through `--space-8`
  - Used for table rhythm, toolbar spacing, panel spacing, shell spacing, and metadata grouping.
- Radius tokens:
  - `--radius-xs`
  - `--radius-sm`
  - `--radius-md`
  - `--radius-lg`
- Surface tokens:
  - `--op-surface`
  - `--op-surface-raised`
  - `--op-surface-soft`
- Border/shadow tokens:
  - `--op-border`
  - `--op-border-strong`
  - `--op-shadow-sm`
  - `--op-shadow-md`
- Text tokens:
  - `--op-text`
  - `--op-text-strong`
  - `--op-muted`
- Operational status tones:
  - success
  - info
  - warning
  - danger
  - attention
  - stale
  - neutral

## Density Philosophy
- Operational screens should prioritize useful rows over decorative space.
- Tables use compact rows by default, with a comfortable density available for detail-heavy views.
- Metadata labels are uppercase, small, and muted; primary values are stronger and easier to scan.
- KPI cards are compact summary instruments, not marketing cards.
- Side panels carry detail context so table rows can stay dense.

## Component Primitives
- `OperationalTable`
  - Dense table wrapper with sticky header support and density mode.
- `OperationalTableRow`
  - Selection-friendly row primitive with keyboard activation.
- `StatusBadge`
  - Shared status badge with tone support and status-to-tone normalization.
- `SeverityBadge`
  - Shared severity badge for queue and diagnostic severity.
- `MetadataRow`
  - Label/value row for detail panels.
- `MetadataGroup`
  - Grouped metadata section for future detail panel composition.
- `SideDetailPanel`
  - Sticky right-side detail panel with header/body/footer rhythm.
- `TimelineBlock`
  - Compact operational lifecycle timeline.
- `KPIStatCard`
  - Compact KPI summary primitive; `KPISummaryCard` remains as compatibility alias.
- `EmptyStatePanel`
  - Shared operational empty state.
- `ActionGroup`
  - Button/action alignment primitive; `OperationalActionGroup` remains as compatibility alias.
- `OperationalToolbar`
  - Shared toolbar container for search, filters, and actions.
- `SearchInput`
  - Standard search input primitive.
- `FilterBar`
  - Inline filter cluster primitive.
- `ShopifyEntityPill`
  - Shopify entity metadata primitive; `ShopifyEntityDisplay` remains as compatibility alias.
- `OperationalSection`
  - Reusable section surface for diagnostics and secondary operational blocks.

## Shell Foundation
- Sidebar spacing, brand scale, nav rhythm, and active navigation treatment were tightened without changing navigation structure.
- Page container spacing and global page typography were normalized.
- The shell remains compatible with the existing route tree and vendor context model.

## Status System
- Standardized operational status tones cover:
  - pending/requested/received/awaiting shipment -> attention
  - fulfilled/delivered/processed/recorded/reconciled/closed/approved -> success
  - failed/declined/cancelled/rejected/error -> danger
  - processing -> info
  - stale/reconciliation/needs-attention -> stale
  - unknown states -> neutral

## Applied Integration
- Returns:
  - Uses foundation table row, toolbar, search, filter, KPI, status, and side panel primitives.
- Finance:
  - Uses foundation table row, toolbar, search, KPI, status, and side panel primitives.
- Diagnostics:
  - Uses foundation table row, KPI, status, section, action, timeline, and side panel primitives.
- Operations Queue:
  - Uses foundation table row, KPI, status, action, timeline, and side panel primitives.

## Preservation Notes
- No backend behavior changed.
- No route architecture changed.
- No app state architecture changed.
- No external UI framework was added.
- Existing real-mode and mock-mode service paths are preserved.
- Existing replay/recover, reconciliation, fulfillment tracking, return/refund visibility, and vendor isolation contracts are preserved.

## Future Phase Usage

### Phase 16B Returns Control Center
- Use `OperationalTable`, `OperationalTableRow`, `SideDetailPanel`, `MetadataGroup`, and `TimelineBlock` as the base page architecture.
- Keep pending return request and processed refund states visually distinct through `StatusBadge` and tone rules.
- Phase 16B implementation update:
  - Returns is now the first full operational workspace built on the foundation.
  - The page uses compact KPIs, an operational toolbar, frontend search/filtering, a dense table, and a right-side detail panel.
  - The table is optimized for scanning status, vendor, customer, Shopify order, Shopify return/refund identifiers, item preview, amount, lifecycle source, updated timestamp, and quick indicators.
  - The detail panel uses existing return detail data for returned item rows, lifecycle timeline, Shopify metadata, refund context, and diagnostics/reconciliation helper context.
  - Pending return requests remain explicitly finance-neutral until `refunds/create`; processed refunds are labeled as refund-ledger records.
  - No backend workflow or route changes were required.

### Phase 16C Finance + Diagnostics
- Use `KPIStatCard`, `OperationalSection`, `StatusBadge`, `SeverityBadge`, and panel metadata primitives.
- Keep diagnostics actions dependent on backend eligibility fields rather than frontend inference.
- Phase 16C implementation update:
  - Finance is now a ledger-oriented control center with compact KPIs, frontend status/source/vendor/search filtering, a dense operational table, and a right-side ledger detail panel.
  - Finance status hierarchy separates recorded refund rows, pending/hold ledger items, failed attention states, and reporting-only payable placeholders without adding payout execution logic.
  - Finance detail panels show ledger metadata, Shopify order/refund identifiers, current vendor scope, and a payout-engine-disabled note.
  - Admin Diagnostics is now an operational event stream with processed/failed/stuck/missing-payload/replayable/recoverable KPIs, topic/status/payload/action-state filters, a dense webhook table, and a right-side recovery detail panel.
  - Replay/recover/reconcile buttons still call backend eligibility-driven services; blocked reasons are displayed from backend DTO fields.
  - Reconciliation display now highlights stale allocations, suggested action, payload availability, no-op/processed states, and admin-triggered reconcile actions.
  - No backend workflow, queue worker, payout engine, or external integration was added.

### Phase 16D Orders + Shell Polish
- Use the same table, toolbar, side panel, and status primitives for order allocation and fulfillment surfaces.
- Extend shell polish incrementally without changing navigation, auth, or vendor context behavior.
- Phase 16D implementation update:
  - Orders is now a dense operational control center with KPIs, search/filter toolbar, table-first scanning, and a right-side order detail panel.
  - Orders table surfaces status, Shopify order, neutral customer label, item count, value, fulfillment, shipping, tracking/carrier, updated timestamp, and compact actions.
  - Orders detail panel hydrates existing order detail data for Shopify identifiers, allocation id, line items, fulfillment/shipping state, carrier/tracking URL, shipment timestamps, and reconciliation helper context.
  - Dashboard is now a command-center workspace with KPI row, priority work, recent activity, finance snapshot, admin diagnostics summary, and workspace status without duplicating the same operational signal list.
  - Shell/sidebar rhythm was tightened with clearer workspace/operations/admin groupings, improved active state, smaller page frame radius, and denser header/context spacing.
  - Cross-workspace fallback wording now uses neutral customer labels instead of developer-facing sync-scope copy.
  - Finance hold/recorded-equivalent refund ledger rows are normalized to `Recorded` in table/detail display; only actual failed/error states render as `Failed`.
  - No backend architecture, route, queue worker, payout engine, or external integration was introduced.

### Phase 16E Operational UX Fidelity Polish
- Density philosophy:
  - Prefer compact operational scan rows over card-like vertical expansion.
  - Preserve emphasis for statuses, amounts, and primary Shopify identifiers while compressing helper text, IDs, timestamps, and metadata labels.
  - Keep fallback labels short and neutral: `Not synced`, `No tracking`, `No URL`, `Customer unavailable`, and `No warning`.
- Viewport-fit strategy:
  - Shared table row height, header height, badge size, metadata row spacing, KPI card height, and drawer padding were tightened.
  - Returns, Finance, Orders, and Diagnostics table minimum widths and column proportions were reduced to fit laptop and standard desktop viewports more naturally.
  - Horizontal overflow remains available for narrow screens, but standard desktop layouts now require substantially less side scrolling.
- Drawer ergonomics:
  - Side panels use narrower max widths, tighter metadata rows, compact timeline rhythm, and viewport-bounded internal scrolling.
  - Detail sections prioritize compact hierarchy over large explanatory blocks.
- Responsive operational layout:
  - Medium desktop layouts keep the table and side panel usable with reduced panel width and denser table columns.
  - Mobile/narrow layouts still collapse panels below tables through existing responsive behavior.

## Remaining Foundation Gaps
- No global icon system was introduced in this phase.
- No full page redesign was completed intentionally.
- No mobile-specific table card pattern was created yet; current behavior relies on horizontal table overflow.
- No Storybook or component catalog exists yet.
- No realtime status updates or background refresh architecture was added.
- After Phase 16B, Returns still depends on currently available backend fields; real product thumbnails, richer customer fields, and direct diagnostics links remain future DTO/workflow improvements.
- After Phase 16C, Finance still uses existing ledger DTOs; richer return/refund joins, payout execution, invoice generation, and vendor payable math remain future finance work.
- After Phase 16C, Diagnostics remains operator-triggered; background retry workers, scheduled reconciliation, alerting, and realtime socket updates remain infrastructure hardening work.
- After Phase 16D, Orders still depends on currently available order detail DTOs; richer customer profiles, direct stale-allocation flags on order summaries, and direct diagnostics deep links remain future DTO/navigation work.
- After Phase 16D, Dashboard remains an aggregate overview; realtime refresh, saved operator views, and cross-workspace drilldown filters are future UX/infrastructure work.
- After Phase 16E, future polish opportunities are mostly workflow-adjacent: saved filters, personalized density preferences, richer entity linking, responsive card alternatives for very small screens, and realtime refresh.
