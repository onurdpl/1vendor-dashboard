import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  vendorAllocation: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  shopifyOrder: {
    findUnique: vi.fn(),
  },
  allocationAssignmentHistory: {
    create: vi.fn(),
  },
  webhookEvent: {
    findMany: vi.fn(),
  },
}));
const transferAllocationEconomicsMock = vi.hoisted(() => vi.fn());

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: prismaMock,
}));

vi.mock('../backend/src/modules/finance/economic-transfer.service.js', () => ({
  transferAllocationEconomics: transferAllocationEconomicsMock,
}));

const {
  addBlockedAllocationResolutionNote,
  getAdminShopifyOrderBreakdown,
  getVendorOrderById,
  previewShopifyRefundForAdminOrder,
  rejectVendorOrderAllocation,
  requestCancelRefundReviewForAdminOrder,
  returnBlockedAllocationToVendor,
  transferAllocationEconomicsForAdminOrder,
  OrderRejectValidationError,
} = await import('../backend/src/modules/orders/orders.service.js');

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
    cancelRefundReviewStatus: null,
    cancelRefundReviewReason: null,
    cancelRefundReviewNote: null,
    cancelRefundReviewRequestedAt: null,
    cancelRefundReviewRequestedByUserId: null,
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
    economicTransfers: [] as Array<Record<string, unknown>>,
    financeIntegrityAlerts: [] as Array<Record<string, unknown>>,
    ...overrides,
  };
}

function buildReturnableBlockedAllocation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'alloc-1088',
    assignedVendorId: 'yalispor',
    allocationStatus: 'VENDOR_BLOCKED',
    reassignmentRequired: true,
    fulfillmentStatus: 'Pending',
    shippingStatus: 'Awaiting Shipment',
    trackingNumber: null,
    carrier: null,
    fulfillment: null,
    shipmentExecutions: [],
    returnRecords: [],
    refundRecords: [],
    economicTransfers: [],
    ...overrides,
  };
}

function buildRefundPreviewAllocation(overrides: Record<string, unknown> = {}) {
  return {
    ...buildReturnableBlockedAllocation(),
    cancelRefundReviewStatus: 'PENDING_REVIEW',
    order: {
      sourceShopifyOrderId: 'gid://shopify/Order/1088',
    },
    lineItems: [
      {
        id: 'allocation-line-1',
        quantity: 1,
        shopifyOrderLineItem: {
          sourceLineItemId: '20346971095377',
        },
      },
    ],
    financeIntegrityAlerts: [],
    ...overrides,
  };
}

function buildShopifyRefundPreviewService(overrides: Record<string, unknown> = {}) {
  return {
    previewSuggestedRefund: vi.fn().mockResolvedValue({
      orderGid: 'gid://shopify/Order/1088',
      sourceShopifyOrderId: '1088',
      refundLineItemsPreview: [
        {
          lineItemId: 'gid://shopify/LineItem/20346971095377',
          quantity: 1,
          restockType: 'CANCEL',
        },
      ],
      suggestedRefund: {
        totalRefundAmount: '1000.00',
        currencyCode: 'TRY',
        subtotalAmount: '900.00',
        totalTaxAmount: '100.00',
        shippingAmount: null,
        maximumRefundableAmount: '1000.00',
        suggestedTransactions: [
          {
            gateway: 'bogus',
            formattedGateway: '(For Testing) Bogus Gateway',
            amount: '1000.00',
            currencyCode: 'TRY',
            parentTransactionId: 'gid://shopify/OrderTransaction/1',
          },
        ],
        refundLineItems: [],
      },
      graphqlErrors: [],
      source: 'shopify_admin',
    }),
    fetchFulfillmentOrders: vi.fn().mockResolvedValue({
      fulfillmentOrders: [],
      source: 'mock',
    }),
    ...overrides,
  };
}

