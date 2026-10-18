import { PrismaClient } from '../backend/node_modules/@prisma/client/index.js';
import { registerSettlementAutoApprovalScheduler,
  runAutomaticSettlementApprovalSweep } from '../backend/src/modules/finance/settlement-auto-approval-scheduler.service.js';
import { prisma as canonicalPrisma } from '../backend/src/db/prisma.js';

const target = process.env.TEST_DATABASE_URL;
const vendorId = process.env.FIN_AUTO_F03_VENDOR_ID;
if (!target || !vendorId || process.env.FIN_AUTO_P4_TEST_DATABASE_ISOLATED !== '1') {
  throw new Error('F-03 child requires the approved isolated database and exact vendor.');
}
const parsed = new URL(target);
const local = parsed.username === 'onur' && !parsed.password &&
  (parsed.port === '5433' && parsed.pathname === '/fin_auto_p4_pg16_8f2ab319' ||
    parsed.port === '5432' && parsed.pathname === '/fin_auto_p4_pg18_143fa61d' ||
    parsed.port === '5433' && parsed.pathname === '/fin_auto_f03f04_pg16_8be49807045e528f' ||
    parsed.port === '5432' && parsed.pathname === '/fin_auto_f03f04_pg18_cec3364d531b5fae');
const ci = process.env.GITHUB_ACTIONS === 'true' && process.env.CI === 'true' &&
  process.env.FIN_AUTO_CI_DB_PROOF?.match(/^[a-f0-9]{64}$/) &&
  process.env.FIN_AUTO_CI_CLUSTER_ID?.match(/^\d+$/) &&
  parsed.username === 'postgres' && parsed.password === 'postgres' &&
  parsed.port === '5432' && parsed.pathname === '/fin_auto_f03f04_ci_validation';
if (parsed.protocol !== 'postgresql:' || parsed.hostname !== '127.0.0.1' ||
    parsed.searchParams.get('schema') !== 'public' || parsed.searchParams.size !== 1 ||
    parsed.hash || !(local || ci) || process.env.DATABASE_URL !== target) {
  throw new Error('F-03 child database target is not the approved canonical Prisma target.');
}

const db = new PrismaClient({ datasources: { db: { url: target } } });
const [identity] = await db.$queryRaw<Array<{ name: string; port: number; version: string;
  systemId: bigint; owner: string; proof: string | null }>>`
  SELECT current_database() AS name, inet_server_port() AS port,
    current_setting('server_version_num') AS version,
    (SELECT system_identifier FROM pg_control_system()) AS "systemId",
    (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database()) AS owner,
    (SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname=current_database()) AS proof`;
if (identity?.name !== parsed.pathname.slice(1) || identity.port !== Number(parsed.port) ||
    Math.floor(Number(identity.version) / 10000) !== (local ? (parsed.port === '5433' ? 16 : 18) : Number(process.env.FIN_AUTO_CI_PG_MAJOR)) ||
    String(identity.systemId) !== (local ? (parsed.port === '5433' ? '7689856229225255193' : '7637676237569338936') : process.env.FIN_AUTO_CI_CLUSTER_ID) ||
    (ci && identity.proof !== `fin-auto-ci:${process.env.FIN_AUTO_CI_DB_PROOF}`) ||
    identity.owner !== parsed.username) {
  throw new Error('F-03 child connected to the wrong PostgreSQL instance.');
}
const [canonical] = await canonicalPrisma.$queryRaw<Array<{ name: string; port: number; systemId: bigint }>>`
  SELECT current_database() AS name, inet_server_port() AS port,
    (SELECT system_identifier FROM pg_control_system()) AS "systemId"`;
if (canonical?.name !== identity.name || canonical.port !== identity.port ||
    String(canonical.systemId) !== String(identity.systemId)) {
  throw new Error('F-03 child canonical Prisma target mismatch.');
}
const candidates = await db.settlementApproval.findMany({
  where: { vendorId, status: 'DRAFT' }, select: { id: true }, orderBy: { id: 'asc' },
});
const app = { log: { info() {}, warn() {}, error() {} }, addHook() {} } as unknown as
  Parameters<typeof registerSettlementAutoApprovalScheduler>[0];
const scheduler = registerSettlementAutoApprovalScheduler(app,
  { SETTLEMENT_AUTO_APPROVAL_SCHEDULER_ENABLED: true },
  { runSweep: () => runAutomaticSettlementApprovalSweep({ vendorIds: [vendorId] }) });
if (!scheduler || !process.send) throw new Error('F-03 child scheduler/IPC is unavailable.');
process.send({ kind: 'READY', candidates: candidates.map((row) => row.id) });
process.once('message', async (message) => {
  try {
    if (message !== 'GO') throw new Error('F-03 child was not explicitly released.');
    const result = await scheduler.runTick();
    process.send?.({ kind: 'RESULT', result });
  } catch (error) {
    process.send?.({ kind: 'ERROR', errorType: error instanceof Error ? error.name : 'UNKNOWN' });
  } finally {
    await db.$disconnect();
    await canonicalPrisma.$disconnect();
    process.disconnect();
  }
});
