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

function buildDisablePayload(event: ProductPanelVariantDisableOutboxEvent): ProductPanelDisablePayload | null {
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
  };
}

function signPayload(secret: string, body: string, idempotencyKey: string) {
  const timestamp = new Date().toISOString();
  const nonce = randomUUID();
  const signature = createHmac('sha256', secret)
    .update(`${timestamp}.${nonce}.${idempotencyKey}.${body}`)
    .digest('hex');

  return {
    timestamp,
    nonce,
    signature: `sha256=${signature}`,
  };
}

function isDryRunResolved(responseBody: Record<string, unknown>) {
  return (
    responseBody.accepted === true &&
    responseBody.dryRun === true &&
    responseBody.writesPerformed !== true
  );
}

async function markProductPanelEventFailed(
  event: ProductPanelVariantDisableOutboxEvent,
  error: string,
  responseJson?: Prisma.InputJsonValue,
  requestPayloadJson?: Prisma.InputJsonValue,
) {
  const failedAt = new Date();
  const updated = await prisma.productPanelVariantDisableOutboxEvent.update({
    where: {
      id: event.id,
    },
    data: {
      status: ProductPanelVariantDisableOutboxStatus.FAILED,
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
      title: 'Product Panel variant dry-run failed',
      description: `Product Panel availability dry-run failed for ${event.variantSku ?? event.shopifyVariantId ?? 'variant'}. Reject workflow was preserved.`,
      suggestedAction: 'Review Product Panel availability mapping or retry the dry-run sender.',
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
      title: 'Product Panel variant dry-run failed',
      description: `Product Panel availability dry-run failed for ${event.variantSku ?? event.shopifyVariantId ?? 'variant'}. Reject workflow was preserved.`,
      suggestedAction: 'Review Product Panel availability mapping or retry the dry-run sender.',
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

  if (!env.PRODUCT_PANEL_VARIANT_DISABLE_DRY_RUN) {
    return {
      processed: 0,
      resolved: 0,
      failed: 0,
      skipped: 0,
      disabled: false,
      error: 'Product Panel variant disable sender is dry-run only in this phase.',
    };
  }

  const baseUrl = env.PRODUCT_PANEL_BASE_URL?.trim();
  const secret = env.PRODUCT_PANEL_HMAC_SECRET?.trim();
  const events = await prisma.productPanelVariantDisableOutboxEvent.findMany({
    where: {
      status: ProductPanelVariantDisableOutboxStatus.CREATED,
      dryRun: true,
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
    const payload = buildDisablePayload(event);
    const requestPayloadJson = payload ? toJsonObject(payload) : undefined;
    if (!payload) {
      await markProductPanelEventFailed(
        event,
        'Missing Shopify variant id for Product Panel availability dry-run.',
        undefined,
        requestPayloadJson,
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
          'X-Product-Panel-Timestamp': signature.timestamp,
          'X-Product-Panel-Nonce': signature.nonce,
          'X-Product-Panel-Signature': signature.signature,
        },
        body,
      });
      const responseBody = parseJsonObject(await response.text());
      const responseJson = toResponseJson(responseBody);

      if (response.ok && isDryRunResolved(responseBody)) {
        await prisma.productPanelVariantDisableOutboxEvent.update({
          where: {
            id: event.id,
          },
          data: {
            status: ProductPanelVariantDisableOutboxStatus.RESOLVED_DRY_RUN,
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
          `Product Panel dry-run failed with status ${response.status}.`,
          responseJson,
          requestPayloadJson,
        );
        failed += 1;
      }
    } catch (error) {
      await markProductPanelEventFailed(
        event,
        error instanceof Error ? error.message : 'Product Panel dry-run request failed.',
        undefined,
        requestPayloadJson,
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
