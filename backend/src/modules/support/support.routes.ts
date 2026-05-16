import type { FastifyInstance } from 'fastify';
import type { AppEnv } from '../../config/env.js';
import { createAuthMiddleware } from '../auth/auth.middleware.js';
import { createAuthService } from '../auth/auth.service.js';
import { requireVendorAccess } from '../vendor-access/vendor-access.middleware.js';
import {
  createSupportTicket,
  listAdminSupportTickets,
  SupportTicketError,
} from './support.service.js';
import type { CreateSupportTicketInput } from './support.types.js';

function sendSupportError(error: unknown, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) {
  if (error instanceof SupportTicketError) {
    return reply.code(error.statusCode).send({ message: error.message });
  }

  throw error;
}

export function registerSupportRoutes(app: FastifyInstance, env: AppEnv) {
  const authService = createAuthService(env);
  const authMiddleware = createAuthMiddleware(authService);

  app.post<{ Body: CreateSupportTicketInput }>(
    '/support/tickets',
    {
      preHandler: [authMiddleware.authenticateRequest, requireVendorAccess],
    },
    async (request, reply) => {
      if (!request.authUser || !request.vendorContext) {
        return reply.code(401).send({ message: 'Unauthorized' });
      }

      try {
        return await createSupportTicket(request.authUser, request.vendorContext, request.body ?? {});
      } catch (error) {
        return sendSupportError(error, reply);
      }
    },
  );

  app.get(
    '/admin/support/tickets',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Admin access required.' });
      }

      return listAdminSupportTickets();
    },
  );
}
