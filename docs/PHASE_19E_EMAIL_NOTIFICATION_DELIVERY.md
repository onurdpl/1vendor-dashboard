# Phase 19E - Email Notification Delivery Foundation

## Purpose

Phase 19E adds a safe email notification delivery foundation on top of existing `NotificationIntent` records.

The goal is provider readiness and auditable delivery lifecycle tracking. This phase does not add real SendGrid, Postmark, SES, Slack, SMS, push, webhook, or marketing email delivery.

## Delivery Safety

Email delivery is disabled by default:

`EMAIL_NOTIFICATIONS_ENABLED=false`

When disabled, eligible email intents are created and immediately marked `skipped` with a compact delivery summary. This makes routing auditable without sending mail.

No raw webhook payloads, secrets, stack traces, or sensitive diagnostic previews are included in email templates.

## Environment Configuration

Backend envs:
- `EMAIL_NOTIFICATIONS_ENABLED=false`
- `EMAIL_PROVIDER=noop`
- `EMAIL_FROM=`
- `EMAIL_ADMIN_RECIPIENTS=`

Supported providers in Phase 19E:
- `noop`: records skipped delivery; no outbound mail
- `console`: logs a deterministic local/dev email preview to the backend console

No real external provider is integrated yet.

## Channel Lifecycle

Email uses the existing `NotificationIntent` model with channel:

`EMAIL_PLACEHOLDER`

Lifecycle statuses:
- `pending`
- `delivered`
- `failed`
- `skipped`

The Phase 19E migration adds `FAILED` to the notification status enum so provider failures can be represented safely.

## Routing Rules

In-app notifications remain unchanged.

Email intents are generated only for high/critical eligible signals:
- admin high/critical signals can route to `EMAIL_ADMIN_RECIPIENTS`
- vendor high/critical signals can route only to active users linked to the signal vendor
- vendor signals must be vendor-safe
- diagnostics and reconciliation internals are not routed to vendors
- warning/info notifications remain in-app only by default

If a vendor has no active recipient email, the email intent is marked skipped.

## Templates

Templates are deterministic text only:
- subject
- severity
- source area
- related entity label
- summary
- suggested action
- dashboard path placeholder

Templates intentionally exclude raw payloads and secrets.

## Delivery Execution

Email delivery runs during notification generation for eligible email intents.

Delivery behavior:
- disabled config: mark skipped
- noop provider: mark skipped
- console provider: mark delivered after writing a safe local/dev preview
- unsupported provider: mark failed

No background worker, retry engine, or external provider queue was added.

## Future Direction

Future phases can add:
- SendGrid/Postmark/SES provider adapters
- email retry lifecycle
- notification preferences
- per-recipient delivery receipts
- Slack delivery
- outbound webhook delivery
- escalation routing policies

Those are intentionally outside Phase 19E.
