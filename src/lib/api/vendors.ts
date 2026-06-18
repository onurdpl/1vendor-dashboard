import { runtimeServices } from '../../services/runtime-services';
import type { LogoIsbasiCommissionInvoicePreviewInput, VendorBillingProfileInput } from './contracts';

export function getVendorBillingProfile(vendorId: string, options: { signal?: AbortSignal } = {}) {
  return runtimeServices.vendors.billingProfile(vendorId, { signal: options.signal });
}

export function updateVendorBillingProfile(vendorId: string, input: VendorBillingProfileInput) {
  return runtimeServices.vendors.updateBillingProfile(vendorId, input);
}

export function listVendorProfileAuditLogs(
  vendorId: string,
  options: { section?: string | null; limit?: number; signal?: AbortSignal } = {},
) {
  return runtimeServices.vendors.profileAuditLogs(vendorId, options);
}

export function probeLogoIsbasiLogin() {
  return runtimeServices.vendors.probeLogoIsbasiLogin();
}

export function discoverLogoIsbasiFirms() {
  return runtimeServices.vendors.discoverLogoIsbasiFirms();
}

export function discoverLogoIsbasiInvoices() {
  return runtimeServices.vendors.discoverLogoIsbasiInvoices();
}

export function discoverLogoIsbasiIncomingEinvoices() {
  return runtimeServices.vendors.discoverLogoIsbasiIncomingEinvoices();
}

export function discoverLogoIsbasiServices() {
  return runtimeServices.vendors.discoverLogoIsbasiServices();
}

export function fetchLogoIsbasiInvoicePdf(uuid: string) {
  return runtimeServices.vendors.fetchLogoIsbasiInvoicePdf(uuid);
}

export function inspectLogoIsbasiInvoice(invoiceId: string) {
  return runtimeServices.vendors.inspectLogoIsbasiInvoice(invoiceId);
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

export function createLogoIsbasiTestInvoice(vendorId: string) {
  return runtimeServices.vendors.createLogoIsbasiTestInvoice(vendorId);
}
