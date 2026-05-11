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
- Backend auth foundation endpoints:
  - `POST /auth/login`
  - `GET /auth/me`
- First DB-backed vendor-scoped read API:
  - `GET /orders`
  - `GET /orders/:orderId`
  - `GET /returns`
  - `GET /returns/:returnId`
  - `GET /finance`
  - `GET /admin/operations`

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
- `JWT_SECRET=dev-only-jwt-secret-change-in-production`
- `JWT_EXPIRES_IN=12h`

Common workflow:
1. `cp backend/.env.example backend/.env`
2. ensure local PostgreSQL is running
3. `npm run backend:db:generate`
4. `npm run backend:db:migrate` (creates/applies local dev migration)
5. `npm run backend:db:studio` (optional data inspection)
6. `npm run backend:db:seed` (idempotent demo data seed)

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

## Demo Seed Data (Local Only)
Seed command:
- `npm run backend:db:seed`

Seeded vendors:
- `yalispor` → `Yalı Spor`
- `sporjinal` → `Sporjinal`
- `sporvol` → `Sporvol`

Seeded users:
- `admin@demo.com` (role: `admin`, access: all three vendors)
- `yalispor@demo.com` (role: `vendor`, access: `yalispor`)
- `sporjinal@demo.com` (role: `vendor`, access: `sporjinal`)
- `sporvol@demo.com` (role: `vendor`, access: `sporvol`)

Seed credentials are demo/local only:
- password: `demo123`
- stored as a clearly marked demo hash format in DB seed flow
- not suitable for production authentication

Frontend note:
- frontend continues using mock authentication and mock vendor IDs until real API/auth migration is implemented.

## Backend Auth Foundation (Demo Phase)
- `POST /auth/login` validates seeded demo users (`demo123`) against demo seed hashes.
- `GET /auth/me` requires `Authorization: Bearer <token>` and returns current user + vendor access.
- JWT tokens are signed using `JWT_SECRET`.
- In development/test, a default JWT secret is allowed for local convenience.
- In production, `JWT_SECRET` must be explicitly set.
- Password hashing in this phase is demo-only and must be replaced with production-grade hashing before real auth rollout.

## Vendor Access Validation Foundation (Phase 13 Step 7)
- Backend resolves request vendor context from authenticated user access + requested `X-Vendor-Id`.
- `X-Vendor-Id` is request context only and is never blindly trusted.
- Admin behavior:
  - may request vendors only if mapped in backend `UserVendorAccess`
  - if no vendor is requested, backend resolves first accessible vendor
- Vendor behavior:
  - may request only mapped vendor IDs
  - requesting another vendor returns `403`
  - if only one vendor mapping exists and header is missing, backend resolves that vendor
- Middleware `requireVendorAccess` enforces this and attaches `request.vendorContext`.
- Temporary diagnostic route (non-production):
  - `GET /debug/vendor-context`
  - requires auth and vendor access middleware
  - intended only for integration validation in development/test
- Future data routes should use the same middleware for safe vendor scoping.

## First DB-Backed Read API (Phase 13 Step 8)
- Orders read routes are now backed by PostgreSQL via Prisma:
  - `GET /orders`
  - `GET /orders/:orderId`
- Both routes require:
  - authenticated user
  - `requireVendorAccess` middleware
- Order reads are scoped using backend-resolved `request.vendorContext.vendorId`, not raw frontend header trust.
- Cross-vendor detail access returns `404` under vendor-scoped query semantics.
- Frontend remains mock-based in this phase; backend routes are prepared for future integration.

## DB-Backed Returns/Refunds Read API (Phase 13 Step 9)
- Returns/refunds read routes are now backed by PostgreSQL via Prisma:
  - `GET /returns`
  - `GET /returns/:returnId`
- Both routes require:
  - authenticated user
  - `requireVendorAccess` middleware
- Return reads are scoped using backend-resolved `request.vendorContext.vendorId`, not raw frontend header trust.
- Cross-vendor return detail access returns `404` under vendor-scoped query semantics.
- Seed data includes a shared Shopify order refund scenario (`#1001`) allocated separately for `yalispor` and `sporjinal`.
- Frontend remains mock-based in this phase; backend returns routes are prepared for future integration.

## DB-Backed Finance Read API (Phase 13 Step 10)
- Finance read route is now backed by PostgreSQL via Prisma:
  - `GET /finance`
- Route requires:
  - authenticated user
  - `requireVendorAccess` middleware
- Finance reads are scoped using backend-resolved `request.vendorContext.vendorId`, not raw frontend header trust.
- Response returns:
  - `summary`: `grossSales`, `refunds`, `netRevenue`, `platformFee`, `payoutEstimate`, `payoutStatus`
  - `records`: vendor-scoped ledger entries with related order/refund references where available
- Model remains reporting-only:
  - no payout provider integration
  - no money movement execution
  - deterministic platform fee in this phase (`10%` of net revenue)
  - payout estimate (`netRevenue - platformFee`)
- Frontend remains mock-based in this phase; backend finance route is prepared for future integration.

## DB-Backed Admin Operations Queue API (Phase 13 Step 11)
- Admin operations queue route is now backed by PostgreSQL via Prisma:
  - `GET /admin/operations`
- Route requires:
  - authenticated user
  - admin role
- Vendor users are denied with `403`.
- Queue is derived from DB-backed operational state:
  - vendor allocations needing reassignment
  - vendor blocked allocations
  - awaiting shipment allocations
  - pending/open return-refund attention signals
- Response includes:
  - summary counters by severity and queue type
  - operational items with vendor/order/return/refund references
- Frontend remains mock-based in this phase; backend operations route is prepared for future integration.
