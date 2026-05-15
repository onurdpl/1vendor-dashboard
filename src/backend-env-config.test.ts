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
    expect(env.KARGO_ENTEGRATOR_ENABLED).toBe(true);
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
});
