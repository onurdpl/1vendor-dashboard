import { createHash, createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppEnv } from '../backend/src/config/env.js';

const findUniqueMock = vi.hoisted(() => vi.fn());
const updateMock = vi.hoisted(() => vi.fn());

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: {
    user: {
      findUnique: findUniqueMock,
      update: updateMock,
    },
  },
}));

const { registerAuthRoutes } = await import('../backend/src/modules/auth/auth.routes.js');
const { createAuthMiddleware } = await import('../backend/src/modules/auth/auth.middleware.js');
const { createAuthService } = await import('../backend/src/modules/auth/auth.service.js');
const { resetLoginRateLimitForTests } = await import('../backend/src/modules/auth/login-rate-limit.js');
const { SESSION_COOKIE_NAME } = await import('../backend/src/modules/auth/session-cookie.js');

function makeDemoPasswordHash(password: string) {
  return `demo_sha256_v1:${createHash('sha256').update(`vendor-dashboard-demo:${password}`).digest('hex')}`;
}

function buildEnv(overrides: Partial<AppEnv> = {}): AppEnv {
  return {
    NODE_ENV: 'test',
    PORT: 4000,
    CORS_ORIGIN: ['http://localhost:5173'],
    JWT_SECRET: 'test-secret',
    JWT_EXPIRES_IN: '1h',
    LOGIN_RATE_LIMIT_MAX_ATTEMPTS: 2,
    LOGIN_RATE_LIMIT_WINDOW_SECONDS: 600,
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
    SHIPPING_EXECUTION_ENABLED: false,
    SHIPPING_SANDBOX_MODE: false,
    SHIPPING_PROVIDER: 'hepsijet',
    KARGO_ENTEGRATOR_ENABLED: false,
    KARGO_ENTEGRATOR_WEBHOOK_INGEST_ENABLED: false,
    TRY_OTO_ENABLED: false,
    TRY_OTO_SANDBOX_MODE: false,
    TRY_OTO_WEBHOOK_INGEST_ENABLED: false,
    ...overrides,
  };
}

function buildUser() {
  return {
    id: 'user-1',
    email: 'vendor@example.com',
    name: 'Vendor User',
    role: 'VENDOR',
    status: 'active',
    passwordHash: makeDemoPasswordHash('demo123'),
    vendorLinks: [
      {
        vendor: {
          id: 'vendor-a',
          name: 'Vendor A',
          status: 'active',
          restrictionReason: null,
          restrictedByUserId: null,
          restrictedAt: null,
        },
      },
    ],
  };
}

function createReply() {
  const reply = {
    statusCode: 200,
    payload: undefined as unknown,
    sent: false,
    headers: {} as Record<string, string | string[]>,
    code: vi.fn((status: number) => {
      reply.statusCode = status;
      return reply;
    }),
    send: vi.fn((payload: unknown) => {
      reply.payload = payload;
      reply.sent = true;
      return payload;
    }),
    header: vi.fn((key: string, value: string | string[]) => {
      reply.headers[key] = value;
      return reply;
    }),
  };

  return reply;
}

function createLoginRoute(env = buildEnv()) {
  return createAuthRouteHandlers(env).post['/auth/login'] ?? null;
}

function createAuthRouteHandlers(env = buildEnv()) {
  type Handler = (request: Record<string, unknown>, reply: ReturnType<typeof createReply>) => Promise<unknown>;
  type Route = {
    preHandler?: Handler;
    handler: Handler;
  };
  const handlers = {
    post: {} as Record<string, Handler>,
    get: {} as Record<string, Route>,
    logInfo: vi.fn(),
  };
  const app = {
    post: vi.fn((path: string, routeHandler: Handler) => {
      handlers.post[path] = routeHandler;
    }),
    get: vi.fn((path: string, _optionsOrHandler: unknown, maybeHandler?: Handler) => {
      handlers.get[path] = typeof _optionsOrHandler === 'function'
        ? { handler: _optionsOrHandler }
        : {
            preHandler: (_optionsOrHandler as { preHandler?: Handler } | undefined)?.preHandler,
            handler: maybeHandler as Handler,
          };
    }),
    log: {
      info: handlers.logInfo,
    },
  };

  registerAuthRoutes(app as never, env);
  return handlers;
}

async function invokeGetRoute(
  route: ReturnType<typeof createAuthRouteHandlers>['get'][string] | undefined,
  request: Record<string, unknown>,
  reply: ReturnType<typeof createReply>,
) {
  await route?.preHandler?.(request, reply);
  if (reply.sent) {
    return reply.payload;
  }

  return route?.handler(request, reply);
}

function readSetCookieHeader(headers: Record<string, string | string[]>) {
  const value = headers['Set-Cookie'];
  return Array.isArray(value) ? value.join('; ') : value ?? '';
}

