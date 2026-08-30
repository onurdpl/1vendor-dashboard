import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadEnv } from '../backend/src/config/env.js';
import {
  buildDatabaseSourceDiagnostics,
  buildFinanceAuditRuntimeMetadata,
  DATABASE_URL_DUPLICATE_WARNING,
} from '../backend/src/config/database-source-diagnostics.js';

const originalEnv = { ...process.env };

function resetEnv(overrides: Record<string, string | undefined>) {
  process.env = {
    ...originalEnv,
    NODE_ENV: 'test',
    JWT_SECRET: 'test',
    SHOPIFY_WEBHOOK_SECRET: 'test',
    SHIPPING_PROVIDER: 'kargonomi',
    KARGONOMI_BASE_URL: 'https://app.kargonomi.com.tr/api/v1',
    KARGONOMI_API_TOKEN: 'configured-token',
    LIDIO_ENABLED: undefined,
    LIDIO_BASE_URL: undefined,
    LIDIO_MERCHANT_CODE: undefined,
    LIDIO_AUTHORIZATION_SCHEME: undefined,
    LIDIO_AUTHORIZATION_TOKEN: undefined,
    LIDIO_MERCHANT_KEY: undefined,
    LIDIO_API_PASSWORD: undefined,
    LIDIO_SUBSELLER_PROFILE_ID: undefined,
    ...overrides,
  };
}

