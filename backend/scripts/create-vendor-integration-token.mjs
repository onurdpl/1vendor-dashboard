#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { runVendorIntegrationTokenCli } from '../dist/modules/vendor-integration/vendor-integration-token.cli.js';

function loadEnvFile(filePath, override = false) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const content = fs.readFileSync(filePath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) {
      continue;
    }

    const separator = trimmed.indexOf('=');
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (key && (override || process.env[key] === undefined)) {
      process.env[key] = value;
    }
  }
}

loadEnvFile(path.join(process.cwd(), '.env.example'));
loadEnvFile(path.join(process.cwd(), '.env'), true);

runVendorIntegrationTokenCli().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Vendor integration token creation failed.');
  process.exitCode = 1;
});
