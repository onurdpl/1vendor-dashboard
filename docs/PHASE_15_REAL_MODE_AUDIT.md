# Phase 15 Real-Mode Frontend Audit

## Purpose
- Capture the current state of the frontend when `VITE_API_MODE=real` is used against the live-capable backend.
- Distinguish fully working backend-backed pages from hybrid, mock-backed, and broken paths.
- Give Phase 15 a priority-ordered frontend gap list before implementation work begins.

## Audit Method
- Backend started on `http://127.0.0.1:4000`.
- Frontend expected on `http://127.0.0.1:5173` in real mode.
- Admin and vendor route viability assessed through:
  - backend API verification
  - frontend runtime-service wiring review
  - route and page-component inspection
- Note:
  - authenticated browser automation is still limited by the local login/input-control issue in the in-app browser
  - where that prevented a full visual pass, the audit uses confirmed backend responses plus page wiring instead of inventing browser results

## Fully Working Real-Mode Pages
- Orders list
  - backend-backed
  - admin and vendor vendor-scoping verified
- Order detail
  - backend-backed for data load
  - live allocation detail verified through backend responses
- Returns list
  - backend-backed
  - vendor isolation verified
- Return detail
  - backend-backed for data load
  - vendor isolation verified
- Finance
  - backend-backed
  - vendor-scoped data verified
- Admin Operations
  - backend-backed
  - admin-only access verified
- Admin Shopify order breakdown
  - backend-backed
  - live order `7613246112081` breakdown verified
- Admin Diagnostics
  - backend-backed
  - reconciliation, webhook detail, and replay route viability verified

## Partially Working Pages

### Dashboard
- Real mode now derives its overview from backend-backed orders, returns, finance, automation, admin operations, and diagnostics services.
- KPI cards, priority work, finance snapshot, recent activity, and admin diagnostics summary are built from live backend data when available.
- Partial backend failures now degrade gracefully into warning notes instead of crashing the entire dashboard.
- Result:
  - no longer a placeholder/hybrid landing view in real mode
  - still not a dedicated backend-native aggregate contract, but operationally meaningful today

### Order Detail Actions
- Data load is backend-backed.
- Action visibility is partially meaningful because it reflects allocation state and assigned-vendor ownership.
- Tracking submission is now wired to the real backend fulfillment mutation in real mode.
- Real-mode order detail now presents live allocation ownership, Shopify order identifiers, fulfillment/shipping status, and tracking state more clearly.
- Already-shipped allocations now show a live tracking summary instead of encouraging duplicate submission.
- Remaining mock-only actions:
  - create shipping label
  - mark as shipped
  - report fulfillment issue
- Result:
  - detail page is operationally useful for vendor tracking submission and live fulfillment readability
  - the broader action layer is still not fully production-ready in the frontend yet

### Admin Shopify Order Breakdown
- Breakdown data is real.
- Reassignment controls are still mock-only and do not map to a backend mutation.
- Result:
  - good read surface
  - incomplete write workflow

### Diagnostics Workspace
- Data load and replay action are real-mode/backend-backed.
- Operationally useful today.
- Still needs polish for:
  - clearer recovery grouping
  - stronger operator cues
  - better real-mode UX fit with the rest of the app

### Returns and Refund Detail
- Data load is backend-backed.
- Real-mode returns pages now surface Shopify refund identifiers, vendor ownership, refunded SKU visibility, and refund webhook context more clearly.
- Refund detail now frames refund requested vs. refund processed state more explicitly and points operators to finance linkage instead of placeholder copy.
- Result:
  - refund visibility is materially clearer in real mode
  - deeper finance/refund cross-linking is still informational rather than navigable

## Mock-Backed Pages

### Dashboard Supporting Signals
- Mock mode still uses the local/dashboard composition path.
- Real mode now uses a frontend-derived aggregation layer over backend services rather than a dedicated dashboard backend route.

### Mock-Only Action Flows Still Present in Real Mode
- Order detail non-tracking fulfillment buttons
- Order detail issue reporting button
- Admin reassignment action buttons
- Finance export feedback action

## Broken Pages or Broken Real-Mode Behaviors

### Automation Page
- Read path is now backend-backed in real mode through `GET /automation`.
- Alerts and suggestions load from vendor-scoped backend operational state.
- Action buttons are still non-mutating/local UX only.
- Impact:
  - page is usable for read visibility
  - action execution is not production-ready yet

### Dashboard Automation Dependency
- Dashboard is not fully broken, but it remains coupled to a hybrid overview model instead of a backend-native dashboard aggregate.
- Impact:
  - less operational depth than the rest of the real-mode shell
  - reduced operator confidence compared with fully backend-backed pages

