import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  vendor: {
    findMany: vi.fn(),
  },
  operationalSignal: {
    findMany: vi.fn(),
    upsert: vi.fn(),
  },
}));

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: prismaMock,
}));

vi.mock('../backend/src/modules/finance/finance.service.js', () => ({
  getVendorFinanceDashboard: vi.fn(),
}));

vi.mock('../backend/src/lib/dashboard-timing.js', () => ({
  logDashboardTiming: vi.fn(),
  startDashboardTimer: vi.fn(() => 0),
  withDashboardTiming: vi.fn((_step: string, action: () => unknown) => action()),
}));

const { listOperationalSignals } = await import('../backend/src/modules/rules/rules.service.js');

function buildSignal(overrides: Record<string, unknown> = {}) {
  const now = new Date('2026-05-13T10:00:00.000Z');
  return {
    id: 'signal-1',
    type: 'stale_fulfillment',
    severity: 'HIGH',
    sourceArea: 'FULFILLMENT',
    vendorId: 'sporjinal',
    allocationId: 'alloc-1',
    financeLedgerEntryId: null,
    payoutBatchId: null,
    operationalJobId: null,
    title: 'Fulfillment is stale',
    description: 'Allocation alloc-1 is stale.',
    suggestedAction: 'Check vendor shipment progress.',
    status: 'ACTIVE',
    ruleKey: 'fulfillment.stale_awaiting_shipment',
    triggeredAt: now,
    resolvedAt: null,
    metadata: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('operational signal reads', () => {
  beforeEach(() => {
    prismaMock.vendor.findMany.mockReset();
    prismaMock.operationalSignal.findMany.mockReset();
    prismaMock.operationalSignal.upsert.mockReset();
  });

  it('returns persisted signals without evaluating operational rules', async () => {
    prismaMock.operationalSignal.findMany.mockResolvedValueOnce([buildSignal()]);

    const response = await listOperationalSignals({
      vendorId: 'sporjinal',
      includeInternal: false,
      limit: 10,
    });

    expect(response.summary).toEqual({
      total: 1,
      critical: 0,
      high: 1,
      warning: 0,
      info: 0,
    });
    expect(response.signals[0]).toMatchObject({
      id: 'signal-1',
      status: 'active',
      vendorId: 'sporjinal',
    });
    expect(prismaMock.operationalSignal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          vendorId: 'sporjinal',
        }),
        take: 10,
      }),
    );
    expect(prismaMock.vendor.findMany).not.toHaveBeenCalled();
    expect(prismaMock.operationalSignal.upsert).not.toHaveBeenCalled();
  });
});