function extractSessionCookie(setCookieHeader: string) {
  const cookie = setCookieHeader.split(';')[0] ?? '';
  expect(cookie).toMatch(new RegExp(`^${SESSION_COOKIE_NAME}=`));
  return cookie;
}

function base64Url(input: string) {
  return Buffer.from(input).toString('base64url');
}

function signJwt(secret: string, expiresAtSeconds: number) {
  const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64Url(JSON.stringify({
    sub: 'user-1',
    email: 'vendor@example.com',
    role: 'vendor',
    exp: expiresAtSeconds,
  }));
  const signature = createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${signature}`;
}

function signExpiredJwt(secret: string) {
  return signJwt(secret, Math.floor(Date.now() / 1000) - 60);
}

async function injectLogin(
  input: {
    email?: unknown;
    password?: unknown;
    ip?: string;
    headers?: Record<string, string>;
    env?: AppEnv;
    omitEmail?: boolean;
    omitPassword?: boolean;
  } = {},
) {
  const handler = createLoginRoute(input.env);
  const reply = createReply();
  const body: Record<string, unknown> = {};
  if (!input.omitEmail) {
    body.email = 'email' in input ? input.email : 'vendor@example.com';
  }
  if (!input.omitPassword) {
    body.password = 'password' in input ? input.password : 'demo123';
  }
  const result = await handler?.(
    {
      headers: input.headers ?? {},
      body,
      ip: input.ip ?? '127.0.0.1',
    },
    reply,
  );

  return {
    statusCode: reply.statusCode,
    payload: reply.sent ? reply.payload : result,
    headers: reply.headers,
  };
}

async function injectLoginRateLimitReset(
  input: {
    email?: unknown;
    ip?: unknown;
    requestIp?: string;
    headers?: Record<string, string>;
    env?: AppEnv;
    omitEmail?: boolean;
  } = {},
) {
  const handlers = createAuthRouteHandlers(input.env);
  const reply = createReply();
  const body: Record<string, unknown> = {};
  if (!input.omitEmail) {
    body.email = 'email' in input ? input.email : 'vendor@example.com';
  }
  if ('ip' in input) {
    body.ip = input.ip;
  }
  const result = await handlers.post['/auth/login-rate-limit/reset']?.(
    {
      headers: input.headers ?? {},
      body,
      ip: input.requestIp ?? '127.0.0.1',
    },
    reply,
  );

  return {
    statusCode: reply.statusCode,
    payload: reply.sent ? reply.payload : result,
    headers: reply.headers,
  };
}

describe('auth login rate limiting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetLoginRateLimitForTests();
    findUniqueMock.mockResolvedValue(buildUser());
    updateMock.mockResolvedValue({});
  });

  it('keeps login behavior unchanged under the configured limit', async () => {
    const response = await injectLogin();

    expect(response.statusCode).toBe(200);
    expect(response.payload).toEqual(
      expect.objectContaining({
        user: expect.objectContaining({
          email: 'vendor@example.com',
          role: 'vendor',
        }),
        csrfToken: expect.any(String),
      }),
    );
    expect(JSON.stringify(response.payload)).not.toContain('eyJ');
    expect(readSetCookieHeader(response.headers)).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(readSetCookieHeader(response.headers)).toContain('HttpOnly');
    expect(readSetCookieHeader(response.headers)).toContain('SameSite=Lax');
  });

  it('emits structured login diagnostics for successful login without logging the password', async () => {
    const handlers = createAuthRouteHandlers();
    const reply = createReply();

    await handlers.post['/auth/login']?.(
      {
        requestId: 'login-success-request',
        method: 'POST',
        routeOptions: { url: '/auth/login' },
        headers: { 'x-auth-attempt-id': 'auth-success123' },
        body: {
          email: ' Vendor@Example.COM ',
          password: 'demo123',
        },
        ip: '127.0.0.1',
      },
      reply,
    );

    expect(reply.statusCode).toBe(200);
    expect(handlers.logInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'AUTH_LOGIN_REQUEST_START',
        requestId: 'login-success-request',
        authAttemptId: 'auth-success123',
        normalizedEmail: 'vendor@example.com',
        method: 'POST',
        path: '/auth/login',
        timestamp: expect.any(String),
      }),
      'auth login request start',
    );
    expect(handlers.logInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'AUTH_LOGIN_DIAGNOSTICS',
        requestId: 'login-success-request',
        authAttemptId: 'auth-success123',
        email: 'vendor@example.com',
        success: true,
        failureStage: null,
        failureReason: null,
        requestReceivedAt: expect.any(String),
        routeEnteredAt: expect.any(String),
        validationStartedAt: expect.any(String),
        validationEndedAt: expect.any(String),
        validationDurationMs: expect.any(Number),
        totalDurationMs: expect.any(Number),
        userLookupDurationMs: expect.any(Number),
        passwordVerifyDurationMs: expect.any(Number),
        tokenIssueDurationMs: expect.any(Number),
        cookieSetDurationMs: expect.any(Number),
        csrfGenerationDurationMs: expect.any(Number),
        sessionCookieSetAttempted: true,
        csrfTokenGenerationAttempted: true,
        csrfHeaderGenerationAttempted: false,
        responseStatus: 200,
      }),
      'auth login diagnostics',
    );
    const serializedLogs = JSON.stringify(handlers.logInfo.mock.calls);
    expect(serializedLogs).not.toContain('demo123');
    expect(serializedLogs).not.toContain('csrf-token');
    expect(serializedLogs).not.toContain(SESSION_COOKIE_NAME);
  });

  it('emits structured login diagnostics for invalid password without changing the response', async () => {
    const handlers = createAuthRouteHandlers();
    const reply = createReply();

    const result = await handlers.post['/auth/login']?.(
      {
        requestId: 'login-failure-request',
        method: 'POST',
        routeOptions: { url: '/auth/login' },
        headers: { 'x-auth-attempt-id': 'auth-failure123' },
        body: {
          email: 'Vendor@Example.COM',
          password: 'wrong-password',
        },
        ip: '127.0.0.1',
      },
      reply,
    );

    expect(reply.statusCode).toBe(401);
    expect(reply.sent ? reply.payload : result).toEqual({ message: 'Invalid email or password.' });
    expect(handlers.logInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'AUTH_LOGIN_DIAGNOSTICS',
        requestId: 'login-failure-request',
        authAttemptId: 'auth-failure123',
        email: 'vendor@example.com',
        success: false,
        failureStage: 'password_verify',
        failureReason: 'invalid_password',
        sessionCookieSetAttempted: false,
        csrfTokenGenerationAttempted: false,
        totalDurationMs: expect.any(Number),
        userLookupDurationMs: expect.any(Number),
        passwordVerifyDurationMs: expect.any(Number),
        tokenIssueDurationMs: expect.any(Number),
        cookieSetDurationMs: null,
        responseStatus: 401,
      }),
      'auth login diagnostics',
    );
    const serializedLogs = JSON.stringify(handlers.logInfo.mock.calls);
    expect(serializedLogs).not.toContain('wrong-password');
  });

  it('returns minimal public login readiness in production without exposing config diagnostics', async () => {
    const handlers = createAuthRouteHandlers(buildEnv({
      NODE_ENV: 'production',
      JWT_SECRET: 'super-secret-jwt-value',
      JWT_EXPIRES_IN: '12h',
      CORS_ORIGIN: ['https://app.example.com'],
    }));
    const reply = createReply();

    const result = await handlers.get['/auth/diagnostics/public-login-readiness']?.handler(
      {
        requestId: 'readiness-request',
        method: 'GET',
        routeOptions: { url: '/auth/diagnostics/public-login-readiness' },
        headers: { 'x-forwarded-proto': 'https' },
        protocol: 'https',
      },
      reply,
    );

    expect(result).toMatchObject({
      ok: true,
      status: 'ready',
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('cookieConfig');
    expect(serialized).not.toContain('cors');
    expect(serialized).not.toContain('jwt');
    expect(serialized).not.toContain('super-secret-jwt-value');
    expect(serialized).not.toContain('sporgym_session=');
    expect(serialized).not.toContain('csrf');
  });

  it('keeps detailed public login readiness available outside production', async () => {
    const handlers = createAuthRouteHandlers(buildEnv({
      NODE_ENV: 'test',
      JWT_SECRET: 'test-secret-jwt-value',
      JWT_EXPIRES_IN: '12h',
      CORS_ORIGIN: ['https://app.example.com'],
    }));
    const reply = createReply();

    const result = await handlers.get['/auth/diagnostics/public-login-readiness']?.handler(
      {
        requestId: 'readiness-request',
        method: 'GET',
        routeOptions: { url: '/auth/diagnostics/public-login-readiness' },
        headers: { 'x-forwarded-proto': 'https' },
        protocol: 'https',
      },
      reply,
    );

    expect(result).toMatchObject({
      ok: true,
      serverTime: expect.any(String),
      envMode: 'test',
      cookieConfig: {
        secure: true,
        sameSite: 'None',
        cookieNamePresent: true,
      },
      cors: {
        originConfigured: true,
      },
      jwt: {
        expiresConfigPresent: true,
      },
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('test-secret-jwt-value');
    expect(serialized).not.toContain('sporgym_session=');
    expect(serialized).not.toContain('csrf');
  });

  it('logs auth attempt id on public login readiness diagnostics without exposing secrets', async () => {
    const handlers = createAuthRouteHandlers(buildEnv({
      NODE_ENV: 'production',
      JWT_SECRET: 'super-secret-jwt-value',
      JWT_EXPIRES_IN: '12h',
      CORS_ORIGIN: ['https://app.example.com'],
    }));
    const reply = createReply();

    await handlers.get['/auth/diagnostics/public-login-readiness']?.handler(
      {
        requestId: 'readiness-correlated-request',
        method: 'GET',
        routeOptions: { url: '/auth/diagnostics/public-login-readiness' },
        headers: {
          'x-auth-attempt-id': 'auth-readiness123',
          'x-forwarded-proto': 'https',
        },
        protocol: 'https',
      },
      reply,
    );

    expect(reply.headers['X-Auth-Attempt-Id']).toBe('auth-readiness123');
    expect(handlers.logInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'AUTH_LOGIN_READINESS_DIAGNOSTICS',
        requestId: 'readiness-correlated-request',
        authAttemptId: 'auth-readiness123',
        method: 'GET',
        path: '/auth/diagnostics/public-login-readiness',
        responseStatus: 200,
        cookieSecure: true,
        cookieSameSite: 'None',
        cookieNamePresent: true,
        corsOriginConfigured: true,
        jwtExpiresConfigPresent: true,
      }),
      'auth login readiness diagnostics',
    );
    const serializedLogs = JSON.stringify(handlers.logInfo.mock.calls);
    expect(serializedLogs).not.toContain('super-secret-jwt-value');
    expect(serializedLogs).not.toContain('sporgym_session=');
    expect(serializedLogs).not.toContain('csrf-token');
  });

  it('rejects missing email or password with the existing generic response', async () => {
    const missingEmail = await injectLogin({ omitEmail: true });
    const missingPassword = await injectLogin({ omitPassword: true });

    expect(missingEmail.statusCode).toBe(400);
    expect(missingEmail.payload).toEqual({ message: 'Email and password are required.' });
    expect(missingPassword.statusCode).toBe(400);
    expect(missingPassword.payload).toEqual({ message: 'Email and password are required.' });
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it.each([
    ['null', null],
    ['object', { value: 'vendor@example.com' }],
    ['array', ['vendor@example.com']],
    ['number', 123],
    ['boolean', true],
  ])('rejects %s email values before authentication', async (_label, email) => {
    const response = await injectLogin({ email });

    expect(response.statusCode).toBe(400);
    expect(response.payload).toEqual({ message: 'Email and password are required.' });
    expect(JSON.stringify(response.payload)).not.toContain('exists');
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it.each([
    ['null', null],
    ['object', { value: 'demo123' }],
    ['array', ['demo123']],
    ['number', 123],
    ['boolean', true],
  ])('rejects %s password values before authentication', async (_label, password) => {
    const response = await injectLogin({ password });

    expect(response.statusCode).toBe(400);
    expect(response.payload).toEqual({ message: 'Email and password are required.' });
    expect(JSON.stringify(response.payload)).not.toContain('exists');
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it('sets Secure on the HttpOnly session cookie in production', async () => {
    const response = await injectLogin({
      env: buildEnv({
        NODE_ENV: 'production',
      }),
    });

    expect(readSetCookieHeader(response.headers)).toContain('Secure');
    expect(readSetCookieHeader(response.headers)).toContain('SameSite=None');
  });

  it('sets Secure on the HttpOnly session cookie for HTTPS proxy requests outside production', async () => {
    const response = await injectLogin({
      env: buildEnv({ NODE_ENV: 'development' }),
      headers: {
        'x-forwarded-proto': 'https',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(readSetCookieHeader(response.headers)).toContain('Secure');
    expect(readSetCookieHeader(response.headers)).toContain('SameSite=None');
  });

  it('supports login then /auth/me using the HttpOnly cookie', async () => {
    const handlers = createAuthRouteHandlers();
    const loginReply = createReply();
    const loginResult = await handlers.post['/auth/login']?.(
      {
        headers: {},
        body: {
          email: 'vendor@example.com',
          password: 'demo123',
        },
        ip: '127.0.0.1',
      },
      loginReply,
    );
    const loginPayload = loginReply.sent ? loginReply.payload : loginResult;

    expect(loginReply.statusCode).toBe(200);
    expect(loginPayload).toEqual(
      expect.objectContaining({
        user: expect.objectContaining({
          email: 'vendor@example.com',
          role: 'vendor',
        }),
        csrfToken: expect.any(String),
      }),
    );
    expect(JSON.stringify(loginPayload)).not.toContain('eyJ');

    const sessionCookie = extractSessionCookie(readSetCookieHeader(loginReply.headers));
    const meReply = createReply();
    const meResult = await invokeGetRoute(
      handlers.get['/auth/me'],
      {
        method: 'GET',
        headers: {
          cookie: sessionCookie,
        },
      },
      meReply,
    );
    const mePayload = meReply.sent ? meReply.payload : meResult;

    expect(meReply.statusCode).toBe(200);
    expect(mePayload).toEqual(
      expect.objectContaining({
        user: expect.objectContaining({
          email: 'vendor@example.com',
          role: 'vendor',
        }),
        csrfToken: expect.any(String),
      }),
    );
  });

  it('reuses the middleware-authenticated user for /auth/me without a duplicate route lookup', async () => {
    const handlers = createAuthRouteHandlers();
    const loginReply = createReply();
    await handlers.post['/auth/login']?.(
      {
        headers: {},
        body: {
          email: 'vendor@example.com',
          password: 'demo123',
        },
        ip: '127.0.0.1',
      },
      loginReply,
    );
    const sessionCookie = extractSessionCookie(readSetCookieHeader(loginReply.headers));
    findUniqueMock.mockClear();

    const meReply = createReply();
    const request = {
      method: 'GET',
      routeOptions: { url: '/auth/me' },
      requestId: 'auth-me-test',
      log: {
        info: vi.fn(),
      },
      headers: {
        'x-auth-attempt-id': 'restore-test123',
        cookie: sessionCookie,
      },
    };
    const meResult = await invokeGetRoute(handlers.get['/auth/me'], request, meReply);
    const mePayload = meReply.sent ? meReply.payload : meResult;

    expect(meReply.statusCode).toBe(200);
    expect(mePayload).toEqual(
      expect.objectContaining({
        user: expect.objectContaining({
          email: 'vendor@example.com',
          vendorAccess: [
            {
              vendorId: 'vendor-a',
              vendorName: 'Vendor A',
              status: 'active',
              restrictionReason: null,
              restrictionChangedByUserId: null,
              restrictionChangedAt: null,
            },
          ],
        }),
      }),
    );
    expect(findUniqueMock).toHaveBeenCalledTimes(1);
    expect(request.log.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'AUTH_ME_RESTORE_DIAGNOSTICS',
        requestId: 'auth-me-test',
        authAttemptId: 'restore-test123',
        cookiePresent: true,
        authFailureStage: null,
        middlewareValidationDurationMs: expect.any(Number),
        routeHandlerDurationMs: expect.any(Number),
        userLookupDurationMs: expect.any(Number),
        responseStatus: 200,
        sessionSource: 'cookie',
      }),
      'auth me restore diagnostics',
    );
  });

  it('restores /auth/me from a valid cookie when a stale bearer header is also present', async () => {
    const handlers = createAuthRouteHandlers();
    const loginReply = createReply();
    await handlers.post['/auth/login']?.(
      {
        headers: {},
        body: {
          email: 'vendor@example.com',
          password: 'demo123',
        },
        ip: '127.0.0.1',
      },
      loginReply,
    );

    const sessionCookie = extractSessionCookie(readSetCookieHeader(loginReply.headers));
    const meReply = createReply();
    const request = {
      method: 'GET',
      headers: {
        authorization: 'Bearer stale-local-storage-token',
        cookie: sessionCookie,
      },
    };
    const meResult = await invokeGetRoute(
      handlers.get['/auth/me'],
      request,
      meReply,
    );
    const mePayload = meReply.sent ? meReply.payload : meResult;

    expect(meReply.statusCode).toBe(200);
    expect(request).toMatchObject({
      authSessionSource: 'cookie',
      authDiagnostics: expect.objectContaining({
        cookiePresent: true,
        authorizationBearerPresent: true,
        jwtVerifySuccess: true,
        userLookupSuccess: true,
        authFailureStage: null,
        selectedSessionSource: 'cookie',
        attemptedSessionSources: ['bearer', 'cookie'],
      }),
    });
    expect(mePayload).toEqual(
      expect.objectContaining({
        user: expect.objectContaining({
          email: 'vendor@example.com',
          role: 'vendor',
        }),
      }),
    );
  });

  it('rejects /auth/me when the session cookie is missing', async () => {
    const handlers = createAuthRouteHandlers();
    const reply = createReply();
    const log = {
      info: vi.fn(),
    };

    await invokeGetRoute(
      handlers.get['/auth/me'],
      {
        method: 'GET',
        routeOptions: { url: '/auth/me' },
        requestId: 'missing-cookie-test',
        log,
        headers: {},
      },
      reply,
    );

    expect(reply.statusCode).toBe(401);
    expect(reply.payload).toEqual({
      message: 'Unauthorized',
      authDiagnostics: {
        cookiePresent: false,
        authorizationBearerPresent: false,
        jwtVerifySuccess: false,
        userLookupSuccess: false,
        authFailureStage: 'missing_token',
        selectedSessionSource: null,
        attemptedSessionSources: [],
      },
    });
    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'AUTH_ME_RESTORE_DIAGNOSTICS',
        requestId: 'missing-cookie-test',
        cookiePresent: false,
        authFailureStage: 'missing_token',
        authFailureReason: 'missing_cookie',
        responseStatus: 401,
      }),
      'auth me restore diagnostics',
    );
  });

  it('does not expose auth diagnostics in production 401 responses', async () => {
    const handlers = createAuthRouteHandlers(buildEnv({ NODE_ENV: 'production' }));
    const reply = createReply();
    const log = {
      info: vi.fn(),
    };

    await invokeGetRoute(
      handlers.get['/auth/me'],
      {
        method: 'GET',
        routeOptions: { url: '/auth/me' },
        requestId: 'missing-cookie-production-test',
        log,
        headers: {},
      },
      reply,
    );

    expect(reply.statusCode).toBe(401);
    expect(reply.payload).toEqual({
      message: 'Unauthorized',
    });
    expect(JSON.stringify(reply.payload)).not.toContain('authDiagnostics');
    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'AUTH_ME_RESTORE_DIAGNOSTICS',
        requestId: 'missing-cookie-production-test',
        cookiePresent: false,
        authFailureStage: 'missing_token',
        authFailureReason: 'missing_cookie',
        responseStatus: 401,
      }),
      'auth me restore diagnostics',
    );
  });

  it('rejects /auth/me when the session cookie is expired', async () => {
    const env = buildEnv();
    const handlers = createAuthRouteHandlers(env);
    const reply = createReply();
    const expiredToken = signExpiredJwt(env.JWT_SECRET);
    const log = {
      info: vi.fn(),
    };

    await invokeGetRoute(
      handlers.get['/auth/me'],
      {
        method: 'GET',
        routeOptions: { url: '/auth/me' },
        requestId: 'expired-cookie-test',
        log,
        headers: {
          cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(expiredToken)}`,
        },
      },
      reply,
    );

    expect(reply.statusCode).toBe(401);
    expect(reply.payload).toEqual({
      message: 'Unauthorized',
      authDiagnostics: {
        cookiePresent: true,
        authorizationBearerPresent: false,
        jwtVerifySuccess: false,
        userLookupSuccess: false,
        authFailureStage: 'jwt_verify',
        selectedSessionSource: null,
        attemptedSessionSources: ['cookie'],
      },
    });
    expect(JSON.stringify(reply.payload)).not.toContain(expiredToken);
    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'AUTH_ME_RESTORE_DIAGNOSTICS',
        requestId: 'expired-cookie-test',
        cookiePresent: true,
        authFailureStage: 'jwt_verify',
        authFailureReason: 'expired_token',
        responseStatus: 401,
      }),
      'auth me restore diagnostics',
    );
  });

  it('rejects /auth/me when the session cookie token is invalid', async () => {
    const handlers = createAuthRouteHandlers();
    const reply = createReply();
    const log = {
      info: vi.fn(),
    };

    await invokeGetRoute(
      handlers.get['/auth/me'],
      {
        method: 'GET',
        routeOptions: { url: '/auth/me' },
        requestId: 'invalid-cookie-test',
        log,
        headers: {
          cookie: `${SESSION_COOKIE_NAME}=not-a-valid-token`,
        },
      },
      reply,
    );

    expect(reply.statusCode).toBe(401);
    expect(reply.payload).toEqual({
      message: 'Unauthorized',
      authDiagnostics: {
        cookiePresent: true,
        authorizationBearerPresent: false,
        jwtVerifySuccess: false,
        userLookupSuccess: false,
        authFailureStage: 'jwt_verify',
        selectedSessionSource: null,
        attemptedSessionSources: ['cookie'],
      },
    });
    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'AUTH_ME_RESTORE_DIAGNOSTICS',
        requestId: 'invalid-cookie-test',
        cookiePresent: true,
        authFailureStage: 'jwt_verify',
        authFailureReason: 'invalid_token',
        responseStatus: 401,
      }),
      'auth me restore diagnostics',
    );
  });

  it('diagnoses /auth/me user lookup failures without exposing the cookie token', async () => {
    const env = buildEnv();
    const handlers = createAuthRouteHandlers(env);
    const reply = createReply();
    const token = signJwt(env.JWT_SECRET, Math.floor(Date.now() / 1000) + 3600);
    findUniqueMock.mockResolvedValueOnce(null);

    await invokeGetRoute(
      handlers.get['/auth/me'],
      {
        method: 'GET',
        headers: {
          cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
        },
      },
      reply,
    );

    expect(reply.statusCode).toBe(401);
    expect(reply.payload).toEqual({
      message: 'Unauthorized',
      authDiagnostics: {
        cookiePresent: true,
        authorizationBearerPresent: false,
        jwtVerifySuccess: true,
        userLookupSuccess: false,
        authFailureStage: 'user_lookup',
        selectedSessionSource: null,
        attemptedSessionSources: ['cookie'],
      },
    });
    expect(JSON.stringify(reply.payload)).not.toContain(token);
  });

  it('authenticates frontend users from the HttpOnly session cookie', async () => {
    const login = await injectLogin();
    const sessionCookie = extractSessionCookie(readSetCookieHeader(login.headers));
    const authService = createAuthService(buildEnv());
    const authMiddleware = createAuthMiddleware(authService);
    const reply = createReply();
    const request = {
      method: 'GET',
      headers: { cookie: sessionCookie },
    } as never;

    await authMiddleware.authenticateRequest(request, reply);

    expect(reply.sent).toBe(false);
    expect(request).toMatchObject({
      authSessionSource: 'cookie',
      authUser: {
        email: 'vendor@example.com',
        role: 'vendor',
      },
    });
  });

  it('requires CSRF for unsafe frontend cookie-authenticated requests', async () => {
    const login = await injectLogin();
    const sessionCookie = extractSessionCookie(readSetCookieHeader(login.headers));
    const token = decodeURIComponent(sessionCookie.split('=').slice(1).join('='));
    const authService = createAuthService(buildEnv());
    const authMiddleware = createAuthMiddleware(authService);
    const missingReply = createReply();

    await authMiddleware.authenticateRequest({
      method: 'POST',
      headers: { cookie: sessionCookie },
    } as never, missingReply);

    expect(missingReply.statusCode).toBe(403);
    expect(missingReply.payload).toEqual({ message: 'CSRF verification failed.' });

    const validReply = createReply();
    await authMiddleware.authenticateRequest({
      method: 'POST',
      headers: {
        cookie: sessionCookie,
        'x-csrf-token': authService.createCsrfToken(token),
      },
    } as never, validReply);

    expect(validReply.sent).toBe(false);
  });

  it('clears the session cookie on logout', async () => {
    let logoutHandler: ((request: Record<string, unknown>, reply: ReturnType<typeof createReply>) => Promise<unknown>) | null = null;
    const app = {
      post: vi.fn((path: string, routeHandler: typeof logoutHandler) => {
        if (path === '/auth/logout') {
          logoutHandler = routeHandler;
        }
      }),
      get: vi.fn(),
      log: {
        info: vi.fn(),
      },
    };
    registerAuthRoutes(app as never, buildEnv());
    const reply = createReply();

    await logoutHandler?.({}, reply);

    expect(readSetCookieHeader(reply.headers)).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(readSetCookieHeader(reply.headers)).toContain('Max-Age=0');
    expect(readSetCookieHeader(reply.headers)).toContain('HttpOnly');
  });

  it('returns 429 when the IP and email bucket exceeds the limit', async () => {
    await injectLogin({ password: 'wrong' });
    await injectLogin({ password: 'wrong' });

    const response = await injectLogin({ password: 'wrong' });

    expect(response.statusCode).toBe(429);
    expect(response.headers['Retry-After']).toBe('600');
    expect(response.payload).toEqual({
      message: 'Too many login attempts. Please try again later.',
      retryAfterSeconds: 600,
      retryAt: expect.any(String),
    });
  });

  it('keeps separate buckets for different normalized emails', async () => {
    await injectLogin({ email: 'vendor@example.com', password: 'wrong' });
    await injectLogin({ email: 'vendor@example.com', password: 'wrong' });

    const response = await injectLogin({ email: 'other@example.com', password: 'wrong' });

    expect(response.statusCode).toBe(401);
    expect(response.payload).toEqual({ message: 'Invalid email or password.' });
  });

  it('keeps separate buckets for different IP addresses', async () => {
    await injectLogin({ ip: '127.0.0.1', password: 'wrong' });
    await injectLogin({ ip: '127.0.0.1', password: 'wrong' });

    const response = await injectLogin({ ip: '127.0.0.2', password: 'wrong' });

    expect(response.statusCode).toBe(401);
    expect(response.payload).toEqual({ message: 'Invalid email or password.' });
  });

  it('uses the forwarded client IP before the proxy IP for deployed rate-limit buckets', async () => {
    await injectLogin({
      ip: '10.0.0.1',
      headers: { 'x-forwarded-for': '203.0.113.10, 10.0.0.1' },
      password: 'wrong',
    });
    await injectLogin({
      ip: '10.0.0.1',
      headers: { 'x-forwarded-for': '203.0.113.10, 10.0.0.1' },
      password: 'wrong',
    });

    const separateForwardedIp = await injectLogin({
      ip: '10.0.0.1',
      headers: { 'x-forwarded-for': '203.0.113.11, 10.0.0.1' },
      password: 'wrong',
    });
    const originalForwardedIp = await injectLogin({
      ip: '10.0.0.1',
      headers: { 'x-forwarded-for': '203.0.113.10, 10.0.0.1' },
      password: 'wrong',
    });

    expect(separateForwardedIp.statusCode).toBe(401);
    expect(originalForwardedIp.statusCode).toBe(429);
  });

  it('resets failed attempts after a successful login without disabling future protection', async () => {
    await injectLogin({ password: 'wrong' });
    const success = await injectLogin({ password: 'demo123' });

    expect(success.statusCode).toBe(200);
    expect((await injectLogin({ password: 'wrong' })).statusCode).toBe(401);
    expect((await injectLogin({ password: 'wrong' })).statusCode).toBe(401);

    const response = await injectLogin({ password: 'wrong' });
    expect(response.statusCode).toBe(429);
  });

  it('does not reveal whether the account exists when the rate limit is exceeded', async () => {
    findUniqueMock.mockResolvedValue(null);
    await injectLogin({ email: 'missing@example.com', password: 'wrong' });
    await injectLogin({ email: 'missing@example.com', password: 'wrong' });

    const response = await injectLogin({ email: 'missing@example.com', password: 'wrong' });

    expect(response.statusCode).toBe(429);
    expect(response.payload).toEqual({
      message: 'Too many login attempts. Please try again later.',
      retryAfterSeconds: 600,
      retryAt: expect.any(String),
    });
    expect(JSON.stringify(response.payload)).not.toContain('missing@example.com');
    expect(JSON.stringify(response.payload)).not.toContain('exists');
  });

  it('keeps production login rate limiting enabled', async () => {
    const env = buildEnv({ NODE_ENV: 'production' });
    await injectLogin({ password: 'wrong', env });
    await injectLogin({ password: 'wrong', env });

    const response = await injectLogin({ password: 'wrong', env });

    expect(response.statusCode).toBe(429);
    expect(response.payload).toEqual(expect.objectContaining({
      message: 'Too many login attempts. Please try again later.',
      retryAfterSeconds: 600,
    }));
  });

  it('allows attempts again after the configured window expires', async () => {
    vi.useFakeTimers();
    const env = buildEnv({ LOGIN_RATE_LIMIT_WINDOW_SECONDS: 1 });
    try {
      await injectLogin({ password: 'wrong', env });
      await injectLogin({ password: 'wrong', env });
      expect((await injectLogin({ password: 'wrong', env })).statusCode).toBe(429);

      vi.advanceTimersByTime(1001);

      const response = await injectLogin({ password: 'wrong', env });
      expect(response.statusCode).toBe(401);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the demo/dev reset route disabled by default', async () => {
    const response = await injectLoginRateLimitReset();

    expect(response.statusCode).toBe(404);
    expect(response.payload).toEqual({ message: 'Not found.' });
  });

  it('keeps the reset route blocked in production even when the flag is set', async () => {
    const env = buildEnv({
      NODE_ENV: 'production',
      AUTH_RATE_LIMIT_RESET_ENABLED: true,
      AUTH_RATE_LIMIT_RESET_TOKEN: 'test-reset-token',
    });

    const response = await injectLoginRateLimitReset({
      env,
      headers: { 'x-auth-rate-limit-reset-token': 'test-reset-token' },
    });

    expect(response.statusCode).toBe(404);
    expect(response.payload).toEqual({ message: 'Not found.' });
  });

  it('requires the reset token when the demo/dev reset route is enabled', async () => {
    const env = buildEnv({
      AUTH_RATE_LIMIT_RESET_ENABLED: true,
      AUTH_RATE_LIMIT_RESET_TOKEN: 'test-reset-token',
    });

    const response = await injectLoginRateLimitReset({ env });

    expect(response.statusCode).toBe(403);
    expect(response.payload).toEqual({ message: 'Reset is not available.' });
  });

  it('resets the selected IP and email bucket through the gated demo/dev reset route', async () => {
    const env = buildEnv({
      AUTH_RATE_LIMIT_RESET_ENABLED: true,
      AUTH_RATE_LIMIT_RESET_TOKEN: 'test-reset-token',
    });
    await injectLogin({ ip: '198.51.100.10', password: 'wrong', env });
    await injectLogin({ ip: '198.51.100.10', password: 'wrong', env });
    expect((await injectLogin({ ip: '198.51.100.10', password: 'wrong', env })).statusCode).toBe(429);

    const reset = await injectLoginRateLimitReset({
      env,
      email: 'Vendor@Example.COM',
      ip: '198.51.100.10',
      headers: { 'x-auth-rate-limit-reset-token': 'test-reset-token' },
    });
    const afterReset = await injectLogin({ ip: '198.51.100.10', password: 'wrong', env });

    expect(reset.statusCode).toBe(200);
    expect(reset.payload).toEqual({
      ok: true,
      reset: true,
      keyingStrategy: 'ip_email',
      email: 'vendor@example.com',
      ip: '198.51.100.10',
      maxAttempts: 2,
      windowSeconds: 600,
    });
    expect(afterReset.statusCode).toBe(401);
  });
});
