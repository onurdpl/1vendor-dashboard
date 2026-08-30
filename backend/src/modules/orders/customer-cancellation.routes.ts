import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppEnv } from '../../config/env.js';
import type { CustomerCancellationCreateBody } from './customer-cancellation-api.types.js';
import {
  createCustomerCancellationApiService,
  CustomerCancellationApiError,
} from './customer-cancellation-api.service.js';
import {
  createCustomerAccountSessionTokenVerifier,
  CustomerAccountAuthConfigurationError,
  CustomerAccountSessionTokenError,
} from './customer-cancellation-session-token.service.js';

const customerAccountCors = {
  origin: '*',
  credentials: false,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id'],
};

function sendCustomerCancellationError(reply: FastifyReply, error: unknown) {
  if (
    error instanceof CustomerCancellationApiError ||
    error instanceof CustomerAccountSessionTokenError ||
    error instanceof CustomerAccountAuthConfigurationError
  ) {
    return reply.status(error.statusCode).send({ code: error.code, message: error.message });
  }
  throw error;
}

export function registerCustomerCancellationRoutes(app: FastifyInstance, env: AppEnv) {
  const verifier = createCustomerAccountSessionTokenVerifier(env);
  const service = createCustomerCancellationApiService(env);

  async function authenticateCustomerAccount(request: FastifyRequest, reply: FastifyReply) {
    const authorization = request.headers.authorization;
    const match = typeof authorization === 'string' ? /^Bearer\s+([^\s]+)$/i.exec(authorization) : null;
    if (!match?.[1]) {
      return sendCustomerCancellationError(reply, new CustomerAccountSessionTokenError());
    }
    try {
      request.customerAccountSession = verifier.verifySessionToken(match[1]);
    } catch (error) {
      return sendCustomerCancellationError(reply, error);
    }
  }

  app.options(
    '/api/customer-cancellations/*',
    { config: { cors: false } },
    async (_request, reply) => reply
      .header('Access-Control-Allow-Origin', '*')
      .header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      .header('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Request-Id')
      .status(204)
      .send(),
  );

  app.get<{ Querystring: { shopifyOrderId?: string } }>(
    '/api/customer-cancellations/eligibility',
    { config: { cors: customerAccountCors }, preHandler: authenticateCustomerAccount },
    async (request, reply) => {
      try {
        if (!request.customerAccountSession) throw new CustomerAccountSessionTokenError();
        return await service.getEligibility(request.customerAccountSession, request.query.shopifyOrderId ?? '');
      } catch (error) {
        return sendCustomerCancellationError(reply, error);
      }
    },
  );

  app.post<{ Body: CustomerCancellationCreateBody }>(
    '/api/customer-cancellations/requests',
    { config: { cors: customerAccountCors }, preHandler: authenticateCustomerAccount },
    async (request, reply) => {
      try {
        if (!request.customerAccountSession) throw new CustomerAccountSessionTokenError();
        const result = await service.createCancellationRequest(request.customerAccountSession, {
          shopifyOrderId: request.body?.shopifyOrderId ?? '',
          items: (request.body?.items ?? []).map((item) => ({
            shopifyLineItemId: item.shopifyLineItemId ?? '',
            requestedQuantity: item.requestedQuantity ?? Number.NaN,
          })),
          reasonCode: request.body?.reasonCode ?? '',
          note: request.body?.note,
          idempotencyKey: request.body?.idempotencyKey ?? '',
        });
        return reply.status(result.idempotent ? 200 : 201).send(result);
      } catch (error) {
        return sendCustomerCancellationError(reply, error);
      }
    },
  );
}
