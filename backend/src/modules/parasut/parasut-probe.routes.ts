import type { FastifyInstance } from 'fastify';
import type { AppEnv } from '../../config/env.js';
import { createAuthMiddleware } from '../auth/auth.middleware.js';
import { createAuthService } from '../auth/auth.service.js';
import { runParasutAuthMeDiagnostic, runParasutEnvDiagnostic } from './parasut-auth-me-diagnostic.js';
import { runParasutCommissionInvoiceProbe } from './parasut-commission-invoice-probe.js';

function adminProbesEnabled() {
  return process.env.ADMIN_PROBES_ENABLED?.trim().toLowerCase() === 'true';
}

const CREATE_COMMISSION_INVOICE_CONFIRMATION = 'CREATE_COMMISSION_INVOICE_TEST';
const SENSITIVE_TEXT_PATTERN =
  /(access[_-]?token|refresh[_-]?token|client[_-]?secret|password|authorization|secret|token)\s*[:=]\s*([^\s,;&]+)/gi;
const JWT_LIKE_PATTERN = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;

type CommissionProbeSummary = {
  contactCreated: boolean;
  productCreated: boolean;
  invoiceCreated: boolean;
  invoiceId: string | null;
  invoiceStatus: string | null;
  warnings: string[];
};

function readEnvFlag(key: string) {
  return process.env[key]?.trim().toLowerCase() === 'true';
}

function sanitizeErrorMessage(value: unknown) {
  const message = value instanceof Error ? value.message : typeof value === 'string' ? value : 'Paraşüt commission invoice probe failed.';
  return message
    .replace(JWT_LIKE_PATTERN, '[redacted-jwt]')
    .replace(SENSITIVE_TEXT_PATTERN, '$1=[redacted]')
    .slice(0, 500);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getResponseDataId(body: unknown) {
  return isRecord(body) && isRecord(body.data) && typeof body.data.id === 'string' ? body.data.id : null;
}

function extractInvoiceStatus(body: unknown) {
  if (!isRecord(body) || !isRecord(body.data) || !isRecord(body.data.attributes)) {
    return null;
  }

  for (const key of ['status', 'invoice_status', 'payment_status', 'e_invoice_status', 'e_archive_status', 'state']) {
    const value = body.data.attributes[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
  }

  return null;
}

async function readJsonClone(response: Response) {
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.includes('json')) {
    return null;
  }

  try {
    return await response.clone().json();
  } catch {
    return null;
  }
}

function getRequestUrl(input: RequestInfo | URL) {
  if (typeof input === 'string') {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}

function createCommissionProbeFetch(summary: CommissionProbeSummary): typeof fetch {
  return async (input, init) => {
    const response = await fetch(input, init);
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = new URL(getRequestUrl(input)).pathname;
    const body = await readJsonClone(response);
    const id = getResponseDataId(body);

    if (method === 'POST' && path.endsWith('/contacts') && id) {
      summary.contactCreated = true;
    }
    if (method === 'POST' && path.endsWith('/products') && id) {
      summary.productCreated = true;
    }
    if (method === 'POST' && path.endsWith('/sales_invoices') && id) {
      summary.invoiceCreated = true;
      summary.invoiceId = id;
      summary.invoiceStatus = extractInvoiceStatus(body) ?? summary.invoiceStatus;
    }
    if (method === 'GET' && path.includes('/sales_invoices/')) {
      summary.invoiceStatus = extractInvoiceStatus(body) ?? summary.invoiceStatus;
    }

    return response;
  };
}

function buildCommissionProbeResponse(ok: boolean, summary: CommissionProbeSummary, error?: unknown) {
  return {
    ok,
    provider: 'PARASUT',
    mode: 'commission_invoice_test',
    contactCreated: summary.contactCreated,
    productCreated: summary.productCreated,
    invoiceCreated: summary.invoiceCreated,
    invoiceId: summary.invoiceId,
    invoiceStatus: summary.invoiceStatus,
    warnings: summary.warnings,
    ...(error ? { error: { message: sanitizeErrorMessage(error) } } : {}),
  };
}

export function registerParasutProbeRoutes(app: FastifyInstance, env: AppEnv) {
  const authService = createAuthService(env);
  const authMiddleware = createAuthMiddleware(authService);

  app.get(
    '/admin/probes/parasut/env-check',
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

      const result = runParasutEnvDiagnostic();
      return reply.code(result.statusCode).send(result.body);
    },
  );

  app.get(
    '/admin/probes/parasut/auth-me',
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

      const result = await runParasutAuthMeDiagnostic();
      return reply.code(result.statusCode).send(result.body);
    },
  );

  app.post(
    '/admin/probes/parasut/commission-invoice-test',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      const summary: CommissionProbeSummary = {
        contactCreated: false,
        productCreated: false,
        invoiceCreated: false,
        invoiceId: null,
        invoiceStatus: null,
        warnings: [],
      };

      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      if (!adminProbesEnabled()) {
        return reply.code(403).send({ ok: false, message: 'Admin probe endpoints are disabled.' });
      }

      if (process.env.NODE_ENV?.trim().toLowerCase() === 'production') {
        return reply.code(403).send({
          ...buildCommissionProbeResponse(false, summary),
          warnings: ['NODE_ENV=production blocks this test-only Paraşüt probe.'],
        });
      }

      if (!readEnvFlag('PARASUT_ENABLED')) {
        return reply.code(422).send({
          ...buildCommissionProbeResponse(false, summary),
          warnings: ['PARASUT_ENABLED=true is required.'],
        });
      }

      if (!readEnvFlag('PARASUT_TEST_MODE')) {
        return reply.code(422).send({
          ...buildCommissionProbeResponse(false, summary),
          warnings: ['PARASUT_TEST_MODE=true is required.'],
        });
      }

      if (process.env.PARASUT_PROBE_CONFIRM?.trim() !== CREATE_COMMISSION_INVOICE_CONFIRMATION) {
        return reply.code(422).send({
          ...buildCommissionProbeResponse(false, summary),
          warnings: [`PARASUT_PROBE_CONFIRM=${CREATE_COMMISSION_INVOICE_CONFIRMATION} is required.`],
        });
      }

      try {
        await runParasutCommissionInvoiceProbe({
          env: {
            ...process.env,
            PARASUT_TEST_MODE: 'true',
            PARASUT_PROBE_DRY_RUN: 'false',
            PARASUT_PROBE_ALLOW_CREATE: 'true',
            PARASUT_PROBE_ALLOW_LIFECYCLE: 'false',
          },
          fetchImpl: createCommissionProbeFetch(summary),
          logger: {
            log: () => undefined,
            error: () => undefined,
          },
        });

        return reply.code(200).send(buildCommissionProbeResponse(true, summary));
      } catch (error) {
        return reply.code(502).send(buildCommissionProbeResponse(false, summary, error));
      }
    },
  );
}
