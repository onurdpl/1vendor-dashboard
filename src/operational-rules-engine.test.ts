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
  refundRecord: {
    findMany: vi.fn(),
  },
  returnRecord: {
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

const {
  evaluateOperationalSignals,
  listDashboardOperationalSignals,
  listOperationalSignals,
  updateOperationalSignalStatus,
} = await import(
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
    prismaMock.refundRecord.findMany.mockReset();
    prismaMock.returnRecord.findMany.mockReset();
    prismaMock.operationalJob.findMany.mockReset();
    prismaMock.operationalSignal.findMany.mockReset();
    prismaMock.operationalSignal.upsert.mockReset();
    prismaMock.operationalSignal.update.mockReset();
    getVendorFinanceDashboardMock.mockReset();

    prismaMock.vendor.findMany.mockResolvedValue([]);
    prismaMock.vendorAllocation.findMany.mockResolvedValue([]);
    prismaMock.financeLedgerEntry.findMany.mockResolvedValue([]);
    prismaMock.payoutBatch.findMany.mockResolvedValue([]);
    prismaMock.refundRecord.findMany.mockResolvedValue([]);
    prismaMock.returnRecord.findMany.mockResolvedValue([]);
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
    prismaMock.vendorAllocation.findMany
      .mockResolvedValueOnce([
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
    ])
      .mockResolvedValueOnce([]);
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
          fullRefundTerminalFact: null,
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

  it('filters terminal fulfillment signals at query time while preserving non-fulfillment history', async () => {
    prismaMock.operationalSignal.findMany.mockResolvedValue([]);

    await listOperationalSignals({ vendorId: 'sporjinal' });
    await listDashboardOperationalSignals({ vendorId: 'sporjinal' });

    for (const [call] of prismaMock.operationalSignal.findMany.mock.calls) {
      expect(call.where).toEqual(expect.objectContaining({
        vendorId: 'sporjinal',
        OR: [
          { allocationId: null },
          { sourceArea: { not: 'FULFILLMENT' } },
          { allocation: { fullRefundTerminalFact: null } },
        ],
      }));
    }
  });

  it('excludes conflict-cancelled allocations from stale fulfillment rules', async () => {
    prismaMock.vendorAllocation.findMany.mockResolvedValueOnce([{
      id: 'alloc-cancelled',
      assignedVendorId: 'sporjinal',
      assignedVendor: { name: 'Sporjinal' },
      fulfillmentStatus: 'Pending',
      shippingStatus: 'Awaiting Shipment',
      updatedAt: new Date('2026-05-10T10:00:00.000Z'),
      order: {
        sourceShopifyOrderId: 'order-cancelled',
        cancelledAt: new Date('2026-05-11T10:00:00.000Z'),
      },
    }]);

    const signals = await evaluateOperationalSignals({ vendorId: 'sporjinal' });

    expect(signals.some((signal) => signal.type === 'stale_fulfillment')).toBe(false);
    expect(prismaMock.vendorAllocation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        assignedVendorId: 'sporjinal',
        order: { cancelledAt: null },
      }),
    }));
  });

  it('escalates return request SLA at 24, 48, and 72 hours', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-13T12:00:00.000Z'));
    prismaMock.vendor.findMany.mockResolvedValue([{ id: 'sporjinal', name: 'Sporjinal' }]);
    getVendorFinanceDashboardMock.mockResolvedValue({
      summary: {
        payableBalance: '0.00',
      },
    });
    prismaMock.returnRecord.findMany.mockResolvedValue([
      {
        id: 'return-warning',
        vendorAllocationId: 'alloc-warning',
        sourceShopifyOrderId: 'order-warning',
        sourceShopifyReturnId: 'ret-warning',
        status: 'pending',
        requestCreatedAt: new Date('2026-05-12T11:00:00.000Z'),
        createdAt: new Date('2026-05-12T11:00:00.000Z'),
        vendorAllocation: {
          assignedVendorId: 'sporjinal',
          assignedVendor: { name: 'Sporjinal' },
          order: { sourceShopifyOrderId: 'order-warning' },
        },
      },
      {
        id: 'return-high',
        vendorAllocationId: 'alloc-high',
        sourceShopifyOrderId: 'order-high',
        sourceShopifyReturnId: 'ret-high',
        status: 'open',
        requestCreatedAt: new Date('2026-05-11T11:00:00.000Z'),
        createdAt: new Date('2026-05-11T11:00:00.000Z'),
        vendorAllocation: {
          assignedVendorId: 'sporjinal',
          assignedVendor: { name: 'Sporjinal' },
          order: { sourceShopifyOrderId: 'order-high' },
        },
      },
      {
        id: 'return-critical',
        vendorAllocationId: 'alloc-critical',
        sourceShopifyOrderId: 'order-critical',
        sourceShopifyReturnId: 'ret-critical',
        status: 'needs_review',
        requestCreatedAt: new Date('2026-05-10T11:00:00.000Z'),
        createdAt: new Date('2026-05-10T11:00:00.000Z'),
        vendorAllocation: {
          assignedVendorId: 'sporjinal',
          assignedVendor: { name: 'Sporjinal' },
          order: { sourceShopifyOrderId: 'order-critical' },
        },
      },
    ]);

    const signals = await evaluateOperationalSignals({ vendorId: 'sporjinal' });
    const returnSignals = signals.filter((signal) => signal.type === 'return_request_sla_aging');

    expect(returnSignals.map((signal) => signal.severity)).toEqual(['warning', 'high', 'critical']);
    expect(returnSignals[1].description).toContain('49 hours');
    expect(prismaMock.operationalSignal.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'signal-return-request-sla-aging-return-high',
        },
      }),
    );
  });

  it('escalates fulfillment stuck SLA at 24, 48, and 72 hours', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-13T12:00:00.000Z'));
    prismaMock.vendor.findMany.mockResolvedValue([{ id: 'sporjinal', name: 'Sporjinal' }]);
    getVendorFinanceDashboardMock.mockResolvedValue({
      summary: {
        payableBalance: '0.00',
      },
    });
    prismaMock.vendorAllocation.findMany
      .mockResolvedValueOnce([
        {
          id: 'alloc-warning',
          assignedVendorId: 'sporjinal',
          assignedVendor: { name: 'Sporjinal' },
          fulfillmentStatus: 'Pending',
          shippingStatus: 'Awaiting Shipment',
          updatedAt: new Date('2026-05-12T11:00:00.000Z'),
          order: { sourceShopifyOrderId: 'order-warning' },
        },
        {
          id: 'alloc-high',
          assignedVendorId: 'sporjinal',
          assignedVendor: { name: 'Sporjinal' },
          fulfillmentStatus: 'Processing',
          shippingStatus: 'Awaiting Shipment',
          updatedAt: new Date('2026-05-11T11:00:00.000Z'),
          order: { sourceShopifyOrderId: 'order-high' },
        },
        {
          id: 'alloc-critical',
          assignedVendorId: 'sporjinal',
          assignedVendor: { name: 'Sporjinal' },
          fulfillmentStatus: 'Pending',
          shippingStatus: 'Awaiting Shipment',
          updatedAt: new Date('2026-05-10T11:00:00.000Z'),
          order: { sourceShopifyOrderId: 'order-critical' },
        },
      ])
      .mockResolvedValueOnce([]);

    const signals = await evaluateOperationalSignals({ vendorId: 'sporjinal' });
    const fulfillmentSignals = signals.filter((signal) => signal.type === 'stale_fulfillment');

    expect(fulfillmentSignals.map((signal) => signal.severity)).toEqual(['warning', 'high', 'critical']);
    expect(fulfillmentSignals[2].description).toContain('73 hours');
  });

  it('escalates payout review SLA at 24, 48, and 96 hours', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-13T12:00:00.000Z'));
    prismaMock.vendor.findMany.mockResolvedValue([{ id: 'sporjinal', name: 'Sporjinal' }]);
    getVendorFinanceDashboardMock.mockResolvedValue({
      summary: {
        payableBalance: '0.00',
      },
    });
    prismaMock.payoutBatch.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'batch-warning',
          vendorId: 'sporjinal',
          status: 'DRAFT',
          updatedAt: new Date('2026-05-12T11:00:00.000Z'),
          netAmount: 100,
          vendor: { name: 'Sporjinal' },
        },
        {
          id: 'batch-high',
          vendorId: 'sporjinal',
          status: 'REVIEW',
          updatedAt: new Date('2026-05-11T11:00:00.000Z'),
          netAmount: 100,
          vendor: { name: 'Sporjinal' },
        },
        {
          id: 'batch-critical',
          vendorId: 'sporjinal',
          status: 'REVIEW',
          updatedAt: new Date('2026-05-09T11:00:00.000Z'),
          netAmount: 100,
          vendor: { name: 'Sporjinal' },
        },
      ]);

    const signals = await evaluateOperationalSignals({ vendorId: 'sporjinal' });
    const payoutSignals = signals.filter((signal) => signal.type === 'payout_review_sla_aging');

    expect(payoutSignals.map((signal) => signal.severity)).toEqual(['warning', 'high', 'critical']);
    expect(payoutSignals[2].description).toContain('97 hours');
  });

  it('generates refund-heavy vendor signals only after minimum order volume', async () => {
    prismaMock.vendor.findMany.mockResolvedValue([{ id: 'sporjinal', name: 'Sporjinal' }]);
    getVendorFinanceDashboardMock.mockResolvedValue({
      summary: {
        payableBalance: '0.00',
      },
    });
    prismaMock.vendorAllocation.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(Array.from({ length: 20 }, (_, index) => ({ sourceShopifyOrderId: `order-${index}` })));
    prismaMock.refundRecord.findMany.mockResolvedValue(
      Array.from({ length: 4 }, (_, index) => ({ sourceShopifyOrderId: `order-${index}` })),
    );

    const signals = await evaluateOperationalSignals({ vendorId: 'sporjinal' });
    const refundSignal = signals.find((signal) => signal.type === 'refund_heavy_vendor');

    expect(refundSignal).toMatchObject({
      severity: 'high',
      sourceArea: 'refund',
      vendorId: 'sporjinal',
    });
    expect(refundSignal?.description).toContain('20% refund ratio');

    prismaMock.operationalSignal.upsert.mockClear();
    prismaMock.vendorAllocation.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(Array.from({ length: 19 }, (_, index) => ({ sourceShopifyOrderId: `low-order-${index}` })));
    prismaMock.refundRecord.findMany.mockResolvedValue(
      Array.from({ length: 10 }, (_, index) => ({ sourceShopifyOrderId: `low-order-${index}` })),
    );

    const lowVolumeSignals = await evaluateOperationalSignals({ vendorId: 'sporjinal' });

    expect(lowVolumeSignals.some((signal) => signal.type === 'refund_heavy_vendor')).toBe(false);
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
