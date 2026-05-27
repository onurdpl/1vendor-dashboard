# Role-Aware Operational Model

## Purpose

This document defines how the operational workspace should separate vendor workflow from admin oversight without splitting the product architecture prematurely.

The current product mixes vendor operations and admin control-plane work in shared pages. That is useful while the platform is still converging, but it creates noise because vendors and admins do different jobs.

This document is discovery and design only. It does not change routes, auth semantics, backend business logic, provider behavior, finance calculations, Shopify ingestion, or vendor isolation.

## Files Audited

- `src/pages/DashboardPage.tsx`
- `src/pages/OrdersPage.tsx`
- `src/pages/OrderDetailPage.tsx`
- `src/pages/ReturnsPage.tsx`
- `src/pages/ReturnDetailPage.tsx`
- `src/pages/FinancePage.tsx`
- `src/pages/VendorInboxPage.tsx`
- `src/pages/VendorSupportTicketsPage.tsx`
- `src/pages/VendorProfilePage.tsx`
- `src/pages/AutomationPage.tsx`
- `src/pages/AdminDiagnosticsPage.tsx`
- `docs/DASHBOARD_OPERATIONAL_MODEL.md`
- `docs/UNIFIED_OPERATIONAL_WORKSPACE_MODEL.md`
- `docs/OPERATIONAL_STABILITY_GUIDELINES.md`
- `docs/ORDER_DETAIL_UNIFICATION.md`

## Role Goals

### Vendor Operational Goals

Vendor users need a focused daily workspace:

- Fulfill orders.
- Resolve missing tracking and shipment attention items.
- Review and manage returns.
- See settlement previews with honest estimate language.
- Respond to support messages and configuration correction requests.
- Understand read-only store/provider configuration enough to ask for help.

Vendor users do not need the platform control plane in their normal workflow.

### Admin Operational Goals

Admin users need operational oversight and recovery tooling:

- Monitor selected-vendor and future cross-vendor queues.
- Review reconciliation and stale-state pressure.
- Investigate provider and Shopify sync failures.
- Manage settlement review and finance reconciliation.
- Monitor automation health and failed operational jobs.
- Handle escalations, support patterns, and diagnostics.
- Preserve replay/recovery auditability.

Admin users need deeper evidence, but diagnostics should still be safe, scoped, and visually subordinate to the active workflow.

## Ownership Classifications

Use these classifications when deciding whether a section should be visible, prominent, muted, collapsed, or admin-only.

| Classification | Meaning | Vendor Treatment | Admin Treatment |
| --- | --- | --- | --- |
| Vendor operational | Daily work the vendor can act on directly. | Primary. | Visible when useful for support/oversight. |
| Admin operational | Operational work that requires admin permissions or platform context. | Hidden or summarized in vendor-safe language. | Primary. |
| Shared operational | Useful to both roles but may need role-specific wording. | Visible with vendor-safe labels. | Visible with optional admin detail. |
| Passive analytics | Contextual metrics and history. | Secondary. | Secondary unless tied to an active review. |
| Internal diagnostics | Implementation, provider, webhook, or recovery detail. | Hidden. | Admin-only, redacted, usually collapsed. |

## Section Ownership Matrix

### Dashboard

