import type { FastifyReply, FastifyRequest } from 'fastify';
import type { createAuthService } from './auth.service.js';
import type { AuthRestoreDiagnostics } from './auth.types.js';
import { CSRF_HEADER_NAME, getSessionCookieToken } from './session-cookie.js';
import { withDashboardTiming } from '../../lib/dashboard-timing.js';
import { normalizeAuthAttemptId } from '../../lib/request-timing.js';

type AuthMiddlewareOptions = {
  exposeAuthDiagnostics?: boolean;
};

function startTimer() {
  return process.hrtime.bigint();
}

function elapsedMs(startedAt: bigint) {
  return Math.max(0, Math.round((Number(process.hrtime.bigint() - startedAt) / 1_000_000) * 10) / 10);
}

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

function isAuthMeRequest(request: FastifyRequest) {
  return request.method.toUpperCase() === 'GET' && request.routeOptions?.url === '/auth/me';
}

function getAuthFailureReason(diagnostics: AuthRestoreDiagnostics) {
  if (!diagnostics.cookiePresent && !diagnostics.authorizationBearerPresent) {
    return 'missing_cookie' as const;
  }

  if (diagnostics.authFailureStage === 'user_lookup') {
    return 'user_not_found' as const;
  }

  return 'unknown' as const;
}

function logAuthMeRestoreDiagnostics(
  request: FastifyRequest,
  payload: {
    statusCode: number;
    routeHandlerDurationMs?: number | null;
    userLookupDurationMs?: number | null;
  },
) {
  if (!isAuthMeRequest(request)) {
    return;
  }

  const diagnostics = request.authDiagnostics;
  request.log.info(
    {
      event: 'AUTH_ME_RESTORE_DIAGNOSTICS',
      requestId: request.requestId ?? null,
      authAttemptId: normalizeAuthAttemptId(request.headers['x-auth-attempt-id']),
      authFlowId: normalizeAuthAttemptId(request.headers['x-auth-flow-id']),
      authRequestId: normalizeAuthAttemptId(request.headers['x-auth-request-id']),
      cookiePresent: diagnostics?.cookiePresent ?? false,
      authFailureStage: diagnostics?.authFailureStage ?? null,
      authFailureReason: request.authFailureReason ?? (diagnostics ? getAuthFailureReason(diagnostics) : 'unknown'),
      middlewareValidationDurationMs: request.authSessionValidationDurationMs ?? null,
      routeHandlerDurationMs: payload.routeHandlerDurationMs ?? null,
      userLookupDurationMs: payload.userLookupDurationMs ?? request.authSessionUserLookupDurationMs ?? null,
      responseStatus: payload.statusCode,
      sessionSource: request.authSessionSource ?? null,
    },
    'auth me restore diagnostics',
  );
}

export function createAuthMiddleware(
  authService: ReturnType<typeof createAuthService>,
  options: AuthMiddlewareOptions = {},
) {
  const exposeAuthDiagnostics = options.exposeAuthDiagnostics ?? process.env.NODE_ENV !== 'production';

  function buildUnauthorizedPayload(diagnostics?: AuthRestoreDiagnostics) {
    return exposeAuthDiagnostics && diagnostics
      ? { message: 'Unauthorized', authDiagnostics: diagnostics }
      : { message: 'Unauthorized' };
  }

  async function authenticateRequest(request: FastifyRequest, reply: FastifyReply) {
    const validationStartedAt = startTimer();
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
      request.authFailureReason = !cookieToken && !bearerToken ? 'missing_cookie' : 'unknown';

      const candidates = [
        bearerToken ? { source: 'bearer' as const, token: bearerToken } : null,
        cookieToken ? { source: 'cookie' as const, token: cookieToken } : null,
      ].filter((candidate): candidate is { source: 'bearer' | 'cookie'; token: string } => Boolean(candidate));

      if (!candidates.length) {
        request.authSessionValidationDurationMs = elapsedMs(validationStartedAt);
        logAuthMeRestoreDiagnostics(request, { statusCode: 401 });
        return reply.code(401).send(buildUnauthorizedPayload(diagnostics));
      }

      let authUser: Awaited<ReturnType<typeof authService.requestContextFromToken>> = null;
      let token: string | null = null;
      let source: 'bearer' | 'cookie' | null = null;

      for (const candidate of candidates) {
        diagnostics.attemptedSessionSources.push(candidate.source);
        const userLookupStartedAt = startTimer();
        const inspection = await authService.inspectToken(candidate.token);
        request.authSessionUserLookupDurationMs =
          (request.authSessionUserLookupDurationMs ?? 0) + elapsedMs(userLookupStartedAt);
        diagnostics.jwtVerifySuccess = inspection.jwtVerifySuccess;
        diagnostics.userLookupSuccess = inspection.userLookupSuccess;
        diagnostics.authFailureStage = inspection.authFailureStage;
        request.authFailureReason = inspection.authFailureReason ?? 'unknown';

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
          request.authUserResponse = inspection.user;
          break;
        }
      }

      if (!authUser || !token || !source) {
        request.authSessionValidationDurationMs = elapsedMs(validationStartedAt);
        logAuthMeRestoreDiagnostics(request, { statusCode: 401 });
        return reply.code(401).send(buildUnauthorizedPayload(diagnostics));
      }

      request.authUser = authUser;
      request.authSessionSource = source;
      request.authSessionToken = token;
      request.authFailureReason = undefined;

      if (request.authSessionSource === 'cookie' && requiresCsrfProtection(request)) {
        const csrfToken = readHeaderValue(request.headers[CSRF_HEADER_NAME]).trim();
        if (!authService.verifyCsrfToken(token, csrfToken)) {
          request.authSessionValidationDurationMs = elapsedMs(validationStartedAt);
          return reply.code(403).send({ message: 'CSRF verification failed.' });
        }
      }
      request.authSessionValidationDurationMs = elapsedMs(validationStartedAt);
    });
  }

  return {
    authenticateRequest,
    buildUnauthorizedPayload,
    logAuthMeRestoreDiagnostics,
  };
}
