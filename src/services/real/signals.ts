import { apiClient } from '../../lib/api-client';
import type { OperationalSignalsResponse } from '../../lib/api/contracts';

export async function listOperationalSignals(vendorId?: string | null, options: { signal?: AbortSignal; headers?: HeadersInit } = {}): Promise<OperationalSignalsResponse> {
  return vendorId
    ? apiClient.get<OperationalSignalsResponse>('/signals', { vendorId, signal: options.signal, headers: options.headers })
    : apiClient.get<OperationalSignalsResponse>('/signals', { signal: options.signal, headers: options.headers });
}
