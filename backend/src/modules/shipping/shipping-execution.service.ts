import {
  Prisma,
  ShipmentExecutionStatus,
  ShippingProvider,
  type ShipmentExecution,
  type VendorShippingConfig,
  type VendorShippingWarehouse,
} from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import type { AppEnv } from '../../config/env.js';
import {
  createShippingProviderAdapter,
  ShippingProviderExecutionError,
  type ShippingProviderAdapter,
} from './shipping-provider.adapter.js';
import {
  KargonomiHttpClient,
  resolveKargonomiDestinationAddress,
  type KargonomiDestinationLookupClient,
} from './kargonomi-provider.adapter.js';
import { createShopifyAdminService } from '../shopify/shopify-admin.service.js';
import { mapShopifyShippingAddress } from '../shopify/order-ingestion.service.js';
import type { ShopifyOrdersCreateWebhookPayload } from '../shopify/order-ingestion.types.js';
import type { ProbeShopifyReturnLabelUploadResult } from '../shopify/shopify-admin.types.js';
import type {
  CreateShipmentExecutionDto,
  ShipmentExecutionPreviewDto,
  ShipmentExecutionDto,
  ShippingProviderGateDiagnosticsDto,
  ShippingProviderDto,
  VendorShippingConfigDto,
  VendorShippingConfigUpdateDto,
} from './shipping-execution.types.js';

const SHIPPING_VAT_PERCENT = 18;
const DUMMY_KARGO_CARRIER_ID = 'dummy';
const DEFAULT_KARGO_PACKAGE_TYPE = 'box';
const ALLOWED_KARGO_PACKAGE_TYPES = new Set(['box', 'document']);
const DEFAULT_TRY_OTO_PACKAGE_WEIGHT_KG = 1;
type StoredShippingConfig = VendorShippingConfig & {
  warehouses?: VendorShippingWarehouse[];
};

type TryOtoWebhookReceiveDiagnostics = {
  received: boolean;
  receivedAt: string | null;
  httpMethod: string | null;
  contentType: string | null;
  payloadKeys: string[];
  matchedShipment: boolean | null;
  matchStatus: 'matched' | 'unmatched' | 'disabled' | 'parse_error' | null;
  matchedByField: string | null;
  statusValue: string | null;
  statusMapped: boolean | null;
  mappedLocalStatus: string | null;
  parseError: string | null;
  signatureVerificationImplemented: false;
};

const TRY_OTO_WEBHOOK_SIGNATURE_WARNING = 'Try OTO webhook signature verification is unknown/not implemented.';

let lastTryOtoWebhookReceiveDiagnostics: TryOtoWebhookReceiveDiagnostics = {
  received: false,
  receivedAt: null,
  httpMethod: null,
  contentType: null,
  payloadKeys: [],
  matchedShipment: null,
  matchStatus: null,
  matchedByField: null,
  statusValue: null,
  statusMapped: null,
  mappedLocalStatus: null,
  parseError: null,
  signatureVerificationImplemented: false,
};

function updateTryOtoWebhookReceiveDiagnostics(update: Partial<TryOtoWebhookReceiveDiagnostics>) {
  lastTryOtoWebhookReceiveDiagnostics = {
    ...lastTryOtoWebhookReceiveDiagnostics,
    ...update,
  };
}

export function getTryOtoWebhookReceiveDiagnostics() {
  return lastTryOtoWebhookReceiveDiagnostics;
}

function toNumber(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function toAmountString(value: number) {
  return value.toFixed(2);
}

function toPositiveNumber(value: unknown, fallback: number) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function mapProvider(provider: ShippingProvider | string): ShippingProviderDto {
  return provider.trim().toLowerCase() as ShippingProviderDto;
}

function normalizeProvider(provider?: ShippingProviderDto): ShippingProvider {
  const normalized = (provider ?? 'hepsijet').trim().toLowerCase();
  if (normalized === 'hepsijet') {
    return ShippingProvider.HEPSIJET;
  }
  if (normalized === 'kargo_entegrator') {
    return ShippingProvider.KARGO_ENTEGRATOR;
  }
  if (normalized === 'try_oto') {
    return ShippingProvider.TRY_OTO;
  }
  if (normalized === 'kargonomi') {
    return ShippingProvider.KARGONOMI;
  }
  if (normalized === 'mng') {
    return ShippingProvider.MNG;
  }
  if (normalized === 'yurtici') {
    return ShippingProvider.YURTICI;
  }
  if (normalized === 'aras') {
    return ShippingProvider.ARAS;
  }

  throw new Error('Unsupported shipping provider.');
}

function mapStatus(status: ShipmentExecutionStatus | string): ShipmentExecutionDto['shipmentStatus'] {
  return status.trim().toLowerCase() as ShipmentExecutionDto['shipmentStatus'];
}

function mapWarehouse(warehouse: VendorShippingWarehouse): VendorShippingConfigDto['warehouses'][number] {
  return {
    id: warehouse.id,
    vendorId: warehouse.vendorId,
    provider: mapProvider(warehouse.provider),
    warehouseId: warehouse.warehouseId,
    name: warehouse.name,
    address: warehouse.address,
    isDefault: warehouse.isDefault,
  };
}

function mapShippingConfig(config: StoredShippingConfig | null, vendorId: string): VendorShippingConfigDto {
  if (!config) {
    return {
      vendorId,
      preferredProvider: 'hepsijet',
      shippingEnabled: true,
      defaultDesi: '3.00',
      cargoIntegrationId: null,
      defaultWarehouseId: null,
      shippingVatPercent: '18.00',
      warehouses: [],
      providerMetadata: null,
      source: 'default',
      updatedAt: null,
    };
  }

  return {
    vendorId: config.vendorId,
    preferredProvider: mapProvider(config.preferredProvider),
    shippingEnabled: config.shippingEnabled,
    defaultDesi: toAmountString(toNumber(config.defaultDesi)),
    cargoIntegrationId: config.cargoIntegrationId,
    defaultWarehouseId: config.defaultWarehouseId,
    shippingVatPercent: toAmountString(toNumber(config.shippingVatPercent)),
    warehouses: (config.warehouses ?? []).map(mapWarehouse),
    providerMetadata: config.providerMetadata,
    source: 'configured',
    updatedAt: config.updatedAt ? config.updatedAt.toISOString() : null,
  };
}

function readStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function readNumber(value: Record<string, unknown> | null, keys: string[]) {
  if (!value) {
    return null;
  }

  for (const key of keys) {
    const numeric = Number(value[key]);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }

  return null;
}

function readStringFieldArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => String(item ?? '').trim()).filter(Boolean);
}

function readShopifyUserErrors(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isRecord).map((error) => ({
    field: readStringFieldArray(error.field),
    message: readString(error, ['message']) ?? 'Unknown Shopify user error.',
  }));
}

function mapShopifyReturnLabelUploadProbe(returnShipment: Record<string, unknown>) {
  const probe = isRecord(returnShipment.shopifyReturnLabelUploadProbe) ? returnShipment.shopifyReturnLabelUploadProbe : null;
  if (!probe) {
    return null;
  }
  const skippedReason = readString(probe, ['skippedReason']);
  const isLegacyMissingLabelGate = skippedReason === 'missing_return_label_url';

  return {
    status: isLegacyMissingLabelGate ? 'tracking_only_ready' : readString(probe, ['status']) ?? 'not_started',
    attemptedAt: readString(probe, ['attemptedAt']),
    reverseFulfillmentOrderIdPresent: readBoolean(probe, ['reverseFulfillmentOrderIdPresent']),
    reverseLineItemIdsPresent: readBoolean(probe, ['reverseLineItemIdsPresent']),
    mutationUsed: readString(probe, ['mutationUsed']),
    shopifyUserErrors: readShopifyUserErrors(probe.shopifyUserErrors),
    reverseDeliveryIdPresent: readBoolean(probe, ['reverseDeliveryIdPresent']),
    shopifyReturnIdPresent: readBoolean(probe, ['shopifyReturnIdPresent']),
    trackingAccepted: readBoolean(probe, ['trackingAccepted']),
    labelAccepted: readBoolean(probe, ['labelAccepted']),
    returnedCarrierName: readString(probe, ['returnedCarrierName']),
    carrierNamePresent: readBoolean(probe, ['carrierNamePresent']),
    trackingOnlyMode: isLegacyMissingLabelGate || readBoolean(probe, ['trackingOnlyMode']),
    labelInputSent: readBoolean(probe, ['labelInputSent']),
    shopifyCallAttempted: readBoolean(probe, ['shopifyCallAttempted']),
    skippedReason: isLegacyMissingLabelGate ? 'return_label_url_missing_tracking_only' : skippedReason,
    errorMessage: isLegacyMissingLabelGate
      ? 'Return label URL missing; probing Shopify with tracking only.'
      : readString(probe, ['errorMessage']),
  };
}

function mapTryOtoReturnDiagnostics(returnShipment: Record<string, unknown>) {
  const diagnostics = isRecord(returnShipment.diagnostics) ? returnShipment.diagnostics : null;
  if (!diagnostics) {
    return null;
  }
  const normalizedReturnLabelUrl = readTryOtoReturnLabelUrl(returnShipment);
  const normalizedReturnLabelSource = readString(returnShipment, [
    'printReturnAWBURL',
    'printReturnAWBUrl',
    'printReturnAwbURL',
    'printReturnAwbUrl',
  ])
    ? 'returnShipment.printReturnAWBURL'
    : normalizedReturnLabelUrl
      ? 'returnShipment.labelUrl'
      : null;

  return {
    endpoint: readString(diagnostics, ['endpoint']),
    httpStatus: readNumber(diagnostics, ['httpStatus']),
    requestKeys: readStringArray(diagnostics.requestKeys),
    responseKeys: readStringArray(diagnostics.responseKeys),
    returnProviderIdPresent: readBoolean(diagnostics, ['returnProviderIdPresent']),
    returnTrackingPresent: readBoolean(diagnostics, ['returnTrackingPresent']),
    returnBarcodePresent: readBoolean(diagnostics, ['returnBarcodePresent']),
    returnStatus: readString(diagnostics, ['returnStatus']),
    returnCarrierName: readString(diagnostics, ['returnCarrierName']),
    labelFieldPresent: Boolean(normalizedReturnLabelUrl) || readBoolean(diagnostics, ['labelFieldPresent']),
    returnLabelSourceChecked: readString(diagnostics, ['returnLabelSourceChecked']) ?? normalizedReturnLabelSource,
    returnTrackingSourceChecked: readString(diagnostics, ['returnTrackingSourceChecked']),
    rawPrintReturnAwbUrlPresent: readBoolean(diagnostics, ['rawPrintReturnAwbUrlPresent']),
    normalizedReturnLabelUrlPresent: Boolean(normalizedReturnLabelUrl) || readBoolean(diagnostics, ['normalizedReturnLabelUrlPresent']),
    returnLabelPersistenceStage: readString(diagnostics, ['returnLabelPersistenceStage']),
    returnLabelOverwrittenByStaleSnapshot: readBoolean(diagnostics, ['returnLabelOverwrittenByStaleSnapshot']),
    providerMessage: readString(diagnostics, ['providerMessage']),
    returnSkippedReason: readString(diagnostics, ['returnSkippedReason', 'skippedReason']),
    forwardDeliveryOptionIdPresent: readBoolean(diagnostics, ['forwardDeliveryOptionIdPresent']),
    forwardDeliveryOptionIdSource: readString(diagnostics, ['forwardDeliveryOptionIdSource']),
    forwardDeliveryOptionPersistedAt: readString(diagnostics, ['forwardDeliveryOptionPersistedAt']),
    forwardDeliveryOptionRetainedAfterWebhook: readBoolean(diagnostics, ['forwardDeliveryOptionRetainedAfterWebhook']),
    forwardDeliveryOptionRetainedAfterStatusRefresh: readBoolean(diagnostics, ['forwardDeliveryOptionRetainedAfterStatusRefresh']),
    returnDeliveryOptionIdPresent: readBoolean(diagnostics, ['returnDeliveryOptionIdPresent']),
    returnDeliveryOptionIdSource: readString(diagnostics, ['returnDeliveryOptionIdSource']),
    pickupLocationCodePresent: readBoolean(diagnostics, ['pickupLocationCodePresent']),
    returnItemSkuPresent: readBoolean(diagnostics, ['returnItemSkuPresent']),
    returnItemQuantityPresent: readBoolean(diagnostics, ['returnItemQuantityPresent']),
    createReturnShipmentFinalized: readBoolean(diagnostics, ['createReturnShipmentFinalized']),
    returnDeliveryOptionLookupCalled: readBoolean(diagnostics, ['returnDeliveryOptionLookupCalled']),
    returnDeliveryOptionLookupImplemented: readBoolean(diagnostics, ['returnDeliveryOptionLookupImplemented']),
    returnPriceLookupCalled: readBoolean(diagnostics, ['returnPriceLookupCalled']),
    returnPriceLookupSuccess: readBoolean(diagnostics, ['returnPriceLookupSuccess']),
    returnPriceLookupOptionCount: readNumber(diagnostics, ['returnPriceLookupOptionCount']),
    selectedReturnPriceOptionIdPresent: readBoolean(diagnostics, ['selectedReturnPriceOptionIdPresent']),
    reverseCreateShipmentCalled: readBoolean(diagnostics, ['reverseCreateShipmentCalled']),
    reverseCreateShipmentSuccess: readBoolean(diagnostics, ['reverseCreateShipmentSuccess']),
    reverseCreateShipmentResponseKeys: readStringArray(diagnostics.reverseCreateShipmentResponseKeys),
    reverseCreateShipmentTrackingPresent: readBoolean(diagnostics, ['reverseCreateShipmentTrackingPresent']),
    reverseCreateShipmentBarcodePresent: readBoolean(diagnostics, ['reverseCreateShipmentBarcodePresent']),
    reverseCreateShipmentLabelPresent: readBoolean(diagnostics, ['reverseCreateShipmentLabelPresent']),
    returnFinalized: readBoolean(diagnostics, ['returnFinalized']),
    returnFinalizationEndpointConfirmed: readBoolean(diagnostics, ['returnFinalizationEndpointConfirmed']),
    returnFinalizeEndpointImplemented: readBoolean(diagnostics, ['returnFinalizeEndpointImplemented']),
    returnLabelRetrievable: Boolean(normalizedReturnLabelUrl) || readBoolean(diagnostics, ['returnLabelRetrievable']),
    providerStatusSource: readString(diagnostics, ['providerStatusSource']),
  };
}

function mapTryOtoReturnDetailsProbe(returnShipment: Record<string, unknown>) {
  const probe = isRecord(returnShipment.detailsProbe) ? returnShipment.detailsProbe : null;
  if (!probe) {
    return null;
  }

  return {
    status: readString(probe, ['status']) ?? 'not_started',
    attemptedAt: readString(probe, ['attemptedAt']),
    endpoint: readString(probe, ['endpoint']),
    httpStatus: readNumber(probe, ['httpStatus']),
    responseKeys: readStringArray(probe.responseKeys),
    nestedKeys: readStringArray(probe.nestedKeys),
    labelLikeFieldsPresent: readBoolean(probe, ['labelLikeFieldsPresent']),
    awbLikeFieldsPresent: readBoolean(probe, ['awbLikeFieldsPresent']),
    pdfLikeFieldsPresent: readBoolean(probe, ['pdfLikeFieldsPresent']),
    urlLikeFieldsPresent: readBoolean(probe, ['urlLikeFieldsPresent']),
    trackingPresent: readBoolean(probe, ['trackingPresent']),
    barcodePresent: readBoolean(probe, ['barcodePresent']),
    providerStatus: readString(probe, ['providerStatus']),
    labelUrlPresent: readBoolean(probe, ['labelUrlPresent']),
    errorMessage: readString(probe, ['errorMessage']),
  };
}

function mapTryOtoReturnLinkProbe(returnShipment: Record<string, unknown>) {
  const probe = isRecord(returnShipment.linkProbe) ? returnShipment.linkProbe : null;
  if (!probe) {
    return null;
  }

  return {
    status: readString(probe, ['status']) ?? 'not_started',
    attemptedAt: readString(probe, ['attemptedAt']),
    endpoint: readString(probe, ['endpoint']),
    httpStatus: readNumber(probe, ['httpStatus']),
    responseKeys: readStringArray(probe.responseKeys),
    nestedKeys: readStringArray(probe.nestedKeys),
    labelLikeFieldsPresent: readBoolean(probe, ['labelLikeFieldsPresent']),
    awbLikeFieldsPresent: readBoolean(probe, ['awbLikeFieldsPresent']),
    pdfLikeFieldsPresent: readBoolean(probe, ['pdfLikeFieldsPresent']),
    urlLikeFieldsPresent: readBoolean(probe, ['urlLikeFieldsPresent']),
    actionUrlPresent: readBoolean(probe, ['actionUrlPresent']),
    trackingPresent: readBoolean(probe, ['trackingPresent']),
    barcodePresent: readBoolean(probe, ['barcodePresent']),
    providerStatus: readString(probe, ['providerStatus']),
    labelUrlPresent: readBoolean(probe, ['labelUrlPresent']),
    providerMessage: readString(probe, ['providerMessage']),
    errorMessage: readString(probe, ['errorMessage']),
  };
}

function mapTryOtoReturnAwbPrintProbe(returnShipment: Record<string, unknown>) {
  const probe = isRecord(returnShipment.awbPrintProbe) ? returnShipment.awbPrintProbe : null;
  if (!probe) {
    return null;
  }

  return {
    status: readString(probe, ['status']) ?? 'not_started',
    attemptedAt: readString(probe, ['attemptedAt']),
    endpoint: readString(probe, ['endpoint']),
    httpStatus: readNumber(probe, ['httpStatus']),
    responseKeys: readStringArray(probe.responseKeys),
    nestedKeys: readStringArray(probe.nestedKeys),
    labelLikeFieldsPresent: readBoolean(probe, ['labelLikeFieldsPresent']),
    awbLikeFieldsPresent: readBoolean(probe, ['awbLikeFieldsPresent']),
    pdfLikeFieldsPresent: readBoolean(probe, ['pdfLikeFieldsPresent']),
    urlLikeFieldsPresent: readBoolean(probe, ['urlLikeFieldsPresent']),
    trackingPresent: readBoolean(probe, ['trackingPresent']),
    barcodePresent: readBoolean(probe, ['barcodePresent']),
    providerStatus: readString(probe, ['providerStatus']),
    labelUrlPresent: readBoolean(probe, ['labelUrlPresent']),
    providerMessage: readString(probe, ['providerMessage']),
    errorMessage: readString(probe, ['errorMessage']),
  };
}

function readTryOtoReturnLabelUrl(returnShipment: Record<string, unknown>) {
  return readString(returnShipment, [
    'labelUrl',
    'returnLabelUrl',
    'printReturnAWBURL',
    'printReturnAWBUrl',
    'printReturnAwbURL',
    'printReturnAwbUrl',
  ]);
}

function readTryOtoReturnTrackingUrl(returnShipment: Record<string, unknown>) {
  return readString(returnShipment, ['trackingUrl', 'returnTrackingUrl', 'brandedTrackingURL', 'brandedTrackingUrl']);
}

function mapReturnShipment(snapshot: Record<string, unknown>): ShipmentExecutionDto['returnShipment'] {
  const returnShipment = isRecord(snapshot.returnShipment) ? snapshot.returnShipment : null;
  if (!returnShipment) {
    return null;
  }

  const labelUrl = readTryOtoReturnLabelUrl(returnShipment);
  const trackingNumber = readString(returnShipment, ['trackingNumber', 'returnTrackingNumber']);
  return {
    provider: 'try_oto',
    returnOrderId: readString(returnShipment, ['returnOrderId', 'returnProviderId', 'providerReturnId', 'returnOtoId']),
    trackingNumber,
    trackingUrl: readTryOtoReturnTrackingUrl(returnShipment),
    labelUrl,
    barcode: readString(returnShipment, ['barcode', 'returnBarcode']),
    carrierName: readString(returnShipment, ['carrierName', 'returnCarrierName']),
    status: readString(returnShipment, ['status', 'returnStatus']),
    createdAt: readString(returnShipment, ['createdAt']),
    requestKeys: readStringArray(returnShipment.requestKeys),
    responseKeys: readStringArray(returnShipment.responseKeys),
    trackingPresent: Boolean(trackingNumber),
    labelPresent: Boolean(labelUrl),
    labelRetrievalConfirmed: Boolean(labelUrl) || readBoolean(returnShipment, ['labelRetrievalConfirmed']),
    labelRetrievalNote: readString(returnShipment, ['labelRetrievalNote']),
    finalized: readBoolean(returnShipment, ['finalized']),
    labelRetrievable: Boolean(labelUrl) || readBoolean(returnShipment, ['labelRetrievable']),
    providerStatusSource: readString(returnShipment, ['providerStatusSource']),
    diagnostics: mapTryOtoReturnDiagnostics(returnShipment),
    detailsProbe: mapTryOtoReturnDetailsProbe(returnShipment),
    linkProbe: mapTryOtoReturnLinkProbe(returnShipment),
    awbPrintProbe: mapTryOtoReturnAwbPrintProbe(returnShipment),
    shopifyReturnLabelUploadProbe: mapShopifyReturnLabelUploadProbe(returnShipment),
  };
}

