import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '../backend/node_modules/@prisma/client/index.js';
import type { AppEnv } from '../backend/src/config/env.js';
import type { ShopifySopyoFulfillmentPlanRead } from '../backend/src/modules/shopify/shopify-admin.types.js';
import { recordVerifiedSopyoShipmentIntent } from '../backend/src/modules/vendor-integration/sopyo-shipment-intent.service.js';
import { planSopyoShopifyFulfillment } from '../backend/src/modules/vendor-integration/sopyo-shopify-fulfillment-plan.service.js';

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const describeWithPostgres = databaseUrl ? describe : describe.skip;
const location = 'gid://shopify/Location/123';
const env = { SHOPIFY_API_VERSION: '2026-01' } as AppEnv;

describeWithPostgres('Sopyo Shopify execution planning on isolated PostgreSQL', () => {
  let db: PrismaClient;
  let sequence = 0;
  const owned: Array<{ vendorId: string; orderId: string; allocationId: string }> = [];

  beforeAll(async () => {
    const target = new URL(databaseUrl!);
    if (process.env.SOPYO_SHOPIFY_PLAN_TEST_DATABASE_ISOLATED !== '1' ||
        !['localhost', '127.0.0.1'].includes(target.hostname) ||
        target.pathname.slice(1) !== 'sopyo_shopify_plan_validation') {
      throw new Error('Sopyo Shopify planning tests require isolated local sopyo_shopify_plan_validation.');
    }
    db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await db.$connect();
  });

  afterAll(async () => {
    if (!db) return;
    for (const row of owned.reverse()) {
      const intent = await db.sopyoShipmentIntent.findUnique({ where: { vendorAllocationId: row.allocationId } });
      if (intent) {
        const plan = await db.sopyoShopifyExecutionPlan.findUnique({ where: { sopyoShipmentIntentId: intent.id } });
        if (plan) {
          await db.sopyoShopifyExecutionPlanLine.deleteMany({ where: { planId: plan.id } });
          await db.sopyoShopifyExecutionPlan.delete({ where: { id: plan.id } });
        }
        await db.sopyoShipmentIntent.delete({ where: { id: intent.id } });
      }
      await db.sopyoOrderPush.deleteMany({ where: { vendorAllocationId: row.allocationId } });
      await db.vendorAllocationLineItem.deleteMany({ where: { vendorAllocationId: row.allocationId } });
      await db.vendorAllocation.delete({ where: { id: row.allocationId } });
      await db.shopifyOrderLineItem.deleteMany({ where: { shopifyOrderId: row.orderId } });
      await db.shopifyOrder.delete({ where: { id: row.orderId } });
      await db.vendor.delete({ where: { id: row.vendorId } });
    }
    await db.$disconnect();
  });

  async function fixture(quantity = 1, frozenLocation: string | null = location) {
    const token = `sopyo-plan-${process.pid}-${Date.now()}-${++sequence}`;
    const vendor = await db.vendor.create({ data: { id: token, name: 'Planning test vendor' } });
    const order = await db.shopifyOrder.create({ data: {
      sourceShopifyOrderId: String(900_000_000 + sequence), sourceShopifyOrderNumber: `#${sequence}`,
    } });
    const line = await db.shopifyOrderLineItem.create({ data: {
      shopifyOrderId: order.id, sourceLineItemId: String(800_000_000 + sequence),
      quantity, title: 'Test item',
    } });
    const allocation = await db.vendorAllocation.create({ data: {
      id: `alloc-${token}`, sourceShopifyOrderId: order.id,
      sourceShopifyOrderNumber: order.sourceShopifyOrderNumber,
      originalVendorId: vendor.id, assignedVendorId: vendor.id,
      outboundMethodSnapshot: 'VENDOR_INTEGRATION', outboundIntegrationProviderSnapshot: 'SOPYO',
      shopifyLocationGidSnapshot: frozenLocation,
    } });
    await db.vendorAllocationLineItem.create({ data: {
      vendorAllocationId: allocation.id, shopifyLineItemId: line.id, quantity,
    } });
    const push = await db.sopyoOrderPush.create({ data: {
      vendorAllocationId: allocation.id, assignedVendorId: vendor.id, orderCode: allocation.id,
      status: 'SUCCEEDED', sopyoOrderId: String(700_000_000 + sequence),
    } });
    const intent = await recordVerifiedSopyoShipmentIntent({
      allocationId: allocation.id, pushId: push.id,
      detail: { id: Number(push.sopyoOrderId), orderCode: allocation.id,
        orderType: 'SOPYOAPI', cargoCompany: 'Carrier', cargoTrackingNumber: 'TRACK-1' },
    }, db as never);
    owned.push({ vendorId: vendor.id, orderId: order.id, allocationId: allocation.id });
    const canonical = (orders: ShopifySopyoFulfillmentPlanRead['fulfillmentOrders']): ShopifySopyoFulfillmentPlanRead => ({
      orderGid: `gid://shopify/Order/${order.sourceShopifyOrderId}`,
      fulfillmentOrders: orders, source: 'shopify_admin',
    });
    const fo = (id: string, remaining: number, options: {
      location?: string; actions?: string[]; fulfillmentIds?: string[];
    } = {}): ShopifySopyoFulfillmentPlanRead['fulfillmentOrders'][number] => ({
      id: `gid://shopify/FulfillmentOrder/${id}`, status: 'OPEN', requestStatus: 'UNSUBMITTED',
      supportedActions: options.actions ?? ['CREATE_FULFILLMENT'],
      assignedLocationId: options.location ?? location,
      existingFulfillmentIds: options.fulfillmentIds ?? [],
      lineItems: [{ id: `gid://shopify/FulfillmentOrderLineItem/${id}`,
        lineItemId: `gid://shopify/LineItem/${line.sourceLineItemId}`,
        remainingQuantity: remaining, totalQuantity: quantity }],
    });
    const run = (state: ShopifySopyoFulfillmentPlanRead) => planSopyoShopifyFulfillment({
      intentId: intent.id, env,
      shopifyAdminService: { fetchFulfillmentOrdersForSopyoPlanning: vi.fn().mockResolvedValue(state) },
    }, db as never);
    return { vendor, order, line, allocation, push, intent, canonical, fo, run };
  }

  it('persists one exact plan and replays without rewriting it', async () => {
    const item = await fixture();
    const state = item.canonical([item.fo('one', 1)]);
    const first = await item.run(state);
    const replay = await item.run(state);
    expect(first.id).toBe(replay.id);
    expect(first.plannedAt).toEqual(replay.plannedAt);
    expect(first.baselineFulfillmentIds).toEqual([]);
    expect(first.lines).toMatchObject([{ fulfillmentOrderGid: 'gid://shopify/FulfillmentOrder/one',
      fulfillmentOrderLineItemGid: 'gid://shopify/FulfillmentOrderLineItem/one',
      shopifyOrderLineItemGid: `gid://shopify/LineItem/${item.line.sourceLineItemId}`, quantity: 1 }]);
    expect(await db.sopyoShopifyExecutionPlan.count({ where: { sopyoShipmentIntentId: item.intent.id } })).toBe(1);
    expect((await db.sopyoShipmentIntent.findUniqueOrThrow({ where: { id: item.intent.id } })).status).toBe('PLAN_READY');
    await expect(db.sopyoShopifyExecutionPlanLine.update({ where: { id: first.lines[0]!.id },
      data: { quantity: 2 } })).rejects.toThrow();
  });

  it('supports multiple matching fulfillment orders without collapsing their line IDs', async () => {
    const item = await fixture(2);
    const plan = await item.run(item.canonical([item.fo('one', 1), item.fo('two', 1)]));
    expect(plan.lines.map((line) => [line.fulfillmentOrderGid, line.quantity])).toEqual([
      ['gid://shopify/FulfillmentOrder/one', 1], ['gid://shopify/FulfillmentOrder/two', 1],
    ]);
  });

  it.each([
    ['different location', (item: Awaited<ReturnType<typeof fixture>>) => item.canonical([item.fo('one', 1, { location: 'gid://shopify/Location/other' })])],
    ['unsupported action', (item: Awaited<ReturnType<typeof fixture>>) => item.canonical([item.fo('one', 1, { actions: [] })])],
    ['existing ambiguous fulfillment', (item: Awaited<ReturnType<typeof fixture>>) => item.canonical([item.fo('one', 1, { fulfillmentIds: ['gid://shopify/Fulfillment/1'] })])],
    ['quantity exceeds ownership', (item: Awaited<ReturnType<typeof fixture>>) => item.canonical([item.fo('one', 2)])],
    ['partial remaining quantity', (item: Awaited<ReturnType<typeof fixture>>) => item.canonical([item.fo('one', 0)])],
  ])('fails closed for %s', async (_name, makeState) => {
    const item = await fixture();
    await expect(item.run(makeState(item))).rejects.toThrow();
    expect(await db.sopyoShopifyExecutionPlan.count({ where: { sopyoShipmentIntentId: item.intent.id } })).toBe(0);
    expect((await db.sopyoShipmentIntent.findUniqueOrThrow({ where: { id: item.intent.id } })).status).toBe('CONFLICT');
  });

  it('does not infer an executable quantity from a partially consumed Shopify line', async () => {
    const item = await fixture(2);
    await expect(item.run(item.canonical([item.fo('one', 1)]))).rejects.toThrow();
    expect(await db.sopyoShopifyExecutionPlan.count({ where: { sopyoShipmentIntentId: item.intent.id } })).toBe(0);
  });

  it('never rewrites a saved plan after canonical Shopify work changes', async () => {
    const item = await fixture();
    const first = await item.run(item.canonical([item.fo('one', 1)]));
    await expect(item.run(item.canonical([item.fo('two', 1)]))).rejects.toThrow();
    const saved = await db.sopyoShopifyExecutionPlan.findUniqueOrThrow({
      where: { id: first.id }, include: { lines: true },
    });
    expect(saved.lines[0]?.fulfillmentOrderGid).toBe('gid://shopify/FulfillmentOrder/one');
    expect((await db.sopyoShipmentIntent.findUniqueOrThrow({ where: { id: item.intent.id } })).status).toBe('CONFLICT');
  });

  it('blocks before Shopify read when frozen location or push identity changes', async () => {
    const item = await fixture();
    await db.vendorAllocation.update({ where: { id: item.allocation.id },
      data: { shopifyLocationGidSnapshot: null } });
    const read = vi.fn();
    await expect(planSopyoShopifyFulfillment({ intentId: item.intent.id, env,
      shopifyAdminService: { fetchFulfillmentOrdersForSopyoPlanning: read },
    }, db as never)).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
    await db.vendorAllocation.update({ where: { id: item.allocation.id },
      data: { shopifyLocationGidSnapshot: location } });
    await db.sopyoOrderPush.update({ where: { id: item.push.id }, data: { assignedVendorId: 'wrong' } });
    await expect(item.run(item.canonical([item.fo('one', 1)]))).rejects.toThrow();
    expect(await db.sopyoShopifyExecutionPlan.count({ where: { sopyoShipmentIntentId: item.intent.id } })).toBe(0);
  });

  it('does not read Shopify or create a plan for a cargo intent with NULL frozen location', async () => {
    const item = await fixture(1, null);
    expect(item.intent.shopifyLocationGid).toBeNull();
    const read = vi.fn();
    await expect(planSopyoShopifyFulfillment({ intentId: item.intent.id, env,
      shopifyAdminService: { fetchFulfillmentOrdersForSopyoPlanning: read },
    }, db as never)).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
    expect(await db.sopyoShopifyExecutionPlan.count({ where: { sopyoShipmentIntentId: item.intent.id } })).toBe(0);
    expect((await db.sopyoShipmentIntent.findUniqueOrThrow({ where: { id: item.intent.id } })).status)
      .toBe('CARGO_VERIFIED');
    const columns = await db.$queryRaw<Array<{ is_nullable: string }>>`
      SELECT is_nullable FROM information_schema.columns
      WHERE table_name = 'SopyoShopifyExecutionPlan' AND column_name = 'shopifyLocationGid'
    `;
    expect(columns).toEqual([{ is_nullable: 'NO' }]);
  });

  it('rejects another allocation sharing the same Shopify order line', async () => {
    const item = await fixture();
    const other = await db.vendorAllocation.create({ data: {
      id: `${item.allocation.id}-other`, sourceShopifyOrderId: item.order.id,
      sourceShopifyOrderNumber: item.order.sourceShopifyOrderNumber,
      originalVendorId: item.vendor.id, assignedVendorId: item.vendor.id,
    } });
    await db.vendorAllocationLineItem.create({ data: {
      vendorAllocationId: other.id, shopifyLineItemId: item.line.id, quantity: 1,
    } });
    await expect(item.run(item.canonical([item.fo('one', 1)]))).rejects.toThrow();
    await db.vendorAllocationLineItem.deleteMany({ where: { vendorAllocationId: other.id } });
    await db.vendorAllocation.delete({ where: { id: other.id } });
  });

  it('treats incomplete canonical read as conflict without any external write', async () => {
    const item = await fixture();
    await expect(planSopyoShopifyFulfillment({ intentId: item.intent.id, env,
      shopifyAdminService: { fetchFulfillmentOrdersForSopyoPlanning: vi.fn().mockRejectedValue(new Error('truncated')) },
    }, db as never)).rejects.toThrow();
    expect(await db.sopyoShopifyExecutionPlan.count({ where: { sopyoShipmentIntentId: item.intent.id } })).toBe(0);
    expect((await db.sopyoShipmentIntent.findUniqueOrThrow({ where: { id: item.intent.id } })).conflictReasonCode).toBe('SHOPIFY_READ_INCOMPLETE');
  });

  it('leaves allocation, fulfillment, delivered observation, finance and Kargonomi untouched', async () => {
    const item = await fixture();
    const before = await Promise.all([db.fulfillment.count(), db.allocationDeliveredObservation.count(),
      db.financeLedgerEntry.count(), db.shipmentExecution.count(), db.shipmentShippingCost.count()]);
    const allocation = await db.vendorAllocation.findUniqueOrThrow({ where: { id: item.allocation.id } });
    await item.run(item.canonical([item.fo('one', 1)]));
    expect(await Promise.all([db.fulfillment.count(), db.allocationDeliveredObservation.count(),
      db.financeLedgerEntry.count(), db.shipmentExecution.count(), db.shipmentShippingCost.count()])).toEqual(before);
    const after = await db.vendorAllocation.findUniqueOrThrow({ where: { id: item.allocation.id } });
    expect([after.carrier, after.trackingNumber, after.shippingStatus, after.fulfillmentStatus]).toEqual(
      [allocation.carrier, allocation.trackingNumber, allocation.shippingStatus, allocation.fulfillmentStatus]);
  });
});
