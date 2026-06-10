import { useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ActionFeedback } from '../components/ActionFeedback';
import {
  MetadataGroup,
  MetadataRow,
  OperationalActionGroup,
  OperationalSection,
  SectionErrorRetry,
  SectionSkeleton,
  StatusBadge,
} from '../components/OperationalPrimitives';
import { useMutationAction } from '../hooks/useMutationAction';
import { useQueryResource } from '../hooks/useQueryResource';
import { getFinanceProfile } from '../features/finance/api';
import { getVendorShippingConfig } from '../features/orders/api';
import { createSupportTicket, listAdminSupportTickets, listVendorSupportTickets } from '../features/support/api';
import {
  bindVendorLogoIsbasiFirm,
  createLogoIsbasiTestInvoice,
  discoverLogoIsbasiFirms,
  discoverLogoIsbasiIncomingEinvoices,
  discoverLogoIsbasiInvoices,
  discoverLogoIsbasiServices,
  fetchLogoIsbasiInvoicePdf,
  getVendorBillingProfile,
  inspectLogoIsbasiInvoice,
  matchVendorLogoIsbasiFirm,
  previewLogoIsbasiCommissionInvoice,
  probeLogoIsbasiLogin,
  updateVendorBillingProfile,
} from '../features/vendors/api';
import { queryClient } from '../lib/api/queryClient';
import { queryKeys } from '../lib/api/queryKeys';
import { ApiError } from '../lib/api/errors';
import type {
  LogoIsbasiCommissionInvoicePreviewResult,
  LogoIsbasiFirmBindResult,
  LogoIsbasiFirmMatchResult,
  LogoIsbasiFirmSummary,
  LogoIsbasiFirmsDiscoveryResult,
  LogoIsbasiIncomingEinvoiceListProbeResult,
  LogoIsbasiIncomingEinvoiceSummary,
  LogoIsbasiInvoiceDetailProbeResult,
  LogoIsbasiInvoiceListProbeResult,
  LogoIsbasiInvoicePdfProbeResult,
  LogoIsbasiInvoiceSummary,
  LogoIsbasiLoginProbeResult,
  LogoIsbasiProductServiceDiscoveryResult,
  LogoIsbasiTestInvoiceCreateResult,
  SupportTicket,
  VendorBillingProfile,
  VendorBillingProfileInput,
  VendorShippingConfig,
} from '../lib/api/contracts';
import { useAppReadiness } from '../lib/appReadiness';
import { formatShippingProviderName } from '../lib/shippingDisplay';
import { useActionFeedback } from '../lib/ui';
import { safeArray, safeStatusLabel } from '../services/real/formatting';

const VENDOR_PROFILE_CONTEXT_ROUTE = 'vendor_profile_settings';
const VENDOR_PROFILE_PATH = '/vendor/profile';
const OPEN_SUPPORT_STATUSES = new Set(['OPEN', 'IN_REVIEW', 'WAITING_FOR_VENDOR']);
type ReadinessStatus = 'ready' | 'review' | 'unknown' | 'not_modeled';
type ReadinessItem = {
  label: string;
  status: ReadinessStatus;
  detail: string;
};
type ReadinessSection = {
  title: string;
  status: ReadinessStatus;
  summary: string;
  actionLabel: string;
  actionPath: string;
  items: ReadinessItem[];
};

function formatValue(value: string | null | undefined, fallback = 'Not configured') {
  return value && value.trim() ? value.trim() : fallback;
}

type BillingProfileFormState = {
  legalCompanyName: string;
  taxNumber: string;
  taxOffice: string;
  billingAddress: string;
  billingCity: string;
  billingDistrict: string;
  authorizedPerson: string;
  billingEmail: string;
  billingPhone: string;
  iban: string;
  legalEntityType: string;
  logoIsbasiCustomerCode: string;
};

type LogoCommissionPreviewFormState = {
  commissionAmount: string;
  vatRate: string;
  currency: string;
  description: string;
  sourcePeriod: string;
};

const EMPTY_BILLING_PROFILE_FORM: BillingProfileFormState = {
  legalCompanyName: '',
  taxNumber: '',
  taxOffice: '',
  billingAddress: '',
  billingCity: '',
  billingDistrict: '',
  authorizedPerson: '',
  billingEmail: '',
  billingPhone: '',
  iban: '',
  legalEntityType: '',
  logoIsbasiCustomerCode: '',
};

const DEFAULT_LOGO_COMMISSION_PREVIEW_FORM: LogoCommissionPreviewFormState = {
  commissionAmount: '',
  vatRate: '20',
  currency: 'TL',
  description: 'Pazaryeri komisyon hizmet bedeli',
  sourcePeriod: '',
};

const billingRequiredFields: Array<{ field: keyof BillingProfileFormState; label: string }> = [
  { field: 'legalCompanyName', label: 'Legal company name' },
  { field: 'taxNumber', label: 'Tax number / TCKN' },
  { field: 'taxOffice', label: 'Tax office' },
  { field: 'billingAddress', label: 'Billing address' },
  { field: 'billingCity', label: 'Billing city' },
  { field: 'billingDistrict', label: 'Billing district' },
  { field: 'billingEmail', label: 'Billing email' },
];

function buildBillingProfileFormState(profile: VendorBillingProfile | null): BillingProfileFormState {
  return {
    legalCompanyName: profile?.legalCompanyName ?? '',
    taxNumber: profile?.taxNumber ?? '',
    taxOffice: profile?.taxOffice ?? '',
    billingAddress: profile?.billingAddress ?? '',
    billingCity: profile?.billingCity ?? '',
    billingDistrict: profile?.billingDistrict ?? '',
    authorizedPerson: profile?.authorizedPerson ?? '',
    billingEmail: profile?.billingEmail ?? '',
    billingPhone: profile?.billingPhone ?? '',
    iban: profile?.iban ?? '',
    legalEntityType: profile?.legalEntityType ?? '',
    logoIsbasiCustomerCode: profile?.logoIsbasiCustomerCode ?? '',
  };
}

