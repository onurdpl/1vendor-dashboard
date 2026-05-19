import type { WebhookEvent } from '@prisma/client';
import { prisma } from '../../db/prisma.js';

export const SHOPIFY_RETURN_SIGNAL_TOPICS = [
  'returns/create',
  'returns/request',
  'returns/update',
  'returns/approve',
  'returns/decline',
  'returns/close',
  'returns/cancel',
  'refunds/create',
  'orders/updated',
  'fulfillment_orders/updated',
] as const;

type ShopifyReturnSignalTopic = typeof SHOPIFY_RETURN_SIGNAL_TOPICS[number];

export type ShopifyReturnSignalDiscoverySummary = {
  topic: string;
  receivedAt: string;
  topLevelPayloadKeys: string[];
  orderIdPresent: boolean;
  returnIdPresent: boolean;
  lineItemIdsPresent: boolean;
  refundIdPresent: boolean;
  financialStatus: string | null;
  fulfillmentStatus: string | null;
  matchedOrderId: string | null;
  matchedByField: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown, keys: string[]) {
  if (!isRecord(value)) {
    return null;
  }

  for (const key of keys) {
    const raw = value[key];
    if (typeof raw === 'string' && raw.trim()) {
      return raw.trim();
    }
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      return String(raw);
    }
  }

  return null;
}

function normalizeGidTail(value: string | null) {
  if (!value) {
    return null;
  }

  const tail = value.split('/').at(-1)?.trim();
  return tail || value.trim();
}

function readNestedRecords(value: unknown, key: string): Record<string, unknown>[] {
  if (!isRecord(value)) {
    return [];
  }

  const raw = value[key];
  if (Array.isArray(raw)) {
    return raw.filter(isRecord);
  }

  return isRecord(raw) ? [raw] : [];
}

function collectLineItemIds(value: unknown): string[] {
  const ids = new Set<string>();
  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!isRecord(node)) {
      return;
    }

    const maybeLineItemId = readString(node, ['line_item_id', 'lineItemId', 'line_item_gid', 'lineItemGid']);
    if (maybeLineItemId) {
      ids.add(normalizeGidTail(maybeLineItemId) ?? maybeLineItemId);
    }

    const lineItem = isRecord(node.line_item) ? node.line_item : isRecord(node.lineItem) ? node.lineItem : null;
    const nestedLineItemId = readString(lineItem, ['id', 'admin_graphql_api_id', 'adminGraphqlApiId']);
    if (nestedLineItemId) {
      ids.add(normalizeGidTail(nestedLineItemId) ?? nestedLineItemId);
    }

    for (const [key, child] of Object.entries(node)) {
      if (key.toLowerCase().includes('customer')) {
        continue;
      }
      if (Array.isArray(child) || isRecord(child)) {
        visit(child);
      }
    }
  };

  visit(value);
  return [...ids].filter(Boolean);
}

