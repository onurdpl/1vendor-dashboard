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
      pathMode?: LoginTransportProbePathMode;
    }
  | {
      result: 'timeout' | 'network_error' | 'http_error' | 'invalid_response' | 'not_configured';
      status: number | null;
      elapsedMs: number;
      pathMode?: LoginTransportProbePathMode;
    };

export type LoginTransportProbePathMode = 'same_origin_api' | 'direct_backend';

export type DualPathTransportDiagnosticInterpretation =
  | 'same_origin_path_suspected'
  | 'shared_transport_failure'
  | 'general_post_transport_ready'
  | 'inconclusive'
  | 'direct_probe_not_configured';

export type DualPathTransportDiagnosticResult = {
  sameOrigin: PublicLoginPostTransportResult;
  directBackend: PublicLoginPostTransportResult;
  interpretation: DualPathTransportDiagnosticInterpretation;
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
  authStartedAtMs?: number;
};

function getSafeBuiltUrlParts(path: string) {
  try {
    const fallbackOrigin = typeof window === 'undefined' ? 'https://vendor-dashboard.local' : window.location.origin;
    const url = new URL(buildApiUrl(path), fallbackOrigin);
    return {
      targetOrigin: url.origin,
      targetPathname: url.pathname,
    };
  } catch {
    return {
      targetOrigin: null,
      targetPathname: null,
    };
  }
}

function getLoginBoundaryDiagnostics(input: {
  authStartedAtMs?: number;
  signal?: AbortSignal;
}) {
  const builtUrl = getSafeBuiltUrlParts('/auth/login');
  return {
    requestPath: '/auth/login',
    requestMethod: 'POST',
    credentialsMode: getRequestCredentials(),
    signalExists: Boolean(input.signal),
    signalAborted: Boolean(input.signal?.aborted),
    durationMs: typeof input.authStartedAtMs === 'number' ? Date.now() - input.authStartedAtMs : null,
    ...builtUrl,
  };
}

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

function classifyProbeOutcome(result: PublicLoginPostTransportResult) {
  if (result.result === 'ready') {
    return 'success';
  }
  if (result.result === 'timeout') {
    return 'timeout';
  }
  if (result.result === 'network_error') {
    return 'network_error';
  }
  if (result.result === 'not_configured') {
    return 'not_configured';
  }

  return 'failure';
}

function isTransportFailure(result: PublicLoginPostTransportResult) {
  return result.result === 'timeout' || result.result === 'network_error';
}

