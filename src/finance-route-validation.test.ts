import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerFinanceRoutes } from '../backend/src/modules/finance/finance.routes.js';

const upsertVendorFinancialProfileMock = vi.hoisted(() => vi.fn());

vi.mock('../backend/src/modules/finance/finance.service.js', () => ({
  cancelPayoutBatch: vi.fn(),
  getPayoutBatch: vi.fn(),
  getVendorFinanceDashboard: vi.fn(),
  getVendorFinancialProfile: vi.fn(),
  listPayoutBatches: vi.fn(),
  markPayoutBatchReview: vi.fn(),
  preparePayoutBatch: vi.fn(),
  upsertShipmentShippingCost: vi.fn(),
  upsertVendorFinancialProfile: upsertVendorFinancialProfileMock,
}));

vi.mock('../backend/src/modules/auth/auth.service.js', () => ({
  createAuthService: vi.fn(() => ({})),
}));

vi.mock('../backend/src/modules/auth/auth.middleware.js', () => ({
  createAuthMiddleware: vi.fn(() => ({
    authenticateRequest: vi.fn(),
  })),
}));

vi.mock('../backend/src/modules/vendor-access/vendor-access.middleware.js', () => ({
  requireVendorAccess: vi.fn(),
}));

type PutHandler = (
  request: {
    authUser?: { role?: string };
    params?: Record<string, string>;
    body?: unknown;
  },
  reply: ReturnType<typeof createReply>,
) => unknown;

function createReply() {
  const reply = {
    statusCode: 200,
    payload: undefined as unknown,
    sent: false,
    code: vi.fn((status: number) => {
      reply.statusCode = status;
      return {
        send: vi.fn((body: unknown) => {
          reply.payload = body;
          reply.sent = true;
          return { status, body };
        }),
      };
    }),
  };

  return reply;
}

function createRegisteredPutRoutes() {
  const puts = new Map<string, PutHandler>();
  const app = {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn((path: string, _options: unknown, handler: PutHandler) => {
      puts.set(path, handler);
    }),
  };

  registerFinanceRoutes(app as never, {} as never);
  return puts;
}

async function updateFinancialProfile(body: unknown) {
  const puts = createRegisteredPutRoutes();
  const reply = createReply();
  const result = await puts.get('/admin/vendors/:vendorId/financial-profile')?.(
    {
      authUser: { role: 'admin' },
      params: { vendorId: 'sporjinal' },
      body,
    },
    reply,
  );

  return {
    statusCode: reply.statusCode,
    payload: reply.sent ? reply.payload : result,
  };
}

describe('finance route validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    upsertVendorFinancialProfileMock.mockResolvedValue({
      vendorId: 'sporjinal',
      commissionPercent: '10.00',
      commissionVatPercent: '0.00',
      deductShippingEnabled: true,
      shippingMode: 'fixed',
      fixedShippingFee: '30.00',
      active: true,
      source: 'configured',
    });
  });

  it.each(['disabled', 'fixed', 'external_provider'])('accepts supported shippingMode value %s', async (shippingMode) => {
    const response = await updateFinancialProfile({
      commissionPercent: 10,
      shippingMode,
    });

    expect(response.statusCode).toBe(200);
    expect(response.payload).toEqual(
      expect.objectContaining({
        vendorId: 'sporjinal',
        shippingMode: 'fixed',
      }),
    );
    expect(upsertVendorFinancialProfileMock).toHaveBeenCalledWith('sporjinal', {
      commissionPercent: 10,
      shippingMode,
    });
  });

  it('preserves existing behavior when shippingMode is omitted', async () => {
    const response = await updateFinancialProfile({
      commissionPercent: 12,
    });

    expect(response.statusCode).toBe(200);
    expect(response.payload).toEqual(
      expect.objectContaining({
        vendorId: 'sporjinal',
        source: 'configured',
      }),
    );
    expect(upsertVendorFinancialProfileMock).toHaveBeenCalledWith('sporjinal', {
      commissionPercent: 12,
    });
  });

  it.each([
    ['unknown', 'manual'],
    ['empty', ''],
    ['non-string number', 123],
    ['non-string boolean', true],
    ['null', null],
    ['object', { value: 'fixed' }],
    ['array', ['fixed']],
  ])('rejects %s shippingMode values', async (_label, shippingMode) => {
    const response = await updateFinancialProfile({
      commissionPercent: 10,
      shippingMode,
    });

    expect(response.statusCode).toBe(400);
    expect(response.payload).toEqual({ message: 'shippingMode must be disabled, fixed, or external_provider.' });
    expect(upsertVendorFinancialProfileMock).not.toHaveBeenCalled();
  });

  it('keeps the successful response shape unchanged for valid profile updates', async () => {
    upsertVendorFinancialProfileMock.mockResolvedValueOnce({
      vendorId: 'sporjinal',
      commissionPercent: '12.00',
      commissionVatPercent: '18.00',
      deductShippingEnabled: true,
      shippingMode: 'external_provider',
      fixedShippingFee: null,
      active: true,
      source: 'configured',
    });

    const response = await updateFinancialProfile({
      commissionPercent: 12,
      commissionVatPercent: 18,
      deductShippingEnabled: true,
      shippingMode: 'external_provider',
      fixedShippingFee: null,
      active: true,
    });

    expect(response.statusCode).toBe(200);
    expect(response.payload).toEqual({
      vendorId: 'sporjinal',
      commissionPercent: '12.00',
      commissionVatPercent: '18.00',
      deductShippingEnabled: true,
      shippingMode: 'external_provider',
      fixedShippingFee: null,
      active: true,
      source: 'configured',
    });
  });
});
