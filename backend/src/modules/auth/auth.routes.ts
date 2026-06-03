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

export function registerAuthRoutes(app: FastifyInstance, env: AppEnv) {
  const authService = createAuthService(env);
  const authMiddleware = createAuthMiddleware(authService);
  const useSecureCookie = env.NODE_ENV === 'production';

  app.post<{ Body: LoginBody }>('/auth/login', async (request, reply) => {
    const routeStartedAt = process.hrtime.bigint();
    const authAttemptId = normalizeAuthAttemptId(request.headers['x-auth-attempt-id']);
    if (authAttemptId) {
      reply.header('X-Auth-Attempt-Id', authAttemptId);
    }

    const body = request.body as Partial<Record<keyof LoginBody, unknown>> | undefined;
    const rawEmail = body?.email;
    const rawPassword = body?.password;
    const routeEntryToBodyValidationMs = elapsedMs(routeStartedAt);

    if (typeof rawEmail !== 'string' || typeof rawPassword !== 'string') {
      return reply.code(400).send({ message: 'Email and password are required.' });
    }

    const email = rawEmail.trim().toLowerCase();
    const password = rawPassword;

    if (!email || !password) {
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
      return reply.code(429).send({ message: 'Too many login attempts. Please try again later.' });
    }

    const serviceStartedAt = process.hrtime.bigint();
    const loginResult = await authService.login({
      email,
      password,
    });
    const routeEntryToServiceStartMs = elapsedMs(routeStartedAt, serviceStartedAt);

    if (!loginResult) {
      return reply.code(401).send({ message: 'Invalid email or password.' });
    }

    const responsePreparationStartedAt = process.hrtime.bigint();
    const csrfToken = authService.createCsrfToken(loginResult.token);
    reply.header('Set-Cookie', createSessionCookie(
      loginResult.token,
      getJwtMaxAgeSeconds(loginResult.token),
      useSecureCookie,
    ));
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

    return responseBody;
  });

  app.post('/auth/logout', async (_request, reply) => {
    reply.header('Set-Cookie', createClearSessionCookie(useSecureCookie));
    return { ok: true };
  });

  app.get('/auth/csrf', { preHandler: authMiddleware.authenticateRequest }, async (request, reply) => {
    const token = request.authSessionToken ?? getSessionCookieToken(request);
    if (!token) {
      return reply.code(401).send({ message: 'Unauthorized' });
    }

    return {
      csrfToken: authService.createCsrfToken(token),
    };
  });

  app.get('/auth/me', { preHandler: authMiddleware.authenticateRequest }, async (request, reply) => {
    const authHeader = request.headers.authorization ?? '';
    const token = request.authSessionToken ?? authHeader.split(' ')[1];

    if (!token) {
      return reply.code(401).send({ message: 'Unauthorized' });
    }

    const user = await authService.currentUserFromToken(token);
    if (!user) {
      return reply.code(401).send({ message: 'Unauthorized' });
    }

    return {
      user,
      csrfToken: request.authSessionSource === 'cookie' ? authService.createCsrfToken(token) : null,
    };
  });
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
