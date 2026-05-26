import { describe, expect, it } from 'vitest';
import {
  createSafeRequestTimingLog,
  getPayloadSize,
  getSafeRouteName,
  shouldLogRequestTiming,
} from '../backend/src/lib/request-timing';

describe('backend request timing instrumentation', () => {
  it('uses Fastify route patterns instead of raw URLs with ids', () => {
    const routeName = getSafeRouteName({
      method: 'GET',
      routeOptions: {
        url: '/orders/:orderId',
      },
    } as never);

    expect(routeName).toBe('GET /orders/:orderId');
    expect(routeName).not.toContain('order-1054');
    expect(routeName).not.toContain('@');
  });

  it('limits timing logs to production dashboard routes', () => {
    expect(shouldLogRequestTiming('POST /auth/login')).toBe(true);
    expect(shouldLogRequestTiming('GET /orders')).toBe(true);
    expect(shouldLogRequestTiming('GET /returns/:returnId')).toBe(true);
    expect(shouldLogRequestTiming('GET /notifications')).toBe(true);
    expect(shouldLogRequestTiming('GET /signals')).toBe(true);
    expect(shouldLogRequestTiming('GET /admin/diagnostics/reconciliation')).toBe(true);
    expect(shouldLogRequestTiming('GET /admin/operations/attention')).toBe(true);
    expect(shouldLogRequestTiming('POST /shipments/:id/retry')).toBe(false);
    expect(shouldLogRequestTiming('POST /webhooks/shopify/orders-create')).toBe(false);
  });

  it('creates a safe timing log without query strings or payload values', () => {
    const log = createSafeRequestTimingLog({
      routeName: 'GET /returns/:returnId',
      method: 'get',
      statusCode: 200,
      elapsedMs: 42.4,
      responseBytes: 512,
    });

    expect(log).toEqual({
      routeName: 'GET /returns/:returnId',
      method: 'GET',
      statusCode: 200,
      elapsedMs: 42,
      responseBytes: 512,
    });
    expect(JSON.stringify(log)).not.toContain('return-request-');
    expect(JSON.stringify(log)).not.toContain('customer');
  });

  it('measures response payload size without inspecting content', () => {
    expect(getPayloadSize('{"ok":true}')).toBe(11);
    expect(getPayloadSize(Buffer.from('ok'))).toBe(2);
    expect(getPayloadSize({ ok: true })).toBeNull();
  });
});
