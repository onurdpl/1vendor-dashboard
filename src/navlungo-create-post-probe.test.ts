import { describe, expect, it, vi } from 'vitest';
import { registerDiagnosticsRoutes } from '../backend/src/modules/diagnostics/diagnostics.routes.js';
import {
  buildNavlungoCreatePostProbePayload,
  parseNavlungoCreatePostProbeCarrierId,
  runNavlungoBarcodeProbeDiagnostics,
  runNavlungoCheckPostProbeDiagnostics,
  runManualNavlungoCreatePostProbe,
  sanitizeNavlungoProbeOutput,
  summarizeNavlungoCheckPostResponse,
  summarizeNavlungoCreatePostResponse,
  validateNavlungoCreatePostProbeEnv,
} from '../backend/src/modules/shipping/navlungo-create-post-probe.js';
import { summarizeNavlungoCreatePostRequest } from '../backend/src/modules/shipping/navlungo-provider.adapter.js';

function buildProbeEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    NAVLUNGO_CREATE_POST_PROBE_CONFIRM: 'YES',
    NAVLUNGO_BASE_URL: 'https://domestic-api.navlungo.com/v2',
    NAVLUNGO_API_USERNAME: 'api-user',
    NAVLUNGO_API_PASSWORD: 'secret-password',
    NAVLUNGO_DEFAULT_SENDER_ADDRESS_ID: '55574',
    NAVLUNGO_DEFAULT_BARCODE_FORMAT: 'pdf-A6',
    ...overrides,
  };
}

function buildLogger() {
  const lines: string[] = [];
  return {
    lines,
    logger: {
      log: (value?: unknown) => {
        lines.push(String(value ?? ''));
      },
      error: (value?: unknown) => {
        lines.push(String(value ?? ''));
      },
    },
  };
}

