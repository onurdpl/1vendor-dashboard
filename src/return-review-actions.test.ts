import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  returnRecord: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: prismaMock,
}));

const { markReturnReceived, reviewReturn } = await import('../backend/src/modules/returns/returns.service.js');

function accessRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'return-1',
    vendorReceivedAt: null,
    vendorAllocation: {
      assignedVendorId: 'vendor-a',
    },
    ...overrides,
  };
}

function detailRecord() {
  return {
    id: 'return-1',
    sourceShopifyOrderId: 'gid://shopify/Order/1',
    sourceShopifyOrderNumber: '#1001',
    sourceShopifyRefundId: null,
    sourceShopifyReturnId: '231',
    sourceShopifyReturnGid: 'gid://shopify/Return/231',
    sourceShopifyLineItemId: 'line-1',
    returnLifecycleStatus: 'requested',
    returnRequestSource: 'shopify_return_request',
    status: 'requested',
    reason: 'Return requested',
    returnReasonNote: null,
    returnCarrierName: null,
    returnTrackingNumber: null,
    returnTrackingUrl: null,
    vendorReceivedAt: new Date('2026-05-14T10:00:00Z'),
    vendorReviewedAt: null,
    vendorDecision: null,
    vendorDecisionReason: null,
    createdAt: new Date('2026-05-13T04:44:00Z'),
    updatedAt: new Date('2026-05-14T10:00:00Z'),
    vendorAllocation: {
      assignedVendorId: 'vendor-a',
      originalVendorId: 'vendor-a',
      sourceShopifyOrderId: 'gid://shopify/Order/1',
      lineItems: [
        {
          id: 'alloc-line-1',
          quantity: 1,
          lineAmount: 0,
          shopifyOrderLineItem: {
            sourceLineItemId: 'line-1',
            sourceVariantId: null,
            sku: 'SKU-1',
            title: 'Test Shoe',
          },
        },
      ],
      refundRecords: [],
    },
  };
}

describe('return vendor review actions', () => {
  beforeEach(() => {
    prismaMock.returnRecord.findUnique.mockReset();
    prismaMock.returnRecord.findFirst.mockReset();
    prismaMock.returnRecord.update.mockReset();
  });

  it('lets a vendor mark their own return received idempotently', async () => {
    prismaMock.returnRecord.findUnique.mockResolvedValueOnce(accessRecord());
    prismaMock.returnRecord.findFirst.mockResolvedValueOnce(detailRecord());
    prismaMock.returnRecord.update.mockResolvedValueOnce({});

    const result = await markReturnReceived('return-1', { role: 'vendor', vendorId: 'vendor-a' });

    expect(prismaMock.returnRecord.update).toHaveBeenCalledWith({
      where: { id: 'return-1' },
      data: { vendorReceivedAt: expect.any(Date) },
    });
    expect(result.vendorReceivedAt).toBe('2026-05-14T10:00:00.000Z');
  });

  it('blocks a vendor from acting on another vendor return', async () => {
    prismaMock.returnRecord.findUnique.mockResolvedValueOnce(accessRecord({ vendorAllocation: { assignedVendorId: 'vendor-b' } }));

    await expect(markReturnReceived('return-1', { role: 'vendor', vendorId: 'vendor-a' })).rejects.toThrow(
      'Return record not found.',
    );
    expect(prismaMock.returnRecord.update).not.toHaveBeenCalled();
  });

  it('lets admin act on any return', async () => {
    prismaMock.returnRecord.findUnique.mockResolvedValueOnce(accessRecord({ vendorAllocation: { assignedVendorId: 'vendor-b' } }));
    prismaMock.returnRecord.findFirst.mockResolvedValueOnce(detailRecord());
    prismaMock.returnRecord.update.mockResolvedValueOnce({});

    await markReturnReceived('return-1', { role: 'admin' });

    expect(prismaMock.returnRecord.update).toHaveBeenCalled();
  });

  it('requires receipt before review', async () => {
    prismaMock.returnRecord.findUnique.mockResolvedValueOnce(accessRecord({ vendorReceivedAt: null }));

    await expect(reviewReturn('return-1', { role: 'vendor', vendorId: 'vendor-a' }, { decision: 'approved' })).rejects.toThrow(
      'Return must be marked received before review.',
    );
    expect(prismaMock.returnRecord.update).not.toHaveBeenCalled();
  });

  it('blocks review mutation for closed refunded returns', async () => {
    prismaMock.returnRecord.findUnique.mockResolvedValueOnce(
      accessRecord({
        status: 'closed',
        returnLifecycleStatus: 'closed',
        returnRequestSource: 'shopify_return_request',
        sourceShopifyRefundId: 'gid://shopify/Refund/1',
        vendorReceivedAt: new Date('2026-05-14T10:00:00Z'),
        vendorReviewedAt: new Date('2026-05-14T10:05:00Z'),
        vendorDecision: 'approved',
        vendorAllocation: {
          assignedVendorId: 'vendor-a',
          refundRecords: [{ id: 'refund-1', sourceShopifyRefundId: 'gid://shopify/Refund/1' }],
        },
      }),
    );

    await expect(reviewReturn('return-1', { role: 'vendor', vendorId: 'vendor-a' }, { decision: 'approved' })).rejects.toMatchObject({
      message: 'Return is already closed and refunded.',
      statusCode: 409,
    });
    expect(prismaMock.returnRecord.update).not.toHaveBeenCalled();
  });

  it('requires a reason for rejected reviews', async () => {
    prismaMock.returnRecord.findUnique.mockResolvedValueOnce(accessRecord({ vendorReceivedAt: new Date('2026-05-14T10:00:00Z') }));

    await expect(reviewReturn('return-1', { role: 'vendor', vendorId: 'vendor-a' }, { decision: 'rejected' })).rejects.toThrow(
      'Rejected returns require a reason.',
    );
    expect(prismaMock.returnRecord.update).not.toHaveBeenCalled();
  });

  it('saves vendor approval without touching refund state', async () => {
    prismaMock.returnRecord.findUnique.mockResolvedValueOnce(accessRecord({ vendorReceivedAt: new Date('2026-05-14T10:00:00Z') }));
    prismaMock.returnRecord.findFirst.mockResolvedValueOnce({
      ...detailRecord(),
      vendorReviewedAt: new Date('2026-05-14T10:05:00Z'),
      vendorDecision: 'approved',
    });
    prismaMock.returnRecord.update.mockResolvedValueOnce({});

    const result = await reviewReturn('return-1', { role: 'vendor', vendorId: 'vendor-a' }, { decision: 'approved' });

    expect(prismaMock.returnRecord.update).toHaveBeenCalledWith({
      where: { id: 'return-1' },
      data: {
        vendorReviewedAt: expect.any(Date),
        vendorDecision: 'approved',
        vendorDecisionReason: null,
      },
    });
    expect(result.vendorDecision).toBe('approved');
  });
});
