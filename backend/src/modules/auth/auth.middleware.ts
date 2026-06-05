import type { FastifyReply, FastifyRequest } from 'fastify';
import type { createAuthService } from './auth.service.js';
import type { AuthRestoreDiagnostics } from './auth.types.js';
import { CSRF_HEADER_NAME, getSessionCookieToken } from './session-cookie.js';
import { withDashboardTiming } from '../../lib/dashboard-timing.js';

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
    return withDashboardTiming('auth.session_validation', async () => {
    const bearerToken = getBearerToken(request);
    const cookieToken = getSessionCookieToken(request);
    const diagnostics: AuthRestoreDiagnostics = {
      cookiePresent: Boolean(cookieToken),
      authorizationBearerPresent: Boolean(bearerToken),
      jwtVerifySuccess: false,
      userLookupSuccess: false,
      authFailureStage: 'missing_token',
      selectedSessionSource: null,
      attemptedSessionSources: [],
    };
    request.authDiagnostics = diagnostics;

    const candidates = [
      bearerToken ? { source: 'bearer' as const, token: bearerToken } : null,
      cookieToken ? { source: 'cookie' as const, token: cookieToken } : null,
    ].filter((candidate): candidate is { source: 'bearer' | 'cookie'; token: string } => Boolean(candidate));

    if (!candidates.length) {
      return reply.code(401).send({ message: 'Unauthorized', authDiagnostics: diagnostics });
    }

    let authUser: Awaited<ReturnType<typeof authService.requestContextFromToken>> = null;
    let token: string | null = null;
    let source: 'bearer' | 'cookie' | null = null;

    for (const candidate of candidates) {
      diagnostics.attemptedSessionSources.push(candidate.source);
      const inspection = await authService.inspectToken(candidate.token);
      diagnostics.jwtVerifySuccess = inspection.jwtVerifySuccess;
      diagnostics.userLookupSuccess = inspection.userLookupSuccess;
      diagnostics.authFailureStage = inspection.authFailureStage;

      if (inspection.user) {
        authUser = {
          id: inspection.user.id,
          email: inspection.user.email,
          name: inspection.user.name,
          role: inspection.user.role,
          status: inspection.user.status,
        };
        token = candidate.token;
        source = candidate.source;
        diagnostics.selectedSessionSource = candidate.source;
        break;
      }
    }

    if (!authUser || !token || !source) {
      return reply.code(401).send({ message: 'Unauthorized', authDiagnostics: diagnostics });
    }

    request.authUser = authUser;
    request.authSessionSource = source;
    request.authSessionToken = token;

    if (request.authSessionSource === 'cookie' && requiresCsrfProtection(request)) {
      const csrfToken = readHeaderValue(request.headers[CSRF_HEADER_NAME]).trim();
      if (!authService.verifyCsrfToken(token, csrfToken)) {
        return reply.code(403).send({ message: 'CSRF verification failed.' });
      }
    }
    });
  }

  return {
    authenticateRequest,
  };
}
