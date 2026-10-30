import { spawn, execFileSync } from 'node:child_process';
import { connect } from 'node:net';
import { userInfo } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nodeEgressGuard = path.join(root, 'scripts/test-node-egress-guard.mjs');
const adminUrl = new URL(process.env.BROWSER_SMOKE_ADMIN_DATABASE_URL ||
  `postgresql://${encodeURIComponent(userInfo().username)}@localhost/postgres`);
if (process.env.BROWSER_SMOKE_ALLOW_LOCAL_DB !== '1' || adminUrl.hostname !== 'localhost' ||
    !adminUrl.username || adminUrl.pathname !== '/postgres' || adminUrl.search || adminUrl.hash) {
  throw new Error('Set BROWSER_SMOKE_ALLOW_LOCAL_DB=1 with a local /postgres maintenance URL.');
}

const scenarios = [
  { name: 'fin03-history', explicitOnly: true,
    fixture: 'tests/e2e/fixtures/fin03-settlement-history.ts', reviewId: 'fin03-history',
    spec: 'fin03-settlement-history.real.spec.ts', verify: 'tests/e2e/fixtures/verify-fin03-settlement-history.ts' },
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
  {
    name: 'zero-net',
    fixture: 'tests/e2e/fixtures/zero-net.ts',
    reviewId: 'browser-smoke-zero-net-review',
    spec: 'financial-correction-zero-net.real.spec.ts',
    verify: 'tests/e2e/fixtures/verify-zero-net.ts',
  },
  {
    name: 'approved-no-payout-deduction',
    fixture: 'tests/e2e/fixtures/approved-no-payout-deduction.ts',
    reviewId: 'browser-smoke-approved-no-payout-deduction-review',
    spec: 'financial-correction-approved-no-payout-deduction.real.spec.ts',
    verify: 'tests/e2e/fixtures/verify-approved-no-payout-deduction.ts',
  },
  {
    name: 'settlement-replacement',
    fixture: 'tests/e2e/fixtures/settlement-replacement.ts',
    reviewId: 'browser-smoke-settlement-replacement',
    spec: 'settlement-replacement.real.spec.ts',
    verify: 'tests/e2e/fixtures/verify-settlement-replacement.ts',
  },
];
const requested = process.argv.slice(2);
if (requested.length > 1 || (requested.length === 1 && !/^--scenario=(review-credit|draft-deduction|paid-deduction|zero-net|approved-no-payout-deduction|settlement-replacement|fin03-history)$/.test(requested[0]))) {
  throw new Error('Use no arguments for all smokes, or --scenario=review-credit|draft-deduction|paid-deduction|zero-net|approved-no-payout-deduction|settlement-replacement.');
}
const selectedScenarios = requested.length
  ? scenarios.filter((scenario) => `--scenario=${scenario.name}` === requested[0])
  : scenarios.filter(scenario => !scenario.explicitOnly);
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
  LOGO_ISBASI_CREATE_ENABLED: 'false',
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
  const fin03 = scenario.name === 'fin03-history';
  const proof = fin03 ? randomBytes(32).toString('hex') : '';
  const evidencePath = path.join(process.env.TMPDIR || '/tmp', `${databaseName}.fin03.json`);
  function inspect(database = 'postgres') {
    const url = new URL(adminUrl); url.pathname = `/${database}`;
    return JSON.parse(execFileSync('psql', ['-XAt', `--dbname=${url}`, '-v', 'ON_ERROR_STOP=1', '-c',
      "SELECT json_build_object('major',current_setting('server_version_num')::int/10000,'owner',current_user,'databaseOwner',pg_get_userbyid(d.datdba),'systemId',(pg_control_system()).system_identifier::text,'directory',current_setting('data_directory'),'port',inet_server_port(),'comment',shobj_description(d.oid,'pg_database')) FROM pg_database d WHERE datname=current_database()"], { env: baseEnv, encoding: 'utf8' }));
  }
  const cluster = fin03 ? inspect() : null;
  const recovery = fin03 && process.env.FIN03_RECOVERY_SMOKE === '1';
  if (recovery) {
    if (cluster.major !== 18 || cluster.systemId !== process.env.FIN03_RECOVERY_CLUSTER_ID ||
        cluster.directory !== process.env.FIN03_RECOVERY_CLUSTER_DIRECTORY ||
        !/^\/private\/tmp\/fin03-reg16c-[A-Za-z0-9_-]+\/data$/.test(cluster.directory) ||
        cluster.port !== Number(process.env.FIN03_RECOVERY_CLUSTER_PORT) || cluster.port <= 1024 ||
        cluster.port === 5432 || cluster.owner !== 'postgres' || cluster.databaseOwner !== 'postgres' ||
        !/^[a-f0-9]{64}$/.test(process.env.FIN03_RECOVERY_CLUSTER_PROOF || '') ||
        cluster.comment !== `fin03-reg16c:${process.env.FIN03_RECOVERY_CLUSTER_PROOF}`)
      throw new Error('FIN03 recovery requires a separately owned, proved temporary PG18 cluster.');
  } else if (fin03 && (cluster.major !== 18 || adminUrl.password || adminUrl.port !== '5432'))
    throw new Error('FIN03 requires verified local PostgreSQL18 without inherited credentials.');
  const databaseEnv = { ...baseEnv, DATABASE_URL: targetUrl.toString(), BROWSER_SMOKE_ALLOW_LOCAL_DB: '1',
    ...(fin03 ? { PGPASSWORD: undefined, FIN03_DB_PROOF: proof, FIN03_CLUSTER_ID: cluster.systemId,
      BROWSER_SMOKE_EVIDENCE_PATH: evidencePath, ...(recovery ? { FIN03_RECOVERY_SMOKE: '1', ...(process.env.FIN03_SCOPED_CLOSURE === '1' ? { FIN03_SCOPED_CLOSURE: '1' } : {}) } : {}), NODE_OPTIONS: `--import=${nodeEgressGuard}` } : {}) };
  const backendEnv = { ...databaseEnv, ...backendDefaults };
  const fixtureDate = new Date();
  const nextWednesday = new Date(Date.UTC(fixtureDate.getUTCFullYear(), fixtureDate.getUTCMonth(), fixtureDate.getUTCDate()));
  nextWednesday.setUTCDate(nextWednesday.getUTCDate() + ((3 - nextWednesday.getUTCDay() + 7) % 7 || 7));
  const replacementRunDate = nextWednesday.toISOString().slice(0, 10);
  const processes = [];
  let databaseCreated = false;
  let browserSucceeded = false;
  console.log(`Running real browser scenario ${scenario.name}.`);
  try {
    await run('createdb', [`--maintenance-db=${adminUrl.toString()}`, databaseName]);
    databaseCreated = true;
    console.log(`Created disposable database ${databaseName}.`);
    if (fin03) {
      execFileSync('psql', [`--dbname=${adminUrl}`, '-v', 'ON_ERROR_STOP=1', '-c',
        `COMMENT ON DATABASE "${databaseName}" IS 'fin03-history:${proof}'`], { env: baseEnv });
      const target = inspect(databaseName);
      if (target.major !== 18 || target.systemId !== cluster.systemId || target.owner !== cluster.owner ||
        target.databaseOwner !== cluster.owner || target.comment !== `fin03-history:${proof}`)
        throw new Error('FIN03 database identity mismatch.');
      await mkdir(path.dirname(evidencePath), { recursive: true });
      Object.assign(backendEnv, { SETTLEMENT_AUTO_APPROVAL_SCHEDULER_ENABLED: 'false',
        SETTLEMENT_AUTO_DRAFT_SCHEDULER_ENABLED: 'false', SETTLEMENT_AUTO_DRAFT_WRITE_SCHEDULER_ENABLED: 'false' });
      console.log(`FIN03 PostgreSQL ${target.major}, isolated cluster/owner/proof verified.`);
    }
    await run('npm', ['run', 'backend:db:generate'], databaseEnv);
    await run('npm', ['run', 'backend:db:bootstrap:fresh'], databaseEnv);
    await run('node_modules/.bin/tsx', [scenario.fixture], { ...databaseEnv, BROWSER_SMOKE_RUN_DATE: replacementRunDate });
    await run('npm', ['run', 'backend:build'], backendEnv);
    await run('npm', ['run', 'build'], frontendEnv);

    const backend = start('npm', ['run', 'backend:start'], {
      ...backendEnv, NODE_OPTIONS: `--import=${nodeEgressGuard}`,
    }, processes);
    await waitFor(`${localBackend}/health`, async (response) => {
      const health = await response.json();
      return health.status === 'ok' && health.dbReachable === true && health.schemaReady === true;
    }, backend);
    const frontend = start('npm', ['run', 'preview', '--', '--host', 'localhost', '--port', '5173', '--strictPort'], frontendEnv, processes);
    await waitFor(localFrontend, async () => true, frontend);
    await run('node_modules/.bin/playwright', ['test', '--config', 'playwright.real.config.ts'], {
      ...baseEnv, BROWSER_SMOKE_REVIEW_ID: scenario.reviewId, BROWSER_SMOKE_REAL_SPEC: scenario.spec,
      BROWSER_SMOKE_RUN_DATE: replacementRunDate,
      ...(fin03 ? { BROWSER_SMOKE_EVIDENCE_PATH: evidencePath, ...(recovery ? { FIN03_RECOVERY_SMOKE: '1', ...(process.env.FIN03_SCOPED_CLOSURE === '1' ? { FIN03_SCOPED_CLOSURE: '1' } : {}) } : {}), NODE_OPTIONS: `--import=${nodeEgressGuard}` } : {}),
    });
    browserSucceeded = true;
    if (!fin03) {
      await run('node_modules/.bin/tsx', [scenario.verify], databaseEnv);
      console.log(`Real browser scenario ${scenario.name} passed browser and DB post-check.`);
    }
  } finally {
    await stopServers(processes);
    try {
      if (fin03 && databaseCreated) await run('node_modules/.bin/tsx', [scenario.verify], { ...databaseEnv, FIN03_BROWSER_PASSED: browserSucceeded ? '1' : '0' });
    } finally {
    if (databaseCreated) {
      if (fin03) {
        const target = inspect(databaseName);
        if (target.systemId !== cluster.systemId || target.databaseOwner !== cluster.owner || target.comment !== `fin03-history:${proof}`)
          throw new Error('FIN03 cleanup ownership/proof mismatch; refusing destructive cleanup.');
      }
      await run('dropdb', ['--force', `--maintenance-db=${adminUrl.toString()}`, databaseName]);
      console.log(`Disposed database ${databaseName}.`);
    }
    }
  }
}

for (const scenario of selectedScenarios) await runScenario(scenario);
