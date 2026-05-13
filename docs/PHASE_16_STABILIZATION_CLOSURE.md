# Phase 16-4 Production Stabilization Closure Audit

## Purpose
- Formalize the production-ready operational foundation before Phase 16A/16B/16C/16D UX architecture work begins.
- Consolidate the current Shopify lifecycle, recovery, reconciliation, and vendor isolation posture into one closure reference.
- Record known operational risks and non-goals without changing production runtime behavior.

## Architecture Snapshot
- Production frontend: `https://onevendor-dashboard.onrender.com`
- Production backend: `https://vendor-dashboard-backend-398h.onrender.com`
- Production database: Render Postgres
- Backend stack: Node.js, TypeScript, Fastify, Prisma, PostgreSQL
- Shopify Admin GraphQL remains the canonical external source of truth.
- Webhook payloads are treated as event envelopes; destructive or stateful operational changes prefer canonical Shopify re-fetch.
- Local database state is the operational control-center state and must remain reconcilable.
- Vendor isolation is enforced server-side through authenticated vendor context and allocation-level scoping.
- No runtime code changes were required for this audit.

## Production Readiness Summary
- Backend health was reachable at the production Render backend.
- Backend version endpoint reported `nodeEnv: "production"`.
- Frontend Render URL responded successfully.
- Current platform foundation supports verified webhook receipt, HMAC verification, duplicate-safe idempotency, vendor-scoped order/return/refund/fulfillment state, diagnostics, replay/recover, and admin-triggered reconciliation.
- Recovery remains explicit and operator-driven; no queue worker, scheduler, or silent background repair was introduced.

## Supported Production Lifecycle
- `orders/create`
- `refunds/create`
- `returns/request`
- `returns/approve`
- `returns/decline`
- `returns/close`
- `fulfillments/create`
- `fulfillments/update`
- `fulfillment_events/create`
- `fulfillment_orders/cancelled`

## Operational Audit

### Webhook Ingestion
- Shopify webhook routes are registered under `backend/src/modules/shopify/webhook.routes.ts`.
- Supported webhook deliveries are accepted with `202` after valid HMAC verification, including duplicate or needs-attention outcomes.
- Webhook payloads are persisted as `WebhookEvent` rows when `DATABASE_URL` is configured.
- Newer persisted webhook events retain raw payload content for admin replay/recover; diagnostics do not expose full raw payloads by default.

### HMAC Verification
- Verification uses the exact raw JSON request bytes captured by the Fastify content-type parser.
- Verification uses timing-safe comparison.
- Invalid signatures return `401`.
- Verification failure logs safe metadata only: route/topic, content-type, raw byte length, HMAC header presence, and payload hash.
- Secret routing:
  - orders/refunds use `SHOPIFY_WEBHOOK_SECRET`
  - return lifecycle routes use `SHOPIFY_RETURN_WEBHOOK_SECRET` when set, otherwise `SHOPIFY_WEBHOOK_SECRET`
  - fulfillment lifecycle routes use `SHOPIFY_FULFILLMENT_WEBHOOK_SECRET` when set, otherwise `SHOPIFY_WEBHOOK_SECRET`

### Idempotency
- Primary idempotency key is `sourceShopDomain + topic + webhookId`.
- Fallback idempotency key is `sourceShopDomain + topic + payloadHash`.
- Duplicate deliveries are accepted with `202` and `duplicate_ignored`.
- Duplicate deliveries do not create a second operational processing row.

### Diagnostics / Replay / Recover
- Admin-only diagnostics endpoints expose webhook receipt, processing state, payload availability, safe affected-entity hints, sync events, and reconciliation suggestions.
- Replay is topic-gated and payload-gated.
- Recover is limited to `RECEIVED` and `FAILED` events with retained payload.
- Processed events are protected from accidental recovery.
- Vendor users are forbidden from diagnostics routes.

### Reconciliation Tooling
- Admin-only reconciliation endpoints can re-fetch canonical Shopify fulfillment state for one allocation or one local Shopify order.
- Reconciliation repairs only safe local operational fields when canonical state is clear.
- Reconciliation does not mutate Shopify, raw webhook history, manual notes, or historical finance records.
- Multi-vendor repair remains scoped by Shopify line item id.

### Vendor Isolation
- Vendor read APIs use authenticated backend vendor context instead of trusting `X-Vendor-Id`.
- Vendor-facing orders, returns, refunds, finance, fulfillment, and tracking state are scoped to assigned/allotted vendor records.
- Admin-only operations, diagnostics, and reconciliation routes reject vendor users.
- Cross-vendor detail access resolves to forbidden or not found semantics instead of leaking data.

### Finance Ledger Flow
- Finance is reporting-focused.
- Gross sales derive from vendor-allocated order line items.
- Refunds derive from vendor-allocated refund line items created by `refunds/create`.
- Pending return requests do not create refund ledger entries.
- Reconciliation can repair missing finance ledger entries only for already persisted processed refund records.
- No payout engine or payout execution exists yet.

