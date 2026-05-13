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
- Shopify webhook smoke signs test payloads with the same effective `SHOPIFY_WEBHOOK_SECRET` the spawned backend process uses, so local live secrets do not break deterministic smoke verification

Real API dry-run verifies:
- backend login succeeds for seeded admin demo credentials
- DB-backed read endpoints return minimally compatible response shapes for frontend migration planning
- running the dry-run does not switch the frontend runtime away from mock mode

## Frontend Real API Migration Strategy (Phase 13 Step 20)
- Frontend runtime now supports safe API-mode switching without removing mock mode.
- Runtime environment:
  - `VITE_API_MODE=mock` -> default, existing mock runtime behavior
  - `VITE_API_MODE=real` -> use backend APIs at `VITE_API_BASE_URL`
  - `VITE_API_BASE_URL=http://127.0.0.1:4000` -> recommended local backend target
- Local browser real-mode requirement:
  - frontend typically runs on `http://127.0.0.1:5173`
  - backend typically runs on `http://127.0.0.1:4000`
  - backend must allow configured browser origins through `CORS_ORIGIN`
  - preflight `OPTIONS` requests must succeed for login and authenticated API calls
- Migration design goals:
  - mock mode remains the default and the primary safe fallback
  - backend-offline conditions must fail gracefully without crashing the app
  - migration stays incremental and reversible
  - no auth-provider rewrite, routing rewrite, or global state rewrite
- Current frontend real-mode coverage is intentionally partial:
  - login uses backend `POST /auth/login` in real mode
  - orders pages use backend-backed runtime services in real mode
  - returns pages use backend-backed runtime services in real mode
  - finance page uses backend-backed runtime service in real mode
  - admin operations queue uses backend-backed runtime service in real mode
- Current non-migrated areas remain mock-backed by design:
  - dashboard
  - automation
  - any future pages not explicitly switched to runtime services
- Dry migration note:
  - real mode is a frontend transport/runtime switch only
  - frontend still does not call Shopify directly
  - mock data remains available for local-safe fallback and regression comparison

`DATABASE_URL` is not required for this smoke because DB actions are not wired yet.

## Local PostgreSQL Setup (Development)
Recommended local setup:
- PostgreSQL running on localhost
- default example credentials for local development only

Environment example (`backend/.env.example`):
- `PORT=4000`
- `NODE_ENV=development`
- `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/vendor_dashboard_dev`
- `CORS_ORIGIN=http://127.0.0.1:5173,http://localhost:5173`
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

## Backend CORS Support (Phase 13.6)
- Backend now uses `@fastify/cors` so the Vite frontend can call the local API in browser real mode.
- `CORS_ORIGIN` accepts a comma-separated list of allowed origins.
- Development/test default origins:
  - `http://127.0.0.1:5173`
  - `http://localhost:5173`
- Production requires explicit configured origins.
- Allowed methods:
  - `GET`
  - `POST`
  - `OPTIONS`
- Allowed headers include:
  - `Authorization`
  - `Content-Type`
  - `X-Vendor-Id`
  - `X-Shopify-Hmac-Sha256`
  - `X-Shopify-Shop-Domain`
  - `X-Shopify-Webhook-Id`
  - `X-Shopify-Topic`
- Real-mode browser login depends on successful preflight handling for endpoints such as:
  - `/auth/login`
  - `/auth/me`
  - `/orders`
  - `/returns`
  - `/finance`
  - `/admin/operations`

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
- Live rollout readiness and manual webhook rollout steps are documented in [SHOPIFY_LIVE_ROLLOUT.md](/Users/onur/Documents/New project 4/docs/SHOPIFY_LIVE_ROLLOUT.md).

## Shopify Live Readiness Foundation (Phase 14-1)
- Live Shopify rollout now has a dedicated readiness command:
  - `npm run shopify:readiness`
  - `npm --prefix backend run shopify:readiness`
- Readiness validates:
  - `SHOPIFY_SHOP_DOMAIN`
  - `SHOPIFY_ADMIN_ACCESS_TOKEN`
  - `SHOPIFY_WEBHOOK_SECRET`
  - `SHOPIFY_API_VERSION`
