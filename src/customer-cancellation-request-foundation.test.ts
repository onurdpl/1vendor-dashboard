import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  shopifyOrder: {
    findUnique: vi.fn(),
  },
  vendorAllocationLineItem: {
    findFirst: vi.fn(),
  },
  customerCancellationRequest: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  customerCancellationRequestItem: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
  },
  vendorAllocation: {
    findMany: vi.fn(),
    update: vi.fn(),
  },
  refundRecord: {
    create: vi.fn(),
  },
  financeLedgerEntry: {
    create: vi.fn(),
  },
  shipmentExecution: {
    create: vi.fn(),
  },
  fulfillment: {
    create: vi.fn(),
  },
}));

const acquireShopifyOrderTransactionLockMock = vi.hoisted(() => vi.fn());

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: prismaMock,
}));

vi.mock('../backend/src/modules/shopify/orders-create-ownership.service.js', () => ({
  acquireShopifyOrderTransactionLock: acquireShopifyOrderTransactionLockMock,
}));

import {
  approveCustomerCancellationItemForRefund,
  createPendingCustomerCancellationRequest,
  CustomerCancellationRequestConflictError,
} from '../backend/src/modules/orders/customer-cancellation-request.service.js';
import {
  hasPendingCustomerCancellationHold,
  isPendingCustomerCancellationHoldState,
} from '../backend/src/modules/orders/customer-cancellation-hold.service.js';

const CustomerCancellationStatus = {
  PENDING: 'PENDING',
  PARTIALLY_RESOLVED: 'PARTIALLY_RESOLVED',
  APPROVED_FOR_REFUND: 'APPROVED_FOR_REFUND',
  APPROVED: 'APPROVED',
  DECLINED: 'DECLINED',
} as const;

function verifiedInput(overrides: Record<string, unknown> = {}) {
  return {
    shopifyOrderId: 'order-local-1',
    shopDomain: 'xgi47p-3k.myshopify.com',
    shopifyCustomerId: 'gid://shopify/Customer/1001',
    reasonCode: 'CUSTOMER_CHANGED_MIND',
    customerNote: 'Please cancel the selected item.',
    idempotencyKey: 'cancel-request-1',
    items: [
      {
        shopifyOrderLineItemId: 'line-local-1',
        vendorAllocationId: 'allocation-1',
        requestedQuantity: 1,
      },
    ],
    ...overrides,
  };
}

function createdRequest(input: ReturnType<typeof verifiedInput>) {
  return {
    id: 'customer-cancellation-1',
    shopifyOrderId: input.shopifyOrderId,
    shopDomain: input.shopDomain,
    shopifyCustomerId: input.shopifyCustomerId,
    status: CustomerCancellationStatus.PENDING,
    reasonCode: input.reasonCode,
    customerNote: input.customerNote,
    idempotencyKey: input.idempotencyKey,
    requestedAt: new Date('2026-08-30T12:00:00.000Z'),
    resolvedAt: null,
    reviewedByUserId: null,
    reviewReason: null,
    createdAt: new Date('2026-08-30T12:00:00.000Z'),
    updatedAt: new Date('2026-08-30T12:00:00.000Z'),
    items: input.items.map((item, index) => ({
      id: `customer-cancellation-item-${index + 1}`,
      requestId: 'customer-cancellation-1',
      ...item,
      resolvedQuantity: null,
      status: CustomerCancellationStatus.PENDING,
      reviewedByUserId: null,
      reviewReason: null,
      reviewedAt: null,
      createdAt: new Date('2026-08-30T12:00:00.000Z'),
      updatedAt: new Date('2026-08-30T12:00:00.000Z'),
    })),
  };
}

function emptyShipmentAuthority(allocationId: string) {
  return {
    id: allocationId,
    trackingNumber: null,
    carrier: null,
    vendorIntegrationTrackingUrl: null,
    vendorIntegrationShippedAt: null,
    fulfillment: null,
    shipmentExecutions: [],
    vendorIntegrationShipmentEvents: [],
  };
}

