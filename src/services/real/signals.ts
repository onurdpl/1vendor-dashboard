import { apiClient } from '../../lib/api-client';
import type { OperationalSignalsResponse } from '../../lib/api/contracts';

export async function listOperationalSignals(vendorId?: string | null): Promise<OperationalSignalsResponse> {
  return vendorId
    ? apiClient.get<OperationalSignalsResponse>('/signals', { vendorId })
    : apiClient.get<OperationalSignalsResponse>('/signals');
}
