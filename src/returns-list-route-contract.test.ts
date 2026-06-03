import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerReturnsRoutes } from '../backend/src/modules/returns/returns.routes.js';

const listVendorReturnsMock = vi.hoisted(() => vi.fn());
const markReturnReceivedMock = vi.hoisted(() => vi.fn());
const reviewReturnMock = vi.hoisted(() => vi.fn());
const backfillShopifyReturnReasonsMock = vi.hoisted(() => vi.fn());
const cleanupDuplicateReturnRecordsMock = vi.hoisted(() => vi.fn());

vi.mock('../backend/src/modules/returns/returns.service.js', () => ({
  getVendorReturnById: vi.fn(),
  listVendorReturns: listVendorReturnsMock,
  markReturnReceived: markReturnReceivedMock,
  reviewReturn: reviewReturnMock,
  ReturnReviewError: class ReturnReviewError extends Error {
    statusCode: number;

    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

vi.mock('../backend/src/modules/returns/return-reason-backfill.service.js', () => ({
  backfillShopifyReturnReasons: backfillShopifyReturnReasonsMock,
}));

vi.mock('../backend/src/modules/returns/duplicate-return-cleanup.service.js', () => ({
  cleanupDuplicateReturnRecords: cleanupDuplicateReturnRecordsMock,
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

vi.mock('../backend/src/modules/vendor-access/vendor-access.service.js', () => ({
  resolveRequestVendorContext: vi.fn(async (_user: unknown, header: string | undefined) => ({
    ok: true,
    context: {
      vendorId: header ?? 'sporjinal',
      vendorName: 'Sporjinal',
      role: 'vendor',
      accessScope: 'vendor',
    },
  })),
}));

type PostHandler = (
  request: { authUser?: { role?: string }; body?: unknown; headers?: Record<string, string>; params?: Record<string, string> },
  reply: ReturnType<typeof createReply>,
) => unknown;

function createReply() {
  return {
    code: vi.fn((status: number) => ({
      send: vi.fn((body: unknown) => ({ status, body })),
    })),
  };
}

function createRegisteredPostRoutes() {
  const posts = new Map<string, PostHandler>();
  const app = {
    get: vi.fn(),
    post: vi.fn((path: string, _options: unknown, handler: PostHandler) => {
      posts.set(path, handler);
    }),
  };

  registerReturnsRoutes(app as never, {} as never);
  return posts;
}

describe('backend returns list route contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes item title fields through the actual list route response', async () => {
    listVendorReturnsMock.mockResolvedValueOnce([
      {
        id: 'return-1026',
        sourceShopifyOrderId: 'gid://shopify/Order/1026',
        sourceShopifyOrderNumber: '#1026',
        sourceShopifyRefundId: '',
        sourceShopifyReturnId: '23165600086',
        sourceShopifyReturnGid: 'gid://shopify/Return/23165600086',
        returnLifecycleStatus: 'requested',
        returnRequestSource: 'shopify_return_request',
        vendorId: 'sporjinal',
        assignedVendorId: 'sporjinal',
        status: 'requested',
        reason: 'SIZE_TOO_LARGE',
        returnReasonNote: 'Beden büyük geldi.',
        returnCarrierName: 'Yurtiçi Kargo',
        returnTrackingNumber: 'returnkargo-123',
        returnTrackingUrl: 'https://tracking.example/returnkargo-123',
        refundAmount: '0.00',
        refundedItemCount: 1,
        refundedSkus: ['SWOOSH-WHITE-S'],
        itemTitle: 'Nike Swoosh Medium Support Kadın Beyaz Sütyen / Beyaz / S',
        displayTitle: 'Nike Swoosh Medium Support Kadın Beyaz Sütyen / Beyaz / S',
        variantTitle: null,
        refundedItems: [
          {
            id: 'line-1026',
            sourceLineItemId: 'line-1026',
            sourceVariantId: null,
            sku: 'SWOOSH-WHITE-S',
            title: 'SWOOSH-WHITE-S',
            itemTitle: 'Nike Swoosh Medium Support Kadın Beyaz Sütyen / Beyaz / S',
            displayTitle: 'Nike Swoosh Medium Support Kadın Beyaz Sütyen / Beyaz / S',
            orderLineItemTitle: 'Nike Swoosh Medium Support Kadın Beyaz Sütyen / Beyaz / S',
            variantTitle: null,
            quantity: 1,
            refundAmount: '0.00',
          },
        ],
        createdAt: '2026-05-13T04:44:00Z',
        updatedAt: '2026-05-13T04:44:00Z',
      },
    ]);
    const routes = new Map<string, (request: { vendorContext?: { vendorId?: string }; query?: unknown }) => unknown>();
    const app = {
      get: vi.fn((path: string, _options: unknown, handler: (request: { vendorContext?: { vendorId?: string }; query?: unknown }) => unknown) => {
        routes.set(path, handler);
      }),
      post: vi.fn(),
    };

    registerReturnsRoutes(app as never, {} as never);
    const response = await routes.get('/returns')?.({
      vendorContext: { vendorId: 'sporjinal' },
      query: {},
    });

    expect(response).toEqual([
      expect.objectContaining({
        itemTitle: 'Nike Swoosh Medium Support Kadın Beyaz Sütyen / Beyaz / S',
        displayTitle: 'Nike Swoosh Medium Support Kadın Beyaz Sütyen / Beyaz / S',
        variantTitle: null,
        reason: 'SIZE_TOO_LARGE',
        returnReasonNote: 'Beden büyük geldi.',
        returnCarrierName: 'Yurtiçi Kargo',
        returnTrackingNumber: 'returnkargo-123',
        returnTrackingUrl: 'https://tracking.example/returnkargo-123',
        refundedItems: [
          expect.objectContaining({
            displayTitle: 'Nike Swoosh Medium Support Kadın Beyaz Sütyen / Beyaz / S',
          }),
        ],
      }),
    ]);
  });

  it('registers an admin-only Shopify return reason backfill route', async () => {
    backfillShopifyReturnReasonsMock.mockResolvedValueOnce({ dryRun: true, scanned: 0, results: [] });
    const posts = new Map<string, (request: { authUser?: { role?: string }; body?: unknown }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => unknown>();
    const app = {
      get: vi.fn(),
      post: vi.fn((path: string, _options: unknown, handler: (request: { authUser?: { role?: string }; body?: unknown }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => unknown) => {
        posts.set(path, handler);
      }),
    };
    const reply = {
      code: vi.fn((status: number) => ({
        send: vi.fn((body: unknown) => ({ status, body })),
      })),
    };

    registerReturnsRoutes(app as never, {} as never);
    const blocked = await posts.get('/admin/returns/reasons/backfill')?.({
      authUser: { role: 'vendor' },
      body: { dryRun: true },
    }, reply);
    const allowed = await posts.get('/admin/returns/reasons/backfill')?.({
      authUser: { role: 'admin' },
      body: { dryRun: true },
    }, reply);

    expect(blocked).toEqual({ status: 403, body: { message: 'Admin access required.' } });
    expect(allowed).toEqual({ dryRun: true, scanned: 0, results: [] });
    expect(backfillShopifyReturnReasonsMock).toHaveBeenCalledWith({}, { dryRun: true });
  });

  it('keeps the existing Shopify return reason backfill default when limit is missing', async () => {
    backfillShopifyReturnReasonsMock.mockResolvedValueOnce({ dryRun: true, scanned: 0, results: [] });
    const posts = createRegisteredPostRoutes();

    const response = await posts.get('/admin/returns/reasons/backfill')?.({
      authUser: { role: 'admin' },
      body: { dryRun: true },
    }, createReply());

    expect(response).toEqual({ dryRun: true, scanned: 0, results: [] });
    expect(backfillShopifyReturnReasonsMock).toHaveBeenCalledWith({}, { dryRun: true });
  });

  it('accepts a valid Shopify return reason backfill integer limit without changing the response shape', async () => {
    backfillShopifyReturnReasonsMock.mockResolvedValueOnce({ dryRun: true, scanned: 2, results: [] });
    const posts = createRegisteredPostRoutes();

    const response = await posts.get('/admin/returns/reasons/backfill')?.({
      authUser: { role: 'admin' },
      body: { dryRun: true, limit: 25 },
    }, createReply());

    expect(response).toEqual({ dryRun: true, scanned: 2, results: [] });
    expect(backfillShopifyReturnReasonsMock).toHaveBeenCalledWith({}, { dryRun: true, limit: 25 });
  });

  it.each([
    ['below min', 0],
    ['negative', -1],
    ['above max', 201],
    ['string', '25'],
    ['object', { value: 25 }],
    ['array', [25]],
    ['null', null],
    ['decimal', 1.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('rejects %s Shopify return reason backfill limit values', async (_label, limit) => {
    const posts = createRegisteredPostRoutes();

    const response = await posts.get('/admin/returns/reasons/backfill')?.({
      authUser: { role: 'admin' },
      body: { dryRun: true, limit },
    }, createReply());

    expect(response).toEqual({ status: 400, body: { message: 'limit must be an integer between 1 and 200.' } });
    expect(backfillShopifyReturnReasonsMock).not.toHaveBeenCalled();
  });

  it('registers an admin-only duplicate return cleanup dry-run route', async () => {
    cleanupDuplicateReturnRecordsMock.mockResolvedValueOnce({ dryRun: true, scannedPairs: 1, duplicatePairs: [] });
    const posts = new Map<string, (request: { authUser?: { role?: string }; body?: unknown }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => unknown>();
    const app = {
      get: vi.fn(),
      post: vi.fn((path: string, _options: unknown, handler: (request: { authUser?: { role?: string }; body?: unknown }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => unknown) => {
        posts.set(path, handler);
      }),
    };
    const reply = {
      code: vi.fn((status: number) => ({
        send: vi.fn((body: unknown) => ({ status, body })),
      })),
    };

    registerReturnsRoutes(app as never, {} as never);
    const blocked = await posts.get('/admin/returns/duplicates/cleanup')?.({
      authUser: { role: 'vendor' },
      body: { dryRun: true },
    }, reply);
    const allowed = await posts.get('/admin/returns/duplicates/cleanup')?.({
      authUser: { role: 'admin' },
      body: { dryRun: true },
    }, reply);

    expect(blocked).toEqual({ status: 403, body: { message: 'Admin access required.' } });
    expect(allowed).toEqual({ dryRun: true, scannedPairs: 1, duplicatePairs: [] });
    expect(cleanupDuplicateReturnRecordsMock).toHaveBeenCalledWith({ dryRun: true });
  });

  it('keeps the existing duplicate return cleanup default when limit is missing', async () => {
    cleanupDuplicateReturnRecordsMock.mockResolvedValueOnce({ dryRun: true, scannedPairs: 1, duplicatePairs: [] });
    const posts = createRegisteredPostRoutes();

    const response = await posts.get('/admin/returns/duplicates/cleanup')?.({
      authUser: { role: 'admin' },
      body: { dryRun: true },
    }, createReply());

    expect(response).toEqual({ dryRun: true, scannedPairs: 1, duplicatePairs: [] });
    expect(cleanupDuplicateReturnRecordsMock).toHaveBeenCalledWith({ dryRun: true });
  });

  it('accepts a valid duplicate return cleanup integer limit without changing the response shape', async () => {
    cleanupDuplicateReturnRecordsMock.mockResolvedValueOnce({ dryRun: true, scannedPairs: 2, duplicatePairs: [] });
    const posts = createRegisteredPostRoutes();

    const response = await posts.get('/admin/returns/duplicates/cleanup')?.({
      authUser: { role: 'admin' },
      body: { dryRun: true, limit: 25 },
    }, createReply());

    expect(response).toEqual({ dryRun: true, scannedPairs: 2, duplicatePairs: [] });
    expect(cleanupDuplicateReturnRecordsMock).toHaveBeenCalledWith({ dryRun: true, limit: 25 });
  });

  it.each([
    ['below min', 0],
    ['negative', -1],
    ['above max', 501],
    ['string', '25'],
    ['object', { value: 25 }],
    ['array', [25]],
    ['null', null],
    ['decimal', 1.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('rejects %s duplicate return cleanup limit values', async (_label, limit) => {
    const posts = createRegisteredPostRoutes();

    const response = await posts.get('/admin/returns/duplicates/cleanup')?.({
      authUser: { role: 'admin' },
      body: { dryRun: true, limit },
    }, createReply());

    expect(response).toEqual({ status: 400, body: { message: 'limit must be an integer between 1 and 500.' } });
    expect(cleanupDuplicateReturnRecordsMock).not.toHaveBeenCalled();
  });

  it('registers vendor return review actions without Shopify refund execution', async () => {
    markReturnReceivedMock.mockResolvedValueOnce({ id: 'return-1', vendorReceivedAt: '2026-05-14T10:00:00Z' });
    reviewReturnMock.mockResolvedValueOnce({ id: 'return-1', vendorDecision: 'approved' });
    const posts = new Map<string, (request: { authUser?: { role?: string }; headers?: Record<string, string>; params: { returnId: string }; body?: unknown }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => unknown>();
    const app = {
      get: vi.fn(),
      post: vi.fn((path: string, _options: unknown, handler: (request: { authUser?: { role?: string }; headers?: Record<string, string>; params: { returnId: string }; body?: unknown }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => unknown) => {
        posts.set(path, handler);
      }),
    };
    const reply = {
      code: vi.fn((status: number) => ({
        send: vi.fn((body: unknown) => ({ status, body })),
      })),
    };

    registerReturnsRoutes(app as never, {} as never);
    const received = await posts.get('/returns/:returnId/mark-received')?.({
      authUser: { role: 'vendor' },
      headers: { 'x-vendor-id': 'sporjinal' },
      params: { returnId: 'return-1' },
    }, reply);
    const reviewed = await posts.get('/returns/:returnId/review')?.({
      authUser: { role: 'vendor' },
      headers: { 'x-vendor-id': 'sporjinal' },
      params: { returnId: 'return-1' },
      body: { decision: 'approved' },
    }, reply);

    expect(received).toEqual({ id: 'return-1', vendorReceivedAt: '2026-05-14T10:00:00Z' });
    expect(reviewed).toEqual({ id: 'return-1', vendorDecision: 'approved' });
    expect(markReturnReceivedMock).toHaveBeenCalledWith('return-1', { role: 'vendor', vendorId: 'sporjinal' });
    expect(reviewReturnMock).toHaveBeenCalledWith('return-1', { role: 'vendor', vendorId: 'sporjinal' }, {
      decision: 'approved',
      reason: undefined,
    });
  });
});
