import { apiClient } from '../../lib/api-client';
import type { AutomationDashboard } from '../../lib/api/contracts';

export async function getAutomationDashboard(vendorId?: string | null): Promise<AutomationDashboard> {
  return vendorId
    ? apiClient.get<AutomationDashboard>('/automation', { vendorId })
    : apiClient.get<AutomationDashboard>('/automation');
}
