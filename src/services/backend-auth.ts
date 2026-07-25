import { apiClient, buildApiUrl, clearCsrfToken, setCsrfToken } from '../lib/api-client';
import { ApiError } from '../lib/api/errors';
import { runtimeConfig } from '../config/runtime';
import { createAuthDiagnosticId, isAuthDiagnosticsEnabled, recordAuthDiagnostic } from '../lib/auth/diagnostics';

export type BackendAuthVendorAccess = {
  vendorId: string;
  vendorName: string;
  status?: string;
  restrictionReason?: string | null;
  restrictionChangedByUserId?: string | null;
  restrictionChangedAt?: string | null;
};

export type BackendAuthUser = {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'vendor' | 'support' | 'finance';
  status: string;
  vendorAccess: BackendAuthVendorAccess[];
};

export type BackendLoginResponse = {
  user: BackendAuthUser;
  csrfToken?: string | null;
};

export type PublicLoginReadinessResponse =
  | {
      ok: true;
      status: 'ready';
    }
  | {
      ok: boolean;
      serverTime: string;
      envMode: string;
      cookieConfig: {
        secure: boolean;
        sameSite: string;
        cookieNamePresent: boolean;
      };
      cors: {
        originConfigured: boolean;
      };
      jwt: {
        expiresConfigPresent: boolean;
      };
    };

export type PublicLoginReadinessResult =
  | {
      ok: true;
      status: number;
      elapsedMs: number;
      response: PublicLoginReadinessResponse;
    }
  | {
      ok: false;
      status: number | null;
      elapsedMs: number;
      failureStage: 'readiness_timeout' | 'readiness_network_error' | 'readiness_http_error' | 'readiness_parse_error';
    };

export type PublicLoginPostTransportResult =
  | {
      result: 'ready';
      status: number;
      elapsedMs: number;
    }
  | {
      result: 'timeout' | 'network_error' | 'http_error' | 'invalid_response';
      status: number | null;
      elapsedMs: number;
    };

function getRequestCredentials(): RequestCredentials {
  return runtimeConfig.apiMode === 'real' ? 'include' : 'same-origin';
}

function getSafeRouteDiagnostics() {
  if (typeof window === 'undefined') {
    return {
      pathname: '/',
      hash: '',
    };
  }

  return {
    pathname: window.location.pathname || '/',
    hash: window.location.hash || '',
  };
}

function getErrorDiagnostics(error: unknown) {
  if (error instanceof ApiError) {
    return {
      kind: error.kind,
      status: error.status ?? null,
      requestId: error.diagnostics?.requestId ?? null,
    };
  }

  return {
    kind: 'unknown',
    status: null,
    requestId: null,
  };
}

type AuthCorrelationOptions = {
  authAttemptId?: string;
  authFlowId?: string;
  authRequestId?: string;
};

function logAuthClientInfo(event: string, details: Record<string, unknown> = {}) {
  if (!isAuthDiagnosticsEnabled()) {
    return;
  }

  console.info({
    event,
    ...getSafeRouteDiagnostics(),
    ...details,
  });
}

function buildAuthCorrelationHeaders(options: AuthCorrelationOptions) {
  const headers: Record<string, string> = {};
  const authFlowId = options.authFlowId ?? options.authAttemptId;
  const authRequestId = options.authRequestId;

  if (options.authAttemptId) {
    headers['X-Auth-Attempt-Id'] = options.authAttemptId;
  }
  if (authFlowId) {
    headers['X-Auth-Flow-Id'] = authFlowId;
  }
  if (authRequestId) {
    headers['X-Auth-Request-Id'] = authRequestId;
  }

  return Object.keys(headers).length ? headers : undefined;
}

function logAuthClientWarn(event: string, details: Record<string, unknown> = {}) {
  if (!isAuthDiagnosticsEnabled()) {
    return;
  }

  console.warn({
    event,
    ...getSafeRouteDiagnostics(),
    ...details,
  });
}

export async function login(
  email: string,
  password: string,
  options: AuthCorrelationOptions & { signal?: AbortSignal } = {},
) {
  const startedAt = Date.now();
  logAuthClientInfo('AUTH_LOGIN_START', { authAttemptId: options.authAttemptId ?? null });
  const authFlowId = options.authFlowId ?? options.authAttemptId ?? createAuthDiagnosticId('auth');
  const authRequestId = options.authRequestId ?? createAuthDiagnosticId('req');
  recordAuthDiagnostic('LOGIN_REQUEST_START', {
    flowId: authFlowId,
    requestId: authRequestId,
    source: 'backend-auth.login',
    resultCategory: 'started',
  });

  try {
    const response = await apiClient.post<BackendLoginResponse>('/auth/login', { email, password }, {
      headers: buildAuthCorrelationHeaders({
        authAttemptId: options.authAttemptId,
        authFlowId,
        authRequestId,
      }),
      skipVendorContext: true,
      signal: options.signal,
    });
    setCsrfToken(response.csrfToken);
    recordAuthDiagnostic('LOGIN_RESPONSE', {
      flowId: authFlowId,
      requestId: authRequestId,
      source: 'backend-auth.login',
      resultCategory: 'success',
    });
    logAuthClientInfo('AUTH_LOGIN_SUCCESS', {
      authAttemptId: options.authAttemptId ?? null,
      durationMs: Date.now() - startedAt,
    });
    return response;
  } catch (error) {
    recordAuthDiagnostic('LOGIN_RESPONSE', {
      flowId: authFlowId,
      requestId: authRequestId,
      source: 'backend-auth.login',
      httpStatus: error instanceof ApiError ? error.status ?? null : null,
      resultCategory: error instanceof ApiError && error.status === 401
        ? 'unauthorized'
        : error instanceof ApiError && error.status === 403
          ? 'forbidden'
          : options.signal?.aborted
            ? 'aborted'
            : 'failure',
    });
    logAuthClientWarn('AUTH_LOGIN_FAILURE', {
      authAttemptId: options.authAttemptId ?? null,
      durationMs: Date.now() - startedAt,
      ...getErrorDiagnostics(error),
    });
    throw error;
  }
}

