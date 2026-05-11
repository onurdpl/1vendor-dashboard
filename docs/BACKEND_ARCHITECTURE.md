# Backend Architecture (Phase 13 Scaffold)

## Stack
- Node.js
- TypeScript
- Fastify
- Prisma
- PostgreSQL (target datastore)

## Why Fastify
- Lightweight and fast HTTP server with low overhead.
- Good TypeScript support for scalable API modules.
- Plugin-friendly for future auth, webhook verification, and observability.

## Current Scope (Scaffold Only)
- Backend project bootstrapped under `backend/`.
- Minimal HTTP app with:
  - `GET /health`
  - `GET /version`
- Environment loader with:
  - `PORT` (default `4000`)
  - `NODE_ENV`
  - `DATABASE_URL` optional for now (required when DB actions are added).
- Prisma schema drafted for the marketplace domain model.

## Local Backend Verification
Run from repository root:

1. `npm --prefix backend ci`
2. `npm run backend:build`
3. `npm run backend:typecheck`
4. `npm run backend:smoke`
5. `npm run backend:db:generate`

Smoke verifies:
- backend process starts without a database connection
- `GET /health` returns `{ "ok": true }`
- `GET /version` returns service and version metadata
- process shuts down cleanly after checks

`DATABASE_URL` is not required for this smoke because DB actions are not wired yet.

## Local PostgreSQL Setup (Development)
Recommended local setup:
- PostgreSQL running on localhost
- default example credentials for local development only

Environment example (`backend/.env.example`):
- `PORT=4000`
- `NODE_ENV=development`
- `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/vendor_dashboard_dev`

Common workflow:
1. `cp backend/.env.example backend/.env`
2. ensure local PostgreSQL is running
3. `npm run backend:db:generate`
4. `npm run backend:db:migrate` (creates/applies local dev migration)
5. `npm run backend:db:studio` (optional data inspection)

Alternative for quick schema sync without migration history:
- `npm run backend:db:push`

## Single Shopify Store Model
- One Shopify store for the whole platform.
- Vendors do not connect independent stores.
- Variant-level vendor ownership is derived from Shopify metafield data.
- A single Shopify order can contain line items allocated to multiple vendors.

## Vendor Allocation Model
- Backend persists source Shopify order and line items.
- Backend creates vendor allocations from line-item vendor mapping.
- Core fields supported:
  - `originalVendorId`
  - `assignedVendorId`
  - `allocationStatus`
  - `cancellationReason`
  - `reassignmentRequired`
  - `sourceShopifyOrderId`
  - `sourceShopifyOrderNumber`

## Fulfillment and Tracking Flow (Planned)
1. Vendor submits tracking data in dashboard.
2. Frontend sends request to backend API.
3. Backend validates vendor ownership/permissions.
4. Backend stores fulfillment + tracking state.
5. Backend updates Shopify fulfillment/tracking via Admin/Fulfillment APIs.

Frontend will never call Shopify directly or hold Shopify credentials.

## Returns and Refunds Flow (Planned)
1. Shopify emits return/refund webhook events.
2. Backend ingests and validates events.
3. Backend maps returned/refunded line items to vendor allocations.
4. Vendor reads only their scoped records; admin can inspect full impact.

## Finance Model (Phase 13 Initial)
- Reporting-only vendor finance in first backend phase:
  - gross sales
  - refunds
  - commission/platform fee
  - net payout estimate
  - payout status
- Actual payout execution remains manual/admin-controlled.

## Webhook and Idempotency Plan (Next Phases)
- Persist raw webhook envelope metadata in `WebhookEvent`.
- Enforce idempotency using unique webhook identifiers:
  - `sourceShopDomain + topic + webhookId`
- Keep payload hash and processing state for safe retries/reprocessing.
- Move webhook processing to async job flow in later phases (Redis/BullMQ not included in this step).

## CI Validation
GitHub Actions CI validates both frontend and backend on push/PR to `main`:
- frontend install/build/test
- backend install/build/typecheck
- backend smoke (`/health` + `/version`)

## Health Endpoints Rationale
- `GET /health` stays database-independent so process liveness checks never fail due to temporary DB downtime or missing local DB configuration.
- `GET /health/db` is optional/readiness-oriented:
  - returns `not_configured` when `DATABASE_URL` is missing
  - returns `connected` when lightweight DB query succeeds
  - returns `unavailable` when DB is configured but not reachable

## Migration Expectations
- Migrations should be created only with a real local PostgreSQL connection.
- If local PostgreSQL is unavailable, migration generation is intentionally deferred (no fake SQL migration files).
