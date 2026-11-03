import type { FastifyInstance } from 'fastify';
import type { AppEnv } from '../../config/env.js';
import { createAuthMiddleware } from '../auth/auth.middleware.js';
import { createAuthService } from '../auth/auth.service.js';
import { requireVendorAccess } from '../vendor-access/vendor-access.middleware.js';
import { readAdminVendorTargetHeader, resolveAdminVendorTarget } from '../vendor-access/admin-vendor-target.service.js';
import { getAutomationDashboard } from './automation.service.js';
import { withDashboardRouteTiming } from '../../lib/dashboard-timing.js';

export function registerAutomationRoutes(app: FastifyInstance, env: AppEnv) {
  const authService = createAuthService(env);
  const authMiddleware = createAuthMiddleware(authService);

  app.get(
    '/automation',
    {
      preHandler: [authMiddleware.authenticateRequest, async (request, reply) => {
        if (request.authUser?.role !== 'admin') {
          return requireVendorAccess(request, reply);
        }

        const targetId = readAdminVendorTargetHeader(request);
        const result = await resolveAdminVendorTarget(request, targetId);
        if (!result.ok) {
          return reply.code(result.code).send({ message: result.message });
        }

        request.vendorContext = {
          vendorId: result.vendor.id,
          vendorName: result.vendor.name,
          vendorStatus: result.vendor.status,
          role: result.actor.role,
          accessScope: 'admin',
        };
      }],
    },
    async (request, reply) => {
      if (!request.vendorContext) {
        return reply.code(400).send({ message: 'Vendor context could not be resolved.' });
      }

      const vendorContext = request.vendorContext;
      return withDashboardRouteTiming('GET /automation', () =>
        getAutomationDashboard(
          vendorContext.vendorId,
          vendorContext.vendorName,
        ),
      );
    },
  );
}
