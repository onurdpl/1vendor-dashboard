# Phase 17A Async Processing Foundation

## Purpose
- Establish the first DB-backed async operational processing foundation without introducing external queue infrastructure.
- Preserve the current production behavior where verified Shopify webhook deliveries are processed inline after HMAC verification and idempotency checks.
- Add retry-ready operational metadata so later phases can introduce safe retries, dead-letter handling, scheduling, and stronger reconciliation automation.

## Architecture Snapshot
- `WebhookEvent` remains the durable webhook receipt and replay/recover audit record.
- `OperationalJob` is a lightweight companion model for internal processing lifecycle visibility.
- Jobs are persisted in Postgres through Prisma and intentionally do not require Redis, BullMQ, RabbitMQ, Kafka, background daemons, or websocket infrastructure.
- Current execution remains inline:
  1. verify Shopify HMAC
  2. apply webhook idempotency
  3. create an `OperationalJob` for the first accepted delivery
  4. mark the job `processing`
  5. run the existing ingestion/replay/recover/reconciliation path
  6. mark the job `completed` or `failed`
- If operational job persistence is unavailable, webhook/reconciliation execution continues and logs the job-persistence issue. Job metadata is observability and retry preparation, not a new hard dependency for production ingestion.

## Operational Job Model
- `jobType`
  - `webhook_processing`
  - `reconciliation`
  - `replay`
  - `recovery`
  - `fulfillment_sync`
  - `refund_sync`
  - `return_sync`
- `status`
  - `pending`
  - `processing`
  - `completed`
  - `failed`
  - `retry_scheduled`
  - `dead_letter_ready`
- Retry-ready fields:
  - `retryCount`
  - `maxRetries`
  - `scheduledAt`
  - `startedAt`
  - `completedAt`
  - `failedAt`
  - `errorSummary`
  - `priority`
- Safe references:
  - related webhook event
  - related allocation/order/refund/return when available
  - payload reference/hash, not full payload duplication

## Current Integration Points
- Webhook ingestion:
  - first accepted non-duplicate Shopify webhook deliveries create an operational job
  - duplicate deliveries remain ignored by existing idempotency and do not create duplicate jobs
  - topic mapping uses fulfillment/refund/return-specific job types where useful
- Diagnostics replay/recover:
  - admin-triggered replay creates a `replay` job
  - admin-triggered recover creates a `recovery` job
  - blocked replay/recover requests remain blocked before job creation
- Reconciliation:
  - admin-triggered allocation/order reconciliation creates a `reconciliation` job
  - Shopify Admin GraphQL remains canonical; jobs do not invent or mutate Shopify state
- Diagnostics visibility:
  - webhook diagnostic list/detail responses include related operational job summaries
  - UI surfaces job type, status, retry count, schedule, and last failure summary without exposing secrets or full raw payloads

## Production Guardrails
- HMAC verification remains the first safety boundary before any webhook persistence or processing.
- Idempotency remains mandatory and unchanged.
- Vendor isolation and allocation-level scoping remain enforced by the existing ingestion/reconciliation services.
- Replay/recover/reconciliation remain admin-only.
- Operational jobs are internal metadata; they do not replace canonical Shopify re-fetch or reconciliation logic.
- No background worker, scheduler, external queue, payout engine, ERP/cargo integration, invoice generation, label generation, analytics engine, or realtime socket infrastructure was added.

## Future Evolution
- Phase 17B adds an operator-safe retry executor for webhook-linked jobs in retryable states, plus explicit retry/dead-letter metadata.
- Later infrastructure hardening can add scheduled reconciliation scans and dead-letter review workflows.
- If throughput requires it, external queue infrastructure can be introduced behind the `OperationalJob` lifecycle without changing webhook HMAC/idempotency contracts.
- Alerting can use `failed`, `retry_scheduled`, and `dead_letter_ready` job states once observability is expanded.

## Remaining Gaps
- There is no autonomous background retry worker yet.
- There is no scheduler for stale reconciliation jobs yet.
- Dead-letter readiness is modeled but not automatically advanced by a worker.
- Retry execution remains operator-driven through current diagnostics/replay/recover/reconciliation surfaces.

## Phase 17A-Fix Runtime Stabilization Notes
- Local smoke must run against a reachable local database with the Phase 17A migration applied:
  - `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/vendor_dashboard_dev ./backend/node_modules/.bin/prisma migrate deploy --schema backend/prisma/schema.prisma`
  - `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/vendor_dashboard_dev npm run backend:smoke`
- If `backend/.env` contains multiple `DATABASE_URL` entries, Prisma/dotenv may use the later value. Use an explicit shell-level `DATABASE_URL=...` override for deterministic local smoke.
- Render deployment must run the same Prisma migration against the Render Postgres external/internal production connection before relying on operational job persistence in production.
- Operational job persistence remains best-effort beside the core workflows:
  - HMAC and idempotency still gate webhook processing.
  - Job persistence failure is logged and should not become the reason a core webhook/replay/recover/reconciliation request fails.
  - Diagnostics handles missing related job records for older events or pre-migration responses.
