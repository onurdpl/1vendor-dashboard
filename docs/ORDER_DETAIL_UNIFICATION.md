# Order Detail Unification

## Canonical Detail Strategy

The canonical order detail experience is the routed operational page at `/orders/:orderId`.
It is the primary surface for shipment state, return state, Shopify sync visibility, support
context, finance preview, timeline, and diagnostics.

List-level `View` actions should navigate to this canonical route. The older dense side
detail remains as a lightweight fallback for quick row selection and legacy flows, but new
operational work should land in the routed detail page.

## Deprecated Legacy Modal Strategy

The legacy dense detail surface should not gain new workflows unless a route-based detail
experience cannot support the flow yet. Existing functionality may remain available while
flows are migrated incrementally.

Migration rules:

- Preserve row selection for quick inspection.
- Prefer routed links for operator actions.
- Do not duplicate provider, Shopify, finance, or support workflows in both surfaces.
- Keep fallback copy vendor-safe and compact.

## Operational Information Hierarchy

The routed detail page should prioritize information in this order:

1. Core order, allocation, shipment, and tracking state.
2. Return and support alerts that need action.
3. Read-only finance preview and explicit unknowns.
4. Unified timeline grouped by operational area.
5. Admin-only diagnostics and copy/export tooling.

Vendor views should stay operational and avoid provider/debug terminology. Admin views may
show diagnostics, but they should be grouped and collapsible where practical.

## Dashboard Loading Strategy

The dashboard should render the workspace shell immediately, then populate operational cards
as data loads. Blocking the full page behind a single loading state makes navigation feel
fragile and hides the sidebar/workspace context.

Phase 1 renders dashboard card skeletons while backend-derived overview data is loading.
Future work can move toward stale-while-revalidate behavior so the last known overview stays
visible during refresh.

## Timeline Grouping And Filtering Plan

Phase 1 collapses repeated noisy shipment/status events when they share the same title,
status, and day. Future filtering should expose stable timeline groups:

- Operations
- Returns
- Finance
- Support

Unknown or provider-specific states should remain visible in admin diagnostics, while vendor
timeline wording should stay concise and action-oriented.
