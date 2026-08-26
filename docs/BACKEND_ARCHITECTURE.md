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

## Orders/Create Durable Fast Acknowledgement

- `SHOPIFY_ORDERS_CREATE_ASYNC_ACK_ENABLED` defaults to `false`; the existing synchronous webhook behavior is preserved while disabled.
- Fast acknowledgement may be enabled only with `SHOPIFY_ORDERS_CREATE_EXECUTOR_ENABLED=true`. Startup rejects the unsafe flag combination.
- The enabled request path performs verification, atomically persists the retained webhook envelope and executor enrollment, and only then returns `202`.
- The request path does not run seller lookup, create operational jobs, mutate order/allocation/finance state, or invoke the executor. The request-independent executor owns later discovery, fenced claims, processing, heartbeat, retry, and terminal handling.
- If durable intake fails, the route returns retryable `503`; no successful acknowledgement is sent.

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
- Confirmed Shopify integration discoveries and open implementation questions are documented in [SHOPIFY_DISCOVERIES.md](docs/SHOPIFY_DISCOVERIES.md) and should be reviewed before Shopify-dependent implementation.
- Live rollout readiness and manual webhook rollout steps are documented in [SHOPIFY_LIVE_ROLLOUT.md](docs/SHOPIFY_LIVE_ROLLOUT.md).

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
- The official Phase 14 operational readiness checkpoint is documented in [PHASE_14_CLOSURE.md](docs/PHASE_14_CLOSURE.md).
- Use that document as the source of truth for:
  - live-verified Shopify capabilities
  - current operational limitations
  - risk register items
  - Phase 15 entry criteria
  - recommended production-readiness steps before real merchant rollout

## Phase 15 Roadmap Baseline
- The official Phase 15 roadmap baseline is documented in [PHASE_15_PLAN.md](docs/PHASE_15_PLAN.md).
- Use that document as the planning source of truth for:
  - operational frontend maturity targets
  - async processing preparation boundaries
  - observability baseline direction
  - deployment-readiness direction
  - operational UX and reliability-hardening workstreams

## Phase 17A Async Processing Foundation
- The lightweight async operational foundation is documented in [PHASE_17A_ASYNC_FOUNDATION.md](docs/PHASE_17A_ASYNC_FOUNDATION.md).
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
- The retry and dead-letter lifecycle is documented in [PHASE_17B_RETRY_AND_DEADLETTER.md](docs/PHASE_17B_RETRY_AND_DEADLETTER.md).
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
- The scheduled reconciliation foundation is documented in [PHASE_17C_SCHEDULED_RECONCILIATION.md](docs/PHASE_17C_SCHEDULED_RECONCILIATION.md).
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

## Shopify-First Missed Order Discovery
- An isolated opt-in in-process runner enumerates recent Shopify orders and detects orders with no local `ShopifyOrder`.
- It remains separate from canonical and scheduled reconciliation because their candidate populations start from local records.
- Defaults are a 15-minute interval, 15-minute grace period, seven-day overlapping lookback, 100-order pages, and a 1,000-order cap.
- Deterministic `OperationalSignal` identities make repeated and multi-instance observations converge without a migration or distributed lock.
- The runner writes diagnostics signals only. It never invokes ingestion, Current-State Repair, Fresh Order Backfill, allocation, or finance mutations.
- Active signals are exposed through existing admin diagnostics and open the existing Order State Inspector for supervised dry-run and explicit repair execution.

