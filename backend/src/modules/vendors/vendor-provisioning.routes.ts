import type { FastifyInstance } from 'fastify';
import type { AppEnv } from '../../config/env.js';
import { createAuthMiddleware } from '../auth/auth.middleware.js';
import { createAuthService } from '../auth/auth.service.js';
import {
  provisionVendor,
  VendorProvisioningError,
  type VendorProvisioningInputDto,
} from './vendor-provisioning.service.js';

export function registerVendorProvisioningRoutes(app: FastifyInstance, env: AppEnv) {
  const authService = createAuthService(env);
  const authMiddleware = createAuthMiddleware(authService);

  app.post(
    '/admin/vendors/provision',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Admin access required.' });
      }

      try {
        const result = await provisionVendor((request.body ?? {}) as VendorProvisioningInputDto, {
          actor: {
            userId: request.authUser.id,
            email: request.authUser.email,
          },
        });
        return reply.code(201).send(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Vendor could not be provisioned.';
        const statusCode = error instanceof VendorProvisioningError ? error.statusCode : 400;
        return reply.code(statusCode).send({ message });
      }
    },
  );
}