| Section / Widget / Action | Classification | Vendor Fit | Admin Fit | Guidance |
| --- | --- | --- | --- | --- |
| Needs attention | Shared operational | Primary | Primary | Keep top-level, but role-worded. |
| Awaiting shipment | Vendor operational | Primary | Useful | Core vendor work. |
| Tracking missing | Vendor operational | Primary | Useful | Vendor-safe action language. |
| Returns/refunds needing review | Shared operational | Primary | Primary | Vendor sees operational review, not raw refund reconciliation. |
| Blocked allocation | Admin operational | Secondary if vendor-actionable | Primary | Vendor wording should say blocked order work only when they can act. |
| Automation signals | Admin operational / shared | Muted or read-only | Primary | Vendor should not see backend/system-health phrasing. |
| Operational queues | Shared operational | Primary | Primary | Queue cards should be role-filtered later. |
| Finance review queue | Shared operational | Secondary estimate view | Primary review surface | Vendor sees pending review; admin sees review pressure. |
| Support queue | Shared operational | Primary | Primary | Vendor sees replies/action needed; admin sees escalations and workload. |
| KPI strip | Passive analytics | Secondary | Secondary | Do not outrank action work. |
| Recent operational events | Passive analytics | Secondary/collapsed | Secondary | Group repeated signals. |
| Notification history | Passive analytics | Muted/collapsed | Useful history | Vendor feed should emphasize actionable unread items. |
| Finance snapshot | Passive analytics | Settlement estimate only | Settlement/review summary | Avoid balance/payable/final language. |
| Diagnostics summary | Internal diagnostics | Hidden | Primary/secondary admin | Admin-only. |
| Operational health | Internal diagnostics | Hidden | Primary/secondary admin | Admin-only. |
| Workspace status | Passive analytics | Secondary | Secondary | Keep compact. |

### Orders

| Section / Widget / Action | Classification | Vendor Fit | Admin Fit | Guidance |
| --- | --- | --- | --- | --- |
| Orders queue | Vendor operational | Primary | Primary | Shared list, vendor-scoped. |
| Search/filter command bar | Shared operational | Primary | Primary | Same controls, role-safe scope. |
| KPI metrics strip | Passive analytics | Secondary | Secondary | Should not compete with queue actions. |
| Row actions/open detail | Shared operational | Primary | Primary | Link to canonical order detail. |
| Right inspector summary | Shared operational | Primary | Primary | Vendor-safe shipment state, admin can see more context. |
| Smart label/shipment actions | Vendor operational | Primary when permitted | Primary | Preserve provider duplicate guards. |
| Inspector timeline | Shared operational | Primary | Primary | Use vendor-safe lifecycle labels. |
| Operational insights/automation signals | Passive/admin hybrid | Secondary or hidden if noisy | Useful | Should move toward role-aware sections. |

### Order Detail

| Section / Widget / Action | Classification | Vendor Fit | Admin Fit | Guidance |
| --- | --- | --- | --- | --- |
| Header/status metadata | Shared operational | Primary | Primary | Same frame, role-aware chips. |
| Shipment action center | Vendor operational | Primary | Primary | Vendor sees workflow; admin may see recovery hints. |
| Return alerts and linked return | Vendor operational | Primary | Primary | Vendor-safe return status. |
| Settlement preview | Shared operational | Secondary/visible | Visible with admin hints | Estimated/unknown language only. |
| Finance timeline | Shared operational | Secondary | Visible | Vendor hides admin reconciliation internals. |
| Linked records | Shared operational | Secondary | Visible | Group support and finance context. |
| Support activity | Shared operational | Secondary unless active | Visible | Group duplicate/historical support. |
| Provider diagnostics | Internal diagnostics | Hidden | Admin-only collapsed | No raw provider noise for vendors. |
| Shopify fulfillment diagnostics | Internal diagnostics | Hidden | Admin-only collapsed | Redacted and scoped. |
| Recovery/replay/admin probes | Internal diagnostics | Hidden | Admin-only | Keep out of vendor workflow. |

### Returns

| Section / Widget / Action | Classification | Vendor Fit | Admin Fit | Guidance |
| --- | --- | --- | --- | --- |
| Returns queue | Vendor operational | Primary | Primary | Vendor-scoped operational work. |
| Returned items summary | Vendor operational | Primary | Primary | Product/item context, no diagnostic dump. |
| Return status and reason | Shared operational | Primary | Primary | Keep status simple. |
| Right inspector timeline | Shared operational | Primary | Primary | Align with `OperationalTimeline`. |
| Return Detail link | Shared operational | Primary | Primary | Deep workspace for full context. |
| Finance/support linked context | Shared operational | Secondary | Useful | Group rather than spam. |

