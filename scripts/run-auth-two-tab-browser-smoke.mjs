import { execFileSync, spawn } from 'node:child_process';
import { connect } from 'node:net';
import { randomBytes } from 'node:crypto';
import { userInfo } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scenario = process.argv[2] === '--scenario=vendor-context' ? 'vendor-context' : 'auth-session';
if (process.argv.length > 3 || (process.argv[2] && process.argv[2] !== '--scenario=vendor-context')) {
  throw new Error('Unsupported auth browser scenario.');
}
const guard = join(root, 'scripts/test-node-egress-guard.mjs');
const adminUrl = new URL(process.env.AUTH_BROWSER_ADMIN_DATABASE_URL ??
  `postgresql://${encodeURIComponent(userInfo().username)}@localhost:5432/postgres`);
if (process.env.AUTH_BROWSER_ALLOW_LOCAL_DB !== '1' || adminUrl.hostname !== 'localhost' ||
    adminUrl.pathname !== '/postgres' || adminUrl.port !== '5432' || !adminUrl.username ||
    adminUrl.password || adminUrl.search || adminUrl.hash) {
  throw new Error('Auth browser smoke requires explicit local PostgreSQL maintenance target.');
}

const baseEnv = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', TMPDIR: process.env.TMPDIR ?? '/tmp' };
const guardedEnv = { ...baseEnv, NODE_OPTIONS: `--import=${guard}` };
const databaseName = `vendor_dashboard_auth_browser_${process.pid}_${Date.now()}`;
const proof = randomBytes(32).toString('hex');
const target = new URL(adminUrl);
target.pathname = `/${databaseName}`;
target.searchParams.set('schema', 'public');
const dbEnv = { ...guardedEnv, DATABASE_URL: target.toString(), AUTH_BROWSER_ALLOW_LOCAL_DB: '1', AUTH_BROWSER_DB_PROOF: proof };
const backendEnv = {
  ...dbEnv, NODE_ENV: 'test', PORT: '4000', CORS_ORIGIN: 'http://localhost:5173',
  JWT_SECRET: 'auth-browser-local-only-session-secret',
  SHOPIFY_ORDERS_CREATE_EXECUTOR_ENABLED: 'false', SHOPIFY_ORDERS_CREATE_ASYNC_ACK_ENABLED: 'false',
  SHOPIFY_MISSED_ORDER_DISCOVERY_ENABLED: 'false', CANONICAL_RECONCILIATION_ENABLED: 'false',
  SCHEDULED_RECONCILIATION_ENABLED: 'false', SETTLEMENT_AUTO_DRAFT_JOB_ENABLED: 'false',
  SETTLEMENT_AUTO_APPROVAL_SCHEDULER_ENABLED: 'false', SETTLEMENT_AUTO_DRAFT_SCHEDULER_ENABLED: 'false',
  SETTLEMENT_AUTO_DRAFT_WRITE_SCHEDULER_ENABLED: 'false', APPROVED_RETURN_AUTO_CANCEL_ENABLED: 'false',
  CUSTOMER_CANCELLATION_INTAKE_ENABLED: 'false', CUSTOMER_CANCELLATION_AUTO_REFUND_ENABLED: 'false',
  SHIPPING_EXECUTION_ENABLED: 'false', EMAIL_NOTIFICATIONS_ENABLED: 'false', EMAIL_PROVIDER: 'noop',
  LOGO_ISBASI_CREATE_ENABLED: 'false', KARGONOMI_BASE_URL: 'http://localhost:9',
  KARGONOMI_API_TOKEN: 'auth-browser-inert',
};
const frontendEnv = { ...guardedEnv, VITE_API_MODE: 'real', VITE_API_BASE_URL: 'http://localhost:4000' };

