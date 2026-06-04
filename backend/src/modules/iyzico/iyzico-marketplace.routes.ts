import type { FastifyInstance } from 'fastify';
import type { AppEnv } from '../../config/env.js';
import { createAuthMiddleware } from '../auth/auth.middleware.js';
import { createAuthService } from '../auth/auth.service.js';
import {
  createIyzicoMarketplaceClientFromEnv,
  type IyzicoHttpResult,
  validateIyzicoSandboxConfig,
} from './iyzico-marketplace.client.js';

type JsonRecord = Record<string, unknown>;

type IyzicoRouteOptions = {
  fetchImpl?: typeof fetch;
};

const SENSITIVE_KEY_PATTERN = /api.?key|secret|authorization|card.?number|cvc|cvv|identity.?number/i;
const AUTH_HEADER_PATTERN = /IYZWSv2\s+[A-Za-z0-9+/=._-]+/gi;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readPayload(body: unknown) {
  return isRecord(body) && isRecord(body.payload) ? body.payload : null;
}

function sanitizeIyzicoDiagnosticValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeIyzicoDiagnosticValue(item));
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => {
        if (SENSITIVE_KEY_PATTERN.test(key)) {
          return [key, '[redacted]'];
        }
        if (key === 'checkoutFormContent') {
          return [key, '[omitted-checkout-form-content]'];
        }
        return [key, sanitizeIyzicoDiagnosticValue(item)];
      }),
    );
  }

  if (typeof value === 'string') {
    return value.replace(AUTH_HEADER_PATTERN, 'IYZWSv2 [redacted]');
  }

  return value;
}

function summarizeProviderBody(body: unknown) {
  if (!isRecord(body)) {
    return {
      bodyType: Array.isArray(body) ? 'array' : body === null ? 'null' : typeof body,
      bodyKeys: [] as string[],
      providerStatus: null,
      providerErrorCode: null,
    };
  }

  return {
    bodyType: 'object',
    bodyKeys: Object.keys(body).filter((key) => !SENSITIVE_KEY_PATTERN.test(key)).sort(),
    providerStatus: readString(body.status),
    providerErrorCode: readString(body.errorCode),
  };
}

function buildDiagnosticResponse(result: IyzicoHttpResult) {
  const summary = summarizeProviderBody(result.body);
  const providerFailure = summary.providerStatus === 'failure';

  return {
    ok: result.ok && !providerFailure,
    provider: 'iyzico',
    sandbox: true,
    productionPaymentFlowChanged: false,
    shopifyCheckoutIntegration: false,
    method: result.request.method,
    endpointPath: result.request.endpointPath,
    httpStatus: result.status,
    contentType: result.contentType,
    requestBodyKeys: result.request.requestBodyKeys,
    authorizationHeaderPresent: result.request.authorizationHeaderPresent,
    ...summary,
    body: sanitizeIyzicoDiagnosticValue(result.body),
  };
}

function providerStatusCode(result: IyzicoHttpResult) {
  return result.ok ? 200 : 502;
}

function buildSafeFetchError(error: unknown) {
  return {
    name: error instanceof Error ? error.name : 'Error',
    message: sanitizeIyzicoDiagnosticValue(error instanceof Error ? error.message : 'iyzico sandbox request failed.'),
  };
}

function validateAdmin(request: { authUser?: { role?: string } }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) {
  if (request.authUser?.role !== 'admin') {
    return reply.code(403).send({ message: 'Forbidden' });
  }

  return null;
}

function validateCheckoutBasketItems(payload: JsonRecord) {
  if (!Array.isArray(payload.basketItems)) {
    return 'payload.basketItems is required for the iyzico checkout-form initialize probe.';
  }

  const requiredKeys = ['id', 'price', 'name', 'category1', 'itemType', 'subMerchantKey', 'subMerchantPrice'];
  for (const [index, item] of payload.basketItems.entries()) {
    if (!isRecord(item)) {
      return `payload.basketItems[${index}] must be an object.`;
    }

    const missing = requiredKeys.filter((key) => item[key] === undefined || item[key] === null || item[key] === '');
    if (missing.length) {
      return `payload.basketItems[${index}] is missing: ${missing.join(', ')}.`;
    }
  }

  return null;
}

