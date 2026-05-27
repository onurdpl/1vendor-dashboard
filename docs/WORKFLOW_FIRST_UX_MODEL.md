# Workflow-First UX Model

## Purpose

Operational pages should answer a simple question after they show the current state:

```text
Current state -> next recommended action
```

This document defines Phase A workflow action guidance. It is a lightweight UI guidance layer only. It does not implement workflow orchestration, automation execution, provider calls, payout/accounting behavior, backend business logic, or new route ownership.

## Files Inspected

- `docs/OPERATIONALLY_TRUSTWORTHY_SYSTEM_MODEL.md`
- `docs/UNIFIED_OPERATIONAL_WORKSPACE_MODEL.md`
- `docs/DASHBOARD_SIGNAL_TRUTH_MODEL.md`
- `docs/OPERATIONAL_SIGNAL_DEDUPLICATION_MODEL.md`
- `src/pages/DashboardPage.tsx`
- `src/pages/OrdersPage.tsx`
- `src/pages/ReturnsPage.tsx`
- `src/pages/FinancePage.tsx`
- `src/pages/OrderDetailPage.tsx`
- `src/pages/ReturnDetailPage.tsx`
- `src/components/OperationalPrimitives.tsx`
- `src/lib/workflowActionGuidance.ts`

## Phase A Scope

Phase A adds contextual guidance to existing surfaces:

- Dashboard action cards
- Dashboard operational queue cards
- Orders inspector
- Returns inspector
- Finance inspector
- Order Detail settlement preview
- Return Detail vendor review card

The guidance is intentionally descriptive. It points users toward existing routes and workflows; it does not execute new actions.

## Action Guidance Mapping

| Operational state | Recommended action | Existing destination or workflow |
| --- | --- | --- |
| Awaiting shipment | Create shipment | Orders row/inspector shipment action |
| Stale fulfillment | Create shipment | Orders queue or detail shipment workspace |
| Tracking missing | Sync tracking | Orders detail tracking/provider workflow |
| Return pending review | Review return | Returns queue/detail review workflow |
| Return received, not reviewed | Approve or reject return | Return Detail vendor review workflow |
| Refund still pending | Monitor refund progress | Return Detail and Finance context |
| Settlement pending review | Review settlement | Finance row/inspector and Order Detail settlement preview |
| Refund impact present | Review refund impact | Finance inspector settlement preview |
| Support issue active | Open linked support record | Support workspace or linked ticket |
| Automation issue active | Review automation queue | Automation workspace |

## Primary Action Principles

1. Each active operational state should expose one primary next action.
2. Guidance should not create a second competing button when a working primary action already exists.
3. If an action already exists, the guidance explains why that action is next.
4. If the action must happen in another workspace, the guidance names the target workspace.
5. If the workflow is read-only for the current role, guidance should use review/open language, not execution language.
6. If prerequisites are missing, the prerequisite step is the next action.
7. Passive history, timelines, linked records, diagnostics, and notifications do not get primary action treatment unless they are the current blocker.

## Escalation And Action Hierarchy

Use this hierarchy when several possible actions exist:

1. Resolve the current blocker in the primary workflow.
2. Open the canonical entity detail page if the list/inspector cannot complete the work.
3. Open the linked support record if human coordination is already active.
4. Contact support only when no linked support record exists and the operator needs correction/help.
5. Review admin diagnostics only after the user has exhausted the workflow action or when the diagnostic is the blocker.

Examples:

- If an order has no shipment, "Create shipment" outranks "Open support".
- If tracking is missing but provider evidence exists, "Sync tracking" outranks "Review timeline".
- If a support ticket already exists, "Open linked support record" outranks "Contact support".
- If finance is pending review, "Review settlement" outranks "Download PDF".
- If return receipt is not marked, "Review return" or "Mark received" outranks refund monitoring.

## Role-Aware Guidance

Vendor-facing guidance should:

- use operational wording;
- avoid provider and accounting internals;
- avoid final payout/payable certainty;
- point to support only when the vendor can act there;
- keep admin-owned settings read-only.

Admin-facing guidance may:

- mention reconciliation and diagnostics;
- point to automation or diagnostic queues;
- expose provider evidence in collapsed admin sections;
- still avoid implying provider success, payout approval, or accounting finality before it exists.

## Action Language Rules

Use:

- Create shipment
- Sync tracking
- Review return
- Approve or reject return
- Review settlement
- Review refund impact
- Open linked support record
- Review automation queue

Avoid:

- No actions available, unless that absence is operationally meaningful
- Payable, confirmed, final payout, or balance for estimates
- Retry provider, unless the user is in an admin/provider-safe context
- Contact support when an existing linked ticket should be reused
- Generic "Review" when the current state can name the next workflow step

## Degraded State Rules

Guidance must not hide uncertainty:

- Unknown data should produce review/open guidance, not fake execution guidance.
- Missing provider evidence should not imply provider success.
- Missing finance inputs should stay `Unknown`.
- A failed optional section should not remove the primary action for the loaded entity.
- A disabled vendor-scoped query should show waiting/select-vendor state, not a false workflow action.

## Phase B Route Filtering

Dashboard workflow actions should carry intent into the destination queue with lightweight query params. The destination page owns the actual filtering, renders the active workflow filter visibly, and lets the user clear or override it through the normal filter controls.

Current route mappings:

- `Create shipment` -> `/orders?workflow=awaiting-shipment`
- `Review allocation` -> `/orders?workflow=blocked-allocation`
- `Review stale fulfillment` -> `/orders?workflow=stale-fulfillment`
- `Sync tracking` -> `/orders?workflow=tracking-missing`
- `Review return` -> `/returns?workflow=pending-review`
- `Review settlement` -> `/finance?workflow=settlement-review`
- `Open linked support record` -> `/support?workflow=open-support-issues`
- `Review automation queue` -> `/automation?workflow=active-issue-groups`

Rules:

1. Workflow params initialize existing local filters; they do not add hidden backend scope.
2. The active workflow filter must be visible in the page body.
3. Manual filter changes clear the workflow param so users are not trapped in a hidden queue context.
4. Reset/clear returns the page to its normal unfiltered state.
5. Existing deep links can coexist with `workflow`; clearing workflow must preserve other query params.

## Phase C Candidates

Future work can make the guidance more precise without changing Phase A/B principles:

1. Extend backend normalized dashboard fields with `recommendedAction`, `destination`, and `sourceEntityType`.
2. Share action guidance with Admin Operations queue recommendations.
3. Persist operational issue group lifecycle before adding acknowledge/resolve/dismiss workflows.
4. Add role-aware guidance tests for vendor/admin dashboard variants.

## Vendor Readiness Distinction

Vendor Profile readiness is adjacent to workflow guidance, but it is not the same thing.

Workflow guidance answers:

```text
Given this active operational state, what should the user do next?
```

Vendor readiness answers:

```text
Given the current vendor configuration and visible workflows, can this vendor operate safely?
```

Readiness can point to existing workflows for review, but it must not duplicate dashboard queue counts or invent onboarding progress. It should stay conservative when data is incomplete:

- `Ready` only when the current config truth satisfies the stated criteria.
- `Requires configuration review` when loaded data is missing a required setup item.
- `Unknown` when a section failed to load or cannot be confirmed.
- `Not modeled yet` when the product has no data model for that readiness dimension.

Future onboarding direction should build on these readiness criteria before adding automation. A later onboarding phase may attach tasks or ownership to missing criteria, but the current model remains a read-only operational readiness workspace.
