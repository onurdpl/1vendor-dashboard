import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  vendorAllocation: { findMany: vi.fn() },
  returnRecord: { findMany: vi.fn() },
  fulfillment: { findMany: vi.fn() },
  webhookEvent: { findMany: vi.fn() },
}));

vi.mock('../backend/src/db/prisma.js', () => ({ prisma: prismaMock }));

const { getAutomationDashboard } = await import('../backend/src/modules/automation/automation.service.js');

describe('automation cancellation safety', () => {
  beforeEach(() => {
    prismaMock.vendorAllocation.findMany.mockReset();
    prismaMock.returnRecord.findMany.mockReset().mockResolvedValue([]);
    prismaMock.fulfillment.findMany.mockReset().mockResolvedValue([]);
    prismaMock.webhookEvent.findMany.mockReset().mockResolvedValue([]);
  });

  it('excludes conflict-cancelled raw awaiting-shipment allocations', async () => {
    prismaMock.vendorAllocation.findMany.mockResolvedValue([{
      id: 'allocation-cancelled',
      allocationStatus: 'ACTIVE',
      reassignmentRequired: false,
      sourceShopifyOrderNumber: '1108',
      shippingStatus: 'Awaiting Shipment',
      updatedAt: new Date('2026-07-11T20:23:00.000Z'),
      order: { cancelledAt: new Date('2026-07-11T20:23:00.000Z') },
    }]);

    const dashboard = await getAutomationDashboard('yalispor', 'Yali Spor');

    expect(dashboard.alerts.some((alert) => alert.id === 'automation-shipment-allocation-cancelled')).toBe(false);
    expect(prismaMock.vendorAllocation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        assignedVendorId: 'yalispor',
        order: { cancelledAt: null },
      }),
    }));
  });
});
