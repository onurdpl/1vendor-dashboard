import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  vendorAllocation: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
  },
  shopifyOrder: {
    findUnique: vi.fn(),
  },
  allocationAssignmentHistory: {
    create: vi.fn(),
  },
  refundRecord: {
    create: vi.fn(),
  },
  financeLedgerEntry: {
    create: vi.fn(),
  },
  financeEvent: {
    create: vi.fn(),
  },
  webhookEvent: {
    findMany: vi.fn(),
  },
  outboundShopifyRefundAttempt: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
}));
const transferAllocationEconomicsMock = vi.hoisted(() => vi.fn());
const enqueueProductPanelVariantDisableEventsMock = vi.hoisted(() => vi.fn());

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: prismaMock,
}));

vi.mock('../backend/src/modules/finance/economic-transfer.service.js', () => ({
  transferAllocationEconomics: transferAllocationEconomicsMock,
}));

vi.mock('../backend/src/modules/product-panel/product-panel-variant-disable-outbox.service.js', () => ({
  enqueueProductPanelVariantDisableEventsForRejectedAllocation: enqueueProductPanelVariantDisableEventsMock,
}));

const {
  addBlockedAllocationResolutionNote,
  executeShopifyRefundForAdminOrder,
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
    sourceAllocationSplitEvents: [] as Array<Record<string, unknown>>,
    childAllocationSplitEvents: [] as Array<Record<string, unknown>>,
    economicTransfers: [] as Array<Record<string, unknown>>,
    financeIntegrityAlerts: [] as Array<Record<string, unknown>>,
    outboundShopifyRefundAttempts: [] as Array<Record<string, unknown>>,
    productPanelVariantDisableEvents: [] as Array<Record<string, unknown>>,
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
    outboundShopifyRefundAttempts: [],
    financeEntries: [],
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
    fetchFulfillmentOrdersForCancellationClassification: vi.fn().mockResolvedValue({
      fulfillmentOrders: [],
      source: 'mock',
    }),
    cancelFulfillmentOrder: vi.fn().mockResolvedValue({
      fulfillmentOrderId: 'gid://shopify/FulfillmentOrder/1',
      fulfillmentOrderStatus: 'CLOSED',
      replacementFulfillmentOrderId: 'gid://shopify/FulfillmentOrder/2',
      replacementFulfillmentOrderStatus: 'OPEN',
      userErrors: [],
    }),
    createShopifyRefund: vi.fn().mockResolvedValue({
      refundId: 'gid://shopify/Refund/1',
      userErrors: [],
      rawResponse: {
        refund: {
          id: 'gid://shopify/Refund/1',
        },
      },
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
        outboundShopifyRefundAttempts: [] as Array<Record<string, unknown>>,
        productPanelVariantDisableEvents: [] as Array<Record<string, unknown>>,
      },
    ],
  };
}

