import type { FastifyInstance } from 'fastify';
import type { AppEnv } from '../../config/env.js';
import { createAuthMiddleware } from '../auth/auth.middleware.js';
import { createAuthService } from '../auth/auth.service.js';
import { requireVendorAccess } from '../vendor-access/vendor-access.middleware.js';
import {
  createShipmentExecution,
  getShipmentExecutionById,
  getShippingProviderReadinessDiagnostics,
  getVendorShippingConfig,
  ingestKargoEntegratorWebhook,
  ingestTryOtoWebhook,
  listShipmentExecutions,
  previewShipmentExecution,
  refreshTryOtoShipmentStatus,
  retryDryRunShipmentExecution,
  retryFailedShipmentExecution,
  upsertVendorShippingConfig,
} from './shipping-execution.service.js';
import type { CreateShipmentExecutionDto, VendorShippingConfigUpdateDto } from './shipping-execution.types.js';

function resolveNotificationUrl(request: { headers: Record<string, unknown>; protocol: string; hostname: string }) {
  const forwardedProto = String(request.headers['x-forwarded-proto'] ?? '').split(',')[0]?.trim();
  const forwardedHost = String(request.headers['x-forwarded-host'] ?? '').split(',')[0]?.trim();
  const host = forwardedHost || String(request.headers.host ?? request.hostname);
  const protocol = forwardedProto || request.protocol || 'https';

  return `${protocol}://${host}/webhooks/shipping/kargo-entegrator`;
}

export function registerShippingExecutionRoutes(app: FastifyInstance, env: AppEnv) {
  const authService = createAuthService(env);
  const authMiddleware = createAuthMiddleware(authService);

  app.post('/webhooks/shipping/kargo-entegrator', async (request, reply) => {
    const result = await ingestKargoEntegratorWebhook(request.body, { env });
    if (!result.ok) {
      return reply.code(501).send({
        message: result.message,
      });
    }

    return result;
  });

  app.post('/webhooks/try-oto', async (request, reply) => {
    const result = await ingestTryOtoWebhook(request.body, {
      env,
      httpMethod: request.method,
      contentType: typeof request.headers['content-type'] === 'string' ? request.headers['content-type'] : null,
    });
    if (!result.ok) {
      return reply.code(result.code ?? 501).send({
        message: result.message,
        signatureVerificationImplemented: false,
      });
    }

    return result;
  });

  app.get(
    '/shipping/config',
    {
      preHandler: [authMiddleware.authenticateRequest, requireVendorAccess],
    },
    async (request, reply) => {
      const vendorId = request.vendorContext?.vendorId;
      if (!vendorId) {
        return reply.code(400).send({ message: 'Vendor context could not be resolved.' });
      }

      return getVendorShippingConfig(vendorId);
    },
  );

  app.post(
    '/shipments/preview',
    {
      preHandler: [authMiddleware.authenticateRequest, requireVendorAccess],
    },
    async (request, reply) => {
      const vendorId = request.vendorContext?.vendorId;
      if (!vendorId) {
        return reply.code(400).send({ message: 'Vendor context could not be resolved.' });
      }

      try {
        const body = (request.body ?? {}) as CreateShipmentExecutionDto;
        return await previewShipmentExecution(
          {
            ...body,
            notificationUrl: body.notificationUrl ?? resolveNotificationUrl(request),
          },
          {
            vendorId,
            env,
          },
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Shipment execution preview could not be created.';
        return reply.code(400).send({ message });
      }
    },
  );

  app.post(
    '/shipments/create',
    {
      preHandler: [authMiddleware.authenticateRequest, requireVendorAccess],
    },
    async (request, reply) => {
      const vendorId = request.vendorContext?.vendorId;
      if (!vendorId) {
        return reply.code(400).send({ message: 'Vendor context could not be resolved.' });
      }

      try {
        const body = (request.body ?? {}) as CreateShipmentExecutionDto;
        return await createShipmentExecution({
          ...body,
          notificationUrl: body.notificationUrl ?? resolveNotificationUrl(request),
        }, {
          env,
          vendorId,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Shipment execution could not be created.';
        return reply.code(400).send({ message });
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    '/shipments/:id',
    {
      preHandler: [authMiddleware.authenticateRequest, requireVendorAccess],
    },
    async (request, reply) => {
      const vendorId = request.vendorContext?.vendorId;
      if (!vendorId) {
        return reply.code(400).send({ message: 'Vendor context could not be resolved.' });
      }

      const shipment = await getShipmentExecutionById(request.params.id, vendorId);
      if (!shipment) {
        return reply.code(404).send({ message: 'Shipment execution not found.' });
      }

      return shipment;
    },
  );

  app.post<{ Params: { id: string } }>(
    '/shipments/:id/retry',
    {
      preHandler: [authMiddleware.authenticateRequest, requireVendorAccess],
    },
    async (request, reply) => {
      const vendorId = request.vendorContext?.vendorId;
      if (!vendorId) {
        return reply.code(400).send({ message: 'Vendor context could not be resolved.' });
      }

      try {
        const body = (request.body ?? {}) as CreateShipmentExecutionDto;
        return await retryFailedShipmentExecution(request.params.id, {
          env,
          vendorId,
          notificationUrl: body.notificationUrl ?? resolveNotificationUrl(request),
          customerOverrides: body.customerOverrides,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Shipment execution could not be retried.';
        return reply.code(400).send({ message });
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    '/shipments/:id/refresh',
    {
      preHandler: [authMiddleware.authenticateRequest, requireVendorAccess],
    },
    async (request, reply) => {
      const vendorId = request.vendorContext?.vendorId;
      if (!vendorId) {
        return reply.code(400).send({ message: 'Vendor context could not be resolved.' });
      }

      try {
        return await refreshTryOtoShipmentStatus(request.params.id, {
          env,
          vendorId,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Shipment status could not be refreshed.';
        return reply.code(400).send({ message });
      }
    },
  );

  app.get(
    '/admin/shipments/provider-config',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Admin access required.' });
      }

      const query = request.query as { provider?: string; vendorId?: string };
      const provider =
        query.provider === 'kargo_entegrator' || query.provider === 'try_oto'
          ? query.provider
          : undefined;
      return getShippingProviderReadinessDiagnostics(env, provider, query.vendorId);
    },
  );

  app.get(
    '/admin/shipments',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Admin access required.' });
      }

      const query = request.query as { vendorId?: string; status?: string };
      return listShipmentExecutions({
        vendorId: query.vendorId,
        status: query.status as never,
      });
    },
  );

  app.post<{ Params: { id: string } }>(
    '/admin/shipments/:id/retry',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Admin access required.' });
      }

      try {
        return await retryDryRunShipmentExecution(request.params.id, {
          env,
          actorRole: request.authUser.role,
          notificationUrl: resolveNotificationUrl(request),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Shipment execution could not be retried.';
        return reply.code(400).send({ message });
      }
    },
  );

  app.put(
    '/admin/vendors/:vendorId/shipping-config',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Admin access required.' });
      }

      const { vendorId } = request.params as { vendorId: string };
      try {
        return await upsertVendorShippingConfig(vendorId, (request.body ?? {}) as VendorShippingConfigUpdateDto);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Vendor shipping configuration could not be saved.';
        return reply.code(400).send({ message });
      }
    },
  );
}
