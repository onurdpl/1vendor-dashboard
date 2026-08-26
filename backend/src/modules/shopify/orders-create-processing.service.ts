import type { WebhookEvent } from '@prisma/client';
import type { AppEnv } from '../../config/env.js';
import {
  classifyOrderIngestionException,
  ingestShopifyOrderWebhook,
} from './order-ingestion.service.js';
import type {
  OrderIngestionMode,
  OrderIngestionResult,
  OrdersCreateFencedExecutionContext,
  ShopifyOrdersCreateWebhookPayload,
} from './order-ingestion.types.js';
import { isOrdersCreateLostFenceError } from './orders-create-ownership.service.js';
import { fetchSellerInfoWithRetry } from './seller-info-retry.service.js';
import { createShopifyAdminService } from './shopify-admin.service.js';

type OrdersCreateAdminService = Pick<
  ReturnType<typeof createShopifyAdminService>,
  'fetchOrderSellerInfo' | 'fetchOrderLineItemImages' | 'fetchOrderTaxSnapshot'
>;

type OrdersCreateProcessingLogger = {
  warn(context: Record<string, unknown>, message: string): void;
};

export type PreparedOrdersCreatePayloadResult =
  | {
      ok: true;
      payload: ShopifyOrdersCreateWebhookPayload;
      sourceShopifyOrderId: string | null;
      mode: OrderIngestionMode;
    }
  | {
      ok: false;
      message: string;
    };

export function prepareOrdersCreatePayload(input: {
  event: WebhookEvent;
  incomingPayload: ShopifyOrdersCreateWebhookPayload;
  retainedSnapshotMode: boolean;
}): PreparedOrdersCreatePayloadResult {
  let payload = input.incomingPayload;

  if (input.retainedSnapshotMode) {
    if (!input.event.rawPayload || !input.event.payloadHash) {
      return {
        ok: false,
        message: 'Retained webhook payload evidence is unavailable for automatic retry.',
      };
    }

    try {
      payload = JSON.parse(input.event.rawPayload) as ShopifyOrdersCreateWebhookPayload;
    } catch {
      return {
        ok: false,
        message: 'Retained webhook payload is not valid JSON.',
      };
    }
  }

  return {
    ok: true,
    payload,
    sourceShopifyOrderId:
      payload.id !== undefined && payload.id !== null ? String(payload.id) : null,
    mode: input.retainedSnapshotMode ? 'missing_order_only' : 'upsert',
  };
}

function failureResult(
  details: ReturnType<typeof classifyOrderIngestionException>,
): OrderIngestionResult {
  return {
    ok: false,
    action: 'received_needs_attention',
    processingStatus: 'needs_attention',
    ...details,
  };
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError';
}

export function createOrdersCreateProcessingService(input: {
  env: AppEnv;
  shopifyAdminService?: OrdersCreateAdminService;
  logger?: OrdersCreateProcessingLogger;
  propagateProcessingExceptions?: boolean;
}) {
  const shopifyAdminService = input.shopifyAdminService ?? createShopifyAdminService(input.env);

  async function process(processingInput: {
    event: WebhookEvent;
    payload: ShopifyOrdersCreateWebhookPayload;
    mode: OrderIngestionMode;
    executionContext?: OrdersCreateFencedExecutionContext;
  }): Promise<OrderIngestionResult> {
    const sourceShopifyOrderId =
      processingInput.payload.id !== undefined && processingInput.payload.id !== null
        ? String(processingInput.payload.id)
        : null;

    if (!sourceShopifyOrderId) {
      return failureResult({
        failureCode: 'missing_order_id',
        failureDisposition: 'NON_RETRYABLE',
        failureCategory: 'validation',
        retryable: false,
        error: 'Shopify orders/create payload did not include an order id.',
      });
    }

    try {
      processingInput.executionContext?.signal.throwIfAborted();
      const sellerInfoResult = await fetchSellerInfoWithRetry({
        orderId: sourceShopifyOrderId,
        fetchSellerInfo: shopifyAdminService.fetchOrderSellerInfo,
        delayMs: input.env.SHOPIFY_SELLER_INFO_RETRY_DELAY_MS,
        signal: processingInput.executionContext?.signal,
      });

      if (!sellerInfoResult.ok) {
        return failureResult({
          failureCode: 'seller_info_unavailable',
          failureDisposition: 'RETRYABLE',
          failureCategory: 'transient',
          retryable: true,
          error: sellerInfoResult.error,
        });
      }

      const lineItemImagesRequest = processingInput.executionContext
        ? shopifyAdminService.fetchOrderLineItemImages(sourceShopifyOrderId, {
            signal: processingInput.executionContext.signal,
          })
        : shopifyAdminService.fetchOrderLineItemImages(sourceShopifyOrderId);
      const lineItemImages = await lineItemImagesRequest
        .then(
          (result) => result.lineItems,
          (error) => {
            if (isAbortError(error) || processingInput.executionContext?.signal.aborted) {
              throw error;
            }
            input.logger?.warn(
              {
                sourceShopifyOrderId,
                errorMessage:
                  error instanceof Error
                    ? error.message
                    : 'Unknown Shopify line item image enrichment error.',
              },
              'Shopify line item image enrichment failed; continuing order ingestion.',
            );
            return [];
          },
        );

      const taxSnapshotRequest = processingInput.executionContext
        ? shopifyAdminService.fetchOrderTaxSnapshot(sourceShopifyOrderId, {
            signal: processingInput.executionContext.signal,
          })
        : shopifyAdminService.fetchOrderTaxSnapshot(sourceShopifyOrderId);
      const taxSnapshot = await taxSnapshotRequest
        .then(
          (result) => result,
          (error) => {
            if (isAbortError(error) || processingInput.executionContext?.signal.aborted) {
              throw error;
            }
            input.logger?.warn(
              {
                sourceShopifyOrderId,
                errorMessage:
                  error instanceof Error
                    ? error.message
                    : 'Unknown Shopify tax snapshot enrichment error.',
              },
              'Shopify tax snapshot enrichment failed; continuing order ingestion with VAT fallback.',
            );
            return null;
          },
        );

      processingInput.executionContext?.signal.throwIfAborted();
      return await ingestShopifyOrderWebhook({
        event: processingInput.event,
        payload: processingInput.payload,
        sellerInfo: sellerInfoResult.sellerInfo,
        lineItemImages,
        taxSnapshot,
        mode: processingInput.mode,
        executionContext: processingInput.executionContext,
      });
    } catch (error) {
      if (
        input.propagateProcessingExceptions ||
        isOrdersCreateLostFenceError(error) ||
        isAbortError(error)
      ) {
        throw error;
      }

      return failureResult(classifyOrderIngestionException(error));
    }
  }

  return { process };
}
