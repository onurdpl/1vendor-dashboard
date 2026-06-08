import { runtimeServices } from '../../services/runtime-services';
import type { LogoIsbasiCommissionInvoicePreviewInput, VendorBillingProfileInput } from './contracts';

export function getVendorBillingProfile(vendorId: string, options: { signal?: AbortSignal } = {}) {
  return runtimeServices.vendors.billingProfile(vendorId, { signal: options.signal });
}

export function updateVendorBillingProfile(vendorId: string, input: VendorBillingProfileInput) {
  return runtimeServices.vendors.updateBillingProfile(vendorId, input);
}

export function probeLogoIsbasiLogin() {
  return runtimeServices.vendors.probeLogoIsbasiLogin();
}

export function discoverLogoIsbasiFirms() {
  return runtimeServices.vendors.discoverLogoIsbasiFirms();
}

export function matchVendorLogoIsbasiFirm(vendorId: string) {
  return runtimeServices.vendors.matchVendorLogoIsbasiFirm(vendorId);
}

export function bindVendorLogoIsbasiFirm(vendorId: string) {
  return runtimeServices.vendors.bindVendorLogoIsbasiFirm(vendorId);
}

export function previewLogoIsbasiCommissionInvoice(
  vendorId: string,
  input: LogoIsbasiCommissionInvoicePreviewInput,
) {
  return runtimeServices.vendors.previewLogoIsbasiCommissionInvoice(vendorId, input);
}
