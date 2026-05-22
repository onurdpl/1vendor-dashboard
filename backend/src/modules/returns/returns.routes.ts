import type { FastifyInstance } from 'fastify';
import type { AppEnv } from '../../config/env.js';
import type { AuthUserContext } from '../auth/auth.types.js';
import { createAuthMiddleware } from '../auth/auth.middleware.js';
import { createAuthService } from '../auth/auth.service.js';
import { requireVendorAccess } from '../vendor-access/vendor-access.middleware.js';
import { resolveRequestVendorContext } from '../vendor-access/vendor-access.service.js';
import {
  getVendorReturnById,
  createNavlungoReturnPickupForReturn,
  listVendorReturns,
  markReturnReceived,
  type ReturnActorScope,
  ReturnReviewError,
  reviewReturn,
} from './returns.service.js';
import { resolvePagination } from '../../lib/pagination.js';
import { backfillShopifyReturnReasons } from './return-reason-backfill.service.js';
import { cleanupDuplicateReturnRecords } from './duplicate-return-cleanup.service.js';

type ReturnReasonBackfillBody = {
  dryRun?: boolean;
  limit?: number;
};

type DuplicateReturnCleanupBody = {
  dryRun?: boolean;
  limit?: number;
};

type ReturnReviewBody = {
  decision?: string;
  reason?: string;
};

type NavlungoReturnPickupBody = {
  dryRun?: boolean;
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

function sendReviewError(error: unknown, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) {
  if (error instanceof ReturnReviewError) {
    return reply.code(error.statusCode).send({ message: error.message });
  }

  throw error;
}

export function registerReturnsRoutes(app: FastifyInstance, env: AppEnv) {
  const authService = createAuthService(env);
  const authMiddleware = createAuthMiddleware(authService);

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

      return listVendorReturns(vendorId, resolvePagination(request.query));
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

      const returnRecord = await getVendorReturnById(vendorId, request.params.returnId);
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

      return backfillShopifyReturnReasons(env, request.body ?? {});
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

      return cleanupDuplicateReturnRecords(request.body ?? {});
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
        });
      } catch (error) {
        return sendReviewError(error, reply);
      }
    },
  );
}