- Optional webhook-secret override:
  - `SHOPIFY_RETURN_WEBHOOK_SECRET`
  - when set, return lifecycle webhook routes use this secret instead of the default webhook secret
  - this is useful when return lifecycle subscriptions are created through a different Shopify app secret than orders/refunds routes
- Optional fulfillment webhook-secret override:
  - `SHOPIFY_FULFILLMENT_WEBHOOK_SECRET`
  - when set, fulfillment lifecycle webhook routes use this secret instead of the default webhook secret
  - this is useful when GraphQL-created fulfillment webhook subscriptions are signed with a different app secret than orders/refunds routes
- Safety behavior:
  - missing variables are reported by name only
  - secret values are never printed
  - development placeholder values fail readiness
  - default behavior is config-only and does not call live Shopify
- Optional live check:
  - set `SHOPIFY_READINESS_LIVE_CHECK=true`
  - runs a lightweight Shopify Admin GraphQL query:
    - `query { shop { name myshopifyDomain } }`
- This keeps normal build, smoke, and dry-run flows isolated from live Shopify dependencies until rollout is intentional.

## Phase 14 Closure Checkpoint
- The official Phase 14 operational readiness checkpoint is documented in [PHASE_14_CLOSURE.md](/Users/onur/Documents/New project 4/docs/PHASE_14_CLOSURE.md).
- Use that document as the source of truth for:
  - live-verified Shopify capabilities
  - current operational limitations
  - risk register items
  - Phase 15 entry criteria
  - recommended production-readiness steps before real merchant rollout

## Phase 15 Roadmap Baseline
- The official Phase 15 roadmap baseline is documented in [PHASE_15_PLAN.md](/Users/onur/Documents/New project 4/docs/PHASE_15_PLAN.md).
- Use that document as the planning source of truth for:
  - operational frontend maturity targets
  - async processing preparation boundaries
  - observability baseline direction
  - deployment-readiness direction
  - operational UX and reliability-hardening workstreams

## Phase 17A Async Processing Foundation
- The lightweight async operational foundation is documented in [PHASE_17A_ASYNC_FOUNDATION.md](/Users/onur/Documents/New project 4/docs/PHASE_17A_ASYNC_FOUNDATION.md).
- Backend now includes an `OperationalJob` model for internal processing lifecycle persistence.
- Current execution remains inline after the existing safety boundaries:
  1. Shopify HMAC verification
  2. webhook idempotency
  3. operational job creation for first accepted deliveries/operator actions
  4. existing ingestion/replay/recover/reconciliation execution
  5. job completion/failure recording
- Job statuses are retry-ready:
  - `pending`
  - `processing`
  - `completed`
  - `failed`
  - `retry_scheduled`
  - `dead_letter_ready`
- Job categories cover:
  - webhook processing
  - reconciliation
  - replay
  - recovery
  - fulfillment sync
  - refund sync
  - return sync
- No external queue infrastructure was added. There is still no Redis, BullMQ, RabbitMQ, Kafka, daemon worker, scheduler, websocket layer, or event-sourcing rewrite.
- Operational jobs are observability and retry-preparation metadata. They do not replace Shopify Admin GraphQL as canonical truth and do not weaken HMAC, idempotency, vendor isolation, or admin-only recovery rules.
- Runtime verification note:
  - local smoke requires a reachable local Postgres `DATABASE_URL` and the Phase 17A migration applied
  - use an explicit shell override for deterministic local validation:
    - `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/vendor_dashboard_dev npm run backend:smoke`
  - if `backend/.env` has duplicate `DATABASE_URL` entries, the later value can override the intended local database for Prisma/dotenv consumers
- Render production must run `prisma migrate deploy` against Render Postgres before operational job persistence is considered production-verified

## Phase 17B Retry and Dead-letter Foundation
- The retry and dead-letter lifecycle is documented in [PHASE_17B_RETRY_AND_DEADLETTER.md](/Users/onur/Documents/New project 4/docs/PHASE_17B_RETRY_AND_DEADLETTER.md).
- `OperationalJob` now models retry execution and escalation metadata:
  - `retrying`
  - `dead_letter_ready`
  - `permanently_failed`
  - `nextRetryAt`
  - `lastAttemptAt`
  - `retryBackoffMs`
  - `failureCategory`
  - `escalationReason`
