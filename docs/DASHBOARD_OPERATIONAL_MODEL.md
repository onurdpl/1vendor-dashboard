# Dashboard Operational Model

## Purpose

The dashboard should answer one question before anything else:

> What requires attention right now?

It is not the canonical source for Shopify state, finance settlement truth, provider execution, or support ownership. It is a role-aware operational entry point that summarizes existing queues and routes operators toward the right workspace.

This document audits the current dashboard and defines the intended separation between vendor operational workflow and admin operational oversight.

## Current Dashboard Shape

Current implementation: `src/pages/DashboardPage.tsx`

The dashboard currently renders one shared page for vendors and admins, with role-aware data and a few admin-only sections. Its visible hierarchy is:

1. Header and workspace context
2. Needs attention
3. Operational queues
4. Passive insights
5. KPI strip
6. Recent operational events
7. Notification history
8. Finance snapshot
9. Admin diagnostics summary
10. Admin operational health
11. Workspace status

The current direction is action-first, but the page still mixes vendor workflow and admin oversight inside one route.

## Vendor Operational Goals

Vendor users need a compact daily operations workspace:

- See what must be handled now.
- Find shipment/fulfillment work quickly.
- See return/refund review pressure without finance certainty.
- Understand support notifications that require vendor action.
- See safe settlement preview information without internal reconciliation detail.
- Navigate to orders, returns, support, and finance workspaces.

Vendor dashboard language should stay operational and scoped:

- Use "Needs attention", "Awaiting shipment", "Returns queue", "Support queue", "Settlement estimate".
- Avoid raw infrastructure wording such as failed webhooks, dead-letter, retry pressure, reconciliation backlog, and stale state counts.
- Avoid implying finalized finance states such as balance, payable, confirmed payout, or final settlement.

## Admin Operational Goals

Admin users need platform oversight and recovery context:

- Monitor cross-vendor or selected-vendor operational health.
- Find blocked allocations, automation signals, webhook failures, stale state, and reconciliation backlog.
- See diagnostics and observability summaries.
- Triage high-severity notifications and failed operational jobs.
- Preserve replay/recovery auditability.

Admin dashboard language can expose operational internals when safe:

- Failed webhooks
- Stuck received
- Fulfillment sync failures
- Retry pressure
- Dead-letter readiness
- Reconciliation backlog
- Stale signals

Admin surfaces must not expose secrets or full sensitive payloads.

## Alert Hierarchy

Dashboard signals should be ranked by operational urgency:

1. Immediate action
   - Awaiting shipment
   - Blocked allocations
   - Refunds needing review
   - Automation failures/signals

2. Queue pressure
   - Fulfillment queue
   - Returns queue
   - Finance review queue
   - Support queue
   - Automation queue

3. Passive status
   - KPI strip
   - Finance snapshot
   - Workspace status

4. History and audit trail
   - Recent operational events
   - Notification history
   - Admin diagnostics/health details

Repeated operational signals should be grouped visually. Raw repeated notifications should not dominate the dashboard unless they represent distinct high-priority work.

## Section Ownership

