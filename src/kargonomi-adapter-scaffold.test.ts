import { describe, expect, it } from 'vitest';
import type { AppEnv } from '../backend/src/config/env.js';
import { createShippingProviderAdapter } from '../backend/src/modules/shipping/shipping-provider.adapter.js';
import {
  getKargonomiConfigDiagnostics,
  KargonomiAdapter,
  KARGONOMI_ENV_NAMES,
  KARGONOMI_PROVIDER_DISPLAY_NAME,
  KARGONOMI_PROVIDER_KEY,
} from '../backend/src/modules/shipping/kargonomi-provider.adapter.js';

function buildEnv(overrides: Partial<AppEnv> = {}): AppEnv {
  return {
    NODE_ENV: 'test',
    PORT: 4000,
    DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:5432/vendor_dashboard_dev',
    CORS_ORIGIN: ['http://localhost:5173'],
    JWT_SECRET: 'test',
    JWT_EXPIRES_IN: '12h',
    SHOPIFY_WEBHOOK_SECRET: 'test',
    SHOPIFY_API_VERSION: '2026-01',
    SHOPIFY_SELLER_INFO_RETRY_DELAY_MS: 25,
    SCHEDULED_RECONCILIATION_ENABLED: false,
    SCHEDULED_RECONCILIATION_EXECUTE_DUE: false,
    SCHEDULED_RECONCILIATION_INTERVAL_MS: 1800000,
    SCHEDULED_RECONCILIATION_COOLDOWN_MS: 1800000,
    SCHEDULED_RECONCILIATION_CANDIDATE_LIMIT: 25,
    EMAIL_NOTIFICATIONS_ENABLED: false,
    EMAIL_PROVIDER: 'noop',
    EMAIL_ADMIN_RECIPIENTS: [],
    INVOICE_EXECUTION_ENABLED: false,
    INVOICE_PROVIDER: 'bizimhesap',
    BIZIMHESAP_ENABLED: false,
    SHIPPING_EXECUTION_ENABLED: false,
    SHIPPING_SANDBOX_MODE: false,
    SHIPPING_PROVIDER: 'hepsijet',
    KARGO_ENTEGRATOR_ENABLED: false,
    KARGO_ENTEGRATOR_WEBHOOK_INGEST_ENABLED: false,
    TRY_OTO_ENABLED: false,
    TRY_OTO_SANDBOX_MODE: false,
    TRY_OTO_WEBHOOK_INGEST_ENABLED: false,
    KARGONOMI_BASE_URL: 'https://app.kargonomi.com.tr/api/v1',
    KARGONOMI_API_TOKEN: 'test-token',
    KARGONOMI_APP_KEY: undefined,
    ...overrides,
  };
}

describe('Kargonomi dormant adapter scaffold', () => {
  it('exposes provider constants without enabling runtime execution', () => {
    expect(KARGONOMI_PROVIDER_KEY).toBe('kargonomi');
    expect(KARGONOMI_PROVIDER_DISPLAY_NAME).toBe('Kargonomi');
    expect(KARGONOMI_ENV_NAMES).toEqual({
      baseUrl: 'KARGONOMI_BASE_URL',
      apiToken: 'KARGONOMI_API_TOKEN',
      appKey: 'KARGONOMI_APP_KEY',
    });
  });

  it('can be constructed with test config and reports safe config diagnostics', () => {
    const adapter = new KargonomiAdapter(buildEnv());

    expect(adapter.provider).toBe('KARGONOMI');
    expect(adapter.getConfigDiagnostics()).toMatchObject({
      provider: 'kargonomi',
      displayName: 'Kargonomi',
      baseUrlConfigured: true,
      apiTokenConfigured: true,
      appKeyConfigured: false,
      appKeyRequirement: 'unknown',
      missing: [],
    });
  });

  it('detects missing token through scaffold diagnostics', () => {
    const diagnostics = getKargonomiConfigDiagnostics(
      buildEnv({
        KARGONOMI_API_TOKEN: undefined,
      }),
    );

    expect(diagnostics.apiTokenConfigured).toBe(false);
    expect(diagnostics.missing).toContain('KARGONOMI_API_TOKEN');
  });

  it('throws an explicit not implemented error for shipment execution', async () => {
    const adapter = new KargonomiAdapter(buildEnv());

    await expect(
      adapter.createShipment({
        allocationId: 'alloc-1',
        vendorId: 'vendor-1',
        provider: 'kargonomi',
        requestSnapshot: {},
      }),
    ).rejects.toThrow('Kargonomi adapter is not implemented yet.');
  });

  it('does not expose return or reverse shipment methods', () => {
    const adapter = new KargonomiAdapter(buildEnv());

    expect(adapter.createReturnShipment).toBeUndefined();
    expect(adapter.probeReturnDetails).toBeUndefined();
    expect(adapter.probeReturnLink).toBeUndefined();
    expect(adapter.probeReturnAwbPrint).toBeUndefined();
  });

  it('returns the dormant stub from the factory only when explicitly requested', () => {
    const adapter = createShippingProviderAdapter(buildEnv(), 'kargonomi');

    expect(adapter).toBeInstanceOf(KargonomiAdapter);
    expect(adapter.provider).toBe('KARGONOMI');
  });
});
