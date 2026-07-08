# Shopify Live Rollout

## Purpose
- Provide a safe checklist before connecting the live Shopify store to this backend.
- Keep mock and local development paths intact while Phase 14 introduces real Shopify traffic deliberately.
- Make readiness verification explicit so we do not discover missing credentials during live webhook delivery.

## Required Environment Variables
Set these in `backend/.env` or the runtime environment before live rollout:

- `SHOPIFY_SHOP_DOMAIN`
- `SHOPIFY_ADMIN_ACCESS_TOKEN`
- `SHOPIFY_WEBHOOK_SECRET`
- `SHOPIFY_API_VERSION` (production webhooks currently use stable `2026-01`; do not use `unstable`)
- `SHOPIFY_RETURN_WEBHOOK_BASE_URL` (required only when registering return lifecycle webhooks)
- `SHOPIFY_ORDER_WEBHOOK_BASE_URL` (required only when registering order-create webhooks)

Optional:

- `SHOPIFY_READINESS_LIVE_CHECK=true`
  - enables one lightweight live Shopify GraphQL check
  - remains off by default so local and CI checks do not call live Shopify
- `SHOPIFY_REGISTER_RETURN_WEBHOOKS=true`
  - opt-in flag required to register return lifecycle webhooks
  - script exits safely without mutating Shopify when this flag is not set to `true`
- `SHOPIFY_REGISTER_ORDER_WEBHOOKS=true`
  - opt-in flag required to register order lifecycle webhooks
  - script exits safely without mutating Shopify when this flag is not set to `true`

## Current Live Webhook Configuration
Live Shopify webhook configuration uses:

- Backend base URL: `https://vendor-dashboard-backend-398h.onrender.com`
- Webhook API version: `2026-01`
- Format: JSON

Configured production webhooks:

| Shopify event | Production callback URL |
| --- | --- |
| Order creation | `https://vendor-dashboard-backend-398h.onrender.com/webhooks/shopify/orders-create` |
| Order payment | `https://vendor-dashboard-backend-398h.onrender.com/webhooks/shopify/orders-paid` |
| Order update | `https://vendor-dashboard-backend-398h.onrender.com/webhooks/shopify/orders-updated` |
| Order cancellation | `https://vendor-dashboard-backend-398h.onrender.com/webhooks/shopify/orders-cancelled` |
| Refund create | `https://vendor-dashboard-backend-398h.onrender.com/webhooks/shopify/refunds-create` |
| Fulfillment orders canceled | `https://vendor-dashboard-backend-398h.onrender.com/webhooks/shopify/fulfillment-orders-cancelled` |

Production webhook guardrails:
- All configured Shopify webhooks should use the same stable API version, currently `2026-01`.
- Do not use `unstable` for production webhooks.
- Do not use temporary or non-production callback bases such as `https://onevendor-dashboard-backend.onrender.com`.
- The expected production cancellation URL is `https://vendor-dashboard-backend-398h.onrender.com/webhooks/shopify/orders-cancelled`.

## Readiness Check
From the repository root:

```bash
npm run shopify:readiness
```

Or directly inside the backend:

```bash
npm --prefix backend run shopify:readiness
```

Behavior:
- validates that required Shopify environment variables exist
- rejects known development placeholder values
- checks that the shop domain looks like a valid `*.myshopify.com` domain
- never prints secret values
- only runs a live Shopify Admin API check when `SHOPIFY_READINESS_LIVE_CHECK=true`

## Order Webhook Registration (Opt-In)
Order ingestion depends on Shopify `ORDERS_CREATE` delivery to the backend. Payment snapshot updates depend on `ORDERS_PAID` delivery. Full-order cancellation reconciliation depends on `ORDERS_CANCELLED` delivery. Order address/contact correction and cancellation fallback depend on `ORDERS_UPDATED` delivery. Register all four through the same idempotent GraphQL helper used for other webhook groups.

Registration command from repository root:

```bash
npm run shopify:order-webhooks:register
```

Render shell alternative:

```http
POST /admin/shopify/order-webhooks/register
```

Use this admin-only deployed backend endpoint when Render shell access is unavailable. It uses the same idempotent registration semantics: exact existing subscriptions are reported as existing, missing subscriptions are created, and same-topic callback mismatches are reported without deleting or duplicating subscriptions.

Required env for registration:
- `SHOPIFY_REGISTER_ORDER_WEBHOOKS=true`
- `SHOPIFY_SHOP_DOMAIN`
- `SHOPIFY_ADMIN_ACCESS_TOKEN`
- `SHOPIFY_API_VERSION`
- `SHOPIFY_ORDER_WEBHOOK_BASE_URL`

