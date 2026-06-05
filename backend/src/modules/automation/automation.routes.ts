import type { FastifyInstance } from 'fastify';
import type { AppEnv } from '../../config/env.js';
import { createAuthMiddleware } from '../auth/auth.middleware.js';
import { createAuthService } from '../auth/auth.service.js';
import { requireVendorAccess } from '../vendor-access/vendor-access.middleware.js';
import { getAutomationDashboard } from './automation.service.js';
import { withDashboardRouteTiming } from '../../lib/dashboard-timing.js';

export function registerAutomationRoutes(app: FastifyInstance, env: AppEnv) {
  const authService = createAuthService(env);
  const authMiddleware = createAuthMiddleware(authService);

  app.get(
    '/automation',
    {
      preHandler: [authMiddleware.authenticateRequest, requireVendorAccess],
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