describe('backend env shipping provider gates', () => {
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('keeps Try OTO passive while preserving its stored env values', () => {
    resetEnv({
      SHIPPING_PROVIDER: 'kargonomi',
      SHIPPING_EXECUTION_ENABLED: 'true',
      KARGONOMI_BASE_URL: 'https://app.kargonomi.com.tr/api/v1',
      KARGONOMI_API_TOKEN: 'configured-token',
      TRY_OTO_ENABLED: 'true',
      TRY_OTO_BASE_URL: 'https://staging-api.tryoto.com',
      TRY_OTO_REFRESH_TOKEN: 'configured-refresh-token',
      TRY_OTO_SANDBOX_MODE: 'true',
      TRY_OTO_WEBHOOK_INGEST_ENABLED: 'true',
    });

    const env = loadEnv();

    expect(env.SHIPPING_PROVIDER).toBe('kargonomi');
    expect(env.SHIPPING_EXECUTION_ENABLED).toBe(true);
    expect(env.TRY_OTO_ENABLED).toBe(true);
    expect(env.TRY_OTO_BASE_URL).toBe('https://staging-api.tryoto.com');
    expect(env.TRY_OTO_REFRESH_TOKEN).toBe('configured-refresh-token');
    expect(env.TRY_OTO_SANDBOX_MODE).toBe(true);
    expect(env.TRY_OTO_WEBHOOK_INGEST_ENABLED).toBe(false);
  });

  it('does not require Try OTO webhook secret in production when legacy ingest env is set', () => {
    resetEnv({
      NODE_ENV: 'production',
      CORS_ORIGIN: 'https://onevendor-dashboard.onrender.com',
      SHOPIFY_SHOP_DOMAIN: 'sporgym-test.myshopify.com',
      SHOPIFY_ADMIN_ACCESS_TOKEN: 'configured-admin-token',
      SHIPPING_PROVIDER: 'kargonomi',
      KARGONOMI_BASE_URL: 'https://app.kargonomi.com.tr/api/v1',
      KARGONOMI_API_TOKEN: 'configured-token',
      TRY_OTO_ENABLED: 'true',
      TRY_OTO_WEBHOOK_INGEST_ENABLED: 'true',
      TRY_OTO_WEBHOOK_SHARED_SECRET: undefined,
    });

    const env = loadEnv();

    expect(env.SHIPPING_PROVIDER).toBe('kargonomi');
    expect(env.TRY_OTO_WEBHOOK_INGEST_ENABLED).toBe(false);
    expect(env.TRY_OTO_WEBHOOK_SHARED_SECRET).toBeUndefined();
  });

  it('ignores short Try OTO webhook secrets because ingest is passive', () => {
    resetEnv({
      NODE_ENV: 'production',
      CORS_ORIGIN: 'https://onevendor-dashboard.onrender.com',
      SHOPIFY_SHOP_DOMAIN: 'sporgym-test.myshopify.com',
      SHOPIFY_ADMIN_ACCESS_TOKEN: 'configured-admin-token',
      SHIPPING_PROVIDER: 'kargonomi',
      KARGONOMI_BASE_URL: 'https://app.kargonomi.com.tr/api/v1',
      KARGONOMI_API_TOKEN: 'configured-token',
      TRY_OTO_ENABLED: 'true',
      TRY_OTO_WEBHOOK_INGEST_ENABLED: 'true',
      TRY_OTO_WEBHOOK_SHARED_SECRET: 'short-secret',
    });

    const env = loadEnv();

    expect(env.TRY_OTO_WEBHOOK_INGEST_ENABLED).toBe(false);
    expect(env.TRY_OTO_WEBHOOK_SHARED_SECRET).toBe('short-secret');
  });

  it('parses Kargonomi env values without requiring X-App-Key', () => {
    resetEnv({
      SHIPPING_PROVIDER: 'kargonomi',
      KARGONOMI_BASE_URL: 'https://app.kargonomi.com.tr/api/v1',
      KARGONOMI_API_TOKEN: 'configured-token',
      KARGONOMI_DEFAULT_WAREHOUSE_ID: '112668',
      KARGONOMI_ACCOUNT_TAX_NUMBER: 'test-account-tax-number',
      KARGONOMI_APP_KEY: undefined,
    });

    const env = loadEnv();

    expect(env.SHIPPING_PROVIDER).toBe('kargonomi');
    expect(env.KARGONOMI_BASE_URL).toBe('https://app.kargonomi.com.tr/api/v1');
    expect(env.KARGONOMI_API_TOKEN).toBe('configured-token');
    expect(env.KARGONOMI_DEFAULT_WAREHOUSE_ID).toBe('112668');
    expect(env.KARGONOMI_ACCOUNT_TAX_NUMBER).toBe('test-account-tax-number');
    expect(env.KARGONOMI_APP_KEY).toBeUndefined();
  });

  it('parses Product Panel variant disable dry-run feature flags safely disabled by default', () => {
    resetEnv({
      PRODUCT_PANEL_BASE_URL: 'https://product-panel.example',
      PRODUCT_PANEL_VARIANT_DISABLE_ENABLED: undefined,
      PRODUCT_PANEL_VARIANT_DISABLE_DRY_RUN: undefined,
      PRODUCT_PANEL_HMAC_SECRET: 'configured-product-panel-secret',
    });

    const env = loadEnv();

    expect(env.PRODUCT_PANEL_BASE_URL).toBe('https://product-panel.example');
    expect(env.PRODUCT_PANEL_VARIANT_DISABLE_ENABLED).toBe(false);
    expect(env.PRODUCT_PANEL_VARIANT_DISABLE_DRY_RUN).toBe(true);
    expect(env.PRODUCT_PANEL_HMAC_SECRET).toBe('configured-product-panel-secret');
  });

  it('parses Navlungo env values without switching provider by default', () => {
    resetEnv({
      SHIPPING_PROVIDER: 'kargonomi',
      KARGONOMI_BASE_URL: 'https://app.kargonomi.com.tr/api/v1',
      KARGONOMI_API_TOKEN: 'configured-token',
      NAVLUNGO_BASE_URL: 'https://domestic-api.navlungo.com/v2',
      NAVLUNGO_API_USERNAME: 'api-user',
      NAVLUNGO_API_PASSWORD: 'secret-password',
      NAVLUNGO_DEFAULT_SENDER_ADDRESS_ID: '55574',
      NAVLUNGO_RETURN_RECIPIENT_ADDRESS_ID: '77701',
      NAVLUNGO_DEFAULT_BARCODE_FORMAT: 'pdf-A6',
      NAVLUNGO_DEFAULT_CARRIER_ID: '9',
    });

    const env = loadEnv();

    expect(env.SHIPPING_PROVIDER).toBe('kargonomi');
    expect(env.NAVLUNGO_BASE_URL).toBe('https://domestic-api.navlungo.com/v2');
    expect(env.NAVLUNGO_API_USERNAME).toBe('api-user');
    expect(env.NAVLUNGO_API_PASSWORD).toBe('secret-password');
    expect(env.NAVLUNGO_DEFAULT_SENDER_ADDRESS_ID).toBe('55574');
    expect(env.NAVLUNGO_RETURN_RECIPIENT_ADDRESS_ID).toBe('77701');
    expect(env.NAVLUNGO_DEFAULT_BARCODE_FORMAT).toBe('pdf-A6');
    expect(env.NAVLUNGO_DEFAULT_CARRIER_ID).toBe('9');
  });

  it('rejects Navlungo as a live SHIPPING_PROVIDER even with credentials', () => {
    resetEnv({
      SHIPPING_PROVIDER: 'navlungo',
      NAVLUNGO_BASE_URL: 'https://domestic-api.navlungo.com/v2',
      NAVLUNGO_API_USERNAME: 'api-user',
      NAVLUNGO_API_PASSWORD: 'secret-password',
    });

    expect(() => loadEnv()).toThrow('SHIPPING_PROVIDER=navlungo is inactive. Only kargonomi is active.');
  });

  it('rejects Try OTO as a live SHIPPING_PROVIDER', () => {
    resetEnv({
      SHIPPING_PROVIDER: 'try_oto',
      TRY_OTO_ENABLED: 'true',
      TRY_OTO_BASE_URL: 'https://staging-api.tryoto.com',
      TRY_OTO_REFRESH_TOKEN: 'configured-refresh-token',
    });

    expect(() => loadEnv()).toThrow('SHIPPING_PROVIDER=try_oto is inactive. Only kargonomi is active.');
  });

  it('rejects Navlungo provider selection before checking credentials', () => {
    resetEnv({
      SHIPPING_PROVIDER: 'navlungo',
      NAVLUNGO_BASE_URL: 'https://domestic-api.navlungo.com/v2',
      NAVLUNGO_API_USERNAME: 'api-user',
      NAVLUNGO_API_PASSWORD: undefined,
    });

    expect(() => loadEnv()).toThrow('SHIPPING_PROVIDER=navlungo is inactive. Only kargonomi is active.');
  });

  it('rejects Kargonomi provider selection when the API token is missing', () => {
    resetEnv({
      SHIPPING_PROVIDER: 'kargonomi',
      KARGONOMI_BASE_URL: 'https://app.kargonomi.com.tr/api/v1',
      KARGONOMI_API_TOKEN: undefined,
    });

    expect(() => loadEnv()).toThrow('KARGONOMI_API_TOKEN is required when SHIPPING_PROVIDER=kargonomi.');
  });
});