| Section | Current Role | Classification | Owner Intent | Vendor Fit | Admin Fit | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Header/workspace context | Shared | Shared | Confirm current user, role, vendor scope, API health | Useful | Useful | Vendor sees API health today, but deeper health belongs to admin. |
| Needs attention | Shared | Operational action | Primary action surface | Strong | Strong | Should remain the top dashboard surface for both roles, with role-specific wording later. |
| Blocked allocations | Shared | Operational action | Allocation recovery pressure | Moderate | Strong | Vendor may need a simpler "Blocked order work" label later. |
| Awaiting shipment | Shared | Operational action | Shipment work needing progress | Strong | Strong | Core vendor workflow. |
| Refund attention | Shared | Operational action | Refund/return review pressure | Strong | Strong | Vendor should see operational review only, not internal refund reconciliation. |
| Automation signals | Shared | Operational action/admin oversight | Automation/rules attention | Moderate | Strong | Vendor wording should avoid backend/internal phrasing. |
| Operational queues | Shared | Operational queue | Summary of fulfillment, returns, finance, support, automation | Strong | Strong | Currently synthesized in UI from existing data. |
| Fulfillment queue | Shared | Operational queue | Shipment execution pressure | Strong | Strong | Vendor-relevant. |
| Returns queue | Shared | Operational queue | Return/refund review pressure | Strong | Strong | Vendor-relevant. |
| Finance review queue | Shared | Passive/queue hybrid | Settlement estimate/review awareness | Moderate | Strong | Vendor should see estimates only. |
| Support queue | Shared | Operational queue | Support/contact pressure | Strong | Strong | Vendor should see actionable support items, not internal support analytics. |
| Automation queue | Shared | Operational queue/admin oversight | Automation signal pressure | Moderate | Strong | Candidate for admin emphasis and vendor simplification. |
| Passive insights heading | Shared | Passive analytics separator | Reduce competition with action work | Useful | Useful | Keeps reporting visually below action work. |
| KPI strip | Shared | Passive analytics | Vendor scope metrics | Useful | Useful | Should not outrank operational actions. |
| Recent operational events | Shared | History | Audit/context stream | Useful in small doses | Useful | Group and collapse older entries to avoid feed dominance. |
| Notification history | Shared | History/alert trail | In-app notification audit | Moderate | Strong | Vendor-facing version should emphasize actionable unread items over history. |
| Finance snapshot | Shared | Passive analytics | Current finance preview | Useful | Useful | Must remain estimated/preview unless settlement is approved by future model. |
| Diagnostics summary | Admin-only | Admin-only operational oversight | Webhook and sync health | Not appropriate | Strong | Keep admin-only. |
| Operational health | Admin-only | Admin-only operational oversight | Platform observability | Not appropriate | Strong | Keep admin-only. |
| Workspace status | Shared | Passive status | Vendor-scoped summary | Useful | Useful | Should remain compact and low on the page. |

## Vendor Noise and Confusion Risks

These areas can create vendor confusion if presented without role-aware language:

- Automation signals described as backend automation.
- API health/status in the header if it looks like vendor-owned work.
- Notification history when it behaves like a raw alert feed rather than actionable support/operation items.
- Finance snapshot values if they appear finalized.
- Blocked allocations if the vendor cannot directly recover the allocation.
- Workspace status copy that mixes refunds, automation/rules signals, and admin queue language.

Admin-only diagnostics and operational health are already hidden from vendors and should remain that way.

## Future Separation Strategy

Recommended direction: keep one route short-term, move toward role-aware dashboard composition, then split only if the workflows continue to diverge.

### Phase 1: Shared Route, Role-Aware Sections

Keep the current `/` dashboard route and one component shell, but make sections explicitly role-aware:

- Vendor default dashboard:
  - Needs attention
  - Fulfillment/returns/support queues
  - Settlement estimate preview
  - Compact recent activity
  - Minimal notification/action history

- Admin default dashboard:
  - Needs attention
  - Operational queues
  - Diagnostics summary
  - Operational health
  - Notification history
  - Passive vendor-scope KPIs

This phase avoids routing churn and preserves existing vendor selection behavior.

### Phase 2: Extract Dashboard Section Model

Introduce a small dashboard section ownership model:

- `vendor`
- `admin`
- `shared`
- `passive`
- `action`
- `history`

This can stay frontend-only initially and should not change backend dashboard contracts.

### Phase 3: Dedicated Dashboards If Needed

Split into dedicated dashboards only when role-specific workflows become too different:

- Vendor dashboard: operational fulfillment/returns/support command center.
- Admin dashboard: operations center for health, diagnostics, recovery, automation, and vendor oversight.

Do not split routes solely for visual polish. Split only when it reduces operational ambiguity and keeps vendor isolation easier to reason about.

## Future Direction

The preferred medium-term model is a shared dashboard route with stricter role-aware sections:

- Vendor users see work they can act on or safely understand.
- Admin users see oversight and recovery details.
- Passive analytics remain below operational action surfaces.
- Notification history remains grouped and secondary.
- Finance language remains estimated unless future settlement state explicitly supports approved/paid states.

Unknowns:

- Whether admin users need a global all-vendor dashboard separate from selected-vendor scope.
- Whether support queue counts should come from support tickets rather than notification unread counts.
- Whether finance review queue should be backed by a formal settlement review model.
- Whether automation signal severity should be vendor-readable or admin-only by rule type.
