import type { FastifyInstance } from 'fastify';
import type { AppEnv } from '../../config/env.js';
import { createAuthMiddleware } from '../auth/auth.middleware.js';
import { createAuthService } from '../auth/auth.service.js';
import { requireVendorAccess } from '../vendor-access/vendor-access.middleware.js';
import {
  createShipmentExecution,
  createTryOtoReturnShipmentLabel,
  getShipmentExecutionById,
  getShippingProviderReadinessDiagnostics,
  getVendorShippingConfig,
  ingestKargoEntegratorWebhook,
  ingestTryOtoWebhook,
  listShipmentExecutions,
  probeShopifyReturnLabelUpload,
  probeTryOtoReturnAwbPrint,
  probeTryOtoReturnDetails,
  probeTryOtoReturnLink,
  previewShipmentExecution,
  refreshTryOtoShipmentStatus,
  retryDryRunShipmentExecution,
  retryFailedShipmentExecution,
  upsertVendorShippingConfig,
} from './shipping-execution.service.js';
import { getNavlungoConfigDiagnostics } from './navlungo-provider.adapter.js';
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

      try {
        return await createTryOtoReturnShipmentLabel(request.params.id, {
          env,
          vendorId,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Try OTO return label could not be created.';
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
      if (query.provider === 'navlungo') {
        const navlungo = getNavlungoConfigDiagnostics(env);
        return {
          provider: 'navlungo',
          supportedProviders: ['navlungo'],
          executionReady: false,
          sandboxModeEnabled: false,
          shippingExecutionEnabled: false,
          providerSelected: false,
          providerEnabled: false,
          webhookIngestEnabled: false,
          lastWebhookReceived: false,
          lastWebhookReceivedAt: null,
          lastWebhookHttpMethod: null,
          lastWebhookContentType: null,
          lastWebhookPayloadKeys: [],
          lastWebhookMatchedShipment: null,
          lastWebhookMatchStatus: null,
          lastWebhookMatchedByField: null,
          lastWebhookStatusValue: null,
          lastWebhookStatusMapped: null,
          lastWebhookMappedLocalStatus: null,
          lastWebhookParseError: null,
          webhookSignatureVerificationImplemented: false,
          baseUrlConfigured: navlungo.baseUrlConfigured,
          apiKeyConfigured: navlungo.usernameConfigured && navlungo.passwordConfigured,
          cargoIntegrationIdConfigured: false,
          warehouseIdConfigured: navlungo.defaultSenderAddressIdConfigured,
          defaultDesiConfigured: false,
          packageTypeUsed: '',
          notificationUrlConfigured: false,
          webhookRouteImplemented: false,
          receiverAddressAvailability: 'unknown_required',
          dummyKargoSupport: 'not_implemented',
          statusSyncSupport: 'not_implemented',
          missing: navlungo.missing,
          deprecatedEnvFallbacks: [],
          warnings: [
            'Navlungo is dormant for diagnostics/auth testing only.',
            'Runtime shipment execution is not enabled.',
            'Return/reverse implementation is not implemented.',
          ],
          navlungo: {
            usernameConfigured: navlungo.usernameConfigured,
            passwordConfigured: navlungo.passwordConfigured,
            defaultSenderAddressIdConfigured: navlungo.defaultSenderAddressIdConfigured,
            defaultBarcodeFormat: navlungo.defaultBarcodeFormat,
            authDiagnosticsAvailable: true,
            runtimeShipmentExecutionEnabled: false,
            returnReverseImplementation: 'not_implemented',
          },
        };
      }
      const provider =
        query.provider === 'kargo_entegrator' || query.provider === 'try_oto' || query.provider === 'kargonomi'
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

  app.post<{ Params: { id: string } }>(
    '/admin/shipments/:id/probe-try-oto-return-details',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Admin access required.' });
      }

      try {
        return await probeTryOtoReturnDetails(request.params.id, {
          env,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Try OTO return details probe could not be run.';
        return reply.code(400).send({ message });
      }
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

      try {
        return await probeTryOtoReturnLink(request.params.id, {
          env,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Try OTO return link probe could not be run.';
        return reply.code(400).send({ message });
      }
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

      try {
        return await probeTryOtoReturnAwbPrint(request.params.id, {
          env,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Try OTO return AWB print probe could not be run.';
        return reply.code(400).send({ message });
      }
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

      try {
        return await probeShopifyReturnLabelUpload(request.params.id, {
          env,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Shopify return label upload probe could not be run.';
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
