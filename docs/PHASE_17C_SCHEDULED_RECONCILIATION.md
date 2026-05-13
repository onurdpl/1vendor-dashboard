# Phase 17C Scheduled Reconciliation Foundation

## Goal
- Add a lightweight scheduled reconciliation foundation on top of the Phase 17A/17B `OperationalJob` lifecycle.
- Provide a missed-webhook and stale-state safety net without introducing external queue infrastructure.
- Keep Shopify Admin GraphQL as canonical truth and keep reconciliation repair rules scoped to existing safe fields.

## Lightweight Scheduler Philosophy
- The scheduler is in-process, DB-backed, and opt-in.
- It does not introduce Redis, BullMQ, RabbitMQ, Kafka, websocket infrastructure, distributed workers, or external cron infrastructure.
- It creates `reconciliation` operational jobs for stale candidates and avoids duplicate job spam with active-job checks and cooldowns.
- Canonical repair execution reuses the existing reconciliation service that fetches Shopify state and compares line-item scoped local state.
- Production can enable scheduling deliberately with env configuration; automatic due-job execution remains separately gated.

## Runtime Configuration
- `SCHEDULED_RECONCILIATION_ENABLED`
  - optional boolean
  - default: `false`
  - when true, app startup registers a low-overhead interval scan
- `SCHEDULED_RECONCILIATION_EXECUTE_DUE`
  - optional boolean
  - default: `false`
  - when true, the interval also executes a capped number of due pending reconciliation jobs
- `SCHEDULED_RECONCILIATION_INTERVAL_MS`
  - optional positive integer
  - default: `1800000` (30 minutes)
- `SCHEDULED_RECONCILIATION_COOLDOWN_MS`
  - optional positive integer
  - default: `1800000` (30 minutes)
- `SCHEDULED_RECONCILIATION_CANDIDATE_LIMIT`
  - optional positive integer
  - default: `25`

## Candidate Heuristics
The scan detects reconciliation candidates for:
- stale allocation fulfillment/tracking state
- missing refund ledger entries after refund records exist
- tracking metadata mismatch between allocation and fulfillment rows
- cancelled fulfillment sync state while allocation still appears fulfilled
- stale shipment timestamp gaps
- retry/dead-letter operational jobs tied to an order or allocation

Heuristics are intentionally advisory. They create operational jobs and diagnostics visibility; they do not invent Shopify state.

## Job Lifecycle
- Candidate scan creates `OperationalJob` rows with:
  - `jobType = reconciliation`
  - allocation/order/refund/return references when available
  - `payload.source = scheduled_reconciliation`
  - `payload.candidateType`
  - `payload.reason`
  - `payload.detectedAt`
  - capped `maxRetries = 1`
- Active reconciliation jobs block duplicate scheduling for the same allocation/order.
- Recently terminal reconciliation jobs enforce a cooldown before another job can be created.
- Due-job execution marks jobs processing, runs canonical reconciliation, and marks completed or failed with retry/dead-letter metadata.

## Diagnostics Visibility
- Admin diagnostics reconciliation now surfaces scheduled reconciliation jobs alongside stuck webhooks, failed webhooks, missing payloads, fulfillment sync failures, and stale allocations.
- Scheduled items expose:
  - operational job id
  - candidate reason
  - related Shopify order/allocation
  - next attempt time
  - last attempt time when available
  - current job status

## Safety Rules
- HMAC verification, webhook idempotency, replay/recover, and vendor isolation are unchanged.
- Scheduled reconciliation never writes Shopify.
- Canonical refresh uses Shopify Admin GraphQL before safe local repair.
- Historical finance records are not deleted.
- Existing reconciliation guardrails remain the source of truth for allowed repairs.
- Cooldowns and active-job checks prevent infinite reconciliation loops.

## Future Worker Evolution
- A later phase can move candidate scanning and due-job execution behind a dedicated worker or managed cron.
- The `OperationalJob` contract is the compatibility boundary for that future worker.
- Future work can add richer dead-letter review, scheduled retry execution, and operator controls without changing webhook ingestion safety contracts.
