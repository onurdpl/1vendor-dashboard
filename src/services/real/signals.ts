import { apiClient } from '../../lib/api-client';
import type { OperationalSignalsResponse } from '../../lib/api/contracts';

function buildSignalsPath(limit?: number) {
  return typeof limit === 'number' && Number.isFinite(limit) && limit > 0 ? `/signals?limit=${Math.floor(limit)}` : '/signals';
}

export async function listOperationalSignals(vendorId?: string | null, options: { signal?: AbortSignal; headers?: HeadersInit; limit?: number } = {}): Promise<OperationalSignalsResponse> {
  const path = buildSignalsPath(options.limit);
  return vendorId
    ? apiClient.get<OperationalSignalsResponse>(path, { vendorId, signal: options.signal, headers: options.headers })
    : apiClient.get<OperationalSignalsResponse>(path, { signal: options.signal, headers: options.headers });
}
