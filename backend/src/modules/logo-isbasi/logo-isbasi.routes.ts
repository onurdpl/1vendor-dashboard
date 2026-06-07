import type { FastifyInstance } from 'fastify';
import type { AppEnv } from '../../config/env.js';
import { createAuthMiddleware } from '../auth/auth.middleware.js';
import { createAuthService } from '../auth/auth.service.js';
import { getVendorBillingProfile, type VendorBillingProfileDto } from '../vendors/vendor-billing-profile.service.js';
import { extractSessionFromLoginResponse, LogoIsbasiClient, sanitizeLoginResponse } from './logo-isbasi.client.js';
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
