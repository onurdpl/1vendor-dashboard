import type { FastifyInstance } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { prisma } from '../../db/prisma.js';
import {
  authenticateVendorIntegrationRequest,
  requireVendorIntegrationScope,
  writeVendorIntegrationAuditLog,
} from './vendor-integration.auth.js';
import { listVendorIntegrationOrders, type VendorIntegrationOrdersQuery } from './vendor-integration.orders.service.js';
import {
  isVendorIntegrationStatus,
  updateVendorIntegrationOrderStatus,
} from './vendor-integration.status.service.js';
import { createVendorIntegrationClientToken } from './vendor-integration.tokens.js';
import './vendor-integration.types.js';

type TokenCreateBody = {
  vendorIdentifier?: string;
  providerName?: string;
  scopes?: string[];
};

type AuditLogsQuery = {
  vendorIdentifier?: string;
  limit?: string | number;
};

type StatusUpdateBody = {
  status?: string;
  message?: string | null;
};

function readHeaderValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

function safeTokenMatches(providedToken: string, expectedToken: string) {
  const provided = Buffer.from(providedToken);
  const expected = Buffer.from(expectedToken);
  if (provided.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(provided, expected);
}

function assertAdminTokenAuthorized(headers: Record<string, string | string[] | undefined>) {
  const expectedToken = process.env.ADMIN_PROBE_TOKEN?.trim();
  if (!expectedToken) {
    return { ok: false as const, statusCode: 503, message: 'Admin token management is not configured.' };
  }

  const providedToken = readHeaderValue(headers['x-admin-probe-token']).trim();
  if (!providedToken || !safeTokenMatches(providedToken, expectedToken)) {
    return { ok: false as const, statusCode: 403, message: 'Forbidden' };
  }

  return { ok: true as const };
}

function resolveAuditLogLimit(value: AuditLogsQuery['limit']) {
  if (value === undefined || value === null || value === '') {
    return 50;
  }

  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 50;
  }

  return Math.min(parsed, 100);
}

export function registerVendorIntegrationRoutes(app: FastifyInstance) {
  app.addHook('onResponse', writeVendorIntegrationAuditLog);

  app.post<{ Body: TokenCreateBody }>('/admin/vendor-integration/tokens', async (request, reply) => {
    const auth = assertAdminTokenAuthorized(request.headers);
    if (!auth.ok) {
      return reply.code(auth.statusCode).send({ message: auth.message });
    }

    const vendorIdentifier = request.body?.vendorIdentifier?.trim() ?? '';
    const providerName = request.body?.providerName?.trim() ?? '';
    const scopes = Array.isArray(request.body?.scopes) ? request.body.scopes : [];

    try {
      const created = await createVendorIntegrationClientToken({
        vendorIdentifier,
        providerName,
        scopes,
      });

      return reply.code(201).send({
        clientId: created.clientId,
        vendorIdentifier: created.vendorIdentifier,
        providerName: created.providerName,
        scopes: created.scopes,
        token: created.token,
        tokenWarning: 'Sensitive: this plaintext token is shown only once. Store it securely.',
      });
    } catch (error) {
      return reply.code(400).send({
        message: error instanceof Error ? error.message : 'Vendor integration token could not be created.',
      });
    }
  });

  app.post<{ Params: { id: string } }>('/admin/vendor-integration/tokens/:id/revoke', async (request, reply) => {
    const auth = assertAdminTokenAuthorized(request.headers);
    if (!auth.ok) {
      return reply.code(auth.statusCode).send({ message: auth.message });
    }

    const revoked = await prisma.vendorIntegrationClient.update({
      where: { id: request.params.id },
      data: {
        enabled: false,
        revokedAt: new Date(),
      },
      select: {
        id: true,
        vendorIdentifier: true,
        providerName: true,
        enabled: true,
        revokedAt: true,
      },
    });

    return {
      clientId: revoked.id,
      vendorIdentifier: revoked.vendorIdentifier,
      providerName: revoked.providerName,
      enabled: revoked.enabled,
      revokedAt: revoked.revokedAt?.toISOString() ?? null,
    };
  });

  app.get<{ Querystring: AuditLogsQuery }>('/admin/vendor-integration/audit-logs', async (request, reply) => {
    const auth = assertAdminTokenAuthorized(request.headers);
    if (!auth.ok) {
      return reply.code(auth.statusCode).send({ message: auth.message });
    }

    const vendorIdentifier = request.query.vendorIdentifier?.trim();
    const logs = await prisma.vendorIntegrationAuditLog.findMany({
      where: vendorIdentifier ? { vendorIdentifier } : {},
      select: {
        id: true,
        clientId: true,
        vendorIdentifier: true,
        method: true,
        path: true,
        statusCode: true,
        requestId: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: resolveAuditLogLimit(request.query.limit),
    });

    return {
      data: logs.map((log) => ({
        ...log,
        createdAt: log.createdAt.toISOString(),
      })),
    };
  });

  app.get<{ Querystring: VendorIntegrationOrdersQuery }>(
    '/api/vendor-integration/orders',
    {
      preHandler: [authenticateVendorIntegrationRequest, requireVendorIntegrationScope('orders:read')],
    },
    async (request, reply) => {
      const context = request.vendorIntegration;
      if (!context) {
        return reply.code(401).send({ message: 'Vendor integration token is required.' });
      }

      try {
        return await listVendorIntegrationOrders(context.vendorIdentifier, request.query);
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('Unsupported allocation status filter:')) {
          return reply.code(400).send({ message: error.message });
        }

        throw error;
      }
    },
  );

  app.post<{ Params: { allocationId: string }; Body: StatusUpdateBody }>(
    '/api/vendor-integration/orders/:allocationId/status',
    {
      preHandler: [authenticateVendorIntegrationRequest, requireVendorIntegrationScope('status:write')],
    },
    async (request, reply) => {
      const context = request.vendorIntegration;
      if (!context) {
        return reply.code(401).send({ message: 'Vendor integration token is required.' });
      }

      const idempotencyKey = readHeaderValue(request.headers['idempotency-key']).trim();
      if (!idempotencyKey) {
        return reply.code(400).send({ message: 'Idempotency-Key header is required.' });
      }

      const status = request.body?.status?.trim() ?? '';
      if (!isVendorIntegrationStatus(status)) {
        return reply.code(400).send({ message: 'Unsupported vendor integration status.' });
      }

      const result = await updateVendorIntegrationOrderStatus({
        allocationId: request.params.allocationId,
        context,
        idempotencyKey,
        status,
        message: request.body?.message ?? null,
        requestId: request.requestId ?? request.id ?? null,
      });

      if (!result) {
        return reply.code(404).send({ message: 'Vendor allocation not found.' });
      }

      return {
        idempotent: result.idempotent,
        allocation: result.allocation,
      };
    },
  );
}
