# Phase 17E Performance and Scale Hardening

## Goal
- Improve production scale readiness across backend list queries, diagnostics streams, operational tables, reconciliation visibility, and frontend data loading.
- Keep behavior stable while preparing for larger operational datasets.

## Selective Hydration Philosophy
- List endpoints should return compact DTOs.
- Detail endpoints remain the place for heavier nested data and payload previews.
- Diagnostics list responses avoid raw webhook payload hydration; payload preview remains detail-only.
- Finance summary totals are computed from lightweight summary fields, while ledger rows can be windowed independently.

## Pagination Strategy
- A shared backend pagination helper clamps `limit` and `offset`.
- Defaults:
  - default limit: 100
  - max limit: 250
  - default offset: 0
- Added pagination readiness to:
  - `GET /orders`
  - `GET /returns`
  - `GET /finance`
  - `GET /admin/operations`
  - `GET /admin/diagnostics/webhooks`
- Responses remain array-shaped or existing DTO-shaped for compatibility. This phase does not redesign route contracts.

## Diagnostics Scaling
- Webhook diagnostics list now selects only event metadata, Shopify order hints, and the latest related jobs.
- Raw payload hydration is reserved for `GET /admin/diagnostics/webhooks/:webhookEventId`.
- List-level replay/recover eligibility uses payload hash availability rather than loading full stored payload content.
- This keeps the event stream suitable for larger webhook histories while preserving detail drawer recovery behavior.

## Finance Ledger Scaling
- Finance totals use lightweight summary fields for all vendor ledger rows.
- Display ledger rows support `limit`/`offset`.
- Related return/refund references are capped to the first relevant record for list display.

## Frontend Readiness
- Real-mode service calls can pass `limit` and `offset` without changing current page behavior.
- Existing pages keep their current default windows.
- This prepares the UI for future “load more”, cursor-lite pagination, or virtualized table rollouts.

## Future Virtualization Direction
- The current dense operational tables remain normal React tables.
- Future phases can add virtualization for:
  - diagnostics event stream
  - finance ledger rows
  - returns workspace
  - operations queue
- The new pagination plumbing provides a safer backend boundary before virtualization.

## Retention and Cleanup Preparation
- No production history is deleted automatically.
- Payload retention remains unchanged.
- Future archival or payload-trimming should be explicit, operator-reviewed, and documented before enablement.

## Non-goals
- No Redis, BullMQ, Kafka, RabbitMQ, external worker, websocket, realtime, or metrics infrastructure was added.
- No backend architecture rewrite was performed.
- No HMAC, idempotency, vendor isolation, replay/recover, or reconciliation behavior was weakened.
