import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  returnRecord: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
  },
  shopifyOrderLineItem: {
    updateMany: vi.fn(),
  },
}));

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: prismaMock,
}));

const { listVendorReturns, getVendorReturnById } = await import('../backend/src/modules/returns/returns.service.js');

function buildReturnRecord() {
  const orderLineItem = {
    id: 'shopify-line-1',
    sourceLineItemId: 'line-1',
    sourceVariantId: 'variant-1',
    sku: 'SKU-1',
    title: 'Running Shoe',
    imageUrl: 'https://cdn.example.com/running-shoe.png',
  };

  return {
    id: 'return-1',
    sourceShopifyOrderId: 'gid://shopify/Order/1',
    sourceShopifyOrderNumber: '#1001',
    sourceShopifyRefundId: null,
    sourceShopifyReturnId: 'return-remote-1',
    sourceShopifyReturnGid: 'gid://shopify/Return/1',
    sourceShopifyLineItemId: 'line-1',
    returnLifecycleStatus: 'approved',
    returnRequestSource: 'shopify_return_request',
    requestCreatedAt: new Date('2026-05-01T08:00:00.000Z'),
    requestUpdatedAt: new Date('2026-05-01T09:00:00.000Z'),
    status: 'approved',
    reason: 'SIZE_TOO_LARGE',
    returnReasonNote: 'Too large.',
    returnProvider: 'navlungo',
    returnProviderShipmentId: 'RET-POST-1',
    returnLabel: 'barcode-data',
    returnReferenceId: 'SP-RET-1001-ABC123',
    navlungoReturnCreatedAt: new Date('2026-05-01T10:00:00.000Z'),
    returnProviderSnapshot: {
      rawProviderDiagnostics: 'detail-only',
    },
    returnCarrierName: 'Sürat Kargo',
    returnTrackingNumber: 'TRACK-1',
    returnTrackingUrl: 'https://tracking.example/return/1',
    vendorReceivedAt: null,
    vendorReviewedAt: null,
    vendorDecision: null,
    vendorDecisionReason: null,
    createdAt: new Date('2026-05-01T08:00:00.000Z'),
    updatedAt: new Date('2026-05-01T10:00:00.000Z'),
    vendorAllocation: {
      assignedVendorId: 'sporjinal',
      originalVendorId: 'sporjinal',
      sourceShopifyOrderId: 'gid://shopify/Order/1',
      sourceShopifyOrderNumber: '#1001',
      order: {
        sourceShopifyOrderId: 'gid://shopify/Order/1',
      },
      lineItems: [
        {
          id: 'alloc-line-1',
          quantity: 1,
          lineAmount: 1299.9,
          shopifyOrderLineItem: orderLineItem,
        },
      ],
      refundRecords: [],
    },
  };
}

