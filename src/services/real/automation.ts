import { apiClient } from '../../lib/api-client';
import type { AutomationDashboard } from '../../lib/api/contracts';

export async function getAutomationDashboard(vendorId?: string | null, options: { signal?: AbortSignal; headers?: HeadersInit } = {}): Promise<AutomationDashboard> {
  return vendorId
    ? apiClient.get<AutomationDashboard>('/automation', { vendorId, signal: options.signal, headers: options.headers })
    : apiClient.get<AutomationDashboard>('/automation', { signal: options.signal, headers: options.headers });
}
