type NodeEnv = 'development' | 'test' | 'production';

export type AppEnv = {
  NODE_ENV: NodeEnv;
  PORT: number;
  DATABASE_URL?: string;
  JWT_SECRET: string;
  JWT_EXPIRES_IN: string;
  SHOPIFY_WEBHOOK_SECRET: string;
  SHOPIFY_SHOP_DOMAIN?: string;
  SHOPIFY_ADMIN_ACCESS_TOKEN?: string;
  SHOPIFY_API_VERSION: string;
  SHOPIFY_MOCK_SELLER_INFO?: string;
  SHOPIFY_SELLER_INFO_RETRY_DELAY_MS: number;
  SHOPIFY_MOCK_FULFILLMENT_ORDERS?: string;
  SHOPIFY_MOCK_FULFILLMENT_FAIL_ALLOCATION_IDS?: string;
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

export function loadEnv(): AppEnv {
  const nodeEnv = normalizeNodeEnv(process.env.NODE_ENV);
  const jwtSecret = process.env.JWT_SECRET || (nodeEnv !== 'production' ? 'dev-only-jwt-secret-change-in-production' : undefined);
  const shopifyWebhookSecret =
    process.env.SHOPIFY_WEBHOOK_SECRET ||
    (nodeEnv !== 'production' ? 'dev-shopify-webhook-secret' : undefined);
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
    JWT_SECRET: jwtSecret,
    JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '12h',
    SHOPIFY_WEBHOOK_SECRET: shopifyWebhookSecret,
    SHOPIFY_SHOP_DOMAIN: shopifyShopDomain,
    SHOPIFY_ADMIN_ACCESS_TOKEN: shopifyAdminAccessToken,
    SHOPIFY_API_VERSION: shopifyApiVersion,
    SHOPIFY_MOCK_SELLER_INFO: process.env.SHOPIFY_MOCK_SELLER_INFO || undefined,
    SHOPIFY_SELLER_INFO_RETRY_DELAY_MS: parsePositiveInteger(
      process.env.SHOPIFY_SELLER_INFO_RETRY_DELAY_MS,
      defaultRetryDelayMs,
    ),
    SHOPIFY_MOCK_FULFILLMENT_ORDERS: process.env.SHOPIFY_MOCK_FULFILLMENT_ORDERS || undefined,
    SHOPIFY_MOCK_FULFILLMENT_FAIL_ALLOCATION_IDS:
      process.env.SHOPIFY_MOCK_FULFILLMENT_FAIL_ALLOCATION_IDS || undefined,
  };
}
