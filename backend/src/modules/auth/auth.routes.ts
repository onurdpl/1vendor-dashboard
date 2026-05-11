import type { FastifyInstance } from 'fastify';
import type { AppEnv } from '../../config/env.js';
import { createAuthService } from './auth.service.js';
import { createAuthMiddleware } from './auth.middleware.js';
import type { LoginBody } from './auth.types.js';

export type ReturnTypeCreateAuthService = ReturnType<typeof createAuthService>;

export function registerAuthRoutes(app: FastifyInstance, env: AppEnv) {
  const authService = createAuthService(env);
  const authMiddleware = createAuthMiddleware(authService);

  app.post<{ Body: LoginBody }>('/auth/login', async (request, reply) => {
    const email = request.body?.email;
    const password = request.body?.password;

    if (!email || !password) {
      return reply.code(400).send({ message: 'Email and password are required.' });
    }

    const loginResult = await authService.login({
      email,
      password,
    });

    if (!loginResult) {
      return reply.code(401).send({ message: 'Invalid email or password.' });
    }

    return loginResult;
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