Registered topics and callbacks:
- `ORDERS_CREATE` -> `${SHOPIFY_ORDER_WEBHOOK_BASE_URL}/webhooks/shopify/orders-create`
- `ORDERS_PAID` -> `${SHOPIFY_ORDER_WEBHOOK_BASE_URL}/webhooks/shopify/orders-paid`
- `ORDERS_CANCELLED` -> `${SHOPIFY_ORDER_WEBHOOK_BASE_URL}/webhooks/shopify/orders-cancelled`
- `ORDERS_UPDATED` -> `${SHOPIFY_ORDER_WEBHOOK_BASE_URL}/webhooks/shopify/orders-updated`

Full-order cancellation notes:
- `ORDERS_CANCELLED` is the primary full-order cancellation webhook.
- `ORDERS_UPDATED` is a fallback only when the payload contains `cancelled_at`.
- `cancelled_at` is the canonical cancellation signal.
- `financial_status=voided` alone is not sufficient for full-order cancellation processing.
- The cancellation bridge fetches canonical Shopify order state before invoking local reconciliation.
- SHOP-CANCEL-1 does not add vendor order UI projection, shipping queue projection, or new finance payout blocker logic.

## Starting the Backend for Tunnel Testing
Use the normal backend start flow:

```bash
npm run backend:dev
```

Local defaults:
- backend: `http://127.0.0.1:4000`
- frontend real mode: `http://127.0.0.1:5173`

## Return Lifecycle Webhook Registration (Opt-In)
Return lifecycle subscriptions are registered through Shopify GraphQL (`webhookSubscriptionCreate`) and require custom app scope `read_returns`.

Important:
- after adding `read_returns`, reinstall the custom app
- copy the refreshed Admin API token into `backend/.env`

Registration command from repository root:

```bash
npm run shopify:return-webhooks:register
```

Or directly inside backend:

```bash
npm --prefix backend run shopify:return-webhooks:register
```

Required env for registration:
- `SHOPIFY_REGISTER_RETURN_WEBHOOKS=true`
- `SHOPIFY_SHOP_DOMAIN`
- `SHOPIFY_ADMIN_ACCESS_TOKEN`
- `SHOPIFY_API_VERSION`
- `SHOPIFY_RETURN_WEBHOOK_BASE_URL`

Registered topics and callbacks:
- `RETURNS_REQUEST` -> `${SHOPIFY_RETURN_WEBHOOK_BASE_URL}/webhooks/shopify/returns-request`
- `RETURNS_APPROVE` -> `${SHOPIFY_RETURN_WEBHOOK_BASE_URL}/webhooks/shopify/returns-approve`
- `RETURNS_DECLINE` -> `${SHOPIFY_RETURN_WEBHOOK_BASE_URL}/webhooks/shopify/returns-decline`
- `RETURNS_CLOSE` -> `${SHOPIFY_RETURN_WEBHOOK_BASE_URL}/webhooks/shopify/returns-close`

## Public Tunnel Requirement
Shopify must reach a public HTTPS URL.

Typical flow:
1. start the backend locally
2. open a public HTTPS tunnel such as ngrok
3. point Shopify webhook delivery to the tunnel URL

Example webhook URL:

```text
https://<public-domain>/webhooks/shopify/orders-create
```

## Webhook Secret Reminder
- The Shopify webhook signing secret configured in Shopify must match `SHOPIFY_WEBHOOK_SECRET` in the backend environment.
- Do not commit secrets to git.
- Do not store production secrets in `.env.example`.

## Live Rollout Order
1. Configure backend live Shopify environment variables locally or in the target environment.
2. Run `npm run shopify:readiness`.
3. If needed, rerun with `SHOPIFY_READINESS_LIVE_CHECK=true` for one live Shopify Admin API confirmation.
4. Start the backend.
5. Expose the backend through a public HTTPS tunnel or deployed domain.
6. Confirm the webhook target URL:
   - `https://vendor-dashboard-backend-398h.onrender.com/webhooks/shopify/orders-create`
   - `https://vendor-dashboard-backend-398h.onrender.com/webhooks/shopify/orders-paid`
   - `https://vendor-dashboard-backend-398h.onrender.com/webhooks/shopify/orders-updated`
   - `https://vendor-dashboard-backend-398h.onrender.com/webhooks/shopify/orders-cancelled`
   - `https://vendor-dashboard-backend-398h.onrender.com/webhooks/shopify/refunds-create`
   - `https://vendor-dashboard-backend-398h.onrender.com/webhooks/shopify/fulfillment-orders-cancelled`
7. Confirm the configured Shopify webhook secret matches backend configuration.
8. Register or update the live webhooks manually, or run the order/return/fulfillment registration scripts with explicit opt-in flags.
9. Observe webhook verification, ingestion, and diagnostics endpoints during the first live deliveries.

## Guardrails
- Do not register live webhooks automatically from the app.
- Do not treat readiness success as proof that webhook delivery is already configured.
- Do not call live Shopify from CI or standard smoke checks.
- Review [SHOPIFY_DISCOVERIES.md](docs/SHOPIFY_DISCOVERIES.md) before changing Shopify-dependent behavior.
