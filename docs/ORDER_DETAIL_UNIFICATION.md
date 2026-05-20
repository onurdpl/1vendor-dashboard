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

The routed detail page is intentionally dense. It should feel like a working operations
dashboard, closer to Stripe/GitHub/Linear operational surfaces than a spacious marketing
SaaS page. Density is a feature here because operators need to scan shipment, return,
finance, support, and Shopify state together without hunting through oversized cards.

The routed detail page should prioritize information in this order:

1. Core order, allocation, shipment, and tracking state.
2. Return and support alerts that need action.
3. Read-only finance preview and explicit unknowns.
4. Unified timeline grouped by operational area.
5. Admin-only diagnostics and copy/export tooling.

Vendor views should stay operational and avoid provider/debug terminology. Admin views may
show diagnostics, but they should be grouped and collapsible where practical.

Vendor-first order detail hierarchy:

1. Current order health.
2. Shipment and return operations.
3. Next action.
4. Read-only finance preview.
5. Linked operational records.
6. Clean timeline.
7. Diagnostics only when the user has admin context.

## Dense Operational Dashboard Philosophy

The canonical order detail layout should preserve high information density while improving
hierarchy. Incremental polish should tighten alignment, typography, grouping, and scanability
instead of replacing the page with a broad split-workspace or low-density card layout.

Design rules:

- Keep operational sections close together so order, shipment, return, finance, and support
  state can be read in one pass.
- Prefer compact strips, grouped rows, and ledger-style summaries over oversized isolated cards.
- Keep unknown values inline and explicit, but avoid turning every unknown into a large visual
  tile.
- Put shipment and return operations near the top of the operator flow.
- Make linked records visibly clickable without making them visually louder than the active
  order state.
- Preserve responsive stacking on mobile, but keep row density and avoid oversized vertical
  gaps.

## Admin Diagnostics Philosophy

Provider lifecycle, webhook traces, Shopify probe results, and safe payload summaries remain
available to admins, but they should not compete visually with the operational state. These
sections should be grouped into collapsed diagnostics panels by default.

Vendors should never see raw provider payload semantics, webhook parsing language, reverse
shipment internals, provider validation messages, stack traces, API keys, tokens, or Shopify
GraphQL implementation details.

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

Vendor timeline policy:

- Show human operational events such as order created, shipment created, tracking synced,
  delivered, return requested, return tracking attached, Shopify return tracking synced, and
  support ticket created or resolved.
- Hide raw provider events such as webhook received, provider status updated, payload parsed,
  `searchingDriver`, `reverseShipmentProcessing`, and reverse shipment implementation terms.
- Keep unknown or provider-specific states visible in admin diagnostics instead of the vendor
  timeline.