- Failure categories are lightweight and operational:
  - transient failures can schedule retries with capped exponential backoff
  - validation and reconciliation-required failures do not loop automatically
  - exhausted transient failures become `dead_letter_ready`
- Admin-only retry endpoint:
  - `POST /admin/diagnostics/jobs/:operationalJobId/retry`
- Current retry execution is limited to webhook-linked operational jobs with stored payloads and reuses existing idempotent webhook processors.
- This phase still does not add daemon workers, polling schedulers, Redis, BullMQ, Kafka, RabbitMQ, websocket infrastructure, or external DLQ infrastructure.

## Phase 17C Scheduled Reconciliation Foundation
- The scheduled reconciliation foundation is documented in [PHASE_17C_SCHEDULED_RECONCILIATION.md](/Users/onur/Documents/New project 4/docs/PHASE_17C_SCHEDULED_RECONCILIATION.md).
- Backend now includes an opt-in in-process reconciliation scan that creates `reconciliation` operational jobs for stale candidates.
- Scheduler env controls:
  - `SCHEDULED_RECONCILIATION_ENABLED` defaults to `false`
  - `SCHEDULED_RECONCILIATION_EXECUTE_DUE` defaults to `false`
  - `SCHEDULED_RECONCILIATION_INTERVAL_MS` defaults to 30 minutes
  - `SCHEDULED_RECONCILIATION_COOLDOWN_MS` defaults to 30 minutes
  - `SCHEDULED_RECONCILIATION_CANDIDATE_LIMIT` defaults to 25
- Candidate heuristics cover stale allocation state, missing refund ledger rows, tracking mismatches, cancelled fulfillment/local fulfilled conflicts, stale shipment timestamps, and retry/dead-letter jobs linked to orders or allocations.
- Duplicate protection:
  - active reconciliation jobs block new scheduled jobs for the same allocation/order
  - recently terminal reconciliation jobs enforce cooldown before another scheduled job can be created
- Canonical refresh execution reuses the existing admin reconciliation service:
  - fetch Shopify Admin GraphQL state
  - compare local operational state
  - repair only existing safe reconciliation fields
  - record completion/failure on the operational job
- Admin diagnostics reconciliation now surfaces scheduled reconciliation jobs with job id, candidate reason, current status, related order/allocation, and next/last attempt metadata.
- This phase still does not add Redis, BullMQ, Kafka, RabbitMQ, Kubernetes cron, distributed workers, websocket infrastructure, or event-sourcing changes.

## Phase 17D Operational Observability and Metrics
- The lightweight observability layer is documented in [PHASE_17D_OBSERVABILITY.md](/Users/onur/Documents/New project 4/docs/PHASE_17D_OBSERVABILITY.md).
- Admin-only observability endpoints:
  - `GET /admin/observability/summary`
  - `GET /admin/observability/metrics`
- Metrics are DB-backed aggregation queries over existing operational records:
  - webhook events
  - operational jobs
  - retry/dead-letter lifecycle
  - replay/recover jobs
  - reconciliation jobs
  - scheduled reconciliation/stale-state jobs
- Supported windows:
  - last hour
  - last 24h
  - last 7d
- Health states are lightweight operational guidance:
  - `healthy`
  - `warning`
  - `degraded`
  - `critical`
- Dashboard and diagnostics now surface admin-only health, retry pressure, dead-letter, reconciliation backlog, stale-state, and webhook success-rate signals.
- This phase does not add Prometheus, Grafana, OpenTelemetry, external metrics storage, distributed tracing, websocket infrastructure, or realtime delivery.

## Phase 17E Performance and Scale Hardening
- Performance hardening is documented in [PHASE_17E_PERFORMANCE_HARDENING.md](/Users/onur/Documents/New project 4/docs/PHASE_17E_PERFORMANCE_HARDENING.md).
- Backend list endpoints now share bounded `limit`/`offset` pagination semantics:
  - default limit 100
  - max limit 250
  - offset defaults to 0
- Pagination-ready endpoints:
  - `GET /orders`
  - `GET /returns`
  - `GET /finance`
  - `GET /admin/operations`
  - `GET /admin/diagnostics/webhooks`
