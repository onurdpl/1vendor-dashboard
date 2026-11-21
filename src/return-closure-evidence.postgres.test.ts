import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const url = process.env.FIX01_TEST_DATABASE_URL;
describe.skipIf(!url && process.env.FIX01_CI_MODE === undefined)('Return closure evidence on disposable PostgreSQL 18', () => {
  let db: typeof import('../backend/src/db/prisma.js')['prisma'];
  let fixturesAuthorized = false;
  let helper: typeof import('../backend/src/modules/returns/return-closure-evidence.js');
  const date = '2026-11-19T10:00:00.000Z';
  const gid = 'gid://shopify/Return/fix01';
  const snapshot = (closedAt: string | null = date, status = 'CLOSED') => ({
    returnGid: gid, sourceShopifyReturnId: 'fix01', status, createdAt: null,
    requestApprovedAt: null, closedAt, returnLineItems: [],
  });
  const response = (item = snapshot()) => ({ orderGid: 'gid://shopify/Order/external-1', sourceShopifyOrderId: 'external-1', source: 'shopify_admin' as const, returns: [item] });
  const observe = (item = snapshot()) => helper.observeCanonicalReturnClosures(async () => response(item), '2026-01', 'external-1');
  beforeAll(async () => {
    const target = new URL(url!);
    const proof = process.env.FIN_AUTO_CI_DB_PROOF;
    const cluster = process.env.FIN_AUTO_CI_CLUSTER_ID;
    const ciTarget = process.env.FIX01_CI_MODE === '1' && process.env.GITHUB_ACTIONS === 'true' &&
      process.env.CI === 'true' && target.port === '5432' && target.password === 'postgres' &&
      process.env.FIN_AUTO_CI_PG_MAJOR === '18' && /^[a-f0-9]{64}$/.test(proof ?? '') && /^\d+$/.test(cluster ?? '');
    const localTarget = process.env.FIX01_CI_MODE === undefined && process.env.GITHUB_ACTIONS !== 'true' && target.port === '55291';
    if (process.env.FIX01_TEST_DATABASE_ISOLATED !== '1' || target.protocol !== 'postgresql:' ||
      target.hostname !== '127.0.0.1' || target.username !== 'postgres' || target.hash ||
      target.pathname !== '/fix01_closure_validation' || target.search !== '?schema=public' ||
      !(ciTarget || localTarget)) throw new Error('Unsafe closure test database');
    process.env.NODE_ENV = 'test'; process.env.DATABASE_URL = url;
    ({ prisma: db } = await import('../backend/src/db/prisma.js'));
    helper = await import('../backend/src/modules/returns/return-closure-evidence.js');
    const [identity] = await db.$queryRaw<Array<{ name: string; version: string; address: string; port: number;
      user: string; owner: string; systemId: bigint; comment: string | null }>>`
      SELECT current_database() AS name, current_setting('server_version_num') AS version,
        host(inet_server_addr()) AS address, inet_server_port() AS port, current_user AS user,
        pg_get_userbyid(d.datdba) AS owner, (pg_control_system()).system_identifier AS "systemId",
        shobj_description(d.oid, 'pg_database') AS comment
      FROM pg_database d WHERE d.datname = current_database()`;
    expect(identity.name).toBe('fix01_closure_validation'); expect(Number(identity.version)).toBeGreaterThanOrEqual(180000);
    expect(Number(identity.version)).toBeLessThan(190000);
    expect(identity.port).toBe(Number(target.port)); expect(identity.user).toBe('postgres'); expect(identity.owner).toBe('postgres');
    if (ciTarget) {
      expect(String(identity.systemId)).toBe(cluster); expect(identity.comment).toBe(`fin-auto-ci:${proof}`);
    } else {
      expect(identity.address).toBe('127.0.0.1');
    }
    expect(await db.returnRecord.count()).toBe(0); expect(await db.vendorAllocation.count()).toBe(0);
    expect(await db.shopifyOrder.count()).toBe(0); expect(await db.vendor.count()).toBe(0);
    fixturesAuthorized = true;
    for (const n of [1, 2]) {
      await db.vendor.create({ data: { id: `fix01-v${n}`, name: `Synthetic ${n}` } });
      await db.shopifyOrder.create({ data: { id: `local-${n}`, sourceShopifyOrderId: `external-${n}`, sourceShopifyOrderNumber: `#${n}` } });
      await db.vendorAllocation.create({ data: { id: `fix01-a${n}`, sourceShopifyOrderId: `local-${n}`, sourceShopifyOrderNumber: `#${n}`, originalVendorId: `fix01-v${n}`, assignedVendorId: `fix01-v${n}` } });
      await db.returnRecord.create({ data: { id: `fix01-r${n}`, vendorAllocationId: `fix01-a${n}`, sourceShopifyOrderId: `external-${n}`, sourceShopifyOrderNumber: `#${n}`, sourceShopifyReturnGid: gid, sourceShopifyReturnId: 'fix01', status: 'closed', returnLifecycleStatus: 'closed' } });
    }
  });
  afterAll(async () => {
    if (!db) return;
    if (!fixturesAuthorized) { await db.$disconnect(); return; }
    await db.returnRecord.deleteMany({ where: { id: { in: ['fix01-r1', 'fix01-r2'] } } });
    await db.vendorAllocation.deleteMany({ where: { id: { in: ['fix01-a1', 'fix01-a2'] } } });
    await db.shopifyOrder.deleteMany({ where: { id: { in: ['local-1', 'local-2'] } } });
    await db.vendor.deleteMany({ where: { id: { in: ['fix01-v1', 'fix01-v2'] } } });
    await db.$disconnect();
  });

  it('keeps historical records null and persists a canonical date without changing operational timestamps or ownership', async () => {
    const before = await db.returnRecord.findUniqueOrThrow({ where: { id: 'fix01-r1' } });
    expect(before.shopifyClosedAt).toBeNull();
    await observe();
    const after = await db.returnRecord.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.shopifyClosedAt?.toISOString()).toBe(date);
    expect(after.shopifyClosureStatus).toBe('CLOSED'); expect(after.shopifyClosureApiVersion).toBe('2026-01');
    expect(after.updatedAt).toEqual(before.updatedAt); expect(after.status).toBe(before.status); expect(after.ownerVendorId).toBe(before.ownerVendorId);
    expect((await db.returnRecord.findUniqueOrThrow({ where: { id: 'fix01-r2' } })).shopifyClosedAt).toBeNull();
  });

  it('fences an older overlapping response after a newer observation commits', async () => {
    let release!: (value: ReturnType<typeof response>) => void;
    let started!: () => void;
    const entered = new Promise<void>((resolve) => { started = resolve; });
    const older = helper.observeCanonicalReturnClosures(() => { started(); return new Promise((resolve) => { release = resolve; }); }, '2026-01', 'external-1');
    await entered;
    await observe(snapshot('2026-11-20T10:00:00.000Z'));
    const newer = await db.returnRecord.findUniqueOrThrow({ where: { id: 'fix01-r1' } });
    release(response(snapshot('2026-11-18T10:00:00.000Z'))); await older;
    const after = await db.returnRecord.findUniqueOrThrow({ where: { id: newer.id } });
    expect(after.shopifyClosedAt).toEqual(newer.shopifyClosedAt); expect(after.shopifyClosureVersion).toBe(newer.shopifyClosureVersion);
  });

  it('preserves accepted OPEN evidence despite an independent operational transaction rollback', async () => {
    await observe(snapshot(null, 'OPEN'));
    await expect(db.$transaction(async (tx) => {
      await tx.returnRecord.update({ where: { id: 'fix01-r1' }, data: { status: 'approved' } });
      throw new Error('Operational status guard rejected');
    })).rejects.toThrow('Operational status guard rejected');
    const row = await db.returnRecord.findUniqueOrThrow({ where: { id: 'fix01-r1' } });
    expect(row.status).toBe('closed'); expect(row.shopifyClosureStatus).toBe('OPEN'); expect(row.shopifyClosedAt).toBeNull();
  });

  it('distinguishes explicit null from omitted, invalid and failed observations', async () => {
    await observe();
    const before = await db.returnRecord.findUniqueOrThrow({ where: { id: 'fix01-r1' } });
    const omitted = snapshot(); delete (omitted as Partial<typeof omitted>).closedAt;
    await observe(omitted); await observe(snapshot('not-a-date'));
    await expect(helper.observeCanonicalReturnClosures(async () => { throw new Error('Canonical read failed'); }, '2026-01', 'external-1')).rejects.toThrow('Canonical read failed');
    const retained = await db.returnRecord.findUniqueOrThrow({ where: { id: before.id } });
    expect(retained.shopifyClosedAt).toEqual(before.shopifyClosedAt); expect(retained.shopifyClosureVersion).toBe(before.shopifyClosureVersion);
    await observe(snapshot(null));
    const unknown = await db.returnRecord.findUniqueOrThrow({ where: { id: before.id } });
    expect(unknown.shopifyClosureStatus).toBe('CLOSED'); expect(unknown.shopifyClosedAt).toBeNull();
  });

  it('makes duplicate application of an observation idempotent', async () => {
    const result = await observe(); const row = await db.returnRecord.findUniqueOrThrow({ where: { id: 'fix01-r1' } });
    await helper.persistReturnClosure(db, result!.returns[0], result!.orderGid);
    const after = await db.returnRecord.findUniqueOrThrow({ where: { id: row.id } });
    expect(after).toEqual(row); expect(await db.returnRecord.count()).toBe(2);
  });

  it('rejects mismatched canonical identity before persisting evidence', async () => {
    const before = await db.returnRecord.findUniqueOrThrow({ where: { id: 'fix01-r1' } });
    await expect(helper.observeCanonicalReturnClosures(async () => response(), '2026-01', 'external-2')).rejects.toThrow('identity mismatch');
    expect(await db.returnRecord.findUniqueOrThrow({ where: { id: before.id } })).toEqual(before);
  });

  it('does not persist synthetic mock-source evidence as Shopify authority', async () => {
    const before = await db.returnRecord.findUniqueOrThrow({ where: { id: 'fix01-r1' } });
    await helper.observeCanonicalReturnClosures(async () => ({ ...response(snapshot(null, 'OPEN')), source: 'mock' }), '2026-01', 'external-1');
    expect(await db.returnRecord.findUniqueOrThrow({ where: { id: before.id } })).toEqual(before);
  });
});