async function executeIyzicoProbe(env: AppEnv, options: IyzicoRouteOptions, execute: (client: ReturnType<typeof createIyzicoMarketplaceClientFromEnv>) => Promise<IyzicoHttpResult>) {
  const validation = validateIyzicoSandboxConfig(env);
  if (!validation.ok) {
    return {
      statusCode: validation.statusCode,
      body: {
        ok: false,
        provider: 'iyzico',
        sandbox: true,
        message: validation.message,
        diagnostics: validation.diagnostics,
      },
    };
  }

  try {
    const client = createIyzicoMarketplaceClientFromEnv(env, { fetchImpl: options.fetchImpl });
    const result = await execute(client);
    return {
      statusCode: providerStatusCode(result),
      body: buildDiagnosticResponse(result),
    };
  } catch (error) {
    return {
      statusCode: 502,
      body: {
        ok: false,
        provider: 'iyzico',
        sandbox: true,
        fetchError: buildSafeFetchError(error),
      },
    };
  }
}

export function registerIyzicoMarketplaceDiagnosticsRoutes(app: FastifyInstance, env: AppEnv, options: IyzicoRouteOptions = {}) {
  const authService = createAuthService(env);
  const authMiddleware = createAuthMiddleware(authService);

  app.post<{ Body: JsonRecord }>(
    '/admin/diagnostics/iyzico-marketplace/submerchant',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      const forbidden = validateAdmin(request, reply);
      if (forbidden) {
        return forbidden;
      }

      const action = readString(request.body?.action);
      if (action === 'create') {
        const payload = readPayload(request.body);
        if (!payload) {
          return reply.code(400).send({ message: 'payload is required for submerchant create.' });
        }

        const result = await executeIyzicoProbe(env, options, (client) => client.createSubMerchant(payload));
        return reply.code(result.statusCode).send(result.body);
      }

      if (action === 'retrieve') {
        const subMerchantExternalId = readString(request.body?.subMerchantExternalId);
        if (!subMerchantExternalId) {
          return reply.code(400).send({ message: 'subMerchantExternalId is required for submerchant retrieve.' });
        }

        const result = await executeIyzicoProbe(env, options, (client) => client.retrieveSubMerchant(subMerchantExternalId));
        return reply.code(result.statusCode).send(result.body);
      }

      return reply.code(400).send({ message: 'action must be create or retrieve.' });
    },
  );

  app.post<{ Body: JsonRecord }>(
    '/admin/diagnostics/iyzico-marketplace/checkout-form',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      const forbidden = validateAdmin(request, reply);
      if (forbidden) {
        return forbidden;
      }

      const action = readString(request.body?.action);
      if (action === 'initialize') {
        const payload = readPayload(request.body);
        if (!payload) {
          return reply.code(400).send({ message: 'payload is required for checkout-form initialize.' });
        }

        const basketValidationError = validateCheckoutBasketItems(payload);
        if (basketValidationError) {
          return reply.code(400).send({ message: basketValidationError });
        }

        const result = await executeIyzicoProbe(env, options, (client) => client.initializeMarketplaceCheckoutForm(payload));
        return reply.code(result.statusCode).send(result.body);
      }

      if (action === 'retrieve-result') {
        const token = readString(request.body?.token);
        const conversationId = readString(request.body?.conversationId);
        if (!token || !conversationId) {
          return reply.code(400).send({ message: 'token and conversationId are required for checkout-form retrieve-result.' });
        }

        const result = await executeIyzicoProbe(env, options, (client) => client.retrieveCheckoutFormResult(token, conversationId));
        return reply.code(result.statusCode).send(result.body);
      }

      return reply.code(400).send({ message: 'action must be initialize or retrieve-result.' });
    },
  );

  app.post<{ Body: JsonRecord }>(
    '/admin/diagnostics/iyzico-marketplace/payment-detail',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      const forbidden = validateAdmin(request, reply);
      if (forbidden) {
        return forbidden;
      }

      const action = readString(request.body?.action) ?? 'retrieve';

      if (action === 'retrieve') {
        const paymentId = readString(request.body?.paymentId);
        if (!paymentId) {
          return reply.code(400).send({ message: 'paymentId is required for payment-detail retrieve.' });
        }

        const paymentConversationId = readString(request.body?.paymentConversationId) ?? undefined;
        const result = await executeIyzicoProbe(env, options, (client) => client.retrievePaymentDetail(paymentId, paymentConversationId));
        return reply.code(result.statusCode).send(result.body);
      }

      if (action === 'approve-item' || action === 'disapprove-item') {
        const paymentTransactionId = readString(request.body?.paymentTransactionId);
        if (!paymentTransactionId) {
          return reply.code(400).send({ message: 'paymentTransactionId is required for item approval actions.' });
        }

        const result = await executeIyzicoProbe(env, options, (client) =>
          action === 'approve-item'
            ? client.approvePaymentItem(paymentTransactionId)
            : client.disapprovePaymentItem(paymentTransactionId),
        );
        return reply.code(result.statusCode).send(result.body);
      }

      if (action === 'update-item') {
        const paymentTransactionId = readString(request.body?.paymentTransactionId);
        const subMerchantKey = readString(request.body?.subMerchantKey);
        const subMerchantPrice = typeof request.body?.subMerchantPrice === 'number' || typeof request.body?.subMerchantPrice === 'string'
          ? request.body.subMerchantPrice
          : null;
        if (!paymentTransactionId || !subMerchantKey || subMerchantPrice === null || subMerchantPrice === '') {
          return reply
            .code(400)
            .send({ message: 'paymentTransactionId, subMerchantKey, and subMerchantPrice are required for item update.' });
        }

        const result = await executeIyzicoProbe(env, options, (client) =>
          client.updatePaymentItem(paymentTransactionId, subMerchantKey, subMerchantPrice),
        );
        return reply.code(result.statusCode).send(result.body);
      }

      return reply.code(400).send({ message: 'action must be retrieve, approve-item, disapprove-item, or update-item.' });
    },
  );

  app.post<{ Body: JsonRecord }>(
    '/admin/diagnostics/iyzico-marketplace/refund',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      const forbidden = validateAdmin(request, reply);
      if (forbidden) {
        return forbidden;
      }

      const paymentTransactionId = readString(request.body?.paymentTransactionId);
      const price = typeof request.body?.price === 'number' || typeof request.body?.price === 'string' ? request.body.price : null;
      const currency = readString(request.body?.currency);
      if (!paymentTransactionId || price === null || price === '' || !currency) {
        return reply.code(400).send({ message: 'paymentTransactionId, price, and currency are required for refund.' });
      }

      const result = await executeIyzicoProbe(env, options, (client) =>
        client.refundPaymentTransaction(paymentTransactionId, price, currency),
      );
      return reply.code(result.statusCode).send(result.body);
    },
  );

  app.post<{ Body: JsonRecord }>(
    '/admin/diagnostics/iyzico-marketplace/cancel',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      const forbidden = validateAdmin(request, reply);
      if (forbidden) {
        return forbidden;
      }

      const paymentId = readString(request.body?.paymentId);
      if (!paymentId) {
        return reply.code(400).send({ message: 'paymentId is required for cancel.' });
      }

      const result = await executeIyzicoProbe(env, options, (client) => client.cancelPayment(paymentId));
      return reply.code(result.statusCode).send(result.body);
    },
  );
}
