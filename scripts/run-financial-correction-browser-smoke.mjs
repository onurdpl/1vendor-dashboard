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

const scenarios = [
  {
    name: 'review-credit',
    fixture: 'tests/e2e/fixtures/review-credit.ts',
    reviewId: 'browser-smoke-review-credit-review',
    spec: 'financial-correction-review-credit.real.spec.ts',
    verify: 'tests/e2e/fixtures/verify-review-credit.ts',
  },
  {
    name: 'draft-deduction',
    fixture: 'tests/e2e/fixtures/draft-deduction.ts',
    reviewId: 'browser-smoke-draft-deduction-review',
    spec: 'financial-correction-draft-deduction.real.spec.ts',
    verify: 'tests/e2e/fixtures/verify-draft-deduction.ts',
  },
  {
    name: 'paid-deduction',
    fixture: 'tests/e2e/fixtures/paid-deduction.ts',
    reviewId: 'browser-smoke-paid-deduction-review',
    spec: 'financial-correction-paid-deduction.real.spec.ts',
    verify: 'tests/e2e/fixtures/verify-paid-deduction.ts',
  },
];
const requested = process.argv.slice(2);
if (requested.length > 1 || (requested.length === 1 && !/^--scenario=(review-credit|draft-deduction|paid-deduction)$/.test(requested[0]))) {
  throw new Error('Use no arguments for all smokes, or --scenario=review-credit|draft-deduction|paid-deduction.');
}
const selectedScenarios = requested.length
  ? scenarios.filter((scenario) => `--scenario=${scenario.name}` === requested[0])
  : scenarios;
const localBackend = 'http://localhost:4000';
const localFrontend = 'http://localhost:5173';
const baseEnv = {
  PATH: process.env.PATH || '',
  HOME: process.env.HOME || '',
  TMPDIR: process.env.TMPDIR || '/tmp',
  ...(process.env.PGPASSWORD ? { PGPASSWORD: process.env.PGPASSWORD } : {}),
};
const backendDefaults = {
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

function run(command, args, env = baseEnv) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}.`)));
  });
}

function start(command, args, env, processes) {
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

async function stopServers(processes) {
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

async function runScenario(scenario) {
  if (await portOpen('127.0.0.1', 4000) || await portOpen('::1', 4000) ||
      await portOpen('127.0.0.1', 5173) || await portOpen('::1', 5173)) {
    throw new Error('Ports 4000 and 5173 must be free; refusing to attach to existing servers.');
  }
  const databaseName = `vendor_dashboard_browser_smoke_${process.pid}_${Date.now()}`;
  const targetUrl = new URL(adminUrl);
  targetUrl.pathname = `/${databaseName}`;
  targetUrl.searchParams.set('schema', 'public');
  const databaseEnv = { ...baseEnv, DATABASE_URL: targetUrl.toString(), BROWSER_SMOKE_ALLOW_LOCAL_DB: '1' };
  const backendEnv = { ...databaseEnv, ...backendDefaults };
  const processes = [];
  let databaseCreated = false;
  console.log(`Running real browser scenario ${scenario.name}.`);
  try {
    await run('createdb', [`--maintenance-db=${adminUrl.toString()}`, databaseName]);
    databaseCreated = true;
    console.log(`Created disposable database ${databaseName}.`);
    await run('npm', ['run', 'backend:db:generate'], databaseEnv);
    await run('npm', ['run', 'backend:db:bootstrap:fresh'], databaseEnv);
    await run('node_modules/.bin/tsx', [scenario.fixture], databaseEnv);
    await run('npm', ['run', 'backend:build'], backendEnv);
    await run('npm', ['run', 'build'], frontendEnv);

    const backend = start('npm', ['run', 'backend:start'], backendEnv, processes);
    await waitFor(`${localBackend}/health`, async (response) => {
      const health = await response.json();
      return health.status === 'ok' && health.dbReachable === true && health.schemaReady === true;
    }, backend);
    const frontend = start('npm', ['run', 'preview', '--', '--host', 'localhost', '--port', '5173', '--strictPort'], frontendEnv, processes);
    await waitFor(localFrontend, async () => true, frontend);
    await run('node_modules/.bin/playwright', ['test', '--config', 'playwright.real.config.ts'], {
      ...baseEnv, BROWSER_SMOKE_REVIEW_ID: scenario.reviewId, BROWSER_SMOKE_REAL_SPEC: scenario.spec,
    });
    await run('node_modules/.bin/tsx', [scenario.verify], databaseEnv);
    console.log(`Real browser scenario ${scenario.name} passed browser and DB post-check.`);
  } finally {
    await stopServers(processes);
    if (databaseCreated) {
      await run('dropdb', ['--force', `--maintenance-db=${adminUrl.toString()}`, databaseName]);
      console.log(`Disposed database ${databaseName}.`);
    }
  }
}

for (const scenario of selectedScenarios) await runScenario(scenario);
