import { describe, expect, it } from 'vitest';
import { createApp } from '../backend/src/app';

describe('backend deployment health endpoint', () => {
  it('returns safe runtime health metadata without exposing environment values', async () => {
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
        dbReachable: expect.any(Boolean),
        migrationsReachable: expect.any(Boolean),
      });
      expect(['ok', 'degraded']).toContain(response.json().status);
      expect(JSON.stringify(response.json())).not.toContain('DATABASE_URL');
      expect(JSON.stringify(response.json())).not.toContain('postgresql://');
      expect(JSON.stringify(response.json())).not.toContain('JWT_SECRET');
    } finally {
      await app.close();
    }
  });
});