export async function probePublicLoginReadiness(
  options: AuthCorrelationOptions & { timeoutMs?: number } = {},
): Promise<PublicLoginReadinessResult> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), options.timeoutMs ?? 3_000);

  try {
    const response = await fetch(buildApiUrl('/auth/diagnostics/public-login-readiness'), {
      method: 'GET',
      credentials: getRequestCredentials(),
      headers: buildAuthCorrelationHeaders(options),
      signal: controller.signal,
    });
    const elapsedMs = Date.now() - startedAt;
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        elapsedMs,
        failureStage: 'readiness_http_error',
      };
    }

    try {
      return {
        ok: true,
        status: response.status,
        elapsedMs,
        response: await response.json() as PublicLoginReadinessResponse,
      };
    } catch {
      return {
        ok: false,
        status: response.status,
        elapsedMs,
        failureStage: 'readiness_parse_error',
      };
    }
  } catch (error) {
    return {
      ok: false,
      status: null,
      elapsedMs: Date.now() - startedAt,
      failureStage: error instanceof DOMException && error.name === 'AbortError'
        ? 'readiness_timeout'
        : 'readiness_network_error',
    };
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function probePublicLoginPostTransport(
  options: AuthCorrelationOptions & { timeoutMs?: number } = {},
): Promise<PublicLoginPostTransportResult> {
  const startedAt = Date.now();
  const controller = new AbortController();
  let didTimeout = false;
  const timeout = window.setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, options.timeoutMs ?? 5_000);

  try {
    const response = await fetch(buildApiUrl('/auth/diagnostics/public-login-transport'), {
      method: 'POST',
      credentials: getRequestCredentials(),
      headers: {
        'Content-Type': 'application/json',
        ...buildAuthCorrelationHeaders(options),
      },
      body: JSON.stringify({ probe: 'login-post-transport' }),
      signal: controller.signal,
    });
    const elapsedMs = Date.now() - startedAt;

    if (!response.ok) {
      return {
        result: 'http_error',
        status: response.status,
        elapsedMs,
      };
    }

    try {
      const payload = await response.json() as { ok?: unknown; status?: unknown };
      if (payload.ok === true && payload.status === 'post_transport_ready') {
        return {
          result: 'ready',
          status: response.status,
          elapsedMs,
        };
      }
      return {
        result: 'invalid_response',
        status: response.status,
        elapsedMs,
      };
    } catch {
      return {
        result: 'invalid_response',
        status: response.status,
        elapsedMs,
      };
    }
  } catch {
    return {
      result: didTimeout ? 'timeout' : 'network_error',
      status: null,
      elapsedMs: Date.now() - startedAt,
    };
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function me(options: AuthCorrelationOptions & { signal?: AbortSignal } = {}) {
  const startedAt = Date.now();
  logAuthClientInfo('AUTH_SESSION_CHECK_START', { authAttemptId: options.authAttemptId ?? null });
  const authFlowId = options.authFlowId ?? options.authAttemptId ?? createAuthDiagnosticId('restore');
  const authRequestId = options.authRequestId ?? createAuthDiagnosticId('req');
  recordAuthDiagnostic('SESSION_RESTORE_START', {
    flowId: authFlowId,
    requestId: authRequestId,
    source: 'backend-auth.me',
    resultCategory: 'started',
  });

  try {
    const response = await apiClient.get<{ user: BackendAuthUser; csrfToken?: string | null }>('/auth/me', {
      headers: buildAuthCorrelationHeaders({
        authAttemptId: options.authAttemptId,
        authFlowId,
        authRequestId,
      }),
      vendorId: null,
      signal: options.signal,
    });
    setCsrfToken(response.csrfToken);
    recordAuthDiagnostic('SESSION_RESTORE_RESPONSE', {
      flowId: authFlowId,
      requestId: authRequestId,
      source: 'backend-auth.me',
      resultCategory: 'success',
    });
    logAuthClientInfo('AUTH_SESSION_CHECK_SUCCESS', {
      authAttemptId: options.authAttemptId ?? null,
      durationMs: Date.now() - startedAt,
    });

    return response.user;
  } catch (error) {
    recordAuthDiagnostic('SESSION_RESTORE_RESPONSE', {
      flowId: authFlowId,
      requestId: authRequestId,
      source: 'backend-auth.me',
      httpStatus: error instanceof ApiError ? error.status ?? null : null,
      resultCategory: error instanceof ApiError && error.status === 401
        ? 'unauthorized'
        : error instanceof ApiError && error.status === 403
          ? 'forbidden'
          : options.signal?.aborted
            ? 'aborted'
            : 'failure',
    });
    logAuthClientWarn('AUTH_SESSION_CHECK_FAILURE', {
      authAttemptId: options.authAttemptId ?? null,
      durationMs: Date.now() - startedAt,
      ...getErrorDiagnostics(error),
    });
    throw error;
  }
}

export async function logout() {
  const authRequestId = createAuthDiagnosticId('req');
  recordAuthDiagnostic('LOGOUT_TRIGGER', {
    flowId: null,
    requestId: authRequestId,
    source: 'backend-auth.logout',
    resultCategory: 'started',
  });
  try {
    await apiClient.post<{ ok: true }>('/auth/logout', undefined, {
      headers: buildAuthCorrelationHeaders({ authRequestId }),
      skipVendorContext: true,
    });
  } finally {
    clearCsrfToken();
  }
}