function resolvePayloadOrderCandidate(payload: Record<string, unknown>) {
  const direct =
    readString(payload, ['order_id', 'orderId', 'sourceShopifyOrderId']) ??
    normalizeGidTail(readString(payload, ['admin_graphql_api_order_id', 'orderGid', 'order_gid']));
  if (direct) {
    return { value: direct, field: 'order_id' };
  }

  const order = isRecord(payload.order) ? payload.order : null;
  const nestedOrderId =
    readString(order, ['id', 'order_id', 'orderId']) ??
    normalizeGidTail(readString(order, ['admin_graphql_api_id', 'adminGraphqlApiId', 'gid']));
  if (nestedOrderId) {
    return { value: nestedOrderId, field: 'order.id' };
  }

  const orderNumber = readString(payload, ['order_number', 'orderNumber', 'name']);
  if (orderNumber) {
    return { value: orderNumber.replace(/^#/, ''), field: 'order_number' };
  }

  return null;
}

function resolvePayloadReturnId(payload: Record<string, unknown>, topic = '') {
  const returnGid = readString(payload, ['admin_graphql_api_id', 'adminGraphqlApiId', 'returnGid', 'return_gid']);
  if (returnGid && returnGid.includes('/Return/')) {
    return normalizeGidTail(returnGid);
  }

  const direct = readString(payload, ['return_id', 'returnId']);
  if (direct) {
    return normalizeGidTail(direct);
  }

  const topicLikeReturnId = readString(payload, ['id']);
  return topicLikeReturnId && (topic.startsWith('returns/') || returnGid || payload.return_line_items || payload.returnLineItems)
    ? normalizeGidTail(topicLikeReturnId)
    : null;
}

function resolvePayloadRefundId(payload: Record<string, unknown>) {
  return readString(payload, ['refund_id', 'refundId']) ?? (payload.refund_line_items || payload.refundLineItems ? readString(payload, ['id']) : null);
}

async function findMatchingOrder(payload: Record<string, unknown>) {
  const candidate = resolvePayloadOrderCandidate(payload);
  if (!candidate) {
    return { order: null, matchedByField: null };
  }

  const normalizedCandidate = normalizeGidTail(candidate.value) ?? candidate.value;
  const order = await prisma.shopifyOrder.findFirst({
    where: {
      OR: [
        { sourceShopifyOrderId: normalizedCandidate },
        { sourceShopifyOrderNumber: normalizedCandidate },
        { sourceShopifyOrderNumber: `#${normalizedCandidate}` },
      ],
    },
    select: {
      id: true,
      sourceShopifyOrderId: true,
      sourceShopifyOrderNumber: true,
    },
  });

  return {
    order,
    matchedByField: order ? candidate.field : null,
  };
}

export function isShopifyReturnSignalTopic(topic: string): topic is ShopifyReturnSignalTopic {
  return SHOPIFY_RETURN_SIGNAL_TOPICS.includes(topic as ShopifyReturnSignalTopic);
}

export function summarizeShopifyReturnSignalPayload(
  topic: string,
  payload: unknown,
  receivedAt: Date | string,
  match: { matchedOrderId?: string | null; matchedByField?: string | null } = {},
): ShopifyReturnSignalDiscoverySummary {
  const record = isRecord(payload) ? payload : {};
  const returnId = resolvePayloadReturnId(record, topic);
  const refundId = resolvePayloadRefundId(record);
  const lineItemIds = collectLineItemIds(record);
  const financialStatus = readString(record, ['financial_status', 'financialStatus']);
  const fulfillmentStatus = readString(record, ['fulfillment_status', 'fulfillmentStatus', 'displayFulfillmentStatus']);

  return {
    topic,
    receivedAt: receivedAt instanceof Date ? receivedAt.toISOString() : receivedAt,
    topLevelPayloadKeys: Object.keys(record).sort(),
    orderIdPresent: Boolean(resolvePayloadOrderCandidate(record)),
    returnIdPresent: Boolean(returnId),
    lineItemIdsPresent: lineItemIds.length > 0,
    refundIdPresent: Boolean(refundId),
    financialStatus,
    fulfillmentStatus,
    matchedOrderId: match.matchedOrderId ?? null,
    matchedByField: match.matchedByField ?? null,
  };
}

export async function recordShopifyReturnSignalDiscovery(input: {
  event: WebhookEvent;
  payload: unknown;
  topic?: string;
  markProcessed?: boolean;
}): Promise<ShopifyReturnSignalDiscoverySummary> {
  const topic = input.topic ?? input.event.topic;
  const payload = isRecord(input.payload) ? input.payload : {};
  const match = await findMatchingOrder(payload);
  const summary = summarizeShopifyReturnSignalPayload(topic, payload, input.event.receivedAt, {
    matchedOrderId: match.order?.id ?? null,
    matchedByField: match.matchedByField,
  });

  await prisma.webhookEvent.update({
    where: { id: input.event.id },
    data: {
      ...(match.order ? { shopifyOrderId: match.order.id } : {}),
      ...(input.markProcessed
        ? {
            status: 'PROCESSED',
            processedAt: new Date(),
            errorMessage: null,
          }
        : {}),
    },
  });

  return summary;
}

export function mapWebhookEventToReturnSignalDiscovery(event: {
  topic: string;
  receivedAt: Date;
  rawPayload: string | null;
  shopifyOrderId?: string | null;
}): ShopifyReturnSignalDiscoverySummary | null {
  if (!isShopifyReturnSignalTopic(event.topic)) {
    return null;
  }

  let payload: unknown = {};
  if (event.rawPayload) {
    try {
      payload = JSON.parse(event.rawPayload);
    } catch {
      payload = {};
    }
  }

  return summarizeShopifyReturnSignalPayload(event.topic, payload, event.receivedAt, {
    matchedOrderId: event.shopifyOrderId ?? null,
    matchedByField: event.shopifyOrderId ? 'stored_webhook_order_relation' : null,
  });
}
