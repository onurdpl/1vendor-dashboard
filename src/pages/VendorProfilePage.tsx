import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ActionFeedback } from '../components/ActionFeedback';
import {
  EmptyStatePanel,
  MetadataGroup,
  MetadataRow,
  OperationalActionGroup,
  OperationalSection,
  SectionErrorRetry,
  SectionSkeleton,
  StatusBadge,
} from '../components/OperationalPrimitives';
import { VendorShippingConfigEditor } from '../components/VendorShippingConfigEditor';
import { useMutationAction } from '../hooks/useMutationAction';
import { useQueryResource } from '../hooks/useQueryResource';
import { getFinanceProfile, updateVendorFinancialProfile } from '../features/finance/api';
import { getVendorShippingConfig } from '../features/orders/api';
import { createSupportTicket, listAdminSupportTickets, listVendorSupportTickets } from '../features/support/api';
import {
  bindVendorLogoIsbasiFirm,
  discoverLogoIsbasiFirms,
  discoverLogoIsbasiIncomingEinvoices,
  discoverLogoIsbasiInvoices,
  discoverLogoIsbasiServices,
  fetchLogoIsbasiInvoicePdf,
  getVendorStatus,
  getVendorBillingProfile,
  inspectLogoIsbasiInvoice,
  listVendorProfileAuditLogs,
  matchVendorLogoIsbasiFirm,
  previewLogoIsbasiCommissionInvoice,
  probeLogoIsbasiLogin,
  updateVendorBillingProfile,
  updateVendorStatus,
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
  SupportTicket,
  VendorBillingProfile,
  VendorBillingProfileInput,
  VendorFinancialProfile,
  VendorProfileAuditLog,
  VendorStatus,
  VendorStatusInput,
  VendorIntegrationProviderSummary,
  VendorIntegrationScope,
  VendorIntegrationTokenCreateResult,
  VendorShippingConfig,
} from '../lib/api/contracts';
import { useAppReadiness } from '../lib/appReadiness';
import { getPageReadinessState } from '../lib/pageReadiness';
import { formatShippingProviderName } from '../lib/shippingDisplay';
import type { VendorContext } from '../lib/auth';
import { useActionFeedback } from '../lib/ui';
import { runtimeServices } from '../services/runtime-services';
import { safeArray, safeStatusLabel } from '../services/real/formatting';

const VENDOR_PROFILE_CONTEXT_ROUTE = 'vendor_profile_settings';
const VENDOR_PROFILE_PATH = '/vendor/profile';
const OPEN_SUPPORT_STATUSES = new Set(['OPEN', 'IN_REVIEW', 'WAITING_FOR_VENDOR']);
const VENDOR_STATUS_REASONS = [
  'Missing documentation',
  'Operational review',
  'Finance review',
  'Compliance review',
  'Other',
] as const;
const VENDOR_INTEGRATION_SCOPE_OPTIONS: Array<{ value: VendorIntegrationScope; label: string }> = [
  { value: 'orders:read', label: 'Read orders' },
  { value: 'status:write', label: 'Write status updates' },
  { value: 'shipment:write', label: 'Write shipment updates' },
  { value: 'invoice:write', label: 'Write invoice updates' },
];
const DEFAULT_VENDOR_INTEGRATION_SCOPES: VendorIntegrationScope[] =
  VENDOR_INTEGRATION_SCOPE_OPTIONS.map((scope) => scope.value);
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
type IntegrationTokenFormState = {
  providerName: string;
  scopes: VendorIntegrationScope[];
};
const EMPTY_INTEGRATION_TOKEN_FORM: IntegrationTokenFormState = {
  providerName: '',
  scopes: DEFAULT_VENDOR_INTEGRATION_SCOPES,
};

function formatValue(value: string | null | undefined, fallback = 'Not configured') {
  return value && value.trim() ? value.trim() : fallback;
}

