type NodeEnv = 'development' | 'test' | 'production';

export type AppEnv = {
  NODE_ENV: NodeEnv;
  PORT: number;
  DATABASE_URL?: string;
  CORS_ORIGIN: string[];
  JWT_SECRET: string;
  JWT_EXPIRES_IN: string;
  SHOPIFY_WEBHOOK_SECRET: string;
  SHOPIFY_RETURN_WEBHOOK_SECRET?: string;
  SHOPIFY_FULFILLMENT_WEBHOOK_SECRET?: string;
  SHOPIFY_SHOP_DOMAIN?: string;
  SHOPIFY_ADMIN_ACCESS_TOKEN?: string;
  SHOPIFY_API_VERSION: string;
  SHOPIFY_MOCK_SELLER_INFO?: string;
  SHOPIFY_MOCK_RETURN_DETAILS?: string;
  SHOPIFY_MOCK_ORDER_FULFILLMENT_STATE?: string;
  SHOPIFY_SELLER_INFO_RETRY_DELAY_MS: number;
  SHOPIFY_MOCK_FULFILLMENT_ORDERS?: string;
  SHOPIFY_MOCK_FULFILLMENT_FAIL_ALLOCATION_IDS?: string;
  SCHEDULED_RECONCILIATION_ENABLED: boolean;
  SCHEDULED_RECONCILIATION_EXECUTE_DUE: boolean;
  SCHEDULED_RECONCILIATION_INTERVAL_MS: number;
  SCHEDULED_RECONCILIATION_COOLDOWN_MS: number;
  SCHEDULED_RECONCILIATION_CANDIDATE_LIMIT: number;
  EMAIL_NOTIFICATIONS_ENABLED: boolean;
  EMAIL_PROVIDER: 'noop' | 'console';
  EMAIL_FROM?: string;
  EMAIL_ADMIN_RECIPIENTS: string[];
};

function normalizeNodeEnv(value: string | undefined): NodeEnv {
  if (value === 'production' || value === 'test') {
    return value;
  }

  return 'development';
}

function parsePort(value: string | undefined): number {
  if (!value) {
    return 4000;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error('Invalid PORT value. Expected a positive integer.');
  }

  return parsed;
}

function parsePositiveInteger(value: string | undefined, fallback: number) {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error('Expected a positive integer configuration value.');
  }

  return parsed;
}

function parseBoolean(value: string | undefined, fallback: boolean) {
  if (!value) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
    return true;
  }

  if (normalized === 'false' || normalized === '0' || normalized === 'no') {
    return false;
  }

  throw new Error('Expected a boolean configuration value.');
}

