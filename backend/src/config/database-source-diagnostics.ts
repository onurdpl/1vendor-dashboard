import fs from 'node:fs';
import path from 'node:path';

export const DATABASE_URL_DUPLICATE_WARNING =
  'Multiple database connection URL definitions detected. Audit results may not represent deployed environment.';

export type DatabaseSourceLabel = 'not_configured' | 'local' | 'remote' | 'invalid';

export type DatabaseUrlDefinition = {
  source: string;
  line: number;
};

export type DatabaseSourceDiagnostics = {
  databaseHost: string | null;
  databaseName: string | null;
  databaseSourceLabel: DatabaseSourceLabel;
  duplicateDatabaseUrlDefinitionsDetected: boolean;
  databaseUrlDefinitionCount: number;
  databaseUrlDefinitions: DatabaseUrlDefinition[];
  warnings: string[];
};

const DEFAULT_ENV_SOURCE_FILES = ['backend/.env', '.env'];

function readEnvValueLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) {
    return null;
  }

  const separatorIndex = trimmed.indexOf('=');
  if (separatorIndex === -1) {
    return null;
  }

  return {
    key: trimmed.slice(0, separatorIndex).trim(),
  };
}

export function findDatabaseUrlDefinitions(input?: {
  cwd?: string;
  envSourceFiles?: string[];
}): DatabaseUrlDefinition[] {
  const cwd = input?.cwd ?? process.cwd();
  const envSourceFiles = input?.envSourceFiles ?? DEFAULT_ENV_SOURCE_FILES;
  const definitions: DatabaseUrlDefinition[] = [];

  for (const source of envSourceFiles) {
    const filePath = path.resolve(cwd, source);
    if (!fs.existsSync(filePath)) {
      continue;
    }

    const content = fs.readFileSync(filePath, 'utf8');
    content.split(/\r?\n/).forEach((line, index) => {
      const parsed = readEnvValueLine(line);
      if (parsed?.key === 'DATABASE_URL') {
        definitions.push({
          source,
          line: index + 1,
        });
      }
    });
  }

  return definitions;
}

function classifyDatabaseSource(hostname: string | null): DatabaseSourceLabel {
  if (!hostname) {
    return 'not_configured';
  }
  const normalized = hostname.toLowerCase();
  if (normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1') {
    return 'local';
  }
  return 'remote';
}

function parseDatabaseUrl(databaseUrl: string | undefined | null) {
  if (!databaseUrl?.trim()) {
    return {
      databaseHost: null,
      databaseName: null,
      databaseSourceLabel: 'not_configured' as const,
    };
  }

  try {
    const parsed = new URL(databaseUrl);
    return {
      databaseHost: parsed.hostname || null,
      databaseName: parsed.pathname.replace(/^\//, '') || null,
      databaseSourceLabel: classifyDatabaseSource(parsed.hostname || null),
    };
  } catch {
    return {
      databaseHost: null,
      databaseName: null,
      databaseSourceLabel: 'invalid' as const,
    };
  }
}

export function buildDatabaseSourceDiagnostics(input: {
  databaseUrl?: string | null;
  cwd?: string;
  envSourceFiles?: string[];
}): DatabaseSourceDiagnostics {
  const parsed = parseDatabaseUrl(input.databaseUrl);
  const definitions = findDatabaseUrlDefinitions({
    cwd: input.cwd,
    envSourceFiles: input.envSourceFiles,
  });
  const duplicateDatabaseUrlDefinitionsDetected = definitions.length > 1;

  return {
    ...parsed,
    duplicateDatabaseUrlDefinitionsDetected,
    databaseUrlDefinitionCount: definitions.length,
    databaseUrlDefinitions: definitions,
    warnings: duplicateDatabaseUrlDefinitionsDetected ? [DATABASE_URL_DUPLICATE_WARNING] : [],
  };
}

export type FinanceAuditRuntimeMetadata = {
  environment: string;
  databaseHost: string | null;
  databaseName: string | null;
  schemaReady: boolean;
  databaseSourceLabel: DatabaseSourceLabel;
  warnings: string[];
};

export function buildFinanceAuditRuntimeMetadata(input: {
  environment: string;
  databaseUrl?: string | null;
  schemaReady: boolean;
  cwd?: string;
  envSourceFiles?: string[];
}): FinanceAuditRuntimeMetadata {
  const diagnostics = buildDatabaseSourceDiagnostics({
    databaseUrl: input.databaseUrl,
    cwd: input.cwd,
    envSourceFiles: input.envSourceFiles,
  });

  return {
    environment: input.environment,
    databaseHost: diagnostics.databaseHost,
    databaseName: diagnostics.databaseName,
    schemaReady: input.schemaReady,
    databaseSourceLabel: diagnostics.databaseSourceLabel,
    warnings: diagnostics.warnings,
  };
}