## Backend-Backed vs Mock-Backed Summary

### Backend-Backed Today
- login
- orders list
- order detail data
- returns list
- return detail data
- finance
- automation read surface
- admin operations
- admin Shopify order breakdown
- admin diagnostics
- webhook/reconciliation/replay surfaces

### Hybrid Today
- order detail action area
- admin order breakdown action area

### Mock-Backed Today
- dashboard recent/mock overview composition
- fulfillment/tracking action buttons in frontend
- admin reassignment action buttons

## Runtime/API Gaps Identified
- No backend dashboard aggregate endpoint exists; real mode currently composes its dashboard from multiple backend service calls on the frontend.
- Remaining order-detail action gap:
  - backend exists: `POST /fulfillments/:allocationId/tracking`
  - frontend now uses it for tracking submission only
  - other fulfillment actions still remain mock-only
- No reassignment mutation contract exists for admin order breakdown actions.
- Return lifecycle webhooks now support backend pending return ingestion and minimal frontend visibility in real mode; deeper operational UX and actions remain pending.

## Frontend Mapping Gaps Identified
- Money formatting in real-mode services currently uses USD-style formatting while live Shopify/backend operational data is TRY-based.
- Order summary and detail still rely on placeholder values for:
  - customer text in list views
  - variant title derivation in some cases
- Return summary/detail still rely on placeholder operational labels such as:
  - condition
- Dashboard real-mode state is intentionally generic instead of reflecting live operational aggregates.
- Dashboard real-mode state is now backend-derived, but still assembled client-side rather than provided by a dedicated dashboard contract.
- Fulfillment state labels are mapped, but frontend copy still assumes mock workflow language in several places.

## Auth / Vendor Context Findings
- Backend vendor scoping works correctly for admin and vendor API access.
- Vendor admin-route denial is verified at the backend.
- App shell vendor visibility logic is correct in code:
  - admin sees admin navigation
  - vendor does not see admin-only nav items
- Real-mode session model supports backend vendor slugs correctly.

## Console Errors / API 404s
- The previously confirmed real backend `404` for `GET /automation` is fixed in current source and verification coverage.
- Authenticated browser console could not be fully captured in this audit because local login automation remains limited in the in-app browser.
- Based on route wiring, the clearest remaining real-mode gaps are hybrid dashboard composition and mock-only action areas rather than a missing automation route.

## Admin Flow Assessment
- Login: backend-supported, previously verified in real mode, not re-driven end-to-end in browser during this audit due local input limitation.
- Dashboard: partially working / hybrid.
- Dashboard: backend-derived and operationally meaningful.
- Orders: working.
- Order detail: working for read path, partial for action path.
- Returns: working.
- Return detail: working for read path with improved live refund clarity.
- Finance: working.
- Admin operations: working.
- Admin order breakdown for live order `7613246112081`: working for read path, partial for action path.
- Admin diagnostics: working.
- Automation: working for read path, partial for action path.

## Vendor Flow Assessment
- Login: backend-supported, not re-driven end-to-end in browser during this audit due local input limitation.
- Dashboard: partially working / hybrid.
- Dashboard: backend-derived and operationally meaningful for the current vendor scope.
- Orders: working.
- Order detail for live Yalı Spor allocation: working for read path, partial for action path.
  - tracking submission path is real-mode/backend-backed
  - readability for live allocation state is improved
- Returns: working.
- Return detail readability for live refund records is improved.
- Finance: working.
- Fulfillment/tracking action visibility:
  - visibility is meaningful
  - tracking submission is real
  - other actions are still mock-only in the frontend
- Automation: working for read path, partial for action path.
- Admin nav hidden:
  - confirmed in code
- Admin routes denied:
  - confirmed by backend `403`

## Priority Order for Phase 15 Fixes

### Priority 1
- Decide whether to keep the frontend-derived dashboard aggregation approach or replace it with a dedicated backend dashboard contract later.
- Decide whether to add real equivalents for the remaining non-tracking fulfillment actions or intentionally remove/mock-gate them in real mode.

### Priority 2
- Clean up real-mode data mapping for money/currency formatting and operational field labels.
- Improve remaining return-detail metadata such as condition and richer refund provenance only when backend sync provides it.
- Replace admin mock reassignment affordances with clearly disabled/read-only operational messaging until real mutations exist.

### Priority 3
- Polish diagnostics and reconciliation UX for operator clarity.
- Improve real-mode loading, error, and backend-unavailable states across the remaining hybrid pages.
- Expand real-mode browser verification coverage once the login/input automation limitation is no longer blocking local audit work.

