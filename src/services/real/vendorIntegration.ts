import { apiClient } from '../../lib/api-client';
import type {
  VendorIntegrationProviderManagement,
  VendorIntegrationProviderRevokeResult,
  VendorIntegrationTokenCreateInput,
  VendorIntegrationTokenCreateResult,
} from '../../lib/api/contracts';

export function getVendorIntegrationProviderManagement(options: { signal?: AbortSignal } = {}) {
  return apiClient.get<VendorIntegrationProviderManagement>('/admin/vendor-integration/providers', {
    signal: options.signal,
  });
}

export function revokeVendorIntegrationProviderToken(clientId: string) {
  return apiClient.post<VendorIntegrationProviderRevokeResult>(
    `/admin/vendor-integration/tokens/${encodeURIComponent(clientId)}/revoke`,
    {},
  );
}

export function createVendorIntegrationToken(input: VendorIntegrationTokenCreateInput) {
  return apiClient.post<VendorIntegrationTokenCreateResult>('/admin/vendor-integration/tokens', input, {
    skipVendorContext: true,
  });
}
