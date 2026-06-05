import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppEnv } from '../../config/env.js';
import { createAuthMiddleware } from '../auth/auth.middleware.js';
import { createAuthService } from '../auth/auth.service.js';
import { CONFIRMED_VENDOR_PAYMENT_SELLERS, seedVendorPaymentSellerMappings } from '../payments/vendor-payment-seller.service.js';
import { buildParatikaSessionTokenPayloadPreviewForOrder } from './paratika-sessiontoken-payload.service.js';

const PARATIKA_SESSIONTOKEN_PROBE_CONFIRM = 'CREATE_SESSIONTOKEN_TEST';
const PARATIKA_CREDENTIAL_PAYLOAD_KEYS = new Set(['MERCHANTUSER', 'MERCHANTPASSWORD', 'MERCHANT']);
const PARATIKA_FORBIDDEN_PAYLOAD_KEYS = [
  'CARDNUMBER',
  'CARDHOLDER',
  'CARDEXPIRY',
  'CARDYEAR',
  'CARDMONTH',
  'CVV',
  'CVC',
  'PAN',
];
const PARATIKA_FORBIDDEN_ACTIONS = new Set(['SALE', 'PREAUTH', 'REFUND', 'VOID']);

function adminProbesEnabled() {
  return process.env.ADMIN_PROBES_ENABLED?.trim().toLowerCase() === 'true';
}

function readConfiguredValue(value: string | undefined | null) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function maskParatikaUsername(value: string | undefined | null) {
  const configured = readConfiguredValue(value);
  if (!configured) {
    return null;
  }

  const [localPart, domain] = configured.split('@');
  if (domain && localPart) {
    return `${localPart.charAt(0)}***@${domain}`;
  }

  return `${configured.charAt(0)}***`;
}

function getUrlHost(value: string | undefined | null) {
  const configured = readConfiguredValue(value);
  if (!configured) {
    return null;
  }

  try {
    return new URL(configured).host;
  } catch {
    return null;
  }
}

function getRuntimeCommit() {
  const rawCommit =
    process.env.RENDER_GIT_COMMIT ||
    process.env.GIT_COMMIT ||
    process.env.COMMIT_SHA ||
    process.env.SOURCE_VERSION ||
    null;

  return rawCommit?.trim() ? rawCommit.trim().slice(0, 12) : null;
}

function buildParatikaEnvDiagnostic(env: AppEnv) {
  const hasEnv = (name: string) => Boolean(readConfiguredValue(process.env[name]));

  return {
    ok: true,
    writesPerformed: false,
    provider: 'PARATIKA',
    externalApiCallAttempted: false,
    envPresence: {
      PARATIKA_API_URL: hasEnv('PARATIKA_API_URL'),
      PARATIKA_MERCHANT: hasEnv('PARATIKA_MERCHANT'),
      PARATIKA_MERCHANTUSER: hasEnv('PARATIKA_MERCHANTUSER'),
      PARATIKA_MERCHANTPASSWORD: hasEnv('PARATIKA_MERCHANTPASSWORD'),
      PARATIKA_TEST_MODE: hasEnv('PARATIKA_TEST_MODE'),
      PARATIKA_PROBE_DRY_RUN: hasEnv('PARATIKA_PROBE_DRY_RUN'),
      PARATIKA_PROBE_CONFIRM: hasEnv('PARATIKA_PROBE_CONFIRM'),
      PARATIKA_MARKETPLACE_MODEL: hasEnv('PARATIKA_MARKETPLACE_MODEL'),
    },
    apiUrlHost: getUrlHost(env.PARATIKA_API_URL),
    merchant: readConfiguredValue(env.PARATIKA_MERCHANT),
    maskedMerchantUser: maskParatikaUsername(env.PARATIKA_MERCHANTUSER),
    testMode: env.PARATIKA_TEST_MODE === true,
    dryRun: env.PARATIKA_PROBE_DRY_RUN !== false,
    confirmPresent: Boolean(readConfiguredValue(env.PARATIKA_PROBE_CONFIRM)),
    marketplaceModel: env.PARATIKA_MARKETPLACE_MODEL,
    runtime: {
      uptimeSeconds: Math.max(0, Math.round(process.uptime())),
      gitCommit: getRuntimeCommit(),
      nodeEnv: env.NODE_ENV,
    },
  };
}

