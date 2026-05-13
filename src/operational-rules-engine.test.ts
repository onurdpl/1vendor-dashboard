import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  financeLedgerEntry: {
    findMany: vi.fn(),
  },
  operationalJob: {
    findMany: vi.fn(),
  },
  operationalSignal: {
    findMany: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
  },
  payoutBatch: {
    findMany: vi.fn(),
  },
  vendor: {
    findMany: vi.fn(),
  },
  vendorAllocation: {
    findMany: vi.fn(),
  },
}));

const getVendorFinanceDashboardMock = vi.hoisted(() => vi.fn());

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: prismaMock,
}));

vi.mock('../backend/src/modules/finance/finance.service.js', () => ({
  getVendorFinanceDashboard: getVendorFinanceDashboardMock,
}));

const { evaluateOperationalSignals, updateOperationalSignalStatus } = await import(
  '../backend/src/modules/rules/rules.service.js'
);

function buildSignal(overrides: Record<string, unknown>) {
  const now = new Date('2026-05-13T10:00:00.000Z');
  return {
    id: 'signal-test',
    type: 'test',
    severity: 'WARNING',
    sourceArea: 'FULFILLMENT',
    vendorId: 'sporjinal',
    allocationId: null,
    financeLedgerEntryId: null,
    payoutBatchId: null,
    operationalJobId: null,
    title: 'Signal',
    description: 'Signal description',
    suggestedAction: null,
    status: 'ACTIVE',
    ruleKey: 'test.rule',
    triggeredAt: now,
    resolvedAt: null,
    metadata: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('operational rules engine foundation', () => {
  beforeEach(() => {
    vi.useRealTimers();
    prismaMock.vendor.findMany.mockReset();
    prismaMock.vendorAllocation.findMany.mockReset();
    prismaMock.financeLedgerEntry.findMany.mockReset();
    prismaMock.payoutBatch.findMany.mockReset();
    prismaMock.operationalJob.findMany.mockReset();
    prismaMock.operationalSignal.findMany.mockReset();
    prismaMock.operationalSignal.upsert.mockReset();
    prismaMock.operationalSignal.update.mockReset();
    getVendorFinanceDashboardMock.mockReset();

    prismaMock.vendor.findMany.mockResolvedValue([]);
    prismaMock.vendorAllocation.findMany.mockResolvedValue([]);
    prismaMock.financeLedgerEntry.findMany.mockResolvedValue([]);
    prismaMock.payoutBatch.findMany.mockResolvedValue([]);
    prismaMock.operationalJob.findMany.mockResolvedValue([]);
    prismaMock.operationalSignal.upsert.mockImplementation(async ({ create, update, where }) =>
      buildSignal({
        ...create,
        ...update,
        id: where.id,
      }),
    );
  });

  it('generates a duplicate-safe negative payable signal', async () => {
    prismaMock.vendor.findMany.mockResolvedValueOnce([{ id: 'sporjinal', name: 'Sporjinal' }]);
    getVendorFinanceDashboardMock.mockResolvedValue({
      summary: {
        payableBalance: '-125.50',
      },
    });

    const signals = await evaluateOperationalSignals({ vendorId: 'sporjinal' });

    expect(signals[0]).toMatchObject({
      id: 'signal-finance-negative-payable-balance-sporjinal',
      type: 'negative_vendor_payable_balance',
      severity: 'high',
      sourceArea: 'payout',
      vendorId: 'sporjinal',
    });
    expect(prismaMock.operationalSignal.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'signal-finance-negative-payable-balance-sporjinal',
        },
      }),
    );
  });

  it('generates stale fulfillment and missing shipping cost signals for vendor-scoped rows', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-13T12:00:00.000Z'));
    prismaMock.vendor.findMany.mockResolvedValue([{ id: 'sporjinal', name: 'Sporjinal' }]);
    getVendorFinanceDashboardMock.mockResolvedValue({
      summary: {
        payableBalance: '0.00',
      },
    });
    prismaMock.vendorAllocation.findMany.mockResolvedValue([
      {
        id: 'alloc-1',
        assignedVendorId: 'sporjinal',
        assignedVendor: { name: 'Sporjinal' },
        sourceShopifyOrderId: '7616544244049',
        fulfillmentStatus: 'Pending',
        shippingStatus: 'Awaiting Shipment',
        updatedAt: new Date('2026-05-10T10:00:00.000Z'),
        order: {
          sourceShopifyOrderId: '7616544244049',
        },
      },
    ]);
    prismaMock.financeLedgerEntry.findMany
      .mockResolvedValueOnce([
      {
        id: 'fin-sporjinal-sale-1',
        entryType: 'sale',
        vendorId: 'sporjinal',
        vendorAllocationId: 'alloc-1',
        amount: 100,
        vendor: { name: 'Sporjinal' },
        vendorAllocation: {
          id: 'alloc-1',
          allocationStatus: 'ACTIVE',
          fulfillmentStatus: 'Fulfilled',
          shippingStatus: 'Delivered',
          sourceShopifyOrderId: '7616544244049',
          fulfillment: {
            fulfilledAt: new Date('2026-05-11T10:00:00.000Z'),
          },
          order: {
            sourceShopifyOrderId: '7616544244049',
          },
        },
      },
    ])
      .mockResolvedValueOnce([]);

    const signals = await evaluateOperationalSignals({ vendorId: 'sporjinal' });

    expect(signals.map((signal) => signal.type)).toEqual([
      'stale_fulfillment',
      'missing_shipping_cost',
    ]);
    expect(prismaMock.vendorAllocation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          assignedVendorId: 'sporjinal',
        }),
      }),
    );
    expect(prismaMock.financeLedgerEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          vendorId: 'sporjinal',
        }),
      }),
    );
  });

  it('updates signal lifecycle to resolved', async () => {
    prismaMock.operationalSignal.update.mockResolvedValue(
      buildSignal({
        id: 'signal-test',
        status: 'RESOLVED',
        resolvedAt: new Date('2026-05-13T10:30:00.000Z'),
      }),
    );

    const signal = await updateOperationalSignalStatus('signal-test', 'resolve');

    expect(signal).toMatchObject({
      id: 'signal-test',
      status: 'resolved',
      resolvedAt: '2026-05-13T10:30:00.000Z',
    });
    expect(prismaMock.operationalSignal.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'signal-test',
        },
        data: expect.objectContaining({
          status: 'RESOLVED',
        }),
      }),
    );
  });
});
