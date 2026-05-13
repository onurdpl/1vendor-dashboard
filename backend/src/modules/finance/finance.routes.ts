import type { FastifyInstance } from 'fastify';
import type { AppEnv } from '../../config/env.js';
import { createAuthMiddleware } from '../auth/auth.middleware.js';
import { createAuthService } from '../auth/auth.service.js';
import { requireVendorAccess } from '../vendor-access/vendor-access.middleware.js';
import { getVendorFinanceDashboard } from './finance.service.js';
import { resolvePagination } from '../../lib/pagination.js';

export function registerFinanceRoutes(app: FastifyInstance, env: AppEnv) {
  const authService = createAuthService(env);
  const authMiddleware = createAuthMiddleware(authService);

  app.get(
    '/finance',
    {
      preHandler: [authMiddleware.authenticateRequest, requireVendorAccess],
    },
    async (request, reply) => {
      const vendorId = request.vendorContext?.vendorId;
      if (!vendorId) {
        return reply.code(400).send({ message: 'Vendor context could not be resolved.' });
      }

      return getVendorFinanceDashboard(vendorId, resolvePagination(request.query));
    },
  );
}
