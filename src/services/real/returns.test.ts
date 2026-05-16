import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listReturns } from './returns';

const apiClientGet = vi.hoisted(() => vi.fn());

vi.mock('../../lib/api-client', () => ({
  apiClient: {
    get: apiClientGet,
  },
}));

describe('real returns service item title mapping', () => {
  beforeEach(() => {
    apiClientGet.mockReset();
  });

  it('maps returned item titles from the backend response', async () => {
    apiClientGet.mockResolvedValueOnce([
      {
        id: 'return-1',
        sourceShopifyOrderId: 'gid://shopify/Order/1023',
        sourceShopifyOrderNumber: '#1023',
        sourceShopifyRefundId: '',
        sourceShopifyReturnId: '23165600081',
        sourceShopifyReturnGid: 'gid://shopify/Return/23165600081',
        returnLifecycleStatus: 'requested',
        returnRequestSource: 'shopify_return_request',
        vendorId: 'sporjinal',
        assignedVendorId: 'sporjinal',
        status: 'requested',
        refundAmount: '0.00',
        refundedItemCount: 1,
        refundedSkus: ['DJ1196-002-40,5'],
        refundedItems: [
          {
            id: 'line-1',
            sourceLineItemId: 'line-1',
            sourceVariantId: null,
            sku: 'DJ1196-002-40,5',
            title: 'Nike Defy All Day Erkek Siyah Antrenman Ayakkabisi',
            quantity: 1,
            refundAmount: '0.00',
          },
        ],
        createdAt: '2026-05-13T04:44:00Z',
        updatedAt: '2026-05-13T04:44:00Z',
      },
    ]);

    const returns = await listReturns();

    expect(returns[0].refundedItems?.[0]?.name).toBe('Nike Defy All Day Erkek Siyah Antrenman Ayakkabisi');
    expect(returns[0].refundedItems?.[0]?.name).not.toBe('Return item');
  });

  it('falls back to SKU when a returned item title is unavailable', async () => {
    apiClientGet.mockResolvedValueOnce([
      {
        id: 'return-2',
        sourceShopifyOrderId: 'gid://shopify/Order/1024',
        sourceShopifyOrderNumber: '#1024',
        sourceShopifyRefundId: '',
        sourceShopifyReturnId: '23165600082',
        sourceShopifyReturnGid: 'gid://shopify/Return/23165600082',
        returnLifecycleStatus: 'requested',
        returnRequestSource: 'shopify_return_request',
        vendorId: 'sporjinal',
        assignedVendorId: 'sporjinal',
        status: 'requested',
        refundAmount: '0.00',
        refundedItemCount: 1,
        refundedSkus: ['SKU-ONLY'],
        refundedItems: [
          {
            id: 'line-2',
            sourceLineItemId: 'line-2',
            sourceVariantId: null,
            sku: 'SKU-ONLY',
            title: null,
            quantity: 1,
            refundAmount: '0.00',
          },
        ],
        createdAt: '2026-05-13T04:44:00Z',
        updatedAt: '2026-05-13T04:44:00Z',
      },
    ]);

    const returns = await listReturns();

    expect(returns[0].refundedItems?.[0]?.name).toBe('SKU-ONLY');
    expect(returns[0].refundedItems?.[0]?.name).not.toBe('Return item');
  });

  it('uses variant title before SKU when title is unavailable but variant is descriptive', async () => {
    apiClientGet.mockResolvedValueOnce([
      {
        id: 'return-3',
        sourceShopifyOrderId: 'gid://shopify/Order/1025',
        sourceShopifyOrderNumber: '#1025',
        sourceShopifyRefundId: '',
        sourceShopifyReturnId: '23165600083',
        sourceShopifyReturnGid: 'gid://shopify/Return/23165600083',
        returnLifecycleStatus: 'requested',
        returnRequestSource: 'shopify_return_request',
        vendorId: 'sporjinal',
        assignedVendorId: 'sporjinal',
        status: 'requested',
        refundAmount: '0.00',
        refundedItemCount: 1,
        refundedSkus: ['DJ1196-002-40,5'],
        refundedItems: [
          {
            id: 'line-3',
            sourceLineItemId: 'line-3',
            sourceVariantId: null,
            sku: 'DJ1196-002-40,5',
            title: null,
            name: 'DJ1196-002-40,5',
            variantTitle: 'Nike Defy All Day Erkek Siyah Antrenman Ayakkabısı / Siyah / 40,5',
            quantity: 1,
            refundAmount: '0.00',
          },
        ],
        createdAt: '2026-05-13T04:44:00Z',
        updatedAt: '2026-05-13T04:44:00Z',
      },
    ]);

    const returns = await listReturns();

    expect(returns[0].refundedItems?.[0]?.name).toBe('Nike Defy All Day Erkek Siyah Antrenman Ayakkabısı / Siyah / 40,5');
    expect(returns[0].refundedItems?.[0]?.sku).toBe('DJ1196-002-40,5');
  });

  it('uses order line title when refund title is only the SKU', async () => {
    apiClientGet.mockResolvedValueOnce([
      {
        id: 'return-4',
        sourceShopifyOrderId: 'gid://shopify/Order/1026',
        sourceShopifyOrderNumber: '#1026',
        sourceShopifyRefundId: '',
        sourceShopifyReturnId: '23165600084',
        sourceShopifyReturnGid: 'gid://shopify/Return/23165600084',
        returnLifecycleStatus: 'requested',
        returnRequestSource: 'shopify_return_request',
        vendorId: 'sporjinal',
        assignedVendorId: 'sporjinal',
        status: 'requested',
        refundAmount: '0.00',
        refundedItemCount: 1,
        refundedSkus: ['DJ1196-002-40,5'],
        refundedItems: [
          {
            id: 'line-4',
            sourceLineItemId: 'line-4',
            sourceVariantId: '1234567890123',
            sku: 'DJ1196-002-40,5',
            title: 'DJ1196-002-40,5',
            orderLineItemTitle: 'Nike Defy All Day Erkek Siyah Antrenman Ayakkabısı / Siyah / 40,5',
            quantity: 1,
            refundAmount: '0.00',
          },
        ],
        createdAt: '2026-05-13T04:44:00Z',
        updatedAt: '2026-05-13T04:44:00Z',
      },
    ]);

    const returns = await listReturns();

    expect(returns[0].refundedItems?.[0]?.name).toBe('Nike Defy All Day Erkek Siyah Antrenman Ayakkabısı / Siyah / 40,5');
    expect(returns[0].refundedItems?.[0]?.variantTitle).toBe('Details pending');
  });

  it('ignores Shopify Default placeholders when resolving item titles', async () => {
    apiClientGet.mockResolvedValueOnce([
      {
        id: 'return-default-placeholder',
        sourceShopifyOrderId: 'gid://shopify/Order/1026',
        sourceShopifyOrderNumber: '#1026',
        sourceShopifyRefundId: '',
        sourceShopifyReturnId: '23165600084',
        sourceShopifyReturnGid: 'gid://shopify/Return/23165600084',
        returnLifecycleStatus: 'requested',
        returnRequestSource: 'shopify_return_request',
        vendorId: 'sporjinal',
        assignedVendorId: 'sporjinal',
        status: 'requested',
        refundAmount: '0.00',
        refundedItemCount: 1,
        refundedSkus: ['DJ1196-002-40,5'],
        refundedItems: [
          {
            id: 'line-default',
            sourceLineItemId: 'line-default',
            sourceVariantId: null,
            sku: 'DJ1196-002-40,5',
            title: 'Default',
            orderLineItemTitle: 'Nike Defy All Day Erkek Siyah Antrenman Ayakkabısı',
            variantTitle: 'Default Title',
            quantity: 1,
            refundAmount: '0.00',
          },
        ],
        createdAt: '2026-05-13T04:44:00Z',
        updatedAt: '2026-05-13T04:44:00Z',
      },
    ]);

    const returns = await listReturns();

    expect(returns[0].refundedItems?.[0]?.name).toBe('Nike Defy All Day Erkek Siyah Antrenman Ayakkabısı');
    expect(returns[0].refundedItems?.[0]?.name).not.toBe('Default');
    expect(returns[0].refundedItems?.[0]?.variantTitle).toBe('Details pending');
  });

  it('strips trailing Default Title from product titles', async () => {
    apiClientGet.mockResolvedValueOnce([
      {
        id: 'return-default-title-suffix',
        sourceShopifyOrderId: 'gid://shopify/Order/1026',
        sourceShopifyOrderNumber: '#1026',
        sourceShopifyRefundId: '',
        sourceShopifyReturnId: '23165600084',
        sourceShopifyReturnGid: 'gid://shopify/Return/23165600084',
        returnLifecycleStatus: 'requested',
        returnRequestSource: 'shopify_return_request',
        vendorId: 'sporjinal',
        assignedVendorId: 'sporjinal',
        status: 'requested',
        refundAmount: '0.00',
        refundedItemCount: 1,
        refundedSkus: ['DJ1196-002-40,5'],
        refundedItems: [
          {
            id: 'line-default-title',
            sourceLineItemId: 'line-default-title',
            sourceVariantId: null,
            sku: 'DJ1196-002-40,5',
            title: 'Nike Court Vision Kadın Krem Günlük Ayakkabı / Default Title',
            quantity: 1,
            refundAmount: '0.00',
          },
        ],
        createdAt: '2026-05-13T04:44:00Z',
        updatedAt: '2026-05-13T04:44:00Z',
      },
    ]);

    const returns = await listReturns();

    expect(returns[0].refundedItems?.[0]?.name).toBe('Nike Court Vision Kadın Krem Günlük Ayakkabı');
  });

  it('keeps descriptive variant titles when product titles are missing', async () => {
    apiClientGet.mockResolvedValueOnce([
      {
        id: 'return-descriptive-variant',
        sourceShopifyOrderId: 'gid://shopify/Order/1026',
        sourceShopifyOrderNumber: '#1026',
        sourceShopifyRefundId: '',
        sourceShopifyReturnId: '23165600084',
        sourceShopifyReturnGid: 'gid://shopify/Return/23165600084',
        returnLifecycleStatus: 'requested',
        returnRequestSource: 'shopify_return_request',
        vendorId: 'sporjinal',
        assignedVendorId: 'sporjinal',
        status: 'requested',
        refundAmount: '0.00',
        refundedItemCount: 1,
        refundedSkus: ['DJ1196-002-40,5'],
        refundedItems: [
          {
            id: 'line-descriptive-variant',
            sourceLineItemId: 'line-descriptive-variant',
            sourceVariantId: null,
            sku: 'DJ1196-002-40,5',
            title: null,
            variantTitle: 'Nike Defy All Day Erkek Siyah Antrenman Ayakkabısı / Siyah / 40,5',
            quantity: 1,
            refundAmount: '0.00',
          },
        ],
        createdAt: '2026-05-13T04:44:00Z',
        updatedAt: '2026-05-13T04:44:00Z',
      },
    ]);

    const returns = await listReturns();

    expect(returns[0].refundedItems?.[0]?.name).toBe('Nike Defy All Day Erkek Siyah Antrenman Ayakkabısı / Siyah / 40,5');
  });

  it('falls back to Unknown item when no title or SKU exists', async () => {
    apiClientGet.mockResolvedValueOnce([
      {
        id: 'return-unknown-item',
        sourceShopifyOrderId: 'gid://shopify/Order/1026',
        sourceShopifyOrderNumber: '#1026',
        sourceShopifyRefundId: '',
        sourceShopifyReturnId: '23165600084',
        sourceShopifyReturnGid: 'gid://shopify/Return/23165600084',
        returnLifecycleStatus: 'requested',
        returnRequestSource: 'shopify_return_request',
        vendorId: 'sporjinal',
        assignedVendorId: 'sporjinal',
        status: 'requested',
        refundAmount: '0.00',
        refundedItemCount: 1,
        refundedSkus: [],
        refundedItems: [
          {
            id: 'line-unknown',
            sourceLineItemId: 'line-unknown',
            sourceVariantId: null,
            sku: null,
            title: 'Default',
            variantTitle: 'Default Title',
            quantity: 1,
            refundAmount: '0.00',
          },
        ],
        createdAt: '2026-05-13T04:44:00Z',
        updatedAt: '2026-05-13T04:44:00Z',
      },
    ]);

    const returns = await listReturns();

    expect(returns[0].refundedItems?.[0]?.name).toBe('Unknown item');
  });

  it('maps minimal list summary item titles when refunded items are omitted', async () => {
    apiClientGet.mockResolvedValueOnce([
      {
        id: 'return-5',
        sourceShopifyOrderId: 'gid://shopify/Order/1027',
        sourceShopifyOrderNumber: '#1027',
        sourceShopifyRefundId: '',
        sourceShopifyReturnId: '23165600085',
        sourceShopifyReturnGid: 'gid://shopify/Return/23165600085',
        returnLifecycleStatus: 'requested',
        returnRequestSource: 'shopify_return_request',
        vendorId: 'sporjinal',
        assignedVendorId: 'sporjinal',
        status: 'requested',
        refundAmount: '0.00',
        refundedItemCount: 1,
        refundedSkus: ['DJ1196-002-40,5'],
        itemTitle: 'Nike Court Vision Kadın Krem Günlük Ayakkabı',
        displayTitle: 'Nike Court Vision Kadın Krem Günlük Ayakkabı',
        variantTitle: 'Krem / 36.5',
        createdAt: '2026-05-13T04:44:00Z',
        updatedAt: '2026-05-13T04:44:00Z',
      },
    ]);

    const returns = await listReturns();

    expect(returns[0].itemTitle).toBe('Nike Court Vision Kadın Krem Günlük Ayakkabı');
    expect(returns[0].refundedItems?.[0]?.name).toBe('Nike Court Vision Kadın Krem Günlük Ayakkabı');
    expect(returns[0].refundedItems?.[0]?.sku).toBe('DJ1196-002-40,5');
  });
});