## Phase 15-7 Admin Tooling Polish Update
- Admin operations queue real-mode readability improved with clearer source labeling for:
  - awaiting shipment
  - blocked allocation
  - pending reassignment
  - refund attention
  - pending return request (when identifiable from queue context)
  - webhook/reconciliation issue context
- Admin diagnostics and reconciliation real-mode UX improved with:
  - explicit replay eligibility cues
  - clearer payload-availability messaging
  - clearer suggested-action/replay relationship
- Returns admin real-mode clarity improved with:
  - distinct lifecycle framing for pending return requests vs processed refunds
  - clearer source-type labeling
  - clearer pending-return finance wording (no refund ledger until refunds/create)

## Phase 15-8 Consistency Update
- Real-mode currency formatting is now normalized across orders, returns, and finance mappings (consistent symbol/precision).
- Operational lifecycle wording is now more consistent across admin tooling and return pages:
  - pending return request
  - processed refund
  - awaiting shipment
  - blocked allocation
  - replay eligibility messaging
- Shopify metadata labels were normalized for readability:
  - Shopify Order Number
  - Shopify Order ID
  - Shopify Return ID
  - Shopify Refund ID
  - consistent fallback: `Not available`
- Empty-state copy was refined for finance and automation views to reduce ambiguous “blank” states and improve operator clarity.

## Phase 15-10 Operational UX Cleanup Update
- Returns workspace readability improved with denser record cards, clearer lifecycle language, and clearer Shopify entity labeling.
- Pending return requests are now visually and semantically distinct from processed refund records in both list and detail views.
- Return detail now separates lifecycle framing and metadata to reduce confusion between return-request state and refund state.
- Finance workspace now surfaces Shopify metadata with consistent labels:
  - Shopify Order Number
  - Shopify Order ID
  - Shopify Refund ID
- Diagnostics workspace now makes replay/recovery eligibility clearer with payload-availability and recoverability cues.
- Operations queue now surfaces clearer lifecycle/source labeling for faster triage scanning.
- Remaining known gaps:
  - no async queue worker yet
  - no return approve/decline frontend mutation actions yet
  - no admin reassignment mutation yet

## Phase 15-9 Backend Recovery Lifecycle Prep
- Webhook processing lifecycle boundaries are now explicit and consistently used:
  - `RECEIVED` -> `PROCESSING` -> `PROCESSED` / `FAILED`
- Admin recovery tooling now includes:
  - replay endpoint (existing)
  - recover endpoint for stuck/failed webhook events with payload availability
- Reconciliation suggestions now point operators toward recover/replay when payload exists, and manual recovery when payload is missing.
- No queue worker was introduced in this phase; recovery remains explicit and operator-driven.

## Remaining Gaps After Phase 15-8
- No return approve/decline/close mutation actions in frontend yet.
- No admin reassignment mutation in real mode yet.
- No async queue worker architecture in production runtime yet.

## Phase 16 Operational Control-Center Redesign
- Returns now use a control-center layout with:
  - KPI summary row
  - search/status toolbar
  - dense operational table
  - right-side detail panel
  - clear pending-return vs processed-refund semantics
- Finance now uses a denser ledger table with Shopify order/refund metadata and a focused detail panel.
- Admin diagnostics now reads like an event/recovery stream with:
  - webhook lifecycle status
  - payload availability
  - recoverability labels
  - replay and recover action hierarchy
  - reconciliation and sync event panels
- Phase 16-3I tightened diagnostics into a safer operator workflow:
  - webhook detail now uses safe metadata, payload hash, affected Shopify entity hints, and a truncated payload preview instead of returning full raw payload by default
  - replay/recover actions now show backend-computed eligibility and blocked reasons
  - replay/recover responses include before/after status, explicit result status, affected counts where available, and safe error summaries
  - reconciliation guidance now distinguishes recover recommended, replay available, manual investigation, and no-action states
- Phase 16-3J adds admin-triggered Shopify state reconciliation:
  - diagnostics can surface stale allocation heuristics
  - admins can reconcile one allocation or a full Shopify order against canonical Shopify fulfillment state
  - safe repairs cover fulfillment/shipping status, tracking metadata, shipment timestamps, stale refund/return status, and missing refund ledger entries
  - reconciliation remains admin-only, line-item scoped, and operator-triggered; no queue worker was introduced
- Admin operations queue now uses a denser queue table with source, lifecycle, urgency, and action context.
- App shell styling was tightened toward the operational control-center baseline while preserving existing routes and session/vendor behavior.
- Remaining future direction:
  - async workers for webhook/recovery execution
  - operational analytics and alerting
  - payout/reconciliation expansion
  - advanced automation tooling
  - admin reassignment and return lifecycle mutation workflows