function normalizeOptionalBillingValue(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function buildBillingProfileInput(form: BillingProfileFormState): VendorBillingProfileInput {
  return {
    legalCompanyName: form.legalCompanyName.trim(),
    taxNumber: form.taxNumber.trim(),
    taxOffice: form.taxOffice.trim(),
    billingAddress: form.billingAddress.trim(),
    billingCity: form.billingCity.trim(),
    billingDistrict: form.billingDistrict.trim(),
    authorizedPerson: normalizeOptionalBillingValue(form.authorizedPerson),
    billingEmail: form.billingEmail.trim(),
    billingPhone: normalizeOptionalBillingValue(form.billingPhone),
    iban: normalizeOptionalBillingValue(form.iban),
    legalEntityType: normalizeOptionalBillingValue(form.legalEntityType),
    logoIsbasiCustomerCode: normalizeOptionalBillingValue(form.logoIsbasiCustomerCode),
  };
}

function validateBillingProfileForm(form: BillingProfileFormState) {
  const missing = billingRequiredFields.find(({ field }) => !form[field].trim());
  return missing ? `${missing.label} is required for commission invoices.` : null;
}

function validateLogoCommissionPreviewForm(form: LogoCommissionPreviewFormState) {
  const amount = Number(form.commissionAmount);
  if (!form.commissionAmount.trim() || !Number.isFinite(amount) || amount <= 0) {
    return 'Commission amount is required.';
  }
  if (!form.description.trim()) {
    return 'Description is required.';
  }
  if (!form.currency.trim()) {
    return 'Currency is required.';
  }
  const vatRate = Number(form.vatRate);
  if (!form.vatRate.trim() || !Number.isFinite(vatRate) || vatRate < 0 || vatRate > 100) {
    return 'VAT rate must be between 0 and 100.';
  }
  return null;
}

function formatLogoProbeJson(
  value:
    | LogoIsbasiLoginProbeResult
    | LogoIsbasiCommissionInvoicePreviewResult
    | LogoIsbasiInvoiceDetailProbeResult
    | LogoIsbasiTestInvoiceCreateResult,
) {
  return JSON.stringify(value, null, 2);
}

function formatLogoBoolean(value: boolean | undefined) {
  return value ? 'Yes' : 'No';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isLogoLoginProbeResult(value: unknown): value is LogoIsbasiLoginProbeResult {
  return isRecord(value) && value.provider === 'LOGO_ISBASI' && value.mode === 'login_probe';
}

function isLogoFirmsDiscoveryResult(value: unknown): value is LogoIsbasiFirmsDiscoveryResult {
  return isRecord(value) && value.provider === 'LOGO_ISBASI' && value.mode === 'firms_discovery';
}

function isLogoFirmMatchResult(value: unknown): value is LogoIsbasiFirmMatchResult {
  return isRecord(value) && value.provider === 'LOGO_ISBASI' && value.mode === 'firm_match_probe';
}

function isLogoFirmBindResult(value: unknown): value is LogoIsbasiFirmBindResult {
  return isRecord(value) && value.provider === 'LOGO_ISBASI' && value.mode === 'firm_bind_probe';
}

function isLogoInvoiceListResult(value: unknown): value is LogoIsbasiInvoiceListProbeResult {
  return isRecord(value) && value.provider === 'LOGO_ISBASI' && value.mode === 'invoice_list_discovery';
}

function isLogoIncomingEinvoiceListResult(value: unknown): value is LogoIsbasiIncomingEinvoiceListProbeResult {
  return isRecord(value) && value.provider === 'LOGO_ISBASI' && value.mode === 'incoming_einvoice_discovery';
}

function isLogoProductServiceDiscoveryResult(value: unknown): value is LogoIsbasiProductServiceDiscoveryResult {
  return isRecord(value) && value.provider === 'LOGO_ISBASI' && value.mode === 'product_service_discovery';
}

function isLogoInvoicePdfProbeResult(value: unknown): value is LogoIsbasiInvoicePdfProbeResult {
  return isRecord(value) && value.provider === 'LOGO_ISBASI' && value.mode === 'invoice_pdf_probe';
}

function isLogoInvoiceDetailResult(value: unknown): value is LogoIsbasiInvoiceDetailProbeResult {
  return isRecord(value) && value.provider === 'LOGO_ISBASI' && value.mode === 'invoice_detail_discovery';
}

function isLogoTestInvoiceCreateResult(value: unknown): value is LogoIsbasiTestInvoiceCreateResult {
  return isRecord(value) && value.provider === 'LOGO_ISBASI' && value.mode === 'test_invoice_create';
}

function buildLogoLoginFailureResult(error: unknown): LogoIsbasiLoginProbeResult {
  if (error instanceof ApiError && isLogoLoginProbeResult(error.details)) {
    return {
      ...error.details,
      ok: false,
      httpStatus: error.details.httpStatus ?? error.status,
      message: error.details.message ?? error.message,
    };
  }

  return {
    ok: false,
    provider: 'LOGO_ISBASI',
    mode: 'login_probe',
    writesPerformed: false,
    externalApiCallAttempted: false,
    httpStatus: error instanceof ApiError ? error.status : undefined,
    errorCode: error instanceof ApiError && error.kind === 'network' ? 'NETWORK_OR_BACKEND_REQUEST_FAILED' : 'LOGO_ISBASI_LOGIN_PROBE_FAILED',
    message: `Network/backend request failed${error instanceof Error && error.message ? `: ${error.message}` : '.'}`,
  };
}

function buildLogoFirmsFailureResult(error: unknown): LogoIsbasiFirmsDiscoveryResult {
  if (error instanceof ApiError && isLogoFirmsDiscoveryResult(error.details)) {
    return {
      ...error.details,
      ok: false,
      httpStatus: error.details.httpStatus ?? error.status,
      message: error.details.message ?? error.message,
    };
  }

  return {
    ok: false,
    provider: 'LOGO_ISBASI',
    mode: 'firms_discovery',
    writesPerformed: false,
    externalApiCallAttempted: false,
    httpStatus: error instanceof ApiError ? error.status : undefined,
    errorCode: error instanceof ApiError && error.kind === 'network' ? 'NETWORK_OR_BACKEND_REQUEST_FAILED' : 'LOGO_ISBASI_FIRMS_DISCOVERY_FAILED',
    message: `Network/backend request failed${error instanceof Error && error.message ? `: ${error.message}` : '.'}`,
  };
}

function buildLogoInvoiceListFailureResult(error: unknown): LogoIsbasiInvoiceListProbeResult {
  if (error instanceof ApiError && isLogoInvoiceListResult(error.details)) {
    return {
      ...error.details,
      ok: false,
      httpStatus: error.details.httpStatus ?? error.status,
      message: error.details.message ?? error.message,
    };
  }

  return {
    ok: false,
    provider: 'LOGO_ISBASI',
    mode: 'invoice_list_discovery',
    writesPerformed: false,
    externalApiCallAttempted: false,
    httpStatus: error instanceof ApiError ? error.status : undefined,
    errorCode: error instanceof ApiError && error.kind === 'network' ? 'NETWORK_OR_BACKEND_REQUEST_FAILED' : 'LOGO_ISBASI_INVOICE_DISCOVERY_FAILED',
    message: `Network/backend request failed${error instanceof Error && error.message ? `: ${error.message}` : '.'}`,
  };
}

function buildLogoIncomingEinvoiceListFailureResult(error: unknown): LogoIsbasiIncomingEinvoiceListProbeResult {
  if (error instanceof ApiError && isLogoIncomingEinvoiceListResult(error.details)) {
    return {
      ...error.details,
      ok: false,
      httpStatus: error.details.httpStatus ?? error.status,
      message: error.details.message ?? error.message,
    };
  }

  return {
    ok: false,
    provider: 'LOGO_ISBASI',
    mode: 'incoming_einvoice_discovery',
    writesPerformed: false,
    externalApiCallAttempted: false,
    httpStatus: error instanceof ApiError ? error.status : undefined,
    errorCode: error instanceof ApiError && error.kind === 'network' ? 'NETWORK_OR_BACKEND_REQUEST_FAILED' : 'LOGO_ISBASI_INCOMING_EINVOICE_DISCOVERY_FAILED',
    message: `Network/backend request failed${error instanceof Error && error.message ? `: ${error.message}` : '.'}`,
  };
}

function buildLogoProductServiceDiscoveryFailureResult(error: unknown): LogoIsbasiProductServiceDiscoveryResult {
  if (error instanceof ApiError && isLogoProductServiceDiscoveryResult(error.details)) {
    return {
      ...error.details,
      ok: false,
      httpStatus: error.details.httpStatus ?? error.status,
      message: error.details.message ?? error.message,
    };
  }

  return {
    ok: false,
    provider: 'LOGO_ISBASI',
    mode: 'product_service_discovery',
    writesPerformed: false,
    externalApiCallAttempted: false,
    httpStatus: error instanceof ApiError ? error.status : undefined,
    errorCode: error instanceof ApiError && error.kind === 'network' ? 'NETWORK_OR_BACKEND_REQUEST_FAILED' : 'LOGO_ISBASI_SERVICE_DISCOVERY_FAILED',
    message: `Network/backend request failed${error instanceof Error && error.message ? `: ${error.message}` : '.'}`,
  };
}

function buildLogoInvoicePdfProbeFailureResult(error: unknown): LogoIsbasiInvoicePdfProbeResult {
  if (error instanceof ApiError && isLogoInvoicePdfProbeResult(error.details)) {
    return {
      ...error.details,
      ok: false,
      httpStatus: error.details.httpStatus ?? error.status,
      message: error.details.message ?? error.message,
    };
  }

  return {
    ok: false,
    provider: 'LOGO_ISBASI',
    mode: 'invoice_pdf_probe',
    writesPerformed: false,
    externalApiCallAttempted: false,
    httpStatus: error instanceof ApiError ? error.status : undefined,
    errorCode: error instanceof ApiError && error.kind === 'network' ? 'NETWORK_OR_BACKEND_REQUEST_FAILED' : 'LOGO_ISBASI_INVOICE_PDF_FAILED',
    message: `Network/backend request failed${error instanceof Error && error.message ? `: ${error.message}` : '.'}`,
  };
}

function buildLogoInvoiceDetailFailureResult(error: unknown): LogoIsbasiInvoiceDetailProbeResult {
  if (error instanceof ApiError && isLogoInvoiceDetailResult(error.details)) {
    return {
      ...error.details,
      ok: false,
      httpStatus: error.details.httpStatus ?? error.status,
      message: error.details.message ?? error.message,
    };
  }

  return {
    ok: false,
    provider: 'LOGO_ISBASI',
    mode: 'invoice_detail_discovery',
    writesPerformed: false,
    externalApiCallAttempted: false,
    httpStatus: error instanceof ApiError ? error.status : undefined,
    errorCode: error instanceof ApiError && error.kind === 'network' ? 'NETWORK_OR_BACKEND_REQUEST_FAILED' : 'LOGO_ISBASI_INVOICE_DETAIL_FAILED',
    message: `Network/backend request failed${error instanceof Error && error.message ? `: ${error.message}` : '.'}`,
  };
}

function buildLogoTestInvoiceCreateFailureResult(error: unknown): LogoIsbasiTestInvoiceCreateResult {
  if (error instanceof ApiError && isLogoTestInvoiceCreateResult(error.details)) {
    return {
      ...error.details,
      ok: false,
      httpStatus: error.details.httpStatus ?? error.status,
      message: error.details.message ?? error.message,
    };
  }

  return {
    ok: false,
    provider: 'LOGO_ISBASI',
    mode: 'test_invoice_create',
    writesPerformed: false,
    externalApiCallAttempted: false,
    httpStatus: error instanceof ApiError ? error.status : undefined,
    errorCode: error instanceof ApiError && error.kind === 'network' ? 'NETWORK_OR_BACKEND_REQUEST_FAILED' : 'LOGO_ISBASI_TEST_INVOICE_CREATE_FAILED',
    message: `Network/backend request failed${error instanceof Error && error.message ? `: ${error.message}` : '.'}`,
  };
}

function buildLogoFirmMatchFailureResult(error: unknown): LogoIsbasiFirmMatchResult {
  if (error instanceof ApiError && isLogoFirmMatchResult(error.details)) {
    return {
      ...error.details,
      ok: false,
      message: error.details.message ?? error.message,
    };
  }

  return {
    ok: false,
    provider: 'LOGO_ISBASI',
    mode: 'firm_match_probe',
    writesPerformed: false,
    externalApiCallAttempted: false,
    errorCode: error instanceof ApiError && error.kind === 'network' ? 'NETWORK_OR_BACKEND_REQUEST_FAILED' : 'LOGO_ISBASI_FIRM_MATCH_FAILED',
    message: `Network/backend request failed${error instanceof Error && error.message ? `: ${error.message}` : '.'}`,
  };
}

function buildLogoFirmBindFailureResult(error: unknown): LogoIsbasiFirmBindResult {
  if (error instanceof ApiError && isLogoFirmBindResult(error.details)) {
    return {
      ...error.details,
      ok: false,
      message: error.details.message ?? error.message,
    };
  }

  return {
    ok: false,
    provider: 'LOGO_ISBASI',
    mode: 'firm_bind_probe',
    writesPerformed: false,
    externalApiCallAttempted: false,
    errorCode: error instanceof ApiError && error.kind === 'network' ? 'NETWORK_OR_BACKEND_REQUEST_FAILED' : 'LOGO_ISBASI_FIRM_BIND_FAILED',
    message: `Network/backend request failed${error instanceof Error && error.message ? `: ${error.message}` : '.'}`,
  };
}

function formatLogoFirmSummary(firm: LogoIsbasiFirmSummary) {
  return [
    firm.code ? `code ${firm.code}` : null,
    firm.firmType ? `type ${firm.firmType}` : null,
    firm.taxNumberMasked ? `tax ${firm.taxNumberMasked}` : null,
  ].filter(Boolean).join(', ') || 'No optional fields returned';
}

function formatLogoInvoiceSummary(invoice: LogoIsbasiInvoiceSummary) {
  return [
    invoice.invoiceNumber ? `number ${invoice.invoiceNumber}` : null,
    invoice.date ? `date ${invoice.date}` : null,
    invoice.amount && invoice.currency ? `${invoice.amount} ${invoice.currency}` : invoice.amount,
    invoice.status ? `status ${invoice.status}` : null,
  ].filter(Boolean).join(', ') || 'No optional fields returned';
}

function formatLogoIncomingEinvoiceSummary(invoice: LogoIsbasiIncomingEinvoiceSummary) {
  return [
    invoice.uuId ? `uuid ${invoice.uuId}` : null,
    invoice.issueDate ? `issue date ${invoice.issueDate}` : null,
    invoice.amount && invoice.currency ? `${invoice.amount} ${invoice.currency}` : invoice.amount,
    invoice.status ? `status ${invoice.status}` : null,
    invoice.supplierTcknVknMasked ? `supplier tax ${invoice.supplierTcknVknMasked}` : null,
  ].filter(Boolean).join(', ') || 'No optional fields returned';
}

function formatBoolean(value: boolean | null | undefined) {
  return value ? 'Yes' : 'No';
}

function formatSource(value: string | null | undefined) {
  return value === 'configured' ? 'Managed by marketplace operations' : 'Marketplace default fallback';
}

function formatShippingMode(value: string | null | undefined) {
  if (value === 'external_provider') {
    return 'External provider cost';
  }
  if (value === 'fixed') {
    return 'Fixed deduction';
  }
  return 'Disabled';
}

function readMetadataString(config: VendorShippingConfig | null, keys: string[]) {
  const metadata = isRecord(config?.providerMetadata) ? config.providerMetadata : {};
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
  }
  return null;
}

function metadataConfigured(config: VendorShippingConfig | null) {
  return isRecord(config?.providerMetadata) && Object.keys(config.providerMetadata).length > 0;
}

function getNavlungoSenderAddressId(config: VendorShippingConfig | null) {
  return (
    readMetadataString(config, ['navlungoSenderAddressId', 'senderAddressId', 'sender_address_id']) ??
    config?.defaultWarehouseId ??
    null
  );
}

function getNavlungoReturnRecipientAddressId(config: VendorShippingConfig | null) {
  return readMetadataString(config, [
    'navlungoReturnRecipientAddressId',
    'returnRecipientAddressId',
    'return_recipient_address_id',
  ]);
}

function getNavlungoReturnLocation(config: VendorShippingConfig | null) {
  return [
    readMetadataString(config, ['navlungoReturnRecipientCity', 'returnRecipientCity', 'return_recipient_city']),
    readMetadataString(config, ['navlungoReturnRecipientDistrict', 'returnRecipientDistrict', 'return_recipient_district']),
  ]
    .filter(Boolean)
    .join(' / ');
}

function getNavlungoSenderLocation(config: VendorShippingConfig | null) {
  return [
    readMetadataString(config, ['navlungoSenderCity', 'senderCity', 'sender_city']),
    readMetadataString(config, ['navlungoSenderDistrict', 'senderDistrict', 'sender_district']),
  ]
    .filter(Boolean)
    .join(' / ');
}

function getVendorInitials(name: string | null | undefined) {
  const normalized = name?.trim();
  if (!normalized) {
    return 'V';
  }

  const initials = normalized
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

  return initials || normalized.slice(0, 1).toUpperCase();
}

function LocationValue({
  id,
  location,
  fallback = 'Location not configured',
}: {
  id: string | null | undefined;
  location: string | null | undefined;
  fallback?: string;
}) {
  const readableLocation = formatValue(location, fallback);
  const operationalId = formatValue(id, 'ID not configured');

  return (
    <span className="vendor-profile-location-value">
      <strong>{readableLocation}</strong>
      <small>{operationalId}</small>
    </span>
  );
}

function findOpenVendorProfileTicket(tickets: SupportTicket[] | null, vendorId: string) {
  return (tickets ?? []).find((ticket) => {
    if (ticket.vendorId !== vendorId || !OPEN_SUPPORT_STATUSES.has(ticket.status)) {
      return false;
    }
    const route = ticket.contextSummary?.route?.toLowerCase();
    const path = ticket.contextSummary?.path?.toLowerCase();
    const subject = ticket.subject?.toLowerCase() ?? '';
    return (
      route === VENDOR_PROFILE_CONTEXT_ROUTE ||
      path === VENDOR_PROFILE_PATH ||
      subject.includes('vendor profile') ||
      subject.includes('profile settings')
    );
  }) ?? null;
}

function getTicketHref(ticket: SupportTicket, isAdmin: boolean) {
  return isAdmin ? `/admin/support/${ticket.id}` : `/support/${ticket.id}`;
}

function getReadinessTone(status: ReadinessStatus) {
  if (status === 'ready') {
    return 'success';
  }
  if (status === 'review') {
    return 'warning';
  }
  if (status === 'unknown') {
    return 'attention';
  }
  return 'neutral';
}

function getReadinessLabel(status: ReadinessStatus) {
  if (status === 'ready') {
    return 'Ready';
  }
  if (status === 'review') {
    return 'Requires configuration review';
  }
  if (status === 'unknown') {
    return 'Unknown';
  }
  return 'Not modeled yet';
}

function combineReadinessStatus(items: ReadinessItem[]): ReadinessStatus {
  if (items.some((item) => item.status === 'unknown')) {
    return 'unknown';
  }
  if (items.some((item) => item.status === 'review')) {
    return 'review';
  }
  if (items.every((item) => item.status === 'not_modeled')) {
    return 'not_modeled';
  }
  if (items.some((item) => item.status === 'not_modeled')) {
    return 'review';
  }
  return 'ready';
}

function ReadinessChecklistCard({
  section,
  onOpen,
}: {
  section: ReadinessSection;
  onOpen: (path: string) => void;
}) {
  return (
    <article className={`vendor-readiness-card readiness-${section.status}`}>
      <div className="vendor-readiness-card-heading">
        <div>
          <h3>{section.title}</h3>
          <p>{section.summary}</p>
        </div>
        <StatusBadge tone={getReadinessTone(section.status)}>{getReadinessLabel(section.status)}</StatusBadge>
      </div>
      <ul className="vendor-readiness-checklist">
        {section.items.map((item) => (
          <li key={item.label}>
            <span>{item.label}</span>
            <StatusBadge tone={getReadinessTone(item.status)}>{getReadinessLabel(item.status)}</StatusBadge>
            <small>{item.detail}</small>
          </li>
        ))}
      </ul>
      <OperationalActionGroup>
        <button type="button" className="button button-secondary" onClick={() => onOpen(section.actionPath)}>
          {section.actionLabel}
        </button>
      </OperationalActionGroup>
    </article>
  );
}

export function VendorProfilePage() {
  const navigate = useNavigate();
  const appReadiness = useAppReadiness();
  const currentVendor = appReadiness.currentVendor;
  const currentUser = appReadiness.currentUser;
  const isAdmin = currentUser?.role === 'admin';
  const { message, tone, showFeedback } = useActionFeedback();
  const [billingEditOpen, setBillingEditOpen] = useState(false);
  const [billingForm, setBillingForm] = useState<BillingProfileFormState>(EMPTY_BILLING_PROFILE_FORM);
  const [billingFormError, setBillingFormError] = useState<string | null>(null);
  const [savedBillingProfile, setSavedBillingProfile] = useState<VendorBillingProfile | null>(null);
  const [logoLoginResult, setLogoLoginResult] = useState<LogoIsbasiLoginProbeResult | null>(null);
  const [logoFirmsResult, setLogoFirmsResult] = useState<LogoIsbasiFirmsDiscoveryResult | null>(null);
  const [logoInvoicesResult, setLogoInvoicesResult] = useState<LogoIsbasiInvoiceListProbeResult | null>(null);
  const [logoIncomingEinvoicesResult, setLogoIncomingEinvoicesResult] =
    useState<LogoIsbasiIncomingEinvoiceListProbeResult | null>(null);
  const [logoServicesResult, setLogoServicesResult] = useState<LogoIsbasiProductServiceDiscoveryResult | null>(null);
  const [logoInvoicePdfUuid, setLogoInvoicePdfUuid] = useState('');
  const [logoInvoicePdfResult, setLogoInvoicePdfResult] = useState<LogoIsbasiInvoicePdfProbeResult | null>(null);
  const [selectedLogoInvoiceId, setSelectedLogoInvoiceId] = useState('');
  const [logoInvoiceDetailResult, setLogoInvoiceDetailResult] = useState<LogoIsbasiInvoiceDetailProbeResult | null>(null);
  const [logoFirmMatchResult, setLogoFirmMatchResult] = useState<LogoIsbasiFirmMatchResult | null>(null);
  const [logoFirmBindResult, setLogoFirmBindResult] = useState<LogoIsbasiFirmBindResult | null>(null);
  const [logoPreviewOpen, setLogoPreviewOpen] = useState(false);
  const [logoPreviewForm, setLogoPreviewForm] = useState<LogoCommissionPreviewFormState>(DEFAULT_LOGO_COMMISSION_PREVIEW_FORM);
  const [logoPreviewFormError, setLogoPreviewFormError] = useState<string | null>(null);
  const [logoPreviewResult, setLogoPreviewResult] = useState<LogoIsbasiCommissionInvoicePreviewResult | null>(null);
  const [logoTestInvoiceConfirmed, setLogoTestInvoiceConfirmed] = useState(false);
  const [logoTestInvoiceResult, setLogoTestInvoiceResult] = useState<LogoIsbasiTestInvoiceCreateResult | null>(null);

  const shippingQuery = useQueryResource(
    queryKeys.vendorProfile.shippingConfig(currentVendor.vendorId),
    ({ signal }) => getVendorShippingConfig({ vendorId: currentVendor.vendorId, signal }),
    { enabled: appReadiness.ready },
  );
  const financeQuery = useQueryResource(
    queryKeys.vendorProfile.financeProfile(currentVendor.vendorId),
    ({ signal }) => getFinanceProfile({ vendorId: currentVendor.vendorId, signal }),
    { enabled: appReadiness.ready },
  );
  const billingQuery = useQueryResource(
    queryKeys.vendorProfile.billingProfile(currentVendor.vendorId),
    ({ signal }) => getVendorBillingProfile(currentVendor.vendorId, { signal }),
    { enabled: appReadiness.ready && isAdmin },
  );
  const supportQuery = useQueryResource(
    queryKeys.vendorProfile.supportTickets(currentVendor.vendorId),
    ({ signal }) => (isAdmin ? listAdminSupportTickets({ signal }) : listVendorSupportTickets({ signal })),
    { enabled: appReadiness.ready },
  );

  const shippingConfig = shippingQuery.data;
  const financeProfile = financeQuery.data ?? null;
  const billingProfile = savedBillingProfile?.vendorId === currentVendor.vendorId ? savedBillingProfile : billingQuery.data ?? null;
  const logoBindingPresent = Boolean(billingProfile?.logoIsbasiCustomerCode || billingProfile?.logoIsbasiCustomerId);
  const logoBindingNeedsMatch = Boolean(billingProfile?.logoIsbasiCustomerCode?.trim() && !billingProfile?.logoIsbasiCustomerId?.trim());
  const supportTickets = useMemo(
    () => safeArray(supportQuery.data).filter((ticket) => ticket.vendorId === currentVendor.vendorId),
    [currentVendor.vendorId, supportQuery.data],
  );
  const existingProfileTicket = useMemo(
    () => findOpenVendorProfileTicket(supportTickets, currentVendor.vendorId),
    [currentVendor.vendorId, supportTickets],
  );
  const warehouses = safeArray(shippingConfig?.warehouses);
  const defaultWarehouse = warehouses.find((warehouse) => warehouse.isDefault) ?? warehouses[0] ?? null;
  const navlungoSenderAddressId = getNavlungoSenderAddressId(shippingConfig);
  const navlungoReturnRecipientAddressId = getNavlungoReturnRecipientAddressId(shippingConfig);
  const navlungoReturnLocation = getNavlungoReturnLocation(shippingConfig);
  const navlungoSenderLocation = getNavlungoSenderLocation(shippingConfig);
  const forwardWarehouseLocation = navlungoSenderLocation || defaultWarehouse?.address || defaultWarehouse?.name || null;
  const returnDestinationLocation = navlungoReturnLocation || 'Return destination location not configured';
  const shippingDataLoaded = Boolean(!shippingQuery.isInitialLoading && shippingConfig);
  const financeDataLoaded = Boolean(!financeQuery.isInitialLoading && financeQuery.data);
  const supportDataLoaded = Boolean(!supportQuery.isInitialLoading && supportQuery.data);
  const providerConfigured = Boolean(shippingConfig?.preferredProvider && metadataConfigured(shippingConfig));
  const warehouseConfigured = Boolean(defaultWarehouse?.warehouseId || shippingConfig?.defaultWarehouseId || navlungoSenderAddressId);
  const shippingConfigured = Boolean(shippingConfig?.shippingEnabled && providerConfigured && warehouseConfigured);
  const returnsConfigured = Boolean(navlungoReturnRecipientAddressId);
  const supportWorkflowReady = Boolean(appReadiness.ready && supportDataLoaded && !supportQuery.isError);
  const marketplaceTermsActive = financeProfile?.active === true;
  const financePreviewAvailable = Boolean(financeDataLoaded && financeProfile);
  const readinessSections = useMemo<ReadinessSection[]>(() => {
    const shippingItems: ReadinessItem[] = [
      {
        label: 'Shipping enabled',
        status: !shippingDataLoaded ? 'unknown' : shippingConfig?.shippingEnabled ? 'ready' : 'review',
        detail: !shippingDataLoaded
          ? 'Shipping configuration could not be confirmed from the current profile data.'
          : shippingConfig?.shippingEnabled
            ? 'Shipment creation can use this vendor configuration.'
            : 'Enable shipping before shipment workflows can rely on this vendor setup.',
      },
      {
        label: 'Provider configured',
        status: !shippingDataLoaded ? 'unknown' : providerConfigured ? 'ready' : 'review',
        detail: !shippingDataLoaded
          ? 'Provider metadata is unavailable.'
          : providerConfigured
            ? `${formatShippingProviderName(shippingConfig?.preferredProvider)} metadata is present.`
            : 'Review the provider metadata before treating shipping as ready.',
      },
      {
        label: 'Warehouse configured',
        status: !shippingDataLoaded ? 'unknown' : warehouseConfigured ? 'ready' : 'review',
        detail: !shippingDataLoaded
          ? 'Warehouse data is unavailable.'
          : warehouseConfigured
            ? 'A default warehouse or sender address is available.'
            : 'Configure a warehouse or sender address for shipment work.',
      },
    ];
    const returnsItems: ReadinessItem[] = [
      {
        label: 'Return destination configured',
        status: !shippingDataLoaded ? 'unknown' : returnsConfigured ? 'ready' : 'review',
        detail: !shippingDataLoaded
          ? 'Return destination metadata is unavailable.'
          : returnsConfigured
            ? 'Return destination ID is present in provider metadata.'
            : 'Review the return recipient destination before return workflows rely on it.',
      },
      {
        label: 'Return workflow visible',
        status: appReadiness.ready ? 'ready' : 'unknown',
        detail: appReadiness.ready ? 'Return queues are available for this vendor context.' : 'Vendor route context is still loading.',
      },
    ];
    const financeItems: ReadinessItem[] = [
      {
        label: 'Finance preview available',
        status: financeQuery.isError ? 'unknown' : financePreviewAvailable ? 'ready' : 'unknown',
        detail: financeQuery.isError
          ? 'Finance profile data could not be loaded.'
          : financePreviewAvailable
            ? 'Settlement preview data is visible as estimates.'
            : 'Finance preview has not returned a profile yet.',
      },
      {
        label: 'Settlement visibility enabled',
        status: financeQuery.isError ? 'unknown' : financePreviewAvailable ? (marketplaceTermsActive ? 'ready' : 'review') : 'unknown',
        detail: financePreviewAvailable
          ? marketplaceTermsActive
            ? 'Marketplace terms are active for estimate visibility.'
            : 'Marketplace terms require verification before treating finance visibility as ready.'
          : 'Settlement visibility cannot be inferred without the finance profile.',
      },
    ];
    const supportItems: ReadinessItem[] = [
      {
        label: 'Support route accessible',
        status: appReadiness.ready ? 'ready' : 'unknown',
        detail: appReadiness.ready ? 'Support routes are available in this workspace.' : 'Vendor access context is still loading.',
      },
      {
        label: 'Support context available',
        status: supportQuery.isError ? 'unknown' : supportWorkflowReady ? 'ready' : 'unknown',
        detail: supportQuery.isError
          ? 'Support context could not be loaded.'
          : supportWorkflowReady
            ? 'Profile correction tickets can reuse the support workflow.'
            : 'Support tickets are still loading.',
      },
    ];
    const workflowItems: ReadinessItem[] = [
      {
        label: 'Vendor access state',
        status: appReadiness.ready && currentVendor.vendorId ? 'ready' : 'unknown',
        detail: appReadiness.ready ? 'This workspace is scoped to the selected vendor.' : 'Vendor access is not ready yet.',
      },
      {
        label: 'Workflow queues',
        status: appReadiness.ready ? 'ready' : 'unknown',
        detail: appReadiness.ready ? 'Orders, returns, finance, and support routes can open with this vendor scope.' : 'Workflow routes are waiting for vendor context.',
      },
    ];
    const automationItems: ReadinessItem[] = [
      {
        label: 'Automation queue accessible',
        status: appReadiness.ready ? 'review' : 'unknown',
        detail: appReadiness.ready
          ? 'Automation visibility exists, but this profile does not model vendor-specific automation readiness.'
          : 'Automation queue access cannot be checked until vendor context is ready.',
      },
      {
        label: 'Alerts visible',
        status: 'not_modeled',
        detail: 'Vendor-specific automation alert readiness is not modeled on the profile yet.',
      },
    ];

    const buildSection = (
      title: string,
      summary: string,
      actionLabel: string,
      actionPath: string,
      items: ReadinessItem[],
    ): ReadinessSection => ({
      title,
      summary,
      actionLabel,
      actionPath,
      items,
      status: combineReadinessStatus(items),
    });

    return [
      buildSection('Shipping ready', 'Shipment work can start only when shipping, provider, and warehouse truth are configured.', 'Open shipping workflow', '/orders?workflow=awaiting-shipment', shippingItems),
      buildSection('Returns ready', 'Return workflows need a configured destination plus visible return queues.', 'Open returns review', '/returns?workflow=pending-review', returnsItems),
      buildSection('Finance visibility ready', 'Finance readiness means estimate visibility only, not payout or accounting execution.', 'Open settlement preview', '/finance?workflow=settlement-review', financeItems),
      buildSection('Support channel active', 'Profile corrections should flow through existing support context without duplicate tickets.', 'Open support workspace', existingProfileTicket ? getTicketHref(existingProfileTicket, isAdmin) : '/support', supportItems),
      buildSection('Workflow access ready', 'The workspace must be safely scoped before operational queues are trusted.', 'Open orders queue', '/orders', workflowItems),
      buildSection('Automation visibility ready', 'Automation readiness stays conservative until vendor-specific alert coverage is modeled.', 'Open automation queue', '/automation?workflow=active-issue-groups', automationItems),
    ];
  }, [
    appReadiness.ready,
    currentVendor.vendorId,
    existingProfileTicket,
    financePreviewAvailable,
    financeQuery.isError,
    isAdmin,
    marketplaceTermsActive,
    providerConfigured,
    returnsConfigured,
    shippingConfig,
    shippingDataLoaded,
    supportQuery.isError,
    supportWorkflowReady,
    warehouseConfigured,
  ]);

  const supportMutation = useMutationAction(
    async () =>
      createSupportTicket({
        subject: 'Vendor profile settings correction',
        message: `Please review the vendor profile and operational settings for ${currentVendor.vendorName}.`,
        priority: 'normal',
        category: 'OTHER',
        contextType: 'general',
        contextId: currentVendor.vendorId,
        contextSnapshot: {
          route: VENDOR_PROFILE_CONTEXT_ROUTE,
          path: VENDOR_PROFILE_PATH,
          status: 'correction_requested',
          vendorId: currentVendor.vendorId,
          vendorName: currentVendor.vendorName,
          shippingProvider: shippingConfig?.preferredProvider ?? null,
          shippingEnabled: shippingConfig?.shippingEnabled ?? null,
          commissionProfileSource: financeProfile?.source ?? null,
          returnRecipientConfigured: Boolean(navlungoReturnRecipientAddressId),
        },
      }),
    {
      onSuccess: async (ticket) => {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.support.tickets(currentVendor.vendorId) }),
          queryClient.invalidateQueries({ queryKey: queryKeys.vendorProfile.supportTickets(currentVendor.vendorId) }),
          queryClient.invalidateQueries({ queryKey: queryKeys.admin.support.tickets() }),
        ]);
        showFeedback('Profile correction ticket created.', 'success');
        navigate(getTicketHref(ticket, isAdmin));
      },
      onError: (error) => {
        showFeedback(error instanceof Error ? error.message : 'Unable to contact support.', 'error');
      },
    },
  );

  const billingMutation = useMutationAction(
    (input: VendorBillingProfileInput) => updateVendorBillingProfile(currentVendor.vendorId, input),
    {
      onSuccess: async (savedProfile) => {
        queryClient.setQueryData(queryKeys.vendorProfile.billingProfile(currentVendor.vendorId), savedProfile);
        setSavedBillingProfile(savedProfile);
        setBillingEditOpen(false);
        setBillingFormError(null);
        setBillingForm(buildBillingProfileFormState(savedProfile));
        showFeedback('Billing profile saved.', 'success');
      },
      onError: (error) => {
        setBillingFormError(error instanceof Error ? error.message : 'Unable to save billing profile.');
      },
    },
  );

  const logoLoginMutation = useMutationAction(
    () => probeLogoIsbasiLogin(),
    {
      onSuccess: (result) => {
        setLogoFirmsResult(null);
        setLogoInvoicesResult(null);
        setLogoIncomingEinvoicesResult(null);
        setLogoInvoiceDetailResult(null);
        setSelectedLogoInvoiceId('');
        setLogoFirmMatchResult(null);
        setLogoFirmBindResult(null);
        setLogoPreviewResult(null);
        setLogoTestInvoiceResult(null);
        setLogoLoginResult(result);
        showFeedback('Logo İşbaşı login probe completed.', 'success');
      },
      onError: (error) => {
        setLogoFirmsResult(null);
        setLogoInvoicesResult(null);
        setLogoIncomingEinvoicesResult(null);
        setLogoInvoiceDetailResult(null);
        setSelectedLogoInvoiceId('');
        setLogoFirmMatchResult(null);
        setLogoFirmBindResult(null);
        setLogoPreviewResult(null);
        setLogoTestInvoiceResult(null);
        setLogoLoginResult(buildLogoLoginFailureResult(error));
      },
    },
  );

  const logoFirmsMutation = useMutationAction(
    () => discoverLogoIsbasiFirms(),
    {
      onSuccess: (result) => {
        setLogoLoginResult(null);
        setLogoInvoicesResult(null);
        setLogoIncomingEinvoicesResult(null);
        setLogoInvoiceDetailResult(null);
        setSelectedLogoInvoiceId('');
        setLogoFirmMatchResult(null);
        setLogoFirmBindResult(null);
        setLogoPreviewResult(null);
        setLogoTestInvoiceResult(null);
        setLogoFirmsResult(result);
        showFeedback('Logo İşbaşı firms discovery completed.', 'success');
      },
      onError: (error) => {
        setLogoLoginResult(null);
        setLogoInvoicesResult(null);
        setLogoIncomingEinvoicesResult(null);
        setLogoInvoiceDetailResult(null);
        setSelectedLogoInvoiceId('');
        setLogoFirmMatchResult(null);
        setLogoFirmBindResult(null);
        setLogoPreviewResult(null);
        setLogoTestInvoiceResult(null);
        setLogoFirmsResult(buildLogoFirmsFailureResult(error));
      },
    },
  );

  const logoInvoicesMutation = useMutationAction(
    () => discoverLogoIsbasiInvoices(),
    {
      onSuccess: (result) => {
        setLogoLoginResult(null);
        setLogoFirmsResult(null);
        setLogoFirmMatchResult(null);
        setLogoFirmBindResult(null);
        setLogoPreviewResult(null);
        setLogoInvoiceDetailResult(null);
        setLogoIncomingEinvoicesResult(null);
        setLogoTestInvoiceResult(null);
        setLogoInvoicesResult(result);
        const firstInvoiceId = result.sampleInvoices?.find((invoice) => invoice.id)?.id ?? '';
        setSelectedLogoInvoiceId(firstInvoiceId);
        showFeedback('Logo İşbaşı invoice discovery completed.', 'success');
      },
      onError: (error) => {
        setLogoLoginResult(null);
        setLogoFirmsResult(null);
        setLogoFirmMatchResult(null);
        setLogoFirmBindResult(null);
        setLogoPreviewResult(null);
        setLogoInvoiceDetailResult(null);
        setLogoIncomingEinvoicesResult(null);
        setLogoTestInvoiceResult(null);
        setSelectedLogoInvoiceId('');
        setLogoInvoicesResult(buildLogoInvoiceListFailureResult(error));
      },
    },
  );

  const logoIncomingEinvoicesMutation = useMutationAction(
    () => discoverLogoIsbasiIncomingEinvoices(),
    {
      onSuccess: (result) => {
        setLogoLoginResult(null);
        setLogoFirmsResult(null);
        setLogoInvoicesResult(null);
        setLogoInvoiceDetailResult(null);
        setSelectedLogoInvoiceId('');
        setLogoFirmMatchResult(null);
        setLogoFirmBindResult(null);
        setLogoPreviewResult(null);
        setLogoTestInvoiceResult(null);
        setLogoIncomingEinvoicesResult(result);
        showFeedback('Logo İşbaşı incoming e-invoices discovery completed.', 'success');
      },
      onError: (error) => {
        setLogoLoginResult(null);
        setLogoFirmsResult(null);
        setLogoInvoicesResult(null);
        setLogoInvoiceDetailResult(null);
        setSelectedLogoInvoiceId('');
        setLogoFirmMatchResult(null);
        setLogoFirmBindResult(null);
        setLogoPreviewResult(null);
        setLogoTestInvoiceResult(null);
        setLogoIncomingEinvoicesResult(buildLogoIncomingEinvoiceListFailureResult(error));
      },
    },
  );

  const logoServicesMutation = useMutationAction(
    () => discoverLogoIsbasiServices(),
    {
      onSuccess: (result) => {
        setLogoLoginResult(null);
        setLogoFirmsResult(null);
        setLogoInvoicesResult(null);
        setLogoIncomingEinvoicesResult(null);
        setLogoInvoiceDetailResult(null);
        setSelectedLogoInvoiceId('');
        setLogoFirmMatchResult(null);
        setLogoFirmBindResult(null);
        setLogoPreviewResult(null);
        setLogoTestInvoiceResult(null);
        setLogoServicesResult(result);
        showFeedback('Logo İşbaşı service discovery completed.', 'success');
      },
      onError: (error) => {
        setLogoLoginResult(null);
        setLogoFirmsResult(null);
        setLogoInvoicesResult(null);
        setLogoIncomingEinvoicesResult(null);
        setLogoInvoiceDetailResult(null);
        setSelectedLogoInvoiceId('');
        setLogoFirmMatchResult(null);
        setLogoFirmBindResult(null);
        setLogoPreviewResult(null);
        setLogoTestInvoiceResult(null);
        setLogoServicesResult(buildLogoProductServiceDiscoveryFailureResult(error));
      },
    },
  );

  const logoInvoicePdfMutation = useMutationAction(
    (uuid: string) => fetchLogoIsbasiInvoicePdf(uuid),
    {
      onSuccess: (result) => {
        setLogoLoginResult(null);
        setLogoFirmsResult(null);
        setLogoInvoicesResult(null);
        setLogoIncomingEinvoicesResult(null);
        setLogoServicesResult(null);
        setLogoInvoiceDetailResult(null);
        setSelectedLogoInvoiceId('');
        setLogoFirmMatchResult(null);
        setLogoFirmBindResult(null);
        setLogoPreviewResult(null);
        setLogoTestInvoiceResult(null);
        setLogoInvoicePdfResult(result);
        showFeedback('Logo İşbaşı invoice PDF probe completed.', result.ok ? 'success' : 'info');
      },
      onError: (error) => {
        setLogoLoginResult(null);
        setLogoFirmsResult(null);
        setLogoInvoicesResult(null);
        setLogoIncomingEinvoicesResult(null);
        setLogoServicesResult(null);
        setLogoInvoiceDetailResult(null);
        setSelectedLogoInvoiceId('');
        setLogoFirmMatchResult(null);
        setLogoFirmBindResult(null);
        setLogoPreviewResult(null);
        setLogoTestInvoiceResult(null);
        setLogoInvoicePdfResult(buildLogoInvoicePdfProbeFailureResult(error));
      },
    },
  );

  const logoInvoiceDetailMutation = useMutationAction(
    (invoiceId: string) => inspectLogoIsbasiInvoice(invoiceId),
    {
      onSuccess: (result) => {
        setLogoLoginResult(null);
        setLogoFirmsResult(null);
        setLogoFirmMatchResult(null);
        setLogoFirmBindResult(null);
        setLogoPreviewResult(null);
        setLogoIncomingEinvoicesResult(null);
        setLogoTestInvoiceResult(null);
        setLogoInvoiceDetailResult(result);
        showFeedback('Logo İşbaşı invoice shape inspection completed.', 'success');
      },
      onError: (error) => {
        setLogoLoginResult(null);
        setLogoFirmsResult(null);
        setLogoFirmMatchResult(null);
        setLogoFirmBindResult(null);
        setLogoPreviewResult(null);
        setLogoIncomingEinvoicesResult(null);
        setLogoTestInvoiceResult(null);
        setLogoInvoiceDetailResult(buildLogoInvoiceDetailFailureResult(error));
      },
    },
  );

  const logoFirmMatchMutation = useMutationAction(
    () => matchVendorLogoIsbasiFirm(currentVendor.vendorId),
    {
      onSuccess: (result) => {
        setLogoLoginResult(null);
        setLogoFirmsResult(null);
        setLogoInvoicesResult(null);
        setLogoIncomingEinvoicesResult(null);
        setLogoInvoiceDetailResult(null);
        setSelectedLogoInvoiceId('');
        setLogoFirmBindResult(null);
        setLogoPreviewResult(null);
        setLogoTestInvoiceResult(null);
        setLogoFirmMatchResult(result);
        showFeedback('Logo İşbaşı firm match probe completed.', 'success');
      },
      onError: (error) => {
        setLogoLoginResult(null);
        setLogoFirmsResult(null);
        setLogoInvoicesResult(null);
        setLogoIncomingEinvoicesResult(null);
        setLogoInvoiceDetailResult(null);
        setSelectedLogoInvoiceId('');
        setLogoFirmBindResult(null);
        setLogoPreviewResult(null);
        setLogoTestInvoiceResult(null);
        setLogoFirmMatchResult(buildLogoFirmMatchFailureResult(error));
      },
    },
  );

  const logoFirmBindMutation = useMutationAction(
    () => bindVendorLogoIsbasiFirm(currentVendor.vendorId),
    {
      onSuccess: (result) => {
        setLogoLoginResult(null);
        setLogoFirmsResult(null);
        setLogoInvoicesResult(null);
        setLogoIncomingEinvoicesResult(null);
        setLogoInvoiceDetailResult(null);
        setSelectedLogoInvoiceId('');
        setLogoFirmMatchResult(null);
        setLogoPreviewResult(null);
        setLogoTestInvoiceResult(null);
        setLogoFirmBindResult(result);
        setSavedBillingProfile((current) => {
          const baseProfile = current?.vendorId === currentVendor.vendorId
            ? current
            : billingProfile?.vendorId === currentVendor.vendorId
              ? billingProfile
              : null;
          return baseProfile
            ? {
              ...baseProfile,
              logoIsbasiCustomerCode: result.logoIsbasiCustomerCode ?? baseProfile.logoIsbasiCustomerCode,
              logoIsbasiCustomerId: result.logoIsbasiCustomerId ?? baseProfile.logoIsbasiCustomerId,
              logoIsbasiEinvoiceEligible: result.logoIsbasiEinvoiceEligible ?? baseProfile.logoIsbasiEinvoiceEligible,
              logoIsbasiLastCheckedAt: result.logoIsbasiLastCheckedAt ?? baseProfile.logoIsbasiLastCheckedAt,
            }
            : current;
        });
        void queryClient.invalidateQueries({ queryKey: queryKeys.vendorProfile.billingProfile(currentVendor.vendorId) });
        showFeedback('Logo İşbaşı firm binding updated.', 'success');
      },
      onError: (error) => {
        setLogoLoginResult(null);
        setLogoFirmsResult(null);
        setLogoInvoicesResult(null);
        setLogoIncomingEinvoicesResult(null);
        setLogoInvoiceDetailResult(null);
        setSelectedLogoInvoiceId('');
        setLogoFirmMatchResult(null);
        setLogoPreviewResult(null);
        setLogoTestInvoiceResult(null);
        setLogoFirmBindResult(buildLogoFirmBindFailureResult(error));
      },
    },
  );

  const logoPreviewMutation = useMutationAction(
    (input: LogoCommissionPreviewFormState) =>
      previewLogoIsbasiCommissionInvoice(currentVendor.vendorId, {
        commissionAmount: input.commissionAmount.trim(),
        vatRate: input.vatRate.trim(),
        currency: input.currency.trim(),
        description: input.description.trim(),
        sourcePeriod: input.sourcePeriod.trim() || null,
      }),
    {
      onSuccess: (result) => {
        setLogoLoginResult(null);
        setLogoFirmsResult(null);
        setLogoInvoicesResult(null);
        setLogoIncomingEinvoicesResult(null);
        setLogoInvoiceDetailResult(null);
        setSelectedLogoInvoiceId('');
        setLogoFirmMatchResult(null);
        setLogoFirmBindResult(null);
        setLogoTestInvoiceResult(null);
        setLogoPreviewResult(result);
        showFeedback('Commission e-Fatura preview generated.', 'success');
      },
      onError: (error) => {
        setLogoLoginResult(null);
        setLogoFirmsResult(null);
        setLogoInvoicesResult(null);
        setLogoIncomingEinvoicesResult(null);
        setLogoInvoiceDetailResult(null);
        setSelectedLogoInvoiceId('');
        setLogoFirmMatchResult(null);
        setLogoFirmBindResult(null);
        setLogoPreviewResult(null);
        setLogoTestInvoiceResult(null);
        setLogoPreviewFormError(error instanceof Error ? error.message : 'Commission e-Fatura preview failed.');
      },
    },
  );

  const logoTestInvoiceMutation = useMutationAction(
    () => createLogoIsbasiTestInvoice(currentVendor.vendorId),
    {
      onSuccess: (result) => {
        setLogoLoginResult(null);
        setLogoFirmsResult(null);
        setLogoInvoicesResult(null);
        setLogoIncomingEinvoicesResult(null);
        setLogoInvoiceDetailResult(null);
        setSelectedLogoInvoiceId('');
        setLogoFirmMatchResult(null);
        setLogoFirmBindResult(null);
        setLogoPreviewResult(null);
        setLogoPreviewFormError(null);
        setLogoTestInvoiceResult(result);
        showFeedback('Logo İşbaşı test invoice create probe completed.', result.ok ? 'success' : 'info');
      },
      onError: (error) => {
        setLogoLoginResult(null);
        setLogoFirmsResult(null);
        setLogoInvoicesResult(null);
        setLogoIncomingEinvoicesResult(null);
        setLogoInvoiceDetailResult(null);
        setSelectedLogoInvoiceId('');
        setLogoFirmMatchResult(null);
        setLogoFirmBindResult(null);
        setLogoPreviewResult(null);
        setLogoPreviewFormError(null);
        setLogoTestInvoiceResult(buildLogoTestInvoiceCreateFailureResult(error));
      },
    },
  );

  function handleContactSupport() {
    if (existingProfileTicket) {
      showFeedback('Existing vendor profile support ticket opened.', 'info');
      navigate(getTicketHref(existingProfileTicket, isAdmin));
      return;
    }
    void supportMutation.mutateAsync(undefined);
  }

  function handleOpenReadinessAction(path: string) {
    navigate(path);
  }

  function handleOpenBillingEdit() {
    setBillingForm(buildBillingProfileFormState(billingProfile));
    setBillingFormError(null);
    setBillingEditOpen(true);
  }

  function handleCancelBillingEdit() {
    setBillingForm(buildBillingProfileFormState(billingProfile));
    setBillingFormError(null);
    setBillingEditOpen(false);
    billingMutation.reset();
  }

  function handleBillingFormChange(field: keyof BillingProfileFormState, value: string) {
    setBillingForm((current) => ({ ...current, [field]: value }));
    if (billingFormError) {
      setBillingFormError(null);
    }
  }

  function handleBillingProfileSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validationError = validateBillingProfileForm(billingForm);
    if (validationError) {
      setBillingFormError(validationError);
      return;
    }
    void billingMutation.mutateAsync(buildBillingProfileInput(billingForm));
  }

  function handleLogoPreviewFormChange(field: keyof LogoCommissionPreviewFormState, value: string) {
    setLogoPreviewForm((current) => ({ ...current, [field]: value }));
    if (logoPreviewFormError) {
      setLogoPreviewFormError(null);
    }
  }

  function handleLogoCommissionPreviewSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validationError = validateLogoCommissionPreviewForm(logoPreviewForm);
    if (validationError) {
      setLogoLoginResult(null);
      setLogoFirmsResult(null);
      setLogoInvoicesResult(null);
      setLogoIncomingEinvoicesResult(null);
      setLogoInvoiceDetailResult(null);
      setSelectedLogoInvoiceId('');
      setLogoFirmMatchResult(null);
      setLogoPreviewFormError(validationError);
      return;
    }
    setLogoLoginResult(null);
    setLogoFirmsResult(null);
    setLogoInvoicesResult(null);
    setLogoIncomingEinvoicesResult(null);
    setLogoInvoiceDetailResult(null);
    setSelectedLogoInvoiceId('');
    setLogoFirmMatchResult(null);
    void logoPreviewMutation.mutateAsync(logoPreviewForm).catch(() => undefined);
  }

  return (
    <section className="op-page vendor-profile-page">
      <div className="vendor-profile-hero operational-card">
        <div className="vendor-profile-identity">
          <div className="vendor-profile-avatar" aria-hidden="true">
            {getVendorInitials(currentVendor.vendorName)}
          </div>
          <div>
            <p className="eyebrow">Marketplace seller workspace</p>
            <h1>{currentVendor.vendorName || 'Vendor profile'}</h1>
            <p>
              Review the seller identity, marketplace terms, shipping operations, and return destination currently managed
              for this store. Marketplace-owned fields are read-only here.
            </p>
          </div>
        </div>
        <div className="vendor-profile-actions">
          <StatusBadge tone={isAdmin ? 'info' : 'neutral'}>{isAdmin ? 'Admin view' : 'Read-only vendor view'}</StatusBadge>
          <StatusBadge tone={appReadiness.ready ? 'success' : 'warning'}>{appReadiness.ready ? 'Active workspace' : 'Context loading'}</StatusBadge>
          {existingProfileTicket ? <StatusBadge tone="attention">Support ticket open</StatusBadge> : null}
          <button
            type="button"
            className="button"
            onClick={handleContactSupport}
            disabled={!appReadiness.ready || supportQuery.isInitialLoading || supportMutation.isPending}
          >
            {existingProfileTicket
              ? 'Open correction ticket'
              : supportMutation.isPending
                ? 'Requesting correction...'
                : 'Request profile correction'}
          </button>
        </div>
      </div>

      <OperationalSection
        title="Operational readiness"
        description="A checklist view of whether this vendor is operationally ready, based only on currently loaded configuration and workflow visibility."
      >
        <div className="vendor-profile-readiness-grid" aria-label="Vendor operational readiness">
          {readinessSections.map((section) => (
            <ReadinessChecklistCard key={section.title} section={section} onOpen={handleOpenReadinessAction} />
          ))}
        </div>
      </OperationalSection>

      <div className="vendor-profile-grid">
        <OperationalSection
          title="Store identity"
          description="Seller identity currently available to marketplace operations."
        >
          <MetadataGroup>
            <MetadataRow label="Display name" value={formatValue(currentVendor.vendorName, 'Vendor unavailable')} />
            <MetadataRow label="Vendor ID" value={formatValue(currentVendor.vendorId, 'Missing vendor context')} />
            <MetadataRow label="Legal name" value="Not modeled yet" />
            <MetadataRow label="Store contact" value="Not modeled yet" />
            <MetadataRow label="Signed-in user" value={currentUser?.email ?? 'Unknown'} />
            <MetadataRow label="Seller of record" value="Not configured" />
          </MetadataGroup>
        </OperationalSection>

        <OperationalSection
          title="Billing / Legal Profile"
          description="Seller legal billing identity used later as the billing source for Sporgym commission invoices."
        >
          {!isAdmin ? (
            <MetadataGroup>
              <MetadataRow label="Visibility" value="Admin-managed" />
              <MetadataRow label="Commission invoice readiness" value="Requires configuration review" />
              <MetadataRow label="Edit access" value="Not available in vendor view" />
            </MetadataGroup>
          ) : billingQuery.isError ? (
            <SectionErrorRetry
              title="Billing profile unavailable"
              description={billingQuery.error ?? 'Unable to load the vendor billing profile.'}
              onRetry={() => void billingQuery.refetch()}
            />
          ) : billingQuery.isInitialLoading ? (
            <SectionSkeleton title="Loading billing profile" description="Fetching seller legal billing identity." />
          ) : (
            <>
              <MetadataGroup>
                <MetadataRow label="Legal company name" value={formatValue(billingProfile?.legalCompanyName)} />
                <MetadataRow label="Tax number / TCKN" value={formatValue(billingProfile?.taxNumber)} />
                <MetadataRow label="Tax office" value={formatValue(billingProfile?.taxOffice)} />
                <MetadataRow label="Billing address" value={formatValue(billingProfile?.billingAddress)} />
                <MetadataRow label="Billing city" value={formatValue(billingProfile?.billingCity)} />
                <MetadataRow label="Billing district" value={formatValue(billingProfile?.billingDistrict)} />
                <MetadataRow label="Authorized person" value={formatValue(billingProfile?.authorizedPerson)} />
                <MetadataRow label="Billing email" value={formatValue(billingProfile?.billingEmail)} />
                <MetadataRow label="Billing phone" value={formatValue(billingProfile?.billingPhone)} />
                <MetadataRow label="IBAN" value={formatValue(billingProfile?.iban)} />
                <MetadataRow label="Legal entity type" value={formatValue(billingProfile?.legalEntityType)} />
                <MetadataRow label="Logo İşbaşı customer code" value={formatValue(billingProfile?.logoIsbasiCustomerCode)} />
                <MetadataRow label="Logo İşbaşı customer id" value={formatValue(billingProfile?.logoIsbasiCustomerId)} />
                <MetadataRow
                  label="Logo İşbaşı e-invoice eligible"
                  value={billingProfile?.logoIsbasiEinvoiceEligible === null || billingProfile?.logoIsbasiEinvoiceEligible === undefined
                    ? 'Not configured'
                    : billingProfile.logoIsbasiEinvoiceEligible
                      ? 'Yes'
                      : 'No'}
                />
                <MetadataRow label="Logo İşbaşı last checked" value={formatValue(billingProfile?.logoIsbasiLastCheckedAt)} />
              </MetadataGroup>
              <div className="vendor-profile-integration-list">
                <div>
                  <span>Commission invoice billing source</span>
                  <StatusBadge tone={billingProfile ? 'success' : 'warning'}>
                    {billingProfile ? 'Configured' : 'Required for commission invoices'}
                  </StatusBadge>
                </div>
                <div>
                  <span>Admin edit</span>
                  <button
                    type="button"
                    className="button button-secondary button-compact"
                    onClick={handleOpenBillingEdit}
                    disabled={billingMutation.isPending}
                  >
                    Edit billing profile
                  </button>
                </div>
                <div>
                  <span>Logo İşbaşı diagnostics</span>
                  <div className="vendor-profile-logo-actions">
                    <button
                      type="button"
                      className="button button-secondary button-compact"
                      onClick={() => {
                        setLogoPreviewResult(null);
                        setLogoFirmsResult(null);
                        setLogoInvoicesResult(null);
                        setLogoIncomingEinvoicesResult(null);
                        setLogoInvoiceDetailResult(null);
                        setSelectedLogoInvoiceId('');
                        setLogoFirmMatchResult(null);
                        setLogoFirmBindResult(null);
                        setLogoPreviewFormError(null);
                        void logoLoginMutation.mutateAsync(undefined).catch(() => undefined);
                      }}
                      disabled={logoLoginMutation.isPending}
                    >
                      {logoLoginMutation.isPending ? 'Testing Logo login...' : 'Test Logo Login'}
                    </button>
                    <button
                      type="button"
                      className="button button-secondary button-compact"
                      onClick={() => {
                        setLogoLoginResult(null);
                        setLogoFirmMatchResult(null);
                        setLogoFirmBindResult(null);
                        setLogoPreviewResult(null);
                        setLogoInvoicesResult(null);
                        setLogoIncomingEinvoicesResult(null);
                        setLogoInvoiceDetailResult(null);
                        setSelectedLogoInvoiceId('');
                        setLogoPreviewFormError(null);
                        void logoFirmsMutation.mutateAsync(undefined).catch(() => undefined);
                      }}
                      disabled={logoFirmsMutation.isPending}
                    >
                      {logoFirmsMutation.isPending ? 'Discovering firms...' : 'Discover Logo Firms'}
                    </button>
                    <button
                      type="button"
                      className="button button-secondary button-compact"
                      onClick={() => {
                        setLogoLoginResult(null);
                        setLogoFirmsResult(null);
                        setLogoFirmMatchResult(null);
                        setLogoFirmBindResult(null);
                        setLogoPreviewResult(null);
                        setLogoInvoiceDetailResult(null);
                        setLogoIncomingEinvoicesResult(null);
                        setSelectedLogoInvoiceId('');
                        setLogoPreviewFormError(null);
                        void logoInvoicesMutation.mutateAsync(undefined).catch(() => undefined);
                      }}
                      disabled={logoInvoicesMutation.isPending}
                    >
                      {logoInvoicesMutation.isPending ? 'Discovering invoices...' : 'Discover Logo Invoices'}
                    </button>
                    <button
                      type="button"
                      className="button button-secondary button-compact"
                      onClick={() => {
                        setLogoLoginResult(null);
                        setLogoFirmsResult(null);
                        setLogoInvoicesResult(null);
                        setLogoIncomingEinvoicesResult(null);
                        setLogoInvoiceDetailResult(null);
                        setSelectedLogoInvoiceId('');
                        setLogoFirmMatchResult(null);
                        setLogoFirmBindResult(null);
                        setLogoPreviewResult(null);
                        setLogoPreviewFormError(null);
                        void logoIncomingEinvoicesMutation.mutateAsync(undefined).catch(() => undefined);
                      }}
                      disabled={logoIncomingEinvoicesMutation.isPending}
                    >
                      {logoIncomingEinvoicesMutation.isPending
                        ? 'Discovering incoming e-invoices...'
                        : 'Discover Incoming E-Invoices'}
                    </button>
                    <button
                      type="button"
                      className="button button-secondary button-compact"
                      onClick={() => {
                        setLogoLoginResult(null);
                        setLogoFirmsResult(null);
                        setLogoInvoicesResult(null);
                        setLogoIncomingEinvoicesResult(null);
                        setLogoInvoiceDetailResult(null);
                        setSelectedLogoInvoiceId('');
                        setLogoFirmMatchResult(null);
                        setLogoFirmBindResult(null);
                        setLogoPreviewResult(null);
                        setLogoPreviewFormError(null);
                        setLogoTestInvoiceResult(null);
                        void logoServicesMutation.mutateAsync(undefined).catch(() => undefined);
                      }}
                      disabled={logoServicesMutation.isPending}
                    >
                      {logoServicesMutation.isPending ? 'Discovering services...' : 'Discover Logo Services'}
                    </button>
                    <label className="vendor-profile-logo-pdf-input">
                      Invoice PDF UUID
                      <input
                        type="text"
                        value={logoInvoicePdfUuid}
                        onChange={(event) => setLogoInvoicePdfUuid(event.target.value)}
                        placeholder="45192DC9-88F7-4382-BD5F-90E6A7BB6264"
                      />
                    </label>
                    <button
                      type="button"
                      className="button button-secondary button-compact"
                      onClick={() => {
                        const uuid = logoInvoicePdfUuid.trim();
                        setLogoLoginResult(null);
                        setLogoFirmsResult(null);
                        setLogoInvoicesResult(null);
                        setLogoIncomingEinvoicesResult(null);
                        setLogoServicesResult(null);
                        setLogoInvoiceDetailResult(null);
                        setSelectedLogoInvoiceId('');
                        setLogoFirmMatchResult(null);
                        setLogoFirmBindResult(null);
                        setLogoPreviewResult(null);
                        setLogoPreviewFormError(null);
                        setLogoTestInvoiceResult(null);
                        if (!uuid) {
                          setLogoInvoicePdfResult({
                            ok: false,
                            success: false,
                            provider: 'LOGO_ISBASI',
                            mode: 'invoice_pdf_probe',
                            writesPerformed: false,
                            externalApiCallAttempted: false,
                            errorCode: 'LOGO_ISBASI_INVOICE_PDF_VALIDATION_FAILED',
                            message: 'uuid is required.',
                          });
                          return;
                        }
                        void logoInvoicePdfMutation.mutateAsync(uuid).catch(() => undefined);
                      }}
                      disabled={logoInvoicePdfMutation.isPending}
                    >
                      {logoInvoicePdfMutation.isPending ? 'Fetching Logo PDF...' : 'Fetch Logo Invoice PDF'}
                    </button>
                    <button
                      type="button"
                      className="button button-secondary button-compact"
                      onClick={() => {
                        setLogoLoginResult(null);
                        setLogoFirmsResult(null);
                        setLogoInvoicesResult(null);
                        setLogoIncomingEinvoicesResult(null);
                        setLogoInvoiceDetailResult(null);
                        setSelectedLogoInvoiceId('');
                        setLogoFirmBindResult(null);
                        setLogoPreviewResult(null);
                        setLogoPreviewFormError(null);
                        void logoFirmMatchMutation.mutateAsync(undefined).catch(() => undefined);
                      }}
                      disabled={logoFirmMatchMutation.isPending}
                    >
                      {logoFirmMatchMutation.isPending ? 'Matching firm...' : 'Match Vendor To Logo Firm'}
                    </button>
                    <button
                      type="button"
                      className="button button-secondary button-compact"
                      onClick={() => {
                        setLogoLoginResult(null);
                        setLogoFirmsResult(null);
                        setLogoInvoicesResult(null);
                        setLogoIncomingEinvoicesResult(null);
                        setLogoInvoiceDetailResult(null);
                        setSelectedLogoInvoiceId('');
                        setLogoFirmMatchResult(null);
                        setLogoPreviewResult(null);
                        setLogoPreviewFormError(null);
                        void logoFirmBindMutation.mutateAsync(undefined).catch(() => undefined);
                      }}
                      disabled={logoFirmBindMutation.isPending}
                    >
                      {logoFirmBindMutation.isPending
                        ? 'Binding Logo firm...'
                        : logoBindingPresent
                          ? 'Rebind Logo Firm'
                          : 'Bind Logo Firm'}
                    </button>
                    <button
                      type="button"
                      className="button button-secondary button-compact"
                      onClick={() => {
                        setLogoLoginResult(null);
                        setLogoFirmsResult(null);
                        setLogoInvoicesResult(null);
                        setLogoIncomingEinvoicesResult(null);
                        setLogoInvoiceDetailResult(null);
                        setSelectedLogoInvoiceId('');
                        setLogoFirmMatchResult(null);
                        setLogoFirmBindResult(null);
                        setLogoPreviewOpen((current) => !current);
                        setLogoPreviewFormError(null);
                      }}
                    >
                      Preview Commission e-Fatura
                    </button>
                    <label className="vendor-profile-logo-confirmation">
                      <input
                        type="checkbox"
                        checked={logoTestInvoiceConfirmed}
                        onChange={(event) => setLogoTestInvoiceConfirmed(event.target.checked)}
                      />
                      I understand this creates a test invoice.
                    </label>
                    <button
                      type="button"
                      className="button button-danger button-compact"
                      onClick={() => {
                        setLogoLoginResult(null);
                        setLogoFirmsResult(null);
                        setLogoInvoicesResult(null);
                        setLogoIncomingEinvoicesResult(null);
                        setLogoInvoiceDetailResult(null);
                        setSelectedLogoInvoiceId('');
                        setLogoFirmMatchResult(null);
                        setLogoFirmBindResult(null);
                        setLogoPreviewResult(null);
                        setLogoPreviewFormError(null);
                        void logoTestInvoiceMutation.mutateAsync(undefined).catch(() => undefined);
                      }}
                      disabled={!logoTestInvoiceConfirmed || logoTestInvoiceMutation.isPending}
                    >
                      {logoTestInvoiceMutation.isPending ? 'Creating TEST invoice...' : 'Create TEST Invoice'}
                    </button>
                  </div>
                  <p className="page-description">
                    This creates a real invoice in the Logo test tenant.
                  </p>
                </div>
              </div>
              {logoBindingPresent ? (
                <div className="vendor-profile-logo-result">
                  <span>Current Logo Binding</span>
                  <div className="vendor-profile-logo-result-grid">
                    <div>
                      <span>Binding status</span>
                      <strong>{logoBindingNeedsMatch ? 'Needs match/rebind' : 'Configured'}</strong>
                    </div>
                    <div>
                      <span>Customer Code</span>
                      <strong>{formatValue(billingProfile?.logoIsbasiCustomerCode)}</strong>
                    </div>
                    <div>
                      <span>Customer Id</span>
                      <strong>{formatValue(billingProfile?.logoIsbasiCustomerId)}</strong>
                    </div>
                    <div>
                      <span>Last Checked</span>
                      <strong>{formatValue(billingProfile?.logoIsbasiLastCheckedAt)}</strong>
                    </div>
                  </div>
                </div>
              ) : null}
              {logoLoginResult ? (
                <div className="vendor-profile-logo-result">
                  <span>Logo login diagnostics result</span>
                  <div className="vendor-profile-logo-result-grid">
                    <div>
                      <span>Status</span>
                      <strong>{logoLoginResult.ok ? 'Success' : 'Failed'}</strong>
                    </div>
                    <div>
                      <span>HTTP status</span>
                      <strong>{logoLoginResult.httpStatus ?? 'Not available'}</strong>
                    </div>
                    {logoLoginResult.errorCode ? (
                      <div>
                        <span>Backend error code</span>
                        <strong>{logoLoginResult.errorCode}</strong>
                      </div>
                    ) : null}
                    <div>
                      <span>Code</span>
                      <strong>{logoLoginResult.login?.code ?? 'Not returned'}</strong>
                    </div>
                    <div>
                      <span>Message</span>
                      <strong>{logoLoginResult.login?.message ?? logoLoginResult.message ?? 'Not returned'}</strong>
                    </div>
                    <div>
                      <span>accessTokenPresent</span>
                      <strong>{formatLogoBoolean(logoLoginResult.login?.accessTokenPresent)}</strong>
                    </div>
                    <div>
                      <span>tenantIdPresent</span>
                      <strong>{formatLogoBoolean(logoLoginResult.login?.tenantIdPresent)}</strong>
                    </div>
                    <div>
                      <span>userIdPresent</span>
                      <strong>{formatLogoBoolean(logoLoginResult.login?.userIdPresent)}</strong>
                    </div>
                    <div>
                      <span>userEmailPresent</span>
                      <strong>{formatLogoBoolean(logoLoginResult.login?.userEmailPresent)}</strong>
                    </div>
                    <div>
                      <span>userNamePresent</span>
                      <strong>{formatLogoBoolean(logoLoginResult.login?.userNamePresent)}</strong>
                    </div>
                    <div>
                      <span>responseKeys</span>
                      <strong>{logoLoginResult.login?.responseKeys?.join(', ') || 'Not returned'}</strong>
                    </div>
                    {logoLoginResult.missingEnv?.length ? (
                      <div>
                        <span>Missing env vars</span>
                        <strong>{logoLoginResult.missingEnv.join(', ')}</strong>
                      </div>
                    ) : null}
                    {logoLoginResult.missingSessionFields?.length ? (
                      <div>
                        <span>Missing session fields</span>
                        <strong>{logoLoginResult.missingSessionFields.join(', ')}</strong>
                      </div>
                    ) : null}
                    {logoLoginResult.login?.tokenPreview ? (
                      <div>
                        <span>tokenPreview</span>
                        <strong>{logoLoginResult.login.tokenPreview}</strong>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
              {logoFirmsResult ? (
                <div className="vendor-profile-logo-result">
                  <span>Logo firms discovery result</span>
                  <div className="vendor-profile-logo-result-grid">
                    <div>
                      <span>Status</span>
                      <strong>{logoFirmsResult.ok ? 'Success' : 'Failed'}</strong>
                    </div>
                    <div>
                      <span>HTTP status</span>
                      <strong>{logoFirmsResult.httpStatus ?? 'Not available'}</strong>
                    </div>
                    <div>
                      <span>Firm count</span>
                      <strong>{logoFirmsResult.count ?? 0}</strong>
                    </div>
                    {logoFirmsResult.errorCode ? (
                      <div>
                        <span>Backend error code</span>
                        <strong>{logoFirmsResult.errorCode}</strong>
                      </div>
                    ) : null}
                    {logoFirmsResult.message ? (
                      <div>
                        <span>Message</span>
                        <strong>{logoFirmsResult.message}</strong>
                      </div>
                    ) : null}
                    {logoFirmsResult.missingEnv?.length ? (
                      <div>
                        <span>Missing env vars</span>
                        <strong>{logoFirmsResult.missingEnv.join(', ')}</strong>
                      </div>
                    ) : null}
                  </div>
                  {logoFirmsResult.sampleFirms?.length ? (
                    <ul className="vendor-profile-logo-firm-list" aria-label="Logo firm samples">
                      {logoFirmsResult.sampleFirms.map((firm, index) => (
                        <li key={firm.id ?? firm.code ?? `${firm.name}-${index}`}>
                          <strong>{firm.name ?? 'Unnamed firm'}</strong>
                          <span>{formatLogoFirmSummary(firm)}</span>
                          <small>
                            e-Invoice {formatBoolean(firm.eInvoiceResponsible)}, e-Archive {formatBoolean(firm.eArchiveResponsible)}
                          </small>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
              {logoServicesResult ? (
                <div className="vendor-profile-logo-result">
                  <span>Logo services discovery result</span>
                  <div className="vendor-profile-logo-result-grid">
                    <div>
                      <span>Status</span>
                      <strong>{logoServicesResult.ok ? 'Success' : 'Failed'}</strong>
                    </div>
                    <div>
                      <span>HTTP status</span>
                      <strong>{logoServicesResult.httpStatus ?? 'Not available'}</strong>
                    </div>
                    <div>
                      <span>Service count</span>
                      <strong>{logoServicesResult.count ?? 0}</strong>
                    </div>
                    <div>
                      <span>responseKeys</span>
                      <strong>{logoServicesResult.responseKeys?.join(', ') || 'Not returned'}</strong>
                    </div>
                    {logoServicesResult.errorCode ? (
                      <div>
                        <span>Backend error code</span>
                        <strong>{logoServicesResult.errorCode}</strong>
                      </div>
                    ) : null}
                    {logoServicesResult.message ? (
                      <div>
                        <span>Message</span>
                        <strong>{logoServicesResult.message}</strong>
                      </div>
                    ) : null}
                    {logoServicesResult.missingEnv?.length ? (
                      <div>
                        <span>Missing env vars</span>
                        <strong>{logoServicesResult.missingEnv.join(', ')}</strong>
                      </div>
                    ) : null}
                  </div>
                  {logoServicesResult.sampleItems?.length ? (
                    <ul className="vendor-profile-logo-firm-list" aria-label="Logo service item samples">
                      {logoServicesResult.sampleItems.map((item, index) => (
                        <li key={item.id ?? item.code ?? `${item.name}-${index}`}>
                          <strong>{item.code ?? item.name ?? 'Unnamed service'}</strong>
                          <span>
                            {[
                              item.name,
                              item.type ? `type ${item.type}` : null,
                              item.vat ? `VAT ${item.vat}` : null,
                              item.unit ? `unit ${item.unit}` : null,
                            ].filter(Boolean).join(' / ') || 'No optional fields returned'}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
              {logoInvoicePdfResult ? (
                <div className="vendor-profile-logo-result">
                  <span>Logo invoice PDF probe result</span>
                  <div className="vendor-profile-logo-result-grid">
                    <div>
                      <span>Status</span>
                      <strong>{logoInvoicePdfResult.ok ? 'Success' : 'Failed'}</strong>
                    </div>
                    <div>
                      <span>HTTP status</span>
                      <strong>{logoInvoicePdfResult.httpStatus ?? 'Not available'}</strong>
                    </div>
                    <div>
                      <span>Content type</span>
                      <strong>{formatValue(logoInvoicePdfResult.contentType)}</strong>
                    </div>
                    <div>
                      <span>Content length</span>
                      <strong>{logoInvoicePdfResult.contentLength ?? 'Not available'}</strong>
                    </div>
                    <div>
                      <span>Body kind</span>
                      <strong>{logoInvoicePdfResult.bodyKind ?? 'Not available'}</strong>
                    </div>
                    <div>
                      <span>PDF detected</span>
                      <strong>{formatBoolean(logoInvoicePdfResult.pdfDetected)}</strong>
                    </div>
                    <div>
                      <span>First bytes preview</span>
                      <strong>{formatValue(logoInvoicePdfResult.firstBytesPreview)}</strong>
                    </div>
                    <div>
                      <span>Endpoint</span>
                      <strong>{formatValue(logoInvoicePdfResult.endpoint)}</strong>
                    </div>
                    {logoInvoicePdfResult.errorCode ? (
                      <div>
                        <span>Backend error code</span>
                        <strong>{logoInvoicePdfResult.errorCode}</strong>
                      </div>
                    ) : null}
                    {logoInvoicePdfResult.message ? (
                      <div>
                        <span>Message</span>
                        <strong>{logoInvoicePdfResult.message}</strong>
                      </div>
                    ) : null}
                    {logoInvoicePdfResult.missingEnv?.length ? (
                      <div>
                        <span>Missing env vars</span>
                        <strong>{logoInvoicePdfResult.missingEnv.join(', ')}</strong>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
              {logoInvoicesResult ? (
                <div className="vendor-profile-logo-result">
                  <span>Logo invoices discovery result</span>
                  <div className="vendor-profile-logo-result-grid">
                    <div>
                      <span>Status</span>
                      <strong>{logoInvoicesResult.ok ? 'Success' : 'Failed'}</strong>
                    </div>
                    <div>
                      <span>HTTP status</span>
                      <strong>{logoInvoicesResult.httpStatus ?? 'Not available'}</strong>
                    </div>
                    <div>
                      <span>Invoice count</span>
                      <strong>{logoInvoicesResult.count ?? 0}</strong>
                    </div>
                    {logoInvoicesResult.errorCode ? (
                      <div>
                        <span>Backend error code</span>
                        <strong>{logoInvoicesResult.errorCode}</strong>
                      </div>
                    ) : null}
                    {logoInvoicesResult.message ? (
                      <div>
                        <span>Message</span>
                        <strong>{logoInvoicesResult.message}</strong>
                      </div>
                    ) : null}
                    {logoInvoicesResult.missingEnv?.length ? (
                      <div>
                        <span>Missing env vars</span>
                        <strong>{logoInvoicesResult.missingEnv.join(', ')}</strong>
                      </div>
                    ) : null}
                    {logoInvoicesResult.request ? (
                      <>
                        <div>
                          <span>Logo endpoint URL</span>
                          <strong>{formatValue(logoInvoicesResult.request.url)}</strong>
                        </div>
                        <div>
                          <span>Request method</span>
                          <strong>{formatValue(logoInvoicesResult.request.method)}</strong>
                        </div>
                        <div>
                          <span>Request content type</span>
                          <strong>{formatValue(logoInvoicesResult.request.contentType)}</strong>
                        </div>
                        <div>
                          <span>Request accept</span>
                          <strong>{formatValue(logoInvoicesResult.request.accept)}</strong>
                        </div>
                        <div>
                          <span>Query parameters</span>
                          <strong>{logoInvoicesResult.request.queryParameters?.join(', ') || 'None'}</strong>
                        </div>
                      </>
                    ) : null}
                    {logoInvoicesResult.response ? (
                      <>
                        <div>
                          <span>Upstream response status</span>
                          <strong>{logoInvoicesResult.response.status}</strong>
                        </div>
                        <div>
                          <span>Upstream content type</span>
                          <strong>{formatValue(logoInvoicesResult.response.contentType)}</strong>
                        </div>
                      </>
                    ) : null}
                  </div>
                  {logoInvoicesResult.response?.bodySnippet ? (
                    <div className="vendor-profile-logo-match-card">
                      <span>Upstream response body snippet</span>
                      <pre>{logoInvoicesResult.response.bodySnippet}</pre>
                    </div>
                  ) : null}
                  {logoInvoicesResult.ok ? (
                    <p className="page-description">
                      Invoice list discovery succeeded. Detail endpoint is not confirmed yet.
                    </p>
                  ) : null}
                  {logoInvoicesResult.sampleInvoices?.length ? (
                    <>
                      <ul className="vendor-profile-logo-firm-list" aria-label="Logo invoice samples">
                        {logoInvoicesResult.sampleInvoices.map((invoice, index) => (
                          <li key={invoice.id ?? invoice.invoiceNumber ?? `${invoice.customerName}-${index}`}>
                            <strong>{invoice.invoiceNumber ?? invoice.id ?? 'Unnamed invoice'}</strong>
                            <span>{formatLogoInvoiceSummary(invoice)}</span>
                            <small>{invoice.customerName ?? 'Customer not returned'}</small>
                          </li>
                        ))}
                      </ul>
                      <div className="vendor-profile-logo-result-grid">
                        <label>
                          Logo invoice
                          <select
                            value={selectedLogoInvoiceId}
                            onChange={(event) => setSelectedLogoInvoiceId(event.target.value)}
                          >
                            <option value="">Select invoice</option>
                            {logoInvoicesResult.sampleInvoices
                              .filter((invoice) => invoice.id)
                              .map((invoice) => (
                                <option key={invoice.id!} value={invoice.id!}>
                                  {invoice.invoiceNumber ?? invoice.id}
                                </option>
                              ))}
                          </select>
                        </label>
                        <div>
                          <span>Invoice shape</span>
                          <button
                            type="button"
                            className="button button-secondary button-compact"
                            onClick={() => {
                              if (!selectedLogoInvoiceId) {
                                return;
                              }
                              void logoInvoiceDetailMutation.mutateAsync(selectedLogoInvoiceId).catch(() => undefined);
                            }}
                            disabled={!selectedLogoInvoiceId || logoInvoiceDetailMutation.isPending}
                          >
                            {logoInvoiceDetailMutation.isPending ? 'Inspecting invoice...' : 'Inspect Invoice Shape'}
                          </button>
                        </div>
                      </div>
                    </>
                  ) : null}
                </div>
              ) : null}
              {logoIncomingEinvoicesResult ? (
                <div className="vendor-profile-logo-result">
                  <span>Logo incoming e-invoices discovery result</span>
                  <div className="vendor-profile-logo-result-grid">
                    <div>
                      <span>Status</span>
                      <strong>{logoIncomingEinvoicesResult.ok ? 'Success' : 'Failed'}</strong>
                    </div>
                    <div>
                      <span>HTTP status</span>
                      <strong>{logoIncomingEinvoicesResult.httpStatus ?? 'Not available'}</strong>
                    </div>
                    <div>
                      <span>Invoice count</span>
                      <strong>{logoIncomingEinvoicesResult.count ?? 0}</strong>
                    </div>
                    <div>
                      <span>responseKeys</span>
                      <strong>{logoIncomingEinvoicesResult.responseKeys?.join(', ') || 'Not returned'}</strong>
                    </div>
                    {logoIncomingEinvoicesResult.errorCode ? (
                      <div>
                        <span>Backend error code</span>
                        <strong>{logoIncomingEinvoicesResult.errorCode}</strong>
                      </div>
                    ) : null}
                    {logoIncomingEinvoicesResult.message ? (
                      <div>
                        <span>Message</span>
                        <strong>{logoIncomingEinvoicesResult.message}</strong>
                      </div>
                    ) : null}
                    {logoIncomingEinvoicesResult.missingEnv?.length ? (
                      <div>
                        <span>Missing env vars</span>
                        <strong>{logoIncomingEinvoicesResult.missingEnv.join(', ')}</strong>
                      </div>
                    ) : null}
                    {logoIncomingEinvoicesResult.request ? (
                      <>
                        <div>
                          <span>Logo endpoint URL</span>
                          <strong>{formatValue(logoIncomingEinvoicesResult.request.url)}</strong>
                        </div>
                        <div>
                          <span>Request method</span>
                          <strong>{formatValue(logoIncomingEinvoicesResult.request.method)}</strong>
                        </div>
                        <div>
                          <span>Request content type</span>
                          <strong>{formatValue(logoIncomingEinvoicesResult.request.contentType)}</strong>
                        </div>
                        <div>
                          <span>Request accept</span>
                          <strong>{formatValue(logoIncomingEinvoicesResult.request.accept)}</strong>
                        </div>
                      </>
                    ) : null}
                    {logoIncomingEinvoicesResult.response ? (
                      <>
                        <div>
                          <span>Upstream response status</span>
                          <strong>{logoIncomingEinvoicesResult.response.status}</strong>
                        </div>
                        <div>
                          <span>Upstream content type</span>
                          <strong>{formatValue(logoIncomingEinvoicesResult.response.contentType)}</strong>
                        </div>
                      </>
                    ) : null}
                  </div>
                  {logoIncomingEinvoicesResult.response?.bodySnippet ? (
                    <div className="vendor-profile-logo-match-card">
                      <span>Upstream response body snippet</span>
                      <pre>{logoIncomingEinvoicesResult.response.bodySnippet}</pre>
                    </div>
                  ) : null}
                  {logoIncomingEinvoicesResult.sampleInvoices?.length ? (
                    <ul className="vendor-profile-logo-firm-list" aria-label="Logo incoming e-invoice samples">
                      {logoIncomingEinvoicesResult.sampleInvoices.map((invoice, index) => (
                        <li key={invoice.invoiceId ?? invoice.uuId ?? `${invoice.supplier}-${index}`}>
                          <strong>{invoice.supplier ?? invoice.invoiceId ?? 'Unnamed supplier'}</strong>
                          <span>{formatLogoIncomingEinvoiceSummary(invoice)}</span>
                          <small>
                            {[
                              invoice.typeDesc,
                              invoice.invoiceType,
                              invoice.eGovermentTypeDesc,
                            ].filter(Boolean).join(' / ') || 'Invoice metadata not returned'}
                          </small>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
              {logoInvoiceDetailResult ? (
                <div className="vendor-profile-logo-result">
                  <span>Logo invoice shape result</span>
                  <div className="vendor-profile-logo-result-grid">
                    <div>
                      <span>Status</span>
                      <strong>{logoInvoiceDetailResult.ok ? 'Success' : 'Failed'}</strong>
                    </div>
                    <div>
                      <span>HTTP status</span>
                      <strong>{logoInvoiceDetailResult.httpStatus ?? 'Not available'}</strong>
                    </div>
                    {logoInvoiceDetailResult.errorCode ? (
                      <div>
                        <span>Backend error code</span>
                        <strong>{logoInvoiceDetailResult.errorCode}</strong>
                      </div>
                    ) : null}
                    {logoInvoiceDetailResult.message ? (
                      <div>
                        <span>Message</span>
                        <strong>{logoInvoiceDetailResult.message}</strong>
                      </div>
                    ) : null}
                    {logoInvoiceDetailResult.request ? (
                      <>
                        <div>
                          <span>Logo endpoint URL</span>
                          <strong>{formatValue(logoInvoiceDetailResult.request.url)}</strong>
                        </div>
                        <div>
                          <span>Request method</span>
                          <strong>{formatValue(logoInvoiceDetailResult.request.method)}</strong>
                        </div>
                        <div>
                          <span>Request content type</span>
                          <strong>{formatValue(logoInvoiceDetailResult.request.contentType)}</strong>
                        </div>
                        <div>
                          <span>Request accept</span>
                          <strong>{formatValue(logoInvoiceDetailResult.request.accept)}</strong>
                        </div>
                        <div>
                          <span>Query parameters</span>
                          <strong>{logoInvoiceDetailResult.request.queryParameters?.join(', ') || 'None'}</strong>
                        </div>
                      </>
                    ) : null}
                    {logoInvoiceDetailResult.response ? (
                      <>
                        <div>
                          <span>Upstream response status</span>
                          <strong>{logoInvoiceDetailResult.response.status}</strong>
                        </div>
                        <div>
                          <span>Upstream content type</span>
                          <strong>{formatValue(logoInvoiceDetailResult.response.contentType)}</strong>
                        </div>
                      </>
                    ) : null}
                    <div>
                      <span>eGovernmentInvoice keys</span>
                      <strong>{logoInvoiceDetailResult.shape?.eGovernmentInvoiceKeys?.join(', ') || 'Not returned'}</strong>
                    </div>
                    <div>
                      <span>eArchivePortalInvoice keys</span>
                      <strong>{logoInvoiceDetailResult.shape?.eArchivePortalInvoiceKeys?.join(', ') || 'Not returned'}</strong>
                    </div>
                  </div>
                  {logoInvoiceDetailResult.response?.bodySnippet ? (
                    <div className="vendor-profile-logo-match-card">
                      <span>Upstream response body snippet</span>
                      <pre>{logoInvoiceDetailResult.response.bodySnippet}</pre>
                    </div>
                  ) : null}
                  <pre>{formatLogoProbeJson(logoInvoiceDetailResult)}</pre>
                </div>
              ) : null}
              {logoFirmMatchResult ? (
                <div className="vendor-profile-logo-result">
                  <span>Logo vendor firm match result</span>
                  <div className="vendor-profile-logo-result-grid">
                    <div>
                      <span>Status</span>
                      <strong>{logoFirmMatchResult.ok ? 'Success' : 'Failed'}</strong>
                    </div>
                    <div>
                      <span>Match status</span>
                      <strong>{logoFirmMatchResult.matchStatus ?? 'Not available'}</strong>
                    </div>
                    <div>
                      <span>Match method</span>
                      <strong>{logoFirmMatchResult.matchMethod ?? 'Not available'}</strong>
                    </div>
                    <div>
                      <span>Firm count</span>
                      <strong>{logoFirmMatchResult.count ?? 0}</strong>
                    </div>
                    {logoFirmMatchResult.errorCode ? (
                      <div>
                        <span>Backend error code</span>
                        <strong>{logoFirmMatchResult.errorCode}</strong>
                      </div>
                    ) : null}
                    {logoFirmMatchResult.message ? (
                      <div>
                        <span>Message</span>
                        <strong>{logoFirmMatchResult.message}</strong>
                      </div>
                    ) : null}
                    {logoFirmMatchResult.missingEnv?.length ? (
                      <div>
                        <span>Missing env vars</span>
                        <strong>{logoFirmMatchResult.missingEnv.join(', ')}</strong>
                      </div>
                    ) : null}
                  </div>
                  {logoFirmMatchResult.exactMatch ? (
                    <div className="vendor-profile-logo-match-card">
                      <span>Exact match</span>
                      <strong>{logoFirmMatchResult.exactMatch.name ?? 'Unnamed firm'}</strong>
                      <small>{formatLogoFirmSummary(logoFirmMatchResult.exactMatch)}</small>
                    </div>
                  ) : logoFirmMatchResult.possibleMatches?.length ? (
                    <ul className="vendor-profile-logo-firm-list" aria-label="Logo possible firm matches">
                      {logoFirmMatchResult.possibleMatches.map((firm, index) => (
                        <li key={firm.id ?? firm.code ?? `${firm.name}-${index}`}>
                          <strong>{firm.name ?? 'Unnamed firm'}</strong>
                          <span>{formatLogoFirmSummary(firm)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="page-description">No Logo firm match found for this vendor billing profile.</p>
                  )}
                  {logoFirmMatchResult.warnings?.length ? (
                    <p className="vendor-profile-billing-error" role="alert">{logoFirmMatchResult.warnings.join(', ')}</p>
                  ) : null}
                </div>
              ) : null}
              {logoFirmBindResult ? (
                <div className="vendor-profile-logo-result">
                  <span>Logo firm bind result</span>
                  <div className="vendor-profile-logo-result-grid">
                    <div>
                      <span>Status</span>
                      <strong>{logoFirmBindResult.ok ? 'Success' : 'Failed'}</strong>
                    </div>
                    <div>
                      <span>Match status</span>
                      <strong>{logoFirmBindResult.matchStatus ?? 'Not available'}</strong>
                    </div>
                    <div>
                      <span>Match method</span>
                      <strong>{logoFirmBindResult.matchMethod ?? 'Not available'}</strong>
                    </div>
                    <div>
                      <span>Previous binding</span>
                      <strong>{formatValue(logoFirmBindResult.previousBinding?.logoIsbasiCustomerCode)}</strong>
                    </div>
                    <div>
                      <span>New binding</span>
                      <strong>{formatValue(logoFirmBindResult.newBinding?.logoIsbasiCustomerCode ?? logoFirmBindResult.logoIsbasiCustomerCode)}</strong>
                    </div>
                    <div>
                      <span>Customer Id</span>
                      <strong>{formatValue(logoFirmBindResult.logoIsbasiCustomerId)}</strong>
                    </div>
                    <div>
                      <span>Last Checked</span>
                      <strong>{formatValue(logoFirmBindResult.logoIsbasiLastCheckedAt)}</strong>
                    </div>
                    {logoFirmBindResult.errorCode ? (
                      <div>
                        <span>Backend error code</span>
                        <strong>{logoFirmBindResult.errorCode}</strong>
                      </div>
                    ) : null}
                    {logoFirmBindResult.message ? (
                      <div>
                        <span>Message</span>
                        <strong>{logoFirmBindResult.message}</strong>
                      </div>
                    ) : null}
                  </div>
                  {logoFirmBindResult.matchedFirm ? (
                    <div className="vendor-profile-logo-match-card">
                      <span>Matched firm</span>
                      <strong>{logoFirmBindResult.matchedFirm.name ?? 'Unnamed firm'}</strong>
                      <small>
                        {[
                          logoFirmBindResult.matchedFirm.code ? `code ${logoFirmBindResult.matchedFirm.code}` : null,
                          logoFirmBindResult.matchedFirm.taxNumberMasked ? `tax ${logoFirmBindResult.matchedFirm.taxNumberMasked}` : null,
                        ].filter(Boolean).join(', ') || 'No optional fields returned'}
                      </small>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {logoTestInvoiceResult ? (
                <div className="vendor-profile-logo-result">
                  <span>Logo TEST invoice creation result</span>
                  <div className="vendor-profile-logo-result-grid">
                    <div>
                      <span>Status</span>
                      <strong>{logoTestInvoiceResult.ok ? 'Success' : 'Failed'}</strong>
                    </div>
                    <div>
                      <span>HTTP status</span>
                      <strong>{logoTestInvoiceResult.httpStatus ?? 'Not available'}</strong>
                    </div>
                    <div>
                      <span>Upstream status</span>
                      <strong>{logoTestInvoiceResult.upstreamStatus ?? 'Not available'}</strong>
                    </div>
                    <div>
                      <span>writesPerformed</span>
                      <strong>{formatBoolean(logoTestInvoiceResult.writesPerformed)}</strong>
                    </div>
                    <div>
                      <span>invoiceId</span>
                      <strong>{formatValue(logoTestInvoiceResult.invoiceId)}</strong>
                    </div>
                    <div>
                      <span>uuid</span>
                      <strong>{formatValue(logoTestInvoiceResult.uuid)}</strong>
                    </div>
                    <div>
                      <span>ettn</span>
                      <strong>{formatValue(logoTestInvoiceResult.ettn)}</strong>
                    </div>
                    <div>
                      <span>responseKeys</span>
                      <strong>{logoTestInvoiceResult.responseKeys?.join(', ') || 'Not returned'}</strong>
                    </div>
                    {logoTestInvoiceResult.errorCode ? (
                      <div>
                        <span>Backend error code</span>
                        <strong>{logoTestInvoiceResult.errorCode}</strong>
                      </div>
                    ) : null}
                    {logoTestInvoiceResult.message ? (
                      <div>
                        <span>Message</span>
                        <strong>{logoTestInvoiceResult.message}</strong>
                      </div>
                    ) : null}
                    {logoTestInvoiceResult.missingEnv?.length ? (
                      <div>
                        <span>Missing env vars</span>
                        <strong>{logoTestInvoiceResult.missingEnv.join(', ')}</strong>
                      </div>
                    ) : null}
                    {logoTestInvoiceResult.missingFields?.length ? (
                      <div>
                        <span>Missing fields</span>
                        <strong>{logoTestInvoiceResult.missingFields.join(', ')}</strong>
                      </div>
                    ) : null}
                  </div>
                  {logoTestInvoiceResult.requestPayload ? (
                    <div className="vendor-profile-logo-match-card">
                      <span>Sanitized request payload used</span>
                      <pre>{JSON.stringify(logoTestInvoiceResult.requestPayload, null, 2)}</pre>
                    </div>
                  ) : null}
                  {logoTestInvoiceResult.responseBody ? (
                    <div className="vendor-profile-logo-match-card">
                      <span>Sanitized upstream response body</span>
                      <pre>{JSON.stringify(logoTestInvoiceResult.responseBody, null, 2)}</pre>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {logoPreviewOpen ? (
                <form className="vendor-profile-billing-form" onSubmit={handleLogoCommissionPreviewSubmit} noValidate>
                  <div className="vendor-profile-billing-form-heading">
                    <div>
                      <h3>Commission e-Fatura dry-run preview</h3>
                      <p>Builds a sanitized Logo İşbaşı payload only. It does not create or send an invoice.</p>
                    </div>
                    <StatusBadge tone="warning">Dry-run only</StatusBadge>
                  </div>
                  <div className="vendor-profile-billing-form-grid">
                    <label>
                      Commission amount
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={logoPreviewForm.commissionAmount}
                        onChange={(event) => handleLogoPreviewFormChange('commissionAmount', event.target.value)}
                        required
                      />
                    </label>
                    <label>
                      VAT rate
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        value={logoPreviewForm.vatRate}
                        onChange={(event) => handleLogoPreviewFormChange('vatRate', event.target.value)}
                        required
                      />
                    </label>
                    <label>
                      Currency
                      <input
                        type="text"
                        value={logoPreviewForm.currency}
                        onChange={(event) => handleLogoPreviewFormChange('currency', event.target.value)}
                        required
                      />
                    </label>
                    <label>
                      Source period
                      <input
                        type="text"
                        value={logoPreviewForm.sourcePeriod}
                        onChange={(event) => handleLogoPreviewFormChange('sourcePeriod', event.target.value)}
                        placeholder="Optional"
                      />
                    </label>
                    <label className="vendor-profile-billing-form-wide">
                      Description
                      <textarea
                        value={logoPreviewForm.description}
                        onChange={(event) => handleLogoPreviewFormChange('description', event.target.value)}
                        required
                        rows={3}
                      />
                    </label>
                  </div>
                  {logoPreviewFormError ? <p className="vendor-profile-billing-error" role="alert">{logoPreviewFormError}</p> : null}
                  <OperationalActionGroup>
                    <button type="submit" className="button button-primary" disabled={logoPreviewMutation.isPending}>
                      {logoPreviewMutation.isPending ? 'Generating preview...' : 'Generate preview'}
                    </button>
                    <button
                      type="button"
                      className="button button-secondary"
                      onClick={() => {
                        setLogoPreviewOpen(false);
                        setLogoPreviewFormError(null);
                      }}
                      disabled={logoPreviewMutation.isPending}
                    >
                      Cancel
                    </button>
                  </OperationalActionGroup>
                </form>
              ) : null}
              {logoPreviewResult ? (
                <div className="vendor-profile-logo-result">
                  <span>Commission e-Fatura sanitized preview</span>
                  <pre>{formatLogoProbeJson(logoPreviewResult)}</pre>
                </div>
              ) : null}
              {billingEditOpen ? (
                <form className="vendor-profile-billing-form" onSubmit={handleBillingProfileSubmit} noValidate>
                  <div className="vendor-profile-billing-form-heading">
                    <div>
                      <h3>Billing / Legal Profile edit</h3>
                      <p>Required fields are used for future Sporgym commission invoices.</p>
                    </div>
                    <StatusBadge tone="info">Admin edit</StatusBadge>
                  </div>
                  <div className="vendor-profile-billing-form-grid">
                    <label>
                      Legal company name
                      <input
                        type="text"
                        value={billingForm.legalCompanyName}
                        onChange={(event) => handleBillingFormChange('legalCompanyName', event.target.value)}
                        required
                      />
                    </label>
                    <label>
                      Tax number / TCKN
                      <input
                        type="text"
                        value={billingForm.taxNumber}
                        onChange={(event) => handleBillingFormChange('taxNumber', event.target.value)}
                        required
                      />
                    </label>
                    <label>
                      Tax office
                      <input
                        type="text"
                        value={billingForm.taxOffice}
                        onChange={(event) => handleBillingFormChange('taxOffice', event.target.value)}
                        required
                      />
                    </label>
                    <label>
                      Billing email
                      <input
                        type="email"
                        value={billingForm.billingEmail}
                        onChange={(event) => handleBillingFormChange('billingEmail', event.target.value)}
                        required
                      />
                    </label>
                    <label>
                      Billing city
                      <input
                        type="text"
                        value={billingForm.billingCity}
                        onChange={(event) => handleBillingFormChange('billingCity', event.target.value)}
                        required
                      />
                    </label>
                    <label>
                      Billing district
                      <input
                        type="text"
                        value={billingForm.billingDistrict}
                        onChange={(event) => handleBillingFormChange('billingDistrict', event.target.value)}
                        required
                      />
                    </label>
                    <label>
                      Authorized person
                      <input
                        type="text"
                        value={billingForm.authorizedPerson}
                        onChange={(event) => handleBillingFormChange('authorizedPerson', event.target.value)}
                      />
                    </label>
                    <label>
                      Billing phone
                      <input
                        type="tel"
                        value={billingForm.billingPhone}
                        onChange={(event) => handleBillingFormChange('billingPhone', event.target.value)}
                      />
                    </label>
                    <label>
                      IBAN
                      <input
                        type="text"
                        value={billingForm.iban}
                        onChange={(event) => handleBillingFormChange('iban', event.target.value)}
                      />
                    </label>
                    <label>
                      Legal entity type
                      <input
                        type="text"
                        value={billingForm.legalEntityType}
                        onChange={(event) => handleBillingFormChange('legalEntityType', event.target.value)}
                      />
                    </label>
                    <label>
                      Logo İşbaşı customer code
                      <input
                        type="text"
                        value={billingForm.logoIsbasiCustomerCode}
                        onChange={(event) => handleBillingFormChange('logoIsbasiCustomerCode', event.target.value)}
                      />
                    </label>
                    <label className="vendor-profile-billing-form-wide">
                      Billing address
                      <textarea
                        value={billingForm.billingAddress}
                        onChange={(event) => handleBillingFormChange('billingAddress', event.target.value)}
                        required
                        rows={3}
                      />
                    </label>
                  </div>
                  {billingFormError ? <p className="vendor-profile-billing-error" role="alert">{billingFormError}</p> : null}
                  <OperationalActionGroup>
                    <button type="submit" className="button button-primary" disabled={billingMutation.isPending}>
                      {billingMutation.isPending ? 'Saving billing profile...' : 'Save billing profile'}
                    </button>
                    <button
                      type="button"
                      className="button button-secondary"
                      onClick={handleCancelBillingEdit}
                      disabled={billingMutation.isPending}
                    >
                      Cancel
                    </button>
                  </OperationalActionGroup>
                </form>
              ) : null}
            </>
          )}
        </OperationalSection>

        <OperationalSection
          title="Marketplace terms"
          description="Read-only commercial profile used for operational visibility. This does not implement payout execution."
        >
          {financeQuery.isError && !financeProfile ? (
            <SectionErrorRetry
              title="Marketplace terms unavailable"
              description={financeQuery.error ?? 'Unable to load the vendor commercial profile.'}
              onRetry={() => void financeQuery.refetch()}
            />
          ) : financeQuery.isInitialLoading || !financeProfile ? (
            <SectionSkeleton title="Loading marketplace terms" description="Fetching the current vendor finance profile." />
          ) : (
            <MetadataGroup>
              <MetadataRow label="Commission" value={`${financeProfile.commissionPercent}%`} />
              <MetadataRow label="Commission VAT" value={`${financeProfile.commissionVatPercent}%`} />
              <MetadataRow label="Shipping deduction" value={formatShippingMode(financeProfile.shippingMode)} />
              <MetadataRow label="Fixed shipping fee" value={formatValue(financeProfile.fixedShippingFee)} />
              <MetadataRow label="Managed by" value={formatSource(financeProfile.source)} />
              <MetadataRow label="Terms active" value={formatBoolean(financeProfile.active)} />
            </MetadataGroup>
          )}
        </OperationalSection>

        <OperationalSection
          title="Shipping operations"
          description="Admin-owned shipping setup used by shipment creation and recovery workflows."
        >
          {shippingQuery.isError && !shippingConfig ? (
            <SectionErrorRetry
              title="Shipping setup unavailable"
              description={shippingQuery.error ?? 'Unable to load the vendor shipping configuration.'}
              onRetry={() => void shippingQuery.refetch()}
            />
          ) : shippingQuery.isInitialLoading || !shippingConfig ? (
            <SectionSkeleton title="Loading shipping setup" description="Fetching provider and warehouse configuration." />
          ) : (
            <MetadataGroup>
              <MetadataRow label="Preferred provider" value={formatValue(formatShippingProviderName(shippingConfig.preferredProvider))} />
              <MetadataRow label="Shipping enabled" value={formatBoolean(shippingConfig.shippingEnabled)} />
              <MetadataRow label="Managed by" value={formatSource(shippingConfig.source)} />
              <MetadataRow label="Default desi" value={shippingConfig.defaultDesi} />
              <MetadataRow label="Cargo integration ID" value={formatValue(shippingConfig.cargoIntegrationId)} />
              <MetadataRow label="Default warehouse ID" value={formatValue(shippingConfig.defaultWarehouseId)} />
              <MetadataRow label="Shipping VAT" value={`${shippingConfig.shippingVatPercent}%`} />
              <MetadataRow label="Provider configuration status" value={metadataConfigured(shippingConfig) ? 'Configured' : 'Not configured'} />
            </MetadataGroup>
          )}
        </OperationalSection>

        <OperationalSection
          title="Integration status"
          description="Marketplace systems connected to this seller workspace."
        >
          <div className="vendor-profile-integration-list">
            <div>
              <span>Shopify workspace</span>
              <StatusBadge tone={appReadiness.ready ? 'success' : 'warning'}>{appReadiness.ready ? 'Connected' : 'Loading'}</StatusBadge>
            </div>
            <div>
              <span>Shipping provider</span>
              <StatusBadge tone={shippingConfigured ? 'success' : 'warning'}>
                {shippingConfigured ? formatShippingProviderName(shippingConfig?.preferredProvider) : 'Not configured'}
              </StatusBadge>
            </div>
            <div>
              <span>Return workflow</span>
              <StatusBadge tone={returnsConfigured ? 'success' : 'warning'}>{returnsConfigured ? 'Configured' : 'Needs destination'}</StatusBadge>
            </div>
            <div>
              <span>Provider configuration status</span>
              <StatusBadge tone={metadataConfigured(shippingConfig) ? 'success' : 'neutral'}>
                {metadataConfigured(shippingConfig) ? 'Configured' : 'Not configured'}
              </StatusBadge>
            </div>
          </div>
        </OperationalSection>

        <OperationalSection
          title="Warehouse and returns"
          description="Address-book destinations visible to the seller as read-only operational truth."
        >
          {shippingQuery.isError && !shippingConfig ? (
            <SectionErrorRetry
              title="Warehouse setup unavailable"
              description={shippingQuery.error ?? 'Unable to load warehouse and return destination metadata.'}
              onRetry={() => void shippingQuery.refetch()}
            />
          ) : shippingQuery.isInitialLoading || !shippingConfig ? (
            <SectionSkeleton title="Loading warehouse setup" description="Fetching branch and return destination metadata." />
          ) : (
            <>
              <MetadataGroup title="Default warehouse">
                <MetadataRow label="Name" value={formatValue(defaultWarehouse?.name)} />
                <MetadataRow label="Provider" value={formatValue(formatShippingProviderName(defaultWarehouse?.provider))} />
                <MetadataRow label="Warehouse ID" value={formatValue(defaultWarehouse?.warehouseId)} />
                <MetadataRow label="Default" value={formatBoolean(defaultWarehouse?.isDefault)} />
                <MetadataRow label="Address summary" value={formatValue(defaultWarehouse?.address)} />
              </MetadataGroup>
              <MetadataGroup title="Marketplace warehouse destinations">
                <MetadataRow
                  label="Forward warehouse"
                  value={<LocationValue id={navlungoSenderAddressId} location={forwardWarehouseLocation} />}
                />
                <MetadataRow
                  label="Return destination"
                  value={<LocationValue id={navlungoReturnRecipientAddressId} location={returnDestinationLocation} />}
                />
              </MetadataGroup>
            </>
          )}
        </OperationalSection>
      </div>

      <OperationalSection
        title="Support and correction workflow"
        description="Vendors request corrections through support; admin-owned settings stay locked on this page."
      >
        <div className="vendor-profile-support-panel">
          <div>
            <strong>{existingProfileTicket ? 'A correction ticket is already open.' : 'Need a correction?'}</strong>
            <p>
              {existingProfileTicket
                ? `${existingProfileTicket.subject} is ${safeStatusLabel(existingProfileTicket.status).toLowerCase()}.`
                : 'Report a marketplace profile or configuration issue so operations can review the admin-owned data.'}
            </p>
          </div>
          <OperationalActionGroup>
            <button
              type="button"
              className="button button-secondary"
              onClick={handleContactSupport}
              disabled={!appReadiness.ready || supportQuery.isInitialLoading || supportMutation.isPending}
            >
              {existingProfileTicket ? 'Open correction ticket' : 'Report configuration issue'}
            </button>
          </OperationalActionGroup>
        </div>
      </OperationalSection>

      <OperationalSection
        title="Additional seller profile fields"
        description="Compact reference for profile data that is intentionally not inferred until the model is confirmed."
      >
        <details className="vendor-profile-disclosure">
          <summary>
            <span>Fields not modeled yet</span>
            <small>Open for data-model notes</small>
          </summary>
          <ul className="vendor-profile-missing-list">
            <li>Legal entity name, tax office, and tax identity</li>
            <li>Dedicated store operations contact email and phone</li>
            <li>Seller-of-record / commercial authority status</li>
            <li>Public marketplace storefront profile content</li>
            <li>Full provider address-book detail sync beyond configured IDs and safe metadata</li>
          </ul>
        </details>
      </OperationalSection>

      {isAdmin ? (
        <OperationalSection
          title="Admin note"
          description="This foundation intentionally avoids a broad editor. Use existing order/shipping or finance admin controls for supported configuration changes."
        >
          <StatusBadge tone="info">Admin-owned configuration</StatusBadge>
        </OperationalSection>
      ) : null}

      {message ? <ActionFeedback tone={tone} message={message} /> : null}
    </section>
  );
}
