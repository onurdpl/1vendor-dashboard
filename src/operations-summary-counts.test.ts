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
  financeIntegrityAlert: {
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
  supportTicket: {
    findMany: vi.fn(),
  },
  shipmentExecution: {
    findMany: vi.fn(),
  },
  financeLedgerEntry: {
    findMany: vi.fn(),
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
  getAdminOperationsAttentionCenter,
  getAdminOperationsQueueSummary,
} = await import('../backend/src/modules/operations/operations.service.js');

function buildAllocation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'alloc-1',
    assignedVendorId: 'vendor-1',
    allocationStatus: 'ACTIVE',
    cancellationReason: null,
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
      sourceShopifyOrderNumber: '#1091',
    },
    ...overrides,
  };
}

function mockQueueSummaryCounts({
  pendingReassignment = 0,
  vendorBlocked = 0,
  awaitingShipment = 0,
  refundAttention = 0,
  financeIntegrityAlerts = 0,
  financeIntegrityCriticalAlerts = 0,
  signalGroups = [],
  automationActions = 0,
  automationAutoSafe = 0,
}: {
  pendingReassignment?: number;
  vendorBlocked?: number;
  awaitingShipment?: number;
  refundAttention?: number;
  financeIntegrityAlerts?: number;
  financeIntegrityCriticalAlerts?: number;
  signalGroups?: unknown[];
  automationActions?: number;
  automationAutoSafe?: number;
} = {}) {
  prismaMock.vendorAllocation.count
    .mockResolvedValueOnce(pendingReassignment)
    .mockResolvedValueOnce(vendorBlocked)
    .mockResolvedValueOnce(awaitingShipment);
  prismaMock.returnRecord.count.mockResolvedValueOnce(refundAttention);
  prismaMock.financeIntegrityAlert.count
    .mockResolvedValueOnce(financeIntegrityAlerts)
    .mockResolvedValueOnce(financeIntegrityCriticalAlerts);
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
    prismaMock.financeIntegrityAlert.findMany.mockReset();
    prismaMock.financeIntegrityAlert.count.mockReset();
    prismaMock.operationalSignal.findMany.mockReset();
    prismaMock.operationalSignal.groupBy.mockReset();
    prismaMock.automationAction.findMany.mockReset();
    prismaMock.automationAction.count.mockReset();
    prismaMock.supportTicket.findMany.mockReset();
    prismaMock.shipmentExecution.findMany.mockReset();
    prismaMock.financeLedgerEntry.findMany.mockReset();
    evaluateOperationalSignalsMock.mockReset();
    generateAutomationActionsForSignalsMock.mockReset();

    prismaMock.vendorAllocation.findMany.mockResolvedValue([]);
    prismaMock.returnRecord.findMany.mockResolvedValue([]);
    prismaMock.financeIntegrityAlert.findMany.mockResolvedValue([]);
    prismaMock.financeIntegrityAlert.count.mockResolvedValue(0);
    prismaMock.operationalSignal.findMany.mockResolvedValue([]);
    prismaMock.automationAction.findMany.mockResolvedValue([]);
    prismaMock.supportTicket.findMany.mockResolvedValue([]);
    prismaMock.shipmentExecution.findMany.mockResolvedValue([]);
    prismaMock.financeLedgerEntry.findMany.mockResolvedValue([]);
    evaluateOperationalSignalsMock.mockResolvedValue([]);
    generateAutomationActionsForSignalsMock.mockResolvedValue([]);
  });

  it('returns existing operation rows without running read-time signal or action generation', async () => {
    prismaMock.vendorAllocation.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);
    prismaMock.returnRecord.count.mockResolvedValueOnce(0);
    prismaMock.financeIntegrityAlert.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);
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
        cancellationReason: 'OUT_OF_STOCK',
        reassignmentRequired: true,
      }),
    ]);
    mockQueueSummaryCounts({ vendorBlocked: 1 });

    const dashboard = await getAdminOperationsQueue({ limit: 20, offset: 0 });

    expect(dashboard.items).toEqual([
      expect.objectContaining({
        id: 'op-blocked-alloc-blocked',
        type: 'vendor_blocked',
        title: 'Vendor rejected allocation',
        description: 'Vendor 1 rejected Order #1091. Reason: OUT_OF_STOCK. Reassignment required: yes.',
        actionLabel: 'Review allocation',
        relatedShopifyOrderNumber: '#1091',
        destinationPath: '/admin/orders/7709129507153',
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

  it('keeps the vendor_blocked fallback description when cancellationReason is missing', async () => {
    prismaMock.vendorAllocation.findMany.mockResolvedValueOnce([
      buildAllocation({
        id: 'alloc-blocked-no-reason',
        allocationStatus: 'VENDOR_BLOCKED',
        cancellationReason: null,
        reassignmentRequired: true,
      }),
    ]);
    mockQueueSummaryCounts({ vendorBlocked: 1 });

    const dashboard = await getAdminOperationsQueue({ limit: 20, offset: 0 });

    expect(dashboard.items).toEqual([
      expect.objectContaining({
        id: 'op-blocked-alloc-blocked-no-reason',
        type: 'vendor_blocked',
        description: 'Vendor 1 rejected Order #1091. Reassignment required: yes.',
      }),
    ]);
  });

  it('preserves vendor-blocked allocations as first-class attention items and recommendations', async () => {
    prismaMock.vendorAllocation.findMany.mockResolvedValueOnce([
      buildAllocation({
        id: 'alloc-1091',
        assignedVendorId: 'sporjinal',
        allocationStatus: 'VENDOR_BLOCKED',
        cancellationReason: 'OUT_OF_STOCK',
        reassignmentRequired: true,
        assignedVendor: {
          name: 'Sporjinal',
        },
        order: {
          sourceShopifyOrderId: '7817723773265',
          sourceShopifyOrderNumber: '#1091',
        },
      }),
    ]);
    mockQueueSummaryCounts({ vendorBlocked: 1 });

    const dashboard = await getAdminOperationsAttentionCenter();

    expect(dashboard.summary.vendorBlocked).toBe(1);
    expect(dashboard.queue).toEqual([
      expect.objectContaining({
        id: 'op-blocked-alloc-1091',
        type: 'vendor_blocked',
        title: 'Vendor rejected allocation',
        objectReference: 'Order #1091',
        description: 'Sporjinal rejected Order #1091. Reason: OUT_OF_STOCK. Reassignment required: yes.',
        recommendedAction: 'Review allocation',
        destinationPath: '/admin/orders/7817723773265',
        reassignmentRequired: true,
      }),
    ]);
    expect(dashboard.sections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'vendor_blocked',
          title: 'Vendor blocked allocations',
          count: 1,
          items: [
            expect.objectContaining({
              type: 'vendor_blocked',
              objectReference: 'Order #1091',
            }),
          ],
        }),
      ]),
    );
    expect(dashboard.recommendations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'vendor_blocked_review',
          title: 'Vendor rejected allocation',
          description: 'Sporjinal rejected Order #1091. Reason: OUT_OF_STOCK.',
          recommendedAction: 'Review transfer, cancel/refund, or return to vendor.',
          deepLink: '/admin/orders/7817723773265',
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

  it('includes open and acknowledged warning/critical finance integrity alerts in the operations queue', async () => {
    prismaMock.financeIntegrityAlert.findMany.mockResolvedValueOnce([
      {
        id: 'alert-critical',
        dedupeKey: 'finance:critical',
        severity: 'critical',
        category: 'multiple_active_sale_ledgers',
        reason: 'Two active sale ledgers exist.',
        status: 'open',
        detectedAt: new Date('2026-06-21T09:00:00.000Z'),
        vendorAllocationId: 'alloc-1',
        allocationEconomicTransferId: 'transfer-1',
        vendorAllocation: {
          assignedVendorId: 'vendor-1',
          assignedVendor: {
            name: 'Vendor 1',
          },
          order: {
            sourceShopifyOrderId: '7709129507153',
          },
        },
      },
      {
        id: 'alert-acknowledged-warning',
        dedupeKey: 'finance:acknowledged-warning',
        severity: 'warning',
        category: 'no_active_sale_ledger',
        reason: 'No active sale ledger exists.',
        status: 'acknowledged',
        detectedAt: new Date('2026-06-21T08:00:00.000Z'),
        vendorAllocationId: 'alloc-2',
        allocationEconomicTransferId: null,
        vendorAllocation: null,
      },
    ]);
    mockQueueSummaryCounts({ financeIntegrityAlerts: 2, financeIntegrityCriticalAlerts: 1 });

    const dashboard = await getAdminOperationsQueue({ limit: 20, offset: 0 });

    expect(dashboard.items).toEqual([
      expect.objectContaining({
        id: 'op-finance-integrity-alert-critical',
        type: 'finance_integrity_alert',
        severity: 'critical',
        description: 'Category: multiple_active_sale_ledgers. Reason: Two active sale ledgers exist. Vendor allocation: alloc-1. Economic transfer: transfer-1.',
        actionLabel: 'Investigate finance alert',
        destinationPath: '/admin/orders/7709129507153',
      }),
      expect.objectContaining({
        id: 'op-finance-integrity-alert-acknowledged-warning',
        type: 'finance_integrity_alert',
        severity: 'warning',
        description: 'Category: no_active_sale_ledger. Reason: No active sale ledger exists. Vendor allocation: alloc-2.',
        destinationPath: '/admin/operations',
      }),
    ]);
    expect(dashboard.summary).toMatchObject({
      total: 2,
      critical: 1,
      warning: 1,
      financeIntegrityAlerts: 2,
    });
  });

  it('omits resolved and info finance integrity alerts from the operations queue', async () => {
    prismaMock.financeIntegrityAlert.findMany.mockResolvedValueOnce([
      {
        id: 'alert-resolved',
        dedupeKey: 'finance:resolved',
        severity: 'critical',
        category: 'transfer_failed',
        reason: 'Resolved alert.',
        status: 'resolved',
        detectedAt: new Date('2026-06-21T09:00:00.000Z'),
        vendorAllocationId: 'alloc-1',
        allocationEconomicTransferId: null,
        vendorAllocation: null,
      },
      {
        id: 'alert-info',
        dedupeKey: 'finance:info',
        severity: 'info',
        category: 'transfer_in_progress',
        reason: 'Info alert.',
        status: 'open',
        detectedAt: new Date('2026-06-21T08:00:00.000Z'),
        vendorAllocationId: 'alloc-2',
        allocationEconomicTransferId: null,
        vendorAllocation: null,
      },
    ]);
    mockQueueSummaryCounts();

    const dashboard = await getAdminOperationsQueue({ limit: 20, offset: 0 });

    expect(dashboard.items).toEqual([]);
    expect(prismaMock.financeIntegrityAlert.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        status: {
          in: ['open', 'acknowledged'],
        },
        severity: {
          in: ['critical', 'warning'],
        },
      },
    }));
  });

  it('computes operations summary counts before candidate slicing', async () => {
    prismaMock.vendorAllocation.count
      .mockResolvedValueOnce(25)
      .mockResolvedValueOnce(12)
      .mockResolvedValueOnce(31);
    prismaMock.returnRecord.count.mockResolvedValueOnce(22);
    prismaMock.financeIntegrityAlert.count
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(2);
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
      total: 124,
      critical: 31,
      warning: 18,
      attention: 62,
      normal: 13,
      pendingReassignment: 25,
      vendorBlocked: 12,
      awaitingShipment: 31,
      refundAttention: 22,
      financeIntegrityAlerts: 3,
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
    prismaMock.financeIntegrityAlert.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);
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
      financeIntegrityAlerts: 0,
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
