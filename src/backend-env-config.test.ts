import { afterEach, describe, expect, it } from 'vitest';
import { loadEnv } from '../backend/src/config/env.js';

const originalEnv = { ...process.env };

function resetEnv(overrides: Record<string, string | undefined>) {
  process.env = {
    ...originalEnv,
    NODE_ENV: 'test',
    JWT_SECRET: 'test',
    SHOPIFY_WEBHOOK_SECRET: 'test',
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
    });

    const env = loadEnv();

    expect(env.SHIPPING_SANDBOX_MODE).toBe(true);
    expect(env.KARGO_ENTEGRATOR_WEBHOOK_INGEST_ENABLED).toBe(true);
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

  it('rejects Kargonomi provider selection when the API token is missing', () => {
    resetEnv({
      SHIPPING_PROVIDER: 'kargonomi',
      KARGONOMI_BASE_URL: 'https://app.kargonomi.com.tr/api/v1',
      KARGONOMI_API_TOKEN: undefined,
    });

    expect(() => loadEnv()).toThrow('KARGONOMI_API_TOKEN is required when SHIPPING_PROVIDER=kargonomi.');
  });
});