## Phase 17D Operational Observability and Metrics
- The lightweight observability layer is documented in [PHASE_17D_OBSERVABILITY.md](docs/PHASE_17D_OBSERVABILITY.md).
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
- Performance hardening is documented in [PHASE_17E_PERFORMANCE_HARDENING.md](docs/PHASE_17E_PERFORMANCE_HARDENING.md).
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
  - for `orders/create`, uses the executor's conditional generation/attempt/lease claim, heartbeat, fenced processing context, retained `missing_order_only` mode, and order transaction fence; exhausted attempts are not reset
  - other supported topics preserve the existing conditional `PROCESSING` claim before re-running ingestion
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
  - request-driven reconciliation diagnostics surface `orders/create` events still `PROCESSING` 15 minutes after `receivedAt` through deterministic `OperationalSignal` review records, except while an authoritative lease remains unexpired
  - the 15-minute `PROCESSING` threshold is visibility-only and never grants retry, replay, reset, takeover, webhook/job mutation, or automatic repair authority
  - processing-review evidence is classified from safe order identity plus local order/allocation/sale-ledger state; ambiguous reads fail closed
  - review signals resolve when the event leaves `PROCESSING` or a later completed exact-order Current-State Repair is recorded, while the original event/job interruption evidence remains preserved
  - surfaces failed webhook events
  - surfaces fulfillment records with `fulfillment_sync_failed`
  - surfaces events missing replayable payload content
  - provides a `suggestedAction` per item rather than attempting silent recovery
  - recommends recovery for stuck `RECEIVED` events with payload, recover/replay review for `FAILED` events with payload, manual investigation for missing payload, and no action for processed/duplicate-safe outcomes
- The supervised `PROCESSING` review path adds no scheduler, timer, worker, schema field, or migration. Operators reuse Order State Inspector and the existing canonical Current-State Repair workflow: dry-run first, then explicit confirmed execution only for a supported, non-skipped, non-blocked plan.
- Missed-order suppression and Current-State Repair intake blocking derive from actionable `WebhookEvent` availability/lease/attempt state, never `OperationalJob` alone. With the executor disabled, enrolled work remains visible instead of being presented as actively consumed.
- Fenced orders/create ingestion and Current-State Repair serialize on the same source-Shopify-order PostgreSQL advisory transaction lock. Repair execute rechecks intake and local assumptions after acquiring that lock; later retained-payload ingestion remains `missing_order_only`.

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

## Vendor Finance Foundation (Phase 18A)
- `VendorFinancialProfile` stores vendor-level finance configuration:
  - commission percent
  - commission VAT percent
  - shipping deduction enabled flag
  - shipping deduction mode (`DISABLED`, `FIXED`, `EXTERNAL_PROVIDER`)
  - optional fixed shipping fee
  - active flag
- Phase 18A keeps one configured profile per vendor by keying the profile on `vendorId`.
- If no profile exists, finance reads use a deterministic default profile:
  - `10.00%` commission
  - `0.00%` commission VAT
  - shipping deduction disabled
- Finance calculation is estimate-only:
  - commission = gross amount × commission percent
  - commission VAT = commission × commission VAT percent
  - refunds fully reduce payout
  - shipping deduction applies only after fulfillment/shipping lifecycle evidence exists
- Accepted `orders/create` allocation ingestion creates one idempotent sale ledger row per vendor allocation:
  - ledger id: `fin-{vendorId}-sale-{sourceShopifyOrderId}`
  - `entryType`: `sale`
  - `amount`: summed vendor allocation line amount
  - duplicate webhook delivery updates the same row rather than creating another ledger record
- Shopify reconciliation repairs missing sale ledger rows for already-ingested allocations without changing canonical Shopify state.
- Return request ingestion uses local ingested order line-item vendor mapping first and falls back to Shopify `seller_info` only when local mapping is unavailable.
  - This keeps real return requests visible when the original order allocation exists but Shopify metafield re-fetch is unavailable later.
  - Pending return requests do not create finance refund ledger rows; `refunds/create` remains the source for posted refund finance impact.
- `GET /finance` remains vendor-scoped and now includes:
  - `profile`
  - summary commission VAT and shipping deduction totals
  - per-record payout calculation context
- Admin-only profile endpoints:
  - `GET /admin/vendors/:vendorId/financial-profile`
  - `PUT /admin/vendors/:vendorId/financial-profile`
- Phase 18A does not execute payouts, schedule settlements, integrate banks, generate invoices, calculate taxes, or ingest external shipping provider costs.

## Settlement Ledger Foundation (Phase 18B)
- `FinanceLedgerEntry` now includes lightweight settlement lifecycle metadata:
  - `settlementStatus`
  - `settlementEligibleAt`
  - `accruedAt`
  - `payableAt`
  - `settledAt`
  - `settlementHoldReason`
