# Phase 19B — Notification Foundation

## Purpose

Phase 19B adds the first notification foundation for operational signals.

The goal is in-app visibility and delivery preparation only. This phase does not send real email, Slack, SMS, push, webhook, or external alert messages.

## In-App First Strategy

Notifications are generated from active operational signals and stored as `NotificationIntent` rows.

The first real channel is:
- `in_app`

Placeholder channels are modeled for future delivery adapters:
- `email_placeholder`
- `slack_placeholder`

No outbound service is called in Phase 19B.

## Notification Model

`NotificationIntent` stores:
- optional related signal id
- optional vendor id
- recipient role
- channel
- lifecycle status
- title and message
- severity
- delivery/read timestamps
- compact metadata

Statuses:
- `pending`
- `delivered`
- `read`
- `dismissed`
- `skipped`

Recipient roles:
- `admin`
- `vendor`

## Routing Rules

Admin routing:
- critical/high active signals create admin in-app notifications
- internal diagnostics/reconciliation signals are admin-only

Vendor routing:
- vendor notifications require `vendorId`
- source area must be vendor-safe
- vendor-safe areas are payout, refund, fulfillment, shipping cost, and settlement
- diagnostics/reconciliation details are not routed to vendors

Generation is duplicate-safe. Notification ids include channel, recipient role, recipient scope, and signal id.

## Lifecycle

Notifications and signals have related but independent lifecycles:
- resolving or acknowledging a signal does not delete notification history
- notification read/dismiss state does not resolve the source signal
- notification history remains auditable

Endpoints:
- `GET /notifications`
- `POST /notifications/read`
- `POST /notifications/dismiss`
- `POST /notifications/:id/read`
- `POST /notifications/:id/dismiss`

The body-based lifecycle routes are preferred by the frontend because deterministic notification ids can become long. The path-param routes remain for compatibility.

Admin users see admin-targeted notifications. Vendor users see only notifications scoped to their selected vendor.

## UI Integration

Dashboard includes a compact in-app Notification Center:
- unread count
- high-priority count
- total count
- latest notification cards
- severity/status display
- source area metadata when present
- read and dismiss actions

The read/dismiss controls call the existing notification lifecycle endpoints and refresh the dashboard/notification state. This keeps Phase 19B lightweight and avoids a broad shell redesign.

Empty notification state uses:

`No active notifications.`

## Future Direction

Future phases can add:
- notification preferences
- email delivery adapter
- Slack delivery adapter
- outbound webhook delivery
- retry/dead-letter handling for external channels
- notification center UX
- signal assignment/escalation

Those are intentionally outside Phase 19B.
