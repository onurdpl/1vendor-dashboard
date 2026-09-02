#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import {
  BACKEND_DIR,
  buildCustomerCancellationPreviewChildEnv,
  loadCustomerCancellationPreviewEnv,
  printCustomerCancellationPreviewGuardFailure,
} from './customer-cancellation-preview-env.mjs';

function main() {
  const { env, database } = loadCustomerCancellationPreviewEnv();

  console.log('Customer cancellation preview env passed local safety checks.');
  console.log(`Shop: ${env.SHOPIFY_SHOP_DOMAIN}`);
  console.log(`Database: ${database.host}/${database.database}`);

  const tsxBin = resolve(BACKEND_DIR, 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx');
  const child = spawn(tsxBin, ['scripts/customer-cancellation-preview-db-probe.ts'], {
    cwd: BACKEND_DIR,
    env: buildCustomerCancellationPreviewChildEnv(env),
    stdio: 'inherit',
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });
}

try {
  main();
} catch (error) {
  printCustomerCancellationPreviewGuardFailure(error);
  process.exit(1);
}
