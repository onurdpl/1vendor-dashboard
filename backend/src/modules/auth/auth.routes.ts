import type { FastifyInstance } from 'fastify';
import type { AppEnv } from '../../config/env.js';
import { createAuthService } from './auth.service.js';
import { createAuthMiddleware } from './auth.middleware.js';
import type { AuthLoginRouteTiming, LoginBody } from './auth.types.js';

export type ReturnTypeCreateAuthService = ReturnType<typeof createAuthService>;

export function registerAuthRoutes(app: FastifyInstance, env: AppEnv) {
  const authService = createAuthService(env);
  const authMiddleware = createAuthMiddleware(authService);

  app.post<{ Body: LoginBody }>('/auth/login', async (request, reply) => {
    const routeStartedAt = process.hrtime.bigint();
    const email = request.body?.email;
    const password = request.body?.password;
    const routeEntryToBodyValidationMs = elapsedMs(routeStartedAt);

    if (!email || !password) {
      return reply.code(400).send({ message: 'Email and password are required.' });
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
    const responseBody = {
      token: loginResult.token,
      user: loginResult.user,
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
        role: loginResult.user.role,
        vendorAccessCount: loginResult.user.vendorAccess.length,
        responseBytes,
        timing,
      },
      'auth login timing',
    );

    return responseBody;
  });

  app.get('/auth/me', { preHandler: authMiddleware.authenticateRequest }, async (request, reply) => {
    const authHeader = request.headers.authorization ?? '';
    const token = authHeader.split(' ')[1];

    if (!token) {
      return reply.code(401).send({ message: 'Unauthorized' });
    }

    const user = await authService.currentUserFromToken(token);
    if (!user) {
      return reply.code(401).send({ message: 'Unauthorized' });
    }

    return { user };
  });
}

function elapsedMs(startedAt: bigint, endedAt: bigint = process.hrtime.bigint()) {
  return Math.max(0, Math.round((Number(endedAt - startedAt) / 1_000_000) * 10) / 10);
}
