import fs from 'node:fs';
import path from 'node:path';
import { describeOdooProbeError, runOdooOrderProbe, type OdooProbeEnv } from '../src/integrations/odoo/odooOrderProbe.js';

function loadBackendEnv(filePath: string): OdooProbeEnv {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const env: OdooProbeEnv = {};
  const content = fs.readFileSync(filePath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) {
      continue;
    }

    const separator = trimmed.indexOf('=');
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (key) {
      env[key] = value;
    }
  }

  return env;
}

async function main() {
  const backendEnvPath = path.resolve(process.cwd(), 'backend/.env');
  const fileEnv = loadBackendEnv(backendEnvPath);
  const runtimeEnv = process.env as OdooProbeEnv;
  const effectiveEnv = mergeEnv(runtimeEnv, fileEnv);
  const envSource = getEnvSource(runtimeEnv, fileEnv);
  const nodeEnv = effectiveEnv.NODE_ENV || 'development';

  if (nodeEnv !== 'development' && nodeEnv !== 'test') {
    throw new Error('Odoo order probe refuses to run unless NODE_ENV is development or test.');
  }

  if (effectiveEnv.ODOO_DRY_RUN === undefined) {
    throw new Error('ODOO_DRY_RUN must be explicitly set in process.env or backend/.env.');
  }

  const dryRun = parseBoolean(effectiveEnv.ODOO_DRY_RUN, 'ODOO_DRY_RUN');
  const discoveryOnly = parseBoolean(effectiveEnv.ODOO_DISCOVERY_ONLY, 'ODOO_DISCOVERY_ONLY', false);
  const enabled = parseBoolean(effectiveEnv.ODOO_ENABLED, 'ODOO_ENABLED', false);
  const mode = dryRun ? 'DRY_RUN' : enabled && discoveryOnly ? 'DISCOVERY_ONLY' : 'LIVE_CREATE_BLOCKED';
  console.log(JSON.stringify(buildStartupReport(effectiveEnv, envSource), null, 2));
  console.log(`Odoo probe mode: ${mode}`);

  if (!dryRun && !discoveryOnly) {
    throw new Error('LIVE_CREATE_BLOCKED: ODOO_DISCOVERY_ONLY=true is required for any non-dry-run Odoo probe. Record creation is blocked.');
  }

  await runOdooOrderProbe({
    env: effectiveEnv,
  });
}

function mergeEnv(runtimeEnv: OdooProbeEnv, fileEnv: OdooProbeEnv): OdooProbeEnv {
  return {
    ...fileEnv,
    ...Object.fromEntries(Object.entries(runtimeEnv).filter(([, value]) => value !== undefined && value !== '')),
  };
}

function getEnvSource(runtimeEnv: OdooProbeEnv, fileEnv: OdooProbeEnv) {
  const keys = ['ODOO_ENABLED', 'ODOO_DRY_RUN', 'ODOO_DISCOVERY_ONLY', 'ODOO_URL', 'ODOO_DB', 'ODOO_USERNAME', 'ODOO_API_KEY'];
  const runtimeCount = keys.filter((key) => runtimeEnv[key] !== undefined && runtimeEnv[key] !== '').length;
  const fileCount = keys.filter((key) => fileEnv[key] !== undefined && fileEnv[key] !== '').length;

  if (runtimeCount > 0 && fileCount > 0) {
    return 'mixed';
  }
  if (runtimeCount > 0) {
    return 'process.env';
  }
  return 'backend/.env';
}

function buildStartupReport(env: OdooProbeEnv, envSource: string) {
  return {
    label: 'Odoo probe startup env',
    envSource,
    ODOO_ENABLED: env.ODOO_ENABLED ?? '(missing)',
    ODOO_DRY_RUN: env.ODOO_DRY_RUN ?? '(missing)',
    ODOO_DISCOVERY_ONLY: env.ODOO_DISCOVERY_ONLY ?? '(missing)',
    ODOO_URL_EXISTS: Boolean(env.ODOO_URL),
    ODOO_DB_EXISTS: Boolean(env.ODOO_DB),
    ODOO_USERNAME_EXISTS: Boolean(env.ODOO_USERNAME),
    ODOO_API_KEY_EXISTS: Boolean(env.ODOO_API_KEY),
  };
}

function parseBoolean(value: string | undefined, key: string, fallback?: boolean) {
  const normalized = value?.trim().toLowerCase();
  if (!normalized && fallback !== undefined) {
    return fallback;
  }
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
    return true;
  }
  if (normalized === 'false' || normalized === '0' || normalized === 'no') {
    return false;
  }
  throw new Error(`${key} must be explicitly true or false in backend/.env.`);
}

main().catch((error) => {
  console.error(JSON.stringify({ label: 'Odoo order probe failed', ...describeOdooProbeError(error) }, null, 2));
  process.exitCode = 1;
});
