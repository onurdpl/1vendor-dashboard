import { describe, expect, it, vi } from 'vitest';
import type { AppEnv } from '../backend/src/config/env.js';
import { createShippingProviderAdapter } from '../backend/src/modules/shipping/shipping-provider.adapter.js';
import {
  getKargonomiConfigDiagnostics,
  KargonomiAdapter,
  KargonomiHttpClient,
  buildKargonomiShipmentCreatePayload,
  KARGONOMI_ENV_NAMES,
  KARGONOMI_PROVIDER_DISPLAY_NAME,
  KARGONOMI_PROVIDER_KEY,
  clearKargonomiLocationLookupCache,
  mapKargonomiStatusToInternalStatus,
  parseKargonomiShipment,
  resolveKargonomiDestinationAddress,
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

function buildMockFetch(body: unknown = { ok: true }, contentType = 'application/json') {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });

    return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status: 200,
      headers: {
        'content-type': contentType,
      },
    });
  }) as typeof fetch;

  return { calls, fetchImpl };
}

describe('Kargonomi forward adapter scaffold', () => {
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
      appKeyRequirement: 'not_required_for_account',
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

  it('executes the documented forward flow with automatic provider selection by default', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      const responseBody = calls.length === 1
        ? { shipment: { id: 123, status: 'draft' } }
        : calls.length === 2
          ? { options: [{ id: 5, price: 100 }] }
          : calls.length === 3
            ? { ok: true, message: 'confirmed' }
            : calls.length === 4
              ? {
                  shipment: {
                    id: 123,
                    status: 'webservice_order_created',
                    shipping_webservice_tracking_code: 'KG-TRACK-1',
                    shipping_provider_name: 'Test Carrier',
                    pricing: { real_price: '100' },
                  },
                }
              : { barcode_pdf_base64: 'JVBERi0xLjQ=' };

      return new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    const adapter = new KargonomiAdapter(buildEnv(), new KargonomiHttpClient(buildEnv(), { fetchImpl }));

    const result = await adapter.createShipment({
      allocationId: 'alloc-1',
      vendorId: 'vendor-1',
      provider: 'kargonomi',
      requestSnapshot: {
        warehouseId: '112668',
        buyer: {
          buyer_name: 'Test Buyer',
          buyer_phone: '5551112233',
          buyer_address: 'Test Buyer Address',
          buyer_state_id: '34',
          buyer_city_id: '828',
        },
        packages: [{ desi: '3', content: 'Shoes', barcode: 'PKG-1' }],
      },
    });

    expect(calls.map((call) => [call.init.method, call.url])).toEqual([
      ['POST', 'https://app.kargonomi.com.tr/api/v1/shipments'],
      ['GET', 'https://app.kargonomi.com.tr/api/v1/shipment-price-comparison/123'],
      ['POST', 'https://app.kargonomi.com.tr/api/v1/confirm-shipping-price'],
      ['GET', 'https://app.kargonomi.com.tr/api/v1/shipments/123'],
      ['GET', 'https://app.kargonomi.com.tr/api/v1/shipments/123/barcode?format=pdf'],
    ]);
    expect(String(calls[2].init.body)).toBe('shipment_id=123&shipping_provider_id=-1');
    expect(result).toMatchObject({
      providerShipmentId: '123',
      trackingNumber: 'KG-TRACK-1',
      shipmentStatus: 'created',
      shippingCost: 100,
      currency: 'TRY',
    });
    expect(result.responseSnapshot).toMatchObject({
      automaticProviderSelection: true,
      getShipmentAfterConfirmCalled: true,
      labelUrlPresent: false,
    });
  });

  it('uses preferred Kargonomi shipping provider id when configured in the request snapshot', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      const responseBody = calls.length === 1
        ? { shipment: { id: 123, status: 'draft' } }
        : calls.length === 3
          ? { shipment: { id: 123, status: 'webservice_order_created' } }
          : {};

      return new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    const adapter = new KargonomiAdapter(buildEnv(), new KargonomiHttpClient(buildEnv(), { fetchImpl }));

    await adapter.createShipment({
      allocationId: 'alloc-1',
      vendorId: 'vendor-1',
      provider: 'kargonomi',
      requestSnapshot: {
        warehouseId: '112668',
        shippingProviderId: 9,
        buyer: {
          buyer_name: 'Test Buyer',
          buyer_phone: '5551112233',
          buyer_address: 'Test Buyer Address',
          buyer_state_id: '34',
          buyer_city_id: '828',
        },
        packages: [{ desi: '3' }],
      },
    });

    expect(String(calls[2].init.body)).toBe('shipment_id=123&shipping_provider_id=9');
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

  it('includes Authorization header and omits X-App-Key when not configured', async () => {
    const { calls, fetchImpl } = buildMockFetch({ id: 1 });
    const client = new KargonomiHttpClient(
      buildEnv({
        KARGONOMI_API_TOKEN: 'secret-token',
        KARGONOMI_APP_KEY: undefined,
      }),
      { fetchImpl },
    );

    await client.getShipment(1);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://app.kargonomi.com.tr/api/v1/shipments/1');
    expect(calls[0].init.headers).toMatchObject({
      Accept: 'application/json',
      Authorization: 'Bearer secret-token',
    });
    expect(calls[0].init.headers).not.toHaveProperty('X-App-Key');
  });

  it('includes X-App-Key when configured', async () => {
    const { calls, fetchImpl } = buildMockFetch({ id: 1 });
    const client = new KargonomiHttpClient(
      buildEnv({
        KARGONOMI_API_TOKEN: 'secret-token',
        KARGONOMI_APP_KEY: 'app-key',
      }),
      { fetchImpl },
    );

    await client.getShipment(1);

    expect(calls[0].init.headers).toMatchObject({
      Authorization: 'Bearer secret-token',
      'X-App-Key': 'app-key',
    });
  });

  it('builds documented forward endpoint paths', async () => {
    const { calls, fetchImpl } = buildMockFetch({ ok: true });
    const client = new KargonomiHttpClient(buildEnv(), { fetchImpl });

    await client.createShipmentDraft({
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
    await client.getShipmentPriceComparison(123);
    await client.confirmShippingPrice({ shipmentId: 123, shippingProviderId: 5 });
    await client.getShipmentBarcodePdf(123);
    await client.getShipment(123);
    await client.listStates();
    await client.listStates(225);
    await client.listCities(34);

    expect(calls.map((call) => [call.init.method, call.url])).toEqual([
      ['POST', 'https://app.kargonomi.com.tr/api/v1/shipments'],
      ['GET', 'https://app.kargonomi.com.tr/api/v1/shipment-price-comparison/123'],
      ['POST', 'https://app.kargonomi.com.tr/api/v1/confirm-shipping-price'],
      ['GET', 'https://app.kargonomi.com.tr/api/v1/shipments/123/barcode?format=pdf'],
      ['GET', 'https://app.kargonomi.com.tr/api/v1/shipments/123'],
      ['GET', 'https://app.kargonomi.com.tr/api/v1/states'],
      ['GET', 'https://app.kargonomi.com.tr/api/v1/states/225'],
      ['GET', 'https://app.kargonomi.com.tr/api/v1/cities/34'],
    ]);

    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      shipment: {
        warehouse_id: '12707',
        buyer_name: 'Test Buyer',
        buyer_phone: '5551112233',
        buyer_address: 'Test Buyer Address',
        buyer_state_id: '34',
        buyer_city_id: '828',
        packages: [{ desi: '1' }],
      },
    });
    expect(String(calls[2].init.body)).toBe('shipment_id=123&shipping_provider_id=5');
  });

  it('resolves Turkish destination state and district IDs with case and diacritic normalization', async () => {
    clearKargonomiLocationLookupCache();
    const client = {
      listStates: async () => ({
        ok: true,
        status: 200,
        contentType: 'application/json',
        body: { data: [{ id: 34, name: 'İstanbul' }] },
      }),
      listCities: async (stateId: string | number) => ({
        ok: true,
        status: 200,
        contentType: 'application/json',
        body: { data: [{ id: 828, name: stateId === '34' || stateId === 34 ? 'Kadıköy' : 'Other' }] },
      }),
    };

    await expect(
      resolveKargonomiDestinationAddress(
        {
          city: 'ISTANBUL',
          district: 'KADIKOY',
        },
        client,
      ),
    ).resolves.toMatchObject({
      ok: true,
      buyerStateId: '34',
      buyerCityId: '828',
      stateSource: 'city',
      citySource: 'district',
    });
  });

  it('does not guess when Kargonomi district matching is unresolved', async () => {
    clearKargonomiLocationLookupCache();
    const client = {
      listStates: async () => ({
        ok: true,
        status: 200,
        contentType: 'application/json',
        body: { data: [{ id: 34, name: 'İstanbul' }] },
      }),
      listCities: async () => ({
        ok: true,
        status: 200,
        contentType: 'application/json',
        body: { data: [{ id: 828, name: 'Kadıköy' }] },
      }),
    };

    await expect(
      resolveKargonomiDestinationAddress(
        {
          city: 'İstanbul',
          district: 'Beşiktaş',
        },
        client,
      ),
    ).resolves.toMatchObject({
      ok: false,
      reason: 'city_unresolved',
    });
  });

  it('reports state lookup transport failures and retries after a transient failure', async () => {
    clearKargonomiLocationLookupCache();
    const client = {
      listStates: vi
        .fn()
        .mockRejectedValueOnce(new Error('fetch failed'))
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          contentType: 'application/json',
          body: { data: [{ id: 34, name: 'İstanbul' }] },
        }),
      listCities: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        contentType: 'application/json',
        body: { data: [{ id: 829, name: 'Kartal' }] },
      }),
    };

    const first = await resolveKargonomiDestinationAddress(
      {
        city: 'İstanbul',
        district: 'Kartal',
      },
      client,
    );

    expect(first).toMatchObject({
      ok: false,
      reason: 'state_lookup_failed',
    });
    expect(first.ok === false ? first.message : '').toContain(
      'Kargonomi states lookup failed before shipment creation: fetch failed.',
    );

    await expect(
      resolveKargonomiDestinationAddress(
        {
          city: 'İstanbul',
          district: 'Kartal',
        },
        client,
      ),
    ).resolves.toMatchObject({
      ok: true,
      buyerStateId: '34',
      buyerCityId: '829',
    });
    expect(client.listStates).toHaveBeenCalledTimes(2);
  });

  it('reports city lookup transport failures and retries after a transient failure', async () => {
    clearKargonomiLocationLookupCache();
    const client = {
      listStates: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        contentType: 'application/json',
        body: { data: [{ id: 34, name: 'İstanbul' }] },
      }),
      listCities: vi
        .fn()
        .mockRejectedValueOnce(new Error('fetch failed'))
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          contentType: 'application/json',
          body: { data: [{ id: 829, name: 'Kartal' }] },
        }),
    };

    const first = await resolveKargonomiDestinationAddress(
      {
        city: 'İstanbul',
        district: 'Kartal',
      },
      client,
    );

    expect(first).toMatchObject({
      ok: false,
      reason: 'city_lookup_failed',
    });
    expect(first.ok === false ? first.message : '').toContain(
      'Kargonomi cities lookup failed before shipment creation for resolved state 34: fetch failed.',
    );

    await expect(
      resolveKargonomiDestinationAddress(
        {
          city: 'İstanbul',
          district: 'Kartal',
        },
        client,
      ),
    ).resolves.toMatchObject({
      ok: true,
      buyerStateId: '34',
      buyerCityId: '829',
    });
    expect(client.listCities).toHaveBeenCalledTimes(2);
  });

  it('keeps barcode response as unknown raw provider body', async () => {
    const { fetchImpl } = buildMockFetch({ barcode_pdf_base64: 'JVBERi0xLjQ=' });
    const client = new KargonomiHttpClient(buildEnv(), { fetchImpl });

    const response = await client.getShipmentBarcodePdf(123);

    expect(response).toMatchObject({
      ok: true,
      status: 200,
      contentType: 'application/json',
      body: { barcode_pdf_base64: 'JVBERi0xLjQ=' },
    });
  });

  it('uses injected fetch and does not make live network calls', async () => {
    const originalFetch = globalThis.fetch;
    let globalFetchCalls = 0;
    globalThis.fetch = (async () => {
      globalFetchCalls += 1;
      throw new Error('unexpected live fetch');
    }) as typeof fetch;

    const { calls, fetchImpl } = buildMockFetch({ id: 1 });
    const client = new KargonomiHttpClient(buildEnv(), { fetchImpl });

    try {
      await client.getShipment(1);
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(calls).toHaveLength(1);
    expect(globalFetchCalls).toBe(0);
  });
});
