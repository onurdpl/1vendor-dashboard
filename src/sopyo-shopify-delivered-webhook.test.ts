import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  webhookEvent: { update: vi.fn() },
  shopifyOrder: { findUnique: vi.fn() },
  vendorAllocation: { update: vi.fn(), findUnique: vi.fn() },
  fulfillment: { upsert: vi.fn() },
  $queryRaw: vi.fn(),
  $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prismaMock)),
}));
const fetchState = vi.hoisted(() => vi.fn());
vi.mock('../backend/src/db/prisma.js', () => ({ prisma: prismaMock }));
vi.mock('../backend/src/modules/shopify/shopify-admin.service.js', () => ({
  createShopifyAdminService: () => ({ fetchOrderFulfillmentState: fetchState }),
}));

const { ingestFulfillmentWebhook } = await import(
  '../backend/src/modules/shopify/fulfillment-ingestion.service.js');

function allocation(sopyo: boolean) {
  return { id: 'allocation-1', shippingStatus: 'delivered',
    outboundMethodSnapshot: sopyo ? 'VENDOR_INTEGRATION' : 'KARGONOMI',
    outboundIntegrationProviderSnapshot: sopyo ? 'SOPYO' : null,
    deliveredObservation: sopyo ? { vendorAllocationId: 'allocation-1',
      outboundMethod: 'VENDOR_INTEGRATION', outboundIntegrationProvider: 'SOPYO',
      id: 'unchanged-observation', firstObservedDeliveredAt: new Date('2026-10-05T12:00:00Z') } : null,
    lineItems: [{ shopifyOrderLineItem: { sourceLineItemId: 'line-1' } }], fulfillment: null,
  };
}

describe('Sopyo Delivered Shopify webhook echo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchState.mockResolvedValue({ fulfillments: [{
      id: 'gid://shopify/Fulfillment/789', sourceFulfillmentId: '789', status: 'SUCCESS',
      createdAt: '2026-10-05T11:00:00Z', updatedAt: '2026-10-05T11:30:00Z',
      events: [{ status: 'in_transit', happenedAt: '2026-10-05T11:30:00Z' }],
      trackingInfo: [], lineItems: [{ sourceLineItemId: 'line-1', lineItemGid: 'gid://shopify/LineItem/line-1' }],
    }], fulfillmentOrders: [] });
  });

  it.each([{ sopyo: true, expected: 'delivered' }, { sopyo: false, expected: 'in_transit' }])(
    'projects $expected without creating delivery or finance authority', async ({ sopyo, expected }) => {
      const row = allocation(sopyo);
      prismaMock.shopifyOrder.findUnique.mockResolvedValue({ id: 'db-order-1', allocations: [row] });
      prismaMock.vendorAllocation.findUnique.mockResolvedValue(row);
      const result = await ingestFulfillmentWebhook({} as never, {
        event: { id: 'webhook-1' } as never,
        topic: 'fulfillment_events/create',
        payload: { order_id: '123', fulfillment_id: '789', status: 'in_transit' },
      });
      expect(result.ok).toBe(true);
      expect(prismaMock.vendorAllocation.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ shippingStatus: expected }),
      }));
      expect(row.deliveredObservation?.id).toBe(sopyo ? 'unchanged-observation' : undefined);
      expect(prismaMock.fulfillment.upsert).toHaveBeenCalledTimes(1);
    },
  );

  it('rechecks a newly committed Sopyo Delivered observation before writing older Shopify status', async () => {
    const stale = { ...allocation(true), shippingStatus: 'shipped', deliveredObservation: null };
    const current = allocation(true);
    prismaMock.shopifyOrder.findUnique.mockResolvedValue({ id: 'db-order-1', allocations: [stale] });
    prismaMock.vendorAllocation.findUnique.mockResolvedValue(current);
    const result = await ingestFulfillmentWebhook({} as never, {
      event: { id: 'webhook-1' } as never,
      topic: 'fulfillment_events/create',
      payload: { order_id: '123', fulfillment_id: '789', status: 'in_transit' },
    });
    expect(result.ok).toBe(true);
    expect(prismaMock.$queryRaw).toHaveBeenCalledOnce();
    expect(prismaMock.vendorAllocation.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ shippingStatus: 'delivered' }),
    }));
  });
});
