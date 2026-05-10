import { request } from './client';
import type { AutomationDashboard } from './mockAutomation';

export function getAutomationDashboard() {
  return request<AutomationDashboard>('/automation');
}
