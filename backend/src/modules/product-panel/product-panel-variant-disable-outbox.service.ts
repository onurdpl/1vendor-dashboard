import { createHmac, randomUUID } from 'node:crypto';
import {
  CancellationReason,
  OperationalSignalSeverity,
  OperationalSignalSourceArea,
  OperationalSignalStatus,
  Prisma,
  ProductPanelVariantDisableOutboxStatus,
  type ProductPanelVariantDisableOutboxEvent,
} from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import type { AppEnv } from '../../config/env.js';

const PRODUCT_PANEL_VARIANT_DISABLE_PATH = '/internal/availability/disable-variant';
const PRODUCT_PANEL_SOURCE_SYSTEM = 'vendor_allocation_panel';
const PRODUCT_PANEL_SOURCE_EVENT_TYPE = 'vendor_allocation_rejected';
const PRODUCT_PANEL_SOURCE_STATUS = 'vendor_reported';
const PRODUCT_PANEL_FAILURE_RULE_KEY = 'product_panel_variant_disable_dry_run_failed';

type ProductPanelEnv = Pick<
  AppEnv,
  | 'NODE_ENV'
  | 'PRODUCT_PANEL_BASE_URL'
  | 'PRODUCT_PANEL_VARIANT_DISABLE_ENABLED'
  | 'PRODUCT_PANEL_VARIANT_DISABLE_DRY_RUN'
  | 'PRODUCT_PANEL_HMAC_SECRET'
>;

type FetchLike = (
  input: string | URL,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

type QueueEventInput = {
  allocationId: string;
  reasonCode: string;
  reasonText?: string | null;
  requestedAt?: Date;
  environment?: string;
  dryRun?: boolean;
};

export class ProductPanelVariantDisableDryRunSendError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 409) {
    super(message);
    this.statusCode = statusCode;
  }
}

type ProductPanelDisablePayload = {
  shopifyVariantId: string;
  variantSku: string | null;
  shopifyLineItemId: string;
  allocationId: string;
  vendorId: string;
  vendorName: string | null;
  sourceOrderId: string;
  sourceOrderName: string | null;
  reasonCode: string;
  reasonText: string | null;
  quantity: number;
  requestedAt: string;
  environment: string;
  sourceSystem: typeof PRODUCT_PANEL_SOURCE_SYSTEM;
  sourceEventType: typeof PRODUCT_PANEL_SOURCE_EVENT_TYPE;
  sourceStatus: typeof PRODUCT_PANEL_SOURCE_STATUS;
  dryRun: boolean;
};

function normalizeReasonCode(reasonCode: string) {
  return reasonCode.trim().toUpperCase();
}

export function shouldQueueProductPanelVariantDisableEvent(reasonCode: string) {
  return normalizeReasonCode(reasonCode) === CancellationReason.OUT_OF_STOCK;
}

function buildIdempotencyKey(allocationId: string, vendorAllocationLineItemId: string, reasonCode: string) {
  return `product-panel-variant-disable:${allocationId}:${vendorAllocationLineItemId}:${normalizeReasonCode(reasonCode)}`;
}

function readEnvironment(environment?: string) {
  return environment?.trim() || process.env.NODE_ENV || 'development';
}

function toJsonObject(value: Record<string, unknown>): Prisma.InputJsonObject {
  return value as Prisma.InputJsonObject;
}

function toResponseJson(value: unknown): Prisma.InputJsonValue {
  if (value && typeof value === 'object') {
    return value as Prisma.InputJsonObject;
  }
  return { raw: value === undefined ? null : String(value) };
}

function parseJsonObject(text: string) {
  if (!text.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : { raw: parsed };
  } catch {
    return { raw: text };
  }
}

