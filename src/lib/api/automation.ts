import { request } from './client';
import type { AutomationDashboard } from './contracts';

export function getAutomationDashboard() {
  return request<AutomationDashboard>('/automation');
}
