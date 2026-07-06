import type { FastifyInstance } from 'fastify';
import type { AppEnv } from '../../config/env.js';
import { createAuthMiddleware } from '../auth/auth.middleware.js';
import { createAuthService } from '../auth/auth.service.js';
import {
  listAdminVendorDirectory,
  VendorDirectoryError,
  type VendorDirectoryQueryDto,
} from './vendor-directory.service.js';

export function registerVendorDirectoryRoutes(app: FastifyInstance, env: AppEnv) {
  const authService = createAuthService(env);
  const authMiddleware = createAuthMiddleware(authService);

  app.get(
    '/admin/vendors',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Admin access required.' });
      }

      try {
        return await listAdminVendorDirectory((request.query ?? {}) as VendorDirectoryQueryDto);
      } catch (error) {
        if (error instanceof VendorDirectoryError) {
          return reply.code(error.statusCode).send({ message: error.message });
        }

        return reply.code(500).send({ message: 'Vendor directory could not be loaded.' });
      }
    },
  );
}
