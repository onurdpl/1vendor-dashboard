import type { FastifyInstance } from 'fastify';
import type { AppEnv } from '../../config/env.js';
import { createAuthService } from '../auth/auth.service.js';
import { createAuthMiddleware } from '../auth/auth.middleware.js';
import { requireVendorAccess } from '../vendor-access/vendor-access.middleware.js';
import { requireUnrestrictedVendorMutation } from '../vendor-access/restricted-vendor.js';
import { createFulfillmentService } from './fulfillment.service.js';
import type { UpdateAllocationTrackingBody } from './fulfillment.types.js';

export function registerFulfillmentRoutes(app: FastifyInstance, env: AppEnv) {
  const authService = createAuthService(env);
  const authMiddleware = createAuthMiddleware(authService);
  const fulfillmentService = createFulfillmentService(env);

  app.post<{ Params: { allocationId: string }; Body: UpdateAllocationTrackingBody }>(
    '/fulfillments/:allocationId/tracking',
    {
      preHandler: [authMiddleware.authenticateRequest, requireVendorAccess, requireUnrestrictedVendorMutation],
    },
    async (request, reply) => {
      if (!request.authUser || !request.vendorContext) {
        return reply.code(401).send({ message: 'Unauthorized' });
      }

      const result = await fulfillmentService.updateAllocationTracking({
        allocationId: request.params.allocationId,
        body: request.body ?? {},
        authUser: request.authUser,
        vendorContext: request.vendorContext,
      });

      if (!result.ok) {
        return reply.code(result.code).send({
          ...(result.errorCode ? { code: result.errorCode } : {}),
          message: result.message,
        });
      }

      return result;
    },
  );
}
