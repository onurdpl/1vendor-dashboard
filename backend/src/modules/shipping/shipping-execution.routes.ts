import type { FastifyInstance } from 'fastify';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { AppEnv } from '../../config/env.js';
import { createAuthMiddleware } from '../auth/auth.middleware.js';
import { createAuthService } from '../auth/auth.service.js';
import { requireVendorAccess } from '../vendor-access/vendor-access.middleware.js';
import {
  cancelNavlungoShipmentExecution,
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
  refreshKargonomiShipmentProviderData,
  refreshShipmentExecutionStatus,
  retryDryRunShipmentExecution,
  retryFailedShipmentExecution,
  updateNavlungoShipmentExecution,
  upsertVendorShippingConfig,
} from './shipping-execution.service.js';
import type { CreateShipmentExecutionDto, UpdateNavlungoShipmentDto, VendorShippingConfigUpdateDto } from './shipping-execution.types.js';

function resolveNotificationUrl(request: { headers: Record<string, unknown>; protocol: string; hostname: string }) {
  const forwardedProto = String(request.headers['x-forwarded-proto'] ?? '').split(',')[0]?.trim();
  const forwardedHost = String(request.headers['x-forwarded-host'] ?? '').split(',')[0]?.trim();
  const host = forwardedHost || String(request.headers.host ?? request.hostname);
  const protocol = forwardedProto || request.protocol || 'https';

  return `${protocol}://${host}/webhooks/shipping/kargo-entegrator`;
}

function readHeaderValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

function fixedLengthDigest(value: string) {
  return createHash('sha256').update(value).digest();
}

function safeSharedSecretMatches(providedSecret: string, expectedSecret: string) {
  return timingSafeEqual(fixedLengthDigest(providedSecret), fixedLengthDigest(expectedSecret));
}

function buildTryOtoWebhookAuthenticityVerification(mode: 'shared_secret' | 'disabled_dev_only') {
  return {
    mode,
    providerNativeSignatureVerified: false,
    note: 'Provider-native Try OTO signature semantics remain unknown.',
  };
}

function buildKargoWebhookAuthenticityVerification(mode: 'shared_secret' | 'disabled_dev_only') {
  return {
    mode,
    providerNativeSignatureVerified: false,
    note: 'Provider-native Kargo Entegratör signature semantics remain unknown.',
  };
}

function verifyKargoWebhookAuthenticity(headers: Record<string, string | string[] | undefined>, env: AppEnv) {
  const configuredSecret = env.KARGO_ENTEGRATOR_WEBHOOK_SHARED_SECRET?.trim();
  if (!configuredSecret) {
    if (env.NODE_ENV === 'production' && env.KARGO_ENTEGRATOR_WEBHOOK_INGEST_ENABLED) {
      return {
        ok: false as const,
        code: 401,
        message: 'Kargo Entegratör webhook authenticity is not configured.',
        authenticityVerification: buildKargoWebhookAuthenticityVerification('shared_secret'),
      };
    }

    return {
      ok: true as const,
      authenticityVerification: buildKargoWebhookAuthenticityVerification('disabled_dev_only'),
    };
  }

  const providedSecret = readHeaderValue(headers['x-kargo-entegrator-webhook-secret']).trim();
  if (!providedSecret || !safeSharedSecretMatches(providedSecret, configuredSecret)) {
    return {
      ok: false as const,
      code: 401,
      message: 'Kargo Entegratör webhook authenticity verification failed.',
      authenticityVerification: buildKargoWebhookAuthenticityVerification('shared_secret'),
    };
  }

  return {
    ok: true as const,
    authenticityVerification: buildKargoWebhookAuthenticityVerification('shared_secret'),
  };
}

function verifyTryOtoWebhookAuthenticity(headers: Record<string, string | string[] | undefined>, env: AppEnv) {
  const configuredSecret = env.TRY_OTO_WEBHOOK_SHARED_SECRET?.trim();
  if (!configuredSecret) {
    if (env.NODE_ENV === 'production' && env.TRY_OTO_WEBHOOK_INGEST_ENABLED) {
      return {
        ok: false as const,
        code: 401,
        message: 'Try OTO webhook authenticity is not configured.',
        authenticityVerification: buildTryOtoWebhookAuthenticityVerification('shared_secret'),
      };
    }

    return {
      ok: true as const,
      authenticityVerification: buildTryOtoWebhookAuthenticityVerification('disabled_dev_only'),
    };
  }

  const providedSecret = readHeaderValue(headers['x-try-oto-webhook-secret']).trim();
  if (!providedSecret || !safeSharedSecretMatches(providedSecret, configuredSecret)) {
    return {
      ok: false as const,
      code: 401,
      message: 'Try OTO webhook authenticity verification failed.',
      authenticityVerification: buildTryOtoWebhookAuthenticityVerification('shared_secret'),
    };
  }

  return {
    ok: true as const,
    authenticityVerification: buildTryOtoWebhookAuthenticityVerification('shared_secret'),
  };
}

export function registerShippingExecutionRoutes(app: FastifyInstance, env: AppEnv) {
  const authService = createAuthService(env);
  const authMiddleware = createAuthMiddleware(authService);

  app.post('/webhooks/shipping/kargo-entegrator', async (request, reply) => {
    const authenticity = verifyKargoWebhookAuthenticity(request.headers, env);
    if (!authenticity.ok) {
      return reply.code(authenticity.code).send({
        message: authenticity.message,
        authenticityVerification: authenticity.authenticityVerification,
      });
    }

    const result = await ingestKargoEntegratorWebhook(request.body, { env });
    if (!result.ok) {
      return reply.code(501).send({
        message: result.message,
      });
    }

    return result;
  });

  app.post('/webhooks/try-oto', async (request, reply) => {
    const authenticity = verifyTryOtoWebhookAuthenticity(request.headers, env);
    if (!authenticity.ok) {
      return reply.code(authenticity.code).send({
        message: authenticity.message,
        authenticityVerification: authenticity.authenticityVerification,
      });
    }

    const result = await ingestTryOtoWebhook(request.body, {
      env,
      httpMethod: request.method,
      contentType: typeof request.headers['content-type'] === 'string' ? request.headers['content-type'] : null,
      authenticityVerificationMode: authenticity.authenticityVerification.mode,
    });
    if (!result.ok) {
      return reply.code(result.code ?? 501).send({
        message: result.message,
        authenticityVerification: result.authenticityVerification,
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

      try {
        return await refreshShipmentExecutionStatus(request.params.id, {
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

      try {
        return await cancelNavlungoShipmentExecution(request.params.id, {
          env,
          vendorId,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Shipment cancellation could not be completed.';
        return reply.code(400).send({ message });
      }
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

      try {
        return await updateNavlungoShipmentExecution(request.params.id, (request.body ?? {}) as UpdateNavlungoShipmentDto, {
          env,
          vendorId,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Shipment update could not be completed.';
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
        const body = (request.body ?? {}) as { dryRun?: boolean; customerOverrides?: CreateShipmentExecutionDto['customerOverrides'] };
        return await createTryOtoReturnShipmentLabel(request.params.id, {
          env,
          vendorId,
          dryRun: body.dryRun === true,
          customerOverrides: body.customerOverrides,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Return shipment could not be created.';
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
        query.provider === 'kargo_entegrator' ||
        query.provider === 'try_oto' ||
        query.provider === 'kargonomi' ||
        query.provider === 'navlungo'
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
