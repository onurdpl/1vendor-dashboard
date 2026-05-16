import { describe, expect, it, vi } from 'vitest';
import { registerReturnsRoutes } from '../backend/src/modules/returns/returns.routes.js';

const listVendorReturnsMock = vi.hoisted(() => vi.fn());
const backfillShopifyReturnReasonsMock = vi.hoisted(() => vi.fn());

vi.mock('../backend/src/modules/returns/returns.service.js', () => ({
  getVendorReturnById: vi.fn(),
  listVendorReturns: listVendorReturnsMock,
}));

vi.mock('../backend/src/modules/returns/return-reason-backfill.service.js', () => ({
  backfillShopifyReturnReasons: backfillShopifyReturnReasonsMock,
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

describe('backend returns list route contract', () => {
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
});
