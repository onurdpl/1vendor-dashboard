type NodeEnv = 'development' | 'test' | 'production';

export type AppEnv = {
  NODE_ENV: NodeEnv;
  PORT: number;
  DATABASE_URL?: string;
  CORS_ORIGIN: string[];
  JWT_SECRET: string;
  JWT_EXPIRES_IN: string;
  LOGIN_RATE_LIMIT_MAX_ATTEMPTS: number;
  LOGIN_RATE_LIMIT_WINDOW_SECONDS: number;
  AUTH_RATE_LIMIT_RESET_ENABLED?: boolean;
  AUTH_RATE_LIMIT_RESET_TOKEN?: string;
  SHOPIFY_WEBHOOK_SECRET: string;
  SHOPIFY_RETURN_WEBHOOK_SECRET?: string;
  SHOPIFY_FULFILLMENT_WEBHOOK_SECRET?: string;
  SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID?: string;
  SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_SECRET?: string;
  SHOPIFY_SHOP_DOMAIN?: string;
  SHOPIFY_ADMIN_ACCESS_TOKEN?: string;
  SHOPIFY_API_VERSION: string;
  SHOPIFY_ORDER_WEBHOOK_BASE_URL?: string;
  SHOPIFY_MOCK_SELLER_INFO?: string;
  SHOPIFY_MOCK_RETURN_DETAILS?: string;
  SHOPIFY_MOCK_ORDER_FULFILLMENT_STATE?: string;
  SHOPIFY_SELLER_INFO_RETRY_DELAY_MS: number;
  SHOPIFY_ORDERS_CREATE_EXECUTOR_ENABLED?: boolean;
  SHOPIFY_ORDERS_CREATE_ASYNC_ACK_ENABLED?: boolean;
  SHOPIFY_ORDERS_CREATE_EXECUTOR_INTERVAL_MS?: number;
  SHOPIFY_ORDERS_CREATE_EXECUTOR_BATCH_SIZE?: number;
  SHOPIFY_ORDERS_CREATE_LEASE_MS?: number;
  SHOPIFY_ORDERS_CREATE_HEARTBEAT_MS?: number;
  CUSTOMER_CANCELLATION_INTAKE_ENABLED?: boolean;
  CUSTOMER_CANCELLATION_AUTO_REFUND_ENABLED?: boolean;
  CUSTOMER_CANCELLATION_AUTO_REFUND_INTERVAL_MS?: number;
  CUSTOMER_CANCELLATION_AUTO_REFUND_BATCH_SIZE?: number;
  CUSTOMER_CANCELLATION_AUTO_REFUND_LEASE_MS?: number;
  FULL_REFUND_TERMINAL_WRITER_ENABLED?: boolean;
  FULL_REFUND_CURRENT_STATE_REPAIR_WRITE_ENABLED?: boolean;
  SHOPIFY_MISSED_ORDER_DISCOVERY_ENABLED?: boolean;
  SHOPIFY_MISSED_ORDER_DISCOVERY_INTERVAL_MS?: number;
  SHOPIFY_MISSED_ORDER_DISCOVERY_LOOKBACK_DAYS?: number;
  SHOPIFY_MISSED_ORDER_DISCOVERY_GRACE_PERIOD_MS?: number;
  SHOPIFY_MISSED_ORDER_DISCOVERY_MAX_ORDERS?: number;
  SHOPIFY_MOCK_CANONICAL_REFUNDS?: string;
  SHOPIFY_MOCK_CANONICAL_RETURNS?: string;
  SHOPIFY_MOCK_FULFILLMENT_ORDERS?: string;
  SHOPIFY_MOCK_FULFILLMENT_FAIL_ALLOCATION_IDS?: string;
  PRODUCT_PANEL_BASE_URL?: string;
  PRODUCT_PANEL_VARIANT_DISABLE_ENABLED: boolean;
  PRODUCT_PANEL_VARIANT_DISABLE_DRY_RUN: boolean;
  PRODUCT_PANEL_HMAC_SECRET?: string;
  SCHEDULED_RECONCILIATION_ENABLED: boolean;
  SCHEDULED_RECONCILIATION_EXECUTE_DUE: boolean;
  SCHEDULED_RECONCILIATION_INTERVAL_MS: number;
  SCHEDULED_RECONCILIATION_COOLDOWN_MS: number;
  SCHEDULED_RECONCILIATION_CANDIDATE_LIMIT: number;
  CANONICAL_RECONCILIATION_ENABLED: boolean;
  CANONICAL_RECONCILIATION_MODE: 'dry-run' | 'repair';
  CANONICAL_RECONCILIATION_SCHEDULE_HOUR: number;
  CANONICAL_RECONCILIATION_LOOKBACK_DAYS: number;
  CANONICAL_RECONCILIATION_ORDER_LIMIT: number;
  SETTLEMENT_AUTO_DRAFT_JOB_ENABLED: boolean;
  SETTLEMENT_AUTO_DRAFT_JOB_DRY_RUN: boolean;
  SETTLEMENT_AUTO_DRAFT_SCHEDULER_ENABLED?: boolean;
  APPROVED_RETURN_AUTO_CANCEL_ENABLED?: boolean;
  APPROVED_RETURN_AUTO_CANCEL_DAYS?: number;
  APPROVED_RETURN_AUTO_CANCEL_INTERVAL_MS?: number;
  APPROVED_RETURN_AUTO_CANCEL_LIMIT?: number;
  EMAIL_NOTIFICATIONS_ENABLED: boolean;
  EMAIL_PROVIDER: 'noop' | 'console';
  EMAIL_FROM?: string;
  EMAIL_ADMIN_RECIPIENTS: string[];
  SHIPPING_EXECUTION_ENABLED: boolean;
  SHIPPING_SANDBOX_MODE: boolean;
  SHIPPING_PROVIDER: 'kargonomi';
  KARGONOMI_BASE_URL?: string;
  KARGONOMI_API_TOKEN?: string;
  KARGONOMI_APP_KEY?: string;
  KARGONOMI_DEFAULT_WAREHOUSE_ID?: string;
  KARGONOMI_ACCOUNT_TAX_NUMBER?: string;
  IYZICO_SANDBOX_API_KEY?: string;
  IYZICO_SANDBOX_SECRET_KEY?: string;
  IYZICO_SANDBOX_BASE_URL?: string;
  LOGO_ISBASI_BASE_URL?: string;
  LOGO_ISBASI_API_KEY?: string;
  LOGO_ISBASI_USERNAME?: string;
  LOGO_ISBASI_PASSWORD?: string;
  LOGO_ISBASI_CREATE_ENABLED?: boolean;
  LOGO_ISBASI_CREATE_ENVIRONMENT?: string;
  LOGO_ISBASI_EXPECTED_TENANT_ID?: string;
  SOPYO_CREDENTIAL_ENCRYPTION_KEY?: string;
  SOPYO_DELIVERY_POLLING_ENABLED?: boolean;
  SOPYO_ORDER_PUSH_WORKER_ENABLED?: boolean;
  SOPYO_ORDER_PUSH_WORKER_INTERVAL_MS?: number;
  SOPYO_ORDER_PUSH_WORKER_BATCH_SIZE?: number;
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

function parseRequiredPositiveInteger(value: string | undefined, name: string, max = Number.MAX_SAFE_INTEGER) {
  if (!value || !/^[1-9]\d*$/.test(value.trim())) {
    throw new Error(`${name} must be an explicit positive integer when the Sopyo order-push worker is enabled.`);
  }
  const parsed = Number(value.trim());
  if (!Number.isSafeInteger(parsed) || parsed > max) {
    throw new Error(`${name} must be an explicit positive integer when the Sopyo order-push worker is enabled.`);
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

function parseIntegerInRange(value: string | undefined, fallback: number, input: {
  min: number;
  max: number;
  name: string;
}) {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < input.min || parsed > input.max) {
    throw new Error(`Invalid ${input.name} value. Expected integer between ${input.min} and ${input.max}.`);
  }

  return parsed;
}

function parseCanonicalReconciliationMode(value: string | undefined): 'dry-run' | 'repair' {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === 'dry-run') {
    return 'dry-run';
  }
  if (normalized === 'repair') {
    return 'repair';
  }
  throw new Error('Invalid CANONICAL_RECONCILIATION_MODE value. Expected dry-run or repair.');
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

function parseShippingProvider(value: string | undefined): AppEnv['SHIPPING_PROVIDER'] {
  const normalized = (value || 'kargonomi').trim().toLowerCase();
  if (normalized === 'kargonomi') {
    return normalized;
  }

  if (normalized === 'try_oto' || normalized === 'navlungo') {
    throw new Error(`SHIPPING_PROVIDER=${normalized} is inactive. Only kargonomi is active.`);
  }

  throw new Error('Invalid SHIPPING_PROVIDER value. Only kargonomi is active.');
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
  const shopifyCustomerAccountClientId = process.env.SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID?.trim() || undefined;
  const shopifyCustomerAccountClientSecret =
    process.env.SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_SECRET?.trim() || undefined;
  const shopifyShopDomain = process.env.SHOPIFY_SHOP_DOMAIN || undefined;
  const shopifyAdminAccessToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || undefined;
  const shopifyApiVersion = process.env.SHOPIFY_API_VERSION || '2024-01';
  const defaultRetryDelayMs = nodeEnv === 'test' ? 25 : 2000;
  const ordersCreateExecutorLeaseMs = parsePositiveInteger(
    process.env.SHOPIFY_ORDERS_CREATE_LEASE_MS,
    60_000,
  );
  const ordersCreateExecutorHeartbeatMs = parsePositiveInteger(
    process.env.SHOPIFY_ORDERS_CREATE_HEARTBEAT_MS,
    10_000,
  );
  const ordersCreateExecutorEnabled = parseBoolean(
    process.env.SHOPIFY_ORDERS_CREATE_EXECUTOR_ENABLED,
    false,
  );
  const ordersCreateAsyncAckEnabled = parseBoolean(
    process.env.SHOPIFY_ORDERS_CREATE_ASYNC_ACK_ENABLED,
    false,
  );
  const customerCancellationIntakeEnabled = parseBoolean(
    process.env.CUSTOMER_CANCELLATION_INTAKE_ENABLED,
    false,
  );

  if (ordersCreateAsyncAckEnabled && !ordersCreateExecutorEnabled) {
    throw new Error(
      'SHOPIFY_ORDERS_CREATE_ASYNC_ACK_ENABLED requires SHOPIFY_ORDERS_CREATE_EXECUTOR_ENABLED=true.',
    );
  }

  if (ordersCreateExecutorHeartbeatMs * 2 >= ordersCreateExecutorLeaseMs) {
    throw new Error(
      'SHOPIFY_ORDERS_CREATE_HEARTBEAT_MS must be materially shorter than SHOPIFY_ORDERS_CREATE_LEASE_MS.',
    );
  }

  if (!jwtSecret) {
    throw new Error('JWT_SECRET is required in production.');
  }

  if (!shopifyWebhookSecret) {
    throw new Error('SHOPIFY_WEBHOOK_SECRET is required in production.');
  }

  if (nodeEnv === 'production' && (!shopifyShopDomain || !shopifyAdminAccessToken)) {
    throw new Error('SHOPIFY_SHOP_DOMAIN and SHOPIFY_ADMIN_ACCESS_TOKEN are required in production.');
  }

  if (
    customerCancellationIntakeEnabled &&
    (!shopifyCustomerAccountClientId || !shopifyCustomerAccountClientSecret || !shopifyShopDomain)
  ) {
    throw new Error(
      'CUSTOMER_CANCELLATION_INTAKE_ENABLED requires SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID, SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_SECRET, and SHOPIFY_SHOP_DOMAIN.',
    );
  }

  const shippingProvider = parseShippingProvider(process.env.SHIPPING_PROVIDER);
  const kargonomiBaseUrl = process.env.KARGONOMI_BASE_URL || undefined;
  const kargonomiApiToken = process.env.KARGONOMI_API_TOKEN || undefined;
  const kargonomiDefaultWarehouseId = process.env.KARGONOMI_DEFAULT_WAREHOUSE_ID || undefined;
  const kargonomiAccountTaxNumber = process.env.KARGONOMI_ACCOUNT_TAX_NUMBER?.trim() || undefined;
  const iyzicoSandboxApiKey = process.env.IYZICO_SANDBOX_API_KEY || undefined;
  const iyzicoSandboxSecretKey = process.env.IYZICO_SANDBOX_SECRET_KEY || undefined;
  const iyzicoSandboxBaseUrl = process.env.IYZICO_SANDBOX_BASE_URL || undefined;
  const logoIsbasiBaseUrl = process.env.LOGO_ISBASI_BASE_URL?.trim() || 'https://soho-isbasi-mwv2-test.logo-paas.com';
  const logoIsbasiApiKey = process.env.LOGO_ISBASI_API_KEY?.trim() || undefined;
  const logoIsbasiUsername = process.env.LOGO_ISBASI_USERNAME?.trim() || undefined;
  const logoIsbasiPassword = process.env.LOGO_ISBASI_PASSWORD?.trim() || undefined;
  const logoIsbasiCreateEnabled = parseBoolean(process.env.LOGO_ISBASI_CREATE_ENABLED, false);
  const logoIsbasiCreateEnvironment = process.env.LOGO_ISBASI_CREATE_ENVIRONMENT?.trim().toLowerCase() || undefined;
  const logoIsbasiExpectedTenantId = process.env.LOGO_ISBASI_EXPECTED_TENANT_ID?.trim() || undefined;
  const sopyoOrderPushWorkerEnabled = parseBoolean(process.env.SOPYO_ORDER_PUSH_WORKER_ENABLED, false);
  const sopyoOrderPushWorkerIntervalMs = sopyoOrderPushWorkerEnabled
    ? parseRequiredPositiveInteger(process.env.SOPYO_ORDER_PUSH_WORKER_INTERVAL_MS,
      'SOPYO_ORDER_PUSH_WORKER_INTERVAL_MS', 2_147_483_647)
    : undefined;
  const sopyoOrderPushWorkerBatchSize = sopyoOrderPushWorkerEnabled
    ? parseRequiredPositiveInteger(process.env.SOPYO_ORDER_PUSH_WORKER_BATCH_SIZE,
      'SOPYO_ORDER_PUSH_WORKER_BATCH_SIZE')
    : undefined;

  if (shippingProvider === 'kargonomi') {
    if (!kargonomiBaseUrl) {
      throw new Error('KARGONOMI_BASE_URL is required when SHIPPING_PROVIDER=kargonomi.');
    }
    if (!kargonomiApiToken) {
      throw new Error('KARGONOMI_API_TOKEN is required when SHIPPING_PROVIDER=kargonomi.');
    }
  }

  return {
    NODE_ENV: nodeEnv,
    PORT: parsePort(process.env.PORT),
    DATABASE_URL: process.env.DATABASE_URL || undefined,
    CORS_ORIGIN: parseCorsOrigins(process.env.CORS_ORIGIN, nodeEnv),
    JWT_SECRET: jwtSecret,
    JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '12h',
    LOGIN_RATE_LIMIT_MAX_ATTEMPTS: parsePositiveInteger(process.env.LOGIN_RATE_LIMIT_MAX_ATTEMPTS, 10),
    LOGIN_RATE_LIMIT_WINDOW_SECONDS: parsePositiveInteger(process.env.LOGIN_RATE_LIMIT_WINDOW_SECONDS, 600),
    AUTH_RATE_LIMIT_RESET_ENABLED: parseBoolean(process.env.AUTH_RATE_LIMIT_RESET_ENABLED, false),
    AUTH_RATE_LIMIT_RESET_TOKEN: process.env.AUTH_RATE_LIMIT_RESET_TOKEN?.trim() || undefined,
    SHOPIFY_WEBHOOK_SECRET: shopifyWebhookSecret,
    SHOPIFY_RETURN_WEBHOOK_SECRET: shopifyReturnWebhookSecret,
    SHOPIFY_FULFILLMENT_WEBHOOK_SECRET: shopifyFulfillmentWebhookSecret,
    SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID: shopifyCustomerAccountClientId,
    SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_SECRET: shopifyCustomerAccountClientSecret,
    SHOPIFY_SHOP_DOMAIN: shopifyShopDomain,
    SHOPIFY_ADMIN_ACCESS_TOKEN: shopifyAdminAccessToken,
    SHOPIFY_API_VERSION: shopifyApiVersion,
    SHOPIFY_ORDER_WEBHOOK_BASE_URL: process.env.SHOPIFY_ORDER_WEBHOOK_BASE_URL?.trim() || undefined,
    SHOPIFY_MOCK_SELLER_INFO: process.env.SHOPIFY_MOCK_SELLER_INFO || undefined,
    SHOPIFY_MOCK_RETURN_DETAILS: process.env.SHOPIFY_MOCK_RETURN_DETAILS || undefined,
    SHOPIFY_MOCK_ORDER_FULFILLMENT_STATE: process.env.SHOPIFY_MOCK_ORDER_FULFILLMENT_STATE || undefined,
    SHOPIFY_MOCK_CANONICAL_REFUNDS: process.env.SHOPIFY_MOCK_CANONICAL_REFUNDS || undefined,
    SHOPIFY_MOCK_CANONICAL_RETURNS: process.env.SHOPIFY_MOCK_CANONICAL_RETURNS || undefined,
    SHOPIFY_SELLER_INFO_RETRY_DELAY_MS: parsePositiveInteger(
      process.env.SHOPIFY_SELLER_INFO_RETRY_DELAY_MS,
      defaultRetryDelayMs,
    ),
    SHOPIFY_ORDERS_CREATE_EXECUTOR_ENABLED: ordersCreateExecutorEnabled,
    SHOPIFY_ORDERS_CREATE_ASYNC_ACK_ENABLED: ordersCreateAsyncAckEnabled,
    SHOPIFY_ORDERS_CREATE_EXECUTOR_INTERVAL_MS: parsePositiveInteger(
      process.env.SHOPIFY_ORDERS_CREATE_EXECUTOR_INTERVAL_MS,
      2_000,
    ),
    SHOPIFY_ORDERS_CREATE_EXECUTOR_BATCH_SIZE: parsePositiveInteger(
      process.env.SHOPIFY_ORDERS_CREATE_EXECUTOR_BATCH_SIZE,
      5,
    ),
    SHOPIFY_ORDERS_CREATE_LEASE_MS: ordersCreateExecutorLeaseMs,
    SHOPIFY_ORDERS_CREATE_HEARTBEAT_MS: ordersCreateExecutorHeartbeatMs,
    CUSTOMER_CANCELLATION_INTAKE_ENABLED: customerCancellationIntakeEnabled,
    CUSTOMER_CANCELLATION_AUTO_REFUND_ENABLED: parseBoolean(
      process.env.CUSTOMER_CANCELLATION_AUTO_REFUND_ENABLED,
      false,
    ),
    CUSTOMER_CANCELLATION_AUTO_REFUND_INTERVAL_MS: parsePositiveInteger(
      process.env.CUSTOMER_CANCELLATION_AUTO_REFUND_INTERVAL_MS,
      5_000,
    ),
    CUSTOMER_CANCELLATION_AUTO_REFUND_BATCH_SIZE: parsePositiveInteger(
      process.env.CUSTOMER_CANCELLATION_AUTO_REFUND_BATCH_SIZE,
      5,
    ),
    CUSTOMER_CANCELLATION_AUTO_REFUND_LEASE_MS: parsePositiveInteger(
      process.env.CUSTOMER_CANCELLATION_AUTO_REFUND_LEASE_MS,
      60_000,
    ),
    FULL_REFUND_TERMINAL_WRITER_ENABLED: parseBoolean(
      process.env.FULL_REFUND_TERMINAL_WRITER_ENABLED,
      false,
    ),
    FULL_REFUND_CURRENT_STATE_REPAIR_WRITE_ENABLED: parseBoolean(
      process.env.FULL_REFUND_CURRENT_STATE_REPAIR_WRITE_ENABLED,
      false,
    ),
    SHOPIFY_MISSED_ORDER_DISCOVERY_ENABLED: parseBoolean(
      process.env.SHOPIFY_MISSED_ORDER_DISCOVERY_ENABLED,
      false,
    ),
    SHOPIFY_MISSED_ORDER_DISCOVERY_INTERVAL_MS: parsePositiveInteger(
      process.env.SHOPIFY_MISSED_ORDER_DISCOVERY_INTERVAL_MS,
      15 * 60 * 1000,
    ),
    SHOPIFY_MISSED_ORDER_DISCOVERY_LOOKBACK_DAYS: parsePositiveInteger(
      process.env.SHOPIFY_MISSED_ORDER_DISCOVERY_LOOKBACK_DAYS,
      7,
    ),
    SHOPIFY_MISSED_ORDER_DISCOVERY_GRACE_PERIOD_MS: parsePositiveInteger(
      process.env.SHOPIFY_MISSED_ORDER_DISCOVERY_GRACE_PERIOD_MS,
      15 * 60 * 1000,
    ),
    SHOPIFY_MISSED_ORDER_DISCOVERY_MAX_ORDERS: parsePositiveInteger(
      process.env.SHOPIFY_MISSED_ORDER_DISCOVERY_MAX_ORDERS,
      1000,
    ),
    SHOPIFY_MOCK_FULFILLMENT_ORDERS: process.env.SHOPIFY_MOCK_FULFILLMENT_ORDERS || undefined,
    SHOPIFY_MOCK_FULFILLMENT_FAIL_ALLOCATION_IDS:
      process.env.SHOPIFY_MOCK_FULFILLMENT_FAIL_ALLOCATION_IDS || undefined,
    PRODUCT_PANEL_BASE_URL: process.env.PRODUCT_PANEL_BASE_URL?.trim() || undefined,
    PRODUCT_PANEL_VARIANT_DISABLE_ENABLED: parseBoolean(
      process.env.PRODUCT_PANEL_VARIANT_DISABLE_ENABLED,
      false,
    ),
    PRODUCT_PANEL_VARIANT_DISABLE_DRY_RUN: parseBoolean(
      process.env.PRODUCT_PANEL_VARIANT_DISABLE_DRY_RUN,
      true,
    ),
    PRODUCT_PANEL_HMAC_SECRET: process.env.PRODUCT_PANEL_HMAC_SECRET?.trim() || undefined,
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
    CANONICAL_RECONCILIATION_ENABLED: parseBoolean(
      process.env.CANONICAL_RECONCILIATION_ENABLED,
      nodeEnv !== 'test',
    ),
    CANONICAL_RECONCILIATION_MODE: parseCanonicalReconciliationMode(process.env.CANONICAL_RECONCILIATION_MODE),
    CANONICAL_RECONCILIATION_SCHEDULE_HOUR: parseIntegerInRange(
      process.env.CANONICAL_RECONCILIATION_SCHEDULE_HOUR,
      3,
      {
        min: 0,
        max: 23,
        name: 'CANONICAL_RECONCILIATION_SCHEDULE_HOUR',
      },
    ),
    CANONICAL_RECONCILIATION_LOOKBACK_DAYS: parsePositiveInteger(
      process.env.CANONICAL_RECONCILIATION_LOOKBACK_DAYS,
      3,
    ),
    CANONICAL_RECONCILIATION_ORDER_LIMIT: parsePositiveInteger(
      process.env.CANONICAL_RECONCILIATION_ORDER_LIMIT,
      500,
    ),
    SETTLEMENT_AUTO_DRAFT_JOB_ENABLED: parseBoolean(process.env.SETTLEMENT_AUTO_DRAFT_JOB_ENABLED, false),
    SETTLEMENT_AUTO_DRAFT_JOB_DRY_RUN: parseBoolean(process.env.SETTLEMENT_AUTO_DRAFT_JOB_DRY_RUN, true),
    SETTLEMENT_AUTO_DRAFT_SCHEDULER_ENABLED: parseBoolean(process.env.SETTLEMENT_AUTO_DRAFT_SCHEDULER_ENABLED, false),
    APPROVED_RETURN_AUTO_CANCEL_ENABLED: parseBoolean(process.env.APPROVED_RETURN_AUTO_CANCEL_ENABLED, false),
    APPROVED_RETURN_AUTO_CANCEL_DAYS: parsePositiveInteger(process.env.APPROVED_RETURN_AUTO_CANCEL_DAYS, 14),
    APPROVED_RETURN_AUTO_CANCEL_INTERVAL_MS: parsePositiveInteger(
      process.env.APPROVED_RETURN_AUTO_CANCEL_INTERVAL_MS,
      24 * 60 * 60 * 1000,
    ),
    APPROVED_RETURN_AUTO_CANCEL_LIMIT: parsePositiveInteger(process.env.APPROVED_RETURN_AUTO_CANCEL_LIMIT, 25),
    EMAIL_NOTIFICATIONS_ENABLED: parseBoolean(process.env.EMAIL_NOTIFICATIONS_ENABLED, false),
    EMAIL_PROVIDER: parseEmailProvider(process.env.EMAIL_PROVIDER),
    EMAIL_FROM: process.env.EMAIL_FROM || undefined,
    EMAIL_ADMIN_RECIPIENTS: parseCommaList(process.env.EMAIL_ADMIN_RECIPIENTS),
    SHIPPING_EXECUTION_ENABLED: parseBoolean(process.env.SHIPPING_EXECUTION_ENABLED, false),
    SHIPPING_SANDBOX_MODE: parseBoolean(process.env.SHIPPING_SANDBOX_MODE, false),
    SHIPPING_PROVIDER: shippingProvider,
    KARGONOMI_BASE_URL: kargonomiBaseUrl,
    KARGONOMI_API_TOKEN: kargonomiApiToken,
    KARGONOMI_APP_KEY: process.env.KARGONOMI_APP_KEY || undefined,
    KARGONOMI_DEFAULT_WAREHOUSE_ID: kargonomiDefaultWarehouseId,
    KARGONOMI_ACCOUNT_TAX_NUMBER: kargonomiAccountTaxNumber,
    IYZICO_SANDBOX_API_KEY: iyzicoSandboxApiKey,
    IYZICO_SANDBOX_SECRET_KEY: iyzicoSandboxSecretKey,
    IYZICO_SANDBOX_BASE_URL: iyzicoSandboxBaseUrl,
    LOGO_ISBASI_BASE_URL: logoIsbasiBaseUrl,
    LOGO_ISBASI_API_KEY: logoIsbasiApiKey,
    LOGO_ISBASI_USERNAME: logoIsbasiUsername,
    LOGO_ISBASI_PASSWORD: logoIsbasiPassword,
    LOGO_ISBASI_CREATE_ENABLED: logoIsbasiCreateEnabled,
    LOGO_ISBASI_CREATE_ENVIRONMENT: logoIsbasiCreateEnvironment,
    LOGO_ISBASI_EXPECTED_TENANT_ID: logoIsbasiExpectedTenantId,
    SOPYO_CREDENTIAL_ENCRYPTION_KEY: process.env.SOPYO_CREDENTIAL_ENCRYPTION_KEY || undefined,
    SOPYO_DELIVERY_POLLING_ENABLED: parseBoolean(process.env.SOPYO_DELIVERY_POLLING_ENABLED, false),
    SOPYO_ORDER_PUSH_WORKER_ENABLED: sopyoOrderPushWorkerEnabled,
    SOPYO_ORDER_PUSH_WORKER_INTERVAL_MS: sopyoOrderPushWorkerIntervalMs,
    SOPYO_ORDER_PUSH_WORKER_BATCH_SIZE: sopyoOrderPushWorkerBatchSize,
  } as AppEnv;
}