function formatAuditDate(value: string | null | undefined) {
  if (!value) {
    return 'No recorded changes';
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString();
}

function getSortTimestamp(value: string | null | undefined) {
  if (!value) {
    return 0;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function formatIntegrationTokenError(error: unknown) {
  if (error instanceof Error && error.message.trim() && !/tokenHash|stack|spg_vi_/i.test(error.message)) {
    return error.message.trim();
  }
  return 'Integration token could not be created. Please retry.';
}

function normalizeIntegrationScopes(scopes: string[]): VendorIntegrationScope[] {
  const allowed = new Set<VendorIntegrationScope>(DEFAULT_VENDOR_INTEGRATION_SCOPES);
  return scopes.filter((scope): scope is VendorIntegrationScope => allowed.has(scope as VendorIntegrationScope));
}

function getProviderTokenStatus(provider: VendorIntegrationProviderSummary | null) {
  if (!provider) {
    return {
      label: 'No token created',
      tone: 'warning' as const,
    };
  }
  if (!provider.enabled || provider.revokedAt) {
    return {
      label: 'Revoked',
      tone: 'neutral' as const,
    };
  }
  return {
    label: 'Active',
    tone: 'success' as const,
  };
}

function formatAuditDisplayValue(value: unknown) {
  if (value === null || value === undefined) {
    return 'Not configured';
  }
  if (typeof value === 'string') {
    return value.trim() || 'Not configured';
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
}

function formatAuditSection(value: string) {
  switch (value) {
    case 'finance_policy':
      return 'Finance Policy';
    case 'billing_legal_profile':
      return 'Billing / Legal Profile';
    case 'logo_binding':
      return 'Logo Binding';
    case 'shipping_operations':
      return 'Shipping Operations';
    default:
      return value;
  }
}

function formatSnapshotImpact(value: string | null | undefined) {
  switch (value) {
    case 'FUTURE_LEDGER_ROWS_ONLY':
      return 'Future ledger rows only';
    case 'FUTURE_SETTLEMENT_APPROVALS_ONLY':
      return 'Future settlement approvals only';
    case 'FUTURE_COMMISSION_INVOICES_ONLY':
      return 'Future commission invoices only';
    case 'FUTURE_SHIPMENTS_ONLY':
      return 'Future shipments only';
    case 'FUTURE_RETURNS_ONLY':
      return 'Future returns only';
    case 'FUTURE_SHIPMENTS_AND_RETURNS_ONLY':
      return 'Future shipments and returns only';
    case 'EXISTING_SETTLEMENTS_UNCHANGED':
      return 'Existing settlements unchanged';
    case 'PROVIDER_REBIND_REQUIRED':
      return 'Provider rebind required';
    case 'FUTURE_PAYOUT_RELEVANT':
      return 'Future payout relevant';
    case 'DIAGNOSTIC_ONLY':
      return 'Diagnostic only';
    case 'UNKNOWN':
      return 'Unknown impact';
    default:
      return 'No audit impact recorded';
  }
}

function auditImpactTone(value: string | null | undefined): 'success' | 'warning' | 'info' | 'attention' | 'neutral' {
  if (value === 'PROVIDER_REBIND_REQUIRED' || value === 'UNKNOWN') {
    return 'warning';
  }
  if (value === 'FUTURE_PAYOUT_RELEVANT') {
    return 'attention';
  }
  if (value) {
    return 'info';
  }
  return 'neutral';
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

type FinancePolicyFormState = {
  commissionPercent: string;
  commissionVatPercent: string;
  deductShippingEnabled: boolean;
  shippingMode: VendorFinancialProfile['shippingMode'];
  fixedShippingFee: string;
  settlementDelayDays: string;
  settlementFrequencyType: VendorFinancialProfile['settlementFrequencyType'];
  weeklySettlementDay: VendorFinancialProfile['weeklySettlementDay'];
  autoSettlementDraftEnabled: boolean;
  autoSettlementApproveEnabled: boolean;
  autoSettlementInvoiceEnabled: boolean;
};

type LogoCommissionPreviewFormState = {
  commissionAmount: string;
  vatRate: string;
  currency: string;
  description: string;
  sourcePeriod: string;
};

type VendorStatusFormState = {
  status: VendorStatusInput['status'];
  reason: string;
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

const EMPTY_FINANCE_POLICY_FORM: FinancePolicyFormState = {
  commissionPercent: '',
  commissionVatPercent: '',
  deductShippingEnabled: false,
  shippingMode: 'disabled',
  fixedShippingFee: '',
  settlementDelayDays: '21',
  settlementFrequencyType: 'WEEKLY',
  weeklySettlementDay: 'WEDNESDAY',
  autoSettlementDraftEnabled: false,
  autoSettlementApproveEnabled: false,
  autoSettlementInvoiceEnabled: false,
};

const DEFAULT_LOGO_COMMISSION_PREVIEW_FORM: LogoCommissionPreviewFormState = {
  commissionAmount: '',
  vatRate: '20',
  currency: 'TL',
  description: 'Pazaryeri komisyon hizmet bedeli',
  sourcePeriod: '',
};

const DEFAULT_VENDOR_STATUS_FORM: VendorStatusFormState = {
  status: 'active',
  reason: '',
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

function buildFinancePolicyFormState(profile: VendorFinancialProfile | null): FinancePolicyFormState {
  return {
    commissionPercent: profile?.commissionPercent ?? '',
    commissionVatPercent: profile?.commissionVatPercent ?? '',
    deductShippingEnabled: profile?.deductShippingEnabled ?? false,
    shippingMode: profile?.shippingMode ?? 'disabled',
    fixedShippingFee: profile?.fixedShippingFee ?? '',
    settlementDelayDays: String(profile?.settlementDelayDays ?? 21),
    settlementFrequencyType: profile?.settlementFrequencyType ?? 'WEEKLY',
    weeklySettlementDay: profile?.weeklySettlementDay ?? 'WEDNESDAY',
    autoSettlementDraftEnabled: profile?.autoSettlementDraftEnabled ?? false,
    autoSettlementApproveEnabled: profile?.autoSettlementApproveEnabled ?? false,
    autoSettlementInvoiceEnabled: profile?.autoSettlementInvoiceEnabled ?? false,
  };
}

function parseFinancePolicyPercent(value: string, label: string) {
  const numeric = Number(value);
  if (!value.trim() || !Number.isFinite(numeric) || numeric < 0 || numeric > 100) {
    return {
      ok: false as const,
      message: `${label} must be between 0 and 100.`,
    };
  }
  return {
    ok: true as const,
    value: Math.round(numeric * 100) / 100,
  };
}

function buildFinancePolicyInput(form: FinancePolicyFormState) {
  const fixedShippingFee = form.fixedShippingFee.trim() ? Number(form.fixedShippingFee) : null;
  return {
    commissionPercent: Number(form.commissionPercent),
    commissionVatPercent: Number(form.commissionVatPercent),
    deductShippingEnabled: form.deductShippingEnabled,
    shippingMode: form.shippingMode,
    fixedShippingFee,
    settlementDelayDays: Number(form.settlementDelayDays),
    settlementFrequencyType: form.settlementFrequencyType,
    weeklySettlementDay: form.weeklySettlementDay,
    autoSettlementDraftEnabled: form.autoSettlementDraftEnabled,
    autoSettlementApproveEnabled: form.autoSettlementApproveEnabled,
    autoSettlementInvoiceEnabled: form.autoSettlementInvoiceEnabled,
  };
}

function validateFinancePolicyForm(form: FinancePolicyFormState) {
  const commissionPercent = parseFinancePolicyPercent(form.commissionPercent, 'Commission %');
  if (!commissionPercent.ok) {
    return commissionPercent.message;
  }

  const commissionVatPercent = parseFinancePolicyPercent(form.commissionVatPercent, 'Commission VAT %');
  if (!commissionVatPercent.ok) {
    return commissionVatPercent.message;
  }

  if (form.fixedShippingFee.trim()) {
    const fixedShippingFee = Number(form.fixedShippingFee);
    if (!Number.isFinite(fixedShippingFee) || fixedShippingFee < 0) {
      return 'Fixed shipping fee must be zero or greater.';
    }
  }

  const settlementDelayDays = Number(form.settlementDelayDays);
  if (
    !form.settlementDelayDays.trim() ||
    !Number.isFinite(settlementDelayDays) ||
    settlementDelayDays < 0 ||
    settlementDelayDays > 365
  ) {
    return 'Settlement delay days must be between 0 and 365.';
  }

  return null;
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
    | LogoIsbasiInvoiceDetailProbeResult,
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

function formatSettlementFrequency(value: VendorFinancialProfile['settlementFrequencyType'] | null | undefined) {
  if (value === 'BIWEEKLY') {
    return 'Biweekly';
  }
  return 'Weekly';
}

function formatSettlementWeekday(value: VendorFinancialProfile['weeklySettlementDay'] | null | undefined) {
  const normalized = value?.toLowerCase().replace('_', ' ') ?? '';
  return normalized ? normalized.replace(/^\w/, (letter) => letter.toUpperCase()) : 'Wednesday';
}

function formatSettlementSchedule(profile: VendorFinancialProfile) {
  return `${formatSettlementFrequency(profile.settlementFrequencyType)} on ${formatSettlementWeekday(profile.weeklySettlementDay)}`;
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

function VendorProfileAuditMetadata({
  title,
  log,
  onViewChanges,
}: {
  title: string;
  log: VendorProfileAuditLog | null;
  onViewChanges: () => void;
}) {
  return (
    <div className="vendor-profile-audit-metadata" aria-label={`${title} change metadata`}>
      <div>
        <span>{title}</span>
        <strong>{formatAuditDate(log?.changedAt)}</strong>
        <small>Changed by {log?.changedByEmail ?? 'Not recorded'}</small>
      </div>
      <div>
        <span>Impact</span>
        <StatusBadge tone={auditImpactTone(log?.snapshotImpact)}>
          {formatSnapshotImpact(log?.snapshotImpact)}
        </StatusBadge>
      </div>
      <button type="button" className="button button-secondary button-compact" onClick={onViewChanges}>
        View changes
      </button>
    </div>
  );
}

function VendorProfileAuditHistory({
  logs,
  isLoading,
  isError,
  error,
  onRetry,
}: {
  logs: VendorProfileAuditLog[];
  isLoading: boolean;
  isError: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  if (isError) {
    return (
      <SectionErrorRetry
        title="Configuration history unavailable"
        description={error ?? 'Unable to load vendor profile audit logs.'}
        onRetry={onRetry}
      />
    );
  }

  if (isLoading) {
    return <SectionSkeleton title="Loading configuration history" description="Fetching immutable vendor profile audit logs." />;
  }

  if (!logs.length) {
    return (
      <div className="vendor-profile-audit-empty">
        <strong>No profile changes recorded yet.</strong>
        <p>Future admin edits will appear here as immutable audit events.</p>
      </div>
    );
  }

  return (
    <ul className="vendor-profile-audit-history" aria-label="Vendor configuration history">
      {logs.map((log) => (
        <li key={log.id}>
          <div className="vendor-profile-audit-history-heading">
            <div>
              <strong>{formatAuditSection(log.section)} · {log.fieldName}</strong>
              <span>{formatAuditDate(log.changedAt)} · {log.changedByEmail ?? 'Actor not recorded'}</span>
            </div>
            <StatusBadge tone={auditImpactTone(log.snapshotImpact)}>{formatSnapshotImpact(log.snapshotImpact)}</StatusBadge>
          </div>
          <div className="vendor-profile-audit-diff">
            <span>Old: {formatAuditDisplayValue(log.oldValue)}</span>
            <span>New: {formatAuditDisplayValue(log.newValue)}</span>
          </div>
          <small>
            Source: {log.source}
            {log.reason ? ` · Reason: ${log.reason}` : ''}
          </small>
        </li>
      ))}
    </ul>
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
  const { vendorId: adminRouteVendorIdParam } = useParams<{ vendorId?: string }>();
  const auditHistoryRef = useRef<HTMLElement | null>(null);
  const appReadiness = useAppReadiness();
  const currentUser = appReadiness.currentUser;
  const adminRouteVendorId = adminRouteVendorIdParam?.trim() ?? '';
  const isAdminVendorRoute = Boolean(adminRouteVendorId);
  const currentVendor = useMemo<VendorContext>(() => {
    if (!isAdminVendorRoute) {
      return appReadiness.currentVendor;
    }

    const knownVendor = currentUser?.vendorDetails?.find((vendor) => vendor.vendorId === adminRouteVendorId);
    return {
      vendorId: adminRouteVendorId,
      vendorName: knownVendor?.vendorName ?? adminRouteVendorId,
      scope: 'admin-route-vendor-context',
      status: knownVendor?.status ?? 'active',
      restrictionReason: knownVendor?.restrictionReason ?? null,
      restrictionChangedByUserId: knownVendor?.restrictionChangedByUserId ?? null,
      restrictionChangedByEmail: knownVendor?.restrictionChangedByEmail ?? null,
      restrictionChangedAt: knownVendor?.restrictionChangedAt ?? null,
    };
  }, [adminRouteVendorId, appReadiness.currentVendor, currentUser?.vendorDetails, isAdminVendorRoute]);
  const pageReadiness = getPageReadinessState(appReadiness, {
    requiresVendorContext: !isAdminVendorRoute,
    currentVendorId: currentVendor.vendorId,
  });
  const isAdmin = currentUser?.role === 'admin';
  const canLoadProfile = pageReadiness.ready && (!isAdminVendorRoute || isAdmin);
  const { message, tone, showFeedback } = useActionFeedback();
  const [billingEditOpen, setBillingEditOpen] = useState(false);
  const [billingForm, setBillingForm] = useState<BillingProfileFormState>(EMPTY_BILLING_PROFILE_FORM);
  const [billingFormError, setBillingFormError] = useState<string | null>(null);
  const [savedBillingProfile, setSavedBillingProfile] = useState<VendorBillingProfile | null>(null);
  const [financePolicyEditOpen, setFinancePolicyEditOpen] = useState(false);
  const [financePolicyForm, setFinancePolicyForm] = useState<FinancePolicyFormState>(EMPTY_FINANCE_POLICY_FORM);
  const [financePolicyFormError, setFinancePolicyFormError] = useState<string | null>(null);
  const [savedFinanceProfile, setSavedFinanceProfile] = useState<VendorFinancialProfile | null>(null);
  const [vendorStatusForm, setVendorStatusForm] = useState<VendorStatusFormState>(DEFAULT_VENDOR_STATUS_FORM);
  const [vendorStatusFormError, setVendorStatusFormError] = useState<string | null>(null);
  const [savedVendorStatus, setSavedVendorStatus] = useState<VendorStatus | null>(null);
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
  const [integrationTokenForm, setIntegrationTokenForm] =
    useState<IntegrationTokenFormState>(EMPTY_INTEGRATION_TOKEN_FORM);
  const [integrationTokenFormError, setIntegrationTokenFormError] = useState<string | null>(null);
  const [createdIntegrationToken, setCreatedIntegrationToken] = useState<VendorIntegrationTokenCreateResult | null>(null);
  const [integrationTokenCopyStatus, setIntegrationTokenCopyStatus] = useState<string | null>(null);

  const shippingQuery = useQueryResource(
    queryKeys.vendorProfile.shippingConfig(currentVendor.vendorId),
    ({ signal }) => getVendorShippingConfig({ vendorId: currentVendor.vendorId, signal }),
    { enabled: canLoadProfile },
  );
  const financeQuery = useQueryResource(
    queryKeys.vendorProfile.financeProfile(currentVendor.vendorId),
    ({ signal }) => getFinanceProfile({ vendorId: currentVendor.vendorId, signal }),
    { enabled: canLoadProfile },
  );
  const billingQuery = useQueryResource(
    queryKeys.vendorProfile.billingProfile(currentVendor.vendorId),
    ({ signal }) => getVendorBillingProfile(currentVendor.vendorId, { signal }),
    { enabled: canLoadProfile && isAdmin },
  );
  const vendorStatusQuery = useQueryResource(
    queryKeys.vendorProfile.status(currentVendor.vendorId),
    ({ signal }) => getVendorStatus(currentVendor.vendorId, { signal }),
    { enabled: canLoadProfile && isAdmin },
  );
  const auditLogQuery = useQueryResource(
    queryKeys.vendorProfile.auditLogs(currentVendor.vendorId),
    ({ signal }) => listVendorProfileAuditLogs(currentVendor.vendorId, { signal, limit: 50 }),
    { enabled: canLoadProfile && isAdmin },
  );
  const supportQuery = useQueryResource(
    queryKeys.vendorProfile.supportTickets(currentVendor.vendorId),
    ({ signal }) => (isAdmin ? listAdminSupportTickets({ signal }) : listVendorSupportTickets({ signal })),
    { enabled: canLoadProfile },
  );
  const integrationProvidersQuery = useQueryResource(
    queryKeys.admin.vendorIntegration.providers(),
    ({ signal }) => runtimeServices.vendorIntegration.providers({ signal }),
    { enabled: canLoadProfile && isAdminVendorRoute && isAdmin },
  );

  const shippingConfig = shippingQuery.data;
  const financeProfile = savedFinanceProfile?.vendorId === currentVendor.vendorId ? savedFinanceProfile : financeQuery.data ?? null;
  const billingProfile = savedBillingProfile?.vendorId === currentVendor.vendorId ? savedBillingProfile : billingQuery.data ?? null;
  const vendorStatus = savedVendorStatus?.vendorId === currentVendor.vendorId
    ? savedVendorStatus
    : vendorStatusQuery.data ?? {
        vendorId: currentVendor.vendorId,
        vendorName: currentVendor.vendorName,
        status: currentVendor.status ?? 'active',
        restricted: String(currentVendor.status ?? 'active').toLowerCase() !== 'active',
        restrictionReason: currentVendor.restrictionReason ?? null,
        changedByUserId: currentVendor.restrictionChangedByUserId ?? null,
        changedByEmail: currentVendor.restrictionChangedByEmail ?? null,
        changedAt: currentVendor.restrictionChangedAt ?? null,
      };
  const profileVendorName = formatValue(
    vendorStatus.vendorName ?? currentVendor.vendorName,
    currentVendor.vendorId || 'Vendor profile',
  );
  const logoBindingPresent = Boolean(billingProfile?.logoIsbasiCustomerCode || billingProfile?.logoIsbasiCustomerId);
  const logoBindingNeedsMatch = Boolean(billingProfile?.logoIsbasiCustomerCode?.trim() && !billingProfile?.logoIsbasiCustomerId?.trim());
  const supportTickets = useMemo(
    () => safeArray(supportQuery.data).filter((ticket) => ticket.vendorId === currentVendor.vendorId),
    [currentVendor.vendorId, supportQuery.data],
  );
  const profileAuditLogs = useMemo(() => safeArray<VendorProfileAuditLog>(auditLogQuery.data), [auditLogQuery.data]);
  const integrationProviders = useMemo(() => {
    return safeArray<VendorIntegrationProviderSummary>(integrationProvidersQuery.data?.providers)
      .filter((provider) => provider.vendorIdentifier === currentVendor.vendorId)
      .sort((left, right) => getSortTimestamp(right.createdAt) - getSortTimestamp(left.createdAt));
  }, [currentVendor.vendorId, integrationProvidersQuery.data?.providers]);
  const latestIntegrationProvider = integrationProviders[0] ?? null;
  const activeIntegrationProvider = integrationProviders.find((provider) => provider.enabled && !provider.revokedAt) ?? null;
  const displayedIntegrationProvider = activeIntegrationProvider ?? latestIntegrationProvider;
  const integrationTokenStatus = getProviderTokenStatus(displayedIntegrationProvider);
  const latestAuditBySection = useMemo(() => {
    const bySection = new Map<string, VendorProfileAuditLog>();
    for (const log of profileAuditLogs) {
      if (!bySection.has(log.section)) {
        bySection.set(log.section, log);
      }
    }
    return bySection;
  }, [profileAuditLogs]);

  useEffect(() => {
    setVendorStatusForm({
      status: String(vendorStatus.status ?? 'active').toLowerCase() === 'active' ? 'active' : 'inactive',
      reason: vendorStatus.restricted ? vendorStatus.restrictionReason ?? '' : '',
    });
    setVendorStatusFormError(null);
  }, [currentVendor.vendorId, vendorStatus.restricted, vendorStatus.restrictionReason, vendorStatus.status]);
  useEffect(() => {
    setIntegrationTokenForm(EMPTY_INTEGRATION_TOKEN_FORM);
    setIntegrationTokenFormError(null);
    setCreatedIntegrationToken(null);
    setIntegrationTokenCopyStatus(null);
  }, [currentVendor.vendorId]);
  const latestBillingAudit = latestAuditBySection.get('billing_legal_profile') ?? null;
  const latestLogoBindingAudit = latestAuditBySection.get('logo_binding') ?? null;
  const latestFinanceAudit = latestAuditBySection.get('finance_policy') ?? null;
  const latestShippingAudit = latestAuditBySection.get('shipping_operations') ?? null;
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
  const supportWorkflowReady = Boolean(canLoadProfile && supportDataLoaded && !supportQuery.isError);
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
        status: canLoadProfile ? 'ready' : 'unknown',
        detail: canLoadProfile ? 'Return queues are available for this vendor context.' : 'Vendor route context is still loading.',
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
            ? 'Finance policy is active for estimate visibility.'
            : 'Finance policy requires verification before treating finance visibility as ready.'
          : 'Settlement visibility cannot be inferred without the finance profile.',
      },
    ];
    const supportItems: ReadinessItem[] = [
      {
        label: 'Support route accessible',
        status: canLoadProfile ? 'ready' : 'unknown',
        detail: canLoadProfile ? 'Support routes are available in this workspace.' : 'Vendor access context is still loading.',
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
        status: canLoadProfile && currentVendor.vendorId ? 'ready' : 'unknown',
        detail: canLoadProfile ? 'This workspace is scoped to the selected vendor.' : 'Vendor access is not ready yet.',
      },
      {
        label: 'Workflow queues',
        status: canLoadProfile ? 'ready' : 'unknown',
        detail: canLoadProfile ? 'Orders, returns, finance, and support routes can open with this vendor scope.' : 'Workflow routes are waiting for vendor context.',
      },
    ];
    const automationItems: ReadinessItem[] = [
      {
        label: 'Automation queue accessible',
        status: canLoadProfile ? 'review' : 'unknown',
        detail: canLoadProfile
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
    canLoadProfile,
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
        message: `Please review the vendor profile and operational settings for ${profileVendorName}.`,
        priority: 'normal',
        category: 'OTHER',
        contextType: 'general',
        contextId: currentVendor.vendorId,
        contextSnapshot: {
          route: VENDOR_PROFILE_CONTEXT_ROUTE,
          path: isAdminVendorRoute ? `/admin/vendors/${encodeURIComponent(currentVendor.vendorId)}` : VENDOR_PROFILE_PATH,
          status: 'correction_requested',
          vendorId: currentVendor.vendorId,
          vendorName: profileVendorName,
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
        void queryClient.invalidateQueries({ queryKey: queryKeys.vendorProfile.auditLogs(currentVendor.vendorId) });
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

  const financePolicyMutation = useMutationAction(
    (input: ReturnType<typeof buildFinancePolicyInput>) => updateVendorFinancialProfile(currentVendor.vendorId, input),
    {
      onSuccess: async (savedProfile) => {
        queryClient.setQueryData(queryKeys.vendorProfile.financeProfile(currentVendor.vendorId), savedProfile);
        setSavedFinanceProfile(savedProfile);
        void queryClient.invalidateQueries({ queryKey: queryKeys.vendorProfile.auditLogs(currentVendor.vendorId) });
        setFinancePolicyEditOpen(false);
        setFinancePolicyFormError(null);
        setFinancePolicyForm(buildFinancePolicyFormState(savedProfile));
        showFeedback('Finance policy saved for future ledger rows.', 'success');
      },
      onError: (error) => {
        setFinancePolicyFormError(error instanceof Error ? error.message : 'Unable to save finance policy.');
      },
    },
  );

  const vendorStatusMutation = useMutationAction(
    (input: VendorStatusInput) => updateVendorStatus(currentVendor.vendorId, input),
    {
      onSuccess: async (savedStatus) => {
        queryClient.setQueryData(queryKeys.vendorProfile.status(currentVendor.vendorId), savedStatus);
        setSavedVendorStatus(savedStatus);
        setVendorStatusForm({
          status: savedStatus.restricted ? 'inactive' : 'active',
          reason: savedStatus.restricted ? savedStatus.restrictionReason ?? '' : '',
        });
        setVendorStatusFormError(null);
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.vendorProfile.auditLogs(currentVendor.vendorId) }),
          queryClient.invalidateQueries({ queryKey: queryKeys.vendorProfile.status(currentVendor.vendorId) }),
        ]);
        showFeedback(
          savedStatus.restricted ? 'Vendor account restricted.' : 'Vendor account activated.',
          'success',
        );
      },
      onError: (error) => {
        setVendorStatusFormError(error instanceof Error ? error.message : 'Unable to save vendor status.');
      },
    },
  );

  const integrationTokenMutation = useMutationAction(
    () =>
      runtimeServices.vendorIntegration.createToken({
        vendorIdentifier: currentVendor.vendorId,
        providerName: integrationTokenForm.providerName.trim(),
        scopes: integrationTokenForm.scopes,
      }),
    {
      onSuccess: async (result) => {
        setCreatedIntegrationToken(result);
        setIntegrationTokenCopyStatus(null);
        setIntegrationTokenFormError(null);
        setIntegrationTokenForm({
          providerName: result.providerName,
          scopes: normalizeIntegrationScopes(result.scopes),
        });
        await queryClient.invalidateQueries({ queryKey: queryKeys.admin.vendorIntegration.providers() });
        showFeedback('Integration token created.', 'success');
      },
      onError: (error) => {
        setCreatedIntegrationToken(null);
        setIntegrationTokenCopyStatus(null);
        setIntegrationTokenFormError(formatIntegrationTokenError(error));
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
        void queryClient.invalidateQueries({ queryKey: queryKeys.vendorProfile.auditLogs(currentVendor.vendorId) });
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
        setLogoPreviewFormError(error instanceof Error ? error.message : 'Commission e-Fatura preview failed.');
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

  function handleViewProfileChanges() {
    auditHistoryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function handleIntegrationTokenProviderNameChange(value: string) {
    setIntegrationTokenForm((current) => ({ ...current, providerName: value }));
    if (integrationTokenFormError) {
      setIntegrationTokenFormError(null);
    }
  }

  function handleIntegrationTokenScopeChange(scope: VendorIntegrationScope, checked: boolean) {
    setIntegrationTokenForm((current) => {
      const scopes = checked
        ? Array.from(new Set([...current.scopes, scope]))
        : current.scopes.filter((item) => item !== scope);
      return { ...current, scopes };
    });
    if (integrationTokenFormError) {
      setIntegrationTokenFormError(null);
    }
  }

  function handleIntegrationTokenSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!integrationTokenForm.providerName.trim()) {
      setIntegrationTokenFormError('Provider name is required.');
      return;
    }
    if (integrationTokenForm.scopes.length === 0) {
      setIntegrationTokenFormError('Select at least one integration scope.');
      return;
    }
    setCreatedIntegrationToken(null);
    setIntegrationTokenCopyStatus(null);
    void integrationTokenMutation.mutateAsync(undefined).catch(() => undefined);
  }

  async function handleCopyCreatedIntegrationToken() {
    if (!createdIntegrationToken?.token) {
      return;
    }
    try {
      await navigator.clipboard.writeText(createdIntegrationToken.token);
      setIntegrationTokenCopyStatus('Token copied.');
    } catch {
      setIntegrationTokenCopyStatus('Copy unavailable. Select the token manually.');
    }
  }

  function handleDoneCreatedIntegrationToken() {
    setCreatedIntegrationToken(null);
    setIntegrationTokenCopyStatus(null);
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

  function handleOpenFinancePolicyEdit() {
    setFinancePolicyForm(buildFinancePolicyFormState(financeProfile));
    setFinancePolicyFormError(null);
    setFinancePolicyEditOpen(true);
  }

  function handleCancelFinancePolicyEdit() {
    setFinancePolicyForm(buildFinancePolicyFormState(financeProfile));
    setFinancePolicyFormError(null);
    setFinancePolicyEditOpen(false);
    financePolicyMutation.reset();
  }

  function handleFinancePolicyFormChange<Field extends keyof FinancePolicyFormState>(
    field: Field,
    value: FinancePolicyFormState[Field],
  ) {
    setFinancePolicyForm((current) => ({ ...current, [field]: value }));
    if (financePolicyFormError) {
      setFinancePolicyFormError(null);
    }
  }

  function handleFinancePolicySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validationError = validateFinancePolicyForm(financePolicyForm);
    if (validationError) {
      setFinancePolicyFormError(validationError);
      return;
    }
    void financePolicyMutation.mutateAsync(buildFinancePolicyInput(financePolicyForm));
  }

  function handleVendorStatusFormChange<Field extends keyof VendorStatusFormState>(
    field: Field,
    value: VendorStatusFormState[Field],
  ) {
    setVendorStatusForm((current) => {
      if (field === 'status' && value === 'active') {
        return { ...current, status: 'active', reason: '' };
      }

      return { ...current, [field]: value };
    });
    if (vendorStatusFormError) {
      setVendorStatusFormError(null);
    }
  }

  function handleVendorStatusSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reason = vendorStatusForm.reason.trim();
    if (vendorStatusForm.status !== 'active' && !reason) {
      setVendorStatusFormError('Status reason is required.');
      return;
    }

    void vendorStatusMutation.mutateAsync(
      vendorStatusForm.status === 'active'
        ? { status: 'active' }
        : { status: vendorStatusForm.status, reason },
    );
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

  if (isAdminVendorRoute && !isAdmin) {
    return (
      <section className="op-page vendor-profile-page">
        <EmptyStatePanel
          title="Admin access required"
          description="This vendor profile route is available only to admin users."
        />
      </section>
    );
  }

  if (pageReadiness.status === 'missing_vendor_context') {
    return (
      <section className="op-page vendor-profile-page">
        <EmptyStatePanel
          title="Select vendor"
          description="No vendor context available. Choose a vendor context before loading vendor profile settings."
        />
      </section>
    );
  }

  if (pageReadiness.status === 'waiting_vendor_context') {
    return (
      <section className="op-page vendor-profile-page">
        <EmptyStatePanel
          title="Waiting for vendor context"
          description="Vendor profile settings will load after the authenticated vendor scope is ready."
        />
      </section>
    );
  }

  if (pageReadiness.status === 'unauthorized') {
    return (
      <section className="op-page vendor-profile-page">
        <EmptyStatePanel title="Sign in required" description="Sign in before loading vendor profile settings." />
      </section>
    );
  }

  const accountStatusLabel = vendorStatus.restricted ? 'Restricted' : 'Active';
  const restrictionStatusLabel = vendorStatus.restricted
    ? formatValue(vendorStatus.restrictionReason, 'Unknown')
    : null;
  const correctionTicketStatusLabel = existingProfileTicket ? 'Correction ticket open' : 'No correction ticket open';
  const managedSettings = [
    {
      title: 'Shipping',
      description: 'Managed by Marketplace',
      status: !shippingDataLoaded ? 'Loading' : shippingConfigured ? 'Configured' : 'Needs review',
      tone: shippingDataLoaded && shippingConfigured ? 'success' : 'warning',
    },
    {
      title: 'Returns',
      description: 'Managed by Marketplace',
      status: !shippingDataLoaded ? 'Loading' : returnsConfigured ? 'Configured' : 'Needs review',
      tone: shippingDataLoaded && returnsConfigured ? 'success' : 'warning',
    },
    {
      title: 'Finance Policy',
      description: 'Managed by Marketplace',
      status: !financeDataLoaded ? 'Loading' : marketplaceTermsActive ? 'Configured' : 'Needs review',
      tone: financeDataLoaded && marketplaceTermsActive ? 'success' : 'warning',
    },
    {
      title: 'Warehouse',
      description: 'Managed by Marketplace',
      status: !shippingDataLoaded ? 'Loading' : warehouseConfigured ? 'Configured' : 'Needs review',
      tone: shippingDataLoaded && warehouseConfigured ? 'success' : 'warning',
    },
    {
      title: 'Billing',
      description: 'Managed by Marketplace',
      status: 'Managed',
      tone: 'info',
    },
    {
      title: 'Integrations',
      description: 'Managed by Marketplace',
      status: canLoadProfile ? 'Available' : 'Loading',
      tone: canLoadProfile ? 'success' : 'warning',
    },
  ] as const;

  return (
    <section className="op-page vendor-profile-page">
      <div className={`vendor-profile-hero operational-card ${isAdmin ? '' : 'vendor-profile-hero-compact'}`}>
        <div className="vendor-profile-identity">
          <div className="vendor-profile-avatar" aria-hidden="true">
            {getVendorInitials(profileVendorName)}
          </div>
          <div>
            <p className="eyebrow">Marketplace Seller Workspace</p>
            <h1>{profileVendorName || 'Vendor profile'}</h1>
            {isAdmin ? (
              <p>
                Review the seller identity, finance policy, shipping operations, and return destination currently managed
                for this store. Marketplace-owned fields are read-only here.
              </p>
            ) : null}
          </div>
        </div>
        <div className="vendor-profile-actions">
          <StatusBadge tone={isAdmin ? 'info' : 'neutral'}>{isAdmin ? 'Admin view' : 'Read-only vendor view'}</StatusBadge>
          <StatusBadge tone={!canLoadProfile ? 'warning' : vendorStatus.restricted ? 'attention' : 'success'}>
            {!canLoadProfile ? 'Context loading' : vendorStatus.restricted ? 'Restricted account' : 'Active workspace'}
          </StatusBadge>
          {existingProfileTicket ? <StatusBadge tone="attention">Correction ticket open</StatusBadge> : null}
          {isAdmin ? (
            <button
              type="button"
              className="button button-secondary"
              onClick={handleContactSupport}
              disabled={!pageReadiness.ready || supportQuery.isInitialLoading || supportMutation.isPending}
            >
              {existingProfileTicket
                ? 'Open correction ticket'
                : supportMutation.isPending
                  ? 'Requesting correction...'
                  : 'Request profile correction'}
            </button>
          ) : null}
        </div>
      </div>

      {!isAdmin ? (
        <>
          <OperationalSection title="My Account">
            <MetadataGroup>
              <MetadataRow label="Display name" value={formatValue(profileVendorName, 'Vendor unavailable')} />
              <MetadataRow label="Signed-in email" value={currentUser?.email ?? 'Unknown'} />
              <MetadataRow label="Vendor ID" value={formatValue(currentVendor.vendorId, 'Missing vendor context')} />
              <MetadataRow label="Account Status" value={accountStatusLabel} />
              {restrictionStatusLabel ? <MetadataRow label="Restriction Status" value={restrictionStatusLabel} /> : null}
              <MetadataRow label="Correction Ticket Status" value={correctionTicketStatusLabel} />
            </MetadataGroup>
          </OperationalSection>

          <OperationalSection title="Marketplace Managed Settings">
            <div className="vendor-managed-settings">
              <p className="vendor-managed-settings-notice">
                These settings are managed by the Marketplace. If something needs to change, open a correction ticket.
              </p>
              <div className="vendor-managed-settings-list">
                {managedSettings.map((setting) => (
                  <div className="vendor-managed-settings-row" key={setting.title}>
                    <div>
                      <strong>{setting.title}</strong>
                      <span>{setting.description}</span>
                    </div>
                    <StatusBadge tone={setting.tone}>{setting.status}</StatusBadge>
                  </div>
                ))}
              </div>
            </div>
          </OperationalSection>

          <OperationalSection title="Request Changes">
            <div className="vendor-profile-support-panel">
              <div>
                <strong>{existingProfileTicket ? 'Correction ticket open' : 'Open correction ticket'}</strong>
                <p>
                  {existingProfileTicket
                    ? `${existingProfileTicket.subject} is ${safeStatusLabel(existingProfileTicket.status).toLowerCase()}.`
                    : 'Request Marketplace support to review account or managed setting changes.'}
                </p>
              </div>
              <OperationalActionGroup>
                <button
                  type="button"
                  className={existingProfileTicket ? 'button button-secondary' : 'button button-primary'}
                  onClick={handleContactSupport}
                  disabled={!pageReadiness.ready || supportQuery.isInitialLoading || supportMutation.isPending}
                >
                  {supportMutation.isPending ? 'Opening correction ticket...' : 'Open correction ticket'}
                </button>
              </OperationalActionGroup>
            </div>
          </OperationalSection>
        </>
      ) : (
        <>
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
            <MetadataRow label="Display name" value={formatValue(profileVendorName, 'Vendor unavailable')} />
            <MetadataRow label="Vendor ID" value={formatValue(currentVendor.vendorId, 'Missing vendor context')} />
            <MetadataRow label="Legal name" value={isAdmin ? formatValue(billingProfile?.legalCompanyName) : 'Admin-managed billing profile'} />
            <MetadataRow label="Store contact" value="Not modeled yet" />
            <MetadataRow label="Signed-in user" value={currentUser?.email ?? 'Unknown'} />
            <MetadataRow label="Seller of record" value="Not configured" />
          </MetadataGroup>
        </OperationalSection>

        {isAdmin ? (
          <OperationalSection
            title="Vendor account status"
            description="Control whether this vendor can perform operational actions. Restricted vendors can still sign in, view their data, and contact support."
          >
            {vendorStatusQuery.isError ? (
              <SectionErrorRetry
                title="Vendor status unavailable"
                description={vendorStatusQuery.error ?? 'Unable to load the vendor account status.'}
                onRetry={() => void vendorStatusQuery.refetch()}
              />
            ) : vendorStatusQuery.isInitialLoading ? (
              <SectionSkeleton title="Loading vendor status" description="Fetching account restriction state." />
            ) : (
              <>
                <MetadataGroup>
                  <MetadataRow label="Status" value={vendorStatus.restricted ? 'Restricted' : 'Active'} />
                  <MetadataRow
                    label="Reason"
                    value={vendorStatus.restricted ? formatValue(vendorStatus.restrictionReason, 'Unknown') : 'Not restricted'}
                  />
                  <MetadataRow
                    label="Changed by"
                    value={
                      vendorStatus.restricted
                        ? formatValue(vendorStatus.changedByEmail ?? vendorStatus.changedByUserId, 'Unknown')
                        : formatValue(vendorStatus.changedByEmail ?? vendorStatus.changedByUserId, 'No recorded change')
                    }
                  />
                  <MetadataRow label="Changed at" value={vendorStatus.restricted ? vendorStatus.changedAt ? formatAuditDate(vendorStatus.changedAt) : 'Unknown' : formatAuditDate(vendorStatus.changedAt)} />
                </MetadataGroup>
                <form className="op-form-grid" onSubmit={handleVendorStatusSubmit}>
                  <label>
                    <span>Status</span>
                    <select
                      value={vendorStatusForm.status}
                      onChange={(event) =>
                        handleVendorStatusFormChange(
                          'status',
                          event.target.value === 'active' ? 'active' : 'inactive',
                        )
                      }
                    >
                      <option value="active">Active</option>
                      <option value="inactive">Restricted</option>
                    </select>
                  </label>
                  <label>
                    <span>Status reason</span>
                    <select
                      value={vendorStatusForm.reason}
                      onChange={(event) => handleVendorStatusFormChange('reason', event.target.value)}
                      disabled={vendorStatusForm.status === 'active'}
                    >
                      <option value="">Select a reason</option>
                      {VENDOR_STATUS_REASONS.map((reason) => (
                        <option key={reason} value={reason}>
                          {reason}
                        </option>
                      ))}
                    </select>
                  </label>
                  {vendorStatusFormError ? (
                    <p className="action-feedback action-error" role="alert">
                      {vendorStatusFormError}
                    </p>
                  ) : null}
                  <OperationalActionGroup>
                    <button
                      type="submit"
                      className="button button-primary"
                      disabled={vendorStatusMutation.isPending}
                    >
                      {vendorStatusMutation.isPending ? 'Saving vendor status...' : 'Save vendor status'}
                    </button>
                  </OperationalActionGroup>
                </form>
              </>
            )}
          </OperationalSection>
        ) : null}

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
              <VendorProfileAuditMetadata
                title="Billing / Legal Profile last changed"
                log={latestBillingAudit}
                onViewChanges={handleViewProfileChanges}
              />
              <VendorProfileAuditMetadata
                title="Logo Binding last changed"
                log={latestLogoBindingAudit}
                onViewChanges={handleViewProfileChanges}
              />
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
              </div>
              <details className="vendor-profile-disclosure vendor-profile-logo-diagnostics">
                <summary>
                  <span>Logo diagnostics</span>
                  <small>Collapsed provider probes and test-only tools</small>
                </summary>
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
                </div>
                <p className="page-description">
                  This section contains read-only Logo probes. Settlement invoices are created only from the Settlement Workspace flow.
                </p>
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
                      <span>responseKeys</span>
                      <strong>{logoInvoicePdfResult.responseKeys?.join(', ') || 'Not returned'}</strong>
                    </div>
                    <div>
                      <span>dataType</span>
                      <strong>{logoInvoicePdfResult.dataType ?? 'Not returned'}</strong>
                    </div>
                    <div>
                      <span>dataLength</span>
                      <strong>{logoInvoicePdfResult.dataLength ?? 'Not returned'}</strong>
                    </div>
                    <div>
                      <span>jsonCode</span>
                      <strong>{logoInvoicePdfResult.jsonCode ?? 'Not returned'}</strong>
                    </div>
                    <div>
                      <span>jsonIsError</span>
                      <strong>{formatBoolean(logoInvoicePdfResult.jsonIsError)}</strong>
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
              </details>
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
          title="Finance Policy"
          description="Admin-owned policy used for future finance ledger rows. It does not change existing ledger snapshots, approved settlements, invoices, or payouts."
        >
          {financeQuery.isError && !financeProfile ? (
            <SectionErrorRetry
              title="Finance policy unavailable"
              description={financeQuery.error ?? 'Unable to load the vendor commercial profile.'}
              onRetry={() => void financeQuery.refetch()}
            />
          ) : financeQuery.isInitialLoading || !financeProfile ? (
            <SectionSkeleton title="Loading finance policy" description="Fetching the current vendor finance profile." />
          ) : (
            <>
              <p className="page-description">
                Finance policy applies to future ledger rows only. Existing ledger rows and approved settlements keep their saved snapshots.
              </p>
              <MetadataGroup>
                <MetadataRow label="Commission %" value={`${financeProfile.commissionPercent}%`} />
                <MetadataRow label="Commission VAT %" value={`${financeProfile.commissionVatPercent}%`} />
                <MetadataRow label="Shipping deduction mode" value={formatShippingMode(financeProfile.shippingMode)} />
                <MetadataRow label="Deduct shipping after fulfillment" value={formatBoolean(financeProfile.deductShippingEnabled)} />
                <MetadataRow label="Fixed shipping fee" value={formatValue(financeProfile.fixedShippingFee)} />
                <MetadataRow label="Settlement delay" value={`${financeProfile.settlementDelayDays} days`} />
                <MetadataRow label="Settlement frequency" value={formatSettlementSchedule(financeProfile)} />
                <MetadataRow label="Auto draft" value={formatBoolean(financeProfile.autoSettlementDraftEnabled)} />
                <MetadataRow label="Auto approve" value={`${formatBoolean(financeProfile.autoSettlementApproveEnabled)} (not executed in Phase 4A)`} />
                <MetadataRow label="Auto invoice" value={`${formatBoolean(financeProfile.autoSettlementInvoiceEnabled)} (not executed in Phase 4A)`} />
                <MetadataRow label="Managed by" value={formatSource(financeProfile.source)} />
                <MetadataRow label="Policy active" value={formatBoolean(financeProfile.active)} />
              </MetadataGroup>
              <VendorProfileAuditMetadata
                title="Finance Policy last changed"
                log={latestFinanceAudit}
                onViewChanges={handleViewProfileChanges}
              />
              <div className="vendor-profile-integration-list">
                <div>
                  <span>Finance policy configured</span>
                  <StatusBadge tone={financeProfile.active ? 'success' : 'warning'}>
                    {financeProfile.active ? 'Configured' : 'Needs review'}
                  </StatusBadge>
                </div>
                <div>
                  <span>Snapshot safety</span>
                  <StatusBadge tone="info">Future rows only</StatusBadge>
                </div>
                {isAdmin ? (
                  <div>
                    <span>Admin edit</span>
                    <button
                      type="button"
                      className="button button-secondary button-compact"
                      onClick={handleOpenFinancePolicyEdit}
                      disabled={financePolicyMutation.isPending}
                    >
                      Edit finance policy
                    </button>
                  </div>
                ) : null}
              </div>
              {financePolicyEditOpen ? (
                <form className="vendor-profile-billing-form" onSubmit={handleFinancePolicySubmit} noValidate>
                  <div className="vendor-profile-billing-form-heading">
                    <div>
                      <h3>Finance Policy edit</h3>
                      <p>Changes apply only to future ledger rows. Historical snapshots remain unchanged.</p>
                    </div>
                    <StatusBadge tone="warning">Snapshot-safe policy</StatusBadge>
                  </div>
                  <div className="vendor-profile-billing-form-grid">
                    <label>
                      Commission %
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        value={financePolicyForm.commissionPercent}
                        onChange={(event) => handleFinancePolicyFormChange('commissionPercent', event.target.value)}
                        required
                      />
                    </label>
                    <label>
                      Commission VAT %
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        value={financePolicyForm.commissionVatPercent}
                        onChange={(event) => handleFinancePolicyFormChange('commissionVatPercent', event.target.value)}
                        required
                      />
                    </label>
                    <label>
                      Shipping deduction mode
                      <select
                        value={financePolicyForm.shippingMode}
                        onChange={(event) =>
                          handleFinancePolicyFormChange(
                            'shippingMode',
                            event.target.value as FinancePolicyFormState['shippingMode'],
                          )
                        }
                      >
                        <option value="disabled">Disabled</option>
                        <option value="fixed">Fixed shipping fee</option>
                        <option value="external_provider">External provider cost</option>
                      </select>
                    </label>
                    <label>
                      Fixed shipping fee
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={financePolicyForm.fixedShippingFee}
                        onChange={(event) => handleFinancePolicyFormChange('fixedShippingFee', event.target.value)}
                        placeholder="Optional"
                      />
                    </label>
                    <label>
                      Settlement delay days
                      <input
                        type="number"
                        min="0"
                        max="365"
                        step="1"
                        value={financePolicyForm.settlementDelayDays}
                        onChange={(event) => handleFinancePolicyFormChange('settlementDelayDays', event.target.value)}
                        required
                      />
                    </label>
                    <label>
                      Settlement frequency
                      <select
                        value={financePolicyForm.settlementFrequencyType}
                        onChange={(event) =>
                          handleFinancePolicyFormChange(
                            'settlementFrequencyType',
                            event.target.value as FinancePolicyFormState['settlementFrequencyType'],
                          )
                        }
                      >
                        <option value="WEEKLY">Weekly</option>
                        <option value="BIWEEKLY">Biweekly</option>
                      </select>
                    </label>
                    <label>
                      Weekly settlement day
                      <select
                        value={financePolicyForm.weeklySettlementDay}
                        onChange={(event) =>
                          handleFinancePolicyFormChange(
                            'weeklySettlementDay',
                            event.target.value as FinancePolicyFormState['weeklySettlementDay'],
                          )
                        }
                      >
                        <option value="MONDAY">Monday</option>
                        <option value="TUESDAY">Tuesday</option>
                        <option value="WEDNESDAY">Wednesday</option>
                        <option value="THURSDAY">Thursday</option>
                        <option value="FRIDAY">Friday</option>
                      </select>
                    </label>
                    <label className="vendor-profile-checkbox-field vendor-profile-billing-form-wide">
                      <input
                        type="checkbox"
                        checked={financePolicyForm.deductShippingEnabled}
                        onChange={(event) => handleFinancePolicyFormChange('deductShippingEnabled', event.target.checked)}
                      />
                      <span>Deduct shipping after fulfillment when the selected shipping deduction mode applies.</span>
                    </label>
                    <label className="vendor-profile-checkbox-field">
                      <input
                        type="checkbox"
                        checked={financePolicyForm.autoSettlementDraftEnabled}
                        onChange={(event) => handleFinancePolicyFormChange('autoSettlementDraftEnabled', event.target.checked)}
                      />
                      <span>Enable scheduled draft creation.</span>
                    </label>
                    <label className="vendor-profile-checkbox-field">
                      <input
                        type="checkbox"
                        checked={financePolicyForm.autoSettlementApproveEnabled}
                        onChange={(event) => handleFinancePolicyFormChange('autoSettlementApproveEnabled', event.target.checked)}
                      />
                      <span>Store auto-approve preference for a future phase.</span>
                    </label>
                    <label className="vendor-profile-checkbox-field">
                      <input
                        type="checkbox"
                        checked={financePolicyForm.autoSettlementInvoiceEnabled}
                        onChange={(event) => handleFinancePolicyFormChange('autoSettlementInvoiceEnabled', event.target.checked)}
                      />
                      <span>Store auto-invoice preference for a future phase.</span>
                    </label>
                  </div>
                  {financePolicyFormError ? <p className="vendor-profile-billing-error" role="alert">{financePolicyFormError}</p> : null}
                  <OperationalActionGroup>
                    <button type="submit" className="button button-primary" disabled={financePolicyMutation.isPending}>
                      {financePolicyMutation.isPending ? 'Saving finance policy...' : 'Save finance policy'}
                    </button>
                    <button
                      type="button"
                      className="button button-secondary"
                      onClick={handleCancelFinancePolicyEdit}
                      disabled={financePolicyMutation.isPending}
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
            <>
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
              <VendorProfileAuditMetadata
                title="Shipping Operations last changed"
                log={latestShippingAudit}
                onViewChanges={handleViewProfileChanges}
              />
              {isAdminVendorRoute ? (
                <VendorShippingConfigEditor
                  vendorId={currentVendor.vendorId}
                  vendorName={profileVendorName}
                  shippingConfig={shippingConfig}
                  enabled={canLoadProfile && isAdmin}
                  onSaved={() => void shippingQuery.refetch()}
                  onSynced={() => void shippingQuery.refetch()}
                />
              ) : null}
            </>
          )}
        </OperationalSection>

        <OperationalSection
          title="Integration status"
          description="Marketplace systems connected to this seller workspace."
        >
          <div className="vendor-profile-integration-list">
            <div>
              <span>Vendor Integration API</span>
              <StatusBadge
                tone={
                  integrationProvidersQuery.isError
                    ? 'warning'
                    : integrationProvidersQuery.isInitialLoading
                      ? 'warning'
                      : displayedIntegrationProvider
                        ? 'success'
                        : 'warning'
                }
              >
                {integrationProvidersQuery.isError
                  ? 'Unavailable'
                  : integrationProvidersQuery.isInitialLoading
                    ? 'Loading'
                    : displayedIntegrationProvider
                      ? 'Configured'
                      : 'Needs token'}
              </StatusBadge>
            </div>
            <div>
              <span>Client ID</span>
              <strong>{displayedIntegrationProvider?.clientId ?? (integrationProvidersQuery.isInitialLoading ? 'Loading' : 'Not created')}</strong>
            </div>
            <div>
              <span>Token status</span>
              <StatusBadge tone={integrationProvidersQuery.isInitialLoading ? 'warning' : integrationTokenStatus.tone}>
                {integrationProvidersQuery.isInitialLoading ? 'Loading' : integrationTokenStatus.label}
              </StatusBadge>
            </div>
            <div>
              <span>Last created</span>
              <strong>{displayedIntegrationProvider ? formatAuditDate(displayedIntegrationProvider.createdAt) : 'No token created'}</strong>
            </div>
            <div>
              <span>Finance policy configured</span>
              <StatusBadge tone={marketplaceTermsActive ? 'success' : 'warning'}>
                {marketplaceTermsActive ? 'Configured' : 'Needs review'}
              </StatusBadge>
            </div>
            <div>
              <span>Billing source configured</span>
              <StatusBadge tone={billingProfile ? 'success' : 'warning'}>
                {billingProfile ? 'Configured' : isAdmin ? 'Required' : 'Admin-managed'}
              </StatusBadge>
            </div>
            <div>
              <span>Logo binding configured</span>
              <StatusBadge tone={logoBindingPresent && !logoBindingNeedsMatch ? 'success' : 'warning'}>
                {logoBindingPresent && !logoBindingNeedsMatch ? 'Configured' : logoBindingNeedsMatch ? 'Needs match' : 'Missing'}
              </StatusBadge>
            </div>
            <div>
              <span>Shipping configured</span>
              <StatusBadge tone={shippingConfigured ? 'success' : 'warning'}>
                {shippingConfigured ? 'Configured' : 'Needs setup'}
              </StatusBadge>
            </div>
            <div>
              <span>Shopify workspace</span>
              <StatusBadge tone={canLoadProfile ? 'success' : 'warning'}>{canLoadProfile ? 'Connected' : 'Loading'}</StatusBadge>
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
          {isAdminVendorRoute ? (
            <form
              aria-label="Create integration token"
              className="vendor-profile-billing-form"
              onSubmit={handleIntegrationTokenSubmit}
              noValidate
            >
              <div className="vendor-profile-billing-form-heading">
                <div>
                  <h3>Create Integration Token</h3>
                  <p>Create the onboarding API token for this vendor's ERP integration.</p>
                </div>
              </div>
              <div className="vendor-profile-billing-form-grid">
                <label className="vendor-profile-billing-form-wide">
                  Provider name
                  <input
                    type="text"
                    value={integrationTokenForm.providerName}
                    onChange={(event) => handleIntegrationTokenProviderNameChange(event.target.value)}
                    placeholder="ERP provider name"
                    disabled={integrationTokenMutation.isPending}
                    required
                  />
                </label>
                {VENDOR_INTEGRATION_SCOPE_OPTIONS.map((scope) => (
                  <label className="vendor-profile-checkbox-field" key={scope.value}>
                    <input
                      type="checkbox"
                      checked={integrationTokenForm.scopes.includes(scope.value)}
                      onChange={(event) => handleIntegrationTokenScopeChange(scope.value, event.target.checked)}
                      disabled={integrationTokenMutation.isPending}
                    />
                    <span>{scope.label}</span>
                  </label>
                ))}
              </div>
              {integrationTokenFormError ? (
                <p className="vendor-profile-billing-error" role="alert">{integrationTokenFormError}</p>
              ) : null}
              {createdIntegrationToken ? (
                <div className="vendor-profile-token-panel" aria-label="One-time integration token" role="status">
                  <div>
                    <strong>Integration token created</strong>
                    <p>Copy this token now. It will never be shown again.</p>
                  </div>
                  <code>{createdIntegrationToken.token}</code>
                  <OperationalActionGroup>
                    <button
                      type="button"
                      className="button button-secondary"
                      onClick={() => void handleCopyCreatedIntegrationToken()}
                    >
                      Copy
                    </button>
                    <button type="button" className="button button-primary" onClick={handleDoneCreatedIntegrationToken}>
                      Done
                    </button>
                  </OperationalActionGroup>
                  {integrationTokenCopyStatus ? (
                    <p className="action-feedback action-success">{integrationTokenCopyStatus}</p>
                  ) : null}
                </div>
              ) : null}
              <OperationalActionGroup>
                <button type="submit" className="button button-primary" disabled={integrationTokenMutation.isPending}>
                  {integrationTokenMutation.isPending ? 'Creating token...' : 'Create Integration Token'}
                </button>
              </OperationalActionGroup>
            </form>
          ) : null}
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
              <VendorProfileAuditMetadata
                title="Warehouse and Returns last changed"
                log={latestShippingAudit}
                onViewChanges={handleViewProfileChanges}
              />
            </>
          )}
        </OperationalSection>
      </div>

      {isAdmin ? (
        <OperationalSection
          title="Vendor Configuration History"
          description="Immutable audit timeline for admin-owned vendor profile and provider configuration changes."
        >
          <section ref={auditHistoryRef} className="vendor-profile-audit-anchor" aria-label="Vendor configuration change history">
            <VendorProfileAuditHistory
              logs={profileAuditLogs}
              isLoading={auditLogQuery.isInitialLoading}
              isError={auditLogQuery.isError}
              error={auditLogQuery.error}
              onRetry={() => void auditLogQuery.refetch()}
            />
          </section>
        </OperationalSection>
      ) : null}

      <OperationalSection
        title="Support and correction workflow"
        description="Vendors request corrections through support; admin-owned settings stay locked on this page."
      >
        <div className="vendor-profile-support-panel">
          <div>
            <strong>{existingProfileTicket ? 'Correction ticket open' : vendorStatus.restricted ? 'Open a correction ticket' : 'Need a correction?'}</strong>
            <p>
              {existingProfileTicket
                ? `${existingProfileTicket.subject} is ${safeStatusLabel(existingProfileTicket.status).toLowerCase()}.`
                : vendorStatus.restricted
                  ? 'Contact support if you believe this account restriction needs review.'
                  : 'Report a marketplace profile or configuration issue so operations can review the admin-owned data.'}
            </p>
          </div>
          <OperationalActionGroup>
            <button
              type="button"
              className="button button-secondary"
              onClick={handleContactSupport}
              disabled={!pageReadiness.ready || supportQuery.isInitialLoading || supportMutation.isPending}
            >
              {existingProfileTicket ? 'Open correction ticket' : vendorStatus.restricted ? 'Open correction ticket' : 'Report configuration issue'}
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
        </>
      )}

      {message ? <ActionFeedback tone={tone} message={message} /> : null}
    </section>
  );
}
