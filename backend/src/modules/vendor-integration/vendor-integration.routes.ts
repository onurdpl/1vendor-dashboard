import type { FastifyInstance } from 'fastify';
import type { AppEnv } from '../../config/env.js';
import { prisma } from '../../db/prisma.js';
import { createAuthMiddleware } from '../auth/auth.middleware.js';
import { createAuthService } from '../auth/auth.service.js';
import { listAdminVendorIntegrationProviders } from './vendor-integration.admin.service.js';
import {
  authenticateVendorIntegrationRequest,
  requireVendorIntegrationScope,
  requireUnrestrictedVendorIntegration,
  writeVendorIntegrationAuditLog,
} from './vendor-integration.auth.js';
import { listVendorIntegrationOrders, type VendorIntegrationOrdersQuery } from './vendor-integration.orders.service.js';
import {
  updateVendorIntegrationOrderInvoice,
  validateVendorIntegrationInvoicePayload,
} from './vendor-integration.invoice.service.js';
import { VendorIntegrationOrderStateError } from './vendor-integration.errors.js';
import { rateLimitVendorIntegrationClient } from './vendor-integration.rate-limit.js';
import {
  updateVendorIntegrationOrderShipment,
  validateVendorIntegrationShipmentPayload,
} from './vendor-integration.shipment.service.js';
import {
  isVendorIntegrationStatus,
  updateVendorIntegrationOrderStatus,
} from './vendor-integration.status.service.js';
import { createVendorIntegrationClientToken } from './vendor-integration.tokens.js';
import './vendor-integration.types.js';

type TokenCreateBody = {
  vendorIdentifier?: string;
  providerName?: string;
  scopes?: unknown[];
};

type AuditLogsQuery = {
  vendorIdentifier?: string;
  limit?: string | number;
};

type StatusUpdateBody = {
  status?: string;
  message?: string | null;
};

type ShipmentUpdateBody = {
  carrier?: string | null;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
  shippedAt?: string | null;
};

type InvoiceUpdateBody = {
  invoiceNumber?: string | null;
  invoiceDate?: string | null;
  invoiceUrl?: string | null;
  invoiceAmount?: string | null;
};

function readHeaderValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

function requireAdminRole(request: { authUser?: { role?: string } }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) {
  if (request.authUser?.role !== 'admin') {
    return reply.code(403).send({ message: 'Forbidden' });
  }

  return null;
}

