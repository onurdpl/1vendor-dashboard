import { describe, expect, it, vi } from 'vitest';
import { runLidioCreateSubsellerProbe } from '../backend/src/scripts/lidioCreateSubsellerProbe.js';

function buildEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    LIDIO_ENABLED: 'true',
    LIDIO_BASE_URL: 'https://test.lidio.com/api',
    LIDIO_MERCHANT_CODE: 'SPORGYM',
    LIDIO_AUTHORIZATION_SCHEME: 'MxS2S',
    LIDIO_AUTHORIZATION_TOKEN: 'test-token',
    LIDIO_SUBSELLER_PROFILE_ID: '3',
    ...overrides,
  };
}

function buildLogger() {
  return {
    log: vi.fn(),
    error: vi.fn(),
  };
}

describe('Lidio CreateSubseller sandbox probe', () => {
  it('exits before sending a request when the write probe flag is not enabled', async () => {
    const fetchImpl = vi.fn();
    const logger = buildLogger();

    const result = await runLidioCreateSubsellerProbe({
      env: buildEnv({ LIDIO_ALLOW_WRITE_PROBE: undefined }),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      logger,
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      endpoint: '/CreateSubseller',
      writesPerformed: false,
    });
  });

  it('sends one CreateSubseller request with fake sandbox data when explicitly enabled', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          result: 'Success',
          resultMessage: null,
          subsellerId: 12345,
          contactEmail: 'should-be-redacted@example.invalid',
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json; charset=utf-8',
          },
        },
      ),
    );
    const logger = buildLogger();

    const result = await runLidioCreateSubsellerProbe({
      env: buildEnv({ LIDIO_ALLOW_WRITE_PROBE: 'true' }),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      logger,
      now: () => new Date('2026-06-05T12:34:56.000Z'),
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, request] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://test.lidio.com/api/CreateSubseller');
    expect(request.method).toBe('POST');
    expect(request.headers).toMatchObject({
      MerchantCode: 'SPORGYM',
      Authorization: 'MxS2S test-token',
    });
    expect(JSON.parse(String(request.body))).toMatchObject({
      companyName: 'Sporgym Lidio Sandbox Vendor 20260605123456',
      companyType: 'Limited',
      vkntckn: '9999999994',
      subsellerIdGivenByMerchant: 'SPORGYM-LIDIO-SANDBOX-20260605123456',
      subsellerProfileId: 3,
      payOutNotAllowed: true,
    });
    expect(result).toMatchObject({
      endpoint: '/CreateSubseller',
      status: 200,
      result: 'Success',
      resultMessage: null,
      subsellerId: 12345,
      writesPerformed: true,
      responseBody: {
        result: 'Success',
        resultMessage: null,
        subsellerId: 12345,
        contactEmail: '[redacted]',
      },
    });
  });
});
