import { clearToken, getCurrentVendorContext, getToken } from './auth';
import { ApiError, type ApiErrorDiagnostics } from './api/errors';
import { getAppReadinessSnapshot } from './appReadiness';
import { runtimeConfig } from '../config/runtime';
import { isAuthDiagnosticsEnabled, recordAuthDiagnostic } from './auth/diagnostics';

type HttpMethod = 'GET' | 'POST' | 'PUT';
const CSRF_HEADER_NAME = 'X-CSRF-Token';

type ApiClientRequestOptions = {
  method?: HttpMethod;
  body?: unknown;
  token?: string | null;
  vendorId?: string | null;
  skipVendorContext?: boolean;
  headers?: HeadersInit;
  authStartedAtMs?: number;
  signal?: AbortSignal;
};

let csrfToken: string | null = null;

export function setCsrfToken(token: string | null | undefined) {
  csrfToken = token?.trim() || null;
}

export function clearCsrfToken() {
  csrfToken = null;
}

export function buildApiUrl(path: string) {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  const normalizedBase = runtimeConfig.apiBaseUrl.replace(/\/+$/, '');
  const normalizedPath = `/${path.replace(/^\/+/, '')}`;

  return `${normalizedBase}${normalizedPath}`;
}

function getCurrentRouteForAuthRedirect() {
  if (typeof window === 'undefined') {
    return '/';
  }

  const { pathname, search, hash } = window.location;
  return `${pathname || '/'}${search || ''}${hash || ''}`;
}

