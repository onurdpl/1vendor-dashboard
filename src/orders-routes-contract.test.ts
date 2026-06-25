import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerOrdersRoutes } from '../backend/src/modules/orders/orders.routes.js';

const listVendorOrdersMock = vi.hoisted(() => vi.fn());
const getVendorOrderByIdForUserMock = vi.hoisted(() => vi.fn());
const getAdminShopifyOrderBreakdownMock = vi.hoisted(() => vi.fn());
const rejectVendorOrderAllocationMock = vi.hoisted(() => vi.fn());
const planAllocationSplitForVendorOrderMock = vi.hoisted(() => vi.fn());
const splitAllocationForVendorOrderMock = vi.hoisted(() => vi.fn());
const returnBlockedAllocationToVendorMock = vi.hoisted(() => vi.fn());
const addBlockedAllocationResolutionNoteMock = vi.hoisted(() => vi.fn());
const requestCancelRefundReviewForAdminOrderMock = vi.hoisted(() => vi.fn());
const previewShopifyRefundForAdminOrderMock = vi.hoisted(() => vi.fn());
const transferAllocationEconomicsForAdminOrderMock = vi.hoisted(() => vi.fn());
const sendProductPanelVariantDisableDryRunEventsForOrderMock = vi.hoisted(() => vi.fn());
const MockOrderRejectValidationError = vi.hoisted(() => class MockOrderRejectValidationError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
});
const MockEconomicTransferValidationError = vi.hoisted(() => class MockEconomicTransferValidationError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
});
const MockProductPanelVariantDisableDryRunSendError = vi.hoisted(() => class MockProductPanelVariantDisableDryRunSendError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 409) {
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
  planAllocationSplitForVendorOrder: planAllocationSplitForVendorOrderMock,
  previewShopifyRefundForAdminOrder: previewShopifyRefundForAdminOrderMock,
  rejectVendorOrderAllocation: rejectVendorOrderAllocationMock,
  requestCancelRefundReviewForAdminOrder: requestCancelRefundReviewForAdminOrderMock,
  returnBlockedAllocationToVendor: returnBlockedAllocationToVendorMock,
  splitAllocationForVendorOrder: splitAllocationForVendorOrderMock,
  transferAllocationEconomicsForAdminOrder: transferAllocationEconomicsForAdminOrderMock,
}));

vi.mock('../backend/src/modules/shopify/shopify-admin.service.js', () => ({
  createShopifyAdminService: vi.fn(() => ({
    previewSuggestedRefund: vi.fn(),
    fetchFulfillmentOrdersForCancellationClassification: vi.fn(),
  })),
}));

vi.mock('../backend/src/modules/finance/economic-transfer.service.js', () => ({
  EconomicTransferValidationError: MockEconomicTransferValidationError,
}));

vi.mock('../backend/src/modules/product-panel/product-panel-variant-disable-outbox.service.js', () => ({
  ProductPanelVariantDisableDryRunSendError: MockProductPanelVariantDisableDryRunSendError,
  sendProductPanelVariantDisableDryRunEventsForOrder: sendProductPanelVariantDisableDryRunEventsForOrderMock,
}));

