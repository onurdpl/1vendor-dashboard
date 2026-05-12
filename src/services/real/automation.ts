import { apiClient } from '../../lib/api-client';
import type { AutomationDashboard } from '../../lib/api/contracts';

export async function getAutomationDashboard(): Promise<AutomationDashboard> {
  return apiClient.get<AutomationDashboard>('/automation');
}
