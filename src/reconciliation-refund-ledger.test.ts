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
    findMany: vi.fn(),
  },
  vendorBalanceEvent: {
    upsert: vi.fn(),
  },
  $transaction: vi.fn((callback: (tx: typeof prismaMock) => unknown) => callback(prismaMock)),
}));
const reconcileCanonicalRefundsMock = vi.hoisted(() => vi.fn());

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: prismaMock,
}));
vi.mock('../backend/src/modules/reconciliation/canonical-refund-reconciliation.service.js', () => ({
  createCanonicalRefundReconciliationService: () => ({
    reconcileShopifyOrderRefunds: reconcileCanonicalRefundsMock,
  }),
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
    prismaMock.financeLedgerEntry.findMany.mockResolvedValue([]);
    reconcileCanonicalRefundsMock.mockResolvedValue(null);
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

  it('delegates missing multi-allocation refund finance to canonical reconciliation without a local first effect', async () => {
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
    const result = await createReconciliationService(env).reconcileShopifyOrder('order-1');

    expect(result?.reconciliationStatus).toBe('needs_attention');
    expect(result?.skippedFields).toEqual(expect.arrayContaining([
      expect.objectContaining({ scope: 'refund-record-alloc-a', field: 'financeLedgerEntry' }),
      expect.objectContaining({ scope: 'refund-record-alloc-b', field: 'financeLedgerEntry' }),
    ]));
    expect(reconcileCanonicalRefundsMock).toHaveBeenCalledTimes(1);
    expect(reconcileCanonicalRefundsMock).toHaveBeenCalledWith('order-1', {});
    expect(prismaMock.financeLedgerEntry.create).not.toHaveBeenCalled();
    expect(prismaMock.vendorBalanceEvent.upsert).not.toHaveBeenCalled();
  });

  it('reports finance repaired only after canonical reconciliation creates the expected active ledger', async () => {
    const allocations = [allocation({
      id: 'alloc-a',
      vendorId: 'vendor-a',
      sourceLineItemId: 'line-1',
      financeEntries: [saleLedger({ id: 'fin-vendor-a-sale-order-1-alloc-a', vendorId: 'vendor-a' })],
    })];
    prismaMock.shopifyOrder.findUnique.mockResolvedValueOnce(shopifyOrder(allocations));
    mockEconomicOwnerFromAllocationRows(allocations);
    prismaMock.financeLedgerEntry.findMany.mockResolvedValueOnce([
      { id: 'fin-vendor-a-refund-refund-1-alloc-a', vendorId: 'vendor-a' },
    ]);

    const result = await createReconciliationService(env).reconcileShopifyOrder('order-1');

    expect(result?.reconciliationStatus).toBe('repaired');
    expect(result?.repairedFields).toEqual([
      expect.objectContaining({ scope: 'refund-record-alloc-a', field: 'financeLedgerEntry' }),
    ]);
    expect(result?.skippedFields).toEqual([]);
    expect(result?.warnings).toEqual([]);
    expect(prismaMock.financeLedgerEntry.create).not.toHaveBeenCalled();
  });

  it('keeps canonical refund recovery scoped to the requested allocation', async () => {
    const allocations = [
      allocation({
        id: 'alloc-a',
        vendorId: 'vendor-a',
        sourceLineItemId: 'line-1',
        financeEntries: [saleLedger({ id: 'fin-vendor-a-sale-order-1-alloc-a', vendorId: 'vendor-a' })],
      }),
      allocation({
        id: 'alloc-b',
        vendorId: 'vendor-b',
        sourceLineItemId: 'line-2',
        financeEntries: [saleLedger({ id: 'fin-vendor-b-sale-order-1-alloc-b', vendorId: 'vendor-b' })],
      }),
    ];
    prismaMock.shopifyOrder.findUnique.mockResolvedValueOnce(shopifyOrder(allocations));
    prismaMock.vendorAllocation.findUnique.mockResolvedValueOnce({
      order: { sourceShopifyOrderId: 'order-1' },
    });
    mockEconomicOwnerFromAllocationRows(allocations);

    await createReconciliationService(env).reconcileAllocation('alloc-a');

    expect(reconcileCanonicalRefundsMock).toHaveBeenCalledTimes(1);
    expect(reconcileCanonicalRefundsMock).toHaveBeenCalledWith('order-1', {
      targetVendorAllocationId: 'alloc-a',
    });
    expect(prismaMock.financeLedgerEntry.create).not.toHaveBeenCalled();
    expect(prismaMock.vendorBalanceEvent.upsert).not.toHaveBeenCalled();
  });

  it('leaves canonical recovery to the runner when the runner already invokes it', async () => {
    const allocations = [allocation({
      id: 'alloc-a',
      vendorId: 'vendor-a',
      sourceLineItemId: 'line-1',
      financeEntries: [saleLedger({ id: 'fin-vendor-a-sale-order-1-alloc-a', vendorId: 'vendor-a' })],
    })];
    prismaMock.shopifyOrder.findUnique.mockResolvedValueOnce(shopifyOrder(allocations));
    mockEconomicOwnerFromAllocationRows(allocations);

    await createReconciliationService(env).reconcileShopifyOrder('order-1', {
      deferCanonicalRefundReconciliation: true,
    });

    expect(reconcileCanonicalRefundsMock).not.toHaveBeenCalled();
    expect(prismaMock.financeLedgerEntry.create).not.toHaveBeenCalled();
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
