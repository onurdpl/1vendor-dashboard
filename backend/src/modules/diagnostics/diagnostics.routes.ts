import type { FastifyInstance } from 'fastify';
import type { AppEnv } from '../../config/env.js';
import { createAuthMiddleware } from '../auth/auth.middleware.js';
import { createAuthService } from '../auth/auth.service.js';
import {
  getWebhookDiagnosticById,
  getReturnVisibilityDiagnostic,
  getReconciliationDiagnostics,
  listSyncDiagnostics,
  listWebhookDiagnostics,
  recoverWebhookEvent,
  replayWebhookEvent,
  retryOperationalJob,
} from './diagnostics.service.js';
import { resolvePagination } from '../../lib/pagination.js';
import { runKargonomiLocationLookupDiagnostics } from '../shipping/kargonomi-location-lookup-probe.js';
import { runNavlungoCreatePostProbeDiagnostics, validateNavlungoCreatePostProbeEnv } from '../shipping/navlungo-create-post-probe.js';
import { runNavlungoAuthDiagnostics } from '../shipping/navlungo-provider.adapter.js';

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

      return listWebhookDiagnostics(resolvePagination(request.query));
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

  app.get(
    '/admin/diagnostics/kargonomi/location-lookup',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      return runKargonomiLocationLookupDiagnostics(env);
    },
  );

  app.get(
    '/admin/diagnostics/navlungo/auth',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      return runNavlungoAuthDiagnostics(env);
    },
  );

  app.post<{ Body: { confirm?: string } }>(
    '/admin/diagnostics/navlungo/create-post-probe',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      if (request.body?.confirm !== 'YES') {
        return reply.code(400).send({ message: 'UI confirmation is required before running the Navlungo Create Post probe.' });
      }

      const validation = validateNavlungoCreatePostProbeEnv(env);
      if (!validation.ok) {
        return reply.code(400).send({ message: validation.reason, diagnostics: validation.diagnostics });
      }

      try {
        return await runNavlungoCreatePostProbeDiagnostics({ env });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Navlungo Create Post probe failed.';
        return reply.code(502).send({ message });
      }
    },
  );

  app.get<{ Params: { shopifyOrderId: string } }>(
    '/admin/diagnostics/returns/order/:shopifyOrderId',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      return getReturnVisibilityDiagnostic(request.params.shopifyOrderId);
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