function createHeaders(options: ApiClientRequestOptions, hasBody: boolean) {
  const headers = new Headers(options.headers);
  const token = options.token !== undefined
    ? options.token
    : runtimeConfig.apiMode === 'real'
      ? null
      : getToken();
  const vendorId = options.skipVendorContext ? null : options.vendorId ?? getCurrentVendorContext().vendorId;

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  if (vendorId) {
    headers.set('X-Vendor-Id', vendorId);
  }

  if (hasBody && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  return headers;
}

function getAuthCorrelationHeader(headers: Headers, name: string) {
  const value = headers.get(name);
  return value?.trim() || null;
}

function getRequestCredentials(): RequestCredentials {
  return runtimeConfig.apiMode === 'real' ? 'include' : 'same-origin';
}

function getSafeBuiltUrlParts(url: string) {
  try {
    const fallbackOrigin = typeof window === 'undefined' ? 'https://vendor-dashboard.local' : window.location.origin;
    const parsed = new URL(url, fallbackOrigin);
    return {
      targetOrigin: parsed.origin,
      targetPathname: parsed.pathname,
    };
  } catch {
    return {
      targetOrigin: null,
      targetPathname: null,
    };
  }
}

function sanitizeDiagnosticErrorText(value: unknown) {
  if (typeof value !== 'string' || !value) {
    return null;
  }

  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
    .slice(0, 200);
}

function getErrorName(error: unknown) {
  if (error && typeof error === 'object' && 'name' in error) {
    const name = Reflect.get(error, 'name');
    return typeof name === 'string' && name ? name : null;
  }

  return null;
}

function getErrorMessage(error: unknown) {
  if (error && typeof error === 'object' && 'message' in error) {
    return sanitizeDiagnosticErrorText(Reflect.get(error, 'message'));
  }

  return sanitizeDiagnosticErrorText(String(error));
}

function isLoginPostRequest(method: HttpMethod, path: string) {
  return method === 'POST' && getDiagnosticEndpoint(path) === '/auth/login';
}

function createLoginFetchBoundaryDiagnostics(input: {
  method: HttpMethod;
  path: string;
  headers: Headers;
  builtUrl?: string;
  signal?: AbortSignal;
  authStartedAtMs?: number;
}) {
  const builtUrl = input.builtUrl ?? buildApiUrl(input.path);
  return {
    flowId: getAuthCorrelationHeader(input.headers, 'X-Auth-Flow-Id'),
    requestId: getAuthCorrelationHeader(input.headers, 'X-Auth-Request-Id'),
    requestPath: getDiagnosticEndpoint(input.path),
    requestMethod: input.method,
    credentialsMode: getRequestCredentials(),
    signalExists: Boolean(input.signal),
    signalAborted: Boolean(input.signal?.aborted),
    durationMs: typeof input.authStartedAtMs === 'number' ? Date.now() - input.authStartedAtMs : null,
    ...getSafeBuiltUrlParts(builtUrl),
  };
}

function getSafeAuthRouteDiagnostics() {
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

function logAuthClientInfo(event: string, details: Record<string, unknown> = {}) {
  if (!isAuthDiagnosticsEnabled()) {
    return;
  }

  console.info({
    event,
    ...getSafeAuthRouteDiagnostics(),
    ...details,
  });
}

function logAuthClientWarn(event: string, details: Record<string, unknown> = {}) {
  if (!isAuthDiagnosticsEnabled()) {
    return;
  }

  console.warn({
    event,
    ...getSafeAuthRouteDiagnostics(),
    ...details,
  });
}

function requiresCsrf(method: HttpMethod, path: string) {
  if (runtimeConfig.apiMode !== 'real' || method === 'GET') {
    return false;
  }

  const endpoint = getDiagnosticEndpoint(path);
  return endpoint !== '/auth/login' && endpoint !== '/auth/logout';
}

async function fetchCsrfToken(signal?: AbortSignal) {
  const startedAt = Date.now();
  logAuthClientInfo('AUTH_CSRF_START');
  let response: Response;

  try {
    response = await fetch(buildApiUrl('/auth/csrf'), {
      method: 'GET',
      credentials: getRequestCredentials(),
      signal,
    });
  } catch (error) {
    logAuthClientWarn('AUTH_CSRF_FAILURE', {
      durationMs: Date.now() - startedAt,
      status: null,
      requestId: null,
    });
    throw error;
  }

  if (!response.ok) {
    clearCsrfToken();
    logAuthClientWarn('AUTH_CSRF_FAILURE', {
      durationMs: Date.now() - startedAt,
      status: response.status,
      requestId: response.headers.get('x-request-id'),
    });
    throw new ApiError('Unauthorized request.', 'unauthorized', {
      status: response.status,
      diagnostics: {
        endpoint: '/auth/csrf',
        status: response.status,
        requestId: response.headers.get('x-request-id'),
        hasAuthHeader: false,
        hasVendorHeader: false,
        selectedVendorPresent: Boolean(getAppReadinessSnapshot().currentVendor.vendorId),
        readinessState: getAppReadinessSnapshot().status,
      },
    });
  }

  const payload = await response.json() as { csrfToken?: unknown };
  if (typeof payload.csrfToken !== 'string' || !payload.csrfToken.trim()) {
    clearCsrfToken();
    logAuthClientWarn('AUTH_CSRF_FAILURE', {
      durationMs: Date.now() - startedAt,
      status: response.status,
      requestId: response.headers.get('x-request-id'),
      reason: 'invalid-response',
    });
    throw new ApiError('CSRF token is unavailable.', 'invalid-response', {
      status: response.status,
      diagnostics: {
        endpoint: '/auth/csrf',
        status: response.status,
        requestId: response.headers.get('x-request-id'),
        hasAuthHeader: false,
        hasVendorHeader: false,
        selectedVendorPresent: Boolean(getAppReadinessSnapshot().currentVendor.vendorId),
        readinessState: getAppReadinessSnapshot().status,
      },
    });
  }

  setCsrfToken(payload.csrfToken);
  logAuthClientInfo('AUTH_CSRF_SUCCESS', {
    durationMs: Date.now() - startedAt,
    status: response.status,
    requestId: response.headers.get('x-request-id'),
  });
  return csrfToken;
}

async function attachCsrfHeaderIfNeeded(
  method: HttpMethod,
  path: string,
  headers: Headers,
  signal?: AbortSignal,
) {
  if (!requiresCsrf(method, path) || headers.has(CSRF_HEADER_NAME)) {
    return;
  }

  const token = csrfToken ?? await fetchCsrfToken(signal);
  if (token) {
    headers.set(CSRF_HEADER_NAME, token);
  }
}

function getDiagnosticEndpoint(path: string) {
  if (/^https?:\/\//i.test(path)) {
    try {
      return new URL(path).pathname || '/';
    } catch {
      return '/';
    }
  }

  try {
    return new URL(path, 'https://vendor-dashboard.local').pathname || '/';
  } catch {
    return path.startsWith('/') ? path.split('?')[0] : `/${path.split('?')[0]}`;
  }
}

function isSessionRestoreEndpoint(path: string) {
  return getDiagnosticEndpoint(path) === '/auth/me';
}

function getPayloadRequestId(payload: unknown) {
  if (!payload || typeof payload !== 'object' || !('requestId' in payload)) {
    return null;
  }

  const requestId = Reflect.get(payload, 'requestId');
  return typeof requestId === 'string' && requestId.trim() ? requestId : null;
}

function createApiDiagnostics(
  path: string,
  headers: Headers,
  response?: Response,
  payload?: unknown,
): ApiErrorDiagnostics {
  const readiness = getAppReadinessSnapshot();

  return {
    endpoint: getDiagnosticEndpoint(path),
    status: response?.status ?? null,
    requestId: response?.headers.get('x-request-id') ?? getPayloadRequestId(payload),
    hasAuthHeader: headers.has('Authorization'),
    hasVendorHeader: headers.has('X-Vendor-Id'),
    selectedVendorPresent: Boolean(readiness.currentVendor.vendorId),
    readinessState: readiness.status,
  };
}

async function parseResponse(response: Response, diagnostics?: ApiErrorDiagnostics) {
  if (response.status === 204) {
    return null;
  }

  const contentType = response.headers.get('content-type') ?? '';
  const rawBody = await response.text();

  if (!rawBody) {
    return null;
  }

  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(rawBody) as unknown;
    } catch {
      throw new ApiError('Received an invalid JSON response from the backend.', 'invalid-response', {
        status: response.status,
        diagnostics,
      });
    }
  }

  return rawBody;
}

