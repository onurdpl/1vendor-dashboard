import type { FastifyInstance } from 'fastify';
import type { AppEnv } from '../../config/env.js';
import { createAuthMiddleware } from '../auth/auth.middleware.js';
import { createAuthService } from '../auth/auth.service.js';
import { requireVendorAccess } from '../vendor-access/vendor-access.middleware.js';
import { prisma } from '../../db/prisma.js';
import {
  addAdminSupportTicketNote,
  addAdminSupportTicketReply,
  addVendorSupportTicketReply,
  assignSupportTicketToSelf,
  createSupportTicket,
  escalateVendorSupportTicket,
  getAdminSupportAnalytics,
  getAdminSupportTicket,
  getVendorSupportTicket,
  listAdminSupportAttentionTickets,
  listAdminSupportTickets,
  listVendorSupportTickets,
  SupportTicketError,
  unassignSupportTicket,
  updateAdminSupportTicketStatus,
} from './support.service.js';
import type {
  AddSupportTicketNoteInput,
  AddSupportTicketReplyInput,
  CreateSupportTicketInput,
  SupportTicketFilters,
  UpdateSupportTicketStatusInput,
} from './support.types.js';
import { withDashboardRouteTiming } from '../../lib/dashboard-timing.js';
import { resolvePagination } from '../../lib/pagination.js';

function sendSupportError(error: unknown, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) {
  if (error instanceof SupportTicketError) {
    return reply.code(error.statusCode).send({ message: error.message });
  }

  throw error;
}

