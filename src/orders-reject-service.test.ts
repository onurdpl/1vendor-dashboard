import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  vendorAllocation: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  allocationAssignmentHistory: {
    create: vi.fn(),
  },
  webhookEvent: {
    findMany: vi.fn(),
  },
}));

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: prismaMock,
}));

const { rejectVendorOrderAllocation, OrderRejectValidationError } = await import('../backend/src/modules/orders/orders.service.js');

function buildRejectAllocation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'alloc-1088',
    assignedVendorId: 'yalispor',
    allocationStatus: 'ACTIVE',
    fulfillmentStatus: 'Pending',
    shippingStatus: 'Awaiting Shipment',
    trackingNumber: null,
    carrier: null,
    fulfillment: null,
    shipmentExecutions: [],
    ...overrides,
  };
}

function buildDetailAllocation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'alloc-1088',
    assignedVendorId: 'yalispor',
    originalVendorId: 'yalispor',
    allocationStatus: 'VENDOR_BLOCKED',
    fulfillmentStatus: 'Pending',
    shippingStatus: 'Awaiting Shipment',
    carrier: null,
    trackingNumber: null,
    vendorIntegrationTrackingUrl: null,
    vendorIntegrationShippedAt: null,
    reassignmentRequired: true,
    cancellationReason: 'OUT_OF_STOCK',
    vendorIntegrationStatus: null,
    vendorIntegrationStatusMessage: null,
    vendorIntegrationStatusUpdatedAt: null,
    vendorIntegrationProvider: null,
    vendorInvoiceNumber: null,
    vendorInvoiceDate: null,
    vendorInvoiceUrl: null,
    vendorInvoiceAmount: null,
    vendorInvoiceReceivedAt: null,
    createdAt: new Date('2026-06-21T08:00:00.000Z'),
    updatedAt: new Date('2026-06-21T08:05:00.000Z'),
    order: {
      id: 'shopify-order-db-1088',
      sourceShopifyOrderId: 'gid://shopify/Order/1088',
      sourceShopifyOrderNumber: '#1088',
      customerName: 'Customer',
      shopifyCreatedAt: new Date('2026-06-21T07:55:00.000Z'),
      currency: 'TRY',
      financialStatus: 'paid',
      paymentGatewayName: 'PayTR',
      taxesIncluded: true,
      orderTaxAmount: null,
      shippingAmount: null,
      discountAmount: null,
      orderNote: null,
      orderTags: [],
      billingFullName: null,
      billingCompany: null,
      billingPhone: null,
      billingCity: null,
      billingDistrict: null,
      billingAddress1: null,
      billingAddress2: null,
      billingPostcode: null,
      customerPhone: null,
      shippingAddress: null,
      shippingCity: null,
      shippingDistrict: null,
      shippingPostcode: null,
      shippingCountry: 'TR',
    },
    fulfillment: null,
    shipmentExecutions: [],
    lineItems: [
      {
        id: 'allocation-line-1',
        quantity: 1,
        lineAmount: '1000.00',
        shopifyOrderLineItem: {
          id: 'shopify-line-db-1',
          sourceLineItemId: 'gid://shopify/LineItem/1',
          sourceVariantId: 'gid://shopify/ProductVariant/1',
          sku: 'SKU-1088',
          title: 'Product',
          imageUrl: null,
          shopifyProductId: null,
          unitPriceVatIncluded: null,
          lineTotalVatIncluded: null,
          lineTaxAmount: null,
          vatRate: null,
        },
      },
    ],
    assignmentHistory: [
      {
        id: 'history-1',
        action: 'vendor_blocked',
        fromVendorId: 'yalispor',
        toVendorId: 'yalispor',
        reason: 'OUT_OF_STOCK: Missing stock',
        actorUserId: 'user-1',
        createdAt: new Date('2026-06-21T08:05:00.000Z'),
      },
    ],
    ...overrides,
  };
}

