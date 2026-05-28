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

  await runOdooOrderProbe({
    env: backendEnv,
  });
}

main().catch((error) => {
  console.error(JSON.stringify({ label: 'Odoo order probe failed', ...describeOdooProbeError(error) }, null, 2));
  process.exitCode = 1;
});
