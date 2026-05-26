import { clearToken, getCurrentVendorContext, getToken } from './auth';
import { ApiError, type ApiErrorDiagnostics } from './api/errors';
import { getAppReadinessSnapshot } from './appReadiness';
import { runtimeConfig } from '../config/runtime';

type HttpMethod = 'GET' | 'POST' | 'PUT';

type ApiClientRequestOptions = {
  method?: HttpMethod;
  body?: unknown;
  token?: string | null;
  vendorId?: string | null;
  skipVendorContext?: boolean;
  headers?: HeadersInit;
  signal?: AbortSignal;
};

function buildUrl(path: string) {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  const normalizedBase = runtimeConfig.apiBaseUrl.endsWith('/')
    ? runtimeConfig.apiBaseUrl.slice(0, -1)
    : runtimeConfig.apiBaseUrl;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;

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
  const token = options.token ?? getToken();
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
  const headers = createHeaders(options, hasBody);

  try {
    const response = await fetch(buildUrl(path), {
      method: options.method ?? 'GET',
      headers,
      body: hasBody ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
    });

    const parseDiagnostics = createApiDiagnostics(path, headers, response);
    const payload = await parseResponse(response, parseDiagnostics);

    if (!response.ok) {
      const diagnostics = createApiDiagnostics(path, headers, response, payload);

      if (response.status === 401) {
        clearToken({ reason: 'expired', intendedPath: getCurrentRouteForAuthRedirect() });
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
    if (error instanceof ApiError) {
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
    return request<T>(path, { ...options, method: 'POST', body });
  },
  put<T>(path: string, body?: unknown, options: Omit<ApiClientRequestOptions, 'method' | 'body'> = {}) {
    return request<T>(path, { ...options, method: 'PUT', body });
  },
};
