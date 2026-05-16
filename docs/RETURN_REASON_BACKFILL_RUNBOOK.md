# Return Reason Backfill Production Runbook

## Purpose

Apply the `ReturnRecord.returnReasonNote` production migration and backfill existing Shopify return request records with customer return reasons from canonical Shopify Return details.

This runbook is for backend commit `7f28b31` or later.

## Scope And Safety

- Backfill endpoint: `POST /admin/returns/reasons/backfill`
- Backfill is dry-run by default.
- The backfill targets only Shopify return request records that have a Shopify Return id/GID and a missing or generic reason such as `Return requested` or `Requested`.
- The backfill does not overwrite existing non-generic customer reasons.
- The backfill does not change refund, shipment, order, payout, or lifecycle status logic.
- Shopify remains the canonical external source for return reason fields.

## Prerequisites

- Render backend service is deployed from commit `7f28b31` or later.
- Render backend has production `DATABASE_URL`.
- Render backend has valid Shopify Admin env values:
  - `SHOPIFY_SHOP_DOMAIN`
  - `SHOPIFY_ADMIN_ACCESS_TOKEN`
  - `SHOPIFY_API_VERSION`
- Operator has an admin account that can obtain a backend bearer token.
- Do not copy production database credentials into chat, logs, shell history, or docs.

## Migration Tooling

The repo uses Prisma.

Current scripts:

- Root `npm run backend:db:migrate` maps to `npm --prefix backend run db:migrate`
- Backend `db:migrate` maps to `prisma migrate dev`

`prisma migrate dev` is not the production command.

Production must use Prisma migrate deploy:

```bash
npm --prefix backend exec -- prisma migrate deploy
```

Run this from the Render backend shell or an equivalent one-off Render job so `DATABASE_URL` is read from Render environment configuration. Prefer Render shell/one-off job over running from a local machine with copied production credentials.

## 1. Verify Deployment

Confirm the backend is deployed at commit `7f28b31` or later.

Preferred Render check:

1. Open Render dashboard.
2. Open the backend service.
3. Open the Deploys tab.
4. Confirm the active deploy commit is `7f28b31` or a later commit on `main`.

Command checks:

```bash
export BACKEND_URL="https://vendor-dashboard-backend-398h.onrender.com"

curl -sS "$BACKEND_URL/health"
curl -sS "$BACKEND_URL/version"
```

Expected:

- `/health` returns `{ "ok": true }`
- `/version` returns `service: "vendor-dashboard-backend"` and `nodeEnv: "production"`

Note: `/version` does not expose the Git SHA in the current app, so exact commit verification is through Render deploy metadata. If using a Render shell that includes Git metadata, this command is also acceptable:

```bash
git rev-parse HEAD
```

## 2. Apply Production Migration

Migration being applied:

```sql
ALTER TABLE "ReturnRecord" ADD COLUMN "returnReasonNote" TEXT;
```

Migration directory:

```text
backend/prisma/migrations/20260516123000_add_return_reason_note/
```

From the Render backend shell or one-off job:

```bash
npm --prefix backend exec -- prisma migrate status
npm --prefix backend exec -- prisma migrate deploy
npm --prefix backend exec -- prisma migrate status
```

Expected:

- `migrate deploy` applies `20260516123000_add_return_reason_note` if it is pending.
- The final `migrate status` reports the database is up to date.

Stop conditions:

- `DATABASE_URL` is missing or points to an unexpected database.
- Prisma reports migration drift.
- Prisma reports a failed migration.
- Render shell is not running against the production backend environment.

Do not use:

```bash
npm run backend:db:migrate
```

That script runs `prisma migrate dev` and is for development databases.

## 3. Get An Admin Bearer Token

Use the existing backend auth pattern.

```bash
export BACKEND_URL="https://vendor-dashboard-backend-398h.onrender.com"

curl -sS -X POST "$BACKEND_URL/auth/login" \
  -H "content-type: application/json" \
  -d '{"email":"<ADMIN_EMAIL>","password":"<ADMIN_PASSWORD>"}'
```

