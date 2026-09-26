import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import { userInfo } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const adminUrl = new URL(process.env.BROWSER_SMOKE_ADMIN_DATABASE_URL ||
  `postgresql://${encodeURIComponent(userInfo().username)}@localhost/postgres`);
if (process.env.BROWSER_SMOKE_ALLOW_LOCAL_DB !== '1' || adminUrl.hostname !== 'localhost' ||
    !adminUrl.username || adminUrl.pathname !== '/postgres' || adminUrl.search || adminUrl.hash) {
  throw new Error('Set BROWSER_SMOKE_ALLOW_LOCAL_DB=1 with a local /postgres maintenance URL.');
}

const databaseName = `vendor_dashboard_browser_smoke_${process.pid}_${Date.now()}`;
const targetUrl = new URL(adminUrl);
targetUrl.pathname = `/${databaseName}`;
targetUrl.searchParams.set('schema', 'public');
const databaseUrl = targetUrl.toString();
const localBackend = 'http://localhost:4000';
const localFrontend = 'http://localhost:5173';
const baseEnv = {
  PATH: process.env.PATH || '',
  HOME: process.env.HOME || '',
  TMPDIR: process.env.TMPDIR || '/tmp',
  ...(process.env.PGPASSWORD ? { PGPASSWORD: process.env.PGPASSWORD } : {}),
};
const databaseEnv = { ...baseEnv, DATABASE_URL: databaseUrl, BROWSER_SMOKE_ALLOW_LOCAL_DB: '1' };
const backendEnv = {
  ...databaseEnv,
  NODE_ENV: 'test', PORT: '4000', CORS_ORIGIN: localFrontend,
  JWT_SECRET: 'browser-smoke-local-only-session-secret',
  SHOPIFY_ORDERS_CREATE_EXECUTOR_ENABLED: 'false',
  SHOPIFY_ORDERS_CREATE_ASYNC_ACK_ENABLED: 'false',
  SHOPIFY_MISSED_ORDER_DISCOVERY_ENABLED: 'false',
  CANONICAL_RECONCILIATION_ENABLED: 'false',
  SCHEDULED_RECONCILIATION_ENABLED: 'false',
  SETTLEMENT_AUTO_DRAFT_JOB_ENABLED: 'false',
  APPROVED_RETURN_AUTO_CANCEL_ENABLED: 'false',
  CUSTOMER_CANCELLATION_INTAKE_ENABLED: 'false',
  CUSTOMER_CANCELLATION_AUTO_REFUND_ENABLED: 'false',
  SHIPPING_EXECUTION_ENABLED: 'false',
  EMAIL_NOTIFICATIONS_ENABLED: 'false', EMAIL_PROVIDER: 'noop',
  LIDIO_ENABLED: 'false', LOGO_ISBASI_CREATE_ENABLED: 'false',
  KARGONOMI_BASE_URL: 'http://localhost:9', KARGONOMI_API_TOKEN: 'browser-smoke-inert',
};
const frontendEnv = {
  ...baseEnv, VITE_API_MODE: 'real', VITE_API_BASE_URL: localBackend,
};
const processes = [];
let databaseCreated = false;

function run(command, args, env = baseEnv) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}.`)));
  });
}

function start(command, args, env) {
  const child = spawn(command, args, { cwd: root, env, stdio: 'inherit', detached: true });
  processes.push(child);
  return child;
}

function portOpen(host, port) {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    socket.setTimeout(700);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
  });
}

async function waitFor(url, check, child) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`${url} server exited before readiness.`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (response.ok && await check(response)) return;
    } catch { /* Wait for the dedicated local process. */ }
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  throw new Error(`${url} did not become ready.`);
}

async function stopServers() {
  for (const child of processes.reverse()) {
    if (!child.pid) continue;
    try { process.kill(-child.pid, 'SIGTERM'); } catch { /* Already exited. */ }
  }
  await new Promise((resolve) => setTimeout(resolve, 1200));
  for (const child of processes) {
    if (!child.pid || child.exitCode !== null) continue;
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Already exited. */ }
  }
}

async function main() {
  if (await portOpen('127.0.0.1', 4000) || await portOpen('::1', 4000) ||
      await portOpen('127.0.0.1', 5173) || await portOpen('::1', 5173)) {
    throw new Error('Ports 4000 and 5173 must be free; refusing to attach to existing servers.');
  }
  try {
    await run('createdb', [`--maintenance-db=${adminUrl.toString()}`, databaseName]);
    databaseCreated = true;
    console.log(`Created disposable database ${databaseName}.`);
    await run('npm', ['run', 'backend:db:generate'], databaseEnv);
    await run('npm', ['run', 'backend:db:bootstrap:fresh'], databaseEnv);
    await run('node_modules/.bin/tsx', ['tests/e2e/fixtures/review-credit.ts'], databaseEnv);
    await run('npm', ['run', 'backend:build'], backendEnv);
    await run('npm', ['run', 'build'], frontendEnv);

    const backend = start('npm', ['run', 'backend:start'], backendEnv);
    await waitFor(`${localBackend}/health`, async (response) => {
      const health = await response.json();
      return health.status === 'ok' && health.dbReachable === true && health.schemaReady === true;
    }, backend);
    const frontend = start('npm', ['run', 'preview', '--', '--host', 'localhost', '--port', '5173', '--strictPort'], frontendEnv);
    await waitFor(localFrontend, async () => true, frontend);
    await run('node_modules/.bin/playwright', ['test', '--config', 'playwright.real.config.ts'], {
      ...baseEnv, BROWSER_SMOKE_REVIEW_ID: 'browser-smoke-review-credit-review',
    });
    await run('node_modules/.bin/tsx', ['tests/e2e/fixtures/verify-review-credit.ts'], databaseEnv);
  } finally {
    await stopServers();
    if (databaseCreated) {
      await run('dropdb', ['--force', `--maintenance-db=${adminUrl.toString()}`, databaseName]);
      console.log(`Disposed database ${databaseName}.`);
    }
  }
}

await main();