function buildAdminOrderBreakdownDb() {
  return {
    sourceShopifyOrderId: 'gid://shopify/Order/1088',
    sourceShopifyOrderNumber: '#1088',
    customerName: 'Customer',
    customerEmail: 'customer@example.test',
    totalPrice: '1000.00',
    createdAt: new Date('2026-06-21T08:00:00.000Z'),
    updatedAt: new Date('2026-06-21T08:05:00.000Z'),
    allocations: [
      {
        ...buildDetailAllocation({
          allocationStatus: 'ACTIVE',
          reassignmentRequired: false,
          cancellationReason: null,
        }),
        assignedVendor: {
          name: 'Yalı Spor',
        },
        returnRecords: [],
        refundRecords: [],
        financeIntegrityAlerts: [] as Array<Record<string, unknown>>,
      },
    ],
  };
}

describe('vendor order reject operational hold', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (callback) => callback(prismaMock));
    prismaMock.webhookEvent.findMany.mockResolvedValue([]);
    prismaMock.shopifyOrder.findUnique.mockResolvedValue(buildAdminOrderBreakdownDb());
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

  it('lets an admin return a blocked allocation to the assigned vendor', async () => {
    prismaMock.vendorAllocation.findFirst.mockResolvedValueOnce(buildReturnableBlockedAllocation());

    const result = await returnBlockedAllocationToVendor('gid://shopify/Order/1088', 'alloc-1088', {
      note: 'Vendor confirmed stock is available.',
      actorUserId: 'admin-1',
    });

    expect(prismaMock.vendorAllocation.update).toHaveBeenCalledWith({
      where: { id: 'alloc-1088' },
      data: {
        allocationStatus: 'ACTIVE',
        reassignmentRequired: false,
        cancellationReason: null,
      },
    });
    expect(prismaMock.allocationAssignmentHistory.create).toHaveBeenCalledWith({
      data: {
        vendorAllocationId: 'alloc-1088',
        action: 'admin_returned_to_vendor',
        fromVendorId: 'yalispor',
        toVendorId: 'yalispor',
        reason: 'Vendor confirmed stock is available.',
        actorUserId: 'admin-1',
      },
    });
    expect(result.allocations[0]?.allocationStatus).toBe('ACTIVE');
  });

  it('does not return non-blocked allocations to vendor', async () => {
    prismaMock.vendorAllocation.findFirst.mockResolvedValueOnce(buildReturnableBlockedAllocation({
      allocationStatus: 'ACTIVE',
    }));

    await expect(
      returnBlockedAllocationToVendor('gid://shopify/Order/1088', 'alloc-1088', {
        note: 'Return to vendor.',
      }),
    ).rejects.toMatchObject({ statusCode: 409 });

    expect(prismaMock.vendorAllocation.update).not.toHaveBeenCalled();
    expect(prismaMock.allocationAssignmentHistory.create).not.toHaveBeenCalled();
  });

  it.each([
    ['fulfilled allocation', { fulfillmentStatus: 'Fulfilled' }],
    ['shipped allocation', { shippingStatus: 'Shipped' }],
    ['tracked allocation', { trackingNumber: 'TRK-1' }],
    ['carrier allocation', { carrier: 'Yurtiçi Kargo' }],
  ])('does not return %s to vendor', async (_label, overrides) => {
    prismaMock.vendorAllocation.findFirst.mockResolvedValueOnce(buildReturnableBlockedAllocation(overrides));

    await expect(
      returnBlockedAllocationToVendor('gid://shopify/Order/1088', 'alloc-1088', {
        note: 'Return to vendor.',
      }),
    ).rejects.toMatchObject({ statusCode: 409 });

    expect(prismaMock.vendorAllocation.update).not.toHaveBeenCalled();
  });

  it('does not return allocation when it belongs to a different Shopify order', async () => {
    prismaMock.vendorAllocation.findFirst.mockResolvedValueOnce(null);

    await expect(
      returnBlockedAllocationToVendor('gid://shopify/Order/9999', 'alloc-1088', {
        note: 'Return to vendor.',
      }),
    ).rejects.toMatchObject({ statusCode: 404 });

    expect(prismaMock.vendorAllocation.update).not.toHaveBeenCalled();
  });

  it('adds an admin resolution note without changing allocation state', async () => {
    prismaMock.vendorAllocation.findFirst.mockResolvedValueOnce({
      id: 'alloc-1088',
      assignedVendorId: 'yalispor',
    });

    await addBlockedAllocationResolutionNote('gid://shopify/Order/1088', 'alloc-1088', {
      note: 'Waiting for vendor confirmation.',
      actorUserId: 'admin-1',
    });

    expect(prismaMock.vendorAllocation.update).not.toHaveBeenCalled();
    expect(prismaMock.allocationAssignmentHistory.create).toHaveBeenCalledWith({
      data: {
        vendorAllocationId: 'alloc-1088',
        action: 'admin_note',
        fromVendorId: 'yalispor',
        toVendorId: 'yalispor',
        reason: 'Waiting for vendor confirmation.',
        actorUserId: 'admin-1',
      },
    });
  });

  it('marks a vendor-blocked allocation for local cancel/refund review', async () => {
    prismaMock.vendorAllocation.findFirst.mockResolvedValueOnce(buildReturnableBlockedAllocation());
    const orderDb = buildAdminOrderBreakdownDb();
    orderDb.allocations[0]!.allocationStatus = 'VENDOR_BLOCKED';
    orderDb.allocations[0]!.reassignmentRequired = true;
    orderDb.allocations[0]!.cancellationReason = 'OUT_OF_STOCK';
    orderDb.allocations[0]!.cancelRefundReviewStatus = 'PENDING_REVIEW';
    orderDb.allocations[0]!.cancelRefundReviewReason = 'OUT_OF_STOCK';
    orderDb.allocations[0]!.cancelRefundReviewNote = 'No replacement vendor available. Customer will be contacted.';
    orderDb.allocations[0]!.cancelRefundReviewRequestedAt = new Date('2026-06-21T10:00:00.000Z');
    orderDb.allocations[0]!.cancelRefundReviewRequestedByUserId = 'admin-1';
    prismaMock.shopifyOrder.findUnique.mockResolvedValueOnce(orderDb);

    const result = await requestCancelRefundReviewForAdminOrder('gid://shopify/Order/1088', 'alloc-1088', {
      reason: 'OUT_OF_STOCK',
      note: 'No replacement vendor available. Customer will be contacted.',
      actorUserId: 'admin-1',
    });

    expect(prismaMock.vendorAllocation.update).toHaveBeenCalledWith({
      where: { id: 'alloc-1088' },
      data: {
        cancelRefundReviewStatus: 'PENDING_REVIEW',
        cancelRefundReviewReason: 'OUT_OF_STOCK',
        cancelRefundReviewNote: 'No replacement vendor available. Customer will be contacted.',
        cancelRefundReviewRequestedAt: expect.any(Date),
        cancelRefundReviewRequestedByUserId: 'admin-1',
      },
    });
    expect(prismaMock.allocationAssignmentHistory.create).toHaveBeenCalledWith({
      data: {
        vendorAllocationId: 'alloc-1088',
        action: 'cancel_refund_review_requested',
        fromVendorId: 'yalispor',
        toVendorId: 'yalispor',
        reason: 'OUT_OF_STOCK: No replacement vendor available. Customer will be contacted.',
        actorUserId: 'admin-1',
      },
    });
    expect(result.allocations[0]?.allocationStatus).toBe('VENDOR_BLOCKED');
    expect(result.allocations[0]?.cancelRefundReview).toEqual({
      status: 'PENDING_REVIEW',
      reason: 'OUT_OF_STOCK',
      note: 'No replacement vendor available. Customer will be contacted.',
      requestedAt: '2026-06-21T10:00:00.000Z',
      requestedByUserId: 'admin-1',
    });
  });

  it('does not mark non-blocked allocations for cancel/refund review', async () => {
    prismaMock.vendorAllocation.findFirst.mockResolvedValueOnce(buildReturnableBlockedAllocation({
      allocationStatus: 'ACTIVE',
    }));

    await expect(
      requestCancelRefundReviewForAdminOrder('gid://shopify/Order/1088', 'alloc-1088', {
        reason: 'OUT_OF_STOCK',
        note: 'Customer will be contacted.',
      }),
    ).rejects.toMatchObject({ statusCode: 409 });

    expect(prismaMock.vendorAllocation.update).not.toHaveBeenCalled();
    expect(prismaMock.allocationAssignmentHistory.create).not.toHaveBeenCalled();
  });

  it('requires a cancel/refund review note', async () => {
    await expect(
      requestCancelRefundReviewForAdminOrder('gid://shopify/Order/1088', 'alloc-1088', {
        reason: 'OUT_OF_STOCK',
        note: ' ',
      }),
    ).rejects.toMatchObject({ message: 'Cancel/refund review note is required.' });

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    ['fulfilled allocation', { fulfillmentStatus: 'Fulfilled' }],
    ['shipped allocation', { shippingStatus: 'Shipped' }],
    ['tracked allocation', { trackingNumber: 'TRK-1' }],
    ['carrier allocation', { carrier: 'Yurtiçi Kargo' }],
    ['active return allocation', { returnRecords: [{ status: 'requested', returnLifecycleStatus: null }] }],
    ['refunded allocation', { refundRecords: [{ id: 'refund-1' }] }],
    ['completed transfer allocation', { economicTransfers: [{ status: 'COMPLETED' }] }],
  ])('does not mark %s for cancel/refund review', async (_label, overrides) => {
    prismaMock.vendorAllocation.findFirst.mockResolvedValueOnce(buildReturnableBlockedAllocation(overrides));

    await expect(
      requestCancelRefundReviewForAdminOrder('gid://shopify/Order/1088', 'alloc-1088', {
        reason: 'OUT_OF_STOCK',
        note: 'Customer will be contacted.',
      }),
    ).rejects.toMatchObject({ statusCode: 409 });

    expect(prismaMock.vendorAllocation.update).not.toHaveBeenCalled();
    expect(prismaMock.allocationAssignmentHistory.create).not.toHaveBeenCalled();
  });

  it('previews Shopify suggested refund for an allocation under cancel/refund review without local writes', async () => {
    const shopifyAdminService = buildShopifyRefundPreviewService();
    prismaMock.vendorAllocation.findFirst.mockResolvedValueOnce(buildRefundPreviewAllocation());

    const result = await previewShopifyRefundForAdminOrder('gid://shopify/Order/1088', 'alloc-1088', {
      restockType: 'CANCEL',
      refundShipping: false,
      shopifyAdminService,
    });

    expect(result).toMatchObject({
      ok: true,
      writesPerformed: false,
      allocationId: 'alloc-1088',
      shopifyOrderId: 'gid://shopify/Order/1088',
      blockers: [],
      warnings: [],
      suggestedRefund: {
        totalRefundAmount: '1000.00',
        currencyCode: 'TRY',
        totalTaxAmount: '100.00',
        shippingAmount: null,
        suggestedTransactions: [
          {
            gateway: 'bogus',
            amount: '1000.00',
            currencyCode: 'TRY',
            parentTransactionId: 'gid://shopify/OrderTransaction/1',
          },
        ],
      },
    });
    expect(shopifyAdminService.previewSuggestedRefund).toHaveBeenCalledWith({
      shopifyOrderId: 'gid://shopify/Order/1088',
      refundLineItems: [
        {
          sourceLineItemId: '20346971095377',
          quantity: 1,
          restockType: 'CANCEL',
        },
      ],
      refundShipping: false,
    });
    expect(prismaMock.vendorAllocation.update).not.toHaveBeenCalled();
    expect(prismaMock.allocationAssignmentHistory.create).not.toHaveBeenCalled();
  });

  it('blocks Shopify refund preview when source line item id is missing', async () => {
    const shopifyAdminService = buildShopifyRefundPreviewService();
    prismaMock.vendorAllocation.findFirst.mockResolvedValueOnce(buildRefundPreviewAllocation({
      lineItems: [
        {
          id: 'allocation-line-1',
          quantity: 1,
          shopifyOrderLineItem: {
            sourceLineItemId: ' ',
          },
        },
      ],
    }));

    const result = await previewShopifyRefundForAdminOrder('gid://shopify/Order/1088', 'alloc-1088', {
      restockType: 'CANCEL',
      refundShipping: false,
      shopifyAdminService,
    });

    expect(result.writesPerformed).toBe(false);
    expect(result.suggestedRefund).toBeNull();
    expect(result.blockers).toContain('Allocation line item allocation-line-1 is missing sourceLineItemId.');
    expect(result.missingData).toContain('Allocation line item allocation-line-1 is missing sourceLineItemId.');
    expect(shopifyAdminService.previewSuggestedRefund).not.toHaveBeenCalled();
  });

  it('includes multiple allocation lines in Shopify refund preview', async () => {
    const shopifyAdminService = buildShopifyRefundPreviewService();
    prismaMock.vendorAllocation.findFirst.mockResolvedValueOnce(buildRefundPreviewAllocation({
      lineItems: [
        {
          id: 'allocation-line-1',
          quantity: 1,
          shopifyOrderLineItem: {
            sourceLineItemId: '20346971095377',
          },
        },
        {
          id: 'allocation-line-2',
          quantity: 2,
          shopifyOrderLineItem: {
            sourceLineItemId: 'gid://shopify/LineItem/20346971095378',
          },
        },
      ],
    }));

    await previewShopifyRefundForAdminOrder('gid://shopify/Order/1088', 'alloc-1088', {
      restockType: 'NO_RESTOCK',
      refundShipping: false,
      shopifyAdminService,
    });

    expect(shopifyAdminService.previewSuggestedRefund).toHaveBeenCalledWith({
      shopifyOrderId: 'gid://shopify/Order/1088',
      refundLineItems: [
        {
          sourceLineItemId: '20346971095377',
          quantity: 1,
          restockType: 'NO_RESTOCK',
        },
        {
          sourceLineItemId: 'gid://shopify/LineItem/20346971095378',
          quantity: 2,
          restockType: 'NO_RESTOCK',
        },
      ],
      refundShipping: false,
    });
  });

  it('blocks Shopify refund preview when allocation quantity is not positive', async () => {
    const shopifyAdminService = buildShopifyRefundPreviewService();
    prismaMock.vendorAllocation.findFirst.mockResolvedValueOnce(buildRefundPreviewAllocation({
      lineItems: [
        {
          id: 'allocation-line-1',
          quantity: 0,
          shopifyOrderLineItem: {
            sourceLineItemId: '20346971095377',
          },
        },
      ],
    }));

    const result = await previewShopifyRefundForAdminOrder('gid://shopify/Order/1088', 'alloc-1088', {
      restockType: 'CANCEL',
      refundShipping: false,
      shopifyAdminService,
    });

    expect(result.writesPerformed).toBe(false);
    expect(result.suggestedRefund).toBeNull();
    expect(result.blockers).toContain('Allocation line item allocation-line-1 has invalid refund quantity.');
    expect(shopifyAdminService.previewSuggestedRefund).not.toHaveBeenCalled();
  });

  it('blocks Shopify refund preview when suggested transactions are missing a parent transaction', async () => {
    const shopifyAdminService = buildShopifyRefundPreviewService({
      previewSuggestedRefund: vi.fn().mockResolvedValue({
        orderGid: 'gid://shopify/Order/1088',
        sourceShopifyOrderId: '1088',
        refundLineItemsPreview: [
          {
            lineItemId: 'gid://shopify/LineItem/20346971095377',
            quantity: 1,
            restockType: 'CANCEL',
          },
        ],
        suggestedRefund: {
          totalRefundAmount: '1000.00',
          currencyCode: 'TRY',
          subtotalAmount: '900.00',
          totalTaxAmount: '100.00',
          shippingAmount: null,
          maximumRefundableAmount: '1000.00',
          suggestedTransactions: [
            {
              gateway: 'bogus',
              formattedGateway: '(For Testing) Bogus Gateway',
              amount: '1000.00',
              currencyCode: 'TRY',
              parentTransactionId: null,
            },
          ],
          refundLineItems: [],
        },
        graphqlErrors: [],
        source: 'shopify_admin',
      }),
    });
    prismaMock.vendorAllocation.findFirst.mockResolvedValueOnce(buildRefundPreviewAllocation());

    const result = await previewShopifyRefundForAdminOrder('gid://shopify/Order/1088', 'alloc-1088', {
      restockType: 'CANCEL',
      refundShipping: false,
      shopifyAdminService,
    });

    expect(result.writesPerformed).toBe(false);
    expect(result.blockers).toContain('Suggested refund has no refundable payment transaction. Future refundCreate must not run.');
  });

  it('adds an open fulfillment order warning without blocking Shopify refund preview', async () => {
    const shopifyAdminService = buildShopifyRefundPreviewService({
      fetchFulfillmentOrders: vi.fn().mockResolvedValue({
        source: 'shopify_admin',
        fulfillmentOrders: [
          {
            id: 'fulfillment-order-1',
            status: 'open',
            lineItems: [
              {
                id: 'fo-line-1',
                lineItemId: '20346971095377',
                quantity: 1,
              },
            ],
          },
        ],
      }),
    });
    prismaMock.vendorAllocation.findFirst.mockResolvedValueOnce(buildRefundPreviewAllocation());

    const result = await previewShopifyRefundForAdminOrder('gid://shopify/Order/1088', 'alloc-1088', {
      restockType: 'CANCEL',
      refundShipping: false,
      shopifyAdminService,
    });

    expect(result.warnings).toContain('Open fulfillment order exists for selected line items. Future refundCreate must cancel affected fulfillment orders first.');
    expect(result.blockers).toEqual([]);
  });

  it('rejects Shopify refund preview outside cancel/refund review state', async () => {
    prismaMock.vendorAllocation.findFirst.mockResolvedValueOnce(buildRefundPreviewAllocation({
      cancelRefundReviewStatus: null,
    }));

    await expect(
      previewShopifyRefundForAdminOrder('gid://shopify/Order/1088', 'alloc-1088', {
        restockType: 'CANCEL',
        refundShipping: false,
        shopifyAdminService: buildShopifyRefundPreviewService(),
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      message: 'Allocation must be in cancel/refund review before Shopify refund preview.',
    });
  });

  it('includes open and acknowledged finance integrity alerts in admin Shopify order breakdown', async () => {
    const orderDb = buildAdminOrderBreakdownDb();
    orderDb.allocations[0]!.financeIntegrityAlerts = [
      {
        id: 'alert-1',
        severity: 'critical',
        category: 'multiple_active_sale_ledgers',
        reason: 'Two active sale ledgers exist for this allocation.',
        status: 'open',
        detectedAt: new Date('2026-06-21T09:00:00.000Z'),
        vendorAllocationId: 'alloc-1088',
        allocationEconomicTransferId: 'transfer-1',
        affectedLedgerIds: ['ledger-a', 'ledger-b'],
      },
      {
        id: 'alert-2',
        severity: 'warning',
        category: 'no_active_sale_ledger',
        reason: 'No active sale ledger exists for this allocation.',
        status: 'acknowledged',
        detectedAt: new Date('2026-06-21T10:00:00.000Z'),
        vendorAllocationId: 'alloc-1088',
        allocationEconomicTransferId: null,
        affectedLedgerIds: [],
      },
    ];
    prismaMock.shopifyOrder.findUnique.mockResolvedValueOnce(orderDb);

    const breakdown = await getAdminShopifyOrderBreakdown('gid://shopify/Order/1088');

    expect(breakdown?.allocations[0]?.financeIntegrityAlerts).toEqual([
      {
        id: 'alert-1',
        severity: 'critical',
        category: 'multiple_active_sale_ledgers',
        reason: 'Two active sale ledgers exist for this allocation.',
        status: 'open',
        detectedAt: '2026-06-21T09:00:00.000Z',
        vendorAllocationId: 'alloc-1088',
        allocationEconomicTransferId: 'transfer-1',
        affectedLedgerIds: ['ledger-a', 'ledger-b'],
      },
      {
        id: 'alert-2',
        severity: 'warning',
        category: 'no_active_sale_ledger',
        reason: 'No active sale ledger exists for this allocation.',
        status: 'acknowledged',
        detectedAt: '2026-06-21T10:00:00.000Z',
        vendorAllocationId: 'alloc-1088',
        allocationEconomicTransferId: null,
        affectedLedgerIds: [],
      },
    ]);
    expect(prismaMock.shopifyOrder.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({
        allocations: expect.objectContaining({
          include: expect.objectContaining({
            financeIntegrityAlerts: expect.objectContaining({
              where: {
                status: {
                  in: ['open', 'acknowledged'],
                },
                severity: {
                  in: ['critical', 'warning'],
                },
              },
            }),
          }),
        }),
      }),
    }));
  });

  it('includes null transfer summary when no completed economic transfer exists', async () => {
    prismaMock.shopifyOrder.findUnique.mockResolvedValueOnce(buildAdminOrderBreakdownDb());

    const breakdown = await getAdminShopifyOrderBreakdown('gid://shopify/Order/1088');

    expect(breakdown?.allocations[0]?.transferSummary).toBeNull();
  });

  it('includes the latest completed economic transfer summary in admin Shopify order breakdown', async () => {
    const orderDb = buildAdminOrderBreakdownDb();
    orderDb.allocations[0]!.economicTransfers = [
      {
        id: 'transfer-pending',
        status: 'IN_PROGRESS',
        fromVendorId: 'yalispor',
        toVendorId: 'vendor-c',
        reason: 'Pending transfer should not render.',
        completedAt: null,
        createdAt: new Date('2026-06-21T12:00:00.000Z'),
        adminActorUserId: 'admin-pending',
      },
      {
        id: 'transfer-old',
        status: 'COMPLETED',
        fromVendorId: 'vendor-x',
        toVendorId: 'yalispor',
        reason: 'Older completed transfer.',
        completedAt: new Date('2026-06-20T12:00:00.000Z'),
        createdAt: new Date('2026-06-20T11:59:00.000Z'),
        adminActorUserId: 'admin-old',
      },
      {
        id: 'transfer-latest',
        status: 'COMPLETED',
        fromVendorId: 'yalispor',
        toVendorId: 'sporjinal',
        reason: 'Replacement accepted captured economics.',
        completedAt: new Date('2026-06-21T12:30:00.000Z'),
        createdAt: new Date('2026-06-21T12:29:00.000Z'),
        adminActorUserId: 'admin-1',
      },
    ];
    prismaMock.shopifyOrder.findUnique.mockResolvedValueOnce(orderDb);

    const breakdown = await getAdminShopifyOrderBreakdown('gid://shopify/Order/1088');

    expect(breakdown?.allocations[0]?.transferSummary).toEqual({
      id: 'transfer-latest',
      status: 'COMPLETED',
      fromVendorId: 'yalispor',
      toVendorId: 'sporjinal',
      reason: 'Replacement accepted captured economics.',
      completedAt: '2026-06-21T12:30:00.000Z',
      adminActorUserId: 'admin-1',
    });
    expect(prismaMock.shopifyOrder.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({
        allocations: expect.objectContaining({
          include: expect.objectContaining({
            economicTransfers: expect.objectContaining({
              select: {
                id: true,
                status: true,
                fromVendorId: true,
                toVendorId: true,
                reason: true,
                completedAt: true,
                adminActorUserId: true,
                createdAt: true,
              },
            }),
          }),
        }),
      }),
    }));
  });

  it('does not expose finance integrity alerts through vendor order detail', async () => {
    prismaMock.vendorAllocation.findFirst.mockResolvedValueOnce(buildDetailAllocation({
      financeIntegrityAlerts: [
        {
          id: 'alert-1',
          severity: 'critical',
        },
      ],
    }));

    const detail = await getVendorOrderById('yalispor', 'alloc-1088');

    expect(detail).not.toHaveProperty('financeIntegrityAlerts');
  });

  it('does not expose economic transfer summary through vendor order detail', async () => {
    prismaMock.vendorAllocation.findFirst.mockResolvedValueOnce(buildDetailAllocation({
      economicTransfers: [
        {
          id: 'transfer-1',
          status: 'COMPLETED',
          fromVendorId: 'yalispor',
          toVendorId: 'sporjinal',
          reason: 'Replacement accepted captured economics.',
          completedAt: new Date('2026-06-21T12:30:00.000Z'),
          adminActorUserId: 'admin-1',
        },
      ],
    }));

    const detail = await getVendorOrderById('yalispor', 'alloc-1088');

    expect(detail).not.toHaveProperty('transferSummary');
    expect(detail).not.toHaveProperty('economicTransfers');
  });

  it('does not expose cancel/refund review details through vendor order detail', async () => {
    prismaMock.vendorAllocation.findFirst.mockResolvedValueOnce(buildDetailAllocation({
      cancelRefundReviewStatus: 'PENDING_REVIEW',
      cancelRefundReviewReason: 'OUT_OF_STOCK',
      cancelRefundReviewNote: 'Customer will be contacted.',
      cancelRefundReviewRequestedAt: new Date('2026-06-21T10:00:00.000Z'),
      cancelRefundReviewRequestedByUserId: 'admin-1',
    }));

    const detail = await getVendorOrderById('yalispor', 'alloc-1088');

    expect(detail).not.toHaveProperty('cancelRefundReview');
    expect(detail).not.toHaveProperty('cancelRefundReviewStatus');
  });

  it('requires a note for admin resolution actions', async () => {
    await expect(
      addBlockedAllocationResolutionNote('gid://shopify/Order/1088', 'alloc-1088', {
        note: ' ',
      }),
    ).rejects.toMatchObject({ message: 'Admin resolution note is required.' });

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('transfers allocation economics only after verifying allocation belongs to the Shopify order', async () => {
    const transfer = {
      transferId: 'transfer-1',
      fromVendorId: 'yalispor',
      toVendorId: 'sporjinal',
      sourceLedgerId: 'fin-yalispor-sale-1088',
      targetLedgerId: 'fin-sporjinal-sale-1088',
      allocationId: 'alloc-1088',
      status: 'COMPLETED',
    };
    prismaMock.vendorAllocation.findFirst.mockResolvedValueOnce({ id: 'alloc-1088' });
    transferAllocationEconomicsMock.mockResolvedValueOnce(transfer);
    prismaMock.shopifyOrder.findUnique.mockResolvedValueOnce(buildAdminOrderBreakdownDb());

    const result = await transferAllocationEconomicsForAdminOrder('gid://shopify/Order/1088', 'alloc-1088', {
      toVendorId: 'sporjinal',
      reason: 'Replacement accepted captured economics.',
      actorUserId: 'admin-1',
    });

    expect(prismaMock.vendorAllocation.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'alloc-1088',
        order: {
          sourceShopifyOrderId: 'gid://shopify/Order/1088',
        },
      },
      select: {
        id: true,
      },
    });
    expect(transferAllocationEconomicsMock).toHaveBeenCalledWith({
      vendorAllocationId: 'alloc-1088',
      toVendorId: 'sporjinal',
      adminUserId: 'admin-1',
      reason: 'Replacement accepted captured economics.',
      confirmTransfer: true,
    });
    expect(result).toMatchObject({
      ok: true,
      transfer,
      order: {
        order: {
          sourceShopifyOrderId: 'gid://shopify/Order/1088',
        },
      },
    });
  });

  it('rejects economic transfer when allocation does not belong to the Shopify order', async () => {
    prismaMock.vendorAllocation.findFirst.mockResolvedValueOnce(null);

    await expect(transferAllocationEconomicsForAdminOrder('gid://shopify/Order/9999', 'alloc-1088', {
      toVendorId: 'sporjinal',
      reason: 'Replacement accepted captured economics.',
      actorUserId: 'admin-1',
    })).rejects.toMatchObject({
      message: 'Allocation not found for Shopify order.',
      statusCode: 404,
    });

    expect(transferAllocationEconomicsMock).not.toHaveBeenCalled();
  });
});
