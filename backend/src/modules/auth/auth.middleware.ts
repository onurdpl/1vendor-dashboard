import type { FastifyReply, FastifyRequest } from 'fastify';
import type { createAuthService } from './auth.service.js';
import { CSRF_HEADER_NAME, getSessionCookieToken } from './session-cookie.js';

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

function readHeaderValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

function requiresCsrfProtection(request: FastifyRequest) {
  return !['GET', 'HEAD', 'OPTIONS'].includes(request.method.toUpperCase());
}

export function createAuthMiddleware(authService: ReturnType<typeof createAuthService>) {
  async function authenticateRequest(request: FastifyRequest, reply: FastifyReply) {
    const bearerToken = getBearerToken(request);
    const cookieToken = bearerToken ? null : getSessionCookieToken(request);
    const token = bearerToken ?? cookieToken;
    if (!token) {
      return reply.code(401).send({ message: 'Unauthorized' });
    }

    const authUser = await authService.requestContextFromToken(token);
    if (!authUser) {
      return reply.code(401).send({ message: 'Unauthorized' });
    }

    request.authUser = authUser;
    request.authSessionSource = bearerToken ? 'bearer' : 'cookie';
    request.authSessionToken = token;

    if (request.authSessionSource === 'cookie' && requiresCsrfProtection(request)) {
      const csrfToken = readHeaderValue(request.headers[CSRF_HEADER_NAME]).trim();
      if (!authService.verifyCsrfToken(token, csrfToken)) {
        return reply.code(403).send({ message: 'CSRF verification failed.' });
      }
    }
  }

  return {
    authenticateRequest,
  };
}
