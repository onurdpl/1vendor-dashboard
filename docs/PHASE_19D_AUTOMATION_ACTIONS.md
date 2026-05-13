# Phase 19D - Automation Actions Foundation

## Purpose

Phase 19D adds the first safe operational automation action foundation on top of rules, signals, notifications, and reconciliation.

The goal is operator assistance, not autonomous operations. Automation actions turn active signals into explainable suggestions or bounded safe actions that operators can review.

## Safe Automation Philosophy

Automation actions are:
- deterministic
- signal-backed
- auditable
- duplicate-safe
- admin-controlled for execution
- bounded to low-risk operator-assist workflows

Automation actions do not:
- auto-refund customers
- auto-cancel orders or fulfillments
- execute payouts or payments
- mutate immutable finance ledger snapshots
- bypass reconciliation
- invent Shopify truth
- call external systems
- expose vendor-unsafe diagnostics details

## Automation Action Model

`AutomationAction` stores:
- optional related signal id
- action type
- lifecycle status
- execution mode
- optional vendor/allocation/finance/payout/job references
- title and description
- execution timestamp
- result summary
- compact metadata

Statuses:
- `pending`
- `suggested`
- `executed`
- `skipped`
- `failed`
- `cancelled`

Execution modes:
- `manual`
- `assisted`
- `auto_safe`

## Starter Action Types

Phase 19D creates deterministic suggestions for:
- stale fulfillment review
- reconciliation review
- payout review
- payout batch review
- shipping cost attachment
- negative payout investigation
- failed operational job investigation

It also models bounded auto-safe actions:
- create reconciliation candidate
- generate reminder notification
- prioritize stale queue item

The current implementation only executes a bounded reconciliation job candidate and manual lifecycle actions. Queue prioritization remains driven by signal severity.

## Explainability Rules

Every action carries metadata describing:
- why it was suggested
- source signal rule key
- signal severity and source area
- recommended operator action
- bounded action notes when the action is auto-safe

This makes automation auditable without storing raw webhook payloads or secrets.

## Execution Boundary

Admin endpoint:

`POST /admin/automation-actions/:actionId/execute`

Supported execution requests:
- `execute_safe`
- `mark_handled`
- `skip`
- `cancel`

`execute_safe` is intentionally narrow. In Phase 19D it can create a reconciliation `OperationalJob` candidate for an action with allocation/job linkage. It does not run destructive mutation directly.

`mark_handled`, `skip`, and `cancel` only update action lifecycle state and preserve history.

## Visibility

Admin users can list actions through:

`GET /admin/automation-actions`

Automation actions are also folded into:
- operations queue
- in-app notification center as admin reminders

Vendor users do not execute automation actions. Vendor-safe visibility remains controlled through the existing signals and notifications rules.

## Notification Behavior

Automation suggestions can create in-app admin notification intents. No external email, Slack, SMS, webhook, push, or alert-provider delivery was added.

## Future Direction

Future phases can add:
- richer action-specific execution adapters
- assignment and ownership
- approval workflows
- notification preferences
- external Slack/email/webhook delivery
- safe remediation playbooks
- configurable automation policies

Those are intentionally outside Phase 19D.
