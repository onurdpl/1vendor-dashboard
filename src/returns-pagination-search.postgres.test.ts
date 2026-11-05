import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../backend/node_modules/@prisma/client/index.js';

const url = process.env.TEST_DATABASE_URL?.trim();
const prefix = 'p4-06b-';

describe.skipIf(!url || process.env.P4_06B_PG_ISOLATED !== '1')('Returns search on isolated PostgreSQL 18', () => {
  let db: PrismaClient;
  let listVendorReturns: typeof import('../backend/src/modules/returns/returns.service.js').listVendorReturns;
  let verified = false;
  const vendorA = `${prefix}vendor-a`;
  const vendorB = `${prefix}vendor-b`;

  beforeAll(async () => {
    const target = new URL(url!);
    if (process.env.GITHUB_ACTIONS === 'true' || target.protocol !== 'postgresql:'
      || target.hostname !== '127.0.0.1' || target.port !== '5432'
      || !/^\/p4_06b_returns_search_[a-z0-9_]+$/.test(target.pathname)
      || target.search !== '?schema=public') {
      throw new Error('P4-06B refuses a nonlocal or unexpected PostgreSQL target.');
    }
    process.env.DATABASE_URL = url;
    const { PrismaClient } = await import('../backend/node_modules/@prisma/client/index.js');
    db = new PrismaClient({ datasources: { db: { url } } });
    await db.$connect();
    const [identity] = await db.$queryRaw<Array<{
      database: string; address: string; port: number; version: string;
    }>>`
      SELECT current_database() AS database, host(inet_server_addr()) AS address,
        inet_server_port() AS port, current_setting('server_version_num') AS version
    `;
    expect(identity.database).toBe(target.pathname.slice(1));
    expect(identity.address).toBe('127.0.0.1');
    expect(identity.port).toBe(5432);
    expect(Number(identity.version)).toBeGreaterThanOrEqual(180000);
    expect(Number(identity.version)).toBeLessThan(190000);
    expect(await db.returnRecord.count()).toBe(0);
    expect(await db.vendor.count()).toBe(0);
    verified = true;

    await db.vendor.createMany({ data: [
      { id: vendorA, name: 'P4-06B A' }, { id: vendorB, name: 'P4-06B B' },
    ] });
    const all = Array.from({ length: 151 }, (_, index) => {
      const number = 1001 + index;
      const vendorId = index === 150 ? vendorB : vendorA;
      return { number, vendorId, orderId: `${prefix}order-${index}`,
        allocationId: `${prefix}allocation-${index}`, returnId: `${prefix}return-${index}` };
    });
    await db.shopifyOrder.createMany({ data: all.map(({ number, orderId }) => ({
      id: orderId, sourceShopifyOrderId: `gid://shopify/Order/${number}`,
      sourceShopifyOrderNumber: `#${number}`, customerName: `Customer ${number}`,
    })) });
    await db.vendorAllocation.createMany({ data: all.map(({ number, vendorId, orderId, allocationId }) => ({
      id: allocationId, sourceShopifyOrderId: orderId,
      sourceShopifyOrderNumber: `#${number}`, originalVendorId: vendorId,
      assignedVendorId: vendorId,
    })) });
    await db.returnRecord.createMany({ data: all.map(({ number, orderId, allocationId, returnId }, index) => ({
      id: returnId, vendorAllocationId: allocationId,
      sourceShopifyOrderId: `gid://shopify/Order/${number}`,
      sourceShopifyOrderNumber: `#${number}`,
      sourceShopifyReturnId: `remote-${number}`,
      sourceShopifyReturnGid: `gid://shopify/Return/remote-${number}`,
      sourceShopifyLineItemId: index === 149 || index === 150 ? `line-${number}` : null,
      returnRequestSource: 'shopify_return_request', status: 'requested',
      returnLifecycleStatus: 'requested', reason: index === 149 ? 'SIZE_TOO_LARGE' : null,
      createdAt: new Date(Date.UTC(2026, 10, 1, 0, 150 - index)),
    })) });
    for (const index of [149, 150]) {
      const row = all[index];
      await db.shopifyOrderLineItem.create({ data: {
        id: `${prefix}line-${index}`, shopifyOrderId: row.orderId,
        sourceLineItemId: `line-${row.number}`, sku: 'SKU-1150',
        title: 'Running Shoe Variant Blue', quantity: 1,
      } });
      await db.vendorAllocationLineItem.create({ data: {
        id: `${prefix}allocation-line-${index}`, vendorAllocationId: row.allocationId,
        shopifyLineItemId: `${prefix}line-${index}`, quantity: 1,
      } });
    }
    await db.shopifyOrderLineItem.create({ data: {
      id: `${prefix}unreturned-line`, shopifyOrderId: all[149].orderId,
      sourceLineItemId: 'unreturned-line', sku: 'SKU-NOT-RETURNED',
      title: 'Unreturned Product', quantity: 1,
    } });
    await db.vendorAllocationLineItem.create({ data: {
      id: `${prefix}unreturned-allocation-line`, vendorAllocationId: all[149].allocationId,
      shopifyLineItemId: `${prefix}unreturned-line`, quantity: 1,
    } });
    ({ listVendorReturns } = await import('../backend/src/modules/returns/returns.service.js'));
  }, 120_000);

  afterAll(async () => {
    if (db && verified) {
      await db.vendorAllocationLineItem.deleteMany({ where: { id: { startsWith: prefix } } });
      await db.shopifyOrderLineItem.deleteMany({ where: { id: { startsWith: prefix } } });
      await db.returnRecord.deleteMany({ where: { id: { startsWith: prefix } } });
      await db.vendorAllocation.deleteMany({ where: { id: { startsWith: prefix } } });
      await db.shopifyOrder.deleteMany({ where: { id: { startsWith: prefix } } });
      await db.vendor.deleteMany({ where: { id: { startsWith: prefix } } });
      expect(await db.returnRecord.count()).toBe(0);
    }
    await db?.$disconnect();
    const { prisma } = await import('../backend/src/db/prisma.js');
    await prisma.$disconnect();
  });

  it('pages beyond 100 rows and searches the authorized Vendor before pagination', async () => {
    const first = await listVendorReturns(vendorA, { limit: 101, offset: 0 });
    const second = await listVendorReturns(vendorA, { limit: 101, offset: 100 });
    expect(first).toHaveLength(101);
    expect(second).toHaveLength(50);
    expect(second.some((row) => row.sourceShopifyOrderNumber === '#1150')).toBe(true);
    expect(first.every((row) => row.assignedVendorId === vendorA)).toBe(true);
    expect(second.every((row) => row.assignedVendorId === vendorA)).toBe(true);

    const fallbackOrderId = `${prefix}refund-fallback-order`;
    const fallbackAllocationId = `${prefix}refund-fallback-allocation`;
    await db.shopifyOrder.create({ data: { id: fallbackOrderId,
      sourceShopifyOrderId: 'gid://shopify/Order/2000', sourceShopifyOrderNumber: '#2000' } });
    await db.vendorAllocation.create({ data: { id: fallbackAllocationId,
      sourceShopifyOrderId: fallbackOrderId, sourceShopifyOrderNumber: '#2000',
      originalVendorId: vendorA, assignedVendorId: vendorA } });
    await db.returnRecord.create({ data: { id: `${prefix}refund-fallback-return`,
      vendorAllocationId: fallbackAllocationId, sourceShopifyOrderId: 'gid://shopify/Order/2000',
      sourceShopifyOrderNumber: '#2000', status: 'processed', returnRequestSource: 'shopify_refund' } });
    await db.shopifyOrderLineItem.create({ data: { id: `${prefix}refund-fallback-line`,
      shopifyOrderId: fallbackOrderId, sourceLineItemId: 'refund-fallback-line',
      title: 'Fallback Refund Product', sku: 'FALLBACK-SKU', quantity: 1 } });
    await db.vendorAllocationLineItem.create({ data: { id: `${prefix}refund-fallback-allocation-line`,
      vendorAllocationId: fallbackAllocationId, shopifyLineItemId: `${prefix}refund-fallback-line`, quantity: 1 } });

    for (const search of ['#1150', 'remote-1150', 'Customer 1150', 'SIZE_TOO_LARGE',
      'SKU-1150', 'Running Shoe']) {
      const matches = await listVendorReturns(vendorA, { limit: 101, offset: 0, search });
      expect(matches.map((row) => row.sourceShopifyOrderNumber)).toEqual(['#1150']);
    }
    expect(await listVendorReturns(vendorA, { limit: 101, offset: 0, search: 'SKU-NOT-RETURNED' })).toEqual([]);
    expect((await listVendorReturns(vendorA, { limit: 101, offset: 0, search: 'Fallback Refund Product' }))
      .map((row) => row.sourceShopifyOrderNumber)).toEqual(['#2000']);
    expect(await listVendorReturns(vendorB, { limit: 101, offset: 0, search: '#1150' })).toEqual([]);
    expect((await listVendorReturns(vendorB, { limit: 101, offset: 0, search: 'SKU-1150' }))
      .map((row) => row.sourceShopifyOrderNumber)).toEqual(['#1151']);
  });
});
