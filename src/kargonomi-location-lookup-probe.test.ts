import { describe, expect, it, vi } from 'vitest';
import {
  runKargonomiLocationLookupDiagnostics,
  runManualKargonomiLocationLookupProbe,
  validateKargonomiLookupProbeEnv,
} from '../backend/src/modules/shipping/kargonomi-location-lookup-probe.js';

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

describe('manual Kargonomi location lookup probe', () => {
  it('refuses to run without KARGONOMI_LOOKUP_PROBE_CONFIRM=YES', () => {
    expect(validateKargonomiLookupProbeEnv({ KARGONOMI_API_TOKEN: 'token' })).toEqual({
      ok: false,
      reason: 'KARGONOMI_LOOKUP_PROBE_CONFIRM=YES is required for the manual Kargonomi location lookup probe.',
    });
  });

  it('refuses to run without KARGONOMI_API_TOKEN', () => {
    expect(validateKargonomiLookupProbeEnv({ KARGONOMI_LOOKUP_PROBE_CONFIRM: 'YES' })).toEqual({
      ok: false,
      reason: 'KARGONOMI_API_TOKEN is required for the manual Kargonomi location lookup probe.',
    });
  });

  it('calls states and Istanbul cities lookups without printing the token', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      const body = String(url).endsWith('/states/1')
        ? { data: [{ id: 34, name: 'İstanbul' }, { id: 6, name: 'Ankara' }] }
        : { data: [{ id: 829, name: 'Kartal' }, { id: 830, name: 'Kadıköy' }] };

      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    const { logger, lines } = buildLogger();

    await runManualKargonomiLocationLookupProbe({
      env: {
        KARGONOMI_LOOKUP_PROBE_CONFIRM: 'YES',
        KARGONOMI_API_TOKEN: 'secret-token',
        KARGONOMI_BASE_URL: 'https://app.kargonomi.com.tr/api/v1',
      },
      fetchImpl,
      logger,
    });

    expect(calls.map((call) => [call.init.method, call.url])).toEqual([
      ['GET', 'https://app.kargonomi.com.tr/api/v1/states/1'],
      ['GET', 'https://app.kargonomi.com.tr/api/v1/cities/34'],
    ]);
    const output = lines.join('\n');
    expect(output).not.toContain('secret-token');
    expect(output).toContain('"tokenPresent": true');
    expect(output).toContain('"firstStateNames"');
    expect(output).toContain('İstanbul');
    expect(output).toContain('Kartal');
  });

  it('handles fetch failed with useful diagnostics', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('fetch failed')) as unknown as typeof fetch;
    const { logger, lines } = buildLogger();

    await runManualKargonomiLocationLookupProbe({
      env: {
        KARGONOMI_LOOKUP_PROBE_CONFIRM: 'YES',
        KARGONOMI_API_TOKEN: 'secret-token',
      },
      fetchImpl,
      logger,
    });

    const output = lines.join('\n');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(output).toContain('"statesRequestUrl": "/states/1"');
    expect(output).toContain('"statesFetchError"');
    expect(output).toContain('"name": "TypeError"');
    expect(output).toContain('"message": "fetch failed"');
    expect(output).not.toContain('secret-token');
  });

  it('returns sanitized diagnostics for fetch failed without throwing', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('fetch failed')) as unknown as typeof fetch;

    const result = await runKargonomiLocationLookupDiagnostics(
      {
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
        SHIPPING_PROVIDER: 'kargonomi',
        KARGO_ENTEGRATOR_ENABLED: false,
        KARGO_ENTEGRATOR_WEBHOOK_INGEST_ENABLED: false,
        TRY_OTO_ENABLED: false,
        TRY_OTO_SANDBOX_MODE: false,
        TRY_OTO_WEBHOOK_INGEST_ENABLED: false,
        KARGONOMI_BASE_URL: 'https://app.kargonomi.com.tr/api/v1',
        KARGONOMI_API_TOKEN: 'secret-token',
      },
      { fetchImpl },
    );

    expect(result).toMatchObject({
      baseUrlHost: 'app.kargonomi.com.tr',
      baseUrlPath: '/api/v1',
      tokenPresent: true,
      statesRequestUrl: '/states/1',
      statesFetchError: {
        name: 'TypeError',
        message: 'fetch failed',
      },
    });
    expect(JSON.stringify(result)).not.toContain('secret-token');
  });
});
