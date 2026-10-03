import { apiClient } from '../../lib/api-client';
import type {
  VendorIntegrationProviderManagement,
  VendorIntegrationProviderRevokeResult,
  VendorIntegrationTokenCreateInput,
  VendorIntegrationTokenCreateResult,
  SopyoCredentialState,
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

export function getSopyoCredentialState(vendorId: string, options: { signal?: AbortSignal } = {}) {
  return apiClient.get<SopyoCredentialState>(
    `/admin/vendors/${encodeURIComponent(vendorId)}/sopyo-credential`,
    { signal: options.signal, skipVendorContext: true },
  );
}

export function saveSopyoCredential(vendorId: string, token: string) {
  return apiClient.post<SopyoCredentialState>(
    `/admin/vendors/${encodeURIComponent(vendorId)}/sopyo-credential`,
    { token },
    { skipVendorContext: true },
  );
}
