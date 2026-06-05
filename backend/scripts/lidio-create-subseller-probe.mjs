#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

function loadEnvFile(filePath) {
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
    const value = trimmed.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadEnvFile(path.join(process.cwd(), '.env'));
loadEnvFile(path.join(process.cwd(), '.env.example'));

const { runLidioCreateSubsellerProbeCli } = await import('../dist/scripts/lidioCreateSubsellerProbe.js');

runLidioCreateSubsellerProbeCli().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Lidio CreateSubseller sandbox probe failed.');
  process.exitCode = 1;
});
