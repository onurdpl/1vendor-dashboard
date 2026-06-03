import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppEnv } from '../backend/src/config/env.js';

const findUniqueMock = vi.hoisted(() => vi.fn());

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: {
    user: {
      findUnique: findUniqueMock,
    },
  },
}));

const { registerAuthRoutes } = await import('../backend/src/modules/auth/auth.routes.js');
const { resetLoginRateLimitForTests } = await import('../backend/src/modules/auth/login-rate-limit.js');

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
    headers: {} as Record<string, string>,
    code: vi.fn((status: number) => {
      reply.statusCode = status;
      return reply;
    }),
    send: vi.fn((payload: unknown) => {
      reply.payload = payload;
      reply.sent = true;
      return payload;
    }),
    header: vi.fn((key: string, value: string) => {
      reply.headers[key] = value;
      return reply;
    }),
  };

  return reply;
}

function createLoginRoute(env = buildEnv()) {
  let handler: ((request: Record<string, unknown>, reply: ReturnType<typeof createReply>) => Promise<unknown>) | null = null;
  const app = {
    post: vi.fn((path: string, routeHandler: typeof handler) => {
      if (path === '/auth/login') {
        handler = routeHandler;
      }
    }),
    get: vi.fn(),
    log: {
      info: vi.fn(),
    },
  };

  registerAuthRoutes(app as never, env);
  return handler;
}

async function injectLogin(
  input: {
    email?: string;
    password?: string;
    ip?: string;
    env?: AppEnv;
  } = {},
) {
  const handler = createLoginRoute(input.env);
  const reply = createReply();
  const result = await handler?.(
    {
      headers: {},
      body: {
        email: input.email ?? 'vendor@example.com',
        password: input.password ?? 'demo123',
      },
      ip: input.ip ?? '127.0.0.1',
    },
    reply,
  );

  return {
    statusCode: reply.statusCode,
    payload: reply.sent ? reply.payload : result,
  };
}

describe('auth login rate limiting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetLoginRateLimitForTests();
    findUniqueMock.mockResolvedValue(buildUser());
  });

  it('keeps login behavior unchanged under the configured limit', async () => {
    const response = await injectLogin();

    expect(response.statusCode).toBe(200);
    expect(response.payload).toEqual(
      expect.objectContaining({
        token: expect.any(String),
        user: expect.objectContaining({
          email: 'vendor@example.com',
          role: 'vendor',
        }),
      }),
    );
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
