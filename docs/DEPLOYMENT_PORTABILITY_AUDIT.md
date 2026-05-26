# Deployment Portability Audit

## Purpose

This document audits how portable the current system is away from Render and identifies hidden provider coupling before hosting cost or scale pressure forces an urgent migration.

This is discovery and design only. It does not migrate infrastructure, introduce Docker, split services, change runtime behavior, change provider logic, or modify deployment scripts.

## Current Architecture Map

### Frontend

- Vite + React single-page app.
- Build command: `npm run build`.
- Build output: `dist/index.html`, `dist/404.html`, `dist/assets/*`.
- Routing: `BrowserRouter`, so production hosting must rewrite unknown routes to `index.html`.
- Static fallback assets:
  - `public/_redirects` with `/* /index.html 200`.
  - `vite.config.ts` emits both `index.html` and `404.html`.
- Runtime API selection is build-time Vite config:
  - `VITE_API_MODE=mock | real`
  - `VITE_API_BASE_URL=<backend origin>`
  - optional build metadata such as `VITE_APP_ENV`, `VITE_APP_VERSION`, `VITE_BUILD_TIMESTAMP`, `VITE_GIT_COMMIT`.

### Backend

- Node.js + Fastify API.
- Entry point: `backend/src/server.ts`.
- Production start command: `npm run backend:start` -> `node backend/dist/server.js`.
- Backend build command: `npm run backend:build` -> TypeScript compile.
- Server binds to `0.0.0.0` and `env.PORT`.
- CORS is explicitly configured with `CORS_ORIGIN`.
- Health/readiness endpoints:
  - `GET /health`
  - `GET /health/db`
  - `GET /version`
- Logs go to Fastify/stdout with safe request timing for key routes.
- No explicit file upload service or local persistent storage was found.

### Database

- Prisma ORM.
- Prisma datasource provider: `postgresql`.
- Database URL: `DATABASE_URL`.
- Migrations live under `backend/prisma/migrations`.
- Production migration command:
  - root: `npm run backend:db:deploy`
  - backend: `npm run db:deploy`
  - underlying command: `prisma migrate deploy`.
- Seed command exists for local/demo bootstrap:
  - `npm run backend:db:seed`.

### Jobs And Background Work

- Operational jobs are persisted in Postgres.
- Scheduled reconciliation exists as an optional in-process interval:
  - `SCHEDULED_RECONCILIATION_ENABLED`
  - `SCHEDULED_RECONCILIATION_EXECUTE_DUE`
  - `SCHEDULED_RECONCILIATION_INTERVAL_MS`
  - `SCHEDULED_RECONCILIATION_COOLDOWN_MS`
  - `SCHEDULED_RECONCILIATION_CANDIDATE_LIMIT`
- No Redis, BullMQ, RabbitMQ, Kafka, external worker service, or managed cron abstraction was found.
- Shopify webhook ingestion is synchronous through backend HTTP routes, with operational job records for audit/recovery.

### External Providers

Provider credentials and execution gates are env-driven:

- Shopify Admin and webhook secrets.
- Kargo Entegrator.
- Try OTO.
- Kargonomi.
- Navlungo.
- Bizimhesap invoice execution.
- Email notification placeholder (`noop` or `console` only today).

These are provider integrations, not hosting provider coupling.

## Render-Specific Coupling Inventory