describe('orders/create executor environment', () => {
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('is disabled by default with conservative runtime settings', () => {
    resetEnv({
      SHOPIFY_ORDERS_CREATE_EXECUTOR_ENABLED: undefined,
      SHOPIFY_ORDERS_CREATE_ASYNC_ACK_ENABLED: undefined,
      SHOPIFY_ORDERS_CREATE_EXECUTOR_INTERVAL_MS: undefined,
      SHOPIFY_ORDERS_CREATE_EXECUTOR_BATCH_SIZE: undefined,
      SHOPIFY_ORDERS_CREATE_LEASE_MS: undefined,
      SHOPIFY_ORDERS_CREATE_HEARTBEAT_MS: undefined,
    });

    expect(loadEnv()).toMatchObject({
      SHOPIFY_ORDERS_CREATE_EXECUTOR_ENABLED: false,
      SHOPIFY_ORDERS_CREATE_ASYNC_ACK_ENABLED: false,
      SHOPIFY_ORDERS_CREATE_EXECUTOR_INTERVAL_MS: 2_000,
      SHOPIFY_ORDERS_CREATE_EXECUTOR_BATCH_SIZE: 5,
      SHOPIFY_ORDERS_CREATE_LEASE_MS: 60_000,
      SHOPIFY_ORDERS_CREATE_HEARTBEAT_MS: 10_000,
    });
  });

  it('parses enabled positive executor settings', () => {
    resetEnv({
      SHOPIFY_ORDERS_CREATE_EXECUTOR_ENABLED: 'true',
      SHOPIFY_ORDERS_CREATE_EXECUTOR_INTERVAL_MS: '3000',
      SHOPIFY_ORDERS_CREATE_EXECUTOR_BATCH_SIZE: '7',
      SHOPIFY_ORDERS_CREATE_LEASE_MS: '90000',
      SHOPIFY_ORDERS_CREATE_HEARTBEAT_MS: '15000',
    });

    expect(loadEnv()).toMatchObject({
      SHOPIFY_ORDERS_CREATE_EXECUTOR_ENABLED: true,
      SHOPIFY_ORDERS_CREATE_ASYNC_ACK_ENABLED: false,
      SHOPIFY_ORDERS_CREATE_EXECUTOR_INTERVAL_MS: 3_000,
      SHOPIFY_ORDERS_CREATE_EXECUTOR_BATCH_SIZE: 7,
      SHOPIFY_ORDERS_CREATE_LEASE_MS: 90_000,
      SHOPIFY_ORDERS_CREATE_HEARTBEAT_MS: 15_000,
    });
  });

  it('keeps production-like executor deployments synchronous when the new flag is absent', () => {
    resetEnv({
      SHOPIFY_ORDERS_CREATE_EXECUTOR_ENABLED: 'true',
      SHOPIFY_ORDERS_CREATE_ASYNC_ACK_ENABLED: undefined,
    });
    expect(loadEnv()).toMatchObject({
      SHOPIFY_ORDERS_CREATE_EXECUTOR_ENABLED: true,
      SHOPIFY_ORDERS_CREATE_ASYNC_ACK_ENABLED: false,
    });
  });

  it('permits fast acknowledgement only when the executor is enabled', () => {
    resetEnv({
      SHOPIFY_ORDERS_CREATE_EXECUTOR_ENABLED: 'true',
      SHOPIFY_ORDERS_CREATE_ASYNC_ACK_ENABLED: 'true',
    });
    expect(loadEnv()).toMatchObject({
      SHOPIFY_ORDERS_CREATE_EXECUTOR_ENABLED: true,
      SHOPIFY_ORDERS_CREATE_ASYNC_ACK_ENABLED: true,
    });

    resetEnv({
      SHOPIFY_ORDERS_CREATE_EXECUTOR_ENABLED: 'false',
      SHOPIFY_ORDERS_CREATE_ASYNC_ACK_ENABLED: 'true',
    });
    expect(() => loadEnv()).toThrow(
      'SHOPIFY_ORDERS_CREATE_ASYNC_ACK_ENABLED requires SHOPIFY_ORDERS_CREATE_EXECUTOR_ENABLED=true.',
    );
  });

  it.each([
    ['SHOPIFY_ORDERS_CREATE_EXECUTOR_INTERVAL_MS', '0'],
    ['SHOPIFY_ORDERS_CREATE_EXECUTOR_BATCH_SIZE', '0'],
    ['SHOPIFY_ORDERS_CREATE_LEASE_MS', '-1'],
    ['SHOPIFY_ORDERS_CREATE_HEARTBEAT_MS', '0'],
  ])('rejects non-positive %s', (name, value) => {
    resetEnv({ [name]: value });
    expect(() => loadEnv()).toThrow();
  });

  it('rejects a heartbeat that is not materially shorter than its lease', () => {
    resetEnv({
      SHOPIFY_ORDERS_CREATE_LEASE_MS: '60000',
      SHOPIFY_ORDERS_CREATE_HEARTBEAT_MS: '30000',
    });

    expect(() => loadEnv()).toThrow(
      'SHOPIFY_ORDERS_CREATE_HEARTBEAT_MS must be materially shorter than SHOPIFY_ORDERS_CREATE_LEASE_MS.',
    );
  });
});