- Diagnostics list hydration now avoids loading raw webhook payload content; payload preview remains detail-only through `GET /admin/diagnostics/webhooks/:webhookEventId`.
- Finance summaries are computed separately from the windowed ledger rows, preserving totals while allowing ledger pagination.
- Real-mode frontend services can pass `limit` and `offset` for future load-more or virtualization work without changing current page behavior.
- This phase does not introduce external infrastructure, queue workers, websocket/realtime behavior, automatic history deletion, or raw payload retention changes.

## Fulfillment and Tracking Flow (Planned)
1. Vendor submits tracking data in dashboard.
2. Frontend sends request to backend API.
3. Backend validates vendor ownership/permissions.
4. Backend stores fulfillment + tracking state.
5. Backend updates Shopify fulfillment/tracking via Admin/Fulfillment APIs.

Frontend will never call Shopify directly or hold Shopify credentials.

## Fulfillment Tracking Mutation Foundation (Phase 13 Step 18)
- Backend now exposes:
  - `POST /fulfillments/:allocationId/tracking`
- Route behavior:
  - requires auth
  - requires backend vendor-context validation
  - vendor users may update only their own assigned allocation
  - admin may update any allocation within the selected vendor context
- Shopify sync boundary:
  - fetch fulfillment orders through Shopify Admin abstraction:
    - `GET /fulfillment_orders.json?order_id={id}`
  - create fulfillment tracking through Shopify Admin abstraction:
    - `POST /fulfillments.json`
  - use `line_items_by_fulfillment_order` so only allocation-owned line items are fulfilled
- Mock vs production path:
  - production uses configured Shopify Admin credentials
  - development/test can use deterministic mock fulfillment-order data
  - smoke does not require live Shopify credentials
- Persistence behavior:
  - updates `VendorAllocation` tracking fields and status
  - upserts `Fulfillment` record with sync metadata and optional error state
- Safe failure behavior:
  - cross-vendor mutation attempts return `403`
  - blocked/cancelled allocations return `409`
  - Shopify sync failures return non-success response and persist `fulfillment_sync_failed`
  - backend never silently reports success when Shopify sync fails

## Inbound Fulfillment Status Sync (Phase 16-3C)
- Backend now supports Shopify inbound fulfillment/status webhook topics:
  - `POST /webhooks/shopify/fulfillments-create`
  - `POST /webhooks/shopify/fulfillments-update`
  - `POST /webhooks/shopify/fulfillment-events-create`
  - `POST /webhooks/shopify/fulfillment-orders-cancelled`
- Supported Shopify subscription topics:
  - `FULFILLMENTS_CREATE`
  - `FULFILLMENTS_UPDATE`
  - `FULFILLMENT_EVENTS_CREATE`
  - `FULFILLMENT_ORDERS_CANCELLED`
- Registration is opt-in through:
  - `npm run shopify:fulfillment-webhooks:register`
  - requires `SHOPIFY_REGISTER_FULFILLMENT_WEBHOOKS=true`
  - requires `SHOPIFY_FULFILLMENT_WEBHOOK_BASE_URL`
- Registration script behavior is mixed-state-safe:
  - existing topic+callback subscriptions are reported as existing and skipped
  - missing topics continue registration even when some topics already exist
  - duplicate/address-taken responses trigger a subscription refresh and continue
  - script exits non-zero only if unexpected failures remain after all topics are attempted
- Sync boundary:
  - webhook payloads are treated as trigger/envelope metadata only
  - backend fetches canonical order fulfillment state through Shopify Admin GraphQL
  - allocation updates are scoped by exact Shopify line item ids
  - partial multi-vendor fulfillments update only the matching vendor allocation
  - absent Shopify tracking info is not invented
  - tracking number, carrier, tracking URL, fulfilled timestamp, shipment-created timestamp, and shipment-updated timestamp are persisted only from canonical Shopify fulfillment data