### Return Detail

| Section / Widget / Action | Classification | Vendor Fit | Admin Fit | Guidance |
| --- | --- | --- | --- | --- |
| Returned items | Vendor operational | Primary | Primary | Core return evidence. |
| Return summary/timeline | Shared operational | Primary | Primary | Vendor-safe lifecycle. |
| Navlungo return pickup evidence | Vendor operational | Read-only unless permitted | Primary | Vendor sees status/evidence, not payload details. |
| Missing pickup address completion | Admin operational | Hidden/edit blocked | Primary | Admin completion only. |
| Provider return diagnostics | Internal diagnostics | Hidden | Admin-only collapsed | Keep redacted. |
| Shopify return/refund diagnostics | Internal diagnostics | Hidden | Admin-only collapsed | Do not imply Shopify state changes unless implemented. |
| Linked finance/support records | Shared operational | Secondary | Visible | Group and role-filter. |

### Finance

| Section / Widget / Action | Classification | Vendor Fit | Admin Fit | Guidance |
| --- | --- | --- | --- | --- |
| Finance table | Shared operational | Settlement estimate view | Review queue | Same records, different emphasis. |
| Settlement estimate KPI | Shared operational | Secondary/visible | Visible | Avoid balance/payable wording. |
| Pending review | Shared operational | Visible as read-only | Primary | Admin owns review workflow. |
| Draft payout review | Admin operational | Hidden or read-only as settlement review | Primary | No payment execution implied. |
| Vendor finance profile form | Admin operational | Read-only profile | Editable if admin | Do not expose editor to vendor. |
| Settlement preview inspector | Shared operational | Visible | Visible | Estimated/unknown language. |
| Customer invoice/accounting | Internal/admin operational | Hidden | Admin-only | Do not expose accounting internals. |
| Shipping cost attachment | Admin operational | Hidden | Admin-only | Reconciliation action. |
| Finance timeline | Shared operational | Vendor-safe lifecycle | Admin may see hints | No fake payout events. |
| Support activity grouping | Shared operational | Visible if linked | Visible | Group historical duplicates. |

### Support And Inbox

| Section / Widget / Action | Classification | Vendor Fit | Admin Fit | Guidance |
| --- | --- | --- | --- | --- |
| Communication center feed | Vendor operational | Primary | Useful if scoped | Vendor-safe combined feed. |
| Support ticket list | Vendor operational | Primary | Useful if scoped | Vendor sees own support requests. |
| Unread/action filters | Vendor operational | Primary | Useful | Keep simple. |
| Selected message context | Shared operational | Primary | Primary | Could become inspector-like later. |
| Escalation handling | Admin operational / shared | Vendor sees status only | Primary | Vendor should not manage internal escalation states. |
| Internal notes | Internal diagnostics/admin operational | Hidden | Admin/support only | Do not render dead vendor buttons. |

### Vendor Profile

| Section / Widget / Action | Classification | Vendor Fit | Admin Fit | Guidance |
| --- | --- | --- | --- | --- |
| Store identity/readiness | Vendor operational | Primary | Useful | Read-only vendor view. |
| Operational readiness workspace | Shared operational | Primary | Useful | Checklist should answer whether the vendor is operationally ready using only real configuration/workflow visibility. |
| Marketplace terms | Shared operational | Read-only | Admin-owned | Vendor sees terms, not editor unless supported. |
| Shipping operations | Shared operational | Read-only summary | Admin-owned config | Keep IDs visible but not dominant. |
| Warehouse/return destination | Shared operational | Read-only summary | Admin-owned config | Use readable location plus ID. |
| Integration status | Shared operational | Visible | Visible | Vendor-safe status labels. |
| Request profile correction | Vendor operational | Primary support CTA | Useful | Must reuse/open support workflow, avoid duplicates. |
| Fields not modeled yet | Passive analytics / future | Collapsed/muted | Useful planning | Keep low visual weight. |

