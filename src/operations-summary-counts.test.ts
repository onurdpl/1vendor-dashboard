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
    findMany: vi.fn(),
    groupBy: vi.fn(),
  },
  automationAction: {
    findMany: vi.fn(),
    count: vi.fn(),
  },
}));
const evaluateOperationalSignalsMock = vi.hoisted(() => vi.fn());
const generateAutomationActionsForSignalsMock = vi.hoisted(() => vi.fn());

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: prismaMock,
}));

vi.mock('../backend/src/modules/rules/rules.service.js', () => ({
  evaluateOperationalSignals: evaluateOperationalSignalsMock,
}));

vi.mock('../backend/src/modules/automation/automation-actions.service.js', () => ({
  generateAutomationActionsForSignals: generateAutomationActionsForSignalsMock,
}));

vi.mock('../backend/src/modules/support/support.service.js', () => ({
  deriveSupportSlaState: vi.fn(() => ({ isOverdue: false, dueLabel: 'On track' })),
}));

vi.mock('../backend/src/lib/dashboard-timing.js', () => ({
  logDashboardTiming: vi.fn(),
  startDashboardTimer: vi.fn(() => 0),
  withDashboardTiming: vi.fn((_step: string, action: () => unknown) => action()),
}));

const {
  generateAdminOperationsAutomationActions,
  generateAdminOperationsSignals,
  getAdminOperationsQueue,
  getAdminOperationsQueueSummary,
} = await import('../backend/src/modules/operations/operations.service.js');

function buildAllocation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'alloc-1',
    assignedVendorId: 'vendor-1',
    allocationStatus: 'ACTIVE',
    fulfillmentStatus: 'Fulfilled',
    shippingStatus: 'Delivered',
    reassignmentRequired: false,
    updatedAt: new Date('2026-05-13T10:00:00.000Z'),
    assignedVendor: {
      name: 'Vendor 1',
    },
    returnRecords: [],
    refundRecords: [],
    order: {
      sourceShopifyOrderId: '7709129507153',
    },
    ...overrides,
  };
}

function mockQueueSummaryCounts({
  pendingReassignment = 0,
  vendorBlocked = 0,
  awaitingShipment = 0,
  refundAttention = 0,
  signalGroups = [],
  automationActions = 0,
  automationAutoSafe = 0,
}: {
  pendingReassignment?: number;
  vendorBlocked?: number;
  awaitingShipment?: number;
  refundAttention?: number;
  signalGroups?: unknown[];
  automationActions?: number;
  automationAutoSafe?: number;
} = {}) {
  prismaMock.vendorAllocation.count
    .mockResolvedValueOnce(pendingReassignment)
    .mockResolvedValueOnce(vendorBlocked)
    .mockResolvedValueOnce(awaitingShipment);
  prismaMock.returnRecord.count.mockResolvedValueOnce(refundAttention);
  prismaMock.operationalSignal.groupBy.mockResolvedValueOnce(signalGroups);
  prismaMock.automationAction.count
    .mockResolvedValueOnce(automationActions)
    .mockResolvedValueOnce(automationAutoSafe);
}

