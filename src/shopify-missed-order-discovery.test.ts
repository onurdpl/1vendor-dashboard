import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppEnv } from '../backend/src/config/env.js';
import type { FetchRecentShopifyOrdersPageResult, RecentShopifyOrderIdentity } from '../backend/src/modules/shopify/shopify-admin.types.js';

const fetchRecentOrdersPage = vi.hoisted(() => vi.fn());
const prismaMock = vi.hoisted(() => ({
  shopifyOrder: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), upsert: vi.fn() },
  operationalJob: { findMany: vi.fn() },
  operationalSignal: { findMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn(), updateMany: vi.fn() },
  vendorAllocation: { create: vi.fn(), update: vi.fn(), upsert: vi.fn() },
  financeLedgerEntry: { create: vi.fn(), update: vi.fn(), upsert: vi.fn() },
  financeEvent: { create: vi.fn(), update: vi.fn(), upsert: vi.fn() },
  fulfillment: { create: vi.fn(), update: vi.fn(), upsert: vi.fn() },
  refundRecord: { create: vi.fn(), update: vi.fn(), upsert: vi.fn() },
  returnRecord: { create: vi.fn(), update: vi.fn(), upsert: vi.fn() },
  settlementBatch: { create: vi.fn(), update: vi.fn(), upsert: vi.fn() },
  payoutBatch: { create: vi.fn(), update: vi.fn(), upsert: vi.fn() },
}));

vi.mock('../backend/src/db/prisma.js', () => ({ prisma: prismaMock }));
vi.mock('../backend/src/modules/shopify/shopify-admin.service.js', () => ({
  createShopifyAdminService: vi.fn(() => ({ fetchRecentOrdersPage })),
}));

const {
  buildMissedOrderSignalId,
  runMissedOrderDiscovery,
} = await import('../backend/src/modules/shopify/missed-order-discovery.service.js');

const now = new Date('2026-08-26T12:00:00.000Z');
const env = {
  NODE_ENV: 'test',
  SHOPIFY_API_VERSION: '2026-01',
  SHOPIFY_MISSED_ORDER_DISCOVERY_LOOKBACK_DAYS: 7,
  SHOPIFY_MISSED_ORDER_DISCOVERY_GRACE_PERIOD_MS: 15 * 60 * 1000,
  SHOPIFY_MISSED_ORDER_DISCOVERY_MAX_ORDERS: 1000,
} as AppEnv;

function order(id: string, createdAt = '2026-08-26T10:00:00.000Z'): RecentShopifyOrderIdentity {
  return {
    orderGid: `gid://shopify/Order/${id}`,
    sourceShopifyOrderId: id,
    sourceShopifyOrderNumber: `#${id}`,
    shopifyCreatedAt: createdAt,
  };
}

function page(orders: RecentShopifyOrderIdentity[], input: Partial<FetchRecentShopifyOrdersPageResult> = {}): FetchRecentShopifyOrdersPageResult {
  return { orders, nodesCount: orders.length, malformedNodes: 0, hasNextPage: false, endCursor: null, ...input };
}

function missingSignalUpserts() {
  return prismaMock.operationalSignal.upsert.mock.calls.filter(([input]) =>
    String(input.where.id).startsWith('signal-diagnostics-shopify-order-missing-local-'));
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.shopifyOrder.findMany.mockResolvedValue([]);
  prismaMock.shopifyOrder.findUnique.mockResolvedValue(null);
  prismaMock.operationalJob.findMany.mockResolvedValue([]);
  prismaMock.operationalSignal.findMany.mockResolvedValue([]);
  prismaMock.operationalSignal.findUnique.mockResolvedValue(null);
  prismaMock.operationalSignal.upsert.mockResolvedValue({});
  prismaMock.operationalSignal.updateMany.mockResolvedValue({ count: 0 });
  fetchRecentOrdersPage.mockResolvedValue(page([]));
});

