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

  it('excludes an unclassified order-linked refund failure from both Vendor scopes', async () => {
    prismaMock.vendorAllocation.findMany.mockResolvedValue([]);
    prismaMock.webhookEvent.findMany.mockResolvedValue([{
      id: 'shared-order-refund-webhook', topic: 'refunds/create',
      errorMessage: 'Canonical refund evidence requires finance review: vendor-b-private-allocation[unresolved].',
      receivedAt: new Date('2026-07-11T20:23:00.000Z'), processedAt: null,
      shopifyOrder: { sourceShopifyOrderNumber: '#shared-order' },
    }]);

    for (const [vendorId, vendorName] of [['vendor-a', 'Vendor A'], ['vendor-b', 'Vendor B']]) {
      const dashboard = await getAutomationDashboard(vendorId, vendorName);
      expect(dashboard.alerts).toEqual([]);
      expect(JSON.stringify(dashboard)).not.toContain('vendor-b-private-allocation');
      expect(JSON.stringify(dashboard)).not.toContain('shared-order-refund-webhook');
      expect(dashboard.suggestions).toEqual([expect.objectContaining({ title: `Monitor ${vendorName} operational health` })]);
    }
  });

  it('does not infer ownership for single-Vendor, legacy, or unlinked failed webhooks', async () => {
    prismaMock.vendorAllocation.findMany.mockResolvedValue([]);
    prismaMock.webhookEvent.findMany.mockResolvedValue([
      { id: 'single-vendor-failure', topic: 'returns/request', errorMessage: 'private-return-line-id',
        receivedAt: new Date('2026-07-11T20:23:00.000Z'), processedAt: null, shopifyOrder: { sourceShopifyOrderNumber: '#single' } },
      { id: 'legacy-failure', topic: 'refunds/create', errorMessage: 'legacy-private-id',
        receivedAt: new Date('2026-07-11T20:22:00.000Z'), processedAt: null, shopifyOrder: { sourceShopifyOrderNumber: '#legacy' } },
      { id: 'unlinked-failure', topic: 'orders/create', errorMessage: 'unlinked-private-id',
        receivedAt: new Date('2026-07-11T20:21:00.000Z'), processedAt: null, shopifyOrder: null },
    ]);

    const dashboard = await getAutomationDashboard('vendor-a', 'Vendor A');
    expect(dashboard.alerts).toEqual([]);
    expect(JSON.stringify(dashboard)).not.toMatch(/private-id|private-return-line-id/);
  });

  it('preserves allocation, return, and fulfillment alerts with their structural Vendor predicates', async () => {
    const updatedAt = new Date('2026-07-11T20:23:00.000Z');
    prismaMock.vendorAllocation.findMany.mockResolvedValue([{
      id: 'vendor-a-allocation', allocationStatus: 'vendor_blocked', reassignmentRequired: false,
      sourceShopifyOrderNumber: '#shared-order', shippingStatus: 'shipped', updatedAt,
      order: { cancelledAt: null },
    }]);
    prismaMock.returnRecord.findMany.mockResolvedValue([{
      id: 'vendor-a-return', sourceShopifyOrderNumber: '#shared-order', updatedAt,
    }]);
    prismaMock.fulfillment.findMany.mockResolvedValue([{
      id: 'vendor-a-fulfillment', vendorAllocationId: 'vendor-a-allocation', updatedAt,
    }]);

    const dashboard = await getAutomationDashboard('vendor-a', 'Vendor A');
    expect(dashboard.alerts.map((alert) => alert.id)).toEqual(expect.arrayContaining([
      'automation-allocation-blocked-vendor-a-allocation',
      'automation-return-vendor-a-return',
      'automation-fulfillment-vendor-a-fulfillment',
    ]));
    expect(prismaMock.vendorAllocation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ assignedVendorId: 'vendor-a' }),
    }));
    expect(prismaMock.returnRecord.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ vendorAllocation: expect.objectContaining({ assignedVendorId: 'vendor-a' }) }),
    }));
    expect(prismaMock.fulfillment.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ vendorAllocation: { assignedVendorId: 'vendor-a' } }),
    }));
  });
});
