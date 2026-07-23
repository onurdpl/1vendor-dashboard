import type { FastifyInstance } from 'fastify';
import type { AppEnv } from '../../config/env.js';
import { createAuthMiddleware } from '../auth/auth.middleware.js';
import { createAuthService } from '../auth/auth.service.js';
import {
  generateAdminOperationsAutomationActions,
  generateAdminOperationsSignals,
  getAdminOperationsAttentionCenter,
  getAdminOperationsQueue,
  getAdminOperationsQueueSummary,
} from './operations.service.js';
import { resolvePagination } from '../../lib/pagination.js';
import { withSlowEndpointTiming } from '../../lib/performance.js';
import { withDashboardRouteTiming } from '../../lib/dashboard-timing.js';
import type { OperationsQueueTypeFilter } from './operations.types.js';

const OPERATIONS_QUEUE_TYPE_FILTER_ERROR =
  'type must be vendor_blocked, awaiting_shipment, return_review, finance_review, or finance_integrity_alert.';

function resolveOperationsQueueTypeFilter(query: unknown): OperationsQueueTypeFilter | undefined {
  const rawType = (query as { type?: unknown } | undefined)?.type;
  if (rawType === undefined || rawType === null || rawType === '') {
    return undefined;
  }
  if (typeof rawType !== 'string') {
    throw new Error(OPERATIONS_QUEUE_TYPE_FILTER_ERROR);
  }

  const normalized = rawType.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (
    normalized !== 'vendor_blocked' &&
    normalized !== 'awaiting_shipment' &&
    normalized !== 'return_review' &&
    normalized !== 'finance_review' &&
    normalized !== 'finance_integrity_alert'
  ) {
    throw new Error(OPERATIONS_QUEUE_TYPE_FILTER_ERROR);
  }

  return normalized;
}

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

      let type: OperationsQueueTypeFilter | undefined;
      try {
        type = resolveOperationsQueueTypeFilter(request.query);
      } catch (error) {
        return reply.code(400).send({ message: error instanceof Error ? error.message : 'Unsupported operations queue type filter.' });
      }
      const pagination = resolvePagination(request.query);

      return withDashboardRouteTiming('GET /admin/operations', () =>
        withSlowEndpointTiming('GET /admin/operations', () => getAdminOperationsQueue({ ...pagination, type })),
      );
    },
  );

  app.get(
    '/admin/operations/summary',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      return withDashboardRouteTiming('GET /admin/operations/summary', () =>
        withSlowEndpointTiming('GET /admin/operations/summary', () => getAdminOperationsQueueSummary()),
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
