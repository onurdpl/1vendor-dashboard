import type { FastifyInstance } from 'fastify';
import type { AppEnv } from '../../config/env.js';
import { createAuthMiddleware } from '../auth/auth.middleware.js';
import { createAuthService } from '../auth/auth.service.js';
import { listVendorProfileAuditLogs } from './vendor-profile-audit-log.service.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readOptionalQueryString(query: unknown, key: string) {
  if (!isRecord(query)) {
    return null;
  }
  const value = query[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readOptionalLimit(query: unknown) {
  const value = readOptionalQueryString(query, 'limit');
  if (!value) {
    return 50;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 50;
  }
  return Math.max(1, Math.min(100, Math.round(parsed)));
}

export function registerVendorProfileAuditLogRoutes(app: FastifyInstance, env: AppEnv) {
  const authService = createAuthService(env);
  const authMiddleware = createAuthMiddleware(authService);

  app.get(
    '/admin/vendors/:vendorId/profile-audit-logs',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Admin access required.' });
      }

      const { vendorId } = request.params as { vendorId: string };
      try {
        return await listVendorProfileAuditLogs(vendorId, {
          section: readOptionalQueryString(request.query, 'section'),
          limit: readOptionalLimit(request.query),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Vendor profile audit logs could not be loaded.';
        return reply.code(400).send({ message });
      }
    },
  );
}
