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
- Page loads from a hybrid data model.
- Real-mode orders, returns, and finance queries are live.
- Overview copy and workspace framing are intentionally real-mode placeholders, not a backend-native dashboard model.
- Recent activity is currently empty in real mode.
- Dashboard automation signals are now backed by the real `GET /automation` endpoint.
- Result:
  - usable as a landing page
  - not a complete operational dashboard yet

### Order Detail Actions
- Data load is backend-backed.
- Action visibility is partially meaningful because it reflects allocation state and assigned-vendor ownership.
- Action execution is still mock-only:
  - create shipping label
  - mark as shipped
  - update tracking
  - report fulfillment issue
- Result:
  - detail page is operationally informative
  - action layer is not production-ready in the frontend yet

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

## Mock-Backed Pages

### Dashboard Supporting Signals
- Dashboard overview composition is still local/hybrid.
- Dashboard automation signals now load from the backend, but the surrounding overview composition is still local/hybrid.

### Mock-Only Action Flows Still Present in Real Mode
- Order detail fulfillment buttons
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
- dashboard
- order detail action area
- admin order breakdown action area

### Mock-Backed Today
- dashboard recent/mock overview composition
- fulfillment/tracking action buttons in frontend
- admin reassignment action buttons

## Runtime/API Gaps Identified
- No backend dashboard aggregate endpoint exists; frontend dashboard is composing a partial placeholder instead.
- No frontend wiring yet for the real fulfillment tracking mutation:
  - backend exists: `POST /fulfillments/:allocationId/tracking`
  - frontend order detail still uses mock actions
- No reassignment mutation contract exists for admin order breakdown actions.

## Frontend Mapping Gaps Identified
- Money formatting in real-mode services currently uses USD-style formatting while live Shopify/backend operational data is TRY-based.
- Order summary and detail still rely on placeholder values for:
  - customer text in list views
  - variant title derivation in some cases
- Return summary/detail still rely on placeholder operational labels such as:
  - customer
  - reason
  - condition
  - refund method
  - processed by
- Dashboard real-mode state is intentionally generic instead of reflecting live operational aggregates.
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
- Orders: working.
- Order detail: working for read path, partial for action path.
- Returns: working.
- Return detail: working for read path.
- Finance: working.
- Admin operations: working.
- Admin order breakdown for live order `7613246112081`: working for read path, partial for action path.
- Admin diagnostics: working.
- Automation: working for read path, partial for action path.

## Vendor Flow Assessment
- Login: backend-supported, not re-driven end-to-end in browser during this audit due local input limitation.
- Dashboard: partially working / hybrid.
- Orders: working.
- Order detail for live Yalı Spor allocation: working for read path, partial for action path.
- Returns: working.
- Finance: working.
- Fulfillment/tracking action visibility:
  - visibility is meaningful
  - action execution is still mock-only in the frontend
- Automation: working for read path, partial for action path.
- Admin nav hidden:
  - confirmed in code
- Admin routes denied:
  - confirmed by backend `403`

## Priority Order for Phase 15 Fixes

### Priority 1
- Wire frontend fulfillment/tracking actions to the real backend mutation.
- Finish real-mode dashboard strategy so it no longer depends on mock-only operational signals.

### Priority 2
- Clean up real-mode data mapping for money/currency formatting and operational field labels.
- Improve order detail and return detail to use richer backend-backed metadata instead of placeholders.
- Replace admin mock reassignment affordances with clearly disabled/read-only operational messaging until real mutations exist.

### Priority 3
- Polish diagnostics and reconciliation UX for operator clarity.
- Improve real-mode loading, error, and backend-unavailable states across the remaining hybrid pages.
- Expand real-mode browser verification coverage once the login/input automation limitation is no longer blocking local audit work.

## Recommended Immediate Phase 15 Focus
- Treat automation and dashboard real-mode behavior as the first frontend operationalization target.
- Treat fulfillment action wiring as the first meaningful vendor write-path completion target.
- Treat data-shape and operational-language cleanup as the next confidence-building layer after route viability is solid.
