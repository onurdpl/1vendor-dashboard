import { afterEach, describe, expect, it } from 'vitest';
import { loadEnv } from '../backend/src/config/env.js';

const originalEnv = { ...process.env };

function resetEnv(overrides: Record<string, string | undefined>) {
  process.env = {
    ...originalEnv,
    NODE_ENV: 'test',
    JWT_SECRET: 'test',
    SHOPIFY_WEBHOOK_SECRET: 'test',
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

  it('parses Kargo Entegratör provider gate independently from the global shipping gate', () => {
    resetEnv({
      SHIPPING_PROVIDER: 'kargo_entegrator',
      SHIPPING_EXECUTION_ENABLED: undefined,
      KARGO_ENTEGRATOR_ENABLED: 'true',
      KARGO_ENTEGRATOR_BASE_URL: 'https://app.kargoentegrator.com/api',
      KARGO_ENTEGRATOR_API_KEY: 'configured',
    });

    const env = loadEnv();

    expect(env.SHIPPING_PROVIDER).toBe('kargo_entegrator');
    expect(env.SHIPPING_EXECUTION_ENABLED).toBe(false);
    expect(env.SHIPPING_SANDBOX_MODE).toBe(false);
    expect(env.KARGO_ENTEGRATOR_ENABLED).toBe(true);
    expect(env.KARGO_ENTEGRATOR_WEBHOOK_INGEST_ENABLED).toBe(false);
    expect(env.KARGO_ENTEGRATOR_BASE_URL).toBe('https://app.kargoentegrator.com/api');
    expect(env.KARGO_ENTEGRATOR_API_KEY).toBe('configured');
  });

  it('reads Paratika SESSIONTOKEN probe env config', () => {
    resetEnv({
      PARATIKA_API_URL: 'https://test.paratika.example/api',
      PARATIKA_MERCHANT: 'merchant-id',
      PARATIKA_MERCHANTUSER: 'merchant-user',
      PARATIKA_MERCHANTPASSWORD: 'merchant-password',
      PARATIKA_RETURN_URL: 'https://onevendor-dashboard.onrender.com/payments/paratika/return',
      PARATIKA_TEST_MODE: 'true',
      PARATIKA_PROBE_DRY_RUN: 'false',
      PARATIKA_PROBE_CONFIRM: 'CREATE_SESSIONTOKEN_TEST',
    });

    const env = loadEnv();

    expect(env.PARATIKA_API_URL).toBe('https://test.paratika.example/api');
    expect(env.PARATIKA_MERCHANT).toBe('merchant-id');
    expect(env.PARATIKA_MERCHANTUSER).toBe('merchant-user');
    expect(env.PARATIKA_MERCHANTPASSWORD).toBe('merchant-password');
    expect(env.PARATIKA_RETURN_URL).toBe('https://onevendor-dashboard.onrender.com/payments/paratika/return');
    expect(env.PARATIKA_TEST_MODE).toBe(true);
    expect(env.PARATIKA_PROBE_DRY_RUN).toBe(false);
    expect(env.PARATIKA_PROBE_CONFIRM).toBe('CREATE_SESSIONTOKEN_TEST');
  });

  it('enables live Kargo execution only when the global and provider gates are both true', () => {
    resetEnv({
      SHIPPING_PROVIDER: 'kargo_entegrator',
      SHIPPING_EXECUTION_ENABLED: 'true',
      KARGO_ENTEGRATOR_ENABLED: 'true',
      KARGO_ENTEGRATOR_BASE_URL: 'https://app.kargoentegrator.com/api',
      KARGO_ENTEGRATOR_API_KEY: 'configured',
    });

    const env = loadEnv();

    expect(env.SHIPPING_EXECUTION_ENABLED).toBe(true);
    expect(env.KARGO_ENTEGRATOR_ENABLED).toBe(true);
  });

  it('reads the correct Kargo cargo integration env var', () => {
    resetEnv({
      KARGO_ENTEGRATOR_CARGO_INTEGRATION_ID: '2547',
      ARGO_ENTEGRATOR_CARGO_INTEGRATION_ID: undefined,
    });

    const env = loadEnv();

    expect(env.KARGO_ENTEGRATOR_CARGO_INTEGRATION_ID).toBe('2547');
    expect(env.KARGO_ENTEGRATOR_CARGO_INTEGRATION_ID_SOURCE).toBe('primary');
  });

  it('falls back to the deprecated ARGO cargo integration env var', () => {
    resetEnv({
      KARGO_ENTEGRATOR_CARGO_INTEGRATION_ID: undefined,
      ARGO_ENTEGRATOR_CARGO_INTEGRATION_ID: '2547',
    });

    const env = loadEnv();

    expect(env.KARGO_ENTEGRATOR_CARGO_INTEGRATION_ID).toBe('2547');
    expect(env.KARGO_ENTEGRATOR_CARGO_INTEGRATION_ID_SOURCE).toBe('deprecated');
  });

  it('prefers the correct KARGO cargo integration env var when both are present', () => {
    resetEnv({
      KARGO_ENTEGRATOR_CARGO_INTEGRATION_ID: '2547',
      ARGO_ENTEGRATOR_CARGO_INTEGRATION_ID: 'wrong-fallback',
    });

    const env = loadEnv();

    expect(env.KARGO_ENTEGRATOR_CARGO_INTEGRATION_ID).toBe('2547');
    expect(env.KARGO_ENTEGRATOR_CARGO_INTEGRATION_ID_SOURCE).toBe('primary');
  });

  it('parses sandbox and Kargo webhook ingest gates as explicit test-mode controls', () => {
    resetEnv({
      SHIPPING_SANDBOX_MODE: 'true',
      KARGO_ENTEGRATOR_WEBHOOK_INGEST_ENABLED: 'true',
      KARGO_ENTEGRATOR_WEBHOOK_SHARED_SECRET: 'configured-kargo-webhook-secret-12345',
    });

    const env = loadEnv();

    expect(env.SHIPPING_SANDBOX_MODE).toBe(true);
    expect(env.KARGO_ENTEGRATOR_WEBHOOK_INGEST_ENABLED).toBe(true);
    expect(env.KARGO_ENTEGRATOR_WEBHOOK_SHARED_SECRET).toBe('configured-kargo-webhook-secret-12345');
  });

  it('rejects production Kargo webhook ingestion when shared secret is missing', () => {
    resetEnv({
      NODE_ENV: 'production',
      CORS_ORIGIN: 'https://onevendor-dashboard.onrender.com',
      SHOPIFY_SHOP_DOMAIN: 'sporgym-test.myshopify.com',
      SHOPIFY_ADMIN_ACCESS_TOKEN: 'configured-admin-token',
      KARGO_ENTEGRATOR_WEBHOOK_INGEST_ENABLED: 'true',
      KARGO_ENTEGRATOR_WEBHOOK_SHARED_SECRET: undefined,
    });

    expect(() => loadEnv()).toThrow(
      'KARGO_ENTEGRATOR_WEBHOOK_SHARED_SECRET is required in production when KARGO_ENTEGRATOR_WEBHOOK_INGEST_ENABLED=true.',
    );
  });

  it('rejects production Kargo webhook ingestion when shared secret is too short', () => {
    resetEnv({
      NODE_ENV: 'production',
      CORS_ORIGIN: 'https://onevendor-dashboard.onrender.com',
      SHOPIFY_SHOP_DOMAIN: 'sporgym-test.myshopify.com',
      SHOPIFY_ADMIN_ACCESS_TOKEN: 'configured-admin-token',
      KARGO_ENTEGRATOR_WEBHOOK_INGEST_ENABLED: 'true',
      KARGO_ENTEGRATOR_WEBHOOK_SHARED_SECRET: 'short-secret',
    });

    expect(() => loadEnv()).toThrow('KARGO_ENTEGRATOR_WEBHOOK_SHARED_SECRET must be at least 32 characters in production.');
  });

  it('parses Try OTO sandbox provider gates without enabling production rollout', () => {
    resetEnv({
      SHIPPING_PROVIDER: 'try_oto',
      SHIPPING_EXECUTION_ENABLED: 'true',
      TRY_OTO_ENABLED: 'true',
      TRY_OTO_BASE_URL: 'https://staging-api.tryoto.com',
      TRY_OTO_REFRESH_TOKEN: 'configured-refresh-token',
      TRY_OTO_SANDBOX_MODE: 'true',
      TRY_OTO_WEBHOOK_INGEST_ENABLED: 'true',
    });

    const env = loadEnv();

    expect(env.SHIPPING_PROVIDER).toBe('try_oto');
    expect(env.SHIPPING_EXECUTION_ENABLED).toBe(true);
    expect(env.TRY_OTO_ENABLED).toBe(true);
    expect(env.TRY_OTO_BASE_URL).toBe('https://staging-api.tryoto.com');
    expect(env.TRY_OTO_REFRESH_TOKEN).toBe('configured-refresh-token');
    expect(env.TRY_OTO_SANDBOX_MODE).toBe(true);
    expect(env.TRY_OTO_WEBHOOK_INGEST_ENABLED).toBe(true);
  });

  it('rejects production Try OTO webhook ingestion when shared secret is missing', () => {
    resetEnv({
      NODE_ENV: 'production',
      CORS_ORIGIN: 'https://onevendor-dashboard.onrender.com',
      SHOPIFY_SHOP_DOMAIN: 'sporgym-test.myshopify.com',
      SHOPIFY_ADMIN_ACCESS_TOKEN: 'configured-admin-token',
      TRY_OTO_ENABLED: 'true',
      TRY_OTO_WEBHOOK_INGEST_ENABLED: 'true',
      TRY_OTO_WEBHOOK_SHARED_SECRET: undefined,
    });

    expect(() => loadEnv()).toThrow(
      'TRY_OTO_WEBHOOK_SHARED_SECRET is required in production when TRY_OTO_WEBHOOK_INGEST_ENABLED=true.',
    );
  });

  it('rejects production Try OTO webhook ingestion when shared secret is too short', () => {
    resetEnv({
      NODE_ENV: 'production',
      CORS_ORIGIN: 'https://onevendor-dashboard.onrender.com',
      SHOPIFY_SHOP_DOMAIN: 'sporgym-test.myshopify.com',
      SHOPIFY_ADMIN_ACCESS_TOKEN: 'configured-admin-token',
      TRY_OTO_ENABLED: 'true',
      TRY_OTO_WEBHOOK_INGEST_ENABLED: 'true',
      TRY_OTO_WEBHOOK_SHARED_SECRET: 'short-secret',
    });

    expect(() => loadEnv()).toThrow('TRY_OTO_WEBHOOK_SHARED_SECRET must be at least 32 characters in production.');
  });

  it('parses Kargonomi env values without requiring X-App-Key', () => {
    resetEnv({
      SHIPPING_PROVIDER: 'kargonomi',
      KARGONOMI_BASE_URL: 'https://app.kargonomi.com.tr/api/v1',
      KARGONOMI_API_TOKEN: 'configured-token',
      KARGONOMI_DEFAULT_WAREHOUSE_ID: '112668',
      KARGONOMI_APP_KEY: undefined,
    });

    const env = loadEnv();

    expect(env.SHIPPING_PROVIDER).toBe('kargonomi');
    expect(env.KARGONOMI_BASE_URL).toBe('https://app.kargonomi.com.tr/api/v1');
    expect(env.KARGONOMI_API_TOKEN).toBe('configured-token');
    expect(env.KARGONOMI_DEFAULT_WAREHOUSE_ID).toBe('112668');
    expect(env.KARGONOMI_APP_KEY).toBeUndefined();
  });

  it('parses Navlungo env values without switching provider by default', () => {
    resetEnv({
      SHIPPING_PROVIDER: 'hepsijet',
      NAVLUNGO_BASE_URL: 'https://domestic-api.navlungo.com/v2',
      NAVLUNGO_API_USERNAME: 'api-user',
      NAVLUNGO_API_PASSWORD: 'secret-password',
      NAVLUNGO_DEFAULT_SENDER_ADDRESS_ID: '55574',
      NAVLUNGO_RETURN_RECIPIENT_ADDRESS_ID: '77701',
      NAVLUNGO_DEFAULT_BARCODE_FORMAT: 'pdf-A6',
      NAVLUNGO_DEFAULT_CARRIER_ID: '9',
    });

    const env = loadEnv();

    expect(env.SHIPPING_PROVIDER).toBe('hepsijet');
    expect(env.NAVLUNGO_BASE_URL).toBe('https://domestic-api.navlungo.com/v2');
    expect(env.NAVLUNGO_API_USERNAME).toBe('api-user');
    expect(env.NAVLUNGO_API_PASSWORD).toBe('secret-password');
    expect(env.NAVLUNGO_DEFAULT_SENDER_ADDRESS_ID).toBe('55574');
    expect(env.NAVLUNGO_RETURN_RECIPIENT_ADDRESS_ID).toBe('77701');
    expect(env.NAVLUNGO_DEFAULT_BARCODE_FORMAT).toBe('pdf-A6');
    expect(env.NAVLUNGO_DEFAULT_CARRIER_ID).toBe('9');
  });

  it('allows Navlungo as a live SHIPPING_PROVIDER with required credentials', () => {
    resetEnv({
      SHIPPING_PROVIDER: 'navlungo',
      NAVLUNGO_BASE_URL: 'https://domestic-api.navlungo.com/v2',
      NAVLUNGO_API_USERNAME: 'api-user',
      NAVLUNGO_API_PASSWORD: 'secret-password',
    });

    expect(loadEnv().SHIPPING_PROVIDER).toBe('navlungo');
  });

  it('rejects Navlungo provider selection when credentials are missing', () => {
    resetEnv({
      SHIPPING_PROVIDER: 'navlungo',
      NAVLUNGO_BASE_URL: 'https://domestic-api.navlungo.com/v2',
      NAVLUNGO_API_USERNAME: 'api-user',
      NAVLUNGO_API_PASSWORD: undefined,
    });

    expect(() => loadEnv()).toThrow('NAVLUNGO_API_PASSWORD is required when SHIPPING_PROVIDER=navlungo.');
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
