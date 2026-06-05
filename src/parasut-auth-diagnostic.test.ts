import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppEnv } from '../backend/src/config/env.js';
import { runParasutAuthMeDiagnostic, runParasutEnvDiagnostic } from '../backend/src/modules/parasut/parasut-auth-me-diagnostic.js';
import { registerParasutProbeRoutes } from '../backend/src/modules/parasut/parasut-probe.routes.js';

const PARASUT_SECRET_VALUES = {
  clientId: 'client-id-secret',
  clientSecret: 'client-secret-value',
  username: 'parasut-user@example.test',
  password: 'parasut-password-secret',
  accessToken: 'oauth-access-token-secret',
  refreshToken: 'oauth-refresh-token-secret',
};

function buildEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    PARASUT_ENABLED: 'true',
    PARASUT_TEST_MODE: 'true',
    PARASUT_BASE_URL: 'https://api.heroku-staging.parasut.com',
    PARASUT_COMPANY_ID: '35427',
    PARASUT_CLIENT_ID: PARASUT_SECRET_VALUES.clientId,
    PARASUT_CLIENT_SECRET: PARASUT_SECRET_VALUES.clientSecret,
    PARASUT_REDIRECT_URI: 'urn:ietf:wg:oauth:2.0:oob',
    PARASUT_GRANT_TYPE: 'password',
    PARASUT_USERNAME: PARASUT_SECRET_VALUES.username,
    PARASUT_PASSWORD: PARASUT_SECRET_VALUES.password,
    ...overrides,
  };
}

function buildAppEnv() {
  return {
    JWT_SECRET: 'test-secret',
    JWT_EXPIRES_IN: '1h',
  } as AppEnv;
}

function buildReply() {
  const reply = {
    statusCode: 200,
    payload: undefined as unknown,
    code: vi.fn((status: number) => {
      reply.statusCode = status;
      return reply;
    }),
    send: vi.fn((payload: unknown) => {
      reply.payload = payload;
      return payload;
    }),
  };

  return reply;
}

function registerRoute(pathToCapture = '/admin/probes/parasut/auth-me', method: 'get' | 'post' = 'get') {
  let handler:
    | ((request: { authUser?: { role?: string } }, reply: ReturnType<typeof buildReply>) => Promise<unknown>)
    | null = null;
  const app = {
    get: vi.fn((path: string, ...args: unknown[]) => {
      if (method === 'get' && path === pathToCapture) {
        handler = args.at(-1) as typeof handler;
      }
    }),
    post: vi.fn((path: string, ...args: unknown[]) => {
      if (method === 'post' && path === pathToCapture) {
        handler = args.at(-1) as typeof handler;
      }
    }),
  };
  registerParasutProbeRoutes(app as never, buildAppEnv());
  return handler;
}

function mockJsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function expectNoSecrets(value: unknown) {
  const text = JSON.stringify(value);
  for (const secret of Object.values(PARASUT_SECRET_VALUES)) {
    expect(text).not.toContain(secret);
  }
}

