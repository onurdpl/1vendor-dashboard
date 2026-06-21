import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerOrdersRoutes } from '../backend/src/modules/orders/orders.routes.js';

const listVendorOrdersMock = vi.hoisted(() => vi.fn());
const getVendorOrderByIdForUserMock = vi.hoisted(() => vi.fn());
const getAdminShopifyOrderBreakdownMock = vi.hoisted(() => vi.fn());
const rejectVendorOrderAllocationMock = vi.hoisted(() => vi.fn());
const returnBlockedAllocationToVendorMock = vi.hoisted(() => vi.fn());
const addBlockedAllocationResolutionNoteMock = vi.hoisted(() => vi.fn());
const MockOrderRejectValidationError = vi.hoisted(() => class MockOrderRejectValidationError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
});

vi.mock('../backend/src/modules/orders/orders.service.js', () => ({
  addBlockedAllocationResolutionNote: addBlockedAllocationResolutionNoteMock,
  getAdminShopifyOrderBreakdown: getAdminShopifyOrderBreakdownMock,
  getVendorOrderByIdForUser: getVendorOrderByIdForUserMock,
  listVendorOrders: listVendorOrdersMock,
  OrderRejectValidationError: MockOrderRejectValidationError,
  rejectVendorOrderAllocation: rejectVendorOrderAllocationMock,
  returnBlockedAllocationToVendor: returnBlockedAllocationToVendorMock,
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
    returnBlockedAllocationToVendorMock.mockReset();
    addBlockedAllocationResolutionNoteMock.mockReset();
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

  it('wires admin return-to-vendor route to the allocation resolution service', async () => {
    returnBlockedAllocationToVendorMock.mockResolvedValueOnce({ order: { sourceShopifyOrderId: 'shopify-1' }, allocations: [] });
    const posts = new Map<string, (request: {
      authUser?: { id?: string; role?: string };
      params: { shopifyOrderId: string; allocationId: string };
      body?: { confirmReturnToVendor?: boolean; note?: string };
    }, reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }) => unknown>();
    const app = {
      get: vi.fn(),
      post: vi.fn((path: string, _options: unknown, handler: (request: {
        authUser?: { id?: string; role?: string };
        params: { shopifyOrderId: string; allocationId: string };
        body?: { confirmReturnToVendor?: boolean; note?: string };
      }, reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }) => unknown) => {
        posts.set(path, handler);
      }),
    };

    registerOrdersRoutes(app as never, {} as never);
    const response = await posts.get('/admin/orders/:shopifyOrderId/allocations/:allocationId/return-to-vendor')?.({
      authUser: { id: 'admin-1', role: 'admin' },
      params: { shopifyOrderId: 'shopify-1', allocationId: 'alloc-1' },
      body: { confirmReturnToVendor: true, note: 'Stock confirmed.' },
    }, {
      code: (statusCode: number) => ({
        send: (payload: unknown) => ({ statusCode, payload }),
      }),
    });

    expect(response).toEqual({ order: { sourceShopifyOrderId: 'shopify-1' }, allocations: [] });
    expect(returnBlockedAllocationToVendorMock).toHaveBeenCalledWith('shopify-1', 'alloc-1', {
      note: 'Stock confirmed.',
      actorUserId: 'admin-1',
    });
  });

  it('blocks non-admin return-to-vendor requests', async () => {
    const posts = new Map<string, (request: {
      authUser?: { id?: string; role?: string };
      params: { shopifyOrderId: string; allocationId: string };
      body?: { confirmReturnToVendor?: boolean; note?: string };
    }, reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }) => unknown>();
    const app = {
      get: vi.fn(),
      post: vi.fn((path: string, _options: unknown, handler: (request: {
        authUser?: { id?: string; role?: string };
        params: { shopifyOrderId: string; allocationId: string };
        body?: { confirmReturnToVendor?: boolean; note?: string };
      }, reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }) => unknown) => {
        posts.set(path, handler);
      }),
    };

    registerOrdersRoutes(app as never, {} as never);
    const response = await posts.get('/admin/orders/:shopifyOrderId/allocations/:allocationId/return-to-vendor')?.({
      authUser: { id: 'vendor-1', role: 'vendor' },
      params: { shopifyOrderId: 'shopify-1', allocationId: 'alloc-1' },
      body: { confirmReturnToVendor: true, note: 'Stock confirmed.' },
    }, {
      code: (statusCode: number) => ({
        send: (payload: unknown) => ({ statusCode, payload }),
      }),
    });

    expect(response).toEqual({ statusCode: 403, payload: { message: 'Forbidden' } });
    expect(returnBlockedAllocationToVendorMock).not.toHaveBeenCalled();
  });

  it('wires admin resolution note route to the allocation note service', async () => {
    addBlockedAllocationResolutionNoteMock.mockResolvedValueOnce({ order: { sourceShopifyOrderId: 'shopify-1' }, allocations: [] });
    const posts = new Map<string, (request: {
      authUser?: { id?: string; role?: string };
      params: { shopifyOrderId: string; allocationId: string };
      body?: { note?: string };
    }, reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }) => unknown>();
    const app = {
      get: vi.fn(),
      post: vi.fn((path: string, _options: unknown, handler: (request: {
        authUser?: { id?: string; role?: string };
        params: { shopifyOrderId: string; allocationId: string };
        body?: { note?: string };
      }, reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }) => unknown) => {
        posts.set(path, handler);
      }),
    };

    registerOrdersRoutes(app as never, {} as never);
    const response = await posts.get('/admin/orders/:shopifyOrderId/allocations/:allocationId/resolution-note')?.({
      authUser: { id: 'admin-1', role: 'admin' },
      params: { shopifyOrderId: 'shopify-1', allocationId: 'alloc-1' },
      body: { note: 'Waiting for confirmation.' },
    }, {
      code: (statusCode: number) => ({
        send: (payload: unknown) => ({ statusCode, payload }),
      }),
    });

    expect(response).toEqual({ order: { sourceShopifyOrderId: 'shopify-1' }, allocations: [] });
    expect(addBlockedAllocationResolutionNoteMock).toHaveBeenCalledWith('shopify-1', 'alloc-1', {
      note: 'Waiting for confirmation.',
      actorUserId: 'admin-1',
    });
  });
});
