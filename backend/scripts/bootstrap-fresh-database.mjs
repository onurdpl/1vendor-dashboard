import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const backendDirectory = path.resolve(scriptDirectory, '..');
const prismaDirectory = path.join(backendDirectory, 'prisma');
const migrationsDirectory = path.join(prismaDirectory, 'migrations');
const bootstrapDirectory = path.join(prismaDirectory, 'bootstrap');
const manifestPath = path.join(bootstrapDirectory, 'baseline-manifest.json');
const prismaCliPath = path.join(backendDirectory, 'node_modules', 'prisma', 'build', 'index.js');
const prismaPackagePath = path.join(backendDirectory, 'node_modules', 'prisma', 'package.json');
const bootstrapLockKeys = [1397117523, 1178878287];

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  console.error('Fresh database bootstrap refused: DATABASE_URL is required.');
  process.exit(1);
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

async function readJson(filePath, label) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`${label} is missing or invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assertHexChecksum(value, label) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 checksum.`);
  }
}

function resolveBootstrapPath(relativePath, label) {
  if (typeof relativePath !== 'string' || !relativePath.trim()) {
    throw new Error(`${label} path is required.`);
  }
  const resolvedPath = path.resolve(bootstrapDirectory, relativePath);
  const relativeToPrisma = path.relative(prismaDirectory, resolvedPath);
  if (relativeToPrisma.startsWith('..') || path.isAbsolute(relativeToPrisma)) {
    throw new Error(`${label} path must stay within backend/prisma.`);
  }
  return resolvedPath;
}

async function migrationDirectories() {
  const entries = await readdir(migrationsDirectory, { withFileTypes: true });
  const names = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      await readFile(path.join(migrationsDirectory, entry.name, 'migration.sql'));
      names.push(entry.name);
    } catch {
      // Ignore non-migration directories.
    }
  }
  return names.sort();
}

async function hashMigrationFiles(migrationNames) {
  const hash = createHash('sha256');
  for (const migrationName of migrationNames) {
    hash.update(migrationName);
    hash.update('\0');
    hash.update(await readFile(path.join(migrationsDirectory, migrationName, 'migration.sql')));
    hash.update('\0');
  }
  return hash.digest('hex');
}

async function validateBaseline() {
  const manifest = await readJson(manifestPath, 'Baseline manifest');
  if (manifest.formatVersion !== 1 || manifest.provider !== 'postgresql') {
    throw new Error('Baseline manifest format or provider is unsupported.');
  }
  if (!Array.isArray(manifest.baselineMigrations) || manifest.baselineMigrations.length === 0) {
    throw new Error('Baseline manifest must list at least one migration.');
  }
  if (new Set(manifest.baselineMigrations).size !== manifest.baselineMigrations.length) {
    throw new Error('Baseline manifest contains duplicate migrations.');
  }
  const sortedBaselineMigrations = [...manifest.baselineMigrations].sort();
  if (sortedBaselineMigrations.some((name, index) => name !== manifest.baselineMigrations[index])) {
    throw new Error('Baseline migrations must be in lexicographic order.');
  }
  if (manifest.migrationCutoff !== manifest.baselineMigrations.at(-1)) {
    throw new Error('Migration cutoff must equal the final baseline migration.');
  }

  assertHexChecksum(manifest.snapshot?.sha256, 'Snapshot');
  assertHexChecksum(manifest.schema?.sha256, 'Schema');
  assertHexChecksum(manifest.baselineMigrationFilesSha256, 'Baseline migration files');

  const snapshotPath = resolveBootstrapPath(manifest.snapshot?.path, 'Snapshot');
  const schemaPath = resolveBootstrapPath(manifest.schema?.path, 'Schema');
  const [snapshotSql, schemaContents, prismaPackage, allMigrationNames] = await Promise.all([
    readFile(snapshotPath),
    readFile(schemaPath),
    readJson(prismaPackagePath, 'Installed Prisma package'),
    migrationDirectories(),
  ]);

  if (sha256(snapshotSql) !== manifest.snapshot.sha256) {
    throw new Error('Current schema snapshot checksum does not match the baseline manifest.');
  }
  if (sha256(schemaContents) !== manifest.schema.sha256) {
    throw new Error('Prisma schema checksum does not match the baseline manifest; regenerate the baseline before bootstrapping.');
  }
  if (prismaPackage.version !== manifest.generatedBy?.prismaVersion) {
    throw new Error('Installed Prisma version does not match the version recorded in the baseline manifest.');
  }

  const migrationsThroughCutoff = allMigrationNames.filter((name) => name <= manifest.migrationCutoff);
  if (
    migrationsThroughCutoff.length !== manifest.baselineMigrations.length ||
    migrationsThroughCutoff.some((name, index) => name !== manifest.baselineMigrations[index])
  ) {
    throw new Error('Migration directories through the baseline cutoff do not match the baseline manifest.');
  }
  if (await hashMigrationFiles(manifest.baselineMigrations) !== manifest.baselineMigrationFilesSha256) {
    throw new Error('Baseline migration file checksum does not match the manifest.');
  }

  return {
    manifest,
    schemaPath,
    snapshotPath,
  };
}

