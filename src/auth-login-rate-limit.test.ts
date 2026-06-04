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
      info: vi.fn(),
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

function signExpiredJwt(secret: string) {
  const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64Url(JSON.stringify({
    sub: 'user-1',
    email: 'vendor@example.com',
    role: 'vendor',
    exp: Math.floor(Date.now() / 1000) - 60,
  }));
  const signature = createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${signature}`;
}

async function injectLogin(
  input: {
    email?: unknown;
    password?: unknown;
    ip?: string;
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
      headers: {},
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

  it('rejects /auth/me when the session cookie is missing', async () => {
    const handlers = createAuthRouteHandlers();
    const reply = createReply();

    await invokeGetRoute(
      handlers.get['/auth/me'],
      {
        method: 'GET',
        headers: {},
      },
      reply,
    );

    expect(reply.statusCode).toBe(401);
    expect(reply.payload).toEqual({ message: 'Unauthorized' });
  });

  it('rejects /auth/me when the session cookie is expired', async () => {
    const env = buildEnv();
    const handlers = createAuthRouteHandlers(env);
    const reply = createReply();
    const expiredToken = signExpiredJwt(env.JWT_SECRET);

    await invokeGetRoute(
      handlers.get['/auth/me'],
      {
        method: 'GET',
        headers: {
          cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(expiredToken)}`,
        },
      },
      reply,
    );

    expect(reply.statusCode).toBe(401);
    expect(reply.payload).toEqual({ message: 'Unauthorized' });
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
    expect(response.payload).toEqual({ message: 'Too many login attempts. Please try again later.' });
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

  it('counts failed and successful attempts before authentication result', async () => {
    await injectLogin({ password: 'wrong' });
    await injectLogin({ password: 'demo123' });

    const response = await injectLogin({ password: 'demo123' });

    expect(response.statusCode).toBe(429);
    expect(response.payload).toEqual({ message: 'Too many login attempts. Please try again later.' });
  });

  it('does not reveal whether the account exists when the rate limit is exceeded', async () => {
    findUniqueMock.mockResolvedValue(null);
    await injectLogin({ email: 'missing@example.com', password: 'wrong' });
    await injectLogin({ email: 'missing@example.com', password: 'wrong' });

    const response = await injectLogin({ email: 'missing@example.com', password: 'wrong' });

    expect(response.statusCode).toBe(429);
    expect(response.payload).toEqual({ message: 'Too many login attempts. Please try again later.' });
    expect(JSON.stringify(response.payload)).not.toContain('missing@example.com');
    expect(JSON.stringify(response.payload)).not.toContain('exists');
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
});
