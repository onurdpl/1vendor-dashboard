import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { request as httpRequest } from 'node:http';
import type { AppEnv } from '../backend/src/config/env.js';
import type { PrismaClient } from '../backend/node_modules/@prisma/client/index.js';

const url = process.env.TEST_DATABASE_URL?.trim();
const localDatabase = 'a2_finance_read_20261101_8d9c2b41';
const ciDatabase = 'a2_finance_read_ci_validation';
const vendors = { a: 'a2-finance-a', b: 'a2-finance-b', c: 'a2-finance-restricted', empty: 'a2-finance-empty' };
const users = { admin: 'a2-finance-admin', linkedAdmin: 'a2-finance-linked-admin',
  vendorA: 'a2-finance-vendor-a', support: 'a2-finance-support', finance: 'a2-finance-finance' };
const password = 'a2-finance-disposable-password';
const env = { NODE_ENV: 'test', JWT_SECRET: 'a2-finance-disposable-jwt-secret', JWT_EXPIRES_IN: '1h',
  LOGIN_RATE_LIMIT_MAX_ATTEMPTS: 20, LOGIN_RATE_LIMIT_WINDOW_SECONDS: 60 } as AppEnv;
const paths = ['/finance', '/finance/summary', '/finance/profile',
  '/finance/return-records?shopifyRefundId=refund-a', '/finance/vendor-debt-history',
  '/finance/payout-offset-obligations'];

