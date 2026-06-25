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
  $transaction: vi.fn((callback: (tx: typeof prismaMock) => unknown) => callback(prismaMock)),
}));

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: prismaMock,
}));

const { createReconciliationService } = await import('../backend/src/modules/reconciliation/reconciliation.service.js');

const env = {
  SHOPIFY_API_VERSION: '2026-01',
  SHOPIFY_MOCK_ORDER_FULFILLMENT_STATE: JSON.stringify({
    'order-1': {
      orderName: '#1001',
      displayFulfillmentStatus: 'UNFULFILLED',
      fulfillments: [],
    },
  }),
  SHOPIFY_MOCK_FULFILLMENT_ORDERS: JSON.stringify({}),
} as AppEnv;

function saleLedger(input: {
  id: string;
  vendorId: string;
}) {
  return {
    id: input.id,
    vendorId: input.vendorId,
    entryType: 'sale',
    amount: '100.00',
    payoutStatus: 'PENDING',
    settlementStatus: 'PENDING',
    voidedAt: null,
    supersededByLedgerId: null,
    commissionPercentSnapshot: '20.00',
    commissionVatPercentSnapshot: '20.00',
    payoutBatchLines: [],
    settlementApprovalLines: [],
  };
}

function refundLedger(input: {
  id: string;
  vendorId: string;
}) {
  return {
    id: input.id,
    vendorId: input.vendorId,
    entryType: 'refund',
    amount: '10.00',
    payoutStatus: 'PENDING',
    settlementStatus: 'PARTIALLY_REFUNDED',
    voidedAt: null,
    commissionPercentSnapshot: '20.00',
    commissionVatPercentSnapshot: '20.00',
    payoutBatchLines: [],
    settlementApprovalLines: [],
  };
}

function orderLineItem(sourceLineItemId: string) {
  return {
    id: `line-${sourceLineItemId}`,
    sourceLineItemId,
  };
}

function allocation(input: {
  id: string;
  vendorId: string;
  sourceLineItemId: string;
  refundId?: string;
  amount?: string;
  financeEntries?: Array<Record<string, unknown>>;
}) {
  const lineItem = orderLineItem(input.sourceLineItemId);
  return {
    id: input.id,
    assignedVendorId: input.vendorId,
    originalVendorId: input.vendorId,
    fulfillmentStatus: 'pending',
    shippingStatus: 'awaiting_shipment',
    trackingNumber: null,
    carrier: null,
    fulfillment: null,
    lineItems: [
      {
        id: `allocation-line-${input.sourceLineItemId}`,
        shopifyOrderLineItem: lineItem,
      },
    ],
    refundRecords: [
      {
        id: `refund-record-${input.id}`,
        sourceShopifyRefundId: input.refundId ?? 'refund-1',
        amount: input.amount ?? '10.00',
        status: 'processed',
        sourceShopifyOrderId: 'order-1',
        sourceShopifyOrderNumber: '#1001',
      },
    ],
    returnRecords: [],
    economicTransfers: [],
    financeEntries: input.financeEntries ?? [],
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

function mockEconomicOwnerFromAllocationRows(allocations: Array<ReturnType<typeof allocation>>) {
  prismaMock.vendorAllocation.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
    const match = allocations.find((entry) => entry.id === where.id);
    if (!match) {
      return null;
    }

    return {
      id: match.id,
      financeEntries: match.financeEntries.filter((entry) => entry.entryType === 'sale'),
      economicTransfers: [],
    };
  });
}