- Settlement statuses are operational readiness states, not money movement:
  - `PENDING`
  - `ACCRUING`
  - `PAYABLE`
  - `PARTIALLY_REFUNDED`
  - `HELD`
  - `SETTLED`
  - `DISPUTED`
- Sale rows continue to use immutable Phase 18A finance profile snapshots.
  - Updating the active vendor profile applies only to future sale rows.
  - Existing calculation snapshots are not rewritten by settlement lifecycle changes.
- Vendor balance aggregation is ledger-backed:
  - unfulfilled sale net amounts contribute to accrued balance
  - fulfilled/shipped sale net amounts contribute to payable balance
  - refunds fully reduce accrued/payable balances
  - held/disputed rows contribute to held balance
- `GET /finance` includes settlement balance fields:
  - `accruedBalance`
  - `payableBalance`
  - `heldBalance`
  - `refundedBalance`
  - `pendingSettlement`
- Each finance record includes settlement detail for the UI drawer:
  - status
  - payout readiness
  - eligible/accrued/payable/settled timestamps
  - hold reason
  - operational note
- Phase 18B still does not execute payouts, create payout batches, integrate bank transfers, export ERP/accounting data, generate invoices, or ingest external provider shipping costs.

## Payout Batch Preparation (Phase 18C)
- `PayoutBatch` stores vendor-scoped draft payout totals for admin review:
  - gross amount
  - commission amount
  - commission VAT amount
  - shipping deduction amount
  - refund amount
  - net amount
  - currency
  - status
- `PayoutBatchLine` links finance ledger rows to a draft and snapshots each row's net contribution.
- Batch statuses are preparation/review states only:
  - `DRAFT`
  - `REVIEW`
  - `APPROVED`
  - `CANCELLED`
  - `EXECUTION_PENDING`
  - `PAID_PLACEHOLDER`
- Eligibility is deterministic:
  - row belongs to the selected vendor
  - row is a sale or refund finance ledger entry
  - settlement is payable or partially refunded
  - row is not already linked to an active payout batch
  - row is not held, disputed, settled, or paid
- Refund rows fully reduce the draft net amount and may create negative drafts for operator review.
- Cancelled batches release rows for future preparation because active-batch checks ignore `CANCELLED`.
- Admin-only endpoints:
  - `GET /admin/payout-batches`
  - `POST /admin/payout-batches/prepare`
  - `GET /admin/payout-batches/:id`
  - `POST /admin/payout-batches/:id/cancel`
  - `POST /admin/payout-batches/:id/mark-review`
- `GET /finance` includes `payoutBatchSummary` and per-record payout batch references for the Finance workspace.
- Phase 18C does not execute bank transfers, mark real payments complete, export ERP/accounting data, generate invoices, or integrate external providers.

## Vendor Balance Workspace (Phase 18D)
- Finance now renders role-specific visibility on top of the same vendor-scoped `/finance` payload.
- Admin users keep the operational finance workspace:
  - vendor finance profile controls
  - payout batch preparation action
  - operational ledger metadata
  - Shopify identifiers and calculation profile details
- Vendor users receive a simplified read-only balance workspace:
  - payable balance
  - upcoming payout
  - accruing balance
  - refund impact
  - held or pending amount
- Vendor detail drawers prioritize payout understanding:
  - gross sale
  - commission/VAT/shipping/refund deductions
  - estimated payout
  - payout readiness
  - payout batch reference
  - simplified payout timeline
- Vendor users cannot prepare, cancel, review, approve, or execute payout batches.
- Vendor isolation remains enforced by existing auth/vendor context and vendor-scoped finance queries.
- Phase 18D remains read-only for vendors and does not execute payments, integrate banks/ERP/accounting providers, generate invoices, or mark real settlement completion.

## External Shipping Cost Foundation (Phase 18E)
- `ShipmentShippingCost` stores vendor-scoped shipment/provider cost inputs:
  - vendor id
  - vendor allocation id
  - Shopify order id
  - optional Shopify fulfillment id
  - provider name and optional provider reference
  - shipping cost and optional shipping VAT
  - currency
  - status
  - source type
