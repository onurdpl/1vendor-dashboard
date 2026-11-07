import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../backend/node_modules/@prisma/client/index.js';
import type { AppEnv } from '../backend/src/config/env.js';

const url = process.env.TEST_DATABASE_URL;
const dbName = 'p4_06c_finance_search_practical_20261106';
const vendorA = 'p4-search-a';
const vendorB = 'p4-search-b';
const vendor100 = 'p4-search-100';
const vendor300 = 'p4-search-300';
const password = 'disposable-finance-search-password';
const env = { NODE_ENV: 'test', JWT_SECRET: 'disposable-finance-search-jwt-key', JWT_EXPIRES_IN: '1h',
  LOGIN_RATE_LIMIT_MAX_ATTEMPTS: 20, LOGIN_RATE_LIMIT_WINDOW_SECONDS: 60 } as AppEnv;

describe.skipIf(!url || process.env.P4_06C_SEARCH_PG_ISOLATED !== '1')('Finance Transactions full-history PostgreSQL search', () => {
  let db: PrismaClient;
  let app: import('../backend/node_modules/fastify/types/instance.js').FastifyInstance;
  let adminToken: string;
  let vendorToken: string;
  let queryCount = 0;

  beforeAll(async () => {
    const target = new URL(url!);
    if (process.env.GITHUB_ACTIONS === 'true' || target.protocol !== 'postgresql:' ||
        target.hostname !== '127.0.0.1' || target.port !== '55439' ||
        target.pathname !== `/${dbName}` || target.username !== 'sporgym_p2a' ||
        target.search !== '?schema=public') throw new Error('Refusing a non-disposable PostgreSQL target.');
    process.env.DATABASE_URL = url;
    process.env.NODE_ENV = 'test';
    const { PrismaClient } = await import('../backend/node_modules/@prisma/client/index.js');
    db = new PrismaClient({ datasources: { db: { url } }, log: [{ emit: 'event', level: 'query' }] });
    db.$on('query', () => { queryCount += 1; });
    await db.$connect();
    const [identity] = await db.$queryRaw<Array<{ database: string; address: string; port: number; version: string }>>`
      SELECT current_database() AS database, host(inet_server_addr()) AS address,
        inet_server_port() AS port, current_setting('server_version_num') AS version
    `;
    expect(identity).toMatchObject({ database: dbName, address: '127.0.0.1', port: 55439, version: '180003' });
    expect(await db.vendor.count()).toBe(0);
    (globalThis as { prisma?: PrismaClient }).prisma = db;
    const { hashPasswordArgon2id } = await import('../backend/src/modules/auth/password-hashing.js');
    const passwordHash = await hashPasswordArgon2id(password);
    await db.vendor.createMany({ data: [{ id: vendorA, name: 'Finance Search A' }, { id: vendorB, name: 'Finance Search B' },
      { id: vendor100, name: 'Finance 100' }, { id: vendor300, name: 'Finance 300' }] });
    await db.user.createMany({ data: [
      { id: 'p4-search-admin', email: 'p4-search-admin@example.test', name: 'Search Admin', role: 'ADMIN', passwordHash },
      { id: 'p4-search-vendor', email: 'p4-search-vendor@example.test', name: 'Search Vendor', role: 'VENDOR', passwordHash },
    ] });
    await db.userVendorAccess.create({ data: { userId: 'p4-search-vendor', vendorId: vendorA } });
    const base = new Date('2026-11-01T00:00:00.000Z').getTime();
    await db.financeLedgerEntry.createMany({ data: Array.from({ length: 1000 }, (_, index) => ({
      id: `p4-search-ledger-${String(index).padStart(4, '0')}`, vendorId: vendorA,
      entryType: 'sale', amount: index === 350 ? '1500.00' : '10.00', payoutStatus: 'PENDING',
      settlementStatus: 'PENDING', description: index === 350 ? 'Needle after page 300' :
        index === 360 ? 'literal %_ target' : `Canonical sale ${index}`,
      createdAt: new Date(base - Math.floor(index / 2) * 1000),
    })) });
    await db.financeLedgerEntry.createMany({ data: [
      { id: 'p4-search-b-only', vendorId: vendorB, entryType: 'sale', amount: '99.00', description: 'Vendor B secret' },
      { id: 'p4-search-void', vendorId: vendorA, entryType: 'sale', amount: '88.00', description: 'Voided only', voidedAt: new Date() },
    ] });
    await db.financeLedgerEntry.createMany({ data: [
      ...Array.from({ length: 100 }, (_, index) => ({ id: `p4-search-100-${index}`, vendorId: vendor100,
        entryType: 'sale', amount: '10.00', description: `Hundred ${index}`, createdAt: new Date(base - index * 1000) })),
      ...Array.from({ length: 300 }, (_, index) => ({ id: `p4-search-300-${index}`, vendorId: vendor300,
        entryType: 'sale', amount: '10.00', description: `Three hundred ${index}`, createdAt: new Date(base - index * 1000) })),
    ] });
    await db.shopifyOrder.create({ data: { id: 'p4-search-order', sourceShopifyOrderId: 'gid://shopify/Order/91777',
      sourceShopifyOrderNumber: '#91777' } });
    await db.vendorAllocation.create({ data: { id: 'p4-search-allocation', sourceShopifyOrderId: 'p4-search-order',
      sourceShopifyOrderNumber: '#91777', originalVendorId: vendorA, assignedVendorId: vendorA } });
    await db.refundRecord.create({ data: { id: 'p4-search-refund', vendorAllocationId: 'p4-search-allocation',
      sourceShopifyOrderId: 'p4-search-order', sourceShopifyOrderNumber: '#91777',
      sourceShopifyRefundId: 'gid://shopify/Refund/91888', status: 'processed', amount: '35.00' } });
    await db.financeLedgerEntry.create({ data: { id: 'p4-search-linked-refund', vendorId: vendorA,
      vendorAllocationId: 'p4-search-allocation', entryType: 'refund', amount: '35.00',
      description: 'Related refund', createdAt: new Date(base - 900_000) } });
    await db.financeLedgerEntry.create({ data: { id: 'p4-search-linked-sale', vendorId: vendorA,
      vendorAllocationId: 'p4-search-allocation', entryType: 'sale', amount: '120.00',
      description: 'Related sale', createdAt: new Date(base - 901_000) } });
    const { createAuthService } = await import('../backend/src/modules/auth/auth.service.js');
    const auth = createAuthService(env);
    adminToken = (await auth.login({ email: 'p4-search-admin@example.test', password }))!.token;
    vendorToken = (await auth.login({ email: 'p4-search-vendor@example.test', password }))!.token;
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

  async function get(query: Record<string, string> = {}, vendorId = vendorA, token = adminToken) {
    const params = new URLSearchParams(query);
    const response = await app.inject({ method: 'GET', url: `/finance/transactions?${params}`,
      headers: { authorization: `Bearer ${token}`, 'x-vendor-id': vendorId } });
    return { status: response.statusCode, body: response.json() as {
      vendorId: string; records: Array<{ id: string }>; hasNextPage: boolean; nextCursor: string | null; scanned: number;
    } };
  }

  async function getRecord(ledgerId: string, vendorId = vendorA, token = adminToken) {
    return app.inject({ method: 'GET', url: `/finance/transactions/${encodeURIComponent(ledgerId)}`,
      headers: { authorization: `Bearer ${token}`, 'x-vendor-id': vendorId } });
  }

  it('reads a ledger beyond page 300 by exact ID with canonical DTO and Vendor isolation', async () => {
    const ledgerCountBefore = await db.financeLedgerEntry.count();
    const historical = await getRecord('p4-search-ledger-0350');
    expect(historical.statusCode).toBe(200);
    expect(historical.json()).toMatchObject({ vendorId: vendorA, record: { id: 'p4-search-ledger-0350' } });
    const canonical = await get({ search: 'Needle after page 300' });
    expect(historical.json().record).toEqual(canonical.body.records[0]);
    expect((await getRecord('p4-search-ledger-0350', vendorA, vendorToken)).statusCode).toBe(200);
    expect((await getRecord('p4-search-b-only', vendorA, vendorToken)).statusCode).toBe(404);
    expect((await getRecord('p4-search-ledger-0350', vendorB)).statusCode).toBe(404);
    expect((await getRecord('p4-search-b-only', vendorB)).statusCode).toBe(200);
    expect((await getRecord('p4-search-void')).statusCode).toBe(404);
    const unknown = await getRecord('no-such-ledger');
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toEqual((await getRecord('p4-search-b-only')).json());
    const missingTarget = await app.inject({ method: 'GET', url: '/finance/transactions/p4-search-ledger-0350',
      headers: { authorization: `Bearer ${adminToken}` } });
    expect(missingTarget.statusCode).not.toBe(200);
    expect((await getRecord('p4-search-ledger-0350', vendorB, vendorToken)).statusCode).not.toBe(200);
    const unauthenticated = await app.inject({ method: 'GET', url: '/finance/transactions/p4-search-ledger-0350',
      headers: { 'x-vendor-id': vendorA } });
    expect(unauthenticated.statusCode).toBe(401);
    expect(await db.financeLedgerEntry.count()).toBe(ledgerCountBefore);
  });

  it('returns 100 ordered records per page, with no repeats at equal timestamps', async () => {
    const start = performance.now();
    const first = await get();
    expect(first.status).toBe(200);
    expect(first.body.records).toHaveLength(100);
    expect(first.body.hasNextPage).toBe(true);
    const second = await get({ cursor: first.body.nextCursor! });
    expect(second.status).toBe(200);
    expect(second.body.records).toHaveLength(100);
    const ids = [...first.body.records, ...second.body.records].map((row) => row.id);
    expect(new Set(ids).size).toBe(200);
    expect(ids).toEqual(Array.from({ length: 200 }, (_, index) =>
      `p4-search-ledger-${String(Math.floor(index / 2) * 2 + (index % 2 === 0 ? 1 : 0)).padStart(4, '0')}`));
    console.info(`finance search first+next: ${Math.round(performance.now() - start)} ms, ${queryCount} SQL queries`);
  });

  it('searches beyond 300 records before pagination and returns a real zero result', async () => {
    const start = performance.now();
    const found = await get({ search: 'Needle after page 300' });
    expect(found.status).toBe(200);
    expect(found.body.records.map((row) => row.id)).toEqual(['p4-search-ledger-0350']);
    expect(found.body.scanned).toBe(1002);
    expect(found.body.hasNextPage).toBe(false);
    const absent = await get({ search: 'no such ledger anywhere' });
    expect(absent.status).toBe(200);
    expect(absent.body.records).toEqual([]);
    expect(absent.body.scanned).toBe(1002);
    console.info(`finance search older+absent: ${Math.round(performance.now() - start)} ms, ${queryCount} SQL queries`);
  });

  it('preserves literal special characters, amount NBSP, and current status labels', async () => {
    expect((await get({ search: '%_' })).body.records.map((row) => row.id)).toContain('p4-search-ledger-0360');
    expect((await get({ search: 'TRY\u00a01,500.00' })).body.records.map((row) => row.id)).toContain('p4-search-ledger-0350');
    expect((await get({ search: 'Estimated' })).body.records.length).toBe(100);
    expect((await get({ search: 'Hesaplanıyor' }, vendorA, vendorToken)).body.records.length).toBe(100);
    expect((await get({ status: 'Estimated', category: 'Invoice' })).body.records.length).toBe(100);
    expect((await get({ search: '91777' })).body.records.map((row) => row.id)).toContain('p4-search-linked-refund');
    expect((await get({ search: '91888' })).body.records.map((row) => row.id)).toContain('p4-search-linked-sale');
    expect((await get({ search: 'Related refund Refund' })).body.records.map((row) => row.id)).toContain('p4-search-linked-refund');
  });

  it('completes 100 and 300-row Vendor histories with correct page boundaries', async () => {
    const hundred = await get({}, vendor100);
    expect(hundred.status).toBe(200);
    expect(hundred.body.records).toHaveLength(100);
    expect(hundred.body.hasNextPage).toBe(false);
    expect(hundred.body.scanned).toBe(100);
    const threeHundred = await get({}, vendor300);
    expect(threeHundred.status).toBe(200);
    expect(threeHundred.body.records).toHaveLength(100);
    expect(threeHundred.body.hasNextPage).toBe(true);
    expect(threeHundred.body.scanned).toBe(250);
    const last = await get({ cursor: (await get({ cursor: threeHundred.body.nextCursor! }, vendor300)).body.nextCursor! }, vendor300);
    expect(last.body.records).toHaveLength(100);
    expect(last.body.hasNextPage).toBe(false);
  });

  it('enforces Vendor ownership, active-ledger visibility and cursor binding', async () => {
    const first = await get();
    expect((await get({ search: 'Vendor B secret' })).body.records).toEqual([]);
    expect((await get({ search: 'Voided only' })).body.records).toEqual([]);
    expect((await get({ cursor: first.body.nextCursor! }, vendorB)).status).toBe(400);
    expect((await get({ cursor: first.body.nextCursor!, search: 'Needle' })).status).toBe(400);
    expect((await get({ cursor: 'not-base64' })).status).toBe(400);
    expect((await get({}, vendorB, vendorToken)).status).not.toBe(200);
    expect((await get({}, vendorA, vendorToken)).status).toBe(200);
    const unauthenticated = await app.inject({ method: 'GET', url: '/finance/transactions', headers: { 'x-vendor-id': vendorA } });
    expect(unauthenticated.statusCode).toBe(401);
  });

  it('keeps live keyset ordering after an insertion between pages', async () => {
    const first = await get();
    await db.financeLedgerEntry.create({ data: { id: 'p4-search-insert-new', vendorId: vendorA,
      entryType: 'sale', amount: '20.00', description: 'New live insert', createdAt: new Date('2026-11-02T00:00:00Z') } });
    const second = await get({ cursor: first.body.nextCursor! });
    expect(second.status).toBe(200);
    expect(second.body.records.map((row) => row.id)).not.toContain('p4-search-insert-new');
    expect(second.body.records.map((row) => row.id)).not.toContain(first.body.records[99].id);
    expect((await get()).body.records.map((row) => row.id)).toContain('p4-search-insert-new');
  });

  it('reflects changed search membership on a restarted query and preserves Overview amounts', async () => {
    const dashboard = async () => (await app.inject({ method: 'GET', url: '/finance',
      headers: { authorization: `Bearer ${adminToken}`, 'x-vendor-id': vendorA } })).json() as { summary: unknown };
    const before = await dashboard();
    expect((await get({ search: 'Needle after page 300' })).body.records.map((row) => row.id))
      .toEqual(['p4-search-ledger-0350']);
    await db.financeLedgerEntry.update({ where: { id: 'p4-search-ledger-0350' }, data: { description: 'Changed membership' } });
    expect((await get({ search: 'Needle after page 300' })).body.records).toEqual([]);
    expect((await get({ search: 'Changed membership' })).body.records.map((row) => row.id))
      .toEqual(['p4-search-ledger-0350']);
    const after = await dashboard();
    expect(after.summary).toEqual(before.summary);
    expect((await get({}, vendorB)).body.records.map((row) => row.id)).toEqual(['p4-search-b-only']);
    expect((await get()).body.records.some((row) => row.id === 'p4-search-b-only')).toBe(false);
  });
});
