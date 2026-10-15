import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { assertRequiredSafeguards, catalogFingerprint } from './bootstrap-catalog.mjs';

const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const prismaDirectory = path.join(backend, 'prisma');
const migrationsDirectory = path.join(prismaDirectory, 'migrations');
const bootstrapDirectory = path.join(prismaDirectory, 'bootstrap');
const postgresMajor = Number(process.env.BOOTSTRAP_POSTGRES_MAJOR || '16');
if (![16, 18].includes(postgresMajor)) {
  throw new Error('Baseline refresh/check supports only PostgreSQL 16 or 18.');
}
const manifestPath = path.join(bootstrapDirectory, postgresMajor === 16 ? 'baseline-manifest.json' : 'baseline-manifest.pg18.json');
const snapshotPath = path.join(bootstrapDirectory, postgresMajor === 16 ? 'current-schema.sql' : 'current-schema.pg18.sql');
const seedManifestPath = path.join(bootstrapDirectory, 'baseline-manifest.json');
const seedSnapshotPath = path.join(bootstrapDirectory, 'current-schema.sql');
const schemaPath = path.join(prismaDirectory, 'schema.prisma');
const prismaCli = path.join(backend, 'node_modules', 'prisma', 'build', 'index.js');
const pgDump = path.join(
  postgresMajor === 16 ? (process.env.PG16_BIN || '/usr/bin') : (process.env.PG18_BIN || '/usr/lib/postgresql/18/bin'),
  'pg_dump',
);
const mode = process.argv[2];
const connection = process.env.BOOTSTRAP_REFRESH_DATABASE_URL;

if (!['--refresh', '--check'].includes(mode) || !connection) {
  console.error('Usage: BOOTSTRAP_REFRESH_DATABASE_URL=<local PostgreSQL 16/18 URL> BOOTSTRAP_POSTGRES_MAJOR=16|18 node scripts/refresh-fresh-database-baseline.mjs --refresh|--check');
  process.exit(1);
}

const adminUrl = new URL(connection);
if (!['127.0.0.1', 'localhost'].includes(adminUrl.hostname) || adminUrl.protocol !== 'postgresql:' ||
    !adminUrl.port || !adminUrl.username || adminUrl.pathname !== '/postgres' ||
    adminUrl.searchParams.get('schema') !== 'public') {
  throw new Error('Baseline refresh/check requires an explicit local PostgreSQL admin URL for the postgres database.');
}
const prismaVersion = JSON.parse(await readFile(path.join(backend, 'node_modules', 'prisma', 'package.json'), 'utf8')).version;
const hash = (value) => createHash('sha256').update(value).digest('hex');
const sourceNames = [];
const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'sporgym-bootstrap-'));

function databaseUrl(name) {
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  url.searchParams.set('schema', 'public');
  return url.toString();
}

function client(url) {
  return new PrismaClient({ datasources: { db: { url } } });
}

