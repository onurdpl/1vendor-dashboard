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
const manifestPath = path.join(bootstrapDirectory, 'baseline-manifest.json');
const snapshotPath = path.join(bootstrapDirectory, 'current-schema.sql');
const schemaPath = path.join(prismaDirectory, 'schema.prisma');
const prismaCli = path.join(backend, 'node_modules', 'prisma', 'build', 'index.js');
const pgDump = path.join(process.env.PG16_BIN || '/usr/bin', 'pg_dump');
const mode = process.argv[2];
const connection = process.env.BOOTSTRAP_REFRESH_DATABASE_URL;

if (!['--refresh', '--check'].includes(mode) || !connection) {
  console.error('Usage: BOOTSTRAP_REFRESH_DATABASE_URL=<local PostgreSQL 16 URL> node scripts/refresh-fresh-database-baseline.mjs --refresh|--check');
  process.exit(1);
}

const adminUrl = new URL(connection);
if (!['127.0.0.1', 'localhost'].includes(adminUrl.hostname) || adminUrl.protocol !== 'postgresql:') {
  throw new Error('Baseline refresh/check requires an explicitly local PostgreSQL URL.');
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

async function verifyPostgres16(url) {
  const db = client(url);
  try {
    const [row] = await db.$queryRawUnsafe('SHOW server_version_num');
    const version = Number(row.server_version_num);
    if (version < 160000 || version >= 170000) throw new Error(`PostgreSQL 16 required; server reports ${version}.`);
  } finally {
    await db.$disconnect();
  }
  const dumpVersion = command(pgDump, ['--version'], 'pg_dump version').trim();
  if (!/\b16\./.test(dumpVersion)) throw new Error(`PostgreSQL 16 pg_dump required; found ${dumpVersion}.`);
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

async function canonicalSource(manifest, allNames) {
  const database = await createDatabase();
  await verifyPostgres16(database.url);
  prisma(['db', 'execute', '--file', snapshotPath], database.url, 'Existing baseline snapshot');
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
  await verifyPostgres16(target.url);
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
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const allNames = await migrations();
  if (![1, 2].includes(manifest.formatVersion) || manifest.provider !== 'postgresql' ||
      JSON.stringify(allNames.filter((name) => name <= manifest.migrationCutoff)) !== JSON.stringify(manifest.baselineMigrations) ||
      hash(await readFile(snapshotPath)) !== manifest.snapshot?.sha256 ||
      await migrationHash(manifest.baselineMigrations) !== manifest.baselineMigrationFilesSha256) {
    throw new Error('Existing baseline artifact or migration manifest is inconsistent.');
  }
  const source = await canonicalSource(manifest, allNames);
  await restoreAndCompare(source, allNames);
  const next = {
    formatVersion: 2,
    provider: 'postgresql',
    generatedBy: {
      prismaVersion,
      postgresMajor: 16,
      command: 'npm run backend:db:bootstrap:refresh (PostgreSQL 16 pg_dump --schema-only)',
    },
    schema: { path: '../schema.prisma', sha256: hash(await readFile(schemaPath)) },
    snapshot: { path: 'current-schema.sql', sha256: hash(source.sql) },
    catalog: { sha256: source.catalogSha256 },
    migrationCutoff: allNames.at(-1),
    baselineMigrationFilesSha256: await migrationHash(allNames),
    baselineMigrations: allNames,
  };
  const manifestContents = `${JSON.stringify(next, null, 2)}\n`;
  if (mode === '--refresh') {
    const repeat = await canonicalSource(manifest, allNames);
    if (repeat.sql !== source.sql || repeat.catalogSha256 !== source.catalogSha256) {
      throw new Error('Independent PostgreSQL 16 regeneration was not byte-stable.');
    }
    await writeFile(snapshotPath, source.sql);
    await writeFile(manifestPath, manifestContents);
    console.log(`Baseline refreshed through ${next.migrationCutoff}; snapshot ${next.snapshot.sha256}; catalog ${next.catalog.sha256}.`);
  } else {
    if (source.sql !== await readFile(snapshotPath, 'utf8') || manifestContents !== await readFile(manifestPath, 'utf8')) {
      throw new Error('Tracked baseline differs from the independently generated PostgreSQL 16 baseline.');
    }
    console.log(`Baseline verified through ${next.migrationCutoff}; catalog ${next.catalog.sha256}.`);
  }
} finally {
  await dropDatabases();
  await rm(temporaryDirectory, { recursive: true, force: true });
}