### Fulfillment Lifecycle
- Vendor/admin tracking submission is exposed through `POST /fulfillments/:allocationId/tracking`.
- Backend validates assigned vendor ownership before fulfillment mutations.
- Shopify fulfillment sync uses fulfillment-order and line-item scoped behavior.
- Inbound fulfillment webhooks trigger canonical Shopify fulfillment refresh before local allocation mutation.
- Tracking fields are persisted only when Shopify provides tracking info.

### Cancellation Rollback
- Fulfillment cancellation truth comes from canonical `fulfillmentOrder.status` or `fulfillment.status`, not broad display fields.
- `FULFILLMENT_ORDERS_CANCELLED` is the preferred cancellation subscription.
- `FULFILLMENTS_UPDATE` may also reflect cancellation after canonical re-fetch.
- Rollback clears fulfillment/tracking state only for affected line-item scoped allocations.

### Tracking Sync
- Tracking submission stores tracking number, carrier, optional tracking URL, Shopify fulfillment id, sync status, and shipment timestamps.
- Inbound fulfillment sync refreshes local tracking from canonical Shopify state.
- If Shopify tracking info is absent, the backend preserves empty tracking state instead of inventing carrier or tracking data.

### Return Lifecycle
- `returns/request` creates vendor-scoped pending return records through canonical Shopify Return fetch and original `seller_info` mapping.
- `returns/approve`, `returns/decline`, and `returns/close` update existing return lifecycle status.
- Return lifecycle state remains separate from refund/finance state.

### Refund Lifecycle
- `refunds/create` maps refund line items by original order allocation snapshot and SKU.
- Vendor-scoped refund/return records are created only for affected vendor-owned refunded line items.
- Missing SKU, missing order mapping, or unknown vendor mapping fails into diagnostics/needs-attention instead of silent fallback.

## Webhook Inventory

| Shopify topic | Backend route | Expected production state | Active verification path |
| --- | --- | --- | --- |
| `ORDERS_CREATE` | `/webhooks/shopify/orders-create` | Required production subscription | Shopify Admin GraphQL subscription listing |
| `REFUNDS_CREATE` | `/webhooks/shopify/refunds-create` | Required production subscription | Shopify Admin GraphQL subscription listing |
| `RETURNS_REQUEST` | `/webhooks/shopify/returns-request` | Required production subscription | `shopify:return-webhooks:register` / GraphQL listing |
| `RETURNS_APPROVE` | `/webhooks/shopify/returns-approve` | Required production subscription | `shopify:return-webhooks:register` / GraphQL listing |
| `RETURNS_DECLINE` | `/webhooks/shopify/returns-decline` | Required production subscription | `shopify:return-webhooks:register` / GraphQL listing |
| `RETURNS_CLOSE` | `/webhooks/shopify/returns-close` | Required production subscription | `shopify:return-webhooks:register` / GraphQL listing |
| `FULFILLMENTS_CREATE` | `/webhooks/shopify/fulfillments-create` | Required production subscription | `shopify:fulfillment-webhooks:register` / GraphQL listing |
| `FULFILLMENTS_UPDATE` | `/webhooks/shopify/fulfillments-update` | Required production subscription | `shopify:fulfillment-webhooks:register` / GraphQL listing |
| `FULFILLMENT_EVENTS_CREATE` | `/webhooks/shopify/fulfillment-events-create` | Required production subscription | `shopify:fulfillment-webhooks:register` / GraphQL listing |
| `FULFILLMENT_ORDERS_CANCELLED` | `/webhooks/shopify/fulfillment-orders-cancelled` | Required production subscription | `shopify:fulfillment-webhooks:register` / GraphQL listing |

GraphQL-managed subscriptions may not appear in the Shopify Admin UI. Use Shopify Admin GraphQL subscription listing or the mixed-state-safe registration scripts as the operational source of truth. The Render backend is the canonical webhook target. Direct live subscription listing was not run from the local workspace during this audit because production Shopify credentials are held in Render/Shopify operational configuration, not in the repo.

## Environment Audit

| Env var | Required in production | Lifecycle / purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes | Render Postgres persistence for operational state, webhook events, diagnostics, replay/recover, reconciliation, finance, and vendor-scoped APIs |
| `SHOPIFY_ADMIN_ACCESS_TOKEN` | Yes | Canonical Shopify Admin GraphQL/REST re-fetch, seller info, return details, fulfillment state, fulfillment creation, registration scripts |
| `SHOPIFY_SHOP_DOMAIN` | Yes | Shopify Admin API target domain |
| `SHOPIFY_API_VERSION` | Yes | Shopify Admin API version; defaults locally to `2024-01` but should be explicit in Render production |
| `SHOPIFY_WEBHOOK_SECRET` | Yes | HMAC verification for orders/refunds and fallback for return/fulfillment webhooks |
| `SHOPIFY_RETURN_WEBHOOK_SECRET` | Lifecycle-specific optional | Return lifecycle HMAC override when return subscriptions are signed by a different app secret |
| `SHOPIFY_FULFILLMENT_WEBHOOK_SECRET` | Lifecycle-specific optional | Fulfillment lifecycle HMAC override when fulfillment subscriptions are signed by a different app secret |

