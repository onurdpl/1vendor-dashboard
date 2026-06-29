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
  listShipmentExecutions,
  previewShipmentExecution,
  refreshKargonomiShipmentProviderData,
  retryDryRunShipmentExecution,
  retryFailedShipmentExecution,
  syncKargonomiWarehouseDetails,
  upsertVendorShippingConfig,
} from './shipping-execution.service.js';
import type { CreateShipmentExecutionDto, VendorShippingConfigUpdateDto } from './shipping-execution.types.js';

function resolveNotificationUrl(request: { headers: Record<string, unknown>; protocol: string; hostname: string }) {
  const forwardedProto = String(request.headers['x-forwarded-proto'] ?? '').split(',')[0]?.trim();
  const forwardedHost = String(request.headers['x-forwarded-host'] ?? '').split(',')[0]?.trim();
  const host = forwardedHost || String(request.headers.host ?? request.hostname);
  const protocol = forwardedProto || request.protocol || 'https';

  return `${protocol}://${host}/webhooks/try-oto`;
}

function disabledProviderResponse(provider: 'try_oto' | 'navlungo') {
  const label = provider === 'try_oto' ? 'Try OTO' : 'Navlungo';
  return {
    code: 'inactive_shipping_provider',
    provider,
    activeProvider: 'kargonomi',
    message: `${label} is passive. Kargonomi is the only active shipping provider.`,
  };
}

export function registerShippingExecutionRoutes(app: FastifyInstance, env: AppEnv) {
  const authService = createAuthService(env);
  const authMiddleware = createAuthMiddleware(authService);

  app.post('/webhooks/try-oto', async (request, reply) => {
    void request;
    return reply.code(409).send(disabledProviderResponse('try_oto'));
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
          useFullSenderDetailsForThisRetry: body.useFullSenderDetailsForThisRetry === true,
          actorRole: request.authUser?.role,
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

      void env;
      void vendorId;
      void request;
      return reply.code(409).send(disabledProviderResponse('try_oto'));
    },
  );

  app.post<{ Params: { id: string } }>(
    '/shipments/:id/refresh-provider-data',
    {
      preHandler: [authMiddleware.authenticateRequest, requireVendorAccess],
    },
    async (request, reply) => {
      const vendorId = request.vendorContext?.vendorId;
      if (!vendorId) {
        return reply.code(400).send({ message: 'Vendor context could not be resolved.' });
      }

      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Admin access required.' });
      }

      try {
        return await refreshKargonomiShipmentProviderData(request.params.id, {
          env,
          vendorId,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Shipment provider data could not be refreshed.';
        return reply.code(400).send({ message });
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    '/shipments/:id/cancel',
    {
      preHandler: [authMiddleware.authenticateRequest, requireVendorAccess],
    },
    async (request, reply) => {
      const vendorId = request.vendorContext?.vendorId;
      if (!vendorId) {
        return reply.code(400).send({ message: 'Vendor context could not be resolved.' });
      }

      void env;
      void vendorId;
      void request;
      return reply.code(409).send(disabledProviderResponse('navlungo'));
    },
  );

  app.post<{ Params: { id: string } }>(
    '/shipments/:id/update-navlungo',
    {
      preHandler: [authMiddleware.authenticateRequest, requireVendorAccess],
    },
    async (request, reply) => {
      const vendorId = request.vendorContext?.vendorId;
      if (!vendorId) {
        return reply.code(400).send({ message: 'Vendor context could not be resolved.' });
      }

      void env;
      void vendorId;
      void request;
      return reply.code(409).send(disabledProviderResponse('navlungo'));
    },
  );

  app.post<{ Params: { id: string } }>(
    '/shipments/:id/create-return',
    {
      preHandler: [authMiddleware.authenticateRequest, requireVendorAccess],
    },
    async (request, reply) => {
      const vendorId = request.vendorContext?.vendorId;
      if (!vendorId) {
        return reply.code(400).send({ message: 'Vendor context could not be resolved.' });
      }

      void env;
      void vendorId;
      void request;
      return reply.code(409).send(disabledProviderResponse('try_oto'));
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
      const provider = query.provider === 'kargonomi' ? query.provider : undefined;
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

  app.post<{ Params: { id: string } }>(
    '/admin/shipments/:id/probe-try-oto-return-details',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Admin access required.' });
      }

      void env;
      void request;
      return reply.code(409).send(disabledProviderResponse('try_oto'));
    },
  );

  app.post<{ Params: { id: string } }>(
    '/admin/shipments/:id/probe-try-oto-return-link',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Admin access required.' });
      }

      void env;
      void request;
      return reply.code(409).send(disabledProviderResponse('try_oto'));
    },
  );

  app.post<{ Params: { id: string } }>(
    '/admin/shipments/:id/probe-try-oto-return-awb-print',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Admin access required.' });
      }

      void env;
      void request;
      return reply.code(409).send(disabledProviderResponse('try_oto'));
    },
  );

  app.post<{ Params: { id: string } }>(
    '/admin/shipments/:id/probe-shopify-return-label',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Admin access required.' });
      }

      void env;
      void request;
      return reply.code(409).send(disabledProviderResponse('try_oto'));
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
        return await upsertVendorShippingConfig(vendorId, (request.body ?? {}) as VendorShippingConfigUpdateDto, {
          actor: {
            userId: request.authUser?.id ?? null,
            email: request.authUser?.email ?? null,
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Vendor shipping configuration could not be saved.';
        return reply.code(400).send({ message });
      }
    },
  );

  app.post(
    '/admin/vendors/:vendorId/shipping-config/kargonomi/warehouses/:warehouseId/sync',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Admin access required.' });
      }

      const { vendorId, warehouseId } = request.params as { vendorId: string; warehouseId: string };
      try {
        return await syncKargonomiWarehouseDetails(vendorId, warehouseId, env);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Kargonomi warehouse details could not be synced.';
        return reply.code(400).send({ message });
      }
    },
  );
}
