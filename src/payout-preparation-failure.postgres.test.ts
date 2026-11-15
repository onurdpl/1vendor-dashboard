import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../backend/node_modules/@prisma/client/index.js';
import type { AppEnv } from '../backend/src/config/env.js';
const url = process.env.TEST_DATABASE_URL;
const databaseName = 'p5_06c1_failure_validation';
const appEnv = { NODE_ENV: 'test', JWT_SECRET: 'disposable-c1-jwt-key', JWT_EXPIRES_IN: '1h', LOGIN_RATE_LIMIT_MAX_ATTEMPTS: 20, LOGIN_RATE_LIMIT_WINDOW_SECONDS: 60 } as AppEnv;
const vendorA = 'c1-original-a', vendorB = 'c1-original-b';

describe.skipIf(!url)('durable payout failure history on disposable PostgreSQL 16/18', () => {
  let db: PrismaClient;
  let app: import('../backend/node_modules/fastify/types/instance.js').FastifyInstance;
  let history: typeof import('../backend/src/modules/finance/payout-preparation-failure.service.js');
  let tokens: { admin: string; vendor: string };
  beforeAll(async () => {
    const target = new URL(url!);
    const proof = process.env.FIN_AUTO_CI_DB_PROOF;
    const cluster = process.env.FIN_AUTO_CI_CLUSTER_ID;
    const ciMajor = process.env.FIN_AUTO_CI_PG_MAJOR;
    const ciTarget = process.env.P5_06C1_CI_MODE === '1' && process.env.GITHUB_ACTIONS === 'true' &&
      process.env.CI === 'true' && target.port === '5432' && target.password === 'postgres' &&
      ['16', '18'].includes(ciMajor ?? '') && /^[a-f0-9]{64}$/.test(proof ?? '') && /^\d+$/.test(cluster ?? '');
    const localTarget = process.env.P5_06C1_CI_MODE === undefined && process.env.GITHUB_ACTIONS !== 'true' &&
      ['55483', '55484'].includes(target.port);
    if (process.env.P5_06C1_TEST_DATABASE_ISOLATED !== '1' || target.protocol !== 'postgresql:' ||
        target.hostname !== '127.0.0.1' || target.username !== 'postgres' ||
        target.pathname !== `/${databaseName}` || target.search !== '?schema=public' || target.hash ||
        !(ciTarget || localTarget)) throw new Error('Unverified disposable database target.');
    process.env.NODE_ENV = 'test'; process.env.DATABASE_URL = url;
    const { PrismaClient } = await import('../backend/node_modules/@prisma/client/index.js');
    db = new PrismaClient({ datasources: { db: { url } } });
    const [identity] = await db.$queryRaw<Array<{ name: string; address: string; port: number; major: number;
      owner: string; databaseOwner: string; systemId: bigint; comment: string | null }>>`
      SELECT current_database() AS name, host(inet_server_addr()) AS address, inet_server_port() AS port,
      (current_setting('server_version_num')::integer / 10000) AS major,
      current_user AS owner, pg_get_userbyid(d.datdba) AS "databaseOwner",
      (pg_control_system()).system_identifier AS "systemId", shobj_description(d.oid, 'pg_database') AS comment
      FROM pg_database d WHERE d.datname = current_database()`;
    if (ciTarget) {
      expect(identity).toMatchObject({ name: databaseName, owner: 'postgres', databaseOwner: 'postgres',
        port: 5432, major: Number(ciMajor), comment: `fin-auto-ci:${proof}` });
      expect(String(identity.systemId)).toBe(cluster);
    } else {
      expect(identity).toMatchObject({ name: databaseName, address: '127.0.0.1', port: Number(target.port),
        major: target.port === '55483' ? 16 : 18 });
    }
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

    const { createAuthService } = await import('../backend/src/modules/auth/auth.service.js'); const auth = createAuthService(appEnv);
    tokens = { admin: (await auth.login({ email: 'c1-admin@example.test', password }))!.token,
      vendor: (await auth.login({ email: 'c1-vendor@example.test', password }))!.token };
    history = await import('../backend/src/modules/finance/payout-preparation-failure.service.js');
    const { default: Fastify } = await import('../backend/node_modules/fastify/fastify.js');
    const { registerFinanceRoutes } = await import('../backend/src/modules/finance/finance.routes.js');
    app = Fastify(); registerFinanceRoutes(app, appEnv); await app.ready();
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
    expect(Object.keys(rows[0]).sort()).toEqual(['id', 'historicalVendorId', 'occurredAt', 'classification', 'correlationReference', 'recoveryGuidance', 'status'].sort());
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

  const resolve = (id: string, payload: Record<string, unknown>, token?: string) => app.inject({
    method: 'POST', url: `/admin/payout-preparation-failures/${id}/resolve`,
    headers: token ? { authorization: `Bearer ${token}` } : {}, payload,
  });

  async function openFailure(vendor = vendorA) {
    const invocationId = randomUUID();
    await write(invocationId, vendor);
    return db.payoutPreparationFailure.findUniqueOrThrow({ where: { invocationId } });
  }

  it('resolves an OPEN failure with server actor and timestamp while preserving original and financial facts', async () => {
    const original = await openFailure();
    expect(original.status).toBe('OPEN');
    expect(await db.payoutPreparationFailureResolution.count({ where: { failureId: original.id } })).toBe(0);
    const before = await financialCounts();
    const start = Date.now();
    const response = await resolve(original.id, { reason: '  Reviewed the operation.  ' }, tokens.admin);
    expect(response.statusCode).toBe(200);
    const result = response.json();
    expect(result.status).toBe('RESOLVED');
    expect(result.events).toEqual([{ fromStatus: 'OPEN', toStatus: 'RESOLVED', actorId: 'c1-admin',
      reason: 'Reviewed the operation.', resolvedAt: expect.any(String) }]);
    const event = await db.payoutPreparationFailureResolution.findUniqueOrThrow({ where: { failureId: original.id } });
    expect(event.resolvedAt.getTime()).toBeGreaterThanOrEqual(start);
    expect(event.resolvedAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect(event.resolvedAt.toISOString()).toBe(result.events[0].resolvedAt);
    expect(await db.payoutPreparationFailure.findUnique({ where: { id: original.id } })).toEqual({ ...original, status: 'RESOLVED' });
    expect(await financialCounts()).toEqual(before);
    expect((await get(`/admin/payout-preparation-failures/${original.id}?vendorId=${vendorA}`, tokens.admin)).json()).toEqual(result);
    await expect(db.payoutPreparationFailureResolution.update({ where: { failureId: original.id },
      data: { reason: 'Overwrite' } })).rejects.toThrow(/immutable/);
    await expect(db.payoutPreparationFailureResolution.delete({ where: { failureId: original.id } })).rejects.toThrow(/immutable/);
    expect((await openFailure()).status).toBe('OPEN');
  });

  it('rejects invalid resolution inputs, missing identities and unauthorized roles', async () => {
    const failure = await openFailure();
    expect((await resolve(failure.id, { reason: 'Reviewed' })).statusCode).toBe(401);
    expect((await resolve(failure.id, { reason: 'Reviewed' }, tokens.vendor)).statusCode).toBe(403);
    for (const payload of [{}, { reason: '' }, { reason: '  \t' }, { reason: 'a'.repeat(501) },
      { reason: 'Reviewed', actorId: 'forged' }, { reason: 'Reviewed', status: 'OPEN' }]) {
      expect((await resolve(failure.id, payload, tokens.admin)).statusCode).toBe(400);
    }
    expect((await resolve('%20', { reason: 'Reviewed' }, tokens.admin)).statusCode).toBe(400);
    expect((await resolve('missing-record', { reason: 'Reviewed' }, tokens.admin)).statusCode).toBe(404);
    expect(await db.payoutPreparationFailure.findUnique({ where: { id: failure.id } })).toEqual(failure);
    expect(await db.payoutPreparationFailureResolution.count({ where: { failureId: failure.id } })).toBe(0);
  });

  it('rolls back status and event together after a failure inside the resolution transaction', async () => {
    const failure = await openFailure();
    const transaction = db.$transaction.bind(db);
    let staged = false;
    vi.spyOn(db, '$transaction').mockImplementation((async (callback: (tx: unknown) => Promise<unknown>) =>
      transaction(async (tx) => {
        await callback(tx);
        const inside = await tx.payoutPreparationFailure.findUniqueOrThrow({
          where: { id: failure.id }, include: { resolution: true },
        });
        expect(inside.status).toBe('RESOLVED');
        expect(inside.resolution?.reason).toBe('Rollback evidence');
        staged = true;
        throw new Error('synthetic rollback');
      })) as never);
    const response = await resolve(failure.id, { reason: 'Rollback evidence' }, tokens.admin);
    expect(response.statusCode).toBe(500);
    expect(staged).toBe(true);
    expect(response.json().message).toContain('could not be confirmed');
    expect(await db.payoutPreparationFailure.findUnique({ where: { id: failure.id } })).toEqual(failure);
    expect(await db.payoutPreparationFailureResolution.count({ where: { failureId: failure.id } })).toBe(0);
  });

  it('commits one authoritative event for competing Admins and refuses later overwrites or reopening', async () => {
    const failure = await openFailure(vendorB);
    const { hashPasswordArgon2id } = await import('../backend/src/modules/auth/password-hashing.js');
    const { createAuthService } = await import('../backend/src/modules/auth/auth.service.js');
    const password = 'disposable-c2-second-password';
    await db.user.create({ data: { id: 'c2-other-admin', email: 'c2-other@example.test', name: 'Second Admin',
      role: 'ADMIN', passwordHash: await hashPasswordArgon2id(password) } });
    const auth = createAuthService(appEnv);
    const other = (await auth.login({ email: 'c2-other@example.test', password }))!.token;
    const transaction = db.$transaction.bind(db);
    let entered = 0;
    let release!: () => void;
    const bothStarted = new Promise<void>((done) => { release = done; });
    const spy = vi.spyOn(db, '$transaction').mockImplementation((async (
      callback: (tx: unknown) => Promise<unknown>, options: { isolationLevel: 'ReadCommitted' },
    ) => transaction(async (tx) => {
      if (++entered === 2) release();
      await bothStarted;
      return callback(tx);
    }, options)) as never);
    const responses = await Promise.all([
      resolve(failure.id, { reason: 'First investigation' }, tokens.admin),
      resolve(failure.id, { reason: 'Second investigation' }, other),
    ]);
    spy.mockRestore();
    expect(entered).toBe(2);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 409]);
    const winnerIndex = responses.findIndex((response) => response.statusCode === 200);
    const winner = { actorId: winnerIndex === 0 ? 'c1-admin' : 'c2-other-admin',
      reason: winnerIndex === 0 ? 'First investigation' : 'Second investigation' };
    const committed = await db.payoutPreparationFailureResolution.findMany({ where: { failureId: failure.id } });
    expect(committed).toEqual([expect.objectContaining(winner)]);
    expect((await resolve(failure.id, { reason: 'Overwrite attempt' }, other)).statusCode).toBe(409);
    expect((await resolve(failure.id, { reason: 'Reopen', status: 'OPEN' }, other)).statusCode).toBe(400);
    expect(await db.payoutPreparationFailureResolution.findMany({ where: { failureId: failure.id } })).toEqual(committed);
  });

  it('keeps lifecycle state changes out of occurrence ordering and exact Vendor cursor scope', async () => {
    const failure = await openFailure(vendorB);
    const before = await history.listPayoutPreparationFailures({ vendorId: vendorB, limit: 10 });
    const target = before.items.find((row) => row.status === 'OPEN')!;
    expect(target.status).toBe('OPEN');
    expect((await resolve(target.id, { reason: 'Verified pagination' }, tokens.admin)).statusCode).toBe(200);
    const after = await history.listPayoutPreparationFailures({ vendorId: vendorB, limit: 10 });
    expect(after.nextCursor).toBe(before.nextCursor);
    expect(after.items).toEqual(before.items.map((row) => row.id === target.id ? { ...row, status: 'RESOLVED' } : row));
    const global = await history.listPayoutPreparationFailures({ limit: 50 });
    expect(new Set(global.items.map((row) => row.status))).toEqual(new Set(['OPEN', 'RESOLVED']));
    expect((await get(`/admin/payout-preparation-failures/${failure.id}?vendorId=${vendorA}`, tokens.admin)).statusCode).toBe(404);
  });
});