| Area | Evidence | Classification | Migration Impact |
| --- | --- | --- | --- |
| Production hosting docs | `AGENTS.md`, `docs/DEPLOYMENT_CHECKLIST.md`, and smoke docs name Render frontend/backend/Postgres URLs. | Minor migration work | Documentation and operator runbooks need updating. |
| Build metadata | Backend reads `RENDER_GIT_COMMIT` before generic `GIT_COMMIT`, `COMMIT_SHA`, `SOURCE_VERSION`. | Portable | This is optional metadata with generic fallbacks. |
| Port binding | Backend binds `0.0.0.0` and env `PORT`; Render also provides `PORT`. | Portable | Works on most PaaS/container hosts. |
| Health checks | `/health` and `/health/db` support Render-style service checks. | Portable | Generic enough for most targets. |
| Render Postgres URL | Production currently uses Render `DATABASE_URL`. | Minor migration work | Replace connection string and run migrations on target Postgres. |
| Render dashboard envs | Production envs appear managed through Render service config, not repo IaC. | Minor migration work | Manual env recreation is the main migration burden. |
| Render deploy command | Docs mention Render shell/pre-deploy/start command patterns for `prisma migrate deploy`. | Minor migration work | Equivalent deploy hook/start command must be configured on the new host. |
| Render cold-start workflow | Docs and diagnostics mention cold-start age/health checks. | Portable with operational caveat | Cold-start behavior varies by host; health timing remains useful. |
| Render log/debug workflow | Production investigation docs rely on Render logs. | Minor migration work | Replace with target log drain/query workflow. |
| `render.yaml` | Not present. | Unknown / missing IaC | No declarative Render config to migrate from; also means current Render setup is not fully reproducible from repo. |
| Persistent disks | No runtime file persistence was found. | Portable | Avoids Render disk coupling. |
| Internal Render networking | No hardcoded internal Render hostnames were found in code. | Portable | Production docs contain public Render URLs only. |

## Portability Classification

### Portable

- Vite static frontend build.
- Fastify backend runtime.
- Node process binding to `0.0.0.0:$PORT`.
- Prisma using standard PostgreSQL.
- `DATABASE_URL` connection-string model.
- Health/readiness endpoints.
- Stdout JSON-ish service logs.
- No local upload/storage dependency.
- No host-specific SDKs.
- No Render-only APIs in runtime paths.

### Minor Migration Work

- Recreate frontend/backend/database env vars on the target platform.
- Update `VITE_API_BASE_URL` and rebuild frontend.
- Update `CORS_ORIGIN` to include the new frontend origin.
- Update Shopify webhook base URLs and re-register subscriptions.
- Update production smoke docs and operator runbooks.
- Configure `prisma migrate deploy` in the target deploy flow.
- Establish backup/export/restore process for the new Postgres provider.
- Replace Render log inspection workflows with target log drains.
- Decide whether optional scheduled reconciliation should keep running in-process or move to a worker/cron.

### Strongly Provider-Coupled

No hard runtime coupling to Render APIs was found.

The strongest coupling is operational rather than code-level:

- production service definitions are not codified in the repo;
- env configuration appears dashboard-managed;
- docs and smoke checklists assume Render URLs/logs;
- backups and DB restore operations depend on Render Postgres process unless exported.

### Unknown

- Exact production Render build/start/pre-deploy commands are not represented in repo IaC.
- Whether Render Postgres uses direct connection or PgBouncer/pooler in production.
- Whether production backups are configured and restore-tested.
- Whether scheduled reconciliation is enabled in production.
- Whether any manual Render dashboard setting exists outside the documented env vars.

## Deployment Reproducibility Audit

| Question | Current Answer | Risk |
| --- | --- | --- |
| Can the frontend build independently? | Yes. `npm run build` creates static assets. | Low. |
| Can the backend build independently? | Yes. `npm run backend:build` compiles backend. | Low. |
| Can backend run locally from clean env? | Likely yes with `backend/.env.example`, Postgres, Prisma generate, migrations, and seed. | Medium because the repo has no one-command local bootstrap or Docker Compose. |
| Can DB migrate independently? | Yes, via `npm run backend:db:deploy`. | Low to medium; depends on target DB connectivity and migration discipline. |
| Is deployment deterministic? | Partially. CI validates build/test, but service definitions/env/deploy hooks are not codified. | Medium. |
| Are env vars documented? | Partially. `.env.example`, `backend/.env.example`, deployment checklist, and provider docs exist. | Medium due to env sprawl and provider-specific gates. |
| Are secrets centralized? | Runtime uses env vars. No repo-managed secret store abstraction. | Medium for migration operations, low for runtime portability. |
| Is there CI? | Yes, GitHub Actions runs install, Prisma generate, build, tests, backend build/typecheck, and backend smoke. | Low. |
| Is there CD/IaC? | Not found. | Medium. |

## Docker Readiness

No `Dockerfile`, `docker-compose.yml`, or container deployment manifests were found.

The app is close to Docker-ready because:

- backend is a standard Node process;
- frontend is a static build;
- database is external Postgres;
- runtime config is env-driven;
- health endpoints already exist.

Missing pieces before Docker is production-ready:

- Root and backend dependency install strategy for the monorepo.
- Prisma generate/migrate step placement.
- Multi-stage backend Dockerfile.
- Static frontend serving strategy, such as Nginx/Caddy or host-native static service.
- Local Docker Compose for app + Postgres development.
- Explicit non-root user and production image hardening.
- Container healthcheck calling `/health`.
- Decision on whether scheduled reconciliation runs in the web container or a separate worker.

Container concern:

- In-process scheduled reconciliation is acceptable for one web instance, but a multi-replica container deployment can run duplicate schedulers unless guarded by DB locks or moved to a single worker/cron.

## Database Portability

Current database portability is good because the system uses standard PostgreSQL through Prisma migrations.

Render Postgres to another PostgreSQL provider should be moderate difficulty:

1. Create target Postgres.
2. Export Render Postgres with provider backup/export tooling or `pg_dump`.
3. Restore into target Postgres.
4. Point backend `DATABASE_URL` to target.
5. Run `prisma migrate deploy`.
6. Verify `/health` and `/health/db`.
7. Run production smoke checks.
8. Re-register Shopify webhooks if backend origin changes.

Risks:

- No repo-managed backup/restore script.
- No documented restore rehearsal.
- No explicit connection-pooling strategy in code/docs.
- Prisma migrations are reliable, but health checks do not prove every local migration file was applied; the deployment checklist already calls this out.
- Provider snapshots and operational history live in Postgres, so DB migration correctness matters for auditability.

## Hosting Target Comparison

This is a qualitative fit assessment, not a pricing quote. Current pricing and plan limits should be checked again before any migration.

| Target | Fit For Current App | Operational Complexity | Cost Profile | Scaling Complexity | Maintenance Burden | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Railway | Strong short-term alternative. Node + Postgres workflow is close to current Render shape. | Low to medium | Usage/subscription based | Low to medium | Low | Good portability target if the team wants managed PaaS ergonomics without Docker-first ops. |
| Fly.io | Good if low-latency regional app deployment matters. | Medium | Resource-based | Medium | Medium | Requires more container/process thinking; Fly Postgres is documented as unmanaged, so DB ops need care. |
| Coolify | Good for self-hosted control on a VPS. | Medium to high | VPS cost plus time/ops | Medium | High | Best if cost control and ownership matter more than managed platform convenience. Dockerization becomes important. |
| VPS/Docker | Technically straightforward after Dockerization. | High | Usually lowest fixed infra cost | Medium to high | High | Requires backups, deploys, TLS, monitoring, log rotation, security patching, and database ops. |
| DigitalOcean App Platform | Good managed PaaS candidate. | Low to medium | Predictable app/database tiers | Low to medium | Low to medium | Similar mental model to Render; managed DB and static/app hosting are available. |
| Cloud Run | Good for containerized backend once Dockerized. | Medium | Pay-per-use/resource based | Medium | Medium | Requires container image, Cloud SQL/Postgres choice, env/secret setup, and cold-start/concurrency planning. |
| ECS/Fargate or Kubernetes | Overpowered for current maturity unless enterprise AWS standardization is required. | High | Resource-based, can grow quickly | High | High | Best after the app has clear worker, queue, observability, and infrastructure-as-code maturity. |

## Operational Risks

### Provider And Env Sprawl

Many provider gates and credentials are env-driven. This is portable, but migration risk grows as the env list grows.

Risk: missing one env var can silently disable an integration or make production startup fail.

Recommendation: create a canonical env inventory with required/optional, frontend/backend, production/staging/local, and owner columns.

### In-Process Scheduler

The optional scheduled reconciliation interval is process-local.

Risk: duplicate scheduler execution in multi-instance deployments, or no execution on platforms that scale to zero.

Recommendation: keep it disabled by default, and move scheduled work to a provider-independent worker/cron model before horizontal scaling.

### Manual Deploy Configuration

No `render.yaml`, Dockerfile, or other IaC was found.

Risk: production cannot be fully recreated from git.

Recommendation: document actual Render commands/envs now, then introduce provider-neutral Docker/Compose or minimal IaC when ready.

### Build-Time Frontend API URL

`VITE_API_BASE_URL` is baked into the frontend build.

Risk: backend origin changes require a frontend rebuild/redeploy.