function validateLiveProbeEnv(env: AppEnv) {
  const missingEnv: string[] = [];
  const validationErrors: string[] = [];

  if (env.PARATIKA_TEST_MODE !== true) {
    validationErrors.push('PARATIKA_TEST_MODE must be true for the Paratika live probe.');
  }

  const requiredEnv = {
    PARATIKA_API_URL: env.PARATIKA_API_URL,
    PARATIKA_MERCHANT: env.PARATIKA_MERCHANT,
    PARATIKA_MERCHANTUSER: env.PARATIKA_MERCHANTUSER,
    PARATIKA_MERCHANTPASSWORD: env.PARATIKA_MERCHANTPASSWORD,
    PARATIKA_RETURN_URL: env.PARATIKA_RETURN_URL,
  };

  for (const [key, value] of Object.entries(requiredEnv)) {
    if (!readConfiguredValue(value)) {
      missingEnv.push(key);
    }
  }

  if (missingEnv.length) {
    validationErrors.push('Required Paratika live probe env values are missing.');
  }

  return {
    ok: validationErrors.length === 0,
    missingEnv,
    validationErrors,
  };
}

function parseOrderItemsPreview(orderItems: string | undefined) {
  if (!orderItems) {
    return [];
  }

  try {
    const parsed = JSON.parse(orderItems) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function buildCredentialedSessionTokenPayload(previewPayload: Record<string, string>, env: AppEnv) {
  return {
    ...previewPayload,
    MERCHANT: readConfiguredValue(env.PARATIKA_MERCHANT) ?? '',
    MERCHANTUSER: readConfiguredValue(env.PARATIKA_MERCHANTUSER) ?? '',
    MERCHANTPASSWORD: readConfiguredValue(env.PARATIKA_MERCHANTPASSWORD) ?? '',
  };
}

function validateOutboundSessionTokenPayload(payload: Record<string, string>) {
  const validationErrors: string[] = [];

  if (payload.ACTION !== 'SESSIONTOKEN') {
    validationErrors.push('Paratika live probe only allows ACTION=SESSIONTOKEN.');
  }

  for (const action of PARATIKA_FORBIDDEN_ACTIONS) {
    if (payload.ACTION === action) {
      validationErrors.push(`Paratika live probe does not allow ACTION=${action}.`);
    }
  }

  for (const key of PARATIKA_FORBIDDEN_PAYLOAD_KEYS) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      validationErrors.push('Paratika live probe does not allow card data fields.');
      break;
    }
  }

  return {
    ok: validationErrors.length === 0,
    validationErrors,
  };
}

function sanitizedPayloadKeys(payload: Record<string, string>) {
  return Object.keys(payload).filter((key) => !PARATIKA_CREDENTIAL_PAYLOAD_KEYS.has(key));
}

function sanitizeParatikaText(value: unknown) {
  if (typeof value !== 'string') {
    return null;
  }

  return value
    .replace(/((?:access|refresh|session)[_-]?token|token|password|secret|merchantpassword|merchantuser)\s*[:=]\s*[^&\s,}]+/gi, '$1=[redacted]')
    .replace(/\beyJ[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+\b/gi, '[redacted]')
    .slice(0, 500);
}

function parseParatikaResponseBody(rawBody: string): Record<string, string> {
  if (!rawBody.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(rawBody) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return Object.fromEntries(
        Object.entries(parsed as Record<string, unknown>).map(([key, value]) => [key, typeof value === 'string' ? value : String(value)]),
      );
    }
  } catch {
    // Paratika responses are commonly form-style; fall through to URLSearchParams.
  }

  return Object.fromEntries(new URLSearchParams(rawBody));
}

function readCaseInsensitive(record: Record<string, string>, names: string[]) {
  const entries = Object.entries(record);
  for (const name of names) {
    const match = entries.find(([key]) => key.toLowerCase() === name.toLowerCase());
    if (match) {
      return match[1];
    }
  }
  return null;
}

