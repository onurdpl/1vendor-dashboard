import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '../backend/node_modules/@prisma/client/index.js';

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const describeWithPostgres = databaseUrl ? describe : describe.skip;

describeWithPostgres('FIN-BUG-003 Phase 2 allocation outbound snapshot on isolated PostgreSQL', () => {
  let db: PrismaClient;
  let save: typeof import('../backend/src/modules/shipping/shipping-execution.service.js')['upsertVendorShippingConfig'];
  let read: typeof import('../backend/src/modules/shipping/shipping-execution.service.js')['getVendorShippingConfig'];
  let resolve: typeof import('../backend/src/modules/orders/allocation-outbound-snapshot.service.js')['resolveAllocationOutboundSnapshot'];
  let vendorId: string;
  let orderId: string;

  beforeEach(async () => {
    const target = new URL(databaseUrl!);
    if (process.env.FIN_BUG_003_PHASE2_TEST_DATABASE_ISOLATED !== '1' ||
        !['127.0.0.1', 'localhost'].includes(target.hostname) ||
        target.pathname.slice(1) !== 'fin_bug_003_phase2_validation') {
      throw new Error('FIN-BUG-003 Phase 2 test requires isolated local fin_bug_003_phase2_validation.');
    }
    process.env.DATABASE_URL = databaseUrl;
    ({ upsertVendorShippingConfig: save } = await import('../backend/src/modules/shipping/shipping-execution.service.js'));
    ({ getVendorShippingConfig: read } = await import('../backend/src/modules/shipping/shipping-execution.service.js'));
    ({ resolveAllocationOutboundSnapshot: resolve } = await import('../backend/src/modules/orders/allocation-outbound-snapshot.service.js'));
    db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await db.$connect();
    vendorId = `snapshot-${process.pid}-${Date.now()}`;
    const order = await db.shopifyOrder.create({ data: {
      sourceShopifyOrderId: vendorId,
      sourceShopifyOrderNumber: `#${vendorId}`,
    } });
    orderId = order.id;
    await db.vendor.create({ data: { id: vendorId, name: 'Allocation Snapshot Test Vendor', status: 'inactive' } });
  });

  afterEach(async () => {
    if (!db) return;
    await db.vendorIntegrationClient.deleteMany({ where: { vendorIdentifier: vendorId } });
    await db.shopifyOrder.delete({ where: { id: orderId } });
    await db.vendor.delete({ where: { id: vendorId } });
    await db.$disconnect();
  });

  async function createAllocation(id: string) {
    return db.$transaction(async (tx) => tx.vendorAllocation.create({ data: {
      id,
      sourceShopifyOrderId: orderId,
      sourceShopifyOrderNumber: `#${vendorId}`,
      originalVendorId: vendorId,
      assignedVendorId: vendorId,
      ...await resolve(tx, vendorId),
    } }));
  }

  it('freezes the explicit provider on A, preserves it through config change/replay, and snapshots new config on B', async () => {
    await save(vendorId, { outboundMethod: 'VENDOR_INTEGRATION', selectedIntegrationProvider: 'SOPYO' });
    const first = await createAllocation(`${vendorId}-a`);
    expect(first).toMatchObject({
      outboundMethodSnapshot: 'VENDOR_INTEGRATION', outboundIntegrationProviderSnapshot: 'SOPYO',
    });

    await save(vendorId, { outboundMethod: 'KARGONOMI' });
    await db.vendorAllocation.upsert({
      where: { id: first.id },
      create: { id: first.id, sourceShopifyOrderId: orderId, sourceShopifyOrderNumber: 'unreachable',
        originalVendorId: vendorId, assignedVendorId: vendorId, ...await resolve(db, vendorId) },
      update: { sourceShopifyOrderNumber: `#${vendorId}-replayed` },
    });
    expect(await db.vendorAllocation.findUniqueOrThrow({ where: { id: first.id } })).toMatchObject({
      outboundMethodSnapshot: 'VENDOR_INTEGRATION', outboundIntegrationProviderSnapshot: 'SOPYO',
    });
    const second = await createAllocation(`${vendorId}-b`);
    expect(second).toMatchObject({ outboundMethodSnapshot: 'KARGONOMI', outboundIntegrationProviderSnapshot: null });
  });

  it('preserves existing unconfigured order creation behavior without inferring a source', async () => {
    const allocation = await createAllocation(`${vendorId}-unconfigured`);
    expect(allocation).toMatchObject({ outboundMethodSnapshot: null, outboundIntegrationProviderSnapshot: null,
      shopifyLocationGidSnapshot: null });
  });

  it('saves, reads, clears and validates current location without changing older snapshots', async () => {
    const locationA = 'gid://shopify/Location/101';
    const locationB = 'gid://shopify/Location/202';
    expect((await read(vendorId)).shopifyLocationGid).toBeNull();
    const historical = await createAllocation(`${vendorId}-historical-null`);
    expect(historical.shopifyLocationGidSnapshot).toBeNull();
    expect((await save(vendorId, { shopifyLocationGid: `  ${locationA}  ` })).shopifyLocationGid).toBe(locationA);
    expect((await read(vendorId)).shopifyLocationGid).toBe(locationA);
    await db.vendorAllocation.update({ where: { id: historical.id }, data: { sourceShopifyOrderNumber: `#${vendorId}-repaired` } });
    expect((await db.vendorAllocation.findUniqueOrThrow({ where: { id: historical.id } })).shopifyLocationGidSnapshot).toBeNull();
    const old = await createAllocation(`${vendorId}-location-a`);
    expect(old.shopifyLocationGidSnapshot).toBe(locationA);
    await save(vendorId, { shopifyLocationGid: locationB });
    await db.vendorAllocation.upsert({ where: { id: old.id },
      create: { id: old.id, sourceShopifyOrderId: orderId, sourceShopifyOrderNumber: 'unreachable',
        originalVendorId: vendorId, assignedVendorId: vendorId, ...await resolve(db, vendorId) },
      update: { sourceShopifyOrderNumber: `#${vendorId}-replayed` } });
    expect((await db.vendorAllocation.findUniqueOrThrow({ where: { id: old.id } })).shopifyLocationGidSnapshot).toBe(locationA);
    expect((await createAllocation(`${vendorId}-location-b`)).shopifyLocationGidSnapshot).toBe(locationB);
    await expect(save(vendorId, { shopifyLocationGid: 'gid://shopify/Order/202' })).rejects.toThrow('Shopify Location GID');
    await save(vendorId, { shopifyLocationGid: null });
    expect((await read(vendorId)).shopifyLocationGid).toBeNull();
    expect((await createAllocation(`${vendorId}-cleared`)).shopifyLocationGidSnapshot).toBeNull();
    expect((await db.vendorAllocation.findUniqueOrThrow({ where: { id: old.id } })).shopifyLocationGidSnapshot).toBe(locationA);
  });

  it('preserves the snapshot through operational projection updates and integration-token lifecycle', async () => {
    await save(vendorId, { outboundMethod: 'VENDOR_INTEGRATION', selectedIntegrationProvider: 'SOPYO' });
    const allocation = await createAllocation(`${vendorId}-operations`);
    const client = await db.vendorIntegrationClient.create({ data: {
      vendorIdentifier: vendorId,
      providerName: 'Sopyo',
      providerCode: 'SOPYO',
      tokenHash: `${vendorId}-token`,
      scopes: ['orders:read', 'shipment:write'],
    } });
    await db.vendorAllocation.update({ where: { id: allocation.id }, data: {
      vendorIntegrationStatus: 'accepted',
      vendorIntegrationShippedAt: new Date('2026-10-01T00:00:00.000Z'),
      shippingStatus: 'In Transit',
      carrier: 'Test Carrier',
      trackingNumber: 'TEST-123',
      fulfillmentStatus: 'fulfilled',
      vendorInvoiceNumber: 'TEST-INV-1',
    } });
    await db.vendorIntegrationClient.update({ where: { id: client.id }, data: { revokedAt: new Date() } });
    await db.vendorIntegrationClient.create({ data: {
      vendorIdentifier: vendorId,
      providerName: 'Replacement Sopyo',
      providerCode: 'SOPYO',
      tokenHash: `${vendorId}-replacement`,
      scopes: ['orders:read', 'shipment:write'],
    } });
    expect(await db.vendorAllocation.findUniqueOrThrow({ where: { id: allocation.id } })).toMatchObject({
      outboundMethodSnapshot: 'VENDOR_INTEGRATION', outboundIntegrationProviderSnapshot: 'SOPYO',
    });
  });

  it('rejects an invalid persisted snapshot pair at the database boundary', async () => {
    const allocation = await createAllocation(`${vendorId}-pair`);
    await expect(db.$executeRaw`
      UPDATE "VendorAllocation" SET "outboundIntegrationProviderSnapshot" = 'SOPYO'
      WHERE "id" = ${allocation.id}
    `).rejects.toThrow();
    expect(await db.vendorAllocation.findUniqueOrThrow({ where: { id: allocation.id } })).toMatchObject({
      outboundMethodSnapshot: null, outboundIntegrationProviderSnapshot: null,
    });
  });
});
