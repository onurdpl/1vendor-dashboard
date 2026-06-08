import type { FastifyInstance } from 'fastify';
import type { AppEnv } from '../../config/env.js';
import type { AuthUserContext } from '../auth/auth.types.js';
import { createAuthMiddleware } from '../auth/auth.middleware.js';
import { createAuthService } from '../auth/auth.service.js';
import { requireVendorAccess } from '../vendor-access/vendor-access.middleware.js';
import { resolveRequestVendorContext } from '../vendor-access/vendor-access.service.js';
import {
  getVendorReturnById,
  createKargonomiReturnShipmentForReturn,
  createNavlungoReturnPickupForReturn,
  listVendorDashboardReturns,
  listVendorReturns,
  markReturnReceived,
  previewKargonomiReturnShipmentForReturn,
  type ReturnActorScope,
  ReturnReviewError,
  reviewReturn,
  saveNavlungoReturnPickupAddressCompletion,
  syncNavlungoReturnPickupStatusForReturn,
} from './returns.service.js';
import { resolvePagination } from '../../lib/pagination.js';
import { withSlowEndpointTiming } from '../../lib/performance.js';
import { backfillShopifyReturnReasons } from './return-reason-backfill.service.js';
import { cleanupDuplicateReturnRecords } from './duplicate-return-cleanup.service.js';
import { createShopifyAdminService } from '../shopify/shopify-admin.service.js';
import { withDashboardRouteTiming } from '../../lib/dashboard-timing.js';

type ReturnReasonBackfillBody = {
  dryRun?: boolean;
  limit?: unknown;
};

type DuplicateReturnCleanupBody = {
  dryRun?: boolean;
  limit?: unknown;
};

type ReturnReviewBody = {
  decision?: string;
  reason?: string;
};

type NavlungoReturnPickupBody = {
  dryRun?: boolean;
  apiVersionOverride?: 'current' | 'v2' | 'v2.1';
  endpointVersionOverride?: 'current' | 'v2' | 'v2.1';
  carrierOverride?: 'current' | '9' | '10';
  carrierIdOverride?: 'current' | '9' | '10';
  endpointPathOverride?: '/post/create' | '/post/return';
  diagnosticConfirm?: 'YES';
  customerOverrides?: {
    name?: string;
    phone?: string;
    email?: string;
    country?: string;
    postcode?: string;
    city?: string;
    district?: string;
    address?: string;
  };
};

type NavlungoReturnPickupAddressCompletionBody = {
  customerOverrides?: NavlungoReturnPickupBody['customerOverrides'];
};