describe('missed Shopify order discovery', () => {
  it('does not signal an order that already exists locally', async () => {
    fetchRecentOrdersPage.mockResolvedValue(page([order('1001')]));
    prismaMock.shopifyOrder.findMany.mockImplementation(async ({ where }) =>
      where.sourceShopifyOrderId.in.includes('1001') ? [{ sourceShopifyOrderId: '1001' }] : []);
    const result = await runMissedOrderDiscovery(env, { now });
    expect(result.missingOrders).toBe(0);
    expect(missingSignalUpserts()).toHaveLength(0);
  });

  it('creates one deterministic active signal for a missing order', async () => {
    fetchRecentOrdersPage.mockResolvedValue(page([order('1002')]));
    await runMissedOrderDiscovery(env, { now });
    expect(missingSignalUpserts()).toHaveLength(1);
    expect(missingSignalUpserts()[0][0]).toMatchObject({
      where: { id: buildMissedOrderSignalId('1002') },
      create: { type: 'shopify_order_missing_local' },
      update: { status: 'ACTIVE' },
    });
  });

  it('reuses the same signal and retains its original triggeredAt', async () => {
    fetchRecentOrdersPage.mockResolvedValue(page([order('1003')]));
    const triggeredAt = new Date('2026-08-25T09:00:00.000Z');
    prismaMock.operationalSignal.findUnique.mockResolvedValue({ triggeredAt });
    await runMissedOrderDiscovery(env, { now });
    await runMissedOrderDiscovery(env, { now: new Date(now.getTime() + 60_000) });
    const calls = missingSignalUpserts();
    expect(new Set(calls.map(([input]) => input.where.id))).toEqual(new Set([buildMissedOrderSignalId('1003')]));
    expect(calls[1][0].update.triggeredAt).toBeUndefined();
    expect(calls[1][0].update.metadata.firstDetectedAt).toBe(triggeredAt.toISOString());
  });

  it('excludes an order inside the grace period', async () => {
    fetchRecentOrdersPage.mockResolvedValue(page([order('1004', '2026-08-26T11:50:00.000Z')]));
    await runMissedOrderDiscovery(env, { now });
    expect(missingSignalUpserts()).toHaveLength(0);
  });

  it('leaves no active false positive when ingestion wins before signal write', async () => {
    fetchRecentOrdersPage.mockResolvedValue(page([order('1005')]));
    let exists = false;
    prismaMock.shopifyOrder.findUnique.mockImplementation(async () => exists ? { id: 'local-1005' } : null);
    await runMissedOrderDiscovery(env, { now, beforeSignalWrite: () => { exists = true; } });
    expect(missingSignalUpserts()).toHaveLength(0);
  });

  it('resolves the signal when ingestion wins immediately after signal write', async () => {
    fetchRecentOrdersPage.mockResolvedValue(page([order('1005-post')]));
    prismaMock.shopifyOrder.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'local-1005-post' });
    await runMissedOrderDiscovery(env, { now });
    expect(prismaMock.operationalSignal.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: buildMissedOrderSignalId('1005-post') }),
      data: expect.objectContaining({ status: 'RESOLVED' }),
    }));
  });

  it('resolves a prior signal only after the local order positively exists', async () => {
    fetchRecentOrdersPage.mockResolvedValue(page([]));
    prismaMock.operationalSignal.findMany.mockResolvedValue([{ id: buildMissedOrderSignalId('1006'), metadata: { sourceShopifyOrderId: '1006' } }]);
    prismaMock.shopifyOrder.findMany.mockResolvedValue([{ sourceShopifyOrderId: '1006' }]);
    await runMissedOrderDiscovery(env, { now });
    expect(prismaMock.operationalSignal.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: buildMissedOrderSignalId('1006') }) }));
  });

  it('creates independent signals for multiple missing orders', async () => {
    fetchRecentOrdersPage.mockResolvedValue(page([order('1007'), order('1008')]));
    await runMissedOrderDiscovery(env, { now });
    expect(missingSignalUpserts().map(([input]) => input.where.id)).toEqual([
      buildMissedOrderSignalId('1007'), buildMissedOrderSignalId('1008'),
    ]);
  });

  it('follows cursor pagination', async () => {
    fetchRecentOrdersPage
      .mockResolvedValueOnce(page([order('1009')], { hasNextPage: true, endCursor: 'cursor-1' }))
      .mockResolvedValueOnce(page([order('1010')]));
    const result = await runMissedOrderDiscovery(env, { now });
    expect(result.ordersScanned).toBe(2);
    expect(fetchRecentOrdersPage).toHaveBeenNthCalledWith(2, expect.objectContaining({ after: 'cursor-1' }));
  });

  it('marks the default 1000-order cap as truncated when Shopify has more pages', async () => {
    for (let pageIndex = 0; pageIndex < 10; pageIndex += 1) {
      const orders = Array.from({ length: 100 }, (_, index) => order(String(pageIndex * 100 + index + 2000)));
      fetchRecentOrdersPage.mockResolvedValueOnce(page(orders, { hasNextPage: true, endCursor: `cursor-${pageIndex}` }));
    }
    prismaMock.shopifyOrder.findMany.mockImplementation(async ({ where }) =>
      where.sourceShopifyOrderId.in.map((sourceShopifyOrderId: string) => ({ sourceShopifyOrderId })));
    const result = await runMissedOrderDiscovery(env, { now });
    expect(result).toMatchObject({ complete: false, truncated: true, ordersScanned: 1000 });
    expect(prismaMock.operationalSignal.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'signal-diagnostics-shopify-order-discovery-truncated' } }));
  });

  it('preserves existing missing signals when a Shopify page fails', async () => {
    fetchRecentOrdersPage.mockRejectedValue(new Error('Shopify unavailable'));
    await runMissedOrderDiscovery(env, { now });
    expect(prismaMock.operationalSignal.findMany).not.toHaveBeenCalled();
    expect(prismaMock.operationalSignal.updateMany).not.toHaveBeenCalled();
  });

  it('does not resolve signals when local comparison fails', async () => {
    fetchRecentOrdersPage.mockResolvedValue(page([order('1011')]));
    prismaMock.shopifyOrder.findMany.mockRejectedValue(new Error('Database unavailable'));
    const result = await runMissedOrderDiscovery(env, { now });
    expect(result.complete).toBe(false);
    expect(prismaMock.operationalSignal.updateMany).not.toHaveBeenCalled();
  });

  it('continues independent candidates after one signal persistence failure', async () => {
    fetchRecentOrdersPage.mockResolvedValue(page([order('1012'), order('1013')]));
    prismaMock.operationalSignal.upsert.mockImplementation(async ({ where }) => {
      if (where.id === buildMissedOrderSignalId('1012')) throw new Error('signal write failed');
      return {};
    });
    const result = await runMissedOrderDiscovery(env, { now });
    expect(result.complete).toBe(false);
    expect(missingSignalUpserts().map(([input]) => input.where.id)).toContain(buildMissedOrderSignalId('1013'));
  });

  it('defers a missing order with an active indexed operational job', async () => {
    fetchRecentOrdersPage.mockResolvedValue(page([order('1014')]));
    prismaMock.operationalJob.findMany.mockResolvedValue([{ sourceShopifyOrderId: '1014' }]);
    const result = await runMissedOrderDiscovery(env, { now });
    expect(result.deferredOrders).toBe(1);
    expect(missingSignalUpserts()).toHaveLength(0);
  });

  it('concurrent observations converge on one deterministic signal identity', async () => {
    fetchRecentOrdersPage.mockResolvedValue(page([order('1015')]));
    await Promise.all([runMissedOrderDiscovery(env, { now }), runMissedOrderDiscovery(env, { now })]);
    expect(new Set(missingSignalUpserts().map(([input]) => input.where.id))).toEqual(new Set([buildMissedOrderSignalId('1015')]));
  });

  it('never writes commerce, allocation, fulfillment, refund, return, settlement, payout, or finance state', async () => {
    fetchRecentOrdersPage.mockResolvedValue(page([order('1016')]));
    await runMissedOrderDiscovery(env, { now });
    const forbiddenModels = [
      prismaMock.shopifyOrder,
      prismaMock.vendorAllocation,
      prismaMock.financeLedgerEntry,
      prismaMock.financeEvent,
      prismaMock.fulfillment,
      prismaMock.refundRecord,
      prismaMock.returnRecord,
      prismaMock.settlementBatch,
      prismaMock.payoutBatch,
    ];
    for (const model of forbiddenModels) {
      expect(model.create).not.toHaveBeenCalled();
      expect(model.update).not.toHaveBeenCalled();
      expect(model.upsert).not.toHaveBeenCalled();
    }
  });
});
