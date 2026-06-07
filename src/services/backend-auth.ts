import { apiClient, clearCsrfToken, setCsrfToken } from '../lib/api-client';
import { ApiError } from '../lib/api/errors';

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
