# Deployment Checklist

This checklist is for Render production deploys of the VendorOps frontend and backend. It is intentionally operational and conservative: deploy the backend first when database/API contracts change, then deploy the frontend that consumes those contracts.

## Before Deploy

- Confirm the branch contains the intended commit and no unrelated local changes.
- Run local validation:
  - `npm run build`
  - `npm run test`
  - `npm run backend:build`
  - `npm run backend:typecheck`
- Review Prisma migrations under `backend/prisma/migrations`.
- Confirm production Render environment variables are present for the backend:
  - `NODE_ENV=production`
  - `DATABASE_URL`
  - `CORS_ORIGIN`
  - `JWT_SECRET`
  - `JWT_EXPIRES_IN`
  - `SHOPIFY_WEBHOOK_SECRET`
  - `SHOPIFY_RETURN_WEBHOOK_SECRET` when return webhooks are enabled
  - `SHOPIFY_FULFILLMENT_WEBHOOK_SECRET` when fulfillment webhooks are enabled
  - `SHOPIFY_SHOP_DOMAIN`
  - `SHOPIFY_ADMIN_ACCESS_TOKEN`
  - `SHOPIFY_API_VERSION` (live Shopify webhooks currently use stable `2026-01`; do not set production webhooks to `unstable`)
  - provider gates such as `SHIPPING_EXECUTION_ENABLED`, `KARGO_ENTEGRATOR_ENABLED`, and `LOGO_ISBASI_CREATE_ENABLED` only when intentionally live
- Confirm production frontend variables:
  - `VITE_API_MODE=real`
  - `VITE_API_BASE_URL=<backend origin>` for standard cross-origin mode, or `VITE_API_BASE_URL=/api` for the reversible mobile same-origin proxy test
  - optional visibility metadata: `VITE_APP_ENV`, `VITE_APP_VERSION`, `VITE_BUILD_TIMESTAMP`, `VITE_GIT_COMMIT`
- Production frontend startup fails closed unless `VITE_API_MODE=real`; see `docs/FRONTEND_PRODUCTION_CONFIG.md`.

## Backend Deploy

- Deploy the backend service before the frontend when migrations or response contracts changed.
- Render build command should install/build the backend from the monorepo context.
- Apply Prisma migrations with the repo script:

```bash
npm run backend:db:deploy
```

- If Render shell access is unavailable, configure the backend service start command or deploy step so `prisma migrate deploy` runs before `backend:start`, for example:

```bash
npm run backend:db:deploy && npm run backend:start
```

- `prisma migrate deploy` is idempotent for already-applied migrations. If it fails, stop the deploy and inspect the migration error before restarting the service.
- Do not use `prisma db push` for production schema changes.

## Frontend Deploy

- Deploy the frontend after the backend is live and ready.
- Confirm SPA fallback remains configured so direct routes such as `/orders`, `/returns/:id`, `/finance`, and `/admin/diagnostics` load the app shell.
- Confirm `VITE_API_BASE_URL` points to the production backend origin, not localhost.
- For mobile same-origin auth testing, configure Render Static Site rewrites in this order:
  - Source `/api/*`, Destination `https://vendor-dashboard-backend-398h.onrender.com/*`, Action `Rewrite`
  - Source `/*`, Destination `/index.html`, Action `Rewrite`
  - Do not proxy `/admin/*`; frontend admin routes remain under `/admin/*`, while backend admin APIs use `/api/admin/*`.
- If auth/session code changed, expect users with old browser sessions to be redirected to login with the expired-session message.

## Post-Deploy Verification

- Open backend liveness:

```bash
curl -sS <BACKEND_URL>/health
```

Expected safe fields:
- `ok`
- `status`
- `timestamp`

- Open backend DB-backed readiness:

```bash
curl -sS <BACKEND_URL>/ready
```

Expected ready response:

```json
{ "status": "ready" }
```

- Production Render backend Health Check Path should be changed to `/ready` only after the deployed `/ready` endpoint returns `200` in production.
- Open frontend as admin and visit `/admin/diagnostics`.
- In the Deployment runtime section, verify:
  - frontend mode is `real`
  - API origin matches the backend origin
  - backend health is reachable
  - database is reachable
  - migration table is reachable
  - frontend/backend version or git metadata matches the expected deploy
- Use the post-deploy links on `/admin/diagnostics` to verify:
  - Orders loads
  - Returns loads
  - Finance loads
  - Support loads
  - Operations loads
  - admin vendor switching still loads scoped data
- As a vendor user, verify one vendor-scoped page loads and does not expose admin diagnostics.

## Migration Safety

- Runtime readiness checks report whether the production backend can complete a minimal database round trip. Non-production database diagnostics may also report `_prisma_migrations` table reachability and required operational columns such as `ShopifyOrder.customerPhone` and Navlungo return evidence fields on `ReturnRecord`.
- `schemaReady=false` or a non-empty `missingColumns` list means production is running with unapplied schema changes. Apply migrations before testing return pickup evidence or Shopify order ingestion.
- Readiness checks still do not prove whether every local migration file has been applied. Use `npm run backend:db:deploy` during backend deploy for authoritative Prisma migration application.
- If `migrationsReachable=false` but `dbReachable=true`, do not proceed with frontend verification until the backend migration deploy path is checked.

## Rollback Guidance

- Prefer rolling back frontend first when the issue is display-only or a frontend/backend version mismatch.
- Roll back backend only after confirming the previous backend can run against the current production schema.
- Do not roll back a migration by deleting production data. Create a forward fix migration if schema repair is required.
- If users see unexpected Unauthorized after rollback/deploy, have them sign in again; stale sessions are cleared on backend `401`.
- To roll back the mobile same-origin proxy test, set `VITE_API_BASE_URL` back to the absolute backend URL, remove the `/api/*` Static Site rewrite, redeploy the frontend, and keep the SPA fallback.

## Stop Conditions

- Backend `/health` reports database unreachable.
- Prisma migration deploy fails.
- Admin diagnostics cannot load with a fresh admin session.
- Vendor-scoped Orders/Returns/Finance pages return true authorization failures for a valid vendor session.
- Frontend Deployment runtime shows API origin pointing to localhost or the wrong backend service.