function buildDisablePayload(event: ProductPanelVariantDisableOutboxEvent, dryRun: boolean): ProductPanelDisablePayload | null {
  if (!event.shopifyVariantId) {
    return null;
  }

  return {
    shopifyVariantId: event.shopifyVariantId,
    variantSku: event.variantSku,
    shopifyLineItemId: event.shopifyLineItemId,
    allocationId: event.allocationId,
    vendorId: event.vendorId,
    vendorName: event.vendorName,
    sourceOrderId: event.shopifyOrderId,
    sourceOrderName: event.shopifyOrderName,
    reasonCode: event.reasonCode,
    reasonText: event.reasonText,
    quantity: event.quantity,
    requestedAt: event.requestedAt.toISOString(),
    environment: event.environment,
    sourceSystem: PRODUCT_PANEL_SOURCE_SYSTEM,
    sourceEventType: PRODUCT_PANEL_SOURCE_EVENT_TYPE,
    sourceStatus: PRODUCT_PANEL_SOURCE_STATUS,
    dryRun,
  };
}

function mapEventStatusSummary(event: ProductPanelVariantDisableOutboxEvent) {
  const responseJson = event.responseJson && typeof event.responseJson === 'object' && !Array.isArray(event.responseJson)
    ? (event.responseJson as Record<string, unknown>)
    : null;
  return {
    id: event.id,
    status: event.status,
    shopifyVariantId: event.shopifyVariantId,
    shopifyLineItemId: event.shopifyLineItemId,
    variantSku: event.variantSku,
    reasonCode: event.reasonCode,
    reasonText: event.reasonText,
    quantity: event.quantity,
    requestedAt: event.requestedAt.toISOString(),
    environment: event.environment,
    dryRun: event.dryRun,
    attemptCount: event.attemptCount,
    error: event.error,
    resolvedAt: event.resolvedAt?.toISOString() ?? null,
    failedAt: event.failedAt?.toISOString() ?? null,
    response: responseJson
      ? {
          accepted: responseJson.accepted,
          dryRun: responseJson.dryRun,
          canResolve: responseJson.canResolve,
          parentSku: responseJson.parentSku,
          normalizedSize: responseJson.normalizedSize,
          sizeKey: responseJson.sizeKey,
          resolutionMethod: responseJson.resolutionMethod,
          confidence: responseJson.confidence,
          writesPerformed: responseJson.writesPerformed,
          error: responseJson.error,
          message: responseJson.message,
          missingHeaders: responseJson.missingHeaders,
          created: responseJson.created,
          duplicate: responseJson.duplicate,
          ruleId: responseJson.ruleId,
        }
      : null,
  };
}

function signPayload(secret: string, body: string, idempotencyKey: string) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = randomUUID();
  const signature = createHmac('sha256', secret)
    .update(`${timestamp}\n${nonce}\n${idempotencyKey}\n${body}`)
    .digest('hex');

  return {
    timestamp,
    nonce,
    signature,
  };
}

function isProductPanelDisableResolved(responseBody: Record<string, unknown>, dryRun: boolean) {
  if (dryRun) {
    return (
      responseBody.accepted === true &&
      responseBody.dryRun === true &&
      responseBody.writesPerformed !== true
    );
  }

  return (
    responseBody.created === true ||
    responseBody.duplicate === true ||
    (typeof responseBody.ruleId === 'string' && responseBody.ruleId.trim().length > 0)
  );
}

async function markProductPanelEventFailed(
  event: ProductPanelVariantDisableOutboxEvent,
  error: string,
  responseJson?: Prisma.InputJsonValue,
  requestPayloadJson?: Prisma.InputJsonValue,
  dryRun?: boolean,
) {
  const failedAt = new Date();
  const updated = await prisma.productPanelVariantDisableOutboxEvent.update({
    where: {
      id: event.id,
    },
    data: {
      status: ProductPanelVariantDisableOutboxStatus.FAILED,
      ...(typeof dryRun === 'boolean' ? { dryRun } : {}),
      attemptCount: event.attemptCount + 1,
      error,
      requestPayloadJson,
      responseJson,
      failedAt,
    },
  });
  await createProductPanelFailureSignal(updated, error);
  return updated;
}

