import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../backend/node_modules/@prisma/client/index.js';
import type { AppEnv } from '../backend/src/config/env.js';

const url = process.env.TEST_DATABASE_URL;
const databaseName = 'p5_07a_support_reply_validation';
const appEnv = { NODE_ENV: 'test', JWT_SECRET: 'disposable-support-reply-jwt-key', JWT_EXPIRES_IN: '1h',
  LOGIN_RATE_LIMIT_MAX_ATTEMPTS: 20, LOGIN_RATE_LIMIT_WINDOW_SECONDS: 60 } as AppEnv;
const vendorA = 'support-reply-a', vendorB = 'support-reply-b';

describe.skipIf(!url)('public Support reply integrity on disposable PostgreSQL 16/18', () => {
  let db: PrismaClient;
  let app: import('../backend/node_modules/fastify/types/instance.js').FastifyInstance;
  let tokens: Record<'admin' | 'a' | 'b', string>;
  let initialFinance: number[];
  const due = new Date('2026-11-14T10:00:00.000Z');

  beforeAll(async () => {
    const target = new URL(url!);
    const proof = process.env.FIN_AUTO_CI_DB_PROOF;
    const cluster = process.env.FIN_AUTO_CI_CLUSTER_ID;
    const ciMajor = process.env.FIN_AUTO_CI_PG_MAJOR;
    const ciTarget = process.env.P5_07A_CI_MODE === '1' && process.env.GITHUB_ACTIONS === 'true' &&
      process.env.CI === 'true' && target.port === '5432' && target.password === 'postgres' &&
      ['16', '18'].includes(ciMajor ?? '') && /^[a-f0-9]{64}$/.test(proof ?? '') && /^\d+$/.test(cluster ?? '');
    const localTarget = process.env.P5_07A_CI_MODE === undefined && process.env.GITHUB_ACTIONS !== 'true' &&
      ['55483', '55484'].includes(target.port);
    if (process.env.P5_07A_TEST_DATABASE_ISOLATED !== '1' || target.protocol !== 'postgresql:' ||
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
    expect(await db.vendor.count()).toBe(0);
    expect(await db.supportTicket.count()).toBe(0);
    expect(await db.supportTicketReply.count()).toBe(0);
    (globalThis as { prisma?: PrismaClient }).prisma = db;
    initialFinance = await financeCounts();
    await db.vendor.createMany({ data: [{ id: vendorA, name: 'Support A' }, { id: vendorB, name: 'Support B' }] });
    const { hashPasswordArgon2id } = await import('../backend/src/modules/auth/password-hashing.js');
    const password = 'disposable-support-reply-password';
    const passwordHash = await hashPasswordArgon2id(password);
    await db.user.createMany({ data: (['admin', 'a', 'b'] as const).map((key) => ({
      id: `support-${key}`, email: `support-${key}@example.test`, name: `Support ${key}`,
      role: key === 'admin' ? 'ADMIN' : 'VENDOR', passwordHash,
    })) });
    await db.userVendorAccess.createMany({ data: [{ userId: 'support-a', vendorId: vendorA }, { userId: 'support-b', vendorId: vendorB }] });

    // Disposable-database fault injection. The ticket trigger fires only on
    // the explicitly marked fixture and proves the reply was already inserted
    // in the transaction before the second write fails.
    await db.$executeRaw`CREATE SEQUENCE p507a_test_reply_observed`;
    await db.$executeRaw`
      CREATE FUNCTION p507a_test_ticket_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF OLD.subject = 'p507a fail ticket update' AND NEW."lastReplyAt" IS NOT NULL THEN
          IF NOT EXISTS (SELECT 1 FROM "SupportTicketReply" WHERE "supportTicketId" = OLD.id) THEN
            RAISE EXCEPTION 'test reply did not reach ticket update' USING ERRCODE = 'P7501';
          END IF;
          PERFORM nextval('p507a_test_reply_observed');
          RAISE EXCEPTION 'test ticket update failure' USING ERRCODE = 'P7502';
        END IF;
        RETURN NEW;
      END;
      $$
    `;
    await db.$executeRaw`
      CREATE TRIGGER p507a_test_ticket_failure BEFORE UPDATE ON "SupportTicket"
      FOR EACH ROW EXECUTE FUNCTION p507a_test_ticket_failure()
    `;
    await db.$executeRaw`
      CREATE FUNCTION p507a_test_reply_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.message = 'p507a fail reply insert' THEN
          RAISE EXCEPTION 'test reply insert failure' USING ERRCODE = 'P7503';
        END IF;
        RETURN NEW;
      END;
      $$
    `;
    await db.$executeRaw`
      CREATE TRIGGER p507a_test_reply_failure BEFORE INSERT ON "SupportTicketReply"
      FOR EACH ROW EXECUTE FUNCTION p507a_test_reply_failure()
    `;
    const { createAuthService } = await import('../backend/src/modules/auth/auth.service.js');
    const auth = createAuthService(appEnv);
    const login = async (key: string) => (await auth.login({ email: `support-${key}@example.test`, password }))!.token;
    tokens = { admin: await login('admin'), a: await login('a'), b: await login('b') };
    const { default: Fastify } = await import('../backend/node_modules/fastify/fastify.js');
    const { registerSupportRoutes } = await import('../backend/src/modules/support/support.routes.js');
    app = Fastify();
    registerSupportRoutes(app, appEnv);
    await app.ready();
  }, 120_000);

  afterAll(async () => {
    try {
      if (initialFinance) expect(await financeCounts()).toEqual(initialFinance);
    } finally {
      await app?.close();
      await db?.$disconnect();
      delete (globalThis as { prisma?: PrismaClient }).prisma;
    }
  });

  function financeCounts() {
    return Promise.all([db.financeLedgerEntry.count(), db.payoutBatch.count(), db.payoutBatchLine.count(),
      db.settlementApproval.count(), db.vendorBalanceEvent.count(), db.financeEvent.count()]);
  }

  function ticket(status = 'WAITING_FOR_VENDOR', subject = 'Support reply fixture') {
    return db.supportTicket.create({ data: {
      id: randomUUID(), subject, status, message: 'Original ticket', vendorId: vendorA, contextType: 'general',
      createdByUserId: 'support-a', createdByRole: 'VENDOR', vendorUnreadCount: 3, adminUnreadCount: 2,
      firstResponseDueAt: due, nextResponseDueAt: due,
    } });
  }

  function request(method: 'POST' | 'GET', path: string, actor?: keyof typeof tokens, payload?: object) {
    const headers: Record<string, string> = {};
    if (actor) headers.authorization = `Bearer ${tokens[actor]}`;
    if (actor === 'a' || actor === 'b') headers['x-vendor-id'] = actor === 'a' ? vendorA : vendorB;
    return app.inject({ method, url: path, headers, payload });
  }

  function reply(id: string, kind: 'admin' | 'vendor', actor: keyof typeof tokens | undefined, payload = { message: 'Public reply' }) {
    const prefix = kind === 'admin' ? '/admin' : '';
    return request('POST', `${prefix}/support/tickets/${id}/replies`, actor, payload);
  }

  function read(id: string) {
    return db.supportTicket.findUniqueOrThrow({ where: { id }, include: { replies: true } });
  }

  it('commits Admin public reply, unread counts, SLA and matching reply timestamp', async () => {
    const original = await ticket('OPEN');
    const result = await request('POST', `/admin/support/tickets/${original.id}/replies`, 'admin',
      { message: 'Admin reply', status: 'WAITING_FOR_VENDOR' });
    expect(result.statusCode).toBe(200);
    const saved = await read(original.id);
    expect(saved).toMatchObject({ status: 'WAITING_FOR_VENDOR', lastReplyByRole: 'ADMIN',
      vendorUnreadCount: 4, adminUnreadCount: 0, firstResponseDueAt: null, nextResponseDueAt: null });
    expect(saved.replies).toMatchObject([{ message: 'Admin reply', authorUserId: 'support-admin', authorRole: 'ADMIN' }]);
    expect(saved.lastReplyAt).toEqual(saved.replies[0].createdAt);
    expect(result.json().replies[0].id).toBe(saved.replies[0].id);
  });

  it('commits Vendor public reply, preserves SLA semantics and keeps Admin notes private', async () => {
    const original = await ticket();
    expect((await request('POST', `/admin/support/tickets/${original.id}/notes`, 'admin',
      { content: 'Private investigation note' })).statusCode).toBe(200);
    const result = await reply(original.id, 'vendor', 'a');
    expect(result.statusCode).toBe(200);
    const saved = await read(original.id);
    const { calculateSupportResponseDueAt } = await import('../backend/src/modules/support/support.service.js');
    expect(saved).toMatchObject({ status: 'IN_REVIEW', lastReplyByRole: 'VENDOR',
      vendorUnreadCount: 0, adminUnreadCount: 3, firstResponseDueAt: due });
    expect(saved.replies).toMatchObject([{ authorUserId: 'support-a', authorRole: 'VENDOR', message: 'Public reply' }]);
    expect(saved.lastReplyAt).toEqual(saved.replies[0].createdAt);
    expect(saved.nextResponseDueAt).toEqual(calculateSupportResponseDueAt('normal', saved.replies[0].createdAt));
    expect(result.body).not.toContain('Private investigation note');
    expect((await request('GET', `/support/tickets/${original.id}`, 'a')).body).not.toContain('Private investigation note');
    expect((await request('GET', `/admin/support/tickets/${original.id}`, 'admin')).body).toContain('Private investigation note');
  });

  it.each(['admin', 'vendor'] as const)('%s ticket update failure rolls back the inserted reply', async (kind) => {
    const original = await ticket('WAITING_FOR_VENDOR', 'p507a fail ticket update');
    // Sequence advancement survives rollback and proves the failing trigger
    // observed the inserted reply before the ticket update was rejected.
    const [before] = await db.$queryRaw<Array<{ hits: bigint }>>`
      SELECT CASE WHEN is_called THEN last_value ELSE 0 END AS hits FROM p507a_test_reply_observed
    `;
    const response = await reply(original.id, kind, kind === 'admin' ? 'admin' : 'a');
    expect(response.statusCode).toBe(500);
    expect(response.json().message).toBe('Unable to post reply.');
    const [after] = await db.$queryRaw<Array<{ hits: bigint }>>`
      SELECT CASE WHEN is_called THEN last_value ELSE 0 END AS hits FROM p507a_test_reply_observed
    `;
    expect(after.hits).toBe(before.hits + 1n);
    expect(await read(original.id)).toEqual({ ...original, replies: [] });
  });

  it.each(['admin', 'vendor'] as const)('%s reply insert failure leaves every ticket field unchanged', async (kind) => {
    const original = await ticket();
    const response = await reply(original.id, kind, kind === 'admin' ? 'admin' : 'a', { message: 'p507a fail reply insert' });
    expect(response.statusCode).toBe(500);
    expect(response.json().message).toBe('Unable to post reply.');
    expect(await read(original.id)).toEqual({ ...original, replies: [] });
  });

  it('rejects closed tickets, foreign Vendor replies, unauthenticated requests and non-Admin global writes', async () => {
    const closed = await ticket('CLOSED');
    const open = await ticket();
    expect((await reply(closed.id, 'admin', 'admin')).statusCode).toBe(400);
    expect((await reply(closed.id, 'vendor', 'a')).statusCode).toBe(400);
    expect((await reply(open.id, 'vendor', 'b')).statusCode).toBe(404);
    expect((await reply(open.id, 'admin', 'a')).statusCode).toBe(403);
    expect((await reply(open.id, 'admin', undefined)).statusCode).toBe(401);
    expect(await read(closed.id)).toEqual({ ...closed, replies: [] });
    expect(await read(open.id)).toEqual({ ...open, replies: [] });
  });

  // The existing Admin status service uses this delegate. Run its actual
  // write through a transaction and pause before commit so PostgreSQL can
  // prove the competing request is blocked on that exact transaction.
  async function withPendingStatus<T>(id: string, status: string, compete: () => Promise<T>) {
    let release!: () => void;
    const hold = new Promise<void>((done) => { release = done; });
    let acquired!: (pid: number) => void;
    const locked = new Promise<number>((done) => { acquired = done; });
    const spy = vi.spyOn(db.supportTicket, 'update').mockImplementationOnce(((args: Parameters<typeof db.supportTicket.update>[0]) =>
      db.$transaction(async (tx) => {
        const [session] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
        const updated = await tx.supportTicket.update(args);
        acquired(session.pid);
        await hold;
        return updated;
      }, { timeout: 8_000 })) as never);
    const writer = request('POST', `/admin/support/tickets/${id}/status`, 'admin', { status });
    let other: Promise<T> | undefined;
    try {
      const pid = await Promise.race([locked, writer.then((response) => { throw Error(`Status writer ended early: ${response.statusCode}`); })]);
      other = compete();
      await waitForBlockedBy(pid);
    } finally {
      release();
      await writer;
      await other;
      spy.mockRestore();
    }
    expect((await writer).statusCode).toBe(200);
    return await other!;
  }

  async function waitForBlockedBy(pid: number) {
    await vi.waitFor(async () => {
      const [row] = await db.$queryRaw<Array<{ blocked: boolean }>>`
        SELECT EXISTS (SELECT 1 FROM pg_stat_activity
          WHERE datname = current_database() AND ${pid}::int = ANY(pg_blocking_pids(pid))) AS blocked
      `;
      expect(row.blocked).toBe(true);
    }, { timeout: 2_000, interval: 25 });
  }

  it('Admin reply waits for the status writer and keeps its committed status', async () => {
    const original = await ticket('OPEN');
    const response = await withPendingStatus(original.id, 'WAITING_FOR_VENDOR', () => reply(original.id, 'admin', 'admin'));
    expect(response.statusCode).toBe(200);
    const saved = await read(original.id);
    expect(saved.status).toBe('WAITING_FOR_VENDOR');
    expect(saved.replies).toHaveLength(1);
    expect(saved.lastReplyAt).toEqual(saved.replies[0].createdAt);
  });

  it('Vendor reply and escalation observe a concurrent committed Admin closure', async () => {
    const replyTicket = await ticket();
    const escalationTicket = await ticket('OPEN');
    const blockedReply = await withPendingStatus(replyTicket.id, 'CLOSED', () => reply(replyTicket.id, 'vendor', 'a'));
    expect(blockedReply.statusCode).toBe(400);
    expect(blockedReply.json().message).toBe('Closed support tickets cannot receive replies.');
    expect(await read(replyTicket.id)).toMatchObject({ status: 'CLOSED', closedAt: expect.any(Date),
      replies: [], lastReplyAt: null, lastReplyByRole: null, adminUnreadCount: 2, vendorUnreadCount: 3,
      firstResponseDueAt: null, nextResponseDueAt: null });

    const escalation = await withPendingStatus(escalationTicket.id, 'CLOSED', () =>
      request('POST', `/support/tickets/${escalationTicket.id}/escalate`, 'a'));
    expect(escalation.statusCode).toBe(400);
    expect(await read(escalationTicket.id)).toMatchObject({ status: 'CLOSED', escalatedAt: null, adminUnreadCount: 2 });
  });
});
