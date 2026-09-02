#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  BACKEND_DIR,
  buildCustomerCancellationPreviewChildEnv,
  loadCustomerCancellationPreviewEnv,
  printCustomerCancellationPreviewGuardFailure,
} from './customer-cancellation-preview-env.mjs';

const ORDER_NUMBER = '1002';
const ORDER_GID = 'gid://shopify/Order/6661668470969';

class CustomerCancellationOrderCancelCanaryArgsError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CustomerCancellationOrderCancelCanaryArgsError';
  }
}

function parseArgs(argv = process.argv.slice(2)) {
  let requestId;
  let execute = false;
  let dryRun = false;
  for (const arg of argv) {
    if (arg === '--execute') {
      execute = true;
      continue;
    }
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (arg.startsWith('-')) {
      throw new CustomerCancellationOrderCancelCanaryArgsError(`Unsupported option: ${arg}`);
    }
    if (requestId) {
      throw new CustomerCancellationOrderCancelCanaryArgsError(
        'Exactly one customer cancellation request ID must be supplied.',
      );
    }
    requestId = arg;
  }
  if (!requestId?.trim()) {
    throw new CustomerCancellationOrderCancelCanaryArgsError(
      'Customer cancellation request ID is required.',
    );
  }
  if (execute && dryRun) {
    throw new CustomerCancellationOrderCancelCanaryArgsError('Use either --execute or --dry-run, not both.');
  }
  return { requestId: requestId.trim(), execute };
}

function printUsage() {
  console.error(
    'Usage: npm run customer-cancellation:preview:order-cancel-canary -- <request-id> [--execute]',
  );
}

function run() {
  const args = parseArgs();
  const { env, database } = loadCustomerCancellationPreviewEnv();
  console.log('Customer cancellation order-cancel canary guard passed.');
  console.log(`Shop: ${env.SHOPIFY_SHOP_DOMAIN}`);
  console.log(`Database: ${database.host}/${database.database}`);
  console.log(`Request: ${args.requestId}`);
  console.log(`Mode: ${args.execute ? 'execute' : 'dry-run'}`);

  const tsxBin = resolve(
    BACKEND_DIR,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'tsx.cmd' : 'tsx',
  );
  const child = spawn(
    tsxBin,
    [
      'scripts/customer-cancellation-preview-order-cancel-canary.ts',
      '--request-id',
      args.requestId,
      '--order-number',
      ORDER_NUMBER,
      '--shopify-order-id',
      ORDER_GID,
      args.execute ? '--execute' : '--dry-run',
    ],
    {
      cwd: BACKEND_DIR,
      env: buildCustomerCancellationPreviewChildEnv(env),
      stdio: 'inherit',
    },
  );

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    run();
  } catch (error) {
    if (error instanceof CustomerCancellationOrderCancelCanaryArgsError) {
      console.error(error.message);
      printUsage();
    } else {
      printCustomerCancellationPreviewGuardFailure(error);
    }
    process.exitCode = 1;
  }
}
