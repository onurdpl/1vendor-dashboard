import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '../backend/node_modules/@prisma/client/index.js';
import type { AppEnv } from '../backend/src/config/env.js';
import { recordVerifiedDeliveredObservation }
  from '../backend/src/modules/shipping/allocation-delivered-observation.service.js';
import { processSopyoShopifyDeliveredSync }
  from '../backend/src/modules/vendor-integration/sopyo-shopify-delivered-sync.service.js';
import { preserveCurrentSopyoDelivered }
  from '../backend/src/modules/shopify/sopyo-delivered-projection.service.js';

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const describeWithPostgres = databaseUrl ? describe : describe.skip;
const env = { SHOPIFY_API_VERSION: '2026-01', SHOPIFY_SHOP_DOMAIN: 'example.myshopify.com',
  SHOPIFY_ADMIN_ACCESS_TOKEN: 'test-token' } as AppEnv;

describeWithPostgres('Sopyo Shopify Delivered sync on isolated PostgreSQL', () => {
  let db: PrismaClient;

  beforeAll(async () => {
    const target = new URL(databaseUrl!);
    if (process.env.SOPYO_DELIVERED_SYNC_TEST_DATABASE_ISOLATED !== '1' ||
        !['localhost', '127.0.0.1'].includes(target.hostname) ||
        target.pathname.slice(1) !== 'sopyo_delivered_sync_validation') {
      throw new Error('Sopyo Delivered sync test requires isolated local sopyo_delivered_sync_validation.');
    }
    db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await db.$connect();
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it('discovers a pre-existing delivered row and fences two workers to one event attempt', async () => {
    const token = `delivered-sync-${process.pid}-${Date.now()}`;
    const numericId = String(Date.now());
    const vendor = await db.vendor.create({ data: { id: token, name: 'Delivered sync test' } });
    const order = await db.shopifyOrder.create({ data: {
      sourceShopifyOrderId: numericId, sourceShopifyOrderNumber: `#${token}`,
    } });
    const allocation = await db.vendorAllocation.create({ data: {
      id: `alloc-${token}`, sourceShopifyOrderId: order.id,
      sourceShopifyOrderNumber: order.sourceShopifyOrderNumber,
      originalVendorId: vendor.id, assignedVendorId: vendor.id,
      outboundMethodSnapshot: 'VENDOR_INTEGRATION', outboundIntegrationProviderSnapshot: 'SOPYO',
      shippingStatus: 'delivered',
    } });
    const push = await db.sopyoOrderPush.create({ data: {
      vendorAllocationId: allocation.id, assignedVendorId: vendor.id,
      orderCode: allocation.id, status: 'SUCCEEDED', sopyoOrderId: '456001',
    } });
    await db.sopyoShipmentIntent.create({ data: {
      vendorAllocationId: allocation.id, sopyoOrderPushId: push.id,
      assignedVendorId: vendor.id, sopyoOrderId: push.sopyoOrderId!,
      orderCode: allocation.id, carrier: 'Carrier', trackingNumber: 'TRACK',
      status: 'CONFIRMED', submissionStartedAt: new Date(), confirmedAt: new Date(),
      shopifyFulfillmentId: `gid://shopify/Fulfillment/${numericId}`,
    } });
    const observation = await recordVerifiedDeliveredObservation({ allocationId: allocation.id,
      source: { method: 'VENDOR_INTEGRATION', providerCode: 'SOPYO',
        pushId: push.id, sourceReference: push.sopyoOrderId! } }, db as never);
    const intent = await db.sopyoShipmentIntent.findUniqueOrThrow({ where: { vendorAllocationId: allocation.id } });
    const read = vi.fn().mockResolvedValue({ delivered: false });
    const create = vi.fn().mockResolvedValue({ outcome: 'unknown' });
    const run = () => processSopyoShopifyDeliveredSync({ intentId: intent.id, env,
      shopifyAdminService: { readSopyoFulfillmentDelivered: read,
        createSopyoDeliveredEvent: create } }, db as never);
    await Promise.all([run(), run()]);
    expect(create).toHaveBeenCalledTimes(1);
    const saved = await db.sopyoShipmentIntent.findUniqueOrThrow({ where: { id: intent.id } });
    expect(saved.deliveredSyncStatus).toBe('OUTCOME_UNKNOWN');
    expect(saved.deliveredSubmissionStartedAt).not.toBeNull();
    expect(await run()).toBe('outcome_unknown');
    expect(create).toHaveBeenCalledTimes(1);
    expect(await db.allocationDeliveredObservation.findUniqueOrThrow({
      where: { vendorAllocationId: allocation.id },
    })).toMatchObject({ id: observation.id, firstObservedDeliveredAt: observation.firstObservedDeliveredAt });
    expect((await db.vendorAllocation.findUniqueOrThrow({ where: { id: allocation.id } })).shippingStatus)
      .toBe('delivered');
    expect(await db.$transaction((tx) => preserveCurrentSopyoDelivered(tx, allocation.id, 'in_transit')))
      .toBe(true);
  });
});