async function createProductPanelFailureSignal(event: ProductPanelVariantDisableOutboxEvent, error: string) {
  await prisma.operationalSignal.upsert({
    where: {
      id: `product-panel-variant-disable-${event.id}`,
    },
    create: {
      id: `product-panel-variant-disable-${event.id}`,
      type: 'product_panel_variant_disable_dry_run_failed',
      severity: OperationalSignalSeverity.WARNING,
      sourceArea: OperationalSignalSourceArea.DIAGNOSTICS,
      vendorId: event.vendorId,
      allocationId: event.allocationId,
      title: 'Product Panel variant disable failed',
      description: `Product Panel availability request failed for ${event.variantSku ?? event.shopifyVariantId ?? 'variant'}. Reject workflow was preserved.`,
      suggestedAction: 'Review Product Panel availability mapping or retry the sender.',
      status: OperationalSignalStatus.ACTIVE,
      ruleKey: PRODUCT_PANEL_FAILURE_RULE_KEY,
      triggeredAt: new Date(),
      metadata: toJsonObject({
        productPanelVariantDisableEventId: event.id,
        allocationId: event.allocationId,
        vendorAllocationLineItemId: event.vendorAllocationLineItemId,
        shopifyVariantId: event.shopifyVariantId,
        shopifyLineItemId: event.shopifyLineItemId,
        variantSku: event.variantSku,
        shopifyOrderId: event.shopifyOrderId,
        shopifyOrderName: event.shopifyOrderName,
        reasonCode: event.reasonCode,
        diagnosticReason: error,
      }),
    },
    update: {
      severity: OperationalSignalSeverity.WARNING,
      sourceArea: OperationalSignalSourceArea.DIAGNOSTICS,
      title: 'Product Panel variant disable failed',
      description: `Product Panel availability request failed for ${event.variantSku ?? event.shopifyVariantId ?? 'variant'}. Reject workflow was preserved.`,
      suggestedAction: 'Review Product Panel availability mapping or retry the sender.',
      status: OperationalSignalStatus.ACTIVE,
      resolvedAt: null,
      triggeredAt: new Date(),
      metadata: toJsonObject({
        productPanelVariantDisableEventId: event.id,
        allocationId: event.allocationId,
        vendorAllocationLineItemId: event.vendorAllocationLineItemId,
        shopifyVariantId: event.shopifyVariantId,
        shopifyLineItemId: event.shopifyLineItemId,
        variantSku: event.variantSku,
        shopifyOrderId: event.shopifyOrderId,
        shopifyOrderName: event.shopifyOrderName,
        reasonCode: event.reasonCode,
        diagnosticReason: error,
      }),
    },
  });
}

async function resolveProductPanelFailureSignal(eventId: string) {
  await prisma.operationalSignal.updateMany({
    where: {
      id: `product-panel-variant-disable-${eventId}`,
      status: {
        in: [OperationalSignalStatus.ACTIVE, OperationalSignalStatus.ACKNOWLEDGED],
      },
    },
    data: {
      status: OperationalSignalStatus.RESOLVED,
      resolvedAt: new Date(),
    },
  });
}

export async function enqueueProductPanelVariantDisableEventsForRejectedAllocation(input: QueueEventInput) {
  const reasonCode = normalizeReasonCode(input.reasonCode);
  if (!shouldQueueProductPanelVariantDisableEvent(reasonCode)) {
    return [];
  }

  const allocation = await prisma.vendorAllocation.findUnique({
    where: {
      id: input.allocationId,
    },
    include: {
      assignedVendor: {
        select: {
          id: true,
          name: true,
        },
      },
      order: {
        select: {
          sourceShopifyOrderId: true,
          sourceShopifyOrderNumber: true,
        },
      },
      lineItems: {
        include: {
          shopifyOrderLineItem: {
            select: {
              sourceLineItemId: true,
              sourceVariantId: true,
              sku: true,
            },
          },
        },
        orderBy: {
          createdAt: 'asc',
        },
      },
    },
  });

  if (!allocation) {
    return [];
  }

  const requestedAt = input.requestedAt ?? new Date();
  const environment = readEnvironment(input.environment);
  const dryRun = input.dryRun ?? true;

  const events = [];
  for (const lineItem of allocation.lineItems) {
    const shopifyVariantId = lineItem.shopifyOrderLineItem.sourceVariantId;
    const idempotencyKey = buildIdempotencyKey(allocation.id, lineItem.id, reasonCode);
    const missingVariantError = shopifyVariantId
      ? null
      : 'Missing Shopify variant id for Product Panel availability dry-run.';
    const status = missingVariantError
      ? ProductPanelVariantDisableOutboxStatus.FAILED
      : ProductPanelVariantDisableOutboxStatus.CREATED;

    events.push(
      await prisma.productPanelVariantDisableOutboxEvent.upsert({
        where: {
          idempotencyKey,
        },
        create: {
          allocationId: allocation.id,
          vendorAllocationLineItemId: lineItem.id,
          shopifyVariantId,
          shopifyLineItemId: lineItem.shopifyOrderLineItem.sourceLineItemId,
          variantSku: lineItem.shopifyOrderLineItem.sku,
          vendorId: allocation.assignedVendorId,
          vendorName: allocation.assignedVendor.name,
          shopifyOrderId: allocation.order.sourceShopifyOrderId,
          shopifyOrderName: allocation.order.sourceShopifyOrderNumber,
          reasonCode,
          reasonText: input.reasonText ?? null,
          quantity: lineItem.quantity,
          requestedAt,
          environment,
          dryRun,
          status,
          error: missingVariantError,
          idempotencyKey,
        },
        update: {
          shopifyVariantId,
          shopifyLineItemId: lineItem.shopifyOrderLineItem.sourceLineItemId,
          variantSku: lineItem.shopifyOrderLineItem.sku,
          vendorId: allocation.assignedVendorId,
          vendorName: allocation.assignedVendor.name,
          shopifyOrderId: allocation.order.sourceShopifyOrderId,
          shopifyOrderName: allocation.order.sourceShopifyOrderNumber,
          reasonText: input.reasonText ?? null,
          quantity: lineItem.quantity,
          environment,
          dryRun,
        },
      }),
    );
  }

  return events;
}