Production also requires `JWT_SECRET` and `CORS_ORIGIN` at runtime, although they are outside the Shopify-specific audit list.

## Production Smoke Checklist
- Dedicated checklist: [PRODUCTION_OPERATIONAL_SMOKE_CHECKLIST.md](/Users/onur/Documents/New project 4/docs/PRODUCTION_OPERATIONAL_SMOKE_CHECKLIST.md)
- Coverage includes login, order ingest, return request, return approval/decline/close, refund ingest, fulfillment update, tracking sync, cancellation rollback, diagnostics replay/recover, reconciliation, and vendor isolation verification.

## Known Limitations And Intentional Non-Goals
- No async worker infrastructure yet.
- Reconciliation is operator-triggered.
- No scheduled jobs yet.
- No background retry workers yet.
- No external ERP integration yet.
- No external cargo/carrier integration yet.
- No invoice generation.
- No shipment label generation.
- No payout engine yet.
- No analytics engine yet.
- No realtime socket infrastructure yet.
- No marketplace, ERP, shipping carrier, invoice-generator, or label-generator scope is introduced by this phase.

## Production Risk Assessment
- Shopify webhook delivery can be delayed or retried outside this application's control.
- Render cold starts may affect first-request latency if the service scales down or restarts.
- Recovery depends on operator action through diagnostics/replay/recover and reconciliation surfaces.
- There are no background retry workers yet for automated stuck-event recovery.
- Shopify Admin API availability and rate limits remain external dependencies.
- Canonical re-fetch can fail when Shopify credentials, scopes, API version, or network access are unhealthy.
- Older webhook events may not have replayable raw payload if they predate payload retention.
- GraphQL-managed webhook subscriptions need GraphQL/script verification because Shopify Admin UI may not show the complete active inventory.

## Next Phase Entry Criteria

### Phase 16A Foundation System
- Preserve existing routes, auth, vendor context, and API contracts.
- Treat the current control-center backend state as the production foundation.
- UX architecture work must not weaken HMAC, idempotency, diagnostics, or vendor isolation.

### Phase 16B Returns Control Center
- Build on separated pending-return and processed-refund lifecycle states.
- Keep pending return requests finance-neutral until `refunds/create`.
- Preserve line-item scoped vendor attribution and safe unknown-state handling.

### Phase 16C Finance + Diagnostics
- Keep finance reporting tied to vendor-scoped order/refund ledger state.
- Keep diagnostics admin-only and avoid exposing secrets or full raw payloads.
- Use backend-computed replay/recover eligibility instead of frontend inference.

### Phase 16D Orders + Shell Polish
- Preserve assigned-vendor order scoping and multi-vendor allocation correctness.
- Keep tracking mutation and fulfillment state actions backend-owned.
- Avoid visual polish that implies unsupported actions are production-ready.

### Phase 17 Infrastructure Hardening
- Candidate scope: async workers, background retries, scheduled reconciliation checks, observability, alerting, and stronger deployment health checks.
- Must preserve explicit operator auditability for any automated recovery path.

### Phase 18 Finance / Payout Engine
- Candidate scope: authoritative payout calculations, payout status workflow, accounting exports, and payout provider integration.
- Must preserve historical financial records and refund-ledger provenance.

### Phase 19 Automation / Rules
- Candidate scope: operational rules, triage automation, alert routing, and safe recommendations.
- Automation should start advisory unless audit trails, permissions, and rollback semantics are explicit.

### Phase 20 External Integrations
- Candidate scope: ERP, cargo/carrier, invoice provider, shipment label provider, and external operational sync.
- External providers may generate invoices, labels, or carrier records; this platform remains the operational control center and source of operational truth.

## Repo Operational Guidance Audit
- `AGENTS.md` is consistent with the current architecture, Shopify reconciliation philosophy, operational constraints, and diagnostics/recovery behavior.
- No `AGENTS.md` update was required.
- Minimal cleanup applied: `backend/.env.example` now includes the return webhook registration opt-in variables alongside the existing fulfillment registration variables.

## Closure Statement
- Phase 16-4 is a stabilization documentation and audit closeout.
- Production behavior is preserved.
- The current foundation is ready to serve as the baseline for Phase 16A/16B/16C/16D UX architecture work, with infrastructure hardening deferred to later phases.
