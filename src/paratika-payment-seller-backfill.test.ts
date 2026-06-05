import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppEnv } from '../backend/src/config/env.js';

const seedVendorPaymentSellerMappingsMock = vi.hoisted(() => vi.fn());
const buildParatikaSessionTokenPayloadPreviewForOrderMock = vi.hoisted(() => vi.fn());

vi.mock('../backend/src/modules/payments/vendor-payment-seller.service.js', () => ({
  CONFIRMED_VENDOR_PAYMENT_SELLERS: [
    {
      vendorId: 'sporjinal',
      provider: 'PARATIKA',
      externalSellerId: '100003585',
    },
    {
      vendorId: 'yalispor',
      provider: 'PARATIKA',
      externalSellerId: '100003586',
    },
  ],
  seedVendorPaymentSellerMappings: seedVendorPaymentSellerMappingsMock,
}));

vi.mock('../backend/src/modules/paratika/paratika-sessiontoken-payload.service.js', () => ({
  buildParatikaSessionTokenPayloadPreviewForOrder: buildParatikaSessionTokenPayloadPreviewForOrderMock,
}));

const { registerParatikaProbeRoutes } = await import('../backend/src/modules/paratika/paratika-probe.routes.js');

function buildAppEnv() {
  return {
    JWT_SECRET: 'test-secret',
    JWT_EXPIRES_IN: '1h',
  } as AppEnv;
}

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

function registerBackfillRoute(method: 'get' | 'post' = 'post') {
  let handler:
    | ((request: { authUser?: { role?: string } }, reply: ReturnType<typeof buildReply>) => Promise<unknown>)
    | null = null;
  const captureHandler = (path: string, ...args: unknown[]) => {
    if (path === '/admin/probes/paratika/payment-seller-mappings/backfill') {
      handler = args.at(-1) as typeof handler;
    }
  };
  const app = {
    get: vi.fn(method === 'get' ? captureHandler : undefined),
    post: vi.fn(method === 'post' ? captureHandler : undefined),
  };

  registerParatikaProbeRoutes(app as never, buildAppEnv());
  return handler;
}

function expectNoSecrets(value: unknown) {
  const serialized = JSON.stringify(value).toLowerCase();

  expect(serialized).not.toContain('merchantpassword');
  expect(serialized).not.toContain('merchantuser');
  expect(serialized).not.toContain('client_secret');
  expect(serialized).not.toContain('password');
  expect(serialized).not.toContain('access_token');
  expect(serialized).not.toContain('refresh_token');
}

describe('Paratika payment seller mapping backfill probe', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  it('rejects non-admin users', async () => {
    process.env.ADMIN_PROBES_ENABLED = 'true';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const handler = registerBackfillRoute();
    const reply = buildReply();

    const result = await handler?.({ authUser: { role: 'vendor' } }, reply);

    expect(reply.statusCode).toBe(403);
    expect(result).toEqual({ message: 'Forbidden' });
    expect(seedVendorPaymentSellerMappingsMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects admin users when admin probes are disabled', async () => {
    process.env.ADMIN_PROBES_ENABLED = 'false';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const handler = registerBackfillRoute();
    const reply = buildReply();

    const result = await handler?.({ authUser: { role: 'admin' } }, reply);

    expect(reply.statusCode).toBe(403);
    expect(result).toEqual({ ok: false, message: 'Admin probe endpoints are disabled.' });
    expect(seedVendorPaymentSellerMappingsMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('upserts both confirmed mappings without calling Paratika', async () => {
    process.env.ADMIN_PROBES_ENABLED = 'true';
    seedVendorPaymentSellerMappingsMock.mockResolvedValue(undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const handler = registerBackfillRoute();
    const reply = buildReply();

    const result = await handler?.({ authUser: { role: 'admin' } }, reply);

    expect(reply.statusCode).toBe(200);
    expect(result).toEqual({
      ok: true,
      writesPerformed: true,
      provider: 'PARATIKA',
      upserted: [
        { vendorId: 'sporjinal', externalSellerId: '100003585', enabled: true },
        { vendorId: 'yalispor', externalSellerId: '100003586', enabled: true },
      ],
    });
    expect(seedVendorPaymentSellerMappingsMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(buildParatikaSessionTokenPayloadPreviewForOrderMock).not.toHaveBeenCalled();
    expectNoSecrets(result);
  });

  it('allows the temporary GET backfill path for manual diagnostics', async () => {
    process.env.ADMIN_PROBES_ENABLED = 'true';
    seedVendorPaymentSellerMappingsMock.mockResolvedValue(undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const handler = registerBackfillRoute('get');
    const reply = buildReply();

    const result = await handler?.({ authUser: { role: 'admin' } }, reply);

    expect(reply.statusCode).toBe(200);
    expect(result).toEqual({
      ok: true,
      writesPerformed: true,
      provider: 'PARATIKA',
      upserted: [
        { vendorId: 'sporjinal', externalSellerId: '100003585', enabled: true },
        { vendorId: 'yalispor', externalSellerId: '100003586', enabled: true },
      ],
    });
    expect(seedVendorPaymentSellerMappingsMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expectNoSecrets(result);
  });

  it('returns the same row status on an idempotent second run', async () => {
    process.env.ADMIN_PROBES_ENABLED = 'true';
    seedVendorPaymentSellerMappingsMock.mockResolvedValue(undefined);
    const handler = registerBackfillRoute();
    const firstReply = buildReply();
    const secondReply = buildReply();

    const firstResult = await handler?.({ authUser: { role: 'admin' } }, firstReply);
    const secondResult = await handler?.({ authUser: { role: 'admin' } }, secondReply);

    expect(firstReply.statusCode).toBe(200);
    expect(secondReply.statusCode).toBe(200);
    expect(secondResult).toEqual(firstResult);
    expect(seedVendorPaymentSellerMappingsMock).toHaveBeenCalledTimes(2);
    expectNoSecrets(secondResult);
  });
});
