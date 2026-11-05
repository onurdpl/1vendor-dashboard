import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppEnv } from '../backend/src/config/env.js';
import type { PrismaClient } from '../backend/node_modules/@prisma/client/index.js';

const url = process.env.TEST_DATABASE_URL?.trim();
const databaseName = 'p4_02a_return_auth_20261105';
const prefix = 'p4-02a-';
const roles = ['admin', 'vendor', 'restricted', 'support', 'finance', 'supportNoAccess', 'financeNoAccess'] as const;
type Role = typeof roles[number];
const env = {
  NODE_ENV: 'test', JWT_SECRET: 'p4-02a-isolated-return-auth-secret', JWT_EXPIRES_IN: '1h',
  LOGIN_RATE_LIMIT_MAX_ATTEMPTS: 20, LOGIN_RATE_LIMIT_WINDOW_SECONDS: 60,
} as AppEnv;

describe.skipIf(!url || process.env.P4_02A_PG_ISOLATED !== '1')('Return action authority on isolated PostgreSQL 18 and authenticated HTTP', () => {
  let db: PrismaClient;
  let app: import('../backend/node_modules/fastify/types/instance.js').FastifyInstance;
  let verified = false;
  let tokens: Record<Role, string>;
  const vendor = { a: `${prefix}vendor-a`, b: `${prefix}vendor-b`, restricted: `${prefix}vendor-restricted` };
  const returns = { a: `${prefix}return-a`, b: `${prefix}return-b`, restricted: `${prefix}return-restricted` };

  beforeAll(async () => {
    const target = new URL(url!);
    if (process.env.P4_02A_PG_ISOLATED !== '1' || process.env.GITHUB_ACTIONS === 'true'
      || target.protocol !== 'postgresql:' || target.hostname !== '127.0.0.1'
      || target.port !== '5432' || target.username !== 'onur' || target.password
      || target.pathname !== `/${databaseName}` || target.search !== '?schema=public') {
      throw new Error('P4-02A refuses an unverified or nonlocal PostgreSQL target.');
    }
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = url;
    const { PrismaClient } = await import('../backend/node_modules/@prisma/client/index.js');
    db = new PrismaClient({ datasources: { db: { url } } });
    await db.$connect();
    const [identity] = await db.$queryRaw<Array<{ database: string; owner: string; databaseOwner: string;
      address: string; port: number; version: string; directory: string; systemId: bigint }>>`
      SELECT current_database() AS database, current_user AS owner,
        pg_get_userbyid(d.datdba) AS "databaseOwner", host(inet_server_addr()) AS address,
        inet_server_port() AS port, current_setting('server_version_num') AS version,
        current_setting('data_directory') AS directory,
        (pg_control_system()).system_identifier AS "systemId"
      FROM pg_database d WHERE d.datname = current_database()
    `;
    expect({ ...identity, systemId: String(identity.systemId) }).toMatchObject({
      database: databaseName, owner: 'onur', databaseOwner: 'onur', address: '127.0.0.1',
      port: 5432, version: '180003', directory: '/opt/homebrew/var/postgresql@18',
      systemId: '7637676237569338936',
    });
    expect(await db.vendor.count()).toBe(0);
    expect(await db.user.count()).toBe(0);
    expect(await db.returnRecord.count()).toBe(0);
    verified = true;

    const { hashPasswordArgon2id } = await import('../backend/src/modules/auth/password-hashing.js');
    const password = 'p4-02a-isolated-password';
    const passwordHash = await hashPasswordArgon2id(password);
    await db.vendor.createMany({ data: [
      { id: vendor.a, name: 'P4 A' }, { id: vendor.b, name: 'P4 B' },
      { id: vendor.restricted, name: 'P4 Restricted', status: 'restricted' },
    ] });
    await db.user.createMany({ data: roles.map((role) => ({
      id: `${prefix}user-${role}`, email: `${prefix}${role.toLowerCase()}@example.test`,
      name: `P4 ${role}`, role: role.startsWith('support') ? 'SUPPORT' as const
        : role.startsWith('finance') ? 'FINANCE' as const
        : role === 'restricted' ? 'VENDOR' as const : role.toUpperCase() as 'ADMIN' | 'VENDOR',
      passwordHash,
    })) });
    await db.userVendorAccess.createMany({ data: [
      { userId: `${prefix}user-vendor`, vendorId: vendor.a },
      { userId: `${prefix}user-restricted`, vendorId: vendor.restricted },
      { userId: `${prefix}user-support`, vendorId: vendor.a },
      { userId: `${prefix}user-finance`, vendorId: vendor.a },
    ] });
    for (const [key, vendorId] of Object.entries(vendor) as Array<[keyof typeof vendor, string]>) {
      const orderId = `${prefix}order-${key}`;
      const allocationId = `${prefix}allocation-${key}`;
      await db.shopifyOrder.create({ data: { id: orderId, sourceShopifyOrderId: orderId,
        sourceShopifyOrderNumber: `#${key}` } });
      await db.vendorAllocation.create({ data: { id: allocationId, sourceShopifyOrderId: orderId,
        sourceShopifyOrderNumber: `#${key}`, originalVendorId: vendorId, assignedVendorId: vendorId } });
      await db.returnRecord.create({ data: { id: returns[key], vendorAllocationId: allocationId,
        sourceShopifyOrderId: orderId, sourceShopifyOrderNumber: `#${key}`,
        status: 'requested', returnLifecycleStatus: 'requested', returnRequestSource: 'shopify_return_request',
        ...(key === 'restricted' ? { vendorReceivedAt: new Date('2026-11-01T00:00:00Z') } : {}),
      } });
    }
    const { createAuthService } = await import('../backend/src/modules/auth/auth.service.js');
    const auth = createAuthService(env);
    tokens = {} as Record<Role, string>;
    for (const role of roles) {
      const result = await auth.login({ email: `${prefix}${role.toLowerCase()}@example.test`, password });
      expect(result).not.toBeNull();
      tokens[role] = result!.token;
    }
    const { default: Fastify } = await import('../backend/node_modules/fastify/fastify.js');
    const { registerReturnsRoutes } = await import('../backend/src/modules/returns/returns.routes.js');
    app = Fastify({ logger: false });
    registerReturnsRoutes(app, env);
    await app.ready();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    if (db && verified) {
      await db.returnRecord.deleteMany({ where: { id: { startsWith: prefix } } });
      await db.vendorAllocation.deleteMany({ where: { id: { startsWith: prefix } } });
      await db.shopifyOrder.deleteMany({ where: { id: { startsWith: prefix } } });
      await db.userVendorAccess.deleteMany({ where: { userId: { startsWith: prefix } } });
      await db.user.deleteMany({ where: { id: { startsWith: prefix } } });
      await db.vendor.deleteMany({ where: { id: { startsWith: prefix } } });
      expect(await db.returnRecord.count()).toBe(0);
      expect(await db.vendorAllocation.count()).toBe(0);
      expect(await db.shopifyOrder.count()).toBe(0);
      expect(await db.userVendorAccess.count()).toBe(0);
      expect(await db.user.count()).toBe(0);
      expect(await db.vendor.count()).toBe(0);
    }
    await db?.$disconnect();
    const { prisma } = await import('../backend/src/db/prisma.js');
    await prisma.$disconnect();
  });

  const path = (id: string, action: string) => `/returns/${id}/${action}`;
  async function post(role: Role | null, id: string, action: string, vendorId?: string, body?: object) {
    return app.inject({ method: 'POST', url: path(id, action),
      headers: { ...(role ? { authorization: `Bearer ${tokens[role]}` } : {}),
        ...(vendorId ? { 'x-vendor-id': vendorId } : {}) }, payload: body ?? {} });
  }
  async function state(id: string) {
    return db.returnRecord.findUniqueOrThrow({ where: { id }, select: {
      vendorReceivedAt: true, vendorReviewedAt: true, vendorDecision: true,
      vendorDecisionReason: true, returnProviderSnapshot: true, returnTrackingNumber: true, returnLabel: true,
    } });
  }

  it('allows Admin without membership and Vendor with matching membership and ownership', async () => {
    expect(await db.userVendorAccess.count({ where: { userId: `${prefix}user-admin` } })).toBe(0);
    expect((await post('admin', returns.b, 'mark-received')).statusCode).toBe(200);
    expect((await post('admin', returns.b, 'review', undefined, { decision: 'approved' })).statusCode).toBe(200);
    expect((await state(returns.b)).vendorDecision).toBe('approved');
    expect((await post('vendor', returns.a, 'mark-received', vendor.a)).statusCode).toBe(200);
    expect((await post('vendor', returns.a, 'review', vendor.a, { decision: 'rejected', reason: 'Inspection' })).statusCode).toBe(200);
    expect((await state(returns.a)).vendorDecision).toBe('rejected');
  });

  it('denies Support and Finance with membership and preserves database state', async () => {
    for (const role of ['support', 'finance'] as const) {
      const before = await state(returns.a);
      for (const [action, body] of [['mark-received', {}], ['review', { decision: 'approved' }]] as const) {
        expect((await post(role, returns.a, action, vendor.a, body)).statusCode).toBe(403);
        expect(await state(returns.a)).toEqual(before);
      }
    }
  });

  it('denies actors without membership, unauthenticated requests, foreign ownership and restricted Vendor', async () => {
    for (const role of ['supportNoAccess', 'financeNoAccess'] as const) {
      for (const action of ['mark-received', 'review']) {
        expect((await post(role, returns.a, action, vendor.a, { decision: 'approved' })).statusCode).toBe(403);
      }
    }
    for (const action of ['mark-received', 'review']) {
      expect((await post(null, returns.a, action, vendor.a, { decision: 'approved' })).statusCode).toBe(401);
      expect((await post('vendor', returns.b, action, vendor.a, { decision: 'approved' })).statusCode).toBe(404);
      expect((await post('restricted', returns.restricted, action, vendor.restricted, { decision: 'approved' })).statusCode).toBe(403);
    }
    expect((await state(returns.restricted)).vendorDecision).toBeNull();
  });

  it('preserves receipt, decision and rejection-reason lifecycle checks', async () => {
    expect((await post('vendor', returns.a, 'review', vendor.a, { decision: 'invalid' })).statusCode).toBe(400);
    expect((await post('vendor', returns.a, 'review', vendor.a, { decision: 'rejected' })).statusCode).toBe(400);
    const fresh = await db.returnRecord.create({ data: { id: `${prefix}return-unreceived`,
      vendorAllocationId: `${prefix}allocation-a`, sourceShopifyOrderId: `${prefix}order-a`,
      sourceShopifyOrderNumber: '#a', status: 'requested', returnLifecycleStatus: 'requested' } });
    expect((await post('vendor', fresh.id, 'review', vendor.a, { decision: 'approved' })).statusCode).toBe(409);
  });

  it('blocks provider refresh for every non-Admin role before any evidence write', async () => {
    const before = await state(returns.a);
    for (const role of ['vendor', 'support', 'finance'] as const) {
      expect((await post(role, returns.a, 'kargonomi-refresh-provider-data', vendor.a)).statusCode).toBe(403);
      expect(await state(returns.a)).toEqual(before);
    }
    expect((await post('admin', returns.a, 'kargonomi-refresh-provider-data')).statusCode).toBe(400);
    expect(await state(returns.a)).toEqual(before);
  });

  it('keeps existing shipment creation and manual Shopify sync Admin-only', async () => {
    const before = await state(returns.a);
    for (const action of ['kargonomi-create-shipment', 'shopify-return-sync']) {
      expect((await post('vendor', returns.a, action, vendor.a)).statusCode).toBe(403);
      expect(await state(returns.a)).toEqual(before);
    }
  });
});
