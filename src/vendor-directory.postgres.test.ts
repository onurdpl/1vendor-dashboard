import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppEnv } from '../backend/src/config/env.js';
import type { PrismaClient } from '../backend/node_modules/@prisma/client/index.js';

const databaseName = 'a2_vendor_directory_pg18_20261024_8c2e4b91';
const ciDatabaseName = 'a2_vendor_directory_ci_validation';
const url = process.env.TEST_DATABASE_URL?.trim();
const vendorPrefix = 'a2-directory-pg-';
const userPrefix = 'a2-directory-pg-';
const password = 'a2-directory-isolated-test-password';
const env = {
  NODE_ENV: 'test',
  JWT_SECRET: 'a2-directory-isolated-test-jwt-secret',
  JWT_EXPIRES_IN: '1h',
  LOGIN_RATE_LIMIT_MAX_ATTEMPTS: 20,
  LOGIN_RATE_LIMIT_WINDOW_SECONDS: 60,
} as AppEnv;

type VendorFixture = {
  id: string;
  name: string;
  status: string;
  updatedAt: Date;
  createdAt: Date;
};

const vendors: VendorFixture[] = Array.from({ length: 523 }, (_, index) => ({
  id: `${vendorPrefix}${String(index).padStart(4, '0')}`,
  name: index < 6 ? 'Twin Vendor' : `Vendor ${index}`,
  status: index % 2 === 0 ? 'active' : 'inactive',
  updatedAt: index < 6
    ? new Date('2026-10-20T10:00:00.000Z')
    : new Date(Date.UTC(2026, 9, 1, 0, Math.floor(index / 7))),
  createdAt: index < 6
    ? new Date('2026-10-01T10:00:00.000Z')
    : new Date(Date.UTC(2026, 8, 1, 0, 0, index % 7)),
}));

const userIds = {
  admin: `${userPrefix}admin`,
  vendor: `${userPrefix}vendor`,
  support: `${userPrefix}support`,
  finance: `${userPrefix}finance`,
};

