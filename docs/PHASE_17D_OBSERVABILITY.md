# Phase 17D Operational Observability and Metrics

## Goal
- Add lightweight operational observability for Shopify webhook processing, operational jobs, retries, dead-letter readiness, stale states, and reconciliation activity.
- Provide admin-facing health insight without external metrics infrastructure.

## Philosophy
- Observability is DB-backed and query-driven.
- Metrics are operational summaries, not analytics-grade reporting.
- Health states intentionally avoid fake precision:
  - `healthy`
  - `warning`
  - `degraded`
  - `critical`
- No Prometheus, Grafana, OpenTelemetry, tracing backend, external metrics store, websocket layer, or realtime infrastructure was added.

## Admin APIs
- `GET /admin/observability/summary`
  - admin-only
  - returns current health, retry pressure, reconciliation state, webhook health, stale-state totals, notes, and time-window snapshots
- `GET /admin/observability/metrics`
  - admin-only
  - returns lightweight windowed metrics only

## Time Windows
The backend aggregates:
- last hour
- last 24h
- last 7d

Window metrics include:
- webhook throughput
- processed webhook count
- failed webhook count
- success rate
- failure rate
- retry count
- dead-letter-ready count
- permanently failed count
- reconciliation jobs
- replay jobs
- recovery jobs
- scheduled/stale reconciliation jobs

## Health Model
Health considers:
- 24h webhook failure rate
- retry scheduled/retrying pressure
- dead-letter-ready jobs
- permanently failed jobs
- reconciliation/stale-state backlog

This is meant to guide operators quickly:
- `healthy`: no active retry, dead-letter, failed webhook, or stale-state pressure
- `warning`: low pressure exists, but no high-risk backlog
- `degraded`: retry pressure, stale backlog, or elevated failure rate needs attention
- `critical`: permanent failures, multiple dead-letter jobs, or severe failure rate

## UI Integration
- Dashboard includes an admin-only Operational Health panel with:
  - health
  - 24h success rate
  - failed webhooks
  - retry pressure
  - dead-letter count
  - reconciliation backlog
  - stale-state signals
  - latest note
- Admin Diagnostics includes health and retry-pressure summary indicators alongside webhook and reconciliation recovery data.

## Safety
- HMAC verification, webhook idempotency, replay/recover, reconciliation repair rules, and vendor isolation are unchanged.
- Observability endpoints are admin-only.
- Metrics aggregate operational metadata and do not expose raw webhook payloads.
- No Shopify state is invented and no reconciliation behavior changes are introduced.

## Future Evolution
- Later phases can move these queries behind periodic snapshots if volume requires it.
- A future observability stack can export these metrics to Prometheus, OpenTelemetry, or an external provider.
- Realtime health updates remain future work and should be introduced only after a socket/event infrastructure phase.