describe('customer cancellation environment', () => {
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('is disabled by default with bounded executor settings', () => {
    resetEnv({
      CUSTOMER_CANCELLATION_INTAKE_ENABLED: undefined,
      CUSTOMER_CANCELLATION_AUTO_REFUND_ENABLED: undefined,
      CUSTOMER_CANCELLATION_AUTO_REFUND_INTERVAL_MS: undefined,
      CUSTOMER_CANCELLATION_AUTO_REFUND_BATCH_SIZE: undefined,
      CUSTOMER_CANCELLATION_AUTO_REFUND_LEASE_MS: undefined,
    });
    expect(loadEnv()).toMatchObject({
      CUSTOMER_CANCELLATION_INTAKE_ENABLED: false,
      CUSTOMER_CANCELLATION_AUTO_REFUND_ENABLED: false,
      CUSTOMER_CANCELLATION_AUTO_REFUND_INTERVAL_MS: 5_000,
      CUSTOMER_CANCELLATION_AUTO_REFUND_BATCH_SIZE: 5,
      CUSTOMER_CANCELLATION_AUTO_REFUND_LEASE_MS: 60_000,
    });
  });

  it('parses intake independently from auto-refund', () => {
    resetEnv({
      CUSTOMER_CANCELLATION_INTAKE_ENABLED: 'true',
      CUSTOMER_CANCELLATION_AUTO_REFUND_ENABLED: 'false',
    });
    expect(loadEnv()).toMatchObject({
      CUSTOMER_CANCELLATION_INTAKE_ENABLED: true,
      CUSTOMER_CANCELLATION_AUTO_REFUND_ENABLED: false,
    });
  });
});

