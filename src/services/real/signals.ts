import { apiClient } from '../../lib/api-client';
import type { OperationalSignalsResponse } from '../../lib/api/contracts';

export async function listOperationalSignals(): Promise<OperationalSignalsResponse> {
  return apiClient.get<OperationalSignalsResponse>('/signals');
}
