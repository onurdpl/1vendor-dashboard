import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  vendorAllocation: {
    findMany: vi.fn(),
    count: vi.fn(),
  },
  returnRecord: {
    findMany: vi.fn(),
    count: vi.fn(),
  },
  operationalSignal: {
    groupBy: vi.fn(),
  },
  automationAction: {
    count: vi.fn(),
  },
}));
const listOperationalSignalsMock = vi.hoisted(() => vi.fn());
const listAutomationActionsMock = vi.hoisted(() => vi.fn());

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: prismaMock,
}));

vi.mock('../backend/src/modules/rules/rules.service.js', () => ({
  listOperationalSignals: listOperationalSignalsMock,
}));

vi.mock('../backend/src/modules/automation/automation-actions.service.js', () => ({
  listAutomationActions: listAutomationActionsMock,
}));

vi.mock('../backend/src/modules/support/support.service.js', () => ({
  deriveSupportSlaState: vi.fn(() => ({ isOverdue: false, dueLabel: 'On track' })),
}));

vi.mock('../backend/src/lib/dashboard-timing.js', () => ({
  logDashboardTiming: vi.fn(),
  startDashboardTimer: vi.fn(() => 0),
  withDashboardTiming: vi.fn((_step: string, action: () => unknown) => action()),
}));

const { getAdminOperationsQueue } = await import('../backend/src/modules/operations/operations.service.js');

describe('admin operations summary counts', () => {
  beforeEach(() => {
    prismaMock.vendorAllocation.findMany.mockReset();
    prismaMock.vendorAllocation.count.mockReset();
    prismaMock.returnRecord.findMany.mockReset();
    prismaMock.returnRecord.count.mockReset();
    prismaMock.operationalSignal.groupBy.mockReset();
    prismaMock.automationAction.count.mockReset();
    listOperationalSignalsMock.mockReset();
    listAutomationActionsMock.mockReset();

    prismaMock.vendorAllocation.findMany.mockResolvedValue([]);
    prismaMock.returnRecord.findMany.mockResolvedValue([]);
    listOperationalSignalsMock.mockResolvedValue({ summary: { total: 0 }, signals: [] });
    listAutomationActionsMock.mockResolvedValue({ summary: { total: 0 }, actions: [] });
  });

  it('computes operations summary counts before candidate slicing', async () => {
    prismaMock.vendorAllocation.count
      .mockResolvedValueOnce(25)
      .mockResolvedValueOnce(12)
      .mockResolvedValueOnce(31);
    prismaMock.returnRecord.count.mockResolvedValueOnce(22);
    prismaMock.operationalSignal.groupBy.mockResolvedValueOnce([
      { severity: 'CRITICAL', _count: { _all: 4 } },
      { severity: 'HIGH', _count: { _all: 5 } },
      { severity: 'WARNING', _count: { _all: 6 } },
      { severity: 'INFO', _count: { _all: 7 } },
    ]);
    prismaMock.automationAction.count
      .mockResolvedValueOnce(9)
      .mockResolvedValueOnce(3);

    const dashboard = await getAdminOperationsQueue({ limit: 20, offset: 0 });

    expect(dashboard.items).toEqual([]);
    expect(dashboard.summary).toEqual({
      total: 121,
      critical: 29,
      warning: 17,
      attention: 62,
      normal: 13,
      pendingReassignment: 25,
      vendorBlocked: 12,
      awaitingShipment: 31,
      refundAttention: 22,
      operationalSignals: 22,
      automationActions: 9,
    });
    expect(prismaMock.vendorAllocation.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 20 }));
  });
});
