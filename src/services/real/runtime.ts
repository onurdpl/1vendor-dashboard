import { apiClient } from '../../lib/api-client';

export type BackendHealthResponse = {
  ok: boolean;
  status: 'ok' | 'degraded';
  service: string;
  version: string;
  gitCommit: string | null;
  environment: string;
  timestamp: string;
  dbReachable: boolean;
  migrationsReachable: boolean;
};

export async function getBackendHealth(options: { signal?: AbortSignal } = {}) {
  return apiClient.get<BackendHealthResponse>('/health', { signal: options.signal });
}