function sendReviewError(error: unknown, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) {
  if (error instanceof ReturnReviewError) {
    return reply.code(error.statusCode).send({
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    });
  }

  throw error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readReturnAdminBody(value: unknown) {
  return isRecord(value) ? value : {};
}

function validateReturnAdminLimit(body: Record<string, unknown>, max: number) {
  if (!Object.prototype.hasOwnProperty.call(body, 'limit') || body.limit === undefined) {
    return { ok: true as const };
  }

  if (
    typeof body.limit !== 'number' ||
    !Number.isFinite(body.limit) ||
    !Number.isInteger(body.limit) ||
    body.limit < 1 ||
    body.limit > max
  ) {
    return {
      ok: false as const,
      message: `limit must be an integer between 1 and ${max}.`,
    };
  }

  return { ok: true as const };
}

function buildReturnAdminOptions(body: Record<string, unknown>) {
  const options: { dryRun?: boolean; limit?: number } = {};
  if (typeof body.dryRun === 'boolean') {
    options.dryRun = body.dryRun;
  }
  if (typeof body.limit === 'number') {
    options.limit = body.limit;
  }

  return options;
}

export function registerReturnsRoutes(app: FastifyInstance, env: AppEnv) {
  const authService = createAuthService(env);
  const authMiddleware = createAuthMiddleware(authService);
  const shopifyAdminService = createShopifyAdminService(env);

  async function resolveReturnActor(
    request: { authUser?: AuthUserContext; headers: { [key: string]: string | string[] | undefined } },
    reply: { code: (status: number) => { send: (body: unknown) => unknown } },
  ): Promise<{ ok: true; actor: ReturnActorScope } | { ok: false; response: unknown }> {
    const authUser = request.authUser;
    if (!authUser) {
      return { ok: false, response: reply.code(401).send({ message: 'Unauthorized' }) };
    }

    if (authUser.role === 'admin') {
      return { ok: true, actor: { role: authUser.role, vendorId: null } };
    }

    const result = await resolveRequestVendorContext(authUser, request.headers['x-vendor-id']);
    if (!result.ok) {
      return { ok: false, response: reply.code(result.code).send({ message: result.message }) };
    }

    return { ok: true, actor: { role: authUser.role, vendorId: result.context.vendorId } };
  }

  app.get(
    '/returns',
    {
      preHandler: [authMiddleware.authenticateRequest, requireVendorAccess],
    },
    async (request) => {
      const vendorId = request.vendorContext?.vendorId;
      if (!vendorId) {
        return [];
      }

      return withDashboardRouteTiming('GET /returns', () =>
        withSlowEndpointTiming('GET /returns', () => listVendorReturns(vendorId, resolvePagination(request.query))),
      );
    },
  );

  app.get(
    '/returns/dashboard',
    {
      preHandler: [authMiddleware.authenticateRequest, requireVendorAccess],
    },
    async (request) => {
      const vendorId = request.vendorContext?.vendorId;
      if (!vendorId) {
        return [];
      }

      return withDashboardRouteTiming('GET /returns/dashboard', () =>
        listVendorDashboardReturns(vendorId, resolvePagination(request.query, { limit: 10 })),
      );
    },
  );

  app.get<{ Params: { returnId: string } }>(
    '/returns/:returnId',
    {
      preHandler: [authMiddleware.authenticateRequest, requireVendorAccess],
    },
    async (request, reply) => {
      const vendorId = request.vendorContext?.vendorId;
      if (!vendorId) {
        return reply.code(400).send({ message: 'Vendor context could not be resolved.' });
      }

      const returnRecord = await withSlowEndpointTiming('GET /returns/:returnId', () =>
        getVendorReturnById(vendorId, request.params.returnId, {
          shopifyAdminService,
          deferImageBackfill: true,
        }),
      );
      if (!returnRecord) {
        return reply.code(404).send({ message: 'Return record not found.' });
      }

      return returnRecord;
    },
  );

  app.post<{ Body: ReturnReasonBackfillBody }>(
    '/admin/returns/reasons/backfill',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Admin access required.' });
      }

      const body = readReturnAdminBody(request.body);
      const limitValidation = validateReturnAdminLimit(body, 200);
      if (!limitValidation.ok) {
        return reply.code(400).send({ message: limitValidation.message });
      }

      return backfillShopifyReturnReasons(env, buildReturnAdminOptions(body));
    },
  );

  app.post<{ Body: DuplicateReturnCleanupBody }>(
    '/admin/returns/duplicates/cleanup',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Admin access required.' });
      }

      const body = readReturnAdminBody(request.body);
      const limitValidation = validateReturnAdminLimit(body, 500);
      if (!limitValidation.ok) {
        return reply.code(400).send({ message: limitValidation.message });
      }

      return cleanupDuplicateReturnRecords(buildReturnAdminOptions(body));
    },
  );

  app.post<{ Params: { returnId: string } }>(
    '/returns/:returnId/mark-received',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      const actor = await resolveReturnActor(request, reply);
      if (!actor.ok) {
        return actor.response;
      }

      try {
        return await markReturnReceived(request.params.returnId, actor.actor);
      } catch (error) {
        return sendReviewError(error, reply);
      }
    },
  );

  app.post<{ Params: { returnId: string }; Body: ReturnReviewBody }>(
    '/returns/:returnId/review',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      const actor = await resolveReturnActor(request, reply);
      if (!actor.ok) {
        return actor.response;
      }

      const decision = request.body?.decision;
      if (decision !== 'approved' && decision !== 'rejected') {
        return reply.code(400).send({ message: 'Return review decision must be approved or rejected.' });
      }

      try {
        return await reviewReturn(request.params.returnId, actor.actor, {
          decision,
          reason: request.body?.reason,
        });
      } catch (error) {
        return sendReviewError(error, reply);
      }
    },
  );

  app.post<{ Params: { returnId: string }; Body: NavlungoReturnPickupBody }>(
    '/returns/:returnId/navlungo-return-pickup',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      const actor = await resolveReturnActor(request, reply);
      if (!actor.ok) {
        return actor.response;
      }

      try {
        return await createNavlungoReturnPickupForReturn(request.params.returnId, actor.actor, env, {
          dryRun: request.body?.dryRun === true,
          customerOverrides: request.body?.customerOverrides,
          apiVersionOverride: request.body?.apiVersionOverride,
          endpointVersionOverride: request.body?.endpointVersionOverride,
          carrierOverride: request.body?.carrierOverride,
          carrierIdOverride: request.body?.carrierIdOverride,
          endpointPathOverride: request.body?.endpointPathOverride,
          diagnosticConfirm: request.body?.diagnosticConfirm,
        });
      } catch (error) {
        return sendReviewError(error, reply);
      }
    },
  );

  app.get<{ Params: { returnId: string } }>(
    '/returns/:returnId/kargonomi-return-preview',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      const actor = await resolveReturnActor(request, reply);
      if (!actor.ok) {
        return actor.response;
      }

      try {
        return await previewKargonomiReturnShipmentForReturn(request.params.returnId, actor.actor, { env });
      } catch (error) {
        return sendReviewError(error, reply);
      }
    },
  );

  app.post<{ Params: { returnId: string } }>(
    '/returns/:returnId/kargonomi-create-shipment',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      const actor = await resolveReturnActor(request, reply);
      if (!actor.ok) {
        return actor.response;
      }

      try {
        return await createKargonomiReturnShipmentForReturn(request.params.returnId, actor.actor, env);
      } catch (error) {
        return sendReviewError(error, reply);
      }
    },
  );

  app.post<{ Params: { returnId: string }; Body: NavlungoReturnPickupAddressCompletionBody }>(
    '/returns/:returnId/navlungo-return-pickup/address-completion',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      const actor = await resolveReturnActor(request, reply);
      if (!actor.ok) {
        return actor.response;
      }

      try {
        return await saveNavlungoReturnPickupAddressCompletion(
          request.params.returnId,
          actor.actor,
          env,
          request.body?.customerOverrides ?? {},
        );
      } catch (error) {
        return sendReviewError(error, reply);
      }
    },
  );

  app.post<{ Params: { returnId: string } }>(
    '/returns/:returnId/navlungo-return-status-sync',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      const actor = await resolveReturnActor(request, reply);
      if (!actor.ok) {
        return actor.response;
      }

      try {
        return await syncNavlungoReturnPickupStatusForReturn(request.params.returnId, actor.actor, env);
      } catch (error) {
        return sendReviewError(error, reply);
      }
    },
  );
}
