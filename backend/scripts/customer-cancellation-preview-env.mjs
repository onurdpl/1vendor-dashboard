import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const BACKEND_DIR = resolve(SCRIPT_DIR, '..');
export const REPO_ROOT = resolve(BACKEND_DIR, '..');
export const CUSTOMER_CANCELLATION_PREVIEW_ENV_FILE = resolve(
  BACKEND_DIR,
  '.env.customer-cancellation-preview',
);
export const CUSTOMER_CANCELLATION_PREVIEW_DATABASE_NAME =
  'vendor_dashboard_customer_cancellation_preview';
export const CUSTOMER_CANCELLATION_PREVIEW_SHOP_DOMAIN =
  'sporgym-cancellation-dev.myshopify.com';
export const CUSTOMER_CANCELLATION_PREVIEW_CLIENT_ID = '2f542047bb25c5f0e2eef3e279390c8d';
export const CUSTOMER_CANCELLATION_PREVIEW_ALLOWED_DB_HOSTS = ['localhost', '127.0.0.1', '::1'];

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
  'REPLACE_WITH_CUSTOMER_CANCELLATION_APP_CLIENT_SECRET',
  'REPLACE_WITH_DEV_STORE_ADMIN_ACCESS_TOKEN',
  '',
]);

export class CustomerCancellationPreviewEnvError extends Error {
  constructor(message, diagnostics = {}) {
    super(message);
    this.name = 'CustomerCancellationPreviewEnvError';
    this.code = 'PREVIEW_DATABASE_GUARD_FAILED';
    this.diagnostics = diagnostics;
  }
}

export function parseCustomerCancellationPreviewEnvFile(
  envFile = CUSTOMER_CANCELLATION_PREVIEW_ENV_FILE,
) {
  if (!existsSync(envFile)) {
    throw new CustomerCancellationPreviewEnvError('Preview env file does not exist.', {
      envFile,
    });
  }

  const parsed = {};
  const lines = readFileSync(envFile, 'utf8').split(/\r?\n/);
  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const equalsIndex = line.indexOf('=');
    if (equalsIndex <= 0) {
      throw new CustomerCancellationPreviewEnvError('Invalid preview env syntax.', {
        envFile,
        line: index + 1,
      });
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
    throw new CustomerCancellationPreviewEnvError(
      `${key} must be ${expected} for the local cancellation preview.`,
      {
        key,
        expected,
        actual: env[key] ? '[configured]' : '[missing]',
      },
    );
  }
}

function assertFalse(env, key) {
  const normalized = (env[key] ?? '').trim().toLowerCase();
  if (!['false', '0', 'no'].includes(normalized)) {
    throw new CustomerCancellationPreviewEnvError(
      `${key} must be false for the local cancellation preview.`,
      {
        key,
        actual: env[key] ? '[configured]' : '[missing]',
      },
    );
  }
}

function assertNotPlaceholder(env, key, envFile) {
  const value = env[key]?.trim() ?? '';
  if (PLACEHOLDER_VALUES.has(value) || /^REPLACE_WITH_/i.test(value)) {
    throw new CustomerCancellationPreviewEnvError(
      `${key} must be set in the preview env before starting cancellation preview tooling.`,
      {
        key,
        envFile,
      },
    );
  }
}

