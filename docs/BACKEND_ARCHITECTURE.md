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
  - `GET /admin/orders/:shopifyOrderId`
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
6. `npm run real-api:dry-run` (requires backend already running on `http://127.0.0.1:4000` by default)

Smoke verifies:
- backend process starts without a database connection
- `GET /health` returns `{ "ok": true }`
- `GET /version` returns service and version metadata
- process shuts down cleanly after checks

Real API dry-run verifies:
- backend login succeeds for seeded admin demo credentials
- DB-backed read endpoints return minimally compatible response shapes for frontend migration planning
- running the dry-run does not switch the frontend runtime away from mock mode

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
- Active vendor, stock ownership, and pricing are managed by an external source system and synced into Shopify.
- This application starts from post-order operations after a Shopify order already exists.

## Vendor Allocation Model
- Backend persists source Shopify order and line items.
- Backend creates vendor allocations from line-item vendor mapping.
- Vendor mapping is resolved from the Shopify variant vendor metafield into internal vendor IDs.
- Core fields supported:
  - `originalVendorId`
  - `assignedVendorId`
  - `allocationStatus`
  - `cancellationReason`
  - `reassignmentRequired`
  - `sourceShopifyOrderId`
  - `sourceShopifyOrderNumber`

## Shopify Vendor Mapping Foundation (Phase 13 Step 14)
- Backend Shopify vendor mapping service now exists under `backend/src/modules/shopify/`.
- `resolveVendorFromMetafield(value)` performs:
  - trim
  - case-insensitive comparison
  - Turkish-character-safe normalization where practical
  - realistic seeded vendor mapping
- Current seeded mappings include:
  - `Yalı Spor` / `Yali Spor` -> `yalispor`
  - `Sporjinal` -> `sporjinal`
  - `Sporvol` -> `sporvol`
- Unknown or empty vendor metafield values resolve safely to `null`.
- Temporary non-production diagnostic route:
  - `GET /debug/shopify/vendor-mapping?value=Yalı%20Spor`
- Confirmed Shopify integration discoveries and open implementation questions are documented in [SHOPIFY_DISCOVERIES.md](/Users/onur/Documents/New project 4/docs/SHOPIFY_DISCOVERIES.md) and should be reviewed before Shopify-dependent implementation.

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

## Shopify Webhook Idempotency (Phase 13 Step 16)
- `POST /webhooks/shopify/orders-create` now performs duplicate-delivery protection before any future ingestion logic exists.
- Idempotency strategy:
  - primary key: `sourceShopDomain + topic + webhookId`
  - fallback key: `sourceShopDomain + topic + payloadHash`
- Duplicate deliveries are accepted with `202` but ignored operationally:
  - first occurrence -> `action: "accepted"`
  - duplicate occurrence -> `action: "duplicate_ignored"`
- Duplicate webhook deliveries do not create a second processing record.
- This phase still does not:
  - ingest orders
  - fetch `seller_info`
  - create allocations
  - call Shopify Admin API
- Payload processing remains deferred to later phases, but webhook envelope persistence is now safe for Shopify retry behavior.

## Shopify Webhook Verification Skeleton (Phase 13 Step 15)
- First webhook endpoint exists:
  - `POST /webhooks/shopify/orders-create`
- Current behavior:
  - reads raw request body
  - verifies `X-Shopify-Hmac-Sha256`
  - computes payload hash and idempotency key
  - returns `202 Accepted` for valid signatures
  - returns `401` for invalid signatures
  - returns duplicate-aware response semantics without ingesting orders yet
- Secret handling:
  - production requires explicit `SHOPIFY_WEBHOOK_SECRET`
  - development/test use safe local default `dev-shopify-webhook-secret`
- Persistence in this phase is limited to raw webhook envelope metadata through `WebhookEvent`; payload processing is deferred.

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

## DB-Backed Admin Shopify Order Breakdown API (Phase 13 Step 12)
- Admin order breakdown route is now backed by PostgreSQL via Prisma:
  - `GET /admin/orders/:shopifyOrderId`
- Route requires:
  - authenticated user
  - admin role
- Vendor users are denied with `403`.
- Missing Shopify orders return `404`.
- Response returns:
  - source Shopify order metadata
  - all vendor allocations for the order
  - allocation line items
  - assignment history
  - vendor-scoped return/refund records tied to each allocation
- Frontend remains mock-based in this phase; backend admin order breakdown route is prepared for future integration.
