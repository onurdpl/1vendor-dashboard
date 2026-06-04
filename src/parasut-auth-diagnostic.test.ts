import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppEnv } from '../backend/src/config/env.js';
import { runParasutAuthMeDiagnostic } from '../backend/src/modules/parasut/parasut-auth-me-diagnostic.js';
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

function registerRoute() {
  let handler:
    | ((request: { authUser?: { role?: string } }, reply: ReturnType<typeof buildReply>) => Promise<unknown>)
    | null = null;
  const app = {
    get: vi.fn((path: string, ...args: unknown[]) => {
      if (path === '/admin/probes/parasut/auth-me') {
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
