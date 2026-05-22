import { request } from './client';
import type { AutomationDashboard } from './contracts';

export function getAutomationDashboard(options: { signal?: AbortSignal } = {}) {
  return request<AutomationDashboard>('/automation', { signal: options.signal });
}