function readAdminSupportAttentionMode(value: unknown) {
  if (value === undefined || value === null || value === false || value === 'false' || value === '0') {
    return false;
  }
  if (value === true || value === 'true' || value === '1') {
    return true;
  }
  throw new SupportTicketError('Unsupported support ticket attention filter.', 400);
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

  app.post<{ Params: { vendorId: string }; Body: CreateSupportTicketInput }>(
    '/admin/vendors/:vendorId/support-tickets',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Admin access required.' });
      }

      const vendor = await prisma.vendor.findUnique({
        where: { id: request.params.vendorId },
        select: {
          id: true,
          name: true,
          status: true,
        },
      });

      if (!vendor) {
        return reply.code(404).send({ message: 'Vendor not found.' });
      }

      try {
        return await createSupportTicket(
          request.authUser,
          {
            vendorId: vendor.id,
            vendorName: vendor.name,
            vendorStatus: vendor.status,
            role: request.authUser.role,
            accessScope: 'admin',
          },
          request.body ?? {},
        );
      } catch (error) {
        return sendSupportError(error, reply);
      }
    },
  );

  app.get<{ Querystring: SupportTicketFilters }>(
    '/support/tickets',
    {
      preHandler: [authMiddleware.authenticateRequest, requireVendorAccess],
    },
    async (request, reply) => {
      if (!request.vendorContext) {
        return reply.code(401).send({ message: 'Unauthorized' });
      }

      const vendorContext = request.vendorContext;
      return withDashboardRouteTiming('GET /support/tickets', () =>
        listVendorSupportTickets(vendorContext.vendorId, request.query ?? {}),
      );
    },
  );

  app.get<{ Params: { ticketId: string } }>(
    '/support/tickets/:ticketId',
    {
      preHandler: [authMiddleware.authenticateRequest, requireVendorAccess],
    },
    async (request, reply) => {
      if (!request.vendorContext) {
        return reply.code(401).send({ message: 'Unauthorized' });
      }

      const ticket = await getVendorSupportTicket(request.params.ticketId, request.vendorContext.vendorId);
      if (!ticket) {
        return reply.code(404).send({ message: 'Support ticket not found.' });
      }

      return ticket;
    },
  );

  app.post<{ Params: { ticketId: string }; Body: AddSupportTicketReplyInput }>(
    '/support/tickets/:ticketId/replies',
    {
      preHandler: [authMiddleware.authenticateRequest, requireVendorAccess],
    },
    async (request, reply) => {
      if (!request.authUser || !request.vendorContext) {
        return reply.code(401).send({ message: 'Unauthorized' });
      }

      try {
        return await addVendorSupportTicketReply(
          request.params.ticketId,
          request.vendorContext.vendorId,
          request.authUser,
          request.body ?? {},
        );
      } catch (error) {
        return sendSupportError(error, reply);
      }
    },
  );

  app.post<{ Params: { ticketId: string } }>(
    '/support/tickets/:ticketId/escalate',
    {
      preHandler: [authMiddleware.authenticateRequest, requireVendorAccess],
    },
    async (request, reply) => {
      if (!request.authUser || !request.vendorContext) {
        return reply.code(401).send({ message: 'Unauthorized' });
      }

      try {
        return await escalateVendorSupportTicket(
          request.params.ticketId,
          request.vendorContext.vendorId,
          request.authUser,
        );
      } catch (error) {
        return sendSupportError(error, reply);
      }
    },
  );

  app.get<{ Querystring: SupportTicketFilters }>(
    '/admin/support/tickets',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Admin access required.' });
      }

      try {
        if (readAdminSupportAttentionMode(request.query?.attention)) {
          return await withDashboardRouteTiming('GET /admin/support/tickets?attention=true', () =>
            listAdminSupportAttentionTickets(resolvePagination(request.query, { limit: 20, offset: 0 })),
          );
        }

        return await withDashboardRouteTiming('GET /admin/support/tickets', () => listAdminSupportTickets(request.query ?? {}));
      } catch (error) {
        return sendSupportError(error, reply);
      }
    },
  );

  app.get(
    '/admin/support/analytics',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Admin access required.' });
      }

      return getAdminSupportAnalytics();
    },
  );

  app.get<{ Params: { ticketId: string } }>(
    '/admin/support/tickets/:ticketId',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Admin access required.' });
      }

      const ticket = await getAdminSupportTicket(request.params.ticketId);
      if (!ticket) {
        return reply.code(404).send({ message: 'Support ticket not found.' });
      }

      return ticket;
    },
  );

  app.post<{ Params: { ticketId: string }; Body: UpdateSupportTicketStatusInput }>(
    '/admin/support/tickets/:ticketId/status',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Admin access required.' });
      }

      try {
        return await updateAdminSupportTicketStatus(request.params.ticketId, request.body ?? {});
      } catch (error) {
        return sendSupportError(error, reply);
      }
    },
  );

  app.post<{ Params: { ticketId: string }; Body: AddSupportTicketReplyInput }>(
    '/admin/support/tickets/:ticketId/replies',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Admin access required.' });
      }

      try {
        return await addAdminSupportTicketReply(request.params.ticketId, request.authUser, request.body ?? {});
      } catch (error) {
        return sendSupportError(error, reply);
      }
    },
  );

  app.post<{ Params: { ticketId: string } }>(
    '/admin/support/tickets/:ticketId/assign-self',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Admin access required.' });
      }

      try {
        return await assignSupportTicketToSelf(request.params.ticketId, request.authUser);
      } catch (error) {
        return sendSupportError(error, reply);
      }
    },
  );

  app.post<{ Params: { ticketId: string } }>(
    '/admin/support/tickets/:ticketId/unassign',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Admin access required.' });
      }

      try {
        return await unassignSupportTicket(request.params.ticketId);
      } catch (error) {
        return sendSupportError(error, reply);
      }
    },
  );

  app.post<{ Params: { ticketId: string }; Body: AddSupportTicketNoteInput }>(
    '/admin/support/tickets/:ticketId/notes',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Admin access required.' });
      }

      try {
        return await addAdminSupportTicketNote(request.params.ticketId, request.authUser, request.body ?? {});
      } catch (error) {
        return sendSupportError(error, reply);
      }
    },
  );
}