Copy the returned `token` into a local shell variable. Do not paste the token into logs or tickets.

```bash
export ADMIN_TOKEN="<ADMIN_TOKEN>"
```

All backfill calls use:

```text
Authorization: Bearer <ADMIN_TOKEN>
```

## 4. Run Dry-Run Backfill

Dry-run is the default, but pass it explicitly.

```bash
curl -sS -X POST "$BACKEND_URL/admin/returns/reasons/backfill" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"dryRun":true,"limit":50}'
```

Expected response fields:

```json
{
  "dryRun": true,
  "scanned": 50,
  "eligible": 0,
  "updated": 0,
  "skipped": 0,
  "failed": 0,
  "results": []
}
```

Result row statuses may include:

- `eligible`
- `skipped_missing_return_id`
- `skipped_existing_reason`
- `skipped_no_reason`
- `failed`

Review:

- `eligible`: rows that would be updated during execution.
- `skipped`: expected for rows without matching needs.
- `failed`: must be investigated before execution.
- `reasonPreview`: Shopify reason that would be stored.
- `notePreview`: Shopify note that would be stored.

Stop conditions:

- `failed > 0`
- `eligible` is unexpectedly high.
- `reasonPreview` values look generic or wrong.
- Shopify credential/config errors appear.
- Response is `401` or `403`, meaning token/auth role is wrong.
- Response is `500`, meaning backend or Shopify fetch failed.

Optional smaller dry run:

```bash
curl -sS -X POST "$BACKEND_URL/admin/returns/reasons/backfill" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"dryRun":true,"limit":10}'
```

## 5. Execute Real Backfill

Run execution only after dry-run is reviewed and accepted.

```bash
curl -sS -X POST "$BACKEND_URL/admin/returns/reasons/backfill" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"dryRun":false,"limit":50}'
```

Expected response fields:

```json
{
  "dryRun": false,
  "scanned": 50,
  "eligible": 3,
  "updated": 3,
  "skipped": 47,
  "failed": 0,
  "results": []
}
```

Execution is idempotent. Running it again should not overwrite non-generic reasons already captured and should report fewer or no eligible rows.

Stop conditions:

- `failed > 0`
- `updated` is higher than expected from dry-run.
- Any result indicates an unexpected Shopify fetch or mapping error.

## 6. Verify After Execution

Run another dry-run:

```bash
curl -sS -X POST "$BACKEND_URL/admin/returns/reasons/backfill" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"dryRun":true,"limit":50}'
```

Expected:

- Previously updated rows should no longer appear as `eligible`.
- `failed` should remain `0`.

Then verify the UI:

1. Open the production frontend.
2. Log in as admin or the relevant vendor.
3. Open Returns.
4. Select a return that was updated.
5. Confirm the Return Summary `Reason` field shows the Shopify/customer reason instead of generic `Return requested`.
6. Confirm the `Note` field appears when Shopify returned a note.
7. Confirm vendor users only see their own vendor returns.

## Rollback And Recovery

There is no automatic app-level rollback for populated reasons.

Safe stop:

- If dry-run fails, do not execute.
- If execution partially fails, stop and review `results` before rerunning.
- Because the operation is idempotent and skips non-generic reasons, reruns are safe after fixing external/config issues.

Database rollback should only be used if the migration itself causes a production issue. The minimal schema rollback is:

```sql
ALTER TABLE "ReturnRecord" DROP COLUMN "returnReasonNote";
```

Do not run the rollback unless approved, because it removes captured Shopify return notes.

## Remaining Unknowns

- `/version` does not expose Git SHA, so exact deployed commit verification relies on Render deploy metadata unless shell Git metadata is available.
- Historical Shopify return reasons are available only if Shopify still returns details for the stored Return GID or numeric Return id.
