import { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { prisma } from '../../db/prisma.js';
import type { AppEnv } from '../../config/env.js';
import {
  createShippingProviderAdapter,
  ShippingProviderExecutionError,
  type ShippingProviderAdapter,
} from '../shipping/shipping-provider.adapter.js';
import {
  summarizeNavlungoCreatePostRequest,
  type NavlungoCreatePostPayload,
  type NavlungoCreatePostEndpointPath,
} from '../shipping/navlungo-provider.adapter.js';
import type { ReturnDetailDto, ReturnSummaryDto } from './returns.types.js';
import {
  backfillMissingLineItemImages,
  type ShopifyLineItemImageLookupService,
} from '../orders/orders.service.js';

export class ReturnReviewError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'ReturnReviewError';
    this.statusCode = statusCode;
  }
}

export type ReturnActorScope = {
  role: 'admin' | 'vendor' | 'support' | 'finance';
  vendorId?: string | null;
};

export type NavlungoReturnPickupInput = {
  dryRun?: boolean;
  adapter?: ShippingProviderAdapter;
  autoCreate?: boolean;
  apiVersionOverride?: 'current' | 'v2' | 'v2.1';
  endpointVersionOverride?: 'current' | 'v2' | 'v2.1';
  carrierOverride?: 'current' | '9' | '10';
  carrierIdOverride?: 'current' | '9' | '10';
  endpointPathOverride?: NavlungoCreatePostEndpointPath;
  diagnosticConfirm?: 'YES';
  customerOverrides?: {
    name?: string;
    phone?: string;
    email?: string;
    country?: string;
    postcode?: string;
    post_code?: string;
    city?: string;
    district?: string;
    address?: string;
  };
};

export type NavlungoReturnStatusSyncInput = {
  adapter?: ShippingProviderAdapter;
};

export type NavlungoReturnPickupCompletionInput = NonNullable<NavlungoReturnPickupInput['customerOverrides']>;

function toAmountString(value: number) {
  return value.toFixed(2);
}

function toNumber(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function getRefundSourceId(record: {
  sourceShopifyRefundId: string | null;
  vendorAllocation: {
    refundRecords: Array<{
      sourceShopifyRefundId: string;
    }>;
  };
}) {
  return record.sourceShopifyRefundId ?? record.vendorAllocation.refundRecords[0]?.sourceShopifyRefundId ?? '';
}

function getLifecycleStatus(status: string, lifecycleStatus: string | null) {
  return lifecycleStatus || status;
}

function isReturnRequestRecord(record: { returnRequestSource: string | null }) {
  return record.returnRequestSource === 'shopify_return_request';
}

function normalizeVendorDecision(value: string | null): 'approved' | 'rejected' | null {
  return value === 'approved' || value === 'rejected' ? value : null;
}

function canActOnReturn(record: { vendorAllocation: { assignedVendorId: string } }, actor: ReturnActorScope) {
  return actor.role === 'admin' || record.vendorAllocation.assignedVendorId === actor.vendorId;
}

function readText(value: string | null | undefined) {
  const text = value?.trim();
  const normalized = text?.toLowerCase();
  if (
    !text ||
    text === 'Return item' ||
    normalized === 'default' ||
    normalized === 'default title' ||
    /^gid:\/\//i.test(text) ||
    /^unknown-sku$/i.test(text)
  ) {
    return null;
  }

  return text;
}

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

function readNumber(value: unknown, keys: string[]) {
  if (!isRecord(value)) {
    return null;
  }
  for (const key of keys) {
    const raw = value[key];
    const numeric = Number(raw);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }
  return null;
}

function readBoolean(value: unknown, keys: string[]) {
  if (!isRecord(value)) {
    return null;
  }
  for (const key of keys) {
    const raw = value[key];
    if (typeof raw === 'boolean') {
      return raw;
    }
  }
  return null;
}

function readStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
}