describe('admin operations summary counts', () => {
  beforeEach(() => {
    prismaMock.vendorAllocation.findMany.mockReset();
    prismaMock.vendorAllocation.count.mockReset();
    prismaMock.returnRecord.findMany.mockReset();
    prismaMock.returnRecord.count.mockReset();
    prismaMock.operationalSignal.findMany.mockReset();
    prismaMock.operationalSignal.groupBy.mockReset();
    prismaMock.automationAction.findMany.mockReset();
    prismaMock.automationAction.count.mockReset();
    evaluateOperationalSignalsMock.mockReset();
    generateAutomationActionsForSignalsMock.mockReset();

    prismaMock.vendorAllocation.findMany.mockResolvedValue([]);
    prismaMock.returnRecord.findMany.mockResolvedValue([]);
    prismaMock.operationalSignal.findMany.mockResolvedValue([]);
    prismaMock.automationAction.findMany.mockResolvedValue([]);
    evaluateOperationalSignalsMock.mockResolvedValue([]);
    generateAutomationActionsForSignalsMock.mockResolvedValue([]);
  });

  it('returns existing operation rows without running read-time signal or action generation', async () => {
    prismaMock.vendorAllocation.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);
    prismaMock.returnRecord.count.mockResolvedValueOnce(0);
    prismaMock.operationalSignal.groupBy.mockResolvedValueOnce([
      { severity: 'HIGH', _count: { _all: 1 } },
    ]);
    prismaMock.automationAction.count
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1);
    prismaMock.operationalSignal.findMany.mockResolvedValueOnce([
      {
        id: 'signal-1',
        type: 'stale_fulfillment',
        severity: 'HIGH',
        sourceArea: 'FULFILLMENT',
        vendorId: 'yalispor',
        allocationId: 'alloc-1',
        financeLedgerEntryId: null,
        payoutBatchId: null,
        operationalJobId: null,
        title: 'Fulfillment is stale',
        description: 'Allocation alloc-1 has not moved.',
        suggestedAction: 'Review signal',
        status: 'ACTIVE',
        ruleKey: 'fulfillment.stale_awaiting_shipment',
        metadata: {
          sourceShopifyOrderId: '7709129507153',
        },
        triggeredAt: new Date('2026-05-13T10:00:00.000Z'),
        resolvedAt: null,
        createdAt: new Date('2026-05-13T10:00:00.000Z'),
        updatedAt: new Date('2026-05-13T10:00:00.000Z'),
      },
    ]);
    prismaMock.automationAction.findMany.mockResolvedValueOnce([
      {
        id: 'action-1',
        signalId: 'signal-1',
        type: 'AUTO_PRIORITIZE_STALE_QUEUE_ITEM',
        status: 'SUGGESTED',
        executionMode: 'AUTO_SAFE',
        vendorId: 'yalispor',
        allocationId: 'alloc-1',
        financeLedgerEntryId: null,
        payoutBatchId: null,
        operationalJobId: null,
        title: 'Prioritize operations queue item',
        description: 'Keep this signal high in the operations queue.',
        resultSummary: null,
        executedAt: null,
        metadata: {},
        createdAt: new Date('2026-05-13T10:01:00.000Z'),
        updatedAt: new Date('2026-05-13T10:01:00.000Z'),
      },
    ]);

    const dashboard = await getAdminOperationsQueue({ limit: 20, offset: 0 });

    expect(dashboard.items).toEqual([
      expect.objectContaining({
        id: 'op-signal-signal-1',
        type: 'operational_signal',
        severity: 'warning',
        destinationPath: '/admin/orders/7709129507153',
      }),
      expect.objectContaining({
        id: 'op-automation-action-1',
        type: 'automation_action',
        severity: 'attention',
      }),
    ]);
    expect(dashboard.summary).toMatchObject({
      total: 2,
      operationalSignals: 1,
      automationActions: 1,
    });
    expect(evaluateOperationalSignalsMock).not.toHaveBeenCalled();
    expect(generateAutomationActionsForSignalsMock).not.toHaveBeenCalled();
  });

  it('emits one vendor_blocked item for a blocked allocation that still requires reassignment', async () => {
    prismaMock.vendorAllocation.findMany.mockResolvedValueOnce([
      buildAllocation({
        id: 'alloc-blocked',
        allocationStatus: 'VENDOR_BLOCKED',
        reassignmentRequired: true,
      }),
    ]);
    mockQueueSummaryCounts({ vendorBlocked: 1 });

    const dashboard = await getAdminOperationsQueue({ limit: 20, offset: 0 });

    expect(dashboard.items).toEqual([
      expect.objectContaining({
        id: 'op-blocked-alloc-blocked',
        type: 'vendor_blocked',
      }),
    ]);
    expect(dashboard.items).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'op-pending-alloc-blocked',
          type: 'pending_reassignment',
        }),
      ]),
    );
  });

  it('excludes vendor-blocked allocations from pendingReassignment summary count', async () => {
    mockQueueSummaryCounts({ pendingReassignment: 0, vendorBlocked: 1 });

    const summary = await getAdminOperationsQueueSummary();

    expect(summary.pendingReassignment).toBe(0);
    expect(summary.vendorBlocked).toBe(1);
    expect(prismaMock.vendorAllocation.count).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          allocationStatus: {
            not: 'VENDOR_BLOCKED',
          },
        }),
      }),
    );
  });

  it('emits one pending_reassignment item for a non-blocked pending reassignment allocation', async () => {
    prismaMock.vendorAllocation.findMany.mockResolvedValueOnce([
      buildAllocation({
        id: 'alloc-pending',
        allocationStatus: 'PENDING_REASSIGNMENT',
      }),
    ]);
    mockQueueSummaryCounts({ pendingReassignment: 1 });

    const dashboard = await getAdminOperationsQueue({ limit: 20, offset: 0 });

    expect(dashboard.items).toEqual([
      expect.objectContaining({
        id: 'op-pending-alloc-pending',
        type: 'pending_reassignment',
      }),
    ]);
  });

  it('emits one pending_reassignment item for a non-blocked allocation with reassignmentRequired=true', async () => {
    prismaMock.vendorAllocation.findMany.mockResolvedValueOnce([
      buildAllocation({
        id: 'alloc-required',
        allocationStatus: 'ACTIVE',
        reassignmentRequired: true,
      }),
    ]);
    mockQueueSummaryCounts({ pendingReassignment: 1 });

    const dashboard = await getAdminOperationsQueue({ limit: 20, offset: 0 });

    expect(dashboard.items).toEqual([
      expect.objectContaining({
        id: 'op-pending-alloc-required',
        type: 'pending_reassignment',
      }),
    ]);
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
    expect(prismaMock.operationalSignal.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }));
    expect(prismaMock.automationAction.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }));
    expect(evaluateOperationalSignalsMock).not.toHaveBeenCalled();
    expect(generateAutomationActionsForSignalsMock).not.toHaveBeenCalled();
  });

  it('returns summary-only counts without loading queue item rows', async () => {
    prismaMock.vendorAllocation.count
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(3);
    prismaMock.returnRecord.count.mockResolvedValueOnce(4);
    prismaMock.operationalSignal.groupBy.mockResolvedValueOnce([]);
    prismaMock.automationAction.count
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(2);

    const summary = await getAdminOperationsQueueSummary();

    expect(summary).toEqual({
      total: 15,
      critical: 1,
      warning: 2,
      attention: 9,
      normal: 3,
      pendingReassignment: 1,
      vendorBlocked: 2,
      awaitingShipment: 3,
      refundAttention: 4,
      operationalSignals: 0,
      automationActions: 5,
    });
    expect(prismaMock.vendorAllocation.findMany).not.toHaveBeenCalled();
    expect(prismaMock.returnRecord.findMany).not.toHaveBeenCalled();
    expect(prismaMock.operationalSignal.findMany).not.toHaveBeenCalled();
    expect(prismaMock.automationAction.findMany).not.toHaveBeenCalled();
    expect(evaluateOperationalSignalsMock).not.toHaveBeenCalled();
    expect(generateAutomationActionsForSignalsMock).not.toHaveBeenCalled();
  });

  it('keeps signal generation explicit', async () => {
    evaluateOperationalSignalsMock.mockResolvedValueOnce([{ id: 'signal-1' }]);

    await expect(generateAdminOperationsSignals()).resolves.toEqual({
      generated: 1,
      signals: [{ id: 'signal-1' }],
    });

    expect(evaluateOperationalSignalsMock).toHaveBeenCalledTimes(1);
  });

  it('keeps automation action generation explicit', async () => {
    generateAutomationActionsForSignalsMock.mockResolvedValueOnce([{ id: 'action-1' }]);

    await expect(generateAdminOperationsAutomationActions()).resolves.toEqual({
      generated: 1,
      actions: [{ id: 'action-1' }],
    });

    expect(generateAutomationActionsForSignalsMock).toHaveBeenCalledTimes(1);
  });
});
