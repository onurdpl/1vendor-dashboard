import type { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import { timingSafeEqual } from 'node:crypto';
import type { AppEnv } from '../../config/env.js';
import { normalizeAuthAttemptId } from '../../lib/request-timing.js';
import { createAuthService } from './auth.service.js';
import { createAuthMiddleware } from './auth.middleware.js';
import type { AuthLoginRouteTiming, LoginBody } from './auth.types.js';
import {
  checkLoginRateLimit,
  recordFailedLoginRateLimitAttempt,
  resetLoginRateLimit,
} from './login-rate-limit.js';
import {
  SESSION_COOKIE_NAME,
  createClearSessionCookie,
  createSessionCookie,
  getSessionCookieToken,
} from './session-cookie.js';

export type ReturnTypeCreateAuthService = ReturnType<typeof createAuthService>;

type LoginFailureStage = 'body_validation' | 'rate_limit' | 'user_lookup' | 'password_verify' | 'user_status' | 'unknown' | null;
type LoginFailureReason = 'missing_credentials' | 'user_not_found' | 'invalid_password' | 'inactive_user' | 'unknown' | null;

type LoginRateLimitResetBody = {
  email?: unknown;
  ip?: unknown;
};

export function registerAuthRoutes(app: FastifyInstance, env: AppEnv) {
  const authService = createAuthService(env);
  const authMiddleware = createAuthMiddleware(authService);

  app.post<{ Body: LoginBody }>('/auth/login', async (request, reply) => {
    const routeStartedAt = process.hrtime.bigint();
    const requestReceivedAt = new Date().toISOString();
    const routeEnteredAt = requestReceivedAt;
    const authAttemptId = normalizeAuthAttemptId(request.headers['x-auth-attempt-id']);
    const normalizedEmail = normalizeLoginEmail((request.body as Partial<Record<keyof LoginBody, unknown>> | undefined)?.email);
    if (authAttemptId) {
      reply.header('X-Auth-Attempt-Id', authAttemptId);
    }
    logAuthLoginRequestStart(app, request, {
      authAttemptId,
      normalizedEmail,
    });

    const body = request.body as Partial<Record<keyof LoginBody, unknown>> | undefined;
    const validationStartedAt = process.hrtime.bigint();
    const validationStartedAtIso = new Date().toISOString();
    const rawEmail = body?.email;
    const rawPassword = body?.password;
    const validationEndedAt = process.hrtime.bigint();
    const validationEndedAtIso = new Date().toISOString();
    const routeEntryToBodyValidationMs = elapsedMs(routeStartedAt);
    const validationDurationMs = elapsedMs(validationStartedAt, validationEndedAt);

    if (typeof rawEmail !== 'string' || typeof rawPassword !== 'string') {
      logAuthLoginDiagnostics(app, request, {
        email: normalizedEmail,
        success: false,
        failureStage: 'body_validation',
        failureReason: 'missing_credentials',
        responseStatus: 400,
        routeStartedAt,
        requestReceivedAt,
        routeEnteredAt,
        validationStartedAt: validationStartedAtIso,
        validationEndedAt: validationEndedAtIso,
        validationDurationMs,
      });
      return reply.code(400).send({ message: 'Email and password are required.' });
    }

    const email = rawEmail.trim().toLowerCase();
    const password = rawPassword;

    if (!email || !password) {
      logAuthLoginDiagnostics(app, request, {
        email,
        success: false,
        failureStage: 'body_validation',
        failureReason: 'missing_credentials',
        responseStatus: 400,
        routeStartedAt,
        requestReceivedAt,
        routeEnteredAt,
        validationStartedAt: validationStartedAtIso,
        validationEndedAt: validationEndedAtIso,
        validationDurationMs,
      });
      return reply.code(400).send({ message: 'Email and password are required.' });
    }

    const loginRateLimitIdentity = {
      ip: getLoginRateLimitIp(request),
      email,
    };
    const loginRateLimitConfig = {
      maxAttempts: env.LOGIN_RATE_LIMIT_MAX_ATTEMPTS,
      windowSeconds: env.LOGIN_RATE_LIMIT_WINDOW_SECONDS,
    };
    const loginRateLimit = checkLoginRateLimit(
      loginRateLimitIdentity,
      loginRateLimitConfig,
    );
    if (loginRateLimit.limited) {
      logAuthLoginDiagnostics(app, request, {
        email,
        success: false,
        failureStage: 'rate_limit',
        failureReason: 'unknown',
        responseStatus: 429,
        routeStartedAt,
        requestReceivedAt,
        routeEnteredAt,
        validationStartedAt: validationStartedAtIso,
        validationEndedAt: validationEndedAtIso,
        validationDurationMs,
      });
      const payload = buildLoginRateLimitExceededPayload(loginRateLimit);
      reply.header('Retry-After', String(payload.retryAfterSeconds));
      return reply.code(429).send(payload);
    }

    const serviceStartedAt = process.hrtime.bigint();
    let loginResult: Awaited<ReturnType<typeof authService.loginWithDiagnostics>>;
    try {
      loginResult = await authService.loginWithDiagnostics({
        email,
        password,
      });
    } catch (error) {
      logAuthLoginDiagnostics(app, request, {
        email,
        success: false,
        failureStage: 'unknown',
        failureReason: 'unknown',
        responseStatus: 500,
        routeStartedAt,
        requestReceivedAt,
        routeEnteredAt,
        validationStartedAt: validationStartedAtIso,
        validationEndedAt: validationEndedAtIso,
        validationDurationMs,
      });
      throw error;
    }
    const routeEntryToServiceStartMs = elapsedMs(routeStartedAt, serviceStartedAt);

    if (!loginResult.success) {
      recordFailedLoginRateLimitAttempt(loginRateLimitIdentity, loginRateLimitConfig);
      logAuthLoginDiagnostics(app, request, {
        email,
        success: false,
        failureStage: loginResult.failureStage,
        failureReason: loginResult.failureReason,
        responseStatus: 401,
        routeStartedAt,
        requestReceivedAt,
        routeEnteredAt,
        validationStartedAt: validationStartedAtIso,
        validationEndedAt: validationEndedAtIso,
        validationDurationMs,
        userLookupDurationMs: loginResult.timing.userLookupMs,
        passwordVerifyDurationMs: loginResult.timing.passwordVerificationMs,
        tokenIssueDurationMs: loginResult.timing.tokenSignMs,
      });
      return reply.code(401).send({ message: 'Invalid email or password.' });
    }

    resetLoginRateLimit(loginRateLimitIdentity);
    const responsePreparationStartedAt = process.hrtime.bigint();
    const csrfGenerationStartedAt = process.hrtime.bigint();
    const csrfToken = authService.createCsrfToken(loginResult.token);
    const csrfGenerationDurationMs = elapsedMs(csrfGenerationStartedAt);
    const cookieSetStartedAt = process.hrtime.bigint();
    reply.header('Set-Cookie', createSessionCookie(
      loginResult.token,
      getJwtMaxAgeSeconds(loginResult.token),
      shouldUseSecureSessionCookie(request, env),
    ));
    const cookieSetDurationMs = elapsedMs(cookieSetStartedAt);
    const responseBody = {
      user: loginResult.user,
      csrfToken,
    };
    const responsePreparationMs = elapsedMs(responsePreparationStartedAt);
    const serializationStartedAt = process.hrtime.bigint();
    const responseBytes = Buffer.byteLength(JSON.stringify(responseBody));
    const responseSerializationMs = elapsedMs(serializationStartedAt);
    const timing: AuthLoginRouteTiming = {
      ...loginResult.timing,
      routeEntryToBodyValidationMs,
      routeEntryToServiceStartMs,
      responsePreparationMs,
      responseSerializationMs,
      routeHandlerMs: elapsedMs(routeStartedAt),
    };

    app.log.info(
      {
        routeName: 'POST /auth/login',
        statusCode: 200,
        success: true,
        authAttemptId,
        role: loginResult.user.role,
        vendorAccessCount: loginResult.user.vendorAccess.length,
        responseBytes,
        timing,
      },
      'auth login timing',
    );
    logAuthLoginDiagnostics(app, request, {
      email,
      success: true,
      failureStage: null,
      failureReason: null,
      responseStatus: 200,
      routeStartedAt,
      requestReceivedAt,
      routeEnteredAt,
      validationStartedAt: validationStartedAtIso,
      validationEndedAt: validationEndedAtIso,
      validationDurationMs,
      userLookupDurationMs: loginResult.timing.userLookupMs,
      passwordVerifyDurationMs: loginResult.timing.passwordVerificationMs,
      tokenIssueDurationMs: loginResult.timing.tokenSignMs,
      cookieSetDurationMs,
      csrfGenerationDurationMs,
      sessionCookieSetAttempted: true,
      csrfTokenGenerationAttempted: true,
    });

    return responseBody;
  });

  app.get('/auth/diagnostics/public-login-readiness', async (request) => {
    const secure = shouldUseSecureSessionCookie(request, env);
    return {
      ok: true,
      serverTime: new Date().toISOString(),
      envMode: env.NODE_ENV,
      cookieConfig: {
        secure,
        sameSite: secure ? 'None' : 'Lax',
        cookieNamePresent: Boolean(SESSION_COOKIE_NAME),
      },
      cors: {
        originConfigured: env.CORS_ORIGIN.length > 0,
      },
      jwt: {
        expiresConfigPresent: Boolean(env.JWT_EXPIRES_IN?.trim()),
      },
    };
  });

  app.post<{ Body: LoginRateLimitResetBody }>('/auth/login-rate-limit/reset', async (request, reply) => {
    if (env.NODE_ENV === 'production' || env.AUTH_RATE_LIMIT_RESET_ENABLED !== true) {
      return reply.code(404).send({ message: 'Not found.' });
    }

    if (!isValidLoginRateLimitResetToken(request, env)) {
      return reply.code(403).send({ message: 'Reset is not available.' });
    }

    const body = request.body as LoginRateLimitResetBody | undefined;
    const email = normalizeLoginEmail(body?.email);
    if (!email) {
      return reply.code(400).send({ message: 'Email is required.' });
    }

    const ip = typeof body?.ip === 'string' && body.ip.trim()
      ? body.ip.trim()
      : getLoginRateLimitIp(request);
    resetLoginRateLimit({ ip, email });
    app.log.info(
      {
        event: 'AUTH_LOGIN_RATE_LIMIT_RESET',
        email,
        ip,
        keyingStrategy: 'ip_email',
        nodeEnv: env.NODE_ENV,
      },
      'auth login rate limit reset',
    );

    return {
      ok: true,
      reset: true,
      keyingStrategy: 'ip_email',
      email,
      ip,
      maxAttempts: env.LOGIN_RATE_LIMIT_MAX_ATTEMPTS,
      windowSeconds: env.LOGIN_RATE_LIMIT_WINDOW_SECONDS,
    };
  });

  app.post('/auth/logout', async (request, reply) => {
    reply.header('Set-Cookie', createClearSessionCookie(shouldUseSecureSessionCookie(request, env)));
    return { ok: true };
  });

  app.get('/auth/csrf', { preHandler: authMiddleware.authenticateRequest }, async (request, reply) => {
    const token = request.authSessionToken ?? getSessionCookieToken(request);
    if (!token) {
      return reply.code(401).send({ message: 'Unauthorized', authDiagnostics: request.authDiagnostics });
    }

    return {
      csrfToken: authService.createCsrfToken(token),
    };
  });

  app.get('/auth/me', { preHandler: authMiddleware.authenticateRequest }, async (request, reply) => {
    const routeStartedAt = process.hrtime.bigint();
    const authHeader = request.headers.authorization ?? '';
    const token = request.authSessionToken ?? authHeader.split(' ')[1];

    if (!token) {
      authMiddleware.logAuthMeRestoreDiagnostics(request, {
        statusCode: 401,
        routeHandlerDurationMs: elapsedMs(routeStartedAt),
        userLookupDurationMs: null,
      });
      return reply.code(401).send({ message: 'Unauthorized', authDiagnostics: request.authDiagnostics });
    }

    let user = request.authUserResponse ?? null;
    let userLookupDurationMs: number | null = null;
    if (!user) {
      const userLookupStartedAt = process.hrtime.bigint();
      user = await authService.currentUserFromToken(token);
      userLookupDurationMs = elapsedMs(userLookupStartedAt);
    }
    if (!user) {
      request.authFailureReason = 'user_not_found';
      authMiddleware.logAuthMeRestoreDiagnostics(request, {
        statusCode: 401,
        routeHandlerDurationMs: elapsedMs(routeStartedAt),
        userLookupDurationMs,
      });
      return reply.code(401).send({ message: 'Unauthorized', authDiagnostics: request.authDiagnostics });
    }

    const responseBody = {
      user,
      csrfToken: request.authSessionSource === 'cookie' ? authService.createCsrfToken(token) : null,
    };
    authMiddleware.logAuthMeRestoreDiagnostics(request, {
      statusCode: 200,
      routeHandlerDurationMs: elapsedMs(routeStartedAt),
      userLookupDurationMs,
    });
    return responseBody;
  });
}

function readHeaderValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

function getLoginRateLimitIp(request: { headers?: Record<string, string | string[] | undefined>; ip?: string }) {
  const forwardedIp = readHeaderValue(request.headers?.['x-forwarded-for'])
    .split(',')[0]
    ?.trim();

  return forwardedIp || request.ip || 'unknown';
}

function buildLoginRateLimitExceededPayload(input: { retryAfterSeconds: number; resetAtMs: number }) {
  return {
    message: 'Too many login attempts. Please try again later.',
    retryAfterSeconds: input.retryAfterSeconds,
    retryAt: new Date(input.resetAtMs).toISOString(),
  };
}

function timingSafeStringEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function isValidLoginRateLimitResetToken(
  request: { headers?: Record<string, string | string[] | undefined> },
  env: AppEnv,
) {
  const configuredToken = env.AUTH_RATE_LIMIT_RESET_TOKEN?.trim();
  const providedToken = readHeaderValue(request.headers?.['x-auth-rate-limit-reset-token']).trim();

  return Boolean(configuredToken && providedToken && timingSafeStringEqual(providedToken, configuredToken));
}

function shouldUseSecureSessionCookie(request: { headers?: Record<string, string | string[] | undefined>; protocol?: string }, env: AppEnv) {
  if (env.NODE_ENV === 'production') {
    return true;
  }

  const forwardedProto = readHeaderValue(request.headers?.['x-forwarded-proto'])
    .split(',')
    .map((entry) => entry.trim().toLowerCase());

  return forwardedProto.includes('https') || request.protocol === 'https';
}

function normalizeLoginEmail(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() || null : null;
}

function logAuthLoginRequestStart(
  app: FastifyInstance,
  request: {
    requestId?: string;
    id?: string;
    method?: string;
    routeOptions?: { url?: string };
    url?: string;
  },
  input: {
    authAttemptId: string | null;
    normalizedEmail: string | null;
  },
) {
  app.log.info(
    {
      event: 'AUTH_LOGIN_REQUEST_START',
      requestId: request.requestId ?? request.id ?? null,
      authAttemptId: input.authAttemptId,
      normalizedEmail: input.normalizedEmail,
      method: request.method ?? 'POST',
      path: request.routeOptions?.url ?? request.url ?? '/auth/login',
      timestamp: new Date().toISOString(),
    },
    'auth login request start',
  );
}

function logAuthLoginDiagnostics(
  app: FastifyInstance,
  request: { requestId?: string; id?: string; headers?: Record<string, string | string[] | undefined> },
  input: {
    email: string | null;
    success: boolean;
    failureStage: LoginFailureStage;
    failureReason: LoginFailureReason;
    responseStatus: number;
    routeStartedAt: bigint;
    requestReceivedAt?: string;
    routeEnteredAt?: string;
    validationStartedAt?: string;
    validationEndedAt?: string;
    validationDurationMs?: number | null;
    userLookupDurationMs?: number | null;
    passwordVerifyDurationMs?: number | null;
    tokenIssueDurationMs?: number | null;
    cookieSetDurationMs?: number | null;
    csrfGenerationDurationMs?: number | null;
    sessionCookieSetAttempted?: boolean;
    csrfTokenGenerationAttempted?: boolean;
  },
) {
  app.log.info(
    {
      event: 'AUTH_LOGIN_DIAGNOSTICS',
      requestId: request.requestId ?? request.id ?? null,
      authAttemptId: normalizeAuthAttemptId(request.headers?.['x-auth-attempt-id']),
      email: input.email,
      success: input.success,
      requestReceivedAt: input.requestReceivedAt ?? null,
      routeEnteredAt: input.routeEnteredAt ?? null,
      validationStartedAt: input.validationStartedAt ?? null,
      validationEndedAt: input.validationEndedAt ?? null,
      validationDurationMs: input.validationDurationMs ?? null,
      failureStage: input.failureStage,
      failureReason: input.failureReason,
      totalDurationMs: elapsedMs(input.routeStartedAt),
      userLookupDurationMs: input.userLookupDurationMs ?? null,
      passwordVerifyDurationMs: input.passwordVerifyDurationMs ?? null,
      tokenIssueDurationMs: input.tokenIssueDurationMs ?? null,
      cookieSetDurationMs: input.cookieSetDurationMs ?? null,
      csrfGenerationDurationMs: input.csrfGenerationDurationMs ?? null,
      sessionCookieSetAttempted: input.sessionCookieSetAttempted ?? false,
      csrfTokenGenerationAttempted: input.csrfTokenGenerationAttempted ?? false,
      csrfHeaderGenerationAttempted: false,
      responseStatus: input.responseStatus,
    },
    'auth login diagnostics',
  );
}

function elapsedMs(startedAt: bigint, endedAt: bigint = process.hrtime.bigint()) {
  return Math.max(0, Math.round((Number(endedAt - startedAt) / 1_000_000) * 10) / 10);
}

function getJwtMaxAgeSeconds(token: string) {
  const decoded = jwt.decode(token);
  if (!decoded || typeof decoded !== 'object' || typeof decoded.exp !== 'number') {
    return 12 * 60 * 60;
  }

  return Math.max(1, decoded.exp - Math.floor(Date.now() / 1000));
}
