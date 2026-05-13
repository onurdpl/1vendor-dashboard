import type { FastifyInstance } from 'fastify';
import type { AppEnv } from '../../config/env.js';
import { createAuthMiddleware } from '../auth/auth.middleware.js';
import { createAuthService } from '../auth/auth.service.js';
import { requireVendorAccess } from '../vendor-access/vendor-access.middleware.js';
import { getVendorReturnById, listVendorReturns } from './returns.service.js';
import { resolvePagination } from '../../lib/pagination.js';

export function registerReturnsRoutes(app: FastifyInstance, env: AppEnv) {
  const authService = createAuthService(env);
  const authMiddleware = createAuthMiddleware(authService);

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
}
