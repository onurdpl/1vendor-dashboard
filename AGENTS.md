# AGENTS.md

## Project Overview

This project is a production Shopify multi-vendor operational platform.

Core responsibilities:
- Shopify webhook ingestion
- Vendor allocation management
- Returns lifecycle
- Refund lifecycle
- Fulfillment lifecycle
- Finance operational visibility
- Diagnostics/recovery tooling
- Operational reconciliation

This project is NOT:
- a marketplace
- an ERP
- a shipping carrier
- an invoice generator
- a label generator

External providers may generate:
- invoices
- shipment labels
- carrier records

This platform acts as the operational control center and source of operational truth.

---

## Architecture Principles

- Shopify Admin GraphQL is the canonical external source of truth.
- Local DB state may become stale and must be reconcilable.
- Webhook payloads are treated as event envelopes, not absolute truth.
- Canonical Shopify re-fetch is preferred before destructive operational mutations.
- Vendor isolation is critical.
- Allocation-level scoping is mandatory.
- Multi-vendor order correctness is mandatory.
- Idempotency is mandatory for all webhook ingestion.
- HMAC verification must never be weakened.

---

## Shopify Rules

Before implementing Shopify-dependent behavior:

1. Read:
   - docs/SHOPIFY_DISCOVERIES.md
   - docs/BACKEND_ARCHITECTURE.md
   - docs/API_CONTRACTS.md

2. If Shopify operational semantics are uncertain:
   - investigate official Shopify docs
   - prefer canonical GraphQL state
   - document uncertainty explicitly
   - do not invent Shopify behavior

3. Do not rely on:
   - derived UI display fields for business logic
   - fulfillment_events/create for cancellation truth
   - orders/updated as primary operational signal

4. Prefer:
   - fulfillmentOrder.status
   - canonical fulfillment GraphQL fetch
   - line-item scoped reconciliation

---

## Operational Safety Rules

- Preserve vendor isolation.
- Never leak another vendor's allocations, returns, refunds, or fulfillment state.
- Never apply tracking/refund/return state to unrelated allocations.
- Preserve historical financial records.
- Preserve replay/recovery auditability.
- Replay/recover tooling must remain admin-only.
- Never expose secrets or full sensitive webhook payloads in diagnostics.

---

## Coding Rules

- Make minimal targeted changes.
- Avoid broad refactors.
- Preserve existing env names and runtime behavior.
- Keep production-safe defaults.
- Prefer incremental stabilization over architectural rewrites.
- Do not remove operational diagnostics.
- Do not silently swallow reconciliation errors.

---

## Required Validation

Before completing changes, run when applicable:

npm run build
npm run test
npm run backend:build
npm run backend:typecheck
npm run backend:smoke
npm run real-api:dry-run

If local DB env is unreachable, explicitly document the reason and use deterministic local DATABASE_URL override where appropriate.

---

## Codex Resource and Validation Budget

- Select the required validation commands above according to the changed files and actual risk; unrelated checks are not mandatory.
- Never repeat the same test unless a specific intermittent failure requires reproduction and the user explicitly approves repetition.
- For small changes, run only directly affected tests, once.
- Do not automatically run the full test suite for every task.
- When only frontend files change, do not run backend builds, PostgreSQL suites or unrelated checks.
- Do not start real-browser smoke tests, extended audits or additional validation packages without a concrete justification and user approval.
- Do not continuously poll GitHub CI, Render or other external systems. One status check is sufficient unless further monitoring is explicitly requested.
- Do not automatically create a PR, merge, deploy or monitor post-merge CI without explicit authorization for that release step.
- Explain the purpose of an expensive operation and obtain approval before starting it.
- If an operation is unexpectedly slow or blocked, stop instead of repeatedly retrying.
- Never weaken financial safety, Vendor isolation, authorization or data-integrity assertions to save execution time.
- Report unverified behavior as `UNKNOWN`.
- One authorized development task includes its necessary GitHub workflow: local changes, commit, push, PR, and required CI and merge checks when the user authorizes end-to-end completion. Do not split local implementation and GitHub delivery into separate tasks unnecessarily.
- Do not repeat already passing local tests without a relevant code change or failure; do not run unrelated full suites, backend checks, or browser suites locally.
- Keep existing mandatory GitHub CI checks intact. Prefer GitHub's existing automation over continuous manual CI polling; do not launch duplicate runs.
- Never enable repository settings or bypass required checks. Do not repeatedly poll GitHub or Render.
- Stop on a genuine CI failure; do not automatically start an unrelated investigation.
- Production financial or operational writes require specific authorization.

---

## Deployment Notes

Production:
- Frontend: Render
- Backend: Render
- Database: Render Postgres

Webhook subscriptions are managed primarily through GraphQL registration scripts.

Do not assume Shopify Admin UI reflects all active subscriptions.

---

## Current Operational Domains

Implemented:
- orders/create
- refunds/create
- returns/request
- returns/approve
- returns/decline
- returns/close
- fulfillments/create
- fulfillments/update
- fulfillment_events/create
- fulfillment_orders/cancelled

Stabilized:
- tracking sync
- fulfillment cancellation rollback
- diagnostics replay/recover
- reconciliation tooling
- mixed-state webhook registration
- duplicate-safe webhook idempotency

---

## Response Expectations

Implementation reports should include:
- Root Cause
- Changed Files
- What Changed
- Behavior Verified
- Commands Run
- Manual Smoke Test
- Remaining Unknowns

Unknown behavior must be labeled explicitly as unknown.
