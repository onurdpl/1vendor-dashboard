#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = resolve(SCRIPT_DIR, '..');
const REPO_ROOT = resolve(BACKEND_DIR, '..');
const ENV_FILE = resolve(BACKEND_DIR, '.env.customer-cancellation-preview');

const EXPECTED_SHOP = 'sporgym-cancellation-dev.myshopify.com';
const EXPECTED_CLIENT_ID = '189b719fce9bc8da4d30ee7818d1a93e';
const REQUIRED_FALSE_FLAGS = [
  'CUSTOMER_CANCELLATION_AUTO_REFUND_ENABLED',
  'SHIPPING_EXECUTION_ENABLED',
  'SHOPIFY_ORDERS_CREATE_EXECUTOR_ENABLED',
  'SHOPIFY_ORDERS_CREATE_ASYNC_ACK_ENABLED',
  'SHOPIFY_MISSED_ORDER_DISCOVERY_ENABLED',
  'SCHEDULED_RECONCILIATION_ENABLED',
  'SCHEDULED_RECONCILIATION_EXECUTE_DUE',
  'SETTLEMENT_AUTO_DRAFT_JOB_ENABLED',
  'APPROVED_RETURN_AUTO_CANCEL_ENABLED',
  'CANONICAL_RECONCILIATION_ENABLED',
];
const PLACEHOLDER_VALUES = new Set([
  'REPLACE_WITH_METAFIELD_SYNC_TOOL_CLIENT_SECRET',
  'REPLACE_WITH_DEV_STORE_ADMIN_ACCESS_TOKEN',
  '',
]);

function parseEnvFile(path) {
  if (!existsSync(path)) {
    throw new Error(`Preview env file does not exist: ${path}`);
  }

  const parsed = {};
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const equalsIndex = line.indexOf('=');
    if (equalsIndex <= 0) {
      throw new Error(`Invalid env syntax at ${path}:${index + 1}`);
    }
    const key = line.slice(0, equalsIndex).trim();
    let value = line.slice(equalsIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    parsed[key] = value;
  }
  return parsed;
}

function assertEqual(env, key, expected) {
  if (env[key] !== expected) {
    throw new Error(`${key} must be ${expected} for the local cancellation preview.`);
  }
}

function assertFalse(env, key) {
  const normalized = (env[key] ?? '').trim().toLowerCase();
  if (!['false', '0', 'no'].includes(normalized)) {
    throw new Error(`${key} must be false for the local cancellation preview.`);
  }
}

function assertNotPlaceholder(env, key) {
  const value = env[key]?.trim() ?? '';
  if (PLACEHOLDER_VALUES.has(value) || /^REPLACE_WITH_/i.test(value)) {
    throw new Error(`${key} must be set in ${ENV_FILE} before starting the preview backend.`);
  }
}

function assertLocalPreviewDatabase(databaseUrl) {
  if (!databaseUrl?.trim()) {
    throw new Error('DATABASE_URL is required for the local cancellation preview.');
  }

  let url;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL URL.');
  }

  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('DATABASE_URL must use the postgres/postgresql protocol.');
  }

  const hostname = url.hostname.toLowerCase();
  if (!['localhost', '127.0.0.1', '::1'].includes(hostname)) {
    throw new Error('DATABASE_URL must point to local PostgreSQL only.');
  }

  const databaseName = decodeURIComponent(url.pathname.replace(/^\//, '')).toLowerCase();
  if (!databaseName.includes('customer_cancellation_preview')) {
    throw new Error('DATABASE_URL database name must include customer_cancellation_preview.');
  }

  const forbidden = ['render.com', 'oregon-postgres', 'singapore-postgres', 'production', 'prod'];
  const normalized = databaseUrl.toLowerCase();
  const matched = forbidden.find((needle) => normalized.includes(needle));
  if (matched) {
    throw new Error(`DATABASE_URL looks unsafe for preview because it contains ${matched}.`);
  }
}

function validatePreviewEnv(env) {
  assertEqual(env, 'NODE_ENV', 'development');
  assertEqual(env, 'SHOPIFY_SHOP_DOMAIN', EXPECTED_SHOP);
  assertEqual(env, 'SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID', EXPECTED_CLIENT_ID);
  assertEqual(env, 'CUSTOMER_CANCELLATION_INTAKE_ENABLED', 'true');
  assertEqual(env, 'SHIPPING_PROVIDER', 'kargonomi');
  assertEqual(env, 'KARGONOMI_BASE_URL', 'http://127.0.0.1:9');
  assertEqual(env, 'KARGONOMI_API_TOKEN', 'dummy-preview-token-shipping-disabled');

  for (const key of REQUIRED_FALSE_FLAGS) {
    assertFalse(env, key);
  }

  assertNotPlaceholder(env, 'SHOPIFY_WEBHOOK_SECRET');
  assertNotPlaceholder(env, 'SHOPIFY_ADMIN_ACCESS_TOKEN');
  assertLocalPreviewDatabase(env.DATABASE_URL);

  return env;
}

function buildChildEnv(env) {
  const childEnv = {
    PATH: process.env.PATH,
    ...env,
    CUSTOMER_CANCELLATION_PREVIEW_ENV_FILE: ENV_FILE,
  };
  if (process.env.npm_config_user_agent) {
    childEnv.npm_config_user_agent = process.env.npm_config_user_agent;
  }
  return childEnv;
}

function main() {
  const checkOnly = process.argv.includes('--check');
  const env = validatePreviewEnv(parseEnvFile(ENV_FILE));

  console.log('Customer cancellation preview env passed local safety checks.');
  console.log(`Shop: ${env.SHOPIFY_SHOP_DOMAIN}`);
  console.log(`Database: ${new URL(env.DATABASE_URL).hostname}/${new URL(env.DATABASE_URL).pathname.replace(/^\//, '')}`);
  console.log('Intake: enabled');
  console.log('Auto-refund: disabled');
  console.log('Shipping execution: disabled');

  if (checkOnly) return;

  const child = spawn('npm', ['--prefix', BACKEND_DIR, 'run', 'dev'], {
    cwd: REPO_ROOT,
    env: buildChildEnv(env),
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
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