- Status behavior:
  - matched allocation line items set `fulfillmentStatus` to `fulfilled` when all allocation items are fulfilled
  - partial allocation matches set `fulfillmentStatus` to `partially_fulfilled`
  - fulfillment without a delivery event maps shipping to `shipped` or `partially_shipped`
  - `FULFILLMENT_EVENTS_CREATE` can map confirmed delivered/in-transit/failure statuses into shipping status
  - delivery/in-transit/failure events are applied only to allocations linked to the matching Shopify fulfillment id
  - fulfillment cancellation is confirmed from canonical `fulfillment.status` / `fulfillmentOrder.status`, not broad `orders/updated`
  - fully cancelled allocation line items revert the owning allocation to pending/awaiting shipment and clear active tracking fields
  - partial/multi-vendor cancellations do not clear unrelated vendor allocations or unrelated active fulfillments
- Diagnostics behavior:
  - inbound fulfillment webhooks use the same HMAC verification, idempotency, `WebhookEvent`, replay, recover, and reconciliation boundaries as other Shopify webhooks
  - HMAC verification uses `SHOPIFY_FULFILLMENT_WEBHOOK_SECRET` when configured, otherwise `SHOPIFY_WEBHOOK_SECRET`
  - canonical fetch or line-item mapping failures mark the webhook `FAILED` with an operator-visible error message

## Returns and Refunds Flow (Planned)
1. Shopify emits return/refund webhook events.
2. Backend ingests and validates events.
3. Backend maps returned/refunded line items to vendor allocations.
4. Vendor reads only their scoped records; admin can inspect full impact.

## Pending Return Request Ingestion (Phase 15-6B)
- Return lifecycle webhooks now support pending return request ingestion:
  - `returns/request` creates vendor-scoped pending return records.
  - `returns/approve`, `returns/decline`, `returns/close`, `returns/cancel` apply minimal lifecycle status updates to existing pending records.
- Attribution path:
  - resolve Return GID (`admin_graphql_api_id` preferred, fallback from numeric `id`)
  - fetch Shopify GraphQL `return(id:)` details
  - extract `fulfillmentLineItem.lineItem.sku`
  - resolve vendor via order `custom.seller_info` (`sellerInfo[sku]`)
- Multi-vendor handling:
  - one Shopify return request can split into multiple internal vendor-scoped records
  - each vendor sees only their own pending return records
- Safety rules:
  - unresolved SKU/seller mapping/order mapping fails into diagnostics needs-attention state
  - no silent vendor assignment
  - no refund-ledger entry is created from pending return requests
  - refund lifecycle remains sourced from `refunds/create`

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
- Shopify webhook verification note:
  - signature verification uses exact raw request bytes
  - failed verification logs route/topic/headers-presence/body-byte-length/payload-hash only
  - secrets and full payloads are not logged by default
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

## Shopify Order Ingestion Engine (Phase 13 Step 17)
- Verified first-time `orders/create` webhooks now run synchronous local ingestion after HMAC verification and idempotency checks.
- Current ingestion flow:
  1. receive verified, non-duplicate webhook
  2. fetch `custom.seller_info` through Shopify Admin abstraction
  3. retry seller info fetch up to 3 times
  4. allocate line items by `sellerInfo[lineItem.sku]`
  5. validate vendor slug exists in local vendor table
  6. create or update:
     - `ShopifyOrder`
     - `ShopifyOrderLineItem`
     - `VendorAllocation`
     - `VendorAllocationLineItem`
     - initial `AllocationAssignmentHistory`
  7. mark `WebhookEvent` as `PROCESSED` on success or `FAILED` on safe diagnostic failure
- Seller info fetch behavior:
  - production expects real Shopify Admin API credentials
  - development/test can use injected mock seller info keyed by Shopify order id
  - retry delay is environment-aware so smoke and CI do not block for full production timing
- Allocation rule:
  - primary mapping is `sellerInfo[lineItem.sku]`
  - empty SKU or missing seller info entry fails safely into diagnostics
  - unknown vendor slug fails safely into diagnostics
- Idempotent write strategy:
  - `ShopifyOrder` keyed by `sourceShopifyOrderId`
  - `ShopifyOrderLineItem` keyed by `(shopifyOrderId, sourceLineItemId)`
  - `VendorAllocation` keyed by deterministic id `alloc-{vendorId}-{sourceShopifyOrderId}`
  - initial assignment history keyed deterministically per allocation
