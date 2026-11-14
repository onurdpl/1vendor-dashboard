import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../backend/node_modules/@prisma/client/index.js';
import type { AppEnv } from '../backend/src/config/env.js';
const url = process.env.TEST_DATABASE_URL;
const databaseName = 'p5_06c1_failure_validation';
const vendorA = 'c1-original-a', vendorB = 'c1-original-b';

describe.skipIf(!url)('durable payout failure history on disposable PostgreSQL 16/18', () => {
  let db: PrismaClient;
  let app: import('../backend/node_modules/fastify/types/instance.js').FastifyInstance;
  let history: typeof import('../backend/src/modules/finance/payout-preparation-failure.service.js');
  let tokens: { admin: string; vendor: string };
  beforeAll(async () => {
    const target = new URL(url!);
    if (process.env.P5_06C1_TEST_DATABASE_ISOLATED !== '1' || target.protocol !== 'postgresql:' ||
        target.hostname !== '127.0.0.1' || !['55483', '55484'].includes(target.port) || target.username !== 'postgres' ||
        target.pathname !== `/${databaseName}` || target.search !== '?schema=public') throw new Error('Unverified disposable database target.');
    process.env.NODE_ENV = 'test'; process.env.DATABASE_URL = url;
    const { PrismaClient } = await import('../backend/node_modules/@prisma/client/index.js');
    db = new PrismaClient({ datasources: { db: { url } } });
    const [identity] = await db.$queryRaw<Array<{ name: string; address: string; port: number; major: number }>>`
      SELECT current_database() AS name, host(inet_server_addr()) AS address, inet_server_port() AS port,
      (current_setting('server_version_num')::integer / 10000) AS major`;
    expect(identity).toEqual({ name: databaseName, address: '127.0.0.1', port: Number(target.port), major: target.port === '55483' ? 16 : 18 });
    expect(await db.vendor.count()).toBe(0); expect(await db.payoutPreparationFailure.count()).toBe(0);
    (globalThis as { prisma?: PrismaClient }).prisma = db;
    await db.vendor.createMany({ data: [{ id: vendorA, name: 'Original A' }, { id: vendorB, name: 'Original B' }] });
    const { hashPasswordArgon2id } = await import('../backend/src/modules/auth/password-hashing.js');
    const password = 'disposable-c1-password'; const passwordHash = await hashPasswordArgon2id(password);
    await db.user.createMany({ data: [
      { id: 'c1-admin', email: 'c1-admin@example.test', name: 'C1 Admin', role: 'ADMIN', passwordHash },
      { id: 'c1-vendor', email: 'c1-vendor@example.test', name: 'C1 Vendor', role: 'VENDOR', passwordHash },
    ] });
    await db.userVendorAccess.create({ data: { userId: 'c1-vendor', vendorId: vendorA } });
    const env = { NODE_ENV: 'test', JWT_SECRET: 'disposable-c1-jwt-key', JWT_EXPIRES_IN: '1h', LOGIN_RATE_LIMIT_MAX_ATTEMPTS: 20, LOGIN_RATE_LIMIT_WINDOW_SECONDS: 60 } as AppEnv;
    const { createAuthService } = await import('../backend/src/modules/auth/auth.service.js'); const auth = createAuthService(env);
    tokens = { admin: (await auth.login({ email: 'c1-admin@example.test', password }))!.token,
      vendor: (await auth.login({ email: 'c1-vendor@example.test', password }))!.token };
    history = await import('../backend/src/modules/finance/payout-preparation-failure.service.js');
    const { default: Fastify } = await import('../backend/node_modules/fastify/fastify.js');
    const { registerFinanceRoutes } = await import('../backend/src/modules/finance/finance.routes.js');
    app = Fastify(); registerFinanceRoutes(app, env); await app.ready();
  }, 120000);
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => { await app?.close(); await db?.$disconnect(); delete (globalThis as { prisma?: PrismaClient }).prisma; });
  const get = (path: string, token?: string) => app.inject({ method: 'GET', url: path, headers: token ? { authorization: `Bearer ${token}` } : {} });
  const write = (invocationId = randomUUID(), verifiedVendorId = vendorA) => history.recordPayoutPreparationFailure({ invocationId, verifiedVendorId, correlationReference: 'safe-request-1' });

  it('records genuine database rollbacks after original Vendor verification without financial writes', async () => {
    const before = await financialCounts();
    const initial = await db.payoutPreparationFailure.count();
    const transaction = db.$transaction.bind(db);
    let attempts = 0;
    // Fault injection at a read boundary AFTER the actual Vendor lock. The
    // rollback and SQLSTATE classification are provided by real PostgreSQL.
    vi.spyOn(db, '$transaction').mockImplementation((async (callback: (tx: unknown) => unknown, options: unknown) => {
      attempts++;
      return transaction(async (tx) => callback(new Proxy(tx, { get(target, key) {
        if (key === 'payoutOffsetClaim') return { count: () => tx.$executeRawUnsafe("DO $$ BEGIN RAISE EXCEPTION 'synthetic conflict' USING ERRCODE = '40001'; END $$") };
        const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
      } })), options as never);
    }) as never);
    for (let index = 0; index < 2; index++) {
      const result = await app.inject({ method: 'POST', url: '/admin/payout-batches/prepare',
        headers: { authorization: `Bearer ${tokens.admin}` }, payload: { vendorId: vendorA } });
      expect(result.statusCode).toBe(400);
      expect(result.json()).toEqual({ message: 'Payout preparation stopped because financial state changed concurrently. Refresh payment preparation and try again.' });
    }
    expect(attempts).toBe(4);
    expect(await db.payoutPreparationFailure.count()).toBe(initial + 2);
    const rows = await db.payoutPreparationFailure.findMany();
    expect(rows.every((row) => row.historicalVendorId === vendorA)).toBe(true);
    expect(new Set(rows.map((row) => row.invocationId)).size).toBe(2);
    expect(await financialCounts()).toEqual(before);
  });
  async function financialCounts() {
    return Promise.all([db.payoutBatch.count(), db.payoutBatchLine.count(), db.settlementApproval.count(),
      db.financeLedgerEntry.count(), db.vendorBalanceEvent.count(), db.financeEvent.count()]);
  }
  it('enforces concurrent duplicate idempotency and preserves original facts on conflicting replay', async () => {
    const id = randomUUID(); const before = await db.payoutPreparationFailure.count();
    await Promise.all([write(id), write(id), write(id)]);
    const original = await db.payoutPreparationFailure.findUniqueOrThrow({ where: { invocationId: id } });
    await write(id, vendorB);
    expect(await db.payoutPreparationFailure.count()).toBe(before + 1);
    expect(await db.payoutPreparationFailure.findUniqueOrThrow({ where: { invocationId: id } })).toEqual(original);
  });
  it('keeps historical identity when supported Vendor rename and deactivation occur', async () => {
    const id = randomUUID(); await write(id);
    await db.vendor.update({ where: { id: vendorA }, data: { name: 'Renamed A', status: 'inactive' } });
    expect((await db.payoutPreparationFailure.findUniqueOrThrow({ where: { invocationId: id } })).historicalVendorId).toBe(vendorA);
    await db.vendor.update({ where: { id: vendorA }, data: { status: 'active' } });
    const fks = await db.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM pg_constraint WHERE conrelid = '"PayoutPreparationFailure"'::regclass AND contype = 'f'`;
    expect(Number(fks[0].count)).toBe(0);
  });
  it('provides stable newest-first keyset pages with identical timestamps and exact Vendor scope', async () => {
    const time = new Date('2026-11-15T00:00:00.000Z');
    await db.payoutPreparationFailure.createMany({ data: Array.from({ length: 125 }, (_, i) => ({
      id: `cursor-${String(i).padStart(3, '0')}`, invocationId: randomUUID(), historicalVendorId: i % 2 ? vendorA : vendorB,
      occurredAt: time, classification: history.PAYOUT_PREPARATION_FAILURE_CLASSIFICATION })) });
    const first = await history.listPayoutPreparationFailures({ vendorId: vendorB, limit: 50 });
    const second = await history.listPayoutPreparationFailures({ vendorId: vendorB, limit: 50, cursor: first.nextCursor! });
    expect(first.items).toHaveLength(50); expect(second.items).toHaveLength(13); expect(second.nextCursor).toBeNull();
    const ids = [...first.items, ...second.items].map((row) => row.id);
    expect(new Set(ids).size).toBe(63); expect(ids).toEqual([...ids].sort().reverse());
    expect(first.items.every((row) => row.historicalVendorId === vendorB)).toBe(true);
    await expect(history.listPayoutPreparationFailures({ vendorId: vendorA, limit: 25, cursor: first.nextCursor! })).rejects.toThrow('Invalid history cursor');
    await expect(history.listPayoutPreparationFailures({ limit: 25, cursor: first.nextCursor! })).rejects.toThrow('Invalid history cursor');
    expect(await history.listPayoutPreparationFailures({ vendorId: vendorB, limit: 50 })).toEqual(first);
  });
  it('enforces authenticated Admin-only list and detail access using real session verification', async () => {
    const id = (await db.payoutPreparationFailure.findFirstOrThrow()).id;
    for (const path of ['/admin/payout-preparation-failures', `/admin/payout-preparation-failures/${id}`]) {
      expect((await get(path)).statusCode).toBe(401);
      expect((await get(path, tokens.vendor)).statusCode).toBe(403);
      expect((await get(path, tokens.admin)).statusCode).toBe(200);
    }
    expect((await get(`/admin/payout-preparation-failures/${id}?vendorId=unknown`, tokens.admin)).statusCode).toBe(404);
    expect((await get('/admin/payout-preparation-failures/unknown', tokens.admin)).statusCode).toBe(404);
    const rows = (await get('/admin/payout-preparation-failures?vendorId=c1-original-b', tokens.admin)).json().items;
    expect(rows.length).toBeGreaterThan(0); expect(rows.every((row: { historicalVendorId: string }) => row.historicalVendorId === vendorB)).toBe(true);
    expect(Object.keys(rows[0]).sort()).toEqual(['id', 'historicalVendorId', 'occurredAt', 'classification', 'correlationReference', 'recoveryGuidance'].sort());
  });
  it('rejects malformed cursors and filters and returns empty unknown Vendor scope', async () => {
    for (const query of ['cursor=bad!', 'cursor=abc', 'limit=0', 'vendorId=a&vendorId=b', 'limit=51']) {
      expect((await get(`/admin/payout-preparation-failures?${query}`, tokens.admin)).statusCode).toBe(400);
    }
    expect((await get('/admin/payout-preparation-failures?vendorId=unknown', tokens.admin)).json()).toEqual({ items: [], nextCursor: null });
  });
  it('does not record ordinary business rejection, missing Vendor or unverified conflict', async () => {
    const before = await db.payoutPreparationFailure.count();
    expect((await app.inject({ method: 'POST', url: '/admin/payout-batches/prepare', headers: { authorization: `Bearer ${tokens.admin}` }, payload: { vendorId: vendorA } })).statusCode).toBe(400);
    const transaction = db.$transaction.bind(db);
    vi.spyOn(db, '$transaction').mockImplementation((async (callback: (tx: unknown) => unknown, options: unknown) => transaction(async (tx) => callback(new Proxy(tx, { get(target, key) {
      if (key === '$queryRaw') return () => tx.$executeRawUnsafe("DO $$ BEGIN RAISE EXCEPTION 'synthetic conflict before verification' USING ERRCODE = '40001'; END $$");
      const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
    } })), options as never)) as never);
    expect((await app.inject({ method: 'POST', url: '/admin/payout-batches/prepare', headers: { authorization: `Bearer ${tokens.admin}` }, payload: { vendorId: 'unknown' } })).statusCode).toBe(400);
    expect(await db.payoutPreparationFailure.count()).toBe(before);
  });
  it('does not persist unsafe correlation data or change financial state', async () => {
    const before = await financialCounts(); const id = randomUUID();
    await history.recordPayoutPreparationFailure({ invocationId: id, verifiedVendorId: vendorB, correlationReference: 'unsafe cookie=secret' });
    expect((await db.payoutPreparationFailure.findUniqueOrThrow({ where: { invocationId: id } })).correlationReference).toBeNull();
    expect(await financialCounts()).toEqual(before);
  });
});
