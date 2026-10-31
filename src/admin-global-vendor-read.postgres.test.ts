import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppEnv } from '../backend/src/config/env.js';
import type { PrismaClient } from '../backend/node_modules/@prisma/client/index.js';

const url = process.env.TEST_DATABASE_URL?.trim();
const databaseName = 'a2_admin_read_20261023_6e2b0c7a';
const vendorIds = { a: 'a2-test-a', b: 'a2-test-b', c: 'a2-test-c', d: 'a2-test-d' };
const userIds = { admin: 'a2-test-admin', adminLinked: 'a2-test-admin-linked', vendorA: 'a2-test-vendor-a',
  vendorB: 'a2-test-vendor-b', support: 'a2-test-support', finance: 'a2-test-finance' };
const password = 'a2-isolated-only-password';
const env = { NODE_ENV: 'test', JWT_SECRET: 'a2-local-isolated-route-validation-secret', JWT_EXPIRES_IN: '1h',
  LOGIN_RATE_LIMIT_MAX_ATTEMPTS: 20, LOGIN_RATE_LIMIT_WINDOW_SECONDS: 60,
  SHOPIFY_MOCK_SELLER_INFO: undefined } as AppEnv;

describe.skipIf(!url)('A2 Admin global vendor reads against isolated real PostgreSQL', () => {
  let db: PrismaClient;
  let app: import('../backend/node_modules/fastify/types/instance.js').FastifyInstance;
  let resolver: typeof import('../backend/src/modules/vendor-access/admin-vendor-target.service.js')['resolveAdminVendorTarget'];
  let authUsers: Record<keyof typeof userIds, { id: string; email: string; name: string; role: 'admin' | 'vendor' | 'support' | 'finance'; status: string }>;
  let tokens: Record<keyof typeof userIds, string>;

  beforeAll(async () => {
    const target = new URL(url!);
    if (process.env.A2_REAL_PG_TEST_ISOLATED !== '1' || target.protocol !== 'postgresql:' ||
        target.hostname !== '127.0.0.1' || target.port !== '5432' || target.username !== 'onur' ||
        target.password || target.pathname !== `/${databaseName}` ||
        target.search !== '?schema=public') {
      throw new Error('A2 real-PostgreSQL test requires its exact dedicated local database and explicit authorization.');
    }
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = url;
    process.env.SETTLEMENT_AUTO_DRAFT_JOB_ENABLED = 'false';
    process.env.SETTLEMENT_AUTO_DRAFT_SCHEDULER_ENABLED = 'false';
    process.env.SETTLEMENT_AUTO_DRAFT_WRITE_SCHEDULER_ENABLED = 'false';
    process.env.SETTLEMENT_AUTO_APPROVAL_SCHEDULER_ENABLED = 'false';
    process.env.SHOPIFY_ORDERS_CREATE_EXECUTOR_ENABLED = 'false';
    process.env.CUSTOMER_CANCELLATION_AUTO_REFUND_ENABLED = 'false';
    process.env.SCHEDULED_RECONCILIATION_ENABLED = 'false';
    process.env.CANONICAL_RECONCILIATION_ENABLED = 'false';
    process.env.SOPYO_DELIVERY_POLLING_ENABLED = 'false';
    process.env.SOPYO_ORDER_PUSH_WORKER_ENABLED = 'false';
    process.env.SHIPPING_EXECUTION_ENABLED = 'false';
    const { PrismaClient } = await import('../backend/node_modules/@prisma/client/index.js');
    db = new PrismaClient({ datasources: { db: { url } } });
    await db.$connect();
    const [identity] = await db.$queryRaw<Array<{ database: string; owner: string; address: string;
      port: number; version: string; directory: string; systemId: bigint; databaseOwner: string }>>`
      SELECT current_database() AS database, current_user AS owner, host(inet_server_addr()) AS address,
        inet_server_port() AS port, current_setting('server_version_num') AS version,
        current_setting('data_directory') AS directory,
        (pg_control_system()).system_identifier AS "systemId",
        pg_get_userbyid(d.datdba) AS "databaseOwner" FROM pg_database d WHERE d.datname = current_database()
    `;
    expect({ ...identity, systemId: String(identity.systemId) }).toMatchObject({
      database: databaseName, owner: 'onur', databaseOwner: 'onur', address: '127.0.0.1', port: 5432,
      version: '180003', directory: '/opt/homebrew/var/postgresql@18', systemId: '7637676237569338936',
    });
    expect(await db.vendor.count()).toBe(0);
    expect(await db.user.count()).toBe(0);
    expect(await db.shopifyOrder.count()).toBe(0);
    expect(await db.vendorAllocation.count()).toBe(0);
    expect(await db.financeLedgerEntry.count()).toBe(0);

    const { hashPasswordArgon2id } = await import('../backend/src/modules/auth/password-hashing.js');
    const passwordHash = await hashPasswordArgon2id(password);
    await db.vendor.createMany({ data: [
      { id: vendorIds.a, name: 'A2 Vendor A' }, { id: vendorIds.b, name: 'A2 Vendor B' },
      { id: vendorIds.c, name: 'A2 Vendor C', status: 'restricted' }, { id: vendorIds.d, name: 'A2 Empty Vendor' },
    ] });
    await db.user.createMany({ data: [
      { id: userIds.admin, email: 'a2-admin@example.test', name: 'A2 Admin', role: 'ADMIN', passwordHash },
      { id: userIds.adminLinked, email: 'a2-admin-linked@example.test', name: 'A2 Linked Admin', role: 'ADMIN', passwordHash },
      { id: userIds.vendorA, email: 'a2-vendor-a@example.test', name: 'A2 Vendor A User', role: 'VENDOR', passwordHash },
      { id: userIds.vendorB, email: 'a2-vendor-b@example.test', name: 'A2 Vendor B User', role: 'VENDOR', passwordHash },
      { id: userIds.support, email: 'a2-support@example.test', name: 'A2 Support', role: 'SUPPORT', passwordHash },
      { id: userIds.finance, email: 'a2-finance@example.test', name: 'A2 Finance', role: 'FINANCE', passwordHash },
    ] });
    await db.userVendorAccess.createMany({ data: [
      { userId: userIds.adminLinked, vendorId: vendorIds.b },
      { userId: userIds.vendorA, vendorId: vendorIds.a }, { userId: userIds.vendorB, vendorId: vendorIds.b },
      { userId: userIds.support, vendorId: vendorIds.a }, { userId: userIds.finance, vendorId: vendorIds.a },
    ] });
    for (const [id, originalVendorId, assignedVendorId] of [
      ['a1', vendorIds.a, vendorIds.a], ['a2', vendorIds.a, vendorIds.a], ['b1', vendorIds.a, vendorIds.b],
    ]) {
      const orderId = `a2-test-order-${id}`;
      await db.shopifyOrder.create({ data: { id: orderId,
        sourceShopifyOrderId: `gid://shopify/Order/a2-${id}`, sourceShopifyOrderNumber: `#a2-${id}` } });
      await db.vendorAllocation.create({ data: { id: `a2-test-allocation-${id}`, sourceShopifyOrderId: orderId,
        sourceShopifyOrderNumber: `#a2-${id}`, originalVendorId, assignedVendorId } });
    }
    const { createAuthService } = await import('../backend/src/modules/auth/auth.service.js');
    const auth = createAuthService(env);
    tokens = {} as typeof tokens;
    authUsers = {} as typeof authUsers;
    for (const [key, id] of Object.entries(userIds) as Array<[keyof typeof userIds, string]>) {
      const email = (await db.user.findUniqueOrThrow({ where: { id }, select: { email: true } })).email;
      const result = await auth.login({ email, password });
      expect(result).not.toBeNull();
      tokens[key] = result!.token;
      authUsers[key] = { id, email, name: result!.user.name, role: result!.user.role, status: result!.user.status };
    }
    const { default: Fastify } = await import('../backend/node_modules/fastify/fastify.js');
    const { registerDashboardSummaryRoutes } = await import('../backend/src/modules/dashboard/dashboard-summary.routes.js');
    const { registerOrdersRoutes } = await import('../backend/src/modules/orders/orders.routes.js');
    ({ resolveAdminVendorTarget: resolver } = await import('../backend/src/modules/vendor-access/admin-vendor-target.service.js'));
    app = Fastify({ logger: false });
    registerDashboardSummaryRoutes(app, env);
    registerOrdersRoutes(app, env);
    await app.ready();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await db?.$disconnect();
    const { prisma } = await import('../backend/src/db/prisma.js');
    await prisma.$disconnect();
  });

  async function get(path: string, actor?: keyof typeof userIds, vendorId?: string, headers: Record<string, string> = {}) {
    const response = await app.inject({ method: 'GET', url: path,
      headers: { ...(actor ? { authorization: `Bearer ${tokens[actor]}` } : {}),
        ...(vendorId !== undefined ? { 'x-vendor-id': vendorId } : {}), ...headers } });
    return { status: response.statusCode, body: response.json() as any };
  }

  it('Phase A resolves every real Vendor for a zero-membership Admin but not non-Admins', async () => {
    expect(await db.userVendorAccess.count({ where: { userId: userIds.admin } })).toBe(0);
    for (const vendorId of Object.values(vendorIds)) {
      const result = await resolver({ authUser: authUsers.admin }, vendorId);
      expect(result).toMatchObject({ ok: true, vendor: { id: vendorId } });
    }
    expect(await resolver({ authUser: authUsers.admin }, 'does-not-exist')).toMatchObject({ ok: false, code: 404 });
    expect(await resolver({ authUser: authUsers.admin }, '')).toMatchObject({ ok: false, code: 400 });
    for (const actor of ['vendorA', 'support', 'finance'] as const) {
      expect(await resolver({ authUser: authUsers[actor] }, vendorIds.a)).toMatchObject({ ok: false, code: 403 });
    }
  });

  it('B1 returns only assigned-Vendor operational counts for Admin A/B/C/D', async () => {
    for (const [vendorId, total] of [[vendorIds.a, 2], [vendorIds.b, 1], [vendorIds.c, 0], [vendorIds.d, 0]] as const) {
      const response = await get('/dashboard/summary', 'admin', vendorId);
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ vendorId, orders: { total } });
    }
    expect((await get('/dashboard/summary', 'admin', 'does-not-exist')).status).toBe(404);
    expect((await get('/dashboard/summary', 'admin')).status).toBe(400);
    expect((await get('/dashboard/summary', 'admin', 'a,b')).status).toBe(400);
    expect((await get('/dashboard/summary')).status).toBe(401);
  });

  it('B2 returns assigned allocations, original owner, pagination and workflow counts', async () => {
    const a = await get('/orders', 'admin', vendorIds.a);
    const b = await get('/orders', 'admin', vendorIds.b);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.map((row: { id: string }) => row.id).sort()).toEqual(['a2-test-allocation-a1', 'a2-test-allocation-a2']);
    expect(b.body).toEqual([expect.objectContaining({ id: 'a2-test-allocation-b1',
      assignedVendorId: vendorIds.b, originalVendorId: vendorIds.a })]);
    expect((await get('/orders?limit=1&offset=1', 'admin', vendorIds.a)).body).toHaveLength(1);
    expect((await get('/orders', 'admin', vendorIds.d)).body).toEqual([]);
    expect((await get('/orders/workflow-summary', 'admin', vendorIds.a)).body).toMatchObject({ all: 2 });
    expect((await get('/orders/workflow-summary', 'admin', vendorIds.b)).body).toMatchObject({ all: 1 });
    expect((await get('/orders/workflow-summary', 'admin', vendorIds.c)).body).toMatchObject({ all: 0 });
    expect((await get('/orders/workflow-summary', 'admin', vendorIds.d)).body).toMatchObject({ all: 0 });
    expect((await get('/orders', 'admin')).status).toBe(400);
    expect((await get('/orders', 'admin', 'does-not-exist')).status).toBe(404);
    expect((await get('/orders/workflow-summary', 'admin')).status).toBe(400);
    expect((await get('/orders?workflow=invalid', 'admin', vendorIds.a)).status).toBe(400);
  });

  it('allows zero-membership Admin detail reads only for the explicitly assigned Vendor allocation', async () => {
    expect(await db.userVendorAccess.count({ where: { userId: userIds.admin } })).toBe(0);
    const a = await get('/orders/a2-test-allocation-a1', 'admin', vendorIds.a);
    const b = await get('/orders/a2-test-allocation-b1', 'admin', vendorIds.b);
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({ id: 'a2-test-allocation-a1', vendorId: vendorIds.a, assignedVendorId: vendorIds.a });
    expect(b.status).toBe(200);
    expect(b.body).toMatchObject({ id: 'a2-test-allocation-b1', vendorId: vendorIds.b,
      assignedVendorId: vendorIds.b, originalVendorId: vendorIds.a });
    expect((await get('/orders/a2-test-allocation-b1', 'admin', vendorIds.a)).status).toBe(404);
    expect((await get('/orders/a2-test-allocation-a1', 'admin', vendorIds.b)).status).toBe(404);
    expect((await get('/orders/does-not-exist', 'admin', vendorIds.a)).status).toBe(404);
    expect((await get('/orders/a2-test-allocation-a1', 'admin')).status).toBe(400);
    expect((await get('/orders/a2-test-allocation-a1', 'admin', 'does-not-exist')).status).toBe(404);
    expect((await get('/orders/a2-test-allocation-a1', 'vendorA', vendorIds.a)).status).toBe(200);
    expect((await get('/orders/a2-test-allocation-b1', 'vendorA', vendorIds.a)).status).toBe(404);
    expect((await get('/orders/a2-test-allocation-b1', 'vendorA', vendorIds.b)).status).toBe(403);
  });

  it('keeps two allocations of one Shopify order separate in Admin detail responses', async () => {
    const orderId = 'a2-test-multi-vendor-order';
    const allocationA = 'a2-test-multi-allocation-a';
    const allocationB = 'a2-test-multi-allocation-b';
    await db.shopifyOrder.create({ data: { id: orderId,
      sourceShopifyOrderId: 'gid://shopify/Order/a2-multi', sourceShopifyOrderNumber: '#a2-multi' } });
    try {
      await db.vendorAllocation.createMany({ data: [
        { id: allocationA, sourceShopifyOrderId: orderId, sourceShopifyOrderNumber: '#a2-multi',
          originalVendorId: vendorIds.a, assignedVendorId: vendorIds.a, vendorInvoiceNumber: 'A-ONLY-INVOICE' },
        { id: allocationB, sourceShopifyOrderId: orderId, sourceShopifyOrderNumber: '#a2-multi',
          originalVendorId: vendorIds.b, assignedVendorId: vendorIds.b, vendorInvoiceNumber: 'B-ONLY-INVOICE' },
      ] });
      const a = await get(`/orders/${allocationA}`, 'admin', vendorIds.a);
      const b = await get(`/orders/${allocationB}`, 'admin', vendorIds.b);
      expect(a.status).toBe(200);
      expect(b.status).toBe(200);
      expect(a.body).toMatchObject({ id: allocationA, assignedVendorId: vendorIds.a,
        orderSnapshot: { vendorInvoiceNumber: 'A-ONLY-INVOICE' } });
      expect(b.body).toMatchObject({ id: allocationB, assignedVendorId: vendorIds.b,
        orderSnapshot: { vendorInvoiceNumber: 'B-ONLY-INVOICE' } });
      expect(JSON.stringify(a.body)).not.toContain('B-ONLY-INVOICE');
      expect(JSON.stringify(b.body)).not.toContain('A-ONLY-INVOICE');
      expect((await get(`/orders/${allocationB}`, 'admin', vendorIds.a)).status).toBe(404);
      expect((await get(`/orders/${allocationA}`, 'admin', vendorIds.b)).status).toBe(404);
    } finally {
      await db.vendorAllocation.deleteMany({ where: { id: { in: [allocationA, allocationB] } } });
      await db.shopifyOrder.delete({ where: { id: orderId } });
    }
  });

  it('VENDOR and scoped SUPPORT/FINANCE cannot obtain cross-Vendor Admin authority', async () => {
    for (const path of ['/dashboard/summary', '/orders', '/orders/workflow-summary']) {
      expect((await get(path, 'vendorA', vendorIds.a)).status).toBe(200);
      expect((await get(path, 'vendorA', vendorIds.b)).status).toBe(403);
      expect((await get(path, 'vendorB', vendorIds.b)).status).toBe(200);
      for (const actor of ['support', 'finance'] as const) {
        expect((await get(path, actor, vendorIds.a)).status).toBe(200);
        expect((await get(path, actor, vendorIds.b)).status).toBe(403);
      }
    }
    expect((await get('/orders', 'adminLinked', vendorIds.a)).status).toBe(200);
    expect((await get('/orders', 'adminLinked', vendorIds.b)).status).toBe(200);
  });

  it('rejects duplicate and comma-combined Admin target headers', async () => {
    for (const path of ['/dashboard/summary', '/orders', '/orders/workflow-summary']) {
      const combined = await get(path, 'admin', `${vendorIds.a},${vendorIds.b}`);
      expect(combined.status).toBe(400);
      const duplicate = await app.inject({ method: 'GET', url: path,
        headers: { authorization: `Bearer ${tokens.admin}`, 'x-vendor-id': [vendorIds.a, vendorIds.b] } });
      expect(duplicate.statusCode).toBe(400);
    }
  });

  it('read requests preserve Vendor, allocation ownership, memberships and financial tables', async () => {
    expect(await db.vendor.findMany({ select: { id: true, status: true }, orderBy: { id: 'asc' } })).toEqual([
      { id: vendorIds.a, status: 'active' }, { id: vendorIds.b, status: 'active' },
      { id: vendorIds.c, status: 'restricted' }, { id: vendorIds.d, status: 'active' },
    ]);
    expect(await db.vendorAllocation.findMany({ select: { id: true, originalVendorId: true, assignedVendorId: true },
      orderBy: { id: 'asc' } })).toEqual([
      { id: 'a2-test-allocation-a1', originalVendorId: vendorIds.a, assignedVendorId: vendorIds.a },
      { id: 'a2-test-allocation-a2', originalVendorId: vendorIds.a, assignedVendorId: vendorIds.a },
      { id: 'a2-test-allocation-b1', originalVendorId: vendorIds.a, assignedVendorId: vendorIds.b },
    ]);
    expect(await db.userVendorAccess.count()).toBe(5);
    expect(await db.financeLedgerEntry.count()).toBe(0);
    expect(await db.settlementApproval.count()).toBe(0);
    expect(await db.shipmentExecution.count()).toBe(0);
  });
});
