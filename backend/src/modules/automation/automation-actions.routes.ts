import type { FastifyInstance } from 'fastify';
import type { AppEnv } from '../../config/env.js';
import { createAuthMiddleware } from '../auth/auth.middleware.js';
import { createAuthService } from '../auth/auth.service.js';
import {
  executeAutomationAction,
  listAutomationActions,
  automationActionEnums,
} from './automation-actions.service.js';
import type { AutomationActionExecutionMode } from './automation-actions.types.js';

function isExecutionMode(value: unknown): value is AutomationActionExecutionMode {
  return value === 'execute_safe' || value === 'mark_handled' || value === 'skip' || value === 'cancel';
}

export function registerAutomationActionRoutes(app: FastifyInstance, env: AppEnv) {
  const authService = createAuthService(env);
  const authMiddleware = createAuthMiddleware(authService);

  app.get(
    '/admin/automation-actions',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      const query = request.query as { status?: string } | undefined;
      const rawStatus = query?.status?.trim().toUpperCase();
      const status = rawStatus && rawStatus in automationActionEnums.status
        ? automationActionEnums.status[rawStatus as keyof typeof automationActionEnums.status]
        : undefined;

      return listAutomationActions({
        status,
        includeNotifications: true,
      });
    },
  );

  app.post<{ Params: { actionId: string }; Body: { execution?: AutomationActionExecutionMode } }>(
    '/admin/automation-actions/:actionId/execute',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      const execution = request.body?.execution ?? 'mark_handled';
      if (!isExecutionMode(execution)) {
        return reply.code(400).send({ message: 'Unsupported automation action execution mode.' });
      }

      const action = await executeAutomationAction({
        actionId: request.params.actionId,
        execution,
        actorUserId: request.authUser.id,
      });
      if (!action) {
        return reply.code(404).send({ message: 'Automation action not found.' });
      }

      return action;
    },
  );
}
