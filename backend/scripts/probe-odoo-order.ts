import fs from 'node:fs';
import path from 'node:path';
import { describeOdooProbeError, runOdooOrderProbe, type OdooProbeEnv } from '../src/integrations/odoo/odooOrderProbe.js';

function loadBackendEnv(filePath: string): OdooProbeEnv {
  if (!fs.existsSync(filePath)) {
    throw new Error(`backend/.env not found at ${filePath}`);
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
  const backendEnv = loadBackendEnv(backendEnvPath);
  const nodeEnv = process.env.NODE_ENV || backendEnv.NODE_ENV || 'development';

  if (nodeEnv !== 'development' && nodeEnv !== 'test') {
    throw new Error('Odoo order probe refuses to run unless NODE_ENV is development or test.');
  }

  if (backendEnv.ODOO_DRY_RUN === undefined) {
    throw new Error('ODOO_DRY_RUN must be explicitly set in backend/.env.');
  }

  const dryRun = parseBoolean(backendEnv.ODOO_DRY_RUN, 'ODOO_DRY_RUN');
  const discoveryOnly = parseBoolean(backendEnv.ODOO_DISCOVERY_ONLY, 'ODOO_DISCOVERY_ONLY', false);
  const enabled = parseBoolean(backendEnv.ODOO_ENABLED, 'ODOO_ENABLED', false);
  const mode = dryRun ? 'DRY_RUN' : enabled && discoveryOnly ? 'DISCOVERY_ONLY' : 'LIVE_CREATE_BLOCKED';
  console.log(`Odoo probe mode: ${mode}`);

  if (!dryRun && !discoveryOnly) {
    throw new Error('LIVE_CREATE_BLOCKED: ODOO_DISCOVERY_ONLY=true is required for any non-dry-run Odoo probe. Record creation is blocked.');
  }

  await runOdooOrderProbe({
    env: backendEnv,
  });
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