function sanitizeParatikaResponse(rawBody: string) {
  const parsed = parseParatikaResponseBody(rawBody);
  const sessionToken = readCaseInsensitive(parsed, ['sessionToken', 'SESSIONTOKEN', 'session_token']);

  return {
    responseCode: sanitizeParatikaText(readCaseInsensitive(parsed, ['responseCode', 'RESPONSECODE', 'response_code'])),
    responseMsg: sanitizeParatikaText(readCaseInsensitive(parsed, ['responseMsg', 'RESPONSEMSG', 'response_msg'])),
    errorCode: sanitizeParatikaText(readCaseInsensitive(parsed, ['errorCode', 'ERRORCODE', 'error_code'])),
    errorMsg: sanitizeParatikaText(readCaseInsensitive(parsed, ['errorMsg', 'ERRORMSG', 'error_msg'])),
    violatorParam: sanitizeParatikaText(readCaseInsensitive(parsed, ['violatorParam', 'VIOLATORPARAM', 'violator_param'])),
    sessionTokenReceived: Boolean(sessionToken),
    sessionTokenLength: typeof sessionToken === 'string' ? sessionToken.length : 0,
    rawBodyKeys: Object.keys(parsed),
  };
}

async function runPaymentSellerMappingBackfill(request: FastifyRequest, reply: FastifyReply) {
  if (request.authUser?.role !== 'admin') {
    return reply.code(403).send({ message: 'Forbidden' });
  }

  if (!adminProbesEnabled()) {
    return reply.code(403).send({ ok: false, message: 'Admin probe endpoints are disabled.' });
  }

  await seedVendorPaymentSellerMappings();

  return reply.code(200).send({
    ok: true,
    writesPerformed: true,
    provider: 'PARATIKA',
    upserted: CONFIRMED_VENDOR_PAYMENT_SELLERS.map((mapping) => ({
      vendorId: mapping.vendorId,
      externalSellerId: mapping.externalSellerId,
      enabled: true,
    })),
  });
}

