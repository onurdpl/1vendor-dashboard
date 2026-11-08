import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../backend/node_modules/@prisma/client/index.js';

const url = process.env.TEST_DATABASE_URL?.trim();
const prefix = 'p4-13b-';

describe.skipIf(!url || process.env.P4_13B_PG_ISOLATED !== '1')('Returns full-history filters on disposable PostgreSQL 18', () => {
  let db: PrismaClient;
  let listReturns: typeof import('../backend/src/modules/returns/returns.service.js').listVendorReturns;
  let statusOptions: typeof import('../backend/src/modules/returns/returns.service.js').listVendorReturnStatusOptions;
  const vendorA = `${prefix}vendor-a`;
  const vendorB = `${prefix}vendor-b`;

  beforeAll(async () => {
    const target = new URL(url!);
    if (process.env.GITHUB_ACTIONS === 'true' || target.protocol !== 'postgresql:'
      || target.hostname !== '127.0.0.1' || target.port !== '5432'
      || !/^\/p4_13b_returns_filters_[a-z0-9_]+$/.test(target.pathname)
      || target.search !== '?schema=public') {
      throw new Error('P4-13B refuses a nonlocal or unexpected PostgreSQL target.');
    }
    process.env.DATABASE_URL = url;
    const { PrismaClient } = await import('../backend/node_modules/@prisma/client/index.js');
    db = new PrismaClient({ datasources: { db: { url } } });
    await db.$connect();
    const [identity] = await db.$queryRaw<Array<{ database: string; address: string; port: number; version: string }>>`
      SELECT current_database() AS database, host(inet_server_addr()) AS address,
        inet_server_port() AS port, current_setting('server_version_num') AS version
    `;
    expect(identity.database).toBe(target.pathname.slice(1));
    expect(identity.address).toBe('127.0.0.1');
    expect(identity.port).toBe(5432);
    expect(Number(identity.version)).toBeGreaterThanOrEqual(180000);
    expect(Number(identity.version)).toBeLessThan(190000);
    expect(await db.returnRecord.count()).toBe(0);

    await db.vendor.createMany({ data: [
      { id: vendorA, name: 'P4-13B A' }, { id: vendorB, name: 'P4-13B B' },
    ] });
    const rows = Array.from({ length: 361 }, (_, index) => {
      const foreign = index === 360;
      const vendorId = foreign ? vendorB : vendorA;
      const orderId = `${prefix}order-${index}`;
      const allocationId = `${prefix}allocation-${index}`;
      const returnId = `${prefix}return-${String(index).padStart(3, '0')}`;
      const status = index === 350 ? 'approved'
        : index === 351 || index === 356 ? 'closed'
          : index === 353 ? 'processed'
            : index === 354 ? 'in_review'
              : index === 300 ? 'late_status'
                : foreign ? 'foreign_only' : 'requested';
      const requestSource = index === 353 ? 'shopify_refund' : 'shopify_return_request';
      return { index, vendorId, orderId, allocationId, returnId, status, requestSource };
    });
    await db.shopifyOrder.createMany({ data: rows.map((row) => ({
      id: row.orderId, sourceShopifyOrderId: `gid://shopify/Order/${row.index + 1000}`,
      sourceShopifyOrderNumber: `#${row.index + 1000}`,
    })) });
    await db.vendorAllocation.createMany({ data: rows.map((row) => ({
      id: row.allocationId, sourceShopifyOrderId: row.orderId,
      sourceShopifyOrderNumber: `#${row.index + 1000}`, originalVendorId: row.vendorId,
      assignedVendorId: row.vendorId,
    })) });
    await db.returnRecord.createMany({ data: rows.map((row) => ({
      id: row.returnId, vendorAllocationId: row.allocationId,
      sourceShopifyOrderId: `gid://shopify/Order/${row.index + 1000}`,
      sourceShopifyOrderNumber: `#${row.index + 1000}`,
      returnRequestSource: row.requestSource,
      sourceShopifyRefundId: row.index === 356 ? 'refund-evidence-356' : null,
      status: row.status, returnLifecycleStatus: row.status,
      vendorDecision: row.index === 350 ? 'approved' : null,
      vendorReceivedAt: row.index === 352 ? new Date('2026-11-01T00:00:00Z') : null,
      createdAt: row.index === 201 || row.index === 200
        ? new Date('2026-11-02T00:00:00Z')
        : new Date(Date.UTC(2026, 10, 5, 0, 0, 0) - row.index * 60_000),
    })) });
    ({ listVendorReturns: listReturns, listVendorReturnStatusOptions: statusOptions } =
      await import('../backend/src/modules/returns/returns.service.js'));
  }, 120_000);

  afterAll(async () => {
    await db?.$disconnect();
    const { prisma } = await import('../backend/src/db/prisma.js');
    await prisma.$disconnect();
  });

  it('finds each lifecycle/source match after row 300 without a false empty batch', async () => {
    const cases = [
      { index: 350, filters: { workflow: 'approved' as const } },
      { index: 351, filters: { workflow: 'closed' as const } },
      { index: 352, filters: { workflow: 'needs-action' as const, source: 'pending' as const } },
      { index: 353, filters: { workflow: 'refunded' as const, source: 'refunded' as const } },
      { index: 354, filters: { status: 'In Review', source: 'pending' as const } },
      { index: 356, filters: { workflow: 'refunded' as const } },
      { index: 359, filters: { workflow: 'requested' as const, source: 'pending' as const } },
    ];
    for (const { index, filters } of cases) {
      const id = `${prefix}return-${String(index).padStart(3, '0')}`;
      expect((await listReturns(vendorA, { limit: 101, offset: 0, search: id, ...filters })).map(row => row.id)).toEqual([id]);
    }
    expect((await listReturns(vendorA, { workflow: 'approved' })).map(row => row.id))
      .toEqual([`${prefix}return-350`]);
    expect((await listReturns(vendorA, { workflow: 'needs-action' })).map(row => row.id))
      .toEqual([`${prefix}return-352`]);
    expect((await listReturns(vendorA, { workflow: 'closed' })).map(row => row.id))
      .toEqual([`${prefix}return-351`]);
    expect((await listReturns(vendorA, { workflow: 'refunded' })).map(row => row.id))
      .toEqual([`${prefix}return-353`, `${prefix}return-356`]);
    expect(await listReturns(vendorA, { workflow: 'approved', search: `${prefix}return-359` })).toEqual([]);
  });

  it('paginates filtered history in stable order without duplicates', async () => {
    const first = await listReturns(vendorA, { workflow: 'requested', limit: 101, offset: 0 });
    const second = await listReturns(vendorA, { workflow: 'requested', limit: 101, offset: 100 });
    expect(first).toHaveLength(101);
    expect(second).toHaveLength(101);
    expect(first[100].id).toBe(second[0].id);
    expect(new Set([...first.slice(0, 100), ...second.slice(0, 100)].map(row => row.id)).size).toBe(200);
    const tied = await listReturns(vendorA, { workflow: 'requested', limit: 360, offset: 0 });
    expect(tied.findIndex(row => row.id.endsWith('201'))).toBeLessThan(tied.findIndex(row => row.id.endsWith('200')));
  });

  it('scopes status options and filtered records to the current assigned Vendor', async () => {
    const optionsA = await statusOptions(vendorA);
    expect(optionsA).toContain('Late Status');
    expect(optionsA).not.toContain('Foreign Only');
    expect(await statusOptions(vendorB)).toEqual(['Foreign Only']);
    expect(await listReturns(vendorB, { status: 'Late Status' })).toEqual([]);
    expect(await listReturns(vendorA, { status: 'Foreign Only' })).toEqual([]);
    expect((await listReturns(vendorA, { status: 'Late Status' })).map(row => row.id))
      .toEqual([`${prefix}return-300`]);
    expect(await db.returnRecord.count()).toBe(361);
  });
});
