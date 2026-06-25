import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppEnv } from '../backend/src/config/env.js';

const prismaMock = vi.hoisted(() => ({
  shopifyOrder: {
    findUnique: vi.fn(),
  },
  vendorAllocation: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  fulfillment: {
    upsert: vi.fn(),
  },
  refundRecord: {
    update: vi.fn(),
  },
  returnRecord: {
    update: vi.fn(),
  },
  financeLedgerEntry: {
    create: vi.fn(),
  },
  vendorBalanceEvent: {
    upsert: vi.fn(),
  },
  operationalSignal: {
    upsert: vi.fn(),
    updateMany: vi.fn(),
  },
  $transaction: vi.fn((callback: (tx: typeof prismaMock) => unknown) => callback(prismaMock)),
}));

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: prismaMock,
}));

const { createReconciliationService, __reconciliationTesting } = await import(
  '../backend/src/modules/reconciliation/reconciliation.service.js'
);

function buildEnv(fulfillments: Array<Record<string, unknown>>): AppEnv {
  return {
    SHOPIFY_API_VERSION: '2026-01',
    SHOPIFY_MOCK_ORDER_FULFILLMENT_STATE: JSON.stringify({
      'order-1': {
        orderName: '#1001',
        displayFulfillmentStatus: fulfillments.length > 0 ? 'FULFILLED' : 'UNFULFILLED',
        fulfillments,
      },
    }),
    SHOPIFY_MOCK_FULFILLMENT_ORDERS: JSON.stringify({}),
  } as AppEnv;
}

function saleLedger(allocationId: string) {
  return {
    id: `fin-vendor-a-sale-order-1-${allocationId}`,
    vendorId: 'vendor-a',
    entryType: 'sale',
    amount: '100.00',
    payoutStatus: 'PENDING',
    settlementStatus: 'PENDING',
    voidedAt: null,
    supersededByLedgerId: null,
    payoutBatchLines: [],
    settlementApprovalLines: [],
  };
}

function allocation(input: {
  id?: string;
  fulfillmentStatus?: string;
  shippingStatus?: string;
  trackingNumber?: string | null;
  carrier?: string | null;
  fulfillment?: Record<string, unknown> | null;
}) {
  const allocationId = input.id ?? 'alloc-a';
  return {
    id: allocationId,
    assignedVendorId: 'vendor-a',
    originalVendorId: 'vendor-a',
    fulfillmentStatus: input.fulfillmentStatus ?? 'pending',
    shippingStatus: input.shippingStatus ?? 'awaiting_shipment',
    trackingNumber: input.trackingNumber ?? null,
    carrier: input.carrier ?? null,
    fulfillment: input.fulfillment ?? null,
    lineItems: [
      {
        id: 'allocation-line-1',
        shopifyOrderLineItem: {
          id: 'line-1',
          sourceLineItemId: 'line-1',
        },
      },
    ],
    refundRecords: [],
    returnRecords: [],
    economicTransfers: [],
    financeEntries: [saleLedger(allocationId)],
  };
}

function shopifyOrder(allocations: Array<ReturnType<typeof allocation>>) {
  return {
    id: 'shopify-order-db-1',
    sourceShopifyOrderId: 'order-1',
    sourceShopifyOrderNumber: '#1001',
    currency: 'TRY',
    allocations,
  };
}

function fulfillment(lineItemId = 'line-1') {
  return {
    id: 'gid://shopify/Fulfillment/fulfillment-1',
    sourceFulfillmentId: 'fulfillment-1',
    status: 'SUCCESS',
    createdAt: '2026-06-25T10:00:00.000Z',
    updatedAt: '2026-06-25T11:00:00.000Z',
    events: [
      {
        status: 'delivered',
        happenedAt: '2026-06-25T12:00:00.000Z',
      },
    ],
    trackingInfo: [
      {
        company: 'Carrier A',
        number: 'TRACK-1',
        url: 'https://tracking.example/TRACK-1',
      },
    ],
    lineItems: [
      {
        lineItemGid: `gid://shopify/LineItem/${lineItemId}`,
        sourceLineItemId: lineItemId,
        sku: 'SKU-1',
        quantity: 1,
      },
    ],
  };
}

