import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../backend/src/app';

describe('backend deployment health endpoint', () => {
  afterEach(() => {
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
});
