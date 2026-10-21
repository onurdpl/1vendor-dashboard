import type { FastifyInstance } from 'fastify';
import type { AppEnv } from '../../config/env.js';
import { createAuthMiddleware } from '../auth/auth.middleware.js';
import { createAuthService } from '../auth/auth.service.js';
import { getVendorPasswordResetOperation, listVendorLoginUsers, resetVendorUserPassword,
  VendorPasswordResetError } from './vendor-password-reset.service.js';

export function registerVendorPasswordResetRoutes(app: FastifyInstance, env: AppEnv) {
  const authMiddleware = createAuthMiddleware(createAuthService(env));
  const preHandler = [authMiddleware.authenticateRequest];

  function handleError(error: unknown, reply: { code: (status: number) => { send: (value: unknown) => unknown } }) {
    if (error instanceof VendorPasswordResetError) {
      return reply.code(error.statusCode).send({ code: error.code });
    }
    return reply.code(503).send({ code: 'reset_status_unknown' });
  }

  app.get<{ Params: { vendorId: string } }>('/admin/vendors/:vendorId/login-users', { preHandler }, async (request, reply) => {
    if (request.authUser?.role !== 'admin') return reply.code(403).send({ code: 'admin_required' });
    try { return await listVendorLoginUsers(request.params.vendorId); }
    catch (error) { return handleError(error, reply); }
  });

  app.get<{ Params: { vendorId: string; operationId: string } }>(
    '/admin/vendors/:vendorId/password-reset-operations/:operationId', { preHandler }, async (request, reply) => {
      if (request.authUser?.role !== 'admin') return reply.code(403).send({ code: 'admin_required' });
      try { return await getVendorPasswordResetOperation(request.params.vendorId, request.params.operationId); }
      catch (error) { return handleError(error, reply); }
    },
  );

  app.post<{ Params: { vendorId: string; userId: string }; Body: { operationId?: unknown; expectedCredentialVersion?: unknown } }>(
    '/admin/vendors/:vendorId/users/:userId/password-reset', { preHandler }, async (request, reply) => {
      if (request.authUser?.role !== 'admin') return reply.code(403).send({ code: 'admin_required' });
      reply.header('Cache-Control', 'no-store');
      try {
        const result = await resetVendorUserPassword({
          vendorId: request.params.vendorId,
          targetUserId: request.params.userId,
          actorAdminUserId: request.authUser.id,
          operationId: request.body?.operationId as string,
          expectedCredentialVersion: request.body?.expectedCredentialVersion as number,
        });
        return reply.code(201).send(result);
      } catch (error) { return handleError(error, reply); }
    },
  );
}
