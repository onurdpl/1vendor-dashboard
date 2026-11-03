import { apiClient as runtimeApiClient, captureSessionOwner, isCurrentSessionOwner } from '../api-client';
import { clearToken } from '../auth';
import { apiConfig } from './config';
import { ApiError } from './errors';
import { MockRequestError, mockRequest } from './mockTransport';
import { recordAuthDiagnostic } from '../auth/diagnostics';

export type RequestOptions = Omit<RequestInit, 'body' | 'headers'> & {
  headers?: HeadersInit;
  body?: unknown;
};

function getCurrentRouteForAuthRedirect() {
  if (typeof window === 'undefined') {
    return '/';
  }

  const { pathname, search, hash } = window.location;
  return `${pathname || '/'}${search || ''}${hash || ''}`;
}

function handleUnauthorized() {
  recordAuthDiagnostic('CACHE_USER_CLEAR', {
    flowId: null,
    requestId: null,
    source: 'legacy-api-client.handleUnauthorized',
    resultCategory: 'unauthorized',
  });
  clearToken({
    reason: 'expired',
    intendedPath: getCurrentRouteForAuthRedirect(),
    source: 'legacy-api-client.handleUnauthorized',
  });

  if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
    recordAuthDiagnostic('REDIRECT_LOGIN', {
      flowId: null,
      requestId: null,
      source: 'legacy-api-client.handleUnauthorized',
      resultCategory: 'unauthorized',
      nextAuthState: 'unauthenticated',
    });
    window.location.assign('/login');
  }
}

export async function request<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const owner = captureSessionOwner();
  try {
    if (apiConfig.mode === 'mock') {
      try {
        const result = await mockRequest<T>(path, options);
        if (!isCurrentSessionOwner(owner)) {
          throw new ApiError('Session changed while the request was pending.', 'invalid-response');
        }
        return result;
      } catch (error) {
        if (error instanceof MockRequestError && error.status === 401) {
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

    if ((options.method ?? 'GET').toUpperCase() === 'POST') {
      return runtimeApiClient.post<T>(path, options.body, {
        headers: options.headers,
        signal: options.signal ?? undefined,
      });
    }

    return runtimeApiClient.get<T>(path, {
      headers: options.headers,
      signal: options.signal ?? undefined,
    });
  } catch (error) {
    if (apiConfig.mode === 'mock' && error instanceof ApiError && error.kind === 'unauthorized' && isCurrentSessionOwner(owner)) {
      handleUnauthorized();
    }

    if (error instanceof ApiError) {
      throw error;
    }

    throw new ApiError('Network request failed', 'network', { details: error });
  }
}

export const apiClient = {
  request,
  config: apiConfig,
};
