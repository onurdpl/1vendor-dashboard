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
  },
  customerCancellationRequestItem: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
  vendorAllocation: {
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
      requestStatus: CustomerCancellationStatus.APPROVED,
      itemStatus: CustomerCancellationStatus.PENDING,
    })).toBe(false);
    expect(isPendingCustomerCancellationHoldState({
      requestStatus: CustomerCancellationStatus.PENDING,
      itemStatus: CustomerCancellationStatus.DECLINED,
    })).toBe(false);
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
        status: CustomerCancellationStatus.PENDING,
        request: {
          status: {
            in: [CustomerCancellationStatus.PENDING, CustomerCancellationStatus.PARTIALLY_RESOLVED],
          },
        },
      },
      select: {
        id: true,
      },
    });
  });
});
