import { apiClient, clearCsrfToken, setCsrfToken } from '../lib/api-client';
import { ApiError } from '../lib/api/errors';
import { runtimeConfig } from '../config/runtime';

export type BackendAuthVendorAccess = {
  vendorId: string;
  vendorName: string;
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

export type PublicLoginReadinessResponse = {
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

function buildApiUrl(path: string) {
  const normalizedBase = runtimeConfig.apiBaseUrl.endsWith('/')
    ? runtimeConfig.apiBaseUrl.slice(0, -1)
    : runtimeConfig.apiBaseUrl;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;

  return `${normalizedBase}${normalizedPath}`;
}

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

function logAuthClientInfo(event: string, details: Record<string, unknown> = {}) {
  console.info({
    event,
    ...getSafeRouteDiagnostics(),
    ...details,
  });
}

function logAuthClientWarn(event: string, details: Record<string, unknown> = {}) {
  console.warn({
    event,
    ...getSafeRouteDiagnostics(),
    ...details,
  });
}

export async function login(
  email: string,
  password: string,
  options: { authAttemptId?: string; signal?: AbortSignal } = {},
) {
  const startedAt = Date.now();
  logAuthClientInfo('AUTH_LOGIN_START', { authAttemptId: options.authAttemptId ?? null });

  try {
    const response = await apiClient.post<BackendLoginResponse>('/auth/login', { email, password }, {
      headers: options.authAttemptId ? { 'X-Auth-Attempt-Id': options.authAttemptId } : undefined,
      skipVendorContext: true,
      signal: options.signal,
    });
    setCsrfToken(response.csrfToken);
    logAuthClientInfo('AUTH_LOGIN_SUCCESS', {
      authAttemptId: options.authAttemptId ?? null,
      durationMs: Date.now() - startedAt,
    });
    return response;
  } catch (error) {
    logAuthClientWarn('AUTH_LOGIN_FAILURE', {
      authAttemptId: options.authAttemptId ?? null,
      durationMs: Date.now() - startedAt,
      ...getErrorDiagnostics(error),
    });
    throw error;
  }
}

export async function probePublicLoginReadiness(
  options: { authAttemptId?: string; timeoutMs?: number } = {},
): Promise<PublicLoginReadinessResult> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), options.timeoutMs ?? 3_000);

  try {
    const response = await fetch(buildApiUrl('/auth/diagnostics/public-login-readiness'), {
      method: 'GET',
      credentials: getRequestCredentials(),
      headers: options.authAttemptId ? { 'X-Auth-Attempt-Id': options.authAttemptId } : undefined,
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

export async function me(options: { signal?: AbortSignal } = {}) {
  const startedAt = Date.now();
  logAuthClientInfo('AUTH_SESSION_CHECK_START');

  try {
    const response = await apiClient.get<{ user: BackendAuthUser; csrfToken?: string | null }>('/auth/me', {
      vendorId: null,
      signal: options.signal,
    });
    setCsrfToken(response.csrfToken);
    logAuthClientInfo('AUTH_SESSION_CHECK_SUCCESS', {
      durationMs: Date.now() - startedAt,
    });

    return response.user;
  } catch (error) {
    logAuthClientWarn('AUTH_SESSION_CHECK_FAILURE', {
      durationMs: Date.now() - startedAt,
      ...getErrorDiagnostics(error),
    });
    throw error;
  }
}

export async function logout() {
  await apiClient.post<{ ok: true }>('/auth/logout', undefined, {
    skipVendorContext: true,
  });
  clearCsrfToken();
}
