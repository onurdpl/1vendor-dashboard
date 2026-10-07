import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '../backend/node_modules/@prisma/client/index.js';
import type { AppEnv } from '../backend/src/config/env.js';
import type { ShopifySopyoFulfillmentEvidence, ShopifySopyoFulfillmentPlanRead }
  from '../backend/src/modules/shopify/shopify-admin.types.js';
import { recordVerifiedSopyoShipmentIntent }
  from '../backend/src/modules/vendor-integration/sopyo-shipment-intent.service.js';
import { planSopyoShopifyFulfillment }
  from '../backend/src/modules/vendor-integration/sopyo-shopify-fulfillment-plan.service.js';
import { executeSopyoShopifyFulfillment }
  from '../backend/src/modules/vendor-integration/sopyo-shopify-fulfillment-execution.service.js';
import { processSopyoShopifySync }
  from '../backend/src/modules/vendor-integration/sopyo-shopify-fulfillment-worker.service.js';
import { createFulfillmentService } from '../backend/src/modules/fulfillments/fulfillment.service.js';

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const describeWithPostgres = databaseUrl ? describe : describe.skip;
const location = 'gid://shopify/Location/123';
const env = { SHOPIFY_API_VERSION: '2026-01', SHOPIFY_SHOP_DOMAIN: 'example.myshopify.com',
  SHOPIFY_ADMIN_ACCESS_TOKEN: 'test-token' } as AppEnv;