Recommendation: acceptable for now; consider runtime-served config only if frequent backend origin swaps become operationally painful.

### Database Backup And Restore Confidence

Docs mention Render migration readiness, but no provider-independent backup/restore script was found.

Risk: DB migration under pressure may be slower and riskier than expected.

Recommendation: add a restore rehearsal checklist and export/restore runbook before changing providers.

### No Durable Queue Layer

Operational jobs are DB-backed, but execution is mostly synchronous or in-process.

Risk: scale-out, retries, and background work become harder when traffic grows.

Recommendation: keep `OperationalJob` as the compatibility boundary and introduce a queue/worker abstraction only when load or reliability proves it is needed.

## Future-Proofing Recommendations

### Phase A: Documentation And Reproducibility

- Create `docs/ENVIRONMENT_VARIABLES.md` with all frontend/backend envs.
- Record the actual Render build/start/pre-deploy commands.
- Record whether production uses direct Postgres or connection pooling.
- Add a DB backup/export/restore rehearsal checklist.
- Document Shopify webhook URL migration steps.
- Add a production migration dry-run checklist that is provider-neutral.

### Phase B: Container Readiness

- Add backend Dockerfile.
- Add frontend static Dockerfile or explicit static-host deployment recipe.
- Add `docker-compose.yml` for local app + Postgres bootstrap.
- Add container healthcheck.
- Add a `npm run backend:db:deploy && npm run backend:start` entrypoint pattern, with clear failure behavior.
- Verify Prisma generate/migrate behavior inside containers.

### Phase C: Background Work Boundary

- Keep `OperationalJob` as the durable job contract.
- Move scheduled reconciliation to one of:
  - dedicated worker process;
  - managed cron hitting an admin-safe endpoint;
  - queue worker with Redis/BullMQ or equivalent only when justified.
- Add DB locking or job leasing before running schedulers on multiple replicas.

### Phase D: Observability And Secrets

- Standardize request timing logs and health fields independent of Render.
- Add log drain guidance for the chosen platform.
- Move provider secrets into a managed secret store if the next platform supports it cleanly.
- Keep diagnostics redacted and vendor-safe.

## Recommended Migration Strategy

Do not migrate immediately just for portability. The app is portable enough to wait until cost, reliability, or operational constraints justify the work.

Recommended sequence:

1. Improve reproducibility while staying on Render.
2. Add provider-neutral env and DB migration docs.
3. Add Docker support.
4. Rehearse Postgres export/restore into a disposable target.
5. Choose next platform based on the actual pain:
   - cost and simplicity: Railway or DigitalOcean App Platform;
   - ownership/control: Coolify or VPS/Docker;
   - container/serverless posture: Cloud Run;
   - AWS standardization: ECS/Fargate;
   - regional edge needs: Fly.io.
6. Migrate staging first.
7. Re-register Shopify webhooks only after the new backend URL is stable.
8. Run full production smoke before switching traffic.

## Current Portability Verdict

Overall portability: good.

Main blockers are not hard Render APIs. The blockers are operational reproducibility, environment inventory, DB backup/restore confidence, and the in-process scheduler model.

If the team documents envs and deployment commands, rehearses Postgres restore, and adds Docker, the system should be able to move away from Render with moderate effort.

## External References Checked

- Render health checks: https://render.com/docs/health-checks
- Render environment variables: https://render.com/docs/environment-variables
- Render Postgres: https://render.com/docs/postgresql
- Render Postgres backups: https://render.com/docs/postgresql-backups
- Railway pricing/plans: https://docs.railway.com/reference/pricing/plans
- Railway PostgreSQL: https://docs.railway.com/guides/postgresql
- Fly deploy docs: https://fly.io/docs/apps/deploy/
- Fly Postgres docs: https://fly.io/docs/postgres/
- Coolify quickstart: https://www.coolify.io/docs/quickstart
- DigitalOcean App Platform pricing: https://docs.digitalocean.com/products/app-platform/details/pricing/
- Google Cloud Run overview: https://docs.cloud.google.com/run/docs/overview/what-is-cloud-run
- Google Cloud Run container contract: https://docs.cloud.google.com/run/docs/container-contract
- AWS ECS pricing: https://aws.amazon.com/ecs/pricing/