function registerCreatePostProbeRoute(env: Record<string, unknown>) {
  const posts = new Map<string, (request: { authUser?: { role?: string }; body?: { confirm?: string } }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => unknown>();
  const app = {
    get: vi.fn(),
    post: vi.fn((path: string, ...args: unknown[]) => {
      const handler = args.at(-1) as (
        request: { authUser?: { role?: string }; body?: { confirm?: string } },
        reply: { code: (status: number) => { send: (body: unknown) => unknown } },
      ) => unknown;
      posts.set(path, handler);
    }),
  };
  registerDiagnosticsRoutes(app as never, env as never);
  return posts.get('/admin/diagnostics/navlungo/create-post-probe');
}

function buildReply() {
  return {
    code: vi.fn((status: number) => ({
      send: vi.fn((body: unknown) => ({ status, body })),
    })),
  };
}

function buildMockFetch() {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });

    if (String(url).endsWith('/auth/api')) {
      return new Response(JSON.stringify({
        status: true,
        message: 'Success',
        data: {
          access_token: 'secret-access-token',
          refresh_token: 'secret-refresh-token',
          expires_in: 86400,
          token_type: 'Bearer',
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (String(url).includes('/post/check/')) {
      return new Response(JSON.stringify({
        status: true,
        message: null,
        data: {
          post_number: 'NP12345',
          tracking_url: 'https://track.example.test/check/NP12345',
          barcode: 'https://barcode.example.test/NP12345.pdf',
          post: {
            carrier_id: 9,
            carrier_name: 'Sürat Kargo',
          },
          status: {
            status_code: 1,
            status_name: 'To be Picked Up',
          },
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      post_number: 'NP12345',
      reference_id: 'NAVLUNGO-PROBE-1700000000000',
      tracking_url: 'https://track.example.test/check/NP12345',
      barcode_url: 'https://barcode.example.test/NP12345.pdf',
      barcode: 'https://barcode.example.test/NP12345.pdf',
      post: {
        carrier_id: 9,
        carrier_name: 'Sürat Kargo',
      },
    }), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  return { calls, fetchImpl };
}

describe('manual Navlungo Create Post probe', () => {
  it('refuses to run without NAVLUNGO_CREATE_POST_PROBE_CONFIRM=YES', () => {
    expect(validateNavlungoCreatePostProbeEnv(buildProbeEnv({ NAVLUNGO_CREATE_POST_PROBE_CONFIRM: undefined }))).toEqual({
      ok: false,
      reason: 'NAVLUNGO_CREATE_POST_PROBE_CONFIRM=YES is required for the manual Navlungo Create Post probe.',
      diagnostics: {
        createPostProbeEnvPresent: false,
        createPostProbeEnvValueIsYES: false,
      },
    });
  });

  it('intentionally rejects lowercase create post probe confirmation', () => {
    expect(validateNavlungoCreatePostProbeEnv(buildProbeEnv({ NAVLUNGO_CREATE_POST_PROBE_CONFIRM: 'yes' }))).toEqual({
      ok: false,
      reason: 'NAVLUNGO_CREATE_POST_PROBE_CONFIRM=YES is required for the manual Navlungo Create Post probe.',
      diagnostics: {
        createPostProbeEnvPresent: true,
        createPostProbeEnvValueIsYES: false,
      },
    });
  });

  it('accepts whitespace-trimmed YES confirmation', () => {
    expect(validateNavlungoCreatePostProbeEnv(buildProbeEnv({ NAVLUNGO_CREATE_POST_PROBE_CONFIRM: ' YES ' }))).toEqual({ ok: true });
  });

  it('refuses to run without required credentials and config', () => {
    expect(
      validateNavlungoCreatePostProbeEnv(buildProbeEnv({
        NAVLUNGO_API_USERNAME: '',
        NAVLUNGO_API_PASSWORD: '',
        NAVLUNGO_DEFAULT_SENDER_ADDRESS_ID: '',
      })),
    ).toEqual({
      ok: false,
      reason:
        'NAVLUNGO_API_USERNAME, NAVLUNGO_API_PASSWORD, NAVLUNGO_DEFAULT_SENDER_ADDRESS_ID required for the manual Navlungo Create Post probe.',
      diagnostics: {
        createPostProbeEnvPresent: true,
        createPostProbeEnvValueIsYES: true,
      },
    });
  });

  it('defaults Create Post probe carrier_id to Sürat Kargo when env is missing', () => {
    const env = buildProbeEnv({ NAVLUNGO_DEFAULT_CARRIER_ID: undefined });
    const payload = buildNavlungoCreatePostProbePayload(env, () => 1700000000000);

    expect(parseNavlungoCreatePostProbeCarrierId(env)).toBe(9);
    expect(payload.posts[0].carrier_id).toBe(9);
    expect(payload.posts[0].post_type).toBe(2);
    expect(payload.posts[0].barcode_format).toBe('pdf-A6');
  });

  it('omits COD and price fields from the normal static test payload', () => {
    const payload = buildNavlungoCreatePostProbePayload(buildProbeEnv(), () => 1700000000000);

    expect(payload.posts[0]).not.toHaveProperty('cod_payment_type');
    expect(payload.posts[0].post).not.toHaveProperty('price');
  });

  it('uses documented Turkish phone formatting in the static test payload', () => {
    const payload = buildNavlungoCreatePostProbePayload(buildProbeEnv(), () => 1700000000000);

    expect(payload.posts[0].sender.phone).toBe('+90 532 123 45 67');
    expect(payload.posts[0].recipient.phone).toBe('+90 532 123 45 68');
  });

  it('allows NAVLUNGO_DEFAULT_CARRIER_ID to override the probe carrier', () => {
    const env = buildProbeEnv({ NAVLUNGO_DEFAULT_CARRIER_ID: '10' });
    const payload = buildNavlungoCreatePostProbePayload(env, () => 1700000000000);

    expect(parseNavlungoCreatePostProbeCarrierId(env)).toBe(10);
    expect(payload.posts[0].carrier_id).toBe(10);
  });

  it('fails safely when NAVLUNGO_DEFAULT_CARRIER_ID is invalid', () => {
    expect(validateNavlungoCreatePostProbeEnv(buildProbeEnv({ NAVLUNGO_DEFAULT_CARRIER_ID: 'surat' }))).toEqual({
      ok: false,
      reason: 'NAVLUNGO_DEFAULT_CARRIER_ID must be a positive numeric carrier id when provided.',
      diagnostics: {
        createPostProbeEnvPresent: true,
        createPostProbeEnvValueIsYES: true,
      },
    });
    expect(() => buildNavlungoCreatePostProbePayload(buildProbeEnv({ NAVLUNGO_DEFAULT_CARRIER_ID: 'surat' }))).toThrow(
      'NAVLUNGO_DEFAULT_CARRIER_ID must be a positive numeric carrier id when provided.',
    );
  });

  it('authenticates before Create Post and sends Authorization bearer token', async () => {
    const { calls, fetchImpl } = buildMockFetch();
    const { logger } = buildLogger();

    await runManualNavlungoCreatePostProbe({
      env: buildProbeEnv(),
      fetchImpl,
      logger,
      now: () => 1700000000000,
    });

    expect(calls.map((call) => [call.init.method, call.url])).toEqual([
      ['POST', 'https://domestic-api.navlungo.com/v2/auth/api'],
      ['POST', 'https://domestic-api.navlungo.com/v2/post/create'],
    ]);
    expect(calls[1].init.headers).toMatchObject({
      Authorization: 'Bearer secret-access-token',
      'Content-Type': 'application/json',
      'X-localization': 'en',
    });
    expect(calls[1].init.body).toEqual(JSON.stringify(buildNavlungoCreatePostProbePayload(buildProbeEnv(), () => 1700000000000)));
  });

  it('summarizes Create Post request shape without exposing PII or secrets', () => {
    const payload = buildNavlungoCreatePostProbePayload(buildProbeEnv(), () => 1700000000000);
    const summary = summarizeNavlungoCreatePostRequest(payload, { NAVLUNGO_BASE_URL: 'https://domestic-api.navlungo.com/v2' });
    const serialized = JSON.stringify(summary);

    expect(summary).toMatchObject({
      baseUrl: 'domestic-api.navlungo.com/v2',
      endpointPath: '/post/create',
      method: 'POST',
      headerKeys: ['Accept', 'Authorization', 'Content-Type', 'X-localization'],
      topLevelBodyKeys: ['platform', 'posts'],
      requestedCarrierId: 9,
      requestedPostType: 2,
      senderUsesAddressId: false,
      senderFullObjectKeysPresent: true,
      codPaymentTypePresent: false,
      postPricePresent: false,
    });
    expect(summary.senderKeys).toEqual(['address', 'city', 'country', 'district', 'email', 'name', 'phone', 'post_code']);
    expect(summary.recipientKeys).toEqual(['address', 'city', 'country', 'district', 'email', 'name', 'phone', 'post_code']);
    expect(summary.postPayloadKeys).toEqual(['desi', 'note', 'package_count']);
    expect(serialized).not.toContain('secret-password');
    expect(serialized).not.toContain('api-user');
    expect(serialized).not.toContain('+90 532 123 45 67');
    expect(serialized).not.toContain('sender.test@example.invalid');
    expect(serialized).not.toContain('recipient.test@example.invalid');
    expect(serialized).not.toContain('Navlungo Test Sender');
    expect(serialized).not.toContain('Navlungo Test Recipient');
    expect(serialized).not.toContain('Navlungo manual probe sender address');
    expect(serialized).not.toContain('NAVLUNGO-PROBE-1700000000000');
  });

  it('returns Create Post probe request summary for comparing against real retry shape', async () => {
    const { fetchImpl } = buildMockFetch();
    const { runNavlungoCreatePostProbeDiagnostics } = await import('../backend/src/modules/shipping/navlungo-create-post-probe.js');

    const diagnostics = await runNavlungoCreatePostProbeDiagnostics({
      env: buildProbeEnv(),
      fetchImpl,
      now: () => 1700000000000,
    });

    expect(diagnostics.requestSummary).toMatchObject({
      endpointPath: '/post/create',
      requestedCarrierId: 9,
      requestedPostType: 2,
      senderUsesAddressId: false,
      senderFullObjectKeysPresent: true,
      codPaymentTypePresent: false,
      postPricePresent: false,
    });
    expect(JSON.stringify(diagnostics.requestSummary)).not.toContain('secret-access-token');
    expect(JSON.stringify(diagnostics.requestSummary)).not.toContain('recipient.test@example.invalid');
  });

  it('does not expose token, password, username, or PII in output', async () => {
    const { fetchImpl } = buildMockFetch();
    const { logger, lines } = buildLogger();

    await runManualNavlungoCreatePostProbe({
      env: buildProbeEnv(),
      fetchImpl,
      logger,
      now: () => 1700000000000,
    });

    const output = lines.join('\n');
    expect(output).not.toContain('secret-access-token');
    expect(output).not.toContain('secret-refresh-token');
    expect(output).not.toContain('secret-password');
    expect(output).not.toContain('api-user');
    expect(output).not.toContain('+90 532 123 45 67');
    expect(output).not.toContain('sender.test@example.invalid');
    expect(output).not.toContain('recipient.test@example.invalid');
    expect(output).toContain('"postNumber": "NP12345"');
    expect(output).toContain('"trackingUrlPresent": true');
    expect(output).toContain('"barcodeUrlPresent": true');
    expect(output).toContain('"barcodePresent": true');
  });

  it('captures post number, tracking, barcode, and carrier presence', () => {
    expect(
      summarizeNavlungoCreatePostResponse({
        post_number: 'NP12345',
        reference_id: 'REF-1',
        tracking_url: 'https://track.example.test/check/NP12345',
        barcode_url: 'https://barcode.example.test/NP12345.pdf',
        barcode: 'https://barcode.example.test/NP12345.pdf',
        post: {
          carrier_id: 9,
          carrier_name: 'Sürat Kargo',
        },
      }),
    ).toMatchObject({
      postNumber: 'NP12345',
      postNumberPresent: true,
      referenceId: 'REF-1',
      referenceIdPresent: true,
      trackingUrlPresent: true,
      barcodeUrlPresent: true,
      barcodePresent: true,
      barcodeType: 'string',
      carrierIdPresent: true,
      carrierId: 9,
      carrierNamePresent: true,
      carrierName: 'Sürat Kargo',
      postCarrierKeys: ['carrier_id', 'carrier_name'],
    });
  });

  it('captures live-style data wrapped Create Post response fields', () => {
    expect(
      summarizeNavlungoCreatePostResponse({
        status: true,
        message: 'Your transaction will be successfully created if your wallet balance is sufficient.',
        data: {
          post_number: 'NP12345',
          reference_id: 'REF-1',
          tracking_url: 'https://track.example.test/check/NP12345',
          barcode: 'https://barcode.example.test/NP12345.pdf',
          post: {
            carrier_id: 9,
            carrier_name: 'Sürat Kargo',
          },
        },
      }),
    ).toMatchObject({
      dataKeys: ['post_number', 'reference_id', 'tracking_url', 'barcode', 'post'],
      postNumber: 'NP12345',
      trackingUrlPresent: true,
      barcodeUrlPresent: false,
      barcodePresent: true,
      carrierId: 9,
      carrierName: 'Sürat Kargo',
      providerMessage: 'Your transaction will be successfully created if your wallet balance is sufficient.',
    });
  });

  it('summarizes Check Post response fields safely', () => {
    expect(
      summarizeNavlungoCheckPostResponse({
        status: true,
        message: null,
        data: {
          post_number: 'NP12345',
          tracking_url: 'https://track.example.test/check/NP12345',
          carrier_tracking_url: 'https://carrier.example.test/NP12345',
          barcode: 'https://barcode.example.test/NP12345.pdf',
          post: {
            carrier_id: 9,
            carrier_name: 'Sürat Kargo',
          },
          status: {
            status_code: 1,
            status_name: 'To be Picked Up',
          },
        },
      }),
    ).toMatchObject({
      postNumberPresent: true,
      trackingUrlPresent: true,
      carrierTrackingUrlPresent: true,
      barcodePresent: true,
      barcodeType: 'string',
      carrierIdPresent: true,
      carrierNamePresent: true,
      statusCode: 1,
      statusName: 'To be Picked Up',
    });
  });

  it('Check Post probe uses returned post_number and does not create posts', async () => {
    const { calls, fetchImpl } = buildMockFetch();

    const result = await runNavlungoCheckPostProbeDiagnostics({
      env: buildProbeEnv(),
      fetchImpl,
      postNumber: 'NP12345',
    });

    expect(calls.map((call) => [call.init.method, call.url])).toEqual([
      ['POST', 'https://domestic-api.navlungo.com/v2/auth/api'],
      ['GET', 'https://domestic-api.navlungo.com/v2/post/check/NP12345'],
    ]);
    expect(calls.some((call) => call.url.includes('post/create'))).toBe(false);
    expect(result).toMatchObject({
      postNumber: 'NP12345',
      checkPostHttpStatus: 200,
      trackingUrlPresent: true,
      barcodePresent: true,
      carrierIdPresent: true,
      carrierNamePresent: true,
    });
    expect(JSON.stringify(result)).not.toContain('secret-access-token');
    expect(JSON.stringify(result)).not.toContain('secret-password');
  });

  it('Barcode probe is gated by post_number and does not guess endpoint path', () => {
    expect(() => runNavlungoBarcodeProbeDiagnostics('')).toThrow('postNumber is required for the Navlungo Barcode probe.');
    expect(runNavlungoBarcodeProbeDiagnostics('NP12345')).toMatchObject({
      provider: 'navlungo',
      dormant: true,
      postNumber: 'NP12345',
      barcodeEndpointPathKnown: false,
      skippedReason: 'barcode_endpoint_path_unknown',
      barcodeHttpStatus: null,
      barcodeFieldPresent: false,
      barcodeUrlPresent: false,
      barcodeBase64Present: false,
    });
  });

  it('redacts sensitive fields if sanitization is used for errors', () => {
    expect(
      sanitizeNavlungoProbeOutput({
        access_token: 'secret',
        password: 'secret',
        recipient: {
          name: 'Customer',
          phone: '+90 555 000 00 00',
          safe: 'visible',
        },
      }),
    ).toEqual({
      access_token: '[redacted]',
      password: '[redacted]',
      recipient: {
        name: '[redacted]',
        phone: '[redacted]',
        safe: 'visible',
      },
    });
  });

  it('diagnostics endpoint requires env guard before provider calls', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchImpl;

    try {
      const handler = registerCreatePostProbeRoute(buildProbeEnv({ NAVLUNGO_CREATE_POST_PROBE_CONFIRM: undefined }));
      const result = await handler?.({ authUser: { role: 'admin' }, body: { confirm: 'YES' } }, buildReply());

      expect(result).toMatchObject({
        status: 400,
        body: {
          message: 'NAVLUNGO_CREATE_POST_PROBE_CONFIRM=YES is required for the manual Navlungo Create Post probe.',
          diagnostics: {
            createPostProbeEnvPresent: false,
            createPostProbeEnvValueIsYES: false,
          },
        },
      });
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('diagnostics endpoint requires UI confirmation before provider calls', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchImpl;

    try {
      const handler = registerCreatePostProbeRoute(buildProbeEnv());
      const result = await handler?.({ authUser: { role: 'admin' }, body: { confirm: 'NO' } }, buildReply());

      expect(result).toMatchObject({
        status: 400,
        body: { message: 'UI confirmation is required before running the Navlungo Create Post probe.' },
      });
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('diagnostics endpoint returns sanitized Create Post probe result', async () => {
    const { calls, fetchImpl } = buildMockFetch();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchImpl;

    try {
      const handler = registerCreatePostProbeRoute(buildProbeEnv());
      const result = await handler?.({ authUser: { role: 'admin' }, body: { confirm: 'YES' } }, buildReply());

      expect(result).toMatchObject({
        provider: 'navlungo',
        dormant: true,
        authHttpStatus: 200,
        authTokenReceived: true,
        requestedCarrierId: 9,
        requestedPostType: 2,
        requestedBarcodeFormat: 'pdf-A6',
        codPaymentIncluded: false,
        priceIncluded: false,
        requestSummary: {
          headerKeys: ['Accept', 'Authorization', 'Content-Type', 'X-localization'],
          endpointPath: '/post/create',
          senderUsesAddressId: false,
        },
        createPostHttpStatus: 201,
        postNumber: 'NP12345',
        trackingUrlPresent: true,
        barcodeUrlPresent: true,
        barcodePresent: true,
        barcodeType: 'string',
        carrierIdPresent: true,
        carrierId: 9,
        carrierNamePresent: true,
        carrierName: 'Sürat Kargo',
      });
      expect(calls.map((call) => [call.init.method, call.url])).toEqual([
        ['POST', 'https://domestic-api.navlungo.com/v2/auth/api'],
        ['POST', 'https://domestic-api.navlungo.com/v2/post/create'],
      ]);
      expect(JSON.stringify(result)).not.toContain('secret-access-token');
      expect(JSON.stringify(result)).not.toContain('secret-password');
      expect(JSON.stringify(result)).not.toContain('Bearer');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
