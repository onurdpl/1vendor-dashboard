import type { FastifyInstance } from 'fastify';
import type { AppEnv } from '../../config/env.js';
import { withDashboardRouteTiming } from '../../lib/dashboard-timing.js';
import { withSlowEndpointTiming } from '../../lib/performance.js';
import { createAuthMiddleware } from '../auth/auth.middleware.js';
import { createAuthService } from '../auth/auth.service.js';
import { requireVendorAccess } from '../vendor-access/vendor-access.middleware.js';
import { getDashboardOperationalSummary } from './dashboard-summary.service.js';

export function registerDashboardSummaryRoutes(app: FastifyInstance, env: AppEnv) {
  const authService = createAuthService(env);
  const authMiddleware = createAuthMiddleware(authService);

  app.get(
    '/dashboard/summary',
    {
      preHandler: [authMiddleware.authenticateRequest, requireVendorAccess],
    },
    async (request, reply) => {
      const vendorId = request.vendorContext?.vendorId;
      if (!vendorId) {
        return reply.code(400).send({ message: 'Vendor context could not be resolved.' });
      }

      return withDashboardRouteTiming('GET /dashboard/summary', () =>
        withSlowEndpointTiming('GET /dashboard/summary', () => getDashboardOperationalSummary(vendorId)),
      );
    },
  );
}
