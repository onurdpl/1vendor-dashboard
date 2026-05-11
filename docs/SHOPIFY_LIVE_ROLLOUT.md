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
- `SHOPIFY_API_VERSION`

Optional:

- `SHOPIFY_READINESS_LIVE_CHECK=true`
  - enables one lightweight live Shopify GraphQL check
  - remains off by default so local and CI checks do not call live Shopify

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

## Starting the Backend for Tunnel Testing
Use the normal backend start flow:

```bash
npm run backend:dev
```

Local defaults:
- backend: `http://127.0.0.1:4000`
- frontend real mode: `http://127.0.0.1:5173`

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
   - `https://<public-domain>/webhooks/shopify/orders-create`
7. Confirm the configured Shopify webhook secret matches backend configuration.
8. Register or update the live webhook manually.
9. Observe webhook verification, ingestion, and diagnostics endpoints during the first live deliveries.

## Guardrails
- Do not register live webhooks automatically from the app.
- Do not treat readiness success as proof that webhook delivery is already configured.
- Do not call live Shopify from CI or standard smoke checks.
- Review [SHOPIFY_DISCOVERIES.md](/Users/onur/Documents/New project 4/docs/SHOPIFY_DISCOVERIES.md) before changing Shopify-dependent behavior.