export async function sendProductPanelVariantDisableDryRunEvents(
  env: ProductPanelEnv,
  options: {
    limit?: number;
    fetchImpl?: FetchLike;
    eventIds?: string[];
    statuses?: ProductPanelVariantDisableOutboxStatus[];
  } = {},
) {
  if (!env.PRODUCT_PANEL_VARIANT_DISABLE_ENABLED) {
    return {
      processed: 0,
      resolved: 0,
      failed: 0,
      skipped: 0,
      disabled: true,
    };
  }

  const requestDryRun = env.PRODUCT_PANEL_VARIANT_DISABLE_DRY_RUN;
  const baseUrl = env.PRODUCT_PANEL_BASE_URL?.trim();
  const secret = env.PRODUCT_PANEL_HMAC_SECRET?.trim();
  const eventIds = options.eventIds?.map((eventId) => eventId.trim()).filter(Boolean);
  if (options.eventIds && !eventIds?.length) {
    return {
      processed: 0,
      resolved: 0,
      failed: 0,
      skipped: 0,
      disabled: false,
    };
  }

  const statuses = options.statuses?.length
    ? options.statuses
    : [ProductPanelVariantDisableOutboxStatus.CREATED];
  const events = await prisma.productPanelVariantDisableOutboxEvent.findMany({
    where: {
      status: {
        in: statuses,
      },
      ...(eventIds?.length ? { id: { in: eventIds } } : {}),
    },
    orderBy: {
      requestedAt: 'asc',
    },
    take: options.limit ?? 25,
  });

  let resolved = 0;
  let failed = 0;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  for (const event of events) {
    const payload = buildDisablePayload(event, requestDryRun);
    const requestPayloadJson = payload ? toJsonObject(payload) : undefined;
    if (!payload) {
      await markProductPanelEventFailed(
        event,
        `Missing Shopify variant id for Product Panel availability ${requestDryRun ? 'dry-run' : 'disable request'}.`,
        undefined,
        requestPayloadJson,
        requestDryRun,
      );
      failed += 1;
      continue;
    }

    if (!baseUrl || !secret) {
      await markProductPanelEventFailed(
        event,
        'Product Panel base URL or HMAC secret is not configured.',
        undefined,
        requestPayloadJson,
        requestDryRun,
      );
      failed += 1;
      continue;
    }

    const body = JSON.stringify(payload);
    const signature = signPayload(secret, body, event.idempotencyKey);

    try {
      const response = await fetchImpl(new URL(PRODUCT_PANEL_VARIANT_DISABLE_PATH, baseUrl), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': event.idempotencyKey,
          'X-Sporgym-Timestamp': signature.timestamp,
          'X-Sporgym-Nonce': signature.nonce,
          'X-Sporgym-Signature': signature.signature,
        },
        body,
      });
      const responseBody = parseJsonObject(await response.text());
      const responseJson = toResponseJson(responseBody);

      if (response.ok && isProductPanelDisableResolved(responseBody, requestDryRun)) {
        await prisma.productPanelVariantDisableOutboxEvent.update({
          where: {
            id: event.id,
          },
          data: {
            status: ProductPanelVariantDisableOutboxStatus.RESOLVED_DRY_RUN,
            dryRun: requestDryRun,
            attemptCount: event.attemptCount + 1,
            error: null,
            requestPayloadJson,
            responseJson,
            resolvedAt: new Date(),
            failedAt: null,
          },
        });
        await resolveProductPanelFailureSignal(event.id);
        resolved += 1;
      } else {
        await markProductPanelEventFailed(
          event,
          `Product Panel variant disable ${requestDryRun ? 'dry-run ' : ''}failed with status ${response.status}.`,
          responseJson,
          requestPayloadJson,
          requestDryRun,
        );
        failed += 1;
      }
    } catch (error) {
      await markProductPanelEventFailed(
        event,
        error instanceof Error ? error.message : 'Product Panel variant disable request failed.',
        undefined,
        requestPayloadJson,
        requestDryRun,
      );
      failed += 1;
    }
  }

  return {
    processed: events.length,
    resolved,
    failed,
    skipped: 0,
    disabled: false,
  };
}

