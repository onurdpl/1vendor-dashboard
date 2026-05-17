import { describe, expect, it } from 'vitest';
import { createApp } from '../backend/src/app';

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
});