function parseCorsOrigins(value: string | undefined, nodeEnv: NodeEnv) {
  if (value?.trim()) {
    return value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  if (nodeEnv === 'production') {
    throw new Error('CORS_ORIGIN is required in production.');
  }

  return ['http://127.0.0.1:5173', 'http://localhost:5173'];
}

function parseEmailProvider(value: string | undefined): AppEnv['EMAIL_PROVIDER'] {
  const normalized = (value || 'noop').trim().toLowerCase();
  if (normalized === 'console' || normalized === 'noop') {
    return normalized;
  }

  throw new Error('Invalid EMAIL_PROVIDER value. Expected noop or console.');
}

function parseCommaList(value: string | undefined) {
  return (value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function loadEnv(): AppEnv {
  const nodeEnv = normalizeNodeEnv(process.env.NODE_ENV);
  const jwtSecret = process.env.JWT_SECRET || (nodeEnv !== 'production' ? 'dev-only-jwt-secret-change-in-production' : undefined);
  const shopifyWebhookSecret =
    process.env.SHOPIFY_WEBHOOK_SECRET ||
    (nodeEnv !== 'production' ? 'dev-shopify-webhook-secret' : undefined);
  const shopifyReturnWebhookSecret = process.env.SHOPIFY_RETURN_WEBHOOK_SECRET || undefined;
  const shopifyFulfillmentWebhookSecret = process.env.SHOPIFY_FULFILLMENT_WEBHOOK_SECRET || undefined;
  const shopifyShopDomain = process.env.SHOPIFY_SHOP_DOMAIN || undefined;
  const shopifyAdminAccessToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || undefined;
  const shopifyApiVersion = process.env.SHOPIFY_API_VERSION || '2024-01';
  const defaultRetryDelayMs = nodeEnv === 'test' ? 25 : 2000;

  if (!jwtSecret) {
    throw new Error('JWT_SECRET is required in production.');
  }

  if (!shopifyWebhookSecret) {
    throw new Error('SHOPIFY_WEBHOOK_SECRET is required in production.');
  }

  if (nodeEnv === 'production' && (!shopifyShopDomain || !shopifyAdminAccessToken)) {
    throw new Error('SHOPIFY_SHOP_DOMAIN and SHOPIFY_ADMIN_ACCESS_TOKEN are required in production.');
  }

  return {
    NODE_ENV: nodeEnv,
    PORT: parsePort(process.env.PORT),
    DATABASE_URL: process.env.DATABASE_URL || undefined,
    CORS_ORIGIN: parseCorsOrigins(process.env.CORS_ORIGIN, nodeEnv),
    JWT_SECRET: jwtSecret,
    JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '12h',
    SHOPIFY_WEBHOOK_SECRET: shopifyWebhookSecret,
    SHOPIFY_RETURN_WEBHOOK_SECRET: shopifyReturnWebhookSecret,
    SHOPIFY_FULFILLMENT_WEBHOOK_SECRET: shopifyFulfillmentWebhookSecret,
    SHOPIFY_SHOP_DOMAIN: shopifyShopDomain,
    SHOPIFY_ADMIN_ACCESS_TOKEN: shopifyAdminAccessToken,
    SHOPIFY_API_VERSION: shopifyApiVersion,
    SHOPIFY_MOCK_SELLER_INFO: process.env.SHOPIFY_MOCK_SELLER_INFO || undefined,
    SHOPIFY_MOCK_RETURN_DETAILS: process.env.SHOPIFY_MOCK_RETURN_DETAILS || undefined,
    SHOPIFY_MOCK_ORDER_FULFILLMENT_STATE: process.env.SHOPIFY_MOCK_ORDER_FULFILLMENT_STATE || undefined,
    SHOPIFY_SELLER_INFO_RETRY_DELAY_MS: parsePositiveInteger(
      process.env.SHOPIFY_SELLER_INFO_RETRY_DELAY_MS,
      defaultRetryDelayMs,
    ),
    SHOPIFY_MOCK_FULFILLMENT_ORDERS: process.env.SHOPIFY_MOCK_FULFILLMENT_ORDERS || undefined,
    SHOPIFY_MOCK_FULFILLMENT_FAIL_ALLOCATION_IDS:
      process.env.SHOPIFY_MOCK_FULFILLMENT_FAIL_ALLOCATION_IDS || undefined,
    SCHEDULED_RECONCILIATION_ENABLED: parseBoolean(process.env.SCHEDULED_RECONCILIATION_ENABLED, false),
    SCHEDULED_RECONCILIATION_EXECUTE_DUE: parseBoolean(process.env.SCHEDULED_RECONCILIATION_EXECUTE_DUE, false),
    SCHEDULED_RECONCILIATION_INTERVAL_MS: parsePositiveInteger(
      process.env.SCHEDULED_RECONCILIATION_INTERVAL_MS,
      30 * 60 * 1000,
    ),
    SCHEDULED_RECONCILIATION_COOLDOWN_MS: parsePositiveInteger(
      process.env.SCHEDULED_RECONCILIATION_COOLDOWN_MS,
      30 * 60 * 1000,
    ),
    SCHEDULED_RECONCILIATION_CANDIDATE_LIMIT: parsePositiveInteger(
      process.env.SCHEDULED_RECONCILIATION_CANDIDATE_LIMIT,
      25,
    ),
    EMAIL_NOTIFICATIONS_ENABLED: parseBoolean(process.env.EMAIL_NOTIFICATIONS_ENABLED, false),
    EMAIL_PROVIDER: parseEmailProvider(process.env.EMAIL_PROVIDER),
    EMAIL_FROM: process.env.EMAIL_FROM || undefined,
    EMAIL_ADMIN_RECIPIENTS: parseCommaList(process.env.EMAIL_ADMIN_RECIPIENTS),
  };
}