## Phase 16B Returns Control Center
- Returns is now a production-grade operational workspace rather than a lightweight list/detail surface.
- The workspace uses:
  - compact KPI summary row for pending requests, approved items, processed refunds, cancelled/declined outcomes, posted refund amount, and attention load
  - operational search and filters for order number, Shopify return/refund id, SKU, customer, lifecycle status, source type, and visible vendor rows
  - dense table-first scanning with status, vendor, customer, Shopify order, source entity, item preview, amount, lifecycle/source, update timestamp, and quick indicators
  - right-side detail panel backed by the existing return detail endpoint for item rows, lifecycle timeline, Shopify metadata, refund context, and diagnostics/reconciliation helper context
- Pending Shopify return requests are visually and semantically separated from processed refunds:
  - pending return request: no finance ledger, no refund-posted assumption
  - processed refund: refund webhook allocation, vendor-scoped finance visibility
- Vendor isolation remains unchanged:
  - list/detail data still comes from existing vendor-scoped runtime services and backend contracts
  - no cross-vendor data aggregation was added to the Returns page
- Remaining gaps before deeper returns automation:
  - no approve/decline/close frontend mutation actions yet
  - no product image thumbnails from backend yet; placeholder thumbnails are used
  - no direct diagnostics event deep-linking from a return record yet
  - richer customer fields depend on future backend DTO expansion

## Phase 16C Finance + Diagnostics Control Centers
- Finance is now a production-grade operational ledger workspace:
  - compact KPIs for recorded refunds, total refund amount, pending/hold items, failed attention items, and vendor payable placeholder
  - frontend filters for status, source/type, vendor scope, Shopify order/refund identifiers, and amount/search text
  - dense ledger table showing status, source, vendor, Shopify order number/id, Shopify refund id, amount, lifecycle label, timestamp, and quick view action
  - right-side detail panel for ledger metadata, Shopify identifiers, vendor isolation context, related refund context, and payout-engine-disabled guidance
- The Finance page remains reporting-only:
  - no payout engine was introduced
  - no invoice generation was introduced
  - no new payout math was invented beyond existing backend summary fields
- Admin Diagnostics is now a recovery-oriented event stream:
  - compact KPIs for processed, failed, received/stuck, missing payload, replayable, and recoverable events
  - frontend filters for topic, status, payload availability, replay/recover eligibility, and entity/error search
  - dense webhook table showing event identity, payload state, backend eligibility, affected Shopify entity, and replay/recover actions
  - right-side detail panel for timeline, topic, webhook id, event id, shop domain, payload hash/idempotency key, affected entity hints, blocked reasons, safe error summaries, and payload preview
- Reconciliation UX now emphasizes:
  - stale allocation signals
  - recommended operator action
  - payload availability
  - no-op/processed states
  - admin-triggered allocation/order reconciliation actions
- Existing production constraints remain:
  - replay/recover/reconcile calls still use backend services and backend eligibility fields
  - diagnostics/recovery remains admin-only by route/permission model
  - vendor isolation is preserved by existing Finance service scope
  - no queue worker, scheduled job, realtime socket, payout engine, ERP/cargo integration, invoice generation, or shipment label generation was introduced
- Remaining gaps before Phase 16D:
  - Finance detail records still depend on existing ledger DTO fields; richer return/refund joins are future DTO work
  - Diagnostics does not auto-refresh or run background retries
  - Reconciliation remains operator-triggered
  - Direct cross-links from finance/refund rows to diagnostics events remain future navigation work

## Phase 16D Orders, Dashboard, and Shell Polish
- Orders is now a production-grade operational control center:
  - compact KPIs for vendor orders, awaiting shipment, blocked/attention items, fulfilled orders, and tracking visibility
  - frontend filters for allocation state, fulfillment state, shipping state, and free-text search across Shopify order, customer, tracking, carrier, amount, and vendor metadata
  - dense orders table for status, Shopify order, customer, item count, value, fulfillment, shipping, tracking/carrier, updated timestamp, and compact actions
  - right-side detail panel backed by existing order detail data for Shopify identifiers, allocation id, customer fallback, line items, fulfillment/shipping status, carrier/tracking URL, fulfillment/shipment timestamps, and reconciliation guidance
- Dashboard is now a command-center workspace:
  - KPI row uses existing dashboard stats
  - priority work appears once
  - recent activity, finance snapshot, diagnostics summary, and workspace status are separated into compact operational sections
  - duplicated operational-signal sections and large low-value whitespace were removed
