import { apiClient as runtimeApiClient } from '../api-client';
import { clearToken } from '../auth';
import { apiConfig } from './config';
import { ApiError } from './errors';
import { MockRequestError, mockRequest } from './mockTransport';

export type RequestOptions = Omit<RequestInit, 'body' | 'headers'> & {
  headers?: HeadersInit;
  body?: unknown;
};

function handleUnauthorized() {
  clearToken();

  if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
    window.location.assign('/login');
  }
}

export async function request<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
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
    if (error instanceof ApiError && error.kind === 'unauthorized') {
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
