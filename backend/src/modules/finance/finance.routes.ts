import type { FastifyInstance } from 'fastify';
import type { AppEnv } from '../../config/env.js';
import { createAuthMiddleware } from '../auth/auth.middleware.js';
import { createAuthService } from '../auth/auth.service.js';
import { requireVendorAccess } from '../vendor-access/vendor-access.middleware.js';
import {
  getVendorFinanceDashboard,
  getVendorFinancialProfile,
  upsertVendorFinancialProfile,
} from './finance.service.js';
import { resolvePagination } from '../../lib/pagination.js';
import type { VendorFinancialProfileUpdateDto } from './finance.types.js';

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

  app.get(
    '/admin/vendors/:vendorId/financial-profile',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Admin access required.' });
      }

      const { vendorId } = request.params as { vendorId: string };
      return getVendorFinancialProfile(vendorId);
    },
  );

  app.put(
    '/admin/vendors/:vendorId/financial-profile',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Admin access required.' });
      }

      const { vendorId } = request.params as { vendorId: string };
      try {
        return await upsertVendorFinancialProfile(vendorId, (request.body ?? {}) as VendorFinancialProfileUpdateDto);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Vendor financial profile could not be saved.';
        return reply.code(400).send({ message });
      }
    },
  );
}
