import type { FastifyInstance } from 'fastify';
import type { AppEnv } from '../../config/env.js';
import { createAuthMiddleware } from '../auth/auth.middleware.js';
import { createAuthService } from '../auth/auth.service.js';
import { requireVendorAccess } from '../vendor-access/vendor-access.middleware.js';
import { evaluateOperationalSignalsForUser, listDashboardOperationalSignals, listOperationalSignals, updateOperationalSignalStatus } from './rules.service.js';
import type { OperationalSignalLifecycleAction } from './rules.types.js';
import { withDashboardRouteTiming } from '../../lib/dashboard-timing.js';
import { resolvePagination } from '../../lib/pagination.js';

type SignalListQuery = {
  limit?: string | number;
};

type SignalDashboardListQuery = SignalListQuery & {
  offset?: string | number;
};

export function registerRulesRoutes(app: FastifyInstance, env: AppEnv) {
  const authService = createAuthService(env);
  const authMiddleware = createAuthMiddleware(authService);

  app.get<{ Querystring: SignalListQuery }>(
    '/signals',
    {
      preHandler: [authMiddleware.authenticateRequest, requireVendorAccess],
    },
    async (request) => {
      const includeInternal = request.authUser?.role === 'admin';

      return withDashboardRouteTiming('GET /signals', () =>
        listOperationalSignals({
          vendorId: request.vendorContext?.vendorId,
          includeInternal,
          limit: parseSignalLimit(request.query?.limit),
        }),
      );
    },
  );

  app.get<{ Querystring: SignalDashboardListQuery }>(
    '/signals/dashboard',
    {
      preHandler: [authMiddleware.authenticateRequest, requireVendorAccess],
    },
    async (request) => {
      const includeInternal = request.authUser?.role === 'admin';

      return withDashboardRouteTiming('GET /signals/dashboard', () =>
        listDashboardOperationalSignals({
          vendorId: request.vendorContext?.vendorId,
          includeInternal,
          ...resolvePagination(request.query, { limit: 10 }),
        }),
      );
    },
  );

  app.get(
    '/admin/signals',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      return listOperationalSignals({
        includeInternal: true,
      });
    },
  );

  app.post(
    '/signals/evaluate',
    {
      preHandler: [authMiddleware.authenticateRequest, requireVendorAccess],
    },
    async (request) => {
      const includeInternal = request.authUser?.role === 'admin';

      return withDashboardRouteTiming('POST /signals/evaluate', () =>
        evaluateOperationalSignalsForUser({
          vendorId: request.vendorContext?.vendorId,
          includeInternal,
        }),
      );
    },
  );

  app.post(
    '/admin/signals/evaluate',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      return withDashboardRouteTiming('POST /admin/signals/evaluate', () =>
        evaluateOperationalSignalsForUser({
          includeInternal: true,
        }),
      );
    },
  );

  app.post<{ Params: { signalId: string }; Body: { action?: OperationalSignalLifecycleAction } }>(
    '/admin/signals/:signalId/lifecycle',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      const action = request.body?.action;
      if (action !== 'acknowledge' && action !== 'resolve' && action !== 'ignore') {
        return reply.code(400).send({ message: 'Unsupported signal lifecycle action.' });
      }

      const signal = await updateOperationalSignalStatus(request.params.signalId, action);
      if (!signal) {
        return reply.code(404).send({ message: 'Signal not found.' });
      }

      return signal;
    },
  );
}

function parseSignalLimit(value: unknown) {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }

  return Math.floor(parsed);
}