- Source types are preparation metadata only:
  - `MANUAL`
  - `IMPORTED`
  - `EXTERNAL_PROVIDER`
- Cost statuses are operational review states:
  - `PENDING`
  - `CONFIRMED`
  - `DISPUTED`
  - `IGNORED`
- Finance sale rows now have optional immutable shipping cost snapshot fields:
  - cost
  - VAT
  - source
  - provider
  - shipment cost record id
- Shipping deduction rules remain deterministic:
  - disabled mode deducts nothing
  - fixed mode deducts the fixed vendor profile fee after fulfillment/shipping
  - external-provider mode deducts confirmed provider cost only when a ledger snapshot exists
  - missing provider cost keeps the deduction at `0.00`
- Admin-only ingestion endpoint:
  - `POST /admin/shipping-costs`
- The ingestion endpoint validates vendor ownership through the selected allocation or finance ledger row and uses a deterministic id to avoid duplicate provider/reference rows.
- Existing finance ledger snapshots are not rewritten when a provider cost is attached later.
- `GET /finance` exposes shipping deduction source, provider, snapshot, and pending-provider-cost state for Finance detail views.
- Phase 18E does not call carrier/provider APIs, create shipment labels, integrate ERP/accounting systems, or execute payouts.

## Finance Closure Audit (Phase 18F)
- Phase 18F is a documentation and production-smoke closure checkpoint for the finance subsystem.
- No new finance runtime architecture is introduced in this phase.
- The finance foundation is considered complete for:
  - vendor-scoped ledger visibility
  - immutable sale calculation snapshots
  - immutable shipping cost snapshots
  - refund full-impact payout behavior
  - settlement readiness and accrued/payable balances
  - payout batch draft preparation
  - vendor read-only payout visibility
  - external-provider shipping cost readiness
- Production read-only verification confirmed:
  - `npm run real-api:dry-run` passes against the Render backend
  - `/finance` returns profile, settlement, payout batch summary, and shipping cost status fields
  - admin profile and payout batch listing routes are deployed
  - the shipping cost ingestion route is deployed and validation-protected
- Mutable production checks, such as preparing payout batches or attaching shipment costs, should only be run in an approved operator smoke window.
- Future phases must still define:
  - real payout execution
  - payout confirmation/settlement completion
  - payout statements
  - ERP/accounting export
  - live shipping provider imports
  - provider cost correction and adjustment policy

## Operational Rules Engine (Phase 19A)
- `OperationalSignal` stores deterministic attention signals generated from operational and finance state.
- Signal severities:
  - `INFO`
  - `WARNING`
  - `HIGH`
  - `CRITICAL`
- Signal lifecycle statuses:
  - `ACTIVE`
  - `ACKNOWLEDGED`
  - `RESOLVED`
  - `IGNORED`
- Signal source areas:
  - `PAYOUT`
  - `REFUND`
  - `FULFILLMENT`
  - `DIAGNOSTICS`
  - `RECONCILIATION`
  - `SHIPPING_COST`
  - `SETTLEMENT`
- Initial deterministic rules cover:
  - negative vendor payable balance
  - stale awaiting-shipment fulfillment
  - missing external-provider shipping cost after fulfillment
  - negative payout batch net
  - old payout-ready rows not yet batched
  - dead-letter/permanently failed operational jobs
- Signals use deterministic ids based on rule key and related entity, so repeated evaluation updates the existing signal rather than creating duplicates.
- Evaluation runs opportunistically through:
  - `GET /signals`
  - `GET /admin/signals`
  - `GET /admin/operations`
- Admin endpoints:
  - `GET /admin/signals`
  - `POST /admin/signals/:signalId/lifecycle`
- Vendor-safe endpoint:
  - `GET /signals`
- Vendor responses are scoped to the selected vendor and exclude internal diagnostics/reconciliation signal areas.
- Admin operations queue now includes active rules signals as `operational_signal` items so critical/high rule output influences operator prioritization.
- Phase 19A does not send notifications, trigger auto-remediation, call external alerting tools, or mutate operational/finance truth.

