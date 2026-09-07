import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  vendorAllocation: {
    findMany: vi.fn(),
    count: vi.fn(),
  },
}));

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: prismaMock,
}));

const { getVendorOrdersWorkflowSummary, listVendorOrders } = await import('../backend/src/modules/orders/orders.service.js');
const { buildVendorOrdersWorkflowWhere } = await import('../backend/src/modules/orders/vendor-orders-workflow.js');

function buildAllocation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'alloc-sporjinal-1038',
    assignedVendorId: 'sporjinal',
    originalVendorId: 'sporjinal',
    allocationStatus: 'ACTIVE',
    fullRefundTerminalFact: null,
    fulfillmentStatus: 'Processing',
    shippingStatus: 'label_created',
    trackingNumber: 'OTO-TRACK-1038',
    carrier: 'try_oto',
    createdAt: new Date('2026-05-18T08:00:00.000Z'),
    updatedAt: new Date('2026-05-18T12:00:00.000Z'),
    order: {
      sourceShopifyOrderId: 'gid://shopify/Order/1038',
      sourceShopifyOrderNumber: '#1038',
    },
    fulfillment: {
      trackingUrl: 'https://track.tryoto.example/OTO-TRACK-1038',
      fulfilledAt: null,
      shipmentCreatedAt: new Date('2026-05-18T11:55:00.000Z'),
      shipmentUpdatedAt: new Date('2026-05-18T12:00:00.000Z'),
    },
    lineItems: [
      {
        lineAmount: 1299.9,
      },
    ],
    ...overrides,
  };
}

function installWorkflowAwareFixture(rows: Array<ReturnType<typeof buildAllocation>>) {
  prismaMock.vendorAllocation.findMany.mockImplementation(async (args: {
    where: Record<string, unknown>;
    skip?: number;
    take?: number;
  }) => {
    let filtered = rows.filter((row) => row.assignedVendorId === args.where.assignedVendorId);
    if (args.where.fullRefundTerminalFact === null) {
      filtered = filtered.filter((row) => row.fullRefundTerminalFact === null);
    }
    if (args.where.order) {
      filtered = filtered.filter((row) => !(row.order as { cancelledAt?: Date | null }).cancelledAt);
    }
    if (args.where.NOT) {
      const excludedStatuses = new Set([
        'delivered',
        'in transit',
        'in_transit',
        'shipped',
        'partially_shipped',
        'label created',
        'label_created',
      ]);
      filtered = filtered.filter((row) => !excludedStatuses.has(row.shippingStatus.trim().toLowerCase()));
    }
    if (args.where.AND) {
      filtered = filtered.filter((row) => !row.trackingNumber && !row.carrier);
    }
    const offset = args.skip ?? 0;
    return filtered.slice(offset, offset + (args.take ?? 100));
  });
}

