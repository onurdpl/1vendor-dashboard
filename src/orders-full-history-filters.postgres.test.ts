import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../backend/node_modules/@prisma/client/index.js';

const url = process.env.TEST_DATABASE_URL?.trim();
const prefix = 'p4-12c-';

describe.skipIf(!url || process.env.P4_12C_PG_ISOLATED !== '1')('Orders full-history filters on disposable PostgreSQL 18', () => {
  let db: PrismaClient;
  let listVendorOrders: typeof import('../backend/src/modules/orders/orders.service.js').listVendorOrders;
  let resolveRequestVendorContext: typeof import('../backend/src/modules/vendor-access/vendor-access.service.js').resolveRequestVendorContext;
  let resolveAdminVendorTarget: typeof import('../backend/src/modules/vendor-access/admin-vendor-target.service.js').resolveAdminVendorTarget;
  const vendorA = `${prefix}vendor-a`;
  const vendorB = `${prefix}vendor-b`;

  beforeAll(async () => {
    const target = new URL(url!);
    if (process.env.GITHUB_ACTIONS === 'true' || target.protocol !== 'postgresql:' ||
      target.hostname !== '127.0.0.1' || target.port !== '5432' ||
      !/^\/p4_12c_orders_filters_[a-z0-9_]+$/.test(target.pathname) || target.search !== '?schema=public') {
      throw new Error('P4-12C requires its disposable local PostgreSQL target.');
    }
    process.env.DATABASE_URL = url;
    const { PrismaClient } = await import('../backend/node_modules/@prisma/client/index.js');
    db = new PrismaClient({ datasources: { db: { url } } });
    await db.$connect();
    const [identity] = await db.$queryRaw<Array<{ database: string; address: string; version: string }>>`
      SELECT current_database() AS database, host(inet_server_addr()) AS address,
        current_setting('server_version_num') AS version
    `;
    expect(identity.database).toBe(target.pathname.slice(1));
    expect(identity.address).toBe('127.0.0.1');
    expect(Number(identity.version)).toBeGreaterThanOrEqual(180000);
    expect(Number(identity.version)).toBeLessThan(190000);
    expect(await db.vendor.count()).toBe(0);
    expect(await db.vendorAllocation.count()).toBe(0);
    await db.vendor.createMany({ data: [
      { id: vendorA, name: 'P4-12C Vendor A' }, { id: vendorB, name: 'P4-12C Vendor B' },
    ] });
    await db.user.createMany({ data: [
      { id: `${prefix}user-a`, email: 'p4-12c-a@example.test', name: 'Vendor A User', role: 'VENDOR', passwordHash: 'unused' },
      { id: `${prefix}user-b`, email: 'p4-12c-b@example.test', name: 'Vendor B User', role: 'VENDOR', passwordHash: 'unused' },
    ] });
    await db.userVendorAccess.createMany({ data: [
      { userId: `${prefix}user-a`, vendorId: vendorA },
      { userId: `${prefix}user-b`, vendorId: vendorB },
    ] });
    const rows = Array.from({ length: 365 }, (_, index) => {
      const vendorId = index === 364 ? vendorB : vendorA;
      const allocationStatus = index === 340 || index === 345 ? 'VENDOR_BLOCKED' :
        index === 341 ? 'PENDING_REASSIGNMENT' : 'ACTIVE';
      const fulfillmentStatus = index === 342 ? 'partially_fulfilled' : index === 340 || index === 344 || index === 346 ? 'Pending' : 'Processing';
      const shippingStatus = index === 342 ? 'in_transit' : index === 343 ? 'label_created' :
        index === 340 || index === 344 || index === 346 ? 'Awaiting Shipment' : 'delivered';
      return { index, vendorId, allocationStatus, fulfillmentStatus, shippingStatus };
    });
    await db.shopifyOrder.createMany({ data: rows.map(({ index }) => ({
      id: `${prefix}order-${index}`, sourceShopifyOrderId: `gid://shopify/Order/p4-12c-${index}`,
      sourceShopifyOrderNumber: `#p4-12c-${index}`,
      cancelledAt: index === 345 || index === 346 ? new Date('2026-11-01T00:00:00Z') : null,
    })) });
    await db.vendorAllocation.createMany({ data: rows.map(({ index, vendorId, allocationStatus, fulfillmentStatus, shippingStatus }) => ({
      id: `${prefix}allocation-${String(index).padStart(3, '0')}`,
      sourceShopifyOrderId: `${prefix}order-${index}`, sourceShopifyOrderNumber: `#p4-12c-${index}`,
      originalVendorId: vendorId, assignedVendorId: vendorId,
      allocationStatus: allocationStatus as 'ACTIVE' | 'VENDOR_BLOCKED' | 'PENDING_REASSIGNMENT',
      fulfillmentStatus, shippingStatus,
      trackingNumber: [340, 341, 344, 345, 346, 364].includes(index) ? null : `TRACK-${index}`,
      carrier: [340, 341, 344, 345, 346, 364].includes(index) ? null : 'carrier',
      updatedAt: new Date(Date.UTC(2026, 10, 8, 0, 0, 365 - index)),
    })) });
    ({ listVendorOrders } = await import('../backend/src/modules/orders/orders.service.js'));
    ({ resolveRequestVendorContext } = await import('../backend/src/modules/vendor-access/vendor-access.service.js'));
    ({ resolveAdminVendorTarget } = await import('../backend/src/modules/vendor-access/admin-vendor-target.service.js'));
  }, 120_000);

  afterAll(async () => {
    await db?.$disconnect();
    const { prisma } = await import('../backend/src/db/prisma.js');
    await prisma.$disconnect();
  });

  it('filters the whole authorized history before offset and preserves stable ordering', async () => {
    const first = await listVendorOrders(vendorA, { limit: 101, offset: 0, allocationStatus: 'active' });
    const second = await listVendorOrders(vendorA, { limit: 101, offset: 100, allocationStatus: 'active' });
    expect(first).toHaveLength(101);
    expect(second).toHaveLength(101);
    expect(new Set([...first.slice(0, 100), ...second.slice(0, 100)].map((row) => row.id)).size).toBe(200);
    const after300 = await listVendorOrders(vendorA, { limit: 100, offset: 300, allocationStatus: 'active' });
    expect(after300.some((row) => row.id.endsWith('342'))).toBe(true);
    expect(first.every((row) => row.vendorId === vendorA)).toBe(true);
    expect((await listVendorOrders(vendorB, { limit: 101, allocationStatus: 'active' })).every((row) => row.vendorId === vendorB)).toBe(true);
  });

  it('finds all five filter kinds beyond row 300 and combines search, workflow and filters', async () => {
    expect((await listVendorOrders(vendorA, { blocked: true })).map((row) => row.id)).toEqual([
      `${prefix}allocation-340`, `${prefix}allocation-341`,
    ]);
    expect((await listVendorOrders(vendorA, { allocationStatus: 'pending_reassignment' })).map((row) => row.id))
      .toEqual([`${prefix}allocation-341`]);
    expect((await listVendorOrders(vendorA, { fulfillmentStatus: 'Partially Fulfilled' })).map((row) => row.id))
      .toEqual([`${prefix}allocation-342`]);
    expect((await listVendorOrders(vendorA, { shippingStatus: 'In Transit' })).map((row) => row.id))
      .toEqual([`${prefix}allocation-342`]);
    expect((await listVendorOrders(vendorA, { shippingStatus: 'Label Created' })).map((row) => row.id))
      .toEqual([`${prefix}allocation-343`]);
    expect((await listVendorOrders(vendorA, { trackingMissing: true })).some((row) => row.id.endsWith('344'))).toBe(true);
    expect((await listVendorOrders(vendorA, { workflow: 'trackingMissing' })).map((row) => row.id))
      .toEqual((await listVendorOrders(vendorA, { trackingMissing: true })).map((row) => row.id));
    expect((await listVendorOrders(vendorA, { search: '#p4-12c-340', blocked: true,
      fulfillmentStatus: 'Pending', shippingStatus: 'Awaiting Shipment' })).map((row) => row.id))
      .toEqual([`${prefix}allocation-340`]);
    expect(await listVendorOrders(vendorA, { blocked: true, search: '#p4-12c-345' })).toEqual([]);
    expect(await listVendorOrders(vendorA, { fulfillmentStatus: 'Pending', search: '#p4-12c-346' })).toEqual([]);
    expect(await listVendorOrders(vendorB, { blocked: true, search: '#p4-12c-340' })).toEqual([]);
  });

  it('enforces membership and verifies an Admin non-member target independently', async () => {
    const userA = { id: `${prefix}user-a`, role: 'vendor' as const } as Parameters<typeof resolveRequestVendorContext>[0];
    expect((await resolveRequestVendorContext(userA, vendorA)).ok).toBe(true);
    expect(await resolveRequestVendorContext(userA, vendorB)).toMatchObject({ ok: false, code: 403 });
    const admin = { authUser: { id: `${prefix}admin`, role: 'admin' } } as Parameters<typeof resolveAdminVendorTarget>[0];
    expect(await resolveAdminVendorTarget(admin, vendorB)).toMatchObject({ ok: true, vendor: { id: vendorB } });
    expect(await resolveAdminVendorTarget(admin, 'missing-vendor')).toMatchObject({ ok: false, code: 404 });
  });

  it('uses id descending as the deterministic tie-breaker for equal update times', async () => {
    const tiedAt = new Date('2026-11-08T12:00:00Z');
    await db.vendorAllocation.updateMany({ where: { id: { in: [
      `${prefix}allocation-340`, `${prefix}allocation-341`,
    ] } }, data: { updatedAt: tiedAt } });
    expect((await listVendorOrders(vendorA, { blocked: true })).map((row) => row.id)).toEqual([
      `${prefix}allocation-341`, `${prefix}allocation-340`,
    ]);
  });
});