export function registerParatikaProbeRoutes(app: FastifyInstance, env: AppEnv) {
  const authService = createAuthService(env);
  const authMiddleware = createAuthMiddleware(authService);

  app.get(
    '/admin/probes/paratika/env-check',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      if (!adminProbesEnabled()) {
        return reply.code(403).send({ ok: false, writesPerformed: false, message: 'Admin probe endpoints are disabled.' });
      }

      return reply.code(200).send(buildParatikaEnvDiagnostic(env));
    },
  );

  app.get<{ Params: { orderId: string } }>(
    '/admin/probes/paratika/orders/:orderId/sessiontoken-payload-preview',
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

      const result = await buildParatikaSessionTokenPayloadPreviewForOrder(request.params.orderId, {
        returnUrl: env.PARATIKA_RETURN_URL,
        marketplaceModel: env.PARATIKA_MARKETPLACE_MODEL,
      });

      return reply.code(result.ok ? 200 : 422).send(result);
    },
  );

  app.post<{ Params: { orderId: string } }>(
    '/admin/probes/paratika/orders/:orderId/sessiontoken-live-probe',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      if (!adminProbesEnabled()) {
        return reply.code(403).send({ ok: false, writesPerformed: false, message: 'Admin probe endpoints are disabled.' });
      }

      const envValidation = validateLiveProbeEnv(env);
      if (!envValidation.ok) {
        return reply.code(422).send({
          ok: false,
          writesPerformed: false,
          provider: 'PARATIKA',
          mode: 'sessiontoken_live_probe',
          validationErrors: envValidation.validationErrors,
          missingEnv: envValidation.missingEnv,
          externalApiCallAttempted: false,
        });
      }

      const dryRun = env.PARATIKA_PROBE_DRY_RUN !== false;
      if (!dryRun && env.PARATIKA_PROBE_CONFIRM !== PARATIKA_SESSIONTOKEN_PROBE_CONFIRM) {
        return reply.code(422).send({
          ok: false,
          writesPerformed: false,
          provider: 'PARATIKA',
          mode: 'sessiontoken_live_probe',
          validationErrors: ['PARATIKA_PROBE_CONFIRM=CREATE_SESSIONTOKEN_TEST is required for a live SESSIONTOKEN probe.'],
          externalApiCallAttempted: false,
        });
      }

      const preview = await buildParatikaSessionTokenPayloadPreviewForOrder(request.params.orderId, {
        returnUrl: env.PARATIKA_RETURN_URL,
        marketplaceModel: env.PARATIKA_MARKETPLACE_MODEL,
      });

      if (!preview.ok || !preview.sessionTokenPayloadPreview) {
        return reply.code(422).send({
          ok: false,
          writesPerformed: false,
          provider: 'PARATIKA',
          mode: 'sessiontoken_live_probe',
          previewOk: preview.ok,
          model: preview.model,
          marketplaceModel: preview.marketplaceModel,
          paymentReference: preview.paymentReference,
          shippingDeductionPolicy: preview.shippingDeductionPolicy,
          itemBreakdown: preview.itemBreakdown,
          validationErrors: preview.validationErrors,
          externalApiCallAttempted: false,
          cardDataIncluded: false,
        });
      }

      const outboundPayload = buildCredentialedSessionTokenPayload(preview.sessionTokenPayloadPreview, env);
      const outboundValidation = validateOutboundSessionTokenPayload(outboundPayload);
      if (!outboundValidation.ok) {
        return reply.code(422).send({
          ok: false,
          writesPerformed: false,
          provider: 'PARATIKA',
          mode: 'sessiontoken_live_probe',
          validationErrors: outboundValidation.validationErrors,
          externalApiCallAttempted: false,
          cardDataIncluded: false,
        });
      }

      if (dryRun) {
        return reply.code(200).send({
          ok: true,
          writesPerformed: false,
          provider: 'PARATIKA',
          mode: 'sessiontoken_live_probe_dry_run',
          action: 'SESSIONTOKEN',
          model: preview.model,
          marketplaceModel: preview.marketplaceModel,
          paymentReference: preview.paymentReference,
          payloadKeys: sanitizedPayloadKeys(outboundPayload),
          orderItemsPreview: parseOrderItemsPreview(preview.sessionTokenPayloadPreview.ORDERITEMS),
          shippingDeductionPolicy: preview.shippingDeductionPolicy,
          credentialValuesOmitted: true,
          externalApiCallAttempted: false,
          cardDataIncluded: false,
        });
      }

      try {
        const response = await fetch(env.PARATIKA_API_URL as string, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams(outboundPayload),
        });
        const rawBody = await response.text();
        const sanitized = sanitizeParatikaResponse(rawBody);

        return reply.code(response.ok ? 200 : 502).send({
          ok: response.ok,
          writesPerformed: true,
          provider: 'PARATIKA',
          mode: 'sessiontoken_live_probe',
          action: 'SESSIONTOKEN',
          model: preview.model,
          marketplaceModel: preview.marketplaceModel,
          paymentReference: preview.paymentReference,
          httpStatus: response.status,
          responseCode: sanitized.responseCode,
          responseMsg: sanitized.responseMsg,
          errorCode: sanitized.errorCode,
          errorMsg: sanitized.errorMsg,
          violatorParam: sanitized.violatorParam,
          sessionTokenReceived: sanitized.sessionTokenReceived,
          sessionTokenLength: sanitized.sessionTokenLength,
          rawBodyKeys: sanitized.rawBodyKeys,
          externalApiCallAttempted: true,
          cardDataIncluded: false,
        });
      } catch (error) {
        return reply.code(502).send({
          ok: false,
          writesPerformed: true,
          provider: 'PARATIKA',
          mode: 'sessiontoken_live_probe',
          action: 'SESSIONTOKEN',
          error: {
            message: sanitizeParatikaText(error instanceof Error ? error.message : 'Paratika SESSIONTOKEN request failed.'),
          },
          externalApiCallAttempted: true,
          cardDataIncluded: false,
        });
      }
    },
  );

  app.get(
    '/admin/probes/paratika/payment-seller-mappings/backfill',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    runPaymentSellerMappingBackfill,
  );

  app.post(
    '/admin/probes/paratika/payment-seller-mappings/backfill',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    runPaymentSellerMappingBackfill,
  );
}