describe('Paraşüt auth/me diagnostic probe', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('rejects non-admin users', async () => {
    process.env.ADMIN_PROBES_ENABLED = 'true';
    Object.assign(process.env, buildEnv());
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const handler = registerRoute();
    const reply = buildReply();
    const result = await handler?.({ authUser: { role: 'vendor' } }, reply);

    expect(result).toEqual({ message: 'Forbidden' });
    expect(reply.statusCode).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects admin users when admin probes are disabled', async () => {
    process.env.ADMIN_PROBES_ENABLED = 'false';
    Object.assign(process.env, buildEnv());
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const handler = registerRoute();
    const reply = buildReply();
    const result = await handler?.({ authUser: { role: 'admin' } }, reply);

    expect(result).toEqual({ ok: false, message: 'Admin probe endpoints are disabled.' });
    expect(reply.statusCode).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns safe env diagnostic presence and support confirmations without secret values', async () => {
    const fetchMock = vi.fn();
    const result = runParasutEnvDiagnostic({
      env: buildEnv(),
    });

    expect(result.statusCode).toBe(200);
    expect(result.body).toEqual({
      ok: true,
      envPresence: {
        PARASUT_CLIENT_ID: true,
        PARASUT_CLIENT_SECRET: true,
        PARASUT_USERNAME: true,
        PARASUT_PASSWORD: true,
        PARASUT_COMPANY_ID: true,
        PARASUT_REDIRECT_URI: true,
        PARASUT_GRANT_TYPE: true,
      },
      grantType: {
        passwordExpectedForCurrentProbeFlow: true,
        configured: true,
        matchesPasswordGrant: true,
        warning: null,
      },
      authConfirmation: {
        companyIdConfirmedCorrect: true,
        redirectUriRegisteredCorrectly: true,
        passwordGrantAllowed: true,
        authorizationCodeRequired: false,
        clientCredentialsMustBelongToConfiguredAccountEmail: true,
        testEinvoiceVkn: '6490512763',
      },
      writesPerformed: false,
      externalApiCallsPerformed: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expectNoSecrets(result.body);
  });

  it('warns when safe env diagnostic grant type is not password without returning the configured value', async () => {
    const result = runParasutEnvDiagnostic({
      env: buildEnv({ PARASUT_GRANT_TYPE: 'authorization_code' }),
    });

    expect(result.body).toEqual(
      expect.objectContaining({
        envPresence: expect.objectContaining({
          PARASUT_GRANT_TYPE: true,
        }),
        grantType: expect.objectContaining({
          configured: true,
          matchesPasswordGrant: false,
          warning: 'PARASUT_GRANT_TYPE should be password for the current Paraşüt probe flow.',
        }),
      }),
    );
    expect(JSON.stringify(result.body)).not.toContain('authorization_code');
    expectNoSecrets(result.body);
  });

  it('serves the safe env diagnostic through the guarded admin route', async () => {
    process.env.ADMIN_PROBES_ENABLED = 'true';
    Object.assign(process.env, buildEnv());
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const handler = registerRoute('/admin/probes/parasut/env-check');
    const reply = buildReply();
    const result = await handler?.({ authUser: { role: 'admin' } }, reply);

    expect(reply.statusCode).toBe(200);
    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        envPresence: expect.objectContaining({
          PARASUT_CLIENT_SECRET: true,
          PARASUT_PASSWORD: true,
        }),
        authConfirmation: expect.objectContaining({
          passwordGrantAllowed: true,
          authorizationCodeRequired: false,
          testEinvoiceVkn: '6490512763',
        }),
        externalApiCallsPerformed: false,
      }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expectNoSecrets(result);
  });

  it('rejects non-staging base URLs before OAuth', async () => {
    const fetchMock = vi.fn();
    const result = await runParasutAuthMeDiagnostic({
      env: buildEnv({ PARASUT_BASE_URL: 'https://api.parasut.com' }),
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(result.statusCode).toBe(422);
    expect(result.body).toEqual(
      expect.objectContaining({
        ok: false,
        oauthSuccess: false,
        meSuccess: false,
        writesPerformed: false,
        error: expect.objectContaining({
          code: 'parasut_staging_base_url_required',
        }),
      }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects production/test mode mismatch before OAuth', async () => {
    const fetchMock = vi.fn();
    const result = await runParasutAuthMeDiagnostic({
      env: buildEnv({ PARASUT_TEST_MODE: 'false' }),
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(result.statusCode).toBe(422);
    expect(result.body).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({
          code: 'parasut_test_mode_required',
        }),
      }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns env presence and /v4/me identifiers without secret values', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (String(url).endsWith('/oauth/token')) {
        return mockJsonResponse({
          access_token: PARASUT_SECRET_VALUES.accessToken,
          refresh_token: PARASUT_SECRET_VALUES.refreshToken,
        });
      }

      return mockJsonResponse({
        data: {
          id: '35427',
          type: 'companies',
          attributes: {
            name: 'Sporgym Test Company',
          },
        },
      });
    });

    const result = await runParasutAuthMeDiagnostic({
      env: buildEnv(),
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(result.statusCode).toBe(200);
    expect(result.body).toEqual(
      expect.objectContaining({
        ok: true,
        envPresence: {
          PARASUT_ENABLED: true,
          PARASUT_TEST_MODE: true,
          PARASUT_BASE_URL: true,
          PARASUT_COMPANY_ID: true,
          PARASUT_CLIENT_ID: true,
          PARASUT_CLIENT_SECRET: true,
          PARASUT_REDIRECT_URI: true,
          PARASUT_USERNAME: true,
          PARASUT_PASSWORD: true,
        },
        baseUrl: 'https://api.heroku-staging.parasut.com',
        companyId: '35427',
        oauthSuccess: true,
        meSuccess: true,
        configuredCompanyIdMatchesMe: true,
        writesPerformed: false,
      }),
    );
    expect(result.body.me).toEqual(
      expect.objectContaining({
        identifiers: expect.objectContaining({
          companyIdCandidates: expect.arrayContaining(['35427']),
          companyNameCandidates: expect.arrayContaining(['Sporgym Test Company']),
        }),
      }),
    );
    expect(calls.map((call) => [call.init.method, call.url])).toEqual([
      ['POST', 'https://api.heroku-staging.parasut.com/oauth/token'],
      ['GET', 'https://api.heroku-staging.parasut.com/v4/me'],
    ]);
    expect(calls.some((call) => /contacts|products|sales_invoices|payments/.test(call.url))).toBe(false);
    expectNoSecrets(result.body);
  });

  it('sanitizes OAuth errors and does not call write endpoints', async () => {
    const fetchMock = vi.fn(async () =>
      mockJsonResponse(
        {
          error: 'invalid_grant',
          error_description: 'Invalid username or password.',
          access_token: PARASUT_SECRET_VALUES.accessToken,
          client_secret: PARASUT_SECRET_VALUES.clientSecret,
          password: PARASUT_SECRET_VALUES.password,
        },
        401,
      ),
    );

    const result = await runParasutAuthMeDiagnostic({
      env: buildEnv(),
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(result.statusCode).toBe(502);
    expect(result.body).toEqual(
      expect.objectContaining({
        ok: false,
        oauthSuccess: false,
        meSuccess: false,
        writesPerformed: false,
        oauth: expect.objectContaining({
          status: 401,
          bodyKeys: ['error', 'error_description'],
          error: 'invalid_grant',
          errorDescription: 'Invalid username or password.',
        }),
        error: expect.objectContaining({
          code: 'parasut_oauth_failed',
        }),
      }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://api.heroku-staging.parasut.com/oauth/token');
    expect(fetchMock.mock.calls.some((call) => /contacts|products|sales_invoices|payments/.test(String(call[0])))).toBe(false);
    expectNoSecrets(result.body);
  });

  it('redacts token-like substrings from OAuth diagnostic error strings', async () => {
    const fetchMock = vi.fn(async () =>
      mockJsonResponse(
        {
          error: `invalid_token token=${PARASUT_SECRET_VALUES.accessToken}`,
          error_description: `Authorization Bearer ${PARASUT_SECRET_VALUES.accessToken}; client_secret=${PARASUT_SECRET_VALUES.clientSecret}; password=${PARASUT_SECRET_VALUES.password}; jwt=eyJabc.def.ghi`,
        },
        400,
      ),
    );

    const result = await runParasutAuthMeDiagnostic({
      env: buildEnv(),
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(result.statusCode).toBe(502);
    expect(result.body).toEqual(
      expect.objectContaining({
        ok: false,
        oauthSuccess: false,
        meSuccess: false,
        writesPerformed: false,
        oauth: expect.objectContaining({
          status: 400,
          bodyKeys: ['error', 'error_description'],
          error: 'invalid_token token=[redacted]',
          errorDescription: 'Authorization Bearer [redacted]; client_secret=[redacted]; password=[redacted]; jwt=[redacted-jwt]',
          tokenReceived: false,
        }),
      }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.some((call) => /contacts|products|sales_invoices|payments/.test(String(call[0])))).toBe(false);
    expectNoSecrets(result.body);
  });
});

describe('Paraşüt commission invoice test endpoint', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = {
      ...originalEnv,
      ADMIN_PROBES_ENABLED: 'true',
      NODE_ENV: 'test',
      PARASUT_ENABLED: 'true',
      PARASUT_TEST_MODE: 'true',
      PARASUT_BASE_URL: 'https://api.heroku-staging.parasut.com',
      PARASUT_COMPANY_ID: '35427',
      PARASUT_CLIENT_ID: PARASUT_SECRET_VALUES.clientId,
      PARASUT_CLIENT_SECRET: PARASUT_SECRET_VALUES.clientSecret,
      PARASUT_REDIRECT_URI: 'urn:ietf:wg:oauth:2.0:oob',
      PARASUT_USERNAME: PARASUT_SECRET_VALUES.username,
      PARASUT_PASSWORD: PARASUT_SECRET_VALUES.password,
      PARASUT_PROBE_CONFIRM: 'CREATE_COMMISSION_INVOICE_TEST',
      PARASUT_PROBE_ALLOW_LIFECYCLE: 'true',
    };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  function registerCommissionRoute() {
    return registerRoute('/admin/probes/parasut/commission-invoice-test', 'post');
  }

  function buildCommissionProbeFetch() {
    const calls: Array<{ method: string; url: string }> = [];
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const requestUrl = String(url);
      const method = init?.method ?? 'GET';
      calls.push({ method, url: requestUrl });

      if (/cancel|recover|archive/.test(requestUrl)) {
        throw new Error('Lifecycle action should not be called.');
      }

      if (requestUrl.endsWith('/oauth/token')) {
        return mockJsonResponse({
          access_token: PARASUT_SECRET_VALUES.accessToken,
          refresh_token: PARASUT_SECRET_VALUES.refreshToken,
        });
      }

      if (requestUrl.endsWith('/v4/me')) {
        return mockJsonResponse({ data: { id: '35427', type: 'companies' } });
      }

      if (requestUrl.endsWith('/v4/35427/contacts?page[size]=25')) {
        return mockJsonResponse({ data: [] });
      }

      if (requestUrl.endsWith('/v4/35427/contacts')) {
        return mockJsonResponse({ data: { id: 'contact-1', type: 'contacts' } });
      }

      if (requestUrl.endsWith('/v4/35427/products?page[size]=25')) {
        return mockJsonResponse({ data: [] });
      }

      if (requestUrl.endsWith('/v4/35427/products')) {
        return mockJsonResponse({ data: { id: 'product-1', type: 'products' } });
      }

      if (requestUrl.endsWith('/v4/35427/sales_invoices')) {
        return mockJsonResponse({
          data: {
            id: 'invoice-1',
            type: 'sales_invoices',
            attributes: {
              status: 'draft',
            },
          },
        });
      }

      if (requestUrl.includes('/v4/35427/sales_invoices/invoice-1?include=')) {
        return mockJsonResponse({
          data: {
            id: 'invoice-1',
            type: 'sales_invoices',
            attributes: {
              status: 'draft',
              payment_status: 'unpaid',
            },
          },
        });
      }

      return mockJsonResponse({ error: 'unexpected_url' }, 500);
    });

    vi.stubGlobal('fetch', fetchMock);
    return { fetchMock, calls };
  }

  it('requires admin auth', async () => {
    const { fetchMock } = buildCommissionProbeFetch();
    const handler = registerCommissionRoute();
    const reply = buildReply();
    const result = await handler?.({ authUser: { role: 'vendor' } }, reply);

    expect(reply.statusCode).toBe(403);
    expect(result).toEqual({ message: 'Forbidden' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects when admin probes are disabled', async () => {
    process.env.ADMIN_PROBES_ENABLED = 'false';
    const { fetchMock } = buildCommissionProbeFetch();
    const handler = registerCommissionRoute();
    const reply = buildReply();
    const result = await handler?.({ authUser: { role: 'admin' } }, reply);

    expect(reply.statusCode).toBe(403);
    expect(result).toEqual({ ok: false, message: 'Admin probe endpoints are disabled.' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects before Paraşüt calls when the create confirmation is missing', async () => {
    process.env.PARASUT_PROBE_CONFIRM = '';
    const { fetchMock } = buildCommissionProbeFetch();
    const handler = registerCommissionRoute();
    const reply = buildReply();
    const result = await handler?.({ authUser: { role: 'admin' } }, reply);

    expect(reply.statusCode).toBe(422);
    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        provider: 'PARASUT',
        mode: 'commission_invoice_test',
        warnings: ['PARASUT_PROBE_CONFIRM=CREATE_COMMISSION_INVOICE_TEST is required.'],
      }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized success response and keeps lifecycle disabled', async () => {
    const { calls } = buildCommissionProbeFetch();
    const handler = registerCommissionRoute();
    const reply = buildReply();
    const result = await handler?.({ authUser: { role: 'admin' } }, reply);

    expect(reply.statusCode).toBe(200);
    expect(result).toEqual({
      ok: true,
      provider: 'PARASUT',
      mode: 'commission_invoice_test',
      contactCreated: true,
      productCreated: true,
      invoiceCreated: true,
      invoiceId: 'invoice-1',
      invoiceStatus: 'draft',
      warnings: [],
    });
    expect(calls.map((call) => [call.method, call.url])).toEqual([
      ['POST', 'https://api.heroku-staging.parasut.com/oauth/token'],
      ['GET', 'https://api.heroku-staging.parasut.com/v4/me'],
      ['GET', 'https://api.heroku-staging.parasut.com/v4/35427/contacts?page[size]=25'],
      ['POST', 'https://api.heroku-staging.parasut.com/v4/35427/contacts'],
      ['GET', 'https://api.heroku-staging.parasut.com/v4/35427/products?page[size]=25'],
      ['POST', 'https://api.heroku-staging.parasut.com/v4/35427/products'],
      ['POST', 'https://api.heroku-staging.parasut.com/v4/35427/sales_invoices'],
      [
        'GET',
        'https://api.heroku-staging.parasut.com/v4/35427/sales_invoices/invoice-1?include=contact%2Cdetails%2Cpayments%2Cpayments.transaction%2Ctags',
      ],
    ]);
    expect(calls.some((call) => /cancel|recover|archive/.test(call.url))).toBe(false);
    expectNoSecrets(result);
  });
});
