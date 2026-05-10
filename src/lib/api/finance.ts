import { request } from './client';
import type { FinanceDashboard } from './contracts';

export function getFinanceDashboard() {
  return request<FinanceDashboard>('/finance');
}
