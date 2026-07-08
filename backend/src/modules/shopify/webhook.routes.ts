import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import type { AppEnv } from '../../config/env.js';
import { getShopifyWebhookHeaders } from './webhook.types.js';
import { getOrCreateWebhookEvent } from './webhook-idempotency.service.js';
import {
  ingestShopifyOrderWebhook,
  syncShopifyOrderPaidSnapshotFromWebhook,
  updateShopifyOrderContactAddressSnapshotFromWebhook,
} from './order-ingestion.service.js';
import { ingestShopifyRefundWebhook } from './refund-ingestion.service.js';
import { fetchSellerInfoWithRetry } from './seller-info-retry.service.js';
import { createShopifyAdminService } from './shopify-admin.service.js';
import {
  verifyShopifyWebhookHmac,
  verifyShopifyWebhookShopDomain,
} from './webhook.service.js';
import type { ShopifyOrdersCreateWebhookPayload } from './order-ingestion.types.js';
import type { ShopifyRefundsCreateWebhookPayload } from './refund-ingestion.types.js';
import {
  applyReturnLifecycleStatusWebhook,
  ingestReturnRequestWebhook,
} from './return-lifecycle-ingestion.service.js';
import { recordShopifyReturnSignalDiscovery } from './return-signal-discovery.service.js';
import type {
  ReturnLifecycleTopic,
  ReturnLifecycleWebhookPayload,
} from './return-lifecycle-ingestion.types.js';
import { ingestFulfillmentWebhook } from './fulfillment-ingestion.service.js';
import type {
  FulfillmentWebhookPayload,
  FulfillmentWebhookTopic,
} from './fulfillment-ingestion.types.js';
import { prisma } from '../../db/prisma.js';
import {
  createWebhookOperationalJob,
  markOperationalJobCompleted,
  markOperationalJobFailed,
  markOperationalJobProcessing,
} from '../operational-jobs/operational-jobs.service.js';
import { createCanonicalCancellationReconciliationService } from '../reconciliation/canonical-cancellation-reconciliation.service.js';