function runPrisma(arguments_, label) {
  const result = spawnSync(process.execPath, [prismaCliPath, ...arguments_], {
    cwd: backendDirectory,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
    },
    encoding: 'utf8',
  });
  if (result.error) {
    throw new Error(`${label} could not start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const details = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`${label} failed${details ? `:\n${details}` : '.'}`);
  }
}

async function inspectUserObjects(prisma) {
  return prisma.$queryRawUnsafe(`
    WITH user_namespaces AS (
      SELECT oid, nspname
      FROM pg_catalog.pg_namespace
      WHERE nspname NOT IN ('pg_catalog', 'information_schema', 'public')
        AND nspname NOT LIKE 'pg_toast%'
        AND nspname NOT LIKE 'pg_temp_%'
    ), relation_objects AS (
      SELECT namespace.nspname AS "schemaName", relation.relname AS "objectName", 'relation'::text AS "objectType"
      FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema')
        AND namespace.nspname NOT LIKE 'pg_toast%'
        AND namespace.nspname NOT LIKE 'pg_temp_%'
        AND relation.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
    ), type_objects AS (
      SELECT namespace.nspname AS "schemaName", type.typname AS "objectName", 'type'::text AS "objectType"
      FROM pg_catalog.pg_type AS type
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = type.typnamespace
      WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema')
        AND namespace.nspname NOT LIKE 'pg_toast%'
        AND namespace.nspname NOT LIKE 'pg_temp_%'
        AND type.typtype IN ('d', 'e')
    ), routine_objects AS (
      SELECT namespace.nspname AS "schemaName", routine.proname AS "objectName", 'routine'::text AS "objectType"
      FROM pg_catalog.pg_proc AS routine
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = routine.pronamespace
      WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema')
        AND namespace.nspname NOT LIKE 'pg_toast%'
        AND namespace.nspname NOT LIKE 'pg_temp_%'
    ), extension_objects AS (
      SELECT 'database'::text AS "schemaName", extension.extname AS "objectName", 'extension'::text AS "objectType"
      FROM pg_catalog.pg_extension AS extension
      WHERE extension.extname <> 'plpgsql'
    ), schema_objects AS (
      SELECT 'database'::text AS "schemaName", nspname AS "objectName", 'schema'::text AS "objectType"
      FROM user_namespaces
    )
    SELECT * FROM relation_objects
    UNION ALL SELECT * FROM type_objects
    UNION ALL SELECT * FROM routine_objects
    UNION ALL SELECT * FROM extension_objects
    UNION ALL SELECT * FROM schema_objects
    ORDER BY "objectType", "schemaName", "objectName"
  `);
}

let prisma;
let lockAcquired = false;
let mutationStarted = false;

try {
  const baseline = await validateBaseline();
  prisma = new PrismaClient({
    datasources: {
      db: {
        url: databaseUrl,
      },
    },
  });
  await prisma.$connect();
  const [lockResult] = await prisma.$queryRawUnsafe(
    `SELECT pg_try_advisory_lock(${bootstrapLockKeys[0]}, ${bootstrapLockKeys[1]}) AS "acquired"`,
  );
  lockAcquired = lockResult?.acquired === true;
  if (!lockAcquired) {
    throw new Error('Fresh database bootstrap refused: another bootstrap process holds the safety lock.');
  }

  const existingObjects = await inspectUserObjects(prisma);
  if (existingObjects.length > 0) {
    const sample = existingObjects
      .slice(0, 5)
      .map((object) => `${object.objectType}:${object.schemaName}.${object.objectName}`)
      .join(', ');
    throw new Error(
      `Fresh database bootstrap refused: target is not empty (${existingObjects.length} user-defined object(s); ${sample}).`,
    );
  }

  mutationStarted = true;
  runPrisma(['db', 'execute', '--file', baseline.snapshotPath, '--schema', baseline.schemaPath], 'Schema snapshot application');
  for (const migrationName of baseline.manifest.baselineMigrations) {
    runPrisma(
      ['migrate', 'resolve', '--applied', migrationName, '--schema', baseline.schemaPath],
      `Baseline migration registration (${migrationName})`,
    );
  }
  runPrisma(['migrate', 'deploy', '--schema', baseline.schemaPath], 'Forward migration deployment');

  console.log(
    `Fresh database bootstrap completed: snapshot applied, ${baseline.manifest.baselineMigrations.length} migrations baselined through ${baseline.manifest.migrationCutoff}, and forward migrations deployed.`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  if (mutationStarted) {
    console.error('Bootstrap stopped after mutation began. Discard and recreate this new database before retrying.');
  }
  process.exitCode = 1;
} finally {
  if (prisma) {
    if (lockAcquired) {
      try {
        await prisma.$queryRawUnsafe(`SELECT pg_advisory_unlock(${bootstrapLockKeys[0]}, ${bootstrapLockKeys[1]})`);
      } catch {
        // The connection close below also releases a session-level advisory lock.
      }
    }
    await prisma.$disconnect();
  }
}