function command(executable, args, label, environment = {}) {
  const result = spawnSync(executable, args, {
    cwd: backend,
    env: { ...process.env, ...environment },
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${label} failed: ${result.error?.message || [result.stdout, result.stderr].filter(Boolean).join('\n').trim()}`);
  }
  return result.stdout;
}

function isVerifiedLocalPostgresServer(serverAddress) {
  if (['127.0.0.1', '::1'].includes(serverAddress)) return true;

  // A published localhost port reaches a Docker service at its container address.
  // Match that address to a running, healthy local PostgreSQL container and its
  // exact published port; a private server address alone is never sufficient.
  const containers = spawnSync('docker', ['ps', '--quiet', '--filter', `publish=${adminUrl.port}`], {
    encoding: 'utf8', timeout: 5000,
  });
  if (containers.status !== 0 || !containers.stdout) return false;
  for (const id of containers.stdout.trim().split('\n')) {
    const inspected = spawnSync('docker', ['inspect', '--format', '{{json .}}', id], {
      encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024,
    });
    if (inspected.status !== 0) continue;
    try {
      const container = JSON.parse(inspected.stdout);
      const addresses = Object.values(container.NetworkSettings?.Networks ?? {})
        .flatMap((network) => [network.IPAddress, network.GlobalIPv6Address]);
      const bindings = container.NetworkSettings?.Ports?.[`${adminUrl.port}/tcp`] ?? [];
      if (container.Config?.Image === `postgres:${postgresMajor}-alpine` &&
          container.State?.Running === true && container.State?.Health?.Status === 'healthy' &&
          addresses.includes(serverAddress) &&
          bindings.some((binding) => binding.HostPort === adminUrl.port)) return true;
    } catch {
      // An uninspectable container cannot establish local database authority.
    }
  }
  return false;
}

function prisma(args, url, label) {
  return command(process.execPath, [prismaCli, ...args, '--schema', schemaPath], label, { DATABASE_URL: url });
}

async function migrations() {
  const entries = await readdir(migrationsDirectory, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}

async function migrationHash(names) {
  const digest = createHash('sha256');
  for (const name of names) {
    digest.update(name);
    digest.update('\0');
    digest.update(await readFile(path.join(migrationsDirectory, name, 'migration.sql')));
    digest.update('\0');
  }
  return digest.digest('hex');
}

async function createDatabase() {
  const name = `bootstrap_${randomUUID().replaceAll('-', '')}`;
  const admin = client(connection);
  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.$disconnect();
  }
  sourceNames.push(name);
  return { name, url: databaseUrl(name) };
}

async function dropDatabases() {
  const admin = client(connection);
  try {
    for (const name of sourceNames.reverse()) {
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    }
  } finally {
    await admin.$disconnect();
  }
}

async function verifyPostgresVersion(url) {
  const db = client(url);
  try {
    const [row] = await db.$queryRawUnsafe(`
      SELECT current_setting('server_version_num') AS version,
        current_database() AS "databaseName", current_user AS "connectedUser",
        pg_get_userbyid(datdba) AS "databaseOwner", host(inet_server_addr()) AS "serverAddress",
        inet_server_port() AS "serverPort"
      FROM pg_database WHERE datname = current_database()
    `);
    const version = Number(row.version);
    if (Math.floor(version / 10000) !== postgresMajor) throw new Error(`PostgreSQL ${postgresMajor} required; server reports ${version}.`);
    if (row.databaseName !== new URL(url).pathname.slice(1) || row.connectedUser !== row.databaseOwner ||
        row.connectedUser !== decodeURIComponent(adminUrl.username) ||
        !isVerifiedLocalPostgresServer(row.serverAddress) || row.serverPort !== Number(adminUrl.port)) {
      throw new Error('Baseline refresh/check database identity, ownership, or loopback server does not match the local URL.');
    }
  } finally {
    await db.$disconnect();
  }
  const dumpVersion = command(pgDump, ['--version'], 'pg_dump version').trim();
  if (!new RegExp(`\\b${postgresMajor}\\.`).test(dumpVersion)) {
    throw new Error(`PostgreSQL ${postgresMajor} pg_dump required; found ${dumpVersion}.`);
  }
}

async function assertMigrationBookkeeping(url, names) {
  const db = client(url);
  try {
    const rows = await db.$queryRawUnsafe(`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`);
    const actual = rows.map((row) => row.migration_name);
    if (JSON.stringify(actual) !== JSON.stringify(names)) throw new Error('Migration bookkeeping differs from the represented migration list.');
    const [invalid] = await db.$queryRawUnsafe(`SELECT COUNT(*)::int AS count FROM _prisma_migrations WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL`);
    if (invalid.count !== 0) throw new Error('Migration bookkeeping contains failed or rolled-back entries.');
  } finally {
    await db.$disconnect();
  }
}

function normalizedDump(url) {
  const parsed = new URL(url);
  const output = command(pgDump, [
    '--schema-only', '--no-owner', '--no-privileges', '--no-comments', '--no-publications',
    '--no-security-labels', '--no-subscriptions', '--no-tablespaces',
    '--exclude-table=public._prisma_migrations', '--restrict-key=sporgymbootstrapv1',
    '--host', parsed.hostname, '--port', parsed.port || '5432', '--username', decodeURIComponent(parsed.username),
    '--dbname', parsed.pathname.slice(1),
  ], 'PostgreSQL schema dump', { PGPASSWORD: decodeURIComponent(parsed.password) });
  const normalized = output.replace(/^\\(?:un)?restrict .*\n/gm, '')
    .replace(/^-- Dumped (?:from database|by pg_dump) version .*\n/gm, '')
    .replace(/\r\n/g, '\n')
    .trimEnd() + '\n';
  if (normalized.includes('\\restrict') || normalized.includes('_prisma_migrations')) {
    throw new Error('PostgreSQL dump normalization left unsupported metadata.');
  }
  return normalized;
}

async function fingerprint(url) {
  const db = client(url);
  try {
    const result = await catalogFingerprint(db);
    assertRequiredSafeguards(result.inventory);
    return result.sha256;
  } finally {
    await db.$disconnect();
  }
}

async function historicalIndex(url) {
  const migration = await readFile(path.join(migrationsDirectory, '20260610170000_add_settlement_commission_invoice_model', 'migration.sql'), 'utf8');
  const statement = migration.match(/CREATE UNIQUE INDEX "SettlementCommissionInvoice_active_settlement_provider_key"[\s\S]*?;/)?.[0];
  if (!statement || !statement.includes('WHERE "status" <> \'CANCELLED\'')) {
    throw new Error('Immutable historical partial index definition is missing or changed.');
  }
  const db = client(url);
  try {
    const existing = await db.$queryRawUnsafe(`SELECT pg_get_indexdef(c.oid) AS definition FROM pg_class c WHERE c.relname = 'SettlementCommissionInvoice_active_settlement_provider_key'`);
    if (existing.length === 0) await db.$executeRawUnsafe(statement);
    const [index] = await db.$queryRawUnsafe(`SELECT pg_get_indexdef(c.oid) AS definition FROM pg_class c WHERE c.relname = 'SettlementCommissionInvoice_active_settlement_provider_key'`);
    if (!index?.definition.includes('CREATE UNIQUE INDEX') || !index.definition.includes('CANCELLED')) {
      throw new Error('Pre-cutoff historical partial index failed catalog acceptance.');
    }
  } finally {
    await db.$disconnect();
  }
}

async function canonicalSource(manifest, sourceSnapshotPath, allNames) {
  const database = await createDatabase();
  await verifyPostgresVersion(database.url);
  prisma(['db', 'execute', '--file', sourceSnapshotPath], database.url, 'Existing baseline snapshot');
  for (const name of manifest.baselineMigrations) {
    prisma(['migrate', 'resolve', '--applied', name], database.url, `Baseline registration ${name}`);
  }
  await historicalIndex(database.url);
  await assertMigrationBookkeeping(database.url, manifest.baselineMigrations);
  prisma(['migrate', 'deploy'], database.url, 'Forward migrations');
  await assertMigrationBookkeeping(database.url, allNames);
  const catalogSha256 = await fingerprint(database.url);
  const sql = normalizedDump(database.url);
  return { ...database, catalogSha256, sql };
}

async function restoreAndCompare(source, allNames) {
  const target = await createDatabase();
  await verifyPostgresVersion(target.url);
  const candidatePath = path.join(temporaryDirectory, 'candidate.sql');
  await writeFile(candidatePath, source.sql);
  prisma(['db', 'execute', '--file', candidatePath], target.url, 'Candidate snapshot restore');
  for (const name of allNames) {
    prisma(['migrate', 'resolve', '--applied', name], target.url, `Candidate registration ${name}`);
  }
  prisma(['migrate', 'deploy'], target.url, 'Established database deploy check');
  await assertMigrationBookkeeping(target.url, allNames);
  const catalogSha256 = await fingerprint(target.url);
  if (catalogSha256 !== source.catalogSha256 || normalizedDump(target.url) !== source.sql) {
    throw new Error('Source and freshly bootstrapped PostgreSQL catalogs are not equivalent.');
  }
}

try {
  const seedFromPostgres16 = postgresMajor === 18 && mode === '--refresh';
  const sourceManifestPath = seedFromPostgres16 ? seedManifestPath : manifestPath;
  const sourceSnapshotPath = seedFromPostgres16 ? seedSnapshotPath : snapshotPath;
  const manifest = JSON.parse(await readFile(sourceManifestPath, 'utf8'));
  const allNames = await migrations();
  if (![1, 2].includes(manifest.formatVersion) || manifest.provider !== 'postgresql' ||
      ((mode === '--check' || seedFromPostgres16) && manifest.generatedBy?.prismaVersion !== prismaVersion) ||
      JSON.stringify(allNames.filter((name) => name <= manifest.migrationCutoff)) !== JSON.stringify(manifest.baselineMigrations) ||
      manifest.generatedBy?.postgresMajor !== (seedFromPostgres16 ? 16 : postgresMajor) ||
      manifest.schema?.path !== '../schema.prisma' ||
      manifest.snapshot?.path !== path.basename(sourceSnapshotPath) ||
      ((mode === '--check' || seedFromPostgres16) && hash(await readFile(schemaPath)) !== manifest.schema?.sha256) ||
      hash(await readFile(sourceSnapshotPath)) !== manifest.snapshot?.sha256 ||
      await migrationHash(manifest.baselineMigrations) !== manifest.baselineMigrationFilesSha256) {
    throw new Error('Existing baseline artifact or migration manifest is inconsistent.');
  }
  const source = await canonicalSource(manifest, sourceSnapshotPath, allNames);
  await restoreAndCompare(source, allNames);
  const next = {
    formatVersion: 2,
    provider: 'postgresql',
    generatedBy: {
      prismaVersion,
      postgresMajor,
      command: `npm run backend:db:bootstrap:refresh (PostgreSQL ${postgresMajor} pg_dump --schema-only)`,
    },
    schema: { path: '../schema.prisma', sha256: hash(await readFile(schemaPath)) },
    snapshot: { path: path.basename(snapshotPath), sha256: hash(source.sql) },
    catalog: { sha256: source.catalogSha256 },
    migrationCutoff: allNames.at(-1),
    baselineMigrationFilesSha256: await migrationHash(allNames),
    baselineMigrations: allNames,
  };
  const manifestContents = `${JSON.stringify(next, null, 2)}\n`;
  if (mode === '--refresh') {
    const repeat = await canonicalSource(manifest, sourceSnapshotPath, allNames);
    if (repeat.sql !== source.sql || repeat.catalogSha256 !== source.catalogSha256) {
      throw new Error(`Independent PostgreSQL ${postgresMajor} regeneration was not byte-stable.`);
    }
    await writeFile(snapshotPath, source.sql);
    await writeFile(manifestPath, manifestContents);
    console.log(`Baseline refreshed through ${next.migrationCutoff}; snapshot ${next.snapshot.sha256}; catalog ${next.catalog.sha256}.`);
  } else {
    if (source.sql !== await readFile(snapshotPath, 'utf8') || manifestContents !== await readFile(manifestPath, 'utf8')) {
      throw new Error(`Tracked baseline differs from the independently generated PostgreSQL ${postgresMajor} baseline.`);
    }
    console.log(`Baseline verified through ${next.migrationCutoff}; catalog ${next.catalog.sha256}.`);
  }
} finally {
  await dropDatabases();
  await rm(temporaryDirectory, { recursive: true, force: true });
}
