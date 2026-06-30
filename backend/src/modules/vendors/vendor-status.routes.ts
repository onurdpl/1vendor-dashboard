import type { FastifyInstance } from 'fastify';
import type { AppEnv } from '../../config/env.js';
import { createAuthMiddleware } from '../auth/auth.middleware.js';
import { createAuthService } from '../auth/auth.service.js';
import {
  getVendorStatus,
  updateVendorStatus,
  type VendorStatusUpdateInputDto,
} from './vendor-status.service.js';

export function registerVendorStatusRoutes(app: FastifyInstance, env: AppEnv) {
  const authService = createAuthService(env);
  const authMiddleware = createAuthMiddleware(authService);

  app.get(
    '/admin/vendors/:vendorId/status',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Admin access required.' });
      }

      const { vendorId } = request.params as { vendorId: string };
      try {
        return await getVendorStatus(vendorId);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Vendor status could not be loaded.';
        return reply.code(400).send({ message });
      }
    },
  );

  app.put(
    '/admin/vendors/:vendorId/status',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Admin access required.' });
      }

      const { vendorId } = request.params as { vendorId: string };
      try {
        return await updateVendorStatus(vendorId, (request.body ?? {}) as VendorStatusUpdateInputDto, {
          actor: {
            userId: request.authUser?.id ?? null,
            email: request.authUser?.email ?? null,
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Vendor status could not be saved.';
        return reply.code(400).send({ message });
      }
    },
  );
}
