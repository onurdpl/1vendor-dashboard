import { apiClient } from '../../lib/api-client';
import type { DashboardOperationalSignalsResponse, OperationalSignalsResponse } from '../../lib/api/contracts';

function buildSignalsPath(limit?: number) {
  return typeof limit === 'number' && Number.isFinite(limit) && limit > 0 ? `/signals?limit=${Math.floor(limit)}` : '/signals';
}

function buildDashboardSignalsPath(options: { limit?: number; offset?: number }) {
  const params = new URLSearchParams();
  if (typeof options.limit === 'number' && Number.isFinite(options.limit) && options.limit > 0) {
    params.set('limit', String(Math.floor(options.limit)));
  }
  if (typeof options.offset === 'number' && Number.isFinite(options.offset) && options.offset >= 0) {
    params.set('offset', String(Math.floor(options.offset)));
  }
  return `/signals/dashboard${params.size ? `?${params.toString()}` : ''}`;
}

export async function listOperationalSignals(vendorId?: string | null, options: { signal?: AbortSignal; headers?: HeadersInit; limit?: number } = {}): Promise<OperationalSignalsResponse> {
  const path = buildSignalsPath(options.limit);
  return vendorId
    ? apiClient.get<OperationalSignalsResponse>(path, { vendorId, signal: options.signal, headers: options.headers })
    : apiClient.get<OperationalSignalsResponse>(path, { signal: options.signal, headers: options.headers });
}

export async function listDashboardSignals(vendorId?: string | null, options: { signal?: AbortSignal; headers?: HeadersInit; limit?: number; offset?: number } = {}): Promise<DashboardOperationalSignalsResponse> {
  const path = buildDashboardSignalsPath(options);
  return vendorId
    ? apiClient.get<DashboardOperationalSignalsResponse>(path, { vendorId, signal: options.signal, headers: options.headers })
    : apiClient.get<DashboardOperationalSignalsResponse>(path, { signal: options.signal, headers: options.headers });
}
