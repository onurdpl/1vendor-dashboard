import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppEnv } from '../../config/env.js';
import { createAuthMiddleware } from '../auth/auth.middleware.js';
import { createAuthService } from '../auth/auth.service.js';
import { requireVendorAccess } from '../vendor-access/vendor-access.middleware.js';
import {
  getVendorBillingLegalSelfView,
  getVendorBillingProfile,
  upsertVendorBillingProfile,
  type VendorBillingProfileInputDto,
} from './vendor-billing-profile.service.js';

async function requireVendorRole(request: FastifyRequest, reply: FastifyReply) {
  if (request.authUser?.role !== 'vendor') {
    return reply.code(403).send({ message: 'Vendor access required.' });
  }
}

export function registerVendorBillingProfileRoutes(app: FastifyInstance, env: AppEnv) {
  const authService = createAuthService(env);
  const authMiddleware = createAuthMiddleware(authService);

  app.get(
    '/vendor/billing-profile',
    {
      preHandler: [authMiddleware.authenticateRequest, requireVendorRole, requireVendorAccess],
    },
    async (request, reply) => {
      const vendorId = request.vendorContext?.vendorId;
      if (!vendorId) {
        return reply.code(403).send({ message: 'Vendor context is required.' });
      }

      try {
        return await getVendorBillingLegalSelfView(vendorId);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Vendor billing profile could not be loaded.';
        return reply.code(400).send({ message });
      }
    },
  );

  app.get(
    '/admin/vendors/:vendorId/billing-profile',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Admin access required.' });
      }

      const { vendorId } = request.params as { vendorId: string };
      try {
        return await getVendorBillingProfile(vendorId);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Vendor billing profile could not be loaded.';
        return reply.code(400).send({ message });
      }
    },
  );

  app.put(
    '/admin/vendors/:vendorId/billing-profile',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Admin access required.' });
      }

      const { vendorId } = request.params as { vendorId: string };
      try {
        return await upsertVendorBillingProfile(vendorId, (request.body ?? {}) as VendorBillingProfileInputDto, {
          actor: {
            userId: request.authUser?.id ?? null,
            email: request.authUser?.email ?? null,
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Vendor billing profile could not be saved.';
        return reply.code(400).send({ message });
      }
    },
  );
}
