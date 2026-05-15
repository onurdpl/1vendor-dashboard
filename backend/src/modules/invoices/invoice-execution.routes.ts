import type { FastifyInstance } from 'fastify';
import type { AppEnv } from '../../config/env.js';
import { createAuthMiddleware } from '../auth/auth.middleware.js';
import { createAuthService } from '../auth/auth.service.js';
import {
  createInvoiceExecution,
  getInvoiceExecutionResponseSummary,
  previewInvoiceExecutionPayload,
  retryInvoiceExecution,
} from './invoice-execution.service.js';
import type { CreateInvoiceExecutionDto, PreviewInvoiceExecutionDto } from './invoice-execution.types.js';

export function registerInvoiceExecutionRoutes(app: FastifyInstance, env: AppEnv) {
  const authService = createAuthService(env);
  const authMiddleware = createAuthMiddleware(authService);

  app.post(
    '/admin/invoices/preview',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Admin access required.' });
      }

      try {
        return await previewInvoiceExecutionPayload((request.body ?? {}) as PreviewInvoiceExecutionDto, {
          env,
        });
      } catch (error) {
        return reply.code(400).send({
          message: error instanceof Error ? error.message : 'Invoice payload preview could not be created.',
        });
      }
    },
  );

  app.post(
    '/admin/invoices/create',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Admin access required.' });
      }

      try {
        return await createInvoiceExecution((request.body ?? {}) as CreateInvoiceExecutionDto, {
          env,
        });
      } catch (error) {
        return reply.code(400).send({
          message: error instanceof Error ? error.message : 'Invoice execution could not be created.',
        });
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    '/admin/invoices/:id/retry',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Admin access required.' });
      }

      try {
        return await retryInvoiceExecution(request.params.id, {
          env,
        });
      } catch (error) {
        return reply.code(400).send({
          message: error instanceof Error ? error.message : 'Invoice execution could not be retried.',
        });
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    '/admin/invoices/:id/response-summary',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Admin access required.' });
      }

      try {
        return await getInvoiceExecutionResponseSummary(request.params.id);
      } catch (error) {
        return reply.code(404).send({
          message: error instanceof Error ? error.message : 'Invoice execution response summary could not be loaded.',
        });
      }
    },
  );
}