function mapShipmentExecution(execution: ShipmentExecution & { shippingCostLinked?: boolean }): ShipmentExecutionDto {
  const snapshot = readSnapshot(execution);
  const providerStatus = readString(snapshot, ['providerStatus', 'statusField', 'shipmentStatus', 'cargoStatus']);
  const barcode = readString(snapshot, ['barcode', 'barcodeNumber']);
  const lastProviderResponseAt = readString(snapshot, ['lastProviderResponseAt']);
  const timeline = readTimeline(snapshot);
  const dummyCarrierDetected = readBoolean(snapshot, ['dummyCarrierDetected']);
  const webhookReceived = readBoolean(snapshot, ['webhookReceived']);
  return {
    id: execution.id,
    allocationId: execution.allocationId,
    vendorId: execution.vendorId,
    sourceShopifyOrderId: execution.sourceShopifyOrderId,
    sourceShopifyOrderNumber: execution.sourceShopifyOrderNumber,
    sourceShopifyFulfillmentId: execution.sourceShopifyFulfillmentId,
    provider: mapProvider(execution.provider),
    providerShipmentId: execution.providerShipmentId,
    trackingNumber: execution.trackingNumber,
    trackingUrl: execution.trackingUrl,
    labelUrl: execution.labelUrl,
    shipmentStatus: mapStatus(execution.shipmentStatus),
    desi: toAmountString(toNumber(execution.desi)),
    cargoIntegrationId: execution.cargoIntegrationId,
    warehouseId: execution.warehouseId,
    shippingCost: execution.shippingCost === null ? null : toAmountString(toNumber(execution.shippingCost)),
    shippingVat: execution.shippingVat === null ? null : toAmountString(toNumber(execution.shippingVat)),
    currency: execution.currency,
    shippingCostLinked: Boolean(execution.shippingCostLinked),
    providerStatus,
    barcode,
    lastProviderResponseAt,
    dummyCarrierDetected,
    webhookReceived,
    barcodeAssigned: Boolean(barcode),
    trackingAssigned: Boolean(execution.trackingNumber),
    returnShipment: mapReturnShipment(snapshot),
    timeline,
    createdAt: execution.createdAt.toISOString(),
    updatedAt: execution.updatedAt.toISOString(),
  };
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

function buildTryOtoRetryContext(existing: ShipmentExecution) {
  if (existing.provider !== ShippingProvider.TRY_OTO) {
    return undefined;
  }

  const responseSnapshot = readSnapshot(existing);
  const existingOrderAlreadyExists = (
    readString(responseSnapshot, ['providerErrorCode', 'errorCode', 'otoErrorCode', 'code'])?.toUpperCase() === 'OTO1063' ||
    /order id is already exist/i.test(readString(responseSnapshot, ['providerError', 'errorMsg', 'otoErrorMessage', 'message', 'error', 'detail']) ?? '')
  );

  return {
    isRetry: true,
    existingOrderId:
      readString(existing.requestSnapshot, ['orderId']) ??
      readString(responseSnapshot, ['orderId']),
    existingProviderOrderId:
      readString(responseSnapshot, ['providerOrderId', 'otoId', 'shipmentId']) ??
      readString(existing.requestSnapshot, ['providerOrderId', 'otoId']),
    existingOrderAlreadyExists,
  };
}

function readBoolean(value: unknown, keys: string[]) {
  if (!isRecord(value)) {
    return false;
  }

  return keys.some((key) => value[key] === true);
}

function readLooseBoolean(value: unknown, keys: string[]) {
  if (!isRecord(value)) {
    return false;
  }

  return keys.some((key) => {
    const raw = value[key];
    return raw === true || (typeof raw === 'string' && raw.trim().toLowerCase() === 'true');
  });
}

function readSnapshot(execution: { responseSnapshot?: unknown }) {
  return isRecord(execution.responseSnapshot) ? execution.responseSnapshot : {};
}

function sanitizeTryOtoReferencePart(value: string | null | undefined, fallback: string) {
  const sanitized = (value ?? '')
    .trim()
    .replace(/^#+/, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toUpperCase();
  return sanitized || fallback;
}

function buildTryOtoInternalOrderReference(allocation: { id: string; sourceShopifyOrderId: string | null; sourceShopifyOrderNumber: string | null }) {
  return [
    'shopify',
    (allocation.sourceShopifyOrderId ?? allocation.sourceShopifyOrderNumber ?? allocation.id).replace(/[^a-zA-Z0-9]+/g, '-'),
    'allocation',
    allocation.id.replace(/[^a-zA-Z0-9]+/g, '-'),
  ].join('-');
}

function buildTryOtoExternalOrderReference(allocation: { assignedVendorId: string; sourceShopifyOrderNumber: string | null; id: string }) {
  const vendorPart = sanitizeTryOtoReferencePart(allocation.assignedVendorId, 'VENDOR');
  const orderPart = sanitizeTryOtoReferencePart(allocation.sourceShopifyOrderNumber ?? allocation.id, 'ORDER');
  return `${vendorPart}-${orderPart}`;
}

function applyExistingTryOtoOrderReference(existing: ShipmentExecution, requestSnapshot: Record<string, unknown>) {
  if (existing.provider !== ShippingProvider.TRY_OTO) {
    return requestSnapshot;
  }

  const existingRequestSnapshot = isRecord(existing.requestSnapshot) ? existing.requestSnapshot : {};
  const existingOrderId = readString(existingRequestSnapshot, ['externalOrderReference', 'orderId']);
  if (!existingOrderId) {
    return requestSnapshot;
  }

  return {
    ...requestSnapshot,
    orderId: existingOrderId,
    externalOrderReference: existingOrderId,
    legacyInternalReferenceUsed: Boolean(isInternalTryOtoOrderReference(existingOrderId)),
  };
}

function isInternalTryOtoOrderReference(value: string | null) {
  const normalized = value?.trim().toLowerCase() ?? '';
  return Boolean(normalized && normalized.startsWith('shopify-') && normalized.includes('-allocation-'));
}

function resolveKargoPackageType(providerMetadata: unknown) {
  return (readString(providerMetadata, ['packageType', 'package_type']) ?? DEFAULT_KARGO_PACKAGE_TYPE).trim().toLowerCase();
}

function assertValidKargoPackageType(value: string): asserts value is 'box' | 'document' {
  if (!ALLOWED_KARGO_PACKAGE_TYPES.has(value)) {
    throw new Error('Invalid Kargo package_type. Allowed values: box, document.');
  }
}

function readTimeline(snapshot: Record<string, unknown>) {
  const events = Array.isArray(snapshot.timeline) ? snapshot.timeline : [];
  return events
    .filter(isRecord)
    .map((event) => ({
      label: readString(event, ['label']) ?? 'Shipment update',
      at: readString(event, ['at']) ?? new Date().toISOString(),
      status: readString(event, ['status']),
    }));
}

function appendTimelineEvent(snapshot: unknown, event: { label: string; status?: string | null }) {
  const base = isRecord(snapshot) ? snapshot : {};
  const timeline = readTimeline(base);
  return {
    ...base,
    timeline: [
      ...timeline,
      {
        label: event.label,
        at: new Date().toISOString(),
        status: event.status ?? null,
      },
    ],
  };
}

function appendTimelineEventOnce(snapshot: unknown, event: { label: string; status?: string | null }, fingerprint: string) {
  const base = isRecord(snapshot) ? snapshot : {};
  const fingerprints = Array.isArray(base.timelineEventFingerprints)
    ? base.timelineEventFingerprints.filter((value): value is string => typeof value === 'string')
    : [];

  if (fingerprints.includes(fingerprint)) {
    return base;
  }

  return {
    ...appendTimelineEvent(base, event),
    timelineEventFingerprints: [...fingerprints, fingerprint],
  };
}

function isDummyKargoRequested(input: CreateShipmentExecutionDto, env?: AppEnv) {
  void env;
  return input.carrierId === DUMMY_KARGO_CARRIER_ID;
}

function getKargoRequestTarget(baseUrl: string | undefined) {
  if (!baseUrl) {
    return {
      selectedBaseUrl: null,
      requestTargetHostname: null,
      productionEndpointSelected: false,
    };
  }

  const selectedBaseUrl = baseUrl.replace(/\/$/, '');
  try {
    const requestUrl = new URL(`${selectedBaseUrl}/shipments`);
    return {
      selectedBaseUrl,
      requestTargetHostname: requestUrl.hostname,
      productionEndpointSelected: requestUrl.hostname === 'app.kargoentegrator.com',
    };
  } catch {
    return {
      selectedBaseUrl,
      requestTargetHostname: null,
      productionEndpointSelected: false,
    };
  }
}

function logKargoExecutionModeSelection(input: CreateShipmentExecutionDto, preview: ShipmentExecutionPreviewDto, env?: AppEnv) {
  if (preview.provider !== 'kargo_entegrator') {
    return;
  }

  const target = getKargoRequestTarget(env?.KARGO_ENTEGRATOR_BASE_URL);
  const explicitDummyCarrierRequested = input.carrierId === DUMMY_KARGO_CARRIER_ID;
  const sandboxModeEnabled = Boolean(env?.SHIPPING_SANDBOX_MODE);
  const dummyModeEnabled = isDummyKargoRequested(input, env);

  console.info('[shipping:kargo:execution-mode]', {
    provider: 'kargo_entegrator',
    selectedEnvironment: sandboxModeEnabled ? 'sandbox' : 'production',
    selectedBaseUrl: target.selectedBaseUrl,
    requestTargetHostname: target.requestTargetHostname,
    productionEndpointSelected: target.productionEndpointSelected,
    providerMode: dummyModeEnabled ? 'dummy' : 'live',
    dummyModeEnabled,
    dummyModeSources: {
      explicitCarrierIdDummy: explicitDummyCarrierRequested,
      sandboxMode: sandboxModeEnabled,
    },
    shippingExecutionEnabled: Boolean(env?.SHIPPING_EXECUTION_ENABLED),
    providerEnabled: Boolean(env?.KARGO_ENTEGRATOR_ENABLED),
    packageType: isRecord(preview.payload) ? readString(preview.payload, ['package_type']) : null,
  });
}

export function inferShipmentDesi(
  lineItems: Array<{ title?: string | null; sku?: string | null }>,
  fallbackDesi = 3,
) {
  const haystack = lineItems
    .map((item) => `${item.title ?? ''} ${item.sku ?? ''}`)
    .join(' ')
    .toLowerCase();

  if (
    /\b(shoe|shoes|sneaker|trainer|boot|bag|backpack|handbag|apparel|shirt|t-shirt|tee|pants|jacket|hoodie|dress)\b/.test(
      haystack,
    )
  ) {
    return 3;
  }

  return fallbackDesi;
}

function resolveShipmentDesi(
  lineItems: Array<{ title?: string | null; sku?: string | null }>,
  configuredDefaultDesi: unknown,
) {
  const fallbackDesi = toPositiveNumber(configuredDefaultDesi, DEFAULT_TRY_OTO_PACKAGE_WEIGHT_KG);
  return toPositiveNumber(inferShipmentDesi(lineItems, fallbackDesi), fallbackDesi);
}

function resolvePersistedShipmentDesi(preview: ShipmentExecutionPreviewDto) {
  const payload = isRecord(preview.payload) ? preview.payload : {};
  const candidates = [
    preview.desi,
    payload.desi,
    payload.packageWeight,
  ];

  for (const candidate of candidates) {
    const parsed = Number(candidate);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return DEFAULT_TRY_OTO_PACKAGE_WEIGHT_KG;
}

function buildShipmentExecutionId(input: {
  allocationId: string;
  provider: ShippingProvider;
}) {
  return `shipment-${input.provider.toLowerCase()}-${input.allocationId}`;
}

function buildShippingCostId(input: {
  vendorId: string;
  allocationId: string;
  provider: ShippingProvider;
  providerReference: string;
}) {
  const provider = input.provider.toLowerCase();
  const reference = input.providerReference
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'shipment';

  return `shipcost-${input.vendorId}-${input.allocationId}-${provider}-${reference}`;
}

function mapProviderStatus(status: ShipmentExecutionDto['shipmentStatus']) {
  if (status === 'created') {
    return ShipmentExecutionStatus.CREATED;
  }
  if (status === 'failed') {
    return ShipmentExecutionStatus.FAILED;
  }
  if (status === 'in_transit') {
    return ShipmentExecutionStatus.IN_TRANSIT;
  }
  if (status === 'delivered') {
    return ShipmentExecutionStatus.DELIVERED;
  }
  if (status === 'returned') {
    return ShipmentExecutionStatus.RETURNED;
  }
  if (status === 'cancelled') {
    return ShipmentExecutionStatus.CANCELLED;
  }
  return ShipmentExecutionStatus.PENDING;
}

function allocationShippingStatus(status: ShipmentExecutionDto['shipmentStatus']) {
  if (status === 'delivered') {
    return 'delivered';
  }
  if (status === 'in_transit') {
    return 'in_transit';
  }
  if (status === 'created') {
    return 'label_created';
  }
  return 'awaiting_shipment';
}

function selectDefaultWarehouse(config: VendorShippingConfigDto, provider: ShippingProviderDto) {
  return (
    config.warehouses.find((warehouse) => warehouse.provider === provider && warehouse.warehouseId === config.defaultWarehouseId) ??
    config.warehouses.find((warehouse) => warehouse.provider === provider && warehouse.isDefault) ??
    config.warehouses.find((warehouse) => warehouse.provider === provider) ??
    null
  );
}

function resolveKargoCargoIntegrationId(config: VendorShippingConfigDto, env?: AppEnv) {
  return config.cargoIntegrationId ?? env?.KARGO_ENTEGRATOR_CARGO_INTEGRATION_ID ?? null;
}

function requireWarehouseConfig(config: VendorShippingConfigDto, provider: ShippingProviderDto, env?: AppEnv) {
  const warehouse = selectDefaultWarehouse(config, provider);
  const warehouseId = warehouse?.warehouseId ?? config.defaultWarehouseId;
  const cargoIntegrationId = resolveKargoCargoIntegrationId(config, env);
  if (!cargoIntegrationId || !warehouseId) {
    throw new Error('Vendor shipping warehouse is not configured.');
  }

  return {
    cargoIntegrationId,
    warehouseId,
  };
}

function resolveTryOtoPickupLocationCode(providerMetadata: unknown) {
  return readString(providerMetadata, [
    'tryOtoPickupLocationCode',
    'pickupLocationCode',
    'pickup_location_code',
    'try_oto_pickup_location_code',
  ]);
}

function resolveTryOtoDeliveryOptionId(providerMetadata: unknown) {
  return readString(providerMetadata, [
    'tryOtoDeliveryOptionId',
    'deliveryOptionId',
    'delivery_option_id',
    'try_oto_delivery_option_id',
  ]);
}

function resolveTryOtoOriginCity(providerMetadata: unknown) {
  return readString(providerMetadata, [
    'tryOtoOriginCity',
    'originCity',
    'origin_city',
    'pickupCity',
    'pickup_city',
  ]);
}

function resolveTryOtoPackageWeight(providerMetadata: unknown, fallback: number) {
  const raw = readString(providerMetadata, ['packageWeight', 'package_weight', 'tryOtoPackageWeight']);
  const parsed = raw === null ? Number.NaN : Number(raw);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return Math.max(DEFAULT_TRY_OTO_PACKAGE_WEIGHT_KG, fallback > 0 ? fallback : DEFAULT_TRY_OTO_PACKAGE_WEIGHT_KG);
}

function resolveKargonomiWarehouseId(config: VendorShippingConfigDto, env?: AppEnv) {
  return selectDefaultWarehouse(config, 'kargonomi')?.warehouseId ?? config.defaultWarehouseId ?? env?.KARGONOMI_DEFAULT_WAREHOUSE_ID ?? null;
}

function resolveKargonomiShippingProviderId(providerMetadata: unknown) {
  return readString(providerMetadata, [
    'kargonomiShippingProviderId',
    'kargonomi_shipping_provider_id',
    'shippingProviderId',
    'shipping_provider_id',
  ]);
}

function resolveKargonomiBuyerStateId(providerMetadata: unknown) {
  return resolveKargonomiAddressId(providerMetadata, ['kargonomiBuyerStateId', 'buyerStateId', 'buyer_state_id']);
}

function resolveKargonomiBuyerCityId(providerMetadata: unknown) {
  return resolveKargonomiAddressId(providerMetadata, ['kargonomiBuyerCityId', 'buyerCityId', 'buyer_city_id']);
}

function resolveKargonomiAddressId(source: unknown, keys: string[]) {
  return readString(source, keys);
}

function normalizeKargonomiPhone(value: string | null) {
  if (!value) {
    return null;
  }

  const digits = value.replace(/\D/g, '');
  if (digits.length === 10) {
    return digits;
  }
  if (digits.length === 11 && digits.startsWith('0')) {
    return digits.slice(1);
  }
  if (digits.length === 12 && digits.startsWith('90')) {
    return digits.slice(2);
  }
  if (digits.length > 10) {
    return digits.slice(-10);
  }

  return null;
}

function splitCustomerName(name: string | null | undefined) {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return {
      name: null,
      surname: null,
    };
  }

  if (parts.length === 1) {
    return {
      name: parts[0],
      surname: null,
    };
  }

  return {
    name: parts.slice(0, -1).join(' '),
    surname: parts.at(-1) ?? null,
  };
}

function buildNotificationUrl(input?: string | null) {
  return input?.trim() || null;
}

function normalizeShipmentPhone(value: string | null | undefined) {
  const digits = value?.replace(/\D+/g, '') ?? '';
  if (!digits) {
    return null;
  }
  if (digits.startsWith('90') && digits.length === 12) {
    return digits;
  }
  if (digits.startsWith('0') && digits.length === 11) {
    return `90${digits.slice(1)}`;
  }
  if (digits.startsWith('5') && digits.length === 10) {
    return `90${digits}`;
  }
  return digits;
}

function composeShipmentAddress(orderRecord: Record<string, unknown>) {
  const directAddress = readString(orderRecord, ['shippingAddress', 'address']);
  if (directAddress) {
    return directAddress;
  }

  const parts = [
    readString(orderRecord, ['shippingAddress1', 'address1']),
    readString(orderRecord, ['shippingAddress2', 'address2']),
  ].filter((part): part is string => Boolean(part));

  return parts.join(', ') || null;
}

function normalizeCustomerOverrides(input: CreateShipmentExecutionDto['customerOverrides']) {
  if (!isRecord(input)) {
    return {};
  }

  const allowedKeys = ['name', 'surname', 'phone', 'email', 'country', 'postcode', 'city', 'district', 'address'] as const;
  return Object.fromEntries(
    allowedKeys
      .map((key) => {
        const value = input[key];
        if (typeof value !== 'string') {
          return null;
        }
        const normalized = key === 'phone' ? normalizeShipmentPhone(value) : value.trim();
        return normalized ? [key, normalized] : null;
      })
      .filter((entry): entry is [string, string] => Boolean(entry)),
  );
}

function readStoredOrderWebhookAddress(orderRecord: Record<string, unknown>) {
  const events = Array.isArray(orderRecord.webhookEvents) ? orderRecord.webhookEvents : [];
  for (const event of events) {
    if (!isRecord(event)) {
      continue;
    }

    const rawPayload = readString(event, ['rawPayload']);
    if (!rawPayload) {
      continue;
    }

    try {
      return mapShopifyShippingAddress(JSON.parse(rawPayload) as ShopifyOrdersCreateWebhookPayload);
    } catch {
      continue;
    }
  }

  return null;
}

function readNestedRecord(value: Record<string, unknown>, key: string) {
  const nested = value[key];
  return isRecord(nested) ? nested : null;
}

function readStoredOrderWebhookPhone(orderRecord: Record<string, unknown>) {
  const events = Array.isArray(orderRecord.webhookEvents) ? orderRecord.webhookEvents : [];
  for (const event of events) {
    if (!isRecord(event)) {
      continue;
    }

    const rawPayload = readString(event, ['rawPayload']);
    if (!rawPayload) {
      continue;
    }

    try {
      const payload = JSON.parse(rawPayload) as Record<string, unknown>;
      const shippingAddress = readNestedRecord(payload, 'shipping_address');
      const billingAddress = readNestedRecord(payload, 'billing_address');
      const customer = readNestedRecord(payload, 'customer');
      const phone =
        readString(shippingAddress ?? {}, ['phone']) ??
        readString(billingAddress ?? {}, ['phone']) ??
        readString(payload, ['phone']) ??
        readString(customer ?? {}, ['phone']);
      const normalized = normalizeShipmentPhone(phone);
      if (normalized) {
        return normalized;
      }
    } catch {
      continue;
    }
  }

  return null;
}

function readAddressDistrict(value: Record<string, unknown> | null) {
  if (!value) {
    return null;
  }

  return readString(value, [
    'district',
    'district_name',
    'districtName',
    'city_area',
    'cityArea',
    'county',
    'county_name',
    'countyName',
    'province',
    'province_name',
    'provinceName',
  ]);
}

function readStoredOrderWebhookDistrict(orderRecord: Record<string, unknown>) {
  const events = Array.isArray(orderRecord.webhookEvents) ? orderRecord.webhookEvents : [];
  for (const event of events) {
    if (!isRecord(event)) {
      continue;
    }

    const rawPayload = readString(event, ['rawPayload']);
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

function buildKargoCustomer(input: {
  order: unknown;
  customerName: string | null | undefined;
  customerEmail: string | null | undefined;
  customerOverrides?: CreateShipmentExecutionDto['customerOverrides'];
}) {
  const orderRecord = isRecord(input.order) ? input.order : {};
  const webhookAddress = readStoredOrderWebhookAddress(orderRecord);
  const overrides = normalizeCustomerOverrides(input.customerOverrides);
  const name = splitCustomerName(input.customerName);
  const customer = {
    name: overrides.name ?? name.name,
    surname: overrides.surname ?? name.surname,
    phone: overrides.phone ?? normalizeShipmentPhone(
      readString(orderRecord, ['customerPhone', 'phone', 'shippingPhone', 'billingPhone']) ??
        webhookAddress?.customerPhone ??
        readStoredOrderWebhookPhone(orderRecord),
    ),
    email: overrides.email ?? input.customerEmail ?? readString(orderRecord, ['customerEmail', 'email']),
    country: overrides.country ?? readString(orderRecord, ['shippingCountry', 'country']) ?? webhookAddress?.shippingCountry ?? null,
    postcode:
      overrides.postcode ??
      readString(orderRecord, ['shippingPostcode', 'postcode', 'zip']) ??
      webhookAddress?.shippingPostcode ??
      null,
    city: overrides.city ?? readString(orderRecord, ['shippingCity', 'city']) ?? webhookAddress?.shippingCity ?? null,
    district:
      overrides.district ??
      readString(orderRecord, [
        'shippingDistrict',
        'district',
        'shippingCounty',
        'county',
        'shippingCityArea',
        'cityArea',
        'shippingProvince',
        'province',
        'billingDistrict',
        'billingCounty',
        'billingCityArea',
        'billingProvince',
      ]) ??
      webhookAddress?.shippingDistrict ??
      readStoredOrderWebhookDistrict(orderRecord) ??
      null,
    address: overrides.address ?? composeShipmentAddress(orderRecord) ?? webhookAddress?.shippingAddress ?? null,
  };
  const missingFields = Object.entries(customer)
    .filter(([, value]) => !value)
    .map(([key]) => `customer.${key}`);

  return {
    customer,
    missingFields,
  };
}

function buildTryOtoCustomer(input: {
  order: unknown;
  customerName: string | null | undefined;
  customerEmail: string | null | undefined;
  customerOverrides?: CreateShipmentExecutionDto['customerOverrides'];
}) {
  const orderRecord = isRecord(input.order) ? input.order : {};
  const webhookAddress = readStoredOrderWebhookAddress(orderRecord);
  const overrides = normalizeCustomerOverrides(input.customerOverrides);
  const customer = {
    name: overrides.name ?? input.customerName ?? readString(orderRecord, ['customerName', 'name']),
    email: overrides.email ?? input.customerEmail ?? readString(orderRecord, ['customerEmail', 'email']),
    mobile: overrides.phone ?? normalizeShipmentPhone(
      readString(orderRecord, ['customerPhone', 'phone', 'shippingPhone', 'billingPhone']) ??
        webhookAddress?.customerPhone ??
        readStoredOrderWebhookPhone(orderRecord),
    ),
    address: overrides.address ?? composeShipmentAddress(orderRecord) ?? webhookAddress?.shippingAddress ?? null,
    district:
      overrides.district ??
      readString(orderRecord, [
        'shippingDistrict',
        'district',
        'shippingCounty',
        'county',
        'shippingCityArea',
        'cityArea',
        'shippingProvince',
        'province',
        'billingDistrict',
        'billingCounty',
        'billingCityArea',
        'billingProvince',
      ]) ??
      webhookAddress?.shippingDistrict ??
      readStoredOrderWebhookDistrict(orderRecord) ??
      null,
    city: overrides.city ?? readString(orderRecord, ['shippingCity', 'city']) ?? webhookAddress?.shippingCity ?? null,
    country: overrides.country ?? readString(orderRecord, ['shippingCountry', 'country']) ?? webhookAddress?.shippingCountry ?? 'TR',
    postcode:
      overrides.postcode ??
      readString(orderRecord, ['shippingPostcode', 'postcode', 'zip']) ??
      webhookAddress?.shippingPostcode ??
      null,
  };
  const requiredFields = ['name', 'mobile', 'address', 'city', 'country'] as const;
  const missingFields = requiredFields
    .filter((key) => !customer[key])
    .map((key) => `customer.${key === 'mobile' ? 'mobile' : key}`);

  return {
    customer,
    missingFields,
  };
}

function buildKargonomiBuyer(input: {
  order: unknown;
  customerName: string | null | undefined;
  customerEmail: string | null | undefined;
  providerMetadata: unknown;
  resolvedDestination?: {
    buyerStateId?: string | null;
    buyerCityId?: string | null;
  };
  customerOverrides?: CreateShipmentExecutionDto['customerOverrides'];
}) {
  const orderRecord = isRecord(input.order) ? input.order : {};
  const webhookAddress = readStoredOrderWebhookAddress(orderRecord);
  const overrides = normalizeCustomerOverrides(input.customerOverrides);
  const buyerName = overrides.name ?? input.customerName ?? readString(orderRecord, ['customerName', 'name']);
  const rawPhone =
    overrides.phone ??
    readString(orderRecord, ['customerPhone', 'phone', 'shippingPhone', 'billingPhone']) ??
    webhookAddress?.customerPhone ??
    readStoredOrderWebhookPhone(orderRecord);
  const buyer = {
    buyer_name: buyerName,
    buyer_email: overrides.email ?? input.customerEmail ?? readString(orderRecord, ['customerEmail', 'email']),
    buyer_phone: normalizeKargonomiPhone(rawPhone),
    buyer_address: overrides.address ?? composeShipmentAddress(orderRecord) ?? webhookAddress?.shippingAddress ?? null,
    buyer_state_id:
      resolveKargonomiAddressId(orderRecord, [
        'kargonomiBuyerStateId',
        'buyerStateId',
        'buyer_state_id',
        'shippingStateId',
        'shipping_state_id',
      ]) ??
      input.resolvedDestination?.buyerStateId ??
      resolveKargonomiAddressId(input.providerMetadata, ['kargonomiBuyerStateId', 'buyerStateId', 'buyer_state_id']),
    buyer_city_id:
      resolveKargonomiAddressId(orderRecord, [
        'kargonomiBuyerCityId',
        'buyerCityId',
        'buyer_city_id',
        'shippingCityId',
        'shipping_city_id',
      ]) ??
      input.resolvedDestination?.buyerCityId ??
      resolveKargonomiAddressId(input.providerMetadata, ['kargonomiBuyerCityId', 'buyerCityId', 'buyer_city_id']),
  };
  const missingFields = Object.entries(buyer)
    .filter(([, value]) => !value)
    .map(([key]) => `buyer.${key}`);

  return {
    buyer,
    missingFields,
  };
}

function readKargonomiDestinationText(
  order: unknown,
  customerOverrides?: CreateShipmentExecutionDto['customerOverrides'],
) {
  const orderRecord = isRecord(order) ? order : {};
  const webhookAddress = readStoredOrderWebhookAddress(orderRecord);
  const overrides = normalizeCustomerOverrides(customerOverrides);
  const province =
    readString(orderRecord, ['shippingProvince', 'province', 'shippingState', 'state']) ??
    webhookAddress?.shippingCity ??
    null;
  const city = overrides.city ?? readString(orderRecord, ['shippingCity', 'city']) ?? webhookAddress?.shippingCity ?? null;
  const district =
    overrides.district ??
    readString(orderRecord, [
      'shippingDistrict',
      'district',
      'shippingCounty',
      'county',
      'shippingCityArea',
      'cityArea',
      'billingDistrict',
      'billingCounty',
      'billingCityArea',
    ]) ??
    webhookAddress?.shippingDistrict ??
    readStoredOrderWebhookDistrict(orderRecord) ??
    null;

  return {
    province,
    city,
    district,
  };
}

function hasKargonomiOrderDestinationIds(order: unknown) {
  const orderRecord = isRecord(order) ? order : {};
  return Boolean(
    resolveKargonomiAddressId(orderRecord, [
      'kargonomiBuyerStateId',
      'buyerStateId',
      'buyer_state_id',
      'shippingStateId',
      'shipping_state_id',
    ]) &&
      resolveKargonomiAddressId(orderRecord, [
        'kargonomiBuyerCityId',
        'buyerCityId',
        'buyer_city_id',
        'shippingCityId',
        'shipping_city_id',
      ]),
  );
}

function resolveKargoPaymentType(orderRecord: Record<string, unknown>) {
  void orderRecord;
  return 'cash_money';
}

function resolveTryOtoPayment(orderRecord: Record<string, unknown>, amount: number) {
  const raw =
    readString(orderRecord, ['payment_method', 'paymentMethod', 'financialStatus', 'paymentStatus'])?.toLowerCase() ??
    '';
  const isCod = raw === 'cod' || raw.includes('cash_on_delivery') || raw.includes('cash on delivery');
  return {
    payment_method: isCod ? 'cod' : 'paid',
    amount_due: isCod ? amount : 0,
  };
}

function resolveKargoKg(orderRecord: Record<string, unknown>, desi: number) {
  const rawKg = readString(orderRecord, ['shippingKg', 'kg']);
  const parsedKg = rawKg === null ? Number.NaN : Number(rawKg);
  return Number.isFinite(parsedKg) && parsedKg > 0 ? parsedKg : desi;
}

function readPath(value: unknown, path: string) {
  return path.split('.').reduce<unknown>((current, key) => {
    if (!isRecord(current)) {
      return null;
    }
    return current[key] ?? null;
  }, value);
}

function logMissingKargoPayloadFields(payload: Record<string, unknown>, provider: ShippingProvider) {
  if (provider !== ShippingProvider.KARGO_ENTEGRATOR) {
    return;
  }

  const requiredFields = [
    'cargo_integration_id',
    'warehouse_id',
    'payment_type',
    'package_type',
    'payor_type',
    'desi',
    'kg',
    'platform_id',
    'platform_d_id',
    'customer.name',
    'customer.surname',
    'customer.phone',
    'customer.email',
    'customer.country',
    'customer.postcode',
    'customer.city',
    'customer.district',
    'customer.address',
  ];
  const missingFields = requiredFields.filter((field) => {
    const value = readPath(payload, field);
    return value === null || value === undefined || value === '';
  });

  if (missingFields.length) {
    console.warn('[shipping:kargo:missing-required-payload-fields]', {
      provider: 'kargo_entegrator',
      missingFields,
      requestBlocked: false,
    });
  }
}

async function getStoredShippingConfig(vendorId: string) {
  return prisma.vendorShippingConfig.findUnique({
    where: {
      vendorId,
    },
    include: {
      warehouses: {
        orderBy: [
          {
            isDefault: 'desc',
          },
          {
            createdAt: 'asc',
          },
        ],
      },
    },
  });
}

export async function getVendorShippingConfig(vendorId: string): Promise<VendorShippingConfigDto> {
  return mapShippingConfig(await getStoredShippingConfig(vendorId), vendorId);
}

export async function upsertVendorShippingConfig(
  vendorId: string,
  input: VendorShippingConfigUpdateDto,
): Promise<VendorShippingConfigDto> {
  const defaultConfig = mapShippingConfig(null, vendorId);
  const preferredProvider = normalizeProvider(input.preferredProvider ?? defaultConfig.preferredProvider);
  const defaultDesi = input.defaultDesi ?? Number(defaultConfig.defaultDesi);
  const shippingVatPercent = input.shippingVatPercent ?? Number(defaultConfig.shippingVatPercent);

  if (!Number.isFinite(defaultDesi) || defaultDesi <= 0) {
    throw new Error('defaultDesi must be greater than zero.');
  }
  if (!Number.isFinite(shippingVatPercent) || shippingVatPercent < 0) {
    throw new Error('shippingVatPercent must be zero or greater.');
  }
  if (input.cargoIntegrationId !== undefined && input.cargoIntegrationId !== null && !/^\d+$/.test(input.cargoIntegrationId)) {
    throw new Error('cargoIntegrationId must be numeric.');
  }
  if (input.defaultWarehouseId !== undefined && input.defaultWarehouseId !== null && !/^\d+$/.test(input.defaultWarehouseId)) {
    throw new Error('defaultWarehouseId must be numeric.');
  }
  if (input.providerMetadata !== undefined) {
    assertValidKargoPackageType(resolveKargoPackageType(input.providerMetadata));
  }

  const config = await prisma.$transaction(async (tx) => {
    const savedConfig = await tx.vendorShippingConfig.upsert({
      where: {
        vendorId,
      },
      update: {
        preferredProvider: input.preferredProvider === undefined ? undefined : preferredProvider,
        shippingEnabled: input.shippingEnabled,
        defaultDesi: input.defaultDesi === undefined ? undefined : defaultDesi,
        cargoIntegrationId: input.cargoIntegrationId === undefined ? undefined : input.cargoIntegrationId,
        defaultWarehouseId: input.defaultWarehouseId === undefined ? undefined : input.defaultWarehouseId,
        shippingVatPercent: input.shippingVatPercent === undefined ? undefined : shippingVatPercent,
        providerMetadata:
          input.providerMetadata === undefined
            ? undefined
            : (input.providerMetadata as Prisma.InputJsonValue),
      },
      create: {
        vendorId,
        preferredProvider,
        shippingEnabled: input.shippingEnabled ?? defaultConfig.shippingEnabled,
        defaultDesi,
        cargoIntegrationId: input.cargoIntegrationId ?? null,
        defaultWarehouseId: input.defaultWarehouseId ?? null,
        shippingVatPercent,
        providerMetadata:
          input.providerMetadata === undefined
            ? Prisma.JsonNull
            : (input.providerMetadata as Prisma.InputJsonValue),
      },
    });

    const warehouseInputs = input.warehouses ?? (
      input.defaultWarehouseId
        ? [
            {
              warehouseId: input.defaultWarehouseId,
              isDefault: true,
              provider: mapProvider(preferredProvider),
            },
          ]
        : []
    );

    for (const warehouseInput of warehouseInputs) {
      if (!/^\d+$/.test(warehouseInput.warehouseId)) {
        throw new Error('warehouseId must be numeric.');
      }
    }

    for (const warehouseInput of warehouseInputs) {
      const warehouseProvider = normalizeProvider(warehouseInput.provider ?? mapProvider(preferredProvider));
      await tx.vendorShippingWarehouse.upsert({
        where: {
          vendorId_provider_warehouseId: {
            vendorId,
            provider: warehouseProvider,
            warehouseId: warehouseInput.warehouseId,
          },
        },
        update: {
          configId: savedConfig.id,
          name: warehouseInput.name ?? null,
          address: warehouseInput.address ?? null,
          isDefault: Boolean(warehouseInput.isDefault) || warehouseInput.warehouseId === input.defaultWarehouseId,
        },
        create: {
          configId: savedConfig.id,
          vendorId,
          provider: warehouseProvider,
          warehouseId: warehouseInput.warehouseId,
          name: warehouseInput.name ?? null,
          address: warehouseInput.address ?? null,
          isDefault: Boolean(warehouseInput.isDefault) || warehouseInput.warehouseId === input.defaultWarehouseId,
        },
      });
    }

    return tx.vendorShippingConfig.findUniqueOrThrow({
      where: {
        vendorId,
      },
      include: {
        warehouses: {
          orderBy: [
            {
              isDefault: 'desc',
            },
            {
              createdAt: 'asc',
            },
          ],
        },
      },
    });
  });

  return mapShippingConfig(config, vendorId);
}

export function getShippingProviderGateDiagnostics(
  env: AppEnv,
  providerOverride?: ShippingProviderDto,
): ShippingProviderGateDiagnosticsDto {
  const provider = providerOverride ?? env.SHIPPING_PROVIDER;
  const isKargo = provider === 'kargo_entegrator';
  const isTryOto = provider === 'try_oto';
  const isKargonomi = provider === 'kargonomi';
  const supportedProviders: ShippingProviderDto[] = [
    'kargo_entegrator',
    'hepsijet',
    ...(env.TRY_OTO_ENABLED ? (['try_oto'] as ShippingProviderDto[]) : []),
    ...(env.SHIPPING_PROVIDER === 'kargonomi' || env.KARGONOMI_BASE_URL || env.KARGONOMI_API_TOKEN
      ? (['kargonomi'] as ShippingProviderDto[])
      : []),
  ];
  const providerSelected = env.SHIPPING_PROVIDER === provider;
  const providerEnabled = isKargo
    ? env.KARGO_ENTEGRATOR_ENABLED
    : isTryOto
      ? env.TRY_OTO_ENABLED
      : isKargonomi
        ? providerSelected
        : false;
  const baseUrlConfigured = isKargo
    ? Boolean(env.KARGO_ENTEGRATOR_BASE_URL)
    : isTryOto
      ? Boolean(env.TRY_OTO_BASE_URL)
      : isKargonomi
        ? Boolean(env.KARGONOMI_BASE_URL)
        : false;
  const apiKeyConfigured = isKargo
    ? Boolean(env.KARGO_ENTEGRATOR_API_KEY)
    : isTryOto
      ? Boolean(env.TRY_OTO_REFRESH_TOKEN)
      : isKargonomi
        ? Boolean(env.KARGONOMI_API_TOKEN)
        : false;
  const cargoIntegrationIdConfigured = isKargo ? Boolean(env.KARGO_ENTEGRATOR_CARGO_INTEGRATION_ID) : false;
  const tryOtoWebhookDiagnostics = isTryOto ? getTryOtoWebhookReceiveDiagnostics() : null;
  const packageTypeUsed = DEFAULT_KARGO_PACKAGE_TYPE;
  const missing = [
    !env.SHIPPING_EXECUTION_ENABLED ? 'SHIPPING_EXECUTION_ENABLED' : null,
    isKargo && !env.KARGO_ENTEGRATOR_ENABLED ? 'KARGO_ENTEGRATOR_ENABLED' : null,
    isKargo && !env.KARGO_ENTEGRATOR_BASE_URL ? 'KARGO_ENTEGRATOR_BASE_URL' : null,
    isKargo && !env.KARGO_ENTEGRATOR_API_KEY ? 'KARGO_ENTEGRATOR_API_KEY' : null,
    isTryOto && !env.TRY_OTO_ENABLED ? 'TRY_OTO_ENABLED' : null,
    isTryOto && !env.TRY_OTO_SANDBOX_MODE ? 'TRY_OTO_SANDBOX_MODE' : null,
    isTryOto && !env.TRY_OTO_BASE_URL ? 'TRY_OTO_BASE_URL' : null,
    isTryOto && !env.TRY_OTO_REFRESH_TOKEN ? 'TRY_OTO_REFRESH_TOKEN' : null,
    isKargonomi && !env.KARGONOMI_BASE_URL ? 'KARGONOMI_BASE_URL' : null,
    isKargonomi && !env.KARGONOMI_API_TOKEN ? 'KARGONOMI_API_TOKEN' : null,
  ].filter((value): value is string => Boolean(value));

  return {
    provider,
    supportedProviders,
    executionReady:
      env.SHIPPING_EXECUTION_ENABLED &&
      providerEnabled &&
      baseUrlConfigured &&
      apiKeyConfigured &&
      (!isTryOto || env.TRY_OTO_SANDBOX_MODE),
    sandboxModeEnabled: isTryOto ? env.TRY_OTO_SANDBOX_MODE : env.SHIPPING_SANDBOX_MODE,
    shippingExecutionEnabled: env.SHIPPING_EXECUTION_ENABLED,
    providerSelected,
    providerEnabled,
    webhookIngestEnabled: isKargo
      ? env.SHIPPING_SANDBOX_MODE && env.KARGO_ENTEGRATOR_WEBHOOK_INGEST_ENABLED
      : isTryOto
        ? env.TRY_OTO_ENABLED && env.TRY_OTO_WEBHOOK_INGEST_ENABLED
        : false,
    lastWebhookReceived: tryOtoWebhookDiagnostics?.received ?? false,
    lastWebhookReceivedAt: tryOtoWebhookDiagnostics?.receivedAt ?? null,
    lastWebhookHttpMethod: tryOtoWebhookDiagnostics?.httpMethod ?? null,
    lastWebhookContentType: tryOtoWebhookDiagnostics?.contentType ?? null,
    lastWebhookPayloadKeys: tryOtoWebhookDiagnostics?.payloadKeys ?? [],
    lastWebhookMatchedShipment: tryOtoWebhookDiagnostics?.matchedShipment ?? null,
    lastWebhookMatchStatus: tryOtoWebhookDiagnostics?.matchStatus ?? null,
    lastWebhookMatchedByField: tryOtoWebhookDiagnostics?.matchedByField ?? null,
    lastWebhookStatusValue: tryOtoWebhookDiagnostics?.statusValue ?? null,
    lastWebhookStatusMapped: tryOtoWebhookDiagnostics?.statusMapped ?? null,
    lastWebhookMappedLocalStatus: tryOtoWebhookDiagnostics?.mappedLocalStatus ?? null,
    lastWebhookParseError: tryOtoWebhookDiagnostics?.parseError ?? null,
    webhookSignatureVerificationImplemented: tryOtoWebhookDiagnostics?.signatureVerificationImplemented ?? false,
    baseUrlConfigured,
    apiKeyConfigured,
    cargoIntegrationIdConfigured,
    warehouseIdConfigured: false,
    defaultDesiConfigured: false,
    packageTypeUsed,
    notificationUrlConfigured: false,
    webhookRouteImplemented: true,
    receiverAddressAvailability: 'confirmed_required',
    dummyKargoSupport: isKargo && env.SHIPPING_SANDBOX_MODE ? 'available' : 'not_implemented',
    statusSyncSupport:
      isTryOto && env.TRY_OTO_ENABLED && env.TRY_OTO_WEBHOOK_INGEST_ENABLED
        ? 'webhook_ingest'
        : 'not_implemented',
    missing,
    deprecatedEnvFallbacks:
      isKargo && env.KARGO_ENTEGRATOR_CARGO_INTEGRATION_ID_SOURCE === 'deprecated'
        ? ['ARGO_ENTEGRATOR_CARGO_INTEGRATION_ID']
        : [],
    warnings: isKargo
      ? [
          'Kargo Entegratör webhook/status sync is not implemented.',
          env.SHIPPING_SANDBOX_MODE
            ? 'Dummy Kargo sandbox shipment creation is enabled.'
            : 'Live carrier execution is not enabled or verified.',
        ]
      : isTryOto
        ? [
            'Try OTO is sandbox-only in this phase.',
            TRY_OTO_WEBHOOK_SIGNATURE_WARNING,
            'Try OTO returns and production rollout are not implemented.',
          ]
        : isKargonomi
          ? [
              'Kargonomi forward shipment execution is enabled only when explicitly selected.',
              'Kargonomi return/reverse shipment is not implemented.',
            ]
          : [],
  };
}

export async function getShippingProviderReadinessDiagnostics(
  env: AppEnv,
  providerOverride?: ShippingProviderDto,
  vendorId?: string | null,
): Promise<ShippingProviderGateDiagnosticsDto> {
  const diagnostics = getShippingProviderGateDiagnostics(env, providerOverride);
  if (
    (diagnostics.provider !== 'kargo_entegrator' &&
      diagnostics.provider !== 'try_oto' &&
      diagnostics.provider !== 'kargonomi') ||
    !vendorId
  ) {
    return diagnostics;
  }

  const config = mapShippingConfig(await getStoredShippingConfig(vendorId), vendorId);
  const configProviderSelected = mapProvider(config.preferredProvider) === diagnostics.provider;
  if (diagnostics.provider === 'try_oto') {
    const pickupLocationCodeConfigured = Boolean(resolveTryOtoPickupLocationCode(config.providerMetadata));
    const originCityConfigured = Boolean(resolveTryOtoOriginCity(config.providerMetadata));
    const defaultDesiConfigured = Number(config.defaultDesi) > 0;
    const missing = [
      ...diagnostics.missing,
      !pickupLocationCodeConfigured ? 'VENDOR_TRY_OTO_PICKUP_LOCATION_CODE' : null,
      !originCityConfigured ? 'VENDOR_TRY_OTO_ORIGIN_CITY' : null,
      !defaultDesiConfigured ? 'VENDOR_DEFAULT_DESI' : null,
    ].filter((value): value is string => Boolean(value));

    return {
      ...diagnostics,
      providerSelected: configProviderSelected,
      executionReady: diagnostics.executionReady && pickupLocationCodeConfigured && originCityConfigured && defaultDesiConfigured,
      warehouseIdConfigured: pickupLocationCodeConfigured,
      defaultDesiConfigured,
      missing,
    };
  }

  if (diagnostics.provider === 'kargonomi') {
    const warehouseIdConfigured = Boolean(resolveKargonomiWarehouseId(config, env));
    const defaultDesiConfigured = Number(config.defaultDesi) > 0;
    const missing = [
      ...diagnostics.missing,
      !warehouseIdConfigured ? 'VENDOR_KARGONOMI_WAREHOUSE_ID' : null,
      !defaultDesiConfigured ? 'VENDOR_DEFAULT_DESI' : null,
    ].filter((value): value is string => Boolean(value));

    return {
      ...diagnostics,
      providerSelected: configProviderSelected,
      executionReady:
        diagnostics.executionReady &&
        configProviderSelected &&
        warehouseIdConfigured &&
        defaultDesiConfigured,
      warehouseIdConfigured,
      defaultDesiConfigured,
      missing,
    };
  }

  const warehouse = selectDefaultWarehouse(config, diagnostics.provider);
  const cargoIntegrationIdConfigured = Boolean(config.cargoIntegrationId ?? env.KARGO_ENTEGRATOR_CARGO_INTEGRATION_ID);
  const warehouseIdConfigured = Boolean(warehouse?.warehouseId ?? config.defaultWarehouseId);
  const defaultDesiConfigured = Number(config.defaultDesi) > 0;
  const missing = [
    ...diagnostics.missing,
    !cargoIntegrationIdConfigured ? 'VENDOR_CARGO_INTEGRATION_ID' : null,
    !warehouseIdConfigured ? 'VENDOR_WAREHOUSE_ID' : null,
    !defaultDesiConfigured ? 'VENDOR_DEFAULT_DESI' : null,
  ].filter((value): value is string => Boolean(value));

  return {
    ...diagnostics,
    providerSelected: configProviderSelected,
    executionReady:
      diagnostics.executionReady &&
      cargoIntegrationIdConfigured &&
      warehouseIdConfigured &&
      defaultDesiConfigured,
    cargoIntegrationIdConfigured,
    warehouseIdConfigured,
    defaultDesiConfigured,
    packageTypeUsed: resolveKargoPackageType(config.providerMetadata),
    missing,
  };
}

function hasDryRunRetryMarker(snapshot: unknown) {
  if (!isRecord(snapshot)) {
    return false;
  }

  return snapshot.dryRun === true || (Array.isArray(snapshot.disabledGates) && snapshot.disabledGates.length > 0);
}

function assertDryRunRetryEligible(execution: ShipmentExecution) {
  if (execution.shipmentStatus !== ShipmentExecutionStatus.PENDING) {
    throw new Error('Only pending dry-run shipment executions can be retried.');
  }

  if (execution.providerShipmentId) {
    throw new Error('Shipment execution already has a provider shipment id and cannot be retried.');
  }

  if (execution.trackingNumber) {
    throw new Error('Shipment execution already has tracking and cannot be retried.');
  }

  if (!hasDryRunRetryMarker(execution.responseSnapshot)) {
    throw new Error('Only dry-run shipment executions can be retried.');
  }
}

function buildProviderFailureSnapshot(error: unknown, provider: ShippingProvider, baseSnapshot?: unknown) {
  const base = isRecord(baseSnapshot) ? baseSnapshot : {};
  const snapshot: Record<string, unknown> = error instanceof ShippingProviderExecutionError
    ? {
        ...base,
        ...error.responseSnapshot,
        error: error.message,
      }
    : {
        ...base,
        error: error instanceof Error ? error.message : 'Shipping provider execution failed.',
        provider,
      };
  const status = typeof snapshot.status === 'number' ? snapshot.status : null;
  const providerError = readString(snapshot, ['providerError', 'error', 'message', 'reason']) ?? '';
  const detectedFormat = readString(snapshot, ['detectedResponseFormat']) ?? '';
  const validationErrors = Array.isArray(snapshot.providerValidationErrors)
    ? snapshot.providerValidationErrors.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : [];
  const lowerError = providerError.toLowerCase();
  const label =
    validationErrors.length > 0 || status === 400 || status === 422
      ? 'Provider validation failed'
      : lowerError.includes('integration')
        ? 'Invalid integration'
        : detectedFormat === 'html' || detectedFormat === 'invalid_json'
          ? 'Malformed provider response'
          : status && status >= 400
            ? 'Provider rejected request'
            : 'Provider execution failed';

  return appendTimelineEvent(snapshot, {
    label,
    status: status ? String(status) : 'failed',
  });
}

function readTryOtoForwardDeliveryOptionMetadata(snapshot: Record<string, unknown>) {
  const deliveryOptionId = readString(snapshot, [
    'forwardDeliveryOptionId',
    'selectedDeliveryOptionId',
    'deliveryOptionId',
  ]);
  return {
    deliveryOptionId,
    source: readString(snapshot, ['forwardDeliveryOptionIdSource']),
    persistedAt: readString(snapshot, ['forwardDeliveryOptionPersistedAt']),
    retainedAfterWebhook: readBoolean(snapshot, ['forwardDeliveryOptionRetainedAfterWebhook']),
    retainedAfterStatusRefresh: readBoolean(snapshot, ['forwardDeliveryOptionRetainedAfterStatusRefresh']),
  };
}

function getTryOtoAsyncContextFromError(error: unknown, requestSnapshot: unknown) {
  if (!(error instanceof ShippingProviderExecutionError)) {
    return null;
  }

  const snapshot = error.responseSnapshot;
  if (readString(snapshot, ['provider']) !== 'try_oto') {
    return null;
  }

  const request = isRecord(requestSnapshot) ? requestSnapshot : {};
  const orderId = readString(request, ['orderId']);
  const createOrder = isRecord(snapshot.createOrder) ? snapshot.createOrder : null;
  const createShipment = isRecord(snapshot.createShipment) ? snapshot.createShipment : null;
  const providerErrorCode = (
    readString(snapshot, ['providerErrorCode', 'errorCode', 'otoErrorCode', 'code']) ??
    readString(createShipment, ['providerErrorCode', 'errorCode', 'otoErrorCode', 'code'])
  )?.toUpperCase();
  const validationErrors = Array.isArray(snapshot.providerValidationErrors)
    ? snapshot.providerValidationErrors.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : [];
  const createShipmentValidationErrors = Array.isArray(createShipment?.providerValidationErrors)
    ? createShipment.providerValidationErrors.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : [];
  const providerError = [
    readString(snapshot, ['providerError', 'error', 'message', 'reason']),
    readString(createShipment, ['providerError', 'error', 'message', 'reason']),
  ].filter(Boolean).join(' ').toLowerCase();
  const isNonRecoverable =
    providerErrorCode === 'OTO1010' ||
    validationErrors.length > 0 ||
    createShipmentValidationErrors.length > 0 ||
    providerError.includes('delivery option is not available') ||
    providerError.includes('validation');

  if (!orderId || !createOrder || createOrder.ok === false || isNonRecoverable) {
    return null;
  }

  return {
    orderId,
    snapshot,
  };
}

async function persistTryOtoAsyncShipmentContext(input: {
  executionId: string;
  allocation: {
    id: string;
    fulfillmentStatus: string;
  };
  error: unknown;
  requestSnapshot: unknown;
  baseSnapshot?: unknown;
}) {
  const context = getTryOtoAsyncContextFromError(input.error, input.requestSnapshot);
  if (!context) {
    return null;
  }

  const failureSnapshot = buildProviderFailureSnapshot(input.error, ShippingProvider.TRY_OTO, input.baseSnapshot);
  const forwardDeliveryOption = readTryOtoForwardDeliveryOptionMetadata(failureSnapshot);
  const responseSnapshot = appendTimelineEvent(
    {
      ...failureSnapshot,
      provider: 'try_oto',
      providerOrderId: context.orderId,
      orderId: context.orderId,
      ...(forwardDeliveryOption.deliveryOptionId
        ? {
            deliveryOptionId: forwardDeliveryOption.deliveryOptionId,
            forwardDeliveryOptionId: forwardDeliveryOption.deliveryOptionId,
            selectedDeliveryOptionId: forwardDeliveryOption.deliveryOptionId,
            forwardDeliveryOptionIdSource: forwardDeliveryOption.source ?? 'delivery_option_lookup',
            forwardDeliveryOptionPersistedAt: forwardDeliveryOption.persistedAt ?? 'async_recovery',
            selectedDeliveryOptionIdPresent: true,
          }
        : {}),
      tryOtoAsyncPending: true,
      effectiveShipmentStatus: 'created',
      providerMessage: 'Shipment was created. Tracking or label may still be processing.',
      lastProviderResponseAt: new Date().toISOString(),
    },
    {
      label: 'Try OTO shipment pending provider finalization',
      status: 'created',
    },
  );

  const updated = await prisma.$transaction(async (tx) => {
    const execution = await tx.shipmentExecution.update({
      where: {
        id: input.executionId,
      },
      data: {
        providerShipmentId: context.orderId,
        shipmentStatus: ShipmentExecutionStatus.CREATED,
        responseSnapshot: responseSnapshot as Prisma.InputJsonValue,
      },
    });

    await tx.vendorAllocation.update({
      where: {
        id: input.allocation.id,
      },
      data: {
        shippingStatus: allocationShippingStatus('created'),
        fulfillmentStatus: input.allocation.fulfillmentStatus === 'Pending' ? 'Processing' : input.allocation.fulfillmentStatus,
        carrier: 'try_oto',
      },
    });

    await tx.fulfillment.upsert({
      where: {
        vendorAllocationId: input.allocation.id,
      },
      update: {
        fulfillmentStatus: 'shipment_created',
        carrier: 'try_oto',
        shipmentUpdatedAt: new Date(),
        syncStatus: 'carrier_created',
        errorMessage: null,
      },
      create: {
        vendorAllocationId: input.allocation.id,
        fulfillmentStatus: 'shipment_created',
        carrier: 'try_oto',
        shipmentCreatedAt: new Date(),
        shipmentUpdatedAt: new Date(),
        syncStatus: 'carrier_created',
      },
    });

    return execution;
  });

  return mapShipmentExecution(updated);
}

function assertFailedRetryEligible(execution: ShipmentExecution) {
  if (execution.shipmentStatus !== ShipmentExecutionStatus.FAILED) {
    throw new Error('Only failed shipment executions can be retried.');
  }

  if (execution.providerShipmentId) {
    throw new Error('Shipment execution already has a provider shipment id and cannot be retried.');
  }

  if (execution.trackingNumber) {
    throw new Error('Shipment execution already has tracking and cannot be retried.');
  }

  if (execution.labelUrl) {
    throw new Error('Shipment execution already has a label and cannot be retried.');
  }
}

function getWebhookData(payload: unknown) {
  if (!isRecord(payload)) {
    return {};
  }

  if (isRecord(payload.data)) {
    return payload.data;
  }

  if (isRecord(payload.shipment)) {
    return payload.shipment;
  }

  return payload;
}

function normalizeProviderWebhookStatus(status: string | null) {
  const normalized = status?.trim().toLowerCase() ?? '';
  if (normalized === 'created') {
    return ShipmentExecutionStatus.CREATED;
  }
  if (normalized === 'non_processed' || normalized === 'non processed') {
    return ShipmentExecutionStatus.PENDING;
  }
  return null;
}

function normalizeTryOtoWebhookStatus(status: string | null) {
  const normalized = status?.trim().toLowerCase().replace(/\s+/g, '_') ?? '';
  if (!normalized) {
    return null;
  }

  if (['assignedtowarehouse', 'assigned_to_warehouse', 'created', 'shipment_created'].includes(normalized)) {
    return ShipmentExecutionStatus.CREATED;
  }
  if (normalized === 'pending') {
    return ShipmentExecutionStatus.PENDING;
  }
  if (normalized === 'in_transit') {
    return ShipmentExecutionStatus.IN_TRANSIT;
  }
  if (normalized === 'searchingdriver') {
    return ShipmentExecutionStatus.IN_TRANSIT;
  }
  if (normalized === 'delivered') {
    return ShipmentExecutionStatus.DELIVERED;
  }
  if (['cancelled', 'canceled'].includes(normalized)) {
    return ShipmentExecutionStatus.CANCELLED;
  }
  if (['returned', 'return'].includes(normalized)) {
    return ShipmentExecutionStatus.RETURNED;
  }

  return null;
}

function shipmentStatusRank(status: ShipmentExecutionStatus) {
  if (status === ShipmentExecutionStatus.PENDING) return 0;
  if (status === ShipmentExecutionStatus.CREATED) return 1;
  if (status === ShipmentExecutionStatus.IN_TRANSIT) return 2;
  if (status === ShipmentExecutionStatus.DELIVERED) return 3;
  if (
    status === ShipmentExecutionStatus.CANCELLED ||
    status === ShipmentExecutionStatus.RETURNED
  ) {
    return 4;
  }
  return 0;
}

function chooseWebhookStatus(existing: ShipmentExecutionStatus, incoming: ShipmentExecutionStatus | null) {
  if (!incoming) {
    return existing;
  }

  return shipmentStatusRank(incoming) >= shipmentStatusRank(existing) ? incoming : existing;
}

function readTryOtoWebhookIdentifiers(data: Record<string, unknown>) {
  const orderId = readString(data, ['orderId', 'order_id']);
  const providerOrderId = readString(data, ['providerOrderId', 'otoId', 'oto_id']);
  const shipmentId = readString(data, ['shipmentId', 'shipment_id', 'id']);
  const trackingNumber = readString(data, ['trackingNumber', 'tracking_number', 'trackingNo']);
  const dcTrackingNumber = readString(data, ['dcTrackingNumber', 'dc_tracking_number']);

  return {
    orderId,
    providerOrderId,
    shipmentId,
    trackingNumber,
    dcTrackingNumber,
    candidates: Array.from(
      new Set([orderId, providerOrderId, shipmentId, trackingNumber, dcTrackingNumber].filter((value): value is string => Boolean(value))),
    ),
  };
}

function readTryOtoWebhookBarcode(data: Record<string, unknown>) {
  return readString(data, ['barcode', 'barcodeNumber', 'barCode', 'awbNumber']);
}

function hasTryOtoReference(value: string | null, ...records: Record<string, unknown>[]) {
  if (!value) {
    return false;
  }

  return records.some((record) =>
    ['orderId', 'externalOrderReference', 'internalOrderReference', 'providerOrderId', 'otoId', 'shipmentId']
      .some((key) => readString(record, [key]) === value),
  );
}

function getTryOtoWebhookPayloadKeys(payload: unknown, data: Record<string, unknown>) {
  if (isRecord(payload)) {
    return Object.keys(payload).sort();
  }

  return Object.keys(data).sort();
}

function resolveTryOtoWebhookMatchedByField(
  execution: ShipmentExecution,
  identifiers: ReturnType<typeof readTryOtoWebhookIdentifiers>,
) {
  const requestSnapshot = isRecord(execution.requestSnapshot) ? execution.requestSnapshot : {};
  const responseSnapshot = readSnapshot(execution);
  const returnShipmentSnapshot = isRecord(responseSnapshot.returnShipment) ? responseSnapshot.returnShipment : {};
  if (identifiers.shipmentId && execution.providerShipmentId === identifiers.shipmentId) return 'shipmentId';
  if (identifiers.providerOrderId && execution.providerShipmentId === identifiers.providerOrderId) return 'providerOrderId';
  if (identifiers.orderId && execution.providerShipmentId === identifiers.orderId) return 'orderId';
  if (identifiers.trackingNumber && execution.trackingNumber === identifiers.trackingNumber) return 'trackingNumber';
  if (identifiers.dcTrackingNumber && execution.trackingNumber === identifiers.dcTrackingNumber) return 'dcTrackingNumber';
  if (
    identifiers.orderId &&
    (resolveTryOtoStatusOrderId(execution) === identifiers.orderId ||
      hasTryOtoReference(identifiers.orderId, requestSnapshot, responseSnapshot, returnShipmentSnapshot))
  ) {
    return 'orderId';
  }
  if (
    identifiers.providerOrderId &&
    (readString(requestSnapshot, ['providerOrderId', 'otoId']) === identifiers.providerOrderId ||
      readString(responseSnapshot, ['providerOrderId', 'otoId']) === identifiers.providerOrderId ||
      readString(returnShipmentSnapshot, ['returnOrderId']) === identifiers.providerOrderId)
  ) {
    return 'providerOrderId';
  }
  if (
    identifiers.shipmentId &&
    (readString(requestSnapshot, ['shipmentId']) === identifiers.shipmentId ||
      readString(responseSnapshot, ['shipmentId']) === identifiers.shipmentId)
  ) {
    return 'shipmentId';
  }

  return 'snapshot';
}

function getTryOtoWebhookParseError(payload: unknown, data: Record<string, unknown>) {
  if (!isRecord(payload)) {
    return 'Webhook payload body was not an object.';
  }

  if (!Object.keys(data).length) {
    return 'Webhook payload did not include parseable object fields.';
  }

  return null;
}

function buildTryOtoWebhookFingerprint(input: {
  identifiers: ReturnType<typeof readTryOtoWebhookIdentifiers>;
  providerStatus: string | null;
  trackingUrl: string | null;
  labelUrl: string | null;
}) {
  return [
    'try_oto_webhook',
    input.identifiers.orderId ?? '',
    input.identifiers.providerOrderId ?? '',
    input.identifiers.shipmentId ?? '',
    input.identifiers.trackingNumber ?? '',
    input.identifiers.dcTrackingNumber ?? '',
    input.providerStatus ?? '',
    input.trackingUrl ?? '',
    input.labelUrl ?? '',
  ].join('|');
}

function matchesTryOtoExecution(execution: ShipmentExecution, candidates: string[]) {
  if (!candidates.length) {
    return false;
  }

  const requestSnapshot = isRecord(execution.requestSnapshot) ? execution.requestSnapshot : {};
  const responseSnapshot = readSnapshot(execution);
  const returnShipmentSnapshot = isRecord(responseSnapshot.returnShipment) ? responseSnapshot.returnShipment : {};
  const executionCandidates = [
    execution.providerShipmentId,
    execution.trackingNumber,
    resolveTryOtoStatusOrderId(execution),
    ...['orderId', 'externalOrderReference', 'internalOrderReference', 'providerOrderId', 'otoId', 'shipmentId']
      .flatMap((key) => [readString(requestSnapshot, [key]), readString(responseSnapshot, [key])]),
    ...['returnOrderId', 'trackingNumber', 'returnTrackingNumber', 'barcode', 'returnBarcode']
      .map((key) => readString(returnShipmentSnapshot, [key])),
  ].filter((value): value is string => Boolean(value));

  return executionCandidates.some((value) => candidates.includes(value));
}

export async function ingestKargoEntegratorWebhook(
  payload: unknown,
  options: {
    env: AppEnv;
  },
): Promise<{ ok: true; shipmentExecutionId: string; shipmentStatus: ShipmentExecutionDto['shipmentStatus'] } | { ok: false; message: string }> {
  if (!options.env.SHIPPING_SANDBOX_MODE || !options.env.KARGO_ENTEGRATOR_WEBHOOK_INGEST_ENABLED) {
    return {
      ok: false,
      message: 'Kargo Entegratör webhook ingestion is not implemented yet.',
    };
  }

  const data = getWebhookData(payload);
  const providerShipmentId = readString(data, ['providerShipmentId', 'shipmentId', 'id', 'cargoId']);
  const allocationId = readString(data, ['allocationId', 'allocation_id']);
  const trackingNumber = readString(data, ['tracking_number', 'trackingNumber', 'trackingNo', 'cargoTrackingNo']);
  const trackingUrl = readString(data, ['tracking_url', 'trackingUrl', 'trackingLink', 'cargoTrackingUrl']);
  const barcode = readString(data, ['barcode', 'barcodeNumber', 'barcode_number']);
  const providerStatus = readString(data, ['status', 'shipmentStatus', 'cargoStatus']) ?? (trackingNumber ? 'tracking_assigned' : null);
  const normalizedStatus = normalizeProviderWebhookStatus(providerStatus);
  if (!providerShipmentId && !allocationId) {
    return {
      ok: false,
      message: 'Kargo Entegratör webhook did not include a shipment or allocation identifier.',
    };
  }

  const execution = await prisma.shipmentExecution.findFirst({
    where: {
      provider: ShippingProvider.KARGO_ENTEGRATOR,
      OR: [
        providerShipmentId ? { providerShipmentId } : undefined,
        allocationId ? { allocationId } : undefined,
      ].filter((entry): entry is NonNullable<typeof entry> => Boolean(entry)),
    },
  });

  if (!execution) {
    return {
      ok: false,
      message: 'Shipment execution could not be matched for the Kargo Entegratör webhook.',
    };
  }

  const snapshot = appendTimelineEvent(
    {
      ...readSnapshot(execution),
      webhookReceived: true,
      dummyCarrierDetected: true,
      providerStatus,
      barcode: barcode ?? readString(readSnapshot(execution), ['barcode', 'barcodeNumber']),
      lastProviderResponseAt: new Date().toISOString(),
      responseKeys: Object.keys(data).sort(),
    },
    {
      label: trackingNumber ? 'Tracking assigned' : barcode ? 'Barcode assigned' : 'Provider status update',
      status: providerStatus,
    },
  );

  const updated = await prisma.shipmentExecution.update({
    where: {
      id: execution.id,
    },
    data: {
      providerShipmentId: execution.providerShipmentId ?? providerShipmentId,
      trackingNumber: execution.trackingNumber ?? trackingNumber,
      trackingUrl: execution.trackingUrl ?? trackingUrl,
      shipmentStatus: normalizedStatus ?? execution.shipmentStatus,
      responseSnapshot: snapshot as Prisma.InputJsonValue,
    },
  });

  return {
    ok: true,
    shipmentExecutionId: updated.id,
    shipmentStatus: mapStatus(updated.shipmentStatus),
  };
}

export async function ingestTryOtoWebhook(
  payload: unknown,
  options: {
    env: AppEnv;
    httpMethod?: string | null;
    contentType?: string | null;
  },
): Promise<
  | {
      ok: true;
      matched: boolean;
      matchStatus: 'matched' | 'unmatched';
      shipmentExecutionId: string | null;
      shipmentStatus: ShipmentExecutionDto['shipmentStatus'] | null;
      signatureVerificationImplemented: false;
      warning: string;
    }
  | { ok: false; code: number; message: string }
> {
  const data = getWebhookData(payload);
  const payloadKeys = getTryOtoWebhookPayloadKeys(payload, data);
  const parseError = getTryOtoWebhookParseError(payload, data);
  const providerStatus = readString(data, ['status', 'dcStatus', 'orderStatus', 'shipmentStatus', 'state', 'statusField']);
  updateTryOtoWebhookReceiveDiagnostics({
    received: true,
    receivedAt: new Date().toISOString(),
    httpMethod: options.httpMethod ?? null,
    contentType: options.contentType ?? null,
    payloadKeys,
    matchedShipment: null,
    matchStatus: parseError ? 'parse_error' : null,
    matchedByField: null,
    statusValue: providerStatus,
    statusMapped: null,
    mappedLocalStatus: null,
    parseError,
    signatureVerificationImplemented: false,
  });

  if (!options.env.TRY_OTO_ENABLED || !options.env.TRY_OTO_WEBHOOK_INGEST_ENABLED) {
    updateTryOtoWebhookReceiveDiagnostics({
      matchedShipment: false,
      matchStatus: 'disabled',
      statusMapped: null,
      mappedLocalStatus: null,
    });
    return {
      ok: false,
      code: 501,
      message: 'Try OTO webhook ingestion is disabled.',
    };
  }

  const responseKeys = Object.keys(data).sort();
  const identifiers = readTryOtoWebhookIdentifiers(data);
  const normalizedStatus = normalizeTryOtoWebhookStatus(providerStatus);
  const trackingUrl = readString(data, ['trackingUrl', 'tracking_url', 'trackingLink', 'tracking_link', 'brandedTrackingURL']);
  const labelUrl = readString(data, [
    'printReturnAWBURL',
    'printReturnAWBUrl',
    'printReturnAwbURL',
    'printReturnAwbUrl',
    'printLabelURL',
    'printAWBURL',
    'labelUrl',
    'label_url',
    'awbUrl',
    'awbURL',
  ]);
  const carrierName = readString(data, ['deliveryCompany', 'deliveryCompanyName', 'deliveryOptionName', 'carrier', 'carrierName']);
  const isReverseShipment = readLooseBoolean(data, ['reverseShipment']);
  const signatureWarning = TRY_OTO_WEBHOOK_SIGNATURE_WARNING;

  if (!identifiers.candidates.length) {
    updateTryOtoWebhookReceiveDiagnostics({
      matchedShipment: false,
      matchStatus: parseError ? 'parse_error' : 'unmatched',
      matchedByField: null,
      statusValue: providerStatus,
      statusMapped: Boolean(normalizedStatus),
      mappedLocalStatus: normalizedStatus ? mapStatus(normalizedStatus) : null,
      parseError,
    });
    return {
      ok: true,
      matched: false,
      matchStatus: 'unmatched',
      shipmentExecutionId: null,
      shipmentStatus: null,
      signatureVerificationImplemented: false,
      warning: signatureWarning,
    };
  }

  let execution = await prisma.shipmentExecution.findFirst({
    where: {
      provider: ShippingProvider.TRY_OTO,
      OR: [
        identifiers.shipmentId ? { providerShipmentId: identifiers.shipmentId } : undefined,
        identifiers.providerOrderId ? { providerShipmentId: identifiers.providerOrderId } : undefined,
        identifiers.orderId ? { providerShipmentId: identifiers.orderId } : undefined,
        identifiers.trackingNumber ? { trackingNumber: identifiers.trackingNumber } : undefined,
        identifiers.dcTrackingNumber ? { trackingNumber: identifiers.dcTrackingNumber } : undefined,
      ].filter((entry): entry is NonNullable<typeof entry> => Boolean(entry)),
    },
  });

  if (!execution) {
    const recentTryOtoExecutions = await prisma.shipmentExecution.findMany({
      where: {
        provider: ShippingProvider.TRY_OTO,
      },
      orderBy: {
        updatedAt: 'desc',
      },
      take: 200,
    });
    execution = recentTryOtoExecutions.find((candidate) => matchesTryOtoExecution(candidate, identifiers.candidates)) ?? null;
  }

  if (!execution) {
    updateTryOtoWebhookReceiveDiagnostics({
      matchedShipment: false,
      matchStatus: 'unmatched',
      matchedByField: null,
      statusValue: providerStatus,
      statusMapped: Boolean(normalizedStatus),
      mappedLocalStatus: normalizedStatus ? mapStatus(normalizedStatus) : null,
      parseError,
    });
    return {
      ok: true,
      matched: false,
      matchStatus: 'unmatched',
      shipmentExecutionId: null,
      shipmentStatus: null,
      signatureVerificationImplemented: false,
      warning: signatureWarning,
    };
  }

  const fingerprint = buildTryOtoWebhookFingerprint({
    identifiers,
    providerStatus,
    trackingUrl,
    labelUrl,
  });
  const existingSnapshot = readSnapshot(execution);
  const existingForwardDeliveryOption = readTryOtoForwardDeliveryOptionMetadata(existingSnapshot);
  const matchedByField = resolveTryOtoWebhookMatchedByField(execution, identifiers);
  const duplicateFingerprints = Array.isArray(existingSnapshot.timelineEventFingerprints)
    ? existingSnapshot.timelineEventFingerprints.filter((value): value is string => typeof value === 'string')
    : [];
  const isDuplicate = duplicateFingerprints.includes(fingerprint);
  if (isReverseShipment) {
    const existingReturnShipment = isRecord(existingSnapshot.returnShipment) ? existingSnapshot.returnShipment : {};
    const nextReturnTrackingNumber =
      readString(existingReturnShipment, ['trackingNumber', 'returnTrackingNumber']) ??
      identifiers.trackingNumber ??
      identifiers.dcTrackingNumber;
    const existingReturnLabelUrl = readTryOtoReturnLabelUrl(existingReturnShipment);
    const nextReturnLabelUrl = existingReturnLabelUrl ?? labelUrl;
    const nextReturnShipment = {
      ...existingReturnShipment,
      provider: 'try_oto',
      returnOrderId:
        readString(existingReturnShipment, ['returnOrderId']) ??
        identifiers.orderId ??
        identifiers.providerOrderId ??
        identifiers.shipmentId,
      trackingNumber: nextReturnTrackingNumber,
      trackingUrl: readTryOtoReturnTrackingUrl(existingReturnShipment) ?? trackingUrl,
      labelUrl: nextReturnLabelUrl,
      barcode: readString(existingReturnShipment, ['barcode', 'returnBarcode']) ?? readTryOtoWebhookBarcode(data) ?? nextReturnTrackingNumber,
      status: providerStatus ?? readString(existingReturnShipment, ['status', 'returnStatus']),
      updatedAt: new Date().toISOString(),
      responseKeys,
      trackingPresent: Boolean(nextReturnTrackingNumber),
      labelPresent: Boolean(nextReturnLabelUrl),
      labelRetrievalConfirmed: Boolean(nextReturnLabelUrl),
      labelRetrievalNote: nextReturnLabelUrl
        ? null
        : readString(existingReturnShipment, ['labelRetrievalNote']) ?? 'Return label is processing or not returned by Try OTO yet.',
      diagnostics: {
        ...(isRecord(existingReturnShipment.diagnostics) ? existingReturnShipment.diagnostics : {}),
        webhookReverseShipment: true,
        webhookReverseShipmentPrintAwbUrlPresent: Boolean(labelUrl),
        rawPrintReturnAwbUrlPresent: Boolean(readString(data, ['printReturnAWBURL', 'printReturnAWBUrl', 'printReturnAwbURL', 'printReturnAwbUrl'])),
        normalizedReturnLabelUrlPresent: Boolean(nextReturnLabelUrl),
        returnLabelPersistenceStage: labelUrl ? 'reverse_shipment_webhook' : 'existing_return_snapshot',
        returnLabelOverwrittenByStaleSnapshot: false,
        returnLabelSourceChecked: labelUrl ? 'reverseShipmentWebhook' : existingReturnLabelUrl ? 'existingReturnShipment' : 'reverseShipmentWebhook',
        printEndpointImplemented: false,
        statusValue: providerStatus,
        responseKeys,
      },
    };
    const reverseSnapshotBase = {
      ...existingSnapshot,
      provider: 'try_oto',
      webhookReceived: true,
      tryOtoWebhookReceived: true,
      lastTryOtoWebhookReceivedAt: new Date().toISOString(),
      lastTryOtoWebhookMatchStatus: 'matched',
      lastTryOtoWebhookMatchedByField: matchedByField,
      lastTryOtoWebhookHttpMethod: options.httpMethod ?? null,
      lastTryOtoWebhookContentType: options.contentType ?? null,
      lastTryOtoWebhookStatusField: providerStatus,
      lastTryOtoWebhookStatusMapped: Boolean(normalizedStatus),
      lastTryOtoWebhookMappedShipmentStatus: normalizedStatus ? mapStatus(normalizedStatus) : null,
      latestProviderStatusSource: 'webhook',
      lastTryOtoWebhookParseError: parseError,
      tryOtoWebhookSignatureVerificationImplemented: false,
      tryOtoWebhookWarning: signatureWarning,
      tryOtoWebhookResponseKeys: responseKeys,
      tryOtoWebhookReverseShipment: true,
      forwardDeliveryOptionRetainedAfterWebhook: Boolean(existingForwardDeliveryOption.deliveryOptionId),
      returnShipment: nextReturnShipment,
      lastProviderResponseAt: new Date().toISOString(),
    };
    const reverseReceivedSnapshot = appendTimelineEventOnce(
      reverseSnapshotBase,
      { label: 'Try OTO return webhook received', status: providerStatus },
      fingerprint,
    );
    const reverseFinalSnapshot = isDuplicate
      ? reverseReceivedSnapshot
      : appendTimelineEventOnce(
          {
            ...reverseReceivedSnapshot,
            timelineEventFingerprints: Array.isArray(reverseReceivedSnapshot.timelineEventFingerprints)
              ? reverseReceivedSnapshot.timelineEventFingerprints
              : duplicateFingerprints,
          },
          { label: labelUrl ? 'Try OTO return label updated' : 'Try OTO return status updated', status: providerStatus },
          `${fingerprint}|return_updated`,
        );

    const updated = await prisma.shipmentExecution.update({
      where: {
        id: execution.id,
      },
      data: {
        responseSnapshot: reverseFinalSnapshot as Prisma.InputJsonValue,
      },
    });

    updateTryOtoWebhookReceiveDiagnostics({
      matchedShipment: true,
      matchStatus: 'matched',
      matchedByField,
      statusValue: providerStatus,
      statusMapped: Boolean(normalizedStatus),
      mappedLocalStatus: normalizedStatus ? mapStatus(normalizedStatus) : null,
      parseError,
    });

    return {
      ok: true,
      matched: true,
      matchStatus: 'matched',
      shipmentExecutionId: updated.id,
      shipmentStatus: mapStatus(updated.shipmentStatus),
      signatureVerificationImplemented: false,
      warning: signatureWarning,
    };
  }

  const nextStatus = chooseWebhookStatus(execution.shipmentStatus, normalizedStatus);
  const nextTrackingNumber = execution.trackingNumber ?? identifiers.trackingNumber ?? identifiers.dcTrackingNumber;
  const nextProviderShipmentId = execution.providerShipmentId ?? identifiers.shipmentId ?? identifiers.providerOrderId ?? identifiers.orderId;
  const webhookSnapshotBase = {
    ...existingSnapshot,
    provider: 'try_oto',
    webhookReceived: true,
    tryOtoWebhookReceived: true,
    lastTryOtoWebhookReceivedAt: new Date().toISOString(),
    lastTryOtoWebhookMatchStatus: 'matched',
    lastTryOtoWebhookMatchedByField: matchedByField,
    lastTryOtoWebhookHttpMethod: options.httpMethod ?? null,
    lastTryOtoWebhookContentType: options.contentType ?? null,
    lastTryOtoWebhookStatusField: providerStatus,
    lastTryOtoWebhookStatusMapped: Boolean(normalizedStatus),
    lastTryOtoWebhookMappedShipmentStatus: normalizedStatus ? mapStatus(normalizedStatus) : null,
    latestProviderStatusSource: 'webhook',
    lastTryOtoWebhookParseError: parseError,
    tryOtoWebhookSignatureVerificationImplemented: false,
    tryOtoWebhookWarning: signatureWarning,
    tryOtoWebhookResponseKeys: responseKeys,
    providerStatus: providerStatus ?? readString(existingSnapshot, ['providerStatus', 'statusField', 'shipmentStatus', 'cargoStatus']),
    selectedDeliveryCompanyName: carrierName ?? readString(existingSnapshot, ['selectedDeliveryCompanyName', 'deliveryCompanyName']),
    forwardDeliveryOptionRetainedAfterWebhook: Boolean(existingForwardDeliveryOption.deliveryOptionId),
    lastProviderResponseAt: new Date().toISOString(),
  };
  const receivedSnapshot = appendTimelineEventOnce(
    webhookSnapshotBase,
    { label: 'Try OTO webhook received', status: providerStatus },
    fingerprint,
  );
  const finalSnapshot = isDuplicate
    ? receivedSnapshot
    : appendTimelineEventOnce(
        {
          ...receivedSnapshot,
          timelineEventFingerprints: Array.isArray(receivedSnapshot.timelineEventFingerprints)
            ? receivedSnapshot.timelineEventFingerprints
            : duplicateFingerprints,
        },
        { label: 'Try OTO status updated', status: providerStatus },
        `${fingerprint}|status_updated`,
      );

  const updated = await prisma.shipmentExecution.update({
    where: {
      id: execution.id,
    },
    data: {
      providerShipmentId: nextProviderShipmentId,
      trackingNumber: nextTrackingNumber,
      trackingUrl: execution.trackingUrl ?? trackingUrl,
      labelUrl: execution.labelUrl ?? labelUrl,
      shipmentStatus: nextStatus,
      responseSnapshot: finalSnapshot as Prisma.InputJsonValue,
    },
  });

  updateTryOtoWebhookReceiveDiagnostics({
    matchedShipment: true,
    matchStatus: 'matched',
    matchedByField,
    statusValue: providerStatus,
    statusMapped: Boolean(normalizedStatus),
    mappedLocalStatus: normalizedStatus ? mapStatus(normalizedStatus) : null,
    parseError,
  });

  return {
    ok: true,
    matched: true,
    matchStatus: 'matched',
    shipmentExecutionId: updated.id,
    shipmentStatus: mapStatus(updated.shipmentStatus),
    signatureVerificationImplemented: false,
    warning: signatureWarning,
  };
}

async function persistProviderShipmentResult(input: {
  executionId: string;
  allocation: {
    id: string;
    assignedVendorId: string;
    sourceShopifyOrderId: string;
    fulfillmentStatus: string;
    fulfillment: {
      shopifyFulfillmentId: string | null;
      shipmentCreatedAt: Date | null;
    } | null;
  };
  provider: ShippingProvider;
  result: Awaited<ReturnType<ShippingProviderAdapter['createShipment']>>;
}) {
  const { allocation, executionId, provider, result } = input;
  const providerCreated = Boolean(result.providerShipmentId || result.trackingNumber || result.labelUrl);
  const status = providerCreated ? mapProviderStatus(result.shipmentStatus === 'pending' ? 'created' : result.shipmentStatus) : ShipmentExecutionStatus.PENDING;
  const shippingVatPercent = SHIPPING_VAT_PERCENT;
  const shippingVat =
    result.shippingVat ??
    (result.shippingCost === null ? null : Number((result.shippingCost * (shippingVatPercent / 100)).toFixed(2)));
  const responseSnapshot = appendTimelineEvent(
    {
      ...result.responseSnapshot,
      providerStatus: readString(result.responseSnapshot, ['statusField', 'shipmentStatus', 'cargoStatus']),
    },
    {
      label: 'Shipment created',
      status: result.shipmentStatus,
    },
  );

  const updated = await prisma.$transaction(async (tx) => {
    const execution = await tx.shipmentExecution.update({
      where: {
        id: executionId,
      },
      data: {
        providerShipmentId: result.providerShipmentId,
        trackingNumber: result.trackingNumber,
        trackingUrl: result.trackingUrl,
        labelUrl: result.labelUrl,
        shipmentStatus: status,
        shippingCost: result.shippingCost,
        shippingVat,
        currency: result.currency,
        responseSnapshot: responseSnapshot as Prisma.InputJsonValue,
      },
    });

    if (providerCreated) {
      const shipmentUpdatedAt = new Date();
      await tx.vendorAllocation.update({
        where: {
          id: allocation.id,
        },
        data: {
          shippingStatus: allocationShippingStatus(mapStatus(status)),
          fulfillmentStatus: allocation.fulfillmentStatus === 'Pending' ? 'Processing' : allocation.fulfillmentStatus,
          trackingNumber: result.trackingNumber,
          carrier: mapProvider(provider),
        },
      });
      await tx.fulfillment.upsert({
        where: {
          vendorAllocationId: allocation.id,
        },
        update: {
          fulfillmentStatus: 'shipment_created',
          trackingNumber: result.trackingNumber,
          carrier: mapProvider(provider),
          trackingUrl: result.trackingUrl,
          shipmentCreatedAt: allocation.fulfillment?.shipmentCreatedAt ?? shipmentUpdatedAt,
          shipmentUpdatedAt,
          syncStatus: 'carrier_created',
          errorMessage: null,
        },
        create: {
          vendorAllocationId: allocation.id,
          fulfillmentStatus: 'shipment_created',
          trackingNumber: result.trackingNumber,
          carrier: mapProvider(provider),
          trackingUrl: result.trackingUrl,
          shipmentCreatedAt: shipmentUpdatedAt,
          shipmentUpdatedAt,
          syncStatus: 'carrier_created',
        },
      });
    }

    if (result.shippingCost !== null) {
      const providerReference = result.providerShipmentId ?? result.trackingNumber ?? execution.id;
      await tx.shipmentShippingCost.upsert({
        where: {
          id: buildShippingCostId({
            vendorId: allocation.assignedVendorId,
            allocationId: allocation.id,
            provider,
            providerReference,
          }),
        },
        update: {
          providerName: mapProvider(provider),
          providerReference,
          shippingCost: result.shippingCost,
          shippingVatAmount: shippingVat,
          currency: result.currency,
          status: 'CONFIRMED',
          sourceType: 'EXTERNAL_PROVIDER',
        },
        create: {
          id: buildShippingCostId({
            vendorId: allocation.assignedVendorId,
            allocationId: allocation.id,
            provider,
            providerReference,
          }),
          vendorId: allocation.assignedVendorId,
          allocationId: allocation.id,
          sourceShopifyOrderId: allocation.sourceShopifyOrderId,
          sourceShopifyFulfillmentId: allocation.fulfillment?.shopifyFulfillmentId ?? null,
          providerName: mapProvider(provider),
          providerReference,
          shippingCost: result.shippingCost,
          shippingVatAmount: shippingVat,
          currency: result.currency,
          status: 'CONFIRMED',
          sourceType: 'EXTERNAL_PROVIDER',
        },
      });

      return { ...execution, shippingCostLinked: true };
    }

    return execution;
  });

  return mapShipmentExecution(updated);
}

function resolveTryOtoStatusOrderId(execution: ShipmentExecution) {
  const requestSnapshot = isRecord(execution.requestSnapshot) ? execution.requestSnapshot : {};
  const responseSnapshot = readSnapshot(execution);
  return (
    readString(requestSnapshot, ['orderId', 'externalOrderReference']) ??
    readString(responseSnapshot, ['orderId', 'providerOrderId']) ??
    execution.providerShipmentId ??
    null
  );
}

function readTryOtoReturnShipmentSnapshot(execution: ShipmentExecution) {
  const snapshot = readSnapshot(execution);
  return isRecord(snapshot.returnShipment) ? snapshot.returnShipment : null;
}

function buildTryOtoReturnItemsFromSnapshot(snapshot: unknown) {
  const record = isRecord(snapshot) ? snapshot : {};
  const lines = Array.isArray(record.lines) ? record.lines : Array.isArray(record.items) ? record.items : [];
  return lines
    .filter(isRecord)
    .map((line) => {
      const sku = readString(line, ['sku']);
      const quantity = readString(line, ['quantity']) ?? '1';
      return sku ? { sku, quantity } : null;
    })
    .filter((item): item is { sku: string; quantity: string } => Boolean(item && Number(item.quantity) > 0));
}

function buildTryOtoReturnItemsFromAllocation(allocation: {
  lineItems?: Array<{
    quantity?: number | null;
    shopifyOrderLineItem?: {
      sourceLineItemId?: string | null;
      sku?: string | null;
    } | null;
  }>;
}) {
  return (allocation.lineItems ?? [])
    .map((lineItem) => {
      const sku = lineItem.shopifyOrderLineItem?.sku?.trim();
      if (!sku) {
        return null;
      }
      return {
        sku,
        quantity: String(lineItem.quantity ?? 1),
      };
    })
    .filter((item): item is { sku: string; quantity: string } => Boolean(item && Number(item.quantity) > 0));
}

function buildTryOtoReturnItemsFromApprovedReturns(allocation: {
  returnRecords?: Array<{
    status?: string | null;
    returnLifecycleStatus?: string | null;
    sourceShopifyLineItemId?: string | null;
  }>;
  lineItems?: Array<{
    quantity?: number | null;
    shopifyOrderLineItem?: {
      sourceLineItemId?: string | null;
      sku?: string | null;
    } | null;
  }>;
}) {
  const approvedLineItemIds = new Set(
    (allocation.returnRecords ?? [])
      .filter((record) => {
        const status = (record.returnLifecycleStatus ?? record.status ?? '').trim().toLowerCase();
        return status === 'approved';
      })
      .map((record) => record.sourceShopifyLineItemId?.trim())
      .filter((id): id is string => Boolean(id)),
  );

  if (approvedLineItemIds.size === 0) {
    return [];
  }

  return (allocation.lineItems ?? [])
    .filter((lineItem) => {
      const sourceLineItemId = lineItem.shopifyOrderLineItem?.sourceLineItemId?.trim();
      return Boolean(sourceLineItemId && approvedLineItemIds.has(sourceLineItemId));
    })
    .map((lineItem) => {
      const sku = lineItem.shopifyOrderLineItem?.sku?.trim();
      if (!sku) {
        return null;
      }
      return {
        sku,
        quantity: String(lineItem.quantity ?? 1),
      };
    })
    .filter((item): item is { sku: string; quantity: string } => Boolean(item && Number(item.quantity) > 0));
}

function resolveTryOtoReturnDeliveryOption(
  requestSnapshot: Record<string, unknown>,
  responseSnapshot: Record<string, unknown>,
) {
  const createShipmentRequestDiagnostics = isRecord(responseSnapshot.createShipmentRequestDiagnostics)
    ? responseSnapshot.createShipmentRequestDiagnostics
    : {};
  const forwardMetadata = readTryOtoForwardDeliveryOptionMetadata(responseSnapshot);

  const fromRequest = readString(requestSnapshot, ['deliveryOptionId']);
  if (fromRequest) {
    return {
      deliveryOptionId: fromRequest,
      source: 'request_snapshot',
      forwardSource: forwardMetadata.source ?? 'request_snapshot',
      persistedAt: forwardMetadata.persistedAt ?? 'request_snapshot',
      retainedAfterWebhook: forwardMetadata.retainedAfterWebhook,
      retainedAfterStatusRefresh: forwardMetadata.retainedAfterStatusRefresh,
    };
  }

  const fromForwardSnapshot = forwardMetadata.deliveryOptionId;
  if (fromForwardSnapshot) {
    return {
      deliveryOptionId: fromForwardSnapshot,
      source: forwardMetadata.source ?? 'forward_shipment_metadata',
      forwardSource: forwardMetadata.source ?? 'forward_shipment_metadata',
      persistedAt: forwardMetadata.persistedAt ?? 'forward_shipment_metadata',
      retainedAfterWebhook: forwardMetadata.retainedAfterWebhook,
      retainedAfterStatusRefresh: forwardMetadata.retainedAfterStatusRefresh,
    };
  }

  const fromCreateShipmentRequest = readString(createShipmentRequestDiagnostics, ['deliveryOptionId']);
  if (fromCreateShipmentRequest) {
    return {
      deliveryOptionId: fromCreateShipmentRequest,
      source: 'create_shipment_request_diagnostics',
      forwardSource: forwardMetadata.source ?? 'create_shipment_request_diagnostics',
      persistedAt: forwardMetadata.persistedAt ?? 'create_shipment_request',
      retainedAfterWebhook: forwardMetadata.retainedAfterWebhook,
      retainedAfterStatusRefresh: forwardMetadata.retainedAfterStatusRefresh,
    };
  }

  return {
    deliveryOptionId: null,
    source: null,
    forwardSource: forwardMetadata.source,
    persistedAt: forwardMetadata.persistedAt,
    retainedAfterWebhook: forwardMetadata.retainedAfterWebhook,
    retainedAfterStatusRefresh: forwardMetadata.retainedAfterStatusRefresh,
  };
}

function isTryOtoReturnAllowedByState(execution: ShipmentExecution, allocation: { fulfillmentStatus?: string | null }) {
  const shipmentStatus = mapStatus(execution.shipmentStatus);
  const fulfillmentStatus = allocation.fulfillmentStatus?.trim().toLowerCase() ?? '';
  return shipmentStatus === 'delivered' || fulfillmentStatus === 'fulfilled';
}

function toShopifyReturnGid(value: string | null) {
  if (!value) {
    return null;
  }
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }
  return normalized.startsWith('gid://shopify/Return/') ? normalized : `gid://shopify/Return/${normalized}`;
}

async function persistTryOtoReturnCreationSkipped(
  execution: ShipmentExecution,
  input: {
    skippedReason: 'missing_delivery_option_id' | 'missing_return_items' | 'missing_pickup_location_code';
    message: string;
    orderId: string | null;
    pickupLocationCode: string | null;
    deliveryOption: ReturnType<typeof resolveTryOtoReturnDeliveryOption>;
    itemCount: number;
    itemSkuPresent: boolean;
    itemQuantityPresent: boolean;
  },
) {
  const now = new Date().toISOString();
  const existingSnapshot = readSnapshot(execution);
  const forwardDeliveryOptionId = input.deliveryOption.deliveryOptionId;
  const returnShipment = {
    provider: 'try_oto',
    endpoint: '/rest/v2/createReturnShipment',
    returnOrderId: null,
    trackingNumber: null,
    trackingUrl: null,
    labelUrl: null,
    barcode: null,
    status: 'skipped',
    createdAt: now,
    requestKeys: [],
    responseKeys: [],
    trackingPresent: false,
    labelPresent: false,
    labelRetrievalConfirmed: false,
    labelRetrievalNote: input.message,
    finalized: false,
    labelRetrievable: false,
    providerStatusSource: 'createReturnShipment:blocked',
    diagnostics: {
      endpoint: '/rest/v2/createReturnShipment',
      httpStatus: null,
      requestKeys: [],
      responseKeys: [],
      returnProviderIdPresent: false,
      returnTrackingPresent: false,
      returnBarcodePresent: false,
      returnStatus: 'skipped',
      returnLabelPresent: false,
      returnItemSkuPresent: input.itemSkuPresent,
      returnItemQuantityPresent: input.itemQuantityPresent,
      createReturnShipmentFinalized: false,
      labelFieldPresent: false,
      providerMessage: input.message,
      returnSkippedReason: input.skippedReason,
      forwardDeliveryOptionIdPresent: Boolean(forwardDeliveryOptionId),
      forwardDeliveryOptionIdSource: input.deliveryOption.forwardSource,
      forwardDeliveryOptionPersistedAt: input.deliveryOption.persistedAt,
      forwardDeliveryOptionRetainedAfterWebhook: input.deliveryOption.retainedAfterWebhook,
      forwardDeliveryOptionRetainedAfterStatusRefresh: input.deliveryOption.retainedAfterStatusRefresh,
      returnDeliveryOptionIdPresent: Boolean(forwardDeliveryOptionId),
      returnDeliveryOptionIdSource: input.deliveryOption.source,
      pickupLocationCodePresent: Boolean(input.pickupLocationCode),
      returnDeliveryOptionLookupCalled: false,
      returnDeliveryOptionLookupImplemented: false,
      returnPriceLookupCalled: false,
      returnPriceLookupSuccess: false,
      returnPriceLookupOptionCount: null,
      selectedReturnPriceOptionIdPresent: false,
      reverseCreateShipmentCalled: false,
      reverseCreateShipmentSuccess: false,
      reverseCreateShipmentResponseKeys: [],
      reverseCreateShipmentTrackingPresent: false,
      reverseCreateShipmentBarcodePresent: false,
      reverseCreateShipmentLabelPresent: false,
      returnLabelSourceChecked: 'createReturnShipment:blocked',
      createReturnShipmentLabelFieldPresent: false,
      webhookReverseShipmentPrintAwbUrlPresent: false,
      printEndpointImplemented: true,
      returnFinalized: false,
      returnFinalizationEndpointConfirmed: false,
      returnFinalizeEndpointImplemented: false,
      returnLabelRetrievable: false,
      providerStatusSource: 'createReturnShipment:blocked',
      itemCount: input.itemCount,
      orderIdPresent: Boolean(input.orderId),
    },
  };
  const mergedSnapshot = appendTimelineEvent(
    {
      ...existingSnapshot,
      returnShipment,
      lastProviderResponseAt: now,
    },
    {
      label: 'Try OTO return shipment skipped',
      status: input.skippedReason,
    },
  );

  const updated = await prisma.shipmentExecution.update({
    where: {
      id: execution.id,
    },
    data: {
      responseSnapshot: mergedSnapshot as Prisma.InputJsonValue,
    },
  });

  return mapShipmentExecution(updated);
}

function buildShopifyReturnLabelUploadProbeSnapshot(input: {
  status: 'blocked' | 'success' | 'failed';
  attemptedAt: string;
  reverseFulfillmentOrderIdPresent?: boolean;
  reverseLineItemIdsPresent?: boolean;
  mutationUsed?: string | null;
  shopifyUserErrors?: Array<{ field: string[]; message: string }>;
  reverseDeliveryIdPresent?: boolean;
  shopifyReturnIdPresent?: boolean;
  trackingAccepted?: boolean;
  labelAccepted?: boolean;
  returnedCarrierName?: string | null;
  carrierNamePresent?: boolean;
  trackingOnlyMode?: boolean;
  labelInputSent?: boolean;
  shopifyCallAttempted?: boolean;
  skippedReason?: string | null;
  errorMessage?: string | null;
}) {
  return {
    status: input.status,
    attemptedAt: input.attemptedAt,
    reverseFulfillmentOrderIdPresent: Boolean(input.reverseFulfillmentOrderIdPresent),
    reverseLineItemIdsPresent: Boolean(input.reverseLineItemIdsPresent),
    mutationUsed: input.mutationUsed ?? null,
    shopifyUserErrors: input.shopifyUserErrors ?? [],
    reverseDeliveryIdPresent: Boolean(input.reverseDeliveryIdPresent),
    shopifyReturnIdPresent: Boolean(input.shopifyReturnIdPresent),
    trackingAccepted: Boolean(input.trackingAccepted),
    labelAccepted: Boolean(input.labelAccepted),
    returnedCarrierName: input.returnedCarrierName ?? null,
    carrierNamePresent: Boolean(input.carrierNamePresent),
    trackingOnlyMode: Boolean(input.trackingOnlyMode),
    labelInputSent: Boolean(input.labelInputSent),
    shopifyCallAttempted: Boolean(input.shopifyCallAttempted),
    skippedReason: input.skippedReason ?? null,
    errorMessage: input.errorMessage ?? null,
  };
}

async function persistShopifyReturnLabelUploadProbe(
  execution: ShipmentExecution,
  probe: ReturnType<typeof buildShopifyReturnLabelUploadProbeSnapshot>,
) {
  const snapshot = readSnapshot(execution);
  const existingReturnShipment = isRecord(snapshot.returnShipment) ? snapshot.returnShipment : {};
  const mergedSnapshot = appendTimelineEvent(
    {
      ...snapshot,
      returnShipment: {
        ...existingReturnShipment,
        shopifyReturnLabelUploadProbe: probe,
      },
      lastProviderResponseAt: probe.attemptedAt,
    },
    {
      label: probe.labelAccepted ? 'Shopify return label probe accepted' : 'Shopify return label probe recorded',
      status: probe.status,
    },
  );

  const updated = await prisma.shipmentExecution.update({
    where: {
      id: execution.id,
    },
    data: {
      responseSnapshot: mergedSnapshot as Prisma.InputJsonValue,
    },
  });

  return mapShipmentExecution(updated);
}

export async function createTryOtoReturnShipmentLabel(
  shipmentExecutionId: string,
  options: {
    env: AppEnv;
    vendorId: string;
    adapter?: ShippingProviderAdapter;
  },
): Promise<ShipmentExecutionDto> {
  const existing = await prisma.shipmentExecution.findUnique({
    where: {
      id: shipmentExecutionId,
    },
  });

  if (!existing || existing.vendorId !== options.vendorId) {
    throw new Error('Shipment execution not found.');
  }

  if (existing.provider !== ShippingProvider.TRY_OTO) {
    throw new Error('Return label creation is only available for Try OTO shipments.');
  }

  const existingReturnShipment = readTryOtoReturnShipmentSnapshot(existing);
  const existingReturnOrderId = readString(existingReturnShipment, ['returnOrderId', 'returnProviderId', 'providerReturnId', 'returnOtoId']);
  const existingReturnSkippedReason = readString(existingReturnShipment, ['skippedReason']) ??
    readString(isRecord(existingReturnShipment?.diagnostics) ? existingReturnShipment.diagnostics : {}, ['returnSkippedReason', 'skippedReason']);
  if (existingReturnShipment && (existingReturnOrderId || !existingReturnSkippedReason)) {
    return mapShipmentExecution(existing);
  }

  const allocation = await prisma.vendorAllocation.findUnique({
    where: {
      id: existing.allocationId,
    },
    include: {
      lineItems: {
        include: {
          shopifyOrderLineItem: true,
        },
      },
      returnRecords: true,
    },
  });

  if (!allocation || allocation.assignedVendorId !== existing.vendorId) {
    throw new Error('Allocation could not be found for the selected shipment execution.');
  }

  if (!isTryOtoReturnAllowedByState(existing, allocation)) {
    throw new Error('Try OTO return label creation requires a delivered or fulfilled shipment.');
  }

  const orderId = resolveTryOtoStatusOrderId(existing);
  if (!orderId || (!existing.trackingNumber && !existing.providerShipmentId)) {
    throw new Error('Try OTO return label creation requires a stored OTO order id or tracking reference.');
  }

  const requestSnapshot = isRecord(existing.requestSnapshot) ? existing.requestSnapshot : {};
  const responseSnapshot = readSnapshot(existing);
  const items = buildTryOtoReturnItemsFromSnapshot(requestSnapshot);
  const approvedReturnItems = buildTryOtoReturnItemsFromApprovedReturns(allocation);
  const fallbackItems = approvedReturnItems.length > 0
    ? approvedReturnItems
    : items.length > 0
      ? items
      : buildTryOtoReturnItemsFromAllocation(allocation);
  const pickupLocationCode = readString(requestSnapshot, ['pickupLocationCode']);
  const deliveryOption = resolveTryOtoReturnDeliveryOption(requestSnapshot, responseSnapshot);
  const itemSkuPresent = fallbackItems.length > 0 && fallbackItems.every((item) => Boolean(item.sku));
  const itemQuantityPresent = fallbackItems.length > 0 && fallbackItems.every((item) => Number(item.quantity) > 0);
  if (!deliveryOption.deliveryOptionId) {
    return persistTryOtoReturnCreationSkipped(existing, {
      skippedReason: 'missing_delivery_option_id',
      message: 'Try OTO return shipment was not created because deliveryOptionId is missing.',
      orderId,
      pickupLocationCode,
      deliveryOption,
      itemCount: fallbackItems.length,
      itemSkuPresent,
      itemQuantityPresent,
    });
  }
  if (!pickupLocationCode) {
    return persistTryOtoReturnCreationSkipped(existing, {
      skippedReason: 'missing_pickup_location_code',
      message: 'Try OTO return shipment was not created because pickupLocationCode is missing.',
      orderId,
      pickupLocationCode,
      deliveryOption,
      itemCount: fallbackItems.length,
      itemSkuPresent,
      itemQuantityPresent,
    });
  }
  if (fallbackItems.length === 0 || !itemSkuPresent || !itemQuantityPresent) {
    return persistTryOtoReturnCreationSkipped(existing, {
      skippedReason: 'missing_return_items',
      message: 'Try OTO return shipment was not created because returned item SKU or quantity is missing.',
      orderId,
      pickupLocationCode,
      deliveryOption,
      itemCount: fallbackItems.length,
      itemSkuPresent,
      itemQuantityPresent,
    });
  }

  const adapter = options.adapter ?? createShippingProviderAdapter(options.env, 'try_oto');
  if (!adapter.createReturnShipment) {
    throw new Error('Try OTO return shipment creation is not implemented for the selected provider adapter.');
  }

  const result = await adapter.createReturnShipment({
    orderId,
    items: fallbackItems,
    pickupLocationCode,
    deliveryOptionId: deliveryOption.deliveryOptionId,
    packageWeight: toNumber(existing.desi) ?? readNumber(requestSnapshot, ['packageWeight']) ?? 1,
  });
  const returnFinalized =
    readBoolean(result.responseSnapshot, ['returnFinalized', 'createReturnShipmentFinalized']) ||
    Boolean(result.returnLabelUrl);
  const returnLabelRetrievable = readBoolean(result.responseSnapshot, ['returnLabelRetrievable']) || Boolean(result.returnLabelUrl);
  const returnProviderStatusSource = readString(result.responseSnapshot, ['returnProviderStatusSource']) ?? 'createReturnShipment';
  const returnStatus = result.returnStatus ?? (returnFinalized ? 'created' : 'request_created');
  const returnShipment = {
    provider: 'try_oto',
    endpoint: '/rest/v2/createReturnShipment',
    returnOrderId: result.returnOrderId,
    trackingNumber: result.returnTrackingNumber,
    trackingUrl: result.returnTrackingUrl,
    labelUrl: result.returnLabelUrl,
    barcode: result.returnBarcode,
    carrierName: result.returnCarrierName ?? readString(result.responseSnapshot, ['returnCarrierName']),
    status: returnStatus,
    createdAt: new Date().toISOString(),
    requestKeys: readStringArray(result.responseSnapshot.requestKeys),
    responseKeys: readStringArray(result.responseSnapshot.bodyKeys),
    trackingPresent: Boolean(result.returnTrackingNumber),
    labelPresent: Boolean(result.returnLabelUrl),
    labelRetrievalConfirmed: returnLabelRetrievable,
    labelRetrievalNote:
      readString(result.responseSnapshot, ['returnLabelRetrievalNote']) ??
      (result.returnLabelUrl
        ? null
        : returnFinalized
          ? 'Return shipment finalized. Label PDF is not available yet.'
          : 'Return request created; waiting for Try OTO return shipment details.'),
    finalized: returnFinalized,
    labelRetrievable: returnLabelRetrievable,
    providerStatusSource: returnProviderStatusSource,
    diagnostics: {
      endpoint: '/rest/v2/createReturnShipment',
      httpStatus: typeof result.responseSnapshot.status === 'number' ? result.responseSnapshot.status : null,
      responseKeys: readStringArray(result.responseSnapshot.bodyKeys),
      requestKeys: readStringArray(result.responseSnapshot.requestKeys),
      returnProviderIdPresent: readBoolean(result.responseSnapshot, ['returnProviderIdPresent', 'returnOrderIdPresent']),
      returnTrackingPresent: Boolean(result.returnTrackingNumber),
      returnBarcodePresent: Boolean(result.returnBarcode),
      returnStatus,
      returnCarrierName: result.returnCarrierName ?? readString(result.responseSnapshot, ['returnCarrierName']),
      returnLabelPresent: Boolean(result.returnLabelUrl),
      returnItemSkuPresent: readBoolean(result.responseSnapshot, ['returnItemSkuPresent']),
      returnItemQuantityPresent: readBoolean(result.responseSnapshot, ['returnItemQuantityPresent']),
      createReturnShipmentFinalized: readBoolean(result.responseSnapshot, ['createReturnShipmentFinalized']) ?? returnFinalized,
      labelFieldPresent: readBoolean(result.responseSnapshot, ['createReturnShipmentLabelFieldPresent']),
      providerMessage: readString(result.responseSnapshot, ['providerError']),
      returnSkippedReason: null,
      forwardDeliveryOptionIdPresent: Boolean(deliveryOption.deliveryOptionId),
      forwardDeliveryOptionIdSource: deliveryOption.forwardSource,
      forwardDeliveryOptionPersistedAt: deliveryOption.persistedAt,
      forwardDeliveryOptionRetainedAfterWebhook: deliveryOption.retainedAfterWebhook,
      forwardDeliveryOptionRetainedAfterStatusRefresh: deliveryOption.retainedAfterStatusRefresh,
      returnDeliveryOptionIdPresent: readBoolean(result.responseSnapshot, ['returnDeliveryOptionIdPresent']),
      returnDeliveryOptionIdSource: deliveryOption.source,
      pickupLocationCodePresent: Boolean(pickupLocationCode),
      returnDeliveryOptionLookupCalled: readBoolean(result.responseSnapshot, ['returnDeliveryOptionLookupCalled']),
      returnDeliveryOptionLookupImplemented: readBoolean(result.responseSnapshot, ['returnDeliveryOptionLookupImplemented']),
      returnPriceLookupCalled: readBoolean(result.responseSnapshot, ['returnPriceLookupCalled']),
      returnPriceLookupSuccess: readBoolean(result.responseSnapshot, ['returnPriceLookupSuccess']),
      returnPriceLookupOptionCount: readNumber(result.responseSnapshot, ['returnPriceLookupOptionCount']),
      selectedReturnPriceOptionIdPresent: readBoolean(result.responseSnapshot, ['selectedReturnPriceOptionIdPresent']),
      reverseCreateShipmentCalled: readBoolean(result.responseSnapshot, ['reverseCreateShipmentCalled']),
      reverseCreateShipmentSuccess: readBoolean(result.responseSnapshot, ['reverseCreateShipmentSuccess']),
      reverseCreateShipmentResponseKeys: readStringArray(result.responseSnapshot.reverseCreateShipmentResponseKeys),
      reverseCreateShipmentTrackingPresent: readBoolean(result.responseSnapshot, ['reverseCreateShipmentTrackingPresent']),
      reverseCreateShipmentBarcodePresent: readBoolean(result.responseSnapshot, ['reverseCreateShipmentBarcodePresent']),
      reverseCreateShipmentLabelPresent: readBoolean(result.responseSnapshot, ['reverseCreateShipmentLabelPresent']),
      returnLabelSourceChecked: readString(result.responseSnapshot, ['returnLabelSourceChecked']) ?? 'createReturnShipment',
      returnTrackingSourceChecked: readString(result.responseSnapshot, ['returnTrackingSourceChecked']) ?? 'createReturnShipment',
      createReturnShipmentLabelFieldPresent: readBoolean(result.responseSnapshot, ['createReturnShipmentLabelFieldPresent']),
      rawPrintReturnAwbUrlPresent: readBoolean(result.responseSnapshot, ['rawPrintReturnAwbUrlPresent']),
      normalizedReturnLabelUrlPresent: Boolean(result.returnLabelUrl) || readBoolean(result.responseSnapshot, ['normalizedReturnLabelUrlPresent']),
      returnLabelPersistenceStage: readString(result.responseSnapshot, ['returnLabelPersistenceStage']) ?? 'createReturnShipment',
      returnLabelOverwrittenByStaleSnapshot: readBoolean(result.responseSnapshot, ['returnLabelOverwrittenByStaleSnapshot']),
      webhookReverseShipmentPrintAwbUrlPresent: readBoolean(result.responseSnapshot, ['webhookReverseShipmentPrintAwbUrlPresent']),
      printEndpointImplemented: readBoolean(result.responseSnapshot, ['printEndpointImplemented']),
      returnFinalized,
      returnFinalizationEndpointConfirmed: readBoolean(result.responseSnapshot, ['returnFinalizationEndpointConfirmed']),
      returnFinalizeEndpointImplemented: readBoolean(result.responseSnapshot, ['returnFinalizeEndpointImplemented']),
      returnLabelRetrievable,
      providerStatusSource: returnProviderStatusSource,
    },
  };
  const mergedSnapshot = appendTimelineEvent(
    {
      ...readSnapshot(existing),
      returnShipment,
      lastProviderResponseAt: new Date().toISOString(),
    },
    {
      label: returnFinalized ? 'Try OTO return shipment created' : 'Try OTO return request created',
      status: returnStatus,
    },
  );

  const updated = await prisma.shipmentExecution.update({
    where: {
      id: existing.id,
    },
    data: {
      responseSnapshot: mergedSnapshot as Prisma.InputJsonValue,
    },
  });

  return mapShipmentExecution(updated);
}

function buildTryOtoReturnDetailsProbeSnapshot(input: {
  status: 'blocked' | 'success' | 'no_label' | 'failed';
  attemptedAt: string;
  endpoint?: string | null;
  httpStatus?: number | null;
  responseKeys?: string[];
  nestedKeys?: string[];
  labelLikeFieldsPresent?: boolean;
  awbLikeFieldsPresent?: boolean;
  pdfLikeFieldsPresent?: boolean;
  urlLikeFieldsPresent?: boolean;
  trackingPresent?: boolean;
  barcodePresent?: boolean;
  providerStatus?: string | null;
  labelUrlPresent?: boolean;
  providerMessage?: string | null;
  actionUrlPresent?: boolean;
  errorMessage?: string | null;
}) {
  return {
    status: input.status,
    attemptedAt: input.attemptedAt,
    endpoint: input.endpoint ?? '/rest/v2/getReturnDetails',
    httpStatus: input.httpStatus ?? null,
    responseKeys: input.responseKeys ?? [],
    nestedKeys: input.nestedKeys ?? [],
    labelLikeFieldsPresent: Boolean(input.labelLikeFieldsPresent),
    awbLikeFieldsPresent: Boolean(input.awbLikeFieldsPresent),
    pdfLikeFieldsPresent: Boolean(input.pdfLikeFieldsPresent),
    urlLikeFieldsPresent: Boolean(input.urlLikeFieldsPresent),
    actionUrlPresent: Boolean(input.actionUrlPresent),
    trackingPresent: Boolean(input.trackingPresent),
    barcodePresent: Boolean(input.barcodePresent),
    providerStatus: input.providerStatus ?? null,
    labelUrlPresent: Boolean(input.labelUrlPresent),
    providerMessage: input.providerMessage ?? null,
    errorMessage: input.errorMessage ?? null,
  };
}

async function persistTryOtoReturnDetailsProbe(
  execution: ShipmentExecution,
  probe: ReturnType<typeof buildTryOtoReturnDetailsProbeSnapshot>,
  probeKey: 'detailsProbe' | 'linkProbe' | 'awbPrintProbe',
  updates: {
    labelUrl?: string | null;
    trackingNumber?: string | null;
    barcode?: string | null;
    status?: string | null;
  } = {},
) {
  const snapshot = readSnapshot(execution);
  const existingReturnShipment = isRecord(snapshot.returnShipment) ? snapshot.returnShipment : {};
  const source =
    probeKey === 'awbPrintProbe'
      ? 'return AWB print'
      : probeKey === 'linkProbe'
        ? 'getReturnLink'
        : 'getReturnDetails';
  const existingReturnLabelUrl = readTryOtoReturnLabelUrl(existingReturnShipment);
  const labelUrl = updates.labelUrl ?? existingReturnLabelUrl;
  const trackingNumber = updates.trackingNumber ?? readString(existingReturnShipment, ['trackingNumber', 'returnTrackingNumber']);
  const barcode = updates.barcode ?? readString(existingReturnShipment, ['barcode', 'returnBarcode']);
  const mergedSnapshot = appendTimelineEvent(
    {
      ...snapshot,
      returnShipment: {
        ...existingReturnShipment,
        ...(labelUrl ? { labelUrl } : {}),
        ...(trackingNumber ? { trackingNumber } : {}),
        ...(barcode ? { barcode } : {}),
        ...(updates.status ? { status: updates.status } : {}),
        labelPresent: Boolean(labelUrl),
        labelRetrievalConfirmed: Boolean(labelUrl),
        labelRetrievable: Boolean(labelUrl),
        labelRetrievalNote: labelUrl
          ? null
          : probeKey === 'awbPrintProbe'
            ? 'Return AWB print did not return a label URL yet.'
            : `Return label is not available from ${source} yet.`,
        providerStatusSource: source,
        diagnostics: {
          ...(isRecord(existingReturnShipment.diagnostics) ? existingReturnShipment.diagnostics : {}),
          rawPrintReturnAwbUrlPresent: Boolean(readString(existingReturnShipment, [
            'printReturnAWBURL',
            'printReturnAWBUrl',
            'printReturnAwbURL',
            'printReturnAwbUrl',
          ])),
          normalizedReturnLabelUrlPresent: Boolean(labelUrl),
          returnLabelPersistenceStage: updates.labelUrl ? source : existingReturnLabelUrl ? 'existing_return_snapshot' : source,
          returnLabelOverwrittenByStaleSnapshot: false,
        },
        [probeKey]: probe,
      },
      lastProviderResponseAt: probe.attemptedAt,
    },
    {
      label: labelUrl
        ? probeKey === 'awbPrintProbe'
          ? 'Try OTO return AWB print label discovered'
          : probeKey === 'linkProbe'
          ? 'Try OTO return link label discovered'
          : 'Try OTO return details label discovered'
        : probeKey === 'awbPrintProbe'
          ? 'Try OTO return AWB print probed'
          : probeKey === 'linkProbe'
          ? 'Try OTO return link probed'
          : 'Try OTO return details probed',
      status: updates.status ?? probe.status,
    },
  );

  const updated = await prisma.shipmentExecution.update({
    where: {
      id: execution.id,
    },
    data: {
      responseSnapshot: mergedSnapshot as Prisma.InputJsonValue,
    },
  });

  return mapShipmentExecution(updated);
}

export async function probeTryOtoReturnDetails(
  shipmentExecutionId: string,
  options: {
    env: AppEnv;
    adapter?: ShippingProviderAdapter;
  },
): Promise<ShipmentExecutionDto> {
  const existing = await prisma.shipmentExecution.findUnique({
    where: {
      id: shipmentExecutionId,
    },
  });

  if (!existing) {
    throw new Error('Shipment execution not found.');
  }

  if (existing.provider !== ShippingProvider.TRY_OTO) {
    throw new Error('Try OTO return details probe is only available for Try OTO shipments.');
  }

  const attemptedAt = new Date().toISOString();
  const responseSnapshot = readSnapshot(existing);
  const returnShipment = isRecord(responseSnapshot.returnShipment) ? responseSnapshot.returnShipment : null;
  const returnIdentifier =
    readString(returnShipment, ['returnOrderId']) ??
    readString(returnShipment, ['trackingNumber', 'returnTrackingNumber']) ??
    readString(returnShipment, ['barcode', 'returnBarcode']);

  const blocked = async (errorMessage: string) =>
    persistTryOtoReturnDetailsProbe(
      existing,
      buildTryOtoReturnDetailsProbeSnapshot({
        status: 'blocked',
        attemptedAt,
        errorMessage,
      }),
      'detailsProbe',
    );

  if (!returnIdentifier) {
    return blocked('Try OTO return details probe requires a return order id, tracking number, or barcode.');
  }

  const adapter = options.adapter ?? createShippingProviderAdapter(options.env, 'try_oto');
  if (!adapter.probeReturnDetails) {
    return blocked('Try OTO getReturnDetails probe is not implemented for the selected provider adapter.');
  }

  try {
    const result = await adapter.probeReturnDetails(returnIdentifier);
    const labelUrl = result.returnLabelUrl;
    return persistTryOtoReturnDetailsProbe(
      existing,
      buildTryOtoReturnDetailsProbeSnapshot({
        status: labelUrl ? 'success' : 'no_label',
        attemptedAt,
        endpoint: readString(result.responseSnapshot, ['endpoint']) ?? '/rest/v2/getReturnDetails',
        httpStatus: readNumber(result.responseSnapshot, ['status']),
        responseKeys: readStringArray(result.responseSnapshot.bodyKeys),
        nestedKeys: readStringArray(result.responseSnapshot.nestedKeys),
        labelLikeFieldsPresent: readBoolean(result.responseSnapshot, ['labelLikeFieldsPresent']),
        awbLikeFieldsPresent: readBoolean(result.responseSnapshot, ['awbLikeFieldsPresent']),
        pdfLikeFieldsPresent: readBoolean(result.responseSnapshot, ['pdfLikeFieldsPresent']),
        urlLikeFieldsPresent: readBoolean(result.responseSnapshot, ['urlLikeFieldsPresent']),
        trackingPresent: readBoolean(result.responseSnapshot, ['trackingPresent']),
        barcodePresent: readBoolean(result.responseSnapshot, ['barcodePresent']),
        providerStatus: readString(result.responseSnapshot, ['providerStatus']),
        labelUrlPresent: Boolean(labelUrl),
        errorMessage: labelUrl ? null : 'Return label is not available from getReturnDetails yet.',
      }),
      'detailsProbe',
      {
        labelUrl,
        trackingNumber: result.returnTrackingNumber,
        barcode: result.returnBarcode,
        status: result.returnStatus,
      },
    );
  } catch (error) {
    const snapshot = error instanceof ShippingProviderExecutionError ? error.responseSnapshot : {};
    const message = error instanceof Error ? error.message : 'Try OTO getReturnDetails probe failed.';
    return persistTryOtoReturnDetailsProbe(
      existing,
      buildTryOtoReturnDetailsProbeSnapshot({
        status: 'failed',
        attemptedAt,
        endpoint: readString(snapshot, ['endpoint']) ?? '/rest/v2/getReturnDetails',
        httpStatus: readNumber(snapshot, ['status']),
        responseKeys: readStringArray(snapshot.bodyKeys),
        errorMessage: message,
      }),
      'detailsProbe',
    );
  }
}

export async function probeTryOtoReturnLink(
  shipmentExecutionId: string,
  options: {
    env: AppEnv;
    adapter?: ShippingProviderAdapter;
  },
): Promise<ShipmentExecutionDto> {
  const existing = await prisma.shipmentExecution.findUnique({
    where: {
      id: shipmentExecutionId,
    },
  });

  if (!existing) {
    throw new Error('Shipment execution not found.');
  }

  if (existing.provider !== ShippingProvider.TRY_OTO) {
    throw new Error('Try OTO return link probe is only available for Try OTO shipments.');
  }

  const attemptedAt = new Date().toISOString();
  const responseSnapshot = readSnapshot(existing);
  const returnShipment = isRecord(responseSnapshot.returnShipment) ? responseSnapshot.returnShipment : null;
  const returnIdentifier =
    readString(returnShipment, ['returnOrderId']) ??
    readString(returnShipment, ['trackingNumber', 'returnTrackingNumber']) ??
    readString(returnShipment, ['barcode', 'returnBarcode']);

  const blocked = async (errorMessage: string) =>
    persistTryOtoReturnDetailsProbe(
      existing,
      buildTryOtoReturnDetailsProbeSnapshot({
        status: 'blocked',
        attemptedAt,
        endpoint: '/rest/v2/getReturnLink',
        errorMessage,
      }),
      'linkProbe',
    );

  if (!returnIdentifier) {
    return blocked('Try OTO return link probe requires a return order id, tracking number, or barcode.');
  }

  const adapter = options.adapter ?? createShippingProviderAdapter(options.env, 'try_oto');
  if (!adapter.probeReturnLink) {
    return blocked('Try OTO getReturnLink probe is not implemented for the selected provider adapter.');
  }

  try {
    const result = await adapter.probeReturnLink(returnIdentifier);
    const labelUrl = result.returnLabelUrl;
    return persistTryOtoReturnDetailsProbe(
      existing,
      buildTryOtoReturnDetailsProbeSnapshot({
        status: labelUrl ? 'success' : 'no_label',
        attemptedAt,
        endpoint: readString(result.responseSnapshot, ['endpoint']) ?? '/rest/v2/getReturnLink',
        httpStatus: readNumber(result.responseSnapshot, ['status']),
        responseKeys: readStringArray(result.responseSnapshot.bodyKeys),
        nestedKeys: readStringArray(result.responseSnapshot.nestedKeys),
        labelLikeFieldsPresent: readBoolean(result.responseSnapshot, ['labelLikeFieldsPresent']),
        awbLikeFieldsPresent: readBoolean(result.responseSnapshot, ['awbLikeFieldsPresent']),
        pdfLikeFieldsPresent: readBoolean(result.responseSnapshot, ['pdfLikeFieldsPresent']),
        urlLikeFieldsPresent: readBoolean(result.responseSnapshot, ['urlLikeFieldsPresent']),
        actionUrlPresent: readBoolean(result.responseSnapshot, ['actionUrlPresent']),
        trackingPresent: readBoolean(result.responseSnapshot, ['trackingPresent']),
        barcodePresent: readBoolean(result.responseSnapshot, ['barcodePresent']),
        providerStatus: readString(result.responseSnapshot, ['providerStatus']),
        providerMessage: readString(result.responseSnapshot, ['providerMessage']),
        labelUrlPresent: Boolean(labelUrl),
        errorMessage: labelUrl ? null : 'Return label is not available from getReturnLink yet.',
      }),
      'linkProbe',
      {
        labelUrl,
        trackingNumber: result.returnTrackingNumber,
        barcode: result.returnBarcode,
        status: result.returnStatus,
      },
    );
  } catch (error) {
    const snapshot = error instanceof ShippingProviderExecutionError ? error.responseSnapshot : {};
    const message = error instanceof Error ? error.message : 'Try OTO getReturnLink probe failed.';
    return persistTryOtoReturnDetailsProbe(
      existing,
      buildTryOtoReturnDetailsProbeSnapshot({
        status: 'failed',
        attemptedAt,
        endpoint: readString(snapshot, ['endpoint']) ?? '/rest/v2/getReturnLink',
        httpStatus: readNumber(snapshot, ['status']),
        responseKeys: readStringArray(snapshot.bodyKeys),
        errorMessage: message,
      }),
      'linkProbe',
    );
  }
}

export async function probeTryOtoReturnAwbPrint(
  shipmentExecutionId: string,
  options: {
    env: AppEnv;
    adapter?: ShippingProviderAdapter;
  },
): Promise<ShipmentExecutionDto> {
  const existing = await prisma.shipmentExecution.findUnique({
    where: {
      id: shipmentExecutionId,
    },
  });

  if (!existing) {
    throw new Error('Shipment execution not found.');
  }

  if (existing.provider !== ShippingProvider.TRY_OTO) {
    throw new Error('Try OTO return AWB print probe is only available for Try OTO shipments.');
  }

  const attemptedAt = new Date().toISOString();
  const responseSnapshot = readSnapshot(existing);
  const returnShipment = isRecord(responseSnapshot.returnShipment) ? responseSnapshot.returnShipment : null;
  const returnOrderId = readString(returnShipment, ['returnOrderId']);

  const blocked = async (errorMessage: string) =>
    persistTryOtoReturnDetailsProbe(
      existing,
      buildTryOtoReturnDetailsProbeSnapshot({
        status: 'blocked',
        attemptedAt,
        endpoint: '/rest/v2/print/{returnOrderId}?printReverseShipment=true',
        errorMessage,
      }),
      'awbPrintProbe',
    );

  if (!returnOrderId) {
    return blocked('Try OTO return AWB print probe requires a return order id.');
  }

  const adapter = options.adapter ?? createShippingProviderAdapter(options.env, 'try_oto');
  if (!adapter.probeReturnAwbPrint) {
    return blocked('Try OTO return AWB print probe is not implemented for the selected provider adapter.');
  }

  try {
    const result = await adapter.probeReturnAwbPrint(returnOrderId);
    const labelUrl = result.returnLabelUrl;
    return persistTryOtoReturnDetailsProbe(
      existing,
      buildTryOtoReturnDetailsProbeSnapshot({
        status: labelUrl ? 'success' : 'no_label',
        attemptedAt,
        endpoint: readString(result.responseSnapshot, ['endpoint']) ?? '/rest/v2/print/{returnOrderId}?printReverseShipment=true',
        httpStatus: readNumber(result.responseSnapshot, ['status']),
        responseKeys: readStringArray(result.responseSnapshot.bodyKeys),
        nestedKeys: readStringArray(result.responseSnapshot.nestedKeys),
        labelLikeFieldsPresent: readBoolean(result.responseSnapshot, ['labelLikeFieldsPresent']),
        awbLikeFieldsPresent: readBoolean(result.responseSnapshot, ['awbLikeFieldsPresent']),
        pdfLikeFieldsPresent: readBoolean(result.responseSnapshot, ['pdfLikeFieldsPresent']),
        urlLikeFieldsPresent: readBoolean(result.responseSnapshot, ['urlLikeFieldsPresent']),
        trackingPresent: readBoolean(result.responseSnapshot, ['trackingPresent']),
        barcodePresent: readBoolean(result.responseSnapshot, ['barcodePresent']),
        providerStatus: readString(result.responseSnapshot, ['providerStatus']),
        providerMessage: readString(result.responseSnapshot, ['providerMessage']),
        labelUrlPresent: Boolean(labelUrl),
        errorMessage: labelUrl ? null : 'Return AWB print did not return a label URL yet.',
      }),
      'awbPrintProbe',
      {
        labelUrl,
        trackingNumber: result.returnTrackingNumber,
        barcode: result.returnBarcode,
        status: result.returnStatus,
      },
    );
  } catch (error) {
    const snapshot = error instanceof ShippingProviderExecutionError ? error.responseSnapshot : {};
    const message = error instanceof Error ? error.message : 'Try OTO return AWB print probe failed.';
    return persistTryOtoReturnDetailsProbe(
      existing,
      buildTryOtoReturnDetailsProbeSnapshot({
        status: 'failed',
        attemptedAt,
        endpoint: readString(snapshot, ['endpoint']) ?? '/rest/v2/print/{returnOrderId}?printReverseShipment=true',
        httpStatus: readNumber(snapshot, ['status']),
        responseKeys: readStringArray(snapshot.bodyKeys),
        providerMessage: readString(snapshot, ['providerError']),
        errorMessage: message,
      }),
      'awbPrintProbe',
    );
  }
}

export async function probeShopifyReturnLabelUpload(
  shipmentExecutionId: string,
  options: {
    env: AppEnv;
    shopifyAdminService?: Pick<ReturnType<typeof createShopifyAdminService>, 'probeReturnLabelUpload'>;
  },
): Promise<ShipmentExecutionDto> {
  const existing = await prisma.shipmentExecution.findUnique({
    where: {
      id: shipmentExecutionId,
    },
  });

  if (!existing) {
    throw new Error('Shipment execution not found.');
  }

  if (existing.provider !== ShippingProvider.TRY_OTO) {
    throw new Error('Shopify return label upload probe is only available for Try OTO shipments.');
  }

  const attemptedAt = new Date().toISOString();
  const responseSnapshot = readSnapshot(existing);
  const returnShipment = isRecord(responseSnapshot.returnShipment) ? responseSnapshot.returnShipment : null;
  const returnTrackingNumber =
    readString(returnShipment, ['trackingNumber', 'returnTrackingNumber']) ??
    readString(returnShipment, ['barcode', 'returnBarcode']);
  const returnTrackingUrl = returnShipment ? readTryOtoReturnTrackingUrl(returnShipment) : null;
  const returnLabelUrl = returnShipment ? readTryOtoReturnLabelUrl(returnShipment) : null;
  const returnCarrierName = readString(returnShipment, ['carrierName', 'returnCarrierName']);

  const blocked = async (skippedReason: string, errorMessage: string) =>
    persistShopifyReturnLabelUploadProbe(
      existing,
      buildShopifyReturnLabelUploadProbeSnapshot({
        status: 'blocked',
        attemptedAt,
        skippedReason,
        errorMessage,
      }),
    );

  if (!returnShipment) {
    return blocked('missing_try_oto_return_shipment', 'Try OTO return shipment data is required before probing Shopify label upload.');
  }

  if (!returnTrackingNumber) {
    return blocked('missing_return_tracking', 'Try OTO return tracking or barcode is required before probing Shopify label upload.');
  }

  const returnRecord = await prisma.returnRecord.findFirst({
    where: {
      vendorAllocationId: existing.allocationId,
      OR: [
        { sourceShopifyReturnGid: { not: null } },
        { sourceShopifyReturnId: { not: null } },
      ],
    },
    orderBy: {
      updatedAt: 'desc',
    },
    select: {
      sourceShopifyReturnGid: true,
      sourceShopifyReturnId: true,
    },
  });
  const returnGid = toShopifyReturnGid(returnRecord?.sourceShopifyReturnGid ?? returnRecord?.sourceShopifyReturnId ?? null);
  if (!returnGid) {
    return blocked('missing_shopify_return_id', 'Shopify return id is required before probing return label upload.');
  }

  try {
    const shopifyAdminService = options.shopifyAdminService ?? createShopifyAdminService(options.env);
    const result: ProbeShopifyReturnLabelUploadResult = await shopifyAdminService.probeReturnLabelUpload({
      returnGid,
      trackingNumber: returnTrackingNumber,
      trackingUrl: returnTrackingUrl,
      labelUrl: returnLabelUrl,
      carrierName: returnCarrierName,
    });
    return persistShopifyReturnLabelUploadProbe(
      existing,
      buildShopifyReturnLabelUploadProbeSnapshot({
        status: result.trackingAccepted || result.labelAccepted ? 'success' : 'failed',
        attemptedAt,
        shopifyReturnIdPresent: Boolean(returnGid),
        reverseFulfillmentOrderIdPresent: result.reverseFulfillmentOrderIdPresent,
        reverseLineItemIdsPresent: result.reverseLineItemIdsPresent,
        mutationUsed: result.mutationUsed,
        shopifyUserErrors: result.userErrors,
        reverseDeliveryIdPresent: Boolean(result.reverseDeliveryId),
        trackingAccepted: result.trackingAccepted,
        labelAccepted: result.labelAccepted,
        returnedCarrierName: result.returnedCarrierName,
        carrierNamePresent: Boolean(returnCarrierName),
        trackingOnlyMode: !returnLabelUrl,
        labelInputSent: Boolean(returnLabelUrl),
        shopifyCallAttempted: true,
        skippedReason: result.labelAccepted
          ? null
          : returnLabelUrl
            ? 'staged_upload_required_or_external_file_url_rejected'
            : 'return_label_url_missing_tracking_only',
        errorMessage: result.userErrors.map((error) => error.message).filter(Boolean).join('; ') || null,
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Shopify return label upload probe failed.';
    return persistShopifyReturnLabelUploadProbe(
      existing,
      buildShopifyReturnLabelUploadProbeSnapshot({
        status: 'failed',
        attemptedAt,
        trackingOnlyMode: !returnLabelUrl,
        labelInputSent: Boolean(returnLabelUrl),
        shopifyCallAttempted: true,
        skippedReason: 'shopify_probe_failed',
        errorMessage: message,
      }),
    );
  }
}

export async function refreshTryOtoShipmentStatus(
  shipmentExecutionId: string,
  options: {
    env: AppEnv;
    vendorId: string;
    adapter?: ShippingProviderAdapter;
  },
): Promise<ShipmentExecutionDto> {
  const existing = await prisma.shipmentExecution.findUnique({
    where: {
      id: shipmentExecutionId,
    },
  });

  if (!existing || existing.vendorId !== options.vendorId) {
    throw new Error('Shipment execution not found.');
  }

  if (existing.provider !== ShippingProvider.TRY_OTO) {
    throw new Error('Shipment status refresh is only available for Try OTO shipments.');
  }

  const orderId = resolveTryOtoStatusOrderId(existing);
  if (!orderId) {
    throw new Error('Try OTO status refresh requires a stored order id or provider id.');
  }

  const adapter = options.adapter ?? createShippingProviderAdapter(options.env, 'try_oto');
  const result = await adapter.getShipmentStatus(orderId);
  const existingSnapshot = readSnapshot(existing);
  const existingForwardDeliveryOption = readTryOtoForwardDeliveryOptionMetadata(existingSnapshot);
  const mergedSnapshot = appendTimelineEvent(
    {
      ...existingSnapshot,
      ...result.responseSnapshot,
      ...(existingForwardDeliveryOption.deliveryOptionId && !readTryOtoForwardDeliveryOptionMetadata(result.responseSnapshot).deliveryOptionId
        ? {
            deliveryOptionId: existingForwardDeliveryOption.deliveryOptionId,
            forwardDeliveryOptionId: existingForwardDeliveryOption.deliveryOptionId,
            selectedDeliveryOptionId: existingForwardDeliveryOption.deliveryOptionId,
            forwardDeliveryOptionIdSource: existingForwardDeliveryOption.source,
            forwardDeliveryOptionPersistedAt: existingForwardDeliveryOption.persistedAt,
          }
        : {}),
      forwardDeliveryOptionRetainedAfterStatusRefresh: Boolean(existingForwardDeliveryOption.deliveryOptionId),
      statusField: readString(result.responseSnapshot, ['providerStatus', 'statusField', 'shipmentStatus', 'cargoStatus']),
      lastProviderResponseAt: new Date().toISOString(),
    },
    {
      label:
        result.trackingNumber || result.labelUrl || readString(result.responseSnapshot, ['barcode', 'barcodeNumber'])
          ? 'Try OTO status refreshed'
          : 'Try OTO status checked',
      status: result.shipmentStatus,
    },
  );
  const nextStatus =
    result.shipmentStatus === 'pending'
      ? existing.shipmentStatus
      : mapProviderStatus(result.shipmentStatus);

  const updated = await prisma.shipmentExecution.update({
    where: {
      id: existing.id,
    },
    data: {
      providerShipmentId: result.providerShipmentId ?? existing.providerShipmentId,
      trackingNumber: result.trackingNumber ?? existing.trackingNumber,
      trackingUrl: result.trackingUrl ?? existing.trackingUrl,
      labelUrl: result.labelUrl ?? existing.labelUrl,
      shipmentStatus: nextStatus,
      currency: result.currency ?? existing.currency,
      responseSnapshot: mergedSnapshot as Prisma.InputJsonValue,
    },
  });

  return mapShipmentExecution(updated);
}

export async function listShipmentExecutions(options: {
  vendorId?: string;
  status?: ShipmentExecutionDto['shipmentStatus'];
} = {}): Promise<ShipmentExecutionDto[]> {
  const executions = await prisma.shipmentExecution.findMany({
    where: {
      vendorId: options.vendorId,
      shipmentStatus: options.status ? mapProviderStatus(options.status) : undefined,
    },
    orderBy: {
      createdAt: 'desc',
    },
    take: 100,
  });

  return executions.map((execution) => mapShipmentExecution(execution));
}

export async function getShipmentExecutionById(
  shipmentExecutionId: string,
  vendorId?: string | null,
): Promise<ShipmentExecutionDto | null> {
  const execution = await prisma.shipmentExecution.findUnique({
    where: {
      id: shipmentExecutionId,
    },
  });
  if (!execution || (vendorId && execution.vendorId !== vendorId)) {
    return null;
  }

  const linkedCost = await prisma.shipmentShippingCost.findFirst({
    where: {
      allocationId: execution.allocationId,
      providerReference: execution.providerShipmentId ?? execution.trackingNumber ?? execution.id,
      sourceType: 'EXTERNAL_PROVIDER',
    },
    select: {
      id: true,
    },
  });

  return mapShipmentExecution({ ...execution, shippingCostLinked: Boolean(linkedCost) });
}

async function buildShipmentRequestPreview(
  input: CreateShipmentExecutionDto,
  options: {
    vendorId: string;
    env?: AppEnv;
    kargonomiDestinationClient?: KargonomiDestinationLookupClient;
  },
): Promise<ShipmentExecutionPreviewDto> {
  if (!input.allocationId) {
    throw new Error('allocationId is required.');
  }

  const allocation = await prisma.vendorAllocation.findUnique({
    where: {
      id: input.allocationId,
    },
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
      fulfillment: true,
      lineItems: {
        include: {
          shopifyOrderLineItem: true,
        },
      },
    },
  });

  if (!allocation || allocation.assignedVendorId !== options.vendorId) {
    throw new Error('Allocation could not be found for the selected vendor.');
  }

  if (allocation.cancellationReason || allocation.allocationStatus !== 'ACTIVE') {
    throw new Error('Allocation is not eligible for shipment execution.');
  }

  const config = mapShippingConfig(await getStoredShippingConfig(options.vendorId), options.vendorId);
  if (!config.shippingEnabled) {
    throw new Error('Shipping execution is disabled for this vendor.');
  }

  const provider = normalizeProvider(input.provider ?? config.preferredProvider);
  const providerDto = mapProvider(provider);
  if (
    provider !== ShippingProvider.HEPSIJET &&
    provider !== ShippingProvider.KARGO_ENTEGRATOR &&
    provider !== ShippingProvider.TRY_OTO &&
    provider !== ShippingProvider.KARGONOMI
  ) {
    throw new Error('Only Hepsijet, Kargo Entegratör, Try OTO, and Kargonomi shipment execution are implemented.');
  }
  const warehouseConfig =
    provider === ShippingProvider.KARGO_ENTEGRATOR ? requireWarehouseConfig(config, providerDto, options.env) : null;
  const kargonomiWarehouseId =
    provider === ShippingProvider.KARGONOMI ? resolveKargonomiWarehouseId(config, options.env) : null;
  if (provider === ShippingProvider.KARGONOMI && !kargonomiWarehouseId) {
    throw new Error('Kargonomi warehouse ID is not configured for this vendor.');
  }
  const tryOtoPickupLocationCode = provider === ShippingProvider.TRY_OTO
    ? resolveTryOtoPickupLocationCode(config.providerMetadata)
    : null;
  if (provider === ShippingProvider.TRY_OTO && !tryOtoPickupLocationCode) {
    throw new Error('Try OTO pickupLocationCode is not configured for this vendor.');
  }
  const tryOtoOriginCity = provider === ShippingProvider.TRY_OTO
    ? resolveTryOtoOriginCity(config.providerMetadata)
    : null;
  if (provider === ShippingProvider.TRY_OTO && !tryOtoOriginCity) {
    throw new Error('Try OTO origin city is required for delivery option lookup.');
  }

  const lineItems = allocation.lineItems.map((lineItem) => ({
    title: lineItem.shopifyOrderLineItem.title ?? lineItem.shopifyOrderLineItem.sku ?? 'Shopify item',
    sku: lineItem.shopifyOrderLineItem.sku,
    quantity: lineItem.quantity,
    lineAmount: toNumber(lineItem.lineAmount),
  }));
  const desi = resolveShipmentDesi(lineItems, config.defaultDesi);
  const customer = splitCustomerName(allocation.order.customerName);
  const dummyKargoRequested = provider === ShippingProvider.KARGO_ENTEGRATOR && isDummyKargoRequested(input, options.env);
  if (input.carrierId === DUMMY_KARGO_CARRIER_ID && !options.env?.SHIPPING_SANDBOX_MODE) {
    throw new Error('Dummy Kargo shipment creation is available only when shipping sandbox mode is enabled.');
  }
  const kargoCustomer = buildKargoCustomer({
    order: allocation.order,
    customerName: allocation.order.customerName,
    customerEmail: allocation.order.customerEmail,
    customerOverrides: input.customerOverrides,
  });
  const tryOtoCustomer = buildTryOtoCustomer({
    order: allocation.order,
    customerName: allocation.order.customerName,
    customerEmail: allocation.order.customerEmail,
    customerOverrides: input.customerOverrides,
  });
  let kargonomiDestinationResolution: Record<string, unknown> | null = null;
  let resolvedKargonomiDestination: { buyerStateId?: string | null; buyerCityId?: string | null } | undefined;
  if (provider === ShippingProvider.KARGONOMI && !hasKargonomiOrderDestinationIds(allocation.order)) {
    const fallbackStateId = resolveKargonomiBuyerStateId(config.providerMetadata);
    const fallbackCityId = resolveKargonomiBuyerCityId(config.providerMetadata);
    const destinationClient =
      options.kargonomiDestinationClient ??
      (options.env?.KARGONOMI_BASE_URL && options.env.KARGONOMI_API_TOKEN ? new KargonomiHttpClient(options.env) : null);

    if (destinationClient) {
      const destination = readKargonomiDestinationText(allocation.order, input.customerOverrides);
      const resolution = await resolveKargonomiDestinationAddress(destination, destinationClient);
      if (resolution.ok) {
        resolvedKargonomiDestination = {
          buyerStateId: resolution.buyerStateId,
          buyerCityId: resolution.buyerCityId,
        };
        kargonomiDestinationResolution = {
          source: 'order_shipping_address_lookup',
          resolved: true,
          stateSource: resolution.stateSource,
          citySource: resolution.citySource,
          buyerStateIdPresent: true,
          buyerCityIdPresent: true,
        };
      } else {
        kargonomiDestinationResolution = {
          source: fallbackStateId && fallbackCityId ? 'fallback_metadata_after_lookup_failure' : 'order_shipping_address_lookup',
          resolved: false,
          reason: resolution.reason,
          buyerStateIdPresent: Boolean(fallbackStateId),
          buyerCityIdPresent: Boolean(fallbackCityId),
        };
        if (!fallbackStateId || !fallbackCityId) {
          throw new Error(
            [
              'Kargonomi destination could not be resolved from the order shipping address.',
              resolution.message,
              'Missing required shipment fields:',
              !fallbackStateId ? '- buyer.buyer_state_id' : null,
              !fallbackCityId ? '- buyer.buyer_city_id' : null,
              '',
              'Provider request blocked before create call.',
            ]
              .filter((line): line is string => Boolean(line))
              .join('\n'),
          );
        }
      }
    } else if (!fallbackStateId || !fallbackCityId) {
      kargonomiDestinationResolution = {
        source: 'unavailable_lookup',
        resolved: false,
        reason: 'lookup_client_unavailable',
        buyerStateIdPresent: Boolean(fallbackStateId),
        buyerCityIdPresent: Boolean(fallbackCityId),
      };
      throw new Error(
        [
          'Kargonomi destination lookup is unavailable and fallback buyer state/city IDs are not configured.',
          'Missing required shipment fields:',
          !fallbackStateId ? '- buyer.buyer_state_id' : null,
          !fallbackCityId ? '- buyer.buyer_city_id' : null,
          '',
          'Provider request blocked before create call.',
        ]
          .filter((line): line is string => Boolean(line))
          .join('\n'),
      );
    } else {
      kargonomiDestinationResolution = {
        source: 'fallback_metadata',
        resolved: false,
        reason: 'lookup_client_unavailable',
        buyerStateIdPresent: true,
        buyerCityIdPresent: true,
      };
    }
  }
  const kargonomiBuyer = buildKargonomiBuyer({
    order: allocation.order,
    customerName: allocation.order.customerName,
    customerEmail: allocation.order.customerEmail,
    providerMetadata: config.providerMetadata,
    resolvedDestination: resolvedKargonomiDestination,
    customerOverrides: input.customerOverrides,
  });
  const missingCustomerFields = [
    ...(dummyKargoRequested
      ? kargoCustomer.missingFields
      : provider === ShippingProvider.TRY_OTO
        ? tryOtoCustomer.missingFields
        : provider === ShippingProvider.KARGONOMI
          ? kargonomiBuyer.missingFields
          : [
              customer.name ? null : 'customer.name',
              customer.surname ? null : 'customer.surname',
            ]),
  ].filter((field): field is string => Boolean(field));
  if (
    (dummyKargoRequested || provider === ShippingProvider.TRY_OTO || provider === ShippingProvider.KARGONOMI) &&
    missingCustomerFields.length > 0
  ) {
    throw new Error(
      [
        'Missing required shipment fields:',
        ...missingCustomerFields.map((field) => `- ${field}`),
        '',
        'Provider request blocked before create call.',
      ].join('\n'),
    );
  }
  const notificationUrl = buildNotificationUrl(input.notificationUrl);
  const cargoIntegrationId = warehouseConfig?.cargoIntegrationId ?? null;
  const warehouseId = warehouseConfig?.warehouseId ?? null;
  const numericCargoIntegrationId = Number(cargoIntegrationId);
  const numericWarehouseId = Number(warehouseId);
  const orderRecord = isRecord(allocation.order) ? allocation.order : {};
  const kg = resolveKargoKg(orderRecord, desi);
  const note = readString(orderRecord, ['shippingNote', 'shipmentNote']) ?? '';
  const packageType = provider === ShippingProvider.KARGO_ENTEGRATOR
    ? resolveKargoPackageType(config.providerMetadata)
    : DEFAULT_KARGO_PACKAGE_TYPE;
  if (provider === ShippingProvider.KARGO_ENTEGRATOR) {
    assertValidKargoPackageType(packageType);
  }
  const amount = lineItems.reduce((sum, lineItem) => sum + lineItem.lineAmount, 0);
  const tryOtoPayment = resolveTryOtoPayment(orderRecord, amount);
  const tryOtoPackageWeight = resolveTryOtoPackageWeight(config.providerMetadata, kg);
  const tryOtoDeliveryOptionId = provider === ShippingProvider.TRY_OTO
    ? resolveTryOtoDeliveryOptionId(config.providerMetadata)
    : null;
  const tryOtoInternalOrderReference = buildTryOtoInternalOrderReference(allocation);
  const tryOtoExternalOrderReference = buildTryOtoExternalOrderReference(allocation);
  const kargonomiShippingProviderId =
    provider === ShippingProvider.KARGONOMI ? resolveKargonomiShippingProviderId(config.providerMetadata) ?? '-1' : null;
  const kargonomiPackageBarcode = `SPJ-${allocation.sourceShopifyOrderNumber ?? allocation.id}`.replace(
    /[^A-Za-z0-9_-]/g,
    '',
  );

  const payload = provider === ShippingProvider.TRY_OTO
    ? {
        orderId: tryOtoExternalOrderReference,
        externalOrderReference: tryOtoExternalOrderReference,
        internalOrderReference: tryOtoInternalOrderReference,
        legacyInternalReferenceUsed: false,
        pickupLocationCode: tryOtoPickupLocationCode,
        payment_method: tryOtoPayment.payment_method,
        amount,
        amount_due: tryOtoPayment.amount_due,
        currency: 'TRY',
        packageCount: 1,
        packageWeight: tryOtoPackageWeight,
        ...(tryOtoOriginCity ? { originCity: tryOtoOriginCity } : {}),
        ...(tryOtoDeliveryOptionId ? { deliveryOptionId: tryOtoDeliveryOptionId } : {}),
        customer: tryOtoCustomer.customer,
        items: lineItems.map((lineItem) => ({
          name: lineItem.title,
          sku: lineItem.sku,
          quantity: lineItem.quantity,
          price: lineItem.lineAmount,
          rowTotal: lineItem.lineAmount,
        })),
        reference: {
          allocation_id: allocation.id,
          shopify_order_id: allocation.sourceShopifyOrderId,
          shopify_order_number: allocation.sourceShopifyOrderNumber,
          vendor_id: allocation.assignedVendorId,
        },
      }
    : provider === ShippingProvider.KARGONOMI
      ? {
          warehouseId: kargonomiWarehouseId,
          shippingProviderId: kargonomiShippingProviderId,
          buyer: kargonomiBuyer.buyer,
          destinationResolution: kargonomiDestinationResolution ?? {
            source: hasKargonomiOrderDestinationIds(allocation.order) ? 'order_stored_ids' : 'fallback_metadata',
            buyerStateIdPresent: Boolean(kargonomiBuyer.buyer.buyer_state_id),
            buyerCityIdPresent: Boolean(kargonomiBuyer.buyer.buyer_city_id),
          },
          packages: [
            {
              content: lineItems.map((lineItem) => lineItem.title).join(', ').slice(0, 240),
              barcode: kargonomiPackageBarcode || allocation.id,
              desi,
            },
          ],
          reference: {
            allocation_id: allocation.id,
            shopify_order_id: allocation.sourceShopifyOrderId,
            shopify_order_number: allocation.sourceShopifyOrderNumber,
            vendor_id: allocation.assignedVendorId,
          },
        }
    : {
        cargo_integration_id: Number.isFinite(numericCargoIntegrationId) ? numericCargoIntegrationId : cargoIntegrationId,
        warehouse_id: Number.isFinite(numericWarehouseId) ? numericWarehouseId : warehouseId,
        ...(dummyKargoRequested ? { cargo_company: { id: DUMMY_KARGO_CARRIER_ID } } : {}),
        platform_id: allocation.sourceShopifyOrderId,
        platform_d_id: allocation.sourceShopifyOrderNumber,
        notification_url: notificationUrl,
        customer: provider === ShippingProvider.KARGO_ENTEGRATOR
          ? kargoCustomer.customer
          : {
              name: customer.name,
              surname: customer.surname,
              email: allocation.order.customerEmail,
            },
        payment_type: resolveKargoPaymentType(orderRecord),
        ...(provider === ShippingProvider.KARGO_ENTEGRATOR ? { package_type: packageType } : {}),
        ...(provider === ShippingProvider.KARGO_ENTEGRATOR ? { payor_type: 'sender' } : {}),
        desi,
        ...(provider === ShippingProvider.KARGO_ENTEGRATOR ? { kg } : {}),
        ...(dummyKargoRequested ? { note } : {}),
        lines: lineItems.map((lineItem) => ({
          title: lineItem.title,
          quantity: lineItem.quantity,
          sku: lineItem.sku,
        })),
        reference: {
          allocation_id: allocation.id,
          shopify_order_id: allocation.sourceShopifyOrderId,
          shopify_order_number: allocation.sourceShopifyOrderNumber,
          vendor_id: allocation.assignedVendorId,
        },
      };
  logMissingKargoPayloadFields(payload, provider);

  return {
    allocationId: allocation.id,
    vendorId: allocation.assignedVendorId,
    provider: providerDto,
    cargoIntegrationId,
    warehouseId:
      provider === ShippingProvider.TRY_OTO
        ? tryOtoPickupLocationCode
        : provider === ShippingProvider.KARGONOMI
          ? kargonomiWarehouseId
          : warehouseId,
    desi: toAmountString(desi),
    notificationUrl,
    payload,
    customerFieldsValid: missingCustomerFields.length === 0,
    missingCustomerFields,
    warnings:
      provider === ShippingProvider.KARGO_ENTEGRATOR
        ? [
            'Kargo Entegratör webhook/status sync is not implemented.',
            dummyKargoRequested
              ? 'Dummy Kargo sandbox shipment creation is enabled.'
              : 'Live carrier execution is not enabled or verified.',
          ]
        : provider === ShippingProvider.TRY_OTO
          ? [
              'Try OTO is sandbox-only in this phase.',
              'Try OTO webhooks, returns, and production rollout are not implemented.',
            ]
          : provider === ShippingProvider.KARGONOMI
            ? ['Kargonomi return/reverse shipment is not implemented.']
            : [],
  };
}

export async function previewShipmentExecution(
  input: CreateShipmentExecutionDto,
  options: {
    vendorId: string;
    env?: AppEnv;
    kargonomiDestinationClient?: KargonomiDestinationLookupClient;
  },
): Promise<ShipmentExecutionPreviewDto> {
  return buildShipmentRequestPreview(input, options);
}

export async function createShipmentExecution(
  input: CreateShipmentExecutionDto,
  options: {
    env: AppEnv;
    vendorId: string;
    adapter?: ShippingProviderAdapter;
    kargonomiDestinationClient?: KargonomiDestinationLookupClient;
  },
): Promise<ShipmentExecutionDto> {
  const preview = await buildShipmentRequestPreview(input, {
    vendorId: options.vendorId,
    env: options.env,
    kargonomiDestinationClient: options.kargonomiDestinationClient,
  });

  const allocation = await prisma.vendorAllocation.findUnique({
    where: {
      id: input.allocationId,
    },
    include: {
      order: true,
      fulfillment: true,
      lineItems: {
        include: {
          shopifyOrderLineItem: true,
        },
      },
    },
  });

  if (!allocation) {
    throw new Error('Allocation could not be found for the selected vendor.');
  }

  const provider = normalizeProvider(preview.provider);
  const providerDto = preview.provider;

  const existing = await prisma.shipmentExecution.findUnique({
    where: {
      allocationId_provider: {
        allocationId: allocation.id,
        provider,
      },
    },
  });
  if (existing) {
    return getShipmentExecutionById(existing.id, options.vendorId) as Promise<ShipmentExecutionDto>;
  }

  const desi = resolvePersistedShipmentDesi(preview);
  const requestSnapshot = preview.payload;
  const executionId = buildShipmentExecutionId({ allocationId: allocation.id, provider });

  await prisma.shipmentExecution.create({
    data: {
      id: executionId,
      sourceShopifyOrderId: allocation.sourceShopifyOrderId,
      sourceShopifyOrderNumber: allocation.sourceShopifyOrderNumber,
      sourceShopifyFulfillmentId: allocation.fulfillment?.shopifyFulfillmentId ?? null,
      provider,
      shipmentStatus: ShipmentExecutionStatus.PENDING,
      desi,
      cargoIntegrationId: preview.cargoIntegrationId,
      warehouseId: preview.warehouseId,
      requestSnapshot: requestSnapshot as Prisma.InputJsonValue,
      allocation: {
        connect: {
          id: allocation.id,
        },
      },
      vendor: {
        connect: {
          id: allocation.assignedVendorId,
        },
      },
    },
  });

  try {
    const adapter = options.adapter ?? createShippingProviderAdapter(options.env, providerDto);
    logKargoExecutionModeSelection(input, preview, options.env);
    const result = await adapter.createShipment({
      allocationId: allocation.id,
      vendorId: allocation.assignedVendorId,
      provider: providerDto,
      requestSnapshot,
    });
    return persistProviderShipmentResult({
      executionId,
      allocation,
      provider,
      result,
    });
  } catch (error) {
    const attemptSnapshot = appendTimelineEvent({}, {
      label: 'Create attempted',
      status: 'failed',
    });
    if (provider === ShippingProvider.TRY_OTO) {
      const recovered = await persistTryOtoAsyncShipmentContext({
        executionId,
        allocation,
        error,
        requestSnapshot,
        baseSnapshot: attemptSnapshot,
      });
      if (recovered) {
        return recovered;
      }
    }
    const failed = await prisma.shipmentExecution.update({
      where: {
        id: executionId,
      },
      data: {
        shipmentStatus: ShipmentExecutionStatus.FAILED,
        responseSnapshot: buildProviderFailureSnapshot(error, provider, attemptSnapshot),
      },
    });

    return mapShipmentExecution(failed);
  }
}

export async function retryDryRunShipmentExecution(
  shipmentExecutionId: string,
  options: {
    env: AppEnv;
    actorRole?: string;
    notificationUrl?: string | null;
    adapter?: ShippingProviderAdapter;
  },
): Promise<ShipmentExecutionDto> {
  if (options.actorRole !== 'admin') {
    throw new Error('Admin access required.');
  }

  const existing = await prisma.shipmentExecution.findUnique({
    where: {
      id: shipmentExecutionId,
    },
  });

  if (!existing) {
    throw new Error('Shipment execution not found.');
  }

  assertDryRunRetryEligible(existing);

  const providerDto = mapProvider(existing.provider);
  const diagnostics = getShippingProviderGateDiagnostics(options.env, providerDto);
  if (!diagnostics.executionReady) {
    const missing = diagnostics.missing.length ? diagnostics.missing.join(', ') : 'provider configuration';
    throw new Error(`Shipping provider execution is not ready. Missing: ${missing}.`);
  }

  const preview = await buildShipmentRequestPreview(
    {
      allocationId: existing.allocationId,
      provider: providerDto,
      notificationUrl: options.notificationUrl ?? undefined,
    },
    {
      vendorId: existing.vendorId,
      env: options.env,
    },
  );

  const provider = normalizeProvider(preview.provider);
  if (provider !== existing.provider) {
    throw new Error('Vendor shipping provider no longer matches the shipment execution provider.');
  }

  const allocation = await prisma.vendorAllocation.findUnique({
    where: {
      id: existing.allocationId,
    },
    include: {
      order: true,
      fulfillment: true,
      lineItems: {
        include: {
          shopifyOrderLineItem: true,
        },
      },
    },
  });

  if (!allocation || allocation.assignedVendorId !== existing.vendorId) {
    throw new Error('Allocation could not be found for the selected shipment execution.');
  }

  const requestSnapshot = applyExistingTryOtoOrderReference(existing, preview.payload);
  await prisma.shipmentExecution.update({
    where: {
      id: existing.id,
    },
    data: {
      desi: Number(preview.desi),
      cargoIntegrationId: preview.cargoIntegrationId,
      warehouseId: preview.warehouseId,
      requestSnapshot: requestSnapshot as Prisma.InputJsonValue,
    },
  });

  try {
    const adapter = options.adapter ?? createShippingProviderAdapter(options.env, providerDto);
    logKargoExecutionModeSelection(
      {
        allocationId: existing.allocationId,
        provider: providerDto,
        notificationUrl: options.notificationUrl ?? undefined,
      },
      preview,
      options.env,
    );
    const retryContext = buildTryOtoRetryContext(existing);
    const result = await adapter.createShipment({
      allocationId: allocation.id,
      vendorId: allocation.assignedVendorId,
      provider: providerDto,
      requestSnapshot,
      ...(retryContext ? { retryContext } : {}),
    });

    return persistProviderShipmentResult({
      executionId: existing.id,
      allocation,
      provider,
      result,
    });
  } catch (error) {
    if (provider === ShippingProvider.TRY_OTO) {
      const recovered = await persistTryOtoAsyncShipmentContext({
        executionId: existing.id,
        allocation,
        error,
        requestSnapshot,
        baseSnapshot: existing.responseSnapshot,
      });
      if (recovered) {
        return recovered;
      }
    }
    const failed = await prisma.shipmentExecution.update({
      where: {
        id: existing.id,
      },
      data: {
        shipmentStatus: ShipmentExecutionStatus.FAILED,
        responseSnapshot: buildProviderFailureSnapshot(error, provider, existing.responseSnapshot),
      },
    });

    return mapShipmentExecution(failed);
  }
}

export async function retryFailedShipmentExecution(
  shipmentExecutionId: string,
  options: {
    env: AppEnv;
    vendorId: string;
    notificationUrl?: string | null;
    customerOverrides?: CreateShipmentExecutionDto['customerOverrides'];
    adapter?: ShippingProviderAdapter;
  },
): Promise<ShipmentExecutionDto> {
  const existing = await prisma.shipmentExecution.findUnique({
    where: {
      id: shipmentExecutionId,
    },
  });

  if (!existing || existing.vendorId !== options.vendorId) {
    throw new Error('Shipment execution not found.');
  }

  assertFailedRetryEligible(existing);

  const providerDto = mapProvider(existing.provider);
  const diagnostics = getShippingProviderGateDiagnostics(options.env, providerDto);
  if (!diagnostics.executionReady) {
    const missing = diagnostics.missing.length ? diagnostics.missing.join(', ') : 'provider configuration';
    throw new Error(`Shipping provider execution is not ready. Missing: ${missing}.`);
  }

  const preview = await buildShipmentRequestPreview(
    {
      allocationId: existing.allocationId,
      provider: providerDto,
      notificationUrl: options.notificationUrl ?? undefined,
      customerOverrides: options.customerOverrides,
    },
    {
      vendorId: existing.vendorId,
      env: options.env,
    },
  );

  const provider = normalizeProvider(preview.provider);
  if (provider !== existing.provider) {
    throw new Error('Vendor shipping provider no longer matches the shipment execution provider.');
  }

  const allocation = await prisma.vendorAllocation.findUnique({
    where: {
      id: existing.allocationId,
    },
    include: {
      order: true,
      fulfillment: true,
      lineItems: {
        include: {
          shopifyOrderLineItem: true,
        },
      },
    },
  });

  if (!allocation || allocation.assignedVendorId !== existing.vendorId) {
    throw new Error('Allocation could not be found for the selected shipment execution.');
  }

  const retrySnapshot = appendTimelineEvent(existing.responseSnapshot, {
    label: 'Retry attempted',
    status: 'pending',
  });
  const requestSnapshot = applyExistingTryOtoOrderReference(existing, preview.payload);
  await prisma.shipmentExecution.update({
    where: {
      id: existing.id,
    },
    data: {
      shipmentStatus: ShipmentExecutionStatus.PENDING,
      desi: Number(preview.desi),
      cargoIntegrationId: preview.cargoIntegrationId,
      warehouseId: preview.warehouseId,
      requestSnapshot: requestSnapshot as Prisma.InputJsonValue,
      responseSnapshot: retrySnapshot as Prisma.InputJsonValue,
    },
  });

  try {
    const adapter = options.adapter ?? createShippingProviderAdapter(options.env, providerDto);
    logKargoExecutionModeSelection(
      {
        allocationId: existing.allocationId,
        provider: providerDto,
        notificationUrl: options.notificationUrl ?? undefined,
        customerOverrides: options.customerOverrides,
      },
      preview,
      options.env,
    );
    const retryContext = buildTryOtoRetryContext(existing);
    const result = await adapter.createShipment({
      allocationId: allocation.id,
      vendorId: allocation.assignedVendorId,
      provider: providerDto,
      requestSnapshot,
      ...(retryContext ? { retryContext } : {}),
    });

    return persistProviderShipmentResult({
      executionId: existing.id,
      allocation,
      provider,
      result,
    });
  } catch (error) {
    if (provider === ShippingProvider.TRY_OTO) {
      const recovered = await persistTryOtoAsyncShipmentContext({
        executionId: existing.id,
        allocation,
        error,
        requestSnapshot,
        baseSnapshot: retrySnapshot,
      });
      if (recovered) {
        return recovered;
      }
    }
    const failed = await prisma.shipmentExecution.update({
      where: {
        id: existing.id,
      },
      data: {
        shipmentStatus: ShipmentExecutionStatus.FAILED,
        responseSnapshot: buildProviderFailureSnapshot(error, provider, retrySnapshot),
      },
    });

    return mapShipmentExecution(failed);
  }
}
