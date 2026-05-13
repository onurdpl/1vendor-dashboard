import type { FastifyInstance } from 'fastify';
import type { AppEnv } from '../../config/env.js';
import { createAuthMiddleware } from '../auth/auth.middleware.js';
import { createAuthService } from '../auth/auth.service.js';
import { createReconciliationService } from './reconciliation.service.js';

export function registerReconciliationRoutes(app: FastifyInstance, env: AppEnv) {
  const authService = createAuthService(env);
  const authMiddleware = createAuthMiddleware(authService);
  const reconciliationService = createReconciliationService(env);

  app.post<{ Params: { allocationId: string } }>(
    '/admin/reconciliation/orders/:allocationId',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      const result = await reconciliationService.reconcileAllocation(request.params.allocationId);
      if (!result) {
        return reply.code(404).send({ message: 'Allocation not found or missing Shopify order linkage.' });
      }

      return result;
    },
  );

  app.post<{ Params: { shopifyOrderId: string } }>(
    '/admin/reconciliation/shopify-order/:shopifyOrderId',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      const result = await reconciliationService.reconcileShopifyOrder(request.params.shopifyOrderId);
      if (!result) {
        return reply.code(404).send({ message: 'Shopify order not found.' });
      }

      return result;
    },
  );
}
