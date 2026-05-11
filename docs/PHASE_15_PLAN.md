# Phase 15 Operational Roadmap

## Purpose
- Establish the Phase 15 roadmap before new runtime behavior is added.
- Turn the Phase 14 live-verification milestone into a practical hardening plan.
- Keep implementation aligned with verified Shopify behavior and the current backend/frontend boundaries.

## Phase 15 Goals
- Improve operational frontend maturity in real mode.
- Prepare the architecture for async-safe processing without introducing queue workers yet.
- Establish an observability baseline for live operational flows.
- Define the deployment shape needed for stable production operation.
- Improve operational ergonomics for admins and vendors.
- Hardening for reliability, recovery, and safe rollout.

## Planned Workstreams

### Frontend Real-Mode Completion
- Complete real-mode coverage for remaining operational screens that still depend on mock behavior.
- Reduce friction between backend operational state and frontend operator workflows.
- Make vendor and admin flows feel production-ready instead of transitional.

### Async Processing Preparation
- Define which webhook-driven and sync-driven operations should move to background processing later.
- Prepare replay-safe and retry-safe boundaries without introducing a queue in this step.
- Clarify where eventual consistency is acceptable and where synchronous guarantees still matter.

### Operational Observability
- Improve visibility into ingestion, fulfillment sync, refund processing, replay, and reconciliation.
- Standardize what operators need to see in logs, diagnostics, and future dashboards.

### Deployment & Environment Strategy
- Define the intended stable hosting model for backend, database, and webhook ingress.
- Formalize environment separation and production secret handling.

### Operational UX & Admin Tooling
- Improve diagnostics, reconciliation, replay, and live-state workflows in the frontend.
- Reduce operator confusion during failure handling and manual recovery.

### Reliability Hardening
- Strengthen failure handling, recovery paths, operator safeguards, and production rollout confidence.
- Prepare for higher-volume usage without prematurely forcing distributed infrastructure decisions.

## Frontend Operationalization Scope
- Live order detail polish so vendor and admin views reflect backend operational state clearly.
- Live fulfillment visibility, including shipping state, tracking state, and ownership boundaries.
- Refund visibility with clearer operational attribution and vendor-safe detail views.
- Diagnostics UX improvements for webhook events, sync failures, and replayable events.
- Reconciliation UX improvements for stuck events, missing payload events, and suggested actions.
- Operational loading and error states that behave cleanly in real mode when the backend is unavailable or slow.
- Vendor operational flows that reduce ambiguity around what a vendor can act on.
- Admin operational flows for cross-vendor inspection, recovery, and attention management.

## Async Processing Preparation
- Intended future job boundaries:
  - order ingestion
  - seller_info retry handling
  - refund ingestion
  - fulfillment sync submission
  - replay-triggered reprocessing
- Replay-safe processing expectations:
  - every replayable operation must remain idempotent
  - stored payload replay must not create duplicate allocations, refunds, or finance records
  - retries must preserve operator-auditable state transitions
- Retry boundaries:
  - webhook receipt remains immediate
  - downstream processing may eventually move to background execution
  - retryable failures should be distinguishable from operator-attention failures
- Idempotency requirements:
  - webhook-level duplicate protection remains mandatory
  - order, refund, fulfillment, and ledger persistence must stay stable under replay or retry
- Queue candidate operations for later phases:
  - seller_info retry work
  - webhook-driven ingestion work
  - fulfillment submission retries
  - reconciliation-driven replay attempts
- Eventual consistency expectations:
  - Shopify-originated data may appear before all downstream operational state is ready
  - frontend/operator surfaces should tolerate processing lag without implying data corruption

## Observability Scope
- Structured logging direction:
  - webhook receipt
  - HMAC verification result
  - idempotency outcome
  - seller_info fetch attempts
  - ingestion success/failure
  - fulfillment sync result
  - replay actions
  - reconciliation counts
- Metrics targets:
  - webhook volume by topic
  - processing success/failure counts
  - replay frequency
  - reconciliation backlog size
  - fulfillment sync failure counts
  - retry exhaustion counts
- Alerting candidates:
  - repeated ingestion failures
  - growing stuck `RECEIVED` webhook backlog
  - fulfillment sync failures
  - repeated replay attempts on the same event
  - unexpected spikes in unresolved vendor mapping
- Audit trail expectations:
  - admin-triggered replay actions should remain traceable
  - vendor fulfillment submissions should remain attributable
  - allocation and refund state transitions should remain inspectable
- Operational dashboards:
  - backend-facing operational metrics dashboard
  - admin-facing diagnostics/reconciliation visibility
  - environment health and webhook health monitoring

## Deployment Shape
- Stable backend hosting with a persistent public webhook endpoint.
- Production-grade PostgreSQL as the long-lived operational datastore.
- Clear staging/live environment separation for:
  - backend deployment
  - database
  - secrets
  - webhook targets
  - frontend real-mode configuration
- Production secret management for:
  - Shopify Admin access token
  - Shopify webhook secret
  - JWT secret
  - database credentials
- Monitoring and runtime health visibility for production services.
- No assumption yet of Kubernetes, service mesh, or distributed orchestration.

## Operational UX & Admin Tooling Focus
- Make diagnostics easier to triage without reading raw backend state manually.
- Improve replay affordances so operators can understand when replay is safe, unavailable, or likely to fail again.
- Improve reconciliation surfaces so suggested actions feel actionable rather than purely descriptive.
- Reduce confusion between vendor-scoped and admin-scoped operational views.
- Improve real-mode session clarity, backend-unavailable messaging, and operational continuity in the UI.

## Reliability Hardening Focus
- Strengthen graceful handling of seller_info timing races.
- Reduce dependence on manual interpretation for known failure classes.
- Harden live-mode behavior around temporary backend/network failures.
- Define safer operator workflows for replay and manual recovery.
- Prepare for larger event volume while staying within the current single-node assumption until the next architecture step is explicitly chosen.

## Explicit Non-Goals
- No inventory engine yet.
- No payout execution engine yet.
- No distributed orchestration yet.
- No microservice split yet.
- No queue worker implementation yet.
- No Shopify behavior changes beyond what is already documented and verified.
- No ingestion architecture refactor in this planning step.

## Phase 15 Outcome Target
- By the end of Phase 15, the system should be materially more production-ready from an operational perspective:
  - operators can trust the frontend in real mode more consistently
  - failure and recovery paths are clearer
  - deployment and monitoring direction is explicit
  - the backend is better prepared for future async processing without unverified architectural jumps
