import type { FastifyInstance } from 'fastify';
import type { AppEnv } from '../../config/env.js';
import { createAuthMiddleware } from '../auth/auth.middleware.js';
import { createAuthService } from '../auth/auth.service.js';
import {
  getWebhookDiagnosticById,
  getReconciliationDiagnostics,
  listSyncDiagnostics,
  listWebhookDiagnostics,
  recoverWebhookEvent,
  replayWebhookEvent,
  retryOperationalJob,
} from './diagnostics.service.js';

export function registerDiagnosticsRoutes(app: FastifyInstance, env: AppEnv) {
  const authService = createAuthService(env);
  const authMiddleware = createAuthMiddleware(authService);

  app.get(
    '/admin/diagnostics/webhooks',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      return listWebhookDiagnostics();
    },
  );

  app.get<{ Params: { webhookEventId: string } }>(
    '/admin/diagnostics/webhooks/:webhookEventId',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      const event = await getWebhookDiagnosticById(request.params.webhookEventId);
      if (!event) {
        return reply.code(404).send({ message: 'Webhook event not found.' });
      }

      return event;
    },
  );

  app.get(
    '/admin/diagnostics/sync-events',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      return listSyncDiagnostics();
    },
  );

  app.get(
    '/admin/diagnostics/reconciliation',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      return getReconciliationDiagnostics();
    },
  );

  app.post<{ Params: { webhookEventId: string } }>(
    '/admin/diagnostics/webhooks/:webhookEventId/replay',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      const result = await replayWebhookEvent(env, request.params.webhookEventId);
      if (!result.ok) {
        return reply.code(result.statusCode).send(result.response);
      }

      return reply.code(202).send(result.response);
    },
  );

  app.post<{ Params: { webhookEventId: string } }>(
    '/admin/diagnostics/webhooks/:webhookEventId/recover',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      const result = await recoverWebhookEvent(env, request.params.webhookEventId);
      if (!result.ok) {
        return reply.code(result.statusCode).send(result.response);
      }

      return reply.code(202).send(result.response);
    },
  );

  app.post<{ Params: { operationalJobId: string } }>(
    '/admin/diagnostics/jobs/:operationalJobId/retry',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      const result = await retryOperationalJob(env, request.params.operationalJobId);
      if (!result.ok) {
        return reply.code(result.statusCode).send(result.response);
      }

      return reply.code(202).send(result.response);
    },
  );
}
