import { clearToken, getToken } from '../auth';
import { getCurrentVendorContext } from '../auth/vendorContext';
import { apiConfig } from './config';
import { ApiError } from './errors';
import { MockRequestError, mockRequest } from './mockTransport';

export type RequestOptions = Omit<RequestInit, 'body' | 'headers'> & {
  headers?: HeadersInit;
  body?: unknown;
};

function buildUrl(path: string) {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  const normalizedBase = apiConfig.baseUrl.endsWith('/')
    ? apiConfig.baseUrl.slice(0, -1)
    : apiConfig.baseUrl;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;

  return `${normalizedBase}${normalizedPath}`;
}

function buildHeaders(initHeaders?: HeadersInit, hasBody = false) {
  const headers = new Headers(initHeaders);
  const token = getToken();
  const { vendorId } = getCurrentVendorContext();

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

async function readResponse(response: Response) {
  if (response.status === 204) {
    return null;
  }

  const contentType = response.headers.get('content-type') ?? '';

  if (contentType.includes('application/json')) {
    return response.json();
  }

  return response.text();
}

function handleUnauthorized() {
  clearToken();

  if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
    window.location.assign('/login');
  }
}

export async function request<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), apiConfig.timeoutMs);

  try {
    if (apiConfig.mode === 'mock') {
      try {
        return await mockRequest<T>(path, options);
      } catch (error) {
        if (error instanceof MockRequestError && error.status === 401) {
          handleUnauthorized();
          throw new ApiError('Unauthorized request', 'unauthorized', {
            status: error.status,
            details: error.body,
          });
        }

        if (error instanceof MockRequestError) {
          throw new ApiError('Request failed', 'server', {
            status: error.status,
            details: error.body,
          });
        }

        throw error;
      }
    }

    const response = await fetch(buildUrl(path), {
      ...options,
      signal: options.signal ?? controller.signal,
      headers: buildHeaders(options.headers, options.body !== undefined),
      body:
        options.body === undefined || options.body instanceof FormData
          ? options.body
          : typeof options.body === 'string'
            ? options.body
            : JSON.stringify(options.body),
    });

    const payload = await readResponse(response);

    if (response.status === 401) {
      handleUnauthorized();
      throw new ApiError('Unauthorized request', 'unauthorized', {
        status: response.status,
        details: payload,
      });
    }

    if (!response.ok) {
      throw new ApiError('Request failed', 'server', {
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
      throw new ApiError('Request timed out', 'network');
    }

    throw new ApiError('Network request failed', 'network', { details: error });
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

export const apiClient = {
  request,
  config: apiConfig,
};
