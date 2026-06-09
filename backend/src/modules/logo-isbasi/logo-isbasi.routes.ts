import type { FastifyInstance } from 'fastify';
import type { AppEnv } from '../../config/env.js';
import { createAuthMiddleware } from '../auth/auth.middleware.js';
import { createAuthService } from '../auth/auth.service.js';
import {
  bindLogoIsbasiFirmToVendor,
  getVendorBillingProfile,
  type VendorBillingProfileDto,
} from '../vendors/vendor-billing-profile.service.js';
import {
  extractSessionFromLoginResponse,
  LogoIsbasiClient,
  sanitizeLoginResponse,
  type LogoIsbasiAuthenticatedSession,
  type LogoIsbasiRawResult,
} from './logo-isbasi.client.js';
import {
  buildLogoIsbasiCommissionInvoicePreview,
  sanitizeLogoIsbasiInvoicePreviewPayload,
} from './logo-isbasi-commission-preview.js';

const REQUIRED_LOGO_ENV = [
  'LOGO_ISBASI_BASE_URL',
  'LOGO_ISBASI_API_KEY',
  'LOGO_ISBASI_USERNAME',
  'LOGO_ISBASI_PASSWORD',
] as const;

const REQUIRED_PREVIEW_FIELDS = [
  'legalCompanyName',
  'taxNumber',
  'taxOffice',
  'billingAddress',
  'billingCity',
  'billingDistrict',
  'billingEmail',
] as const;

function adminProbesEnabled() {
  return process.env.ADMIN_PROBES_ENABLED?.trim().toLowerCase() === 'true';
}

function readConfiguredValue(value: string | undefined | null) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function getMissingLogoEnv(env: AppEnv) {
  const values = {
    LOGO_ISBASI_BASE_URL: env.LOGO_ISBASI_BASE_URL,
    LOGO_ISBASI_API_KEY: env.LOGO_ISBASI_API_KEY,
    LOGO_ISBASI_USERNAME: env.LOGO_ISBASI_USERNAME,
    LOGO_ISBASI_PASSWORD: env.LOGO_ISBASI_PASSWORD,
  };

  return REQUIRED_LOGO_ENV.filter((key) => !readConfiguredValue(values[key]));
}

