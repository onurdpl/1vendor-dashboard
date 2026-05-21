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
  INVOICE_EXECUTION_ENABLED: boolean;
  INVOICE_PROVIDER: 'bizimhesap';
  BIZIMHESAP_ENABLED: boolean;
  BIZIMHESAP_FIRM_ID?: string;
  BIZIMHESAP_API_KEY?: string;
  BIZIMHESAP_BASE_URL?: string;
  BIZIMHESAP_ADD_INVOICE_URL?: string;
  BIZIMHESAP_ACCESS_TOKEN?: string;
  SHIPPING_EXECUTION_ENABLED: boolean;
  SHIPPING_SANDBOX_MODE: boolean;
  SHIPPING_PROVIDER: 'hepsijet' | 'kargo_entegrator' | 'try_oto' | 'kargonomi' | 'navlungo';
  KARGO_ENTEGRATOR_ENABLED: boolean;
  KARGO_ENTEGRATOR_WEBHOOK_INGEST_ENABLED: boolean;
  KARGO_ENTEGRATOR_BASE_URL?: string;
  KARGO_ENTEGRATOR_API_KEY?: string;
  KARGO_ENTEGRATOR_CARGO_INTEGRATION_ID?: string;
  KARGO_ENTEGRATOR_CARGO_INTEGRATION_ID_SOURCE?: 'primary' | 'deprecated';
  TRY_OTO_ENABLED: boolean;
  TRY_OTO_BASE_URL?: string;
  TRY_OTO_REFRESH_TOKEN?: string;
  TRY_OTO_SANDBOX_MODE: boolean;
  TRY_OTO_WEBHOOK_INGEST_ENABLED: boolean;
  KARGONOMI_BASE_URL?: string;
  KARGONOMI_API_TOKEN?: string;
  KARGONOMI_APP_KEY?: string;
  KARGONOMI_DEFAULT_WAREHOUSE_ID?: string;
  NAVLUNGO_BASE_URL?: string;
  NAVLUNGO_API_USERNAME?: string;
  NAVLUNGO_API_PASSWORD?: string;
  NAVLUNGO_DEFAULT_SENDER_ADDRESS_ID?: string;
  NAVLUNGO_DEFAULT_BARCODE_FORMAT?: string;
  NAVLUNGO_DEFAULT_CARRIER_ID?: string;
  NAVLUNGO_CREATE_POST_PROBE_CONFIRM?: string;
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

function parseInvoiceProvider(value: string | undefined): AppEnv['INVOICE_PROVIDER'] {
  const normalized = (value || 'bizimhesap').trim().toLowerCase();
  if (normalized === 'bizimhesap') {
    return normalized;
  }

  throw new Error('Invalid INVOICE_PROVIDER value. Expected bizimhesap.');
}

function parseShippingProvider(value: string | undefined): AppEnv['SHIPPING_PROVIDER'] {
  const normalized = (value || 'hepsijet').trim().toLowerCase();
  if (
    normalized === 'hepsijet' ||
    normalized === 'kargo_entegrator' ||
    normalized === 'try_oto' ||
    normalized === 'kargonomi' ||
    normalized === 'navlungo'
  ) {
    return normalized;
  }

  throw new Error('Invalid SHIPPING_PROVIDER value. Expected hepsijet, kargo_entegrator, try_oto, kargonomi, or navlungo.');
}