## Notification Foundation (Phase 19B)
- `NotificationIntent` stores in-app notification records generated from active operational signals.
- Notification channels:
  - `IN_APP`
  - `EMAIL_PLACEHOLDER`
  - `SLACK_PLACEHOLDER`
- Notification lifecycle statuses:
  - `PENDING`
  - `DELIVERED`
  - `READ`
  - `DISMISSED`
  - `SKIPPED`
- Recipient roles:
  - `ADMIN`
  - `VENDOR`
- Routing rules:
  - critical/high signals create admin in-app notifications
  - vendor notifications require a vendor-scoped signal
  - vendor-safe areas are payout, refund, fulfillment, shipping cost, and settlement
  - diagnostics/reconciliation details are not routed to vendors
- Notification ids include channel, recipient role, recipient scope, and signal id so generation is duplicate-safe.
- Signal lifecycle and notification lifecycle are intentionally separate:
  - resolving a signal does not delete notification history
  - reading/dismissing a notification does not resolve the signal
- User-facing endpoints:
  - `GET /notifications`
  - `POST /notifications/read`
  - `POST /notifications/dismiss`
  - `POST /notifications/:notificationId/read`
  - `POST /notifications/:notificationId/dismiss`
- The body-based read/dismiss routes are preferred by the frontend because deterministic notification ids can be long enough to fail path-param routing in production edge cases.
- Dashboard includes a compact in-app Notification Center with unread/high-priority summary, latest notification cards, source metadata, and read/dismiss controls.
- Phase 19B does not send real email, Slack, SMS, push, webhook, or external alert-provider messages.

## SLA and Escalation Rules (Phase 19C)
- Phase 19C adds static SLA thresholds and escalation aging to the existing operational rules engine.
- Threshold constants are code-defined in the rules service. There is no admin rule builder yet.
- SLA thresholds:
  - return request aging: warning at 24h, high at 48h, critical at 72h
  - fulfillment stuck: warning at 24h, high at 48h, critical at 72h
  - payout review stale: warning at 24h, high at 48h, critical at 96h
  - refund-heavy vendor ratio: warning above 8 percent, high above 15 percent, critical above 25 percent, with a minimum 20 orders in a 30-day window
- SLA-backed rule keys:
  - `return.request_sla_aging`
  - `fulfillment.stale_awaiting_shipment`
  - `payout.review_sla_aging`
  - `refund.vendor_ratio_sla`
- Existing signal ids remain deterministic, so repeated evaluation updates the current signal severity instead of creating duplicate attention rows.
- Signal metadata includes compact explainability fields such as elapsed hours, threshold crossed, evaluation timestamp, Shopify identifiers where safe, payout status, or refund ratio details.
- Admin users can see SLA operations signals through the existing signals and operations queue endpoints.
- Vendor users only see vendor-safe, vendor-scoped business SLA signals. Diagnostics and reconciliation internals remain admin-only.
- Notification integration remains in-app only through Phase 19B `NotificationIntent` generation. No external email, Slack, SMS, webhook, or auto-remediation behavior was added.
- Phase 19C does not mutate finance snapshots, payout batches, fulfillment state, reconciliation truth, or Shopify state.

## Automation Actions Foundation (Phase 19D)
- `AutomationAction` stores safe operator-assist suggestions generated from active operational signals.
- Automation action statuses:
  - `PENDING`
  - `SUGGESTED`
  - `EXECUTED`
  - `SKIPPED`
  - `FAILED`
  - `CANCELLED`
- Execution modes:
  - `MANUAL`
  - `ASSISTED`
  - `AUTO_SAFE`
- Starter action types cover:
  - replay/recover investigation suggestions
  - reconciliation suggestions
  - payout batch review suggestions
  - shipping cost attachment suggestions
  - stale fulfillment review suggestions
  - negative payout investigation suggestions
  - dead-letter investigation suggestions
  - bounded auto-safe reconciliation candidate creation
  - reminder notification and queue prioritization intents