function getLogoBaseUrlError(value: string | undefined | null) {
  const configured = readConfiguredValue(value);
  if (!configured) {
    return 'LOGO_ISBASI_BASE_URL is required.';
  }

  try {
    const parsed = new URL(configured);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return 'LOGO_ISBASI_BASE_URL must be an HTTP(S) URL.';
    }
    return null;
  } catch {
    return 'LOGO_ISBASI_BASE_URL must be a valid URL.';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readRequiredString(body: Record<string, unknown>, key: string) {
  const value = body[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${key} is required.`);
  }
  return value.trim();
}

function readOptionalString(body: Record<string, unknown>, key: string) {
  const value = body[key];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new Error(`${key} must be a string when provided.`);
  }
  return value.trim() || null;
}

function readOptionalStringArray(body: Record<string, unknown>, key: string) {
  const value = body[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error(`${key} must be an array of strings when provided.`);
  }
  const normalized = value.map((entry) => {
    if (typeof entry !== 'string' || !entry.trim()) {
      throw new Error(`${key} must contain only non-empty strings.`);
    }
    return entry.trim();
  });
  return normalized.length ? normalized : undefined;
}

function readRecordString(value: unknown, keys: string[]) {
  if (!isRecord(value)) {
    return null;
  }
  for (const key of keys) {
    const raw = value[key];
    if (typeof raw === 'string' && raw.trim()) {
      return raw.trim();
    }
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      return String(raw);
    }
  }
  return null;
}

function readRecordBoolean(value: unknown, keys: string[]) {
  if (!isRecord(value)) {
    return null;
  }
  for (const key of keys) {
    const raw = value[key];
    if (typeof raw === 'boolean') {
      return raw;
    }
    if (typeof raw === 'string') {
      const normalized = raw.trim().toLowerCase();
      if (['true', '1', 'yes', 'evet'].includes(normalized)) {
        return true;
      }
      if (['false', '0', 'no', 'hayir', 'hayır'].includes(normalized)) {
        return false;
      }
    }
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      return raw !== 0;
    }
  }
  return null;
}

function maskTaxNumber(value: string | null) {
  if (!value) {
    return null;
  }
  const digits = value.replace(/\D/g, '');
  if (!digits) {
    return null;
  }
  if (digits.length <= 4) {
    return '*'.repeat(digits.length);
  }
  return `${digits.slice(0, 2)}${'*'.repeat(Math.max(2, digits.length - 4))}${digits.slice(-2)}`;
}

function normalizeMatchText(value: string | null | undefined) {
  return value?.trim().toLocaleLowerCase('tr-TR').replace(/\s+/g, ' ') ?? '';
}

function normalizeTaxNumber(value: string | null | undefined) {
  return value?.replace(/\D/g, '') ?? '';
}

function normalizeFirmCode(value: string | null | undefined) {
  return value?.trim().toLocaleLowerCase('tr-TR') ?? '';
}

function readFirmTaxNumber(value: unknown) {
  return readRecordString(value, [
    'taxNumber',
    'taxNo',
    'tax_number',
    'tcknVkn',
    'tckn_vkn',
    'vknTckn',
    'vkn_tckn',
    'tckn',
    'vkn',
    'identityNumber',
    'identity_number',
    'taxIdentityNumber',
  ]);
}

type SanitizedLogoFirm = {
  id: string | null;
  code: string | null;
  name: string | null;
  firmType: string | null;
  taxNumberMasked: string | null;
  eInvoiceResponsible: boolean | null;
  eArchiveResponsible: boolean | null;
};

type LogoFirmMatchResult = ReturnType<typeof matchLogoFirmForVendor>;

type SanitizedLogoFirmDetail = SanitizedLogoFirm & {
  taxOffice: string | null;
  city: string | null;
  district: string | null;
  eDispatchResponsible: boolean | null;
};

type SanitizedLogoInvoiceSummary = {
  id: string | null;
  invoiceNumber: string | null;
  date: string | null;
  amount: string | null;
  currency: string | null;
  scenario: string | null;
  status: string | null;
  invoiceType: string | null;
  customerName: string | null;
};

type SanitizedLogoIncomingEinvoiceSummary = {
  invoiceId: string | null;
  uuId: string | null;
  type: string | null;
  typeDesc: string | null;
  issueDate: string | null;
  amount: string | null;
  currency: string | null;
  supplier: string | null;
  supplierTcknVknMasked: string | null;
  invoiceType: string | null;
  status: string | null;
  statusCode: string | null;
  eGovermentType: string | null;
  eGovermentTypeDesc: string | null;
};

export type LogoInvoiceShape = {
  hasEGovernmentInvoice: boolean;
  eGovernmentInvoiceKeys: string[];
  hasEArchivePortalInvoice: boolean;
  eArchivePortalInvoiceKeys: string[];
  currency: string | null;
  invoiceType: string | null;
  scenario: string | null;
  lineItemShape: string[];
};

function sanitizeLogoFirm(value: unknown): SanitizedLogoFirm {
  return {
    id: readRecordString(value, ['id', 'firmId', 'firmID', 'firmNo', 'firm_id']),
    code: readRecordString(value, ['code', 'firmCode', 'firm_code', 'customerCode', 'customer_code', 'accountCode']),
    name: readRecordString(value, ['name', 'firmName', 'firm_name', 'title', 'commercialTitle', 'unvan']),
    firmType: readRecordString(value, ['firmType', 'firm_type', 'type', 'cardType']),
    taxNumberMasked: maskTaxNumber(readFirmTaxNumber(value)),
    eInvoiceResponsible: readRecordBoolean(value, ['eInvoiceResponsible', 'einvoiceResponsible', 'isEInvoiceResponsible', 'e_invoice_responsible']),
    eArchiveResponsible: readRecordBoolean(value, ['eArchiveResponsible', 'earchiveResponsible', 'isEArchiveResponsible', 'e_archive_responsible']),
  };
}

function sanitizeLogoFirmDetail(value: unknown): SanitizedLogoFirmDetail {
  return {
    ...sanitizeLogoFirm(value),
    taxOffice: readRecordString(value, ['taxOffice', 'taxOfficeName', 'tax_office', 'tax_office_name']),
    city: readRecordString(value, ['city', 'cityName', 'city_name']),
    district: readRecordString(value, ['district', 'districtName', 'district_name', 'county']),
    eDispatchResponsible: readRecordBoolean(value, ['eDispatchResponsible', 'edispatchResponsible', 'isEDispatchResponsible', 'e_dispatch_responsible']),
  };
}

function maskEmail(value: string | null) {
  if (!value?.trim()) {
    return null;
  }
  const trimmed = value.trim();
  const atIndex = trimmed.indexOf('@');
  if (atIndex <= 0) {
    return '[masked-email]';
  }
  const local = trimmed.slice(0, atIndex);
  const domain = trimmed.slice(atIndex + 1);
  return `${local.slice(0, 1)}***@${domain}`;
}

function maskPhone(value: string | null) {
  if (!value?.trim()) {
    return null;
  }
  const digits = value.replace(/\D/g, '');
  if (!digits) {
    return '[masked-phone]';
  }
  return `***${digits.slice(-2)}`;
}

function sanitizeDiagnosticString(value: string) {
  return value
    .replace(/("?((?:access|refresh)?token|password|secret|api[_-]?key|authorization)"?\s*[:=]\s*)("[^"]*"|[^&\s,}]+)/gi, '$1[redacted]')
    .replace(/((?:access|refresh)?token|password|secret|api[_-]?key|authorization)\s*[:=]\s*[^&\s,}]+/gi, '$1=[redacted]')
    .replace(/\beyJ[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+\b/gi, '[redacted-token]')
    .slice(0, 500);
}

function isSecretLikeKey(key: string) {
  return /(token|authorization|api[_-]?key|password|secret|credential|card)/i.test(key);
}

function isEmailLikeKey(key: string) {
  return /(email|e[_-]?mail|mailAddress)/i.test(key);
}

function isPhoneLikeKey(key: string) {
  return /(phone|telephone|gsm|mobile|fax|telNo)/i.test(key);
}

function isTaxNumberLikeKey(key: string) {
  return /(taxNumber|taxNo|tax_number|tckn|vkn|tcknVkn|vknTckn|identityNumber|taxIdentityNumber|tcKimlik)/i.test(key);
}

function sanitizeLogoInvoiceNestedValue(value: unknown, key = '', depth = 0): unknown {
  if (isSecretLikeKey(key)) {
    return '[redacted]';
  }
  if (typeof value === 'string') {
    if (isEmailLikeKey(key)) {
      return maskEmail(value);
    }
    if (isPhoneLikeKey(key)) {
      return maskPhone(value);
    }
    if (isTaxNumberLikeKey(key)) {
      return maskTaxNumber(value);
    }
    return sanitizeDiagnosticString(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null || value === undefined) {
    return value ?? null;
  }
  if (depth >= 5) {
    return '[truncated]';
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((entry) => sanitizeLogoInvoiceNestedValue(entry, key, depth + 1));
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 80)
        .map(([entryKey, entryValue]) => [entryKey, sanitizeLogoInvoiceNestedValue(entryValue, entryKey, depth + 1)]),
    );
  }
  return null;
}

function readFirstRecord(value: unknown, keys: string[]) {
  if (!isRecord(value)) {
    return null;
  }
  for (const key of keys) {
    if (isRecord(value[key])) {
      return value[key] as Record<string, unknown>;
    }
  }
  return null;
}

function readFirstArray(value: unknown, keys: string[]) {
  if (Array.isArray(value)) {
    return value;
  }
  if (!isRecord(value)) {
    return [];
  }
  for (const key of keys) {
    const candidate = value[key];
    if (Array.isArray(candidate)) {
      return candidate;
    }
    if (isRecord(candidate)) {
      const nested = [candidate.items, candidate.records, candidate.data, candidate.list];
      const match = nested.find(Array.isArray);
      if (Array.isArray(match)) {
        return match;
      }
    }
  }
  return [];
}

function readInvoiceCustomerRecord(value: unknown) {
  return readFirstRecord(value, [
    'customer',
    'firm',
    'account',
    'currentAccount',
    'currentAccountCard',
    'customerDetail',
    'firmDetail',
  ]);
}

function readInvoiceLineItems(value: unknown) {
  return readFirstArray(value, [
    'lineItems',
    'lines',
    'items',
    'salesInvoiceDetails',
    'invoiceDetails',
    'details',
  ]);
}

function readInvoiceCustomerName(value: unknown) {
  return readRecordString(value, ['customerName', 'firmName', 'accountName', 'currentAccountName', 'customerTitle'])
    ?? readRecordString(readInvoiceCustomerRecord(value), ['name', 'firmName', 'title', 'commercialTitle', 'unvan']);
}

function sanitizeLogoInvoiceSummary(value: unknown): SanitizedLogoInvoiceSummary {
  return {
    id: readRecordString(value, ['id', 'invoiceId', 'invoiceID', 'invoice_id', 'salesInvoiceId']),
    invoiceNumber: readRecordString(value, ['invoiceNumber', 'invoiceNo', 'invoice_number', 'number', 'documentNumber', 'serialNumber']),
    date: readRecordString(value, ['date', 'invoiceDate', 'invoice_date', 'issueDate', 'documentDate', 'createdDate']),
    amount: readRecordString(value, ['amount', 'totalAmount', 'grandTotal', 'total', 'payableAmount', 'netTotal']),
    currency: readRecordString(value, ['currency', 'currencyCode', 'currency_code']),
    scenario: readRecordString(value, ['scenario', 'invoiceScenario', 'invoice_scenario']),
    status: readRecordString(value, ['status', 'invoiceStatus', 'invoice_status']),
    invoiceType: readRecordString(value, ['invoiceType', 'invoice_type', 'type']),
    customerName: readInvoiceCustomerName(value),
  };
}

function sanitizeLogoIncomingEinvoiceSummary(value: unknown): SanitizedLogoIncomingEinvoiceSummary {
  return {
    invoiceId: readRecordString(value, ['invoiceId', 'id', 'invoice_id']),
    uuId: readRecordString(value, ['uuId', 'uuid', 'UUID', 'ettn']),
    type: readRecordString(value, ['type']),
    typeDesc: readRecordString(value, ['typeDesc', 'typeDescription', 'type_desc']),
    issueDate: readRecordString(value, ['issueDate', 'date', 'invoiceDate']),
    amount: readRecordString(value, ['amount', 'totalAmount', 'payableAmount', 'grandTotal', 'netTotal']),
    currency: readRecordString(value, ['currency', 'currencyCode', 'currency_code']),
    supplier: readRecordString(value, ['supplier', 'supplierName', 'senderName', 'title', 'commercialTitle']),
    supplierTcknVknMasked: maskTaxNumber(readRecordString(value, [
      'supplierTcknVkn',
      'supplierVknTckn',
      'supplierTaxNumber',
      'senderTcknVkn',
      'senderVknTckn',
      'vknTckn',
      'tcknVkn',
    ])),
    invoiceType: readRecordString(value, ['invoiceType', 'invoice_type']),
    status: readRecordString(value, ['status', 'statusDesc', 'statusDescription']),
    statusCode: readRecordString(value, ['statusCode', 'status_code']),
    eGovermentType: readRecordString(value, ['eGovermentType', 'eGovernmentType', 'egovermentType']),
    eGovermentTypeDesc: readRecordString(value, ['eGovermentTypeDesc', 'eGovernmentTypeDesc', 'egovermentTypeDesc']),
  };
}

function sanitizeLogoInvoiceCustomer(value: unknown) {
  const customer = readInvoiceCustomerRecord(value);
  const source = customer ?? value;
  return {
    id: readRecordString(source, ['id', 'firmId', 'customerId', 'accountId']),
    code: readRecordString(source, ['code', 'firmCode', 'customerCode', 'accountCode']),
    name: readRecordString(source, ['name', 'firmName', 'title', 'commercialTitle', 'unvan']) ?? readInvoiceCustomerName(value),
    firmType: readRecordString(source, ['firmType', 'firm_type', 'type', 'cardType']),
    taxNumberMasked: maskTaxNumber(readFirmTaxNumber(source)),
    taxOffice: readRecordString(source, ['taxOffice', 'taxOfficeName', 'tax_office', 'tax_office_name']),
    city: readRecordString(source, ['city', 'cityName', 'city_name']),
    district: readRecordString(source, ['district', 'districtName', 'district_name', 'county']),
    emailMasked: maskEmail(readRecordString(source, ['email', 'emailAddress', 'eMail', 'mail'])),
    phoneMasked: maskPhone(readRecordString(source, ['phone', 'phoneNumber', 'telephone', 'gsm', 'mobilePhone'])),
    eInvoiceResponsible: readRecordBoolean(source, ['eInvoiceResponsible', 'einvoiceResponsible', 'isEInvoiceResponsible', 'e_invoice_responsible']),
    eArchiveResponsible: readRecordBoolean(source, ['eArchiveResponsible', 'earchiveResponsible', 'isEArchiveResponsible', 'e_archive_responsible']),
  };
}

function sanitizeLogoInvoiceLineItem(value: unknown) {
  return {
    id: readRecordString(value, ['id', 'lineId', 'detailId']),
    productCode: readRecordString(value, ['productCode', 'itemCode', 'code', 'stockCode']),
    name: readRecordString(value, ['name', 'productName', 'itemName', 'description']),
    description: readRecordString(value, ['description', 'lineDescription', 'explanation']),
    quantity: readRecordString(value, ['quantity', 'amount', 'qty']),
    unitPrice: readRecordString(value, ['unitPrice', 'price', 'unit_price']),
    amount: readRecordString(value, ['amount', 'lineTotal', 'total', 'netTotal']),
    vatRate: readRecordString(value, ['vatRate', 'taxRate', 'vat_rate', 'tax_rate']),
    currency: readRecordString(value, ['currency', 'currencyCode', 'currency_code']),
    rawShape: isRecord(value) ? Object.keys(value).sort() : [],
  };
}

function readLogoInvoicesArray(body: unknown): unknown[] {
  if (Array.isArray(body)) {
    return body;
  }
  if (!isRecord(body)) {
    return [];
  }
  const candidates = [body.data, body.items, body.invoices, body.salesInvoices, body.records, body.result];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
    if (isRecord(candidate)) {
      const nested = [candidate.items, candidate.invoices, candidate.salesInvoices, candidate.records, candidate.data];
      const match = nested.find(Array.isArray);
      if (Array.isArray(match)) {
        return match;
      }
    }
  }
  return [];
}

function readLogoIncomingEinvoicesArray(body: unknown): unknown[] {
  if (Array.isArray(body)) {
    return body;
  }
  if (!isRecord(body)) {
    return [];
  }
  const candidates = [body.data, body.items, body.invoices, body.myInvoices, body.records, body.result];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
    if (isRecord(candidate)) {
      const nested = [candidate.items, candidate.invoices, candidate.myInvoices, candidate.records, candidate.data];
      const match = nested.find(Array.isArray);
      if (Array.isArray(match)) {
        return match;
      }
    }
  }
  return [];
}

function readLogoInvoiceDetailRecord(body: unknown): unknown {
  if (!isRecord(body)) {
    return body;
  }
  for (const key of ['data', 'invoice', 'salesInvoice', 'result', 'item']) {
    if (isRecord(body[key])) {
      return body[key];
    }
  }
  return body;
}

function readEGovernmentInvoice(value: unknown) {
  return readFirstRecord(value, ['eGovernmentInvoice', 'e_government_invoice', 'egovernmentInvoice']);
}

function readEArchivePortalInvoice(value: unknown) {
  return readFirstRecord(value, ['eArchivePortalInvoice', 'e_archive_portal_invoice', 'earchivePortalInvoice']);
}

export function extractInvoiceShape(value: unknown): LogoInvoiceShape {
  const eGovernmentInvoice = readEGovernmentInvoice(value);
  const eArchivePortalInvoice = readEArchivePortalInvoice(value);
  const lineItems = readInvoiceLineItems(value);
  const firstLineItem = lineItems.find(isRecord) ?? null;

  return {
    hasEGovernmentInvoice: Boolean(eGovernmentInvoice),
    eGovernmentInvoiceKeys: eGovernmentInvoice ? Object.keys(eGovernmentInvoice).sort() : [],
    hasEArchivePortalInvoice: Boolean(eArchivePortalInvoice),
    eArchivePortalInvoiceKeys: eArchivePortalInvoice ? Object.keys(eArchivePortalInvoice).sort() : [],
    currency: readRecordString(value, ['currency', 'currencyCode', 'currency_code']),
    invoiceType: readRecordString(value, ['invoiceType', 'invoice_type', 'type']),
    scenario: readRecordString(value, ['scenario', 'invoiceScenario', 'invoice_scenario']),
    lineItemShape: firstLineItem ? Object.keys(firstLineItem).sort() : [],
  };
}

function sanitizeLogoInvoiceDetail(value: unknown) {
  return {
    invoiceId: readRecordString(value, ['id', 'invoiceId', 'invoiceID', 'invoice_id', 'salesInvoiceId']),
    currency: readRecordString(value, ['currency', 'currencyCode', 'currency_code']),
    invoiceType: readRecordString(value, ['invoiceType', 'invoice_type', 'type']),
    scenario: readRecordString(value, ['scenario', 'invoiceScenario', 'invoice_scenario']),
    customer: sanitizeLogoInvoiceCustomer(value),
    lineItems: readInvoiceLineItems(value).slice(0, 50).map(sanitizeLogoInvoiceLineItem),
    eGovernmentInvoice: sanitizeLogoInvoiceNestedValue(readEGovernmentInvoice(value)),
    eArchivePortalInvoice: sanitizeLogoInvoiceNestedValue(readEArchivePortalInvoice(value)),
  };
}

function readLogoFirmsArray(body: unknown): unknown[] {
  if (Array.isArray(body)) {
    return body;
  }
  if (!isRecord(body)) {
    return [];
  }
  const candidates = [body.data, body.items, body.firms, body.records, body.result];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
    if (isRecord(candidate)) {
      const nested = [candidate.items, candidate.firms, candidate.records, candidate.data];
      const match = nested.find(Array.isArray);
      if (Array.isArray(match)) {
        return match;
      }
    }
  }
  return [];
}

function readLogoFirmDetailRecord(body: unknown): unknown {
  if (!isRecord(body)) {
    return body;
  }
  for (const key of ['data', 'firm', 'result', 'item']) {
    if (isRecord(body[key])) {
      return body[key];
    }
  }
  return body;
}

function buildLogoClient(env: AppEnv) {
  return new LogoIsbasiClient({
    baseUrl: env.LOGO_ISBASI_BASE_URL!,
    apiKey: env.LOGO_ISBASI_API_KEY!,
    username: env.LOGO_ISBASI_USERNAME!,
    password: env.LOGO_ISBASI_PASSWORD!,
  });
}

function buildLogoReadinessError(env: AppEnv, mode: string) {
  const missingEnv = getMissingLogoEnv(env);
  if (missingEnv.length) {
    return {
      status: 422,
      body: {
        ok: false,
        provider: 'LOGO_ISBASI',
        mode,
        writesPerformed: false,
        externalApiCallAttempted: false,
        errorCode: 'LOGO_ISBASI_ENV_MISSING',
        message: 'Required Logo İşbaşı environment variables are missing.',
        missingEnv,
      },
    };
  }

  const baseUrlError = getLogoBaseUrlError(env.LOGO_ISBASI_BASE_URL);
  if (baseUrlError) {
    return {
      status: 422,
      body: {
        ok: false,
        provider: 'LOGO_ISBASI',
        mode,
        writesPerformed: false,
        externalApiCallAttempted: false,
        errorCode: 'LOGO_ISBASI_BASE_URL_INVALID',
        message: baseUrlError,
        missingEnv: ['LOGO_ISBASI_BASE_URL'],
      },
    };
  }

  return null;
}

function logoBaseUrlLooksLikeTestTenant(value: string | undefined) {
  return typeof value === 'string' && /\btest\b|[-.]test[.-]|staging|sandbox/i.test(value);
}

function buildLogoTestTenantError(env: AppEnv, mode: string) {
  if (logoBaseUrlLooksLikeTestTenant(env.LOGO_ISBASI_BASE_URL)) {
    return null;
  }

  return {
    status: 422,
    body: {
      ok: false,
      success: false,
      provider: 'LOGO_ISBASI',
      mode,
      writesPerformed: false,
      externalApiCallAttempted: false,
      errorCode: 'LOGO_ISBASI_TEST_TENANT_REQUIRED',
      message: 'Logo İşbaşı test invoice creation is allowed only against a test/staging/sandbox tenant URL.',
    },
  };
}

async function loginForLogoReadProbe(client: LogoIsbasiClient, mode: string) {
  const result = await client.login();
  const login = sanitizeLoginResponse(result.body);
  const session = extractSessionFromLoginResponse(result.body);
  const missingSessionFields = session.missing;
  const sessionComplete = missingSessionFields.length === 0;
  const ok = result.ok && sessionComplete && !result.jsonParseFailed;

  if (!ok) {
    const errorCode = result.jsonParseFailed
      ? 'LOGO_ISBASI_JSON_PARSE_FAILED'
      : !result.ok
        ? 'LOGO_ISBASI_UPSTREAM_NON_2XX'
        : 'LOGO_ISBASI_SESSION_FIELDS_MISSING';
    const message = result.jsonParseFailed
      ? 'Logo İşbaşı login returned a non-JSON response.'
      : !result.ok
        ? 'Logo İşbaşı login request failed.'
        : 'Logo İşbaşı login response is missing required session fields.';

    return {
      ok: false as const,
      status: result.ok ? 422 : 502,
      body: {
        ok: false,
        provider: 'LOGO_ISBASI',
        mode,
        writesPerformed: false,
        externalApiCallAttempted: true,
        httpStatus: result.status,
        errorCode,
        message,
        ...(missingSessionFields.length ? { missingSessionFields } : {}),
        login,
      },
    };
  }

  return {
    ok: true as const,
    session: {
      accessToken: session.accessToken!,
      tenantId: session.tenantId!,
      userId: session.userId,
      userEmail: session.userEmail,
      userName: session.userName,
    } satisfies LogoIsbasiAuthenticatedSession,
    login,
  };
}

function buildLogoUpstreamError(mode: string, result: LogoIsbasiRawResult) {
  const sanitized = sanitizeLoginResponse(result.body);
  return {
    ok: false,
    provider: 'LOGO_ISBASI',
    mode,
    writesPerformed: false,
    externalApiCallAttempted: true,
    httpStatus: result.status,
    errorCode: result.jsonParseFailed ? 'LOGO_ISBASI_JSON_PARSE_FAILED' : 'LOGO_ISBASI_UPSTREAM_NON_2XX',
    message: result.jsonParseFailed ? 'Logo İşbaşı returned a non-JSON response.' : 'Logo İşbaşı request failed.',
    responseKeys: isRecord(result.body) ? Object.keys(result.body).sort() : [],
    upstream: {
      code: sanitized.code,
      message: sanitized.message,
    },
    request: {
      url: result.requestUrl ?? null,
      method: result.requestMethod ?? null,
      contentType: result.requestContentType ?? null,
      accept: result.requestAccept ?? null,
      queryParameters: result.queryParameters ?? [],
    },
    response: {
      status: result.status,
      contentType: result.responseContentType ?? null,
      bodySnippet: result.responseBodySnippet ?? null,
    },
  };
}

function readLogoCreateInvoiceRecord(body: unknown): unknown {
  if (!isRecord(body)) {
    return body;
  }
  for (const key of ['data', 'invoice', 'result', 'item']) {
    if (isRecord(body[key])) {
      return body[key];
    }
  }
  return body;
}

function buildLogoTestInvoiceCreateResponse(
  result: LogoIsbasiRawResult,
  requestPayload: Record<string, unknown>,
  vendorId: string,
  warnings: string[] = [],
) {
  const invoiceRecord = readLogoCreateInvoiceRecord(result.body);
  return {
    ok: result.ok && !result.jsonParseFailed,
    success: result.ok && !result.jsonParseFailed,
    provider: 'LOGO_ISBASI',
    mode: 'test_invoice_create',
    writesPerformed: result.ok && !result.jsonParseFailed,
    externalApiCallAttempted: true,
    vendorId,
    httpStatus: result.status,
    upstreamStatus: result.status,
    responseKeys: isRecord(result.body) ? Object.keys(result.body).sort() : [],
    invoiceId: readRecordString(invoiceRecord, ['invoiceId', 'id', 'invoice_id', 'salesInvoiceId']),
    uuid: readRecordString(invoiceRecord, ['uuid', 'uuId', 'UUID']),
    ettn: readRecordString(invoiceRecord, ['ettn', 'ETTN', 'eTtn']),
    warnings,
    requestPayload: sanitizeLogoIsbasiInvoicePreviewPayload(requestPayload),
    responseBody: sanitizeLogoInvoiceNestedValue(result.body),
    ...(result.ok && !result.jsonParseFailed
      ? {}
      : {
        errorCode: result.jsonParseFailed ? 'LOGO_ISBASI_JSON_PARSE_FAILED' : 'LOGO_ISBASI_UPSTREAM_NON_2XX',
        message: result.jsonParseFailed ? 'Logo İşbaşı returned a non-JSON response.' : 'Logo İşbaşı test invoice create request failed.',
        request: {
          url: result.requestUrl ?? null,
          method: result.requestMethod ?? null,
          contentType: result.requestContentType ?? null,
          accept: result.requestAccept ?? null,
          queryParameters: result.queryParameters ?? [],
        },
        response: {
          status: result.status,
          contentType: result.responseContentType ?? null,
          bodySnippet: result.responseBodySnippet ?? null,
        },
      }),
  };
}

function formatLogoTestInvoiceItemCode(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0');
  const timestamp = [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
  ].join('');
  return `SPORGYM-COMMISSION-TEST-${timestamp}`;
}

function buildLogoTestInvoicePayload(requestPayload: Record<string, unknown>, date = new Date()) {
  const itemCode = formatLogoTestInvoiceItemCode(date);
  const details = Array.isArray(requestPayload.salesInvoiceDetails)
    ? requestPayload.salesInvoiceDetails.map((detail) => {
        if (!isRecord(detail) || !isRecord(detail.productDetail)) {
          return detail;
        }
        return {
          ...detail,
          productDetail: {
            ...detail.productDetail,
            itemCode,
          },
        };
      })
    : requestPayload.salesInvoiceDetails;

  return {
    ...requestPayload,
    salesInvoiceDetails: details,
  };
}

function logLogoInvoiceUpstreamFailure(app: FastifyInstance, mode: string, result: LogoIsbasiRawResult) {
  app.log?.warn?.(
    {
      provider: 'LOGO_ISBASI',
      mode,
      requestUrl: result.requestUrl ?? null,
      requestMethod: result.requestMethod ?? null,
      requestContentType: result.requestContentType ?? null,
      requestAccept: result.requestAccept ?? null,
      queryParameters: result.queryParameters ?? [],
      httpStatus: result.status,
      responseContentType: result.responseContentType ?? null,
      responseBodySnippet: result.responseBodySnippet ?? null,
    },
    'Logo İşbaşı invoice probe upstream request failed.',
  );
}

function sanitizeFirmMatches(firms: unknown[]) {
  return firms.slice(0, 10).map(sanitizeLogoFirm);
}

const LOGO_FIRM_MATCH_PAGE_SIZE = 50;
const LOGO_FIRM_MATCH_MAX_PAGES = 10;

function buildLogoFirmListPageBody(page: number) {
  return {
    filters: [],
    sorting: {
      code: 1,
    },
    paging: {
      currentPage: page,
      pageSize: LOGO_FIRM_MATCH_PAGE_SIZE,
    },
    columnNames: null,
    count: true,
    excel: {
      export: false,
      allowedColumns: null,
      lucaExport: false,
    },
  };
}

function getLogoFirmDedupeKey(firm: unknown, index: number) {
  const sanitized = sanitizeLogoFirm(firm);
  return sanitized.id || sanitized.code || `${index}`;
}

async function listLogoFirmMatchCandidates(
  client: LogoIsbasiClient,
  session: LogoIsbasiAuthenticatedSession,
  mode: string,
) {
  const firms: unknown[] = [];
  const seen = new Set<string>();
  const pageStatuses: Array<{ page: number; status: number; count: number }> = [];

  for (let page = 1; page <= LOGO_FIRM_MATCH_MAX_PAGES; page += 1) {
    const result = await client.listFirms(session, buildLogoFirmListPageBody(page));
    if (!result.ok || result.jsonParseFailed) {
      return {
        ok: false as const,
        result,
        firms,
        diagnostics: {
          lookupMode: 'paged_firm_match',
          pageSize: LOGO_FIRM_MATCH_PAGE_SIZE,
          maxPages: LOGO_FIRM_MATCH_MAX_PAGES,
          pagesFetched: pageStatuses.length,
          pageStatuses,
        },
      };
    }

    const pageFirms = readLogoFirmsArray(result.body);
    pageStatuses.push({ page, status: result.status, count: pageFirms.length });
    pageFirms.forEach((firm, index) => {
      const key = getLogoFirmDedupeKey(firm, firms.length + index);
      if (!seen.has(key)) {
        seen.add(key);
        firms.push(firm);
      }
    });

    if (pageFirms.length === 0 || pageFirms.length < LOGO_FIRM_MATCH_PAGE_SIZE) {
      break;
    }
  }

  return {
    ok: true as const,
    firms,
    diagnostics: {
      lookupMode: 'paged_firm_match',
      pageSize: LOGO_FIRM_MATCH_PAGE_SIZE,
      maxPages: LOGO_FIRM_MATCH_MAX_PAGES,
      pagesFetched: pageStatuses.length,
      pageStatuses,
      mode,
    },
  };
}

function matchLogoFirmForVendor(profile: VendorBillingProfileDto | null, firms: unknown[]) {
  if (!profile) {
    return {
      matchStatus: 'none' as const,
      exactMatch: null,
      possibleMatches: [],
      warnings: ['Vendor billing profile is missing.'],
    };
  }

  const profileCustomerCode = normalizeFirmCode(profile.logoIsbasiCustomerCode);
  const profileTaxNumber = normalizeTaxNumber(profile.taxNumber);
  const profileName = normalizeMatchText(profile.legalCompanyName);
  const indexed = firms.map((firm) => ({
    raw: firm,
    sanitized: sanitizeLogoFirm(firm),
    code: normalizeFirmCode(sanitizeLogoFirm(firm).code),
    taxNumber: normalizeTaxNumber(readFirmTaxNumber(firm)),
    name: normalizeMatchText(sanitizeLogoFirm(firm).name),
  }));

  const exactByCode = profileCustomerCode
    ? indexed.find((firm) => firm.code && firm.code === profileCustomerCode)
    : undefined;
  const exactByTax = !exactByCode && profileTaxNumber
    ? indexed.find((firm) => firm.taxNumber && firm.taxNumber === profileTaxNumber)
    : undefined;
  const exactByName = !exactByCode && !exactByTax && profileName
    ? indexed.find((firm) => firm.name && firm.name === profileName)
    : undefined;
  const exact = exactByCode ?? exactByTax ?? exactByName ?? null;

  if (exact) {
    return {
      matchStatus: 'exact_match' as const,
      matchMethod: exactByCode ? 'logoIsbasiCustomerCode' : exactByTax ? 'taxNumberOrTckn' : 'legalCompanyName',
      exactMatch: exact.sanitized,
      possibleMatches: [],
      warnings: [],
    };
  }

  const possibleMatches = profileName
    ? indexed
        .filter((firm) => firm.name && (firm.name.includes(profileName) || profileName.includes(firm.name)))
        .slice(0, 10)
        .map((firm) => firm.sanitized)
    : [];

  return {
    matchStatus: possibleMatches.length ? 'possible_matches' as const : 'none' as const,
    matchMethod: possibleMatches.length ? 'legalCompanyName' : null,
    exactMatch: null,
    possibleMatches,
    warnings: [],
  };
}

function buildLogoFirmMatchResponse(vendorId: string, profile: VendorBillingProfileDto | null, firms: unknown[]) {
  const match = matchLogoFirmForVendor(profile, firms);
  return {
    vendorId,
    billingProfilePresent: Boolean(profile),
    searchedBy: {
      logoIsbasiCustomerCodePresent: Boolean(profile?.logoIsbasiCustomerCode?.trim()),
      taxNumberOrTcknPresent: Boolean(profile?.taxNumber?.trim()),
      legalCompanyNamePresent: Boolean(profile?.legalCompanyName?.trim()),
    },
    count: firms.length,
    ...match,
  };
}

function sanitizeBoundFirm(match: LogoFirmMatchResult['exactMatch']) {
  return {
    name: match?.name ?? null,
    code: match?.code ?? null,
    taxNumberMasked: match?.taxNumberMasked ?? null,
  };
}

function readDecimalString(body: Record<string, unknown>, key: string) {
  const value = body[key];
  const rawValue = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
  if (!rawValue || !/^\d+(?:\.\d{1,4})?$/.test(rawValue)) {
    throw new Error(`${key} must be a positive decimal value.`);
  }
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${key} must be a positive decimal value.`);
  }
  return rawValue;
}

