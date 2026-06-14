import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../backend/src/app';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('backend request id diagnostics', () => {
  it('propagates a safe request id header and error response field', async () => {
    const app = createApp();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/orders',
        headers: {
          'x-request-id': 'req-test-123',
        },
      });

      expect(response.statusCode).toBeGreaterThanOrEqual(400);
      expect(response.headers['x-request-id']).toBe('req-test-123');
      expect(response.json()).toMatchObject({
        requestId: 'req-test-123',
      });
    } finally {
      await app.close();
    }
  });

  it('echoes a safe auth attempt id header on login validation failures', async () => {
    const app = createApp();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        headers: {
          'x-auth-attempt-id': 'auth-test123',
        },
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      expect(response.headers['x-auth-attempt-id']).toBe('auth-test123');
      expect(response.body).not.toContain('token');
      expect(response.body).not.toContain('@');
    } finally {
      await app.close();
    }
  });

  it('allows credentialed CORS requests from an exact configured frontend origin', async () => {
    const app = createApp();

    try {
      const response = await app.inject({
        method: 'OPTIONS',
        url: '/auth/me',
        headers: {
          origin: 'http://localhost:5173',
          'access-control-request-method': 'GET',
        },
      });

      expect(response.statusCode).toBe(204);
      expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
      expect(response.headers['access-control-allow-credentials']).toBe('true');
    } finally {
      await app.close();
    }
  });

  it('allows auth attempt id on login CORS preflight requests', async () => {
    const app = createApp();

    try {
      const response = await app.inject({
        method: 'OPTIONS',
        url: '/auth/login',
        headers: {
          origin: 'http://localhost:5173',
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'content-type,x-auth-attempt-id',
        },
      });

      expect(response.statusCode).toBe(204);
      expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
      expect(response.headers['access-control-allow-credentials']).toBe('true');
      expect(String(response.headers['access-control-allow-headers']).toLowerCase()).toContain('x-auth-attempt-id');
    } finally {
      await app.close();
    }
  });

  it('allows credentialed CORS requests from the configured Render frontend origin', async () => {
    vi.stubEnv('CORS_ORIGIN', 'https://onevendor-dashboard.onrender.com');
    const app = createApp();

    try {
      const response = await app.inject({
        method: 'OPTIONS',
        url: '/auth/me',
        headers: {
          origin: 'https://onevendor-dashboard.onrender.com',
          'access-control-request-method': 'GET',
        },
      });

      expect(response.statusCode).toBe(204);
      expect(response.headers['access-control-allow-origin']).toBe('https://onevendor-dashboard.onrender.com');
      expect(response.headers['access-control-allow-credentials']).toBe('true');
    } finally {
      await app.close();
    }
  });
});