describe('returns list payload optimization', () => {
  beforeEach(() => {
    prismaMock.returnRecord.findMany.mockReset();
    prismaMock.returnRecord.findFirst.mockReset();
    prismaMock.shopifyOrderLineItem.updateMany.mockReset();
  });

  it('omits heavy return provider snapshots from list summaries', async () => {
    prismaMock.returnRecord.findMany.mockResolvedValueOnce([buildReturnRecord()]);

    const result = await listVendorReturns('sporjinal', { limit: 25, offset: 0 });

    expect(prismaMock.returnRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.not.objectContaining({
          returnProviderSnapshot: true,
        }),
        take: 25,
        skip: 0,
      }),
    );
    expect(result[0]).toEqual(
      expect.objectContaining({
        id: 'return-1',
        returnProvider: 'navlungo',
        returnProviderShipmentId: 'RET-POST-1',
        returnTrackingUrl: 'https://tracking.example/return/1',
      }),
    );
    expect(result[0]).not.toHaveProperty('returnProviderSnapshot');
  });

  it('keeps return provider snapshots on detail responses', async () => {
    prismaMock.returnRecord.findFirst.mockResolvedValueOnce(buildReturnRecord());

    const result = await getVendorReturnById('sporjinal', 'return-1');

    expect(result?.returnProviderSnapshot).toEqual(
      expect.objectContaining({
        rawProviderDiagnostics: 'detail-only',
      }),
    );
  });

  it('threads stored Shopify line item images into return list summaries', async () => {
    prismaMock.returnRecord.findMany.mockResolvedValueOnce([buildReturnRecord()]);

    const result = await listVendorReturns('sporjinal', { limit: 25, offset: 0 });

    expect(result[0]?.refundedItems[0]).toEqual(
      expect.objectContaining({
        imageUrl: 'https://cdn.example.com/running-shoe.png',
      }),
    );
  });

  it('threads stored Shopify line item images into return detail items', async () => {
    prismaMock.returnRecord.findFirst.mockResolvedValueOnce(buildReturnRecord());

    const result = await getVendorReturnById('sporjinal', 'return-1');

    expect(result?.refundedItems[0]).toEqual(
      expect.objectContaining({
        imageUrl: 'https://cdn.example.com/running-shoe.png',
      }),
    );
  });

  it('falls back to the original allocation line item image for refund return items', async () => {
    const record = buildReturnRecord();
    record.returnRequestSource = 'shopify_refund';
    record.sourceShopifyRefundId = 'gid://shopify/Refund/1';
    record.vendorAllocation.refundRecords = [
      {
        sourceShopifyRefundId: 'gid://shopify/Refund/1',
        amount: 1299.9,
        lineItems: [
          {
            id: 'refund-line-1',
            sourceLineItemId: 'gid://shopify/LineItem/line-1',
            sku: 'SKU-1',
            title: 'Refund row title',
            quantity: 1,
            subtotal: 1299.9,
            shopifyOrderLineItem: {
              sourceVariantId: 'variant-1',
              sku: 'SKU-1',
              title: 'Running Shoe',
              imageUrl: null,
            },
          },
        ],
      },
    ];
    prismaMock.returnRecord.findFirst.mockResolvedValueOnce(record);

    const result = await getVendorReturnById('sporjinal', 'return-1');

    expect(result?.refundedItems[0]).toEqual(
      expect.objectContaining({
        imageUrl: 'https://cdn.example.com/running-shoe.png',
      }),
    );
  });

  it('lazily backfills missing return detail images from the original Shopify order line item lookup', async () => {
    const record = buildReturnRecord();
    record.vendorAllocation.lineItems[0].shopifyOrderLineItem.imageUrl = null;
    prismaMock.returnRecord.findFirst.mockResolvedValueOnce(record);
    prismaMock.shopifyOrderLineItem.updateMany.mockResolvedValue({ count: 1 });
    const shopifyAdminService = {
      fetchOrderLineItemImages: vi.fn().mockResolvedValue({
        orderId: 'gid://shopify/Order/1',
        lineItems: [
          {
            lineItemGid: 'gid://shopify/LineItem/line-1',
            sourceLineItemId: 'line-1',
            sku: 'SKU-1',
            imageUrl: 'https://cdn.example.com/backfilled-running-shoe.png',
            imageSource: 'line_item',
          },
        ],
      }),
    };

    const result = await getVendorReturnById('sporjinal', 'return-1', { shopifyAdminService });

    expect(shopifyAdminService.fetchOrderLineItemImages).toHaveBeenCalledWith('gid://shopify/Order/1');
    expect(prismaMock.shopifyOrderLineItem.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'shopify-line-1',
        imageUrl: null,
      },
      data: {
        imageUrl: 'https://cdn.example.com/backfilled-running-shoe.png',
      },
    });
    expect(result?.refundedItems[0]).toEqual(
      expect.objectContaining({
        imageUrl: 'https://cdn.example.com/backfilled-running-shoe.png',
      }),
    );
  });

  it('can defer return detail image backfill so primary detail payload is not blocked', async () => {
    const record = buildReturnRecord();
    record.vendorAllocation.lineItems[0].shopifyOrderLineItem.imageUrl = null;
    prismaMock.returnRecord.findFirst.mockResolvedValueOnce(record);
    prismaMock.shopifyOrderLineItem.updateMany.mockResolvedValue({ count: 1 });
    let resolveImages: (value: {
      orderId: string;
      lineItems: Array<{
        lineItemGid: string;
        sourceLineItemId: string;
        sku: string;
        imageUrl: string;
        imageSource: string;
      }>;
    }) => void = () => undefined;
    const shopifyAdminService = {
      fetchOrderLineItemImages: vi.fn().mockReturnValue(new Promise((resolve) => {
        resolveImages = resolve;
      })),
    };

    const result = await getVendorReturnById('sporjinal', 'return-1', {
      shopifyAdminService,
      deferImageBackfill: true,
    });

    expect(shopifyAdminService.fetchOrderLineItemImages).toHaveBeenCalledWith('gid://shopify/Order/1');
    expect(result?.refundedItems[0]).toEqual(
      expect.objectContaining({
        imageUrl: null,
      }),
    );

    resolveImages({
      orderId: 'gid://shopify/Order/1',
      lineItems: [
        {
          lineItemGid: 'gid://shopify/LineItem/line-1',
          sourceLineItemId: 'line-1',
          sku: 'SKU-1',
          imageUrl: 'https://cdn.example.com/deferred-running-shoe.png',
          imageSource: 'line_item',
        },
      ],
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(prismaMock.shopifyOrderLineItem.updateMany).toHaveBeenCalled();
  });
});
