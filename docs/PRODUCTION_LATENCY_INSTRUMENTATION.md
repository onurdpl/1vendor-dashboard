# Production Latency Instrumentation

## What Is Logged

The backend emits safe structured request timing logs for the main dashboard routes:

- `GET /orders`
- `GET /orders/:orderId`
- `GET /returns`
- `GET /returns/:returnId`
- `GET /finance`
- `GET /admin/operations`
- `GET /admin/operations/attention`
- `GET /admin/observability/summary`
- `GET /admin/observability/metrics`
- `GET /automation`

Each log includes only:

- route name
- method
- status code
- elapsed milliseconds
- response byte size when available

Raw URLs, query strings, ids, addresses, tokens, payloads, and customer data are not logged.

## Health Timing

`GET /health` now includes:

- `uptimeSeconds`
- `coldStartAgeSeconds`
- `dbReachable`
- `dbPingMs`
- `schemaReady`

`GET /health/db` returns `dbPingMs` when the database ping succeeds.

## Reading Production Symptoms

Use these signals together:

- Cold start: first request is slow and `/health.coldStartAgeSeconds` is low, commonly under 60 seconds.
- Slow DB or network to Postgres: `/health.dbPingMs` is high or `dbReachable` is false.
- Slow endpoint logic: request timing `elapsedMs` is high while `/health.dbPingMs` is normal and `coldStartAgeSeconds` is high.
- Large payload: request timing `responseBytes` is high on list/detail routes.
- Frontend timeout: browser shows a timeout but no matching backend timing log appears, or the backend log completed well before the frontend timeout.
- Schema/deploy issue: `/health.schemaReady` is false or `missingColumns` is non-empty.

## Render Cold-Start Checks

Render cold starts are likely when:

- the first request after idle time is slow,
- `/health.coldStartAgeSeconds` is low,
- subsequent requests are fast,
- `dbPingMs` is normal.

Consider Render min instances or a scheduled warm ping when cold-start latency repeatedly affects operators during business hours. Prefer min instances for production-critical admin/vendor workflows; use scheduled pings only as a lower-cost mitigation when occasional cold starts are acceptable.

## Safety Notes

These diagnostics are observability only. They do not change Shopify ingestion, provider execution, shipment behavior, return behavior, or frontend API contracts.
