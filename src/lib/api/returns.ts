import { request } from './client';
import type { ReturnDetail, ReturnSummary } from './contracts';

export async function listReturns() {
  return request<ReturnSummary[]>('/returns');
}

export async function getReturn(returnId: string) {
  return request<ReturnDetail>(`/returns/${returnId}`);
}