function logAdminVendorIntegrationAction(
  app: FastifyInstance,
  event: string,
  request: { authUser?: { id?: string | null; email?: string | null; role?: string } },
  details: Record<string, unknown>,
) {
  app.log?.info?.(
    {
      event,
      adminUserId: request.authUser?.id ?? null,
      adminEmail: request.authUser?.email ?? null,
      adminRole: request.authUser?.role ?? null,
      ...details,
    },
    'vendor integration admin action',
  );
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

function isInvalidVendorIntegrationCursorLookupError(error: unknown) {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const errorRecord = error as { code?: unknown; message?: unknown };
  return errorRecord.code === 'P2025' || (typeof errorRecord.message === 'string' && errorRecord.message.toLowerCase().includes('cursor'));
}

export function registerVendorIntegrationRoutes(app: FastifyInstance, env?: AppEnv) {
  app.addHook('onResponse', writeVendorIntegrationAuditLog);
  const authService = env ? createAuthService(env) : null;
  const adminAuthPreHandlers = authService
    ? [createAuthMiddleware(authService).authenticateRequest]
    : [];

  app.post<{ Body: TokenCreateBody }>(
    '/admin/vendor-integration/tokens',
    {
      preHandler: adminAuthPreHandlers,
    },
    async (request, reply) => {
      const forbidden = requireAdminRole(request, reply);
      if (forbidden) {
        return forbidden;
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

        logAdminVendorIntegrationAction(app, 'VENDOR_INTEGRATION_TOKEN_CREATED', request, {
          clientId: created.clientId,
          vendorIdentifier: created.vendorIdentifier,
          providerName: created.providerName,
          scopes: created.scopes,
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
    },
  );

  app.post<{ Params: { id: string } }>(
    '/admin/vendor-integration/tokens/:id/revoke',
    {
      preHandler: adminAuthPreHandlers,
    },
    async (request, reply) => {
      const forbidden = requireAdminRole(request, reply);
      if (forbidden) {
        return forbidden;
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

      logAdminVendorIntegrationAction(app, 'VENDOR_INTEGRATION_TOKEN_REVOKED', request, {
        clientId: revoked.id,
        vendorIdentifier: revoked.vendorIdentifier,
        providerName: revoked.providerName,
      });

      return {
        clientId: revoked.id,
        vendorIdentifier: revoked.vendorIdentifier,
        providerName: revoked.providerName,
        enabled: revoked.enabled,
        revokedAt: revoked.revokedAt?.toISOString() ?? null,
      };
    },
  );

  app.get<{ Querystring: AuditLogsQuery }>(
    '/admin/vendor-integration/audit-logs',
    {
      preHandler: adminAuthPreHandlers,
    },
    async (request, reply) => {
      const forbidden = requireAdminRole(request, reply);
      if (forbidden) {
        return forbidden;
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

      logAdminVendorIntegrationAction(app, 'VENDOR_INTEGRATION_AUDIT_LOGS_READ', request, {
        vendorIdentifier: vendorIdentifier ?? null,
        resultCount: logs.length,
      });

      return {
        data: logs.map((log) => ({
          ...log,
          createdAt: log.createdAt.toISOString(),
        })),
      };
    },
  );

  app.get(
    '/admin/vendor-integration/providers',
    {
      preHandler: adminAuthPreHandlers,
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      return listAdminVendorIntegrationProviders();
    },
  );

  app.get<{ Querystring: VendorIntegrationOrdersQuery }>(
    '/api/vendor-integration/orders',
    {
      preHandler: [authenticateVendorIntegrationRequest, rateLimitVendorIntegrationClient, requireVendorIntegrationScope('orders:read')],
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
        if (error instanceof Error && error.message === 'Invalid pagination cursor.') {
          return reply.code(400).send({ message: 'Invalid pagination cursor.' });
        }
        if (isInvalidVendorIntegrationCursorLookupError(error)) {
          return reply.code(400).send({ message: 'Invalid pagination cursor.' });
        }

        throw error;
      }
    },
  );

  app.post<{ Params: { allocationId: string }; Body: StatusUpdateBody }>(
    '/api/vendor-integration/orders/:allocationId/status',
    {
      preHandler: [
        authenticateVendorIntegrationRequest,
        rateLimitVendorIntegrationClient,
        requireVendorIntegrationScope('status:write'),
        requireUnrestrictedVendorIntegration,
      ],
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

      let result;
      try {
        result = await updateVendorIntegrationOrderStatus({
          allocationId: request.params.allocationId,
          context,
          idempotencyKey,
          status,
          message: request.body?.message ?? null,
          requestId: request.requestId ?? request.id ?? null,
        });
      } catch (error) {
        if (error instanceof VendorIntegrationOrderStateError) {
          return reply.code(error.statusCode).send({ message: error.message });
        }
        throw error;
      }

      if (!result) {
        return reply.code(404).send({ message: 'Vendor allocation not found.' });
      }

      return {
        idempotent: result.idempotent,
        allocation: result.allocation,
      };
    },
  );

  app.post<{ Params: { allocationId: string }; Body: ShipmentUpdateBody }>(
    '/api/vendor-integration/orders/:allocationId/shipment',
    {
      preHandler: [
        authenticateVendorIntegrationRequest,
        rateLimitVendorIntegrationClient,
        requireVendorIntegrationScope('shipment:write'),
        requireUnrestrictedVendorIntegration,
      ],
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

      const validation = validateVendorIntegrationShipmentPayload(request.body ?? {});
      if (!validation.ok) {
        return reply.code(400).send({ message: validation.message });
      }

      let result;
      try {
        result = await updateVendorIntegrationOrderShipment({
          allocationId: request.params.allocationId,
          context,
          idempotencyKey,
          carrier: validation.shipment.carrier,
          trackingNumber: validation.shipment.trackingNumber,
          trackingUrl: validation.shipment.trackingUrl,
          shippedAt: validation.shipment.shippedAt?.toISOString() ?? null,
          requestId: request.requestId ?? request.id ?? null,
        });
      } catch (error) {
        if (error instanceof VendorIntegrationOrderStateError) {
          return reply.code(error.statusCode).send({ message: error.message });
        }
        throw error;
      }

      if (!result) {
        return reply.code(404).send({ message: 'Vendor allocation not found.' });
      }

      return {
        idempotent: result.idempotent,
        allocation: result.allocation,
      };
    },
  );

  app.post<{ Params: { allocationId: string }; Body: InvoiceUpdateBody }>(
    '/api/vendor-integration/orders/:allocationId/invoice',
    {
      preHandler: [
        authenticateVendorIntegrationRequest,
        rateLimitVendorIntegrationClient,
        requireVendorIntegrationScope('invoice:write'),
        requireUnrestrictedVendorIntegration,
      ],
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

      const validation = validateVendorIntegrationInvoicePayload(request.body ?? {});
      if (!validation.ok) {
        return reply.code(400).send({ message: validation.message });
      }

      let result;
      try {
        result = await updateVendorIntegrationOrderInvoice({
          allocationId: request.params.allocationId,
          context,
          idempotencyKey,
          invoiceNumber: validation.invoice.invoiceNumber,
          invoiceDate: validation.invoice.invoiceDate.toISOString().slice(0, 10),
          invoiceUrl: validation.invoice.invoiceUrl,
          invoiceAmount: validation.invoice.invoiceAmount,
          requestId: request.requestId ?? request.id ?? null,
        });
      } catch (error) {
        if (error instanceof VendorIntegrationOrderStateError) {
          return reply.code(error.statusCode).send({ message: error.message });
        }
        throw error;
      }

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
