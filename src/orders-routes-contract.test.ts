import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerOrdersRoutes } from '../backend/src/modules/orders/orders.routes.js';

const listVendorOrdersMock = vi.hoisted(() => vi.fn());
const getVendorOrderByIdForUserMock = vi.hoisted(() => vi.fn());
const getAdminShopifyOrderBreakdownMock = vi.hoisted(() => vi.fn());
const rejectVendorOrderAllocationMock = vi.hoisted(() => vi.fn());
const MockOrderRejectValidationError = vi.hoisted(() => class MockOrderRejectValidationError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
});

vi.mock('../backend/src/modules/orders/orders.service.js', () => ({
  getAdminShopifyOrderBreakdown: getAdminShopifyOrderBreakdownMock,
  getVendorOrderByIdForUser: getVendorOrderByIdForUserMock,
  listVendorOrders: listVendorOrdersMock,
  OrderRejectValidationError: MockOrderRejectValidationError,
  rejectVendorOrderAllocation: rejectVendorOrderAllocationMock,
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

describe('orders route contract', () => {
  beforeEach(() => {
    listVendorOrdersMock.mockReset();
    getVendorOrderByIdForUserMock.mockReset();
    getAdminShopifyOrderBreakdownMock.mockReset();
    rejectVendorOrderAllocationMock.mockReset();
  });

  it('keeps vendor order detail as a DB read without Shopify image backfill service wiring', async () => {
    getVendorOrderByIdForUserMock.mockResolvedValueOnce({ id: 'alloc-1' });
    const gets = new Map<string, (request: { authUser?: { role?: string }; vendorContext?: { vendorId?: string }; params: { orderId: string } }, reply: unknown) => unknown>();
    const app = {
      get: vi.fn((path: string, _options: unknown, handler: (request: { authUser?: { role?: string }; vendorContext?: { vendorId?: string }; params: { orderId: string } }, reply: unknown) => unknown) => {
        gets.set(path, handler);
      }),
      post: vi.fn(),
    };

    registerOrdersRoutes(app as never, {} as never);
    const response = await gets.get('/orders/:orderId')?.({
      authUser: { role: 'admin' },
      vendorContext: { vendorId: 'vendor-a' },
      params: { orderId: 'alloc-1' },
    }, {});

    expect(response).toEqual({ id: 'alloc-1' });
    expect(getVendorOrderByIdForUserMock).toHaveBeenCalledWith('vendor-a', 'alloc-1', {
      includeShipmentProviderResponseSummary: true,
      includeFinanceLedgerPreview: true,
    });
    expect(JSON.stringify(getVendorOrderByIdForUserMock.mock.calls[0])).not.toContain('shopifyAdminService');
  });

  it('wires vendor reject route to the operational hold service', async () => {
    rejectVendorOrderAllocationMock.mockResolvedValueOnce({ id: 'alloc-1', allocationStatus: 'VENDOR_BLOCKED' });
    const posts = new Map<string, (request: {
      authUser?: { id?: string; role?: string };
      vendorContext?: { vendorId?: string };
      params: { orderId: string };
      body?: { reason?: string; note?: string };
    }, reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }) => unknown>();
    const app = {
      get: vi.fn(),
      post: vi.fn((path: string, _options: unknown, handler: (request: {
        authUser?: { id?: string; role?: string };
        vendorContext?: { vendorId?: string };
        params: { orderId: string };
        body?: { reason?: string; note?: string };
      }, reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }) => unknown) => {
        posts.set(path, handler);
      }),
    };

    registerOrdersRoutes(app as never, {} as never);
    const response = await posts.get('/orders/:orderId/reject')?.({
      authUser: { id: 'user-1', role: 'vendor' },
      vendorContext: { vendorId: 'vendor-a' },
      params: { orderId: 'alloc-1' },
      body: { reason: 'OUT_OF_STOCK', note: 'Missing stock' },
    }, {
      code: (statusCode: number) => ({
        send: (payload: unknown) => ({ statusCode, payload }),
      }),
    });

    expect(response).toEqual({ id: 'alloc-1', allocationStatus: 'VENDOR_BLOCKED' });
    expect(rejectVendorOrderAllocationMock).toHaveBeenCalledWith('vendor-a', 'alloc-1', {
      reason: 'OUT_OF_STOCK',
      note: 'Missing stock',
      actorUserId: 'user-1',
    });
  });
});
