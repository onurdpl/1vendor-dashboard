import { apiClient } from '../../lib/api-client';
import type { OperationalSignalsResponse } from '../../lib/api/contracts';

export async function listOperationalSignals(vendorId?: string | null, options: { signal?: AbortSignal } = {}): Promise<OperationalSignalsResponse> {
  return vendorId
    ? apiClient.get<OperationalSignalsResponse>('/signals', { vendorId, signal: options.signal })
    : apiClient.get<OperationalSignalsResponse>('/signals', { signal: options.signal });
}