- Shell/sidebar polish:
  - navigation is grouped into Workspace, Operations, and Admin tools
  - active navigation state, session/vendor cards, page frame spacing, and top header rhythm were tightened
  - responsive behavior preserves existing routes and auth/vendor context
- Cross-workspace polish:
  - customer fallback copy now uses neutral labels such as `Customer unavailable`
  - operational timelines have clearer spacing between labels and dates
  - side detail panels and dense tables use more consistent widths and overflow behavior
- Finance status display correction:
  - hold/recorded-equivalent refund ledger rows render as `Recorded`
  - only failed/error states render as `Failed`
  - table and detail panel use the same display normalization
- Remaining gaps before Phase 16E:
  - Orders still does not expose direct diagnostics deep links or explicit stale-allocation fields in the order DTO
  - Dashboard has no realtime refresh or saved operator views
  - Customer profile enrichment remains future backend DTO work
  - Reconciliation remains admin/operator-triggered

## Phase 16E Operational UX Fidelity Polish
- The control-center UI now uses a tighter operational density baseline across Returns, Finance, Orders, Dashboard, Diagnostics, and shared shell surfaces.
- Viewport-fit strategy:
  - table row height, header height, column gaps, KPI card height, metadata row spacing, badge scale, and drawer padding were reduced
  - Returns, Finance, Orders, and Diagnostics table minimum widths were reduced so standard desktop/laptop viewports require far less horizontal scrolling
  - table overflow remains as a safety mechanism on narrow screens
- Drawer and timeline ergonomics:
  - side panels use narrower widths and internal viewport-bounded scrolling
  - metadata groups and timelines are more compact
  - repetitive helper paragraphs were shortened where they were not operationally necessary
- Fallback wording:
  - developer-facing or verbose fallback copy was replaced with compact labels such as `Not synced`, `No tracking`, `No URL`, `No warning`, and `Customer unavailable`
- Dashboard polish:
  - command-center sections use tighter spacing, denser priority/activity rows, and compact metadata presentation
- Production behavior preserved:
  - no backend architecture changed
  - no queue workers, payout engine, external integrations, routing rewrite, or state architecture rewrite were introduced
  - replay/recover/reconcile actions, finance ledger logic, fulfillment tracking visibility, and vendor isolation remain on existing service contracts
- Remaining future UX opportunities:
  - saved filters and saved workspace views
  - user-selectable density preferences
  - richer entity linking between orders/returns/finance/diagnostics
  - realtime refresh and proactive alerting
  - responsive card alternatives for very small screens

## Phase 16-3C Inbound Fulfillment Sync
- Backend now supports inbound Shopify fulfillment status refresh for:
  - `FULFILLMENTS_CREATE`
  - `FULFILLMENTS_UPDATE`
  - `FULFILLMENT_EVENTS_CREATE`
- Fulfillment webhook payloads are treated as trigger/envelope metadata; backend fetches canonical Shopify fulfillment state before updating allocations.
- Allocation status updates are line-item scoped so partial multi-vendor fulfillment cannot mark unrelated vendor allocations fulfilled.
- Tracking metadata is shown only when Shopify provides tracking info.
- Remaining verification gap:
  - live registration and a production Shopify Admin fulfillment/delivery event should be tested to confirm this store emits the expected fulfillment event sequence.

## Phase 16-3E Fulfillment Tracking Stabilization
- Inbound fulfillment sync now hydrates canonical Shopify fulfillment tracking and shipment timestamps into vendor order detail:
  - carrier
  - tracking number
  - tracking URL
  - fulfilled at
  - shipment created at
  - shipment updated at
- Fulfillment event status is scoped to the matching Shopify fulfillment id before shipping status updates are applied.
- If Shopify does not provide `trackingInfo`, the UI keeps carrier/tracking fields unassigned while still showing fulfillment timestamps when Shopify provides them.
- Remaining verification gap:
  - production Phase 16-3F should confirm Render receives a fresh fulfillment update and the live panel/API shows tracking and timestamps for the affected allocation.

## Phase 16-3H Operational Hardening
- Shopify webhook registration scripts now handle mixed registration state safely:
  - existing topics no longer block missing-topic registration
  - duplicate/address-taken responses trigger subscription re-check and continue
  - summaries report created/existing/failed topics after all attempts
- Finance status mapping now treats successful refund ledger records (`hold` lifecycle) as non-failure (`Recorded`) instead of `Failed`.

## Recommended Immediate Phase 15 Focus
- Treat automation and dashboard real-mode behavior as the first frontend operationalization target.
- Treat fulfillment action wiring as the first meaningful vendor write-path completion target.
- Treat data-shape and operational-language cleanup as the next confidence-building layer after route viability is solid.
