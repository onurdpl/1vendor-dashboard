import { describe, expect, it, vi } from 'vitest';
import type { AppEnv } from '../backend/src/config/env.js';
import { registerDiagnosticsRoutes } from '../backend/src/modules/diagnostics/diagnostics.routes.js';
import {
  getNavlungoConfigDiagnostics,
  NavlungoAdapter,
  NavlungoHttpClient,
  NAVLUNGO_ENV_NAMES,
  NAVLUNGO_PROVIDER_DISPLAY_NAME,
  NAVLUNGO_PROVIDER_KEY,
  runNavlungoAuthDiagnostics,
  runNavlungoCarrierDiagnostics,
} from '../backend/src/modules/shipping/navlungo-provider.adapter.js';

function buildEnv(overrides: Partial<AppEnv> = {}): AppEnv {
  return {
    NODE_ENV: 'test',
    PORT: 4000,
    DATABASE_URL: undefined,
    CORS_ORIGIN: [],
    JWT_SECRET: 'unused',
    JWT_EXPIRES_IN: '12h',
    SHOPIFY_WEBHOOK_SECRET: 'unused',
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
    NAVLUNGO_BASE_URL: 'https://domestic-api.navlungo.com/v2',
    NAVLUNGO_API_USERNAME: 'api-user',
    NAVLUNGO_API_PASSWORD: 'secret-password',
    NAVLUNGO_DEFAULT_SENDER_ADDRESS_ID: '55574',
    NAVLUNGO_DEFAULT_BARCODE_FORMAT: 'pdf-A6',
    ...overrides,
  };
}