describe.skipIf(!url)('Admin Vendor directory pagination on disposable PostgreSQL 18', () => {
  let db: PrismaClient | undefined;
  let app: import('../backend/node_modules/fastify/types/instance.js').FastifyInstance | undefined;
  let targetVerified = false;
  let tokens: Record<keyof typeof userIds, string>;

  beforeAll(async () => {
    const target = new URL(url!);
    const ciMode = process.env.A2_DIRECTORY_CI_MODE === '1';
    const ciProof = process.env.FIN_AUTO_CI_DB_PROOF;
    const ciClusterId = process.env.FIN_AUTO_CI_CLUSTER_ID;
    const ciTarget = ciMode && process.env.GITHUB_ACTIONS === 'true' && process.env.CI === 'true'
      && target.username === 'postgres' && target.password === 'postgres'
      && target.pathname === `/${ciDatabaseName}` && process.env.FIN_AUTO_CI_PG_MAJOR === '18'
      && /^[a-f0-9]{64}$/.test(ciProof ?? '') && /^\d+$/.test(ciClusterId ?? '');
    const localTarget = process.env.A2_DIRECTORY_CI_MODE === undefined
      && process.env.GITHUB_ACTIONS !== 'true'
      && target.username === 'onur' && !target.password
      && target.pathname === `/${databaseName}`;
    if (
      process.env.A2_DIRECTORY_PG_ISOLATED !== '1'
      || target.protocol !== 'postgresql:'
      || target.hostname !== '127.0.0.1'
      || target.port !== '5432'
      || target.search !== '?schema=public'
      || !(ciTarget || localTarget)
    ) throw new Error('A2 directory PostgreSQL test refuses any unverified target.');

    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = url;
    const { PrismaClient } = await import('../backend/node_modules/@prisma/client/index.js');
    db = new PrismaClient({ datasources: { db: { url } } });
    await db.$connect();
    const [identity] = await db.$queryRaw<Array<{
      database: string; owner: string; databaseOwner: string; address: string;
      port: number; version: string; directory: string; systemId: bigint; comment: string | null;
    }>>`
      SELECT current_database() AS database, current_user AS owner,
        pg_get_userbyid(d.datdba) AS "databaseOwner", host(inet_server_addr()) AS address,
        inet_server_port() AS port, current_setting('server_version_num') AS version,
        current_setting('data_directory') AS directory,
        (pg_control_system()).system_identifier AS "systemId",
        shobj_description(d.oid, 'pg_database') AS comment
      FROM pg_database d WHERE d.datname = current_database()
    `;
    if (ciTarget) {
      expect(identity).toMatchObject({
        database: ciDatabaseName,
        owner: 'postgres',
        databaseOwner: 'postgres',
        port: 5432,
        comment: `fin-auto-ci:${ciProof}`,
      });
      expect(Math.floor(Number(identity.version) / 10000)).toBe(18);
      expect(String(identity.systemId)).toBe(ciClusterId);
      expect(identity.directory).toEqual(expect.any(String));
    } else {
      expect({ ...identity, systemId: String(identity.systemId) }).toMatchObject({
        database: databaseName,
        owner: 'onur',
        databaseOwner: 'onur',
        address: '127.0.0.1',
        port: 5432,
        version: '180003',
        directory: '/opt/homebrew/var/postgresql@18',
        systemId: '7637676237569338936',
      });
    }
    expect(await db.vendor.count()).toBe(0);
    expect(await db.user.count()).toBe(0);
    targetVerified = true;

    const { hashPasswordArgon2id } = await import('../backend/src/modules/auth/password-hashing.js');
    const passwordHash = await hashPasswordArgon2id(password);
    await db.vendor.createMany({ data: vendors });
    await db.user.createMany({ data: [
      { id: userIds.admin, email: 'a2-directory-admin@example.test', name: 'A2 Directory Admin', role: 'ADMIN', passwordHash },
      { id: userIds.vendor, email: 'a2-directory-vendor@example.test', name: 'A2 Directory Vendor', role: 'VENDOR', passwordHash },
      { id: userIds.support, email: 'a2-directory-support@example.test', name: 'A2 Directory Support', role: 'SUPPORT', passwordHash },
      { id: userIds.finance, email: 'a2-directory-finance@example.test', name: 'A2 Directory Finance', role: 'FINANCE', passwordHash },
    ] });
    await db.userVendorAccess.createMany({ data: [
      { userId: userIds.vendor, vendorId: vendors[0].id },
      { userId: userIds.support, vendorId: vendors[0].id },
      { userId: userIds.finance, vendorId: vendors[0].id },
    ] });

    const { createAuthService } = await import('../backend/src/modules/auth/auth.service.js');
    const auth = createAuthService(env);
    tokens = {} as typeof tokens;
    for (const [role, id] of Object.entries(userIds) as Array<[keyof typeof userIds, string]>) {
      const result = await auth.login({ email: `a2-directory-${role}@example.test`, password });
      expect(result).not.toBeNull();
      tokens[role] = result!.token;
      expect(result!.user.id).toBe(id);
    }

    const { default: Fastify } = await import('../backend/node_modules/fastify/fastify.js');
    const { registerVendorDirectoryRoutes } = await import('../backend/src/modules/vendors/vendor-directory.routes.js');
    app = Fastify({ logger: false });
    registerVendorDirectoryRoutes(app, env);
    await app.ready();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    if (db && targetVerified) {
      await db.userVendorAccess.deleteMany({ where: { userId: { in: Object.values(userIds) } } });
      await db.user.deleteMany({ where: { id: { in: Object.values(userIds) } } });
      await db.vendor.deleteMany({ where: { id: { startsWith: vendorPrefix } } });
      expect(await db.vendor.count()).toBe(0);
      expect(await db.user.count()).toBe(0);
    }
    await db?.$disconnect();
    const { prisma } = await import('../backend/src/db/prisma.js');
    await prisma.$disconnect();
  });

  async function get(query: Record<string, string> = {}, actor?: keyof typeof userIds) {
    const params = new URLSearchParams(query);
    const response = await app!.inject({ method: 'GET', url: `/admin/vendors${params.size ? `?${params}` : ''}`,
      headers: actor ? { authorization: `Bearer ${tokens[actor]}` } : {} });
    return { status: response.statusCode, body: response.json() as {
      vendors: Array<{ vendorId: string; vendorName: string; status: string; statusLabel: string;
        restrictionReason: string | null; restrictedAt: string | null; updatedAt: string;
        createdAt: string; profileUrl: string }>;
      hasMore: boolean; nextCursor: string | null; generatedAt: string;
      filters: { search: string | null; status: string; limit: number };
    } };
  }

  async function collect(query: Record<string, string> = {}) {
    const found: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const result = await get({ ...query, ...(cursor ? { cursor } : {}) }, 'admin');
      expect(result.status).toBe(200);
      found.push(...result.body.vendors.map((vendor) => vendor.vendorId));
      pages += 1;
      expect(result.body.hasMore).toBe(Boolean(result.body.nextCursor));
      cursor = result.body.nextCursor;
    } while (cursor && pages < 600);
    expect(pages).toBeLessThan(600);
    return { found, pages };
  }

  it('returns all 523 Vendors through bounded default pages with preserved DTO fields', async () => {
    expect(await db!.userVendorAccess.count({ where: { userId: userIds.admin } })).toBe(0);
    const first = await get({}, 'admin');
    expect(first.status).toBe(200);
    expect(first.body.vendors).toHaveLength(100);
    expect(first.body.hasMore).toBe(true);
    expect(first.body.nextCursor).toEqual(expect.any(String));
    expect(first.body.filters).toEqual({ search: null, status: 'all', limit: 100 });
    expect(first.body.vendors[0]).toEqual(expect.objectContaining({
      vendorId: expect.any(String), vendorName: expect.any(String), status: expect.any(String),
      statusLabel: expect.any(String), restrictionReason: null, restrictedAt: null,
      updatedAt: expect.any(String), createdAt: expect.any(String), profileUrl: expect.any(String),
    }));
    expect(first.body.generatedAt).toEqual(expect.any(String));
    const { found, pages } = await collect();
    expect(pages).toBe(6);
    expect(found).toHaveLength(523);
    expect(new Set(found)).toEqual(new Set(vendors.map((vendor) => vendor.id)));
    expect(new Set(found).size).toBe(523);
  });

  it('orders updatedAt, createdAt and Vendor.id deterministically across cursor boundaries', async () => {
    const { found } = await collect({ limit: '7' });
    const expected = [...vendors].sort((left, right) =>
      right.updatedAt.getTime() - left.updatedAt.getTime()
      || right.createdAt.getTime() - left.createdAt.getTime()
      || right.id.localeCompare(left.id));
    expect(found).toEqual(expected.map((vendor) => vendor.id));
    const twins = await collect({ search: 'Twin Vendor', limit: '2' });
    expect(twins.found).toEqual(vendors.slice(0, 6).map((vendor) => vendor.id).reverse());
  });

  it('paginates search and status filters without duplicates or omissions', async () => {
    for (const [query, expected] of [
      [{ status: 'active', limit: '31' }, vendors.filter((vendor) => vendor.status === 'active')],
      [{ status: 'restricted', limit: '31' }, vendors.filter((vendor) => vendor.status !== 'active')],
      [{ search: 'Vendor 51', limit: '2' }, vendors.filter((vendor) => vendor.name.includes('Vendor 51'))],
      [{ search: 'A2-DIRECTORY-PG-000', limit: '2' }, vendors.filter((vendor) => vendor.id.includes('a2-directory-pg-000'))],
    ] as const) {
      const { found } = await collect(query);
      expect(new Set(found)).toEqual(new Set(expected.map((vendor) => vendor.id)));
      expect(found).toHaveLength(expected.length);
    }
    expect((await collect({ search: 'no-matching-vendor' })).found).toEqual([]);
  });

  it('validates cursor and filter context with HTTP 400 and ends with no next cursor', async () => {
    const first = await get({ search: 'Twin Vendor', status: 'active', limit: '2' }, 'admin');
    expect(first.status).toBe(200);
    expect(first.body.nextCursor).toEqual(expect.any(String));
    const cursor = first.body.nextCursor!;
    expect((await get({ search: 'Twin Vendor', status: 'active', limit: '2', cursor }, 'admin')).status).toBe(200);
    for (const query of [
      { cursor: 'bad!' },
      { cursor: Buffer.from('{}').toString('base64url') },
      { search: 'other', status: 'active', limit: '2', cursor },
      { search: 'Twin Vendor', status: 'restricted', limit: '2', cursor },
      { search: 'Twin Vendor', status: 'active', limit: '3', cursor },
    ]) expect((await get(query, 'admin')).status).toBe(400);
    const last = await get({ search: 'Twin Vendor', status: 'active', limit: '2', cursor }, 'admin');
    expect(last.body.hasMore).toBe(false);
    expect(last.body.nextCursor).toBeNull();
  });

  it('enforces real authentication and Admin-only directory access', async () => {
    expect((await get()).status).toBe(401);
    expect((await get({}, 'admin')).status).toBe(200);
    for (const role of ['vendor', 'support', 'finance'] as const) {
      expect((await get({}, role)).status).toBe(403);
    }
  });
});
