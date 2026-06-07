import { apiClient } from '../../lib/api-client';
import type {
  LogoIsbasiCommissionInvoicePreviewInput,
  LogoIsbasiCommissionInvoicePreviewResult,
  LogoIsbasiLoginProbeResult,
  VendorBillingProfile,
  VendorBillingProfileInput,
} from '../../lib/api/contracts';

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

export function probeLogoIsbasiLogin() {
  return apiClient.post<LogoIsbasiLoginProbeResult>(
    '/admin/probes/logo-isbasi/login',
    undefined,
    { skipVendorContext: true },
  );
}

export function previewLogoIsbasiCommissionInvoice(
  vendorId: string,
  input: LogoIsbasiCommissionInvoicePreviewInput,
) {
  return apiClient.post<LogoIsbasiCommissionInvoicePreviewResult>(
    `/admin/vendors/${encodeURIComponent(vendorId)}/logo-isbasi/commission-invoice-preview`,
    input,
    { skipVendorContext: true },
  );
}