function registerRoute(env: AppEnv, path = '/admin/diagnostics/navlungo/auth') {
  const gets = new Map<string, (request: { authUser?: { role?: string } }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => unknown>();
  const app = {
    get: vi.fn((path: string, ...args: unknown[]) => {
      const handler = args.at(-1) as (
        request: { authUser?: { role?: string } },
        reply: { code: (status: number) => { send: (body: unknown) => unknown } },
      ) => unknown;
      gets.set(path, handler);
    }),
    post: vi.fn(),
  };
  registerDiagnosticsRoutes(app as never, env);
  return gets.get(path);
}

function buildReply() {
  return {
    code: vi.fn((status: number) => ({
      send: vi.fn((body: unknown) => ({ status, body })),
    })),
  };
}

describe('Navlungo dormant auth scaffold', () => {
  it('exposes provider constants without enabling runtime shipment execution', () => {
    expect(NAVLUNGO_PROVIDER_KEY).toBe('navlungo');
    expect(NAVLUNGO_PROVIDER_DISPLAY_NAME).toBe('Navlungo');
    expect(NAVLUNGO_ENV_NAMES).toEqual({
      baseUrl: 'NAVLUNGO_BASE_URL',
      apiUsername: 'NAVLUNGO_API_USERNAME',
      apiPassword: 'NAVLUNGO_API_PASSWORD',
      defaultSenderAddressId: 'NAVLUNGO_DEFAULT_SENDER_ADDRESS_ID',
      defaultBarcodeFormat: 'NAVLUNGO_DEFAULT_BARCODE_FORMAT',
      defaultCarrierId: 'NAVLUNGO_DEFAULT_CARRIER_ID',
    });
    expect(getNavlungoConfigDiagnostics(buildEnv())).toMatchObject({
      provider: 'navlungo',
      displayName: 'Navlungo',
      dormant: true,
      runtimeShipmentExecutionEnabled: true,
      missing: [],
    });
  });

  it('requires prepared payload for return pickup execution', async () => {
    const adapter = new NavlungoAdapter(buildEnv());

    await expect(adapter.createReturnShipment({ orderId: 'order-1', items: [] })).rejects.toThrow(
      'Navlungo return pickup requires a prepared Create Post payload.',
    );
  });

  it('uses configured base URL and does not expose credentials in auth diagnostics', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({
        token_type: 'Bearer',
        expires_in: 86400,
        access_token: 'secret-access-token',
        refresh_token: 'secret-refresh-token',
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const result = await runNavlungoAuthDiagnostics(buildEnv(), { fetchImpl });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://domestic-api.navlungo.com/v2/auth/api');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.headers).toMatchObject({
      Accept: 'application/json',
      'Content-Type': 'application/json',
    });
    expect(result).toMatchObject({
      baseUrlHost: 'domestic-api.navlungo.com',
      baseUrlPath: '/v2',
      authRequestUrl: '/v2/auth/api',
      authHttpStatus: 200,
      tokenReceived: true,
      refreshTokenReceived: true,
      expiresIn: 86400,
      responseShapeSummary: {
        kind: 'json:object',
        topLevelKeys: ['token_type', 'expires_in', 'access_token', 'refresh_token'],
      },
      responseDataShapeSummary: null,
      tokenKeyPresence: {
        rootAccessToken: true,
        dataAccessToken: false,
        dataToken: false,
        anyTokenLikeKey: true,
      },
      refreshTokenKeyPresence: {
        rootRefreshToken: true,
        dataRefreshToken: false,
      },
      expiresInPresent: true,
      tokenTypePresent: true,
    });
    expect(JSON.stringify(result)).not.toContain('secret-password');
    expect(JSON.stringify(result)).not.toContain('secret-access-token');
    expect(JSON.stringify(result)).not.toContain('secret-refresh-token');
  });

  it('detects live-style data-wrapped auth tokens without exposing token values', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({
      status: true,
      message: 'Success',
      data: {
        token_type: 'Bearer',
        expires_in: 86400,
        access_token: 'secret-data-access-token',
        refresh_token: 'secret-data-refresh-token',
      },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;

    const result = await runNavlungoAuthDiagnostics(buildEnv(), { fetchImpl });

    expect(result).toMatchObject({
      authHttpStatus: 200,
      responseShapeSummary: {
        kind: 'json:object',
        topLevelKeys: ['status', 'message', 'data'],
      },
      responseDataShapeSummary: {
        kind: 'json:object',
        topLevelKeys: ['token_type', 'expires_in', 'access_token', 'refresh_token'],
      },
      tokenKeyPresence: {
        rootAccessToken: false,
        dataAccessToken: true,
        dataToken: false,
        anyTokenLikeKey: true,
      },
      refreshTokenKeyPresence: {
        rootRefreshToken: false,
        dataRefreshToken: true,
      },
      expiresInPresent: true,
      tokenTypePresent: true,
      tokenReceived: true,
      refreshTokenReceived: true,
      expiresIn: 86400,
    });
    expect(JSON.stringify(result)).not.toContain('secret-password');
    expect(JSON.stringify(result)).not.toContain('secret-data-access-token');
    expect(JSON.stringify(result)).not.toContain('secret-data-refresh-token');
  });

  it('surfaces auth validation fields from root error object without exposing credentials', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({
      message: 'Validation Errors',
      status: false,
      error: {
        username: ['Username field is required'],
        password: ['Password field is required'],
        another_field: 'Another field is invalid',
      },
    }), {
      status: 422,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;

    const result = await runNavlungoAuthDiagnostics(buildEnv(), { fetchImpl });

    expect(result).toMatchObject({
      authHttpStatus: 422,
      tokenReceived: false,
      authValidationErrorKeys: ['username', 'password', 'another_field'],
      authFailedFieldNames: ['username', 'password', 'another_field'],
      authValidationErrorMessages: [
        'username validation failed',
        'password validation failed',
        'Another field is invalid',
      ],
    });
    expect(JSON.stringify(result)).not.toContain('secret-password');
  });

  it('returns network failure diagnostics safely', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('fetch failed')) as unknown as typeof fetch;

    const result = await runNavlungoAuthDiagnostics(buildEnv(), { fetchImpl });

    expect(result).toMatchObject({
      authRequestUrl: '/v2/auth/api',
      authHttpStatus: null,
      tokenReceived: false,
      tokenKeyPresence: {
        rootAccessToken: false,
        dataAccessToken: false,
        dataToken: false,
        anyTokenLikeKey: false,
      },
      fetchError: {
        name: 'TypeError',
        message: 'fetch failed',
      },
    });
    expect(JSON.stringify(result)).not.toContain('secret-password');
  });

  it('HTTP client supports auth only and makes no shipment create calls', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ access_token: 'token' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const client = new NavlungoHttpClient(buildEnv(), { fetchImpl });
    await client.createAuthToken();

    expect(calls.map((call) => call.url)).toEqual(['https://domestic-api.navlungo.com/v2/auth/api']);
    expect(calls.some((call) => call.url.includes('post/create'))).toBe(false);
  });

  it('HTTP client calls documented detailed Check Post endpoint with post_number payload', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ status: true, data: { post_number: 'NAV-1' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const client = new NavlungoHttpClient(buildEnv(), { fetchImpl });
    await client.checkPostDetailed('secret-access-token', {
      post: {
        post_number: 'NAV-1',
      },
      limit: 1,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://domestic-api.navlungo.com/v2.1/post/check');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.headers).toMatchObject({
      Authorization: 'Bearer secret-access-token',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      post: {
        post_number: 'NAV-1',
      },
      limit: 1,
    });
  });

  it('keeps detailed Check Post on configured v2.1 base URL', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ status: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const client = new NavlungoHttpClient(buildEnv({ NAVLUNGO_BASE_URL: 'https://domestic-api.navlungo.com/v2.1/' }), {
      fetchImpl,
    });
    await client.checkPostDetailed('secret-access-token', {
      post: {
        post_number: 'NAV-1',
      },
      limit: 1,
    });

    expect(calls[0].url).toBe('https://domestic-api.navlungo.com/v2.1/post/check');
  });

  it('creates a forward shipment through Create Post and enriches with Check Post', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (String(url).endsWith('/auth/api')) {
        return new Response(JSON.stringify({ data: { access_token: 'secret-access-token' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (String(url).includes('/post/check/')) {
        return new Response(JSON.stringify({
          status: true,
          data: {
            post_number: 'NP12345',
            carrier_tracking_code: 'SR-TRACK-1',
            carrier_tracking_url: 'https://surat.example.test/SR-TRACK-1',
            barcode: 'barcode-pdf-string',
            post: {
              carrier_id: 9,
              carrier_name: 'Sürat Kargo',
            },
            status: {
              status_name: 'To be Picked Up',
            },
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({
        status: true,
        message: 'Your transaction will be successfully created if your wallet balance is sufficient.',
        data: {
          post_number: 'NP12345',
          reference_id: 'REF-1',
          tracking_url: 'https://track.example.test/NP12345',
          barcode: 'create-barcode-string',
          post: {
            carrier_id: 9,
            carrier_name: 'Sürat Kargo',
          },
        },
      }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    const adapter = new NavlungoAdapter(buildEnv({ SHIPPING_EXECUTION_ENABLED: true }), { fetchImpl });

    const result = await adapter.createShipment({
      allocationId: 'allocation-1',
      vendorId: 'vendor-1',
      provider: 'navlungo',
      requestSnapshot: {
        platform: 'shopify',
        posts: [
          {
            reference_id: 'REF-1',
            carrier_id: 9,
            post_type: 2,
            sender: {
              name: 'Sender',
              phone: '+90 532 123 45 67',
              email: 'sender@example.test',
              address: 'Sender address',
              country: 'tr',
              city: 'Istanbul',
              district: 'Kadikoy',
              post_code: '',
            },
            recipient: {
              name: 'Recipient',
              phone: '+90 532 123 45 68',
              email: 'recipient@example.test',
              address: 'Recipient address',
              country: 'tr',
              city: 'Istanbul',
              district: 'Kartal',
              post_code: '',
            },
            post: {
              desi: 3,
              package_count: 1,
              note: 'Order 1048',
            },
            barcode_format: 'pdf-A6',
            custom_data_1: 'alloc-1',
            custom_data_2: '1048',
            custom_data_3: 'vendor-1',
            custom_data_4: '55574',
          },
        ],
      },
    });

    expect(calls.map((call) => [call.init.method, call.url])).toEqual([
      ['POST', 'https://domestic-api.navlungo.com/v2/auth/api'],
      ['POST', 'https://domestic-api.navlungo.com/v2/post/create'],
      ['GET', 'https://domestic-api.navlungo.com/v2/post/check/NP12345'],
    ]);
    expect(result).toMatchObject({
      providerShipmentId: 'NP12345',
      trackingNumber: 'SR-TRACK-1',
      trackingUrl: 'https://surat.example.test/SR-TRACK-1',
      labelUrl: 'barcode-pdf-string',
      shipmentStatus: 'created',
      responseSnapshot: {
        authCalled: true,
        createPostCalled: true,
        checkPostCalled: true,
        createPostHttpStatus: 201,
        checkPostHttpStatus: 200,
        barcodePresent: true,
        carrierName: 'Sürat Kargo',
        carrierId: 9,
        navlungoRequestSummary: expect.objectContaining({
          endpointPath: '/post/create',
          method: 'POST',
          senderUsesAddressId: false,
          recipientDistrictPresent: true,
          recipientPhoneFormatValid: true,
          recipientAddressPresent: true,
          requestedCarrierId: 9,
          requestedPostType: 2,
        }),
      },
    });
    expect(JSON.stringify(result)).not.toContain('secret-access-token');
    expect(JSON.stringify(result.responseSnapshot.navlungoRequestSummary)).not.toContain('recipient@example.test');
    expect(JSON.stringify(result.responseSnapshot.navlungoRequestSummary)).not.toContain('Recipient address');
  });

  it('treats successful Navlungo Create Post response as shipment success when Check Post fails', async () => {
    const fetchImpl = (async (url: RequestInfo | URL) => {
      if (String(url).endsWith('/auth/api')) {
        return new Response(JSON.stringify({ data: { access_token: 'secret-access-token' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (String(url).includes('/post/check/')) {
        return new Response(JSON.stringify({ status: false, message: 'Temporarily unavailable' }), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({
        status: true,
        message: 'Your transaction will be successfully created if your wallet balance is sufficient.',
        data: {
          post_number: 'NP-CREATE-ONLY',
          reference_id: 'REF-CREATE-ONLY',
          tracking_url: 'https://domestic.navlungo.test/tracking/NP-CREATE-ONLY',
          barcode: 'create-barcode-string',
          post: {
            carrier_id: 9,
            carrier_name: 'Sürat Kargo',
          },
        },
      }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    const adapter = new NavlungoAdapter(buildEnv({ SHIPPING_EXECUTION_ENABLED: true }), { fetchImpl });

    const result = await adapter.createShipment({
      allocationId: 'allocation-1',
      vendorId: 'vendor-1',
      provider: 'navlungo',
      requestSnapshot: {
        platform: 'shopify',
        posts: [
          {
            reference_id: 'REF-CREATE-ONLY',
            carrier_id: 9,
            post_type: 2,
            sender: {
              name: 'Sender',
              phone: '+90 532 123 45 67',
              email: 'sender@example.test',
              address: 'Sender address',
              country: 'tr',
              city: 'Istanbul',
              district: 'Kadikoy',
              post_code: '',
            },
            recipient: {
              name: 'Recipient',
              phone: '+90 532 123 45 68',
              email: 'recipient@example.test',
              address: 'Recipient address',
              country: 'tr',
              city: 'Istanbul',
              district: '',
              post_code: '',
            },
            post: {
              desi: 3,
              package_count: 1,
              note: 'Order 1048',
            },
            barcode_format: 'pdf-A6',
            custom_data_1: 'alloc-1',
            custom_data_2: '1048',
            custom_data_3: 'vendor-1',
            custom_data_4: '55574',
          },
        ],
      },
    });

    expect(result).toMatchObject({
      providerShipmentId: 'NP-CREATE-ONLY',
      trackingNumber: 'NP-CREATE-ONLY',
      trackingUrl: 'https://domestic.navlungo.test/tracking/NP-CREATE-ONLY',
      labelUrl: 'create-barcode-string',
      shipmentStatus: 'created',
      responseSnapshot: {
        ok: true,
        providerShipmentIdPresent: true,
        trackingNumberPresent: true,
        trackingUrlPresent: true,
        barcodePresent: true,
        carrierName: 'Sürat Kargo',
        carrierId: 9,
        checkPostWarning: 'Navlungo Check Post failed with HTTP 503.',
      },
    });
    expect(JSON.stringify(result)).not.toContain('secret-access-token');
  });

  it('captures sanitized Navlungo 422 validation details without exposing PII', async () => {
    const fetchImpl = (async (url: RequestInfo | URL) => {
      if (String(url).endsWith('/auth/api')) {
        return new Response(JSON.stringify({ data: { access_token: 'secret-access-token' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({
        status: false,
        message: 'Validation Errors',
        code: 'VALIDATION_ERROR',
        errors: {
          recipient: {
            phone: ['The recipient phone +90 532 123 45 68 is invalid.'],
            email: ['recipient@example.test is invalid.'],
            address: ['Recipient address is invalid.'],
          },
          post: {
            desi: ['The desi field is required.'],
          },
        },
      }), {
        status: 422,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    const adapter = new NavlungoAdapter(buildEnv({ SHIPPING_EXECUTION_ENABLED: true }), { fetchImpl });

    let thrown: unknown;
    try {
      await adapter.createShipment({
        allocationId: 'allocation-1',
        vendorId: 'vendor-1',
        provider: 'navlungo',
        requestSnapshot: {
          platform: 'shopify',
          posts: [
            {
              reference_id: 'REF-422',
              carrier_id: 9,
              post_type: 2,
              sender: {
                name: 'Sender',
                phone: '+90 532 123 45 67',
                email: 'sender@example.test',
                address: 'Sender address',
                country: 'tr',
                city: 'Istanbul',
                district: 'Kadikoy',
                post_code: '',
              },
              recipient: {
                name: 'Recipient',
                phone: '+90 532 123 45 68',
                email: 'recipient@example.test',
                address: 'Recipient address',
                country: 'tr',
                city: 'Istanbul',
                district: '',
                post_code: '',
              },
              post: {
                desi: 3,
                package_count: 1,
                note: 'Order 1048',
              },
              barcode_format: 'pdf-A6',
            },
          ],
        },
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe('Navlungo Create Post failed with HTTP 422.');
    const snapshot = (thrown as Error & { responseSnapshot?: Record<string, unknown> }).responseSnapshot;
    expect(snapshot).toMatchObject({
      createPostHttpStatus: 422,
      providerMessage: 'Validation Errors',
      providerErrorCode: 'VALIDATION_ERROR',
      validationErrorKeys: ['recipient', 'post'],
      failedFieldNames: [
        'recipient.phone',
        'recipient.email',
        'recipient.address',
        'post.desi',
      ],
      validationErrorMessages: [
        'recipient.phone validation failed',
        'recipient.email validation failed',
        'recipient.address validation failed',
        'The desi field is required.',
      ],
      providerValidationErrors: [
        'recipient.phone validation failed',
        'recipient.email validation failed',
        'recipient.address validation failed',
        'The desi field is required.',
      ],
      validationResponseShape: {
        kind: 'json:object',
        topLevelKeys: ['status', 'message', 'code', 'errors'],
      },
    });
    expect(JSON.stringify(snapshot)).not.toContain('secret-access-token');
    expect(JSON.stringify(snapshot)).not.toContain('+90 532 123 45 68');
    expect(JSON.stringify(snapshot)).not.toContain('recipient@example.test');
    expect(JSON.stringify(snapshot)).not.toContain('Recipient address');
  });

  it('parses Navlungo validation field paths from root error object', async () => {
    const fetchImpl = (async (url: RequestInfo | URL) => {
      if (String(url).endsWith('/auth/api')) {
        return new Response(JSON.stringify({ data: { access_token: 'secret-access-token' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({
        message: 'Validation Errors',
        status: false,
        error: {
          'posts.0.reference_id': ['This reference id has already been registered.'],
          'posts.0.carrier_id': ['Carrier field is required'],
          'posts.0.recipient.phone': ['The phone +90 532 123 45 68 is invalid.'],
          'posts.0.recipient.email': 'recipient@example.test is invalid.',
        },
      }), {
        status: 422,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    const adapter = new NavlungoAdapter(buildEnv({ SHIPPING_EXECUTION_ENABLED: true }), { fetchImpl });

    let thrown: unknown;
    try {
      await adapter.createShipment({
        allocationId: 'allocation-1',
        vendorId: 'vendor-1',
        provider: 'navlungo',
        requestSnapshot: {
          platform: 'shopify',
          posts: [
            {
              reference_id: 'REF-ERROR-OBJECT',
              carrier_id: 9,
              post_type: 2,
              sender: {
                addressId: 55574,
              },
              recipient: {
                name: 'Recipient',
                phone: '+90 532 123 45 68',
                email: 'recipient@example.test',
                address: 'Recipient address',
                country: 'tr',
                city: 'Istanbul',
                district: '',
                post_code: '',
              },
              post: {
                desi: 3,
                package_count: 1,
                note: 'Order 1048',
              },
              barcode_format: 'pdf-A6',
            },
          ],
        },
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    const snapshot = (thrown as Error & { responseSnapshot?: Record<string, unknown> }).responseSnapshot;
    expect(snapshot).toMatchObject({
      createPostHttpStatus: 422,
      providerMessage: 'Validation Errors',
      validationErrorKeys: [
        'posts.0.reference_id',
        'posts.0.carrier_id',
        'posts.0.recipient.phone',
        'posts.0.recipient.email',
      ],
      failedFieldNames: [
        'posts.0.reference_id',
        'posts.0.carrier_id',
        'posts.0.recipient.phone',
        'posts.0.recipient.email',
      ],
      validationErrorMessages: [
        'This reference id has already been registered.',
        'Carrier field is required',
        'posts.0.recipient.phone validation failed',
        'posts.0.recipient.email validation failed',
      ],
    });
    expect(JSON.stringify(snapshot)).not.toContain('+90 532 123 45 68');
    expect(JSON.stringify(snapshot)).not.toContain('recipient@example.test');
  });

  it('parses Navlungo validation field paths from nested data error object', async () => {
    const fetchImpl = (async (url: RequestInfo | URL) => {
      if (String(url).endsWith('/auth/api')) {
        return new Response(JSON.stringify({ data: { access_token: 'secret-access-token' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({
        message: 'Validation Errors',
        status: false,
        data: {
          error: {
            'posts.0.sender.phone': ['The phone +90 532 123 45 67 is invalid.'],
            'posts.0.recipient.email': ['recipient@example.test is invalid.'],
          },
        },
      }), {
        status: 422,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    const adapter = new NavlungoAdapter(buildEnv({ SHIPPING_EXECUTION_ENABLED: true }), { fetchImpl });

    let thrown: unknown;
    try {
      await adapter.createShipment({
        allocationId: 'allocation-1',
        vendorId: 'vendor-1',
        provider: 'navlungo',
        requestSnapshot: {
          platform: 'shopify',
          posts: [
            {
              reference_id: 'REF-DATA-ERROR',
              carrier_id: 9,
              post_type: 2,
              sender: {
                name: 'Sender',
                phone: '+90 532 123 45 67',
                email: 'sender@example.test',
                address: 'Sender address',
                country: 'tr',
                city: 'Istanbul',
                district: 'Kadikoy',
                post_code: '',
              },
              recipient: {
                name: 'Recipient',
                phone: '+90 532 123 45 68',
                email: 'recipient@example.test',
                address: 'Recipient address',
                country: 'tr',
                city: 'Istanbul',
                district: '',
                post_code: '',
              },
              post: {
                desi: 3,
                package_count: 1,
                note: 'Order 1048',
              },
              barcode_format: 'pdf-A6',
            },
          ],
        },
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    const snapshot = (thrown as Error & { responseSnapshot?: Record<string, unknown> }).responseSnapshot;
    expect(snapshot).toMatchObject({
      createPostHttpStatus: 422,
      providerMessage: 'Validation Errors',
      validationErrorKeys: ['posts.0.sender.phone', 'posts.0.recipient.email'],
      failedFieldNames: ['posts.0.sender.phone', 'posts.0.recipient.email'],
      validationErrorMessages: [
        'posts.0.sender.phone validation failed',
        'posts.0.recipient.email validation failed',
      ],
      validationErrorKeysCount: 2,
      failedFieldNamesCount: 2,
      validationErrorMessagesCount: 2,
      topLevelErrorShape: 'missing',
      nestedCreatePostErrorShape: 'object:2',
      providerValidationErrorsShape: 'array:2',
    });
    expect(JSON.stringify(snapshot)).not.toContain('+90 532 123 45 67');
    expect(JSON.stringify(snapshot)).not.toContain('recipient@example.test');
  });

  it('parses Navlungo validation details from errors arrays', async () => {
    const fetchImpl = (async (url: RequestInfo | URL) => {
      if (String(url).endsWith('/auth/api')) {
        return new Response(JSON.stringify({ data: { access_token: 'secret-access-token' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({
        message: 'Validation Errors',
        status: false,
        errors: [
          {
            field: 'posts.0.recipient.addressId',
            message: 'Address id is not valid for returns.',
          },
          {
            path: 'posts.0.sender.phone',
            messages: ['Phone +90 532 123 45 67 is invalid.'],
          },
        ],
      }), {
        status: 422,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    const adapter = new NavlungoAdapter(buildEnv({ SHIPPING_EXECUTION_ENABLED: true }), { fetchImpl });

    let thrown: unknown;
    try {
      await adapter.createShipment({
        allocationId: 'allocation-1',
        vendorId: 'vendor-1',
        provider: 'navlungo',
        requestSnapshot: {
          platform: 'shopify',
          posts: [
            {
              reference_id: 'REF-ERRORS-ARRAY',
              carrier_id: 9,
              post_type: 3,
              sender: {
                name: 'Sender',
                phone: '+90 532 123 45 67',
                email: 'sender@example.test',
                address: 'Sender address',
                country: 'tr',
                city: 'Istanbul',
                district: 'Kadikoy',
                post_code: '',
              },
              recipient: {
                addressId: 55574,
              },
              post: {
                desi: 3,
                package_count: 1,
                price: '',
                note: '',
              },
              barcode_format: 'pdf-A5',
            },
          ],
        },
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    const snapshot = (thrown as Error & { responseSnapshot?: Record<string, unknown> }).responseSnapshot;
    expect(snapshot).toMatchObject({
      createPostHttpStatus: 422,
      providerMessage: 'Validation Errors',
      validationErrorKeys: ['errors'],
      failedFieldNames: ['posts.0.recipient.addressId', 'posts.0.sender.phone'],
      validationErrorMessages: [
        'posts.0.recipient.addressId validation failed',
        'posts.0.sender.phone validation failed',
      ],
      validationResponseShape: {
        kind: 'json:object',
        topLevelKeys: ['message', 'status', 'errors'],
      },
    });
    expect(JSON.stringify(snapshot)).not.toContain('+90 532 123 45 67');
    expect(JSON.stringify(snapshot)).not.toContain('sender@example.test');
  });

  it('extracts Navlungo provider tracking id from 500 provider messages', async () => {
    const providerMessage =
      'Execution of ServiceCallout failed. Please report for error resolution with Tracking ID: #35440d91ec90403483413b548ba91844';
    const fetchImpl = (async (url: RequestInfo | URL) => {
      if (String(url).endsWith('/auth/api')) {
        return new Response(JSON.stringify({ data: { access_token: 'secret-access-token' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({
        status: false,
        message: providerMessage,
      }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    const adapter = new NavlungoAdapter(buildEnv({ SHIPPING_EXECUTION_ENABLED: true }), { fetchImpl });

    let thrown: unknown;
    try {
      await adapter.createShipment({
        allocationId: 'allocation-1',
        vendorId: 'vendor-1',
        provider: 'navlungo',
        requestSnapshot: {
          platform: 'shopify',
          posts: [
            {
              reference_id: 'REF-500',
              carrier_id: 9,
              post_type: 2,
              sender: {
                addressId: 55574,
              },
              recipient: {
                name: 'Recipient',
                phone: '+90 532 123 45 68',
                email: 'recipient@example.test',
                address: 'Recipient address',
                country: 'tr',
                city: 'Istanbul',
                district: '',
                post_code: '',
              },
              post: {
                desi: 3,
                package_count: 1,
                note: 'Order 1048',
              },
              barcode_format: 'pdf-A6',
            },
          ],
        },
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe('Navlungo Create Post failed with HTTP 500.');
    const snapshot = (thrown as Error & { responseSnapshot?: Record<string, unknown> }).responseSnapshot;
    expect(snapshot).toMatchObject({
      createPostHttpStatus: 500,
      providerMessage,
      providerTrackingId: '#35440d91ec90403483413b548ba91844',
      senderAddressIdPresent: true,
      senderAddressIdValid: true,
      senderUsesAddressId: true,
    });
    expect(JSON.stringify(snapshot)).not.toContain('secret-access-token');
    expect(JSON.stringify(snapshot)).not.toContain('recipient@example.test');
  });

  it('authenticates before carrier diagnostics but does not call unknown carrier paths', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({
        status: true,
        message: 'ok',
        data: { access_token: 'secret-access-token' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const result = await runNavlungoCarrierDiagnostics(buildEnv(), { fetchImpl });

    expect(calls.map((call) => [call.init.method, call.url])).toEqual([
      ['POST', 'https://domestic-api.navlungo.com/v2/auth/api'],
    ]);
    expect(calls.some((call) => call.url.includes('carrier'))).toBe(false);
    expect(calls.some((call) => call.url.includes('post/create'))).toBe(false);
    expect(result).toMatchObject({
      authHttpStatus: 200,
      authTokenReceived: true,
      carrierEndpointPathsKnown: false,
      skippedReason: 'carrier_endpoint_paths_unknown',
      myCarriersHttpStatus: null,
      myCarrierCount: null,
      myCarrierSamples: [],
      listCarriersHttpStatus: null,
      listCarrierCount: null,
      anyConfiguredCarrier: false,
      providerMessages: [
        'ok',
        'Navlungo carrier endpoint paths are unknown. Official carrier pages do not expose request paths.',
      ],
    });
    expect(JSON.stringify(result)).not.toContain('secret-password');
    expect(JSON.stringify(result)).not.toContain('secret-access-token');
  });

  it('does not call carrier or create-post endpoints from carrier diagnostics', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: RequestInfo | URL) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ data: { access_token: 'secret-access-token' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const result = await runNavlungoCarrierDiagnostics(buildEnv(), { fetchImpl });

    expect(calls).toEqual(['https://domestic-api.navlungo.com/v2/auth/api']);
    expect(calls.some((url) => url.includes('carrier'))).toBe(false);
    expect(calls.some((url) => url.includes('post/create'))).toBe(false);
    expect(result).toMatchObject({
      carrierEndpointPathsKnown: false,
      skippedReason: 'carrier_endpoint_paths_unknown',
      anyConfiguredCarrier: false,
    });
    expect(JSON.stringify(result)).not.toContain('secret-access-token');
  });
});

describe('Navlungo auth diagnostics route', () => {
  it('requires admin access', async () => {
    const handler = registerRoute(buildEnv());
    const result = await handler?.({ authUser: { role: 'vendor' } }, buildReply());

    expect(result).toMatchObject({
      status: 403,
      body: { message: 'Forbidden' },
    });
  });

  it('requires admin access for carrier diagnostics', async () => {
    const handler = registerRoute(buildEnv(), '/admin/diagnostics/navlungo/carriers');
    const result = await handler?.({ authUser: { role: 'vendor' } }, buildReply());

    expect(result).toMatchObject({
      status: 403,
      body: { message: 'Forbidden' },
    });
  });

  it('returns sanitized diagnostics without exposing credentials or tokens', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({
      expires_in: 86400,
      access_token: 'secret-access-token',
      refresh_token: 'secret-refresh-token',
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;

    try {
      const handler = registerRoute(buildEnv());
      const result = await handler?.({ authUser: { role: 'admin' } }, buildReply());

      expect(result).toMatchObject({
        provider: 'navlungo',
        dormant: true,
        usernamePresent: true,
        passwordPresent: true,
        authHttpStatus: 200,
        tokenReceived: true,
        responseDataShapeSummary: null,
        tokenKeyPresence: {
          rootAccessToken: true,
          dataAccessToken: false,
          dataToken: false,
          anyTokenLikeKey: true,
        },
      });
      expect(JSON.stringify(result)).not.toContain('secret-password');
      expect(JSON.stringify(result)).not.toContain('secret-access-token');
      expect(JSON.stringify(result)).not.toContain('secret-refresh-token');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('returns sanitized carrier diagnostics without exposing credentials or tokens', async () => {
    const originalFetch = globalThis.fetch;
    const calls: string[] = [];
    globalThis.fetch = (async (url: RequestInfo | URL) => {
      calls.push(String(url));
      if (String(url).endsWith('/auth/api')) {
        return new Response(JSON.stringify({ data: { access_token: 'secret-access-token' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ status: true, message: 'ok', data: [{ id: 9, carrier_name: 'Sürat Kargo' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      const handler = registerRoute(buildEnv(), '/admin/diagnostics/navlungo/carriers');
      const result = await handler?.({ authUser: { role: 'admin' } }, buildReply());

      expect(calls).toEqual([
        'https://domestic-api.navlungo.com/v2/auth/api',
      ]);
      expect(result).toMatchObject({
        provider: 'navlungo',
        dormant: true,
        authHttpStatus: 200,
        carrierEndpointPathsKnown: false,
        skippedReason: 'carrier_endpoint_paths_unknown',
        myCarriersHttpStatus: null,
        listCarriersHttpStatus: null,
        myCarrierSamples: [],
      });
      expect(JSON.stringify(result)).not.toContain('secret-password');
      expect(JSON.stringify(result)).not.toContain('secret-access-token');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