describe('fulfillment reconciliation downgrade protection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation((callback: (tx: typeof prismaMock) => unknown) => callback(prismaMock));
  });

  it('updates local fulfillment state when a canonical fulfillment line is matched', async () => {
    prismaMock.shopifyOrder.findUnique.mockResolvedValueOnce(shopifyOrder([allocation({})]));

    const result = await createReconciliationService(buildEnv([fulfillment()])).reconcileShopifyOrder('order-1');

    expect(result?.reconciliationStatus).toBe('repaired');
    expect(prismaMock.vendorAllocation.update).toHaveBeenCalledWith({
      where: { id: 'alloc-a' },
      data: {
        fulfillmentStatus: 'fulfilled',
        shippingStatus: 'delivered',
        trackingNumber: 'TRACK-1',
        carrier: 'Carrier A',
      },
    });
    expect(prismaMock.fulfillment.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { vendorAllocationId: 'alloc-a' },
      update: expect.objectContaining({
        fulfillmentStatus: 'fulfilled',
        trackingNumber: 'TRACK-1',
        carrier: 'Carrier A',
        trackingUrl: 'https://tracking.example/TRACK-1',
        syncStatus: 'shopify_reconciled',
      }),
    }));
    expect(prismaMock.operationalSignal.updateMany).toHaveBeenCalledWith({
      where: {
        id: __reconciliationTesting.buildCanonicalFulfillmentMatchMissingSignalId('alloc-a'),
        status: {
          in: ['ACTIVE', 'ACKNOWLEDGED'],
        },
      },
      data: {
        status: 'RESOLVED',
        resolvedAt: expect.any(Date),
      },
    });
  });

  it('preserves delivered state and creates a reconciliation issue when no canonical line matches', async () => {
    prismaMock.shopifyOrder.findUnique.mockResolvedValueOnce(shopifyOrder([
      allocation({
        fulfillmentStatus: 'fulfilled',
        shippingStatus: 'delivered',
        trackingNumber: 'TRACK-DELIVERED',
        carrier: 'Carrier A',
        fulfillment: {
          trackingUrl: 'https://tracking.example/TRACK-DELIVERED',
          shopifyFulfillmentId: 'fulfillment-local',
          fulfilledAt: new Date('2026-06-24T10:00:00.000Z'),
          shipmentCreatedAt: new Date('2026-06-24T10:00:00.000Z'),
          shipmentUpdatedAt: new Date('2026-06-24T12:00:00.000Z'),
        },
      }),
    ]));

    const result = await createReconciliationService(buildEnv([])).reconcileShopifyOrder('order-1');

    expect(result?.reconciliationStatus).toBe('needs_attention');
    expect(result?.requiresManualReview).toBe(true);
    expect(result?.skippedFields).toEqual([
      expect.objectContaining({
        scope: 'alloc-a',
        field: 'canonicalFulfillmentMatch',
        localValue: 'local_fulfillment_state_preserved',
        canonicalValue: null,
      }),
    ]);
    expect(result?.warnings.join(' ')).toContain('Canonical fulfillment line could not be matched');
    expect(prismaMock.vendorAllocation.update).not.toHaveBeenCalled();
    expect(prismaMock.fulfillment.upsert).not.toHaveBeenCalled();
    expect(prismaMock.operationalSignal.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: __reconciliationTesting.buildCanonicalFulfillmentMatchMissingSignalId('alloc-a'),
      },
      create: expect.objectContaining({
        ruleKey: __reconciliationTesting.CANONICAL_FULFILLMENT_MATCH_MISSING_RULE_KEY,
        sourceArea: 'RECONCILIATION',
        vendorId: 'vendor-a',
        allocationId: 'alloc-a',
        description: 'Canonical fulfillment line could not be matched. Local state preserved. Manual review recommended.',
        metadata: expect.objectContaining({
          sourceShopifyOrderId: 'order-1',
          sourceShopifyOrderNumber: '#1001',
          localFulfillmentStatus: 'fulfilled',
          localShippingStatus: 'delivered',
          localTrackingNumber: 'TRACK-DELIVERED',
        }),
      }),
      update: expect.objectContaining({
        status: 'ACTIVE',
        resolvedAt: null,
      }),
    }));
  });

  it('preserves shipped state when no canonical line matches', async () => {
    prismaMock.shopifyOrder.findUnique.mockResolvedValueOnce(shopifyOrder([
      allocation({
        fulfillmentStatus: 'fulfilled',
        shippingStatus: 'shipped',
        trackingNumber: 'TRACK-SHIPPED',
        carrier: 'Carrier A',
      }),
    ]));

    const result = await createReconciliationService(buildEnv([])).reconcileShopifyOrder('order-1');

    expect(result?.reconciliationStatus).toBe('needs_attention');
    expect(prismaMock.vendorAllocation.update).not.toHaveBeenCalled();
    expect(prismaMock.fulfillment.upsert).not.toHaveBeenCalled();
    expect(prismaMock.operationalSignal.upsert).toHaveBeenCalledTimes(1);
  });

  it('does not create duplicate reconciliation issues on repeated missing-match reconciliation', async () => {
    prismaMock.shopifyOrder.findUnique.mockResolvedValue(shopifyOrder([
      allocation({
        fulfillmentStatus: 'fulfilled',
        shippingStatus: 'delivered',
        trackingNumber: 'TRACK-DELIVERED',
      }),
    ]));

    const service = createReconciliationService(buildEnv([]));
    await service.reconcileShopifyOrder('order-1');
    await service.reconcileShopifyOrder('order-1');

    expect(prismaMock.operationalSignal.upsert).toHaveBeenCalledTimes(2);
    expect(prismaMock.operationalSignal.upsert.mock.calls[0]?.[0].where).toEqual(
      prismaMock.operationalSignal.upsert.mock.calls[1]?.[0].where,
    );
  });

  it('resolves a prior missing-match issue when a later reconciliation finds canonical fulfillment', async () => {
    prismaMock.shopifyOrder.findUnique.mockResolvedValueOnce(shopifyOrder([
      allocation({
        fulfillmentStatus: 'fulfilled',
        shippingStatus: 'delivered',
        trackingNumber: 'TRACK-DELIVERED',
      }),
    ]));

    await createReconciliationService(buildEnv([fulfillment()])).reconcileShopifyOrder('order-1');

    expect(prismaMock.operationalSignal.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: __reconciliationTesting.buildCanonicalFulfillmentMatchMissingSignalId('alloc-a'),
      }),
      data: expect.objectContaining({
        status: 'RESOLVED',
      }),
    }));
  });
});
