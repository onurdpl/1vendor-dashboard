import { describe, expect, it } from 'vitest';
import {
  runManualKargonomiForwardProbe,
  sanitizeKargonomiProbeOutput,
  validateKargonomiProbeEnv,
} from '../backend/src/modules/shipping/kargonomi-forward-probe.js';

function buildMockFetch() {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });

    if (String(url).includes('/shipment-price-comparison/')) {
      return new Response(
        JSON.stringify({
          shipping_provider_with_price: [{ id: 5, name: 'Sürat Kargo', slug: 'surat', price: '22.67 + KDV' }],
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      );
    }

    return new Response(
      JSON.stringify({
        id: 123,
        buyer_name: 'Sensitive Buyer',
        buyer_phone: '5551112233',
        Authorization: 'Bearer should-not-print',
      }),
      {
        status: 200,
        headers: { 'content-type': 'application/json' },
      },
    );
  }) as typeof fetch;

  return { calls, fetchImpl };
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

describe('manual Kargonomi forward probe guards', () => {
  it('refuses to run without KARGONOMI_PROBE_CONFIRM=YES', () => {
    expect(validateKargonomiProbeEnv({ KARGONOMI_API_TOKEN: 'token' })).toEqual({
      ok: false,
      reason: 'KARGONOMI_PROBE_CONFIRM=YES is required for the manual/dev Kargonomi probe.',
    });
  });

  it('refuses to run without KARGONOMI_API_TOKEN', () => {
    expect(validateKargonomiProbeEnv({ KARGONOMI_PROBE_CONFIRM: 'YES' })).toEqual({
      ok: false,
      reason: 'KARGONOMI_API_TOKEN is required for the manual/dev Kargonomi probe.',
    });
  });

  it('requires explicit shipping provider id before price confirmation', () => {
    expect(
      validateKargonomiProbeEnv({
        KARGONOMI_PROBE_CONFIRM: 'YES',
        KARGONOMI_API_TOKEN: 'token',
        KARGONOMI_PROBE_CONFIRM_PRICE: 'YES',
      }),
    ).toEqual({
      ok: false,
      reason: 'KARGONOMI_PROBE_SHIPPING_PROVIDER_ID is required when KARGONOMI_PROBE_CONFIRM_PRICE=YES.',
    });
  });

  it('stops after draft shipment and price comparison by default', async () => {
    const { calls, fetchImpl } = buildMockFetch();
    const { logger, lines } = buildLogger();

    await runManualKargonomiForwardProbe({
      env: {
        KARGONOMI_PROBE_CONFIRM: 'YES',
        KARGONOMI_API_TOKEN: 'secret-token',
        KARGONOMI_APP_KEY: 'secret-app-key',
      },
      fetchImpl,
      logger,
    });

    expect(calls.map((call) => [call.init.method, call.url])).toEqual([
      ['POST', 'https://app.kargonomi.com.tr/api/v1/shipments'],
      ['GET', 'https://app.kargonomi.com.tr/api/v1/shipment-price-comparison/123'],
    ]);
    expect(lines.join('\n')).toContain('Stopping before price confirmation.');
  });

  it('does not print secrets or PII in sanitized probe output', async () => {
    const { fetchImpl } = buildMockFetch();
    const { logger, lines } = buildLogger();

    await runManualKargonomiForwardProbe({
      env: {
        KARGONOMI_PROBE_CONFIRM: 'YES',
        KARGONOMI_API_TOKEN: 'secret-token',
        KARGONOMI_APP_KEY: 'secret-app-key',
      },
      fetchImpl,
      logger,
    });

    const output = lines.join('\n');
    expect(output).not.toContain('secret-token');
    expect(output).not.toContain('secret-app-key');
    expect(output).not.toContain('Sensitive Buyer');
    expect(output).not.toContain('5551112233');
    expect(output).not.toContain('should-not-print');
    expect(output).toContain('[redacted]');
  });

  it('redacts nested token and customer fields', () => {
    expect(
      sanitizeKargonomiProbeOutput({
        token: 'secret',
        buyer: {
          buyer_name: 'Customer',
          buyer_address: 'Address',
          nested: { apiKey: 'also-secret', safe: 'ok' },
        },
      }),
    ).toEqual({
      token: '[redacted]',
      buyer: {
        buyer_name: '[redacted]',
        buyer_address: '[redacted]',
        nested: { apiKey: '[redacted]', safe: 'ok' },
      },
    });
  });
});
