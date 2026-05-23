import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  returnRecord: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
  },
}));

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: prismaMock,
}));

const { listVendorReturns, getVendorReturnById } = await import('../backend/src/modules/returns/returns.service.js');

function buildReturnRecord() {
  const orderLineItem = {
    sourceLineItemId: 'line-1',
    sourceVariantId: 'variant-1',
    sku: 'SKU-1',
    title: 'Running Shoe',
  };

  return {
    id: 'return-1',
    sourceShopifyOrderId: 'gid://shopify/Order/1',
    sourceShopifyOrderNumber: '#1001',
    sourceShopifyRefundId: null,
    sourceShopifyReturnId: 'return-remote-1',
    sourceShopifyReturnGid: 'gid://shopify/Return/1',
    sourceShopifyLineItemId: null,
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
});
