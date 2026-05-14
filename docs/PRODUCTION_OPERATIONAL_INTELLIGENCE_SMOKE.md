# Production Operational Intelligence Smoke Checklist

## Purpose

This checklist verifies the production rules, signals, notifications, SLA, automation, and email-ready delivery foundation without introducing destructive operations or external notification delivery.

Production backend:

`https://vendor-dashboard-backend-398h.onrender.com`

## Preconditions

- Use seeded demo/admin credentials only in an approved smoke window.
- Do not print tokens, secrets, raw webhook payloads, or diagnostic payload bodies.
- Use `X-Vendor-Id` for vendor-scoped reads.
- Keep mutation checks limited to safe notification lifecycle actions unless explicitly approved.
- Confirm `EMAIL_NOTIFICATIONS_ENABLED=false` unless testing a real provider in a future phase.

## Read-Only Smoke

1. Authenticate as admin.
   - Expected: HTTP 200 and token returned.

2. Fetch admin signals.
   - Request: `GET /admin/signals`
   - Expected: HTTP 200.
   - Verify summary counts and signal rows include `type`, `severity`, `sourceArea`, and `status`.

3. Fetch admin operations queue.
   - Request: `GET /admin/operations`
   - Expected: HTTP 200.
   - Verify active operational signals and automation action queue items appear when present.

4. Fetch admin automation actions.
   - Request: `GET /admin/automation-actions`
   - Expected: HTTP 200.
   - Verify suggestions are present when signals support them.
   - Verify action statuses are non-destructive lifecycle states such as `suggested`, `executed`, `skipped`, or `cancelled`.

5. Fetch admin notifications.
   - Request: `GET /notifications`
   - Expected: HTTP 200.
   - Verify notification rows include channel, status, severity, recipient role, and safe metadata.

6. Authenticate as vendor.
   - Expected: HTTP 200 and token returned.

7. Fetch vendor signals.
   - Request: `GET /signals`
   - Expected: HTTP 200.
   - Verify all returned signals are scoped to the selected vendor and vendor-safe source areas.

8. Fetch vendor notifications.
   - Request: `GET /notifications`
   - Expected: HTTP 200.
   - Verify all returned notifications use recipient role `vendor` and the selected vendor id.

9. Attempt vendor admin automation access.
   - Request: `GET /admin/automation-actions`
   - Expected: HTTP 403.

## Safe Lifecycle Smoke

1. Mark one in-app admin notification as read.
   - Request: `POST /notifications/read`
   - Body: `{ "notificationId": "<selected notification id>" }`
   - Expected: HTTP 200.
   - Verify response status is `read` and `readAt` is set.
   - Verify the next `GET /notifications` shows reduced unread count.

2. Dismiss one in-app admin notification.
   - Request: `POST /notifications/dismiss`
   - Body: `{ "notificationId": "<selected notification id>" }`
   - Expected: HTTP 200.
   - Verify response status is `dismissed`.
   - Verify the next `GET /notifications` keeps history but excludes the item from active dashboard rendering.

3. Confirm the legacy path routes still exist for compatibility.
   - Routes:
     - `POST /notifications/:notificationId/read`
     - `POST /notifications/:notificationId/dismiss`
   - Preferred frontend path remains the body-based route because deterministic notification ids can become long.

## SLA Verification

Check signal rows and metadata for:
- return request aging at 24h / 48h / 72h thresholds
- fulfillment stuck at 24h / 48h / 72h thresholds
- payout review stale at 24h / 48h / 96h thresholds
- refund-heavy vendor ratio above 8 percent / 15 percent / 25 percent with minimum 20 orders

Expected:
- threshold breaches update existing deterministic signals
- severity escalates without duplicate signal spam
- metadata explains elapsed time, threshold, and related safe entity labels

## Notification Routing Verification

Admin:
- can see admin-targeted in-app notifications
- can see internal operational attention when applicable
- can manage notification read/dismiss lifecycle

Vendor:
- sees only vendor-scoped notifications
- does not see internal diagnostics/reconciliation notifications
- cannot access admin automation action endpoints

## Email Safety Verification

Expected Phase 19F behavior:
- no real outbound email provider is configured
- `EMAIL_NOTIFICATIONS_ENABLED=false` by default
- eligible high/critical email intents are skipped or not generated when no eligible high/critical signals exist
- no raw payloads, secrets, stack traces, or internal diagnostic previews appear in email template metadata

Automated tests cover disabled email delivery and safe template behavior. Production smoke should not attempt to enable real outbound email in Phase 19F.

## May 14, 2026 Production Smoke Result

Observed:
- admin login: passed
- admin signals: passed, 10 active warning signals
- admin automation actions: passed, 16 suggested actions and 6 auto-safe candidates
- admin notifications: passed
- mark read via `POST /notifications/read`: passed, unread count decreased
- dismiss via `POST /notifications/dismiss`: passed
- vendor login: passed
- vendor signals for `sporjinal`: passed, 7 vendor-scoped warning signals
- vendor notifications for `sporjinal`: passed, 7 vendor in-app notifications
- vendor admin automation access blocked: passed, HTTP 403
- outbound email: not sent

Known production caveat:
- no eligible high/critical email intents were present during this smoke run, so production email intent generation was not mutated for a new high/critical case.

