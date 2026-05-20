import { describe, expect, it } from 'vitest';
import type { AppEnv } from '../backend/src/config/env.js';
import { createShippingProviderAdapter } from '../backend/src/modules/shipping/shipping-provider.adapter.js';
import {
  getKargonomiConfigDiagnostics,
  KargonomiAdapter,
  buildKargonomiShipmentCreatePayload,
  KARGONOMI_ENV_NAMES,
  KARGONOMI_PROVIDER_DISPLAY_NAME,
  KARGONOMI_PROVIDER_KEY,
  mapKargonomiStatusToInternalStatus,
  parseKargonomiShipment,
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

  it('builds create payload with explicit sender fields', () => {
    const payload = buildKargonomiShipmentCreatePayload({
      sender: {
        sender_name: 'Test Sender',
        sender_email: 'sender@example.com',
        sender_tax_number: '1234567890',
        sender_tax_place: 'Test Place',
        sender_phone: '5555555555',
        sender_address: 'Test Sender Address',
        sender_state_id: '34',
        sender_city_id: '828',
      },
      buyer: {
        buyer_name: 'Test Buyer',
        buyer_email: 'buyer@example.com',
        buyer_phone: '5551112233',
        buyer_address: 'Test Buyer Address',
        buyer_state_id: '66',
        buyer_city_id: '662',
      },
      packages: [
        {
          content: 'Shoes',
          barcode: 'PKG-1',
          desi: '3',
        },
      ],
    });

    expect(payload).toEqual({
      shipment: {
        sender_name: 'Test Sender',
        sender_email: 'sender@example.com',
        sender_tax_number: '1234567890',
        sender_tax_place: 'Test Place',
        sender_phone: '5555555555',
        sender_address: 'Test Sender Address',
        sender_state_id: '34',
        sender_city_id: '828',
        buyer_name: 'Test Buyer',
        buyer_email: 'buyer@example.com',
        buyer_phone: '5551112233',
        buyer_address: 'Test Buyer Address',
        buyer_state_id: '66',
        buyer_city_id: '662',
        packages: [{ content: 'Shoes', barcode: 'PKG-1', desi: '3' }],
      },
    });
  });

  it('builds create payload with warehouse_id instead of sender fields', () => {
    const payload = buildKargonomiShipmentCreatePayload({
      warehouseId: 12707,
      sender: {
        sender_name: 'Ignored Sender',
      },
      buyer: {
        buyer_name: 'Test Buyer',
        buyer_phone: '5551112233',
        buyer_address: 'Test Buyer Address',
        buyer_state_id: 34,
        buyer_city_id: 828,
      },
      packages: [
        {
          desi: 2,
        },
      ],
    });

    expect(payload.shipment).toMatchObject({
      warehouse_id: 12707,
      buyer_name: 'Test Buyer',
      buyer_phone: '5551112233',
      buyer_address: 'Test Buyer Address',
      buyer_state_id: 34,
      buyer_city_id: 828,
      packages: [{ desi: 2 }],
    });
    expect(payload.shipment).not.toHaveProperty('sender_name');
  });

  it('preserves package desi/content/barcode mapping', () => {
    const payload = buildKargonomiShipmentCreatePayload({
      warehouseId: '12707',
      buyer: {
        buyer_name: 'Test Buyer',
        buyer_phone: '5551112233',
        buyer_address: 'Test Buyer Address',
        buyer_state_id: '34',
        buyer_city_id: '828',
      },
      packages: [
        { content: 'First package', barcode: 'A-1', desi: '1.5' },
        { content: null, barcode: '', desi: 4 },
      ],
    });

    expect(payload.shipment.packages).toEqual([
      { content: 'First package', barcode: 'A-1', desi: '1.5' },
      { desi: 4 },
    ]);
  });

  it('parses shipment response with tracking, provider, pricing, and package fields', () => {
    const parsed = parseKargonomiShipment({
      id: 8,
      shipping_webservice_order_id: 'WS-1',
      shipping_webservice_barcode: 'BAR-1',
      shipping_webservice_tracking_code: 'TRK-1',
      shipping_provider_name: 'Sürat Kargo',
      shipping_provider_slug: 'surat',
      barcode_of_order_id: 'ORDER-BAR-1',
      status: 'webservice_shipment_started',
      status_label: 'Kargo Teslim Sürecinde',
      package_count: 1,
      pricing: {
        estimated_price: '22.67 + KDV',
        real_price: '25.00',
        extra_shipping_price: '0.0000',
        price_diff: '2.33',
      },
      shipment_packages: [
        {
          desi: '1',
          barcode: 'JRJ3PA_1',
          content: 'Defter',
          real_desi: '1.2',
        },
      ],
    });

    expect(parsed).toMatchObject({
      id: '8',
      shippingWebserviceOrderId: 'WS-1',
      shippingWebserviceBarcode: 'BAR-1',
      shippingWebserviceTrackingCode: 'TRK-1',
      shippingProviderName: 'Sürat Kargo',
      shippingProviderSlug: 'surat',
      barcodeOfOrderId: 'ORDER-BAR-1',
      status: 'webservice_shipment_started',
      statusLabel: 'Kargo Teslim Sürecinde',
      internalStatus: 'in_transit',
      pricing: {
        packageCount: '1',
        estimatedPrice: '22.67 + KDV',
        realPrice: '25.00',
        extraShippingPrice: '0.0000',
        priceDiff: '2.33',
      },
      shipmentPackages: [{ desi: '1', barcode: 'JRJ3PA_1', content: 'Defter', realDesi: '1.2' }],
    });
  });

  it.each([
    ['draft', 'pending'],
    ['ready', 'created'],
    ['webservice_order_failed', 'failed'],
    ['webservice_order_creating', 'pending'],
    ['webservice_order_created', 'created'],
    ['webservice_checking_shipment', 'pending'],
    ['webservice_shipment_started', 'in_transit'],
    ['webservice_shipment_delivered', 'delivered'],
    ['webservice_shipment_not_delivered', 'failed'],
    ['webservice_shipment_returning', 'pending'],
    ['webservice_shipment_missing', 'failed'],
    ['cancelled', 'cancelled'],
    ['request_for_cancellation', 'pending'],
  ] as const)('maps documented status %s to %s', (providerStatus, internalStatus) => {
    expect(mapKargonomiStatusToInternalStatus(providerStatus)).toBe(internalStatus);
  });

  it('maps unknown status to a safe pending state', () => {
    expect(mapKargonomiStatusToInternalStatus('future_status')).toBe('pending');
    expect(mapKargonomiStatusToInternalStatus(null)).toBe('pending');
  });

  it('does not treat returning status as confirmed return shipment support', () => {
    const parsed = parseKargonomiShipment({
      id: 9,
      status: 'webservice_shipment_returning',
      status_label: 'Kargo Geri Geliyor',
    });

    expect(parsed.status).toBe('webservice_shipment_returning');
    expect(parsed.internalStatus).toBe('pending');
    expect(parsed.internalStatus).not.toBe('returned');
  });

  it('does not make HTTP calls from mapping helpers', () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (() => {
      calls += 1;
      throw new Error('unexpected fetch');
    }) as typeof fetch;

    try {
      buildKargonomiShipmentCreatePayload({
        warehouseId: '12707',
        buyer: {
          buyer_name: 'Test Buyer',
          buyer_phone: '5551112233',
          buyer_address: 'Test Buyer Address',
          buyer_state_id: '34',
          buyer_city_id: '828',
        },
        packages: [{ desi: '1' }],
      });
      parseKargonomiShipment({ id: 1, status: 'draft' });
      mapKargonomiStatusToInternalStatus('draft');
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(calls).toBe(0);
  });
});
