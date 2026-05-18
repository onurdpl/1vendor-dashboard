import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  vendorAllocation: {
    findMany: vi.fn(),
  },
}));

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: prismaMock,
}));

const { listVendorOrders } = await import('../backend/src/modules/orders/orders.service.js');

function buildAllocation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'alloc-sporjinal-1038',
    assignedVendorId: 'sporjinal',
    originalVendorId: 'sporjinal',
    allocationStatus: 'ACTIVE',
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

describe('vendor orders list visibility', () => {
  beforeEach(() => {
    prismaMock.vendorAllocation.findMany.mockReset();
  });

  it('orders vendor allocations by operational update time so shipment updates stay visible', async () => {
    prismaMock.vendorAllocation.findMany.mockResolvedValue([buildAllocation()]);

    await listVendorOrders('sporjinal', { limit: 100, offset: 0 });

    expect(prismaMock.vendorAllocation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          assignedVendorId: 'sporjinal',
        },
        include: expect.objectContaining({
          order: true,
          fulfillment: true,
          lineItems: true,
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
        fulfillmentStatus: 'Processing',
        shippingStatus: 'label_created',
        carrier: 'try_oto',
        trackingNumber: 'OTO-TRACK-1038',
        trackingUrl: 'https://track.tryoto.example/OTO-TRACK-1038',
        fulfilledAt: null,
        shipmentCreatedAt: '2026-05-18T11:55:00.000Z',
        shipmentUpdatedAt: '2026-05-18T12:00:00.000Z',
      }),
    ]);
  });
});