function readSnapshot(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function readIsoDate(value: unknown, keys: string[]) {
  const raw = readString(value, keys);
  if (!raw) {
    return null;
  }
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function sanitizeNavlungoReferencePart(value: string | null | undefined, fallback: string, length?: number) {
  const sanitized = (value ?? '')
    .trim()
    .replace(/^#+/, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '');
  const safe = sanitized || fallback;
  return length ? safe.padEnd(length, '0').slice(0, length) : safe;
}

function buildNavlungoShortUniqueReferencePart() {
  const numeric = randomBytes(4).readUInt32BE(0);
  return numeric.toString(36).toUpperCase().replace(/[^A-Z0-9]/g, '').padStart(6, '0').slice(-6);
}

function buildNavlungoReturnReferenceId(input: {
  vendorId: string;
  shopifyOrderNumber: string | null;
  providerMetadata?: unknown;
}) {
  const metadataStoreShort = readString(input.providerMetadata, [
    'navlungoStoreShort',
    'storeShort',
    'store_short',
    'storeCode',
  ]);
  const storeShort = sanitizeNavlungoReferencePart(metadataStoreShort ?? input.vendorId, 'ST', 2);
  const orderNumber = sanitizeNavlungoReferencePart(input.shopifyOrderNumber, 'ORDER');
  return `${storeShort}-RET-${orderNumber}-${buildNavlungoShortUniqueReferencePart()}`;
}

function normalizeNavlungoPhone(value: string | null | undefined) {
  const digits = value?.replace(/\D+/g, '') ?? '';
  const national = digits.startsWith('90') && digits.length === 12
    ? digits.slice(2)
    : digits.startsWith('0') && digits.length === 11
      ? digits.slice(1)
      : digits.startsWith('5') && digits.length === 10
        ? digits
        : digits;
  if (national.length === 10 && national.startsWith('5')) {
    return `+90 ${national.slice(0, 3)} ${national.slice(3, 6)} ${national.slice(6, 8)} ${national.slice(8, 10)}`;
  }
  return value?.trim() || null;
}

function composeShipmentAddress(order: {
  shippingAddress: string | null;
}) {
  return order.shippingAddress?.trim() || null;
}

function resolveNavlungoSenderAddressId(config: {
  defaultWarehouseId: string | null;
  providerMetadata: unknown;
  warehouses: Array<{ warehouseId: string; provider: string; isDefault: boolean }>;
}, env: AppEnv) {
  return (
    readString(config.providerMetadata, ['navlungoSenderAddressId', 'senderAddressId', 'sender_address_id']) ??
    config.warehouses.find((warehouse) => warehouse.provider.toLowerCase() === 'navlungo' && warehouse.isDefault)?.warehouseId ??
    config.warehouses.find((warehouse) => warehouse.provider.toLowerCase() === 'navlungo')?.warehouseId ??
    config.defaultWarehouseId ??
    env.NAVLUNGO_DEFAULT_SENDER_ADDRESS_ID ??
    null
  );
}

function resolveNavlungoReturnRecipientAddressId(config: {
  providerMetadata: unknown;
}, env: AppEnv) {
  const metadataValue = readString(config.providerMetadata, [
    'navlungoReturnRecipientAddressId',
    'returnRecipientAddressId',
    'return_recipient_address_id',
    'navlungoReturnAddressId',
    'returnAddressId',
  ]);
  if (metadataValue !== null) {
    return {
      value: metadataValue,
      source: 'provider_metadata',
    };
  }

  if (env.NAVLUNGO_RETURN_RECIPIENT_ADDRESS_ID?.trim()) {
    return {
      value: env.NAVLUNGO_RETURN_RECIPIENT_ADDRESS_ID,
      source: 'env',
    };
  }

  return {
    value: null,
    source: 'missing',
  };
}

function summarizeNavlungoReturnRecipientMetadata(providerMetadata: unknown) {
  const name = readString(providerMetadata, ['navlungoReturnRecipientName', 'returnRecipientName', 'return_recipient_name']);
  const city = readString(providerMetadata, ['navlungoReturnRecipientCity', 'returnRecipientCity', 'return_recipient_city']);
  const district = readString(providerMetadata, [
    'navlungoReturnRecipientDistrict',
    'returnRecipientDistrict',
    'return_recipient_district',
  ]);
  const configured = Boolean(name?.trim() || city?.trim() || district?.trim());

  return {
    configured,
    name: name?.trim() || null,
    city: city?.trim() || null,
    district: district?.trim() || null,
  };
}

function parsePositiveInteger(value: string | null | undefined) {
  if (!value?.trim()) {
    return null;
  }
  const numeric = Number(value.trim());
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

function resolveNavlungoCarrierId(providerMetadata: unknown, env: AppEnv) {
  return parsePositiveInteger(
    readString(providerMetadata, ['navlungoCarrierId', 'carrierId', 'carrier_id']) ?? env.NAVLUNGO_DEFAULT_CARRIER_ID ?? '9',
  );
}

function resolveNavlungoDiagnosticCarrierId(
  providerMetadata: unknown,
  env: AppEnv,
  carrierOverride: NavlungoReturnPickupInput['carrierOverride'] | NavlungoReturnPickupInput['carrierIdOverride'],
) {
  if (carrierOverride === '9' || carrierOverride === '10') {
    return Number(carrierOverride);
  }
  return resolveNavlungoCarrierId(providerMetadata, env);
}

function resolveNavlungoReturnBarcodeFormat(providerMetadata: unknown) {
  return readString(providerMetadata, [
    'navlungoReturnBarcodeFormat',
    'returnBarcodeFormat',
    'return_barcode_format',
    'navlungo_return_barcode_format',
  ]) ?? 'pdf-A5';
}

function resolveNavlungoDiagnosticEndpointPath(
  endpointPathOverride: NavlungoReturnPickupInput['endpointPathOverride'],
): NavlungoCreatePostEndpointPath {
  return endpointPathOverride === '/post/create' ? '/post/create' : '/post/return';
}

function resolveNavlungoDiagnosticBaseUrl(
  env: AppEnv,
  apiVersionOverride: NavlungoReturnPickupInput['apiVersionOverride'] | NavlungoReturnPickupInput['endpointVersionOverride'],
  endpointPathOverride: NavlungoReturnPickupInput['endpointPathOverride'],
) {
  const selectedVersion = apiVersionOverride === 'v2' || apiVersionOverride === 'v2.1' ? apiVersionOverride : 'current';
  const baseUrl = env.NAVLUNGO_BASE_URL?.trim();
  const endpointPath = resolveNavlungoDiagnosticEndpointPath(endpointPathOverride);
  if (!baseUrl || selectedVersion === 'current') {
    let resolvedProviderPath: string = endpointPath;
    if (baseUrl) {
      try {
        resolvedProviderPath = `${new URL(baseUrl).pathname.replace(/\/$/, '') || ''}${endpointPath}`;
      } catch {
        resolvedProviderPath = endpointPath;
      }
    }
    return {
      env,
      versionTried: selectedVersion,
      endpointPath,
      baseUrlOverride: null,
      resolvedProviderPath,
      resolvedProviderUrl: baseUrl ? `${baseUrl.replace(/\/$/, '')}${endpointPath}` : null,
    };
  }

  try {
    const url = new URL(baseUrl);
    url.pathname = `/${selectedVersion}`;
    const nextBaseUrl = url.toString().replace(/\/$/, '');
    return {
      env: {
        ...env,
        NAVLUNGO_BASE_URL: nextBaseUrl,
      },
      versionTried: selectedVersion,
      endpointPath,
      baseUrlOverride: nextBaseUrl,
      resolvedProviderPath: `/${selectedVersion}${endpointPath}`,
      resolvedProviderUrl: `${nextBaseUrl}${endpointPath}`,
    };
  } catch {
    return {
      env,
      versionTried: selectedVersion,
      endpointPath,
      baseUrlOverride: null,
      resolvedProviderPath: endpointPath,
      resolvedProviderUrl: null,
    };
  }
}

function safeShopifyReturnIdShort(value: string | null) {
  const normalized = value?.trim() ?? '';
  if (!normalized) {
    return '';
  }
  return normalized.split('/').filter(Boolean).at(-1)?.replace(/[^A-Za-z0-9_-]/g, '') ?? '';
}

function readProductText(value: string | null | undefined, sku: string | null | undefined) {
  const text = readText(value)
    ?.replace(/\s*\/\s*default(?:\s+title)?$/i, '')
    .trim();
  const normalizedSku = readText(sku);
  if (!text || (normalizedSku && text === normalizedSku) || /^\d{6,}$/.test(text)) {
    return null;
  }

  return text;
}

function resolveReturnedItemDisplayTitle(item: {
  sku: string | null;
  title: string | null;
  orderLineItemTitle?: string | null;
}) {
  return (
    readProductText(item.orderLineItemTitle, item.sku) ??
    readProductText(item.title, item.sku) ??
    readText(item.sku) ??
    null
  );
}

function resolveReturnedItemVariantTitle(item: {
  sku: string | null;
  title: string | null;
  orderLineItemTitle?: string | null;
}) {
  const displayTitle = resolveReturnedItemDisplayTitle(item);
  const variantTitle = readProductText(item.orderLineItemTitle, item.sku);
  return variantTitle && variantTitle !== displayTitle ? variantTitle : null;
}

function withReturnedItemDisplayFields<T extends {
  sku: string | null;
  title: string | null;
  orderLineItemTitle?: string | null;
}>(item: T) {
  const displayTitle = resolveReturnedItemDisplayTitle(item);
  return {
    ...item,
    itemTitle: displayTitle,
    displayTitle,
    variantTitle: resolveReturnedItemVariantTitle(item),
  };
}

function mapReturnProviderSnapshot(value: unknown): Record<string, unknown> | null {
  const snapshot = readSnapshot(value);
  if (!snapshot) {
    return null;
  }
  if (!isRecord(snapshot.navlungoReturnPickupCustomerOverrides)) {
    return snapshot;
  }
  const overrideKeys = Object.keys(snapshot.navlungoReturnPickupCustomerOverrides)
    .filter((key) => typeof key === 'string')
    .sort();
  return {
    ...snapshot,
    navlungoReturnPickupCustomerOverrides: undefined,
    navlungoReturnPickupCustomerOverrideKeys: overrideKeys,
    navlungoReturnPickupCustomerOverrideValuesRedacted: true,
  };
}

type ReturnRecordLineItemSource = {
  id: string;
  sourceLineItemId: string;
  sourceVariantId: string | null;
  sku: string | null;
  title: string | null;
  orderLineItemTitle: string | null;
  imageUrl: string | null;
  quantity: number;
  refundAmount: string;
};

function normalizeShopifyIdentifier(value: string | null | undefined) {
  const text = value?.trim();
  if (!text) {
    return null;
  }
  const parts = text.split('/').filter(Boolean);
  return parts.at(-1) ?? text;
}

function identifiersMatch(left: string | null | undefined, right: string | null | undefined) {
  const leftText = left?.trim();
  const rightText = right?.trim();
  if (!leftText || !rightText) {
    return false;
  }
  return leftText === rightText || normalizeShopifyIdentifier(leftText) === normalizeShopifyIdentifier(rightText);
}

function setImageLookupValue(map: Map<string, string>, key: string | null | undefined, imageUrl: string) {
  const text = key?.trim();
  if (!text) {
    return;
  }
  map.set(text, imageUrl);
  const normalized = normalizeShopifyIdentifier(text);
  if (normalized) {
    map.set(normalized, imageUrl);
  }
}

function buildReturnLineItemImageLookup(lineItems: Array<Parameters<typeof toAllocationReturnedItem>[0]>) {
  const byLineItemId = new Map<string, string>();
  const byVariantId = new Map<string, string>();
  const bySku = new Map<string, string>();

  for (const item of lineItems) {
    const imageUrl = item.shopifyOrderLineItem.imageUrl?.trim();
    if (!imageUrl) {
      continue;
    }
    setImageLookupValue(byLineItemId, item.shopifyOrderLineItem.sourceLineItemId, imageUrl);
    setImageLookupValue(byVariantId, item.shopifyOrderLineItem.sourceVariantId, imageUrl);
    const sku = item.shopifyOrderLineItem.sku?.trim();
    if (sku) {
      bySku.set(sku, imageUrl);
    }
  }

  return { byLineItemId, byVariantId, bySku };
}

function resolveReturnedItemImageUrl(
  item: ReturnRecordLineItemSource,
  lookup: ReturnType<typeof buildReturnLineItemImageLookup>,
) {
  const existing = item.imageUrl?.trim();
  if (existing) {
    return existing;
  }

  const lineItemImage =
    lookup.byLineItemId.get(item.sourceLineItemId) ??
    lookup.byLineItemId.get(normalizeShopifyIdentifier(item.sourceLineItemId) ?? '');
  if (lineItemImage) {
    return lineItemImage;
  }

  const variantImage =
    item.sourceVariantId
      ? lookup.byVariantId.get(item.sourceVariantId) ??
        lookup.byVariantId.get(normalizeShopifyIdentifier(item.sourceVariantId) ?? '')
      : null;
  if (variantImage) {
    return variantImage;
  }

  return item.sku ? lookup.bySku.get(item.sku) ?? null : null;
}

function toAllocationReturnedItem(item: {
  id: string;
  quantity: number;
  lineAmount: unknown;
  shopifyOrderLineItem: {
    sourceLineItemId: string;
    sourceVariantId: string | null;
    sku: string | null;
    title: string | null;
    imageUrl: string | null;
  };
}): ReturnRecordLineItemSource {
  return {
    id: item.id,
    sourceLineItemId: item.shopifyOrderLineItem.sourceLineItemId,
    sourceVariantId: item.shopifyOrderLineItem.sourceVariantId,
    sku: item.shopifyOrderLineItem.sku,
    title: item.shopifyOrderLineItem.title,
    orderLineItemTitle: item.shopifyOrderLineItem.title,
    imageUrl: item.shopifyOrderLineItem.imageUrl,
    quantity: item.quantity,
    refundAmount: toAmountString(toNumber(item.lineAmount)),
  };
}

function toRefundReturnedItem(item: {
  id: string;
  sourceLineItemId: string;
  sku: string | null;
  title: string | null;
  quantity: number;
  subtotal: unknown;
  shopifyOrderLineItem: {
    sourceVariantId: string | null;
    sku: string | null;
    title: string | null;
    imageUrl: string | null;
  };
}): ReturnRecordLineItemSource {
  return {
    id: item.id,
    sourceLineItemId: item.sourceLineItemId,
    sourceVariantId: item.shopifyOrderLineItem.sourceVariantId,
    sku: item.shopifyOrderLineItem.sku ?? item.sku,
    title: item.title,
    orderLineItemTitle: item.shopifyOrderLineItem.title,
    imageUrl: item.shopifyOrderLineItem.imageUrl,
    quantity: item.quantity,
    refundAmount: toAmountString(toNumber(item.subtotal)),
  };
}

function buildReturnedItemsForRecord(record: {
  returnRequestSource: string | null;
  sourceShopifyLineItemId: string | null;
  vendorAllocation: {
    lineItems: Array<Parameters<typeof toAllocationReturnedItem>[0]>;
  };
}, refundLineItems: Array<Parameters<typeof toRefundReturnedItem>[0]>) {
  const returnRequestLineItems = filterReturnRequestAllocationLineItems(record, record.vendorAllocation.lineItems);
  const itemSources = isReturnRequestRecord(record)
    ? returnRequestLineItems.map(toAllocationReturnedItem)
    : refundLineItems.length > 0
      ? refundLineItems.map(toRefundReturnedItem)
      : record.vendorAllocation.lineItems.map(toAllocationReturnedItem);
  const imageLookup = buildReturnLineItemImageLookup(record.vendorAllocation.lineItems);

  return itemSources
    .map((item) => ({
      ...item,
      imageUrl: resolveReturnedItemImageUrl(item, imageLookup),
    }))
    .map(withReturnedItemDisplayFields);
}

function filterReturnRequestAllocationLineItems<
  T extends {
    shopifyOrderLineItem: {
      sourceLineItemId: string;
    };
  },
>(record: { returnRequestSource: string | null; sourceShopifyLineItemId: string | null }, lineItems: T[]) {
  if (!isReturnRequestRecord(record)) {
    return lineItems;
  }

  if (!record.sourceShopifyLineItemId) {
    return [];
  }

  return lineItems.filter((item) =>
    identifiersMatch(item.shopifyOrderLineItem.sourceLineItemId, record.sourceShopifyLineItemId),
  );
}

function getMatchingRefundRecords(record: {
  sourceShopifyRefundId: string | null;
  returnRequestSource: string | null;
  vendorAllocation: {
    refundRecords: Array<{
      sourceShopifyRefundId: string;
      amount?: unknown;
      lineItems: Array<Parameters<typeof toRefundReturnedItem>[0]>;
    }>;
  };
}) {
  if (record.sourceShopifyRefundId) {
    return record.vendorAllocation.refundRecords.filter(
      (refund) => refund.sourceShopifyRefundId === record.sourceShopifyRefundId,
    );
  }

  return isReturnRequestRecord(record) ? [] : record.vendorAllocation.refundRecords;
}

export async function listVendorReturns(
  vendorId: string,
  options: { limit?: number; offset?: number } = {},
): Promise<ReturnSummaryDto[]> {
  const records = await prisma.returnRecord.findMany({
    where: {
      vendorAllocation: {
        assignedVendorId: vendorId,
      },
    },
    select: {
      id: true,
      sourceShopifyOrderId: true,
      sourceShopifyOrderNumber: true,
      sourceShopifyRefundId: true,
      sourceShopifyReturnId: true,
      sourceShopifyReturnGid: true,
      sourceShopifyLineItemId: true,
      returnLifecycleStatus: true,
      returnRequestSource: true,
      status: true,
      reason: true,
      returnReasonNote: true,
      returnProvider: true,
      returnProviderShipmentId: true,
      returnLabel: true,
      returnReferenceId: true,
      navlungoReturnCreatedAt: true,
      returnCarrierName: true,
      returnTrackingNumber: true,
      returnTrackingUrl: true,
      vendorReceivedAt: true,
      vendorReviewedAt: true,
      vendorDecision: true,
      vendorDecisionReason: true,
      createdAt: true,
      updatedAt: true,
      vendorAllocation: {
        select: {
          assignedVendorId: true,
          refundRecords: {
            select: {
              sourceShopifyRefundId: true,
              amount: true,
              lineItems: {
                select: {
                  id: true,
                  sourceLineItemId: true,
                  sku: true,
                  title: true,
                  quantity: true,
                  subtotal: true,
                  shopifyOrderLineItem: true,
                },
              },
            },
            orderBy: {
              createdAt: 'asc',
            },
          },
          lineItems: {
            select: {
              id: true,
              quantity: true,
              lineAmount: true,
              shopifyOrderLineItem: true,
            },
          },
        },
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
    take: options.limit ?? 100,
    skip: options.offset ?? 0,
  });

  return records.map((record) => {
    const matchingRefundRecords = getMatchingRefundRecords(record);
    const refundAmount = matchingRefundRecords.reduce(
      (sum, refund) => sum + toNumber(refund.amount),
      0,
    );
    const sourceRefundId = record.sourceShopifyRefundId ?? (isReturnRequestRecord(record) ? '' : getRefundSourceId(record));
    const returnRequestLineItems = filterReturnRequestAllocationLineItems(record, record.vendorAllocation.lineItems);
    const refundLineItemCount = matchingRefundRecords.reduce((sum, refund) => {
      return sum + (refund.lineItems.length > 0 ? refund.lineItems.length : 0);
    }, 0);
    const refundedItemCount = isReturnRequestRecord(record)
      ? returnRequestLineItems.length
      : refundLineItemCount || record.vendorAllocation.lineItems.length;
    const refundedSkus = isReturnRequestRecord(record)
      ? Array.from(
          new Set(
            returnRequestLineItems
              .map((item) => item.shopifyOrderLineItem.sku ?? null)
              .filter((sku): sku is string => Boolean(sku)),
          ),
        )
      : Array.from(
          new Set(
            matchingRefundRecords.flatMap((refund) =>
              refund.lineItems
                .map((item) => item.sku ?? null)
                .filter((sku): sku is string => Boolean(sku)),
            ),
          ),
        );
    const refundLineItems = matchingRefundRecords.flatMap((refund) => refund.lineItems);
    const summaryRefundedItems = buildReturnedItemsForRecord(record, refundLineItems);
    const primaryReturnedItem = summaryRefundedItems[0] ?? null;
    return {
      id: record.id,
      sourceShopifyOrderId: record.sourceShopifyOrderId,
      sourceShopifyOrderNumber: record.sourceShopifyOrderNumber,
      sourceShopifyRefundId: sourceRefundId,
      sourceShopifyReturnId: record.sourceShopifyReturnId,
      sourceShopifyReturnGid: record.sourceShopifyReturnGid,
      returnLifecycleStatus: record.returnLifecycleStatus,
      returnRequestSource: record.returnRequestSource,
      vendorId: record.vendorAllocation.assignedVendorId,
      assignedVendorId: record.vendorAllocation.assignedVendorId,
      status: getLifecycleStatus(record.status, record.returnLifecycleStatus),
      reason: record.reason,
      returnReasonNote: record.returnReasonNote,
      returnProvider: record.returnProvider,
      returnProviderShipmentId: record.returnProviderShipmentId,
      returnLabel: record.returnLabel,
      returnReferenceId: record.returnReferenceId,
      navlungoReturnCreatedAt: record.navlungoReturnCreatedAt ? record.navlungoReturnCreatedAt.toISOString() : null,
      returnCarrierName: record.returnCarrierName,
      returnTrackingNumber: record.returnTrackingNumber,
      returnTrackingUrl: record.returnTrackingUrl,
      vendorReceivedAt: record.vendorReceivedAt ? record.vendorReceivedAt.toISOString() : null,
      vendorReviewedAt: record.vendorReviewedAt ? record.vendorReviewedAt.toISOString() : null,
      vendorDecision: normalizeVendorDecision(record.vendorDecision),
      vendorDecisionReason: record.vendorDecisionReason,
      refundAmount: toAmountString(refundAmount),
      refundedItemCount,
      refundedSkus,
      itemTitle: primaryReturnedItem?.itemTitle ?? null,
      displayTitle: primaryReturnedItem?.displayTitle ?? null,
      variantTitle: primaryReturnedItem?.variantTitle ?? null,
      refundedItems: summaryRefundedItems,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  });
}

export async function getVendorReturnById(
  vendorId: string,
  returnId: string,
  options: { shopifyAdminService?: ShopifyLineItemImageLookupService } = {},
): Promise<ReturnDetailDto | null> {
  const record = await prisma.returnRecord.findFirst({
    where: {
      id: returnId,
      vendorAllocation: {
        assignedVendorId: vendorId,
      },
    },
    include: {
      vendorAllocation: {
        include: {
          order: {
            select: {
              sourceShopifyOrderId: true,
            },
          },
          lineItems: {
            include: {
              shopifyOrderLineItem: true,
            },
          },
          refundRecords: {
            include: {
              lineItems: {
                include: {
                  shopifyOrderLineItem: true,
                },
              },
            },
            orderBy: {
              createdAt: 'asc',
            },
          },
        },
      },
    },
  });

  if (!record) {
    return null;
  }

  const lineItemImageOverrides = await backfillMissingLineItemImages(record.vendorAllocation, options.shopifyAdminService);
  const matchingRefundRecords = getMatchingRefundRecords(record);
  const refundAmount = matchingRefundRecords.reduce(
    (sum, refund) => sum + toNumber(refund.amount),
    0,
  );
  const sourceRefundId = record.sourceShopifyRefundId ?? (isReturnRequestRecord(record) ? '' : getRefundSourceId(record));
  const refundLineItems = matchingRefundRecords.flatMap((refund) => refund.lineItems);
  const detailRefundedItems = buildReturnedItemsForRecord(
    {
      ...record,
      vendorAllocation: {
        ...record.vendorAllocation,
        lineItems: record.vendorAllocation.lineItems.map((item) => ({
          ...item,
          shopifyOrderLineItem: {
            ...item.shopifyOrderLineItem,
            imageUrl: lineItemImageOverrides.get(item.shopifyOrderLineItem.id) ?? item.shopifyOrderLineItem.imageUrl,
          },
        })),
      },
    },
    refundLineItems,
  );
  const refundedSkus = Array.from(
    new Set(
      detailRefundedItems
        .map((item) => item.sku)
        .filter((sku): sku is string => Boolean(sku)),
    ),
  );
  const primaryReturnedItem = detailRefundedItems[0] ?? null;

  return {
    id: record.id,
    sourceShopifyOrderId: record.sourceShopifyOrderId,
    sourceShopifyOrderNumber: record.sourceShopifyOrderNumber,
    sourceShopifyRefundId: sourceRefundId,
    sourceShopifyReturnId: record.sourceShopifyReturnId,
    sourceShopifyReturnGid: record.sourceShopifyReturnGid,
    returnLifecycleStatus: record.returnLifecycleStatus,
    returnRequestSource: record.returnRequestSource,
    vendorId: record.vendorAllocation.assignedVendorId,
    assignedVendorId: record.vendorAllocation.assignedVendorId,
    status: getLifecycleStatus(record.status, record.returnLifecycleStatus),
    reason: record.reason,
    returnReasonNote: record.returnReasonNote,
    returnProvider: record.returnProvider,
    returnProviderShipmentId: record.returnProviderShipmentId,
    returnLabel: record.returnLabel,
    returnReferenceId: record.returnReferenceId,
    navlungoReturnCreatedAt: record.navlungoReturnCreatedAt ? record.navlungoReturnCreatedAt.toISOString() : null,
    returnProviderSnapshot: mapReturnProviderSnapshot(record.returnProviderSnapshot),
    returnCarrierName: record.returnCarrierName,
    returnTrackingNumber: record.returnTrackingNumber,
    returnTrackingUrl: record.returnTrackingUrl,
    vendorReceivedAt: record.vendorReceivedAt ? record.vendorReceivedAt.toISOString() : null,
    vendorReviewedAt: record.vendorReviewedAt ? record.vendorReviewedAt.toISOString() : null,
    vendorDecision: normalizeVendorDecision(record.vendorDecision),
    vendorDecisionReason: record.vendorDecisionReason,
    refundAmount: toAmountString(refundAmount),
    refundedItemCount: detailRefundedItems.length,
    refundedSkus,
    itemTitle: primaryReturnedItem?.itemTitle ?? null,
    displayTitle: primaryReturnedItem?.displayTitle ?? null,
    variantTitle: primaryReturnedItem?.variantTitle ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    sourceShopifyInternalOrderId: record.vendorAllocation.sourceShopifyOrderId,
    originalVendorId: record.vendorAllocation.originalVendorId,
    requestCreatedAt: record.requestCreatedAt ? record.requestCreatedAt.toISOString() : null,
    requestUpdatedAt: record.requestUpdatedAt ? record.requestUpdatedAt.toISOString() : null,
    refundedItems: detailRefundedItems,
  };
}

export async function getReturnByIdForActor(returnId: string, actor: ReturnActorScope): Promise<ReturnDetailDto | null> {
  if (actor.role !== 'admin' && !actor.vendorId) {
    return null;
  }

  const record = await prisma.returnRecord.findFirst({
    where: {
      id: returnId,
      ...(actor.role === 'admin'
        ? {}
        : {
            vendorAllocation: {
              assignedVendorId: actor.vendorId ?? '',
            },
          }),
    },
    select: {
      vendorAllocation: {
        select: {
          assignedVendorId: true,
        },
      },
    },
  });

  if (!record || !canActOnReturn(record, actor)) {
    return null;
  }

  return getVendorReturnById(record.vendorAllocation.assignedVendorId, returnId);
}

export async function markReturnReceived(returnId: string, actor: ReturnActorScope): Promise<ReturnDetailDto> {
  const record = await prisma.returnRecord.findUnique({
    where: { id: returnId },
    select: {
      id: true,
      vendorReceivedAt: true,
      vendorAllocation: {
        select: {
          assignedVendorId: true,
        },
      },
    },
  });

  if (!record || !canActOnReturn(record, actor)) {
    throw new ReturnReviewError('Return record not found.', 404);
  }

  if (!record.vendorReceivedAt) {
    await prisma.returnRecord.update({
      where: { id: returnId },
      data: {
        vendorReceivedAt: new Date(),
      },
    });
  }

  const updated = await getVendorReturnById(record.vendorAllocation.assignedVendorId, returnId);
  if (!updated) {
    throw new ReturnReviewError('Return record not found.', 404);
  }

  return updated;
}

export async function reviewReturn(
  returnId: string,
  actor: ReturnActorScope,
  input: { decision: 'approved' | 'rejected'; reason?: string | null },
): Promise<ReturnDetailDto> {
  const record = await prisma.returnRecord.findUnique({
    where: { id: returnId },
    select: {
      id: true,
      vendorReceivedAt: true,
      vendorAllocation: {
        select: {
          assignedVendorId: true,
        },
      },
    },
  });

  if (!record || !canActOnReturn(record, actor)) {
    throw new ReturnReviewError('Return record not found.', 404);
  }

  if (!record.vendorReceivedAt) {
    throw new ReturnReviewError('Return must be marked received before review.', 409);
  }

  if (input.decision !== 'approved' && input.decision !== 'rejected') {
    throw new ReturnReviewError('Return review decision must be approved or rejected.', 400);
  }

  const reason = input.reason?.trim() ?? '';
  if (input.decision === 'rejected' && !reason) {
    throw new ReturnReviewError('Rejected returns require a reason.', 400);
  }

  await prisma.returnRecord.update({
    where: { id: returnId },
    data: {
      vendorReviewedAt: new Date(),
      vendorDecision: input.decision,
      vendorDecisionReason: input.decision === 'rejected' ? reason : null,
    },
  });

  const updated = await getVendorReturnById(record.vendorAllocation.assignedVendorId, returnId);
  if (!updated) {
    throw new ReturnReviewError('Return record not found.', 404);
  }

  return updated;
}

async function getVendorShippingConfigForReturn(vendorId: string) {
  const config = await prisma.vendorShippingConfig.findUnique({
    where: { vendorId },
    include: {
      warehouses: true,
    },
  });

  return {
    preferredProvider: config?.preferredProvider?.toString().toLowerCase() ?? null,
    shippingEnabled: config?.shippingEnabled ?? false,
    defaultDesi: config?.defaultDesi?.toString() ?? '1',
    defaultWarehouseId: config?.defaultWarehouseId ?? null,
    providerMetadata: config?.providerMetadata ?? null,
    warehouses: (config?.warehouses ?? []).map((warehouse) => ({
      warehouseId: warehouse.warehouseId,
      provider: warehouse.provider,
      isDefault: warehouse.isDefault,
    })),
  };
}

function isNavlungoReturnProviderConfig(config: Awaited<ReturnType<typeof getVendorShippingConfigForReturn>>) {
  return config.shippingEnabled && config.preferredProvider === 'navlungo';
}

function normalizeNavlungoReturnPickupCompletion(input: NavlungoReturnPickupCompletionInput | undefined) {
  const source = input ?? {};
  const normalized = {
    name: source.name?.trim(),
    phone: source.phone?.trim(),
    email: source.email?.trim(),
    country: source.country?.trim(),
    postcode: source.postcode?.trim() || source.post_code?.trim(),
    city: source.city?.trim(),
    district: source.district?.trim(),
    address: source.address?.trim(),
  };
  return Object.fromEntries(
    Object.entries(normalized).filter((entry): entry is [string, string] => Boolean(entry[1])),
  ) as NavlungoReturnPickupCompletionInput;
}

function readNavlungoReturnPickupCompletion(snapshot: unknown): NavlungoReturnPickupCompletionInput {
  const raw = readSnapshot(snapshot)?.navlungoReturnPickupCustomerOverrides;
  if (!isRecord(raw)) {
    return {};
  }
  return normalizeNavlungoReturnPickupCompletion({
    name: readString(raw, ['name']) ?? undefined,
    phone: readString(raw, ['phone']) ?? undefined,
    email: readString(raw, ['email']) ?? undefined,
    country: readString(raw, ['country']) ?? undefined,
    postcode: readString(raw, ['postcode', 'post_code']) ?? undefined,
    city: readString(raw, ['city']) ?? undefined,
    district: readString(raw, ['district']) ?? undefined,
    address: readString(raw, ['address']) ?? undefined,
  });
}

function mergeNavlungoReturnPickupCompletion(
  saved: NavlungoReturnPickupCompletionInput,
  incoming: NavlungoReturnPickupCompletionInput | undefined,
) {
  return {
    ...saved,
    ...normalizeNavlungoReturnPickupCompletion(incoming),
  };
}

function buildNavlungoReturnPickupPayload(input: {
  record: {
    id: string;
    sourceShopifyOrderNumber: string;
    sourceShopifyReturnId: string | null;
    sourceShopifyReturnGid: string | null;
    vendorAllocation: {
      assignedVendorId: string;
      order: {
        customerName: string | null;
        customerEmail: string | null;
        customerPhone: string | null;
        shippingCountry: string | null;
        shippingPostcode: string | null;
        shippingCity: string | null;
        shippingDistrict: string | null;
        shippingAddress: string | null;
      };
    };
  };
  config: Awaited<ReturnType<typeof getVendorShippingConfigForReturn>>;
  env: AppEnv;
  customerOverrides?: NavlungoReturnPickupInput['customerOverrides'];
  carrierOverride?: NavlungoReturnPickupInput['carrierOverride'] | NavlungoReturnPickupInput['carrierIdOverride'];
  endpointPath?: NavlungoCreatePostEndpointPath;
}) {
  const order = input.record.vendorAllocation.order;
  const overrides = input.customerOverrides ?? {};
  const senderAddress = overrides.address?.trim() || composeShipmentAddress(order);
  const sender = {
    name: overrides.name?.trim() || order.customerName?.trim() || '',
    phone: normalizeNavlungoPhone(overrides.phone || order.customerPhone) ?? '',
    email: overrides.email?.trim() || order.customerEmail?.trim() || '',
    address: senderAddress ?? '',
    country: overrides.country?.trim() || order.shippingCountry?.trim() || 'tr',
    city: overrides.city?.trim() || order.shippingCity?.trim() || '',
    district: overrides.district?.trim() || order.shippingDistrict?.trim() || '',
    post_code: overrides.postcode?.trim() || overrides.post_code?.trim() || order.shippingPostcode?.trim() || '',
  };
  const returnRecipientAddress = resolveNavlungoReturnRecipientAddressId(input.config, input.env);
  const returnRecipientMetadata = summarizeNavlungoReturnRecipientMetadata(input.config.providerMetadata);
  const recipientAddressId = parsePositiveInteger(returnRecipientAddress.value);
  const returnRecipientAddressIdPresent = Boolean(returnRecipientAddress.value?.trim());
  const returnRecipientAddressIdNumeric = returnRecipientAddressIdPresent && Boolean(recipientAddressId);
  const carrierId = resolveNavlungoDiagnosticCarrierId(input.config.providerMetadata, input.env, input.carrierOverride);
  const barcodeFormat = resolveNavlungoReturnBarcodeFormat(input.config.providerMetadata);
  const desi = Number(input.config.defaultDesi || 1);
  const referenceId = buildNavlungoReturnReferenceId({
    vendorId: input.record.vendorAllocation.assignedVendorId,
    shopifyOrderNumber: input.record.sourceShopifyOrderNumber,
    providerMetadata: input.config.providerMetadata,
  });
  const missingFields = [
    sender.name ? null : 'sender.name',
    sender.phone ? null : 'sender.phone',
    sender.address ? null : 'sender.address',
    sender.country ? null : 'sender.country',
    sender.city ? null : 'sender.city',
    sender.district ? null : 'sender.district',
    recipientAddressId ? null : 'recipient.addressId',
    carrierId ? null : 'carrier_id',
    Number.isFinite(desi) && desi > 0 ? null : 'post.desi',
  ].filter((field): field is string => Boolean(field));
  const payload: NavlungoCreatePostPayload = {
    platform: 'shopify',
    posts: [
      {
        reference_id: referenceId,
        carrier_id: carrierId ?? 9,
        post_type: 3,
        cod_payment_type: '',
        sender,
        recipient: recipientAddressId ? { addressId: recipientAddressId } : { addressId: 0 },
        post: {
          desi: Number.isFinite(desi) && desi > 0 ? desi : 1,
          package_count: 1,
          price: '',
          note: '',
        },
        barcode_format: barcodeFormat,
        custom_data_1: sanitizeNavlungoReferencePart(input.record.sourceShopifyOrderNumber, 'ORDER'),
        custom_data_2: sanitizeNavlungoReferencePart(input.record.id, 'RETURN'),
        custom_data_3: safeShopifyReturnIdShort(input.record.sourceShopifyReturnGid ?? input.record.sourceShopifyReturnId),
        custom_data_4: 'navlungo-return',
      },
    ],
  };

  return {
    payload,
    missingFields,
    referenceId,
    summary: summarizeNavlungoCreatePostRequest(payload, input.env, input.endpointPath),
    recipientAddressIdValid: Boolean(recipientAddressId),
    navlungoReturnRecipientAddressIdPresent: returnRecipientAddressIdPresent,
    navlungoReturnRecipientAddressIdNumeric: returnRecipientAddressIdNumeric,
    navlungoReturnRecipientAddressIdSource: returnRecipientAddress.source,
    navlungoReturnRecipientMetadataConfigured: returnRecipientMetadata.configured,
    navlungoReturnRecipientName: returnRecipientMetadata.name,
    navlungoReturnRecipientCity: returnRecipientMetadata.city,
    navlungoReturnRecipientDistrict: returnRecipientMetadata.district,
  };
}

export async function createNavlungoReturnPickupForReturn(
  returnId: string,
  actor: ReturnActorScope,
  env: AppEnv,
  input: NavlungoReturnPickupInput = {},
): Promise<ReturnDetailDto> {
  const record = await prisma.returnRecord.findUnique({
    where: { id: returnId },
    include: {
      vendorAllocation: {
        include: {
          order: true,
        },
      },
    },
  });

  if (!record || !canActOnReturn(record, actor)) {
    throw new ReturnReviewError('Return record not found.', 404);
  }

  if (actor.role !== 'admin') {
    throw new ReturnReviewError('Admin access required for Navlungo return pickup creation.', 403);
  }

  if (record.returnProvider === 'navlungo' && record.returnProviderShipmentId && !input.dryRun) {
    const existing = await getVendorReturnById(record.vendorAllocation.assignedVendorId, returnId);
    if (!existing) {
      throw new ReturnReviewError('Return record not found.', 404);
    }
    return existing;
  }

  const config = await getVendorShippingConfigForReturn(record.vendorAllocation.assignedVendorId);
  const diagnosticOverrideRequested =
    input.apiVersionOverride === 'v2' ||
    input.apiVersionOverride === 'v2.1' ||
    input.endpointVersionOverride === 'v2' ||
    input.endpointVersionOverride === 'v2.1' ||
    input.carrierOverride === '9' ||
    input.carrierOverride === '10' ||
    input.carrierIdOverride === '9' ||
    input.carrierIdOverride === '10' ||
    input.endpointPathOverride === '/post/return';
  if (diagnosticOverrideRequested && input.dryRun !== true && input.diagnosticConfirm !== 'YES') {
    throw new ReturnReviewError('Explicit confirmation is required for Navlungo return pickup diagnostic live create.', 400);
  }
  const endpointVersionOverride = input.endpointVersionOverride ?? input.apiVersionOverride;
  const carrierIdOverride = input.carrierIdOverride ?? input.carrierOverride;
  const requestBase = resolveNavlungoDiagnosticBaseUrl(env, endpointVersionOverride, input.endpointPathOverride);
  const savedCompletion = readNavlungoReturnPickupCompletion(record.returnProviderSnapshot);
  const built = buildNavlungoReturnPickupPayload({
    record,
    config,
    env: requestBase.env,
    customerOverrides: mergeNavlungoReturnPickupCompletion(savedCompletion, input.customerOverrides),
    carrierOverride: carrierIdOverride,
    endpointPath: requestBase.endpointPath,
  });
  const attemptedAt = new Date().toISOString();
  const diagnostics = {
    provider: 'navlungo',
    flow: 'return_pickup',
    endpoint: requestBase.endpointPath,
    dryRun: input.dryRun === true,
    navlungoReturnAutoCreateAttempted: input.autoCreate === true && input.dryRun !== true,
    navlungoReturnAutoCreateSkippedReason: null,
    navlungoReturnPickupDryRun: input.dryRun === true,
    navlungoReturnPickupAttempted: input.dryRun !== true,
    navlungoReturnPickupSucceeded: false,
    navlungoReturnPickupMissingFields: built.missingFields,
    navlungoReturnPickupPayloadSummary: built.summary,
    navlungoReturnRequestSummary: built.summary,
    navlungoReturnRequestedBarcodeFormat: built.summary.requestedBarcodeFormat,
    navlungoReturnRequestedCarrierId: built.summary.requestedCarrierId,
    navlungoReturnRequestedPostType: built.summary.requestedPostType,
    navlungoReturnEndpointVersionTried: requestBase.versionTried,
    navlungoReturnEndpointPathTried: requestBase.endpointPath,
    navlungoReturnResolvedProviderPath: requestBase.resolvedProviderPath,
    navlungoReturnResolvedProviderUrl: requestBase.resolvedProviderUrl,
    navlungoReturnBaseUrlOverrideApplied: Boolean(requestBase.baseUrlOverride),
    recipientAddressIdValid: built.recipientAddressIdValid,
    navlungoReturnRecipientAddressIdPresent: built.navlungoReturnRecipientAddressIdPresent,
    navlungoReturnRecipientAddressIdNumeric: built.navlungoReturnRecipientAddressIdNumeric,
    navlungoReturnRecipientAddressIdSource: built.navlungoReturnRecipientAddressIdSource,
    navlungoReturnRecipientMetadataConfigured: built.navlungoReturnRecipientMetadataConfigured,
    navlungoReturnRecipientName: built.navlungoReturnRecipientName,
    navlungoReturnRecipientCity: built.navlungoReturnRecipientCity,
    navlungoReturnRecipientDistrict: built.navlungoReturnRecipientDistrict,
    returnRequestId: record.id,
    shopifyReturnIdPresent: Boolean(record.sourceShopifyReturnId || record.sourceShopifyReturnGid),
    shopifyReturnSyncSkippedReason: 'not_implemented',
    shopifyReturnTrackingSyncSkippedReason: 'not_implemented',
    attemptedAt,
  };

  if (requestBase.endpointPath === '/post/create') {
    const endpointDiagnostics = {
      ...diagnostics,
      navlungoReturnAutoCreateSkippedReason: 'invalid_return_endpoint',
      navlungoReturnPickupStatus: 'needs_attention',
      navlungoReturnProviderMessage: 'Return pickup must use /post/return, not /post/create.',
      navlungoReturnCreateHttpStatus: null,
      navlungoReturnCreateSucceeded: false,
    };
    if (input.dryRun) {
      const detail = await getVendorReturnById(record.vendorAllocation.assignedVendorId, returnId);
      if (!detail) {
        throw new ReturnReviewError('Return record not found.', 404);
      }
      return {
        ...detail,
        returnProviderSnapshot: endpointDiagnostics,
      };
    }

    await prisma.returnRecord.update({
      where: { id: returnId },
      data: {
        returnProviderSnapshot: {
          ...(readSnapshot(record.returnProviderSnapshot) ?? {}),
          ...endpointDiagnostics,
        } as Prisma.InputJsonValue,
      },
    });
    throw new ReturnReviewError('Return pickup must use /post/return, not /post/create.', 400);
  }

  if (input.dryRun) {
    const detail = await getVendorReturnById(record.vendorAllocation.assignedVendorId, returnId);
    if (!detail) {
      throw new ReturnReviewError('Return record not found.', 404);
    }
    return {
      ...detail,
      returnProviderSnapshot: diagnostics,
    };
  }

  if (built.missingFields.length > 0) {
    const missingRecipientAddressId = built.missingFields.includes('recipient.addressId');
    await prisma.returnRecord.update({
      where: { id: returnId },
      data: {
        returnProviderSnapshot: {
          ...(readSnapshot(record.returnProviderSnapshot) ?? {}),
          ...diagnostics,
          navlungoReturnAutoCreateSkippedReason: 'missing_required_fields',
          navlungoReturnPickupStatus: 'needs_attention',
          navlungoReturnMissingFields: built.missingFields,
          navlungoReturnCreateHttpStatus: null,
          navlungoReturnCreateSucceeded: false,
        } as Prisma.InputJsonValue,
      },
    });
    throw new ReturnReviewError(
      missingRecipientAddressId
        ? 'Navlungo return recipient addressId is invalid or not configured.'
        : [
            'Missing required Navlungo return pickup fields:',
            ...built.missingFields.map((field) => `- ${field}`),
            '',
            'Provider request blocked before create call.',
          ].join('\n'),
      400,
    );
  }

  try {
    const adapter = input.adapter ?? createShippingProviderAdapter(requestBase.env, 'navlungo');
    if (!adapter.createReturnShipment) {
      throw new Error('Navlungo return pickup creation is not supported by this adapter.');
    }
    const result = await adapter.createReturnShipment({
      orderId: record.id,
      items: [],
      requestSnapshot: built.payload as unknown as Record<string, unknown>,
      endpointPath: requestBase.endpointPath,
    });
    const providerSnapshot = {
      ...diagnostics,
      dryRun: false,
      navlungoReturnPickupSucceeded: Boolean(result.returnOrderId),
      navlungoReturnCreateSucceeded: Boolean(result.returnOrderId),
      navlungoReturnCreateHttpStatus: readNumber(result.responseSnapshot, ['createPostHttpStatus', 'httpStatus']),
      httpStatus: readNumber(result.responseSnapshot, ['createPostHttpStatus', 'httpStatus']),
      responseKeys: Object.keys(result.responseSnapshot),
      providerMessage: readString(result.responseSnapshot, ['providerMessage', 'providerError']),
      navlungoReturnProviderMessage: readString(result.responseSnapshot, ['providerMessage', 'providerError']),
      navlungoReturnProviderTrackingId: readString(result.responseSnapshot, ['providerTrackingId']),
      navlungoReturnValidationFields: readStringArray(result.responseSnapshot.failedFieldNames),
      navlungoReturnValidationMessages: readStringArray(result.responseSnapshot.validationErrorMessages),
      navlungoReturnValidationResponseShape: result.responseSnapshot.validationResponseShape ?? null,
      navlungoReturnCreateRequest: result.responseSnapshot.createPostRequest ?? null,
      navlungoReturnCreateResponseBody: result.responseSnapshot.createPostResponseBody ?? null,
      returnProviderIdPresent: Boolean(result.returnOrderId),
      returnTrackingPresent: Boolean(result.returnTrackingNumber || result.returnTrackingUrl),
      returnBarcodePresent: Boolean(result.returnBarcode),
      returnStatus: result.returnStatus,
      rawResponseSummary: result.responseSnapshot,
      shopifyReturnSyncSkippedReason: 'not_implemented',
      shopifyReturnTrackingSyncSkippedReason: 'not_implemented',
    };
    await prisma.returnRecord.update({
      where: { id: returnId },
      data: {
        returnProvider: 'navlungo',
        returnProviderShipmentId: result.returnOrderId,
        returnTrackingNumber: result.returnTrackingNumber,
        returnTrackingUrl: result.returnTrackingUrl,
        returnLabel: result.returnBarcode ?? result.returnLabelUrl,
        returnCarrierName: result.returnCarrierName ?? 'Navlungo',
        returnReferenceId: built.referenceId,
        navlungoReturnCreatedAt: new Date(attemptedAt),
        returnProviderSnapshot: providerSnapshot as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    if (error instanceof ShippingProviderExecutionError) {
      await prisma.returnRecord.update({
        where: { id: returnId },
        data: {
          returnProviderSnapshot: {
            ...diagnostics,
            dryRun: false,
            navlungoReturnPickupSucceeded: false,
            navlungoReturnCreateSucceeded: false,
            navlungoReturnCreateHttpStatus: readNumber(error.responseSnapshot, ['createPostHttpStatus', 'httpStatus']),
            providerMessage: readString(error.responseSnapshot, ['providerMessage', 'providerError']),
            navlungoReturnProviderMessage: readString(error.responseSnapshot, ['providerMessage', 'providerError']),
            navlungoReturnProviderTrackingId: readString(error.responseSnapshot, ['providerTrackingId']),
            navlungoReturnValidationFields: readStringArray(error.responseSnapshot.failedFieldNames),
            navlungoReturnValidationMessages: readStringArray(error.responseSnapshot.validationErrorMessages),
            navlungoReturnValidationResponseShape: error.responseSnapshot.validationResponseShape ?? null,
            navlungoReturnCreateRequest: error.responseSnapshot.createPostRequest ?? null,
            navlungoReturnCreateResponseBody: error.responseSnapshot.createPostResponseBody ?? null,
            httpStatus: readNumber(error.responseSnapshot, ['createPostHttpStatus', 'httpStatus']),
            responseKeys: Object.keys(error.responseSnapshot),
            rawResponseSummary: error.responseSnapshot,
          } as Prisma.InputJsonValue,
        },
      });
      throw new ReturnReviewError(error.message, 400);
    }
    throw new ReturnReviewError(error instanceof Error ? error.message : 'Navlungo return pickup could not be created.', 400);
  }

  const updated = await getVendorReturnById(record.vendorAllocation.assignedVendorId, returnId);
  if (!updated) {
    throw new ReturnReviewError('Return record not found.', 404);
  }
  return updated;
}

export async function autoCreateNavlungoReturnPickupForApprovedReturn(
  returnId: string,
  env: AppEnv,
  input: Pick<NavlungoReturnPickupInput, 'adapter'> = {},
) {
  const record = await prisma.returnRecord.findUnique({
    where: { id: returnId },
    include: {
      vendorAllocation: {
        include: {
          order: true,
        },
      },
    },
  });

  if (!record) {
    return { attempted: false, skippedReason: 'return_record_not_found' };
  }

  const normalizedStatus = (record.returnLifecycleStatus || record.status || '').toLowerCase();
  if (normalizedStatus !== 'approved') {
    return { attempted: false, skippedReason: 'return_not_approved' };
  }

  if (record.returnProvider === 'navlungo' && record.returnProviderShipmentId) {
    return { attempted: false, skippedReason: 'return_provider_evidence_exists' };
  }

  const config = await getVendorShippingConfigForReturn(record.vendorAllocation.assignedVendorId);
  if (!isNavlungoReturnProviderConfig(config)) {
    await prisma.returnRecord.update({
      where: { id: returnId },
      data: {
        returnProviderSnapshot: {
          ...(readSnapshot(record.returnProviderSnapshot) ?? {}),
          provider: 'navlungo',
          flow: 'return_pickup',
          navlungoReturnAutoCreateAttempted: false,
          navlungoReturnAutoCreateSkippedReason: 'provider_not_navlungo',
          navlungoReturnPickupStatus: 'not_applicable',
        } as Prisma.InputJsonValue,
      },
    });
    return { attempted: false, skippedReason: 'provider_not_navlungo' };
  }

  const built = buildNavlungoReturnPickupPayload({
    record,
    config,
    env,
    customerOverrides: readNavlungoReturnPickupCompletion(record.returnProviderSnapshot),
  });

  if (built.missingFields.length > 0) {
    await prisma.returnRecord.update({
      where: { id: returnId },
      data: {
        returnProviderSnapshot: {
          ...(readSnapshot(record.returnProviderSnapshot) ?? {}),
          provider: 'navlungo',
          flow: 'return_pickup',
          endpoint: '/post/create',
          navlungoReturnAutoCreateAttempted: true,
          navlungoReturnAutoCreateSkippedReason: 'missing_required_fields',
          navlungoReturnPickupStatus: 'needs_attention',
          navlungoReturnPickupDryRun: false,
          navlungoReturnPickupAttempted: false,
          navlungoReturnPickupSucceeded: false,
          navlungoReturnPickupMissingFields: built.missingFields,
          navlungoReturnMissingFields: built.missingFields,
          navlungoReturnPickupPayloadSummary: built.summary,
          navlungoReturnRequestSummary: built.summary,
          navlungoReturnRequestedBarcodeFormat: built.summary.requestedBarcodeFormat,
          navlungoReturnRequestedCarrierId: built.summary.requestedCarrierId,
          navlungoReturnRequestedPostType: built.summary.requestedPostType,
          recipientAddressIdValid: built.recipientAddressIdValid,
          navlungoReturnRecipientAddressIdPresent: built.navlungoReturnRecipientAddressIdPresent,
          navlungoReturnRecipientAddressIdNumeric: built.navlungoReturnRecipientAddressIdNumeric,
          navlungoReturnRecipientAddressIdSource: built.navlungoReturnRecipientAddressIdSource,
          navlungoReturnRecipientMetadataConfigured: built.navlungoReturnRecipientMetadataConfigured,
          navlungoReturnRecipientName: built.navlungoReturnRecipientName,
          navlungoReturnRecipientCity: built.navlungoReturnRecipientCity,
          navlungoReturnRecipientDistrict: built.navlungoReturnRecipientDistrict,
          shopifyReturnSyncSkippedReason: 'not_implemented',
          shopifyReturnTrackingSyncSkippedReason: 'not_implemented',
          attemptedAt: new Date().toISOString(),
        } as Prisma.InputJsonValue,
      },
    });
    return { attempted: false, skippedReason: 'missing_required_fields', missingFields: built.missingFields };
  }

  try {
    await createNavlungoReturnPickupForReturn(
      returnId,
      { role: 'admin', vendorId: null },
      env,
      {
        adapter: input.adapter,
        autoCreate: true,
      },
    );
    return { attempted: true, skippedReason: null };
  } catch {
    return { attempted: true, skippedReason: 'provider_create_failed' };
  }
}

export async function saveNavlungoReturnPickupAddressCompletion(
  returnId: string,
  actor: ReturnActorScope,
  env: AppEnv,
  completionInput: NavlungoReturnPickupCompletionInput,
): Promise<ReturnDetailDto> {
  if (actor.role !== 'admin') {
    throw new ReturnReviewError('Admin access required for return pickup address completion.', 403);
  }

  const record = await prisma.returnRecord.findUnique({
    where: { id: returnId },
    include: {
      vendorAllocation: {
        include: {
          order: true,
        },
      },
    },
  });

  if (!record) {
    throw new ReturnReviewError('Return record not found.', 404);
  }

  const existingSnapshot = readSnapshot(record.returnProviderSnapshot) ?? {};
  const existingCompletion = readNavlungoReturnPickupCompletion(existingSnapshot);
  const nextCompletion = mergeNavlungoReturnPickupCompletion(existingCompletion, completionInput);
  if (Object.keys(nextCompletion).length === 0) {
    throw new ReturnReviewError('At least one return pickup address field is required.', 400);
  }

  const config = await getVendorShippingConfigForReturn(record.vendorAllocation.assignedVendorId);
  const built = buildNavlungoReturnPickupPayload({
    record,
    config,
    env,
    customerOverrides: nextCompletion,
  });
  const resolved = built.missingFields.length === 0;

  await prisma.returnRecord.update({
    where: { id: returnId },
    data: {
      returnProviderSnapshot: {
        ...existingSnapshot,
        navlungoReturnPickupCustomerOverrides: nextCompletion,
        navlungoReturnPickupCustomerOverrideKeys: Object.keys(nextCompletion).sort(),
        navlungoReturnPickupCustomerOverrideValuesRedacted: true,
        navlungoReturnPickupCompletionSavedAt: new Date().toISOString(),
        navlungoReturnPickupMissingFields: built.missingFields,
        navlungoReturnMissingFields: built.missingFields,
        navlungoReturnPickupPayloadSummary: built.summary,
        navlungoReturnRequestSummary: built.summary,
        navlungoReturnRequestedBarcodeFormat: built.summary.requestedBarcodeFormat,
        navlungoReturnRequestedCarrierId: built.summary.requestedCarrierId,
        navlungoReturnRequestedPostType: built.summary.requestedPostType,
        navlungoReturnAutoCreateSkippedReason: resolved ? null : 'missing_required_fields',
        navlungoReturnPickupStatus: resolved ? 'ready' : 'needs_attention',
        recipientAddressIdValid: built.recipientAddressIdValid,
        navlungoReturnRecipientAddressIdPresent: built.navlungoReturnRecipientAddressIdPresent,
        navlungoReturnRecipientAddressIdNumeric: built.navlungoReturnRecipientAddressIdNumeric,
        navlungoReturnRecipientAddressIdSource: built.navlungoReturnRecipientAddressIdSource,
        navlungoReturnRecipientMetadataConfigured: built.navlungoReturnRecipientMetadataConfigured,
        navlungoReturnRecipientName: built.navlungoReturnRecipientName,
        navlungoReturnRecipientCity: built.navlungoReturnRecipientCity,
        navlungoReturnRecipientDistrict: built.navlungoReturnRecipientDistrict,
      } as Prisma.InputJsonValue,
    },
  });

  const updated = await getVendorReturnById(record.vendorAllocation.assignedVendorId, returnId);
  if (!updated) {
    throw new ReturnReviewError('Return record not found.', 404);
  }
  return updated;
}

function mapNavlungoReturnStatusLogTimelineEvents(snapshot: Record<string, unknown>) {
  const logs = Array.isArray(snapshot.navlungoReturnStatusLogs)
    ? snapshot.navlungoReturnStatusLogs.filter(isRecord)
    : [];
  const existingTimeline = Array.isArray(snapshot.timeline) ? snapshot.timeline.filter(isRecord) : [];
  const existingFingerprints = Array.isArray(snapshot.timelineEventFingerprints)
    ? snapshot.timelineEventFingerprints.filter((value): value is string => typeof value === 'string')
    : [];
  const nextTimeline = [...existingTimeline];
  const nextFingerprints = [...existingFingerprints];

  for (const log of logs) {
    const statusCode = readNumber(log, ['status_code', 'statusCode']) ?? readString(log, ['status_code', 'statusCode']);
    const action = readString(log, ['action']);
    const actionResult = readString(log, ['action_result', 'actionResult']);
    const createdAt = readString(log, ['created_at', 'createdAt']);
    const numeric = typeof statusCode === 'number' ? statusCode : Number(statusCode);
    const label = (() => {
      switch (numeric) {
        case 2:
          return 'Delivered';
        case 4:
          return 'Out for delivery';
        case 9:
        case 21:
          return 'Returned to warehouse';
        case 10:
          return 'Cancelled';
        case 16:
          return 'Picked up';
        case 17:
          return 'In transit';
        case 18:
          return 'Waiting at branch';
        default:
          break;
      }
      const normalizedAction = action?.toLowerCase() ?? '';
      if (/cancel|iptal/.test(normalizedAction)) return 'Cancelled';
      if (/return|iade/.test(normalizedAction)) return 'Returned to warehouse';
      if (/deliver|teslim/.test(normalizedAction)) return 'Delivered';
      if (/pickup|picked|teslim al/.test(normalizedAction)) return 'Picked up';
      if (/branch|şube|sube/.test(normalizedAction)) return 'Waiting at branch';
      if (/transit|yolda|transfer/.test(normalizedAction)) return 'In transit';
      return action || 'Return pickup status updated';
    })();
    const fingerprint = ['navlungo_return_status_log', action ?? '', statusCode ?? '', createdAt ?? ''].join('|');
    if (nextFingerprints.includes(fingerprint)) {
      continue;
    }
    nextTimeline.push({
      label,
      at: createdAt ?? new Date().toISOString(),
      status: actionResult ?? (statusCode === null ? null : String(statusCode)),
    });
    nextFingerprints.push(fingerprint);
  }

  return {
    ...snapshot,
    timeline: nextTimeline,
    timelineEventFingerprints: nextFingerprints,
  };
}

function buildNavlungoReturnStatusSnapshot(input: {
  existingSnapshot: Record<string, unknown>;
  providerSnapshot: Record<string, unknown>;
  succeeded: boolean;
}) {
  const { existingSnapshot, providerSnapshot, succeeded } = input;
  const statusCode = readNumber(providerSnapshot, ['navlungoProviderStatusCode']);
  const statusName = readString(providerSnapshot, ['navlungoProviderStatusName']);
  const normalizedStatus = readString(providerSnapshot, ['navlungoNormalizedStatus']);
  const logs = Array.isArray(providerSnapshot.navlungoStatusLogs) ? providerSnapshot.navlungoStatusLogs.filter(isRecord) : [];
  const findLogDate = (codes: number[]) => {
    const value = logs.find((log) => {
      const code = readNumber(log, ['status_code', 'statusCode']);
      return code !== null && codes.includes(code);
    });
    return value ? readString(value, ['created_at', 'createdAt']) : null;
  };
  const pickedUpAt = readIsoDate(providerSnapshot, ['picked_up_date', 'pickedUpDate'])
    ?? findLogDate([16]);
  const deliveredAt = readIsoDate(providerSnapshot, ['delivered_date', 'deliveredDate'])
    ?? findLogDate([2, 9, 21]);
  const cancelledAt = readIsoDate(providerSnapshot, ['cancel_date', 'cancelDate'])
    ?? findLogDate([10]);
  const merged = {
    ...existingSnapshot,
    navlungoReturnStatusSyncAttempted: true,
    navlungoReturnStatusSyncSucceeded: succeeded,
    navlungoReturnStatusSyncHttpStatus: readNumber(providerSnapshot, ['navlungoStatusSyncHttpStatus']),
    navlungoReturnProviderStatusCode: statusCode,
    navlungoReturnProviderStatusName: statusName,
    navlungoReturnNormalizedStatus: normalizedStatus,
    navlungoReturnPickedUpAt: pickedUpAt,
    navlungoReturnDeliveredAt: deliveredAt,
    navlungoReturnCancelledAt: cancelledAt,
    navlungoReturnLastStatusSyncedAt: new Date().toISOString(),
    navlungoReturnLogsCount: readNumber(providerSnapshot, ['navlungoLogsCount']) ?? logs.length,
    navlungoReturnStatusLogs: logs,
    navlungoReturnTrackingEnriched: readBoolean(providerSnapshot, ['navlungoTrackingEnriched']) === true,
    navlungoReturnStatusSyncValidationFields: readStringArray(providerSnapshot.navlungoStatusSyncValidationFields),
    navlungoReturnStatusSyncValidationMessages: readStringArray(providerSnapshot.navlungoStatusSyncValidationMessages),
    navlungoReturnStatusSyncProviderTrackingId: readString(providerSnapshot, ['navlungoStatusSyncProviderTrackingId', 'providerTrackingId']),
    navlungoReturnStatusSyncProviderMessage: readString(providerSnapshot, ['navlungoStatusSyncProviderMessage', 'providerMessage', 'providerError']),
    navlungoReturnStatusSyncResponseShape: isRecord(providerSnapshot.navlungoStatusSyncResponseShape)
      ? providerSnapshot.navlungoStatusSyncResponseShape
      : null,
    navlungoReturnStatusSyncDataKeys: readStringArray(providerSnapshot.navlungoStatusSyncDataKeys),
    navlungoReturnCarrierTrackingPresent: readBoolean(providerSnapshot, ['navlungoCarrierTrackingPresent']),
    navlungoReturnBarcodeStatus: readString(providerSnapshot, ['barcodeStatus']),
    shopifyReturnStatusSyncSkippedReason: 'not_implemented',
  };

  return mapNavlungoReturnStatusLogTimelineEvents(merged);
}

export async function syncNavlungoReturnPickupStatusForReturn(
  returnId: string,
  actor: ReturnActorScope,
  env: AppEnv,
  input: NavlungoReturnStatusSyncInput = {},
): Promise<ReturnDetailDto> {
  if (actor.role !== 'admin') {
    throw new ReturnReviewError('Admin access required for Navlungo return status sync.', 403);
  }

  const record = await prisma.returnRecord.findUnique({
    where: { id: returnId },
    include: {
      vendorAllocation: {
        select: {
          assignedVendorId: true,
        },
      },
    },
  });

  if (!record) {
    throw new ReturnReviewError('Return record not found.', 404);
  }

  if (record.returnProvider?.toLowerCase() !== 'navlungo') {
    throw new ReturnReviewError('Navlungo return status sync is only available for Navlungo return pickups.', 400);
  }

  const postNumber = record.returnProviderShipmentId?.trim();
  if (!postNumber) {
    const blockedSnapshot = {
      ...(readSnapshot(record.returnProviderSnapshot) ?? {}),
      navlungoReturnStatusSyncAttempted: false,
      navlungoReturnStatusSyncSkippedReason: 'missing_return_provider_shipment_id',
      shopifyReturnStatusSyncSkippedReason: 'not_implemented',
    };
    await prisma.returnRecord.update({
      where: { id: returnId },
      data: {
        returnProviderSnapshot: blockedSnapshot as Prisma.InputJsonValue,
      },
    });
    throw new ReturnReviewError('Navlungo return status sync requires a stored return post number.', 400);
  }

  const adapter = input.adapter ?? createShippingProviderAdapter(env, 'navlungo');
  const existingSnapshot = readSnapshot(record.returnProviderSnapshot) ?? {};
  try {
    const result = await adapter.getShipmentStatus(postNumber);
    const providerSnapshot = readSnapshot(result.responseSnapshot) ?? {};
    const mergedSnapshot = buildNavlungoReturnStatusSnapshot({
      existingSnapshot,
      providerSnapshot,
      succeeded: true,
    });
    await prisma.returnRecord.update({
      where: { id: returnId },
      data: {
        returnTrackingNumber: result.trackingNumber ?? record.returnTrackingNumber,
        returnTrackingUrl: result.trackingUrl ?? record.returnTrackingUrl,
        returnLabel: result.labelUrl ?? record.returnLabel,
        returnCarrierName: readString(providerSnapshot, ['carrierName']) ?? record.returnCarrierName,
        returnProviderSnapshot: mergedSnapshot as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    if (error instanceof ShippingProviderExecutionError) {
      const failedSnapshot = buildNavlungoReturnStatusSnapshot({
        existingSnapshot,
        providerSnapshot: readSnapshot(error.responseSnapshot) ?? {},
        succeeded: false,
      });
      await prisma.returnRecord.update({
        where: { id: returnId },
        data: {
          returnProviderSnapshot: failedSnapshot as Prisma.InputJsonValue,
        },
      });
      throw new ReturnReviewError(error.message, 400);
    }
    throw error;
  }

  const updated = await getVendorReturnById(record.vendorAllocation.assignedVendorId, returnId);
  if (!updated) {
    throw new ReturnReviewError('Return record not found.', 404);
  }
  return updated;
}