## Vendor Operational Readiness

Vendor Profile now acts as a lightweight readiness workspace. It is not an onboarding automation engine and does not create payout, accounting, provider, or Shopify behavior. Its job is narrower:

```text
Existing configuration and workflow visibility -> is this vendor operationally ready?
```

Readiness sections must use only currently available truth:

- Shipping ready: shipping enabled, provider metadata present, and warehouse or sender address configured.
- Returns ready: return destination configured and return workflow visible for the current vendor context.
- Finance visibility ready: finance profile/settlement preview visible as estimates, with active marketplace terms when available.
- Support channel active: support route and profile correction context available.
- Workflow access ready: current user/vendor context is loaded and scoped before queues are trusted.
- Automation visibility ready: conservative visibility only; vendor-specific automation alert readiness is `Not modeled yet` until modeled explicitly.

Readiness labels must avoid fake certainty. Missing, failed, or unmodeled data should render `Unknown`, `Requires configuration review`, or `Not modeled yet`, not a green state.

Readiness is role-aware but shared: vendors see a read-only operational checklist and correction/support actions; admins see the same truth with admin-owned configuration context preserved. Vendor isolation still applies to all linked queues and support records.

### Automation

| Section / Widget / Action | Classification | Vendor Fit | Admin Fit | Guidance |
| --- | --- | --- | --- | --- |
| Automation alerts | Admin operational / shared | Read-only or simplified | Primary | Current page shows role/read-only state. |
| Suggested actions | Admin operational | Hidden or disabled | Primary when permissioned | Do not imply vendor can execute admin automation. |
| Permission note | Shared operational | Useful | Useful | Keep explicit. |
| Backend/system terminology | Internal diagnostics | Hidden/simplified | Visible if useful | Vendor labels should focus on operational impact. |

### Diagnostics

| Section / Widget / Action | Classification | Vendor Fit | Admin Fit | Guidance |
| --- | --- | --- | --- | --- |
| Webhook recovery command center | Internal diagnostics | Hidden | Primary | Admin-only. |
| Deployment runtime | Internal diagnostics | Hidden | Primary | Admin-only. |
| Backend health | Internal diagnostics | Hidden | Primary | Admin-only. |
| Reconciliation backlog | Admin operational | Hidden | Primary | Admin-only recovery context. |
| Replay/recover/retry controls | Internal diagnostics/admin operational | Hidden | Primary | Preserve auditability and permissions. |
| Payload diagnostics | Internal diagnostics | Hidden | Admin-only collapsed | Redacted preview only. |

## Vendor UX Noise To Reduce

Vendors likely do not need these in their normal workspace:

- Raw provider request/response diagnostics.
- Webhook, replay, recovery, payload hash, idempotency, and dead-letter language.
- Backend health, Render runtime, DB readiness, and deployment checks.
- Automation/system health phrasing when the vendor cannot act on it.
- Internal finance review artifacts such as draft payout batch details.
- Payment evidence internals and accounting sync internals.
- Duplicate support/ticket history rendered as repeated cards.
- Provider-specific lifecycle words that do not map to vendor action.
- Raw internal IDs without readable business context.
- The same status repeated with equal weight in KPI, badge, timeline, and card body.

Vendor-visible equivalents should use operational language:

- "Shipment needs attention"
- "Tracking missing"
- "Return waiting for pickup"
- "Settlement preview"
- "Pending review"
- "Support activity"
- "Configuration issue"
- "Contact support" or "Request profile correction"

## Admin-Specific Operational Needs

Admins need the control plane that vendors do not:

