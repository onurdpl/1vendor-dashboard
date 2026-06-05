import { describe, expect, it, vi } from 'vitest';
import { registerPaymentReturnRoutes } from '../backend/src/modules/payments/payment-return.routes.js';

function buildReply() {
  const reply = {
    statusCode: 200,
    payload: undefined as unknown,
    code: vi.fn((status: number) => {
      reply.statusCode = status;
      return reply;
    }),
    send: vi.fn((payload: unknown) => {
      reply.payload = payload;
      return payload;
    }),
  };

  return reply;
}

function registerRoutes() {
  const routes = new Map<string, (request: Record<string, unknown>, reply: ReturnType<typeof buildReply>) => Promise<unknown>>();
  const parsers = new Map<string, unknown>();
  const app = {
    addContentTypeParser: vi.fn((contentType: string, _options: unknown, parser: unknown) => {
      parsers.set(contentType, parser);
    }),
    get: vi.fn((path: string, handler: (request: Record<string, unknown>, reply: ReturnType<typeof buildReply>) => Promise<unknown>) => {
      routes.set(`GET ${path}`, handler);
    }),
    post: vi.fn((path: string, handler: (request: Record<string, unknown>, reply: ReturnType<typeof buildReply>) => Promise<unknown>) => {
      routes.set(`POST ${path}`, handler);
    }),
  };

  registerPaymentReturnRoutes(app as never);
  return { routes, parsers };
}

function expectNoSensitiveValues(value: unknown) {
  const serialized = JSON.stringify(value);

  expect(serialized).not.toContain('4111111111111111');
  expect(serialized).not.toContain('123');
  expect(serialized).not.toContain('secret-session-token');
  expect(serialized).not.toContain('merchant-password-secret');
}

describe('Paratika payment return route skeleton', () => {
  it('accepts GET returns without mutating payment or Shopify state', async () => {
    const { routes } = registerRoutes();
    const handler = routes.get('GET /payments/paratika/return');
    const logInfo = vi.fn();
    const reply = buildReply();

    const result = await handler?.(
      {
        method: 'GET',
        requestId: 'request-1',
        query: {
          order: 'order-100',
          cardNumber: '4111111111111111',
          token: 'secret-session-token',
        },
        body: undefined,
        log: { info: logInfo },
      },
      reply,
    );

    expect(reply.statusCode).toBe(202);
    expect(result).toEqual({
      ok: true,
      provider: 'PARATIKA',
      message: 'Payment return received. Verification pending.',
      verificationStatus: 'pending',
      writesPerformed: false,
      paymentStateMutated: false,
      shopifyMutationAttempted: false,
      paratikaApiCallAttempted: false,
      ignoredParameterCount: 3,
    });
    expect(logInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'PARATIKA',
        route: '/payments/paratika/return',
        method: 'GET',
        queryKeyCount: 3,
        bodyKeyCount: 0,
        sensitiveKeyCount: 2,
        paymentStateMutated: false,
        shopifyMutationAttempted: false,
        paratikaApiCallAttempted: false,
      }),
      'Paratika payment return placeholder received.',
    );
    expectNoSensitiveValues(result);
    expectNoSensitiveValues(logInfo.mock.calls);
  });

  it('accepts POST returns while ignoring unknown params safely', async () => {
    const { routes } = registerRoutes();
    const handler = routes.get('POST /payments/paratika/return');
    const logInfo = vi.fn();
    const reply = buildReply();

    const result = await handler?.(
      {
        method: 'POST',
        requestId: 'request-2',
        query: { unknown: 'ignored' },
        body: {
          responseCode: '00',
          merchantPassword: 'merchant-password-secret',
          cvv: '123',
        },
        log: { info: logInfo },
      },
      reply,
    );

    expect(reply.statusCode).toBe(202);
    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        writesPerformed: false,
        paymentStateMutated: false,
        shopifyMutationAttempted: false,
        paratikaApiCallAttempted: false,
        ignoredParameterCount: 4,
      }),
    );
    expect(logInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        queryKeyCount: 1,
        bodyKeyCount: 3,
        sensitiveKeyCount: 2,
      }),
      'Paratika payment return placeholder received.',
    );
    expectNoSensitiveValues(result);
    expectNoSensitiveValues(logInfo.mock.calls);
  });

  it('registers a form parser for provider POST callbacks', () => {
    const { parsers } = registerRoutes();

    expect(parsers.has('application/x-www-form-urlencoded')).toBe(true);
  });
});
