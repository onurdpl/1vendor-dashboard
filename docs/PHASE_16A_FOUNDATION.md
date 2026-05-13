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

### Phase 16D Orders + Shell Polish
- Use the same table, toolbar, side panel, and status primitives for order allocation and fulfillment surfaces.
- Extend shell polish incrementally without changing navigation, auth, or vendor context behavior.

## Remaining Foundation Gaps
- No global icon system was introduced in this phase.
- No full page redesign was completed intentionally.
- No mobile-specific table card pattern was created yet; current behavior relies on horizontal table overflow.
- No Storybook or component catalog exists yet.
- No realtime status updates or background refresh architecture was added.
- After Phase 16B, Returns still depends on currently available backend fields; real product thumbnails, richer customer fields, and direct diagnostics links remain future DTO/workflow improvements.