export async function sendProductPanelVariantDisableDryRunEventsForOrder(
  env: ProductPanelEnv,
  input: {
    shopifyOrderId: string;
    limit?: number;
    fetchImpl?: FetchLike;
  },
) {
  const shopifyOrderId = input.shopifyOrderId.trim();
  if (!shopifyOrderId) {
    throw new ProductPanelVariantDisableDryRunSendError('Shopify order id is required.', 400);
  }

  if (!env.PRODUCT_PANEL_VARIANT_DISABLE_ENABLED) {
    throw new ProductPanelVariantDisableDryRunSendError('Product Panel variant disable dry-run sender is disabled.');
  }

  if (!env.PRODUCT_PANEL_BASE_URL?.trim() || !env.PRODUCT_PANEL_HMAC_SECRET?.trim()) {
    throw new ProductPanelVariantDisableDryRunSendError('Product Panel base URL or HMAC secret is not configured.');
  }

  const retryableStatuses = [
    ProductPanelVariantDisableOutboxStatus.CREATED,
    ProductPanelVariantDisableOutboxStatus.FAILED,
  ];
  const candidates = await prisma.productPanelVariantDisableOutboxEvent.findMany({
    where: {
      shopifyOrderId,
      reasonCode: CancellationReason.OUT_OF_STOCK,
      status: {
        in: retryableStatuses,
      },
    },
    orderBy: {
      requestedAt: 'asc',
    },
    take: input.limit ?? 25,
  });
  const sendableEventIds = candidates
    .filter((event) => Boolean(event.shopifyVariantId))
    .map((event) => event.id);
  const skippedBeforeSend = candidates.length - sendableEventIds.length;

  const sendResult = sendableEventIds.length
    ? await sendProductPanelVariantDisableDryRunEvents(env, {
        eventIds: sendableEventIds,
        statuses: retryableStatuses,
        limit: sendableEventIds.length,
        fetchImpl: input.fetchImpl,
      })
    : {
        processed: 0,
        resolved: 0,
        failed: 0,
        skipped: 0,
        disabled: false,
      };

  const latestEvents = await prisma.productPanelVariantDisableOutboxEvent.findMany({
    where: {
      shopifyOrderId,
      reasonCode: CancellationReason.OUT_OF_STOCK,
    },
    orderBy: {
      requestedAt: 'desc',
    },
    take: input.limit ?? 25,
  });

  return {
    ok: true,
    attempted: sendResult.processed,
    resolved: sendResult.resolved,
    failed: sendResult.failed,
    skipped: skippedBeforeSend + sendResult.skipped,
    latestEventStatuses: latestEvents.map(mapEventStatusSummary),
  };
}
