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
    count: vi.fn(),
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
const {
  buildReturnReviewAttentionWhere,
  isReturnReviewAttentionStatus,
} = await import('../backend/src/modules/returns/return-review-status.js');

function buildAllocation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'alloc-1',
    assignedVendorId: 'vendor-1',
    allocationStatus: 'ACTIVE',
    cancellationReason: null,
    cancelRefundReviewStatus: null,
    fulfillmentStatus: 'Fulfilled',
    shippingStatus: 'Delivered',
    reassignmentRequired: false,
    updatedAt: new Date('2026-05-13T10:00:00.000Z'),
    assignedVendor: {
      name: 'Vendor 1',
    },
    returnRecords: [],
    refundRecords: [],
    outboundShopifyRefundAttempts: [],
    childAllocationSplitEvents: [],
    order: {
      sourceShopifyOrderId: '7709129507153',
      sourceShopifyOrderNumber: '#1091',
    },
    ...overrides,
  };
}

function buildShipmentExecution(overrides: Record<string, unknown> = {}) {
  return {
    id: 'shipment-1',
    allocationId: 'alloc-1',
    vendorId: 'vendor-1',
    sourceShopifyOrderId: '7709129507153',
    sourceShopifyOrderNumber: '#1091',
    shipmentStatus: 'PENDING',
    trackingNumber: null,
    updatedAt: new Date('2026-05-13T10:00:00.000Z'),
    vendor: {
      name: 'Vendor 1',
    },
    allocation: {
      order: {
        sourceShopifyOrderId: '7709129507153',
        sourceShopifyOrderNumber: '#1091',
      },
    },
    ...overrides,
  };
}

function buildReturnRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'return-1',
    status: 'pending',
    returnLifecycleStatus: null,
    sourceShopifyOrderId: '7709129507153',
    sourceShopifyOrderNumber: '#1091',
    sourceShopifyRefundId: null,
    createdAt: new Date('2026-05-13T10:00:00.000Z'),
    vendorAllocation: {
      id: 'alloc-1',
      assignedVendorId: 'vendor-1',
      assignedVendor: {
        name: 'Vendor 1',
      },
      refundRecords: [],
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
    prismaMock.shipmentExecution.count.mockReset();
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
    prismaMock.shipmentExecution.count.mockResolvedValue(0);
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

  it('filters vendor-blocked queue rows before pagination and returns a matching filtered total', async () => {
    const vendorBlockedAllocations = Array.from({ length: 7 }, (_unused, index) =>
      buildAllocation({
        id: `alloc-filtered-${index + 1}`,
        assignedVendorId: 'sporjinal',
        allocationStatus: 'VENDOR_BLOCKED',
        cancellationReason: 'OUT_OF_STOCK',
        reassignmentRequired: true,
        updatedAt: new Date(`2026-05-17T0${8 - index}:00:00.000Z`),
        assignedVendor: {
          name: 'Sporjinal',
        },
        order: {
          sourceShopifyOrderId: String(7900000000000 + index),
          sourceShopifyOrderNumber: `#12${index + 1}`,
          cancelledAt: null,
        },
      }),
    );
    prismaMock.vendorAllocation.count.mockResolvedValueOnce(7);
    prismaMock.vendorAllocation.findMany.mockResolvedValueOnce(vendorBlockedAllocations.slice(0, 5));

    const dashboard = await getAdminOperationsQueue({ type: 'vendor_blocked', limit: 5, offset: 0 });

    expect(dashboard.summary).toMatchObject({
      total: 7,
      vendorBlocked: 7,
      warning: 7,
      awaitingShipment: 0,
      refundAttention: 0,
      financeIntegrityAlerts: 0,
      operationalSignals: 0,
      automationActions: 0,
    });
    expect(dashboard.items).toHaveLength(5);
    expect(dashboard.items.map((item) => item.type)).toEqual(['vendor_blocked', 'vendor_blocked', 'vendor_blocked', 'vendor_blocked', 'vendor_blocked']);
    expect(dashboard.items.map((item) => item.relatedShopifyOrderNumber)).toEqual(['#121', '#122', '#123', '#124', '#125']);
    expect(prismaMock.vendorAllocation.count).toHaveBeenCalledWith({
      where: {
        order: {
          cancelledAt: null,
        },
        allocationStatus: 'VENDOR_BLOCKED',
        NOT: expect.any(Object),
      },
    });
    expect(prismaMock.vendorAllocation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        order: {
          cancelledAt: null,
        },
        allocationStatus: 'VENDOR_BLOCKED',
        NOT: expect.any(Object),
      },
      orderBy: {
        updatedAt: 'desc',
      },
      skip: 0,
      take: 5,
    }));
    expect(prismaMock.returnRecord.findMany).not.toHaveBeenCalled();
    expect(prismaMock.financeIntegrityAlert.findMany).not.toHaveBeenCalled();
    expect(prismaMock.operationalSignal.findMany).not.toHaveBeenCalled();
    expect(prismaMock.automationAction.findMany).not.toHaveBeenCalled();
  });

  it('pages through the filtered vendor-blocked population without unrelated rows consuming page slots', async () => {
    const secondPageVendorBlockedAllocations = [6, 7].map((orderIndex) =>
      buildAllocation({
        id: `alloc-filtered-${orderIndex}`,
        assignedVendorId: 'sporjinal',
        allocationStatus: 'VENDOR_BLOCKED',
        cancellationReason: 'OUT_OF_STOCK',
        reassignmentRequired: true,
        updatedAt: new Date(`2026-05-17T0${8 - orderIndex}:00:00.000Z`),
        assignedVendor: {
          name: 'Sporjinal',
        },
        order: {
          sourceShopifyOrderId: String(7900000000000 + orderIndex),
          sourceShopifyOrderNumber: orderIndex === 7 ? '#1109' : '#126',
          cancelledAt: null,
        },
      }),
    );
    prismaMock.vendorAllocation.count.mockResolvedValueOnce(7);
    prismaMock.vendorAllocation.findMany.mockResolvedValueOnce(secondPageVendorBlockedAllocations);

    const dashboard = await getAdminOperationsQueue({ type: 'vendor_blocked', limit: 5, offset: 5 });

    expect(dashboard.summary.total).toBe(7);
    expect(dashboard.items).toHaveLength(2);
    expect(dashboard.items.map((item) => item.relatedShopifyOrderNumber)).toEqual(['#126', '#1109']);
    expect(dashboard.items[1]).toEqual(expect.objectContaining({
      type: 'vendor_blocked',
      destinationPath: '/admin/orders/7900000000007',
      relatedOrderId: 'alloc-filtered-7',
      relatedShopifyOrderId: '7900000000007',
    }));
    expect(prismaMock.vendorAllocation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      skip: 5,
      take: 5,
    }));
    expect(prismaMock.returnRecord.findMany).not.toHaveBeenCalled();
    expect(prismaMock.financeIntegrityAlert.findMany).not.toHaveBeenCalled();
    expect(prismaMock.operationalSignal.findMany).not.toHaveBeenCalled();
    expect(prismaMock.automationAction.findMany).not.toHaveBeenCalled();
  });

  it('filters shipment executions before pagination and returns an authoritative matching total', async () => {
    const shipments = [
      buildShipmentExecution({
        id: 'shipment-failed-oldest',
        shipmentStatus: 'FAILED',
        updatedAt: new Date('2026-05-12T08:00:00.000Z'),
      }),
      buildShipmentExecution({
        id: 'shipment-pending-oldest',
        shipmentStatus: 'PENDING',
        sourceShopifyOrderId: null,
        sourceShopifyOrderNumber: null,
        trackingNumber: 'TRACK-1',
        updatedAt: new Date('2026-05-12T09:00:00.000Z'),
      }),
    ];
    prismaMock.shipmentExecution.count
      .mockResolvedValueOnce(12)
      .mockResolvedValueOnce(3);
    prismaMock.shipmentExecution.findMany.mockResolvedValueOnce(shipments);

    const dashboard = await getAdminOperationsQueue({ type: 'awaiting_shipment', limit: 10, offset: 0 });

    expect(dashboard.summary).toEqual({
      total: 12,
      critical: 3,
      warning: 9,
      attention: 0,
      normal: 0,
      pendingReassignment: 0,
      vendorBlocked: 0,
      awaitingShipment: 12,
      refundAttention: 0,
      financeIntegrityAlerts: 0,
      operationalSignals: 0,
      automationActions: 0,
    });
    expect(dashboard.items).toEqual([
      expect.objectContaining({
        id: 'op-shipment-shipment-failed-oldest',
        type: 'awaiting_shipment',
        severity: 'critical',
        status: 'failed',
        title: 'Shipment execution failed',
        actionLabel: 'Review provider response',
        destinationPath: '/admin/orders/7709129507153',
      }),
      expect.objectContaining({
        id: 'op-shipment-shipment-pending-oldest',
        type: 'awaiting_shipment',
        severity: 'warning',
        status: 'pending',
        title: 'Shipment pending carrier identifiers',
        description: 'Carrier record exists; tracking should be reviewed.',
        relatedShopifyOrderId: '7709129507153',
      }),
    ]);

    const totalWhere = prismaMock.shipmentExecution.count.mock.calls[0]?.[0]?.where;
    const itemsWhere = prismaMock.shipmentExecution.findMany.mock.calls[0]?.[0]?.where;
    expect(itemsWhere).toEqual(totalWhere);
    expect(totalWhere).toEqual({
      shipmentStatus: {
        in: ['PENDING', 'FAILED'],
      },
      allocation: {
        order: {
          cancelledAt: null,
        },
      },
    });
    expect(prismaMock.shipmentExecution.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: totalWhere,
      orderBy: [
        { shipmentStatus: 'desc' },
        { updatedAt: 'asc' },
        { id: 'asc' },
      ],
      skip: 0,
      take: 10,
    }));
    expect(prismaMock.vendorAllocation.findMany).not.toHaveBeenCalled();
    expect(prismaMock.returnRecord.findMany).not.toHaveBeenCalled();
    expect(prismaMock.financeIntegrityAlert.findMany).not.toHaveBeenCalled();
    expect(prismaMock.operationalSignal.findMany).not.toHaveBeenCalled();
    expect(prismaMock.automationAction.findMany).not.toHaveBeenCalled();
  });

  it('uses shipment offsets to separate pages without generic queue work', async () => {
    prismaMock.shipmentExecution.count
      .mockResolvedValueOnce(12)
      .mockResolvedValueOnce(3);
    prismaMock.shipmentExecution.findMany.mockResolvedValueOnce([
      buildShipmentExecution({
        id: 'shipment-page-two',
        sourceShopifyOrderNumber: '#1109',
      }),
    ]);

    const dashboard = await getAdminOperationsQueue({ type: 'awaiting_shipment', limit: 10, offset: 10 });

    expect(dashboard.summary.total).toBe(12);
    expect(dashboard.items).toEqual([
      expect.objectContaining({
        id: 'op-shipment-shipment-page-two',
        relatedShopifyOrderNumber: '#1109',
      }),
    ]);
    expect(prismaMock.shipmentExecution.findMany).toHaveBeenCalledWith(expect.objectContaining({
      skip: 10,
      take: 10,
    }));
    expect(prismaMock.vendorAllocation.findMany).not.toHaveBeenCalled();
    expect(prismaMock.supportTicket.findMany).not.toHaveBeenCalled();
  });

  it('returns an empty authoritative shipment result', async () => {
    prismaMock.shipmentExecution.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);
    prismaMock.shipmentExecution.findMany.mockResolvedValueOnce([]);

    const dashboard = await getAdminOperationsQueue({ type: 'awaiting_shipment', limit: 10, offset: 0 });

    expect(dashboard.summary.total).toBe(0);
    expect(dashboard.summary.awaitingShipment).toBe(0);
    expect(dashboard.items).toEqual([]);
  });

  it('filters return-review records before pagination and returns an authoritative matching total', async () => {
    prismaMock.returnRecord.count.mockResolvedValueOnce(12);
    prismaMock.returnRecord.findMany.mockResolvedValueOnce([
      buildReturnRecord({
        id: 'return-requested-oldest',
        status: 'requested',
        returnLifecycleStatus: 'requested',
        createdAt: new Date('2026-05-10T08:00:00.000Z'),
      }),
      buildReturnRecord({
        id: 'return-pending-next',
        status: 'legacy-status',
        returnLifecycleStatus: 'pending',
        sourceShopifyRefundId: 'refund-safe-id',
        createdAt: new Date('2026-05-10T09:00:00.000Z'),
      }),
    ]);

    const dashboard = await getAdminOperationsQueue({ type: 'return_review', limit: 10, offset: 0 });

    expect(dashboard.summary).toEqual({
      total: 12,
      critical: 0,
      warning: 0,
      attention: 12,
      normal: 0,
      pendingReassignment: 0,
      vendorBlocked: 0,
      awaitingShipment: 0,
      refundAttention: 12,
      financeIntegrityAlerts: 0,
      operationalSignals: 0,
      automationActions: 0,
    });
    expect(dashboard.items).toEqual([
      expect.objectContaining({
        id: 'op-refund-return-requested-oldest',
        type: 'refund_attention',
        relatedReturnId: 'return-requested-oldest',
        status: 'requested',
        destinationPath: '/returns/return-requested-oldest',
      }),
      expect.objectContaining({
        id: 'op-refund-return-pending-next',
        type: 'refund_attention',
        relatedRefundId: 'refund-safe-id',
        status: 'pending',
      }),
    ]);

    const totalWhere = prismaMock.returnRecord.count.mock.calls[0]?.[0]?.where;
    const itemsWhere = prismaMock.returnRecord.findMany.mock.calls[0]?.[0]?.where;
    expect(itemsWhere).toEqual(totalWhere);
    expect(totalWhere).toEqual(buildReturnReviewAttentionWhere());
    expect(prismaMock.returnRecord.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: totalWhere,
      orderBy: [
        { createdAt: 'asc' },
        { id: 'asc' },
      ],
      skip: 0,
      take: 10,
    }));
    expect(prismaMock.vendorAllocation.findMany).not.toHaveBeenCalled();
    expect(prismaMock.shipmentExecution.findMany).not.toHaveBeenCalled();
    expect(prismaMock.financeIntegrityAlert.findMany).not.toHaveBeenCalled();
    expect(prismaMock.operationalSignal.findMany).not.toHaveBeenCalled();
    expect(prismaMock.automationAction.findMany).not.toHaveBeenCalled();
  });

  it('keeps return-review totals stable across pages and uses a unique ordering tie-breaker', async () => {
    prismaMock.returnRecord.count
      .mockResolvedValueOnce(12)
      .mockResolvedValueOnce(12);
    prismaMock.returnRecord.findMany
      .mockResolvedValueOnce([
        buildReturnRecord({
          id: 'return-page-one',
          createdAt: new Date('2026-05-10T08:00:00.000Z'),
        }),
      ])
      .mockResolvedValueOnce([
        buildReturnRecord({
          id: 'return-page-two',
          createdAt: new Date('2026-05-10T08:00:00.000Z'),
        }),
      ]);

    const firstPage = await getAdminOperationsQueue({ type: 'return_review', limit: 10, offset: 0 });
    const secondPage = await getAdminOperationsQueue({ type: 'return_review', limit: 10, offset: 10 });

    expect(firstPage.summary.total).toBe(12);
    expect(secondPage.summary.total).toBe(12);
    expect(firstPage.items.map((item) => item.id)).toEqual(['op-refund-return-page-one']);
    expect(secondPage.items.map((item) => item.id)).toEqual(['op-refund-return-page-two']);
    expect(new Set([...firstPage.items, ...secondPage.items].map((item) => item.id)).size).toBe(2);
    expect(prismaMock.returnRecord.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      skip: 0,
      take: 10,
    }));
    expect(prismaMock.returnRecord.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      skip: 10,
      take: 10,
    }));
  });

  it('uses one ReturnRecord as one stable queue row without multiplying shared order relations', async () => {
    prismaMock.returnRecord.count.mockResolvedValueOnce(2);
    prismaMock.returnRecord.findMany.mockResolvedValueOnce([
      buildReturnRecord({ id: 'return-line-a' }),
      buildReturnRecord({ id: 'return-line-b' }),
    ]);

    const dashboard = await getAdminOperationsQueue({ type: 'return_review', limit: 10, offset: 0 });

    expect(dashboard.items.map((item) => item.relatedReturnId)).toEqual(['return-line-a', 'return-line-b']);
    expect(new Set(dashboard.items.map((item) => item.id)).size).toBe(2);
    expect(prismaMock.returnRecord.findMany).toHaveBeenCalledTimes(1);
  });

  it('returns an empty authoritative return-review page and preserves canonical status eligibility', async () => {
    prismaMock.returnRecord.count.mockResolvedValueOnce(0);
    prismaMock.returnRecord.findMany.mockResolvedValueOnce([]);

    const dashboard = await getAdminOperationsQueue({ type: 'return_review', limit: 10, offset: 20 });

    expect(dashboard.summary.total).toBe(0);
    expect(dashboard.summary.refundAttention).toBe(0);
    expect(dashboard.items).toEqual([]);
    expect(isReturnReviewAttentionStatus('requested')).toBe(true);
    expect(isReturnReviewAttentionStatus('awaiting review')).toBe(true);
    expect(isReturnReviewAttentionStatus('pending')).toBe(true);
    expect(isReturnReviewAttentionStatus('in_review')).toBe(true);
    expect(isReturnReviewAttentionStatus('approved')).toBe(false);
    expect(isReturnReviewAttentionStatus('processed')).toBe(false);
    expect(isReturnReviewAttentionStatus('refunded')).toBe(false);
    expect(isReturnReviewAttentionStatus('closed')).toBe(false);
    expect(isReturnReviewAttentionStatus('cancelled')).toBe(false);
    expect(isReturnReviewAttentionStatus('declined')).toBe(false);
    expect(isReturnReviewAttentionStatus('rejected')).toBe(false);
  });

  it('keeps the existing Return Attention projection unchanged', async () => {
    mockQueueSummaryCounts();
    prismaMock.returnRecord.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          ...buildReturnRecord({
            id: 'return-attention-approved',
            status: 'approved',
          }),
          requestUpdatedAt: new Date('2026-05-13T10:00:00.000Z'),
          updatedAt: new Date('2026-05-13T10:00:00.000Z'),
          vendorAllocation: {
            id: 'alloc-1',
            assignedVendorId: 'vendor-1',
            assignedVendor: {
              name: 'Vendor 1',
            },
            order: {
              sourceShopifyOrderId: '7709129507153',
              sourceShopifyOrderNumber: '#1091',
            },
          },
        },
      ]);

    const dashboard = await getAdminOperationsAttentionCenter();

    expect(dashboard.sections).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: 'return',
        title: 'Return backlog',
        count: 1,
        items: [
          expect.objectContaining({
            id: 'attention-return-return-attention-approved',
            type: 'return',
            status: 'approved',
          }),
        ],
      }),
    ]));
  });

  it('keeps the existing shipment attention projection unchanged', async () => {
    mockQueueSummaryCounts();
    prismaMock.shipmentExecution.findMany.mockResolvedValueOnce([
      buildShipmentExecution({
        id: 'shipment-attention-existing',
        shipmentStatus: 'FAILED',
      }),
    ]);

    const dashboard = await getAdminOperationsAttentionCenter();

    expect(dashboard.sections).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: 'shipment',
        title: 'Shipment attention',
        count: 1,
        items: [
          expect.objectContaining({
            id: 'attention-shipment-shipment-attention-existing',
            type: 'shipment',
            severity: 'critical',
            status: 'failed',
          }),
        ],
      }),
    ]));
    expect(prismaMock.shipmentExecution.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        shipmentStatus: {
          in: ['PENDING', 'FAILED'],
        },
        allocation: {
          order: {
            cancelledAt: null,
          },
        },
      },
      orderBy: {
        updatedAt: 'desc',
      },
      take: 100,
    }));
    expect(prismaMock.shipmentExecution.count).not.toHaveBeenCalled();
  });

  it('uses split-aware copy for vendor-blocked child allocations created by line-item split', async () => {
    prismaMock.vendorAllocation.findMany.mockResolvedValueOnce([
      buildAllocation({
        id: 'alloc-split-child',
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
        childAllocationSplitEvents: [
          {
            id: 'split-event-1',
          },
        ],
      }),
    ]);
    mockQueueSummaryCounts({ vendorBlocked: 1 });

    const dashboard = await getAdminOperationsAttentionCenter();

    expect(dashboard.queue).toEqual([
      expect.objectContaining({
        id: 'op-blocked-alloc-split-child',
        type: 'vendor_blocked',
        title: 'Split allocation awaiting admin resolution',
        description: 'Vendor rejected selected line items. Review the split allocation and choose transfer, refund, or return. Reason: OUT_OF_STOCK.',
        recommendedAction: 'Review allocation',
        splitChildAllocation: true,
        cancellationReason: 'OUT_OF_STOCK',
      }),
    ]);
    expect(dashboard.recommendations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'vendor_blocked_review',
          title: 'Split allocation awaiting admin resolution',
          description: 'Vendor rejected selected line items on Order #1091. Reason: OUT_OF_STOCK.',
          recommendedAction: 'Review the split allocation and choose transfer, refund, or return.',
        }),
      ]),
    );
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
        sourceShopifyOrderId: '7817723773265',
        sourceShopifyOrderNumber: '#1091',
        cancellationReason: 'OUT_OF_STOCK',
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

  it('keeps a vendor-blocked allocation in the queue while Shopify refund webhook is pending', async () => {
    prismaMock.vendorAllocation.findMany.mockResolvedValueOnce([
      buildAllocation({
        id: 'alloc-shopify-action-pending',
        allocationStatus: 'VENDOR_BLOCKED',
        cancellationReason: 'OUT_OF_STOCK',
        reassignmentRequired: true,
        cancelRefundReviewStatus: 'SHOPIFY_ACTION_PENDING',
        outboundShopifyRefundAttempts: [
          {
            status: 'SHOPIFY_ACTION_PENDING',
          },
        ],
      }),
    ]);
    mockQueueSummaryCounts({ vendorBlocked: 1 });

    const dashboard = await getAdminOperationsQueue({ limit: 20, offset: 0 });

    expect(dashboard.items).toEqual([
      expect.objectContaining({
        id: 'op-blocked-alloc-shopify-action-pending',
        type: 'vendor_blocked',
        actionLabel: 'Review allocation',
      }),
    ]);
  });

  it('keeps a vendor-blocked allocation in the queue when refund execution failed', async () => {
    prismaMock.vendorAllocation.findMany.mockResolvedValueOnce([
      buildAllocation({
        id: 'alloc-refund-failed',
        allocationStatus: 'VENDOR_BLOCKED',
        cancellationReason: 'OUT_OF_STOCK',
        reassignmentRequired: true,
        cancelRefundReviewStatus: 'SHOPIFY_ACTION_PENDING',
        outboundShopifyRefundAttempts: [
          {
            status: 'FAILED',
          },
        ],
      }),
    ]);
    mockQueueSummaryCounts({ vendorBlocked: 1 });

    const dashboard = await getAdminOperationsQueue({ limit: 20, offset: 0 });

    expect(dashboard.items).toEqual([
      expect.objectContaining({
        id: 'op-blocked-alloc-refund-failed',
        type: 'vendor_blocked',
      }),
    ]);
  });

  it('removes a vendor-blocked allocation from active queue after Shopify refund completion', async () => {
    prismaMock.vendorAllocation.findMany.mockResolvedValueOnce([
      buildAllocation({
        id: 'alloc-refund-resolved',
        allocationStatus: 'VENDOR_BLOCKED',
        cancellationReason: 'OUT_OF_STOCK',
        reassignmentRequired: true,
        cancelRefundReviewStatus: 'RESOLVED',
        fulfillmentStatus: 'Pending',
        shippingStatus: 'Awaiting Shipment',
        refundRecords: [
          {
            sourceShopifyRefundId: 'gid://shopify/Refund/1',
          },
        ],
        outboundShopifyRefundAttempts: [
          {
            status: 'RESOLVED',
          },
        ],
      }),
    ]);
    mockQueueSummaryCounts({ vendorBlocked: 0, awaitingShipment: 0 });

    const dashboard = await getAdminOperationsQueue({ limit: 20, offset: 0 });

    expect(dashboard.items).toEqual([]);
  });

  it('keeps resolved vendor rejection refund in recent activity without active attention item', async () => {
    const resolvedAllocation = buildAllocation({
      id: 'alloc-refund-activity',
      assignedVendorId: 'sporjinal',
      allocationStatus: 'VENDOR_BLOCKED',
      cancellationReason: 'OUT_OF_STOCK',
      reassignmentRequired: true,
      cancelRefundReviewStatus: 'RESOLVED',
      refundRecords: [
        {
          sourceShopifyRefundId: 'gid://shopify/Refund/1',
        },
      ],
      outboundShopifyRefundAttempts: [
        {
          status: 'RESOLVED',
        },
      ],
      assignedVendor: {
        name: 'Sporjinal',
      },
      order: {
        sourceShopifyOrderId: '7817723773265',
        sourceShopifyOrderNumber: '#1091',
      },
      updatedAt: new Date('2026-06-21T12:00:00.000Z'),
    });
    prismaMock.vendorAllocation.findMany
      .mockResolvedValueOnce([resolvedAllocation])
      .mockResolvedValueOnce([resolvedAllocation]);
    mockQueueSummaryCounts({ vendorBlocked: 0, awaitingShipment: 0 });

    const dashboard = await getAdminOperationsAttentionCenter();

    expect(dashboard.summary.vendorBlocked).toBe(0);
    expect(dashboard.queue).toEqual([]);
    expect(dashboard.sections.find((section) => section.key === 'vendor_blocked')?.count).toBe(0);
    expect(dashboard.recommendations).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'vendor_blocked_review',
        }),
      ]),
    );
    expect(dashboard.recentActivity).toEqual([
      expect.objectContaining({
        id: 'activity-resolved-vendor-block-alloc-refund-activity',
        type: 'vendor_blocked',
        severity: 'info',
        title: 'Vendor rejection resolved by Shopify refund',
        description: 'Order #1091',
        destinationPath: '/admin/orders/7817723773265',
      }),
    ]);
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

  it('excludes full Shopify cancellations from awaiting shipment summary candidates', async () => {
    prismaMock.vendorAllocation.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);
    prismaMock.returnRecord.count.mockResolvedValueOnce(0);
    prismaMock.financeIntegrityAlert.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);
    prismaMock.operationalSignal.groupBy.mockResolvedValueOnce([]);
    prismaMock.automationAction.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);

    await getAdminOperationsQueueSummary();

    expect(prismaMock.vendorAllocation.count).toHaveBeenNthCalledWith(3, {
      where: {
        AND: expect.arrayContaining([
          {
            order: {
              cancelledAt: null,
            },
          },
        ]),
      },
    });
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
