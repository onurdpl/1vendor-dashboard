import { apiClient } from '../../lib/api-client';
import type { DashboardOperationalSummary } from '../../lib/api/contracts';

function readVendorRequestOptions(options: { vendorId?: string | null; signal?: AbortSignal; headers?: HeadersInit } = {}) {
  const requestOptions: { vendorId?: string; signal?: AbortSignal; headers?: HeadersInit } = {};
  if (options.vendorId) requestOptions.vendorId = options.vendorId;
  if (options.signal) requestOptions.signal = options.signal;
  if (options.headers) requestOptions.headers = options.headers;
  return requestOptions;
}

export async function getDashboardOperationalSummary(
  options: { vendorId?: string | null; signal?: AbortSignal; headers?: HeadersInit } = {},
): Promise<DashboardOperationalSummary> {
  return apiClient.get<DashboardOperationalSummary>('/dashboard/summary', readVendorRequestOptions(options));
}