export function registerShopifyWebhookRoutes(app: FastifyInstance, env: AppEnv) {
  const shopifyAdminService = createShopifyAdminService(env);
  const canonicalCancellationReconciliationService = createCanonicalCancellationReconciliationService(env);
  const resolveWebhookSecret = (topic: string) => {
    if (topic.startsWith('returns/')) {
      return env.SHOPIFY_RETURN_WEBHOOK_SECRET || env.SHOPIFY_WEBHOOK_SECRET;
    }

    if (
      topic.startsWith('fulfillments/') ||
      topic.startsWith('fulfillment_events/') ||
      topic.startsWith('fulfillment_orders/')
    ) {
      return env.SHOPIFY_FULFILLMENT_WEBHOOK_SECRET || env.SHOPIFY_WEBHOOK_SECRET;
    }

    return env.SHOPIFY_WEBHOOK_SECRET;
  };

  const getRawBodyBuffer = (rawBodyBuffer: Buffer | undefined, rawBody: string | undefined) => {
    if (rawBodyBuffer) {
      return rawBodyBuffer;
    }

    return Buffer.from(rawBody ?? '', 'utf8');
  };

  const logWebhookVerificationFailure = (input: {
    path: string;
    topic: string;
    contentType: string | undefined;
    rawBodyBuffer: Buffer;
    hasHmacHeader: boolean;
  }) => {
    app.log.warn(
      {
        webhookPath: input.path,
        webhookTopic: input.topic,
        contentType: input.contentType ?? null,
        hasRawBody: input.rawBodyBuffer.length > 0,
        rawBodyBytes: input.rawBodyBuffer.length,
        hasHmacHeader: input.hasHmacHeader,
        payloadHash: createHash('sha256').update(input.rawBodyBuffer).digest('hex'),
      },
      'Shopify webhook signature verification failed.',
    );
  };

  const logWebhookShopDomainFailure = (input: {
    path: string;
    topic: string;
    reason: string;
    headerShopDomain: string | null;
    configuredShopDomain: string | null;
  }) => {
    app.log.warn(
      {
        webhookPath: input.path,
        webhookTopic: input.topic,
        reason: input.reason,
        headerShopDomain: input.headerShopDomain,
        configuredShopDomain: input.configuredShopDomain,
      },
      'Shopify webhook shop domain verification failed.',
    );
  };

  const verifyShopifyWebhookRequest = (input: {
    path: string;
    topic: string;
    rawBodyBuffer: Buffer;
    headers: ReturnType<typeof getShopifyWebhookHeaders>;
    contentType: string | undefined;
  }) => {
    const isHmacValid = verifyShopifyWebhookHmac(
      input.rawBodyBuffer,
      input.headers.hmac,
      resolveWebhookSecret(input.topic),
    );

    if (!isHmacValid) {
      logWebhookVerificationFailure({
        path: input.path,
        topic: input.topic,
        contentType: input.contentType,
        rawBodyBuffer: input.rawBodyBuffer,
        hasHmacHeader: !!input.headers.hmac,
      });

      return {
        ok: false as const,
        statusCode: 401,
        message: 'Invalid Shopify webhook signature.',
      };
    }

    const shopDomainCheck = verifyShopifyWebhookShopDomain({
      headerShopDomain: input.headers.shopDomain,
      configuredShopDomain: env.SHOPIFY_SHOP_DOMAIN,
      nodeEnv: env.NODE_ENV,
    });

    if (!shopDomainCheck.ok) {
      logWebhookShopDomainFailure({
        path: input.path,
        topic: input.topic,
        reason: shopDomainCheck.reason,
        headerShopDomain: shopDomainCheck.headerShopDomain,
        configuredShopDomain: shopDomainCheck.configuredShopDomain,
      });

      return {
        ok: false as const,
        statusCode: 403,
        message: 'Invalid Shopify webhook shop domain.',
      };
    }

    return { ok: true as const };
  };

  const getPersistedShopDomain = (shopDomain: string | null) => shopDomain ?? 'unknown.myshopify.com';

  const isRecord = (value: unknown): value is Record<string, unknown> =>
    Boolean(value) && typeof value === 'object' && !Array.isArray(value);

  const readPayloadString = (payload: unknown, keys: string[]) => {
    if (!isRecord(payload)) {
      return null;
    }

    for (const key of keys) {
      const raw = payload[key];
      if (typeof raw === 'string' && raw.trim()) {
        return raw.trim();
      }
      if (typeof raw === 'number' && Number.isFinite(raw)) {
        return String(raw);
      }
    }

    return null;
  };

  const normalizeShopifyGidTail = (value: string | null) => {
    if (!value) {
      return null;
    }

    const tail = value.split('/').at(-1)?.trim();
    return tail || value.trim();
  };

  const resolveShopifyOrderIdFromPayload = (payload: unknown) =>
    readPayloadString(payload, ['id', 'order_id', 'orderId', 'sourceShopifyOrderId']) ??
    normalizeShopifyGidTail(
      readPayloadString(payload, [
        'admin_graphql_api_id',
        'admin_graphql_api_order_id',
        'adminGraphqlApiId',
        'orderGid',
        'order_gid',
      ]),
    );

  const hasCanonicalCancellationSignal = (payload: unknown) =>
    Boolean(readPayloadString(payload, ['cancelled_at', 'cancelledAt']));

  const markWebhookProcessing = async (eventId: string) => {
    await prisma.webhookEvent.update({
      where: { id: eventId },
      data: {
        status: 'PROCESSING',
        errorMessage: null,
      },
    });
  };

  const markWebhookProcessed = async (eventId: string) => {
    await prisma.webhookEvent.update({
      where: { id: eventId },
      data: {
        status: 'PROCESSED',
        processedAt: new Date(),
        errorMessage: null,
      },
    });
  };

  const markWebhookFailed = async (eventId: string, message: string) => {
    await prisma.webhookEvent.update({
      where: { id: eventId },
      data: {
        status: 'FAILED',
        errorMessage: message,
      },
    });
  };

  const createWebhookJob = async (input: {
    topic: string;
    webhookEventId: string;
    payloadRef?: string | null;
    sourceShopifyOrderId?: string | null;
  }) => {
    try {
      return await createWebhookOperationalJob(input);
    } catch (error) {
      app.log.error(
        {
          error,
          webhookTopic: input.topic,
          webhookEventId: input.webhookEventId,
        },
        'Operational job persistence failed; continuing inline webhook processing.',
      );
      return null;
    }
  };

  const markJobProcessing = async (jobId: string | null | undefined) => {
    try {
      await markOperationalJobProcessing(jobId);
    } catch (error) {
      app.log.error({ error, operationalJobId: jobId }, 'Failed to mark operational job processing.');
    }
  };

  const markJobCompleted = async (jobId: string | null | undefined) => {
    try {
      await markOperationalJobCompleted(jobId);
    } catch (error) {
      app.log.error({ error, operationalJobId: jobId }, 'Failed to mark operational job completed.');
    }
  };

  const markJobFailed = async (jobId: string | null | undefined, error: unknown) => {
    try {
      await markOperationalJobFailed(jobId, error);
    } catch (jobError) {
      app.log.error({ error: jobError, operationalJobId: jobId }, 'Failed to mark operational job failed.');
    }
  };

  const processCanonicalOrderCancellationBridge = async (input: {
    topic: string;
    idempotencyResult: Awaited<ReturnType<typeof getOrCreateWebhookEvent>>;
    payload: unknown;
    sourceShopifyOrderId: string | null;
    responseContext?: Record<string, unknown>;
  }) => {
    const operationalJob = await createWebhookJob({
      topic: input.topic,
      webhookEventId: input.idempotencyResult.event.id,
      payloadRef: input.idempotencyResult.event.payloadHash,
      sourceShopifyOrderId: input.sourceShopifyOrderId,
    });

    try {
      await markJobProcessing(operationalJob?.id);
      await markWebhookProcessing(input.idempotencyResult.event.id);

      if (!input.sourceShopifyOrderId) {
        const message = `Shopify ${input.topic} payload did not include an order id.`;
        await markJobFailed(operationalJob?.id, message);
        await markWebhookFailed(input.idempotencyResult.event.id, message);
        return {
          ok: true,
          duplicate: false,
          topic: input.topic,
          action: 'received_needs_attention',
          processingStatus: 'needs_attention',
          message,
          ...(input.responseContext ?? {}),
        };
      }

      const canonicalOrder = await shopifyAdminService.fetchCanonicalOrderSnapshot(input.sourceShopifyOrderId);
      if (!canonicalOrder) {
        const message = 'Shopify canonical order cancellation state not found or Shopify Admin is not configured.';
        await markJobFailed(operationalJob?.id, message);
        await markWebhookFailed(input.idempotencyResult.event.id, message);
        return {
          ok: true,
          duplicate: false,
          topic: input.topic,
          action: 'received_needs_attention',
          processingStatus: 'needs_attention',
          shopifyOrderId: input.sourceShopifyOrderId,
          message,
          ...(input.responseContext ?? {}),
        };
      }

      if (!canonicalOrder.cancelledAt) {
        app.log.info(
          {
            topic: input.topic,
            sourceShopifyOrderId: input.sourceShopifyOrderId,
            financialStatus: canonicalOrder.financialStatus,
          },
          'Shopify order cancellation bridge ignored a webhook because canonical cancelledAt was empty.',
        );
        await markWebhookProcessed(input.idempotencyResult.event.id);
        await markJobCompleted(operationalJob?.id);
        return {
          ok: true,
          duplicate: false,
          topic: input.topic,
          action: 'canonical_cancellation_ignored',
          processingStatus: 'processed',
          shopifyOrderId: input.sourceShopifyOrderId,
          cancellationProcessed: false,
          reason: 'canonical_cancelled_at_missing',
          ...(input.responseContext ?? {}),
        };
      }

      const reconciliationResult =
        await canonicalCancellationReconciliationService.reconcileShopifyOrderCancellation(input.sourceShopifyOrderId);

      if (!reconciliationResult) {
        const message = 'Shopify order cancellation state not found or Shopify Admin is not configured.';
        await markJobFailed(operationalJob?.id, message);
        await markWebhookFailed(input.idempotencyResult.event.id, message);
        return {
          ok: true,
          duplicate: false,
          topic: input.topic,
          action: 'received_needs_attention',
          processingStatus: 'needs_attention',
          shopifyOrderId: input.sourceShopifyOrderId,
          message,
          ...(input.responseContext ?? {}),
        };
      }

      await markWebhookProcessed(input.idempotencyResult.event.id);
      await markJobCompleted(operationalJob?.id);
      return {
        ok: true,
        duplicate: false,
        topic: input.topic,
        action: 'canonical_cancellation_reconciled',
        processingStatus: 'processed',
        shopifyOrderId: input.sourceShopifyOrderId,
        cancellationProcessed: true,
        cancellationState: reconciliationResult.cancellationState,
        affectedAllocationCount: reconciliationResult.affectedAllocations.length,
        ledgersHeldOrVoidedCount: reconciliationResult.ledgersHeldOrVoided.length,
        signalsCreatedOrUpdated: reconciliationResult.signalsCreatedOrUpdated,
        ...(input.responseContext ?? {}),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : `Shopify ${input.topic} cancellation bridge failed.`;
      await markJobFailed(operationalJob?.id, message);
      await markWebhookFailed(input.idempotencyResult.event.id, message);
      return {
        ok: true,
        duplicate: false,
        topic: input.topic,
        action: 'received_needs_attention',
        processingStatus: 'needs_attention',
        message,
        ...(input.responseContext ?? {}),
      };
    }
  };

  const registerSkeletonReturnLifecycleRoute = (
    path: string,
    topic: ReturnLifecycleTopic,
  ) => {
    app.post(path, async (request, reply) => {
      const rawBodyBuffer = getRawBodyBuffer(request.rawBodyBuffer, request.rawBody);
      const rawBody = rawBodyBuffer.toString('utf8');
      const headers = getShopifyWebhookHeaders(request);
      const verification = verifyShopifyWebhookRequest({
        path,
        topic,
        contentType: request.headers['content-type'] as string | undefined,
        rawBodyBuffer,
        headers,
      });

      if (!verification.ok) {
        return reply.code(verification.statusCode).send({ message: verification.message });
      }

      if (!env.DATABASE_URL) {
        return reply.code(202).send({
          ok: true,
          duplicate: false,
          action: 'received_pending_implementation',
          topic,
        });
      }

      const idempotencyResult = await getOrCreateWebhookEvent({
        topic,
        shopDomain: getPersistedShopDomain(headers.shopDomain),
        webhookId: headers.webhookId,
        rawBody,
      });

      if (idempotencyResult.isDuplicate) {
        return reply.code(202).send({
          ok: true,
          duplicate: true,
          action: 'duplicate_ignored',
          topic,
        });
      }

      const operationalJob = await createWebhookJob({
        topic,
        webhookEventId: idempotencyResult.event.id,
        payloadRef: idempotencyResult.event.payloadHash,
      });
      const payload = (request.body ?? {}) as ReturnLifecycleWebhookPayload;
      await recordShopifyReturnSignalDiscovery({
        event: idempotencyResult.event,
        payload,
        topic,
      });
      let ingestionResult;
      try {
        await markJobProcessing(operationalJob?.id);
        await markWebhookProcessing(idempotencyResult.event.id);
        ingestionResult =
          topic === 'returns/request'
            ? await ingestReturnRequestWebhook(env, {
                event: idempotencyResult.event,
                payload,
              })
            : await applyReturnLifecycleStatusWebhook(env, topic, {
                event: idempotencyResult.event,
                payload,
              });
      } catch (error) {
        const message = error instanceof Error ? error.message : `Shopify ${topic} lifecycle ingestion failed.`;
        await markJobFailed(operationalJob?.id, message);
        await markWebhookFailed(idempotencyResult.event.id, message);
        return reply.code(202).send({
          ok: true,
          duplicate: false,
          topic,
          action: 'received_needs_attention',
          processingStatus: 'needs_attention',
          message,
        });
      }

      if (!ingestionResult.ok) {
        await markJobFailed(operationalJob?.id, ingestionResult.error);
        return reply.code(202).send({
          ok: true,
          duplicate: false,
          topic,
          action: ingestionResult.action,
          processingStatus: ingestionResult.processingStatus,
          message: ingestionResult.error,
        });
      }

      await markJobCompleted(operationalJob?.id);
      return reply.code(202).send({
        ok: true,
        duplicate: false,
        action: ingestionResult.action,
        processingStatus: ingestionResult.processingStatus,
        shopifyReturnGid: ingestionResult.shopifyReturnGid,
        affectedRecordCount: ingestionResult.affectedRecordCount,
        topic,
      });
    });
  };

  const registerReturnSignalDiscoveryRoute = (
    path: string,
    topic: string,
  ) => {
    app.post(path, async (request, reply) => {
      const rawBodyBuffer = getRawBodyBuffer(request.rawBodyBuffer, request.rawBody);
      const rawBody = rawBodyBuffer.toString('utf8');
      const headers = getShopifyWebhookHeaders(request);
      const verification = verifyShopifyWebhookRequest({
        path,
        topic,
        contentType: request.headers['content-type'] as string | undefined,
        rawBodyBuffer,
        headers,
      });

      if (!verification.ok) {
        return reply.code(verification.statusCode).send({ message: verification.message });
      }

      if (!env.DATABASE_URL) {
        return reply.code(202).send({
          ok: true,
          duplicate: false,
          action: 'return_signal_discovery_deferred',
          topic,
        });
      }

      const idempotencyResult = await getOrCreateWebhookEvent({
        topic,
        shopDomain: getPersistedShopDomain(headers.shopDomain),
        webhookId: headers.webhookId,
        rawBody,
      });

      if (idempotencyResult.isDuplicate) {
        return reply.code(202).send({
          ok: true,
          duplicate: true,
          action: 'duplicate_ignored',
          topic,
        });
      }

      const payload = request.body ?? {};
      const cancellationFallbackRequired = topic === 'orders/updated' && hasCanonicalCancellationSignal(payload);
      const orderUpdateResult = topic === 'orders/updated'
        ? await updateShopifyOrderContactAddressSnapshotFromWebhook(payload as ShopifyOrdersCreateWebhookPayload)
        : null;
      const summary = await recordShopifyReturnSignalDiscovery({
        event: idempotencyResult.event,
        payload,
        topic,
        markProcessed: !cancellationFallbackRequired,
      });
      app.log.info(
        {
          topic,
          webhookEventId: idempotencyResult.event.id,
          payloadKeys: summary.topLevelPayloadKeys,
          orderIdPresent: summary.orderIdPresent,
          returnIdPresent: summary.returnIdPresent,
          lineItemIdsPresent: summary.lineItemIdsPresent,
          refundIdPresent: summary.refundIdPresent,
          matchedOrder: Boolean(summary.matchedOrderId),
          matchedByField: summary.matchedByField,
          addressContactSnapshotUpdated: orderUpdateResult?.updated ?? null,
          changedFields: orderUpdateResult?.changedFields ?? [],
        },
        'Shopify return signal discovery webhook received.',
      );

      if (cancellationFallbackRequired) {
        const cancellationResult = await processCanonicalOrderCancellationBridge({
          topic,
          idempotencyResult,
          payload,
          sourceShopifyOrderId: resolveShopifyOrderIdFromPayload(payload),
          responseContext: {
            matchedOrder: Boolean(summary.matchedOrderId),
            matchedByField: summary.matchedByField,
            ...(orderUpdateResult
              ? {
                  addressContactSnapshotUpdated: orderUpdateResult.updated,
                  changedFields: orderUpdateResult.changedFields,
                }
              : {}),
          },
        });
        return reply.code(202).send(cancellationResult);
      }

      return reply.code(202).send({
        ok: true,
        duplicate: false,
        action: 'return_signal_discovery_recorded',
        processingStatus: 'processed',
        topic,
        matchedOrder: Boolean(summary.matchedOrderId),
        matchedByField: summary.matchedByField,
        ...(orderUpdateResult
          ? {
              addressContactSnapshotUpdated: orderUpdateResult.updated,
              changedFields: orderUpdateResult.changedFields,
            }
          : {}),
      });
    });
  };

  const registerFulfillmentLifecycleRoute = (
    path: string,
    topic: FulfillmentWebhookTopic,
  ) => {
    app.post(path, async (request, reply) => {
      const rawBodyBuffer = getRawBodyBuffer(request.rawBodyBuffer, request.rawBody);
      const rawBody = rawBodyBuffer.toString('utf8');
      const headers = getShopifyWebhookHeaders(request);
      const verification = verifyShopifyWebhookRequest({
        path,
        topic,
        contentType: request.headers['content-type'] as string | undefined,
        rawBodyBuffer,
        headers,
      });

      if (!verification.ok) {
        return reply.code(verification.statusCode).send({ message: verification.message });
      }

      if (!env.DATABASE_URL) {
        return reply.code(202).send({
          ok: true,
          duplicate: false,
          action: 'accepted',
          processingStatus: 'deferred',
          topic,
        });
      }

      const idempotencyResult = await getOrCreateWebhookEvent({
        topic,
        shopDomain: getPersistedShopDomain(headers.shopDomain),
        webhookId: headers.webhookId,
        rawBody,
      });

      if (idempotencyResult.isDuplicate) {
        return reply.code(202).send({
          ok: true,
          duplicate: true,
          action: 'duplicate_ignored',
          topic,
        });
      }

      const operationalJob = await createWebhookJob({
        topic,
        webhookEventId: idempotencyResult.event.id,
        payloadRef: idempotencyResult.event.payloadHash,
      });
      let ingestionResult;
      try {
        await markJobProcessing(operationalJob?.id);
        await markWebhookProcessing(idempotencyResult.event.id);
        ingestionResult = await ingestFulfillmentWebhook(env, {
          event: idempotencyResult.event,
          payload: (request.body ?? {}) as FulfillmentWebhookPayload,
          topic,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : `Shopify ${topic} fulfillment sync failed.`;
        await markJobFailed(operationalJob?.id, message);
        await markWebhookFailed(idempotencyResult.event.id, message);
        return reply.code(202).send({
          ok: true,
          duplicate: false,
          topic,
          action: 'received_needs_attention',
          processingStatus: 'needs_attention',
          message,
        });
      }

      if (!ingestionResult.ok) {
        await markJobFailed(operationalJob?.id, ingestionResult.error);
        return reply.code(202).send({
          ok: true,
          duplicate: false,
          topic,
          action: ingestionResult.action,
          processingStatus: ingestionResult.processingStatus,
          message: ingestionResult.error,
        });
      }

      await markJobCompleted(operationalJob?.id);
      return reply.code(202).send({
        ok: true,
        duplicate: false,
        topic,
        action: ingestionResult.action,
        processingStatus: ingestionResult.processingStatus,
        shopifyOrderId: ingestionResult.shopifyOrderId,
        affectedAllocationCount: ingestionResult.affectedAllocationCount,
      });
    });
  };

  app.post('/webhooks/shopify/orders-create', async (request, reply) => {
    const rawBodyBuffer = getRawBodyBuffer(request.rawBodyBuffer, request.rawBody);
    const rawBody = rawBodyBuffer.toString('utf8');
    const headers = getShopifyWebhookHeaders(request);
    const verification = verifyShopifyWebhookRequest({
      path: '/webhooks/shopify/orders-create',
      topic: headers.topic,
      contentType: request.headers['content-type'] as string | undefined,
      rawBodyBuffer,
      headers,
    });

    if (!verification.ok) {
      return reply.code(verification.statusCode).send({ message: verification.message });
    }

    const payload = (request.body ?? {}) as ShopifyOrdersCreateWebhookPayload;

    if (!env.DATABASE_URL) {
      return reply.code(202).send({
        ok: true,
        duplicate: false,
        action: 'accepted',
        processingStatus: 'deferred',
      });
    }

    const idempotencyResult = await getOrCreateWebhookEvent({
      topic: headers.topic,
      shopDomain: getPersistedShopDomain(headers.shopDomain),
      webhookId: headers.webhookId,
      rawBody,
    });

    if (idempotencyResult.isDuplicate) {
      return reply.code(202).send({
        ok: true,
        duplicate: true,
        action: 'duplicate_ignored',
      });
    }

    const sourceShopifyOrderId =
      payload.id !== undefined && payload.id !== null ? String(payload.id) : null;
    const operationalJob = await createWebhookJob({
      topic: headers.topic,
      webhookEventId: idempotencyResult.event.id,
      payloadRef: idempotencyResult.event.payloadHash,
      sourceShopifyOrderId,
    });
    let ingestionResult;
    try {
      await markJobProcessing(operationalJob?.id);
      await markWebhookProcessing(idempotencyResult.event.id);

      if (!sourceShopifyOrderId) {
        await markJobFailed(operationalJob?.id, 'Shopify orders/create payload did not include an order id.');
        await markWebhookFailed(idempotencyResult.event.id, 'Shopify orders/create payload did not include an order id.');
        return reply.code(202).send({
          ok: true,
          duplicate: false,
          action: 'received_needs_attention',
          processingStatus: 'needs_attention',
          message: 'Shopify orders/create payload did not include an order id.',
        });
      }

      const sellerInfoResult = await fetchSellerInfoWithRetry({
        orderId: sourceShopifyOrderId,
        fetchSellerInfo: shopifyAdminService.fetchOrderSellerInfo,
        delayMs: env.SHOPIFY_SELLER_INFO_RETRY_DELAY_MS,
      });

      if (!sellerInfoResult.ok) {
        await markJobFailed(operationalJob?.id, sellerInfoResult.error);
        await markWebhookFailed(idempotencyResult.event.id, sellerInfoResult.error);
        return reply.code(202).send({
          ok: true,
          duplicate: false,
          action: 'received_needs_attention',
          processingStatus: 'needs_attention',
          message: sellerInfoResult.error,
        });
      }

      const lineItemImages = await shopifyAdminService.fetchOrderLineItemImages(sourceShopifyOrderId).then(
        (result) => result.lineItems,
        (error) => {
          app.log.warn(
            {
              sourceShopifyOrderId,
              errorMessage: error instanceof Error ? error.message : 'Unknown Shopify line item image enrichment error.',
            },
            'Shopify line item image enrichment failed; continuing order ingestion.',
          );
          return [];
        },
      );

      const taxSnapshot = await shopifyAdminService.fetchOrderTaxSnapshot(sourceShopifyOrderId).then(
        (result) => result,
        (error) => {
          app.log.warn(
            {
              sourceShopifyOrderId,
              errorMessage: error instanceof Error ? error.message : 'Unknown Shopify tax snapshot enrichment error.',
            },
            'Shopify tax snapshot enrichment failed; continuing order ingestion with VAT fallback.',
          );
          return null;
        },
      );

      ingestionResult = await ingestShopifyOrderWebhook({
        event: idempotencyResult.event,
        payload,
        sellerInfo: sellerInfoResult.sellerInfo,
        lineItemImages,
        taxSnapshot,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Shopify orders/create ingestion failed.';
      await markJobFailed(operationalJob?.id, message);
      await markWebhookFailed(idempotencyResult.event.id, message);
      return reply.code(202).send({
        ok: true,
        duplicate: false,
        action: 'received_needs_attention',
        processingStatus: 'needs_attention',
        message,
      });
    }

    if (!ingestionResult.ok) {
      await markJobFailed(operationalJob?.id, ingestionResult.error);
      return reply.code(202).send({
        ok: true,
        duplicate: false,
        action: ingestionResult.action,
        processingStatus: ingestionResult.processingStatus,
        message: ingestionResult.error,
      });
    }

    await markJobCompleted(operationalJob?.id);
    return reply.code(202).send({
      ok: true,
      duplicate: false,
      action: ingestionResult.action,
      processingStatus: ingestionResult.processingStatus,
      shopifyOrderId: ingestionResult.shopifyOrderId,
      allocationCount: ingestionResult.allocationCount,
    });
  });

  app.post('/webhooks/shopify/orders-paid', async (request, reply) => {
    const rawBodyBuffer = getRawBodyBuffer(request.rawBodyBuffer, request.rawBody);
    const rawBody = rawBodyBuffer.toString('utf8');
    const headers = getShopifyWebhookHeaders(request);
    const topic = 'orders/paid';
    const verification = verifyShopifyWebhookRequest({
      path: '/webhooks/shopify/orders-paid',
      topic,
      contentType: request.headers['content-type'] as string | undefined,
      rawBodyBuffer,
      headers,
    });

    if (!verification.ok) {
      return reply.code(verification.statusCode).send({ message: verification.message });
    }

    const payload = (request.body ?? {}) as ShopifyOrdersCreateWebhookPayload;
    const sourceShopifyOrderId =
      payload.id !== undefined && payload.id !== null ? String(payload.id) : null;

    if (!env.DATABASE_URL) {
      return reply.code(202).send({
        ok: true,
        duplicate: false,
        action: 'accepted',
        processingStatus: 'deferred',
      });
    }

    const idempotencyResult = await getOrCreateWebhookEvent({
      topic,
      shopDomain: getPersistedShopDomain(headers.shopDomain),
      webhookId: headers.webhookId,
      rawBody,
    });

    if (idempotencyResult.isDuplicate) {
      return reply.code(202).send({
        ok: true,
        duplicate: true,
        action: 'duplicate_ignored',
      });
    }

    const operationalJob = await createWebhookJob({
      topic,
      webhookEventId: idempotencyResult.event.id,
      payloadRef: idempotencyResult.event.payloadHash,
      sourceShopifyOrderId,
    });

    try {
      await markJobProcessing(operationalJob?.id);
      await markWebhookProcessing(idempotencyResult.event.id);
      const syncResult = await syncShopifyOrderPaidSnapshotFromWebhook(payload);
      await prisma.webhookEvent.update({
        where: {
          id: idempotencyResult.event.id,
        },
        data: {
          ...(syncResult.orderId ? { shopifyOrderId: syncResult.orderId } : {}),
          status: 'PROCESSED',
          processedAt: new Date(),
          errorMessage: null,
        },
      });
      await markJobCompleted(operationalJob?.id);

      return reply.code(202).send({
        ok: true,
        duplicate: false,
        action: syncResult.matched ? 'paid_snapshot_synced' : 'paid_snapshot_ignored',
        processingStatus: 'processed',
        shopifyOrderId: syncResult.sourceShopifyOrderId,
        orderMatched: syncResult.matched,
        snapshotUpdated: syncResult.updated,
        changedFields: syncResult.changedFields,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Shopify orders/paid snapshot sync failed.';
      await markJobFailed(operationalJob?.id, message);
      await markWebhookFailed(idempotencyResult.event.id, message);
      return reply.code(202).send({
        ok: true,
        duplicate: false,
        action: 'received_needs_attention',
        processingStatus: 'needs_attention',
        message,
      });
    }
  });

  app.post('/webhooks/shopify/orders-cancelled', async (request, reply) => {
    const rawBodyBuffer = getRawBodyBuffer(request.rawBodyBuffer, request.rawBody);
    const rawBody = rawBodyBuffer.toString('utf8');
    const headers = getShopifyWebhookHeaders(request);
    const topic = 'orders/cancelled';
    const verification = verifyShopifyWebhookRequest({
      path: '/webhooks/shopify/orders-cancelled',
      topic,
      contentType: request.headers['content-type'] as string | undefined,
      rawBodyBuffer,
      headers,
    });

    if (!verification.ok) {
      return reply.code(verification.statusCode).send({ message: verification.message });
    }

    const payload = request.body ?? {};
    const sourceShopifyOrderId = resolveShopifyOrderIdFromPayload(payload);

    if (!env.DATABASE_URL) {
      return reply.code(202).send({
        ok: true,
        duplicate: false,
        action: 'accepted',
        processingStatus: 'deferred',
        topic,
      });
    }

    const idempotencyResult = await getOrCreateWebhookEvent({
      topic,
      shopDomain: getPersistedShopDomain(headers.shopDomain),
      webhookId: headers.webhookId,
      rawBody,
    });

    if (idempotencyResult.isDuplicate) {
      return reply.code(202).send({
        ok: true,
        duplicate: true,
        action: 'duplicate_ignored',
        topic,
      });
    }

    const cancellationResult = await processCanonicalOrderCancellationBridge({
      topic,
      idempotencyResult,
      payload,
      sourceShopifyOrderId,
    });
    return reply.code(202).send(cancellationResult);
  });

  app.post('/webhooks/shopify/refunds-create', async (request, reply) => {
    const rawBodyBuffer = getRawBodyBuffer(request.rawBodyBuffer, request.rawBody);
    const rawBody = rawBodyBuffer.toString('utf8');
    const headers = getShopifyWebhookHeaders(request);
    const verification = verifyShopifyWebhookRequest({
      path: '/webhooks/shopify/refunds-create',
      topic: headers.topic,
      contentType: request.headers['content-type'] as string | undefined,
      rawBodyBuffer,
      headers,
    });

    if (!verification.ok) {
      return reply.code(verification.statusCode).send({ message: verification.message });
    }

    const payload = (request.body ?? {}) as ShopifyRefundsCreateWebhookPayload;

    if (!env.DATABASE_URL) {
      return reply.code(202).send({
        ok: true,
        duplicate: false,
        action: 'accepted',
        processingStatus: 'deferred',
      });
    }

    const idempotencyResult = await getOrCreateWebhookEvent({
      topic: headers.topic,
      shopDomain: getPersistedShopDomain(headers.shopDomain),
      webhookId: headers.webhookId,
      rawBody,
    });

    if (idempotencyResult.isDuplicate) {
      return reply.code(202).send({
        ok: true,
        duplicate: true,
        action: 'duplicate_ignored',
      });
    }

    const operationalJob = await createWebhookJob({
      topic: headers.topic,
      webhookEventId: idempotencyResult.event.id,
      payloadRef: idempotencyResult.event.payloadHash,
      sourceShopifyOrderId:
        payload.order_id !== undefined && payload.order_id !== null ? String(payload.order_id) : null,
    });
    await recordShopifyReturnSignalDiscovery({
      event: idempotencyResult.event,
      payload,
      topic: headers.topic,
    });
    let ingestionResult;
    try {
      await markJobProcessing(operationalJob?.id);
      await markWebhookProcessing(idempotencyResult.event.id);
      ingestionResult = await ingestShopifyRefundWebhook({
        event: idempotencyResult.event,
        payload,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Shopify refunds/create ingestion failed.';
      await markJobFailed(operationalJob?.id, message);
      await markWebhookFailed(idempotencyResult.event.id, message);
      return reply.code(202).send({
        ok: true,
        duplicate: false,
        action: 'received_needs_attention',
        processingStatus: 'needs_attention',
        message,
      });
    }

    if (!ingestionResult.ok) {
      await markJobFailed(operationalJob?.id, ingestionResult.error);
      return reply.code(202).send({
        ok: true,
        duplicate: false,
        action: ingestionResult.action,
        processingStatus: ingestionResult.processingStatus,
        message: ingestionResult.error,
      });
    }

    await markJobCompleted(operationalJob?.id);
    return reply.code(202).send({
      ok: true,
      duplicate: false,
      action: ingestionResult.action,
      processingStatus: ingestionResult.processingStatus,
      shopifyOrderId: ingestionResult.shopifyOrderId,
      refundAllocationCount: ingestionResult.refundAllocationCount,
    });
  });

  registerSkeletonReturnLifecycleRoute('/webhooks/shopify/returns-request', 'returns/request');
  registerReturnSignalDiscoveryRoute('/webhooks/shopify/returns-create', 'returns/create');
  registerReturnSignalDiscoveryRoute('/webhooks/shopify/returns-update', 'returns/update');
  registerReturnSignalDiscoveryRoute('/webhooks/shopify/orders-updated', 'orders/updated');
  registerReturnSignalDiscoveryRoute('/webhooks/shopify/fulfillment-orders-updated', 'fulfillment_orders/updated');
  registerSkeletonReturnLifecycleRoute('/webhooks/shopify/returns-approve', 'returns/approve');
  registerSkeletonReturnLifecycleRoute('/webhooks/shopify/returns-decline', 'returns/decline');
  registerSkeletonReturnLifecycleRoute('/webhooks/shopify/returns-close', 'returns/close');
  registerSkeletonReturnLifecycleRoute('/webhooks/shopify/returns-cancel', 'returns/cancel');
  registerFulfillmentLifecycleRoute('/webhooks/shopify/fulfillments-create', 'fulfillments/create');
  registerFulfillmentLifecycleRoute('/webhooks/shopify/fulfillments-update', 'fulfillments/update');
  registerFulfillmentLifecycleRoute('/webhooks/shopify/fulfillment-events-create', 'fulfillment_events/create');
  registerFulfillmentLifecycleRoute('/webhooks/shopify/fulfillment-orders-cancelled', 'fulfillment_orders/cancelled');
}
