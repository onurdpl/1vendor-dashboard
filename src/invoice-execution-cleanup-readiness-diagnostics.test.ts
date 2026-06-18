import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppEnv } from '../backend/src/config/env.js';

const prismaMock = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  invoiceExecution: {
    aggregate: vi.fn(),
    groupBy: vi.fn(),
  },
}));

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: prismaMock,
}));

const { getInvoiceExecutionCleanupReadiness } = await import(
  '../backend/src/modules/diagnostics/diagnostics.service.js'
);
const { registerDiagnosticsRoutes } = await import('../backend/src/modules/diagnostics/diagnostics.routes.js');

function buildEnv(overrides: Partial<AppEnv> = {}): AppEnv {
  return {
    NODE_ENV: 'test',
    PORT: 4000,
    DATABASE_URL: 'postgresql://postgres:postgres@db.example.internal:5432/vendor_dashboard_h8fb',
    CORS_ORIGIN: [],
    JWT_SECRET: 'unused',
    JWT_EXPIRES_IN: '12h',
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
    INVOICE_EXECUTION_ENABLED: false,
    INVOICE_PROVIDER: 'bizimhesap',
    BIZIMHESAP_ENABLED: false,
    SHIPPING_EXECUTION_ENABLED: false,
    SHIPPING_SANDBOX_MODE: false,
    SHIPPING_PROVIDER: 'kargonomi',
    KARGO_ENTEGRATOR_ENABLED: false,
    KARGO_ENTEGRATOR_WEBHOOK_INGEST_ENABLED: false,
    TRY_OTO_ENABLED: false,
    TRY_OTO_SANDBOX_MODE: false,
    TRY_OTO_WEBHOOK_INGEST_ENABLED: false,
    PARATIKA_MARKETPLACE_MODEL: 'SELLER_COMMISSION_RATE',
    ...overrides,
  };
}

function mockSchemaReady() {
  prismaMock.$queryRaw.mockResolvedValue([
    { column_name: 'id' },
    { column_name: 'provider' },
    { column_name: 'status' },
    { column_name: 'createdAt' },
  ]);
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

function buildReply() {
  return {
    code: vi.fn((status: number) => ({
      send: vi.fn((body: unknown) => ({ status, body })),
    })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSchemaReady();
});

describe('InvoiceExecution cleanup readiness diagnostic', () => {
  it('returns READY_TO_REMOVE when no InvoiceExecution rows exist', async () => {
    prismaMock.invoiceExecution.aggregate.mockResolvedValue({
      _count: { _all: 0 },
      _min: { createdAt: null },
      _max: { createdAt: null },
    });
    prismaMock.invoiceExecution.groupBy.mockResolvedValue([]);

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
      totalInvoiceExecutionRows: 0,
      countsByProviderStatus: [],
      oldestCreatedAt: null,
      newestCreatedAt: null,
      rowsExist: false,
      cleanupReadiness: 'READY_TO_REMOVE',
      error: null,
    });
  });

  it('groups rows by provider and status and returns ARCHIVE_REQUIRED', async () => {
    const oldest = new Date('2026-01-01T00:00:00.000Z');
    const newest = new Date('2026-06-01T00:00:00.000Z');
    prismaMock.invoiceExecution.aggregate.mockResolvedValue({
      _count: { _all: 3 },
      _min: { createdAt: oldest },
      _max: { createdAt: newest },
    });
    prismaMock.invoiceExecution.groupBy.mockResolvedValue([
      { provider: 'BIZIMHESAP', status: 'FAILED', _count: { _all: 1 } },
      { provider: 'BIZIMHESAP', status: 'PENDING', _count: { _all: 2 } },
    ]);

    const result = await getInvoiceExecutionCleanupReadiness(buildEnv());

    expect(result).toMatchObject({
      ok: true,
      totalInvoiceExecutionRows: 3,
      countsByProviderStatus: [
        { provider: 'BIZIMHESAP', status: 'FAILED', count: 1 },
        { provider: 'BIZIMHESAP', status: 'PENDING', count: 2 },
      ],
      oldestCreatedAt: '2026-01-01T00:00:00.000Z',
      newestCreatedAt: '2026-06-01T00:00:00.000Z',
      rowsExist: true,
      cleanupReadiness: 'ARCHIVE_REQUIRED',
    });
  });

  it('returns UNKNOWN when the query fails', async () => {
    prismaMock.invoiceExecution.aggregate.mockRejectedValue(new Error('relation "InvoiceExecution" does not exist'));
    prismaMock.invoiceExecution.groupBy.mockResolvedValue([]);

    const result = await getInvoiceExecutionCleanupReadiness(buildEnv());

    expect(result).toMatchObject({
      ok: false,
      totalInvoiceExecutionRows: null,
      countsByProviderStatus: [],
      oldestCreatedAt: null,
      newestCreatedAt: null,
      rowsExist: null,
      cleanupReadiness: 'UNKNOWN',
      error: 'relation "InvoiceExecution" does not exist',
    });
  });

  it('does not expose provider request or response snapshot bodies', async () => {
    prismaMock.invoiceExecution.aggregate.mockResolvedValue({
      _count: { _all: 1 },
      _min: { createdAt: new Date('2026-01-01T00:00:00.000Z') },
      _max: { createdAt: new Date('2026-01-01T00:00:00.000Z') },
    });
    prismaMock.invoiceExecution.groupBy.mockResolvedValue([
      { provider: 'BIZIMHESAP', status: 'CREATED', _count: { _all: 1 } },
    ]);

    const result = await getInvoiceExecutionCleanupReadiness(buildEnv());
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain('requestSnapshot');
    expect(serialized).not.toContain('responseSnapshot');
    expect(serialized).not.toContain('body');
  });

  it('requires admin access on the cleanup readiness route', async () => {
    const handler = registerCleanupRoute(buildEnv());
    const result = await handler?.({ authUser: { role: 'vendor' } }, buildReply());

    expect(result).toMatchObject({
      status: 403,
      body: { message: 'Forbidden' },
    });
    expect(prismaMock.invoiceExecution.aggregate).not.toHaveBeenCalled();
  });

  it('returns cleanup readiness through the admin diagnostic route', async () => {
    prismaMock.invoiceExecution.aggregate.mockResolvedValue({
      _count: { _all: 0 },
      _min: { createdAt: null },
      _max: { createdAt: null },
    });
    prismaMock.invoiceExecution.groupBy.mockResolvedValue([]);
    const handler = registerCleanupRoute(buildEnv());

    const result = await handler?.({ authUser: { role: 'admin' } }, buildReply());

    expect(result).toMatchObject({
      cleanupReadiness: 'READY_TO_REMOVE',
      writesPerformed: false,
      totalInvoiceExecutionRows: 0,
    });
  });
});