- Action ids are deterministic from action type and source signal id, so repeated signal evaluation updates the same automation action instead of creating duplicates.
- Admin endpoints:
  - `GET /admin/automation-actions`
  - `POST /admin/automation-actions/:actionId/execute`
- Supported execution requests:
  - `execute_safe`
  - `mark_handled`
  - `skip`
  - `cancel`
- Phase 19D `execute_safe` is intentionally narrow. It can create a reconciliation `OperationalJob` candidate for an action with allocation/job linkage. It does not run payout execution, refunds, cancellations, Shopify mutation, or finance snapshot mutation.
- Automation actions are folded into the admin operations queue as `automation_action` items and can create admin in-app notification reminders.
- Vendor users do not execute automation actions. Vendor-safe business visibility remains controlled by existing signal and notification routing rules.
- Phase 19D does not add external integrations, AI decisioning, destructive automation, or customer-facing actions.

## Email Notification Delivery Foundation (Phase 19E)
- Phase 19E adds env-gated email delivery preparation on top of existing `NotificationIntent` rows.
- Email configuration:
  - `EMAIL_NOTIFICATIONS_ENABLED=false` by default
  - `EMAIL_PROVIDER=noop` by default
  - `EMAIL_FROM` optional
  - `EMAIL_ADMIN_RECIPIENTS` optional comma-separated admin recipient list
- Supported providers:
  - `noop`: records skipped delivery and sends nothing
  - `console`: local/dev provider that writes a safe email preview to backend logs
- No real SendGrid, Postmark, SES, Slack, SMS, push, webhook, or external alert provider was added.
- Email uses `NotificationChannel.EMAIL_PLACEHOLDER`.
- `NotificationStatus.FAILED` was added so failed provider attempts can be represented safely.
- Email eligibility:
  - high/critical signals only
  - admin high/critical signals route to configured admin recipients
  - vendor high/critical signals route only to active users linked to the signal vendor
  - vendor emails are limited to vendor-safe source areas
  - diagnostics/reconciliation internals are not emailed to vendors
- Disabled email behavior:
  - eligible email intents are created for auditability
  - delivery is marked `SKIPPED` with a compact reason
- Email templates are deterministic text and include severity, source area, related entity label, summary, suggested action, and dashboard path placeholder.
- Email templates intentionally exclude raw webhook payloads, secrets, internal stack traces, and sensitive diagnostics previews.
- Phase 19E does not add background email workers, external provider retries, notification preferences, Slack delivery, or marketing/bulk email.

## Operational Intelligence Closure (Phase 19F)
- Phase 19F closes the rules, signals, notification, SLA, automation, and email-ready foundation with an audit-only stabilization pass.
- Closure documents:
  - `docs/PHASE_19_OPERATIONAL_INTELLIGENCE_CLOSURE.md`
  - `docs/PRODUCTION_OPERATIONAL_INTELLIGENCE_SMOKE.md`
- Production smoke on May 14, 2026 confirmed:
  - `GET /admin/signals` returns active deterministic operational signals
  - `GET /admin/automation-actions` returns duplicate-safe suggested actions
  - `GET /notifications` returns in-app notification summaries
  - `POST /notifications/read` marks long-id notifications read and reduces unread count
  - `POST /notifications/dismiss` marks long-id notifications dismissed
  - vendor `GET /signals` and `GET /notifications` remain vendor-scoped
  - vendor access to `GET /admin/automation-actions` is blocked with HTTP 403
- Phase 19F preserves these boundaries:
  - no automatic refunds
  - no automatic payouts
  - no automatic cancellations
  - no Slack or real outbound email provider
  - no AI action execution
  - no destructive remediation workflows

## Legacy Customer InvoiceExecution Removal (C4)
- The legacy BizimHesap / `InvoiceExecution` customer accounting sync system was removed after production archive export.
- Production archive evidence before removal:
  - database: `vendor_dashboard_h8fb`
  - archive status: `READY_FOR_EXPORT`
  - rows exported: 4
  - writes performed: false
