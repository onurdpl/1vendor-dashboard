import { apiClient } from '../../lib/api-client';
import type {
  LogoIsbasiCommissionInvoicePreviewInput,
  LogoIsbasiCommissionInvoicePreviewResult,
  LogoIsbasiFirmBindResult,
  LogoIsbasiFirmMatchResult,
  LogoIsbasiFirmsDiscoveryResult,
  LogoIsbasiIncomingEinvoiceListProbeResult,
  LogoIsbasiInvoiceDetailProbeResult,
  LogoIsbasiInvoiceListProbeResult,
  LogoIsbasiInvoicePdfProbeResult,
  LogoIsbasiLoginProbeResult,
  LogoIsbasiProductServiceDiscoveryResult,
  LogoIsbasiTestInvoiceCreateResult,
  VendorBillingProfile,
  VendorBillingProfileInput,
  VendorBillingLegalSelfView,
  VendorDirectoryResponse,
  VendorDirectoryStatusFilter,
  VendorProvisioningInput,
  VendorProvisioningResult,
  VendorLoginUsersResponse,
  VendorPasswordResetInput,
  VendorPasswordResetOperation,
  VendorPasswordResetResult,
  VendorProfileAuditLog,
  VendorStatus,
  VendorStatusInput,
} from '../../lib/api/contracts';

export function getVendorBillingLegalSelfView(options: { signal?: AbortSignal } = {}) {
  return apiClient.get<VendorBillingLegalSelfView | null>('/vendor/billing-profile', {
    signal: options.signal,
  });
}

export function listAdminVendors(
  options: { search?: string | null; status?: VendorDirectoryStatusFilter; limit?: number; signal?: AbortSignal } = {},
) {
  const searchParams = new URLSearchParams();
  const search = options.search?.trim();
  if (search) {
    searchParams.set('search', search);
  }
  if (options.status && options.status !== 'all') {
    searchParams.set('status', options.status);
  }
  if (options.limit) {
    searchParams.set('limit', String(options.limit));
  }
  const query = searchParams.toString();

  return apiClient.get<VendorDirectoryResponse>(`/admin/vendors${query ? `?${query}` : ''}`, {
    signal: options.signal,
  });
}

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

export function getVendorStatus(vendorId: string, options: { signal?: AbortSignal } = {}) {
  return apiClient.get<VendorStatus>(
    `/admin/vendors/${encodeURIComponent(vendorId)}/status`,
    {
      signal: options.signal,
    },
  );
}

export function updateVendorStatus(vendorId: string, input: VendorStatusInput) {
  return apiClient.put<VendorStatus>(
    `/admin/vendors/${encodeURIComponent(vendorId)}/status`,
    input,
  );
}

export function provisionVendor(input: VendorProvisioningInput) {
  return apiClient.post<VendorProvisioningResult>(
    '/admin/vendors/provision',
    input,
    { skipVendorContext: true },
  );
}

export function listVendorLoginUsers(vendorId: string, options: { signal?: AbortSignal } = {}) {
  return apiClient.get<VendorLoginUsersResponse>(`/admin/vendors/${encodeURIComponent(vendorId)}/login-users`,
    { signal: options.signal, skipVendorContext: true });
}

export function resetVendorUserPassword(vendorId: string, userId: string, input: VendorPasswordResetInput) {
  return apiClient.post<VendorPasswordResetResult>(
    `/admin/vendors/${encodeURIComponent(vendorId)}/users/${encodeURIComponent(userId)}/password-reset`,
    input, { skipVendorContext: true });
}

export function getVendorPasswordResetOperation(vendorId: string, operationId: string) {
  return apiClient.get<VendorPasswordResetOperation>(
    `/admin/vendors/${encodeURIComponent(vendorId)}/password-reset-operations/${encodeURIComponent(operationId)}`,
    { skipVendorContext: true });
}

export function listVendorProfileAuditLogs(
  vendorId: string,
  options: { section?: string | null; limit?: number; signal?: AbortSignal } = {},
) {
  const searchParams = new URLSearchParams();
  if (options.section) {
    searchParams.set('section', options.section);
  }
  if (options.limit) {
    searchParams.set('limit', String(options.limit));
  }
  const query = searchParams.toString();
  return apiClient.get<VendorProfileAuditLog[]>(
    `/admin/vendors/${encodeURIComponent(vendorId)}/profile-audit-logs${query ? `?${query}` : ''}`,
    {
      signal: options.signal,
    },
  );
}

export function probeLogoIsbasiLogin() {
  return apiClient.post<LogoIsbasiLoginProbeResult>(
    '/admin/probes/logo-isbasi/login',
    undefined,
    { skipVendorContext: true },
  );
}

export function discoverLogoIsbasiFirms() {
  return apiClient.post<LogoIsbasiFirmsDiscoveryResult>(
    '/admin/probes/logo-isbasi/firms',
    undefined,
    { skipVendorContext: true },
  );
}

export function discoverLogoIsbasiInvoices() {
  return apiClient.post<LogoIsbasiInvoiceListProbeResult>(
    '/admin/probes/logo-isbasi/invoices',
    undefined,
    { skipVendorContext: true },
  );
}

export function discoverLogoIsbasiIncomingEinvoices() {
  return apiClient.post<LogoIsbasiIncomingEinvoiceListProbeResult>(
    '/admin/probes/logo-isbasi/incoming-einvoices',
    undefined,
    { skipVendorContext: true },
  );
}

export function discoverLogoIsbasiServices() {
  return apiClient.post<LogoIsbasiProductServiceDiscoveryResult>(
    '/admin/probes/logo-isbasi/products',
    { type: 2, pageSize: 50 },
    { skipVendorContext: true },
  );
}

export function fetchLogoIsbasiInvoicePdf(uuid: string) {
  return apiClient.post<LogoIsbasiInvoicePdfProbeResult>(
    '/admin/probes/logo-isbasi/invoice-pdf',
    { uuid },
    { skipVendorContext: true },
  );
}

export function inspectLogoIsbasiInvoice(invoiceId: string) {
  return apiClient.post<LogoIsbasiInvoiceDetailProbeResult>(
    `/admin/probes/logo-isbasi/invoices/${encodeURIComponent(invoiceId)}`,
    undefined,
    { skipVendorContext: true },
  );
}

export function matchVendorLogoIsbasiFirm(vendorId: string) {
  return apiClient.post<LogoIsbasiFirmMatchResult>(
    `/admin/vendors/${encodeURIComponent(vendorId)}/logo-isbasi/match-firm`,
    undefined,
    { skipVendorContext: true },
  );
}

export function bindVendorLogoIsbasiFirm(vendorId: string) {
  return apiClient.post<LogoIsbasiFirmBindResult>(
    `/admin/vendors/${encodeURIComponent(vendorId)}/logo-isbasi/bind-matched-firm`,
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

export function createLogoIsbasiTestInvoice(vendorId: string) {
  return apiClient.post<LogoIsbasiTestInvoiceCreateResult>(
    `/admin/vendors/${encodeURIComponent(vendorId)}/logo-isbasi/test-create-invoice`,
    { confirmTestInvoice: true },
    { skipVendorContext: true },
  );
}