export function interpretDualPathTransportDiagnostic(
  sameOrigin: PublicLoginPostTransportResult,
  directBackend: PublicLoginPostTransportResult,
): DualPathTransportDiagnosticInterpretation {
  if (directBackend.result === 'not_configured') {
    return 'direct_probe_not_configured';
  }
  if (isTransportFailure(sameOrigin) && directBackend.result === 'ready') {
    return 'same_origin_path_suspected';
  }
  if (isTransportFailure(sameOrigin) && isTransportFailure(directBackend)) {
    return 'shared_transport_failure';
  }
  if (sameOrigin.result === 'ready' && directBackend.result === 'ready') {
    return 'general_post_transport_ready';
  }

  return 'inconclusive';
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
  const authFlowId = options.authFlowId ?? options.authAttemptId ?? createAuthDiagnosticId('auth');
  const authRequestId = options.authRequestId ?? createAuthDiagnosticId('req');
  recordAuthDiagnostic('AUTH_BACKEND_LOGIN_ENTER', {
    flowId: authFlowId,
    stage: 'backend_auth_login_enter',
    outcome: 'started',
    requestId: authRequestId,
    source: 'backend-auth.login.enter',
    resultCategory: 'started',
    ...getLoginBoundaryDiagnostics({
      authStartedAtMs: options.authStartedAtMs,
      signal: options.signal,
    }),
  });
  logAuthClientInfo('AUTH_LOGIN_START', {
    authAttemptId: options.authAttemptId ?? null,
    flowId: authFlowId,
    stage: 'login_post',
    outcome: 'started',
    durationMs: 0,
  });
  recordAuthDiagnostic('LOGIN_REQUEST_START', {
    flowId: authFlowId,
    stage: 'login_post',
    outcome: 'started',
    requestId: authRequestId,
    source: 'backend-auth.login',
    resultCategory: 'started',
    durationMs: 0,
  });

  try {
    const response = await apiClient.post<BackendLoginResponse>('/auth/login', { email, password }, {
      headers: buildAuthCorrelationHeaders({
        authAttemptId: options.authAttemptId,
        authFlowId,
        authRequestId,
      }),
      skipVendorContext: true,
      authStartedAtMs: options.authStartedAtMs,
      signal: options.signal,
    });
    setCsrfToken(response.csrfToken);
    recordAuthDiagnostic('LOGIN_RESPONSE', {
      flowId: authFlowId,
      stage: 'login_post',
      outcome: 'success',
      requestId: authRequestId,
      source: 'backend-auth.login',
      resultCategory: 'success',
      durationMs: Date.now() - startedAt,
    });
    logAuthClientInfo('AUTH_LOGIN_SUCCESS', {
      authAttemptId: options.authAttemptId ?? null,
      flowId: authFlowId,
      stage: 'login_post',
      outcome: 'success',
      durationMs: Date.now() - startedAt,
    });
    return response;
  } catch (error) {
    const httpStatus = error instanceof ApiError ? error.status ?? null : null;
    const outcome = error instanceof ApiError && error.status === 401
      ? 'unauthorized'
      : error instanceof ApiError && error.status === 403
        ? 'forbidden'
        : options.signal?.aborted
          ? 'aborted'
          : 'failure';
    recordAuthDiagnostic('LOGIN_RESPONSE', {
      flowId: authFlowId,
      stage: 'login_post',
      outcome,
      requestId: authRequestId,
      source: 'backend-auth.login',
      httpStatus,
      durationMs: Date.now() - startedAt,
      resultCategory: outcome,
    });
    logAuthClientWarn('AUTH_LOGIN_FAILURE', {
      authAttemptId: options.authAttemptId ?? null,
      flowId: authFlowId,
      stage: 'login_post',
      outcome,
      httpStatus,
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
        pathMode: 'same_origin_api',
      };
    }

    try {
      const payload = await response.json() as { ok?: unknown; status?: unknown };
      if (payload.ok === true && payload.status === 'post_transport_ready') {
        return {
          result: 'ready',
          status: response.status,
          elapsedMs,
          pathMode: 'same_origin_api',
        };
      }
      return {
        result: 'invalid_response',
        status: response.status,
        elapsedMs,
        pathMode: 'same_origin_api',
      };
    } catch {
      return {
        result: 'invalid_response',
        status: response.status,
        elapsedMs,
        pathMode: 'same_origin_api',
      };
    }
  } catch {
    return {
      result: didTimeout ? 'timeout' : 'network_error',
      status: null,
      elapsedMs: Date.now() - startedAt,
      pathMode: 'same_origin_api',
    };
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function probeDirectBackendLoginPostTransport(
  options: AuthCorrelationOptions & { timeoutMs?: number } = {},
): Promise<PublicLoginPostTransportResult> {
  const diagnosticBackendOrigin = runtimeConfig.diagnosticBackendOrigin;
  if (!diagnosticBackendOrigin) {
    return {
      result: 'not_configured',
      status: null,
      elapsedMs: 0,
      pathMode: 'direct_backend',
    };
  }

  const startedAt = Date.now();
  const controller = new AbortController();
  let didTimeout = false;
  const timeout = window.setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, options.timeoutMs ?? 5_000);

  try {
    const response = await fetch(`${diagnosticBackendOrigin}/auth/diagnostics/public-login-transport`, {
      method: 'POST',
      credentials: 'omit',
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
        pathMode: 'direct_backend',
      };
    }

    try {
      const payload = await response.json() as { ok?: unknown; status?: unknown };
      if (payload.ok === true && payload.status === 'post_transport_ready') {
        return {
          result: 'ready',
          status: response.status,
          elapsedMs,
          pathMode: 'direct_backend',
        };
      }
      return {
        result: 'invalid_response',
        status: response.status,
        elapsedMs,
        pathMode: 'direct_backend',
      };
    } catch {
      return {
        result: 'invalid_response',
        status: response.status,
        elapsedMs,
        pathMode: 'direct_backend',
      };
    }
  } catch {
    return {
      result: didTimeout ? 'timeout' : 'network_error',
      status: null,
      elapsedMs: Date.now() - startedAt,
      pathMode: 'direct_backend',
    };
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function probeDualPathLoginPostTransport(
  options: AuthCorrelationOptions & { timeoutMs?: number } = {},
): Promise<DualPathTransportDiagnosticResult> {
  const authFlowId = options.authFlowId ?? options.authAttemptId ?? createAuthDiagnosticId('auth');
  const sameOriginRequestId = options.authRequestId ?? createAuthDiagnosticId('req');
  const directBackendRequestId = createAuthDiagnosticId('req');
  const startedAt = Date.now();

  recordAuthDiagnostic('LOGIN_POST_TRANSPORT_PROBE', {
    flowId: authFlowId,
    stage: 'login_transport_dual_probe_start',
    outcome: 'started',
    requestId: sameOriginRequestId,
    source: 'backend-auth.probeDualPathLoginPostTransport',
    resultCategory: 'started',
    method: 'POST',
    timeoutMs: options.timeoutMs ?? 5_000,
    durationMs: 0,
  });

  const [sameOrigin, directBackend] = await Promise.all([
    probePublicLoginPostTransport({
      authAttemptId: options.authAttemptId,
      authFlowId,
      authRequestId: sameOriginRequestId,
      timeoutMs: options.timeoutMs,
    }),
    probeDirectBackendLoginPostTransport({
      authAttemptId: options.authAttemptId,
      authFlowId,
      authRequestId: directBackendRequestId,
      timeoutMs: options.timeoutMs,
    }),
  ]);
  const interpretation = interpretDualPathTransportDiagnostic(sameOrigin, directBackend);

  recordAuthDiagnostic('LOGIN_POST_TRANSPORT_PROBE', {
    flowId: authFlowId,
    stage: 'login_transport_probe_same_origin_complete',
    pathMode: 'same_origin_api',
    method: 'POST',
    outcome: classifyProbeOutcome(sameOrigin),
    requestId: sameOriginRequestId,
    source: 'backend-auth.probeDualPathLoginPostTransport.sameOrigin',
    httpStatus: sameOrigin.status,
    resultCategory: classifyProbeOutcome(sameOrigin),
    durationMs: sameOrigin.elapsedMs,
  });
  recordAuthDiagnostic('LOGIN_POST_TRANSPORT_PROBE', {
    flowId: authFlowId,
    stage: 'login_transport_probe_direct_backend_complete',
    pathMode: 'direct_backend',
    method: 'POST',
    outcome: classifyProbeOutcome(directBackend),
    requestId: directBackendRequestId,
    source: 'backend-auth.probeDualPathLoginPostTransport.directBackend',
    httpStatus: directBackend.status,
    resultCategory: classifyProbeOutcome(directBackend),
    durationMs: directBackend.elapsedMs,
  });
  recordAuthDiagnostic('LOGIN_POST_TRANSPORT_PROBE', {
    flowId: authFlowId,
    stage: 'login_transport_dual_probe_complete',
    outcome: interpretation,
    requestId: sameOriginRequestId,
    source: 'backend-auth.probeDualPathLoginPostTransport.complete',
    resultCategory: interpretation === 'general_post_transport_ready' ? 'success' : 'unknown',
    method: 'POST',
    durationMs: Date.now() - startedAt,
  });

  return {
    sameOrigin,
    directBackend,
    interpretation,
  };
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
