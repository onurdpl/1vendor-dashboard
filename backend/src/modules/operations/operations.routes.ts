import type { FastifyInstance } from 'fastify';
import type { AppEnv } from '../../config/env.js';
import { createAuthMiddleware } from '../auth/auth.middleware.js';
import { createAuthService } from '../auth/auth.service.js';
import {
  generateAdminOperationsAutomationActions,
  generateAdminOperationsSignals,
  getAdminOperationsAttentionCenter,
  getAdminOperationsQueue,
} from './operations.service.js';
import { resolvePagination } from '../../lib/pagination.js';
import { withSlowEndpointTiming } from '../../lib/performance.js';
import { withDashboardRouteTiming } from '../../lib/dashboard-timing.js';

export function registerOperationsRoutes(app: FastifyInstance, env: AppEnv) {
  const authService = createAuthService(env);
  const authMiddleware = createAuthMiddleware(authService);

  app.get(
    '/admin/operations',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      return withDashboardRouteTiming('GET /admin/operations', () =>
        withSlowEndpointTiming('GET /admin/operations', () => getAdminOperationsQueue(resolvePagination(request.query))),
      );
    },
  );

  app.get(
    '/admin/operations/attention',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      return withSlowEndpointTiming('GET /admin/operations/attention', () => getAdminOperationsAttentionCenter());
    },
  );

  app.post(
    '/admin/operations/generate-signals',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      return withDashboardRouteTiming('POST /admin/operations/generate-signals', () => generateAdminOperationsSignals());
    },
  );

  app.post(
    '/admin/operations/generate-actions',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      return withDashboardRouteTiming('POST /admin/operations/generate-actions', () =>
        generateAdminOperationsAutomationActions(),
      );
    },
  );
}