describe.skipIf(!url)('Admin Vendor Finance reads against isolated PostgreSQL 18', () => {
  let db: PrismaClient;
  let app: import('../backend/node_modules/fastify/types/instance.js').FastifyInstance;
  let tokens: Record<keyof typeof users, string>;

  beforeAll(async () => {
    const target = new URL(url!);
    const proof = process.env.FIN_AUTO_CI_DB_PROOF;
    const cluster = process.env.FIN_AUTO_CI_CLUSTER_ID;
    const ciTarget = process.env.A2_FINANCE_READ_CI_MODE === '1' &&
      process.env.GITHUB_ACTIONS === 'true' && process.env.CI === 'true' &&
      target.username === 'postgres' && target.password === 'postgres' &&
      target.pathname === `/${ciDatabase}` && process.env.FIN_AUTO_CI_PG_MAJOR === '18' &&
      /^[a-f0-9]{64}$/.test(proof ?? '') && /^\d+$/.test(cluster ?? '');
    const localTarget = process.env.A2_FINANCE_READ_CI_MODE === undefined &&
      process.env.GITHUB_ACTIONS !== 'true' &&
      target.username === 'onur' && !target.password && target.pathname === `/${localDatabase}`;
    if (process.env.A2_FINANCE_READ_PG_ISOLATED !== '1' || target.protocol !== 'postgresql:' ||
        target.hostname !== '127.0.0.1' || target.port !== '5432' ||
        target.search !== '?schema=public' || !(ciTarget || localTarget)) {
      throw new Error('Admin Finance read tests refuse an unverified PostgreSQL target.');
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
    const [identity] = await db.$queryRaw<Array<{ database: string; owner: string; databaseOwner: string;
      port: number; version: string; directory: string; systemId: bigint; address: string; comment: string | null }>>`
      SELECT current_database() AS database, current_user AS owner,
        pg_get_userbyid(d.datdba) AS "databaseOwner", inet_server_port() AS port,
        current_setting('server_version_num') AS version, current_setting('data_directory') AS directory,
        (pg_control_system()).system_identifier AS "systemId", host(inet_server_addr()) AS address,
        shobj_description(d.oid, 'pg_database') AS comment
      FROM pg_database d WHERE d.datname = current_database()
    `;
    if (ciTarget) {
      expect(identity).toMatchObject({ database: ciDatabase, owner: 'postgres',
        databaseOwner: 'postgres', port: 5432, comment: `fin-auto-ci:${proof}` });
      expect(Math.floor(Number(identity.version) / 10000)).toBe(18);
      expect(String(identity.systemId)).toBe(cluster);
      expect(identity.directory).toEqual(expect.any(String));
    } else {
      expect({ ...identity, systemId: String(identity.systemId) }).toMatchObject({
        database: localDatabase, owner: 'onur', databaseOwner: 'onur',
        address: '127.0.0.1', port: 5432, version: '180003',
        directory: '/opt/homebrew/var/postgresql@18', systemId: '7637676237569338936',
      });
    }
    for (const table of ['Vendor', 'User', 'FinanceLedgerEntry', 'VendorBalanceEvent',
      'RefundRecord', 'ReturnRecord', 'PayoutBatch', 'SettlementApproval'] as const) {
      const rows = await db.$queryRawUnsafe<Array<{ count: bigint }>>(`SELECT count(*) AS count FROM "${table}"`);
      expect(Number(rows[0]?.count)).toBe(0);
    }
    const { hashPasswordArgon2id } = await import('../backend/src/modules/auth/password-hashing.js');
    const passwordHash = await hashPasswordArgon2id(password);
    await db.vendor.createMany({ data: [
      { id: vendors.a, name: 'Finance A' }, { id: vendors.b, name: 'Finance B' },
      { id: vendors.c, name: 'Finance Restricted', status: 'restricted' },
      { id: vendors.empty, name: 'Finance Empty' },
    ] });
    await db.user.createMany({ data: [
      { id: users.admin, email: 'finance-admin@example.test', name: 'Finance Admin', role: 'ADMIN', passwordHash },
      { id: users.linkedAdmin, email: 'finance-linked@example.test', name: 'Linked Admin', role: 'ADMIN', passwordHash },
      { id: users.vendorA, email: 'finance-vendor@example.test', name: 'Finance Vendor', role: 'VENDOR', passwordHash },
      { id: users.support, email: 'finance-support@example.test', name: 'Finance Support', role: 'SUPPORT', passwordHash },
      { id: users.finance, email: 'finance-finance@example.test', name: 'Finance Role', role: 'FINANCE', passwordHash },
    ] });
    await db.userVendorAccess.createMany({ data: [
      { userId: users.linkedAdmin, vendorId: vendors.b },
      { userId: users.vendorA, vendorId: vendors.a },
      { userId: users.support, vendorId: vendors.a },
      { userId: users.finance, vendorId: vendors.a },
    ] });
    for (const [suffix, vendorId, sale, refund, debt] of [
      ['a', vendors.a, '120.00', '10.00', -700],
      ['b', vendors.b, '340.00', '20.00', -1300],
    ] as const) {
      const orderId = `a2-finance-order-${suffix}`;
      const allocationId = `a2-finance-allocation-${suffix}`;
      const refundId = `refund-${suffix}`;
      await db.shopifyOrder.create({ data: { id: orderId,
        sourceShopifyOrderId: `gid://shopify/Order/finance-${suffix}`,
        sourceShopifyOrderNumber: `#finance-${suffix}` } });
      await db.vendorAllocation.create({ data: { id: allocationId, sourceShopifyOrderId: orderId,
        sourceShopifyOrderNumber: `#finance-${suffix}`, originalVendorId: vendorId, assignedVendorId: vendorId } });
      await db.refundRecord.create({ data: { id: refundId, vendorAllocationId: allocationId,
        sourceShopifyOrderId: orderId, sourceShopifyOrderNumber: `#finance-${suffix}`,
        sourceShopifyRefundId: refundId, status: 'processed', amount: refund } });
      await db.financeLedgerEntry.createMany({ data: [
        { id: `sale-${suffix}`, vendorId, vendorAllocationId: allocationId, entryType: 'sale',
          amount: sale, payoutStatus: 'PENDING', settlementStatus: 'PENDING',
          commissionPercentSnapshot: '10.00' },
        { id: `refund-ledger-${suffix}`, vendorId, vendorAllocationId: allocationId, entryType: 'refund',
          amount: refund, payoutStatus: 'PENDING', settlementStatus: 'PENDING' },
      ] });
      await db.vendorFinancialProfile.create({ data: { vendorId, commissionPercent: suffix === 'a' ? '12.00' : '18.00' } });
      await db.vendorBalanceEvent.create({ data: { id: `debt-${suffix}`, vendorId,
        type: 'VENDOR_DEBT_CREATED', amountMinor: debt, currency: 'TRY',
        sourceType: 'test', sourceId: `debt-${suffix}`, idempotencyKey: `debt-${suffix}` } });
    }
    const { createAuthService } = await import('../backend/src/modules/auth/auth.service.js');
    const auth = createAuthService(env);
    tokens = {} as typeof tokens;
    for (const [actor, id] of Object.entries(users) as Array<[keyof typeof users, string]>) {
      const email = (await db.user.findUniqueOrThrow({ where: { id }, select: { email: true } })).email;
      const login = await auth.login({ email, password });
      expect(login).not.toBeNull();
      tokens[actor] = login!.token;
    }
    const { default: Fastify } = await import('../backend/node_modules/fastify/fastify.js');
    const { registerFinanceRoutes } = await import('../backend/src/modules/finance/finance.routes.js');
    app = Fastify({ logger: false });
    registerFinanceRoutes(app, env);
    await app.ready();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await db?.$disconnect();
    const { prisma } = await import('../backend/src/db/prisma.js');
    await prisma.$disconnect();
  });

  async function get(path: string, actor?: keyof typeof users, vendorId?: string,
    headers: Record<string, string | string[]> = {}) {
    const response = await app.inject({ method: 'GET', url: path,
      headers: { ...(actor ? { authorization: `Bearer ${tokens[actor]}` } : {}),
        ...(vendorId !== undefined ? { 'x-vendor-id': vendorId } : {}), ...headers } });
    return { status: response.statusCode, body: response.json() as any };
  }

  it('zero-membership Admin reads all six scoped Finance endpoints for A and B', async () => {
    expect(await db.userVendorAccess.count({ where: { userId: users.admin } })).toBe(0);
    for (const vendorId of [vendors.a, vendors.b]) {
      for (const path of paths) expect((await get(path, 'admin', vendorId)).status).toBe(200);
    }
    expect((await get('/finance', 'linkedAdmin', vendors.a)).status).toBe(200);
  });

  it('Finance dashboard and summary keep distinct ledger IDs and totals per Vendor', async () => {
    for (const [vendorId, suffix, sale, refund] of [
      [vendors.a, 'a', '120.00', '10.00'], [vendors.b, 'b', '340.00', '20.00'],
    ] as const) {
      const dashboard = (await get('/finance', 'admin', vendorId)).body;
      const summary = (await get('/finance/summary', 'admin', vendorId)).body;
      expect(dashboard.records.map((row: { id: string }) => row.id).sort()).toEqual([`refund-ledger-${suffix}`, `sale-${suffix}`]);
      expect(dashboard.summary.grossSales).toBe(sale);
      expect(dashboard.summary.refunds).toBe(refund);
      expect(summary.summary.grossSales).toBe(sale);
      expect(summary.summary.refunds).toBe(refund);
      expect(JSON.stringify(dashboard)).not.toContain(`sale-${suffix === 'a' ? 'b' : 'a'}`);
    }
  });

  it('profiles, return-finance records and debt history remain Vendor-specific', async () => {
    for (const [vendorId, suffix, commission] of [
      [vendors.a, 'a', '12.00'], [vendors.b, 'b', '18.00'],
    ] as const) {
      expect((await get('/finance/profile', 'admin', vendorId)).body)
        .toMatchObject({ vendorId, commissionPercent: commission });
      const adminProfile = await get(`/admin/vendors/${vendorId}/financial-profile`, 'admin');
      expect(adminProfile.status).toBe(200);
      expect(adminProfile.body).toMatchObject({ vendorId, commissionPercent: commission, source: 'configured' });
      const records = await get(`/finance/return-records?shopifyRefundId=refund-${suffix}`, 'admin', vendorId);
      expect(records.body.records.map((row: { id: string }) => row.id).sort())
        .toEqual([`refund-ledger-${suffix}`, `sale-${suffix}`]);
      expect((await get('/finance/vendor-debt-history', 'admin', vendorId)).body)
        .toMatchObject({ vendorId, events: [expect.objectContaining({ id: `debt-${suffix}`, vendorId })] });
      expect((await get(`/finance/return-records?shopifyRefundId=refund-${suffix === 'a' ? 'b' : 'a'}`,
        'admin', vendorId)).body.records).toEqual([]);
    }
  });

  it('payout offset obligations stay scoped and preserve UNKNOWN for unverified debt provenance', async () => {
    for (const vendorId of [vendors.a, vendors.b]) {
      const response = await get('/finance/payout-offset-obligations', 'admin', vendorId);
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ vendorId, status: 'UNKNOWN', writesPerformed: false });
      expect(response.body.outstandingDebtAmount).toBeNull();
    }
  });

  it('restricted and empty Vendors are readable without falling back to another Vendor', async () => {
    for (const vendorId of [vendors.c, vendors.empty]) {
      for (const path of paths) {
        const result = await get(path, 'admin', vendorId);
        expect(result.status).toBe(200);
        expect(JSON.stringify(result.body)).not.toContain('sale-a');
        expect(JSON.stringify(result.body)).not.toContain('sale-b');
      }
      expect((await get('/finance', 'admin', vendorId)).body.records).toEqual([]);
      expect((await get('/finance/vendor-debt-history', 'admin', vendorId)).body.events).toEqual([]);
      const adminProfile = await get(`/admin/vendors/${vendorId}/financial-profile`, 'admin');
      expect(adminProfile.status).toBe(200);
      expect(adminProfile.body).toMatchObject({ vendorId, source: 'default' });
      expect(adminProfile.body).toEqual((await get('/finance/profile', 'admin', vendorId)).body);
      expect(adminProfile.body.commissionPercent).not.toBe('12.00');
      expect(adminProfile.body.commissionPercent).not.toBe('18.00');
    }
  });

  it('all six endpoints reject missing, invalid and combined Admin targets', async () => {
    for (const path of paths) {
      expect((await get(path, 'admin')).status).toBe(400);
      expect((await get(path, 'admin', 'missing')).status).toBe(404);
      expect((await get(path, 'admin', `${vendors.a},${vendors.b}`)).status).toBe(400);
      expect((await get(path, 'admin', undefined, { 'x-vendor-id': [vendors.a, vendors.b] })).status).toBe(400);
      expect((await get(path)).status).toBe(401);
    }
    const missingProfile = await get('/admin/vendors/a2-finance-nonexistent/financial-profile', 'admin');
    expect(missingProfile).toEqual({ status: 404, body: { message: 'Vendor could not be found.' } });
    expect((await get(`/admin/vendors/${vendors.a}/financial-profile`)).status).toBe(401);
  });

  it('rejects duplicate identical raw Admin target headers on all six endpoints', async () => {
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('Expected local test TCP port.');
    for (const path of paths) {
      const status = await new Promise<number>((resolve, reject) => {
        const request = httpRequest({ host: '127.0.0.1', port: address.port, path,
          headers: { authorization: `Bearer ${tokens.admin}`, 'X-Vendor-Id': [vendors.a, vendors.a] } }, response => {
          response.resume();
          response.on('end', () => resolve(response.statusCode ?? 0));
        });
        request.on('error', reject);
        request.end();
      });
      expect(status).toBe(400);
    }
  });

  it('VENDOR, SUPPORT and FINANCE retain membership boundaries on every Finance GET', async () => {
    for (const actor of ['vendorA', 'support', 'finance'] as const) {
      for (const path of paths) {
        expect((await get(path, actor, vendors.a)).status).toBe(200);
        expect((await get(path, actor, vendors.b)).status).toBe(403);
      }
    }
    for (const actor of ['vendorA', 'support', 'finance'] as const) {
      expect((await get(`/admin/vendors/${vendors.a}/financial-profile`, actor, vendors.a)).status).toBe(403);
    }
    expect(await db.userVendorAccess.count({ where: { userId: users.admin } })).toBe(0);
    expect((await get(`/admin/vendors/${vendors.b}/financial-profile`, 'admin', vendors.a)).status).toBe(200);
  });

  it('read requests preserve financial, return and membership records', async () => {
    const before = {
      ledger: await db.financeLedgerEntry.findMany({ select: { id: true, vendorId: true, amount: true,
        payoutStatus: true, settlementStatus: true, updatedAt: true }, orderBy: { id: 'asc' } }),
      debt: await db.vendorBalanceEvent.findMany({ select: { id: true, vendorId: true, amountMinor: true },
        orderBy: { id: 'asc' } }),
      refunds: await db.refundRecord.findMany({ select: { id: true, status: true, amount: true },
        orderBy: { id: 'asc' } }),
      memberships: await db.userVendorAccess.findMany({ select: { userId: true, vendorId: true },
        orderBy: [{ userId: 'asc' }, { vendorId: 'asc' }] }),
      profiles: await db.vendorFinancialProfile.findMany({
        select: { vendorId: true, commissionPercent: true, active: true }, orderBy: { vendorId: 'asc' },
      }),
      payoutCount: await db.payoutBatch.count(),
      settlementCount: await db.settlementApproval.count(),
    };
    for (const path of paths) expect((await get(path, 'admin', vendors.a)).status).toBe(200);
    expect((await get(`/admin/vendors/${vendors.a}/financial-profile`, 'admin')).status).toBe(200);
    expect((await get(`/admin/vendors/${vendors.empty}/financial-profile`, 'admin')).status).toBe(200);
    expect((await get('/admin/vendors/a2-finance-nonexistent/financial-profile', 'admin')).status).toBe(404);
    expect(await db.financeLedgerEntry.findMany({ select: { id: true, vendorId: true, amount: true,
      payoutStatus: true, settlementStatus: true, updatedAt: true }, orderBy: { id: 'asc' } })).toEqual(before.ledger);
    expect(await db.vendorBalanceEvent.findMany({ select: { id: true, vendorId: true, amountMinor: true },
      orderBy: { id: 'asc' } })).toEqual(before.debt);
    expect(await db.refundRecord.findMany({ select: { id: true, status: true, amount: true },
      orderBy: { id: 'asc' } })).toEqual(before.refunds);
    expect(await db.userVendorAccess.findMany({ select: { userId: true, vendorId: true },
      orderBy: [{ userId: 'asc' }, { vendorId: 'asc' }] })).toEqual(before.memberships);
    expect(await db.vendorFinancialProfile.findMany({
      select: { vendorId: true, commissionPercent: true, active: true }, orderBy: { vendorId: 'asc' },
    })).toEqual(before.profiles);
    expect(await db.payoutBatch.count()).toBe(before.payoutCount);
    expect(await db.settlementApproval.count()).toBe(before.settlementCount);
  });
});
