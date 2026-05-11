import type { FastifyReply, FastifyRequest } from 'fastify';
import type { createAuthService } from './auth.service.js';

function getBearerToken(request: FastifyRequest) {
  const authHeader = request.headers.authorization;
  if (!authHeader) {
    return null;
  }

  const [scheme, token] = authHeader.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    return null;
  }

  return token.trim();
}

export function createAuthMiddleware(authService: ReturnType<typeof createAuthService>) {
  async function authenticateRequest(request: FastifyRequest, reply: FastifyReply) {
    const token = getBearerToken(request);
    if (!token) {
      return reply.code(401).send({ message: 'Unauthorized' });
    }

    const authUser = await authService.requestContextFromToken(token);
    if (!authUser) {
      return reply.code(401).send({ message: 'Unauthorized' });
    }

    request.authUser = authUser;
  }

  return {
    authenticateRequest,
  };
}
