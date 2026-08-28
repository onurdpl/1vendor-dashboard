# Render Production Migration Strategy

## Purpose

Define the safest production migration strategy for the backend Render web service when Render shell access is unavailable.

The backend uses Prisma and stores migrations under:

```text
backend/prisma/migrations/
```

The current schema changes that need production migration include:

- `20260516123000_add_return_reason_note`
- `20260516133000_add_return_tracking_fields`

## Repo Findings

- This is a monorepo:
  - root package: frontend/Vite commands and wrapper backend scripts
  - `backend/`: Fastify backend, Prisma schema, migrations, backend package lock
- There is no `render.yaml`, Dockerfile, or Procfile in the repo.
- Render service commands are therefore configured in the Render dashboard, not version-controlled here.
- The backend compiles TypeScript from `backend/src` to `backend/dist`.
- The production server entrypoint is:

```bash
node backend/dist/server.js
```

- Before this change, the backend package did not expose a production `start` script or a production migration script.
- The repo already had:
  - root `backend:db:migrate` -> backend `db:migrate`
  - backend `db:migrate` -> `prisma migrate dev`
- `prisma migrate dev` is not production-safe.
- Production must use:

```bash
prisma migrate deploy
```

## Added Stable Scripts

Root scripts:

```bash
npm run backend:start
npm run backend:db:deploy
```

Backend scripts:

```bash
npm --prefix backend run start
npm --prefix backend run db:deploy
```

These resolve to:

```bash
node dist/server.js
prisma migrate deploy
```

## Established Databases And Fresh Database Bootstrap

Production and every other established database must continue to use the normal migration deployment command:

```bash
npm run backend:db:deploy
```

Do not replace this command with the fresh database bootstrap.

For a genuinely new, empty PostgreSQL database only, run:

```bash
npm run backend:db:bootstrap:fresh
```

The fresh bootstrap validates that the target database is empty, validates the maintained schema snapshot, baseline manifest, and checksums, applies the snapshot, records the manifest's historical baseline migrations as applied, and then runs normal forward migration deployment. The command fails closed when these checks fail.

**Do not run fresh bootstrap against an existing or non-empty database.** The script rejects detected application objects and Prisma migration history before applying the snapshot, but operators must still treat it as a fresh-environment-only command.

This separate path is required because the historical migration chain cannot be replayed cleanly from zero: `20260513191500_add_operational_signals` references `PayoutBatch` before `20260513230000_add_payout_batch_preparation` creates it. Do not edit, reorder, squash, delete, or otherwise rewrite historical migration files to repair fresh-environment creation.

The maintained baseline files are:

- `backend/prisma/bootstrap/current-schema.sql`
- `backend/prisma/bootstrap/baseline-manifest.json`

Whenever `backend/prisma/schema.prisma` changes, the baseline must be refreshed in the same change because the bootstrap validates its checksum. Regenerate `current-schema.sql` from the actual schema using the repository's installed Prisma version and the generation command recorded in the manifest. Then advance the manifest cutoff to the latest migration represented by that snapshot, refresh the ordered baseline migration list, and update the recorded Prisma version plus schema, snapshot, and aggregate migration-file checksums. The bootstrap validates all of this metadata and applies only migrations newer than the cutoff afterward, so incomplete or inconsistent maintenance must fail CI. Validate the refreshed baseline against a disposable empty PostgreSQL database; leave all historical migration files unchanged.

Restoring an existing production backup is not fresh bootstrap: restore the backup and continue with normal migration deployment. Fresh bootstrap is appropriate in disaster recovery only when the recovery plan intentionally creates a truly empty replacement database and restores or reconstructs application data separately.

## Recommended Render Commands

Use these on the backend web service, not the frontend static service.

### Build Command

If the Render backend service root directory is the repository root:

```bash
npm ci && npm --prefix backend ci && npm run backend:db:generate && npm run backend:build
```

If the Render backend service root directory is `backend`:

```bash
npm ci && npm run db:generate && npm run build
```

Do not run production database migrations during the build command. Build commands should compile artifacts and generate Prisma Client, not mutate the production database.

### Pre-Deploy Command: Preferred

Use Render's backend service Pre-Deploy Command when available:

```bash
npm run backend:db:deploy
```

