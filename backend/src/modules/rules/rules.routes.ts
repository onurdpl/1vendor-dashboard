import type { FastifyInstance } from 'fastify';
import type { AppEnv } from '../../config/env.js';
import { createAuthMiddleware } from '../auth/auth.middleware.js';
import { createAuthService } from '../auth/auth.service.js';
import { requireVendorAccess } from '../vendor-access/vendor-access.middleware.js';
import { listOperationalSignals, updateOperationalSignalStatus } from './rules.service.js';
import type { OperationalSignalLifecycleAction } from './rules.types.js';

export function registerRulesRoutes(app: FastifyInstance, env: AppEnv) {
  const authService = createAuthService(env);
  const authMiddleware = createAuthMiddleware(authService);

  app.get(
    '/signals',
    {
      preHandler: [authMiddleware.authenticateRequest, requireVendorAccess],
    },
    async (request) => {
      const includeInternal = request.authUser?.role === 'admin';

      return listOperationalSignals({
        vendorId: request.vendorContext?.vendorId,
        includeInternal,
      });
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
