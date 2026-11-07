import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../backend/node_modules/@prisma/client/index.js';

const url = process.env.TEST_DATABASE_URL;
const databaseName = 'p4_07g_support_pagination_isolated';

describe.skipIf(!url)('Support pagination against disposable PostgreSQL', () => {
  let db: PrismaClient;
  let app: import('../backend/node_modules/fastify/types/instance.js').FastifyInstance;
  let tokens: { admin: string; a: string; b: string };

  beforeAll(async () => {
    const target = new URL(url!);
    if (target.protocol !== 'postgresql:' || target.hostname !== '127.0.0.1' || target.pathname !== `/${databaseName}`
      || process.env.SUPPORT_PAGINATION_ISOLATED !== '1') {
      throw new Error('Support pagination tests require their dedicated local disposable PostgreSQL database.');
    }
    process.env.DATABASE_URL = url;
    process.env.NODE_ENV = 'test';
    process.env.SETTLEMENT_AUTO_DRAFT_JOB_ENABLED = 'false';
    process.env.SHOPIFY_ORDERS_CREATE_EXECUTOR_ENABLED = 'false';
    process.env.SCHEDULED_RECONCILIATION_ENABLED = 'false';
    const { PrismaClient } = await import('../backend/node_modules/@prisma/client/index.js');
    db = new PrismaClient({ datasources: { db: { url } } });
    await db.$connect();
    expect(await db.vendor.count()).toBe(0);
    expect(await db.user.count()).toBe(0);
    await db.vendor.createMany({ data: [{ id: 'p4g-a', name: 'Vendor A' }, { id: 'p4g-b', name: 'Vendor B' }] });
    const { hashPasswordArgon2id } = await import('../backend/src/modules/auth/password-hashing.js');
    const password = 'isolated-test-password';
    const passwordHash = await hashPasswordArgon2id(password);
    await db.user.createMany({ data: [
      { id: 'p4g-admin', email: 'p4g-admin@example.test', name: 'Admin', role: 'ADMIN', passwordHash },
      { id: 'p4g-user-a', email: 'p4g-a@example.test', name: 'Vendor A User', role: 'VENDOR', passwordHash },
      { id: 'p4g-user-b', email: 'p4g-b@example.test', name: 'Vendor B User', role: 'VENDOR', passwordHash },
    ] });
    await db.userVendorAccess.createMany({ data: [
      { userId: 'p4g-user-a', vendorId: 'p4g-a' }, { userId: 'p4g-user-b', vendorId: 'p4g-b' },
    ] });
    await db.supportTicket.createMany({ data: Array.from({ length: 600 }, (_, index) => ({
      id: `p4g-ticket-${String(index).padStart(3, '0')}`,
      vendorId: index < 300 ? 'p4g-a' : 'p4g-b',
      createdByUserId: index < 300 ? 'p4g-user-a' : 'p4g-user-b',
      createdByRole: 'VENDOR',
      subject: index === 299 || index === 599 ? `Historical needle ${index}` : `Support ${index}`,
      message: 'Disposable test ticket', contextType: 'general',
      updatedAt: new Date(Date.UTC(2026, 4, 1) - index * 1000),
      adminUnreadCount: index % 2,
    })) });
    const env = { NODE_ENV: 'test', JWT_SECRET: 'p4g-isolated-auth-secret', JWT_EXPIRES_IN: '1h',
      LOGIN_RATE_LIMIT_MAX_ATTEMPTS: 20, LOGIN_RATE_LIMIT_WINDOW_SECONDS: 60 } as never;
    const { createAuthService } = await import('../backend/src/modules/auth/auth.service.js');
    const auth = createAuthService(env);
    tokens = { admin: (await auth.login({ email: 'p4g-admin@example.test', password }))!.token,
      a: (await auth.login({ email: 'p4g-a@example.test', password }))!.token,
      b: (await auth.login({ email: 'p4g-b@example.test', password }))!.token };
    const { default: Fastify } = await import('../backend/node_modules/fastify/fastify.js');
    const { registerSupportRoutes } = await import('../backend/src/modules/support/support.routes.js');
    app = Fastify({ logger: false });
    registerSupportRoutes(app, env);
    await app.ready();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await db?.$disconnect();
    const { prisma } = await import('../backend/src/db/prisma.js');
    await prisma.$disconnect();
  });

  async function get(path: string, actor: keyof typeof tokens, vendorId?: string) {
    const response = await app.inject({ method: 'GET', url: path,
      headers: { authorization: `Bearer ${tokens[actor]}`, ...(vendorId ? { 'x-vendor-id': vendorId } : {}) } });
    return { status: response.statusCode, body: response.json() as any };
  }

  async function collect(path: string, actor: keyof typeof tokens, vendorId?: string) {
    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const response = await get(`${path}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, actor, vendorId);
      expect(response.status).toBe(200);
      expect(response.body.items.length).toBeLessThanOrEqual(100);
      ids.push(...response.body.items.map((ticket: { id: string }) => ticket.id));
      cursor = response.body.nextCursor;
      expect(Boolean(cursor)).toBe(response.body.hasNextPage);
    } while (cursor);
    expect(new Set(ids).size).toBe(ids.length);
    return ids;
  }

  it('reaches all 300 Vendor and 600 global Admin tickets without duplication', async () => {
    expect(await collect('/support/tickets/page?search=', 'a')).toHaveLength(300);
    expect(await collect('/admin/support/tickets/page?unresolvedOnly=false', 'admin')).toHaveLength(600);
  });

  it('searches and counts beyond old caps, including absent matches and filters', async () => {
    const vendor = await get('/support/tickets/page?search=needle%20299', 'a');
    expect(vendor.body.items.map((ticket: { id: string }) => ticket.id)).toEqual(['p4g-ticket-299']);
    const admin = await get('/admin/support/tickets/page?search=needle%20599', 'admin');
    expect(admin.body.items.map((ticket: { id: string }) => ticket.id)).toEqual(['p4g-ticket-599']);
    const empty = await get('/support/tickets/page?search=absent-needle', 'a');
    expect(empty.body).toMatchObject({ total: 0, items: [], hasNextPage: false });
    const unread = await get('/support/tickets/page?unreadOnly=true', 'a');
    expect(unread.body.total).toBe(0);
    const counts = await get('/admin/support/tickets/page', 'admin');
    expect(counts.body.bucketCounts.all).toBe(600);
    expect(counts.body.bucketCounts.needs_assignment).toBe(600);
  });

  it('enforces Vendor ownership and cursor binding', async () => {
    expect((await get('/support/tickets/page', 'a', 'p4g-b')).status).toBe(403);
    expect((await get('/support/tickets/page?search=needle%20599', 'a')).body.items).toEqual([]);
    expect((await get('/admin/support/tickets/page', 'a')).status).toBe(403);
    const first = await get('/support/tickets/page', 'a');
    expect((await get(`/support/tickets/page?cursor=${encodeURIComponent(first.body.nextCursor)}`, 'b')).status).toBe(400);
    expect((await get('/support/tickets/page', 'admin', 'p4g-b')).body.total).toBe(300);
    expect((await get('/support/tickets/page', 'admin')).status).toBe(400);
  });

  it('orders global operational ranks before timestamp and applies filters before paging', async () => {
    const escalationId = 'p4g-ticket-599';
    const overdueId = 'p4g-ticket-598';
    const originals = await db.supportTicket.findMany({ where: { id: { in: [escalationId, overdueId] } },
      select: { id: true, updatedAt: true } });
    try {
      await db.supportTicket.update({ where: { id: escalationId },
        data: { escalatedAt: new Date('2026-05-01T00:00:00Z'), firstResponseDueAt: new Date('2026-05-01T00:00:00Z') } });
      await db.supportTicket.update({ where: { id: overdueId },
        data: { firstResponseDueAt: new Date('2026-05-01T00:00:00Z') } });
      const page = await get('/admin/support/tickets/page', 'admin');
      expect(page.body.items.slice(0, 2).map((ticket: { id: string }) => ticket.id)).toEqual([escalationId, overdueId]);
      expect(page.body.bucketCounts.escalated).toBe(1);
      expect(page.body.bucketCounts.overdue).toBe(2);
      const filtered = await get('/admin/support/tickets/page?bucket=escalated', 'admin');
      expect(filtered.body).toMatchObject({ total: 1, hasNextPage: false });
      expect(filtered.body.items[0].id).toBe(escalationId);
    } finally {
      for (const original of originals) await db.supportTicket.update({ where: { id: original.id },
        data: { escalatedAt: null, firstResponseDueAt: null, updatedAt: original.updatedAt } });
    }
  });
});