- Cross-vendor or selected-vendor monitoring.
- Queue balancing across fulfillment, returns, finance, support, automation, and diagnostics.
- Failed webhook and sync visibility.
- Stuck state and reconciliation backlog.
- Replay, recover, retry, and reconcile controls.
- Provider issue investigation with redacted payload summaries.
- Settlement review and shipping-cost reconciliation.
- Support escalation management and internal notes.
- Automation action review and permissioned execution.
- Deployment/runtime verification after releases.

Admin pages should still preserve hierarchy: active operational blockers first, diagnostics second, raw evidence collapsed.

## Future Dashboard Strategy

### Option A: Shared Dashboard With Role-Aware Sections

Keep one `/` dashboard route and one dashboard shell, but apply explicit section ownership rules.

Vendor dashboard composition:

1. Fulfillment and tracking attention.
2. Returns needing action.
3. Support replies and configuration issues.
4. Settlement preview and pending review.
5. Compact recent activity.
6. Passive KPIs.

Admin dashboard composition:

1. Cross-vendor or selected-vendor operational pressure.
2. Reconciliation and automation health.
3. Finance review pressure.
4. Support escalations.
5. Diagnostics and runtime health.
6. Passive vendor-scope KPIs.

Pros:

- Lower implementation risk.
- Preserves current routing, app shell, and vendor context.
- Can be rolled out section by section.
- Avoids duplicating dashboard data contracts.

Cons:

- Requires discipline to keep vendor/admin copy and visibility clean.
- Shared component can keep accumulating conditionals.
- Admin and vendor priorities may still compete inside one page.

Implementation complexity: low to medium.

Maintenance complexity: medium as role rules grow.

Operational clarity: good if section ownership is explicit.

### Option B: Dedicated Vendor Command Center And Admin Operations Center

Introduce dedicated dashboard experiences later:

- Vendor Command Center: fulfillment, returns, support, settlement preview.
- Admin Operations Center: diagnostics, reconciliation, automation, finance review, escalation management.

Pros:

- Strongest role clarity.
- Fewer conditional sections per page.
- Easier to tune density and terminology per role.
- Admin can get a true platform control plane.

Cons:

- Higher routing and test surface.
- Requires clear decision about global vs selected-vendor admin scope.
- Risks duplicate widgets unless shared lower-level components are extracted first.
- More migration work for navigation and documentation.

Implementation complexity: medium to high.

Maintenance complexity: low to medium after shared primitives exist.

Operational clarity: strongest.

### Recommended Direction

Use Option A first. Move to Option B only after the shared dashboard reaches the limit of role-aware filtering.

The immediate goal is not separate apps. The goal is to make every shared page know whether each section is vendor operational, admin operational, shared operational, passive analytics, or internal diagnostics.

## Role-Aware Information Hierarchy

### Vendor Hierarchy

1. Action required now.
2. Orders awaiting fulfillment or tracking.
3. Returns waiting for vendor/admin workflow.
4. Support replies and configuration correction.
5. Settlement preview and refund impact.
6. Compact history.
7. Read-only configuration summary.

Vendor pages should be action-first, not diagnostic-first.

### Admin Hierarchy

1. Operational health and queue pressure.
2. Reconciliation and failed automation.
3. Support escalations.
4. Finance review and settlement preparation.
5. Provider/Shopify investigation.
6. Deployment/runtime diagnostics.
7. Historical audit and raw evidence.

Admin pages should expose the control plane without making raw diagnostics the default reading path.

## Inspector And Detail Behavior

### Vendor Inspectors

Vendor inspectors should show:

- selected entity summary;
- actionable state;
- next step;
- timeline in vendor-safe language;
- linked order/return/support/finance context;
- settlement preview only when relevant;
- support CTA when the vendor cannot fix something directly.

Vendor inspectors should hide:

- provider payload keys;
- HTTP status and endpoint diagnostics unless translated into a vendor-safe issue;
- replay/recover controls;
- admin notes;
- accounting/payment internals.

