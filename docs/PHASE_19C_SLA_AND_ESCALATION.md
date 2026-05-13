# Phase 19C - SLA and Escalation Rules

## Purpose

Phase 19C adds deterministic SLA thresholds and escalation aging on top of the Phase 19A operational signals and Phase 19B in-app notification foundation.

Signals now reflect how long attention items have been waiting, not only whether a static condition exists. This improves operator prioritization while preserving the existing no-automation boundary.

## SLA Philosophy

SLA rules are:
- static and code-defined for now
- deterministic and explainable
- vendor-scoped when vendor state is involved
- duplicate-safe through deterministic signal ids
- safe to re-run during dashboard, signal, notification, or operations queue reads

SLA rules do not:
- auto-approve or decline returns
- mutate fulfillment, payout, settlement, or finance state
- call external notification providers
- execute remediation workflows
- expose internal diagnostics details to vendors

## Threshold Model

Return request aging:
- warning: 24 hours
- high: 48 hours
- critical: 72 hours

Fulfillment stuck:
- warning: 24 hours
- high: 48 hours
- critical: 72 hours

Payout review stale:
- warning: 24 hours
- high: 48 hours
- critical: 96 hours

Refund-heavy vendor:
- warning: greater than 8 percent
- high: greater than 15 percent
- critical: greater than 25 percent
- minimum order volume: 20 orders
- evaluation window: last 30 days

The threshold constants live in the rules service and are intentionally not admin-configurable yet.

## Escalation Aging

Existing active signals are updated as thresholds are crossed. For example:
- a pending return at 25 hours creates or updates a warning signal
- the same return at 49 hours updates the same signal to high
- the same return at 73 hours updates the same signal to critical

Signal metadata includes compact operational context such as:
- elapsed hours
- threshold crossed
- evaluated timestamp
- related Shopify order/return id where available
- payout batch status or refund ratio details where relevant

This keeps rule output explainable without storing full payloads or leaking sensitive diagnostics.

## Rule Coverage

Phase 19C adds or upgrades these rules:
- `return.request_sla_aging`
- `fulfillment.stale_awaiting_shipment`
- `payout.review_sla_aging`
- `refund.vendor_ratio_sla`

The fulfillment rule now uses the approved 24/48/72 hour tiers instead of a single stale threshold.

## Visibility

Admin users can see:
- all SLA aging signals
- internal operations queue prioritization
- payout review stale signals
- refund-heavy vendor risk
- diagnostics/reconciliation signals from previous phases

Vendor users can see only vendor-safe business signals scoped to their vendor:
- return aging
- fulfillment aging
- payout/settlement-facing warnings
- refund-heavy vendor risk when it is safe to show

Diagnostics and reconciliation internals remain admin-only.

## Notification Behavior

Phase 19B notification generation already reads active signals. SLA escalation therefore flows into in-app notifications through the existing duplicate-safe `NotificationIntent` path.

No external email, Slack, SMS, push, webhook, or remediation delivery was added.

## Operations Queue

The operations queue already folds active operational signals into operator work. Because SLA signals update severity over time, critical aging signals naturally rise above lower-severity work through the existing severity rank.

## Future Direction

Future automation phases can add:
- configurable SLA thresholds
- scheduled background signal scans
- escalation assignment
- notification preferences
- email/Slack delivery
- remediation playbooks
- safe auto-actions

Those are intentionally outside Phase 19C.
