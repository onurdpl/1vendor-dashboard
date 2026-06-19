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
import type { KargonomiShipmentCreatePayloadInput } from '../shipping/kargonomi-provider.adapter.js';
import {
  KargonomiHttpClient,
  normalizeKargonomiPhone,
  resolveKargonomiDestinationAddress,
  type KargonomiDestinationLookupClient,
  type KargonomiDestinationResolution,
} from '../shipping/kargonomi-provider.adapter.js';
import { withDashboardTiming } from '../../lib/dashboard-timing.js';
import { createShopifyAdminService } from '../shopify/shopify-admin.service.js';
import type { DashboardReturnSummaryDto, KargonomiReturnPreviewDto, ReturnDetailDto, ReturnSummaryDto } from './returns.types.js';
import { mapLinkedSettlementRefundAdjustments } from '../finance/settlement-refund-adjustment.service.js';
import {
  backfillMissingLineItemImages,
  type ShopifyLineItemImageLookupService,
} from '../orders/orders.service.js';

export class ReturnReviewError extends Error {
  statusCode: number;
  details?: Record<string, unknown>;

  constructor(message: string, statusCode: number, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ReturnReviewError';
    this.statusCode = statusCode;
    this.details = details;
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

export type KargonomiReturnShipmentCreateInput = {
  adapter?: ShippingProviderAdapter;
  kargonomiDestinationClient?: KargonomiDestinationLookupClient;
  senderTaxNumber?: string | null;
  shopifyAdminService?: Pick<ReturnType<typeof createShopifyAdminService>, 'syncReturnShipping'>;
};

export type KargonomiReturnProviderDataRefreshInput = {
  adapter?: ShippingProviderAdapter;
  shopifyAdminService?: Pick<ReturnType<typeof createShopifyAdminService>, 'syncReturnShipping'>;
};

export type ShopifyReturnSyncInput = {
  shopifyAdminService?: Pick<ReturnType<typeof createShopifyAdminService>, 'syncReturnShipping'>;
};

export type KargonomiReturnPreviewInput = {
  env?: AppEnv;
  kargonomiDestinationClient?: KargonomiDestinationLookupClient;
  senderTaxNumber?: string | null;
};

type KargonomiReturnSenderTaxNumberResolution = {
  value: string | null;
  source: 'kargonomi_account_fallback' | 'missing';
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

function toShopifyReturnGid(value: string | null | undefined) {
  const text = value?.trim();
  if (!text) {
    return null;
  }
  return /^gid:\/\/shopify\/Return\//i.test(text) ? text : `gid://shopify/Return/${text.replace(/^#+/, '')}`;
}

function sanitizeShopifyReturnSyncMessage(value: unknown) {
  if (typeof value !== 'string') {
    return null;
  }
  const text = value.trim();
  if (!text) {
    return null;
  }
  return text
    .replace(/(access[_-]?token|refresh[_-]?token|authorization|password|secret|api[_-]?key)=?[^\s,;]+/gi, '$1=[redacted]')
    .replace(/data:application\/pdf;base64,[a-z0-9+/=\s]+/gi, 'data:application/pdf;base64,[redacted]')
    .slice(0, 500);
}

function sanitizeShopifyUserErrors(errors: Array<{ field?: string[]; message?: string }> | undefined) {
  return (errors ?? []).map((error) => ({
    field: Array.isArray(error.field) ? error.field.filter((field): field is string => typeof field === 'string') : [],
    message: sanitizeShopifyReturnSyncMessage(error.message) ?? 'Unknown Shopify user error.',
  }));
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

type NavlungoForwardShipmentExecutionContext = {
  id?: string | null;
  provider?: unknown;
  shipmentStatus?: unknown;
  providerShipmentId?: string | null;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
  labelUrl?: string | null;
  warehouseId?: string | null;
  requestSnapshot?: unknown;
  responseSnapshot?: unknown;
  updatedAt?: Date | string | null;
};

function readNavlungoFirstPost(snapshot: unknown) {
  const request = readSnapshot(snapshot);
  const posts = Array.isArray(request?.posts) ? request.posts : [];
  const post = posts[0];
  return isRecord(post) ? post : null;
}

function readNavlungoPayloadSenderAddressId(snapshot: unknown) {
  const post = readNavlungoFirstPost(snapshot);
  const sender = isRecord(post?.sender) ? post.sender : null;
  return readString(sender, ['addressId', 'address_id']);
}

function readNavlungoConfiguredSenderAddressIdFromPayload(snapshot: unknown) {
  const post = readNavlungoFirstPost(snapshot);
  return readString(post, ['custom_data_4']);
}

function inferOriginalNavlungoSenderMode(execution: NavlungoForwardShipmentExecutionContext) {
  const responseSnapshot = readSnapshot(execution.responseSnapshot);
  const senderMode = readString(responseSnapshot, ['senderMode', 'navlungoSenderMode']);
  if (senderMode === 'addressId' || senderMode === 'address_id') {
    return 'address_id';
  }
  if (senderMode === 'fullSender' || senderMode === 'full_sender' || senderMode === 'full_sender_details') {
    return 'full_sender_details';
  }

  const post = readNavlungoFirstPost(execution.requestSnapshot);
  const sender = isRecord(post?.sender) ? post.sender : null;
  if (readNavlungoPayloadSenderAddressId(execution.requestSnapshot)) {
    return 'address_id';
  }
  if (sender && Object.keys(sender).length > 0) {
    return 'full_sender_details';
  }
  return 'unknown';
}

function navlungoForwardExecutionHasProviderEvidence(execution: NavlungoForwardShipmentExecutionContext) {
  const responseSnapshot = readSnapshot(execution.responseSnapshot);
  return Boolean(
    execution.providerShipmentId?.trim() ||
      execution.trackingNumber?.trim() ||
      execution.trackingUrl?.trim() ||
      execution.labelUrl?.trim() ||
      readString(responseSnapshot, ['providerShipmentId', 'post_number', 'postNumber', 'trackingNumber', 'trackingUrl', 'barcode']),
  );
}

function isSuccessfulNavlungoForwardExecution(execution: NavlungoForwardShipmentExecutionContext) {
  const provider = typeof execution.provider === 'string' ? execution.provider.toLowerCase() : '';
  if (provider !== 'navlungo' || !navlungoForwardExecutionHasProviderEvidence(execution)) {
    return false;
  }

  const status = typeof execution.shipmentStatus === 'string' ? execution.shipmentStatus.toLowerCase() : '';
  return status !== 'failed' && status !== 'cancelled' && status !== 'canceled';
}

function resolveOriginalForwardNavlungoAddressId(executions: NavlungoForwardShipmentExecutionContext[] | undefined) {
  const candidates = [...(executions ?? [])]
    .filter(isSuccessfulNavlungoForwardExecution)
    .sort((left, right) => {
      const leftTime = left.updatedAt ? new Date(left.updatedAt).getTime() : 0;
      const rightTime = right.updatedAt ? new Date(right.updatedAt).getTime() : 0;
      return rightTime - leftTime;
    });

  for (const execution of candidates) {
    const originalSenderMode = inferOriginalNavlungoSenderMode(execution);
    const payloadSenderAddressId = readNavlungoPayloadSenderAddressId(execution.requestSnapshot);
    const payloadSenderAddressIdNumeric = parsePositiveInteger(payloadSenderAddressId);
    const warehouseAddressIdNumeric = parsePositiveInteger(execution.warehouseId ?? null);
    const configuredSenderAddressId = readNavlungoConfiguredSenderAddressIdFromPayload(execution.requestSnapshot);
    const configuredSenderAddressIdNumeric = parsePositiveInteger(configuredSenderAddressId);
    const originalForwardDiagnostics = {
      originalForwardSenderMode: originalSenderMode,
      originalPayloadSenderAddressIdPresent: Boolean(payloadSenderAddressId?.trim()),
      originalPayloadSenderAddressId: payloadSenderAddressIdNumeric ? String(payloadSenderAddressIdNumeric) : null,
      originalForwardWarehouseAddressIdPresent: Boolean(
        execution.warehouseId?.trim() || configuredSenderAddressId?.trim(),
      ),
      originalForwardWarehouseAddressId: warehouseAddressIdNumeric
        ? String(warehouseAddressIdNumeric)
        : configuredSenderAddressIdNumeric
          ? String(configuredSenderAddressIdNumeric)
          : null,
      originalForwardShipmentExecutionId: execution.id ?? null,
      originalForwardProviderShipmentIdPresent: Boolean(execution.providerShipmentId?.trim()),
    };

    if (payloadSenderAddressIdNumeric) {
      return {
        value: String(payloadSenderAddressIdNumeric),
        source: 'original_forward_payload_sender_address_id',
        ...originalForwardDiagnostics,
      };
    }

    if (warehouseAddressIdNumeric) {
      return {
        value: String(warehouseAddressIdNumeric),
        source: 'original_forward_warehouse_id',
        ...originalForwardDiagnostics,
      };
    }

    if (configuredSenderAddressIdNumeric) {
      return {
        value: String(configuredSenderAddressIdNumeric),
        source: 'original_forward_configured_sender_address_id',
        ...originalForwardDiagnostics,
      };
    }

    return {
      value: null,
      source: 'original_forward_missing_numeric_address_id',
      ...originalForwardDiagnostics,
    };
  }

  return {
    value: null,
    source: 'original_forward_unavailable',
    originalForwardSenderMode: 'unknown',
    originalPayloadSenderAddressIdPresent: false,
    originalPayloadSenderAddressId: null,
    originalForwardWarehouseAddressIdPresent: false,
    originalForwardWarehouseAddressId: null,
    originalForwardShipmentExecutionId: null,
    originalForwardProviderShipmentIdPresent: false,
  };
}

function resolveConfiguredNavlungoReturnRecipientAddressId(config: {
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

function resolveNavlungoReturnRecipientAddressId(input: {
  shipmentExecutions?: NavlungoForwardShipmentExecutionContext[];
  config: {
    providerMetadata: unknown;
  };
  env: AppEnv;
}) {
  const original = resolveOriginalForwardNavlungoAddressId(input.shipmentExecutions);
  if (parsePositiveInteger(original.value)) {
    return {
      ...original,
      fallbackUsed: false,
      configuredFallbackSource: null,
      returnRecipientEqualsOriginalSenderAddressId: true,
    };
  }

  const configured = resolveConfiguredNavlungoReturnRecipientAddressId(input.config, input.env);
  const configuredNumeric = parsePositiveInteger(configured.value);
  return {
    ...original,
    value: configured.value,
    source: configured.source,
    fallbackUsed: configured.source !== 'missing',
    configuredFallbackSource: configured.source,
    returnRecipientEqualsOriginalSenderAddressId: Boolean(
      configuredNumeric &&
        parsePositiveInteger(original.originalPayloadSenderAddressId ?? original.originalForwardWarehouseAddressId) ===
          configuredNumeric,
    ),
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

function resolveNavlungoReturnPickupBaseUrl(
  env: AppEnv,
  endpointPathOverride: NavlungoReturnPickupInput['endpointPathOverride'],
) {
  const selectedVersion = 'v2.1';
  const baseUrl = env.NAVLUNGO_BASE_URL?.trim();
  const endpointPath = resolveNavlungoDiagnosticEndpointPath(endpointPathOverride);
  if (!baseUrl) {
    return {
      env,
      versionTried: selectedVersion,
      endpointPath,
      baseUrlOverride: null,
      resolvedProviderPath: `/v2.1${endpointPath}`,
      resolvedProviderUrl: null,
    };
  }

  try {
    const url = new URL(baseUrl);
    url.pathname = '/v2.1';
    const nextBaseUrl = url.toString().replace(/\/$/, '');
    return {
      env: {
        ...env,
        NAVLUNGO_BASE_URL: nextBaseUrl,
      },
      versionTried: selectedVersion,
      endpointPath,
      baseUrlOverride: nextBaseUrl,
      resolvedProviderPath: `/v2.1${endpointPath}`,
      resolvedProviderUrl: `${nextBaseUrl}${endpointPath}`,
    };
  } catch {
    return {
      env,
      versionTried: selectedVersion,
      endpointPath,
      baseUrlOverride: null,
      resolvedProviderPath: `/v2.1${endpointPath}`,
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
      settlementRefundAdjustments?: Parameters<typeof mapLinkedSettlementRefundAdjustments>[0];
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
  const records = await withDashboardTiming('returns.vendor_return_fetch', () => prisma.returnRecord.findMany({
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
  }));

  return withDashboardTiming('returns.metrics_aggregation', () => records.map((record) => {
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
  }));
}

export async function listVendorDashboardReturns(
  vendorId: string,
  options: { limit?: number; offset?: number } = {},
): Promise<DashboardReturnSummaryDto[]> {
  const records = await withDashboardTiming('returns.dashboard_return_fetch', () => prisma.returnRecord.findMany({
    where: {
      vendorAllocation: {
        assignedVendorId: vendorId,
      },
    },
    select: {
      id: true,
      status: true,
      returnLifecycleStatus: true,
      sourceShopifyRefundId: true,
      createdAt: true,
    },
    orderBy: {
      createdAt: 'desc',
    },
    take: options.limit ?? 10,
    skip: options.offset ?? 0,
  }));

  return records.map((record) => ({
    id: record.id,
    status: getLifecycleStatus(record.status, record.returnLifecycleStatus),
    sourceShopifyRefundId: record.sourceShopifyRefundId,
    createdAt: record.createdAt.toISOString(),
  }));
}

export async function getVendorReturnById(
  vendorId: string,
  returnId: string,
  options: { shopifyAdminService?: ShopifyLineItemImageLookupService; deferImageBackfill?: boolean } = {},
): Promise<ReturnDetailDto | null> {
  const startedAt = Date.now();
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
              settlementRefundAdjustments: {
                select: {
                  id: true,
                  status: true,
                  amountMinor: true,
                  originalAmountMinor: true,
                  appliedAmountMinor: true,
                  remainingAmountMinor: true,
                  currencyCode: true,
                  reason: true,
                  originalSettlementApprovalId: true,
                  originalSettlementApprovalLineId: true,
                  originalSettlementCommissionInvoiceId: true,
                  appliedSettlementApprovalId: true,
                  appliedSettlementApprovalLineId: true,
                  blockedReason: true,
                  createdAt: true,
                  updatedAt: true,
                  applications: {
                    orderBy: { createdAt: 'asc' },
                    select: {
                      id: true,
                      settlementApprovalId: true,
                      settlementApprovalLineId: true,
                      amountMinor: true,
                      currencyCode: true,
                      status: true,
                      createdAt: true,
                      updatedAt: true,
                    },
                  },
                },
                orderBy: {
                  createdAt: 'desc',
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
  const dbElapsedMs = Date.now() - startedAt;
  if (dbElapsedMs >= 500) {
    console.warn('[return-detail-timing]', {
      stage: 'db_find_return_detail',
      returnId,
      elapsedMs: dbElapsedMs,
    });
  }

  if (!record) {
    return null;
  }

  let lineItemImageOverrides = new Map<string, string>();
  if (options.deferImageBackfill && options.shopifyAdminService) {
    const imageBackfillStartedAt = Date.now();
    void backfillMissingLineItemImages(record.vendorAllocation, options.shopifyAdminService)
      .then((resolved) => {
        const elapsedMs = Date.now() - imageBackfillStartedAt;
        if (elapsedMs >= 500 || resolved.size > 0) {
          console.info('[return-detail-image-backfill]', {
            mode: 'deferred',
            returnId,
            resolvedCount: resolved.size,
            elapsedMs,
          });
        }
      })
      .catch((error) => {
        console.warn('[return-detail-image-backfill]', {
          mode: 'deferred',
          returnId,
          resolvedCount: 0,
          error: error instanceof Error ? error.message : 'Unknown image backfill error.',
        });
      });
  } else {
    const imageBackfillStartedAt = Date.now();
    lineItemImageOverrides = await backfillMissingLineItemImages(record.vendorAllocation, options.shopifyAdminService);
    const imageElapsedMs = Date.now() - imageBackfillStartedAt;
    if (imageElapsedMs >= 500) {
      console.warn('[return-detail-timing]', {
        stage: 'line_item_image_backfill',
        returnId,
        resolvedCount: lineItemImageOverrides.size,
        elapsedMs: imageElapsedMs,
      });
    }
  }
  const matchingRefundRecords = getMatchingRefundRecords(record);
  const refundAmount = matchingRefundRecords.reduce(
    (sum, refund) => sum + toNumber(refund.amount),
    0,
  );
  const sourceRefundId = record.sourceShopifyRefundId ?? (isReturnRequestRecord(record) ? '' : getRefundSourceId(record));
  const refundLineItems = matchingRefundRecords.flatMap((refund) => refund.lineItems);
  const settlementRefundAdjustments = matchingRefundRecords.flatMap((refund) =>
    mapLinkedSettlementRefundAdjustments(refund.settlementRefundAdjustments),
  );
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
    settlementRefundAdjustments,
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

function readOrderAddress(order: { shippingAddress: string | null }) {
  return order.shippingAddress?.trim() || null;
}

function readKargonomiWarehousePhone(warehouseMetadata: unknown, configMetadata: unknown) {
  return (
    readString(warehouseMetadata, [
      'phone',
      'contactPhone',
      'contact_phone',
      'kargonomiReturnReceiverPhone',
      'returnReceiverPhone',
      'receiverPhone',
      'warehousePhone',
    ]) ??
    readString(configMetadata, [
      'kargonomiReturnReceiverPhone',
      'returnReceiverPhone',
      'receiverPhone',
      'warehousePhone',
      'phone',
    ])
  );
}

function readKargonomiWarehouseContactName(warehouseMetadata: unknown, configMetadata: unknown, fallback?: string | null) {
  return resolveKargonomiReceiverName(warehouseMetadata, configMetadata, fallback).value;
}

function resolveKargonomiReceiverName(warehouseMetadata: unknown, configMetadata: unknown, fallback?: string | null) {
  const metadataName = readString(warehouseMetadata, ['contactName', 'contact_name']);
  if (metadataName) {
    return { value: metadataName, source: 'warehouse_metadata_contact_name' };
  }

  const fallbackName = fallback?.trim() || null;
  if (fallbackName) {
    return { value: fallbackName, source: 'warehouse_name' };
  }

  const providerMetadataName = readString(configMetadata, ['kargonomiReturnReceiverName', 'returnReceiverName']);
  if (providerMetadataName) {
    return { value: providerMetadataName, source: 'provider_metadata' };
  }

  return { value: null, source: 'missing' };
}

function resolveKargonomiReceiverAddress(
  warehouse: { address: string | null } | null | undefined,
  configMetadata: unknown,
) {
  const warehouseAddress = warehouse?.address?.trim() || null;
  if (warehouseAddress) {
    return { value: warehouseAddress, source: 'warehouse_address' };
  }

  const providerMetadataAddress = readString(configMetadata, [
    'kargonomiReturnReceiverAddress',
    'returnReceiverAddress',
    'warehouseAddress',
  ]);
  if (providerMetadataAddress) {
    return { value: providerMetadataAddress, source: 'provider_metadata' };
  }

  return { value: null, source: 'missing' };
}

function readKargonomiLocationId(source: unknown, keys: string[]) {
  const value = readString(source, keys);
  if (!value) {
    return null;
  }
  return value;
}

function readKargonomiReceiverStateId(warehouseMetadata: unknown, configMetadata: unknown) {
  return (
    readKargonomiLocationId(warehouseMetadata, [
      'stateId',
      'state_id',
      'kargonomiReturnReceiverStateId',
      'returnReceiverStateId',
      'receiverStateId',
      'warehouseStateId',
    ]) ??
    readKargonomiLocationId(configMetadata, [
      'kargonomiReturnReceiverStateId',
      'returnReceiverStateId',
      'receiverStateId',
      'warehouseStateId',
      'stateId',
    ])
  );
}

function readKargonomiReceiverCityId(warehouseMetadata: unknown, configMetadata: unknown) {
  return (
    readKargonomiLocationId(warehouseMetadata, [
      'cityId',
      'city_id',
      'kargonomiReturnReceiverCityId',
      'returnReceiverCityId',
      'receiverCityId',
      'warehouseCityId',
    ]) ??
    readKargonomiLocationId(configMetadata, [
      'kargonomiReturnReceiverCityId',
      'returnReceiverCityId',
      'receiverCityId',
      'warehouseCityId',
      'cityId',
    ])
  );
}

function readNestedRecord(value: unknown, key: string) {
  const nested = isRecord(value) ? value[key] : null;
  return isRecord(nested) ? nested : null;
}

function readAddressDistrict(value: unknown) {
  if (!isRecord(value)) {
    return null;
  }

  const explicitDistrict = readString(value, [
    'district',
    'district_name',
    'districtName',
    'city_area',
    'cityArea',
    'county',
    'county_name',
    'countyName',
  ]);
  if (explicitDistrict) {
    return explicitDistrict;
  }

  const countryCode = readString(value, ['country_code'])?.toUpperCase();
  const country = readString(value, ['country'])?.toLocaleLowerCase('tr-TR');
  if (countryCode === 'TR' || country === 'turkey' || country === 'türkiye' || country === 'turkiye') {
    const address2District = readString(value, ['address2']);
    if (address2District) {
      return address2District;
    }
  }

  return readString(value, ['province', 'province_name', 'provinceName']);
}

function readStoredOrderWebhookDistrict(order: { webhookEvents?: Array<{ rawPayload: string | null }> }) {
  const events = Array.isArray(order.webhookEvents) ? order.webhookEvents : [];
  for (const event of events) {
    const rawPayload = event.rawPayload?.trim();
    if (!rawPayload) {
      continue;
    }

    try {
      const payload = JSON.parse(rawPayload) as Record<string, unknown>;
      const shippingAddress = readNestedRecord(payload, 'shipping_address');
      const billingAddress = readNestedRecord(payload, 'billing_address');
      const district = readAddressDistrict(shippingAddress) ?? readAddressDistrict(billingAddress);
      if (district) {
        return district;
      }
    } catch {
      continue;
    }
  }

  return null;
}

function readKargonomiReturnDestinationText(order: {
  shippingCity: string | null;
  shippingDistrict: string | null;
  billingCity?: string | null;
  billingDistrict?: string | null;
  webhookEvents?: Array<{ rawPayload: string | null }>;
}) {
  return {
    province: order.shippingCity?.trim() || order.billingCity?.trim() || null,
    city: order.shippingCity?.trim() || order.billingCity?.trim() || null,
    district:
      order.shippingDistrict?.trim() ||
      order.billingDistrict?.trim() ||
      readStoredOrderWebhookDistrict(order) ||
      null,
  };
}

function readKargonomiOrderDestinationId(order: unknown, keys: string[]) {
  return readKargonomiLocationId(order, keys);
}

async function resolveKargonomiReturnSenderDestination(input: {
  order: {
    shippingCity: string | null;
    shippingDistrict: string | null;
    billingCity?: string | null;
    billingDistrict?: string | null;
    webhookEvents?: Array<{ rawPayload: string | null }>;
  };
  configMetadata: unknown;
  env?: AppEnv;
  kargonomiDestinationClient?: KargonomiDestinationLookupClient;
}) {
  const directStateId =
    readKargonomiOrderDestinationId(input.order, [
      'kargonomiBuyerStateId',
      'buyerStateId',
      'buyer_state_id',
      'shippingStateId',
      'shipping_state_id',
    ]) ??
    readKargonomiLocationId(input.configMetadata, [
      'kargonomiReturnSenderStateId',
      'returnSenderStateId',
      'fallbackBuyerStateId',
      'buyerStateId',
      'buyer_state_id',
    ]);
  const directCityId =
    readKargonomiOrderDestinationId(input.order, [
      'kargonomiBuyerCityId',
      'buyerCityId',
      'buyer_city_id',
      'shippingCityId',
      'shipping_city_id',
    ]) ??
    readKargonomiLocationId(input.configMetadata, [
      'kargonomiReturnSenderCityId',
      'returnSenderCityId',
      'fallbackBuyerCityId',
      'buyerCityId',
      'buyer_city_id',
    ]);
  const district = readKargonomiReturnDestinationText(input.order).district;

  if (directStateId && directCityId) {
    return {
      senderStateId: directStateId,
      senderCityId: directCityId,
      senderDistrict: district,
      diagnostics: {
        source: 'metadata_or_order_ids',
        senderCityIdPresent: true,
        senderStateIdPresent: true,
        senderDistrictPresent: Boolean(district),
        lookupAttempted: false,
      },
    };
  }

  const destinationClient =
    input.kargonomiDestinationClient ??
    (input.env?.KARGONOMI_BASE_URL && input.env.KARGONOMI_API_TOKEN ? new KargonomiHttpClient(input.env) : null);
  if (!destinationClient) {
    return {
      senderStateId: directStateId,
      senderCityId: directCityId,
      senderDistrict: district,
      diagnostics: {
        source: directStateId || directCityId ? 'partial_metadata_or_order_ids' : 'lookup_unavailable',
        senderCityIdPresent: Boolean(directCityId),
        senderStateIdPresent: Boolean(directStateId),
        senderDistrictPresent: Boolean(district),
        lookupAttempted: false,
      },
    };
  }

  const destinationText = readKargonomiReturnDestinationText(input.order);
  const resolution = await resolveKargonomiDestinationAddress(destinationText, destinationClient);
  if (resolution.ok) {
    return {
      senderStateId: resolution.buyerStateId,
      senderCityId: resolution.buyerCityId,
      senderDistrict: destinationText.district,
      diagnostics: {
        source: 'order_shipping_address_lookup',
        senderCityIdPresent: true,
        senderStateIdPresent: true,
        senderDistrictPresent: Boolean(destinationText.district),
        lookupAttempted: true,
        stateSource: resolution.stateSource,
        citySource: resolution.citySource,
      },
    };
  }

  const failedResolution = resolution as Extract<KargonomiDestinationResolution, { ok: false }>;
  return {
    senderStateId: directStateId,
    senderCityId: directCityId,
    senderDistrict: destinationText.district,
    diagnostics: {
      source: directStateId && directCityId ? 'metadata_after_lookup_failure' : 'order_shipping_address_lookup_failed',
      senderCityIdPresent: Boolean(directCityId),
      senderStateIdPresent: Boolean(directStateId),
      senderDistrictPresent: Boolean(destinationText.district),
      lookupAttempted: true,
      reason: failedResolution.reason,
    },
  };
}

export async function previewKargonomiReturnShipmentForReturn(
  returnId: string,
  actor: ReturnActorScope,
  input: KargonomiReturnPreviewInput = {},
): Promise<KargonomiReturnPreviewDto> {
  const record = await prisma.returnRecord.findUnique({
    where: { id: returnId },
    include: {
      vendorAllocation: {
        include: {
          order: {
            include: {
              webhookEvents: {
                where: {
                  topic: 'orders/create',
                  rawPayload: {
                    not: null,
                  },
                },
                orderBy: [
                  {
                    processedAt: 'desc',
                  },
                  {
                    receivedAt: 'desc',
                  },
                ],
                take: 1,
              },
            },
          },
          lineItems: {
            include: {
              shopifyOrderLineItem: true,
            },
          },
        },
      },
    },
  });

  if (!record || !canActOnReturn(record, actor)) {
    throw new ReturnReviewError('Return record not found.', 404);
  }

  const allocation = record.vendorAllocation;
  const order = allocation.order;
  const config = await prisma.vendorShippingConfig.findUnique({
    where: { vendorId: allocation.assignedVendorId },
    include: {
      warehouses: true,
    },
  });
  const configMetadata = config?.providerMetadata ?? null;
  const kargonomiWarehouses = (config?.warehouses ?? []).filter(
    (warehouse) => warehouse.provider.toString().toLowerCase() === 'kargonomi',
  );
  const warehouse =
    kargonomiWarehouses.find((item) => item.warehouseId === config?.defaultWarehouseId) ??
    kargonomiWarehouses.find((item) => item.isDefault) ??
    kargonomiWarehouses[0] ??
    null;
  const warehouseId = warehouse?.warehouseId ?? config?.defaultWarehouseId ?? null;
  const receiverNameResolution = resolveKargonomiReceiverName(warehouse?.metadata ?? null, configMetadata, warehouse?.name);
  const receiverName = receiverNameResolution.value;
  const receiverPhone = normalizeKargonomiPhone(readKargonomiWarehousePhone(warehouse?.metadata ?? null, configMetadata));
  const receiverAddressResolution = resolveKargonomiReceiverAddress(warehouse, configMetadata);
  const receiverAddress = receiverAddressResolution.value;
  const receiverStateId = readKargonomiReceiverStateId(warehouse?.metadata ?? null, configMetadata);
  const receiverCityId = readKargonomiReceiverCityId(warehouse?.metadata ?? null, configMetadata);
  const defaultDesi = Number(config?.defaultDesi ?? 0);
  const senderName = order.customerName?.trim() || order.billingFullName?.trim() || null;
  const senderPhone = normalizeKargonomiPhone(order.customerPhone?.trim() || order.billingPhone?.trim() || null);
  const senderTaxNumberResolution = resolveKargonomiReturnSenderTaxNumber({
    senderTaxNumber: input.senderTaxNumber,
    env: input.env,
  });
  const senderTaxNumber = senderTaxNumberResolution.value;
  const senderAddress = readOrderAddress(order);
  const buyerNameValid = hasAtLeastTwoWords(receiverName);
  const senderDestination = await resolveKargonomiReturnSenderDestination({
    order,
    configMetadata,
    env: input.env,
    kargonomiDestinationClient: input.kargonomiDestinationClient,
  });
  const senderCityId = senderDestination.senderCityId;
  const senderStateId = senderDestination.senderStateId;
  const hasDistrict = Boolean(senderDestination.senderDistrict);
  const hasReturnItemsOrReference = Boolean(
    record.sourceShopifyLineItemId ||
      record.sourceShopifyReturnId ||
      record.sourceShopifyReturnGid ||
      record.returnReferenceId ||
      allocation.lineItems.length,
  );
  const missingFields: string[] = [];
  if (!order) missingFields.push('shopifyOrder');
  if (!senderName) missingFields.push('sender.name');
  if (!senderPhone) missingFields.push('sender.phone');
  if (!senderTaxNumber) missingFields.push('sender.taxNumber');
  if (!senderAddress) missingFields.push('sender.address');
  if (!senderCityId) missingFields.push('sender.cityId');
  if (!senderStateId) missingFields.push('sender.stateId');
  if (!hasDistrict) missingFields.push('sender.district');
  if (!config) missingFields.push('shippingConfig');
  if (config && !config.shippingEnabled) missingFields.push('shippingConfig.shippingEnabled');
  if (!warehouseId || !warehouse) missingFields.push('receiver.warehouseId');
  if (!receiverName || !buyerNameValid) missingFields.push('receiver.name');
  if (!receiverPhone) missingFields.push('receiver.phone');
  if (!receiverAddress) missingFields.push('receiver.address');
  if (!receiverCityId) missingFields.push('receiver.cityId');
  if (!receiverStateId) missingFields.push('receiver.stateId');
  if (!Number.isFinite(defaultDesi) || defaultDesi <= 0) missingFields.push('package.defaultDesi');
  if (!hasReturnItemsOrReference) missingFields.push('return.itemsOrReference');

  const notes = [
    'Preview only. No Kargonomi API call was made.',
    'Provider-native return shipment behavior remains untested; current guidance is reverse sender and receiver.',
  ];
  if (config?.preferredProvider?.toString().toLowerCase() !== 'kargonomi') {
    notes.push('Vendor preferred shipping provider is not Kargonomi; preview uses Kargonomi warehouse readiness only.');
  }

  return {
    ok: true,
    provider: 'KARGONOMI',
    mode: 'return_preview',
    returnId,
    ready: missingFields.length === 0,
    missingFields,
    direction: 'CUSTOMER_TO_VENDOR',
    senderSource: 'CUSTOMER_ORDER_ADDRESS',
    receiverSource: 'VENDOR_KARGONOMI_WAREHOUSE',
    previewPayload: {
      shipment: {
        sender: {
          source: 'CUSTOMER_ORDER_ADDRESS',
          namePresent: Boolean(senderName),
          phonePresent: Boolean(senderPhone),
          phoneValid: Boolean(senderPhone),
          taxNumberPresent: Boolean(senderTaxNumber),
          taxNumberSource: senderTaxNumberResolution.source,
          addressPresent: Boolean(senderAddress),
          districtPresent: hasDistrict,
          cityId: senderCityId,
          stateId: senderStateId,
        },
        senderDestinationResolution: senderDestination.diagnostics,
        receiver: {
          source: 'VENDOR_KARGONOMI_WAREHOUSE',
          warehouseId,
          namePresent: Boolean(receiverName),
          nameValid: buyerNameValid,
          nameSource: receiverNameResolution.source,
          phonePresent: Boolean(receiverPhone),
          phoneValid: Boolean(receiverPhone),
          addressPresent: Boolean(receiverAddress),
          addressSource: receiverAddressResolution.source,
          cityId: receiverCityId,
          stateId: receiverStateId,
        },
        package: {
          defaultDesi: Number.isFinite(defaultDesi) && defaultDesi > 0 ? defaultDesi : null,
        },
        reference: {
          returnReferencePresent: Boolean(record.returnReferenceId || record.sourceShopifyReturnId || record.sourceShopifyReturnGid),
          returnLineItemCount: allocation.lineItems.length,
          sourceShopifyOrderNumber: record.sourceShopifyOrderNumber,
        },
      },
    },
    notes,
  };
}

function readKargonomiReturnPreviewShipment(preview: KargonomiReturnPreviewDto) {
  return readNestedRecord(preview.previewPayload, 'shipment');
}

function readKargonomiReturnPreviewSenderDestination(preview: KargonomiReturnPreviewDto) {
  const shipment = readKargonomiReturnPreviewShipment(preview);
  const sender = readNestedRecord(shipment, 'sender');
  return {
    senderStateId: readString(sender, ['stateId']),
    senderCityId: readString(sender, ['cityId']),
  };
}

function normalizeKargonomiReturnSenderTaxNumber(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed || null;
}

function resolveKargonomiReturnSenderTaxNumber(input: {
  senderTaxNumber?: string | null;
  env?: Pick<AppEnv, 'KARGONOMI_ACCOUNT_TAX_NUMBER'>;
}): KargonomiReturnSenderTaxNumberResolution {
  const explicitValue = normalizeKargonomiReturnSenderTaxNumber(input.senderTaxNumber);
  if (explicitValue) {
    return {
      value: explicitValue,
      source: 'kargonomi_account_fallback',
    };
  }

  const fallbackValue = normalizeKargonomiReturnSenderTaxNumber(input.env?.KARGONOMI_ACCOUNT_TAX_NUMBER);
  if (fallbackValue) {
    return {
      value: fallbackValue,
      source: 'kargonomi_account_fallback',
    };
  }

  return {
    value: null,
    source: 'missing',
  };
}

function hasAtLeastTwoWords(value: string | null | undefined) {
  return (value ?? '').trim().split(/\s+/).filter(Boolean).length >= 2;
}

function buildKargonomiReturnCreateReadinessDetails(
  preview: KargonomiReturnPreviewDto,
  missingFields = preview.missingFields,
) {
  const shipment = readKargonomiReturnPreviewShipment(preview);
  const sender = readNestedRecord(shipment, 'sender');
  const receiver = readNestedRecord(shipment, 'receiver');
  return {
    missingFields,
    senderDestinationResolution: readNestedRecord(shipment, 'senderDestinationResolution'),
    senderCityIdPresent: Boolean(readString(sender, ['cityId'])),
    senderStateIdPresent: Boolean(readString(sender, ['stateId'])),
    senderPhoneValid: readBoolean(sender, ['phoneValid']) === true,
    senderTaxNumberPresent: readBoolean(sender, ['taxNumberPresent']) === true,
    senderTaxNumberSource: readString(sender, ['taxNumberSource']) ?? 'missing',
    buyerNameValid: readBoolean(receiver, ['nameValid']) === true,
    receiverNamePresent: readBoolean(receiver, ['namePresent']) === true,
    receiverNameValid: readBoolean(receiver, ['nameValid']) === true,
    receiverNameSource: readString(receiver, ['nameSource']) ?? 'missing',
    receiverAddressPresent: readBoolean(receiver, ['addressPresent']) === true,
    receiverAddressSource: readString(receiver, ['addressSource']) ?? 'missing',
    receiverCityIdPresent: Boolean(readString(receiver, ['cityId'])),
    receiverStateIdPresent: Boolean(readString(receiver, ['stateId'])),
  };
}

function buildKargonomiReturnReadinessMessage(missingFields: string[]) {
  return [
    'Kargonomi return shipment is not ready.',
    ...missingFields.map((field) => `- ${field}`),
    '',
    'Provider request blocked before create call.',
  ].join('\n');
}

function buildKargonomiReturnReferenceId(record: {
  id: string;
  sourceShopifyOrderNumber: string;
  vendorAllocation: { assignedVendorId: string };
}) {
  return [
    'RET',
    sanitizeNavlungoReferencePart(record.vendorAllocation.assignedVendorId, 'VENDOR', 24),
    sanitizeNavlungoReferencePart(record.sourceShopifyOrderNumber, 'ORDER', 24),
    sanitizeNavlungoReferencePart(record.id, 'RETURN', 24),
  ].join('-');
}

function buildKargonomiReturnShipmentPayload(input: {
  record: {
    id: string;
    sourceShopifyOrderNumber: string;
    sourceShopifyReturnId: string | null;
    sourceShopifyReturnGid: string | null;
    returnReferenceId: string | null;
    vendorAllocation: {
      assignedVendorId: string;
      order: {
        customerName: string | null;
        billingFullName: string | null;
        customerEmail: string | null;
        customerPhone: string | null;
        billingPhone: string | null;
        shippingAddress: string | null;
        shippingDistrict: string | null;
      };
      lineItems: Array<{
        id: string;
        shopifyOrderLineItem: {
          sku: string | null;
          title?: string | null;
          variantTitle?: string | null;
        } | null;
      }>;
    };
  };
  config: {
    defaultDesi: Prisma.Decimal | number | string | null;
    defaultWarehouseId: string | null;
    providerMetadata: Prisma.JsonValue | null;
    warehouses: Array<{
      warehouseId: string;
      provider: unknown;
      isDefault: boolean;
      name: string | null;
      address: string | null;
      metadata: Prisma.JsonValue | null;
    }>;
  } | null;
  resolvedSenderDestination?: {
    senderStateId: string | null;
    senderCityId: string | null;
  };
  senderTaxNumber?: string | null;
  env?: Pick<AppEnv, 'KARGONOMI_ACCOUNT_TAX_NUMBER'>;
}) {
  const order = input.record.vendorAllocation.order;
  const configMetadata = input.config?.providerMetadata ?? null;
  const kargonomiWarehouses = (input.config?.warehouses ?? []).filter(
    (warehouse) => warehouse.provider?.toString().toLowerCase() === 'kargonomi',
  );
  const warehouse =
    kargonomiWarehouses.find((item) => item.warehouseId === input.config?.defaultWarehouseId) ??
    kargonomiWarehouses.find((item) => item.isDefault) ??
    kargonomiWarehouses[0] ??
    null;
  const warehouseMetadata = warehouse?.metadata ?? null;
  const receiverNameResolution = resolveKargonomiReceiverName(warehouseMetadata, configMetadata, warehouse?.name);
  const receiverName = receiverNameResolution.value;
  const receiverPhone = normalizeKargonomiPhone(readKargonomiWarehousePhone(warehouseMetadata, configMetadata));
  const receiverAddressResolution = resolveKargonomiReceiverAddress(warehouse, configMetadata);
  const receiverAddress = receiverAddressResolution.value;
  const receiverStateId = readKargonomiReceiverStateId(warehouseMetadata, configMetadata);
  const receiverCityId = readKargonomiReceiverCityId(warehouseMetadata, configMetadata);
  const senderName = order.customerName?.trim() || order.billingFullName?.trim() || null;
  const senderPhone = normalizeKargonomiPhone(order.customerPhone?.trim() || order.billingPhone?.trim() || null);
  const senderTaxNumberResolution = resolveKargonomiReturnSenderTaxNumber({
    senderTaxNumber: input.senderTaxNumber,
    env: input.env,
  });
  const senderTaxNumber = senderTaxNumberResolution.value;
  const senderAddress = readOrderAddress(order);
  const buyerNameValid = hasAtLeastTwoWords(receiverName);
  const senderCityId =
    input.resolvedSenderDestination?.senderCityId ??
    readKargonomiLocationId(configMetadata, [
      'kargonomiReturnSenderCityId',
      'returnSenderCityId',
      'fallbackBuyerCityId',
      'buyerCityId',
      'buyer_city_id',
    ]);
  const senderStateId =
    input.resolvedSenderDestination?.senderStateId ??
    readKargonomiLocationId(configMetadata, [
      'kargonomiReturnSenderStateId',
      'returnSenderStateId',
      'fallbackBuyerStateId',
      'buyerStateId',
      'buyer_state_id',
    ]);
  const defaultDesi = Number(input.config?.defaultDesi ?? 0);
  const content =
    input.record.vendorAllocation.lineItems
      .map((line) => line.shopifyOrderLineItem?.sku ?? line.shopifyOrderLineItem?.title ?? line.shopifyOrderLineItem?.variantTitle)
      .filter((item): item is string => Boolean(item?.trim()))
      .join(', ')
      .slice(0, 240) || `Return ${input.record.sourceShopifyOrderNumber}`;
  const referenceId = input.record.returnReferenceId ?? buildKargonomiReturnReferenceId(input.record);
  const packageBarcode = referenceId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || input.record.id;
  const missingFields = [
    !senderName ? 'sender.name' : null,
    !senderPhone ? 'sender.phone' : null,
    !senderTaxNumber ? 'sender.taxNumber' : null,
    !senderAddress ? 'sender.address' : null,
    !senderStateId ? 'sender.stateId' : null,
    !senderCityId ? 'sender.cityId' : null,
    !receiverName || !buyerNameValid ? 'receiver.name' : null,
    !receiverPhone ? 'receiver.phone' : null,
    !receiverAddress ? 'receiver.address' : null,
    !receiverStateId ? 'receiver.stateId' : null,
    !receiverCityId ? 'receiver.cityId' : null,
    !Number.isFinite(defaultDesi) || defaultDesi <= 0 ? 'package.defaultDesi' : null,
  ].filter((field): field is string => Boolean(field));

  const payload: KargonomiShipmentCreatePayloadInput = {
    sender: {
      sender_name: senderName,
      sender_email: order.customerEmail,
      sender_phone: senderPhone,
      sender_tax_number: senderTaxNumber,
      sender_address: senderAddress,
      sender_state_id: senderStateId,
      sender_city_id: senderCityId,
    },
    buyer: {
      buyer_name: receiverName ?? '',
      buyer_phone: receiverPhone ?? '',
      buyer_address: receiverAddress ?? '',
      buyer_state_id: receiverStateId ?? '',
      buyer_city_id: receiverCityId ?? '',
    },
    packages: [
      {
        content,
        barcode: packageBarcode,
        desi: Number.isFinite(defaultDesi) && defaultDesi > 0 ? defaultDesi : 1,
      },
    ],
  };

  return {
    payload,
    missingFields,
    referenceId,
    warehouseId: warehouse?.warehouseId ?? input.config?.defaultWarehouseId ?? null,
    senderStateId,
    senderCityId,
    receiverStateId,
    receiverCityId,
    senderPhoneValid: Boolean(senderPhone),
    senderTaxNumberPresent: Boolean(senderTaxNumber),
    senderTaxNumberSource: senderTaxNumberResolution.source,
    buyerNameValid,
    receiverNamePresent: Boolean(receiverName),
    receiverNameSource: receiverNameResolution.source,
    receiverAddressPresent: Boolean(receiverAddress),
    receiverAddressSource: receiverAddressResolution.source,
  };
}

function isReturnClosedOrCancelled(record: { status: string; returnLifecycleStatus: string | null }) {
  const normalized = `${record.status ?? ''} ${record.returnLifecycleStatus ?? ''}`.toLowerCase();
  return /\b(closed|cancelled|canceled)\b/.test(normalized);
}

type KargonomiReturnShopifyAutoSyncRecord = {
  id: string;
  sourceShopifyReturnId: string | null;
  sourceShopifyReturnGid: string | null;
  sourceShopifyLineItemId: string | null;
  returnProvider: string | null;
  returnProviderShipmentId: string | null;
  returnTrackingNumber: string | null;
  returnTrackingUrl: string | null;
  returnLabel: string | null;
  returnProviderSnapshot: unknown;
};

type KargonomiReturnShopifyAutoSyncInput = {
  shopifyAdminService?: Pick<ReturnType<typeof createShopifyAdminService>, 'syncReturnShipping'>;
};

function isShopifyReturnSyncConfigured(env: AppEnv, input: KargonomiReturnShopifyAutoSyncInput) {
  return Boolean(input.shopifyAdminService || (env.SHOPIFY_SHOP_DOMAIN && env.SHOPIFY_ADMIN_ACCESS_TOKEN && env.SHOPIFY_API_VERSION));
}

async function persistKargonomiReturnAutoSyncSnapshot(
  returnId: string,
  existingSnapshot: Record<string, unknown>,
  patch: Record<string, unknown>,
) {
  await prisma.returnRecord.update({
    where: { id: returnId },
    data: {
      returnProviderSnapshot: {
        ...existingSnapshot,
        ...patch,
      } as Prisma.InputJsonValue,
    },
  });
}

async function autoSyncKargonomiReturnToShopify(
  record: KargonomiReturnShopifyAutoSyncRecord,
  env: AppEnv,
  input: KargonomiReturnShopifyAutoSyncInput = {},
) {
  const existingSnapshot = readSnapshot(record.returnProviderSnapshot) ?? {};
  const attemptedAt = new Date().toISOString();
  const baseAutoSnapshot = {
    shopifyReturnAutoSyncAttempted: true,
    shopifyReturnAutoSyncSucceeded: false,
    shopifyReturnAutoSyncAttemptedAt: attemptedAt,
    shopifyReturnTrackingSynced: false,
    shopifyReturnLabelSynced: false,
    returnTrackingPresent: Boolean(record.returnTrackingNumber?.trim()),
    returnLabelPresent: Boolean(record.returnLabel?.trim()),
    labelUploadAttempted: false,
    labelUploadSucceeded: false,
    labelUploadSkippedReason: null,
  };
  const skip = async (reason: string, extra: Record<string, unknown> = {}) => {
    await persistKargonomiReturnAutoSyncSnapshot(record.id, existingSnapshot, {
      ...baseAutoSnapshot,
      shopifyReturnAutoSyncSkippedReason: reason,
      shopifyReturnSyncSkippedReason: reason,
      ...extra,
    });
  };

  if (record.returnProvider?.toLowerCase() !== 'kargonomi') {
    await skip('provider_not_kargonomi');
    return;
  }

  if (!record.returnProviderShipmentId?.trim()) {
    await skip('provider_shipment_id_missing');
    return;
  }

  const trackingNumber = record.returnTrackingNumber?.trim();
  if (!trackingNumber) {
    await skip('tracking_missing');
    return;
  }

  if (!record.returnLabel?.trim()) {
    await skip('label_missing');
    return;
  }

  const returnGid = toShopifyReturnGid(record.sourceShopifyReturnGid ?? record.sourceShopifyReturnId);
  if (!returnGid) {
    await skip('shopify_return_id_missing', { shopifyReturnIdPresent: false });
    return;
  }

  const sourceLineItemId = record.sourceShopifyLineItemId?.trim();
  if (!sourceLineItemId) {
    await skip('source_line_item_missing', { shopifyReturnSourceLineItemIdPresent: false });
    return;
  }

  if (!isShopifyReturnSyncConfigured(env, input)) {
    await skip('shopify_not_configured', {
      shopifyReturnIdPresent: true,
      shopifyReturnSourceLineItemIdPresent: true,
    });
    return;
  }

  await persistKargonomiReturnAutoSyncSnapshot(record.id, existingSnapshot, {
    ...baseAutoSnapshot,
    shopifyReturnAutoSyncSkippedReason: null,
    shopifyReturnSyncSkippedReason: null,
    shopifyReturnIdPresent: true,
    shopifyReturnSourceLineItemIdPresent: true,
  });

  try {
    const shopifyAdminService = input.shopifyAdminService ?? createShopifyAdminService(env);
    const result = await shopifyAdminService.syncReturnShipping({
      returnGid,
      sourceLineItemId,
      trackingNumber,
      trackingUrl: record.returnTrackingUrl,
      labelUrl: record.returnLabel,
      notifyCustomer: true,
    });
    const sanitizedUserErrors = sanitizeShopifyUserErrors(result.userErrors);
    const syncSucceeded = result.trackingAccepted && result.labelAccepted && sanitizedUserErrors.length === 0;

    await persistKargonomiReturnAutoSyncSnapshot(record.id, existingSnapshot, {
      ...baseAutoSnapshot,
      shopifyReturnAutoSyncSucceeded: syncSucceeded,
      shopifyReturnAutoSyncSkippedReason: syncSucceeded ? null : 'shopify_sync_not_fully_accepted',
      shopifyReturnSyncAttempted: true,
      shopifyReturnSyncSucceeded: syncSucceeded,
      shopifyReturnTrackingSynced: result.trackingAccepted,
      shopifyReturnLabelSynced: result.labelAccepted,
      shopifyReturnSyncSkippedReason: syncSucceeded ? null : 'shopify_sync_not_fully_accepted',
      shopifyReverseDeliveryId: result.reverseDeliveryId,
      shopifyReverseFulfillmentOrderId: result.reverseFulfillmentOrderId,
      shopifyReturnSyncUserErrors: sanitizedUserErrors,
      labelUploadAttempted: result.labelUploadAttempted,
      labelUploadSucceeded: result.labelUploadSucceeded,
      labelUploadSkippedReason: result.labelUploadSkippedReason,
      labelUploadSource: result.labelUploadSource,
      labelInputSent: result.labelInputSent,
      shopifyReturnSyncMutationUsed: result.mutationUsed,
      shopifyReturnAutoSyncCompletedAt: new Date().toISOString(),
    });
  } catch (error) {
    const safeErrorMessage =
      sanitizeShopifyReturnSyncMessage(error instanceof Error ? error.message : 'Unknown Shopify return sync error.') ??
      'Unknown Shopify return sync error.';
    await persistKargonomiReturnAutoSyncSnapshot(record.id, existingSnapshot, {
      ...baseAutoSnapshot,
      shopifyReturnAutoSyncSucceeded: false,
      shopifyReturnAutoSyncSkippedReason: 'shopify_sync_failed',
      shopifyReturnAutoSyncErrorMessage: safeErrorMessage,
      shopifyReturnSyncAttempted: true,
      shopifyReturnSyncSucceeded: false,
      shopifyReturnTrackingSynced: false,
      shopifyReturnLabelSynced: false,
      shopifyReturnSyncSkippedReason: 'shopify_sync_failed',
      shopifyReturnSyncErrorMessage: safeErrorMessage,
      shopifyReturnSyncFailedAt: new Date().toISOString(),
    });
  }
}

export async function createKargonomiReturnShipmentForReturn(
  returnId: string,
  actor: ReturnActorScope,
  env: AppEnv,
  input: KargonomiReturnShipmentCreateInput = {},
): Promise<ReturnDetailDto> {
  const record = await prisma.returnRecord.findUnique({
    where: { id: returnId },
    include: {
      vendorAllocation: {
        include: {
          order: true,
          lineItems: {
            include: {
              shopifyOrderLineItem: true,
            },
          },
        },
      },
    },
  });

  if (!record || !canActOnReturn(record, actor)) {
    throw new ReturnReviewError('Return record not found.', 404);
  }

  if (actor.role !== 'admin') {
    throw new ReturnReviewError('Admin access required for Kargonomi return shipment creation.', 403);
  }

  if (record.returnProviderShipmentId) {
    throw new ReturnReviewError('Return shipment already exists for this return.', 400);
  }

  if (isReturnClosedOrCancelled(record)) {
    throw new ReturnReviewError('Closed or cancelled returns cannot create Kargonomi return shipments.', 400);
  }

  const preview = await previewKargonomiReturnShipmentForReturn(returnId, actor, {
    env,
    kargonomiDestinationClient: input.kargonomiDestinationClient,
    senderTaxNumber: input.senderTaxNumber,
  });
  if (!preview.ready) {
    throw new ReturnReviewError(
      buildKargonomiReturnReadinessMessage(preview.missingFields),
      400,
      buildKargonomiReturnCreateReadinessDetails(preview),
    );
  }

  const config = await prisma.vendorShippingConfig.findUnique({
    where: { vendorId: record.vendorAllocation.assignedVendorId },
    include: {
      warehouses: true,
    },
  });
  const built = buildKargonomiReturnShipmentPayload({
    record,
    config,
    resolvedSenderDestination: readKargonomiReturnPreviewSenderDestination(preview),
    senderTaxNumber: input.senderTaxNumber,
    env,
  });
  if (built.missingFields.length > 0) {
    throw new ReturnReviewError(
      buildKargonomiReturnReadinessMessage(built.missingFields),
      400,
      buildKargonomiReturnCreateReadinessDetails(preview, built.missingFields),
    );
  }

  const attemptedAt = new Date().toISOString();
  const readinessDetails = buildKargonomiReturnCreateReadinessDetails(preview, built.missingFields);
  const diagnostics = {
    provider: 'kargonomi',
    flow: 'return_shipment',
    direction: 'CUSTOMER_TO_VENDOR',
    kargonomiReturnShipmentAttempted: true,
    kargonomiReturnShipmentSucceeded: false,
    kargonomiReturnMissingFields: built.missingFields,
    warehouseId: built.warehouseId,
    senderDestinationResolution: readinessDetails.senderDestinationResolution,
    senderStateIdPresent: Boolean(built.senderStateId),
    senderCityIdPresent: Boolean(built.senderCityId),
    senderPhoneValid: built.senderPhoneValid,
    senderTaxNumberPresent: built.senderTaxNumberPresent,
    senderTaxNumberSource: built.senderTaxNumberSource,
    buyerNameValid: built.buyerNameValid,
    receiverNamePresent: built.receiverNamePresent,
    receiverNameValid: built.buyerNameValid,
    receiverNameSource: built.receiverNameSource,
    receiverAddressPresent: built.receiverAddressPresent,
    receiverAddressSource: built.receiverAddressSource,
    receiverStateIdPresent: Boolean(built.receiverStateId),
    receiverCityIdPresent: Boolean(built.receiverCityId),
    attemptedAt,
    shopifyReturnSyncSkippedReason: 'not_implemented',
    shopifyReturnTrackingSyncSkippedReason: 'not_implemented',
  };

  try {
    const adapter = input.adapter ?? createShippingProviderAdapter(env, 'kargonomi');
    const result = await adapter.createShipment({
      allocationId: record.vendorAllocationId,
      vendorId: record.vendorAllocation.assignedVendorId,
      provider: 'kargonomi',
      requestSnapshot: {
        ...built.payload,
        reference: {
          return_id: record.id,
          allocation_id: record.vendorAllocationId,
          shopify_order_number: record.sourceShopifyOrderNumber,
          vendor_id: record.vendorAllocation.assignedVendorId,
        },
      } as unknown as Record<string, unknown>,
    });
    const providerSnapshot = {
      ...diagnostics,
      kargonomiReturnShipmentSucceeded: Boolean(result.providerShipmentId),
      returnProviderIdPresent: Boolean(result.providerShipmentId),
      returnTrackingPresent: Boolean(result.trackingNumber || result.trackingUrl),
      returnLabelPresent: Boolean(result.labelUrl),
      returnStatus: result.shipmentStatus,
      carrierName: readString(result.responseSnapshot, ['shippingProviderName']) ?? null,
      responseKeys: Object.keys(result.responseSnapshot),
      rawResponseSummary: result.responseSnapshot,
    };
    await prisma.returnRecord.update({
      where: { id: returnId },
      data: {
        returnProvider: 'kargonomi',
        returnProviderShipmentId: result.providerShipmentId,
        returnTrackingNumber: result.trackingNumber,
        returnTrackingUrl: result.trackingUrl,
        returnLabel: result.labelUrl,
        returnCarrierName: readString(result.responseSnapshot, ['shippingProviderName']) ?? 'Kargonomi',
        returnReferenceId: built.referenceId,
        returnProviderSnapshot: providerSnapshot as Prisma.InputJsonValue,
      },
    });
    try {
      await autoSyncKargonomiReturnToShopify(
        {
          id: returnId,
          sourceShopifyReturnId: record.sourceShopifyReturnId,
          sourceShopifyReturnGid: record.sourceShopifyReturnGid,
          sourceShopifyLineItemId: record.sourceShopifyLineItemId,
          returnProvider: 'kargonomi',
          returnProviderShipmentId: result.providerShipmentId,
          returnTrackingNumber: result.trackingNumber,
          returnTrackingUrl: result.trackingUrl,
          returnLabel: result.labelUrl,
          returnProviderSnapshot: providerSnapshot,
        },
        env,
        { shopifyAdminService: input.shopifyAdminService },
      );
    } catch {
      // Auto-sync diagnostics must never roll back a successfully persisted Kargonomi return shipment.
    }
  } catch (error) {
    if (error instanceof ShippingProviderExecutionError) {
      await prisma.returnRecord.update({
        where: { id: returnId },
        data: {
          returnProviderSnapshot: {
            ...diagnostics,
            kargonomiReturnShipmentSucceeded: false,
            providerMessage: readString(error.responseSnapshot, ['providerErrorMessage', 'providerError', 'error', 'message']),
            httpStatus: readNumber(error.responseSnapshot, ['httpStatus']),
            responseKeys: Object.keys(error.responseSnapshot),
            rawResponseSummary: error.responseSnapshot,
          } as Prisma.InputJsonValue,
        },
      });
      throw new ReturnReviewError(error.message, 400);
    }
    throw new ReturnReviewError(error instanceof Error ? error.message : 'Kargonomi return shipment could not be created.', 400);
  }

  const updated = await getVendorReturnById(record.vendorAllocation.assignedVendorId, returnId);
  if (!updated) {
    throw new ReturnReviewError('Return record not found.', 404);
  }
  return updated;
}

function hasReturnProviderDuplicateEvidence(record: {
  returnProviderShipmentId: string | null;
  returnTrackingNumber: string | null;
  returnLabel: string | null;
}) {
  return Boolean(record.returnProviderShipmentId || record.returnTrackingNumber || record.returnLabel);
}

async function persistKargonomiReturnAutoCreateDiagnostic(
  returnId: string,
  existingSnapshot: unknown,
  input: {
    attempted: boolean;
    status: 'not_applicable' | 'skipped' | 'needs_attention' | 'failed';
    skippedReason?: string | null;
    missingFields?: string[];
    details?: Record<string, unknown>;
  },
) {
  await prisma.returnRecord.update({
    where: { id: returnId },
    data: {
      returnProviderSnapshot: {
        ...(readSnapshot(existingSnapshot) ?? {}),
        provider: 'kargonomi',
        flow: 'return_shipment',
        direction: 'CUSTOMER_TO_VENDOR',
        kargonomiReturnAutoCreateAttempted: input.attempted,
        kargonomiReturnAutoCreateStatus: input.status,
        kargonomiReturnAutoCreateSkippedReason: input.skippedReason ?? null,
        kargonomiReturnShipmentAttempted: false,
        kargonomiReturnShipmentSucceeded: false,
        kargonomiReturnMissingFields: input.missingFields ?? [],
        ...(input.details ?? {}),
        attemptedAt: new Date().toISOString(),
      } as Prisma.InputJsonValue,
    },
  });
}

export async function autoCreateKargonomiReturnShipmentForApprovedReturn(
  returnId: string,
  env: AppEnv,
  input: KargonomiReturnShipmentCreateInput = {},
) {
  const record = await prisma.returnRecord.findUnique({
    where: { id: returnId },
    include: {
      vendorAllocation: true,
    },
  });

  if (!record) {
    return { attempted: false, skippedReason: 'return_record_not_found' };
  }

  const normalizedStatus = (record.returnLifecycleStatus || record.status || '').toLowerCase();
  if (normalizedStatus !== 'approved') {
    return { attempted: false, skippedReason: 'return_not_approved' };
  }

  if (hasReturnProviderDuplicateEvidence(record)) {
    await persistKargonomiReturnAutoCreateDiagnostic(returnId, record.returnProviderSnapshot, {
      attempted: false,
      status: 'skipped',
      skippedReason: 'return_provider_evidence_exists',
      details: {
        returnProviderShipmentIdPresent: Boolean(record.returnProviderShipmentId),
        returnTrackingNumberPresent: Boolean(record.returnTrackingNumber),
        returnLabelPresent: Boolean(record.returnLabel),
      },
    });
    return { attempted: false, skippedReason: 'return_provider_evidence_exists' };
  }

  const config = await getVendorShippingConfigForReturn(record.vendorAllocation.assignedVendorId);
  if (config.preferredProvider !== 'kargonomi') {
    await persistKargonomiReturnAutoCreateDiagnostic(returnId, record.returnProviderSnapshot, {
      attempted: false,
      status: 'not_applicable',
      skippedReason: 'provider_not_kargonomi',
      details: {
        preferredProvider: config.preferredProvider,
        shippingEnabled: config.shippingEnabled,
      },
    });
    return { attempted: false, skippedReason: 'provider_not_kargonomi' };
  }

  if (!config.shippingEnabled) {
    await persistKargonomiReturnAutoCreateDiagnostic(returnId, record.returnProviderSnapshot, {
      attempted: false,
      status: 'not_applicable',
      skippedReason: 'shipping_disabled',
      details: {
        preferredProvider: config.preferredProvider,
        shippingEnabled: config.shippingEnabled,
      },
    });
    return { attempted: false, skippedReason: 'shipping_disabled' };
  }

  const actor: ReturnActorScope = { role: 'admin', vendorId: null };
  const preview = await previewKargonomiReturnShipmentForReturn(returnId, actor, {
    env,
    kargonomiDestinationClient: input.kargonomiDestinationClient,
    senderTaxNumber: input.senderTaxNumber,
  });
  if (!preview.ready) {
    await persistKargonomiReturnAutoCreateDiagnostic(returnId, record.returnProviderSnapshot, {
      attempted: true,
      status: 'needs_attention',
      skippedReason: 'missing_required_fields',
      missingFields: preview.missingFields,
      details: buildKargonomiReturnCreateReadinessDetails(preview),
    });
    return { attempted: false, skippedReason: 'missing_required_fields', missingFields: preview.missingFields };
  }

  try {
    await createKargonomiReturnShipmentForReturn(returnId, actor, env, input);
    return { attempted: true, skippedReason: null };
  } catch (error) {
    if (!(error instanceof ReturnReviewError)) {
      await persistKargonomiReturnAutoCreateDiagnostic(returnId, record.returnProviderSnapshot, {
        attempted: true,
        status: 'failed',
        skippedReason: 'provider_create_failed',
        details: {
          errorMessage: error instanceof Error ? error.message : 'Kargonomi return shipment auto-create failed.',
        },
      });
    }
    return { attempted: true, skippedReason: 'provider_create_failed' };
  }
}

function isReturnCancelledOrDeleted(record: { status: string; returnLifecycleStatus: string | null }) {
  const normalized = `${record.status ?? ''} ${record.returnLifecycleStatus ?? ''}`.toLowerCase();
  return /\b(cancelled|canceled|deleted)\b/.test(normalized);
}

export async function refreshKargonomiReturnProviderData(
  returnId: string,
  actor: ReturnActorScope,
  env: AppEnv,
  input: KargonomiReturnProviderDataRefreshInput = {},
): Promise<ReturnDetailDto> {
  const record = await prisma.returnRecord.findUnique({
    where: { id: returnId },
    include: {
      vendorAllocation: true,
    },
  });

  if (!record || !canActOnReturn(record, actor)) {
    throw new ReturnReviewError('Return record not found.', 404);
  }

  if (isReturnCancelledOrDeleted(record)) {
    throw new ReturnReviewError('Cancelled or deleted returns cannot refresh Kargonomi provider data.', 400);
  }

  if (record.returnProvider?.toLowerCase() !== 'kargonomi') {
    throw new ReturnReviewError('Kargonomi return provider data refresh requires a Kargonomi return shipment.', 400);
  }

  const providerShipmentId = record.returnProviderShipmentId?.trim();
  if (!providerShipmentId) {
    throw new ReturnReviewError('Kargonomi return provider data refresh requires a stored provider shipment id.', 400);
  }

  const existingSnapshot = readSnapshot(record.returnProviderSnapshot) ?? {};
  const attemptedAt = new Date().toISOString();
  const attemptSnapshot = {
    ...existingSnapshot,
    provider: 'kargonomi',
    flow: 'return_provider_data_refresh',
    direction: 'CUSTOMER_TO_VENDOR',
    kargonomiReturnProviderDataRefreshAttempted: true,
    kargonomiReturnProviderDataRefreshSucceeded: false,
    kargonomiReturnProviderDataRefreshEndpointUsed: '/returns/:returnId/kargonomi-refresh-provider-data',
    refreshedReturnProviderShipmentId: providerShipmentId,
    createShipmentCalled: false,
    createShipmentDraftCalled: false,
    priceComparisonCalled: false,
    confirmShippingPriceCalled: false,
    getShipmentCalled: false,
    barcodeFetchCalled: false,
    lastProviderStage: 'provider_data_refresh',
    attemptedAt,
  };

  await prisma.returnRecord.update({
    where: { id: returnId },
    data: {
      returnProviderSnapshot: attemptSnapshot as Prisma.InputJsonValue,
    },
  });

  const adapter = input.adapter ?? createShippingProviderAdapter(env, 'kargonomi');
  if (!adapter.refreshProviderData) {
    throw new ReturnReviewError('Kargonomi return provider data refresh is not available.', 400);
  }

  try {
    const result = await adapter.refreshProviderData(providerShipmentId);
    const carrier =
      readString(result.responseSnapshot, ['shippingProviderName', 'carrierName', 'providerName']) ??
      record.returnCarrierName ??
      'Kargonomi';
    const trackingNumber = result.trackingNumber ?? record.returnTrackingNumber;
    const trackingUrl = result.trackingUrl ?? record.returnTrackingUrl;
    const labelUrl = result.labelUrl ?? record.returnLabel;
    const kargonomiReturnCancelled = result.shipmentStatus === 'cancelled';
    const mergedSnapshot = {
      ...attemptSnapshot,
      ...result.responseSnapshot,
      provider: 'kargonomi',
      flow: 'return_provider_data_refresh',
      direction: 'CUSTOMER_TO_VENDOR',
      kargonomiReturnProviderDataRefreshAttempted: true,
      kargonomiReturnProviderDataRefreshSucceeded: true,
      kargonomiReturnProviderDataRefreshEndpointUsed: '/returns/:returnId/kargonomi-refresh-provider-data',
      refreshedReturnProviderShipmentId: providerShipmentId,
      createShipmentCalled: false,
      createShipmentDraftCalled: false,
      priceComparisonCalled: false,
      confirmShippingPriceCalled: false,
      returnProviderIdPresent: Boolean(result.providerShipmentId ?? providerShipmentId),
      returnTrackingPresent: Boolean(trackingNumber || trackingUrl),
      returnLabelPresent: Boolean(labelUrl),
      returnStatus: result.shipmentStatus,
      kargonomiReturnCancelled,
      providerStatus: readString(result.responseSnapshot, ['providerStatus', 'status']),
      providerStatusLabel: readString(result.responseSnapshot, ['providerStatusLabel', 'statusLabel']),
      ...(kargonomiReturnCancelled
        ? {
            shopifyReturnAutoSyncAttempted: false,
            shopifyReturnAutoSyncSucceeded: false,
            shopifyReturnAutoSyncSkippedReason: 'kargonomi_return_cancelled',
          }
        : {}),
      carrierName: carrier,
      persistedReturnTrackingPresent: Boolean(trackingNumber),
      persistedReturnTrackingUrlPresent: Boolean(trackingUrl),
      persistedReturnLabelPresent: Boolean(labelUrl),
      responseKeys: Object.keys(result.responseSnapshot),
      rawResponseSummary: result.responseSnapshot,
    };

    await prisma.returnRecord.update({
      where: { id: returnId },
      data: {
        returnProviderShipmentId: result.providerShipmentId ?? providerShipmentId,
        returnCarrierName: carrier,
        returnTrackingNumber: trackingNumber,
        returnTrackingUrl: trackingUrl,
        returnLabel: labelUrl,
        returnProviderSnapshot: mergedSnapshot as Prisma.InputJsonValue,
      },
    });
    if (!kargonomiReturnCancelled) {
      try {
        await autoSyncKargonomiReturnToShopify(
          {
            id: returnId,
            sourceShopifyReturnId: record.sourceShopifyReturnId,
            sourceShopifyReturnGid: record.sourceShopifyReturnGid,
            sourceShopifyLineItemId: record.sourceShopifyLineItemId,
            returnProvider: record.returnProvider,
            returnProviderShipmentId: result.providerShipmentId ?? providerShipmentId,
            returnTrackingNumber: trackingNumber,
            returnTrackingUrl: trackingUrl,
            returnLabel: labelUrl,
            returnProviderSnapshot: mergedSnapshot,
          },
          env,
          { shopifyAdminService: input.shopifyAdminService },
        );
      } catch {
        // Auto-sync diagnostics must never roll back a successfully refreshed Kargonomi return shipment.
      }
    }
  } catch (error) {
    const providerSnapshot = error instanceof ShippingProviderExecutionError
      ? error.responseSnapshot
      : {
          providerError: error instanceof Error ? error.message : 'Unknown Kargonomi return provider data refresh error.',
        };
    await prisma.returnRecord.update({
      where: { id: returnId },
      data: {
        returnProviderSnapshot: {
          ...attemptSnapshot,
          ...providerSnapshot,
          kargonomiReturnProviderDataRefreshAttempted: true,
          kargonomiReturnProviderDataRefreshSucceeded: false,
          providerMessage: readString(providerSnapshot, ['providerErrorMessage', 'providerError', 'error', 'message']),
          httpStatus: readNumber(providerSnapshot, ['httpStatus']),
          responseKeys: Object.keys(providerSnapshot),
          rawResponseSummary: providerSnapshot,
        } as Prisma.InputJsonValue,
      },
    });
    throw new ReturnReviewError(
      error instanceof Error ? error.message : 'Kargonomi return provider data refresh failed.',
      400,
    );
  }

  const updated = await getVendorReturnById(record.vendorAllocation.assignedVendorId, returnId);
  if (!updated) {
    throw new ReturnReviewError('Return record not found.', 404);
  }
  return updated;
}

export async function syncKargonomiReturnToShopify(
  returnId: string,
  actor: ReturnActorScope,
  env: AppEnv,
  input: ShopifyReturnSyncInput = {},
): Promise<ReturnDetailDto> {
  const record = await prisma.returnRecord.findUnique({
    where: { id: returnId },
    include: {
      vendorAllocation: true,
    },
  });

  if (!record || !canActOnReturn(record, actor)) {
    throw new ReturnReviewError('Return record not found.', 404);
  }

  if (actor.role !== 'admin') {
    throw new ReturnReviewError('Admin access required for Shopify return sync.', 403);
  }

  if (isReturnCancelledOrDeleted(record)) {
    throw new ReturnReviewError('Cancelled or deleted returns cannot sync to Shopify.', 400);
  }

  if (record.returnProvider?.toLowerCase() !== 'kargonomi') {
    throw new ReturnReviewError('Shopify return sync currently supports Kargonomi return shipments only.', 400);
  }

  if (!record.returnProviderShipmentId?.trim()) {
    throw new ReturnReviewError('Shopify return sync requires a Kargonomi return shipment id.', 400);
  }

  const trackingNumber = record.returnTrackingNumber?.trim();
  if (!trackingNumber) {
    throw new ReturnReviewError('Shopify return sync requires a return tracking number.', 400, {
      shopifyReturnSyncSkippedReason: 'tracking_missing',
    });
  }

  const returnGid = toShopifyReturnGid(record.sourceShopifyReturnGid ?? record.sourceShopifyReturnId);
  if (!returnGid) {
    throw new ReturnReviewError('Shopify return sync requires a Shopify return id.', 400, {
      shopifyReturnSyncSkippedReason: 'shopify_return_id_missing',
    });
  }

  const sourceLineItemId = record.sourceShopifyLineItemId?.trim();
  if (!sourceLineItemId) {
    throw new ReturnReviewError('Shopify return sync requires a Shopify source line item id.', 400, {
      shopifyReturnSyncSkippedReason: 'source_line_item_missing',
    });
  }

  const existingSnapshot = readSnapshot(record.returnProviderSnapshot) ?? {};
  const attemptedAt = new Date().toISOString();
  const attemptSnapshot = {
    ...existingSnapshot,
    provider: 'kargonomi',
    flow: 'return_shopify_sync',
    shopifyReturnSyncAttempted: true,
    shopifyReturnSyncSucceeded: false,
    shopifyReturnTrackingSynced: false,
    shopifyReturnLabelSynced: false,
    shopifyReturnSyncSkippedReason: null,
    shopifyReturnSyncAttemptedAt: attemptedAt,
    shopifyReturnIdPresent: true,
    shopifyReturnSourceLineItemIdPresent: true,
    returnTrackingPresent: true,
    returnLabelPresent: Boolean(record.returnLabel?.trim()),
    labelUploadAttempted: false,
    labelUploadSucceeded: false,
    labelUploadSkippedReason: null,
  };

  await prisma.returnRecord.update({
    where: { id: returnId },
    data: {
      returnProviderSnapshot: attemptSnapshot as Prisma.InputJsonValue,
    },
  });

  try {
    const shopifyAdminService = input.shopifyAdminService ?? createShopifyAdminService(env);
    const result = await shopifyAdminService.syncReturnShipping({
      returnGid,
      sourceLineItemId,
      trackingNumber,
      trackingUrl: record.returnTrackingUrl,
      labelUrl: record.returnLabel,
      notifyCustomer: true,
    });

    const sanitizedUserErrors = sanitizeShopifyUserErrors(result.userErrors);
    const successSnapshot = {
      ...attemptSnapshot,
      shopifyReturnSyncSucceeded: result.trackingAccepted && sanitizedUserErrors.length === 0,
      shopifyReturnTrackingSynced: result.trackingAccepted,
      shopifyReturnLabelSynced: result.labelAccepted,
      shopifyReturnSyncSkippedReason: result.trackingAccepted ? null : 'tracking_not_accepted',
      shopifyReverseDeliveryId: result.reverseDeliveryId,
      shopifyReverseFulfillmentOrderId: result.reverseFulfillmentOrderId,
      shopifyReturnSyncUserErrors: sanitizedUserErrors,
      labelUploadAttempted: result.labelUploadAttempted,
      labelUploadSucceeded: result.labelUploadSucceeded,
      labelUploadSkippedReason: result.labelUploadSkippedReason,
      labelUploadSource: result.labelUploadSource,
      labelInputSent: result.labelInputSent,
      shopifyReturnSyncMutationUsed: result.mutationUsed,
      shopifyReturnSyncCompletedAt: new Date().toISOString(),
    };

    await prisma.returnRecord.update({
      where: { id: returnId },
      data: {
        returnProviderSnapshot: successSnapshot as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    const safeErrorMessage =
      sanitizeShopifyReturnSyncMessage(error instanceof Error ? error.message : 'Unknown Shopify return sync error.') ??
      'Unknown Shopify return sync error.';
    const failedSnapshot = {
      ...attemptSnapshot,
      shopifyReturnSyncSucceeded: false,
      shopifyReturnTrackingSynced: false,
      shopifyReturnLabelSynced: false,
      shopifyReturnSyncSkippedReason: 'shopify_sync_failed',
      shopifyReturnSyncErrorMessage: safeErrorMessage,
      shopifyReturnSyncFailedAt: new Date().toISOString(),
    };
    await prisma.returnRecord.update({
      where: { id: returnId },
      data: {
        returnProviderSnapshot: failedSnapshot as Prisma.InputJsonValue,
      },
    });
    throw new ReturnReviewError(
      safeErrorMessage,
      400,
      {
        shopifyReturnSyncSkippedReason: 'shopify_sync_failed',
      },
    );
  }

  const updated = await getVendorReturnById(record.vendorAllocation.assignedVendorId, returnId);
  if (!updated) {
    throw new ReturnReviewError('Return record not found.', 404);
  }
  return updated;
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
      shipmentExecutions?: NavlungoForwardShipmentExecutionContext[];
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
  const returnRecipientAddress = resolveNavlungoReturnRecipientAddressId({
    shipmentExecutions: input.record.vendorAllocation.shipmentExecutions,
    config: input.config,
    env: input.env,
  });
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
    navlungoReturnOriginalSenderMode: returnRecipientAddress.originalForwardSenderMode,
    navlungoReturnOriginalPayloadSenderAddressIdPresent: returnRecipientAddress.originalPayloadSenderAddressIdPresent,
    navlungoReturnOriginalPayloadSenderAddressId: returnRecipientAddress.originalPayloadSenderAddressId,
    navlungoReturnOriginalWarehouseAddressIdPresent: returnRecipientAddress.originalForwardWarehouseAddressIdPresent,
    navlungoReturnOriginalWarehouseAddressId: returnRecipientAddress.originalForwardWarehouseAddressId,
    navlungoReturnOriginalForwardShipmentExecutionId: returnRecipientAddress.originalForwardShipmentExecutionId,
    navlungoReturnOriginalForwardProviderShipmentIdPresent:
      returnRecipientAddress.originalForwardProviderShipmentIdPresent,
    navlungoReturnResolvedRecipientAddressId: recipientAddressId ? String(recipientAddressId) : null,
    navlungoReturnResolvedRecipientAddressIdSource: returnRecipientAddress.source,
    navlungoReturnResolvedRecipientAddressIdNumeric: Boolean(recipientAddressId),
    navlungoReturnRecipientFallbackUsed: returnRecipientAddress.fallbackUsed,
    navlungoReturnRecipientConfiguredFallbackSource: returnRecipientAddress.configuredFallbackSource,
    navlungoReturnRecipientEqualsOriginalSenderAddressId:
      returnRecipientAddress.returnRecipientEqualsOriginalSenderAddressId,
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
          shipmentExecutions: {
            orderBy: { updatedAt: 'desc' },
          },
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
    input.carrierOverride === '9' ||
    input.carrierOverride === '10' ||
    input.carrierIdOverride === '9' ||
    input.carrierIdOverride === '10' ||
    input.endpointPathOverride === '/post/return' ||
    input.endpointPathOverride === '/post/create';
  if (diagnosticOverrideRequested && input.dryRun !== true && input.diagnosticConfirm !== 'YES') {
    throw new ReturnReviewError('Explicit confirmation is required for Navlungo return pickup diagnostic live create.', 400);
  }
  const carrierIdOverride = input.carrierIdOverride ?? input.carrierOverride;
  const requestBase = resolveNavlungoReturnPickupBaseUrl(env, input.endpointPathOverride);
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
    navlungoReturnOriginalSenderMode: built.navlungoReturnOriginalSenderMode,
    navlungoReturnOriginalPayloadSenderAddressIdPresent: built.navlungoReturnOriginalPayloadSenderAddressIdPresent,
    navlungoReturnOriginalPayloadSenderAddressId: built.navlungoReturnOriginalPayloadSenderAddressId,
    navlungoReturnOriginalWarehouseAddressIdPresent: built.navlungoReturnOriginalWarehouseAddressIdPresent,
    navlungoReturnOriginalWarehouseAddressId: built.navlungoReturnOriginalWarehouseAddressId,
    navlungoReturnOriginalForwardShipmentExecutionId: built.navlungoReturnOriginalForwardShipmentExecutionId,
    navlungoReturnOriginalForwardProviderShipmentIdPresent:
      built.navlungoReturnOriginalForwardProviderShipmentIdPresent,
    navlungoReturnResolvedRecipientAddressId: built.navlungoReturnResolvedRecipientAddressId,
    navlungoReturnResolvedRecipientAddressIdSource: built.navlungoReturnResolvedRecipientAddressIdSource,
    navlungoReturnResolvedRecipientAddressIdNumeric: built.navlungoReturnResolvedRecipientAddressIdNumeric,
    navlungoReturnRecipientFallbackUsed: built.navlungoReturnRecipientFallbackUsed,
    navlungoReturnRecipientConfiguredFallbackSource: built.navlungoReturnRecipientConfiguredFallbackSource,
    navlungoReturnRecipientEqualsOriginalSenderAddressId:
      built.navlungoReturnRecipientEqualsOriginalSenderAddressId,
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
          shipmentExecutions: {
            orderBy: { updatedAt: 'desc' },
          },
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
          navlungoReturnOriginalSenderMode: built.navlungoReturnOriginalSenderMode,
          navlungoReturnOriginalPayloadSenderAddressIdPresent: built.navlungoReturnOriginalPayloadSenderAddressIdPresent,
          navlungoReturnOriginalPayloadSenderAddressId: built.navlungoReturnOriginalPayloadSenderAddressId,
          navlungoReturnOriginalWarehouseAddressIdPresent: built.navlungoReturnOriginalWarehouseAddressIdPresent,
          navlungoReturnOriginalWarehouseAddressId: built.navlungoReturnOriginalWarehouseAddressId,
          navlungoReturnOriginalForwardShipmentExecutionId: built.navlungoReturnOriginalForwardShipmentExecutionId,
          navlungoReturnOriginalForwardProviderShipmentIdPresent:
            built.navlungoReturnOriginalForwardProviderShipmentIdPresent,
          navlungoReturnResolvedRecipientAddressId: built.navlungoReturnResolvedRecipientAddressId,
          navlungoReturnResolvedRecipientAddressIdSource: built.navlungoReturnResolvedRecipientAddressIdSource,
          navlungoReturnResolvedRecipientAddressIdNumeric: built.navlungoReturnResolvedRecipientAddressIdNumeric,
          navlungoReturnRecipientFallbackUsed: built.navlungoReturnRecipientFallbackUsed,
          navlungoReturnRecipientConfiguredFallbackSource: built.navlungoReturnRecipientConfiguredFallbackSource,
          navlungoReturnRecipientEqualsOriginalSenderAddressId:
            built.navlungoReturnRecipientEqualsOriginalSenderAddressId,
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
          shipmentExecutions: {
            orderBy: { updatedAt: 'desc' },
          },
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
        navlungoReturnOriginalSenderMode: built.navlungoReturnOriginalSenderMode,
        navlungoReturnOriginalPayloadSenderAddressIdPresent: built.navlungoReturnOriginalPayloadSenderAddressIdPresent,
        navlungoReturnOriginalPayloadSenderAddressId: built.navlungoReturnOriginalPayloadSenderAddressId,
        navlungoReturnOriginalWarehouseAddressIdPresent: built.navlungoReturnOriginalWarehouseAddressIdPresent,
        navlungoReturnOriginalWarehouseAddressId: built.navlungoReturnOriginalWarehouseAddressId,
        navlungoReturnOriginalForwardShipmentExecutionId: built.navlungoReturnOriginalForwardShipmentExecutionId,
        navlungoReturnOriginalForwardProviderShipmentIdPresent:
          built.navlungoReturnOriginalForwardProviderShipmentIdPresent,
        navlungoReturnResolvedRecipientAddressId: built.navlungoReturnResolvedRecipientAddressId,
        navlungoReturnResolvedRecipientAddressIdSource: built.navlungoReturnResolvedRecipientAddressIdSource,
        navlungoReturnResolvedRecipientAddressIdNumeric: built.navlungoReturnResolvedRecipientAddressIdNumeric,
        navlungoReturnRecipientFallbackUsed: built.navlungoReturnRecipientFallbackUsed,
        navlungoReturnRecipientConfiguredFallbackSource: built.navlungoReturnRecipientConfiguredFallbackSource,
        navlungoReturnRecipientEqualsOriginalSenderAddressId:
          built.navlungoReturnRecipientEqualsOriginalSenderAddressId,
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