vi.mock('../backend/src/modules/orders/allocation-split.service.js', () => ({
  AllocationSplitValidationError: MockOrderRejectValidationError,
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
    planAllocationSplitForVendorOrderMock.mockReset();
    splitAllocationForVendorOrderMock.mockReset();
    returnBlockedAllocationToVendorMock.mockReset();
    addBlockedAllocationResolutionNoteMock.mockReset();
    requestCancelRefundReviewForAdminOrderMock.mockReset();
    previewShopifyRefundForAdminOrderMock.mockReset();
    transferAllocationEconomicsForAdminOrderMock.mockReset();
    sendProductPanelVariantDisableDryRunEventsForOrderMock.mockReset();
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

    const env = {
      PRODUCT_PANEL_VARIANT_DISABLE_ENABLED: true,
      PRODUCT_PANEL_VARIANT_DISABLE_DRY_RUN: false,
      PRODUCT_PANEL_BASE_URL: 'https://product-panel.example',
      PRODUCT_PANEL_HMAC_SECRET: 'secret',
    };

    registerOrdersRoutes(app as never, env as never);
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
    }, {
      productPanelEnv: env,
    });
  });

  it('wires vendor allocation split planner route to the read-only planner wrapper', async () => {
    const plannerResponse = {
      ok: true,
      writesPerformed: false,
      canSplit: true,
      decision: 'can_split',
      blockers: [],
      warnings: [],
      sourceAllocation: {
        id: 'alloc-1',
        allocationStatus: 'ACTIVE',
        originalVendorId: 'vendor-a',
        assignedVendorId: 'vendor-a',
        sourceShopifyOrderId: 'shopify-1',
        sourceShopifyOrderNumber: '#1097',
      },
      selectedLines: [{ id: 'line-2', shopifyLineItemId: 'shopify-line-2', quantity: 1, lineAmount: 200 }],
      remainingLines: [{ id: 'line-1', shopifyLineItemId: 'shopify-line-1', quantity: 1, lineAmount: 100 }],
      amountPlan: { originalAmount: 300, selectedAmount: 200, remainingAmount: 100 },
      proposedChildAllocation: { id: 'alloc-split-alloc-1-hash', deterministic: true },
    };
    planAllocationSplitForVendorOrderMock.mockResolvedValueOnce(plannerResponse);
    const posts = new Map<string, (request: {
      authUser?: { id?: string; role?: string };
      vendorContext?: { vendorId?: string };
      params: { allocationId: string };
      body?: { selectedVendorAllocationLineItemIds?: string[]; reason?: string; note?: string };
    }, reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }) => unknown>();
    const app = {
      get: vi.fn(),
      post: vi.fn((path: string, _options: unknown, handler: (request: {
        authUser?: { id?: string; role?: string };
        vendorContext?: { vendorId?: string };
        params: { allocationId: string };
        body?: { selectedVendorAllocationLineItemIds?: string[]; reason?: string; note?: string };
      }, reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }) => unknown) => {
        posts.set(path, handler);
      }),
    };

    registerOrdersRoutes(app as never, {} as never);
    const response = await posts.get('/orders/:allocationId/split-plan')?.({
      authUser: { id: 'vendor-user-1', role: 'vendor' },
      vendorContext: { vendorId: 'vendor-a' },
      params: { allocationId: ' alloc-1 ' },
      body: {
        selectedVendorAllocationLineItemIds: [' line-2 ', ''],
        reason: 'OUT_OF_STOCK',
        note: 'One item unavailable.',
      },
    }, {
      code: (statusCode: number) => ({
        send: (payload: unknown) => ({ statusCode, payload }),
      }),
    });

    expect(response).toEqual(plannerResponse);
    expect(planAllocationSplitForVendorOrderMock).toHaveBeenCalledWith('vendor-a', 'alloc-1', {
      selectedVendorAllocationLineItemIds: ['line-2'],
      reason: 'OUT_OF_STOCK',
      note: 'One item unavailable.',
    });
  });

  it.each([
    ['blocked', { canSplit: false, decision: 'blocked', blockers: [{ code: 'tracking_exists', message: 'Allocation already has tracking evidence.' }], warnings: [] }],
    ['use_full_allocation_reject', { canSplit: false, decision: 'use_full_allocation_reject', blockers: [], warnings: [{ code: 'all_lines_selected', message: 'All allocation lines were selected; use full allocation reject instead of split.' }] }],
  ])('returns vendor allocation split planner %s responses without writing', async (_case, partialResponse) => {
    const plannerResponse = {
      ok: true,
      writesPerformed: false,
      sourceAllocation: null,
      selectedLines: [],
      remainingLines: [],
      amountPlan: { originalAmount: 0, selectedAmount: 0, remainingAmount: 0 },
      proposedChildAllocation: { id: null, deterministic: true },
      ...partialResponse,
    };
    planAllocationSplitForVendorOrderMock.mockResolvedValueOnce(plannerResponse);
    const posts = new Map<string, (request: {
      authUser?: { role?: string };
      vendorContext?: { vendorId?: string };
      params: { allocationId: string };
      body?: { selectedVendorAllocationLineItemIds?: string[] };
    }, reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }) => unknown>();
    const app = {
      get: vi.fn(),
      post: vi.fn((path: string, _options: unknown, handler: (request: {
        authUser?: { role?: string };
        vendorContext?: { vendorId?: string };
        params: { allocationId: string };
        body?: { selectedVendorAllocationLineItemIds?: string[] };
      }, reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }) => unknown) => {
        posts.set(path, handler);
      }),
    };

    registerOrdersRoutes(app as never, {} as never);
    const response = await posts.get('/orders/:allocationId/split-plan')?.({
      authUser: { role: 'vendor' },
      vendorContext: { vendorId: 'vendor-a' },
      params: { allocationId: 'alloc-1' },
      body: { selectedVendorAllocationLineItemIds: ['line-1'] },
    }, {
      code: (statusCode: number) => ({
        send: (payload: unknown) => ({ statusCode, payload }),
      }),
    });

    expect(response).toEqual(plannerResponse);
    expect(splitAllocationForVendorOrderMock).not.toHaveBeenCalled();
  });

  it('wires vendor allocation split execution route to the split service wrapper', async () => {
    const splitResponse = {
      ok: true,
      splitSummary: {
        splitEventId: 'split-1',
        sourceAllocationId: 'alloc-1',
        childAllocationId: 'alloc-child',
        reason: 'OUT_OF_STOCK',
        actorName: null,
        lineageRole: 'unknown',
        movedItems: [],
      },
      sourceAllocationId: 'alloc-1',
      childAllocationId: 'alloc-child',
      sourceSaleLedgerId: 'fin-source',
      remainingSaleLedgerId: 'fin-remaining',
      childSaleLedgerId: 'fin-child',
      idempotent: false,
    };
    splitAllocationForVendorOrderMock.mockResolvedValueOnce(splitResponse);
    const posts = new Map<string, (request: {
      authUser?: { id?: string; role?: string };
      vendorContext?: { vendorId?: string };
      params: { allocationId: string };
      body?: { selectedVendorAllocationLineItemIds?: string[]; reason?: string; note?: string; confirmSplit?: boolean };
    }, reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }) => unknown>();
    const app = {
      get: vi.fn(),
      post: vi.fn((path: string, _options: unknown, handler: (request: {
        authUser?: { id?: string; role?: string };
        vendorContext?: { vendorId?: string };
        params: { allocationId: string };
        body?: { selectedVendorAllocationLineItemIds?: string[]; reason?: string; note?: string; confirmSplit?: boolean };
      }, reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }) => unknown) => {
        posts.set(path, handler);
      }),
    };

    registerOrdersRoutes(app as never, {} as never);
    const response = await posts.get('/orders/:allocationId/split')?.({
      authUser: { id: 'vendor-user-1', role: 'vendor' },
      vendorContext: { vendorId: 'vendor-a' },
      params: { allocationId: 'alloc-1' },
      body: {
        selectedVendorAllocationLineItemIds: ['line-2'],
        reason: ' OUT_OF_STOCK ',
        note: 'One item unavailable.',
        confirmSplit: true,
      },
    }, {
      code: (statusCode: number) => ({
        send: (payload: unknown) => ({ statusCode, payload }),
      }),
    });

    expect(response).toEqual(splitResponse);
    expect(splitAllocationForVendorOrderMock).toHaveBeenCalledWith('vendor-a', 'alloc-1', {
      selectedVendorAllocationLineItemIds: ['line-2'],
      reason: 'OUT_OF_STOCK',
      note: 'One item unavailable.',
      actorUserId: 'vendor-user-1',
    });
  });

  it('returns idempotent allocation split execution responses', async () => {
    splitAllocationForVendorOrderMock.mockResolvedValueOnce({
      ok: true,
      splitSummary: {
        splitEventId: 'split-1',
        sourceAllocationId: 'alloc-1',
        childAllocationId: 'alloc-child',
        reason: 'OUT_OF_STOCK',
        actorName: null,
        lineageRole: 'unknown',
        movedItems: [],
      },
      sourceAllocationId: 'alloc-1',
      childAllocationId: 'alloc-child',
      sourceSaleLedgerId: 'fin-source',
      remainingSaleLedgerId: 'fin-remaining',
      childSaleLedgerId: 'fin-child',
      idempotent: true,
    });
    const posts = new Map<string, (request: {
      authUser?: { id?: string; role?: string };
      vendorContext?: { vendorId?: string };
      params: { allocationId: string };
      body?: { selectedVendorAllocationLineItemIds?: string[]; reason?: string; confirmSplit?: boolean };
    }, reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }) => unknown>();
    const app = {
      get: vi.fn(),
      post: vi.fn((path: string, _options: unknown, handler: (request: {
        authUser?: { id?: string; role?: string };
        vendorContext?: { vendorId?: string };
        params: { allocationId: string };
        body?: { selectedVendorAllocationLineItemIds?: string[]; reason?: string; confirmSplit?: boolean };
      }, reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }) => unknown) => {
        posts.set(path, handler);
      }),
    };

    registerOrdersRoutes(app as never, {} as never);
    const response = await posts.get('/orders/:allocationId/split')?.({
      authUser: { id: 'vendor-user-1', role: 'vendor' },
      vendorContext: { vendorId: 'vendor-a' },
      params: { allocationId: 'alloc-1' },
      body: { selectedVendorAllocationLineItemIds: ['line-2'], reason: 'OUT_OF_STOCK', confirmSplit: true },
    }, {
      code: (statusCode: number) => ({
        send: (payload: unknown) => ({ statusCode, payload }),
      }),
    });

    expect(response).toMatchObject({ ok: true, idempotent: true });
  });

  it('blocks allocation split execution without explicit confirmation', async () => {
    const posts = new Map<string, (request: {
      authUser?: { id?: string; role?: string };
      vendorContext?: { vendorId?: string };
      params: { allocationId: string };
      body?: { selectedVendorAllocationLineItemIds?: string[]; reason?: string; confirmSplit?: boolean };
    }, reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }) => unknown>();
    const app = {
      get: vi.fn(),
      post: vi.fn((path: string, _options: unknown, handler: (request: {
        authUser?: { id?: string; role?: string };
        vendorContext?: { vendorId?: string };
        params: { allocationId: string };
        body?: { selectedVendorAllocationLineItemIds?: string[]; reason?: string; confirmSplit?: boolean };
      }, reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }) => unknown) => {
        posts.set(path, handler);
      }),
    };

    registerOrdersRoutes(app as never, {} as never);
    const response = await posts.get('/orders/:allocationId/split')?.({
      authUser: { id: 'vendor-user-1', role: 'vendor' },
      vendorContext: { vendorId: 'vendor-a' },
      params: { allocationId: 'alloc-1' },
      body: { selectedVendorAllocationLineItemIds: ['line-2'], reason: 'OUT_OF_STOCK', confirmSplit: false },
    }, {
      code: (statusCode: number) => ({
        send: (payload: unknown) => ({ statusCode, payload }),
      }),
    });

    expect(response).toEqual({ statusCode: 400, payload: { message: 'Allocation split confirmation is required.' } });
    expect(splitAllocationForVendorOrderMock).not.toHaveBeenCalled();
  });

  it('surfaces allocation split ownership validation safely', async () => {
    splitAllocationForVendorOrderMock.mockRejectedValueOnce(
      new MockOrderRejectValidationError('Actor vendor does not own this allocation.', 409),
    );
    const posts = new Map<string, (request: {
      authUser?: { id?: string; role?: string };
      vendorContext?: { vendorId?: string };
      params: { allocationId: string };
      body?: { selectedVendorAllocationLineItemIds?: string[]; reason?: string; confirmSplit?: boolean };
    }, reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }) => unknown>();
    const app = {
      get: vi.fn(),
      post: vi.fn((path: string, _options: unknown, handler: (request: {
        authUser?: { id?: string; role?: string };
        vendorContext?: { vendorId?: string };
        params: { allocationId: string };
        body?: { selectedVendorAllocationLineItemIds?: string[]; reason?: string; confirmSplit?: boolean };
      }, reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }) => unknown) => {
        posts.set(path, handler);
      }),
    };

    registerOrdersRoutes(app as never, {} as never);
    const response = await posts.get('/orders/:allocationId/split')?.({
      authUser: { id: 'vendor-user-1', role: 'vendor' },
      vendorContext: { vendorId: 'vendor-b' },
      params: { allocationId: 'alloc-1' },
      body: { selectedVendorAllocationLineItemIds: ['line-2'], reason: 'OUT_OF_STOCK', confirmSplit: true },
    }, {
      code: (statusCode: number) => ({
        send: (payload: unknown) => ({ statusCode, payload }),
      }),
    });

    expect(response).toEqual({ statusCode: 409, payload: { message: 'Actor vendor does not own this allocation.' } });
  });

  it('blocks non-vendor allocation split routes', async () => {
    const posts = new Map<string, (request: {
      authUser?: { id?: string; role?: string };
      vendorContext?: { vendorId?: string };
      params: { allocationId: string };
      body?: { selectedVendorAllocationLineItemIds?: string[]; reason?: string; confirmSplit?: boolean };
    }, reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }) => unknown>();
    const app = {
      get: vi.fn(),
      post: vi.fn((path: string, _options: unknown, handler: (request: {
        authUser?: { id?: string; role?: string };
        vendorContext?: { vendorId?: string };
        params: { allocationId: string };
        body?: { selectedVendorAllocationLineItemIds?: string[]; reason?: string; confirmSplit?: boolean };
      }, reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }) => unknown) => {
        posts.set(path, handler);
      }),
    };

    registerOrdersRoutes(app as never, {} as never);
    const response = await posts.get('/orders/:allocationId/split-plan')?.({
      authUser: { id: 'admin-1', role: 'admin' },
      vendorContext: { vendorId: 'vendor-a' },
      params: { allocationId: 'alloc-1' },
      body: { selectedVendorAllocationLineItemIds: ['line-2'] },
    }, {
      code: (statusCode: number) => ({
        send: (payload: unknown) => ({ statusCode, payload }),
      }),
    });

    expect(response).toEqual({ statusCode: 403, payload: { message: 'Forbidden' } });
    expect(planAllocationSplitForVendorOrderMock).not.toHaveBeenCalled();
    expect(splitAllocationForVendorOrderMock).not.toHaveBeenCalled();
  });

  it('wires admin Product Panel dry-run send route to the scoped sender', async () => {
    const env = {
      PRODUCT_PANEL_VARIANT_DISABLE_ENABLED: true,
      PRODUCT_PANEL_VARIANT_DISABLE_DRY_RUN: true,
      PRODUCT_PANEL_BASE_URL: 'https://product-panel.example',
      PRODUCT_PANEL_HMAC_SECRET: 'secret',
    };
    sendProductPanelVariantDisableDryRunEventsForOrderMock.mockResolvedValueOnce({
      ok: true,
      attempted: 1,
      resolved: 1,
      failed: 0,
      skipped: 0,
      latestEventStatuses: [],
    });
    const posts = new Map<string, (request: {
      authUser?: { id?: string; role?: string };
      params: { shopifyOrderId: string };
    }, reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }) => unknown>();
    const app = {
      get: vi.fn(),
      post: vi.fn((path: string, _options: unknown, handler: (request: {
        authUser?: { id?: string; role?: string };
        params: { shopifyOrderId: string };
      }, reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }) => unknown) => {
        posts.set(path, handler);
      }),
    };

    registerOrdersRoutes(app as never, env as never);
    const response = await posts.get('/admin/orders/:shopifyOrderId/product-panel-variant-disable/send-dry-run')?.({
      authUser: { id: 'admin-1', role: 'admin' },
      params: { shopifyOrderId: 'gid://shopify/Order/1101' },
    }, {
      code: (statusCode: number) => ({
        send: (payload: unknown) => ({ statusCode, payload }),
      }),
    });

    expect(response).toEqual({
      ok: true,
      attempted: 1,
      resolved: 1,
      failed: 0,
      skipped: 0,
      latestEventStatuses: [],
    });
    expect(sendProductPanelVariantDisableDryRunEventsForOrderMock).toHaveBeenCalledWith(env, {
      shopifyOrderId: 'gid://shopify/Order/1101',
    });
  });

  it('blocks non-admin Product Panel dry-run send requests', async () => {
    const posts = new Map<string, (request: {
      authUser?: { id?: string; role?: string };
      params: { shopifyOrderId: string };
    }, reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }) => unknown>();
    const app = {
      get: vi.fn(),
      post: vi.fn((path: string, _options: unknown, handler: (request: {
        authUser?: { id?: string; role?: string };
        params: { shopifyOrderId: string };
      }, reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }) => unknown) => {
        posts.set(path, handler);
      }),
    };

    registerOrdersRoutes(app as never, {} as never);
    const response = await posts.get('/admin/orders/:shopifyOrderId/product-panel-variant-disable/send-dry-run')?.({
      authUser: { id: 'vendor-1', role: 'vendor' },
      params: { shopifyOrderId: 'gid://shopify/Order/1101' },
    }, {
      code: (statusCode: number) => ({
        send: (payload: unknown) => ({ statusCode, payload }),
      }),
    });

    expect(response).toEqual({ statusCode: 403, payload: { message: 'Forbidden' } });
    expect(sendProductPanelVariantDisableDryRunEventsForOrderMock).not.toHaveBeenCalled();
  });

  it('returns Product Panel dry-run send validation errors from the admin route', async () => {
    sendProductPanelVariantDisableDryRunEventsForOrderMock.mockRejectedValueOnce(
      new MockProductPanelVariantDisableDryRunSendError('Product Panel hard-disable mode is not allowed from this manual dry-run action.'),
    );
    const posts = new Map<string, (request: {
      authUser?: { id?: string; role?: string };
      params: { shopifyOrderId: string };
    }, reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }) => unknown>();
    const app = {
      get: vi.fn(),
      post: vi.fn((path: string, _options: unknown, handler: (request: {
        authUser?: { id?: string; role?: string };
        params: { shopifyOrderId: string };
      }, reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }) => unknown) => {
        posts.set(path, handler);
      }),
    };

    registerOrdersRoutes(app as never, {} as never);
    const response = await posts.get('/admin/orders/:shopifyOrderId/product-panel-variant-disable/send-dry-run')?.({
      authUser: { id: 'admin-1', role: 'admin' },
      params: { shopifyOrderId: 'gid://shopify/Order/1101' },
    }, {
      code: (statusCode: number) => ({
        send: (payload: unknown) => ({ statusCode, payload }),
      }),
    });

    expect(response).toEqual({
      statusCode: 409,
      payload: { message: 'Product Panel hard-disable mode is not allowed from this manual dry-run action.' },
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

  it('wires admin cancel/refund review route to the local review service', async () => {
    requestCancelRefundReviewForAdminOrderMock.mockResolvedValueOnce({ order: { sourceShopifyOrderId: 'shopify-1' }, allocations: [] });
    const posts = new Map<string, (request: {
      authUser?: { id?: string; role?: string };
      params: { shopifyOrderId: string; allocationId: string };
      body?: { reason?: string; note?: string; confirmReview?: boolean };
    }, reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }) => unknown>();
    const app = {
      get: vi.fn(),
      post: vi.fn((path: string, _options: unknown, handler: (request: {
        authUser?: { id?: string; role?: string };
        params: { shopifyOrderId: string; allocationId: string };
        body?: { reason?: string; note?: string; confirmReview?: boolean };
      }, reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }) => unknown) => {
        posts.set(path, handler);
      }),
    };

    registerOrdersRoutes(app as never, {} as never);
    const response = await posts.get('/admin/orders/:shopifyOrderId/allocations/:allocationId/cancel-refund-review')?.({
      authUser: { id: 'admin-1', role: 'admin' },
      params: { shopifyOrderId: 'shopify-1', allocationId: 'alloc-1' },
      body: {
        reason: ' OUT_OF_STOCK ',
        note: ' Customer will be contacted. ',
        confirmReview: true,
      },
    }, {
      code: (statusCode: number) => ({
        send: (payload: unknown) => ({ statusCode, payload }),
      }),
    });

    expect(response).toEqual({ order: { sourceShopifyOrderId: 'shopify-1' }, allocations: [] });
    expect(requestCancelRefundReviewForAdminOrderMock).toHaveBeenCalledWith('shopify-1', 'alloc-1', {
      reason: 'OUT_OF_STOCK',
      note: 'Customer will be contacted.',
      actorUserId: 'admin-1',
    });
  });

  it('blocks non-admin cancel/refund review requests', async () => {
    const posts = new Map<string, (request: {
      authUser?: { id?: string; role?: string };
      params: { shopifyOrderId: string; allocationId: string };
      body?: { reason?: string; note?: string; confirmReview?: boolean };
    }, reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }) => unknown>();
    const app = {
      get: vi.fn(),
      post: vi.fn((path: string, _options: unknown, handler: (request: {
        authUser?: { id?: string; role?: string };
        params: { shopifyOrderId: string; allocationId: string };
        body?: { reason?: string; note?: string; confirmReview?: boolean };
      }, reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }) => unknown) => {
        posts.set(path, handler);
      }),
    };

    registerOrdersRoutes(app as never, {} as never);
    const response = await posts.get('/admin/orders/:shopifyOrderId/allocations/:allocationId/cancel-refund-review')?.({
      authUser: { id: 'vendor-1', role: 'vendor' },
      params: { shopifyOrderId: 'shopify-1', allocationId: 'alloc-1' },
      body: { reason: 'OUT_OF_STOCK', note: 'Customer will be contacted.', confirmReview: true },
    }, {
      code: (statusCode: number) => ({
        send: (payload: unknown) => ({ statusCode, payload }),
      }),
    });

    expect(response).toEqual({ statusCode: 403, payload: { message: 'Forbidden' } });
    expect(requestCancelRefundReviewForAdminOrderMock).not.toHaveBeenCalled();
  });

  it.each([
    ['confirmReview missing', { reason: 'OUT_OF_STOCK', note: 'Customer will be contacted.' }, 'Cancel/refund review confirmation is required.'],
    ['confirmReview false', { reason: 'OUT_OF_STOCK', note: 'Customer will be contacted.', confirmReview: false }, 'Cancel/refund review confirmation is required.'],
    ['reason missing', { note: 'Customer will be contacted.', confirmReview: true }, 'Cancel/refund review reason is required.'],
    ['note missing', { reason: 'OUT_OF_STOCK', confirmReview: true }, 'Cancel/refund review note is required.'],
    ['note too long', { reason: 'OUT_OF_STOCK', note: 'x'.repeat(1001), confirmReview: true }, 'Cancel/refund review note must be 1000 characters or fewer.'],
  ])('rejects admin cancel/refund review when %s', async (_case, body, message) => {
    const posts = new Map<string, (request: {
      authUser?: { id?: string; role?: string };
      params: { shopifyOrderId: string; allocationId: string };
      body?: { reason?: string; note?: string; confirmReview?: boolean };
    }, reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }) => unknown>();
    const app = {
      get: vi.fn(),
      post: vi.fn((path: string, _options: unknown, handler: (request: {
        authUser?: { id?: string; role?: string };
        params: { shopifyOrderId: string; allocationId: string };
        body?: { reason?: string; note?: string; confirmReview?: boolean };
      }, reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }) => unknown) => {
        posts.set(path, handler);
      }),
    };

    registerOrdersRoutes(app as never, {} as never);
    const response = await posts.get('/admin/orders/:shopifyOrderId/allocations/:allocationId/cancel-refund-review')?.({
      authUser: { id: 'admin-1', role: 'admin' },
      params: { shopifyOrderId: 'shopify-1', allocationId: 'alloc-1' },
      body,
    }, {
      code: (statusCode: number) => ({
        send: (payload: unknown) => ({ statusCode, payload }),
      }),
    });

    expect(response).toEqual({ statusCode: 400, payload: { message } });
    expect(requestCancelRefundReviewForAdminOrderMock).not.toHaveBeenCalled();
  });

  it('wires admin Shopify refund preview route to the read-only preview service', async () => {
    const preview = {
      ok: true,
      writesPerformed: false,
      allocationId: 'alloc-1',
      shopifyOrderId: 'shopify-1',
      refundLineItemsPreview: [],
      suggestedRefund: null,
      warnings: [],
      blockers: [],
      missingData: [],
    };
    previewShopifyRefundForAdminOrderMock.mockResolvedValueOnce(preview);
    const posts = new Map<string, (request: {
      authUser?: { id?: string; role?: string };
      params: { shopifyOrderId: string; allocationId: string };
      body?: { restockType?: string; refundShipping?: boolean };
    }, reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }) => unknown>();
    const app = {
      get: vi.fn(),
      post: vi.fn((path: string, _options: unknown, handler: (request: {
        authUser?: { id?: string; role?: string };
        params: { shopifyOrderId: string; allocationId: string };
        body?: { restockType?: string; refundShipping?: boolean };
      }, reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }) => unknown) => {
        posts.set(path, handler);
      }),
    };

    registerOrdersRoutes(app as never, {} as never);
    const response = await posts.get('/admin/orders/:shopifyOrderId/allocations/:allocationId/shopify-refund-preview')?.({
      authUser: { id: 'admin-1', role: 'admin' },
      params: { shopifyOrderId: ' shopify-1 ', allocationId: ' alloc-1 ' },
      body: { restockType: 'CANCEL', refundShipping: false },
    }, {
      code: (statusCode: number) => ({
        send: (payload: unknown) => ({ statusCode, payload }),
      }),
    });

    expect(response).toEqual(preview);
    expect(previewShopifyRefundForAdminOrderMock).toHaveBeenCalledWith('shopify-1', 'alloc-1', expect.objectContaining({
      restockType: 'CANCEL',
      refundShipping: false,
      actorUserId: 'admin-1',
      shopifyAdminService: expect.objectContaining({
        previewSuggestedRefund: expect.any(Function),
        fetchFulfillmentOrdersForCancellationClassification: expect.any(Function),
      }),
    }));
  });

  it('blocks non-admin Shopify refund preview requests', async () => {
    const posts = new Map<string, (request: {
      authUser?: { id?: string; role?: string };
      params: { shopifyOrderId: string; allocationId: string };
      body?: { restockType?: string; refundShipping?: boolean };
    }, reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }) => unknown>();
    const app = {
      get: vi.fn(),
      post: vi.fn((path: string, _options: unknown, handler: (request: {
        authUser?: { id?: string; role?: string };
        params: { shopifyOrderId: string; allocationId: string };
        body?: { restockType?: string; refundShipping?: boolean };
      }, reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }) => unknown) => {
        posts.set(path, handler);
      }),
    };

    registerOrdersRoutes(app as never, {} as never);
    const response = await posts.get('/admin/orders/:shopifyOrderId/allocations/:allocationId/shopify-refund-preview')?.({
      authUser: { id: 'vendor-1', role: 'vendor' },
      params: { shopifyOrderId: 'shopify-1', allocationId: 'alloc-1' },
      body: { restockType: 'CANCEL', refundShipping: false },
    }, {
      code: (statusCode: number) => ({
        send: (payload: unknown) => ({ statusCode, payload }),
      }),
    });

    expect(response).toEqual({ statusCode: 403, payload: { message: 'Forbidden' } });
    expect(previewShopifyRefundForAdminOrderMock).not.toHaveBeenCalled();
  });

  it('rejects Shopify refund preview when refundShipping is true', async () => {
    const posts = new Map<string, (request: {
      authUser?: { id?: string; role?: string };
      params: { shopifyOrderId: string; allocationId: string };
      body?: { restockType?: string; refundShipping?: boolean };
    }, reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }) => unknown>();
    const app = {
      get: vi.fn(),
      post: vi.fn((path: string, _options: unknown, handler: (request: {
        authUser?: { id?: string; role?: string };
        params: { shopifyOrderId: string; allocationId: string };
        body?: { restockType?: string; refundShipping?: boolean };
      }, reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }) => unknown) => {
        posts.set(path, handler);
      }),
    };

    registerOrdersRoutes(app as never, {} as never);
    const response = await posts.get('/admin/orders/:shopifyOrderId/allocations/:allocationId/shopify-refund-preview')?.({
      authUser: { id: 'admin-1', role: 'admin' },
      params: { shopifyOrderId: 'shopify-1', allocationId: 'alloc-1' },
      body: { restockType: 'CANCEL', refundShipping: true },
    }, {
      code: (statusCode: number) => ({
        send: (payload: unknown) => ({ statusCode, payload }),
      }),
    });

    expect(response).toEqual({
      statusCode: 400,
      payload: { message: 'Refund shipping preview is not supported for allocation-scoped cancel/refund review.' },
    });
    expect(previewShopifyRefundForAdminOrderMock).not.toHaveBeenCalled();
  });

  it('wires admin economic transfer route to the economic transfer wrapper', async () => {
    const transfer = {
      transferId: 'transfer-1',
      fromVendorId: 'vendor-a',
      toVendorId: 'vendor-b',
      sourceLedgerId: 'fin-vendor-a-sale-1001',
      targetLedgerId: 'fin-vendor-b-sale-1001',
      allocationId: 'alloc-1',
      status: 'COMPLETED',
    };
    const order = { order: { sourceShopifyOrderId: 'shopify-1' }, allocations: [] };
    transferAllocationEconomicsForAdminOrderMock.mockResolvedValueOnce({ ok: true, transfer, order });
    const posts = new Map<string, (request: {
      authUser?: { id?: string; role?: string };
      params: { shopifyOrderId: string; allocationId: string };
      body?: { toVendorId?: string; reason?: string; confirmTransfer?: boolean };
    }, reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }) => unknown>();
    const app = {
      get: vi.fn(),
      post: vi.fn((path: string, _options: unknown, handler: (request: {
        authUser?: { id?: string; role?: string };
        params: { shopifyOrderId: string; allocationId: string };
        body?: { toVendorId?: string; reason?: string; confirmTransfer?: boolean };
      }, reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }) => unknown) => {
        posts.set(path, handler);
      }),
    };

    registerOrdersRoutes(app as never, {} as never);
    const response = await posts.get('/admin/orders/:shopifyOrderId/allocations/:allocationId/economic-transfer')?.({
      authUser: { id: 'admin-1', role: 'admin' },
      params: { shopifyOrderId: 'shopify-1', allocationId: 'alloc-1' },
      body: {
        toVendorId: ' vendor-b ',
        reason: ' Replacement vendor accepted captured economics. ',
        confirmTransfer: true,
      },
    }, {
      code: (statusCode: number) => ({
        send: (payload: unknown) => ({ statusCode, payload }),
      }),
    });

    expect(response).toEqual({ ok: true, transfer, order });
    expect(transferAllocationEconomicsForAdminOrderMock).toHaveBeenCalledWith('shopify-1', 'alloc-1', {
      toVendorId: 'vendor-b',
      reason: 'Replacement vendor accepted captured economics.',
      actorUserId: 'admin-1',
    });
  });

  it('blocks non-admin economic transfer requests', async () => {
    const posts = new Map<string, (request: {
      authUser?: { id?: string; role?: string };
      params: { shopifyOrderId: string; allocationId: string };
      body?: { toVendorId?: string; reason?: string; confirmTransfer?: boolean };
    }, reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }) => unknown>();
    const app = {
      get: vi.fn(),
      post: vi.fn((path: string, _options: unknown, handler: (request: {
        authUser?: { id?: string; role?: string };
        params: { shopifyOrderId: string; allocationId: string };
        body?: { toVendorId?: string; reason?: string; confirmTransfer?: boolean };
      }, reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }) => unknown) => {
        posts.set(path, handler);
      }),
    };

    registerOrdersRoutes(app as never, {} as never);
    const response = await posts.get('/admin/orders/:shopifyOrderId/allocations/:allocationId/economic-transfer')?.({
      authUser: { id: 'vendor-1', role: 'vendor' },
      params: { shopifyOrderId: 'shopify-1', allocationId: 'alloc-1' },
      body: { toVendorId: 'vendor-b', reason: 'Replacement vendor accepted.', confirmTransfer: true },
    }, {
      code: (statusCode: number) => ({
        send: (payload: unknown) => ({ statusCode, payload }),
      }),
    });

    expect(response).toEqual({ statusCode: 403, payload: { message: 'Forbidden' } });
    expect(transferAllocationEconomicsForAdminOrderMock).not.toHaveBeenCalled();
  });

  it.each([
    ['confirmTransfer missing', { toVendorId: 'vendor-b', reason: 'Valid reason.' }, 'Economic transfer confirmation is required.'],
    ['confirmTransfer false', { toVendorId: 'vendor-b', reason: 'Valid reason.', confirmTransfer: false }, 'Economic transfer confirmation is required.'],
    ['toVendorId missing', { reason: 'Valid reason.', confirmTransfer: true }, 'Replacement vendor id is required.'],
    ['reason missing', { toVendorId: 'vendor-b', confirmTransfer: true }, 'Economic transfer reason is required.'],
    ['reason too long', { toVendorId: 'vendor-b', reason: 'x'.repeat(501), confirmTransfer: true }, 'Economic transfer reason must be 500 characters or fewer.'],
  ])('rejects admin economic transfer when %s', async (_case, body, message) => {
    const posts = new Map<string, (request: {
      authUser?: { id?: string; role?: string };
      params: { shopifyOrderId: string; allocationId: string };
      body?: { toVendorId?: string; reason?: string; confirmTransfer?: boolean };
    }, reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }) => unknown>();
    const app = {
      get: vi.fn(),
      post: vi.fn((path: string, _options: unknown, handler: (request: {
        authUser?: { id?: string; role?: string };
        params: { shopifyOrderId: string; allocationId: string };
        body?: { toVendorId?: string; reason?: string; confirmTransfer?: boolean };
      }, reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }) => unknown) => {
        posts.set(path, handler);
      }),
    };

    registerOrdersRoutes(app as never, {} as never);
    const response = await posts.get('/admin/orders/:shopifyOrderId/allocations/:allocationId/economic-transfer')?.({
      authUser: { id: 'admin-1', role: 'admin' },
      params: { shopifyOrderId: 'shopify-1', allocationId: 'alloc-1' },
      body,
    }, {
      code: (statusCode: number) => ({
        send: (payload: unknown) => ({ statusCode, payload }),
      }),
    });

    expect(response).toEqual({ statusCode: 400, payload: { message } });
    expect(transferAllocationEconomicsForAdminOrderMock).not.toHaveBeenCalled();
  });

  it.each([
    ['shopifyOrderId missing', { shopifyOrderId: ' ', allocationId: 'alloc-1' }, 'Shopify order id is required.'],
    ['allocationId missing', { shopifyOrderId: 'shopify-1', allocationId: ' ' }, 'Allocation id is required.'],
  ])('rejects admin economic transfer when %s', async (_case, params, message) => {
    const posts = new Map<string, (request: {
      authUser?: { id?: string; role?: string };
      params: { shopifyOrderId: string; allocationId: string };
      body?: { toVendorId?: string; reason?: string; confirmTransfer?: boolean };
    }, reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }) => unknown>();
    const app = {
      get: vi.fn(),
      post: vi.fn((path: string, _options: unknown, handler: (request: {
        authUser?: { id?: string; role?: string };
        params: { shopifyOrderId: string; allocationId: string };
        body?: { toVendorId?: string; reason?: string; confirmTransfer?: boolean };
      }, reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }) => unknown) => {
        posts.set(path, handler);
      }),
    };

    registerOrdersRoutes(app as never, {} as never);
    const response = await posts.get('/admin/orders/:shopifyOrderId/allocations/:allocationId/economic-transfer')?.({
      authUser: { id: 'admin-1', role: 'admin' },
      params,
      body: { toVendorId: 'vendor-b', reason: 'Valid reason.', confirmTransfer: true },
    }, {
      code: (statusCode: number) => ({
        send: (payload: unknown) => ({ statusCode, payload }),
      }),
    });

    expect(response).toEqual({ statusCode: 400, payload: { message } });
    expect(transferAllocationEconomicsForAdminOrderMock).not.toHaveBeenCalled();
  });

  it('surfaces allocation ownership validation for economic transfer safely', async () => {
    transferAllocationEconomicsForAdminOrderMock.mockRejectedValueOnce(
      new MockOrderRejectValidationError('Allocation not found for Shopify order.', 404),
    );
    const posts = new Map<string, (request: {
      authUser?: { id?: string; role?: string };
      params: { shopifyOrderId: string; allocationId: string };
      body?: { toVendorId?: string; reason?: string; confirmTransfer?: boolean };
    }, reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }) => unknown>();
    const app = {
      get: vi.fn(),
      post: vi.fn((path: string, _options: unknown, handler: (request: {
        authUser?: { id?: string; role?: string };
        params: { shopifyOrderId: string; allocationId: string };
        body?: { toVendorId?: string; reason?: string; confirmTransfer?: boolean };
      }, reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }) => unknown) => {
        posts.set(path, handler);
      }),
    };

    registerOrdersRoutes(app as never, {} as never);
    const response = await posts.get('/admin/orders/:shopifyOrderId/allocations/:allocationId/economic-transfer')?.({
      authUser: { id: 'admin-1', role: 'admin' },
      params: { shopifyOrderId: 'shopify-1', allocationId: 'alloc-other' },
      body: { toVendorId: 'vendor-b', reason: 'Valid reason.', confirmTransfer: true },
    }, {
      code: (statusCode: number) => ({
        send: (payload: unknown) => ({ statusCode, payload }),
      }),
    });

    expect(response).toEqual({ statusCode: 404, payload: { message: 'Allocation not found for Shopify order.' } });
  });

  it('surfaces economic transfer service blocker errors safely', async () => {
    transferAllocationEconomicsForAdminOrderMock.mockRejectedValueOnce(
      new MockEconomicTransferValidationError('Economic transfer cannot run after refund evidence exists.', 409),
    );
    const posts = new Map<string, (request: {
      authUser?: { id?: string; role?: string };
      params: { shopifyOrderId: string; allocationId: string };
      body?: { toVendorId?: string; reason?: string; confirmTransfer?: boolean };
    }, reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }) => unknown>();
    const app = {
      get: vi.fn(),
      post: vi.fn((path: string, _options: unknown, handler: (request: {
        authUser?: { id?: string; role?: string };
        params: { shopifyOrderId: string; allocationId: string };
        body?: { toVendorId?: string; reason?: string; confirmTransfer?: boolean };
      }, reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }) => unknown) => {
        posts.set(path, handler);
      }),
    };

    registerOrdersRoutes(app as never, {} as never);
    const response = await posts.get('/admin/orders/:shopifyOrderId/allocations/:allocationId/economic-transfer')?.({
      authUser: { id: 'admin-1', role: 'admin' },
      params: { shopifyOrderId: 'shopify-1', allocationId: 'alloc-1' },
      body: { toVendorId: 'vendor-b', reason: 'Valid reason.', confirmTransfer: true },
    }, {
      code: (statusCode: number) => ({
        send: (payload: unknown) => ({ statusCode, payload }),
      }),
    });

    expect(response).toEqual({
      statusCode: 409,
      payload: { message: 'Economic transfer cannot run after refund evidence exists.' },
    });
  });
});