If the Render backend service root directory is `backend`:

```bash
npm run db:deploy
```

This is the safest Render path because the migration runs after build and before the new backend version receives traffic.

Render's deploy flow runs build, then pre-deploy, then start. Render documents pre-deploy commands as the recommended place for database migrations. If the pre-deploy command fails, the deploy fails and the previous successful service version keeps running.

### Start Command

If the Render backend service root directory is the repository root:

```bash
npm run backend:start
```

If the Render backend service root directory is `backend`:

```bash
npm run start
```

## Fallback If Pre-Deploy Command Is Unavailable

If the Render plan/service type does not support Pre-Deploy Command and shell access is unavailable, the safest fallback is to run migrations before backend startup:

Repository root service:

```bash
npm run backend:db:deploy && npm run backend:start
```

Backend-root service:

```bash
npm run db:deploy && npm run start
```

This is acceptable but less clean than a pre-deploy command:

- `prisma migrate deploy` is designed to be idempotent and applies only pending migrations.
- Repeated restarts should not reapply completed migrations.
- Startup depends on database availability.
- If migration fails, the backend instance does not start.

Use this fallback only when pre-deploy is unavailable.

## Why Not Run Migrations Locally

Do not copy Render production `DATABASE_URL` into a local terminal just to run migrations.

Running from Render ensures:

- the command uses the same production environment as the backend
- secrets stay in Render
- deployment logs capture the migration output
- operators do not leak production credentials into local shell history

## Why Not Use `backend:db:migrate`

Do not use:

```bash
npm run backend:db:migrate
```

That runs:

```bash
prisma migrate dev
```

`migrate dev` is intended for local development. It can create migrations and perform development-only checks. Production deploys should use `migrate deploy`.

## Rollback Risks

Current migrations are additive nullable columns:

- `ReturnRecord.returnReasonNote`
- `ReturnRecord.returnCarrierName`
- `ReturnRecord.returnTrackingNumber`
- `ReturnRecord.returnTrackingUrl`

These are backward-compatible with the previous backend because older code ignores extra nullable columns.

Rollback considerations:

- Rolling back code after these migrations is low risk.
- Dropping the columns is not recommended unless an approved database rollback is required because it removes captured return reason/tracking data.
- Prisma migration rollback is not automatic; rollback would require an explicit SQL change.

## Startup Failure Risks

Possible failures:

- `DATABASE_URL` missing or pointed at the wrong database
- Prisma migration drift or failed migration state
- production database unavailable
- migration SQL error

Behavior:

- With Pre-Deploy Command: deploy fails before new code receives traffic; prior successful deploy remains active.
- With startup fallback: backend process fails to start until the migration issue is resolved.

Stop conditions:

- Prisma reports drift
- Prisma reports a failed migration
- `migrate deploy` attempts an unexpected migration
- Render environment variables are missing or unexpectedly changed

## Verification

After deploy:

```bash
export BACKEND_URL="https://vendor-dashboard-backend-398h.onrender.com"

curl -sS "$BACKEND_URL/health"
curl -sS "$BACKEND_URL/version"
curl -sS "$BACKEND_URL/health/db"
```

Expected:

- `/health` returns `{ "ok": true }`
- `/version` returns `service: "vendor-dashboard-backend"` and `nodeEnv: "production"`
- `/health/db` returns connected status

Then verify Returns UI fields:

- existing/new return reasons render when backfilled or ingested
- return shipment card appears only when Shopify provides carrier/tracking
- no refund/order/shipment status behavior changes

## Recommended Final Render Backend Configuration

For backend service rooted at repository root:

```text
Build Command:
npm ci && npm --prefix backend ci && npm run backend:db:generate && npm run backend:build

Pre-Deploy Command:
npm run backend:db:deploy

Start Command:
npm run backend:start
```

For backend service rooted at `backend`:

```text
Build Command:
npm ci && npm run db:generate && npm run build

Pre-Deploy Command:
npm run db:deploy

Start Command:
npm run start
```

Fallback without Pre-Deploy Command:

```text
Start Command:
npm run backend:db:deploy && npm run backend:start
```

or, if rooted at `backend`:

```text
Start Command:
npm run db:deploy && npm run start
```