- This phase still does not:
  - ingest refunds
  - fetch fulfillment orders
  - create Shopify fulfillments
  - run background queue workers
  - switch the frontend to real API mode

## Shopify Refund Ingestion Foundation (Phase 14-5)
- Backend now exposes:
  - `POST /webhooks/shopify/refunds-create`
- Current refund ingestion flow:
  1. verify Shopify webhook HMAC
  2. apply webhook idempotency before processing
  3. parse `refund_line_items`
  4. resolve the original Shopify order from persisted order ingestion state
  5. map each refund line item by `refund_line_items[].line_item.sku`
  6. resolve the original vendor from the persisted order line-item mapping snapshot
  7. create vendor-scoped refund records and refund line-item snapshots
- Persisted refund state is intentionally small and incremental:
  - `ShopifyRefund`
  - `ShopifyRefundLineItem`
  - existing vendor-scoped `RefundRecord`
  - existing vendor-scoped `ReturnRecord`
- Safe failure behavior:
  - missing order id -> needs attention
  - missing refund line items -> needs attention
  - missing SKU -> needs attention
  - missing original order mapping -> needs attention
  - unknown vendor mapping -> needs attention
  - no silent fallback allocation is allowed
- Diagnostics visibility:
  - failed refund ingestions appear through the existing webhook failure and sync diagnostics feeds
  - duplicate refund deliveries are ignored by existing webhook idempotency

## Diagnostics and Sync Visibility (Phase 13 Step 19)
- Admin-only diagnostics APIs now expose persisted webhook and sync state without changing frontend runtime behavior.
- Current diagnostics endpoints:
  - `GET /admin/diagnostics/webhooks`
  - `GET /admin/diagnostics/webhooks/:webhookEventId`
  - `GET /admin/diagnostics/sync-events`
- Observability strategy:
  - use persisted `WebhookEvent` rows for webhook receipt, processing, and failure visibility
  - use persisted `OperationalJob` rows for retry-ready internal processing lifecycle visibility
  - use persisted `Fulfillment` sync state for fulfillment tracking failures
  - consolidate operational failures into an admin-only sync-events feed
- Current visibility includes:

## Webhook Replay and Reconciliation Tooling (Phase 14-6)
- Backend now adds explicit admin recovery tooling without introducing queue workers or silent retries.
- Current recovery endpoints:
  - `POST /admin/diagnostics/webhooks/:webhookEventId/replay`
  - `POST /admin/diagnostics/webhooks/:webhookEventId/recover`
  - `GET /admin/diagnostics/reconciliation`
- Webhook lifecycle states are explicitly used for recovery boundaries:
  - `RECEIVED`
  - `PROCESSING`
  - `PROCESSED`
  - `FAILED`
- Replay strategy:
  - admin-only
  - supported topics only:
    - `orders/create`
    - `refunds/create`
    - `fulfillments/create`
    - `fulfillments/update`
    - `fulfillment_events/create`
    - `fulfillment_orders/cancelled`
  - replay reuses the stored raw webhook payload and existing ingestion services
  - missing payload is a hard `409` with:
    - `Webhook payload is not available for replay`
  - unsupported topics are rejected explicitly instead of pretending to recover
- Recover strategy:
  - admin-only
  - allows explicit operator recovery for events in `RECEIVED` or `FAILED`
  - requires `payloadAvailable=true`
  - marks event `PROCESSING` before re-running ingestion
  - blocks `PROCESSED` recovery with `409` to prevent accidental re-processing
  - reuses idempotent upsert-based ingestion paths (safe duplicate protection without queue worker)
- Payload retention:
  - new `WebhookEvent` rows persist `rawPayload` for future replay
  - older historical events are not backfilled
  - diagnostics detail and reconciliation expose payload availability so operators can tell whether replay/recover is possible
  - diagnostics detail does not return full raw payload by default; it returns payload hash, payload availability, safe affected-entity hints, and a capped preview only for operator context
- Replay/recover response model:
  - blocked actions return `409` with `skippedReason`, before/after status, topic, and `not_replayable` / `not_recoverable` status
  - successful operator actions return `202` with `webhookEventId`, `beforeStatus`, `afterStatus`, explicit replay/recovery status, affected counts when available, and a safe error summary when processing still fails
  - `PROCESSED` events remain protected from recovery; replay remains deliberate and topic-gated for idempotent ingestion paths
