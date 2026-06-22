import { describe, expect, it, vi } from 'vitest';
import type { AppEnv } from '../backend/src/config/env.js';

const {
  getInvoiceExecutionArchiveDiagnostic,
  getInvoiceExecutionCleanupReadiness,
} = await import('../backend/src/modules/diagnostics/diagnostics.service.js');
const { registerDiagnosticsRoutes } = await import('../backend/src/modules/diagnostics/diagnostics.routes.js');

function buildEnv(overrides: Partial<AppEnv> = {}): AppEnv {
  return {
    NODE_ENV: 'test',
    PORT: 4000,
    DATABASE_URL: 'postgresql://postgres:postgres@db.example.internal:5432/vendor_dashboard_h8fb',
    CORS_ORIGIN: [],
    JWT_SECRET: 'unused',
    JWT_EXPIRES_IN: '12h',
    LOGIN_RATE_LIMIT_MAX_ATTEMPTS: 10,
    LOGIN_RATE_LIMIT_WINDOW_SECONDS: 600,
    SHOPIFY_WEBHOOK_SECRET: 'unused',
    SHOPIFY_API_VERSION: '2026-01',
    SHOPIFY_SELLER_INFO_RETRY_DELAY_MS: 25,
    SCHEDULED_RECONCILIATION_ENABLED: false,
    SCHEDULED_RECONCILIATION_EXECUTE_DUE: false,
    SCHEDULED_RECONCILIATION_INTERVAL_MS: 1800000,
    SCHEDULED_RECONCILIATION_COOLDOWN_MS: 1800000,
    SCHEDULED_RECONCILIATION_CANDIDATE_LIMIT: 25,
    EMAIL_NOTIFICATIONS_ENABLED: false,
    EMAIL_PROVIDER: 'noop',
    EMAIL_ADMIN_RECIPIENTS: [],
    SHIPPING_EXECUTION_ENABLED: false,
    SHIPPING_SANDBOX_MODE: false,
    SHIPPING_PROVIDER: 'kargonomi',
    KARGO_ENTEGRATOR_ENABLED: false,
    KARGO_ENTEGRATOR_WEBHOOK_INGEST_ENABLED: false,
    TRY_OTO_ENABLED: false,
    TRY_OTO_SANDBOX_MODE: false,
    TRY_OTO_WEBHOOK_INGEST_ENABLED: false,
    ...overrides,
  };
}

function buildReply() {
  return {
    code: vi.fn((status: number) => ({
      send: vi.fn((body: unknown) => ({ status, body })),
    })),
  };
}

function registerCleanupRoute(env: AppEnv) {
  const gets = new Map<
    string,
    (request: { authUser?: { role?: string } }, reply: ReturnType<typeof buildReply>) => unknown
  >();
  const app = {
    get: vi.fn((path: string, ...args: unknown[]) => {
      const handler = args.at(-1) as (
        request: { authUser?: { role?: string } },
        reply: ReturnType<typeof buildReply>,
      ) => unknown;
      gets.set(path, handler);
    }),
    post: vi.fn(),
  };
  registerDiagnosticsRoutes(app as never, env);
  return gets.get('/admin/diagnostics/cleanup/invoice-execution-readiness');
}

function registerArchiveRoute(env: AppEnv) {
  const gets = new Map<
    string,
    (request: { authUser?: { role?: string } }, reply: ReturnType<typeof buildReply>) => unknown
  >();
  const app = {
    get: vi.fn((path: string, ...args: unknown[]) => {
      const handler = args.at(-1) as (
        request: { authUser?: { role?: string } },
        reply: ReturnType<typeof buildReply>,
      ) => unknown;
      gets.set(path, handler);
    }),
    post: vi.fn(),
  };
  registerDiagnosticsRoutes(app as never, env);
  return gets.get('/admin/diagnostics/cleanup/invoice-execution-archive');
}

describe('InvoiceExecution cleanup diagnostics after C4 removal', () => {
  it('reports cleanup readiness as REMOVED without querying removed schema', async () => {
    const result = await getInvoiceExecutionCleanupReadiness(buildEnv());

    expect(result).toMatchObject({
      ok: true,
      writesPerformed: false,
      databaseIdentity: {
        databaseHost: 'db.example.internal',
        databaseName: 'vendor_dashboard_h8fb',
        databaseSourceLabel: 'remote',
        schemaReady: true,
      },
      schemaRemoved: true,
      totalInvoiceExecutionRows: null,
      countsByProviderStatus: [],
      oldestCreatedAt: null,
      newestCreatedAt: null,
      rowsExist: false,
      cleanupReadiness: 'REMOVED',
      archiveRequired: false,
      error: null,
    });
    expect(result.message).toContain('removed in C4');
  });

  it('reports archive diagnostic as NOT_APPLICABLE after schema removal', async () => {
    const result = await getInvoiceExecutionArchiveDiagnostic(buildEnv());

    expect(result).toMatchObject({
      ok: true,
      writesPerformed: false,
      schemaRemoved: true,
      archiveMetadata: {
        totalRows: 0,
        writesPerformed: false,
      },
      archiveStatus: 'NOT_APPLICABLE',
      rows: [],
      error: null,
    });
    expect(typeof result.archiveMetadata.generatedAt).toBe('string');
  });

  it('does not expose archived request or response snapshot bodies', async () => {
    const result = await getInvoiceExecutionArchiveDiagnostic(buildEnv());
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain('requestSnapshot');
    expect(serialized).not.toContain('responseSnapshot');
    expect(serialized).not.toContain('AddInvoice');
    expect(serialized).not.toContain('ApiKey');
  });

  it('requires admin access on the cleanup readiness route', async () => {
    const handler = registerCleanupRoute(buildEnv());
    const result = await handler?.({ authUser: { role: 'vendor' } }, buildReply());

    expect(result).toMatchObject({
      status: 403,
      body: { message: 'Forbidden' },
    });
  });

  it('requires admin access on the archive route', async () => {
    const handler = registerArchiveRoute(buildEnv());
    const result = await handler?.({ authUser: { role: 'vendor' } }, buildReply());

    expect(result).toMatchObject({
      status: 403,
      body: { message: 'Forbidden' },
    });
  });

  it('returns removed readiness through the admin diagnostic route', async () => {
    const handler = registerCleanupRoute(buildEnv());
    const result = await handler?.({ authUser: { role: 'admin' } }, buildReply());

    expect(result).toMatchObject({
      cleanupReadiness: 'REMOVED',
      writesPerformed: false,
      schemaRemoved: true,
    });
  });
});