describe('vendor orders list visibility', () => {
  beforeEach(() => {
    prismaMock.vendorAllocation.findMany.mockReset();
    prismaMock.vendorAllocation.count.mockReset();
  });

  it('orders vendor allocations by operational update time so shipment updates stay visible', async () => {
    prismaMock.vendorAllocation.findMany.mockResolvedValue([buildAllocation()]);

    await listVendorOrders('sporjinal', { limit: 100, offset: 0 });

    expect(prismaMock.vendorAllocation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          assignedVendorId: 'sporjinal',
        },
        select: expect.objectContaining({
          order: {
            select: expect.objectContaining({
              sourceShopifyOrderId: true,
              sourceShopifyOrderNumber: true,
              cancelledAt: true,
              cancelReason: true,
            }),
          },
          fulfillment: {
            select: {
              trackingUrl: true,
              fulfilledAt: true,
              shipmentCreatedAt: true,
              shipmentUpdatedAt: true,
            },
          },
          fullRefundTerminalFact: {
            select: {
              id: true,
            },
          },
          lineItems: {
            select: {
              quantity: true,
              lineAmount: true,
            },
          },
        }),
        orderBy: {
          updatedAt: 'desc',
        },
        take: 100,
        skip: 0,
      }),
    );
  });

  it('keeps orders with created shipments and pending fulfillment in the Orders list summary', async () => {
    prismaMock.vendorAllocation.findMany.mockResolvedValue([buildAllocation()]);

    const result = await listVendorOrders('sporjinal', { limit: 100, offset: 0 });

    expect(result).toEqual([
      expect.objectContaining({
        id: 'alloc-sporjinal-1038',
        sourceShopifyOrderNumber: '#1038',
        allocationStatus: 'ACTIVE',
        operationalActionability: {
          actionable: true,
          reason: null,
        },
        fulfillmentStatus: 'Processing',
        shippingStatus: 'label_created',
        carrier: 'try_oto',
        trackingNumber: 'OTO-TRACK-1038',
        trackingUrl: 'https://track.tryoto.example/OTO-TRACK-1038',
        lineItemCount: 1,
        fulfilledAt: null,
        shipmentCreatedAt: '2026-05-18T11:55:00.000Z',
        shipmentUpdatedAt: '2026-05-18T12:00:00.000Z',
      }),
    ]);
  });

  it('keeps a terminal allocation visible with unchanged raw state and projects it as non-actionable', async () => {
    prismaMock.vendorAllocation.findMany.mockResolvedValue([
      buildAllocation({
        allocationStatus: 'ACTIVE',
        fulfillmentStatus: 'Pending',
        shippingStatus: 'Awaiting Shipment',
        carrier: null,
        trackingNumber: null,
        fullRefundTerminalFact: { id: 'terminal-fact-1' },
      }),
    ]);

    const result = await listVendorOrders('sporjinal', { limit: 100, offset: 0 });

    expect(result).toEqual([
      expect.objectContaining({
        id: 'alloc-sporjinal-1038',
        allocationStatus: 'ACTIVE',
        fulfillmentStatus: 'Pending',
        shippingStatus: 'Awaiting Shipment',
        carrier: null,
        trackingNumber: null,
        operationalActionability: {
          actionable: false,
          reason: 'ALLOCATION_REFUND_TERMINAL',
        },
      }),
    ]);
  });

  it('derives actionability independently for allocations belonging to the same Shopify order', async () => {
    const sharedOrder = {
      sourceShopifyOrderId: 'gid://shopify/Order/2001',
      sourceShopifyOrderNumber: '#2001',
    };
    prismaMock.vendorAllocation.findMany.mockResolvedValue([
      buildAllocation({
        id: 'allocation-a',
        order: sharedOrder,
        fullRefundTerminalFact: { id: 'terminal-fact-a' },
      }),
      buildAllocation({
        id: 'allocation-b',
        order: sharedOrder,
        fullRefundTerminalFact: null,
      }),
    ]);

    const result = await listVendorOrders('sporjinal');

    expect(result.map(({ id, operationalActionability }) => ({ id, operationalActionability }))).toEqual([
      {
        id: 'allocation-a',
        operationalActionability: {
          actionable: false,
          reason: 'ALLOCATION_REFUND_TERMINAL',
        },
      },
      {
        id: 'allocation-b',
        operationalActionability: {
          actionable: true,
          reason: null,
        },
      },
    ]);
  });

  it('does not infer terminality from refund evidence when the terminal fact is absent', async () => {
    installWorkflowAwareFixture([
      buildAllocation({
        fulfillmentStatus: 'Pending',
        shippingStatus: 'Awaiting Shipment',
        carrier: null,
        trackingNumber: null,
        refundRecords: [{ id: 'partial-refund-1' }],
        fullRefundTerminalFact: null,
      }),
    ]);

    const result = await listVendorOrders('sporjinal', { workflow: 'awaitingShipment' });

    expect(result[0]).toMatchObject({
      refundRecordCount: 1,
      operationalActionability: {
        actionable: true,
        reason: null,
      },
    });
  });

  it.each(['awaitingShipment', 'shipmentReview', 'trackingMissing'] as const)(
    'applies the terminal-aware %s predicate before pagination',
    async (workflow) => {
      installWorkflowAwareFixture([
        buildAllocation({
          id: 'terminal',
          fulfillmentStatus: 'Pending',
          shippingStatus: 'Awaiting Shipment',
          trackingNumber: null,
          carrier: null,
          fullRefundTerminalFact: { id: 'terminal-fact-1' },
        }),
        buildAllocation({
          id: 'actionable-a',
          fulfillmentStatus: 'Pending',
          shippingStatus: 'Awaiting Shipment',
          trackingNumber: null,
          carrier: null,
        }),
        buildAllocation({
          id: 'actionable-b',
          fulfillmentStatus: 'Pending',
          shippingStatus: 'Awaiting Shipment',
          trackingNumber: null,
          carrier: null,
        }),
      ]);

      const result = await listVendorOrders('sporjinal', { workflow, limit: 2, offset: 0 });

      expect(result.map((order) => order.id)).toEqual(['actionable-a', 'actionable-b']);
      expect(prismaMock.vendorAllocation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: buildVendorOrdersWorkflowWhere('sporjinal', workflow),
          skip: 0,
          take: 2,
        }),
      );
    },
  );

  it('applies offset to the terminal-filtered result set', async () => {
    installWorkflowAwareFixture([
      buildAllocation({ id: 'terminal', shippingStatus: 'Awaiting Shipment', fullRefundTerminalFact: { id: 'terminal-fact-1' } }),
      buildAllocation({ id: 'actionable-a', shippingStatus: 'Awaiting Shipment', fullRefundTerminalFact: null }),
      buildAllocation({ id: 'actionable-b', shippingStatus: 'Awaiting Shipment', fullRefundTerminalFact: null }),
    ]);

    const result = await listVendorOrders('sporjinal', {
      workflow: 'awaitingShipment',
      limit: 1,
      offset: 1,
    });

    expect(result.map((order) => order.id)).toEqual(['actionable-b']);
  });

  it('keeps terminal filtering scoped to each vendor allocation', async () => {
    installWorkflowAwareFixture([
      buildAllocation({
        id: 'vendor-a-terminal',
        assignedVendorId: 'vendor-a',
        shippingStatus: 'Awaiting Shipment',
        fullRefundTerminalFact: { id: 'terminal-fact-a' },
      }),
      buildAllocation({
        id: 'vendor-b-actionable',
        assignedVendorId: 'vendor-b',
        shippingStatus: 'Awaiting Shipment',
        fullRefundTerminalFact: null,
      }),
    ]);

    const [vendorAForward, vendorAAll, vendorBForward, vendorBAll] = await Promise.all([
      listVendorOrders('vendor-a', { workflow: 'awaitingShipment' }),
      listVendorOrders('vendor-a'),
      listVendorOrders('vendor-b', { workflow: 'awaitingShipment' }),
      listVendorOrders('vendor-b'),
    ]);

    expect(vendorAForward).toEqual([]);
    expect(vendorAAll.map((order) => order.id)).toEqual(['vendor-a-terminal']);
    expect(vendorBForward.map((order) => order.id)).toEqual(['vendor-b-actionable']);
    expect(vendorBAll.map((order) => order.id)).toEqual(['vendor-b-actionable']);
  });

  it('uses the shared workflow predicates for authoritative counts', async () => {
    prismaMock.vendorAllocation.count
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1);

    await expect(getVendorOrdersWorkflowSummary('sporjinal')).resolves.toEqual({
      all: 3,
      awaitingShipment: 2,
      shipmentReview: 2,
      trackingMissing: 1,
    });
    expect(prismaMock.vendorAllocation.count.mock.calls.map(([args]) => args)).toEqual([
      { where: buildVendorOrdersWorkflowWhere('sporjinal', 'all') },
      { where: buildVendorOrdersWorkflowWhere('sporjinal', 'awaitingShipment') },
      { where: buildVendorOrdersWorkflowWhere('sporjinal', 'shipmentReview') },
      { where: buildVendorOrdersWorkflowWhere('sporjinal', 'trackingMissing') },
    ]);
  });
});
