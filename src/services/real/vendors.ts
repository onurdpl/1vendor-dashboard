import { apiClient } from '../../lib/api-client';
import type { VendorBillingProfile, VendorBillingProfileInput } from '../../lib/api/contracts';

export function getVendorBillingProfile(vendorId: string, options: { signal?: AbortSignal } = {}) {
  return apiClient.get<VendorBillingProfile | null>(
    `/admin/vendors/${encodeURIComponent(vendorId)}/billing-profile`,
    {
      signal: options.signal,
    },
  );
}

export function updateVendorBillingProfile(vendorId: string, input: VendorBillingProfileInput) {
  return apiClient.put<VendorBillingProfile>(
    `/admin/vendors/${encodeURIComponent(vendorId)}/billing-profile`,
    input,
  );
}