describe('vendor order reject operational hold', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (callback) => callback(prismaMock));
    enqueueProductPanelVariantDisableEventsMock.mockResolvedValue([]);
    prismaMock.webhookEvent.findMany.mockResolvedValue([]);
    prismaMock.shopifyOrder.findUnique.mockResolvedValue(buildAdminOrderBreakdownDb());
    prismaMock.outboundShopifyRefundAttempt.findFirst.mockResolvedValue(null);
    prismaMock.outboundShopifyRefundAttempt.create.mockImplementation(async ({ data }) => ({
      id: 'attempt-1',
      createdAt: new Date('2026-06-21T08:10:00.000Z'),
      updatedAt: new Date('2026-06-21T08:10:00.000Z'),
      submittedAt: null,
      resolvedAt: null,
      failedAt: null,
      failureReason: null,
      ...data,
    }));
    prismaMock.outboundShopifyRefundAttempt.update.mockImplementation(async ({ data }) => ({
      id: 'attempt-existing',
      vendorAllocationId: 'alloc-1088',
      createdAt: new Date('2026-06-21T08:00:00.000Z'),
      updatedAt: new Date('2026-06-21T08:10:00.000Z'),
      submittedAt: null,
      resolvedAt: null,
      failedAt: null,
      failureReason: null,
      ...data,
    }));
    prismaMock.vendorAllocation.findMany.mockResolvedValue([
      {
        id: 'alloc-1088',
        assignedVendorId: 'yalispor',
        lineItems: [
          {
            shopifyOrderLineItem: {
              sourceLineItemId: '20346971095377',
            },
          },
        ],
      },
    ]);
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
    expect(enqueueProductPanelVariantDisableEventsMock).toHaveBeenCalledWith({
      allocationId: 'alloc-1088',
      reasonCode: 'OUT_OF_STOCK',
      reasonText: 'Missing stock',
    });
    expect(enqueueProductPanelVariantDisableEventsMock.mock.invocationCallOrder[0]).toBeGreaterThan(
      prismaMock.$transaction.mock.invocationCallOrder[0],
    );
    expect(result.allocationStatus).toBe('VENDOR_BLOCKED');
    expect(result.reassignmentRequired).toBe(true);
    expect(result.cancellationReason).toBe('OUT_OF_STOCK');
  });

  it('does not enqueue Product Panel availability events for non-stock rejection reasons', async () => {
    prismaMock.vendorAllocation.findFirst
      .mockResolvedValueOnce(buildRejectAllocation())
      .mockResolvedValueOnce(
        buildDetailAllocation({
          cancellationReason: 'FULFILLMENT_ISSUE',
        }),
      );

    const result = await rejectVendorOrderAllocation('yalispor', 'alloc-1088', {
      reason: 'FULFILLMENT_ISSUE',
      note: 'Cannot fulfill this order safely',
      actorUserId: 'user-1',
    });

    expect(prismaMock.vendorAllocation.update).toHaveBeenCalledWith({
      where: { id: 'alloc-1088' },
      data: {
        allocationStatus: 'VENDOR_BLOCKED',
        reassignmentRequired: true,
        cancellationReason: 'FULFILLMENT_ISSUE',
      },
    });
    expect(enqueueProductPanelVariantDisableEventsMock).not.toHaveBeenCalled();
    expect(result.allocationStatus).toBe('VENDOR_BLOCKED');
  });

  it('keeps vendor reject successful when Product Panel outbox enqueue fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    enqueueProductPanelVariantDisableEventsMock.mockRejectedValueOnce(new Error('outbox unavailable'));
    prismaMock.vendorAllocation.findFirst
      .mockResolvedValueOnce(buildRejectAllocation())
      .mockResolvedValueOnce(buildDetailAllocation());

    try {
      const result = await rejectVendorOrderAllocation('yalispor', 'alloc-1088', {
        reason: 'OUT_OF_STOCK',
        note: 'Missing stock',
        actorUserId: 'user-1',
      });

      expect(result.allocationStatus).toBe('VENDOR_BLOCKED');
      expect(prismaMock.vendorAllocation.update).toHaveBeenCalled();
      expect(enqueueProductPanelVariantDisableEventsMock).toHaveBeenCalledTimes(1);
    } finally {
      warnSpy.mockRestore();
    }
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

  it('previews Shopify suggested refund and stores outbound audit state without finance writes', async () => {
    const shopifyAdminService = buildShopifyRefundPreviewService();
    prismaMock.vendorAllocation.findFirst.mockResolvedValueOnce(buildRefundPreviewAllocation());

    const result = await previewShopifyRefundForAdminOrder('gid://shopify/Order/1088', 'alloc-1088', {
      restockType: 'CANCEL',
      refundShipping: false,
      actorUserId: 'admin-1',
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
    expect(prismaMock.refundRecord.create).not.toHaveBeenCalled();
    expect(prismaMock.financeLedgerEntry.create).not.toHaveBeenCalled();
    expect(prismaMock.financeEvent.create).not.toHaveBeenCalled();
    expect(prismaMock.outboundShopifyRefundAttempt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        vendorAllocationId: 'alloc-1088',
        shopifyOrderId: 'gid://shopify/Order/1088',
        status: 'PREVIEWED',
        restockType: 'CANCEL',
        refundShipping: false,
        notifyCustomer: false,
        requestedByUserId: 'admin-1',
        refundLineItemsJson: [
          {
            lineItemId: 'gid://shopify/LineItem/20346971095377',
            quantity: 1,
            restockType: 'CANCEL',
          },
        ],
        suggestedTransactionsJson: [
          {
            gateway: 'bogus',
            amount: '1000.00',
            currencyCode: 'TRY',
            parentTransactionId: 'gid://shopify/OrderTransaction/1',
          },
        ],
        blockersJson: [],
        warningsJson: [],
        previewHash: expect.any(String),
        previewedAt: expect.any(Date),
      }),
    });
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
    expect(prismaMock.outboundShopifyRefundAttempt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: 'PREVIEWED',
        vendorAllocationId: 'alloc-1088',
        blockersJson: ['Allocation line item allocation-line-1 is missing sourceLineItemId.'],
        suggestedTransactionsJson: [],
      }),
    });
  });

  it('updates the latest PREVIEWED outbound audit attempt on repeated preview', async () => {
    const shopifyAdminService = buildShopifyRefundPreviewService();
    prismaMock.vendorAllocation.findFirst.mockResolvedValueOnce(buildRefundPreviewAllocation());
    prismaMock.outboundShopifyRefundAttempt.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'attempt-existing',
        status: 'PREVIEWED',
        vendorAllocationId: 'alloc-1088',
      });

    await previewShopifyRefundForAdminOrder('gid://shopify/Order/1088', 'alloc-1088', {
      restockType: 'CANCEL',
      refundShipping: false,
      actorUserId: 'admin-1',
      shopifyAdminService,
    });

    expect(prismaMock.outboundShopifyRefundAttempt.create).not.toHaveBeenCalled();
    expect(prismaMock.outboundShopifyRefundAttempt.update).toHaveBeenCalledWith({
      where: {
        id: 'attempt-existing',
      },
      data: expect.objectContaining({
        status: 'PREVIEWED',
        restockType: 'CANCEL',
        requestedByUserId: 'admin-1',
        previewHash: expect.any(String),
      }),
    });
  });

  it('blocks Shopify refund preview when an outbound Shopify action is pending', async () => {
    const shopifyAdminService = buildShopifyRefundPreviewService();
    prismaMock.vendorAllocation.findFirst.mockResolvedValueOnce(buildRefundPreviewAllocation());
    prismaMock.outboundShopifyRefundAttempt.findFirst.mockResolvedValueOnce({
      id: 'attempt-pending',
      status: 'SHOPIFY_ACTION_PENDING',
      vendorAllocationId: 'alloc-1088',
    });

    await expect(
      previewShopifyRefundForAdminOrder('gid://shopify/Order/1088', 'alloc-1088', {
        restockType: 'CANCEL',
        refundShipping: false,
        shopifyAdminService,
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      message: 'A Shopify refund attempt is already pending for this allocation.',
    });

    expect(shopifyAdminService.previewSuggestedRefund).not.toHaveBeenCalled();
    expect(prismaMock.outboundShopifyRefundAttempt.create).not.toHaveBeenCalled();
    expect(prismaMock.outboundShopifyRefundAttempt.update).not.toHaveBeenCalled();
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

  it('includes safe fulfillment order cancellation classifier output without mutating state', async () => {
    const shopifyAdminService = buildShopifyRefundPreviewService({
      fetchFulfillmentOrdersForCancellationClassification: vi.fn().mockResolvedValue({
        source: 'shopify_admin',
        fulfillmentOrders: [
          {
            id: 'gid://shopify/FulfillmentOrder/1',
            status: 'OPEN',
            requestStatus: 'SUBMITTED',
            supportedActions: ['CANCEL_FULFILLMENT_ORDER'],
            assignedLocationId: 'gid://shopify/Location/1',
            lineItems: [
              {
                id: 'gid://shopify/FulfillmentOrderLineItem/1',
                lineItemId: 'gid://shopify/LineItem/20346971095377',
                remainingQuantity: 1,
                totalQuantity: 1,
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

    expect(result.fulfillmentOrderCancellation).toMatchObject({
      overallClassification: 'safe_to_cancel',
      affectedFulfillmentOrders: [
        {
          fulfillmentOrderId: 'gid://shopify/FulfillmentOrder/1',
          classification: 'safe_to_cancel',
        },
      ],
    });
    expect(result.warnings).toContain('Affected fulfillment orders must be cancelled before refundCreate.');
    expect(result.blockers).toEqual([]);
    expect(prismaMock.vendorAllocation.update).not.toHaveBeenCalled();
    expect(prismaMock.allocationAssignmentHistory.create).not.toHaveBeenCalled();
  });

  it('surfaces strict fulfillment order cancellation status blockers in Shopify refund preview', async () => {
    const shopifyAdminService = buildShopifyRefundPreviewService({
      fetchFulfillmentOrdersForCancellationClassification: vi.fn().mockResolvedValue({
        source: 'shopify_admin',
        fulfillmentOrders: [
          {
            id: 'gid://shopify/FulfillmentOrder/1',
            status: 'OPEN',
            requestStatus: 'UNREQUESTED',
            supportedActions: ['CANCEL_FULFILLMENT_ORDER'],
            assignedLocationId: 'gid://shopify/Location/1',
            lineItems: [
              {
                id: 'gid://shopify/FulfillmentOrderLineItem/1',
                lineItemId: 'gid://shopify/LineItem/20346971095377',
                remainingQuantity: 1,
                totalQuantity: 1,
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

    expect(result.fulfillmentOrderCancellation).toMatchObject({
      overallClassification: 'blocked',
      affectedFulfillmentOrders: [
        {
          fulfillmentOrderId: 'gid://shopify/FulfillmentOrder/1',
          classification: 'unsupported_request_status',
        },
      ],
    });
    expect(result.blockers).toContain(
      'fulfillment_order_status_not_confirmed_cancelable: Fulfillment order gid://shopify/FulfillmentOrder/1 status/requestStatus is not confirmed compatible with fulfillmentOrderCancel.',
    );
    expect(result.writesPerformed).toBe(false);
  });

  it('surfaces safe fulfillment order classifier exception diagnostics in Shopify refund preview', async () => {
    const shopifyAdminService = buildShopifyRefundPreviewService({
      fetchFulfillmentOrdersForCancellationClassification: vi.fn().mockRejectedValue(
        new Error('Shopify order fulfillment orders were not found for order gid://shopify/Order/1088.'),
      ),
    });
    prismaMock.vendorAllocation.findFirst.mockResolvedValueOnce(buildRefundPreviewAllocation());

    const result = await previewShopifyRefundForAdminOrder('gid://shopify/Order/1088', 'alloc-1088', {
      restockType: 'CANCEL',
      refundShipping: false,
      shopifyAdminService,
    });

    expect(result.writesPerformed).toBe(false);
    expect(result.suggestedRefund).toMatchObject({
      totalRefundAmount: '1000.00',
      currencyCode: 'TRY',
    });
    expect(result.fulfillmentOrderCancellation).toMatchObject({
      overallClassification: 'unknown',
      affectedFulfillmentOrders: [],
      diagnosticCode: 'fulfillment_order_classifier_exception',
      diagnosticMessage: 'Shopify order fulfillment orders were not found for order gid://shopify/Order/1088.',
    });
    expect(result.blockers).toContain(
      'Shopify fulfillment order cancellation classification failed. Future refundCreate must verify affected fulfillment orders before running.',
    );
    expect(result.blockers).not.toContain('Shopify order fulfillment orders were not found for order gid://shopify/Order/1088.');
    expect(prismaMock.outboundShopifyRefundAttempt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: 'PREVIEWED',
        fulfillmentOrderCancellationJson: expect.objectContaining({
          diagnosticCode: 'fulfillment_order_classifier_exception',
          diagnosticMessage: 'Shopify order fulfillment orders were not found for order gid://shopify/Order/1088.',
        }),
      }),
    });
  });

  it('executes Shopify refund, cancels safe fulfillment orders first, and leaves finance to webhook ingestion', async () => {
    const shopifyAdminService = buildShopifyRefundPreviewService({
      fetchFulfillmentOrdersForCancellationClassification: vi.fn().mockResolvedValue({
        source: 'shopify_admin',
        fulfillmentOrders: [
          {
            id: 'gid://shopify/FulfillmentOrder/1',
            status: 'OPEN',
            requestStatus: 'SUBMITTED',
            supportedActions: ['CANCEL_FULFILLMENT_ORDER'],
            assignedLocationId: 'gid://shopify/Location/1',
            lineItems: [
              {
                id: 'gid://shopify/FulfillmentOrderLineItem/1',
                lineItemId: 'gid://shopify/LineItem/20346971095377',
                remainingQuantity: 1,
                totalQuantity: 1,
              },
            ],
          },
        ],
      }),
    });
    prismaMock.vendorAllocation.findFirst.mockResolvedValueOnce(buildRefundPreviewAllocation());

    const result = await executeShopifyRefundForAdminOrder('gid://shopify/Order/1088', 'alloc-1088', {
      restockType: 'CANCEL',
      refundShipping: false,
      notifyCustomer: true,
      note: 'Customer approved refund.',
      confirmRefund: true,
      shopifyAdminService,
    });

    expect(shopifyAdminService.cancelFulfillmentOrder).toHaveBeenCalledWith({
      fulfillmentOrderId: 'gid://shopify/FulfillmentOrder/1',
    });
    expect(shopifyAdminService.createShopifyRefund).toHaveBeenCalledWith(expect.objectContaining({
      orderId: 'gid://shopify/Order/1088',
      note: 'Customer approved refund.',
      notify: true,
      idempotencyKey: 'shopify-refund:alloc-1088:attempt-1',
      refundLineItems: [
        {
          lineItemId: 'gid://shopify/LineItem/20346971095377',
          quantity: 1,
          restockType: 'CANCEL',
          locationId: 'gid://shopify/Location/1',
        },
      ],
      transactions: [
        {
          parentTransactionId: 'gid://shopify/OrderTransaction/1',
          amount: '1000.00',
          gateway: 'bogus',
        },
      ],
    }));
    expect(prismaMock.vendorAllocation.update).toHaveBeenCalledWith({
      where: { id: 'alloc-1088' },
      data: { cancelRefundReviewStatus: 'SHOPIFY_ACTION_PENDING' },
    });
    expect(prismaMock.outboundShopifyRefundAttempt.update).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { id: 'attempt-1' },
      data: expect.objectContaining({
        status: 'SHOPIFY_ACTION_PENDING',
        shopifyRefundId: 'gid://shopify/Refund/1',
      }),
    }));
    expect(prismaMock.refundRecord.create).not.toHaveBeenCalled();
    expect(prismaMock.financeLedgerEntry.create).not.toHaveBeenCalled();
    expect(prismaMock.financeEvent.create).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: true,
      writesPerformed: true,
      status: 'SHOPIFY_ACTION_PENDING',
      shopifyRefundId: 'gid://shopify/Refund/1',
      attemptId: 'attempt-1',
    });
  });

  it('blocks duplicate Shopify refund execution while an attempt is pending', async () => {
    prismaMock.vendorAllocation.findFirst.mockResolvedValueOnce(buildRefundPreviewAllocation());
    prismaMock.outboundShopifyRefundAttempt.findFirst.mockResolvedValueOnce({
      id: 'attempt-pending',
      status: 'SHOPIFY_ACTION_PENDING',
    });

    await expect(
      executeShopifyRefundForAdminOrder('gid://shopify/Order/1088', 'alloc-1088', {
        restockType: 'CANCEL',
        refundShipping: false,
        notifyCustomer: true,
        note: 'Customer approved refund.',
        confirmRefund: true,
        shopifyAdminService: buildShopifyRefundPreviewService(),
      }),
    ).rejects.toThrow('A Shopify refund attempt is already pending for this allocation.');
  });

  it('marks attempt failed when strict fulfillment order classification blocks execution', async () => {
    const shopifyAdminService = buildShopifyRefundPreviewService({
      fetchFulfillmentOrdersForCancellationClassification: vi.fn().mockResolvedValue({
        source: 'shopify_admin',
        fulfillmentOrders: [
          {
            id: 'gid://shopify/FulfillmentOrder/1',
            status: 'OPEN',
            requestStatus: 'UNREQUESTED',
            supportedActions: ['CANCEL_FULFILLMENT_ORDER'],
            assignedLocationId: 'gid://shopify/Location/1',
            lineItems: [
              {
                id: 'gid://shopify/FulfillmentOrderLineItem/1',
                lineItemId: 'gid://shopify/LineItem/20346971095377',
                remainingQuantity: 1,
                totalQuantity: 1,
              },
            ],
          },
        ],
      }),
    });
    prismaMock.vendorAllocation.findFirst.mockResolvedValueOnce(buildRefundPreviewAllocation());

    await expect(
      executeShopifyRefundForAdminOrder('gid://shopify/Order/1088', 'alloc-1088', {
        restockType: 'CANCEL',
        refundShipping: false,
        notifyCustomer: true,
        note: 'Customer approved refund.',
        confirmRefund: true,
        shopifyAdminService,
      }),
    ).rejects.toThrow('fulfillment_order_status_not_confirmed_cancelable');

    expect(shopifyAdminService.createShopifyRefund).not.toHaveBeenCalled();
    expect(prismaMock.outboundShopifyRefundAttempt.update).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'FAILED',
      }),
    }));
  });

  it('requires post-refund fulfillment check confirmation for open unsubmitted fulfillment order probe', async () => {
    const shopifyAdminService = buildShopifyRefundPreviewService({
      fetchFulfillmentOrdersForCancellationClassification: vi.fn().mockResolvedValue({
        source: 'shopify_admin',
        fulfillmentOrders: [
          {
            id: 'gid://shopify/FulfillmentOrder/1',
            status: 'OPEN',
            requestStatus: 'UNSUBMITTED',
            supportedActions: ['CREATE_FULFILLMENT', 'MOVE', 'HOLD'],
            assignedLocationId: 'gid://shopify/Location/1',
            lineItems: [
              {
                id: 'gid://shopify/FulfillmentOrderLineItem/1',
                lineItemId: 'gid://shopify/LineItem/20346971095377',
                remainingQuantity: 1,
                totalQuantity: 1,
              },
            ],
          },
        ],
      }),
    });
    prismaMock.vendorAllocation.findFirst.mockResolvedValueOnce(buildRefundPreviewAllocation());

    await expect(
      executeShopifyRefundForAdminOrder('gid://shopify/Order/1088', 'alloc-1088', {
        restockType: 'CANCEL',
        refundShipping: false,
        notifyCustomer: true,
        note: 'Customer approved refund.',
        confirmRefund: true,
        shopifyAdminService,
      }),
    ).rejects.toThrow('Post-refund Shopify fulfillment check confirmation is required');

    expect(shopifyAdminService.createShopifyRefund).not.toHaveBeenCalled();
    expect(prismaMock.outboundShopifyRefundAttempt.update).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'FAILED',
      }),
    }));
  });

  it('blocks refundCreate before Shopify when CANCEL restock locationId is missing', async () => {
    const shopifyAdminService = buildShopifyRefundPreviewService({
      fetchFulfillmentOrdersForCancellationClassification: vi.fn().mockResolvedValue({
        source: 'shopify_admin',
        fulfillmentOrders: [
          {
            id: 'gid://shopify/FulfillmentOrder/1',
            status: 'OPEN',
            requestStatus: 'UNSUBMITTED',
            supportedActions: ['CREATE_FULFILLMENT', 'MOVE', 'HOLD'],
            assignedLocationId: null,
            lineItems: [
              {
                id: 'gid://shopify/FulfillmentOrderLineItem/1',
                lineItemId: 'gid://shopify/LineItem/20346971095377',
                remainingQuantity: 1,
                totalQuantity: 1,
              },
            ],
          },
        ],
      }),
    });
    prismaMock.vendorAllocation.findFirst.mockResolvedValueOnce(buildRefundPreviewAllocation());

    await expect(
      executeShopifyRefundForAdminOrder('gid://shopify/Order/1088', 'alloc-1088', {
        restockType: 'CANCEL',
        refundShipping: false,
        notifyCustomer: true,
        note: 'Customer approved refund.',
        confirmRefund: true,
        confirmPostRefundFulfillmentCheck: true,
        shopifyAdminService,
      }),
    ).rejects.toThrow('Missing Shopify locationId required for restockType CANCEL.');

    expect(shopifyAdminService.cancelFulfillmentOrder).not.toHaveBeenCalled();
    expect(shopifyAdminService.createShopifyRefund).not.toHaveBeenCalled();
    expect(prismaMock.outboundShopifyRefundAttempt.update).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'FAILED',
        failureReason: 'Missing Shopify locationId required for restockType CANCEL.',
      }),
    }));
  });

  it('blocks refundCreate when one CANCEL line item maps to conflicting fulfillment order locations', async () => {
    const shopifyAdminService = buildShopifyRefundPreviewService({
      fetchFulfillmentOrdersForCancellationClassification: vi.fn().mockResolvedValue({
        source: 'shopify_admin',
        fulfillmentOrders: [
          {
            id: 'gid://shopify/FulfillmentOrder/1',
            status: 'OPEN',
            requestStatus: 'UNSUBMITTED',
            supportedActions: ['CREATE_FULFILLMENT', 'MOVE', 'HOLD'],
            assignedLocationId: 'gid://shopify/Location/1',
            lineItems: [
              {
                id: 'gid://shopify/FulfillmentOrderLineItem/1',
                lineItemId: 'gid://shopify/LineItem/20346971095377',
                remainingQuantity: 1,
                totalQuantity: 1,
              },
            ],
          },
          {
            id: 'gid://shopify/FulfillmentOrder/2',
            status: 'OPEN',
            requestStatus: 'UNSUBMITTED',
            supportedActions: ['CREATE_FULFILLMENT', 'MOVE', 'HOLD'],
            assignedLocationId: 'gid://shopify/Location/2',
            lineItems: [
              {
                id: 'gid://shopify/FulfillmentOrderLineItem/2',
                lineItemId: 'gid://shopify/LineItem/20346971095377',
                remainingQuantity: 1,
                totalQuantity: 1,
              },
            ],
          },
        ],
      }),
    });
    prismaMock.vendorAllocation.findFirst.mockResolvedValueOnce(buildRefundPreviewAllocation());

    await expect(
      executeShopifyRefundForAdminOrder('gid://shopify/Order/1088', 'alloc-1088', {
        restockType: 'CANCEL',
        refundShipping: false,
        notifyCustomer: true,
        note: 'Customer approved refund.',
        confirmRefund: true,
        confirmPostRefundFulfillmentCheck: true,
        shopifyAdminService,
      }),
    ).rejects.toThrow('Conflicting Shopify locationIds found for restockType CANCEL.');

    expect(shopifyAdminService.cancelFulfillmentOrder).not.toHaveBeenCalled();
    expect(shopifyAdminService.createShopifyRefund).not.toHaveBeenCalled();
  });

  it('executes open unsubmitted refund probe without fulfillmentOrderCancel and passes post-check when remainingQuantity becomes zero', async () => {
    const fetchFulfillmentOrdersForCancellationClassification = vi.fn()
      .mockResolvedValueOnce({
        source: 'shopify_admin',
        fulfillmentOrders: [
          {
            id: 'gid://shopify/FulfillmentOrder/1',
            status: 'OPEN',
            requestStatus: 'UNSUBMITTED',
            supportedActions: ['CREATE_FULFILLMENT', 'MOVE', 'HOLD'],
            assignedLocationId: 'gid://shopify/Location/1',
            lineItems: [
              {
                id: 'gid://shopify/FulfillmentOrderLineItem/1',
                lineItemId: 'gid://shopify/LineItem/20346971095377',
                remainingQuantity: 1,
                totalQuantity: 1,
              },
            ],
          },
        ],
      })
      .mockResolvedValueOnce({
        source: 'shopify_admin',
        fulfillmentOrders: [
          {
            id: 'gid://shopify/FulfillmentOrder/1',
            status: 'OPEN',
            requestStatus: 'UNSUBMITTED',
            supportedActions: ['CREATE_FULFILLMENT', 'MOVE', 'HOLD'],
            assignedLocationId: 'gid://shopify/Location/1',
            lineItems: [
              {
                id: 'gid://shopify/FulfillmentOrderLineItem/1',
                lineItemId: 'gid://shopify/LineItem/20346971095377',
                remainingQuantity: 0,
                totalQuantity: 1,
              },
            ],
          },
        ],
      });
    const shopifyAdminService = buildShopifyRefundPreviewService({
      fetchFulfillmentOrdersForCancellationClassification,
    });
    prismaMock.vendorAllocation.findFirst.mockResolvedValueOnce(buildRefundPreviewAllocation());

    const result = await executeShopifyRefundForAdminOrder('gid://shopify/Order/1088', 'alloc-1088', {
      restockType: 'CANCEL',
      refundShipping: false,
      notifyCustomer: true,
      note: 'Customer approved refund.',
      confirmRefund: true,
      confirmPostRefundFulfillmentCheck: true,
      shopifyAdminService,
    });

    expect(shopifyAdminService.cancelFulfillmentOrder).not.toHaveBeenCalled();
    expect(shopifyAdminService.createShopifyRefund).toHaveBeenCalledWith(expect.objectContaining({
      refundLineItems: [
        {
          lineItemId: 'gid://shopify/LineItem/20346971095377',
          quantity: 1,
          restockType: 'CANCEL',
          locationId: 'gid://shopify/Location/1',
        },
      ],
    }));
    expect(fetchFulfillmentOrdersForCancellationClassification).toHaveBeenCalledTimes(2);
    expect(result.message).toBe('Shopify refund submitted. Fulfillment post-check passed. Waiting for refunds/create webhook.');
    expect(prismaMock.refundRecord.create).not.toHaveBeenCalled();
    expect(prismaMock.financeLedgerEntry.create).not.toHaveBeenCalled();
    expect(prismaMock.financeEvent.create).not.toHaveBeenCalled();
    expect(prismaMock.outboundShopifyRefundAttempt.update).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'SHOPIFY_ACTION_PENDING',
        mutationResponseJson: expect.objectContaining({
          postRefundFulfillmentCheck: expect.objectContaining({
            status: 'passed',
          }),
        }),
      }),
    }));
  });

  it('returns warning when open unsubmitted refund probe still shows fulfillable quantity after refundCreate', async () => {
    const fetchFulfillmentOrdersForCancellationClassification = vi.fn()
      .mockResolvedValueOnce({
        source: 'shopify_admin',
        fulfillmentOrders: [
          {
            id: 'gid://shopify/FulfillmentOrder/1',
            status: 'OPEN',
            requestStatus: 'UNSUBMITTED',
            supportedActions: ['CREATE_FULFILLMENT', 'MOVE', 'HOLD'],
            assignedLocationId: 'gid://shopify/Location/1',
            lineItems: [
              {
                id: 'gid://shopify/FulfillmentOrderLineItem/1',
                lineItemId: 'gid://shopify/LineItem/20346971095377',
                remainingQuantity: 1,
                totalQuantity: 1,
              },
            ],
          },
        ],
      })
      .mockResolvedValueOnce({
        source: 'shopify_admin',
        fulfillmentOrders: [
          {
            id: 'gid://shopify/FulfillmentOrder/1',
            status: 'OPEN',
            requestStatus: 'UNSUBMITTED',
            supportedActions: ['CREATE_FULFILLMENT', 'MOVE', 'HOLD'],
            assignedLocationId: 'gid://shopify/Location/1',
            lineItems: [
              {
                id: 'gid://shopify/FulfillmentOrderLineItem/1',
                lineItemId: 'gid://shopify/LineItem/20346971095377',
                remainingQuantity: 1,
                totalQuantity: 1,
              },
            ],
          },
        ],
      });
    const shopifyAdminService = buildShopifyRefundPreviewService({
      fetchFulfillmentOrdersForCancellationClassification,
    });
    prismaMock.vendorAllocation.findFirst.mockResolvedValueOnce(buildRefundPreviewAllocation());

    const result = await executeShopifyRefundForAdminOrder('gid://shopify/Order/1088', 'alloc-1088', {
      restockType: 'CANCEL',
      refundShipping: false,
      notifyCustomer: true,
      note: 'Customer approved refund.',
      confirmRefund: true,
      confirmPostRefundFulfillmentCheck: true,
      shopifyAdminService,
    });

    expect(shopifyAdminService.cancelFulfillmentOrder).not.toHaveBeenCalled();
    expect(result.message).toBe('Refund was submitted, but Shopify still shows fulfillable quantity. Manual attention required.');
    expect(prismaMock.vendorAllocation.update).toHaveBeenCalledWith({
      where: { id: 'alloc-1088' },
      data: { cancelRefundReviewStatus: 'SHOPIFY_ACTION_PENDING' },
    });
    expect(prismaMock.outboundShopifyRefundAttempt.update).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'SHOPIFY_ACTION_PENDING',
        warningsJson: expect.arrayContaining([
          'Refund was submitted, but Shopify still shows fulfillable quantity. Manual attention required.',
        ]),
        mutationResponseJson: expect.objectContaining({
          postRefundFulfillmentCheck: expect.objectContaining({
            status: 'warning',
            activeFulfillableLineItems: [
              expect.objectContaining({
                shopifyLineItemId: 'gid://shopify/LineItem/20346971095377',
                remainingQuantity: 1,
              }),
            ],
          }),
        }),
      }),
    }));
    expect(prismaMock.refundRecord.create).not.toHaveBeenCalled();
    expect(prismaMock.financeLedgerEntry.create).not.toHaveBeenCalled();
    expect(prismaMock.financeEvent.create).not.toHaveBeenCalled();
  });

  it('exposes a controlled direct refundCreate probe for eligible split-child mixed fulfillment orders while keeping preview blocked', async () => {
    prismaMock.vendorAllocation.findMany.mockResolvedValueOnce([
      {
        id: 'alloc-1088',
        assignedVendorId: 'yalispor',
        lineItems: [
          {
            shopifyOrderLineItem: {
              sourceLineItemId: '20346971095377',
            },
          },
        ],
      },
      {
        id: 'alloc-source',
        assignedVendorId: 'yalispor',
        lineItems: [
          {
            shopifyOrderLineItem: {
              sourceLineItemId: '20346971095378',
            },
          },
        ],
      },
    ]);
    const shopifyAdminService = buildShopifyRefundPreviewService({
      fetchFulfillmentOrdersForCancellationClassification: vi.fn().mockResolvedValue({
        source: 'shopify_admin',
        fulfillmentOrders: [
          {
            id: 'gid://shopify/FulfillmentOrder/1',
            status: 'OPEN',
            requestStatus: 'UNSUBMITTED',
            supportedActions: ['CREATE_FULFILLMENT', 'MOVE', 'HOLD', 'SPLIT'],
            assignedLocationId: 'gid://shopify/Location/1',
            lineItems: [
              {
                id: 'gid://shopify/FulfillmentOrderLineItem/1',
                lineItemId: 'gid://shopify/LineItem/20346971095377',
                remainingQuantity: 1,
                totalQuantity: 1,
              },
              {
                id: 'gid://shopify/FulfillmentOrderLineItem/2',
                lineItemId: 'gid://shopify/LineItem/20346971095378',
                remainingQuantity: 1,
                totalQuantity: 1,
              },
            ],
          },
        ],
      }),
    });
    prismaMock.vendorAllocation.findFirst.mockResolvedValueOnce(buildRefundPreviewAllocation({
      childAllocationSplitEvents: [{ id: 'split-1' }],
    }));

    const result = await previewShopifyRefundForAdminOrder('gid://shopify/Order/1088', 'alloc-1088', {
      restockType: 'CANCEL',
      refundShipping: false,
      shopifyAdminService,
    });

    expect(result.fulfillmentOrderCancellation.overallClassification).toBe('blocked');
    expect(result.blockers.some((blocker) => blocker.includes('outside the selected allocation refund'))).toBe(true);
    expect(result.mixedFulfillmentOrderDirectRefundProbe).toMatchObject({
      eligible: true,
      code: 'mixed_fulfillment_order_direct_refund_probe',
      sourceLineItems: [
        {
          lineItemId: 'gid://shopify/LineItem/20346971095378',
          preRefundRemainingQuantity: 1,
        },
      ],
    });
  });

  it('requires explicit confirmation before running the split-child mixed fulfillment order direct refundCreate probe', async () => {
    prismaMock.vendorAllocation.findMany.mockResolvedValueOnce([
      {
        id: 'alloc-1088',
        assignedVendorId: 'yalispor',
        lineItems: [{ shopifyOrderLineItem: { sourceLineItemId: '20346971095377' } }],
      },
      {
        id: 'alloc-source',
        assignedVendorId: 'yalispor',
        lineItems: [{ shopifyOrderLineItem: { sourceLineItemId: '20346971095378' } }],
      },
    ]);
    const shopifyAdminService = buildShopifyRefundPreviewService({
      fetchFulfillmentOrdersForCancellationClassification: vi.fn().mockResolvedValue({
        source: 'shopify_admin',
        fulfillmentOrders: [
          {
            id: 'gid://shopify/FulfillmentOrder/1',
            status: 'OPEN',
            requestStatus: 'UNSUBMITTED',
            supportedActions: ['CREATE_FULFILLMENT', 'MOVE', 'HOLD', 'SPLIT'],
            assignedLocationId: 'gid://shopify/Location/1',
            lineItems: [
              {
                id: 'gid://shopify/FulfillmentOrderLineItem/1',
                lineItemId: 'gid://shopify/LineItem/20346971095377',
                remainingQuantity: 1,
                totalQuantity: 1,
              },
              {
                id: 'gid://shopify/FulfillmentOrderLineItem/2',
                lineItemId: 'gid://shopify/LineItem/20346971095378',
                remainingQuantity: 1,
                totalQuantity: 1,
              },
            ],
          },
        ],
      }),
    });
    prismaMock.vendorAllocation.findFirst.mockResolvedValueOnce(buildRefundPreviewAllocation({
      childAllocationSplitEvents: [{ id: 'split-1' }],
    }));

    await expect(
      executeShopifyRefundForAdminOrder('gid://shopify/Order/1088', 'alloc-1088', {
        restockType: 'CANCEL',
        refundShipping: false,
        notifyCustomer: true,
        note: 'Controlled probe.',
        confirmRefund: true,
        confirmPostRefundFulfillmentCheck: true,
        shopifyAdminService,
      }),
    ).rejects.toThrow('Mixed fulfillment order direct refundCreate probe confirmation is required.');

    expect(shopifyAdminService.cancelFulfillmentOrder).not.toHaveBeenCalled();
    expect(shopifyAdminService.createShopifyRefund).not.toHaveBeenCalled();
  });

  it('executes split-child mixed fulfillment order direct refundCreate probe and verifies child and source remaining quantities', async () => {
    prismaMock.vendorAllocation.findMany.mockResolvedValueOnce([
      {
        id: 'alloc-1088',
        assignedVendorId: 'yalispor',
        lineItems: [{ shopifyOrderLineItem: { sourceLineItemId: '20346971095377' } }],
      },
      {
        id: 'alloc-source',
        assignedVendorId: 'yalispor',
        lineItems: [{ shopifyOrderLineItem: { sourceLineItemId: '20346971095378' } }],
      },
    ]);
    const fetchFulfillmentOrdersForCancellationClassification = vi.fn()
      .mockResolvedValueOnce({
        source: 'shopify_admin',
        fulfillmentOrders: [
          {
            id: 'gid://shopify/FulfillmentOrder/1',
            status: 'OPEN',
            requestStatus: 'UNSUBMITTED',
            supportedActions: ['CREATE_FULFILLMENT', 'MOVE', 'HOLD', 'SPLIT'],
            assignedLocationId: 'gid://shopify/Location/1',
            lineItems: [
              {
                id: 'gid://shopify/FulfillmentOrderLineItem/1',
                lineItemId: 'gid://shopify/LineItem/20346971095377',
                remainingQuantity: 1,
                totalQuantity: 1,
              },
              {
                id: 'gid://shopify/FulfillmentOrderLineItem/2',
                lineItemId: 'gid://shopify/LineItem/20346971095378',
                remainingQuantity: 1,
                totalQuantity: 1,
              },
            ],
          },
        ],
      })
      .mockResolvedValueOnce({
        source: 'shopify_admin',
        fulfillmentOrders: [
          {
            id: 'gid://shopify/FulfillmentOrder/1',
            status: 'OPEN',
            requestStatus: 'UNSUBMITTED',
            supportedActions: ['CREATE_FULFILLMENT', 'MOVE', 'HOLD', 'SPLIT'],
            assignedLocationId: 'gid://shopify/Location/1',
            lineItems: [
              {
                id: 'gid://shopify/FulfillmentOrderLineItem/1',
                lineItemId: 'gid://shopify/LineItem/20346971095377',
                remainingQuantity: 0,
                totalQuantity: 1,
              },
              {
                id: 'gid://shopify/FulfillmentOrderLineItem/2',
                lineItemId: 'gid://shopify/LineItem/20346971095378',
                remainingQuantity: 1,
                totalQuantity: 1,
              },
            ],
          },
        ],
      });
    const shopifyAdminService = buildShopifyRefundPreviewService({
      fetchFulfillmentOrdersForCancellationClassification,
    });
    prismaMock.vendorAllocation.findFirst.mockResolvedValueOnce(buildRefundPreviewAllocation({
      childAllocationSplitEvents: [{ id: 'split-1' }],
    }));

    const result = await executeShopifyRefundForAdminOrder('gid://shopify/Order/1088', 'alloc-1088', {
      restockType: 'CANCEL',
      refundShipping: false,
      notifyCustomer: true,
      note: 'Controlled probe.',
      confirmRefund: true,
      confirmPostRefundFulfillmentCheck: true,
      confirmMixedFulfillmentOrderDirectRefundProbe: true,
      shopifyAdminService,
    });

    expect(shopifyAdminService.cancelFulfillmentOrder).not.toHaveBeenCalled();
    expect(shopifyAdminService.createShopifyRefund).toHaveBeenCalledWith(expect.objectContaining({
      refundLineItems: [
        {
          lineItemId: 'gid://shopify/LineItem/20346971095377',
          quantity: 1,
          restockType: 'CANCEL',
          locationId: 'gid://shopify/Location/1',
        },
      ],
    }));
    expect(fetchFulfillmentOrdersForCancellationClassification).toHaveBeenCalledTimes(2);
    expect(result.message).toBe('Shopify refund submitted. Fulfillment post-check passed. Waiting for refunds/create webhook.');
    expect(prismaMock.refundRecord.create).not.toHaveBeenCalled();
    expect(prismaMock.financeLedgerEntry.create).not.toHaveBeenCalled();
    expect(prismaMock.financeEvent.create).not.toHaveBeenCalled();
    expect(prismaMock.outboundShopifyRefundAttempt.update).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'SHOPIFY_ACTION_PENDING',
        mutationResponseJson: expect.objectContaining({
          postRefundFulfillmentCheck: expect.objectContaining({
            status: 'passed',
            mode: 'mixed_fulfillment_order_direct_refund_probe',
          }),
        }),
        fulfillmentOrderCancellationJson: expect.objectContaining({
          mixedFulfillmentOrderDirectRefundProbe: expect.objectContaining({
            eligible: true,
          }),
        }),
      }),
    }));
  });

  it('does not call refundCreate when fulfillment order cancellation returns userErrors', async () => {
    const shopifyAdminService = buildShopifyRefundPreviewService({
      fetchFulfillmentOrdersForCancellationClassification: vi.fn().mockResolvedValue({
        source: 'shopify_admin',
        fulfillmentOrders: [
          {
            id: 'gid://shopify/FulfillmentOrder/1',
            status: 'OPEN',
            requestStatus: 'SUBMITTED',
            supportedActions: ['CANCEL_FULFILLMENT_ORDER'],
            assignedLocationId: 'gid://shopify/Location/1',
            lineItems: [
              {
                id: 'gid://shopify/FulfillmentOrderLineItem/1',
                lineItemId: 'gid://shopify/LineItem/20346971095377',
                remainingQuantity: 1,
                totalQuantity: 1,
              },
            ],
          },
        ],
      }),
      cancelFulfillmentOrder: vi.fn().mockResolvedValue({
        fulfillmentOrderId: null,
        fulfillmentOrderStatus: null,
        replacementFulfillmentOrderId: null,
        replacementFulfillmentOrderStatus: null,
        userErrors: [{ field: ['id'], message: 'Cannot cancel fulfillment order.' }],
      }),
    });
    prismaMock.vendorAllocation.findFirst.mockResolvedValueOnce(buildRefundPreviewAllocation());

    await expect(
      executeShopifyRefundForAdminOrder('gid://shopify/Order/1088', 'alloc-1088', {
        restockType: 'CANCEL',
        refundShipping: false,
        notifyCustomer: true,
        note: 'Customer approved refund.',
        confirmRefund: true,
        shopifyAdminService,
      }),
    ).rejects.toThrow('Shopify fulfillment order cancellation failed: Cannot cancel fulfillment order.');

    expect(shopifyAdminService.createShopifyRefund).not.toHaveBeenCalled();
  });

  it('blocks refundCreate when suggested transactions are missing parentTransactionId', async () => {
    const shopifyAdminService = buildShopifyRefundPreviewService({
      fetchFulfillmentOrdersForCancellationClassification: vi.fn().mockResolvedValue({
        source: 'shopify_admin',
        fulfillmentOrders: [
          {
            id: 'gid://shopify/FulfillmentOrder/1',
            status: 'OPEN',
            requestStatus: 'SUBMITTED',
            supportedActions: ['CANCEL_FULFILLMENT_ORDER'],
            assignedLocationId: 'gid://shopify/Location/1',
            lineItems: [
              {
                id: 'gid://shopify/FulfillmentOrderLineItem/1',
                lineItemId: 'gid://shopify/LineItem/20346971095377',
                remainingQuantity: 1,
                totalQuantity: 1,
              },
            ],
          },
        ],
      }),
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

    await expect(
      executeShopifyRefundForAdminOrder('gid://shopify/Order/1088', 'alloc-1088', {
        restockType: 'CANCEL',
        refundShipping: false,
        notifyCustomer: true,
        note: 'Customer approved refund.',
        confirmRefund: true,
        shopifyAdminService,
      }),
    ).rejects.toThrow('Suggested refund transaction is missing parentTransactionId.');

    expect(shopifyAdminService.createShopifyRefund).not.toHaveBeenCalled();
  });

  it('marks attempt failed and keeps review open when refundCreate returns userErrors', async () => {
    const shopifyAdminService = buildShopifyRefundPreviewService({
      fetchFulfillmentOrdersForCancellationClassification: vi.fn().mockResolvedValue({
        source: 'shopify_admin',
        fulfillmentOrders: [
          {
            id: 'gid://shopify/FulfillmentOrder/1',
            status: 'OPEN',
            requestStatus: 'SUBMITTED',
            supportedActions: ['CANCEL_FULFILLMENT_ORDER'],
            assignedLocationId: 'gid://shopify/Location/1',
            lineItems: [
              {
                id: 'gid://shopify/FulfillmentOrderLineItem/1',
                lineItemId: 'gid://shopify/LineItem/20346971095377',
                remainingQuantity: 1,
                totalQuantity: 1,
              },
            ],
          },
        ],
      }),
      createShopifyRefund: vi.fn().mockResolvedValue({
        refundId: null,
        userErrors: [{ field: ['transactions'], message: 'Payment cannot be refunded.' }],
        rawResponse: {
          userErrors: [{ field: ['transactions'], message: 'Payment cannot be refunded.' }],
        },
      }),
    });
    prismaMock.vendorAllocation.findFirst.mockResolvedValueOnce(buildRefundPreviewAllocation());

    await expect(
      executeShopifyRefundForAdminOrder('gid://shopify/Order/1088', 'alloc-1088', {
        restockType: 'CANCEL',
        refundShipping: false,
        notifyCustomer: true,
        note: 'Customer approved refund.',
        confirmRefund: true,
        shopifyAdminService,
      }),
    ).rejects.toThrow('Shopify refundCreate failed: Payment cannot be refunded.');

    expect(prismaMock.outboundShopifyRefundAttempt.update).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'FAILED',
      }),
    }));
    expect(prismaMock.vendorAllocation.update).not.toHaveBeenCalledWith(expect.objectContaining({
      data: { cancelRefundReviewStatus: 'SHOPIFY_ACTION_PENDING' },
    }));
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

  it('includes latest outbound Shopify refund attempt summary in admin Shopify order breakdown', async () => {
    const orderDb = buildAdminOrderBreakdownDb();
    orderDb.allocations[0]!.outboundShopifyRefundAttempts = [
      {
        id: 'attempt-latest',
        status: 'RESOLVED',
        restockType: 'CANCEL',
        refundShipping: false,
        notifyCustomer: false,
        previewedAt: new Date('2026-06-21T12:00:00.000Z'),
        requestedAt: new Date('2026-06-21T12:00:00.000Z'),
        submittedAt: new Date('2026-06-21T12:01:00.000Z'),
        resolvedAt: new Date('2026-06-21T12:02:00.000Z'),
        failedAt: null,
        failureReason: null,
        shopifyRefundId: 'gid://shopify/Refund/1',
        mutationResponseJson: {
          postRefundFulfillmentCheck: {
            status: 'passed',
            message: 'Refunded line items are no longer fulfillable in active Shopify fulfillment orders.',
          },
        },
      },
    ];
    prismaMock.shopifyOrder.findUnique.mockResolvedValueOnce(orderDb);

    const breakdown = await getAdminShopifyOrderBreakdown('gid://shopify/Order/1088');

    expect(breakdown?.allocations[0]?.outboundRefundAttemptSummary).toEqual({
      id: 'attempt-latest',
      status: 'RESOLVED',
      restockType: 'CANCEL',
      refundShipping: false,
      notifyCustomer: false,
      shopifyRefundId: 'gid://shopify/Refund/1',
      previewedAt: '2026-06-21T12:00:00.000Z',
      requestedAt: '2026-06-21T12:00:00.000Z',
      submittedAt: '2026-06-21T12:01:00.000Z',
      resolvedAt: '2026-06-21T12:02:00.000Z',
      failedAt: null,
      failureReason: null,
      postRefundFulfillmentCheckStatus: 'passed',
      postRefundFulfillmentCheckMessage: 'Refunded line items are no longer fulfillable in active Shopify fulfillment orders.',
    });
    expect(prismaMock.shopifyOrder.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({
        allocations: expect.objectContaining({
          include: expect.objectContaining({
            outboundShopifyRefundAttempts: expect.objectContaining({
              orderBy: {
                requestedAt: 'desc',
              },
              take: 1,
            }),
          }),
        }),
      }),
    }));
  });

  it('includes refunded line item details in admin Shopify order breakdown', async () => {
    const orderDb = buildAdminOrderBreakdownDb();
    orderDb.allocations[0]!.refundRecords = [
      {
        id: 'refund-yalispor-1',
        sourceShopifyRefundId: 'refund-1',
        amount: '100.00',
        status: 'processed',
        createdAt: new Date('2026-06-21T12:02:00.000Z'),
        updatedAt: new Date('2026-06-21T12:02:00.000Z'),
        lineItems: [
          {
            id: 'refund-line-1',
            sku: 'SKU-1',
            title: 'Refunded item',
            sourceLineItemId: 'gid://shopify/LineItem/1',
            quantity: 1,
            subtotal: '100.00',
            createdAt: new Date('2026-06-21T12:02:00.000Z'),
          },
        ],
      },
    ];
    prismaMock.shopifyOrder.findUnique.mockResolvedValueOnce(orderDb);

    const breakdown = await getAdminShopifyOrderBreakdown('gid://shopify/Order/1088');

    expect(breakdown?.allocations[0]?.refundRecords).toEqual([
      expect.objectContaining({
        id: 'refund-yalispor-1',
        sourceShopifyRefundId: 'refund-1',
        amount: '100.00',
        status: 'processed',
        lineItems: [
          {
            id: 'refund-line-1',
            sku: 'SKU-1',
            title: 'Refunded item',
            sourceLineItemId: 'gid://shopify/LineItem/1',
            quantity: 1,
            subtotal: '100.00',
          },
        ],
      }),
    ]);
    expect(prismaMock.shopifyOrder.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({
        allocations: expect.objectContaining({
          include: expect.objectContaining({
            refundRecords: expect.objectContaining({
              include: {
                lineItems: {
                  orderBy: {
                    createdAt: 'asc',
                  },
                },
              },
            }),
          }),
        }),
      }),
    }));
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
              select: expect.objectContaining({
                id: true,
                status: true,
                fromVendorId: true,
                toVendorId: true,
                reason: true,
                completedAt: true,
                adminActorUserId: true,
                createdAt: true,
                fromVendor: {
                  select: {
                    name: true,
                  },
                },
                toVendor: {
                  select: {
                    name: true,
                  },
                },
              }),
            }),
          }),
        }),
      }),
    }));
  });

  it('includes split summary in admin Shopify order breakdown allocations', async () => {
    const orderDb = buildAdminOrderBreakdownDb();
    orderDb.allocations[0]!.childAllocationSplitEvents = [
      {
        id: 'split-event-1',
        sourceAllocationId: 'alloc-source',
        childAllocationId: 'alloc-1088',
        reason: 'OUT_OF_STOCK',
        note: 'One selected line item was unavailable.',
        actorUserId: 'vendor-user-1',
        actorUser: {
          name: 'Vendor User',
        },
        createdAt: new Date('2026-06-21T12:45:00.000Z'),
        childAllocation: {
          lineItems: [
            {
              id: 'allocation-line-1',
              quantity: 1,
              lineAmount: '1000.00',
              shopifyOrderLineItem: {
                sourceLineItemId: 'gid://shopify/LineItem/1',
                sku: 'SKU-1088',
                title: 'Product',
              },
            },
          ],
        },
      },
    ];
    prismaMock.shopifyOrder.findUnique.mockResolvedValueOnce(orderDb);

    const breakdown = await getAdminShopifyOrderBreakdown('gid://shopify/Order/1088');

    expect(breakdown?.allocations[0]?.splitSummary).toEqual({
      splitEventId: 'split-event-1',
      sourceAllocationId: 'alloc-source',
      childAllocationId: 'alloc-1088',
      reason: 'OUT_OF_STOCK',
      note: 'One selected line item was unavailable.',
      createdAt: '2026-06-21T12:45:00.000Z',
      actorUserId: 'vendor-user-1',
      actorName: 'Vendor User',
      lineageRole: 'child',
      movedItems: [
        {
          vendorAllocationLineItemId: 'allocation-line-1',
          shopifyLineItemId: 'gid://shopify/LineItem/1',
          sku: 'SKU-1088',
          title: 'Product',
          quantity: 1,
          lineAmount: 1000,
        },
      ],
    });
    expect(prismaMock.shopifyOrder.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({
        allocations: expect.objectContaining({
          include: expect.objectContaining({
            sourceAllocationSplitEvents: expect.objectContaining({
              take: 1,
            }),
            childAllocationSplitEvents: expect.objectContaining({
              take: 1,
            }),
          }),
        }),
      }),
    }));
  });

  it('marks source allocations with source split lineage in admin Shopify order breakdown', async () => {
    const orderDb = buildAdminOrderBreakdownDb();
    orderDb.allocations[0]!.sourceAllocationSplitEvents = [
      {
        id: 'split-event-source',
        sourceAllocationId: 'alloc-1088',
        childAllocationId: 'alloc-child',
        reason: 'OUT_OF_STOCK',
        note: null,
        actorUserId: 'vendor-user-1',
        actorUser: null,
        createdAt: new Date('2026-06-21T12:45:00.000Z'),
        childAllocation: {
          lineItems: [
            {
              id: 'allocation-line-moved',
              quantity: 1,
              lineAmount: '250.00',
              shopifyOrderLineItem: {
                sourceLineItemId: 'gid://shopify/LineItem/moved',
                sku: 'SKU-MOVED',
                title: 'Moved item',
              },
            },
          ],
        },
      },
    ];
    prismaMock.shopifyOrder.findUnique.mockResolvedValueOnce(orderDb);

    const breakdown = await getAdminShopifyOrderBreakdown('gid://shopify/Order/1088');

    expect(breakdown?.allocations[0]?.splitSummary).toEqual(expect.objectContaining({
      sourceAllocationId: 'alloc-1088',
      childAllocationId: 'alloc-child',
      lineageRole: 'source',
      movedItems: [
        {
          vendorAllocationLineItemId: 'allocation-line-moved',
          shopifyLineItemId: 'gid://shopify/LineItem/moved',
          sku: 'SKU-MOVED',
          title: 'Moved item',
          quantity: 1,
          lineAmount: 250,
        },
      ],
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

  it('does not expose outbound Shopify refund attempt details through vendor order detail', async () => {
    prismaMock.vendorAllocation.findFirst.mockResolvedValueOnce(buildDetailAllocation({
      outboundShopifyRefundAttempts: [
        {
          id: 'attempt-1',
          status: 'PREVIEWED',
        },
      ],
    }));

    const detail = await getVendorOrderById('yalispor', 'alloc-1088');

    expect(detail).not.toHaveProperty('outboundRefundAttemptSummary');
    expect(detail).not.toHaveProperty('outboundShopifyRefundAttempts');
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

  it('includes split summary through vendor order detail', async () => {
    prismaMock.vendorAllocation.findFirst.mockResolvedValueOnce(buildDetailAllocation({
      childAllocationSplitEvents: [
        {
          id: 'split-event-1',
          sourceAllocationId: 'alloc-source',
          childAllocationId: 'alloc-1088',
          reason: 'OUT_OF_STOCK',
          note: 'One selected line item was unavailable.',
          actorUserId: 'vendor-user-1',
          actorUser: {
            name: 'Vendor User',
          },
          createdAt: new Date('2026-06-21T12:45:00.000Z'),
          childAllocation: {
            lineItems: [
              {
                id: 'allocation-line-1',
                quantity: 1,
                lineAmount: '1000.00',
                shopifyOrderLineItem: {
                  sourceLineItemId: 'gid://shopify/LineItem/1',
                  sku: 'SKU-1088',
                  title: 'Product',
                },
              },
            ],
          },
        },
      ],
    }));

    const detail = await getVendorOrderById('yalispor', 'alloc-1088');

    expect(detail?.splitSummary).toEqual({
      splitEventId: 'split-event-1',
      sourceAllocationId: 'alloc-source',
      childAllocationId: 'alloc-1088',
      reason: 'OUT_OF_STOCK',
      note: 'One selected line item was unavailable.',
      createdAt: '2026-06-21T12:45:00.000Z',
      actorUserId: 'vendor-user-1',
      actorName: 'Vendor User',
      lineageRole: 'child',
      movedItems: [
        {
          vendorAllocationLineItemId: 'allocation-line-1',
          shopifyLineItemId: 'gid://shopify/LineItem/1',
          sku: 'SKU-1088',
          title: 'Product',
          quantity: 1,
          lineAmount: 1000,
        },
      ],
    });
    expect(prismaMock.vendorAllocation.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({
        sourceAllocationSplitEvents: expect.objectContaining({
          take: 1,
        }),
        childAllocationSplitEvents: expect.objectContaining({
          take: 1,
        }),
      }),
    }));
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
