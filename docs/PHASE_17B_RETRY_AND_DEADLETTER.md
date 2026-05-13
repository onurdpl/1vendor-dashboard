# Phase 17B Retry and Dead-letter Foundation

## Purpose
- Add retry scheduling, retry execution boundaries, and dead-letter readiness on top of the Phase 17A `OperationalJob` foundation.
- Keep the platform lightweight and DB-backed without introducing Redis, BullMQ, Kafka, RabbitMQ, background daemon orchestration, websocket infrastructure, or an event-sourcing rewrite.
- Improve operator visibility for retry state, retry exhaustion, and failures that require canonical Shopify reconciliation or manual intervention.

## Retry Lifecycle
- Operational job statuses now include:
  - `pending`
  - `processing`
  - `completed`
  - `failed`
  - `retry_scheduled`
  - `retrying`
  - `dead_letter_ready`
  - `permanently_failed`
- Retry metadata:
  - `retryCount`
  - `maxRetries`
  - `nextRetryAt`
  - `lastAttemptAt`
  - `retryBackoffMs`
  - `failureCategory`
  - `escalationReason`

## Failure Categories
- `transient`
  - temporary network, timeout, rate-limit, or Shopify dependency failures
  - eligible for scheduled retry until `maxRetries` is reached
- `validation`
  - missing payload fields, invalid IDs, or deterministic malformed input
  - not automatically retried
- `reconciliation_required`
  - canonical Shopify or mapping state needs operator review before retry
  - not automatically retried
- `permanent`
  - known unrecoverable outcome
  - becomes `permanently_failed`
- `duplicate_noop`
  - duplicate/no-op outcome
  - not automatically retried

## Dead-letter Readiness
- Repeated transient failures escalate to `dead_letter_ready` after retry attempts are exhausted.
- Dead-letter readiness is an internal operational state, not an external DLQ.
- `dead_letter_ready` means an operator should inspect diagnostics, replay/recover eligibility, canonical Shopify state, or mapping/reconciliation before another attempt.

## Retry Execution
- Admin diagnostics now exposes an operational job retry endpoint:
  - `POST /admin/diagnostics/jobs/:operationalJobId/retry`
- The endpoint is admin-only.
- Current retry execution supports webhook-linked operational jobs with stored payloads.
- Completed jobs and jobs already processing/retrying are blocked.
- Retry execution reuses the same idempotent webhook processing services used by replay/recover, preserving allocation, refund, return, and fulfillment idempotency.

## Diagnostics Visibility
- Webhook diagnostics include retry metadata for related operational jobs:
  - job status
  - retry count and max retries
  - next retry time
  - last attempt time
  - failure category
  - escalation reason
  - safe error summary
- The diagnostics UI surfaces retry badges, retry actions for retryable states, and dead-letter/permanent failure indicators.

## Guardrails
- Shopify HMAC verification and webhook idempotency remain unchanged.
- Duplicate deliveries still do not create duplicate operational jobs.
- Jobs do not invent Shopify state.
- Reconciliation remains canonical and operator-triggered.
- There is still no autonomous scheduler or background worker in this phase.

## Future Scheduler Evolution
- A future Phase 17C/17D can add a small scheduler that selects `retry_scheduled` jobs where `nextRetryAt <= now`.
- External queue infrastructure should only be introduced after the DB-backed lifecycle proves insufficient for throughput or latency.
