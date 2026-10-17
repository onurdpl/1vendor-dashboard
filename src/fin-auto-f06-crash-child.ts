import { PrismaClient } from '../backend/node_modules/@prisma/client/index.js';

const target = process.env.TEST_DATABASE_URL;
const vendorId = process.env.FIN_AUTO_F06_VENDOR_ID;
const approvalId = process.env.FIN_AUTO_F06_APPROVAL_ID;
const attemptId = process.env.FIN_AUTO_F06_ATTEMPT_ID;
const mode = process.env.FIN_AUTO_F06_MODE;
if (!target || !vendorId || !approvalId || !attemptId || !['APPROVE', 'RECOVER', 'RECONCILE'].includes(mode ?? '') ||
    process.env.FIN_AUTO_F06_TEST_DATABASE_ISOLATED !== '1' || process.env.DATABASE_URL !== target) {
  throw new Error('F-06 child requires the exact isolated target and fixture identities.');
}
const parsed = new URL(target);
const pg16 = parsed.port === '5433' && parsed.pathname === '/fin_auto_f06_pg16_7d31e84c1a64';
const pg18 = parsed.port === '5432' && parsed.pathname === '/fin_auto_f06_pg18_4f88ae2b0c39';
const local = parsed.username === 'onur' && !parsed.password && (pg16 || pg18);
const ci = process.env.GITHUB_ACTIONS === 'true' && process.env.CI === 'true' &&
  process.env.FIN_AUTO_CI_DB_PROOF?.match(/^[a-f0-9]{64}$/) &&
  process.env.FIN_AUTO_CI_CLUSTER_ID?.match(/^\d+$/) &&
  parsed.username === 'postgres' && parsed.password === 'postgres' &&
  parsed.port === '5432' && parsed.pathname === '/fin_auto_f06_ci_validation';
if (parsed.protocol !== 'postgresql:' || parsed.hostname !== '127.0.0.1' ||
    parsed.searchParams.get('schema') !== 'public' || parsed.searchParams.size !== 1 ||
    parsed.hash || !(local || ci)) throw new Error('F-06 child target is not approved.');

const db = new PrismaClient({ datasources: { db: { url: target } } });
const [identity] = await db.$queryRaw<Array<{ name: string; port: number; version: string;
  systemId: bigint; owner: string; proof: string | null }>>`
  SELECT current_database() AS name, inet_server_port() AS port,
    current_setting('server_version_num') AS version,
    (SELECT system_identifier FROM pg_control_system()) AS "systemId",
    (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database()) AS owner,
    (SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname=current_database()) AS proof`;
if (identity?.name !== parsed.pathname.slice(1) || identity.port !== Number(parsed.port) ||
    Math.floor(Number(identity.version) / 10000) !== (local ? (pg16 ? 16 : 18) : Number(process.env.FIN_AUTO_CI_PG_MAJOR)) ||
    String(identity.systemId) !== (local ? (pg16 ? '7689856229225255193' : '7637676237569338936') : process.env.FIN_AUTO_CI_CLUSTER_ID) ||
    (ci && identity.proof !== `fin-auto-ci:${process.env.FIN_AUTO_CI_DB_PROOF}`) ||
    identity.owner !== parsed.username) throw new Error('F-06 child PostgreSQL identity mismatch.');
const { prisma } = await import('../backend/src/db/prisma.js');
const [canonical] = await prisma.$queryRaw<Array<{ name: string; port: number; systemId: bigint }>>`
  SELECT current_database() AS name, inet_server_port() AS port,
    (SELECT system_identifier FROM pg_control_system()) AS "systemId"`;
if (canonical?.name !== identity.name || canonical.port !== identity.port ||
    String(canonical.systemId) !== String(identity.systemId)) {
  throw new Error('F-06 child canonical Prisma connection mismatch.');
}
if (!process.send) throw new Error('F-06 child requires a test-owned IPC channel.');
process.once('message', async (message) => {
  try {
    if (message !== 'GO') throw new Error('F-06 child was not explicitly released.');
    if (mode === 'APPROVE') {
      const { approveSettlementDraftInternally } = await import(
        '../backend/src/modules/finance/settlement-auto-approval.service.js');
      const result = await approveSettlementDraftInternally({ settlementApprovalId: approvalId,
        expectedVendorId: vendorId, attemptId });
      process.send?.({ kind: 'RETURNED', status: result.status });
      // The parent may terminate this test-owned process before caller acknowledgement.
      process.once('message', async (ack) => {
        if (ack !== 'ACK') return;
        await db.$disconnect();
        await prisma.$disconnect();
        process.disconnect();
      });
      return;
    }
    if (mode === 'RECONCILE') {
      const { reconcileAutomaticApprovalAttempt } = await import(
        '../backend/src/modules/finance/settlement-auto-approval.service.js');
      const result = await reconcileAutomaticApprovalAttempt({ attemptId,
        settlementApprovalId: approvalId, expectedVendorId: vendorId });
      process.send?.({ kind: 'RESULT', result });
      await db.$disconnect();
      await prisma.$disconnect();
      process.disconnect();
      return;
    }
    const { runAutomaticSettlementApprovalSweep } = await import(
      '../backend/src/modules/finance/settlement-auto-approval-scheduler.service.js');
    const result = await runAutomaticSettlementApprovalSweep({ vendorIds: [vendorId] });
    process.send?.({ kind: 'RESULT', result });
    await db.$disconnect();
    await prisma.$disconnect();
    process.disconnect();
  } catch (error) {
    process.send?.({ kind: 'ERROR', errorType: error instanceof Error ? error.name : 'UNKNOWN' });
    await db.$disconnect();
    await prisma.$disconnect();
    process.disconnect();
  }
});
process.send({ kind: 'READY', pid: process.pid });