async function request<T>(path: string, options: ApiClientRequestOptions = {}) {
  const hasBody = options.body !== undefined;
  const method = options.method ?? 'GET';
  const headers = createHeaders(options, hasBody);
  const isLoginPost = isLoginPostRequest(method, path);

  try {
    await attachCsrfHeaderIfNeeded(method, path, headers, options.signal);
    const builtUrl = buildApiUrl(path);
    if (isLoginPost) {
      recordAuthDiagnostic('AUTH_LOGIN_BUILD_API_URL_COMPLETE', {
        stage: 'build_api_url_complete',
        outcome: 'success',
        source: 'api-client.request.buildApiUrl',
        resultCategory: 'success',
        ...createLoginFetchBoundaryDiagnostics({
          method,
          path,
          headers,
          builtUrl,
          signal: options.signal,
          authStartedAtMs: options.authStartedAtMs,
        }),
      });
      recordAuthDiagnostic('AUTH_LOGIN_FETCH_CALL_ENTER', {
        stage: 'fetch_call_enter',
        outcome: 'started',
        source: 'api-client.request.fetch',
        resultCategory: 'started',
        ...createLoginFetchBoundaryDiagnostics({
          method,
          path,
          headers,
          builtUrl,
          signal: options.signal,
          authStartedAtMs: options.authStartedAtMs,
        }),
      });
    }
    const fetchPromise = fetch(builtUrl, {
      method,
      headers,
      body: hasBody ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
      credentials: getRequestCredentials(),
    });
    if (isLoginPost) {
      recordAuthDiagnostic('AUTH_LOGIN_FETCH_PROMISE_CREATED', {
        stage: 'fetch_promise_created',
        outcome: 'pending',
        source: 'api-client.request.fetch',
        resultCategory: 'started',
        ...createLoginFetchBoundaryDiagnostics({
          method,
          path,
          headers,
          builtUrl,
          signal: options.signal,
          authStartedAtMs: options.authStartedAtMs,
        }),
      });
    }
    const response = await fetchPromise;
    if (isLoginPost) {
      recordAuthDiagnostic('AUTH_LOGIN_FETCH_RESOLVED', {
        stage: 'fetch_resolved',
        outcome: response.ok ? 'success' : 'http_error',
        source: 'api-client.request.fetch',
        resultCategory: response.ok ? 'success' : 'failure',
        httpStatus: response.status,
        ...createLoginFetchBoundaryDiagnostics({
          method,
          path,
          headers,
          builtUrl,
          signal: options.signal,
          authStartedAtMs: options.authStartedAtMs,
        }),
      });
    }

    const parseDiagnostics = createApiDiagnostics(path, headers, response);
    const payload = await parseResponse(response, parseDiagnostics);

      if (!response.ok) {
      const diagnostics = createApiDiagnostics(path, headers, response, payload);

      if (response.status === 401 && !isSessionRestoreEndpoint(path)) {
        recordAuthDiagnostic('CACHE_USER_CLEAR', {
          flowId: getAuthCorrelationHeader(headers, 'X-Auth-Flow-Id'),
          requestId: getAuthCorrelationHeader(headers, 'X-Auth-Request-Id') ?? diagnostics.requestId,
          source: 'api-client.request.401-handler',
          httpStatus: response.status,
          resultCategory: 'unauthorized',
          cachedUserPresent: Boolean(getAppReadinessSnapshot().currentUser),
        });
        clearCsrfToken();
        clearToken({
          reason: 'expired',
          intendedPath: getCurrentRouteForAuthRedirect(),
          flowId: getAuthCorrelationHeader(headers, 'X-Auth-Flow-Id'),
          requestId: getAuthCorrelationHeader(headers, 'X-Auth-Request-Id') ?? diagnostics.requestId,
          source: 'api-client.request.401-handler',
        });
      }

      const backendMessage =
        payload && typeof payload === 'object' && 'message' in payload && typeof payload.message === 'string'
          ? payload.message
          : null;
      const message = !diagnostics.hasVendorHeader && diagnostics.readinessState === 'loading_vendor_context'
        ? 'Vendor context is still loading. Please retry.'
        : response.status === 401
          ? backendMessage ?? 'Unauthorized request.'
          : response.status === 403
            ? 'You do not have access to this workspace.'
            : backendMessage ?? 'Backend request failed.';

      throw new ApiError(message, response.status === 401 ? 'unauthorized' : 'server', {
        status: response.status,
        details: payload,
        diagnostics,
      });
    }

    return payload as T;
  } catch (error) {
    if (isLoginPost && !(error instanceof ApiError)) {
      const builtUrl = buildApiUrl(path);
      recordAuthDiagnostic('AUTH_LOGIN_FETCH_REJECTED', {
        stage: 'fetch_rejected',
        outcome: options.signal?.aborted ? 'aborted' : 'failure',
        source: 'api-client.request.fetch',
        resultCategory: options.signal?.aborted ? 'aborted' : 'network_error',
        errorName: getErrorName(error),
        errorMessage: getErrorMessage(error),
        ...createLoginFetchBoundaryDiagnostics({
          method,
          path,
          headers,
          builtUrl,
          signal: options.signal,
          authStartedAtMs: options.authStartedAtMs,
        }),
      });
    }
    if (error instanceof ApiError) {
      if (error.kind === 'unauthorized' && !isSessionRestoreEndpoint(path)) {
        recordAuthDiagnostic('CACHE_USER_CLEAR', {
          flowId: getAuthCorrelationHeader(headers, 'X-Auth-Flow-Id'),
          requestId: getAuthCorrelationHeader(headers, 'X-Auth-Request-Id') ?? error.diagnostics?.requestId ?? null,
          source: 'api-client.request.ApiError-unauthorized-handler',
          httpStatus: error.status ?? null,
          resultCategory: error.status === 403 ? 'forbidden' : 'unauthorized',
          cachedUserPresent: Boolean(getAppReadinessSnapshot().currentUser),
        });
        clearCsrfToken();
        clearToken({
          reason: 'expired',
          intendedPath: getCurrentRouteForAuthRedirect(),
          flowId: getAuthCorrelationHeader(headers, 'X-Auth-Flow-Id'),
          requestId: getAuthCorrelationHeader(headers, 'X-Auth-Request-Id') ?? error.diagnostics?.requestId ?? null,
          source: 'api-client.request.ApiError-unauthorized-handler',
        });
      }
      throw error;
    }

    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiError('The backend request timed out.', 'network', {
        diagnostics: createApiDiagnostics(path, headers),
      });
    }

    throw new ApiError(
      'Unable to reach the backend. The app can continue in mock mode or once the backend is available.',
      'network',
      { details: error, diagnostics: createApiDiagnostics(path, headers) },
    );
  }
}

export const apiClient = {
  get<T>(path: string, options: Omit<ApiClientRequestOptions, 'method' | 'body'> = {}) {
    return request<T>(path, { ...options, method: 'GET' });
  },
  post<T>(path: string, body?: unknown, options: Omit<ApiClientRequestOptions, 'method' | 'body'> = {}) {
    const headers = new Headers(options.headers);
    if (isLoginPostRequest('POST', path)) {
      const builtUrl = buildApiUrl(path);
      recordAuthDiagnostic('AUTH_API_CLIENT_LOGIN_POST_ENTER', {
        stage: 'api_client_post_enter',
        outcome: 'started',
        source: 'apiClient.post',
        resultCategory: 'started',
        ...createLoginFetchBoundaryDiagnostics({
          method: 'POST',
          path,
          headers,
          builtUrl,
          signal: options.signal,
          authStartedAtMs: options.authStartedAtMs,
        }),
      });
    }
    return request<T>(path, { ...options, method: 'POST', body });
  },
  put<T>(path: string, body?: unknown, options: Omit<ApiClientRequestOptions, 'method' | 'body'> = {}) {
    return request<T>(path, { ...options, method: 'PUT', body });
  },
};
