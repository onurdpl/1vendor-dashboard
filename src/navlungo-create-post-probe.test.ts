import { describe, expect, it } from 'vitest';
import {
  buildNavlungoCreatePostProbePayload,
  runManualNavlungoCreatePostProbe,
  sanitizeNavlungoProbeOutput,
  summarizeNavlungoCreatePostResponse,
  validateNavlungoCreatePostProbeEnv,
} from '../backend/src/modules/shipping/navlungo-create-post-probe.js';

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

    return new Response(JSON.stringify({
      post_number: 'NP12345',
      reference_id: 'NAVLUNGO-PROBE-1700000000000',
      tracking_url: 'https://track.example.test/check/NP12345',
      barcode_url: 'https://barcode.example.test/NP12345.pdf',
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
    });
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
    });
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
    expect(output).not.toContain('+90 555 000 00 01');
    expect(output).not.toContain('sender.test@example.invalid');
    expect(output).not.toContain('recipient.test@example.invalid');
    expect(output).toContain('"postNumber": "NP12345"');
    expect(output).toContain('"trackingUrlPresent": true');
    expect(output).toContain('"barcodeUrlPresent": true');
  });

  it('captures post number, tracking, barcode, and carrier presence', () => {
    expect(
      summarizeNavlungoCreatePostResponse({
        post_number: 'NP12345',
        reference_id: 'REF-1',
        tracking_url: 'https://track.example.test/check/NP12345',
        barcode_url: 'https://barcode.example.test/NP12345.pdf',
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
      carrierIdPresent: true,
      carrierNamePresent: true,
      postCarrierKeys: ['carrier_id', 'carrier_name'],
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
});
