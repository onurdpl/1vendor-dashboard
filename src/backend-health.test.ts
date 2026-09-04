import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../backend/src/app';

const queryRawMock = vi.hoisted(() => vi.fn());

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: {
    $queryRaw: queryRawMock,
  },
}));

describe('backend deployment health endpoint', () => {
  afterEach(() => {
    queryRawMock.mockReset();
    vi.unstubAllEnvs();
  });

  function stubProductionEnv() {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CORS_ORIGIN', 'https://vendor.example.com');
    vi.stubEnv('JWT_SECRET', 'production-jwt-secret');
    vi.stubEnv('SHOPIFY_WEBHOOK_SECRET', 'production-shopify-webhook-secret');
    vi.stubEnv('SHOPIFY_SHOP_DOMAIN', 'shop.example.com');
    vi.stubEnv('SHOPIFY_ADMIN_ACCESS_TOKEN', 'production-shopify-admin-token');
    vi.stubEnv('SHIPPING_PROVIDER', 'kargonomi');
    vi.stubEnv('KARGONOMI_BASE_URL', 'https://kargonomi.example.com');
    vi.stubEnv('KARGONOMI_API_TOKEN', 'production-kargonomi-token');
    vi.stubEnv('DATABASE_URL', 'postgresql://db_user:db_password@db.example.com:5432/vendor_dashboard');
  }

  function stubTestEnv() {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('SHIPPING_PROVIDER', 'kargonomi');
    vi.stubEnv('KARGONOMI_BASE_URL', 'https://kargonomi.test.example.com');
    vi.stubEnv('KARGONOMI_API_TOKEN', 'test-kargonomi-token');
  }

  const requiredSchemaRows = [
    { table_name: 'ShopifyOrder', column_name: 'customerPhone' },
    { table_name: 'ReturnRecord', column_name: 'returnProvider' },
    { table_name: 'ReturnRecord', column_name: 'returnProviderShipmentId' },
    { table_name: 'ReturnRecord', column_name: 'returnLabel' },
    { table_name: 'ReturnRecord', column_name: 'returnReferenceId' },
    { table_name: 'ReturnRecord', column_name: 'navlungoReturnCreatedAt' },
    { table_name: 'ReturnRecord', column_name: 'returnProviderSnapshot' },
    { table_name: 'AllocationFullRefundTerminalFact', column_name: 'vendorAllocationId' },
  ];

  it('returns safe runtime health metadata without exposing environment values', async () => {
    stubTestEnv();
    const app = createApp();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        ok: true,
        service: 'vendor-dashboard-backend',
        version: expect.any(String),
        environment: expect.any(String),
        timestamp: expect.any(String),
        uptimeSeconds: expect.any(Number),
        coldStartAgeSeconds: expect.any(Number),
        dbReachable: expect.any(Boolean),
        migrationsReachable: expect.any(Boolean),
      });
      expect(response.json()).toHaveProperty('dbPingMs');
      expect(response.json()).toHaveProperty('databaseSource');
      expect(response.json()).toHaveProperty('financeAuditMetadata');
      expect(typeof response.json().dbPingMs === 'number' || response.json().dbPingMs === null).toBe(true);
      expect(response.json().financeAuditMetadata).toMatchObject({
        environment: expect.any(String),
        schemaReady: expect.any(Boolean),
      });
      expect(response.json().databaseSource).toEqual(
        expect.objectContaining({
          databaseSourceLabel: expect.any(String),
          duplicateDatabaseUrlDefinitionsDetected: expect.any(Boolean),
          databaseUrlDefinitionCount: expect.any(Number),
          warnings: expect.any(Array),
        }),
      );
      expect(['ok', 'degraded']).toContain(response.json().status);
      expect(JSON.stringify(response.json())).not.toContain('DATABASE_URL');
      expect(JSON.stringify(response.json())).not.toContain('postgresql://');
      expect(JSON.stringify(response.json())).not.toContain('JWT_SECRET');
    } finally {
      await app.close();
    }
  });

  it('returns minimal public health in production without DB, schema, or env diagnostics', async () => {
    stubProductionEnv();
    const app = createApp();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });
      const payload = response.json();

      expect(response.statusCode).toBe(200);
      expect(payload).toEqual({
        ok: true,
        status: 'ok',
        timestamp: expect.any(String),
      });
      expect(JSON.stringify(payload)).not.toContain('db.example.com');
      expect(payload).not.toHaveProperty('dbReachable');
      expect(payload).not.toHaveProperty('dbPingMs');
      expect(payload).not.toHaveProperty('schemaReady');
      expect(payload).not.toHaveProperty('missingColumns');
      expect(payload).not.toHaveProperty('databaseSource');
      expect(payload).not.toHaveProperty('financeAuditMetadata');
      expect(payload).not.toHaveProperty('environment');
      expect(payload).not.toHaveProperty('gitCommit');
    } finally {
      await app.close();
    }
  });

  it('returns minimal public database health in production without topology or schema diagnostics', async () => {
    stubProductionEnv();
    const app = createApp();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/health/db',
      });
      const payload = response.json();

      expect(response.statusCode).toBe(200);
      expect(payload).toEqual({
        ok: true,
        status: 'ok',
        timestamp: expect.any(String),
      });
      expect(JSON.stringify(payload)).not.toContain('db.example.com');
      expect(payload).not.toHaveProperty('databaseSource');
      expect(payload).not.toHaveProperty('schemaReady');
      expect(payload).not.toHaveProperty('missingColumns');
      expect(payload).not.toHaveProperty('financeAuditMetadata');
    } finally {
      await app.close();
    }
  });

  it('degrades database health when the full-refund terminal fact schema is missing', async () => {
    stubTestEnv();
    vi.stubEnv('DATABASE_URL', 'postgresql://test:test@localhost:5432/vendor_dashboard_test');
    queryRawMock
      .mockResolvedValueOnce([{ '?column?': 1 }])
      .mockResolvedValueOnce(requiredSchemaRows.slice(0, -1))
      .mockResolvedValueOnce([{ count: 1 }]);
    const app = createApp();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        status: 'degraded',
        schemaReady: false,
        requiredColumnCount: 8,
        missingColumns: [
          {
            tableName: 'AllocationFullRefundTerminalFact',
            columnName: 'vendorAllocationId',
            expectedMigration: '20260904120000_add_allocation_full_refund_terminal_fact',
          },
        ],
      });
    } finally {
      await app.close();
    }
  });

  it('reports schema readiness when the full-refund terminal fact schema is present', async () => {
    stubTestEnv();
    vi.stubEnv('DATABASE_URL', 'postgresql://test:test@localhost:5432/vendor_dashboard_test');
    queryRawMock
      .mockResolvedValueOnce([{ '?column?': 1 }])
      .mockResolvedValueOnce(requiredSchemaRows)
      .mockResolvedValueOnce([{ count: 1 }]);
    const app = createApp();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        status: 'ok',
        schemaReady: true,
        requiredColumnCount: 8,
        missingColumns: [],
      });
    } finally {
      await app.close();
    }
  });

  it('returns ready when the database readiness ping succeeds', async () => {
    stubProductionEnv();
    queryRawMock.mockResolvedValueOnce([{ '?column?': 1 }]);
    const app = createApp();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/ready',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        status: 'ready',
      });
      expect(queryRawMock).toHaveBeenCalledOnce();
    } finally {
      await app.close();
    }
  });

  it('returns not ready without exposing raw database error details when the ping fails', async () => {
    stubProductionEnv();
    queryRawMock.mockRejectedValueOnce(new Error('postgresql://db_user:db_password@db.example.com:5432/vendor_dashboard failed'));
    const app = createApp();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/ready',
      });
      const payload = response.json();

      expect(response.statusCode).toBe(503);
      expect(payload).toMatchObject({
        status: 'not_ready',
      });
      expect(payload.requestId).toEqual(expect.any(String));
      expect(response.body).not.toContain('postgresql://');
      expect(response.body).not.toContain('db_password');
      expect(response.body).not.toContain('db.example.com');
      expect(response.body).not.toContain('failed');
      expect(queryRawMock).toHaveBeenCalledOnce();
    } finally {
      await app.close();
    }
  });

  it('returns not ready when DATABASE_URL is absent', async () => {
    stubTestEnv();
    vi.stubEnv('DATABASE_URL', '');
    queryRawMock.mockRejectedValueOnce(new Error('Database is not configured.'));
    const app = createApp();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/ready',
      });

      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({ status: 'not_ready' });
    } finally {
      await app.close();
    }
  });
});
