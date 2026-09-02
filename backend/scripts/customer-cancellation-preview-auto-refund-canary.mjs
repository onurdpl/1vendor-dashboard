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

export const CUSTOMER_CANCELLATION_AUTO_REFUND_CANARY_ORDER_NUMBER = '1002';
export const CUSTOMER_CANCELLATION_AUTO_REFUND_CANARY_ORDER_GID =
  'gid://shopify/Order/6661668470969';

class CustomerCancellationAutoRefundCanaryArgsError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CustomerCancellationAutoRefundCanaryArgsError';
  }
}

export function parseCustomerCancellationAutoRefundCanaryArgs(argv = process.argv.slice(2)) {
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
      throw new CustomerCancellationAutoRefundCanaryArgsError(`Unsupported option: ${arg}`);
    }
    if (requestId) {
      throw new CustomerCancellationAutoRefundCanaryArgsError(
        'Exactly one customer cancellation request ID must be supplied.',
      );
    }
    requestId = arg;
  }

  if (!requestId?.trim()) {
    throw new CustomerCancellationAutoRefundCanaryArgsError(
      'Customer cancellation request ID is required.',
    );
  }
  if (execute && dryRun) {
    throw new CustomerCancellationAutoRefundCanaryArgsError(
      'Use either --execute or --dry-run, not both.',
    );
  }

  return {
    requestId: requestId.trim(),
    execute,
  };
}

export function buildCustomerCancellationAutoRefundCanaryChildEnv(env, { execute }) {
  return buildCustomerCancellationPreviewChildEnv({
    ...env,
    CUSTOMER_CANCELLATION_AUTO_REFUND_ENABLED: execute ? 'true' : 'false',
    CUSTOMER_CANCELLATION_AUTO_REFUND_CANARY_MODE: execute ? 'execute' : 'dry-run',
  });
}

function printUsage() {
  console.error(
    'Usage: npm run backend:customer-cancellation:preview:auto-refund-canary -- <request-id> [--execute]',
  );
}

function run() {
  const args = parseCustomerCancellationAutoRefundCanaryArgs();
  const { env, database } = loadCustomerCancellationPreviewEnv();

  console.log('Customer cancellation auto-refund canary guard passed.');
  console.log(`Shop: ${env.SHOPIFY_SHOP_DOMAIN}`);
  console.log(`Database: ${database.host}/${database.database}`);
  console.log(`Request: ${args.requestId}`);
  console.log(`Mode: ${args.execute ? 'execute' : 'dry-run'}`);
  console.log(`Persistent auto-refund flag: ${env.CUSTOMER_CANCELLATION_AUTO_REFUND_ENABLED}`);

  const tsxBin = resolve(
    BACKEND_DIR,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'tsx.cmd' : 'tsx',
  );
  const child = spawn(
    tsxBin,
    [
      'scripts/customer-cancellation-preview-auto-refund-canary.ts',
      '--request-id',
      args.requestId,
      '--order-number',
      CUSTOMER_CANCELLATION_AUTO_REFUND_CANARY_ORDER_NUMBER,
      '--shopify-order-id',
      CUSTOMER_CANCELLATION_AUTO_REFUND_CANARY_ORDER_GID,
      args.execute ? '--execute' : '--dry-run',
    ],
    {
      cwd: BACKEND_DIR,
      env: buildCustomerCancellationAutoRefundCanaryChildEnv(env, args),
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
    if (error instanceof CustomerCancellationAutoRefundCanaryArgsError) {
      console.error(error.message);
      printUsage();
    } else {
      printCustomerCancellationPreviewGuardFailure(error);
    }
    process.exit(1);
  }
}
