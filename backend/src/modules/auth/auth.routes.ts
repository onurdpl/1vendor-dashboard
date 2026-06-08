import type { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import type { AppEnv } from '../../config/env.js';
import { normalizeAuthAttemptId } from '../../lib/request-timing.js';
import { createAuthService } from './auth.service.js';
import { createAuthMiddleware } from './auth.middleware.js';
import type { AuthLoginRouteTiming, LoginBody } from './auth.types.js';
import { checkLoginRateLimit } from './login-rate-limit.js';
import { createClearSessionCookie, createSessionCookie, getSessionCookieToken } from './session-cookie.js';

export type ReturnTypeCreateAuthService = ReturnType<typeof createAuthService>;

type LoginFailureStage = 'body_validation' | 'rate_limit' | 'user_lookup' | 'password_verify' | 'user_status' | 'unknown' | null;
type LoginFailureReason = 'missing_credentials' | 'user_not_found' | 'invalid_password' | 'inactive_user' | 'unknown' | null;

export function registerAuthRoutes(app: FastifyInstance, env: AppEnv) {
  const authService = createAuthService(env);
  const authMiddleware = createAuthMiddleware(authService);

  app.post<{ Body: LoginBody }>('/auth/login', async (request, reply) => {
    const routeStartedAt = process.hrtime.bigint();
    const authAttemptId = normalizeAuthAttemptId(request.headers['x-auth-attempt-id']);
    const normalizedEmail = normalizeLoginEmail((request.body as Partial<Record<keyof LoginBody, unknown>> | undefined)?.email);
    if (authAttemptId) {
      reply.header('X-Auth-Attempt-Id', authAttemptId);
    }

    const body = request.body as Partial<Record<keyof LoginBody, unknown>> | undefined;
    const rawEmail = body?.email;
    const rawPassword = body?.password;
    const routeEntryToBodyValidationMs = elapsedMs(routeStartedAt);

    if (typeof rawEmail !== 'string' || typeof rawPassword !== 'string') {
      logAuthLoginDiagnostics(app, request, {
        email: normalizedEmail,
        success: false,
        failureStage: 'body_validation',
        failureReason: 'missing_credentials',
        responseStatus: 400,
        routeStartedAt,
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
      });
      return reply.code(400).send({ message: 'Email and password are required.' });
    }

    const loginRateLimit = checkLoginRateLimit(
      {
        ip: request.ip,
        email,
      },
      {
        maxAttempts: env.LOGIN_RATE_LIMIT_MAX_ATTEMPTS,
        windowSeconds: env.LOGIN_RATE_LIMIT_WINDOW_SECONDS,
      },
    );
    if (loginRateLimit.limited) {
      logAuthLoginDiagnostics(app, request, {
        email,
        success: false,
        failureStage: 'rate_limit',
        failureReason: 'unknown',
        responseStatus: 429,
        routeStartedAt,
      });
      return reply.code(429).send({ message: 'Too many login attempts. Please try again later.' });
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
      });
      throw error;
    }
    const routeEntryToServiceStartMs = elapsedMs(routeStartedAt, serviceStartedAt);

    if (!loginResult.success) {
      logAuthLoginDiagnostics(app, request, {
        email,
        success: false,
        failureStage: loginResult.failureStage,
        failureReason: loginResult.failureReason,
        responseStatus: 401,
        routeStartedAt,
        userLookupDurationMs: loginResult.timing.userLookupMs,
        passwordVerifyDurationMs: loginResult.timing.passwordVerificationMs,
        tokenIssueDurationMs: loginResult.timing.tokenSignMs,
      });
      return reply.code(401).send({ message: 'Invalid email or password.' });
    }

    const responsePreparationStartedAt = process.hrtime.bigint();
    const csrfToken = authService.createCsrfToken(loginResult.token);
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
      userLookupDurationMs: loginResult.timing.userLookupMs,
      passwordVerifyDurationMs: loginResult.timing.passwordVerificationMs,
      tokenIssueDurationMs: loginResult.timing.tokenSignMs,
      cookieSetDurationMs,
    });

    return responseBody;
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

function logAuthLoginDiagnostics(
  app: FastifyInstance,
  request: { requestId?: string; id?: string },
  input: {
    email: string | null;
    success: boolean;
    failureStage: LoginFailureStage;
    failureReason: LoginFailureReason;
    responseStatus: number;
    routeStartedAt: bigint;
    userLookupDurationMs?: number | null;
    passwordVerifyDurationMs?: number | null;
    tokenIssueDurationMs?: number | null;
    cookieSetDurationMs?: number | null;
  },
) {
  app.log.info(
    {
      event: 'AUTH_LOGIN_DIAGNOSTICS',
      requestId: request.requestId ?? request.id ?? null,
      email: input.email,
      success: input.success,
      failureStage: input.failureStage,
      failureReason: input.failureReason,
      totalDurationMs: elapsedMs(input.routeStartedAt),
      userLookupDurationMs: input.userLookupDurationMs ?? null,
      passwordVerifyDurationMs: input.passwordVerifyDurationMs ?? null,
      tokenIssueDurationMs: input.tokenIssueDurationMs ?? null,
      cookieSetDurationMs: input.cookieSetDurationMs ?? null,
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