- Removed active surface:
  - `InvoiceExecution` Prisma model
  - `InvoiceExecutionProvider` and `InvoiceExecutionStatus` enums
  - `FinanceLedgerEntry.invoiceExecutions` relation
  - `/admin/invoices/*` routes
  - BizimHesap adapter/runtime execution service
  - active BizimHesap env/config keys
  - finance dashboard invoice execution exposure
- Archived Phase 20A documentation remains under `docs/archive/legacy-finance/` for historical context only.
- Settlement commission invoices now use the settlement approval → Logo İşbaşı commission invoice lifecycle.
- The active invoice lifecycle is `SettlementApproval` → immutable request snapshot → `SettlementCommissionInvoice` → controlled Logo İşbaşı execution/reconciliation.
- The C4 cleanup readiness/archive diagnostic routes remain admin-only compatibility endpoints and report the legacy schema as removed/not applicable.

## Shipping Execution Foundation (Phase 20B)
- Phase 20B introduces merchant-of-record shipping execution orchestration while keeping the platform as canonical operational and finance truth.
- External carriers execute shipment creation. The backend persists carrier evidence without replacing Shopify canonical fulfillment state or weakening existing fulfillment safeguards.
- Provider abstraction:
  - `ShippingProviderAdapter`
  - `createShipment()`
  - `getShipmentStatus()`
  - `getTrackingInfo()`
  - `cancelShipment()` placeholder
- Initial provider:
  - `HEPSIJET`
  - `KARGO_ENTEGRATOR`
  - future-ready schema values: `MNG`, `YURTICI`, `ARAS`
- `VendorShippingConfig` stores vendor-level shipping settings:
  - preferred provider
  - shipping enabled flag
  - default desi
  - cargo integration id
  - default warehouse id
  - shipping VAT percent
  - optional provider metadata
- `VendorShippingWarehouse` stores vendor-scoped carrier warehouse/branch records:
  - provider
  - warehouse id
  - default marker
  - optional name/address/metadata
- Sporjinal seed config uses Kargo Entegratör cargo integration `2547`, default warehouse `1774`, default desi `3`, and shipping VAT `18%`.
- `ShipmentExecution` stores shipment execution evidence:
  - allocation and vendor scope
  - provider and provider shipment reference
  - tracking number, tracking URL, and label URL when returned
  - shipment status
  - desi
  - cargo integration id used
  - warehouse id used
  - shipping cost, shipping VAT, and currency when returned
  - request and safe response snapshots
- Duplicate prevention is enforced by the allocation/provider unique key. Repeat create attempts return the existing shipment execution instead of creating duplicate carrier shipments.
- Initial desi rules are deterministic and intentionally lightweight:
  - shoes: 3 desi
  - bags: 3 desi
  - apparel: 3 desi
  - fallback: vendor default desi
- Shipping VAT defaults to 18% when the provider returns a shipping cost without explicit VAT.
- Finance linkage:
  - confirmed provider cost creates or updates `ShipmentShippingCost`
  - source type is `EXTERNAL_PROVIDER`
  - status is `CONFIRMED`
  - immutable finance ledger snapshots are not mutated retroactively
- Shipping execution configuration is disabled by default:
  - `SHIPPING_EXECUTION_ENABLED=false`
  - `SHIPPING_PROVIDER=kargo_entegrator`
  - `KARGO_ENTEGRATOR_ENABLED=false`
  - `KARGO_ENTEGRATOR_BASE_URL`
  - `KARGO_ENTEGRATOR_API_KEY`
- Kargo Entegratör cargo integration ids and warehouse ids are vendor-scoped configuration, never global env values.
- Backend endpoints:
  - `GET /shipping/config`
  - `POST /shipments/create`
  - `GET /shipments/:id`
  - `GET /admin/shipments`
  - `PUT /admin/vendors/:vendorId/shipping-config`
- Vendor users can create and inspect shipments only for their own allocations. Admins can inspect shipment executions and configure vendor carrier settings.
- Phase 20B does not add WMS functionality, rate shopping, automatic return shipments, carrier cancellation execution, label printing infrastructure, or live provider reconciliation.