function inspect(database = 'postgres') {
  const url = new URL(adminUrl);
  url.pathname = `/${database}`;
  return JSON.parse(execFileSync('psql', ['-XAt', `--dbname=${url}`, '-v', 'ON_ERROR_STOP=1', '-c',
    `SELECT json_build_object('major',current_setting('server_version_num')::int/10000,
      'owner',current_user,'databaseOwner',pg_get_userbyid(datdba),
      'systemId',(pg_control_system()).system_identifier::text,
      'port',inet_server_port(),'comment',shobj_description(d.oid,'pg_database'))
      FROM pg_database d WHERE datname=current_database()`], { cwd: root, env: baseEnv, encoding: 'utf8' }));
}
function run(command, args, env = guardedEnv) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolveRun() : reject(new Error(`${command} exited with ${code}.`)));
  });
}
function portOpen(port) {
  return new Promise(resolvePort => {
    const socket = connect({ host: '127.0.0.1', port });
    socket.setTimeout(500);
    socket.once('connect', () => { socket.destroy(); resolvePort(true); });
    socket.once('error', () => resolvePort(false));
    socket.once('timeout', () => { socket.destroy(); resolvePort(false); });
  });
}
async function ready(url, process) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (process.exitCode !== null) throw new Error(`Local server exited before ${url} was ready.`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (response.ok) return;
    } catch { /* Await the process created by this runner. */ }
    await new Promise(resolveWait => setTimeout(resolveWait, 350));
  }
  throw new Error(`Local server did not become ready: ${url}`);
}
function start(command, args, env, processes) {
  const child = spawn(command, args, { cwd: root, env, stdio: 'inherit', detached: true });
  processes.push(child);
  return child;
}
async function stop(processes) {
  for (const child of processes.reverse()) {
    if (child.pid) try { process.kill(-child.pid, 'SIGTERM'); } catch { /* exited */ }
  }
  await new Promise(resolveWait => setTimeout(resolveWait, 1200));
  for (const child of processes) {
    if (child.pid && child.exitCode === null) try { process.kill(-child.pid, 'SIGKILL'); } catch { /* exited */ }
  }
}

if (await portOpen(4000) || await portOpen(5173)) {
  throw new Error('Ports 4000 and 5173 must be free.');
}
const cluster = inspect();
if (cluster.major !== 18 || cluster.port !== 5432 || cluster.owner !== cluster.databaseOwner) {
  throw new Error('Local PostgreSQL 18 cluster identity was not verified.');
}
dbEnv.AUTH_BROWSER_CLUSTER_ID = cluster.systemId;
let created = false;
let proved = false;
const processes = [];
try {
  await run('createdb', [`--maintenance-db=${adminUrl}`, databaseName], baseEnv);
  created = true;
  execFileSync('psql', [`--dbname=${adminUrl}`, '-v', 'ON_ERROR_STOP=1', '-c',
    `COMMENT ON DATABASE "${databaseName}" IS 'auth-browser:${proof}'`], { cwd: root, env: baseEnv });
  const identity = inspect(databaseName);
  if (identity.major !== 18 || identity.systemId !== cluster.systemId || identity.owner !== cluster.owner ||
      identity.databaseOwner !== cluster.owner || identity.comment !== `auth-browser:${proof}`) {
    throw new Error('Disposable auth browser database identity mismatch.');
  }
  proved = true;
  console.log(`Disposable local PostgreSQL 18 database ${databaseName} identity verified.`);
  await run('npm', ['run', 'backend:db:generate'], dbEnv);
  await run('npm', ['run', 'backend:db:bootstrap:fresh'], dbEnv);
  await run('node_modules/.bin/tsx', [scenario === 'vendor-context'
    ? 'tests/e2e/fixtures/global-vendor-context.ts' : 'tests/e2e/fixtures/auth-session-ownership.ts'], dbEnv);
  await run('npm', ['run', 'backend:build'], backendEnv);
  await run('npm', ['run', 'build'], frontendEnv);
  const backend = start('npm', ['run', 'backend:start'], backendEnv, processes);
  await ready('http://localhost:4000/health', backend);
  const frontend = start('npm', ['run', 'dev', '--', '--host', 'localhost', '--port', '5173', '--strictPort'], frontendEnv, processes);
  await ready('http://localhost:5173', frontend);
  await run('node_modules/.bin/tsx', [scenario === 'vendor-context'
    ? 'tests/e2e/global-vendor-context.real.spec.ts' : 'tests/e2e/auth-session-ownership.real.spec.ts'],
    { ...guardedEnv, AUTH_BROWSER_REAL_TEST: '1' });
} finally {
  await stop(processes);
  if (created && proved) {
    const identity = inspect(databaseName);
    if (identity.systemId !== cluster.systemId || identity.databaseOwner !== cluster.owner ||
        identity.comment !== `auth-browser:${proof}`) {
      throw new Error('Auth browser cleanup identity mismatch; database retained.');
    }
    await run('dropdb', ['--force', `--maintenance-db=${adminUrl}`, databaseName], baseEnv);
    const remaining = execFileSync('psql', [`--dbname=${adminUrl}`, '-XAt', '-v', 'ON_ERROR_STOP=1',
      '-c', `SELECT count(*) FROM pg_database WHERE datname='${databaseName}'`],
    { cwd: root, env: baseEnv, encoding: 'utf8' }).trim();
    if (remaining !== '0') throw new Error('Auth browser disposable database cleanup not verified.');
    console.log(`Disposable database ${databaseName} cleanup independently verified.`);
  } else if (created) {
    throw new Error(`Unproved database ${databaseName} retained for manual inspection; no destructive cleanup attempted.`);
  }
}
