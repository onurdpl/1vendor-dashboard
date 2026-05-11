import { getCurrentVendorContext, getToken } from './auth';
import { ApiError } from './api/errors';
import { runtimeConfig } from '../config/runtime';

type HttpMethod = 'GET' | 'POST';

type ApiClientRequestOptions = {
  method?: HttpMethod;
  body?: unknown;
  token?: string | null;
  vendorId?: string | null;
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

function createHeaders(options: ApiClientRequestOptions, hasBody: boolean) {
  const headers = new Headers(options.headers);
  const token = options.token ?? getToken();
  const vendorId = options.vendorId ?? getCurrentVendorContext().vendorId;

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

async function parseResponse(response: Response) {
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
      throw new ApiError('Received an invalid JSON response from the backend.', 'invalid-response');
    }
  }

  return rawBody;
}

async function request<T>(path: string, options: ApiClientRequestOptions = {}) {
  const hasBody = options.body !== undefined;

  try {
    const response = await fetch(buildUrl(path), {
      method: options.method ?? 'GET',
      headers: createHeaders(options, hasBody),
      body: hasBody ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
    });

    const payload = await parseResponse(response);

    if (!response.ok) {
      const message =
        payload && typeof payload === 'object' && 'message' in payload && typeof payload.message === 'string'
          ? payload.message
          : response.status === 401
            ? 'Unauthorized request.'
            : response.status === 403
              ? 'You do not have access to this resource.'
              : 'Backend request failed.';

      throw new ApiError(message, response.status === 401 ? 'unauthorized' : 'server', {
        status: response.status,
        details: payload,
      });
    }

    return payload as T;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiError('The backend request timed out.', 'network');
    }

    throw new ApiError(
      'Unable to reach the backend. The app can continue in mock mode or once the backend is available.',
      'network',
      { details: error },
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
};