describe('vendor order reject operational hold', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (callback) => callback(prismaMock));
    prismaMock.webhookEvent.findMany.mockResolvedValue([]);
  });

  it('lets a vendor reject their own active allocation and records assignment history', async () => {
    prismaMock.vendorAllocation.findFirst
      .mockResolvedValueOnce(buildRejectAllocation())
      .mockResolvedValueOnce(buildDetailAllocation());

    const result = await rejectVendorOrderAllocation('yalispor', 'alloc-1088', {
      reason: 'OUT_OF_STOCK',
      note: 'Missing stock',
      actorUserId: 'user-1',
    });

    expect(prismaMock.vendorAllocation.update).toHaveBeenCalledWith({
      where: { id: 'alloc-1088' },
      data: {
        allocationStatus: 'VENDOR_BLOCKED',
        reassignmentRequired: true,
        cancellationReason: 'OUT_OF_STOCK',
      },
    });
    expect(prismaMock.allocationAssignmentHistory.create).toHaveBeenCalledWith({
      data: {
        vendorAllocationId: 'alloc-1088',
        action: 'vendor_blocked',
        fromVendorId: 'yalispor',
        toVendorId: 'yalispor',
        reason: 'OUT_OF_STOCK: Missing stock',
        actorUserId: 'user-1',
      },
    });
    expect(result.allocationStatus).toBe('VENDOR_BLOCKED');
    expect(result.reassignmentRequired).toBe(true);
    expect(result.cancellationReason).toBe('OUT_OF_STOCK');
  });

  it('blocks another vendor from rejecting the allocation', async () => {
    prismaMock.vendorAllocation.findFirst.mockResolvedValueOnce(buildRejectAllocation({ assignedVendorId: 'sporjinal' }));

    await expect(
      rejectVendorOrderAllocation('yalispor', 'alloc-1088', {
        reason: 'OUT_OF_STOCK',
        note: 'Missing stock',
      }),
    ).rejects.toMatchObject({ statusCode: 404 });

    expect(prismaMock.vendorAllocation.update).not.toHaveBeenCalled();
    expect(prismaMock.allocationAssignmentHistory.create).not.toHaveBeenCalled();
  });

  it('blocks already blocked allocations from being rejected again', async () => {
    prismaMock.vendorAllocation.findFirst.mockResolvedValueOnce(buildRejectAllocation({ allocationStatus: 'VENDOR_BLOCKED' }));

    await expect(
      rejectVendorOrderAllocation('yalispor', 'alloc-1088', {
        reason: 'OUT_OF_STOCK',
        note: 'Missing stock',
      }),
    ).rejects.toMatchObject({ statusCode: 409 });

    expect(prismaMock.vendorAllocation.update).not.toHaveBeenCalled();
  });

  it.each([
    ['fulfilled allocation', { fulfillmentStatus: 'Fulfilled' }],
    ['shipped allocation', { shippingStatus: 'Shipped' }],
    ['tracked allocation', { trackingNumber: 'TRK-1' }],
    ['carrier allocation', { carrier: 'Yurtiçi Kargo' }],
  ])('blocks %s from being rejected', async (_label, overrides) => {
    prismaMock.vendorAllocation.findFirst.mockResolvedValueOnce(buildRejectAllocation(overrides));

    await expect(
      rejectVendorOrderAllocation('yalispor', 'alloc-1088', {
        reason: 'OUT_OF_STOCK',
        note: 'Missing stock',
      }),
    ).rejects.toMatchObject({ statusCode: 409 });

    expect(prismaMock.vendorAllocation.update).not.toHaveBeenCalled();
  });

  it('requires a valid reason', async () => {
    await expect(
      rejectVendorOrderAllocation('yalispor', 'alloc-1088', {
        reason: '',
        note: 'Missing stock',
      }),
    ).rejects.toBeInstanceOf(OrderRejectValidationError);

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('requires a non-empty note', async () => {
    await expect(
      rejectVendorOrderAllocation('yalispor', 'alloc-1088', {
        reason: 'OUT_OF_STOCK',
        note: '   ',
      }),
    ).rejects.toMatchObject({ message: 'Reject note is required.' });

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});