describe('refund ledger reconciliation ids', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation((callback: (tx: typeof prismaMock) => unknown) => callback(prismaMock));
  });

  it('does not mark an existing allocation-scoped refund ledger as missing', async () => {
    const sale = saleLedger({ id: 'fin-vendor-a-sale-order-1-alloc-a', vendorId: 'vendor-a' });
    const refund = refundLedger({ id: 'fin-vendor-a-refund-refund-1-alloc-a', vendorId: 'vendor-a' });
    const allocations = [
      allocation({
        id: 'alloc-a',
        vendorId: 'vendor-a',
        sourceLineItemId: 'line-1',
        financeEntries: [sale, refund],
      }),
    ];
    prismaMock.shopifyOrder.findUnique.mockResolvedValueOnce(shopifyOrder(allocations));
    mockEconomicOwnerFromAllocationRows(allocations);

    const result = await createReconciliationService(env).reconcileShopifyOrder('order-1');

    expect(result?.reconciliationStatus).toBe('in_sync');
    expect(result?.staleFields).toEqual([]);
    expect(prismaMock.financeLedgerEntry.create).not.toHaveBeenCalled();
  });

  it('repairs multi-allocation refunds with one allocation-scoped ledger per allocation', async () => {
    const firstSale = saleLedger({ id: 'fin-vendor-a-sale-order-1-alloc-a', vendorId: 'vendor-a' });
    const secondSale = saleLedger({ id: 'fin-vendor-a-sale-order-1-alloc-b', vendorId: 'vendor-a' });
    const allocations = [
      allocation({
        id: 'alloc-a',
        vendorId: 'vendor-a',
        sourceLineItemId: 'line-1',
        financeEntries: [firstSale],
      }),
      allocation({
        id: 'alloc-b',
        vendorId: 'vendor-a',
        sourceLineItemId: 'line-2',
        financeEntries: [secondSale],
      }),
    ];
    prismaMock.shopifyOrder.findUnique.mockResolvedValueOnce(shopifyOrder(allocations));
    mockEconomicOwnerFromAllocationRows(allocations);
    prismaMock.financeLedgerEntry.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => data);

    const result = await createReconciliationService(env).reconcileShopifyOrder('order-1');

    expect(result?.reconciliationStatus).toBe('repaired');
    expect(prismaMock.financeLedgerEntry.create).toHaveBeenCalledTimes(2);
    expect(prismaMock.financeLedgerEntry.create).toHaveBeenNthCalledWith(1, expect.objectContaining({
      data: expect.objectContaining({
        id: 'fin-vendor-a-refund-refund-1-alloc-a',
        vendorAllocationId: 'alloc-a',
      }),
    }));
    expect(prismaMock.financeLedgerEntry.create).toHaveBeenNthCalledWith(2, expect.objectContaining({
      data: expect.objectContaining({
        id: 'fin-vendor-a-refund-refund-1-alloc-b',
        vendorAllocationId: 'alloc-b',
      }),
    }));
  });

  it('reports legacy non-allocation-scoped refund ledgers without creating duplicates', async () => {
    const sale = saleLedger({ id: 'fin-vendor-a-sale-order-1-alloc-a', vendorId: 'vendor-a' });
    const legacyRefund = refundLedger({ id: 'fin-vendor-a-refund-refund-1', vendorId: 'vendor-a' });
    const allocations = [
      allocation({
        id: 'alloc-a',
        vendorId: 'vendor-a',
        sourceLineItemId: 'line-1',
        financeEntries: [sale, legacyRefund],
      }),
    ];
    prismaMock.shopifyOrder.findUnique.mockResolvedValueOnce(shopifyOrder(allocations));
    mockEconomicOwnerFromAllocationRows(allocations);

    const result = await createReconciliationService(env).reconcileShopifyOrder('order-1');

    expect(result?.reconciliationStatus).toBe('needs_attention');
    expect(result?.skippedFields).toEqual([
      expect.objectContaining({
        scope: 'refund-record-alloc-a',
        field: 'financeLedgerEntry',
        canonicalValue: 'fin-vendor-a-refund-refund-1-alloc-a',
      }),
    ]);
    expect(result?.warnings.join(' ')).toContain('Legacy refund ledger fin-vendor-a-refund-refund-1 already exists');
    expect(prismaMock.financeLedgerEntry.create).not.toHaveBeenCalled();
  });
});