export function parseDatabaseUrlForSafeDiagnostics(databaseUrl) {
  if (!databaseUrl?.trim()) {
    throw new CustomerCancellationPreviewEnvError(
      'DATABASE_URL is required for the local cancellation preview.',
      {
        host: '[missing]',
        database: '[missing]',
      },
    );
  }

  let url;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new CustomerCancellationPreviewEnvError('DATABASE_URL must be a valid PostgreSQL URL.');
  }

  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new CustomerCancellationPreviewEnvError(
      'DATABASE_URL must use the postgres/postgresql protocol.',
      {
        protocol: url.protocol,
      },
    );
  }

  return {
    host: url.hostname.toLowerCase().replace(/^\[(.*)\]$/, '$1'),
    database: decodeURIComponent(url.pathname.replace(/^\//, '')),
  };
}

export function assertCustomerCancellationPreviewDatabase(databaseUrl) {
  const diagnostics = parseDatabaseUrlForSafeDiagnostics(databaseUrl);

  if (!CUSTOMER_CANCELLATION_PREVIEW_ALLOWED_DB_HOSTS.includes(diagnostics.host)) {
    throw new CustomerCancellationPreviewEnvError(
      'DATABASE_URL must point to local PostgreSQL only.',
      diagnostics,
    );
  }

  if (diagnostics.database !== CUSTOMER_CANCELLATION_PREVIEW_DATABASE_NAME) {
    throw new CustomerCancellationPreviewEnvError(
      `DATABASE_URL database name must be exactly ${CUSTOMER_CANCELLATION_PREVIEW_DATABASE_NAME}.`,
      diagnostics,
    );
  }

  const forbidden = ['render.com', 'oregon-postgres', 'singapore-postgres', 'production', 'prod'];
  const normalized = databaseUrl.toLowerCase();
  const matched = forbidden.find((needle) => normalized.includes(needle));
  if (matched) {
    throw new CustomerCancellationPreviewEnvError(
      'DATABASE_URL contains a forbidden production-like marker.',
      {
        ...diagnostics,
        marker: matched,
      },
    );
  }

  return diagnostics;
}

export function validateCustomerCancellationPreviewEnv(
  env,
  { envFile = CUSTOMER_CANCELLATION_PREVIEW_ENV_FILE } = {},
) {
  assertEqual(env, 'NODE_ENV', 'development');
  assertEqual(env, 'SHOPIFY_SHOP_DOMAIN', CUSTOMER_CANCELLATION_PREVIEW_SHOP_DOMAIN);
  assertEqual(env, 'SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID', CUSTOMER_CANCELLATION_PREVIEW_CLIENT_ID);
  assertEqual(env, 'CUSTOMER_CANCELLATION_INTAKE_ENABLED', 'true');
  assertEqual(env, 'SHIPPING_PROVIDER', 'kargonomi');
  assertEqual(env, 'KARGONOMI_BASE_URL', 'http://127.0.0.1:9');
  assertEqual(env, 'KARGONOMI_API_TOKEN', 'dummy-preview-token-shipping-disabled');

  for (const key of REQUIRED_FALSE_FLAGS) {
    assertFalse(env, key);
  }

  assertNotPlaceholder(env, 'SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_SECRET', envFile);
  assertNotPlaceholder(env, 'SHOPIFY_ADMIN_ACCESS_TOKEN', envFile);
  const database = assertCustomerCancellationPreviewDatabase(env.DATABASE_URL);

  return {
    env,
    envFile,
    database,
  };
}

export function loadCustomerCancellationPreviewEnv(
  envFile = CUSTOMER_CANCELLATION_PREVIEW_ENV_FILE,
) {
  return validateCustomerCancellationPreviewEnv(
    parseCustomerCancellationPreviewEnvFile(envFile),
    { envFile },
  );
}

export function buildCustomerCancellationPreviewChildEnv(
  env,
  {
    envFile = CUSTOMER_CANCELLATION_PREVIEW_ENV_FILE,
    baseEnv = process.env,
  } = {},
) {
  const childEnv = {
    PATH: baseEnv.PATH,
    ...env,
    CUSTOMER_CANCELLATION_PREVIEW_ENV_FILE: envFile,
  };
  if (baseEnv.npm_config_user_agent) {
    childEnv.npm_config_user_agent = baseEnv.npm_config_user_agent;
  }
  return childEnv;
}

export function printCustomerCancellationPreviewGuardFailure(error) {
  if (error instanceof CustomerCancellationPreviewEnvError) {
    console.error(error.code);
    console.error(error.message);
    if (error.diagnostics.host || error.diagnostics.database) {
      console.error(
        `Safe diagnostics: host=${error.diagnostics.host ?? '[unknown]'} database=${
          error.diagnostics.database ?? '[unknown]'
        }`,
      );
    }
    return;
  }

  console.error(error instanceof Error ? error.message : error);
}
