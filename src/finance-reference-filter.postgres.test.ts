import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../backend/node_modules/@prisma/client/index.js';
import type { AppEnv } from '../backend/src/config/env.js';

const url = process.env.TEST_DATABASE_URL;
const dbName = 'p4_14_finance_reference_backend';
const vendorA = 'p4-14-a';
const vendorB = 'p4-14-b';
const password = 'disposable-finance-reference-password';
const env = { NODE_ENV: 'test', JWT_SECRET: 'disposable-finance-reference-jwt-key', JWT_EXPIRES_IN: '1h',
  LOGIN_RATE_LIMIT_MAX_ATTEMPTS: 20, LOGIN_RATE_LIMIT_WINDOW_SECONDS: 60 } as AppEnv;

describe.skipIf(!url || process.env.P4_14_REFERENCE_PG_ISOLATED !== '1')('Finance exact reference filtering on PostgreSQL', () => {
  let db: PrismaClient;
  let app: import('../backend/node_modules/fastify/types/instance.js').FastifyInstance;
  let adminToken: string;
  let vendorToken: string;

  beforeAll(async () => {
    const target = new URL(url!);
    if (process.env.GITHUB_ACTIONS === 'true' || target.protocol !== 'postgresql:' ||
        target.hostname !== '127.0.0.1' || target.port !== '55440' ||
        target.pathname !== `/${dbName}` || target.username !== 'sporgym_p14' ||
        target.search !== '?schema=public') throw new Error('Refusing a non-disposable PostgreSQL target.');
    process.env.DATABASE_URL = url;
    process.env.NODE_ENV = 'test';
    const { PrismaClient } = await import('../backend/node_modules/@prisma/client/index.js');
    db = new PrismaClient({ datasources: { db: { url } } });
    await db.$connect();
    const [identity] = await db.$queryRaw<Array<{ database: string; address: string; port: number; version: string }>>`
      SELECT current_database() AS database, host(inet_server_addr()) AS address,
        inet_server_port() AS port, current_setting('server_version_num') AS version`;
    expect(identity).toMatchObject({ database: dbName, address: '127.0.0.1', port: 55440, version: '180003' });
    expect(await db.vendor.count()).toBe(0);
    (globalThis as { prisma?: PrismaClient }).prisma = db;

    const { hashPasswordArgon2id } = await import('../backend/src/modules/auth/password-hashing.js');
    const passwordHash = await hashPasswordArgon2id(password);
    await db.vendor.createMany({ data: [{ id: vendorA, name: 'Reference A' }, { id: vendorB, name: 'Reference B' }] });
    await db.user.createMany({ data: [
      { id: 'p4-14-admin', email: 'p4-14-admin@example.test', name: 'Reference Admin', role: 'ADMIN', passwordHash },
      { id: 'p4-14-vendor', email: 'p4-14-vendor@example.test', name: 'Reference Vendor', role: 'VENDOR', passwordHash },
    ] });
    await db.userVendorAccess.create({ data: { userId: 'p4-14-vendor', vendorId: vendorA } });
    await db.shopifyOrder.createMany({ data: [
      { id: 'p4-14-order', sourceShopifyOrderId: 'gid://shopify/Order/1414', sourceShopifyOrderNumber: '#1414' },
      { id: 'p4-14-other', sourceShopifyOrderId: 'gid://shopify/Order/other', sourceShopifyOrderNumber: '#1414' },
    ] });
    await db.vendorAllocation.createMany({ data: [
      { id: 'p4-14-a1', sourceShopifyOrderId: 'p4-14-order', sourceShopifyOrderNumber: '#1414', originalVendorId: vendorA, assignedVendorId: vendorB },
      { id: 'p4-14-a2', sourceShopifyOrderId: 'p4-14-order', sourceShopifyOrderNumber: '#1414', originalVendorId: vendorA, assignedVendorId: vendorA },
      { id: 'p4-14-b1', sourceShopifyOrderId: 'p4-14-order', sourceShopifyOrderNumber: '#1414', originalVendorId: vendorB, assignedVendorId: vendorB },
      { id: 'p4-14-other-a', sourceShopifyOrderId: 'p4-14-other', sourceShopifyOrderNumber: '#1414', originalVendorId: vendorA, assignedVendorId: vendorA },
    ] });
    const base = new Date('2026-11-01T00:00:00.000Z').getTime();
    await db.financeLedgerEntry.createMany({ data: [
      ...Array.from({ length: 350 }, (_, index) => ({ id: `p4-14-filler-${String(index).padStart(3, '0')}`,
        vendorId: vendorA, entryType: 'sale', amount: '10.00', description: `Filler ${index}`,
        createdAt: new Date(base - index * 1000) })),
      ...Array.from({ length: 120 }, (_, index) => ({ id: `p4-14-target-${String(index).padStart(3, '0')}`,
        vendorId: vendorA, vendorAllocationId: index % 2 ? 'p4-14-a1' : 'p4-14-a2',
        entryType: 'sale', amount: '20.00', description: `Target ${index}`,
        createdAt: new Date(base - 400_000 - Math.floor(index / 2) * 1000) })),
      { id: 'p4-14-b-sale', vendorId: vendorB, vendorAllocationId: 'p4-14-b1', entryType: 'sale', amount: '30.00' },
      { id: 'p4-14-other-sale', vendorId: vendorA, vendorAllocationId: 'p4-14-other-a', entryType: 'sale', amount: '40.00' },
      { id: 'p4-14-null-sale', vendorId: vendorA, entryType: 'sale', amount: '50.00' },
      { id: 'p4-14-void-sale', vendorId: vendorA, vendorAllocationId: 'p4-14-a1', entryType: 'sale', amount: '60.00', voidedAt: new Date() },
      { id: 'p4-14-a-refund-1', vendorId: vendorA, vendorAllocationId: 'p4-14-a1', entryType: 'refund', amount: '5.00' },
      { id: 'p4-14-a-refund-2', vendorId: vendorA, vendorAllocationId: 'p4-14-a1', entryType: 'refund', amount: '6.00' },
      { id: 'p4-14-b-refund-1', vendorId: vendorB, vendorAllocationId: 'p4-14-b1', entryType: 'refund', amount: '7.00' },
      { id: 'p4-14-legacy-refund', vendorId: vendorA, vendorAllocationId: 'p4-14-a1', entryType: 'refund', amount: '8.00' },
    ] });
    const refunds = [
      { id: 'p4-14-r1-a', allocation: 'p4-14-a1', external: 'gid://shopify/Refund/one', vendor: vendorA, sale: 'p4-14-target-001', ledger: 'p4-14-a-refund-1' },
      { id: 'p4-14-r2-a', allocation: 'p4-14-a1', external: 'gid://shopify/Refund/two', vendor: vendorA, sale: 'p4-14-target-001', ledger: 'p4-14-a-refund-2' },
      { id: 'p4-14-r1-b', allocation: 'p4-14-b1', external: 'gid://shopify/Refund/one', vendor: vendorB, sale: 'p4-14-b-sale', ledger: 'p4-14-b-refund-1' },
    ];
    for (const refund of refunds) {
      await db.refundRecord.create({ data: { id: refund.id, vendorAllocationId: refund.allocation,
        sourceShopifyOrderId: 'p4-14-order', sourceShopifyOrderNumber: '#1414',
        sourceShopifyRefundId: refund.external, status: 'processed', amount: '5.00' } });
      await db.refundEvidenceSnapshot.create({ data: {
        id: `${refund.id}-snapshot`, sourceShopifyRefundId: refund.external,
        sourceShopifyOrderId: 'p4-14-order', vendorAllocationId: refund.allocation,
        refundRecordId: refund.id, refundFinanceLedgerEntryId: refund.ledger,
        historicalEconomicVendorId: refund.vendor, historicalSaleFinanceLedgerEntryId: refund.sale,
        monetaryClassification: 'MONETARY_REFUND', refundTotalAmount: '5.00', currency: 'TRY',
        normalizedTransactionsJson: {}, normalizedRefundLinesJson: [], normalizedOwnershipJson: {},
        normalizedEvidenceJson: {}, supersededSaleLedgerIdsJson: [], evidenceHash: 'disposable-test',
        hashAlgorithm: 'sha256', evidenceVersion: 1, normalizationVersion: 1,
        evidenceSource: 'disposable-test', capturedAt: new Date(),
      } });
    }
    const { createAuthService } = await import('../backend/src/modules/auth/auth.service.js');
    const auth = createAuthService(env);
    adminToken = (await auth.login({ email: 'p4-14-admin@example.test', password }))!.token;
    vendorToken = (await auth.login({ email: 'p4-14-vendor@example.test', password }))!.token;
    const { default: Fastify } = await import('../backend/node_modules/fastify/fastify.js');
    const { registerFinanceRoutes } = await import('../backend/src/modules/finance/finance.routes.js');
    app = Fastify({ logger: false });
    registerFinanceRoutes(app, env);
    await app.ready();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await db?.$disconnect();
    delete (globalThis as { prisma?: PrismaClient }).prisma;
  });

  async function get(query: Record<string, string>, vendorId = vendorA, token = adminToken) {
    const response = await app.inject({ method: 'GET', url: `/finance/transactions?${new URLSearchParams(query)}`,
      headers: { authorization: `Bearer ${token}`, 'x-vendor-id': vendorId } });
    return { status: response.statusCode, body: response.json() as {
      records: Array<{ id: string }>; hasNextPage: boolean; nextCursor: string | null; scanned: number;
    } };
  }

  it('distinguishes local and external Order IDs, multiple allocations, ownership, and unrelated display numbers', async () => {
    const unscoped = await get({});
    expect(unscoped.body.records.map((row) => row.id)).not.toContain('p4-14-target-119');
    const local = await get({ localOrderId: 'p4-14-order' });
    const external = await get({ sourceShopifyOrderId: 'gid://shopify/Order/1414' });
    expect(local.status).toBe(200);
    expect(local.body.records).toHaveLength(100);
    expect(local.body.records).toEqual(external.body.records);
    expect(local.body.scanned).toBeGreaterThan(100);
    expect(local.body.records.map((row) => row.id)).not.toContain('p4-14-other-sale');
    expect(local.body.records.map((row) => row.id)).not.toContain('p4-14-b-sale');
    expect((await get({ localOrderId: 'gid://shopify/Order/1414' })).body.records).toEqual([]);
    expect((await get({ sourceShopifyOrderId: 'p4-14-order' })).body.records).toEqual([]);
    expect((await get({ localOrderId: 'p4-14-order' }, vendorB)).body.records.map((row) => row.id)).toContain('p4-14-b-sale');
    expect((await get({ localOrderId: 'p4-14-order' }, vendorB, vendorToken)).status).not.toBe(200);
  });

  it('paginates more than 100 historical Order matches without duplicates and binds the cursor', async () => {
    const first = await get({ localOrderId: 'p4-14-order' });
    const second = await get({ localOrderId: 'p4-14-order', cursor: first.body.nextCursor! });
    expect(first.body.hasNextPage).toBe(true);
    expect(second.body.hasNextPage).toBe(false);
    expect(second.body.records.length).toBeGreaterThan(20);
    const ids = [...first.body.records, ...second.body.records].map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('p4-14-target-119');
    expect(ids.indexOf('p4-14-target-001')).toBeLessThan(ids.indexOf('p4-14-target-000'));
    expect(ids).not.toContain('p4-14-null-sale');
    expect(ids).not.toContain('p4-14-void-sale');
    expect((await get({ sourceShopifyOrderId: 'gid://shopify/Order/1414', cursor: first.body.nextCursor! })).status).toBe(400);
    expect((await get({ localOrderId: 'p4-14-other', cursor: first.body.nextCursor! })).status).toBe(400);
    expect((await get({ localOrderId: 'p4-14-order', cursor: first.body.nextCursor! }, vendorB)).status).toBe(400);
    expect((await get({ localOrderId: 'p4-14-order', cursor: first.body.nextCursor!, search: 'Target' })).status).toBe(400);
  });

  it('uses exact refund snapshots, excluding another partial refund, sale display reference and legacy rows', async () => {
    const local = await get({ refundRecordId: 'p4-14-r1-a' });
    const external = await get({ sourceShopifyRefundId: 'gid://shopify/Refund/one' });
    expect(local.body.records.map((row) => row.id)).toEqual(['p4-14-a-refund-1']);
    expect(external.body.records.map((row) => row.id)).toEqual(['p4-14-a-refund-1']);
    expect((await get({ refundRecordId: 'p4-14-r2-a' })).body.records.map((row) => row.id)).toEqual(['p4-14-a-refund-2']);
    expect((await get({ sourceShopifyRefundId: 'gid://shopify/Refund/one' }, vendorB)).body.records.map((row) => row.id))
      .toEqual(['p4-14-b-refund-1']);
    expect((await get({ refundRecordId: 'p4-14-r1-b' })).body.records).toEqual([]);
    expect((await get({ refundRecordId: 'p4-14-r1-a' }, vendorA, vendorToken)).body.records.map((row) => row.id))
      .toEqual(['p4-14-a-refund-1']);
    expect((await get({ refundRecordId: 'p4-14-r1-a', category: 'Refund', search: 'p4-14-a-refund' }))
      .body.records.map((row) => row.id)).toEqual(['p4-14-a-refund-1']);
    expect((await get({ refundRecordId: 'p4-14-r1-a', category: 'Invoice' })).body.records).toEqual([]);
    expect((await get({ refundRecordId: 'p4-14-r1-a', status: 'nonexistent-status' })).body.records).toEqual([]);
  });

  it('rejects invalid or conflicting references and preserves existing no-reference and exact-ledger reads', async () => {
    const countBefore = await db.financeLedgerEntry.count();
    expect((await get({ localOrderId: '' })).status).toBe(400);
    expect((await get({ localOrderId: 'p4-14-order', refundRecordId: 'p4-14-r1-a' })).status).toBe(400);
    expect((await get({ localOrderId: 'missing' })).body.records).toEqual([]);
    expect((await get({ refundRecordId: 'missing' })).body.records).toEqual([]);
    expect((await get({ refundRecordId: 'p4-14-r1-b' }, vendorA, vendorToken)).body.records).toEqual([]);
    const regular = await get({});
    expect(regular.status).toBe(200);
    expect(regular.body.records).toHaveLength(100);
    const exact = await app.inject({ method: 'GET', url: '/finance/transactions/p4-14-target-119',
      headers: { authorization: `Bearer ${adminToken}`, 'x-vendor-id': vendorA } });
    expect(exact.statusCode).toBe(200);
    const overview = await app.inject({ method: 'GET', url: '/finance',
      headers: { authorization: `Bearer ${adminToken}`, 'x-vendor-id': vendorA } });
    expect(overview.statusCode).toBe(200);
    expect(await db.financeLedgerEntry.count()).toBe(countBefore);
  });
});