function parseCommaList(value: string | undefined) {
  return (value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseKargoCargoIntegrationEnv() {
  const primary = process.env.KARGO_ENTEGRATOR_CARGO_INTEGRATION_ID?.trim();
  const deprecated = process.env.ARGO_ENTEGRATOR_CARGO_INTEGRATION_ID?.trim();

  if (primary) {
    return {
      value: primary,
      source: 'primary' as const,
    };
  }

  if (deprecated) {
    return {
      value: deprecated,
      source: 'deprecated' as const,
    };
  }

  return {
    value: undefined,
    source: undefined,
  };
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

  const kargoCargoIntegration = parseKargoCargoIntegrationEnv();
  const shippingProvider = parseShippingProvider(process.env.SHIPPING_PROVIDER);
  const kargonomiBaseUrl = process.env.KARGONOMI_BASE_URL || undefined;
  const kargonomiApiToken = process.env.KARGONOMI_API_TOKEN || undefined;
  const kargonomiDefaultWarehouseId = process.env.KARGONOMI_DEFAULT_WAREHOUSE_ID || undefined;
  const navlungoBaseUrl = process.env.NAVLUNGO_BASE_URL || undefined;
  const navlungoApiUsername = process.env.NAVLUNGO_API_USERNAME || undefined;
  const navlungoApiPassword = process.env.NAVLUNGO_API_PASSWORD || undefined;
  const navlungoDefaultSenderAddressId = process.env.NAVLUNGO_DEFAULT_SENDER_ADDRESS_ID || undefined;
  const navlungoDefaultBarcodeFormat = process.env.NAVLUNGO_DEFAULT_BARCODE_FORMAT || undefined;
  const navlungoDefaultCarrierId = process.env.NAVLUNGO_DEFAULT_CARRIER_ID || undefined;
  const navlungoCreatePostProbeConfirm = process.env.NAVLUNGO_CREATE_POST_PROBE_CONFIRM || undefined;

  if (shippingProvider === 'kargonomi') {
    if (!kargonomiBaseUrl) {
      throw new Error('KARGONOMI_BASE_URL is required when SHIPPING_PROVIDER=kargonomi.');
    }
    if (!kargonomiApiToken) {
      throw new Error('KARGONOMI_API_TOKEN is required when SHIPPING_PROVIDER=kargonomi.');
    }
  }
  if (shippingProvider === 'navlungo') {
    if (!navlungoBaseUrl) {
      throw new Error('NAVLUNGO_BASE_URL is required when SHIPPING_PROVIDER=navlungo.');
    }
    if (!navlungoApiUsername) {
      throw new Error('NAVLUNGO_API_USERNAME is required when SHIPPING_PROVIDER=navlungo.');
    }
    if (!navlungoApiPassword) {
      throw new Error('NAVLUNGO_API_PASSWORD is required when SHIPPING_PROVIDER=navlungo.');
    }
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
    INVOICE_EXECUTION_ENABLED: parseBoolean(process.env.INVOICE_EXECUTION_ENABLED, false),
    INVOICE_PROVIDER: parseInvoiceProvider(process.env.INVOICE_PROVIDER),
    BIZIMHESAP_ENABLED: parseBoolean(process.env.BIZIMHESAP_ENABLED, false),
    BIZIMHESAP_FIRM_ID: process.env.BIZIMHESAP_FIRM_ID || undefined,
    BIZIMHESAP_API_KEY: process.env.BIZIMHESAP_API_KEY || undefined,
    BIZIMHESAP_BASE_URL: process.env.BIZIMHESAP_BASE_URL || undefined,
    BIZIMHESAP_ADD_INVOICE_URL: process.env.BIZIMHESAP_ADD_INVOICE_URL || undefined,
    BIZIMHESAP_ACCESS_TOKEN: process.env.BIZIMHESAP_ACCESS_TOKEN || undefined,
    SHIPPING_EXECUTION_ENABLED: parseBoolean(process.env.SHIPPING_EXECUTION_ENABLED, false),
    SHIPPING_SANDBOX_MODE: parseBoolean(process.env.SHIPPING_SANDBOX_MODE, false),
    SHIPPING_PROVIDER: shippingProvider,
    KARGO_ENTEGRATOR_ENABLED: parseBoolean(process.env.KARGO_ENTEGRATOR_ENABLED, false),
    KARGO_ENTEGRATOR_WEBHOOK_INGEST_ENABLED: parseBoolean(process.env.KARGO_ENTEGRATOR_WEBHOOK_INGEST_ENABLED, false),
    KARGO_ENTEGRATOR_BASE_URL: process.env.KARGO_ENTEGRATOR_BASE_URL || undefined,
    KARGO_ENTEGRATOR_API_KEY: process.env.KARGO_ENTEGRATOR_API_KEY || undefined,
    KARGO_ENTEGRATOR_CARGO_INTEGRATION_ID: kargoCargoIntegration.value,
    KARGO_ENTEGRATOR_CARGO_INTEGRATION_ID_SOURCE: kargoCargoIntegration.source,
    TRY_OTO_ENABLED: parseBoolean(process.env.TRY_OTO_ENABLED, false),
    TRY_OTO_BASE_URL: process.env.TRY_OTO_BASE_URL || undefined,
    TRY_OTO_REFRESH_TOKEN: process.env.TRY_OTO_REFRESH_TOKEN || undefined,
    TRY_OTO_SANDBOX_MODE: parseBoolean(process.env.TRY_OTO_SANDBOX_MODE, false),
    TRY_OTO_WEBHOOK_INGEST_ENABLED: parseBoolean(process.env.TRY_OTO_WEBHOOK_INGEST_ENABLED, false),
    KARGONOMI_BASE_URL: kargonomiBaseUrl,
    KARGONOMI_API_TOKEN: kargonomiApiToken,
    KARGONOMI_APP_KEY: process.env.KARGONOMI_APP_KEY || undefined,
    KARGONOMI_DEFAULT_WAREHOUSE_ID: kargonomiDefaultWarehouseId,
    NAVLUNGO_BASE_URL: navlungoBaseUrl,
    NAVLUNGO_API_USERNAME: navlungoApiUsername,
    NAVLUNGO_API_PASSWORD: navlungoApiPassword,
    NAVLUNGO_DEFAULT_SENDER_ADDRESS_ID: navlungoDefaultSenderAddressId,
    NAVLUNGO_DEFAULT_BARCODE_FORMAT: navlungoDefaultBarcodeFormat,
    NAVLUNGO_DEFAULT_CARRIER_ID: navlungoDefaultCarrierId,
    NAVLUNGO_CREATE_POST_PROBE_CONFIRM: navlungoCreatePostProbeConfirm,
  };
}
