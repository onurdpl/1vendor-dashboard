import { randomUUID } from 'node:crypto';
import jwt from '../backend/node_modules/jsonwebtoken/index.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppEnv } from '../backend/src/config/env.js';
import type { PrismaClient } from '../backend/node_modules/@prisma/client/index.js';

const url = process.env.TEST_DATABASE_URL?.trim();
const enabled = Boolean(url);
const targets = {
  '5433': { name: 'admin_password_reset_pg16_20261021', major: 16, systemId: '7689856229225255193',
    directory: '/opt/homebrew/var/postgresql@16', version: '160015' },
  '5432': { name: 'admin_password_reset_pg18_20261021', major: 18, systemId: '7637676237569338936',
    directory: '/opt/homebrew/var/postgresql@18', version: '180003' },
} as const;

describe.skipIf(!enabled)('Admin password reset on isolated PostgreSQL', () => {
  let db: PrismaClient;
  let auth: ReturnType<typeof import('../backend/src/modules/auth/auth.service.js')['createAuthService']>;
  let reset: typeof import('../backend/src/modules/vendors/vendor-password-reset.service.js')['resetVendorUserPassword'];
  let list: typeof import('../backend/src/modules/vendors/vendor-password-reset.service.js')['listVendorLoginUsers'];
  let operation: typeof import('../backend/src/modules/vendors/vendor-password-reset.service.js')['getVendorPasswordResetOperation'];
  let app: import('../backend/node_modules/fastify/types/instance.js').FastifyInstance;
  const vendorId = 'password-reset-test-vendor';
  const otherVendorId = 'password-reset-other-vendor';
  const env = { JWT_SECRET: 'isolated-password-reset-test-secret', JWT_EXPIRES_IN: '1h', NODE_ENV: 'test' } as AppEnv;
  const initialPassword = 'initial-test-password';
  const ids = { admin: 'reset-test-admin', target: 'reset-test-target', other: 'reset-test-other',
    multi: 'reset-test-multi', adminTarget: 'reset-test-admin-target', zero: 'reset-test-zero',
    apiTarget: 'reset-test-api-target', rollbackTarget: 'reset-test-rollback-target' };

  beforeAll(async () => {
    const target = new URL(url!);
    const expected = targets[target.port as keyof typeof targets];
    const ciProof = process.env.FIN_AUTO_CI_DB_PROOF;
    const ciTarget = process.env.GITHUB_ACTIONS === 'true' && process.env.CI === 'true' &&
      target.port === '5432' && target.pathname === '/admin_password_reset_ci_validation' &&
      target.username === 'postgres' && target.password === 'postgres' &&
      /^[a-f0-9]{64}$/.test(ciProof ?? '') && process.env.FIN_AUTO_CI_CLUSTER_ID;
    const localTarget = expected && target.pathname === `/${expected.name}` &&
      target.username === 'onur' && !target.password;
    if (process.env.ADMIN_PASSWORD_RESET_TEST_DATABASE_ISOLATED !== '1' ||
        target.protocol !== 'postgresql:' || target.hostname !== '127.0.0.1' ||
        target.searchParams.get('schema') !== 'public' ||
        target.searchParams.size !== 1 || !(ciTarget || localTarget)) {
      throw new Error('Password reset tests require an approved, dedicated local PostgreSQL URL.');
    }
    process.env.DATABASE_URL = url;
    const { PrismaClient } = await import('../backend/node_modules/@prisma/client/index.js');
    db = new PrismaClient({ datasources: { db: { url } } });
    await db.$connect();
    const [identity] = await db.$queryRaw<Array<{ database: string; owner: string; port: number; version: string;
      directory: string; systemId: bigint; comment: string | null }>>`
      SELECT current_database() AS database, current_user AS owner, inet_server_port() AS port,
        current_setting('server_version_num') AS version, current_setting('data_directory') AS directory,
        (pg_control_system()).system_identifier AS "systemId",
        shobj_description((SELECT oid FROM pg_database WHERE datname = current_database()), 'pg_database') AS comment
    `;
    if (ciTarget) {
      expect(identity).toMatchObject({ database: 'admin_password_reset_ci_validation', owner: 'postgres',
        port: 5432, comment: `fin-auto-ci:${ciProof}` });
      expect(Math.floor(Number(identity.version) / 10000)).toBe(Number(process.env.FIN_AUTO_CI_PG_MAJOR));
      expect(String(identity.systemId)).toBe(process.env.FIN_AUTO_CI_CLUSTER_ID);
    } else {
      expect(identity).toMatchObject({ database: expected!.name, owner: 'onur', port: Number(target.port),
        version: expected!.version, directory: expected!.directory });
      expect(String(identity.systemId)).toBe(expected!.systemId);
    }
    expect(await db.user.count()).toBe(0);
    expect(await db.vendor.count()).toBe(0);
    expect(await db.vendorPasswordResetAudit.count()).toBe(0);

    const { hashPasswordArgon2id } = await import('../backend/src/modules/auth/password-hashing.js');
    const passwordHash = await hashPasswordArgon2id(initialPassword);
    await db.vendor.createMany({ data: [
      { id: vendorId, name: 'Inactive test vendor', status: 'inactive' },
      { id: otherVendorId, name: 'Other test vendor' },
    ] });
    await db.user.createMany({ data: [
      { id: ids.admin, email: 'reset-admin@example.test', name: 'Test Admin', role: 'ADMIN', passwordHash },
      { id: ids.target, email: 'reset-target@example.test', name: 'Test Target', role: 'VENDOR', passwordHash },
      { id: ids.other, email: 'reset-other@example.test', name: 'Other User', role: 'VENDOR', passwordHash },
      { id: ids.multi, email: 'reset-multi@example.test', name: 'Multi User', role: 'VENDOR', passwordHash },
      { id: ids.adminTarget, email: 'reset-admin-target@example.test', name: 'Admin Target', role: 'ADMIN', passwordHash },
      { id: ids.zero, email: 'reset-zero@example.test', name: 'Zero Links', role: 'VENDOR', passwordHash },
      { id: ids.apiTarget, email: 'reset-api@example.test', name: 'API Target', role: 'VENDOR', passwordHash },
      { id: ids.rollbackTarget, email: 'reset-rollback@example.test', name: 'Rollback Target', role: 'VENDOR', passwordHash },
    ] });
    await db.userVendorAccess.createMany({ data: [
      { userId: ids.target, vendorId }, { userId: ids.other, vendorId: otherVendorId },
      { userId: ids.multi, vendorId }, { userId: ids.multi, vendorId: otherVendorId },
      { userId: ids.adminTarget, vendorId },
      { userId: ids.apiTarget, vendorId }, { userId: ids.rollbackTarget, vendorId },
    ] });

    const { createAuthService } = await import('../backend/src/modules/auth/auth.service.js');
    ({ resetVendorUserPassword: reset, listVendorLoginUsers: list,
      getVendorPasswordResetOperation: operation } = await import('../backend/src/modules/vendors/vendor-password-reset.service.js'));
    auth = createAuthService(env);
    const { default: Fastify } = await import('../backend/node_modules/fastify/fastify.js');
    const { registerVendorPasswordResetRoutes } = await import('../backend/src/modules/vendors/vendor-password-reset.routes.js');
    const { registerAuthRoutes } = await import('../backend/src/modules/auth/auth.routes.js');
    app = Fastify({ logger: false });
    registerAuthRoutes(app, env);
    registerVendorPasswordResetRoutes(app, env);
    await app.ready();
  });

  afterAll(async () => {
    if (db) {
      await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS "password_reset_audit_failure_test" ON "VendorPasswordResetAudit"');
      await db.$executeRawUnsafe('DROP FUNCTION IF EXISTS password_reset_audit_failure_test()');
    }
    await app?.close(); await db?.$disconnect();
  });

  async function directReset(targetUserId: string, expectedCredentialVersion = 0, actorAdminUserId = ids.admin,
    requestedVendorId = vendorId, operationId = randomUUID()) {
    return reset({ vendorId: requestedVendorId, targetUserId, actorAdminUserId, operationId, expectedCredentialVersion });
  }

  it('lists non-secret eligibility and enforces target, membership, vendor and actor authority', async () => {
    const listed = await list(vendorId);
    expect(listed.users.find((user) => user.userId === ids.target)).toMatchObject({ resetEligible: true, credentialVersion: 0 });
    expect(listed.users.find((user) => user.userId === ids.multi)).toMatchObject({
      resetEligible: false, ineligibilityReason: 'multiple_vendor_memberships' });
    expect(JSON.stringify(listed)).not.toContain('initial-test-password');
    await expect(directReset(ids.adminTarget)).rejects.toMatchObject({ code: 'target_not_vendor' });
    await expect(directReset(ids.multi)).rejects.toMatchObject({ code: 'multiple_vendor_memberships' });
    await expect(directReset(ids.zero)).rejects.toMatchObject({ code: 'target_vendor_mismatch' });
    await expect(directReset('missing-user')).rejects.toMatchObject({ code: 'target_vendor_mismatch' });
    await expect(directReset(ids.other)).rejects.toMatchObject({ code: 'target_vendor_mismatch' });
    await expect(directReset(ids.target, 0, ids.target)).rejects.toMatchObject({ code: 'admin_authority_lost' });
    expect(await db.vendorPasswordResetAudit.count()).toBe(0);
  });

  it('atomically rotates a password, invalidates old bearer/cookie/CSRF sessions and records secret-free audit', async () => {
    const oldTarget = await auth.login({ email: 'reset-target@example.test', password: initialPassword });
    const other = await auth.login({ email: 'reset-other@example.test', password: initialPassword });
    expect(oldTarget?.token).toBeTruthy();
    const legacy = jwt.sign({ sub: ids.target, email: 'reset-target@example.test', role: 'vendor' }, env.JWT_SECRET);
    expect((await auth.inspectToken(legacy)).user?.id).toBe(ids.target);
    const operationId = randomUUID();
    const result = await directReset(ids.target, 0, ids.admin, vendorId, operationId);
    expect(result.credentialVersion).toBe(1);
    expect(result.temporaryPassword).toMatch(/^spg_[A-Za-z0-9_-]{24}$/);
    const stored = await db.user.findUniqueOrThrow({ where: { id: ids.target } });
    expect(stored.passwordHash).toMatch(/^\$argon2id\$/);
    expect(stored.passwordHash).not.toContain(result.temporaryPassword);
    expect(stored.credentialVersion).toBe(1);
    const audits = await db.vendorPasswordResetAudit.findMany();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ operationId, actorAdminUserId: ids.admin,
      targetUserId: ids.target, vendorId, eventType: 'PASSWORD_RESET', credentialVersion: 1 });
    expect(JSON.stringify(audits)).not.toContain(result.temporaryPassword);
    expect(JSON.stringify(audits)).not.toContain(stored.passwordHash);
    expect((await auth.inspectToken(oldTarget!.token)).user).toBeNull();
    expect((await auth.inspectToken(legacy)).user).toBeNull();
    expect((await auth.inspectToken(other!.token)).user?.id).toBe(ids.other);
    expect(await auth.login({ email: 'reset-target@example.test', password: initialPassword })).toBeNull();
    const newLogin = await auth.login({ email: 'reset-target@example.test', password: result.temporaryPassword });
    expect(newLogin?.token).toBeTruthy();
    expect((await auth.inspectToken(newLogin!.token)).user?.id).toBe(ids.target);
    const cookie = `sporgym_session=${encodeURIComponent(oldTarget!.token)}`;
    const me = await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie } });
    expect(me.statusCode).toBe(401);
    const write = await app.inject({ method: 'POST', url: `/admin/vendors/${vendorId}/users/${ids.target}/password-reset`,
      headers: { cookie, 'x-csrf-token': auth.createCsrfToken(oldTarget!.token) },
      payload: { operationId: randomUUID(), expectedCredentialVersion: 1 } });
    expect(write.statusCode).toBe(401);
    const status = await operation(vendorId, operationId);
    expect(status).toMatchObject({ status: 'COMMITTED', targetUserId: ids.target });
    expect(JSON.stringify(status)).not.toContain(result.temporaryPassword);
    await expect(directReset(ids.target, 0)).rejects.toMatchObject({ code: 'credential_version_conflict' });
    await expect(directReset(ids.target, 0, ids.admin, vendorId, operationId)).rejects.toMatchObject({ code: 'operation_already_committed' });
    expect(await db.vendorPasswordResetAudit.count()).toBe(1);
  });

  it('enforces Admin API authorization and rejects malformed operation identifiers', async () => {
    const vendorLogin = await auth.login({ email: 'reset-other@example.test', password: initialPassword });
    const vendorRead = await app.inject({ method: 'GET', url: `/admin/vendors/${vendorId}/login-users`,
      headers: { authorization: `Bearer ${vendorLogin!.token}` } });
    expect(vendorRead.statusCode).toBe(403);
    const adminLogin = await auth.login({ email: 'reset-admin@example.test', password: initialPassword });
    const adminRead = await app.inject({ method: 'GET', url: `/admin/vendors/${vendorId}/login-users`,
      headers: { authorization: `Bearer ${adminLogin!.token}` } });
    expect(adminRead.statusCode).toBe(200);
    const malformed = await app.inject({ method: 'POST', url: `/admin/vendors/${vendorId}/users/${ids.target}/password-reset`,
      headers: { authorization: `Bearer ${adminLogin!.token}` },
      payload: { operationId: 'bad', expectedCredentialVersion: 1 } });
    expect(malformed.statusCode).toBe(400);
    const operationId = randomUUID();
    const cookie = `sporgym_session=${encodeURIComponent(adminLogin!.token)}`;
    const noCsrf = await app.inject({ method: 'POST', url: `/admin/vendors/${vendorId}/users/${ids.apiTarget}/password-reset`,
      headers: { cookie }, payload: { operationId, expectedCredentialVersion: 0 } });
    expect(noCsrf.statusCode).toBe(403);
    const withCsrf = await app.inject({ method: 'POST', url: `/admin/vendors/${vendorId}/users/${ids.apiTarget}/password-reset`,
      headers: { cookie, 'x-csrf-token': auth.createCsrfToken(adminLogin!.token) },
      payload: { operationId, expectedCredentialVersion: 0 } });
    expect(withCsrf.statusCode).toBe(201);
    expect(withCsrf.headers['cache-control']).toBe('no-store');
    const temporaryPassword = withCsrf.json().temporaryPassword as string;
    expect(temporaryPassword).toMatch(/^spg_/);
    const replay = await app.inject({ method: 'POST', url: `/admin/vendors/${vendorId}/users/${ids.apiTarget}/password-reset`,
      headers: { cookie, 'x-csrf-token': auth.createCsrfToken(adminLogin!.token) },
      payload: { operationId, expectedCredentialVersion: 0 } });
    expect(replay.statusCode).toBe(409);
    expect(replay.body).not.toContain(temporaryPassword);
    const status = await app.inject({ method: 'GET',
      url: `/admin/vendors/${vendorId}/password-reset-operations/${operationId}`,
      headers: { cookie } });
    expect(status.json()).toMatchObject({ status: 'COMMITTED', operationId });
    expect(status.body).not.toContain(temporaryPassword);
  });

  it('rolls back the password and version when audit insertion fails', async () => {
    const before = await db.user.findUniqueOrThrow({ where: { id: ids.rollbackTarget },
      select: { passwordHash: true, credentialVersion: true } });
    await db.$executeRawUnsafe(`
      CREATE FUNCTION password_reset_audit_failure_test() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW."targetUserId" = 'reset-test-rollback-target' THEN
          RAISE EXCEPTION 'isolated audit insertion failure';
        END IF;
        RETURN NEW;
      END $$;
    `);
    await db.$executeRawUnsafe(`
      CREATE TRIGGER "password_reset_audit_failure_test" BEFORE INSERT ON "VendorPasswordResetAudit"
      FOR EACH ROW EXECUTE FUNCTION password_reset_audit_failure_test();
    `);
    try {
      await expect(directReset(ids.rollbackTarget)).rejects.toMatchObject({ code: 'reset_outcome_unknown' });
      expect(await db.user.findUniqueOrThrow({ where: { id: ids.rollbackTarget },
        select: { passwordHash: true, credentialVersion: true } })).toEqual(before);
      expect(await db.vendorPasswordResetAudit.count({ where: { targetUserId: ids.rollbackTarget } })).toBe(0);
    } finally {
      await db.$executeRawUnsafe('DROP TRIGGER "password_reset_audit_failure_test" ON "VendorPasswordResetAudit"');
      await db.$executeRawUnsafe('DROP FUNCTION password_reset_audit_failure_test()');
    }
  });

  it('allows at most one concurrent reset from the same expected version', async () => {
    const attempts = await Promise.allSettled([directReset(ids.multi, 0, ids.admin, otherVendorId),
      directReset(ids.multi, 0, ids.admin, otherVendorId)]);
    expect(attempts.every((item) => item.status === 'rejected')).toBe(true);
    expect(await db.user.findUniqueOrThrow({ where: { id: ids.multi }, select: { credentialVersion: true } }))
      .toMatchObject({ credentialVersion: 0 });
    const [first, second] = await Promise.allSettled([
      directReset(ids.other, 0, ids.admin, otherVendorId),
      directReset(ids.other, 0, ids.admin, otherVendorId),
    ]);
    const results = [first, second];
    expect(results.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((item) => item.status === 'rejected')).toHaveLength(1);
    expect(results.find((item) => item.status === 'rejected')).toMatchObject({
      status: 'rejected', reason: { statusCode: 409, code: 'credential_version_conflict' },
    });
    expect(await db.vendorPasswordResetAudit.count({ where: { targetUserId: ids.other } })).toBe(1);
    expect(await db.user.findUniqueOrThrow({ where: { id: ids.other }, select: { credentialVersion: true } }))
      .toMatchObject({ credentialVersion: 1 });
  });
});