- Operational job integration:
  - accepted webhook deliveries create a related job after idempotency accepts the event
  - replay/recover actions create `replay` / `recovery` jobs after eligibility checks pass
  - diagnostics webhook list/detail responses include related job summaries with status, retry count, schedule, and safe error summary
  - job persistence failure is logged and does not block the existing inline processing path
- Reconciliation strategy:
  - surfaces `RECEIVED` webhook events older than 5 minutes
  - surfaces failed webhook events
  - surfaces fulfillment records with `fulfillment_sync_failed`
  - surfaces events missing replayable payload content
  - provides a `suggestedAction` per item rather than attempting silent recovery
  - recommends recovery for stuck `RECEIVED` events with payload, recover/replay review for `FAILED` events with payload, manual investigation for missing payload, and no action for processed/duplicate-safe outcomes

## Admin Shopify State Reconciliation (Phase 16-3J)
- Backend now includes admin-only reconciliation endpoints for explicit operator recovery:
  - `POST /admin/reconciliation/orders/:allocationId`
  - `POST /admin/reconciliation/shopify-order/:shopifyOrderId`
- These endpoints create lightweight `reconciliation` operational jobs for lifecycle visibility, but do not add queue workers and do not mutate Shopify.
- Reconciliation flow:
  - locate the local Shopify order/allocation
  - fetch canonical Shopify fulfillment state through Admin GraphQL
  - compare canonical line-item scoped fulfillment/cancellation/tracking state with local allocation state
  - repair only safe operational fields when Shopify state is clear
  - return a structured result with stale fields, repaired fields, skipped fields, affected vendors, warnings, and manual-review flag
- Repair-safe fields:
  - allocation fulfillment/shipping status
  - allocation tracking number/carrier
  - fulfillment tracking URL
  - fulfillment fulfilled/shipment timestamps
  - fulfillment sync status
  - stale local refund/return operational status for already persisted records
  - missing finance ledger entry for an already persisted processed refund
- Reconciliation guardrails:
  - no raw webhook history is modified
  - no historical finance records are deleted
  - no manual notes are overwritten
  - no Shopify state is invented
  - multi-vendor updates remain scoped by Shopify line item id
- Stale visibility:
  - diagnostics reconciliation now includes lightweight stale-allocation heuristics
  - heuristics are advisory and do not trigger automatic repair
  - admin UI can trigger allocation/order reconciliation from the diagnostics workspace
- Operational guardrail:
  - this phase does not change Shopify ingestion assumptions
  - this phase does not add queue workers
  - recovery remains operator-driven and explicit
  - processed webhook receipts
  - failed webhook ingestion attempts
  - seller_info retry exhaustion
  - unresolved SKU mapping failures
  - unknown vendor slug failures
  - fulfillment sync failures
- Duplicate-delivery note:
  - duplicate webhook deliveries are accepted and ignored by idempotency logic before a second processing row is created
  - duplicates are therefore visible through request/response semantics and idempotency keys, but not yet persisted as standalone duplicate-event rows
- Raw payload note:
  - webhook payload hash is persisted
  - webhook raw payload is persisted for newer events and used by replay/recover tooling
- Frontend note:
  - this phase adds API-level diagnostics only
  - admin diagnostics UI remains future work

## Shopify Webhook Verification Skeleton (Phase 13 Step 15)
- First webhook endpoint exists:
  - `POST /webhooks/shopify/orders-create`
- Current behavior:
  - reads raw request body
  - verifies `X-Shopify-Hmac-Sha256`
  - computes payload hash and idempotency key
  - returns `202 Accepted` for valid signatures
  - returns `401` for invalid signatures
  - returns duplicate-aware response semantics
  - ingests first-time orders synchronously for now
  - returns needs-attention response when seller info or SKU mapping cannot be resolved
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
- Finance record status semantics:
  - successful ledger rows from `refunds/create` are non-failure records
  - frontend should map `HOLD`/non-error statuses to non-failure wording (`Recorded` or equivalent)
  - `Failed` should be reserved for actual financial operation errors
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
