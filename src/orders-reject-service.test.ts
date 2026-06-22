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
  rejectVendorOrderAllocation,
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
