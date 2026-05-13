# Phase 19A — Rules Engine Foundation

## Purpose

Phase 19A adds the first deterministic operational rules engine and signal-generation foundation.

The platform already has rich operational and finance state from Phases 16-18. This phase turns that state into explainable attention signals without adding notifications, auto-remediation, external automation, or ML/risk scoring.

## Deterministic Rules Philosophy

Rules are:
- deterministic
- explainable
- DB-backed
- vendor-scoped when vendor state is involved
- safe to re-run
- operationally visible

Rules do not mutate Shopify, finance snapshots, settlement calculations, payout batches, or reconciliation truth. They only create/update attention signals.

## Operational Signal Model

`OperationalSignal` stores:
- signal type
- severity
- source area
- optional vendor/allocation/finance/payout/job references
- title and description
- suggested action
- lifecycle status
- rule key
- trigger/resolution timestamps
- compact metadata

Signal statuses:
- `active`
- `acknowledged`
- `resolved`
- `ignored`

Signal severities:
- `info`
- `warning`
- `high`
- `critical`

Source areas:
- `payout`
- `refund`
- `fulfillment`
- `diagnostics`
- `reconciliation`
- `shipping_cost`
- `settlement`

## Starter Rules

Initial rule coverage includes:
- negative vendor payable balance
- stale awaiting-shipment fulfillment
- fulfilled external-provider sale rows missing shipping cost snapshots
- negative payout batch net amount
- payout-ready rows not yet batched after a threshold
- dead-letter or permanently failed operational jobs

Signals are created with deterministic ids built from rule key and related entity. Re-running evaluation updates the same signal instead of creating duplicates.

## Evaluation Flow

Evaluation runs opportunistically:
- when `/signals` is requested
- when `/admin/signals` is requested
- before the admin operations queue is built

This keeps Phase 19A lightweight and avoids introducing workers, queues, scheduler infra, or notifications.

## Visibility

Admin users can see internal and vendor-scoped signals through:
- `/admin/signals`
- `/admin/operations`
- dashboard operations context

Vendor users can see vendor-safe signals through:
- `/signals`
- dashboard signal summary/activity

Vendor responses exclude internal diagnostics/reconciliation signals. Admin-only signal lifecycle actions are available for acknowledge, resolve, and ignore.

## Lifecycle Actions

Admin lifecycle endpoint:

`POST /admin/signals/:signalId/lifecycle`

Supported actions:
- `acknowledge`
- `resolve`
- `ignore`

No workflow automation, escalation routing, or remediation is executed in Phase 19A.

## Operations Queue Integration

Active signals are folded into the admin operations queue as `operational_signal` items. High and critical signals influence queue ordering through the existing severity rank.

This makes rules visible to operators without replacing the existing hardcoded queue items.

## Future Direction

Future phases can add:
- configurable thresholds
- scheduled signal scans
- signal history and trend views
- notification delivery
- rule ownership/assignment
- remediation playbooks
- safe auto-actions
- external Slack/email integrations

Those are intentionally outside Phase 19A.