describe('backend env Lidio configuration', () => {
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('exposes Lidio configuration with documented defaults', () => {
    resetEnv({
      LIDIO_ENABLED: 'true',
      LIDIO_BASE_URL: 'https://test.lidio.com/api',
      LIDIO_MERCHANT_CODE: 'SPORGYM',
      LIDIO_AUTHORIZATION_SCHEME: undefined,
      LIDIO_AUTHORIZATION_TOKEN: 'configured-token',
      LIDIO_MERCHANT_KEY: '',
      LIDIO_API_PASSWORD: '',
      LIDIO_SUBSELLER_PROFILE_ID: undefined,
    });

    const env = loadEnv();

    expect(env.LIDIO_ENABLED).toBe(true);
    expect(env.LIDIO_BASE_URL).toBe('https://test.lidio.com/api');
    expect(env.LIDIO_MERCHANT_CODE).toBe('SPORGYM');
    expect(env.LIDIO_AUTHORIZATION_SCHEME).toBe('MxS2S');
    expect(env.LIDIO_AUTHORIZATION_TOKEN).toBe('configured-token');
    expect(env.LIDIO_MERCHANT_KEY).toBeUndefined();
    expect(env.LIDIO_API_PASSWORD).toBeUndefined();
    expect(env.LIDIO_SUBSELLER_PROFILE_ID).toBe(3);
  });

  it('requires only base URL, merchant code, and authorization token when Lidio is enabled', () => {
    resetEnv({
      LIDIO_ENABLED: 'true',
      LIDIO_BASE_URL: 'https://test.lidio.com/api',
      LIDIO_MERCHANT_CODE: 'SPORGYM',
      LIDIO_AUTHORIZATION_TOKEN: undefined,
      LIDIO_MERCHANT_KEY: undefined,
      LIDIO_API_PASSWORD: undefined,
      LIDIO_SUBSELLER_PROFILE_ID: undefined,
    });

    expect(() => loadEnv()).toThrow(
      'Missing required Lidio env vars when LIDIO_ENABLED=true: LIDIO_AUTHORIZATION_TOKEN.',
    );
  });
});

describe('database source diagnostics', () => {
  it('reports database host and database name without exposing credentials', () => {
    const diagnostics = buildDatabaseSourceDiagnostics({
      databaseUrl: 'postgresql://finance_user:secret-password@db.example.internal:5432/vendor_dashboard',
      envSourceFiles: [],
    });

    expect(diagnostics).toMatchObject({
      databaseHost: 'db.example.internal',
      databaseName: 'vendor_dashboard',
      databaseSourceLabel: 'remote',
      duplicateDatabaseUrlDefinitionsDetected: false,
    });
    expect(JSON.stringify(diagnostics)).not.toContain('finance_user');
    expect(JSON.stringify(diagnostics)).not.toContain('secret-password');
    expect(JSON.stringify(diagnostics)).not.toContain('postgresql://');
  });

  it('flags duplicate DATABASE_URL definitions in configured env sources', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sporgym-db-source-'));
    fs.writeFileSync(
      path.join(tempDir, '.env'),
      [
        'DATABASE_URL=postgresql://postgres:postgres@localhost:5432/vendor_dashboard_dev',
        'DATABASE_URL=postgresql://remote_user:secret@db.example.internal:5432/vendor_dashboard',
      ].join('\n'),
    );
    const diagnostics = buildDatabaseSourceDiagnostics({
      databaseUrl: 'postgresql://postgres:postgres@localhost:5432/vendor_dashboard_dev',
      cwd: tempDir,
      envSourceFiles: ['.env'],
    });

    try {
      expect(diagnostics.duplicateDatabaseUrlDefinitionsDetected).toBe(true);
      expect(diagnostics.databaseUrlDefinitionCount).toBe(2);
      expect(diagnostics.warnings).toContain(DATABASE_URL_DUPLICATE_WARNING);
      expect(diagnostics.databaseUrlDefinitions.every((entry) => entry.source === '.env')).toBe(true);
      expect(JSON.stringify(diagnostics)).not.toContain('remote_user');
      expect(JSON.stringify(diagnostics)).not.toContain('secret');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('builds finance audit runtime metadata with the same duplicate warning', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sporgym-finance-audit-'));
    fs.writeFileSync(
      path.join(tempDir, '.env'),
      [
        'DATABASE_URL=postgresql://postgres:postgres@localhost:5432/vendor_dashboard_dev',
        'DATABASE_URL=postgresql://remote_user:secret@db.example.internal:5432/vendor_dashboard',
      ].join('\n'),
    );
    const metadata = buildFinanceAuditRuntimeMetadata({
      environment: 'development',
      databaseUrl: 'postgresql://postgres:postgres@localhost:5432/vendor_dashboard_dev',
      schemaReady: true,
      cwd: tempDir,
      envSourceFiles: ['.env'],
    });

    try {
      expect(metadata).toEqual(
        expect.objectContaining({
          environment: 'development',
          databaseHost: 'localhost',
          databaseName: 'vendor_dashboard_dev',
          databaseSourceLabel: 'local',
          schemaReady: true,
        }),
      );
      expect(metadata.warnings).toContain(DATABASE_URL_DUPLICATE_WARNING);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
