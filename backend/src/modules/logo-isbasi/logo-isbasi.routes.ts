import type { FastifyInstance } from 'fastify';
import type { AppEnv } from '../../config/env.js';
import { createAuthMiddleware } from '../auth/auth.middleware.js';
import { createAuthService } from '../auth/auth.service.js';
import { getVendorBillingProfile, type VendorBillingProfileDto } from '../vendors/vendor-billing-profile.service.js';
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

type SanitizedLogoFirmDetail = SanitizedLogoFirm & {
  taxOffice: string | null;
  city: string | null;
  district: string | null;
  eDispatchResponsible: boolean | null;
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
  };
}

function sanitizeFirmMatches(firms: unknown[]) {
  return firms.slice(0, 10).map(sanitizeLogoFirm);
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

        const result = await client.listFirms(login.session);
        if (!result.ok || result.jsonParseFailed) {
          return reply.code(502).send(buildLogoUpstreamError('firm_match_probe', result));
        }

        const firms = readLogoFirmsArray(result.body);
        const match = matchLogoFirmForVendor(profile, firms);
        return {
          ok: true,
          success: true,
          provider: 'LOGO_ISBASI',
          mode: 'firm_match_probe',
          writesPerformed: false,
          externalApiCallAttempted: true,
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
}
