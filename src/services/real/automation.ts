import { apiClient } from '../../lib/api-client';
import type { AutomationDashboard } from '../../lib/api/contracts';

export async function getAutomationDashboard(vendorId?: string | null, options: { signal?: AbortSignal } = {}): Promise<AutomationDashboard> {
  return vendorId
    ? apiClient.get<AutomationDashboard>('/automation', { vendorId, signal: options.signal })
    : apiClient.get<AutomationDashboard>('/automation', { signal: options.signal });
}
