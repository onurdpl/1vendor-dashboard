import { describe, expect, it, vi } from 'vitest';
import {
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
    expect(output).toContain('"firstLocationNames"');
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
    expect(output).toContain('"label": "GET /states/1"');
    expect(output).toContain('"fetchFailed": true');
    expect(output).toContain('"name": "TypeError"');
    expect(output).toContain('"message": "fetch failed"');
    expect(output).not.toContain('secret-token');
  });
});
