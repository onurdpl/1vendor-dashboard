import { request } from './client';
import type { FinanceDashboard } from './mockFinance';

export function getFinanceDashboard() {
  return request<FinanceDashboard>('/finance');
}