### Admin Inspectors

Admin inspectors may add:

- reconciliation state;
- provider/Shopify diagnostic summaries;
- safe response keys and tracking IDs;
- recovery/retry eligibility;
- internal support and finance context;
- admin-only actions.

Admin inspector diagnostics should still sit below the current operational state.

### Vendor Detail Pages

Vendor detail pages should be workflow surfaces:

- shipment and return operations;
- product/line item context;
- support state;
- settlement preview;
- clean operational timeline.

Vendor detail pages should not become diagnostics workbenches.

### Admin Detail Pages

Admin detail pages may layer in overlays:

- provider diagnostics;
- Shopify sync diagnostics;
- reconciliation hints;
- payload summaries;
- retry/recover tools;
- finance review/admin adjustment hints when modeled.

These overlays should be collapsible or visually subordinate.

## Visibility Principles

- Vendor isolation is non-negotiable.
- Visibility cleanup must not weaken auth or query scoping.
- Role-aware rendering is not a substitute for backend authorization.
- Vendor-safe labels must not hide mutation uncertainty.
- Admin-only diagnostics must remain redacted and auditable.
- Unknown finance values must render as `Unknown`, not `0`.
- Estimated settlement values must stay labeled as estimates.
- Support history may be grouped visually, but historical records must not be deleted or mutated.
- Provider behavior must not change because of UI visibility cleanup.

## Implementation Roadmap

### Phase A: Low-Risk Visibility Cleanup

- Label dashboard sections by ownership in code comments or a small frontend map.
- Hide or mute vendor-facing automation/system-health wording when the vendor cannot act.
- Normalize dashboard, finance, and detail terminology around:
  - `Settlement preview`
  - `Pending review`
  - `Refund impact`
  - `Support activity`
  - `Estimated`
  - `Unknown`
- Move remaining provider/internal diagnostics below operational state and keep admin-only.
- Replace generic passive empty copy with role-aware operational copy.
- Group repeated support and notification history where it still appears as repeated rows.
- Add regression tests for vendor-hidden admin hints on Finance and Order Detail.

### Phase B: Role-Aware Dashboard Filtering

- Introduce a frontend dashboard section ownership model:
  - `vendor_operational`
  - `admin_operational`
  - `shared_operational`
  - `passive_analytics`
  - `internal_diagnostics`
- Use that model to order and filter dashboard sections per role.
- Keep one dashboard route.
- Keep shared data contracts unless payload size or role-specific backend concerns are proven.
- Extract shared support activity grouping and finance preview display so dashboard, finance, and detail pages use the same patterns.
- Make automation page copy role-aware: vendor read-only impact view, admin action/recovery view.

### Phase C: Optional Dedicated Dashboards

Only consider this after Phase B if the shared route remains noisy.

Possible split:

- `/` or `/vendor` as Vendor Command Center.
- `/admin` as Admin Operations Center.

Prerequisites:

- Shared operational primitives already extracted.
- Clear admin global vs selected-vendor scope decision.
- Tests proving vendor pages cannot show admin diagnostics.
- Navigation and onboarding copy updated.
- No duplicate business logic or duplicated data contracts unless justified.

## Future Direction

Short term: keep shared architecture, make section ownership explicit, and clean vendor-facing noise.

Medium term: add role-aware dashboard filtering and shared inspector/timeline/support grouping primitives.

Long term: split dashboards only if role-aware composition cannot keep the product clear.

## Remaining Unknowns

- Whether admins need a global all-vendor dashboard in addition to selected-vendor scope.
- Whether automation severity should be vendor-visible by rule type or admin-only by default.
- Whether finance review queues should eventually be backed by a formal settlement review state.
- Whether Support/Inbox should adopt the same persistent right inspector model as Orders, Returns, and Finance.
- Whether Vendor Profile should remain read-only for vendors forever or gain tightly scoped self-service fields later.