function readVatRate(body: Record<string, unknown>) {
  const value = readDecimalString(body, 'vatRate');
  const parsed = Number(value);
  if (parsed > 100) {
    throw new Error('vatRate must be between 0 and 100.');
  }
  return value;
}

function validateBillingProfileReady(profile: VendorBillingProfileDto | null) {
  if (!profile) {
    throw new Error('Vendor billing profile is required.');
  }

  const missingFields = REQUIRED_PREVIEW_FIELDS.filter((field) => {
    const value = profile[field];
    return typeof value !== 'string' || !value.trim();
  });

  if (missingFields.length) {
    throw new Error(`Vendor billing profile is missing required fields: ${missingFields.join(', ')}.`);
  }
}

export function registerLogoIsbasiRoutes(app: FastifyInstance, env: AppEnv) {
  const authService = createAuthService(env);
  const authMiddleware = createAuthMiddleware(authService);

  app.post(
    '/admin/probes/logo-isbasi/login',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      if (!adminProbesEnabled()) {
        return reply.code(403).send({ ok: false, message: 'Admin probe endpoints are disabled.' });
      }

      const missingEnv = getMissingLogoEnv(env);
      if (missingEnv.length) {
        return reply.code(422).send({
          ok: false,
          provider: 'LOGO_ISBASI',
          mode: 'login_probe',
          writesPerformed: false,
          externalApiCallAttempted: false,
          errorCode: 'LOGO_ISBASI_ENV_MISSING',
          message: 'Required Logo İşbaşı environment variables are missing.',
          missingEnv,
        });
      }

      const baseUrlError = getLogoBaseUrlError(env.LOGO_ISBASI_BASE_URL);
      if (baseUrlError) {
        return reply.code(422).send({
          ok: false,
          provider: 'LOGO_ISBASI',
          mode: 'login_probe',
          writesPerformed: false,
          externalApiCallAttempted: false,
          errorCode: 'LOGO_ISBASI_BASE_URL_INVALID',
          message: baseUrlError,
          missingEnv: ['LOGO_ISBASI_BASE_URL'],
        });
      }

      try {
        const client = new LogoIsbasiClient({
          baseUrl: env.LOGO_ISBASI_BASE_URL!,
          apiKey: env.LOGO_ISBASI_API_KEY!,
          username: env.LOGO_ISBASI_USERNAME!,
          password: env.LOGO_ISBASI_PASSWORD!,
        });
        const result = await client.login();
        const login = sanitizeLoginResponse(result.body);
        const session = extractSessionFromLoginResponse(result.body);
        const missingSessionFields = session.missing;
        const sessionComplete = missingSessionFields.length === 0;
        const ok = result.ok && sessionComplete && !result.jsonParseFailed;
        const errorCode = result.jsonParseFailed
          ? 'LOGO_ISBASI_JSON_PARSE_FAILED'
          : !result.ok
            ? 'LOGO_ISBASI_UPSTREAM_NON_2XX'
            : !sessionComplete
              ? 'LOGO_ISBASI_SESSION_FIELDS_MISSING'
              : undefined;
        const message = result.jsonParseFailed
          ? 'Logo İşbaşı login returned a non-JSON response.'
          : !result.ok
            ? 'Logo İşbaşı login request failed.'
            : !sessionComplete
              ? 'Logo İşbaşı login response is missing required session fields.'
              : 'Logo İşbaşı login probe succeeded.';

        return reply.code(ok ? 200 : result.ok ? 422 : 502).send({
          ok,
          provider: 'LOGO_ISBASI',
          mode: 'login_probe',
          writesPerformed: false,
          externalApiCallAttempted: true,
          httpStatus: result.status,
          ...(errorCode ? { errorCode } : {}),
          message,
          ...(missingSessionFields.length ? { missingSessionFields } : {}),
          login,
        });
      } catch {
        return reply.code(502).send({
          ok: false,
          provider: 'LOGO_ISBASI',
          mode: 'login_probe',
          writesPerformed: false,
          externalApiCallAttempted: true,
          errorCode: 'LOGO_ISBASI_NETWORK_ERROR',
          message: 'Network/backend request failed while calling Logo İşbaşı login.',
        });
      }
    },
  );

  app.post(
    '/admin/probes/logo-isbasi/firms',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      if (!adminProbesEnabled()) {
        return reply.code(403).send({ ok: false, message: 'Admin probe endpoints are disabled.' });
      }

      const readinessError = buildLogoReadinessError(env, 'firms_discovery');
      if (readinessError) {
        return reply.code(readinessError.status).send(readinessError.body);
      }

      try {
        const client = buildLogoClient(env);
        const login = await loginForLogoReadProbe(client, 'firms_discovery');
        if (!login.ok) {
          return reply.code(login.status).send(login.body);
        }

        const result = await client.listFirms(login.session);
        if (!result.ok || result.jsonParseFailed) {
          return reply.code(502).send(buildLogoUpstreamError('firms_discovery', result));
        }

        const firms = readLogoFirmsArray(result.body);
        return {
          ok: true,
          success: true,
          provider: 'LOGO_ISBASI',
          mode: 'firms_discovery',
          writesPerformed: false,
          externalApiCallAttempted: true,
          httpStatus: result.status,
          count: firms.length,
          sampleFirms: sanitizeFirmMatches(firms),
        };
      } catch {
        return reply.code(502).send({
          ok: false,
          success: false,
          provider: 'LOGO_ISBASI',
          mode: 'firms_discovery',
          writesPerformed: false,
          externalApiCallAttempted: true,
          errorCode: 'LOGO_ISBASI_NETWORK_ERROR',
          message: 'Network/backend request failed while calling Logo İşbaşı firms discovery.',
        });
      }
    },
  );

  app.post<{ Params: { firmId: string } }>(
    '/admin/probes/logo-isbasi/firms/:firmId',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      if (!adminProbesEnabled()) {
        return reply.code(403).send({ ok: false, message: 'Admin probe endpoints are disabled.' });
      }

      const firmId = request.params.firmId?.trim();
      if (!firmId) {
        return reply.code(400).send({
          ok: false,
          success: false,
          provider: 'LOGO_ISBASI',
          mode: 'firm_detail_discovery',
          writesPerformed: false,
          externalApiCallAttempted: false,
          message: 'firmId is required.',
        });
      }

      const readinessError = buildLogoReadinessError(env, 'firm_detail_discovery');
      if (readinessError) {
        return reply.code(readinessError.status).send(readinessError.body);
      }

      try {
        const client = buildLogoClient(env);
        const login = await loginForLogoReadProbe(client, 'firm_detail_discovery');
        if (!login.ok) {
          return reply.code(login.status).send(login.body);
        }

        const result = await client.getFirmDetail(login.session, firmId);
        if (!result.ok || result.jsonParseFailed) {
          return reply.code(502).send(buildLogoUpstreamError('firm_detail_discovery', result));
        }

        return {
          ok: true,
          success: true,
          provider: 'LOGO_ISBASI',
          mode: 'firm_detail_discovery',
          writesPerformed: false,
          externalApiCallAttempted: true,
          httpStatus: result.status,
          firm: sanitizeLogoFirmDetail(readLogoFirmDetailRecord(result.body)),
        };
      } catch {
        return reply.code(502).send({
          ok: false,
          success: false,
          provider: 'LOGO_ISBASI',
          mode: 'firm_detail_discovery',
          writesPerformed: false,
          externalApiCallAttempted: true,
          errorCode: 'LOGO_ISBASI_NETWORK_ERROR',
          message: 'Network/backend request failed while calling Logo İşbaşı firm detail.',
        });
      }
    },
  );

  app.post(
    '/admin/probes/logo-isbasi/invoices',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      if (!adminProbesEnabled()) {
        return reply.code(403).send({ ok: false, message: 'Admin probe endpoints are disabled.' });
      }

      const readinessError = buildLogoReadinessError(env, 'invoice_list_discovery');
      if (readinessError) {
        return reply.code(readinessError.status).send(readinessError.body);
      }

      try {
        const client = buildLogoClient(env);
        const login = await loginForLogoReadProbe(client, 'invoice_list_discovery');
        if (!login.ok) {
          return reply.code(login.status).send(login.body);
        }

        const result = await client.listInvoices(login.session);
        if (!result.ok || result.jsonParseFailed) {
          logLogoInvoiceUpstreamFailure(app, 'invoice_list_discovery', result);
          return reply.code(502).send(buildLogoUpstreamError('invoice_list_discovery', result));
        }

        const invoices = readLogoInvoicesArray(result.body);
        return {
          ok: true,
          success: true,
          provider: 'LOGO_ISBASI',
          mode: 'invoice_list_discovery',
          writesPerformed: false,
          externalApiCallAttempted: true,
          httpStatus: result.status,
          count: invoices.length,
          sampleInvoices: invoices.slice(0, 20).map(sanitizeLogoInvoiceSummary),
        };
      } catch {
        return reply.code(502).send({
          ok: false,
          success: false,
          provider: 'LOGO_ISBASI',
          mode: 'invoice_list_discovery',
          writesPerformed: false,
          externalApiCallAttempted: true,
          errorCode: 'LOGO_ISBASI_NETWORK_ERROR',
          message: 'Network/backend request failed while calling Logo İşbaşı invoices discovery.',
        });
      }
    },
  );

  app.post<{ Params: { invoiceId: string } }>(
    '/admin/probes/logo-isbasi/invoices/:invoiceId',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      if (!adminProbesEnabled()) {
        return reply.code(403).send({ ok: false, message: 'Admin probe endpoints are disabled.' });
      }

      const invoiceId = request.params.invoiceId?.trim();
      if (!invoiceId) {
        return reply.code(400).send({
          ok: false,
          success: false,
          provider: 'LOGO_ISBASI',
          mode: 'invoice_detail_discovery',
          writesPerformed: false,
          externalApiCallAttempted: false,
          message: 'invoiceId is required.',
        });
      }

      return reply.code(501).send({
        ok: false,
        success: false,
        provider: 'LOGO_ISBASI',
        mode: 'invoice_detail_discovery',
        writesPerformed: false,
        externalApiCallAttempted: false,
        errorCode: 'LOGO_ISBASI_INVOICE_DETAIL_ENDPOINT_UNKNOWN',
        message: 'Invoice list discovery succeeded. Detail endpoint is not confirmed yet.',
        invoiceId,
      });
    },
  );

  app.post(
    '/admin/probes/logo-isbasi/incoming-einvoices',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      if (!adminProbesEnabled()) {
        return reply.code(403).send({ ok: false, message: 'Admin probe endpoints are disabled.' });
      }

      const readinessError = buildLogoReadinessError(env, 'incoming_einvoice_discovery');
      if (readinessError) {
        return reply.code(readinessError.status).send(readinessError.body);
      }

      try {
        const client = buildLogoClient(env);
        const login = await loginForLogoReadProbe(client, 'incoming_einvoice_discovery');
        if (!login.ok) {
          return reply.code(login.status).send(login.body);
        }

        const result = await client.listIncomingEinvoices(login.session);
        if (!result.ok || result.jsonParseFailed) {
          logLogoInvoiceUpstreamFailure(app, 'incoming_einvoice_discovery', result);
          return reply.code(502).send(buildLogoUpstreamError('incoming_einvoice_discovery', result));
        }

        const invoices = readLogoIncomingEinvoicesArray(result.body);
        return {
          ok: true,
          success: true,
          provider: 'LOGO_ISBASI',
          mode: 'incoming_einvoice_discovery',
          writesPerformed: false,
          externalApiCallAttempted: true,
          httpStatus: result.status,
          count: invoices.length,
          responseKeys: isRecord(result.body) ? Object.keys(result.body).sort() : [],
          sampleInvoices: invoices.slice(0, 20).map(sanitizeLogoIncomingEinvoiceSummary),
        };
      } catch {
        return reply.code(502).send({
          ok: false,
          success: false,
          provider: 'LOGO_ISBASI',
          mode: 'incoming_einvoice_discovery',
          writesPerformed: false,
          externalApiCallAttempted: true,
          errorCode: 'LOGO_ISBASI_NETWORK_ERROR',
          message: 'Network/backend request failed while calling Logo İşbaşı incoming e-invoices discovery.',
        });
      }
    },
  );

  app.post<{ Params: { vendorId: string } }>(
    '/admin/vendors/:vendorId/logo-isbasi/match-firm',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Admin access required.' });
      }

      if (!adminProbesEnabled()) {
        return reply.code(403).send({ ok: false, message: 'Admin probe endpoints are disabled.' });
      }

      const readinessError = buildLogoReadinessError(env, 'firm_match_probe');
      if (readinessError) {
        return reply.code(readinessError.status).send(readinessError.body);
      }

      const { vendorId } = request.params;

      try {
        const profile = await getVendorBillingProfile(vendorId);
        const client = buildLogoClient(env);
        const login = await loginForLogoReadProbe(client, 'firm_match_probe');
        if (!login.ok) {
          return reply.code(login.status).send(login.body);
        }

        const candidates = await listLogoFirmMatchCandidates(client, login.session, 'firm_match_probe');
        if (!candidates.ok) {
          return reply.code(502).send(buildLogoUpstreamError('firm_match_probe', candidates.result));
        }

        return {
          ok: true,
          success: true,
          provider: 'LOGO_ISBASI',
          mode: 'firm_match_probe',
          writesPerformed: false,
          externalApiCallAttempted: true,
          lookup: candidates.diagnostics,
          ...buildLogoFirmMatchResponse(vendorId, profile, candidates.firms),
        };
      } catch (error) {
        return reply.code(502).send({
          ok: false,
          success: false,
          provider: 'LOGO_ISBASI',
          mode: 'firm_match_probe',
          writesPerformed: false,
          externalApiCallAttempted: true,
          errorCode: 'LOGO_ISBASI_MATCH_PROBE_FAILED',
          message: error instanceof Error ? error.message : 'Logo İşbaşı firm match probe failed.',
        });
      }
    },
  );

  app.post<{ Params: { vendorId: string } }>(
    '/admin/vendors/:vendorId/logo-isbasi/bind-matched-firm',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Admin access required.' });
      }

      if (!adminProbesEnabled()) {
        return reply.code(403).send({ ok: false, message: 'Admin probe endpoints are disabled.' });
      }

      const readinessError = buildLogoReadinessError(env, 'firm_bind_probe');
      if (readinessError) {
        return reply.code(readinessError.status).send(readinessError.body);
      }

      const { vendorId } = request.params;

      try {
        const profile = await getVendorBillingProfile(vendorId);
        const client = buildLogoClient(env);
        const login = await loginForLogoReadProbe(client, 'firm_bind_probe');
        if (!login.ok) {
          return reply.code(login.status).send(login.body);
        }

        const candidates = await listLogoFirmMatchCandidates(client, login.session, 'firm_bind_probe');
        if (!candidates.ok) {
          return reply.code(502).send(buildLogoUpstreamError('firm_bind_probe', candidates.result));
        }

        const matchResponse = buildLogoFirmMatchResponse(vendorId, profile, candidates.firms);
        if (matchResponse.matchStatus !== 'exact_match' || !matchResponse.exactMatch) {
          return reply.code(422).send({
            ok: false,
            success: false,
            provider: 'LOGO_ISBASI',
            mode: 'firm_bind_probe',
            writesPerformed: false,
            externalApiCallAttempted: true,
            errorCode: 'LOGO_ISBASI_NO_EXACT_MATCH',
            message: 'Logo İşbaşı firm binding requires an exact match.',
            lookup: candidates.diagnostics,
            ...matchResponse,
          });
        }

        if (!matchResponse.exactMatch.code || !matchResponse.exactMatch.id) {
          return reply.code(422).send({
            ok: false,
            success: false,
            provider: 'LOGO_ISBASI',
            mode: 'firm_bind_probe',
            writesPerformed: false,
            externalApiCallAttempted: true,
            errorCode: 'LOGO_ISBASI_MATCH_BINDING_FIELDS_MISSING',
            message: 'Exact Logo İşbaşı match is missing customer code or id.',
            ...matchResponse,
          });
        }

        const previousBinding = {
          logoIsbasiCustomerCode: profile?.logoIsbasiCustomerCode ?? null,
          logoIsbasiCustomerId: profile?.logoIsbasiCustomerId ?? null,
        };
        const boundAt = new Date();
        const saved = await bindLogoIsbasiFirmToVendor(vendorId, {
          logoIsbasiCustomerCode: matchResponse.exactMatch.code,
          logoIsbasiCustomerId: matchResponse.exactMatch.id,
          logoIsbasiEinvoiceEligible: matchResponse.exactMatch.eInvoiceResponsible,
          logoIsbasiLastCheckedAt: boundAt,
        });

        return {
          ok: true,
          success: true,
          provider: 'LOGO_ISBASI',
          mode: 'firm_bind_probe',
          writesPerformed: true,
          externalApiCallAttempted: true,
          vendorId,
          matchStatus: matchResponse.matchStatus,
          matchMethod: matchResponse.matchMethod,
          logoIsbasiCustomerCode: saved.logoIsbasiCustomerCode,
          logoIsbasiCustomerId: saved.logoIsbasiCustomerId,
          logoIsbasiEinvoiceEligible: saved.logoIsbasiEinvoiceEligible,
          logoIsbasiLastCheckedAt: saved.logoIsbasiLastCheckedAt,
          previousBinding,
          newBinding: {
            logoIsbasiCustomerCode: saved.logoIsbasiCustomerCode,
            logoIsbasiCustomerId: saved.logoIsbasiCustomerId,
          },
          matchedFirm: sanitizeBoundFirm(matchResponse.exactMatch),
        };
      } catch (error) {
        return reply.code(502).send({
          ok: false,
          success: false,
          provider: 'LOGO_ISBASI',
          mode: 'firm_bind_probe',
          writesPerformed: false,
          externalApiCallAttempted: true,
          errorCode: 'LOGO_ISBASI_BIND_PROBE_FAILED',
          message: error instanceof Error ? error.message : 'Logo İşbaşı firm bind probe failed.',
        });
      }
    },
  );

  app.post(
    '/admin/vendors/:vendorId/logo-isbasi/commission-invoice-preview',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Admin access required.' });
      }

      const body = isRecord(request.body) ? request.body : {};
      const { vendorId } = request.params as { vendorId: string };

      try {
        const profile = await getVendorBillingProfile(vendorId);
        validateBillingProfileReady(profile);

        const preview = buildLogoIsbasiCommissionInvoicePreview({
          vendorBillingProfile: profile!,
          commissionAmount: readDecimalString(body, 'commissionAmount'),
          vatRate: readVatRate(body),
          currency: readRequiredString(body, 'currency'),
          description: readRequiredString(body, 'description'),
          invoiceDate: readOptionalString(body, 'invoiceDate'),
          sourceOrderIds: readOptionalStringArray(body, 'sourceOrderIds'),
          sourcePeriod: readOptionalString(body, 'sourcePeriod'),
        });

        return {
          ok: true,
          provider: 'LOGO_ISBASI',
          mode: 'commission_invoice_preview',
          writesPerformed: false,
          externalApiCallAttempted: false,
          payload: sanitizeLogoIsbasiInvoicePreviewPayload(preview.payload),
          warnings: preview.warnings,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Logo İşbaşı commission invoice preview failed.';
        return reply.code(400).send({
          ok: false,
          provider: 'LOGO_ISBASI',
          mode: 'commission_invoice_preview',
          writesPerformed: false,
          externalApiCallAttempted: false,
          message,
        });
      }
    },
  );

  app.post(
    '/admin/vendors/:vendorId/logo-isbasi/test-create-invoice',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Admin access required.' });
      }

      if (!adminProbesEnabled()) {
        return reply.code(403).send({ ok: false, message: 'Admin probe endpoints are disabled.' });
      }

      const readinessError = buildLogoReadinessError(env, 'test_invoice_create');
      if (readinessError) {
        return reply.code(readinessError.status).send(readinessError.body);
      }

      const testTenantError = buildLogoTestTenantError(env, 'test_invoice_create');
      if (testTenantError) {
        return reply.code(testTenantError.status).send(testTenantError.body);
      }

      const body = isRecord(request.body) ? request.body : {};
      if (body.confirmTestInvoice !== true) {
        return reply.code(400).send({
          ok: false,
          success: false,
          provider: 'LOGO_ISBASI',
          mode: 'test_invoice_create',
          writesPerformed: false,
          externalApiCallAttempted: false,
          errorCode: 'LOGO_ISBASI_TEST_INVOICE_CONFIRMATION_REQUIRED',
          message: 'confirmTestInvoice=true is required before creating a Logo İşbaşı test invoice.',
        });
      }

      const { vendorId } = request.params as { vendorId: string };

      try {
        const profile = await getVendorBillingProfile(vendorId);
        validateBillingProfileReady(profile);
        if (!profile?.logoIsbasiCustomerCode || !profile.logoIsbasiCustomerId) {
          return reply.code(422).send({
            ok: false,
            success: false,
            provider: 'LOGO_ISBASI',
            mode: 'test_invoice_create',
            writesPerformed: false,
            externalApiCallAttempted: false,
            vendorId,
            errorCode: 'LOGO_ISBASI_BOUND_CUSTOMER_REQUIRED',
            message: 'Vendor must be bound to a Logo İşbaşı customer before creating a test invoice.',
            missingFields: [
              ...(!profile?.logoIsbasiCustomerCode ? ['logoIsbasiCustomerCode'] : []),
              ...(!profile?.logoIsbasiCustomerId ? ['logoIsbasiCustomerId'] : []),
            ],
          });
        }

        const preview = buildLogoIsbasiCommissionInvoicePreview({
          vendorBillingProfile: profile,
          commissionAmount: '1',
          vatRate: '20',
          currency: 'TL',
          description: 'SPORGYM TEST KOMİSYON FATURASI',
          invoiceDate: new Date().toISOString().slice(0, 10),
        });
        const testInvoiceWarnings = [
          ...preview.warnings,
          'Using unique test itemCode to avoid Logo test tenant product collision.',
        ];
        const testInvoicePayload = buildLogoTestInvoicePayload(preview.payload);

        const client = buildLogoClient(env);
        const login = await loginForLogoReadProbe(client, 'test_invoice_create');
        if (!login.ok) {
          return reply.code(login.status).send(login.body);
        }

        const result = await client.createIntegrationInvoice(login.session, testInvoicePayload);
        const response = buildLogoTestInvoiceCreateResponse(result, testInvoicePayload, vendorId, testInvoiceWarnings);
        return reply.code(result.ok && !result.jsonParseFailed ? 200 : 502).send(response);
      } catch (error) {
        return reply.code(400).send({
          ok: false,
          success: false,
          provider: 'LOGO_ISBASI',
          mode: 'test_invoice_create',
          writesPerformed: false,
          externalApiCallAttempted: false,
          vendorId,
          errorCode: 'LOGO_ISBASI_TEST_INVOICE_CREATE_FAILED',
          message: error instanceof Error ? error.message : 'Logo İşbaşı test invoice create probe failed.',
        });
      }
    },
  );
}
