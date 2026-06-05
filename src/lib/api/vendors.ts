import { runtimeServices } from '../../services/runtime-services';
import type { VendorBillingProfileInput } from './contracts';

export function getVendorBillingProfile(vendorId: string, options: { signal?: AbortSignal } = {}) {
  return runtimeServices.vendors.billingProfile(vendorId, { signal: options.signal });
}

export function updateVendorBillingProfile(vendorId: string, input: VendorBillingProfileInput) {
  return runtimeServices.vendors.updateBillingProfile(vendorId, input);
}