describeWithPostgres('Sopyo Shopify fulfillment execution on isolated PostgreSQL', () => {
  let db: PrismaClient;
  let sequence = 0;
  const owned: Array<{ vendorId: string; orderId: string; allocationId: string }> = [];

  beforeAll(async () => {
    const target = new URL(databaseUrl!);
    if (process.env.SOPYO_SHOPIFY_EXECUTION_TEST_DATABASE_ISOLATED !== '1' ||
        !['localhost', '127.0.0.1'].includes(target.hostname) ||
        target.pathname.slice(1) !== 'sopyo_shopify_execution_validation') {
      throw new Error('Sopyo Shopify execution tests require isolated local sopyo_shopify_execution_validation.');
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
      await db.fulfillment.deleteMany({ where: { vendorAllocationId: row.allocationId } });
      await db.vendorAllocationLineItem.deleteMany({ where: { vendorAllocationId: row.allocationId } });
      await db.vendorAllocation.delete({ where: { id: row.allocationId } });
      await db.shopifyOrderLineItem.deleteMany({ where: { shopifyOrderId: row.orderId } });
      await db.shopifyOrder.delete({ where: { id: row.orderId } });
      await db.vendor.delete({ where: { id: row.vendorId } });
    }
    await db.$disconnect();
  });

  async function fixture(quantity = 1, multi = false) {
    const n = ++sequence;
    const token = `sopyo-exec-${process.pid}-${Date.now()}-${n}`;
    const vendor = await db.vendor.create({ data: { id: token, name: 'Execution test vendor' } });
    const order = await db.shopifyOrder.create({ data: {
      sourceShopifyOrderId: String(910_000_000 + n), sourceShopifyOrderNumber: `#${n}`,
    } });
    const line = await db.shopifyOrderLineItem.create({ data: {
      shopifyOrderId: order.id, sourceLineItemId: String(810_000_000 + n), quantity, title: 'Test item',
    } });
    const allocation = await db.vendorAllocation.create({ data: {
      id: `alloc-${token}`, sourceShopifyOrderId: order.id,
      sourceShopifyOrderNumber: order.sourceShopifyOrderNumber,
      originalVendorId: vendor.id, assignedVendorId: vendor.id,
      outboundMethodSnapshot: 'VENDOR_INTEGRATION', outboundIntegrationProviderSnapshot: 'SOPYO',
      shopifyLocationGidSnapshot: location,
    } });
    await db.vendorAllocationLineItem.create({ data: {
      vendorAllocationId: allocation.id, shopifyLineItemId: line.id, quantity,
    } });
    const push = await db.sopyoOrderPush.create({ data: {
      vendorAllocationId: allocation.id, assignedVendorId: vendor.id, orderCode: allocation.id,
      status: 'SUCCEEDED', sopyoOrderId: String(710_000_000 + n),
    } });
    const intent = await recordVerifiedSopyoShipmentIntent({
      allocationId: allocation.id, pushId: push.id,
      detail: { id: Number(push.sopyoOrderId), orderCode: allocation.id,
        orderType: 'SOPYOAPI', cargoCompany: 'Carrier', cargoTrackingNumber: 'TRACK-1' },
    }, db as never);
    owned.push({ vendorId: vendor.id, orderId: order.id, allocationId: allocation.id });
    const canonical: ShopifySopyoFulfillmentPlanRead = {
      orderGid: `gid://shopify/Order/${order.sourceShopifyOrderId}`, source: 'shopify_admin',
      fulfillmentOrders: (multi ? ['one', 'two'] : ['one']).map((part) => ({
        id: `gid://shopify/FulfillmentOrder/${n}-${part}`,
        status: 'OPEN', requestStatus: 'UNSUBMITTED', supportedActions: ['CREATE_FULFILLMENT'],
        assignedLocationId: location, existingFulfillmentIds: [],
        lineItems: [{ id: `gid://shopify/FulfillmentOrderLineItem/${n}-${part}`,
          lineItemId: `gid://shopify/LineItem/${line.sourceLineItemId}`,
          remainingQuantity: multi ? 1 : quantity, totalQuantity: quantity }],
      })),
    };
    const plan = await planSopyoShopifyFulfillment({ intentId: intent.id, env,
      shopifyAdminService: { fetchFulfillmentOrdersForSopyoPlanning: vi.fn().mockResolvedValue(canonical) },
    }, db as never);
    const evidence: ShopifySopyoFulfillmentEvidence = {
      id: `gid://shopify/Fulfillment/${n}`,
      orderGid: canonical.orderGid, locationGid: location, status: 'SUCCESS',
      fulfillmentOrderGids: canonical.fulfillmentOrders.map((fo) => fo.id),
      lines: [{ shopifyOrderLineItemGid: `gid://shopify/LineItem/${line.sourceLineItemId}`, quantity }],
      tracking: [{ company: 'Carrier', number: 'TRACK-1' }],
    };
    const create = vi.fn().mockResolvedValue({ outcome: 'success', fulfillment: evidence });
    const lookup = vi.fn().mockResolvedValue([evidence]);
    const port = { fetchFulfillmentOrdersForSopyoPlanning: vi.fn().mockResolvedValue(canonical),
      createSopyoFulfillment: create, fetchSopyoFulfillmentsForReconciliation: lookup };
    const run = () => executeSopyoShopifyFulfillment({ intentId: intent.id, env,
      shopifyAdminService: port }, db as never);
    const manualCreate = vi.fn().mockResolvedValue({ fulfillmentId: `gid://shopify/Fulfillment/manual-${n}`,
      status: 'submitted', source: 'shopify_admin', fulfillmentCreated: true, skippedReason: null,
      fulfillmentOrderIdPresent: true, fulfillmentIdPresent: true });
    const manualPort = { fetchFulfillmentOrders: vi.fn().mockResolvedValue({
      fulfillmentOrders: canonical.fulfillmentOrders.map((fo) => ({ id: fo.id, status: fo.status,
        lineItems: fo.lineItems.map((item) => ({ id: item.id, lineItemId: item.lineItemId,
          quantity: item.remainingQuantity })) })),
    }), createFulfillmentTracking: manualCreate };
    const manual = () => createFulfillmentService(env, { db: db as never,
      shopifyAdminService: manualPort as never }).updateAllocationTracking({
      allocationId: allocation.id, body: { carrier: 'Carrier', trackingNumber: 'TRACK-1' },
      authUser: { id: vendor.id, email: 'test@example.invalid', role: 'vendor' },
      vendorContext: { vendorId: vendor.id, role: 'vendor', allowedVendorIds: [vendor.id] },
    });
    return { vendor, order, line, allocation, push, intent, plan, canonical, evidence, create, lookup, port, run,
      manual, manualCreate, manualPort };
  }

  it('Sopyo-first claim excludes the manual path even before Shopify responds', async () => {
    const item = await fixture();
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    item.create.mockImplementation(async () => { await held; return { outcome: 'success', fulfillment: item.evidence }; });
    const sopyo = item.run();
    try {
      await vi.waitFor(() => expect(item.create).toHaveBeenCalledTimes(1));
      const manual = await item.manual();
      expect(manual).toMatchObject({ ok: false, code: 409 });
      expect(item.manualCreate).not.toHaveBeenCalled();
      expect(await db.fulfillment.findUnique({ where: { vendorAllocationId: item.allocation.id } })).toBeNull();
    } finally { release(); await sopyo; }
  });

  it('manual-first claim excludes Sopyo before a second Shopify create', async () => {
    const item = await fixture();
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    item.manualCreate.mockImplementation(async () => { await held; return {
      fulfillmentId: 'gid://shopify/Fulfillment/manual', status: 'submitted', source: 'shopify_admin',
      fulfillmentCreated: true, skippedReason: null, fulfillmentOrderIdPresent: true,
      fulfillmentIdPresent: true,
    }; });
    const manual = item.manual();
    try {
      await vi.waitFor(() => expect(item.manualCreate).toHaveBeenCalledTimes(1));
      await expect(item.run()).rejects.toThrow();
      expect(item.create).not.toHaveBeenCalled();
      expect((await db.fulfillment.findUniqueOrThrow({ where: { vendorAllocationId: item.allocation.id } }))
        .syncStatus).toBe('fulfillment_submission_pending');
    } finally { release(); await manual; }
  });

  it('concurrent real PostgreSQL claim transactions allow at most one external create path', async () => {
    const item = await fixture();
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    item.create.mockImplementation(async () => { await held; return { outcome: 'success', fulfillment: item.evidence }; });
    item.manualCreate.mockImplementation(async () => { await held; return {
      fulfillmentId: 'gid://shopify/Fulfillment/manual', status: 'submitted', source: 'shopify_admin',
      fulfillmentCreated: true, skippedReason: null, fulfillmentOrderIdPresent: true,
      fulfillmentIdPresent: true,
    }; });
    const sopyo = item.run().catch((error: unknown) => error);
    const manual = item.manual().catch((error: unknown) => error);
    try {
      await vi.waitFor(() => expect(item.create.mock.calls.length + item.manualCreate.mock.calls.length).toBe(1));
    } finally { release(); }
    const [sopyoOutcome, manualOutcome] = await Promise.all([sopyo, manual]);
    expect(item.create.mock.calls.length + item.manualCreate.mock.calls.length).toBe(1);
    if (item.create.mock.calls.length === 1) {
      expect(sopyoOutcome).toMatchObject({ status: 'CONFIRMED' });
      expect(manualOutcome).toMatchObject({ ok: false, code: 409 });
    } else {
      expect(manualOutcome).toMatchObject({ ok: true });
      expect(sopyoOutcome).toBeInstanceOf(Error);
    }
  });

  it('a normal non-Sopyo allocation without intent still uses the manual path', async () => {
    const item = await fixture();
    await db.sopyoShopifyExecutionPlanLine.deleteMany({ where: { planId: item.plan.id } });
    await db.sopyoShopifyExecutionPlan.delete({ where: { id: item.plan.id } });
    await db.sopyoShipmentIntent.delete({ where: { id: item.intent.id } });
    await db.sopyoOrderPush.delete({ where: { id: item.push.id } });
    await db.vendorAllocation.update({ where: { id: item.allocation.id }, data: {
      outboundMethodSnapshot: 'KARGONOMI', outboundIntegrationProviderSnapshot: null,
    } });
    expect((await item.manual()).ok).toBe(true);
    expect(item.manualCreate).toHaveBeenCalledTimes(1);
  });

  it('submits exact persisted FO-line IDs and quantities once, including multiple FOs, then replays', async () => {
    const item = await fixture(2, true);
    const before = await Promise.all([db.fulfillment.count(), db.allocationDeliveredObservation.count(),
      db.financeLedgerEntry.count(), db.shipmentExecution.count(), db.shipmentShippingCost.count(),
      db.vendorIntegrationShipmentEvent.count()]);
    const first = await item.run();
    expect(first.status).toBe('CONFIRMED');
    expect(first.shopifyFulfillmentId).toBe(item.evidence.id);
    expect(first.submissionStartedAt).toBeTruthy();
    expect(first.confirmedAt).toBeTruthy();
    expect(item.create).toHaveBeenCalledTimes(1);
    expect(item.create.mock.calls[0]![0].lineItemsByFulfillmentOrder).toEqual(
      item.plan.lines.map((line) => ({ fulfillmentOrderId: line.fulfillmentOrderGid,
        fulfillmentOrderLineItems: [{ id: line.fulfillmentOrderLineItemGid, quantity: line.quantity }] })));
    const replay = await item.run();
    expect(replay.shopifyFulfillmentId).toBe(first.shopifyFulfillmentId);
    expect(item.create).toHaveBeenCalledTimes(1);
    expect(await Promise.all([db.fulfillment.count(), db.allocationDeliveredObservation.count(),
      db.financeLedgerEntry.count(), db.shipmentExecution.count(), db.shipmentShippingCost.count(),
      db.vendorIntegrationShipmentEvent.count()])).toEqual(before);
    const allocation = await db.vendorAllocation.findUniqueOrThrow({ where: { id: item.allocation.id } });
    expect([allocation.carrier, allocation.trackingNumber, allocation.shippingStatus]).toEqual([null, null, 'Awaiting Shipment']);
  });

  it.each(['rejected', 'unknown'] as const)('%s response never retries create', async (outcome) => {
    const item = await fixture();
    item.create.mockResolvedValue({ outcome });
    const first = await item.run();
    expect(first.status).toBe(outcome === 'rejected' ? 'CONFLICT' : 'OUTCOME_UNKNOWN');
    if (outcome === 'unknown') item.lookup.mockResolvedValue([]);
    const replay = await item.run();
    expect(replay.status).toBe(first.status);
    expect(item.create).toHaveBeenCalledTimes(1);
  });

  it('treats a transport throw as unknown and only reconciles on replay', async () => {
    const item = await fixture();
    item.create.mockRejectedValue(new Error('timeout'));
    expect((await item.run()).status).toBe('OUTCOME_UNKNOWN');
    expect((await item.run()).status).toBe('CONFIRMED');
    expect(item.create).toHaveBeenCalledTimes(1);
    expect(item.lookup).toHaveBeenCalledTimes(1);
  });

  it('cannot confirm a malformed success result without canonical reconciliation', async () => {
    const item = await fixture();
    item.create.mockResolvedValue({ outcome: 'success', fulfillment: { ...item.evidence, locationGid: 'wrong' } });
    expect((await item.run()).status).toBe('OUTCOME_UNKNOWN');
    expect((await item.run()).status).toBe('CONFIRMED');
    expect(item.create).toHaveBeenCalledTimes(1);
  });

  it('fails closed on conflicting external fulfillment evidence', async () => {
    const item = await fixture();
    item.create.mockResolvedValue({ outcome: 'unknown' });
    await item.run();
    item.lookup.mockResolvedValue([{ ...item.evidence, tracking: [{ company: 'Other', number: 'OTHER' }] }]);
    expect((await item.run()).status).toBe('CONFLICT');
    expect(item.create).toHaveBeenCalledTimes(1);
  });

  it('fails closed when canonical reconciliation has multiple matching candidates', async () => {
    const item = await fixture();
    item.create.mockResolvedValue({ outcome: 'unknown' });
    await item.run();
    item.lookup.mockResolvedValue([item.evidence,
      { ...item.evidence, id: 'gid://shopify/Fulfillment/another' }]);
    expect((await item.run()).status).toBe('CONFLICT');
    expect(item.create).toHaveBeenCalledTimes(1);
  });

  it('does not treat an empty canonical read as proof create was absent', async () => {
    const item = await fixture();
    item.create.mockResolvedValue({ outcome: 'unknown' });
    await item.run();
    item.lookup.mockResolvedValue([]);
    expect((await item.run()).status).toBe('OUTCOME_UNKNOWN');
    expect(item.create).toHaveBeenCalledTimes(1);
  });

  it('at most one concurrent caller can initiate the local mutation', async () => {
    const item = await fixture();
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    item.create.mockImplementation(async () => { await held; return { outcome: 'success', fulfillment: item.evidence }; });
    const first = item.run();
    await vi.waitFor(() => expect(item.create).toHaveBeenCalledTimes(1));
    item.lookup.mockResolvedValue([]);
    const second = await item.run();
    expect(['SUBMISSION_PENDING', 'OUTCOME_UNKNOWN']).toContain(second.status);
    release();
    await first;
    expect(item.create).toHaveBeenCalledTimes(1);
  });

  it('automatically routes persisted PLAN_READY then OUTCOME_UNKNOWN through one create and canonical reconciliation', async () => {
    const item = await fixture();
    await db.vendorAllocation.update({ where: { id: item.allocation.id }, data: {
      carrier: 'Carrier', trackingNumber: 'TRACK-1', shippingStatus: 'In Transit',
    } });
    const before = await Promise.all([db.allocationDeliveredObservation.count(),
      db.financeLedgerEntry.count(), db.vendorIntegrationShipmentEvent.count(),
      db.shipmentExecution.count(), db.shipmentShippingCost.count()]);
    item.create.mockResolvedValueOnce({ outcome: 'unknown' });
    item.lookup.mockResolvedValueOnce([]).mockResolvedValueOnce([item.evidence]);
    const runWorker = () => processSopyoShopifySync({ env, dependencies: {
      db: { sopyoShipmentIntent: { findMany: (args: never) => db.sopyoShipmentIntent.findMany({
        ...args, where: { AND: [(args as { where: object }).where, { id: item.intent.id }] },
      }) } } as never,
      plan: vi.fn(),
      execute: ({ intentId, env: runtimeEnv }) => executeSopyoShopifyFulfillment({
        intentId, env: runtimeEnv, shopifyAdminService: item.port,
      }, db as never),
    } as never });
    const first = await runWorker();
    expect(first).toMatchObject({ executed: 1, confirmed: 0, failed: 0 });
    expect((await db.sopyoShipmentIntent.findUniqueOrThrow({ where: { id: item.intent.id } })).status)
      .toBe('OUTCOME_UNKNOWN');
    const second = await runWorker();
    expect(second).toMatchObject({ reconciled: 1, confirmed: 0, failed: 0 });
    const third = await runWorker();
    expect(third).toMatchObject({ reconciled: 1, confirmed: 1, failed: 0 });
    expect((await db.sopyoShipmentIntent.findUniqueOrThrow({ where: { id: item.intent.id } })).shopifyFulfillmentId)
      .toBe(item.evidence.id);
    expect(item.create).toHaveBeenCalledTimes(1);
    expect(await Promise.all([db.allocationDeliveredObservation.count(),
      db.financeLedgerEntry.count(), db.vendorIntegrationShipmentEvent.count(),
      db.shipmentExecution.count(), db.shipmentShippingCost.count()])).toEqual(before);
    const allocation = await db.vendorAllocation.findUniqueOrThrow({ where: { id: item.allocation.id } });
    expect([allocation.carrier, allocation.trackingNumber, allocation.shippingStatus])
      .toEqual(['Carrier', 'TRACK-1', 'In Transit']);
  });

  it('overlapping orchestration cycles share the durable executor fence', async () => {
    const item = await fixture();
    await db.vendorAllocation.update({ where: { id: item.allocation.id }, data: {
      carrier: 'Carrier', trackingNumber: 'TRACK-1', shippingStatus: 'In Transit',
    } });
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    item.create.mockImplementation(async () => {
      await held;
      return { outcome: 'success', fulfillment: item.evidence };
    });
    item.lookup.mockResolvedValue([]);
    const runWorker = () => processSopyoShopifySync({ env, dependencies: {
      db: { sopyoShipmentIntent: { findMany: (args: never) => db.sopyoShipmentIntent.findMany({
        ...args, where: { AND: [(args as { where: object }).where, { id: item.intent.id }] },
      }) } } as never,
      plan: vi.fn(),
      execute: ({ intentId, env: runtimeEnv }) => executeSopyoShopifyFulfillment({
        intentId, env: runtimeEnv, shopifyAdminService: item.port,
      }, db as never),
    } as never });
    const first = runWorker();
    await vi.waitFor(() => expect(item.create).toHaveBeenCalledTimes(1));
    await runWorker();
    release();
    await first;
    expect(item.create).toHaveBeenCalledTimes(1);
    expect((await db.sopyoShipmentIntent.findUniqueOrThrow({ where: { id: item.intent.id } })).status)
      .toBe('CONFIRMED');
  });

  it('prevents mutation after vendor or frozen-location change', async () => {
    const item = await fixture();
    await db.vendorAllocation.update({ where: { id: item.allocation.id },
      data: { shopifyLocationGidSnapshot: null } });
    await expect(item.run()).rejects.toThrow();
    expect(item.create).not.toHaveBeenCalled();
  });

  it('prevents mutation after assigned-vendor change', async () => {
    const item = await fixture();
    const other = await db.vendor.create({ data: {
      id: `${item.vendor.id}-other`, name: 'Another vendor',
    } });
    try {
      await db.vendorAllocation.update({ where: { id: item.allocation.id },
        data: { assignedVendorId: other.id } });
      await expect(item.run()).rejects.toThrow();
      expect(item.create).not.toHaveBeenCalled();
    } finally {
      await db.vendorAllocation.update({ where: { id: item.allocation.id },
        data: { assignedVendorId: item.vendor.id } });
      await db.vendor.delete({ where: { id: other.id } });
    }
  });

  it('does not submit when a manual path already holds a local fulfillment identity', async () => {
    const item = await fixture();
    await db.fulfillment.create({ data: {
      vendorAllocationId: item.allocation.id, fulfillmentStatus: 'fulfilled',
      shopifyFulfillmentId: 'gid://shopify/Fulfillment/manual',
    } });
    try {
      await expect(item.run()).rejects.toThrow();
      expect(item.create).not.toHaveBeenCalled();
    } finally {
      await db.fulfillment.delete({ where: { vendorAllocationId: item.allocation.id } });
    }
  });

  it('prevents mutation when allocation becomes non-actionable', async () => {
    const item = await fixture();
    await db.vendorAllocation.update({ where: { id: item.allocation.id },
      data: { allocationStatus: 'VENDOR_BLOCKED' } });
    await expect(item.run()).rejects.toThrow();
    expect(item.create).not.toHaveBeenCalled();
  });

  it('does not submit after the intent enters CONFLICT', async () => {
    const item = await fixture();
    await db.sopyoShipmentIntent.update({ where: { id: item.intent.id },
      data: { status: 'CONFLICT', conflictReasonCode: 'CARGO_MISMATCH', conflictObservedAt: new Date() } });
    expect((await item.run()).status).toBe('CONFLICT');
    expect(item.create).not.toHaveBeenCalled();
  });

  it('retains proven Shopify identity without clearing an in-flight cargo conflict', async () => {
    const item = await fixture();
    item.create.mockImplementation(async () => {
      await db.sopyoShipmentIntent.update({ where: { id: item.intent.id },
        data: { status: 'CONFLICT', conflictReasonCode: 'CARGO_MISMATCH', conflictObservedAt: new Date() } });
      return { outcome: 'success', fulfillment: item.evidence };
    });
    const result = await item.run();
    expect(result.status).toBe('CONFLICT');
    expect(result.conflictReasonCode).toBe('CARGO_MISMATCH');
    expect(result.shopifyFulfillmentId).toBe(item.evidence.id);
    expect(item.create).toHaveBeenCalledTimes(1);
  });

  it('reconciles a cargo-conflicted in-flight submission without clearing the conflict', async () => {
    const item = await fixture();
    item.create.mockImplementation(async () => {
      await db.sopyoShipmentIntent.update({ where: { id: item.intent.id },
        data: { status: 'CONFLICT', conflictReasonCode: 'CARGO_MISMATCH', conflictObservedAt: new Date() } });
      return { outcome: 'unknown' };
    });
    expect((await item.run()).status).toBe('CONFLICT');
    const result = await item.run();
    expect(result.status).toBe('CONFLICT');
    expect(result.shopifyFulfillmentId).toBe(item.evidence.id);
    expect(item.create).toHaveBeenCalledTimes(1);
  });

  it('does not mutate when canonical FO selection changed after planning', async () => {
    const item = await fixture();
    item.port.fetchFulfillmentOrdersForSopyoPlanning.mockResolvedValue({ ...item.canonical,
      fulfillmentOrders: item.canonical.fulfillmentOrders.map((fo) => ({ ...fo,
        lineItems: fo.lineItems.map((line) => ({ ...line, remainingQuantity: 0 })) })) });
    await expect(item.run()).rejects.toThrow();
    expect(item.create).not.toHaveBeenCalled();
    expect((await db.sopyoShipmentIntent.findUniqueOrThrow({ where: { id: item.intent.id } })).status).toBe('CONFLICT');
  });
});