describe('customer cancellation request persistence and hold foundation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (callback) => callback(prismaMock));
    prismaMock.shopifyOrder.findUnique.mockResolvedValue({
      id: 'order-local-1',
      sourceShopifyOrderId: 'gid://shopify/Order/9001',
    });
    prismaMock.customerCancellationRequest.findUnique.mockResolvedValue(null);
    prismaMock.vendorAllocationLineItem.findFirst.mockResolvedValue({ quantity: 2 });
    prismaMock.customerCancellationRequestItem.findFirst.mockResolvedValue(null);
    prismaMock.vendorAllocation.findMany.mockResolvedValue([emptyShipmentAuthority('allocation-1')]);
    acquireShopifyOrderTransactionLockMock.mockResolvedValue(undefined);
  });

  it('persists one pending item under the canonical Shopify order lock without operational side effects', async () => {
    const input = verifiedInput();
    const expectedRequest = createdRequest(input);
    prismaMock.customerCancellationRequest.create.mockResolvedValue(expectedRequest);

    const result = await createPendingCustomerCancellationRequest(input);

    expect(result).toEqual({ request: expectedRequest, idempotent: false });
    expect(acquireShopifyOrderTransactionLockMock).toHaveBeenCalledWith(
      prismaMock,
      'gid://shopify/Order/9001',
    );
    expect(prismaMock.customerCancellationRequest.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        shopifyOrderId: 'order-local-1',
        status: CustomerCancellationStatus.PENDING,
        items: {
          create: [expect.objectContaining({
            shopifyOrderLineItemId: 'line-local-1',
            vendorAllocationId: 'allocation-1',
            requestedQuantity: 1,
            status: CustomerCancellationStatus.PENDING,
          })],
        },
      }),
    }));
    expect(acquireShopifyOrderTransactionLockMock.mock.invocationCallOrder[0]).toBeLessThan(
      prismaMock.customerCancellationRequest.create.mock.invocationCallOrder[0]!,
    );
    expect(prismaMock.vendorAllocation.update).not.toHaveBeenCalled();
    expect(prismaMock.refundRecord.create).not.toHaveBeenCalled();
    expect(prismaMock.financeLedgerEntry.create).not.toHaveBeenCalled();
    expect(prismaMock.shipmentExecution.create).not.toHaveBeenCalled();
    expect(prismaMock.fulfillment.create).not.toHaveBeenCalled();
  });

  it('persists one request containing items from multiple allocations', async () => {
    const input = verifiedInput({
      items: [
        {
          shopifyOrderLineItemId: 'line-local-1',
          vendorAllocationId: 'allocation-1',
          requestedQuantity: 1,
        },
        {
          shopifyOrderLineItemId: 'line-local-2',
          vendorAllocationId: 'allocation-2',
          requestedQuantity: 2,
        },
      ],
    });
    prismaMock.vendorAllocationLineItem.findFirst
      .mockResolvedValueOnce({ quantity: 1 })
      .mockResolvedValueOnce({ quantity: 2 });
    prismaMock.vendorAllocation.findMany.mockResolvedValue([
      emptyShipmentAuthority('allocation-1'),
      emptyShipmentAuthority('allocation-2'),
    ]);
    const expectedRequest = createdRequest(input);
    prismaMock.customerCancellationRequest.create.mockResolvedValue(expectedRequest);

    const result = await createPendingCustomerCancellationRequest(input);

    expect(result.request.items).toHaveLength(2);
    expect(prismaMock.vendorAllocationLineItem.findFirst).toHaveBeenCalledTimes(2);
    expect(prismaMock.customerCancellationRequest.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        items: {
          create: expect.arrayContaining([
            expect.objectContaining({ vendorAllocationId: 'allocation-1', requestedQuantity: 1 }),
            expect.objectContaining({ vendorAllocationId: 'allocation-2', requestedQuantity: 2 }),
          ]),
        },
      }),
    }));
  });

  it('returns the existing request for the same database idempotency identity', async () => {
    const input = verifiedInput();
    const existing = createdRequest(input);
    prismaMock.customerCancellationRequest.findUnique.mockResolvedValue(existing);

    const result = await createPendingCustomerCancellationRequest(input);

    expect(result).toEqual({ request: existing, idempotent: true });
    expect(prismaMock.customerCancellationRequest.create).not.toHaveBeenCalled();
    expect(prismaMock.vendorAllocationLineItem.findFirst).not.toHaveBeenCalled();
  });

  it('records a conflicted request when a provider-call claim already owns shipment authority', async () => {
    const input = verifiedInput();
    prismaMock.vendorAllocation.findMany.mockResolvedValue([{
      id: 'allocation-1',
      trackingNumber: null,
      carrier: null,
      vendorIntegrationTrackingUrl: null,
      vendorIntegrationShippedAt: null,
      fulfillment: null,
      shipmentExecutions: [{
        shipmentStatus: 'PENDING',
        providerShipmentId: null,
        trackingNumber: null,
        trackingUrl: null,
        labelUrl: null,
        responseSnapshot: { providerCallClaimedAt: '2026-08-30T10:00:00.000Z' },
      }],
      vendorIntegrationShipmentEvents: [],
    }]);
    prismaMock.customerCancellationRequest.create.mockResolvedValue({
      ...createdRequest(input),
      status: 'CONFLICTED',
      items: createdRequest(input).items.map((item) => ({ ...item, status: 'CONFLICTED' })),
    });

    const result = await createPendingCustomerCancellationRequest(input);

    expect(prismaMock.customerCancellationRequest.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'CONFLICTED',
        items: { create: [expect.objectContaining({ status: 'CONFLICTED' })] },
      }),
    }));
    expect(result.request.status).toBe('CONFLICTED');
  });

  it('records a too-late request when real carrier evidence already exists', async () => {
    const input = verifiedInput();
    prismaMock.vendorAllocation.findMany.mockResolvedValue([{
      id: 'allocation-1',
      trackingNumber: 'TRACK-ALREADY-SHIPPED',
      carrier: 'Existing Carrier',
      vendorIntegrationTrackingUrl: null,
      vendorIntegrationShippedAt: null,
      fulfillment: null,
      shipmentExecutions: [],
      vendorIntegrationShipmentEvents: [],
    }]);
    prismaMock.customerCancellationRequest.create.mockResolvedValue({
      ...createdRequest(input),
      status: 'TOO_LATE',
      items: createdRequest(input).items.map((item) => ({ ...item, status: 'TOO_LATE' })),
    });

    const result = await createPendingCustomerCancellationRequest(input);

    expect(prismaMock.customerCancellationRequest.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'TOO_LATE' }),
    }));
    expect(result.request.status).toBe('TOO_LATE');
  });

  it('keeps shipment authority allocation-scoped in a mixed multi-vendor request', async () => {
    const input = verifiedInput({
      items: [
        { shopifyOrderLineItemId: 'line-local-1', vendorAllocationId: 'allocation-1', requestedQuantity: 1 },
        { shopifyOrderLineItemId: 'line-local-2', vendorAllocationId: 'allocation-2', requestedQuantity: 1 },
      ],
    });
    prismaMock.vendorAllocationLineItem.findFirst.mockResolvedValue({ quantity: 1 });
    prismaMock.vendorAllocation.findMany.mockResolvedValue([
      { ...emptyShipmentAuthority('allocation-1'), trackingNumber: 'ALREADY-SHIPPED' },
      emptyShipmentAuthority('allocation-2'),
    ]);
    prismaMock.customerCancellationRequest.create.mockResolvedValue({
      ...createdRequest(input),
      status: 'PARTIALLY_RESOLVED',
      items: createdRequest(input).items.map((item, index) => ({
        ...item,
        status: index === 0 ? 'TOO_LATE' : 'PENDING',
      })),
    });

    await createPendingCustomerCancellationRequest(input);

    expect(prismaMock.customerCancellationRequest.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'PARTIALLY_RESOLVED',
        items: {
          create: [
            expect.objectContaining({ vendorAllocationId: 'allocation-1', status: 'TOO_LATE' }),
            expect.objectContaining({ vendorAllocationId: 'allocation-2', status: 'PENDING' }),
          ],
        },
      }),
    }));
  });

  it('rejects a different active request affecting the same allocation after acquiring the order lock', async () => {
    prismaMock.customerCancellationRequestItem.findFirst.mockResolvedValue({ id: 'pending-item-existing' });

    await expect(createPendingCustomerCancellationRequest(verifiedInput({ idempotencyKey: 'different-key' })))
      .rejects.toBeInstanceOf(CustomerCancellationRequestConflictError);

    expect(acquireShopifyOrderTransactionLockMock).toHaveBeenCalledTimes(1);
    expect(prismaMock.customerCancellationRequest.create).not.toHaveBeenCalled();
  });

  it('treats only pending items on active requests as authoritative holds', async () => {
    expect(isPendingCustomerCancellationHoldState({
      requestStatus: CustomerCancellationStatus.PENDING,
      itemStatus: CustomerCancellationStatus.PENDING,
    })).toBe(true);
    expect(isPendingCustomerCancellationHoldState({
      requestStatus: CustomerCancellationStatus.PARTIALLY_RESOLVED,
      itemStatus: CustomerCancellationStatus.PENDING,
    })).toBe(true);
    expect(isPendingCustomerCancellationHoldState({
      requestStatus: CustomerCancellationStatus.APPROVED_FOR_REFUND,
      itemStatus: CustomerCancellationStatus.APPROVED_FOR_REFUND,
    })).toBe(true);
    expect(isPendingCustomerCancellationHoldState({
      requestStatus: CustomerCancellationStatus.APPROVED,
      itemStatus: CustomerCancellationStatus.PENDING,
    })).toBe(false);
    expect(isPendingCustomerCancellationHoldState({
      requestStatus: CustomerCancellationStatus.PENDING,
      itemStatus: CustomerCancellationStatus.DECLINED,
    })).toBe(false);
    for (const resolvedStatus of ['APPROVED', 'DECLINED', 'TOO_LATE', 'CONFLICTED'] as const) {
      expect(isPendingCustomerCancellationHoldState({
        requestStatus: resolvedStatus as never,
        itemStatus: resolvedStatus as never,
      })).toBe(false);
    }
  });

  it('loads persisted pending hold state without consulting Vendor Reject fields', async () => {
    const holdDb = {
      customerCancellationRequestItem: {
        findFirst: vi.fn().mockResolvedValueOnce({ id: 'pending-item' }).mockResolvedValueOnce(null),
      },
    };

    await expect(hasPendingCustomerCancellationHold('allocation-1', holdDb as never)).resolves.toBe(true);
    await expect(hasPendingCustomerCancellationHold('allocation-1', holdDb as never)).resolves.toBe(false);

    expect(holdDb.customerCancellationRequestItem.findFirst).toHaveBeenCalledWith({
      where: {
        vendorAllocationId: 'allocation-1',
        status: {
          in: [CustomerCancellationStatus.PENDING, CustomerCancellationStatus.APPROVED_FOR_REFUND],
        },
        request: {
          status: {
            in: [
              CustomerCancellationStatus.PENDING,
              CustomerCancellationStatus.PARTIALLY_RESOLVED,
              CustomerCancellationStatus.APPROVED_FOR_REFUND,
            ],
          },
        },
      },
      select: {
        id: true,
      },
    });
  });

  it('transitions only a pending item to approved-for-refund under the canonical order lock', async () => {
    prismaMock.customerCancellationRequestItem.findUnique
      .mockResolvedValueOnce({
        requestId: 'customer-cancellation-1',
        request: { order: { sourceShopifyOrderId: 'gid://shopify/Order/9001' } },
      })
      .mockResolvedValueOnce({
        id: 'item-a',
        requestId: 'customer-cancellation-1',
        status: CustomerCancellationStatus.PENDING,
        request: {
          status: CustomerCancellationStatus.PENDING,
          items: [{ id: 'item-a', status: CustomerCancellationStatus.PENDING }],
        },
      });
    prismaMock.customerCancellationRequestItem.update.mockImplementation(async ({ data }) => ({
      id: 'item-a',
      requestId: 'customer-cancellation-1',
      ...data,
    }));
    prismaMock.customerCancellationRequest.update.mockImplementation(async ({ data }) => ({
      id: 'customer-cancellation-1',
      ...data,
    }));

    const result = await approveCustomerCancellationItemForRefund({
      requestId: 'customer-cancellation-1',
      itemId: 'item-a',
      reviewedByUserId: 'admin-1',
      reviewReason: 'Approved for later refund execution.',
    });

    expect(acquireShopifyOrderTransactionLockMock).toHaveBeenCalledWith(
      prismaMock,
      'gid://shopify/Order/9001',
    );
    expect(prismaMock.customerCancellationRequestItem.update).toHaveBeenCalledWith({
      where: { id: 'item-a' },
      data: expect.objectContaining({
        status: CustomerCancellationStatus.APPROVED_FOR_REFUND,
        reviewedByUserId: 'admin-1',
        reviewReason: 'Approved for later refund execution.',
        reviewedAt: expect.any(Date),
      }),
    });
    expect(prismaMock.customerCancellationRequest.update).toHaveBeenCalledWith({
      where: { id: 'customer-cancellation-1' },
      data: { status: CustomerCancellationStatus.APPROVED_FOR_REFUND, resolvedAt: null },
    });
    expect(result.request.status).toBe(CustomerCancellationStatus.APPROVED_FOR_REFUND);
    expect(isPendingCustomerCancellationHoldState({
      requestStatus: result.request.status,
      itemStatus: result.item.status,
    })).toBe(true);
    expect(prismaMock.refundRecord.create).not.toHaveBeenCalled();
    expect(prismaMock.financeLedgerEntry.create).not.toHaveBeenCalled();
    expect(prismaMock.shipmentExecution.create).not.toHaveBeenCalled();
    expect(prismaMock.fulfillment.create).not.toHaveBeenCalled();
  });

  it('keeps mixed vendor item decisions allocation-scoped', async () => {
    prismaMock.customerCancellationRequestItem.findUnique
      .mockResolvedValueOnce({
        requestId: 'customer-cancellation-1',
        request: { order: { sourceShopifyOrderId: 'gid://shopify/Order/9001' } },
      })
      .mockResolvedValueOnce({
        id: 'item-a',
        requestId: 'customer-cancellation-1',
        status: CustomerCancellationStatus.PENDING,
        request: {
          status: CustomerCancellationStatus.PARTIALLY_RESOLVED,
          items: [
            { id: 'item-a', status: CustomerCancellationStatus.PENDING },
            { id: 'item-b', status: CustomerCancellationStatus.DECLINED },
          ],
        },
      });
    prismaMock.customerCancellationRequestItem.update.mockResolvedValue({
      id: 'item-a',
      requestId: 'customer-cancellation-1',
      status: CustomerCancellationStatus.APPROVED_FOR_REFUND,
    });
    prismaMock.customerCancellationRequest.update.mockResolvedValue({
      id: 'customer-cancellation-1',
      status: CustomerCancellationStatus.PARTIALLY_RESOLVED,
    });

    const result = await approveCustomerCancellationItemForRefund({
      requestId: 'customer-cancellation-1',
      itemId: 'item-a',
      reviewedByUserId: 'admin-1',
      reviewReason: 'Vendor A approved for refund.',
    });

    expect(prismaMock.customerCancellationRequest.update).toHaveBeenCalledWith({
      where: { id: 'customer-cancellation-1' },
      data: { status: CustomerCancellationStatus.PARTIALLY_RESOLVED, resolvedAt: null },
    });
    expect(isPendingCustomerCancellationHoldState({
      requestStatus: result.request.status,
      itemStatus: CustomerCancellationStatus.APPROVED_FOR_REFUND,
    })).toBe(true);
    expect(isPendingCustomerCancellationHoldState({
      requestStatus: result.request.status,
      itemStatus: CustomerCancellationStatus.DECLINED,
    })).toBe(false);
  });

  it('rejects approved-for-refund to approved without refund reconciliation authority', async () => {
    prismaMock.customerCancellationRequestItem.findUnique
      .mockResolvedValueOnce({
        requestId: 'customer-cancellation-1',
        request: { order: { sourceShopifyOrderId: 'gid://shopify/Order/9001' } },
      })
      .mockResolvedValueOnce({
        id: 'item-a',
        requestId: 'customer-cancellation-1',
        status: CustomerCancellationStatus.APPROVED_FOR_REFUND,
        request: {
          status: CustomerCancellationStatus.APPROVED_FOR_REFUND,
          items: [{ id: 'item-a', status: CustomerCancellationStatus.APPROVED_FOR_REFUND }],
        },
      });

    await expect(approveCustomerCancellationItemForRefund({
      requestId: 'customer-cancellation-1',
      itemId: 'item-a',
      reviewedByUserId: 'admin-1',
      reviewReason: 'Duplicate approval.',
    })).rejects.toBeInstanceOf(CustomerCancellationRequestConflictError);
    expect(prismaMock.customerCancellationRequestItem.update).not.toHaveBeenCalled();
    expect(prismaMock.customerCancellationRequest.update).not.toHaveBeenCalled();
  });
});
