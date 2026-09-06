import {
  Prisma,
  ShipmentExecutionStatus,
  ShippingProvider,
  type ShipmentExecution,
  type VendorShippingConfig,
  type VendorShippingWarehouse,
} from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { prisma } from '../../db/prisma.js';
import type { AppEnv } from '../../config/env.js';
import {
  createShippingProviderAdapter,
  ShippingProviderExecutionError,
  type ShippingProviderAdapter,
} from './shipping-provider.adapter.js';
import {
  KargonomiHttpClient,
  normalizeKargonomiPhone,
  resolveKargonomiDestinationAddress,
  type KargonomiDestinationLookupClient,
} from './kargonomi-provider.adapter.js';
import {
  summarizeNavlungoCreatePostRequest,
  type NavlungoCreatePostPayload,
} from './navlungo-provider.adapter.js';
import { createShopifyAdminService } from '../shopify/shopify-admin.service.js';
import { mapShopifyShippingAddress } from '../shopify/order-ingestion.service.js';
import { splitShopifyWorldwideAddress2 } from '../shopify/shopify-worldwide-address.service.js';
import { createFulfillmentService } from '../fulfillments/fulfillment.service.js';
import {
  auditVendorProfileChanges,
  type VendorProfileAuditActor,
} from '../vendors/vendor-profile-audit-log.service.js';
import type { ShopifyOrdersCreateWebhookPayload } from '../shopify/order-ingestion.types.js';
import type { ProbeShopifyReturnLabelUploadResult } from '../shopify/shopify-admin.types.js';
import type {
  CreateShipmentExecutionDto,
  ShipmentExecutionPreviewDto,
  ShipmentExecutionDto,
  ShippingProviderGateDiagnosticsDto,
  ShippingProviderDto,
  UpdateNavlungoShipmentDto,
  KargonomiWarehouseSyncResultDto,
  VendorShippingConfigDto,
  VendorShippingConfigUpdateDto,
} from './shipping-execution.types.js';
import { assertFullOrderOperationallyEligible } from '../orders/full-order-cancellation-policy.js';
import { assertAllocationActionable } from '../orders/allocation-actionability-guard.service.js';
import {
  assertNoPendingCustomerCancellationHold,
  CustomerCancellationShipmentHoldError,
  hasPendingCustomerCancellationHold,
} from '../orders/customer-cancellation-hold.service.js';

const SHIPPING_VAT_PERCENT = 18;
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
  authenticityVerification: TryOtoWebhookAuthenticityVerification;
};

type TryOtoWebhookAuthenticityVerification = {
  mode: 'shared_secret' | 'disabled_dev_only';
  providerNativeSignatureVerified: false;
  note: string;
};

const TRY_OTO_WEBHOOK_AUTHENTICITY_NOTE = 'Provider-native Try OTO signature semantics remain unknown.';
const TRY_OTO_WEBHOOK_SIGNATURE_WARNING =
  'Try OTO provider-native signature semantics remain unknown; interim shared-secret verification may be used at the route boundary.';

function buildTryOtoWebhookAuthenticityVerification(
  mode: TryOtoWebhookAuthenticityVerification['mode'] = 'disabled_dev_only',
): TryOtoWebhookAuthenticityVerification {
  return {
    mode,
    providerNativeSignatureVerified: false,
    note: TRY_OTO_WEBHOOK_AUTHENTICITY_NOTE,
  };
}

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
  authenticityVerification: buildTryOtoWebhookAuthenticityVerification(),
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
  const normalized = (provider ?? 'kargonomi').trim().toLowerCase();
  if (normalized === 'hepsijet') {
    return ShippingProvider.HEPSIJET;
  }
  if (normalized === 'try_oto') {
    return ShippingProvider.TRY_OTO;
  }
  if (normalized === 'kargonomi') {
    return ShippingProvider.KARGONOMI;
  }
  if (normalized === 'navlungo') {
    return ShippingProvider.NAVLUNGO;
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

function passiveShippingProviderLabel(provider: ShippingProvider | ShippingProviderDto) {
  return mapProvider(provider) === 'try_oto' ? 'Try OTO' : 'Navlungo';
}

function isPassiveShippingProvider(provider: ShippingProvider | ShippingProviderDto) {
  const providerDto = mapProvider(provider);
  return providerDto === 'try_oto' || providerDto === 'navlungo';
}

function buildPassiveShippingProviderMessage(provider: ShippingProvider | ShippingProviderDto) {
  return `${passiveShippingProviderLabel(provider)} is passive. Kargonomi is the only active shipping provider.`;
}

function assertActiveShippingProvider(provider: ShippingProvider | ShippingProviderDto) {
  if (isPassiveShippingProvider(provider)) {
    throw new Error(buildPassiveShippingProviderMessage(provider));
  }
}

function mapStatus(status: ShipmentExecutionStatus | string): ShipmentExecutionDto['shipmentStatus'] {
  return status.trim().toLowerCase() as ShipmentExecutionDto['shipmentStatus'];
}

function readWarehouseMetadataString(metadata: unknown, keys: string[]) {
  return readString(metadata, keys);
}

function buildWarehouseSyncStatus(metadata: unknown, address: string | null) {
  return {
    contactNamePresent: Boolean(readWarehouseMetadataString(metadata, ['contactName', 'contact_name'])),
    phonePresent: Boolean(readWarehouseMetadataString(metadata, ['phone', 'contactPhone', 'contact_phone'])),
    addressPresent: Boolean(address?.trim()),
    stateIdPresent: Boolean(readWarehouseMetadataString(metadata, ['stateId', 'state_id', 'warehouseStateId'])),
    cityIdPresent: Boolean(readWarehouseMetadataString(metadata, ['cityId', 'city_id', 'warehouseCityId'])),
    stateName: readWarehouseMetadataString(metadata, ['stateName', 'state_name']) ?? null,
    cityName: readWarehouseMetadataString(metadata, ['cityName', 'city_name']) ?? null,
    syncedAt: readWarehouseMetadataString(metadata, ['syncedAt', 'kargonomiWarehouseSyncedAt']) ?? null,
    lookupStatus: readWarehouseMetadataString(metadata, ['lookupStatus', 'kargonomiWarehouseLookupStatus']) ?? null,
    lookupError: readWarehouseMetadataString(metadata, ['lookupError', 'kargonomiWarehouseLookupError']) ?? null,
  };
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
    syncStatus: buildWarehouseSyncStatus(warehouse.metadata, warehouse.address),
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
    const raw = value[key];
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      return raw;
    }
    if (typeof raw === 'string' && raw.trim()) {
      const numeric = Number(raw);
      if (Number.isFinite(numeric)) {
        return numeric;
      }
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
    provider: readString(returnShipment, ['provider']) === 'navlungo' ? 'navlungo' : 'try_oto',
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

function readOptionalBoolean(value: unknown, keys: string[]) {
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

function mapNavlungoRequestSummary(value: unknown): NonNullable<ShipmentExecutionDto['providerResponseSummary']>['navlungoRequestSummary'] {
  if (!isRecord(value)) {
    return null;
  }

  return {
    baseUrl: readString(value, ['baseUrl']),
    baseUrlHost: readString(value, ['baseUrlHost']),
    baseUrlPath: readString(value, ['baseUrlPath']),
    endpointPath: readString(value, ['endpointPath']) ?? '—',
    method: readString(value, ['method']) ?? '—',
    headerKeys: readStringArray(value.headerKeys),
    topLevelBodyKeys: readStringArray(value.topLevelBodyKeys),
    postKeys: readStringArray(value.postKeys),
    senderKeys: readStringArray(value.senderKeys),
    recipientKeys: readStringArray(value.recipientKeys),
    postPayloadKeys: readStringArray(value.postPayloadKeys),
    barcodeFormatPresent: Boolean(value.barcodeFormatPresent),
    barcodeFormatType: readString(value, ['barcodeFormatType']),
    codPaymentTypePresent: Boolean(value.codPaymentTypePresent),
    codPaymentType: readString(value, ['codPaymentType']),
    postPricePresent: Boolean(value.postPricePresent),
    postPriceType: readString(value, ['postPriceType']),
    requestedCarrierId: readNumber(value, ['requestedCarrierId']) ?? readString(value, ['requestedCarrierId']),
    requestedPostType: readNumber(value, ['requestedPostType']) ?? readString(value, ['requestedPostType']),
    senderUsesAddressId: Boolean(value.senderUsesAddressId),
    senderFullObjectKeysPresent: Boolean(value.senderFullObjectKeysPresent),
    customData1Present: Boolean(value.customData1Present),
    customData2Present: Boolean(value.customData2Present),
    customData3Present: Boolean(value.customData3Present),
    customData4Present: Boolean(value.customData4Present),
    recipientDistrictPresent: Boolean(value.recipientDistrictPresent),
    recipientCityPresent: Boolean(value.recipientCityPresent),
    recipientCountryPresent: Boolean(value.recipientCountryPresent),
    recipientPostCodePresent: Boolean(value.recipientPostCodePresent),
    recipientPhonePresent: Boolean(value.recipientPhonePresent),
    recipientPhoneFormatValid: Boolean(value.recipientPhoneFormatValid),
    recipientEmailPresent: Boolean(value.recipientEmailPresent),
    recipientEmailFormatValid: Boolean(value.recipientEmailFormatValid),
    recipientAddressPresent: Boolean(value.recipientAddressPresent),
    recipientAddressLength: readNumber(value, ['recipientAddressLength']) ?? 0,
    packageCountPresent: Boolean(value.packageCountPresent),
    packageCountType: readString(value, ['packageCountType']),
    requestedPackageCount: readNumber(value, ['requestedPackageCount']) ?? readString(value, ['requestedPackageCount']),
    desiPresent: Boolean(value.desiPresent),
    desiType: readString(value, ['desiType']),
    requestedDesi: readNumber(value, ['requestedDesi']) ?? readString(value, ['requestedDesi']),
    postNotePresent: Boolean(value.postNotePresent),
    postNoteType: readString(value, ['postNoteType']),
    postNoteLength: readNumber(value, ['postNoteLength']) ?? 0,
  };
}

function redactValidationDiagnosticText(value: string) {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, '[redacted-phone]')
    .trim();
}

function readValidationStringArray(value: unknown) {
  return readStringArray(value)
    .map(redactValidationDiagnosticText)
    .filter(Boolean);
}

function mergeUniqueStrings(...groups: string[][]) {
  return Array.from(new Set(groups.flat().map((value) => value.trim()).filter(Boolean)));
}

function mapProviderResponseSummary(
  execution: ShipmentExecution & { shippingCostLinked?: boolean },
  snapshot: Record<string, unknown>,
  barcode: string | null,
): ShipmentExecutionDto['providerResponseSummary'] {
  const createPostSnapshot = isRecord(snapshot.createPost) ? snapshot.createPost : null;
  const updatePostSnapshot = isRecord(snapshot.updatePost) ? snapshot.updatePost : null;
  const providerError = readString(snapshot, [
    'providerError',
    'providerMessage',
    'navlungoUpdateProviderMessage',
    'errorMessage',
    'message',
    'error',
    'reason',
    'providerCallSkippedReason',
  ]);
  const trackingUrlPresent = Boolean(execution.trackingUrl);
  const barcodePresent = Boolean(barcode);
  const disabledGates = Array.isArray(snapshot.disabledGates)
    ? snapshot.disabledGates.filter((gate): gate is string => typeof gate === 'string')
    : [];
  const providerValidationErrors = mergeUniqueStrings(
    readValidationStringArray(snapshot.providerValidationErrors),
    readValidationStringArray(createPostSnapshot?.providerValidationErrors),
    readValidationStringArray(createPostSnapshot?.validationErrorMessages),
    readValidationStringArray(snapshot.navlungoUpdateValidationMessages),
    readValidationStringArray(updatePostSnapshot?.validationErrorMessages),
  );
  const validationErrorKeys = mergeUniqueStrings(
    readStringArray(snapshot.validationErrorKeys),
    readStringArray(createPostSnapshot?.validationErrorKeys),
    readStringArray(updatePostSnapshot?.validationErrorKeys),
  );
  const validationErrorMessages = mergeUniqueStrings(
    readValidationStringArray(snapshot.validationErrorMessages),
    readValidationStringArray(createPostSnapshot?.validationErrorMessages),
    readValidationStringArray(createPostSnapshot?.providerValidationErrors),
    readValidationStringArray(snapshot.navlungoUpdateValidationMessages),
    readValidationStringArray(updatePostSnapshot?.validationErrorMessages),
  );
  const failedFieldNames = mergeUniqueStrings(
    readStringArray(snapshot.failedFieldNames),
    readStringArray(createPostSnapshot?.failedFieldNames),
    readStringArray(snapshot.navlungoUpdateValidationFields),
    readStringArray(updatePostSnapshot?.failedFieldNames),
  );
  const validationResponseShapeSource = isRecord(snapshot.validationResponseShape)
    ? snapshot.validationResponseShape
    : isRecord(createPostSnapshot?.validationResponseShape)
      ? createPostSnapshot.validationResponseShape
      : null;
  const validationResponseShape = validationResponseShapeSource
    ? {
        kind: readString(validationResponseShapeSource, ['kind']) ?? 'unknown',
        topLevelKeys: Array.isArray(validationResponseShapeSource.topLevelKeys)
          ? validationResponseShapeSource.topLevelKeys.filter((key): key is string => typeof key === 'string')
          : [],
      }
    : null;
  const navlungoUpdateResponseShapeSource = isRecord(snapshot.navlungoUpdateResponseShape)
    ? snapshot.navlungoUpdateResponseShape
    : isRecord(updatePostSnapshot?.navlungoUpdateResponseShape)
      ? updatePostSnapshot.navlungoUpdateResponseShape
      : isRecord(updatePostSnapshot?.responseShape)
        ? updatePostSnapshot.responseShape
        : null;
  const navlungoUpdateResponseShape = navlungoUpdateResponseShapeSource
    ? {
        kind: readString(navlungoUpdateResponseShapeSource, ['kind']) ?? 'unknown',
        topLevelKeys: Array.isArray(navlungoUpdateResponseShapeSource.topLevelKeys)
          ? navlungoUpdateResponseShapeSource.topLevelKeys.filter((key): key is string => typeof key === 'string')
          : [],
      }
    : null;
  const navlungoStatusLogs = readNavlungoStatusLogEvents(snapshot).map((event) => ({
    statusCode: event.statusCode,
    action: event.action,
    actionResult: event.actionResult,
    createdAt: event.createdAt,
  }));
  const kargonomiGetShipmentAfterConfirm = isRecord(snapshot.getShipmentAfterConfirm)
    ? snapshot.getShipmentAfterConfirm
    : null;
  const kargonomiBarcodeFetch = isRecord(snapshot.barcodeFetch) ? snapshot.barcodeFetch : null;

  return {
    httpStatus: readNumber(snapshot, ['httpStatus', 'createPostHttpStatus', 'providerCallHttpStatus', 'navlungoCancelHttpStatus', 'navlungoUpdateHttpStatus', 'statusCode']),
    ok: readOptionalBoolean(snapshot, ['ok', 'success']),
    contentType: readString(snapshot, ['contentType']),
    parsedBodyType: readString(snapshot, ['parsedBodyType']),
    responseKeys: Object.keys(snapshot).filter((key) => !['body', 'request', 'payload'].includes(key)).sort(),
    providerError: providerError ?? readString(snapshot, ['navlungoCancelProviderMessage']),
    dryRun: readOptionalBoolean(snapshot, ['dryRun']),
    disabledGates,
    providerValidationErrors,
    validationErrorKeys,
    validationErrorMessages,
    failedFieldNames,
    validationErrorKeysCount:
      readNumber(snapshot, ['validationErrorKeysCount']) ??
      readNumber(createPostSnapshot, ['validationErrorKeysCount']) ??
      validationErrorKeys.length,
    failedFieldNamesCount:
      readNumber(snapshot, ['failedFieldNamesCount']) ??
      readNumber(createPostSnapshot, ['failedFieldNamesCount']) ??
      failedFieldNames.length,
    validationErrorMessagesCount:
      readNumber(snapshot, ['validationErrorMessagesCount']) ??
      readNumber(createPostSnapshot, ['validationErrorMessagesCount']) ??
      validationErrorMessages.length,
    providerValidationErrorsShape:
      readString(snapshot, ['providerValidationErrorsShape']) ??
      readString(createPostSnapshot, ['providerValidationErrorsShape']),
    createPostErrorShape:
      readString(snapshot, ['createPostErrorShape']) ?? readString(createPostSnapshot, ['createPostErrorShape']),
    topLevelErrorShape:
      readString(snapshot, ['topLevelErrorShape']) ?? readString(createPostSnapshot, ['topLevelErrorShape']),
    nestedCreatePostErrorShape:
      readString(snapshot, ['nestedCreatePostErrorShape']) ?? readString(createPostSnapshot, ['nestedCreatePostErrorShape']),
    providerErrorCode:
      readString(snapshot, ['providerErrorCode', 'errorCode', 'code']) ??
      readString(createPostSnapshot, ['providerErrorCode', 'errorCode', 'code']),
    providerTrackingId: readString(snapshot, ['providerTrackingId', 'navlungoUpdateProviderTrackingId']),
    validationResponseShape,
    providerShipmentIdPresent: Boolean(execution.providerShipmentId),
    trackingNumberPresent: Boolean(execution.trackingNumber),
    trackingUrlPresent,
    labelPresent: Boolean(execution.labelUrl),
    barcodePresent,
    endpointUsed: readString(snapshot, ['retryEndpointUsed', 'endpointUsed']),
    executionId: readString(snapshot, ['existingExecutionId', 'executionId']),
    providerAtExecution: readString(snapshot, ['existingProvider', 'providerAtExecution', 'provider']),
    existingStatus: readString(snapshot, ['existingStatus']),
    hasProviderEvidenceBefore: readOptionalBoolean(snapshot, ['existingHasProviderEvidence']),
    staleRecoveryAttempted: readOptionalBoolean(snapshot, ['staleRecoveryAttempted']),
    providerCallAttempted: readOptionalBoolean(snapshot, ['providerCallAttempted']),
    providerCallHttpStatus: readNumber(snapshot, ['providerCallHttpStatus', 'createPostHttpStatus', 'httpStatus', 'statusCode']),
    normalizedProviderShipmentIdPresent: readOptionalBoolean(snapshot, [
      'normalizedProviderShipmentIdPresent',
      'providerShipmentIdPresent',
    ]),
    normalizedTrackingUrlPresent: readOptionalBoolean(snapshot, ['normalizedTrackingUrlPresent', 'trackingUrlPresent']),
    normalizedBarcodePresent: readOptionalBoolean(snapshot, ['normalizedBarcodePresent', 'barcodePresent']),
    persistedProviderShipmentIdPresent: readOptionalBoolean(snapshot, ['persistedProviderShipmentIdPresent']),
    persistedTrackingUrlPresent: readOptionalBoolean(snapshot, ['persistedTrackingUrlPresent']),
    persistedBarcodePresent: readOptionalBoolean(snapshot, ['persistedBarcodePresent']),
    dtoProviderShipmentIdPresent: Boolean(execution.providerShipmentId),
    dtoTrackingUrlPresent: trackingUrlPresent,
    dtoBarcodePresent: barcodePresent,
    skipReason: readString(snapshot, ['providerCallSkippedReason', 'skipReason']),
    realPathProviderCallAttempted: readOptionalBoolean(snapshot, ['realPathProviderCallAttempted']),
    realPathCreatePostHttpStatus: readNumber(snapshot, ['realPathCreatePostHttpStatus']),
    realPathRequestedCarrierId:
      readNumber(snapshot, ['realPathRequestedCarrierId']) ?? readString(snapshot, ['realPathRequestedCarrierId']),
    realPathRequestedPostType:
      readNumber(snapshot, ['realPathRequestedPostType']) ?? readString(snapshot, ['realPathRequestedPostType']),
    realPathRequestedBarcodeFormat: readString(snapshot, ['realPathRequestedBarcodeFormat']),
    realPathCodPaymentIncluded: readOptionalBoolean(snapshot, ['realPathCodPaymentIncluded']),
    realPathPriceIncluded: readOptionalBoolean(snapshot, ['realPathPriceIncluded']),
    senderAddressIdPresent: readOptionalBoolean(snapshot, ['senderAddressIdPresent']),
    senderAddressIdValid: readOptionalBoolean(snapshot, ['senderAddressIdValid']),
    senderUsesAddressId: readOptionalBoolean(snapshot, ['senderUsesAddressId']),
    senderMode: readString(snapshot, ['senderMode']),
    fullSenderRetryRequested: readOptionalBoolean(snapshot, ['fullSenderRetryRequested']),
    shopifyFulfillmentSyncAttempted: readOptionalBoolean(snapshot, ['shopifyFulfillmentSyncAttempted']),
    shopifyFulfillmentSyncSkippedReason: readString(snapshot, ['shopifyFulfillmentSyncSkippedReason']),
    shopifyFulfillmentSynced: readOptionalBoolean(snapshot, ['shopifyFulfillmentSynced']),
    autoSyncAttempted: readOptionalBoolean(snapshot, ['autoSyncAttempted']),
    autoSyncSucceeded: readOptionalBoolean(snapshot, ['autoSyncSucceeded']),
    autoSyncSkippedReason: readString(snapshot, ['autoSyncSkippedReason']),
    shopifyFulfillmentId: readString(snapshot, ['shopifyFulfillmentId']),
    shopifyFulfillmentOrderId: readString(snapshot, ['shopifyFulfillmentOrderId']),
    shopifyFulfillmentCancelSyncSkippedReason: readString(snapshot, ['shopifyFulfillmentCancelSyncSkippedReason']),
    fulfillmentTrackingNumberPresent: readOptionalBoolean(snapshot, ['fulfillmentTrackingNumberPresent']),
    fulfillmentTrackingUrlPresent: readOptionalBoolean(snapshot, ['fulfillmentTrackingUrlPresent']),
    navlungoCancelAttempted: readOptionalBoolean(snapshot, ['navlungoCancelAttempted']),
    navlungoCancelHttpStatus: readNumber(snapshot, ['navlungoCancelHttpStatus']),
    navlungoCancelSucceeded: readOptionalBoolean(snapshot, ['navlungoCancelSucceeded']),
    navlungoCancelProviderMessage: readString(snapshot, ['navlungoCancelProviderMessage']),
    navlungoCancelValidationFields: readStringArray(snapshot.navlungoCancelValidationFields),
    navlungoCancelValidationMessages: readValidationStringArray(snapshot.navlungoCancelValidationMessages),
    navlungoCancelProviderTrackingId: readString(snapshot, ['navlungoCancelProviderTrackingId']),
    navlungoCancelledAt: readString(snapshot, ['navlungoCancelledAt']),
    navlungoUpdateAttempted: readOptionalBoolean(snapshot, ['navlungoUpdateAttempted']),
    navlungoUpdateHttpStatus: readNumber(snapshot, ['navlungoUpdateHttpStatus']),
    navlungoUpdateSucceeded: readOptionalBoolean(snapshot, ['navlungoUpdateSucceeded']),
    navlungoUpdateProviderMessage: readString(snapshot, ['navlungoUpdateProviderMessage']),
    navlungoUpdateValidationFields: readStringArray(snapshot.navlungoUpdateValidationFields),
    navlungoUpdateValidationMessages: readValidationStringArray(snapshot.navlungoUpdateValidationMessages),
    navlungoUpdateProviderTrackingId: readString(snapshot, ['navlungoUpdateProviderTrackingId']),
    navlungoUpdateResponseShape,
    navlungoUpdateSenderMode: readString(snapshot, ['navlungoUpdateSenderMode']),
    navlungoUpdateSenderFieldKeys: readStringArray(snapshot.navlungoUpdateSenderFieldKeys),
    navlungoUpdateMissingSenderFields: readStringArray(snapshot.navlungoUpdateMissingSenderFields),
    navlungoUpdateRecipientOverridePresent: readOptionalBoolean(snapshot, ['navlungoUpdateRecipientOverridePresent']),
    navlungoUpdateRecipientOverrideKeys: readStringArray(snapshot.navlungoUpdateRecipientOverrideKeys),
    navlungoUpdateSubmittedRecipientOverrideKeys: readStringArray(snapshot.navlungoUpdateSubmittedRecipientOverrideKeys),
    navlungoUpdateOptionOverrideKeys: readStringArray(snapshot.navlungoUpdateOptionOverrideKeys),
    navlungoUpdateRecipientOverrides: normalizeNavlungoUpdateRecipientOverrides(snapshot.navlungoUpdateRecipientOverrides),
    navlungoUpdatePostNote: readString(snapshot, ['navlungoUpdatePostNote']),
    navlungoUpdateBarcodeFormat: readString(snapshot, ['navlungoUpdateBarcodeFormat']),
    navlungoUpdatedAt: readString(snapshot, ['navlungoUpdatedAt']),
    shopifyFulfillmentUpdateSyncSkippedReason: readString(snapshot, ['shopifyFulfillmentUpdateSyncSkippedReason']),
    navlungoReturnPickupDryRun: readOptionalBoolean(snapshot, ['navlungoReturnPickupDryRun']),
    navlungoReturnPickupAttempted: readOptionalBoolean(snapshot, ['navlungoReturnPickupAttempted']),
    navlungoReturnPickupSucceeded: readOptionalBoolean(snapshot, ['navlungoReturnPickupSucceeded']),
    navlungoReturnPickupMissingFields: readStringArray(snapshot.navlungoReturnPickupMissingFields),
    navlungoReturnPickupPayloadSummary: mapNavlungoRequestSummary(snapshot.navlungoReturnPickupPayloadSummary),
    recipientAddressIdValid: readOptionalBoolean(snapshot, ['recipientAddressIdValid']),
    navlungoStatusSyncAttempted: readOptionalBoolean(snapshot, ['navlungoStatusSyncAttempted']),
    navlungoStatusSyncHttpStatus: readNumber(snapshot, ['navlungoStatusSyncHttpStatus']),
    navlungoStatusSyncResolvedProviderUrl: readString(snapshot, ['navlungoStatusSyncResolvedProviderUrl']),
    navlungoStatusSyncResolvedProviderPath: readString(snapshot, ['navlungoStatusSyncResolvedProviderPath']),
    navlungoStatusSyncRequestPayloadKeys: readStringArray(snapshot.navlungoStatusSyncRequestPayloadKeys),
    navlungoStatusSyncPostPayloadKeys: readStringArray(snapshot.navlungoStatusSyncPostPayloadKeys),
    navlungoStatusSyncLimit: readNumber(snapshot, ['navlungoStatusSyncLimit']),
    navlungoStatusSyncResponseShape: isRecord(snapshot.navlungoStatusSyncResponseShape)
      ? {
          kind: readString(snapshot.navlungoStatusSyncResponseShape, ['kind']) ?? 'unknown',
          topLevelKeys: Array.isArray(snapshot.navlungoStatusSyncResponseShape.topLevelKeys)
            ? snapshot.navlungoStatusSyncResponseShape.topLevelKeys.filter((key): key is string => typeof key === 'string')
            : [],
        }
      : null,
    navlungoProviderStatusCode:
      readNumber(snapshot, ['navlungoProviderStatusCode']) ?? readString(snapshot, ['navlungoProviderStatusCode']),
    navlungoProviderStatusName: readString(snapshot, ['navlungoProviderStatusName']),
    navlungoNormalizedStatus: readString(snapshot, ['navlungoNormalizedStatus']),
    navlungoPickedUpDate: readString(snapshot, ['navlungoPickedUpDate', 'picked_up_date', 'pickedUpDate']),
    navlungoDeliveredDate: readString(snapshot, ['navlungoDeliveredDate', 'delivered_date', 'deliveredDate']),
    navlungoCancelDate: readString(snapshot, ['navlungoCancelDate', 'cancel_date', 'cancelDate']),
    navlungoCarrierTrackingCode:
      readString(snapshot, ['navlungoCarrierTrackingCode', 'carrier_tracking_code', 'carrierTrackingCode']) ??
      execution.trackingNumber,
    navlungoCarrierTrackingUrl:
      readString(snapshot, ['navlungoCarrierTrackingUrl', 'carrier_tracking_url', 'carrierTrackingUrl']) ??
      execution.trackingUrl,
    navlungoBarcodeStatus: readString(snapshot, ['navlungoBarcodeStatus', 'barcodeStatus', 'barcode_status']),
    navlungoTrackingEnriched: readOptionalBoolean(snapshot, ['navlungoTrackingEnriched']),
    navlungoGeoStatus: readString(snapshot, ['navlungoGeoStatus']),
    navlungoGeoBadAddress: readOptionalBoolean(snapshot, ['navlungoGeoBadAddress']),
    navlungoCarrierTrackingPresent: readOptionalBoolean(snapshot, ['navlungoCarrierTrackingPresent']),
    navlungoLogsCount: readNumber(snapshot, ['navlungoLogsCount']) ?? navlungoStatusLogs.length,
    navlungoStatusLogs,
    navlungoStatusSyncProviderTrackingId: readString(snapshot, ['navlungoStatusSyncProviderTrackingId']),
    navlungoStatusSyncValidationFields: readStringArray(snapshot.navlungoStatusSyncValidationFields),
    navlungoStatusSyncValidationMessages: readValidationStringArray(snapshot.navlungoStatusSyncValidationMessages),
    shopifyDeliveryStatusSyncSkippedReason: readString(snapshot, ['shopifyDeliveryStatusSyncSkippedReason']),
    realPathPostNumberPresent: readOptionalBoolean(snapshot, ['realPathPostNumberPresent']),
    realPathTrackingUrlPresent: readOptionalBoolean(snapshot, ['realPathTrackingUrlPresent']),
    realPathBarcodePresent: readOptionalBoolean(snapshot, ['realPathBarcodePresent']),
    realPathPersistedProviderShipmentIdPresent: readOptionalBoolean(snapshot, ['realPathPersistedProviderShipmentIdPresent']),
    realPathPersistedTrackingUrlPresent: readOptionalBoolean(snapshot, ['realPathPersistedTrackingUrlPresent']),
    realPathPersistedBarcodePresent: readOptionalBoolean(snapshot, ['realPathPersistedBarcodePresent']),
    notificationUrlIncluded: readOptionalBoolean(snapshot, ['notificationUrlIncluded']),
    statusField: readString(snapshot, ['statusField', 'shipmentStatus', 'cargoStatus']),
    detectedResponseFormat: readString(snapshot, ['detectedResponseFormat']),
    responseSnippet: readString(snapshot, ['responseSnippet']),
    authHeaderMode: readString(snapshot, ['authHeaderMode']),
    requestId: readString(snapshot, ['requestId']),
    requestPath: readString(snapshot, ['requestPath']),
    selectedEnvironment: readString(snapshot, ['selectedEnvironment']),
    requestTargetHostname: readString(snapshot, ['requestTargetHostname']),
    providerMode: readString(snapshot, ['providerMode']),
    navlungoRequestSummary: mapNavlungoRequestSummary(snapshot.navlungoRequestSummary),
    lastSuccessfulNavlungoRequestSummary: mapNavlungoRequestSummary(snapshot.lastSuccessfulNavlungoRequestSummary),
    lastSuccessfulNavlungoRequestSummarySource: readString(snapshot, ['lastSuccessfulNavlungoRequestSummarySource']),
    lastSuccessfulNavlungoRequestSummaryReason: readString(snapshot, ['lastSuccessfulNavlungoRequestSummaryReason']),
    providerApiCallAttempted: readOptionalBoolean(snapshot, ['providerApiCallAttempted']),
    lastProviderStage: readString(snapshot, ['lastProviderStage']),
    createShipmentCalled:
      readOptionalBoolean(snapshot, ['createShipmentCalled']) ??
      readOptionalBoolean(snapshot, ['createShipmentDraftCalled']),
    priceComparisonCalled: readOptionalBoolean(snapshot, ['priceComparisonCalled']),
    confirmShippingPriceCalled: readOptionalBoolean(snapshot, ['confirmShippingPriceCalled']),
    getShipmentCalled:
      readOptionalBoolean(snapshot, ['getShipmentCalled']) ??
      readOptionalBoolean(snapshot, ['getShipmentAfterConfirmCalled']),
    barcodeFetchCalled: readOptionalBoolean(snapshot, ['barcodeFetchCalled']),
    providerStatus: readString(snapshot, ['providerStatus', 'status']),
    providerStatusLabel: readString(snapshot, ['providerStatusLabel', 'statusLabel']),
    kargonomiCancelled: readOptionalBoolean(snapshot, ['kargonomiCancelled']),
    kargonomiPostCreateDiagnostics: kargonomiGetShipmentAfterConfirm || kargonomiBarcodeFetch
      ? {
          getShipmentAfterConfirm: kargonomiGetShipmentAfterConfirm
            ? {
                httpStatus: readNumber(kargonomiGetShipmentAfterConfirm, ['httpStatus', 'status']),
                contentType: readString(kargonomiGetShipmentAfterConfirm, ['contentType']),
                bodyKeys: readStringArray(kargonomiGetShipmentAfterConfirm.bodyKeys),
                safeFields: kargonomiGetShipmentAfterConfirm.safeFields ?? null,
              }
            : null,
          barcodeFetch: kargonomiBarcodeFetch
            ? {
                httpStatus: readNumber(kargonomiBarcodeFetch, ['httpStatus', 'status']),
                contentType: readString(kargonomiBarcodeFetch, ['contentType']),
                topLevelKeys: readStringArray(kargonomiBarcodeFetch.topLevelKeys),
                bodyKeys: readStringArray(kargonomiBarcodeFetch.bodyKeys),
                detectedFormat: readString(kargonomiBarcodeFetch, ['detectedFormat']),
                pdfLikeValuePresent: readOptionalBoolean(kargonomiBarcodeFetch, ['pdfLikeValuePresent']),
                labelUrlPresent: readOptionalBoolean(kargonomiBarcodeFetch, ['labelUrlPresent']),
              }
            : null,
        }
      : null,
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
    providerResponseSummary: mapProviderResponseSummary(execution, snapshot, barcode),
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

function buildNavlungoReferenceId(input: {
  vendorId: string;
  shopifyOrderNumber: string | null;
  providerMetadata?: unknown;
}) {
  const metadataStoreShort = readString(input.providerMetadata, ['navlungoStoreShort', 'storeShort', 'store_short', 'storeCode']);
  const storeShort = sanitizeNavlungoReferencePart(metadataStoreShort ?? input.vendorId, 'ST', 2);
  const orderNumber = sanitizeNavlungoReferencePart(input.shopifyOrderNumber, 'ORDER');
  return `${storeShort}-${orderNumber}-${buildNavlungoShortUniqueReferencePart()}`;
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

function readNavlungoStatusLogEvents(snapshot: Record<string, unknown>) {
  const logs = Array.isArray(snapshot.navlungoStatusLogs) ? snapshot.navlungoStatusLogs.filter(isRecord) : [];
  return logs
    .map((log) => ({
      statusCode:
        readNumber(log, ['status_code', 'statusCode']) ??
        readString(log, ['status_code', 'statusCode']),
      action: readString(log, ['action']),
      actionResult: readString(log, ['action_result', 'actionResult']),
      createdAt: readString(log, ['created_at', 'createdAt']),
    }))
    .filter((event) => event.action || event.statusCode !== null || event.createdAt);
}

function mapNavlungoTimelineStatusLabel(statusCode: string | number | null, action: string | null) {
  const numeric = typeof statusCode === 'number' ? statusCode : Number(statusCode);
  switch (numeric) {
    case 2:
      return 'Delivered';
    case 4:
      return 'Out for delivery';
    case 9:
    case 21:
      return 'Returned';
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

  const normalizedAction = action?.trim().toLowerCase() ?? '';
  if (/deliver|teslim/.test(normalizedAction)) return 'Delivered';
  if (/cancel|iptal/.test(normalizedAction)) return 'Cancelled';
  if (/return|iade/.test(normalizedAction)) return 'Returned';
  if (/pickup|picked|teslim al/.test(normalizedAction)) return 'Picked up';
  if (/branch|şube|sube/.test(normalizedAction)) return 'Waiting at branch';
  if (/transit|yolda|transfer/.test(normalizedAction)) return 'In transit';
  return action?.trim() || 'Shipment status updated';
}

function appendNavlungoStatusLogTimelineEvents(snapshot: Record<string, unknown>) {
  return readNavlungoStatusLogEvents(snapshot).reduce((current, event) => {
    const label = mapNavlungoTimelineStatusLabel(event.statusCode, event.action);
    const fingerprint = [
      'navlungo_status_log',
      event.action ?? '',
      event.statusCode ?? '',
      event.createdAt ?? '',
    ].join('|');
    const fingerprints = Array.isArray(current.timelineEventFingerprints)
      ? current.timelineEventFingerprints.filter((value): value is string => typeof value === 'string')
      : [];
    if (fingerprints.includes(fingerprint)) {
      return current;
    }

    return {
      ...current,
      timeline: [
        ...readTimeline(current),
        {
          label,
          at: event.createdAt ?? new Date().toISOString(),
          status: event.actionResult ?? (event.statusCode === null ? null : String(event.statusCode)),
        },
      ],
      timelineEventFingerprints: [...fingerprints, fingerprint],
    };
  }, snapshot as Record<string, unknown>);
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

function resolveNavlungoSenderAddressId(config: VendorShippingConfigDto, env?: AppEnv) {
  return (
    readString(config.providerMetadata, ['navlungoSenderAddressId', 'senderAddressId', 'sender_address_id']) ??
    selectDefaultWarehouse(config, 'navlungo')?.warehouseId ??
    config.defaultWarehouseId ??
    env?.NAVLUNGO_DEFAULT_SENDER_ADDRESS_ID ??
    null
  );
}

function parseNavlungoSenderAddressId(value: string | null | undefined) {
  if (!value?.trim()) {
    return null;
  }
  const numeric = Number(value.trim());
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

function resolveNavlungoSenderField(config: VendorShippingConfigDto, keys: string[], fallback?: string | null) {
  const fromMetadata = readString(config.providerMetadata, keys);
  if (fromMetadata !== null) {
    return fromMetadata;
  }
  return fallback?.trim() || null;
}

function buildNavlungoSender(config: VendorShippingConfigDto, options: { useFullSenderDetails?: boolean; requireEmail?: boolean } = {}) {
  if (options.useFullSenderDetails) {
    const defaultWarehouse = selectDefaultWarehouse(config, 'navlungo') ?? config.warehouses[0] ?? null;
    const sender = {
      name: resolveNavlungoSenderField(config, ['navlungoSenderName', 'senderName', 'sender_name'], defaultWarehouse?.name) ?? '',
      phone: normalizeNavlungoPhone(
        resolveNavlungoSenderField(config, ['navlungoSenderPhone', 'senderPhone', 'sender_phone']),
      ) ?? '',
      email: resolveNavlungoSenderField(config, ['navlungoSenderEmail', 'senderEmail', 'sender_email']) ?? '',
      address: resolveNavlungoSenderField(
        config,
        ['navlungoSenderAddress', 'senderAddress', 'sender_address'],
        defaultWarehouse?.address,
      ) ?? '',
      country: resolveNavlungoSenderField(config, ['navlungoSenderCountry', 'senderCountry', 'sender_country'], 'tr') ?? '',
      city: resolveNavlungoSenderField(config, ['navlungoSenderCity', 'senderCity', 'sender_city']) ?? '',
      district: resolveNavlungoSenderField(config, ['navlungoSenderDistrict', 'senderDistrict', 'sender_district']) ?? '',
      post_code: resolveNavlungoSenderField(config, ['navlungoSenderPostCode', 'senderPostCode', 'sender_post_code']) ?? '',
    };
    const requireEmail = options.requireEmail !== false;
    const missingFields = [
      sender.name ? null : 'sender.name',
      sender.phone ? null : 'sender.phone',
      requireEmail && !sender.email ? 'sender.email' : null,
      sender.address ? null : 'sender.address',
      sender.country ? null : 'sender.country',
      sender.city ? null : 'sender.city',
      sender.district ? null : 'sender.district',
    ].filter((field): field is string => Boolean(field));

    return {
      sender: missingFields.length === 0 ? sender : null,
      missingFields,
      mode: 'fullSender' as const,
    };
  }

  const senderAddressId = parseNavlungoSenderAddressId(resolveNavlungoSenderAddressId(config));

  return {
    sender: senderAddressId ? { addressId: senderAddressId } : null,
    missingFields: senderAddressId ? [] : ['sender.addressId'],
    mode: 'addressId' as const,
  };
}

function resolveNavlungoCarrierId(providerMetadata: unknown, env?: AppEnv) {
  const value = readString(providerMetadata, ['navlungoCarrierId', 'carrierId', 'carrier_id']) ?? env?.NAVLUNGO_DEFAULT_CARRIER_ID ?? '9';
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

function resolveNavlungoBarcodeFormat(providerMetadata: unknown, env?: AppEnv) {
  return readString(providerMetadata, ['navlungoBarcodeFormat', 'barcodeFormat', 'barcode_format']) ?? env?.NAVLUNGO_DEFAULT_BARCODE_FORMAT ?? 'pdf-A6';
}

function resolveNavlungoReturnBarcodeFormat(providerMetadata: unknown) {
  return readString(providerMetadata, [
    'navlungoReturnBarcodeFormat',
    'returnBarcodeFormat',
    'return_barcode_format',
    'navlungo_return_barcode_format',
  ]) ?? 'pdf-A5';
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

function isNavlungoEmailLike(value: string | null | undefined) {
  return !value?.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
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

function readStoredOrderWebhookShippingAddressRecord(orderRecord: Record<string, unknown>) {
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
      if (shippingAddress) {
        return shippingAddress;
      }
    } catch {
      continue;
    }
  }

  return null;
}

function normalizeKargonomiDestinationValue(value: string | null | undefined) {
  return value
    ?.replace(/[,\.;:_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase() ?? '';
}

function isInvalidKargonomiDestinationValue(value: string | null | undefined) {
  const normalized = normalizeKargonomiDestinationValue(value);
  if (!normalized) {
    return true;
  }

  const tokens = normalized.split(' ').filter(Boolean);
  return tokens.length > 0 && tokens.every((token) => token === 'na' || token === 'n/a');
}

function validateKargonomiOrderDestination(
  order: unknown,
  customerOverrides?: CreateShipmentExecutionDto['customerOverrides'],
) {
  const orderRecord = isRecord(order) ? order : {};
  const webhookAddress = readStoredOrderWebhookAddress(orderRecord);
  const overrides = normalizeCustomerOverrides(customerOverrides);
  const destination = readKargonomiDestinationText(order, customerOverrides);
  const address = overrides.address ?? composeShipmentAddress(orderRecord) ?? webhookAddress?.shippingAddress ?? null;
  const stateText = destination.province ?? destination.city ?? null;
  const storedDestinationIdsPresent = hasKargonomiOrderDestinationIds(order);
  const missingFields = [
    isInvalidKargonomiDestinationValue(address) ? 'buyer.buyer_address' : null,
    isInvalidKargonomiDestinationValue(stateText) ? 'buyer.buyer_state_id' : null,
    !storedDestinationIdsPresent && isInvalidKargonomiDestinationValue(destination.district) ? 'buyer.buyer_city_id' : null,
  ].filter((field): field is string => Boolean(field));

  return {
    invalid: missingFields.length > 0,
    missingFields,
    destination,
  };
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

function buildNavlungoRecipient(input: {
  order: unknown;
  customerName: string | null | undefined;
  customerEmail: string | null | undefined;
  customerOverrides?: CreateShipmentExecutionDto['customerOverrides'];
}) {
  const orderRecord = isRecord(input.order) ? input.order : {};
  const webhookAddress = readStoredOrderWebhookAddress(orderRecord);
  const overrides = normalizeCustomerOverrides(input.customerOverrides);
  const recipient = {
    name: overrides.name ?? input.customerName ?? readString(orderRecord, ['customerName', 'name']),
    phone: normalizeNavlungoPhone(
      overrides.phone ??
        readString(orderRecord, ['customerPhone', 'phone', 'shippingPhone', 'billingPhone']) ??
        webhookAddress?.customerPhone ??
        readStoredOrderWebhookPhone(orderRecord),
    ),
    email: overrides.email ?? input.customerEmail ?? readString(orderRecord, ['customerEmail', 'email']),
    address: overrides.address ?? composeShipmentAddress(orderRecord) ?? webhookAddress?.shippingAddress ?? null,
    country: overrides.country ?? readString(orderRecord, ['shippingCountry', 'country']) ?? webhookAddress?.shippingCountry ?? 'tr',
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
        'billingDistrict',
        'billingCounty',
        'billingCityArea',
      ]) ??
      webhookAddress?.shippingDistrict ??
      readStoredOrderWebhookDistrict(orderRecord) ??
      null,
    post_code:
      overrides.postcode ??
      readString(orderRecord, ['shippingPostcode', 'postcode', 'zip']) ??
      webhookAddress?.shippingPostcode ??
      '',
  };
  const requiredFields = ['name', 'phone', 'email', 'address', 'country', 'city', 'district'] as const;
  const missingFields = requiredFields
    .filter((key) => !recipient[key])
    .map((key) => `recipient.${key}`);

  return {
    recipient,
    missingFields,
  };
}

function buildNavlungoUpdateRecipient(input: {
  order: unknown;
  customerName: string | null | undefined;
  customerEmail: string | null | undefined;
  recipient?: UpdateNavlungoShipmentDto['recipient'];
}) {
  const base = buildNavlungoRecipient({
    order: input.order,
    customerName: input.customerName,
    customerEmail: input.customerEmail,
    customerOverrides: input.recipient,
  });
  const recipient = {
    ...base.recipient,
    email: base.recipient.email ?? '',
    post_code: base.recipient.post_code ?? '',
  };
  const missingFields = [
    recipient.name ? null : 'recipient.name',
    recipient.phone ? null : 'recipient.phone',
    recipient.address ? null : 'recipient.address',
    recipient.country ? null : 'recipient.country',
    recipient.city ? null : 'recipient.city',
    recipient.district ? null : 'recipient.district',
    isNavlungoEmailLike(recipient.email) ? null : 'recipient.email',
  ].filter((field): field is string => Boolean(field));

  return {
    recipient,
    missingFields,
  };
}

const NAVLUNGO_UPDATE_RECIPIENT_OVERRIDE_FIELDS = [
  'name',
  'phone',
  'email',
  'country',
  'postcode',
  'city',
  'district',
  'address',
] as const;

type NavlungoUpdateRecipientOverrideField = typeof NAVLUNGO_UPDATE_RECIPIENT_OVERRIDE_FIELDS[number];

function normalizeNavlungoUpdateRecipientOverrides(value: unknown) {
  if (!isRecord(value)) {
    return {} as Partial<Record<NavlungoUpdateRecipientOverrideField, string>>;
  }

  return Object.fromEntries(
    NAVLUNGO_UPDATE_RECIPIENT_OVERRIDE_FIELDS
      .map((field) => {
        const raw = value[field];
        return [field, typeof raw === 'string' ? raw.trim() : ''] as const;
      })
      .filter(([, raw]) => raw.length > 0),
  ) as Partial<Record<NavlungoUpdateRecipientOverrideField, string>>;
}

function readNavlungoUpdateOverrides(snapshot: unknown) {
  const snapshotRecord = isRecord(snapshot) ? snapshot : {};
  const nested = isRecord(snapshotRecord.navlungoUpdateOverrides) ? snapshotRecord.navlungoUpdateOverrides : {};
  const recipient = {
    ...normalizeNavlungoUpdateRecipientOverrides(snapshotRecord.navlungoUpdateRecipientOverrides),
    ...normalizeNavlungoUpdateRecipientOverrides(nested.recipient),
  };
  const postNote =
    readString(nested, ['postNote']) ??
    readString(snapshotRecord, ['navlungoUpdatePostNote']);
  const barcodeFormat =
    readString(nested, ['barcodeFormat']) ??
    readString(snapshotRecord, ['navlungoUpdateBarcodeFormat']);

  return {
    recipient,
    postNote,
    barcodeFormat,
  };
}

function buildNavlungoUpdateOverrideSnapshot(input: {
  recipient: Partial<Record<NavlungoUpdateRecipientOverrideField, string>>;
  submittedRecipient: Partial<Record<NavlungoUpdateRecipientOverrideField, string>>;
  postNote: string | null;
  barcodeFormat: string | null;
  submittedOptionKeys: string[];
}) {
  const recipientKeys = Object.keys(input.recipient).sort();

  return {
    navlungoUpdateOverrides: {
      recipient: input.recipient,
      postNote: input.postNote ?? '',
      barcodeFormat: input.barcodeFormat ?? '',
    },
    navlungoUpdateRecipientOverrides: input.recipient,
    navlungoUpdateRecipientOverridePresent: recipientKeys.length > 0,
    navlungoUpdateRecipientOverrideKeys: recipientKeys,
    navlungoUpdateSubmittedRecipientOverrideKeys: Object.keys(input.submittedRecipient).sort(),
    navlungoUpdateOptionOverrideKeys: input.submittedOptionKeys.sort(),
    navlungoUpdatePostNote: input.postNote ?? '',
    navlungoUpdateBarcodeFormat: input.barcodeFormat ?? '',
  };
}

function buildNavlungoReturnPickupPayload(input: {
  allocation: {
    id: string;
    assignedVendorId: string;
    sourceShopifyOrderNumber: string | null;
    order: unknown;
  };
  config: VendorShippingConfigDto;
  env: AppEnv;
  customerOverrides?: CreateShipmentExecutionDto['customerOverrides'];
}) {
  const recipientAddressId = parseNavlungoSenderAddressId(resolveNavlungoSenderAddressId(input.config, input.env));
  const sender = buildNavlungoRecipient({
    order: input.allocation.order,
    customerName: isRecord(input.allocation.order) ? readString(input.allocation.order, ['customerName']) : null,
    customerEmail: isRecord(input.allocation.order) ? readString(input.allocation.order, ['customerEmail']) : null,
    customerOverrides: input.customerOverrides,
  });
  const carrierId = resolveNavlungoCarrierId(input.config.providerMetadata, input.env);
  const barcodeFormat = resolveNavlungoReturnBarcodeFormat(input.config.providerMetadata);
  const desi = Number(input.config.defaultDesi || 1);
  const referenceId = buildNavlungoReferenceId({
    vendorId: input.allocation.assignedVendorId,
    shopifyOrderNumber: input.allocation.sourceShopifyOrderNumber,
    providerMetadata: input.config.providerMetadata,
  });
  const missingFields = [
    ...sender.missingFields.map((field) => field.replace(/^recipient\./, 'sender.')),
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
        sender: {
          name: sender.recipient.name ?? '',
          phone: sender.recipient.phone ?? '',
          email: sender.recipient.email ?? '',
          address: sender.recipient.address ?? '',
          country: sender.recipient.country ?? 'tr',
          city: sender.recipient.city ?? '',
          district: sender.recipient.district ?? '',
          post_code: sender.recipient.post_code ?? '',
        },
        recipient: recipientAddressId ? { addressId: recipientAddressId } : { addressId: 0 },
        post: {
          desi: Number.isFinite(desi) && desi > 0 ? desi : 1,
          package_count: 1,
          price: '',
          note: '',
        },
        barcode_format: barcodeFormat,
        custom_data_1: input.allocation.id,
        custom_data_2: input.allocation.sourceShopifyOrderNumber ?? '',
        custom_data_3: input.allocation.assignedVendorId,
        custom_data_4: 'return_pickup',
      },
    ],
  };

  return {
    payload,
    missingFields,
    summary: summarizeNavlungoCreatePostRequest(payload, input.env),
    recipientAddressIdValid: Boolean(recipientAddressId),
  };
}

type KargonomiDistrictResolutionSource = 'exact' | 'shopify_worldwide_split' | 'unresolved';

function readKargonomiDestinationCountryCode(input: {
  orderRecord: Record<string, unknown>;
  webhookAddress: ReturnType<typeof readStoredOrderWebhookAddress>;
  webhookShippingAddress: Record<string, unknown> | null;
}) {
  return (
    readString(input.orderRecord, ['shippingCountry', 'country', 'countryCode', 'country_code']) ??
    input.webhookAddress?.shippingCountry ??
    readString(input.webhookShippingAddress ?? {}, ['country_code', 'countryCode', 'country'])
  );
}

function resolveKargonomiDistrictText(input: {
  orderRecord: Record<string, unknown>;
  webhookAddress: ReturnType<typeof readStoredOrderWebhookAddress>;
  webhookShippingAddress: Record<string, unknown> | null;
  overrideDistrict?: string | null;
}): {
  district: string | null;
  rawValue: string | null;
  source: KargonomiDistrictResolutionSource;
} {
  if (input.overrideDistrict) {
    return {
      district: input.overrideDistrict,
      rawValue: input.overrideDistrict,
      source: 'exact',
    };
  }

  const countryCode = readKargonomiDestinationCountryCode(input);
  const explicitWebhookDistrict = readString(input.webhookShippingAddress ?? {}, [
    'district',
    'district_name',
    'districtName',
    'city_area',
    'cityArea',
    'county',
    'county_name',
    'countyName',
  ]);
  if (explicitWebhookDistrict) {
    return {
      district: explicitWebhookDistrict,
      rawValue: explicitWebhookDistrict,
      source: 'exact',
    };
  }

  const storedDistrict = readString(input.orderRecord, [
    'shippingDistrict',
    'district',
    'shippingCounty',
    'county',
    'shippingCityArea',
    'cityArea',
    'billingDistrict',
    'billingCounty',
    'billingCityArea',
  ]);
  const rawAddress2 = readString(input.webhookShippingAddress ?? {}, ['address2']);

  for (const rawValue of [rawAddress2, storedDistrict]) {
    const split = splitShopifyWorldwideAddress2({ address2: rawValue, countryCode });
    if (split.splitSource === 'shopify_worldwide' && split.district) {
      return {
        district: split.district,
        rawValue: rawValue ?? null,
        source: 'shopify_worldwide_split',
      };
    }
  }

  const exactDistrict =
    storedDistrict ??
    input.webhookAddress?.shippingDistrict ??
    readStoredOrderWebhookDistrict(input.orderRecord);
  if (exactDistrict) {
    return {
      district: exactDistrict,
      rawValue: exactDistrict,
      source: 'exact',
    };
  }

  return {
    district: null,
    rawValue: rawAddress2 ?? null,
    source: 'unresolved',
  };
}

function readKargonomiDestinationText(
  order: unknown,
  customerOverrides?: CreateShipmentExecutionDto['customerOverrides'],
) {
  const orderRecord = isRecord(order) ? order : {};
  const webhookAddress = readStoredOrderWebhookAddress(orderRecord);
  const webhookShippingAddress = readStoredOrderWebhookShippingAddressRecord(orderRecord);
  const overrides = normalizeCustomerOverrides(customerOverrides);
  const province =
    readString(orderRecord, ['shippingProvince', 'province', 'shippingState', 'state']) ??
    null;
  const city = overrides.city ?? readString(orderRecord, ['shippingCity', 'city']) ?? webhookAddress?.shippingCity ?? null;
  const districtResolution = resolveKargonomiDistrictText({
    orderRecord,
    webhookAddress,
    webhookShippingAddress,
    overrideDistrict: overrides.district ?? null,
  });

  return {
    province,
    city,
    district: districtResolution.district,
    districtRawValue: districtResolution.rawValue,
    districtResolvedValue: districtResolution.district,
    districtResolutionSource: districtResolution.source,
  };
}

function buildKargonomiDistrictResolutionDiagnostics(destination: ReturnType<typeof readKargonomiDestinationText>) {
  return {
    districtRawValue: destination.districtRawValue,
    districtResolvedValue: destination.districtResolvedValue,
    districtResolutionSource: destination.districtResolutionSource,
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
  auditContext: {
    actor?: VendorProfileAuditActor | null;
    reason?: string | null;
    source?: string;
  } = {},
): Promise<VendorShippingConfigDto> {
  const defaultConfig = mapShippingConfig(null, vendorId);
  const existingConfig = await getStoredShippingConfig(vendorId);
  const beforeConfig = mapShippingConfig(existingConfig, vendorId);
  const preferredProvider = normalizeProvider(input.preferredProvider ?? defaultConfig.preferredProvider);
  const defaultDesi = input.defaultDesi ?? Number(defaultConfig.defaultDesi);
  const shippingVatPercent = input.shippingVatPercent ?? Number(defaultConfig.shippingVatPercent);
  const providerMetadataForSave =
    input.providerMetadata !== undefined &&
    preferredProvider === ShippingProvider.NAVLUNGO &&
    isRecord(existingConfig?.providerMetadata) &&
    isRecord(input.providerMetadata)
      ? { ...existingConfig.providerMetadata, ...input.providerMetadata }
      : input.providerMetadata;

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
          providerMetadataForSave === undefined
            ? undefined
            : (providerMetadataForSave as Prisma.InputJsonValue),
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
          providerMetadataForSave === undefined
            ? Prisma.JsonNull
            : (providerMetadataForSave as Prisma.InputJsonValue),
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
      const existingWarehouse = (existingConfig?.warehouses ?? []).find(
        (warehouse) => warehouse.provider === warehouseProvider && warehouse.warehouseId === warehouseInput.warehouseId,
      );
      const incomingName = typeof warehouseInput.name === 'string' && warehouseInput.name.trim()
        ? warehouseInput.name.trim()
        : null;
      const incomingAddress = typeof warehouseInput.address === 'string' && warehouseInput.address.trim()
        ? warehouseInput.address.trim()
        : null;
      const isDefault = Boolean(warehouseInput.isDefault) || warehouseInput.warehouseId === input.defaultWarehouseId;

      if (isDefault) {
        await tx.vendorShippingWarehouse.updateMany({
          where: {
            vendorId,
            provider: warehouseProvider,
          },
          data: {
            isDefault: false,
          },
        });
      }

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
          name: incomingName ?? existingWarehouse?.name ?? null,
          address: incomingAddress ?? existingWarehouse?.address ?? null,
          isDefault,
        },
        create: {
          configId: savedConfig.id,
          vendorId,
          provider: warehouseProvider,
          warehouseId: warehouseInput.warehouseId,
          name: incomingName,
          address: incomingAddress,
          isDefault,
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

  const mappedConfig = mapShippingConfig(config, vendorId);
  await auditVendorProfileChanges({
    vendorId,
    section: 'shipping_operations',
    before: beforeConfig as unknown as Record<string, unknown>,
    after: mappedConfig as unknown as Record<string, unknown>,
    actor: auditContext.actor,
    reason: auditContext.reason,
    source: auditContext.source ?? 'admin_shipping_config_update',
  });

  return mappedConfig;
}

type KargonomiWarehouseDetailClient = Pick<KargonomiHttpClient, 'getWarehouse' | 'listStates' | 'listCities'>;

function extractKargonomiWarehouseBody(body: unknown) {
  if (!isRecord(body)) {
    return {};
  }

  if (isRecord(body.warehouse)) {
    return body.warehouse;
  }

  if (isRecord(body.data)) {
    if (isRecord(body.data.warehouse)) {
      return body.data.warehouse;
    }
    return body.data;
  }

  return body;
}

function readNestedStringValue(value: unknown, keys: string[]) {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (!isRecord(value)) {
    return null;
  }
  return readString(value, keys);
}

function readKargonomiWarehouseDetailString(warehouse: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const direct = readNestedStringValue(warehouse[key], ['name', 'title', 'value', 'label']);
    if (direct) {
      return direct;
    }
  }

  return null;
}

function buildKargonomiWarehouseSyncMetadata(input: {
  existingMetadata: unknown;
  contactName: string | null;
  phone: string | null;
  stateName: string;
  cityName: string;
  stateId: string;
  cityId: string;
  syncedAt: string;
}) {
  const metadata = isRecord(input.existingMetadata) ? { ...input.existingMetadata } : {};
  return {
    ...metadata,
    contactName: input.contactName,
    phone: input.phone,
    stateName: input.stateName,
    cityName: input.cityName,
    stateId: input.stateId,
    cityId: input.cityId,
    lookupStatus: 'resolved',
    lookupError: null,
    kargonomiWarehouseSyncedAt: input.syncedAt,
  };
}

export async function syncKargonomiWarehouseDetails(
  vendorId: string,
  warehouseId: string,
  env: AppEnv,
  options: { client?: KargonomiWarehouseDetailClient } = {},
): Promise<KargonomiWarehouseSyncResultDto> {
  if (!/^\d+$/.test(warehouseId)) {
    throw new Error('warehouseId must be numeric.');
  }

  const config = await getStoredShippingConfig(vendorId);
  const warehouse = (config?.warehouses ?? []).find(
    (item) => mapProvider(item.provider) === 'kargonomi' && item.warehouseId === warehouseId,
  );
  if (!config || !warehouse) {
    throw new Error('Kargonomi warehouse is not configured for this vendor.');
  }

  const client = options.client ?? new KargonomiHttpClient(env);
  const response = await client.getWarehouse(warehouseId);
  if (!response.ok) {
    const bodyKeys = isRecord(response.body) ? Object.keys(response.body) : [];
    throw new Error(`Kargonomi warehouse detail lookup failed with HTTP ${response.status}. Body keys: ${bodyKeys.join(', ') || 'none'}.`);
  }

  const detail = extractKargonomiWarehouseBody(response.body);
  const contactName = readKargonomiWarehouseDetailString(detail, ['contact_name', 'contactName']);
  const phone = readKargonomiWarehouseDetailString(detail, ['contact_phone', 'contactPhone', 'phone']);
  const address = readKargonomiWarehouseDetailString(detail, ['address']);
  const stateName = readKargonomiWarehouseDetailString(detail, ['state', 'state_name', 'stateName']);
  const cityName = readKargonomiWarehouseDetailString(detail, ['city', 'city_name', 'cityName']);

  if (!stateName) {
    throw new Error('Kargonomi warehouse detail is missing state name; stateId cannot be resolved safely.');
  }
  if (!cityName) {
    throw new Error('Kargonomi warehouse detail is missing city name; cityId cannot be resolved safely.');
  }

  const resolution = await resolveKargonomiDestinationAddress(
    {
      province: stateName,
      district: cityName,
    },
    client,
  );
  if (!resolution.ok) {
    throw new Error(`Kargonomi warehouse location could not be resolved: ${resolution.message}`);
  }

  const syncedAt = new Date().toISOString();
  await prisma.vendorShippingWarehouse.update({
    where: {
      vendorId_provider_warehouseId: {
        vendorId,
        provider: ShippingProvider.KARGONOMI,
        warehouseId,
      },
    },
    data: {
      address: address ?? warehouse.address,
      metadata: buildKargonomiWarehouseSyncMetadata({
        existingMetadata: warehouse.metadata,
        contactName,
        phone,
        stateName: resolution.stateName,
        cityName: resolution.cityName,
        stateId: resolution.buyerStateId,
        cityId: resolution.buyerCityId,
        syncedAt,
      }) as Prisma.InputJsonValue,
    },
  });

  const syncedConfig = await getVendorShippingConfig(vendorId);
  return {
    ok: true,
    provider: 'KARGONOMI',
    mode: 'warehouse_detail_sync',
    vendorId,
    warehouseId,
    writesPerformed: true,
    warehouse: {
      contactNamePresent: Boolean(contactName),
      phonePresent: Boolean(phone),
      addressPresent: Boolean(address ?? warehouse.address),
      stateName: resolution.stateName,
      cityName: resolution.cityName,
      stateId: resolution.buyerStateId,
      cityId: resolution.buyerCityId,
    },
    syncedConfig,
    warnings: [],
  };
}

export function getShippingProviderGateDiagnostics(
  env: AppEnv,
  providerOverride?: ShippingProviderDto,
): ShippingProviderGateDiagnosticsDto {
  const provider = providerOverride ?? env.SHIPPING_PROVIDER;
  if (provider === 'try_oto' || provider === 'navlungo') {
    return {
      provider,
      supportedProviders: ['kargonomi'],
      executionReady: false,
      sandboxModeEnabled: env.SHIPPING_SANDBOX_MODE,
      shippingExecutionEnabled: env.SHIPPING_EXECUTION_ENABLED,
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
      webhookAuthenticityVerification: buildTryOtoWebhookAuthenticityVerification(),
      baseUrlConfigured: false,
      apiKeyConfigured: false,
      cargoIntegrationIdConfigured: false,
      warehouseIdConfigured: false,
      defaultDesiConfigured: false,
      packageTypeUsed: '',
      notificationUrlConfigured: false,
      webhookRouteImplemented: false,
      receiverAddressAvailability: 'confirmed_required',
      dummyKargoSupport: 'not_implemented',
      statusSyncSupport: 'not_implemented',
      missing: ['inactive_shipping_provider'],
      deprecatedEnvFallbacks: [],
      warnings: [buildPassiveShippingProviderMessage(provider)],
    };
  }
  const isKargonomi = provider === 'kargonomi';
  const supportedProviders: ShippingProviderDto[] = ['kargonomi'];
  const providerSelected = env.SHIPPING_PROVIDER === provider;
  const providerEnabled = isKargonomi ? providerSelected : false;
  const baseUrlConfigured = isKargonomi ? Boolean(env.KARGONOMI_BASE_URL) : false;
  const apiKeyConfigured = isKargonomi ? Boolean(env.KARGONOMI_API_TOKEN) : false;
  const cargoIntegrationIdConfigured = false;
  const packageTypeUsed = '';
  const missing = [
    !env.SHIPPING_EXECUTION_ENABLED ? 'SHIPPING_EXECUTION_ENABLED' : null,
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
      apiKeyConfigured,
    sandboxModeEnabled: env.SHIPPING_SANDBOX_MODE,
    shippingExecutionEnabled: env.SHIPPING_EXECUTION_ENABLED,
    providerSelected,
    providerEnabled,
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
    webhookAuthenticityVerification: buildTryOtoWebhookAuthenticityVerification(),
    baseUrlConfigured,
    apiKeyConfigured,
    cargoIntegrationIdConfigured,
    warehouseIdConfigured: false,
    defaultDesiConfigured: false,
    packageTypeUsed,
    notificationUrlConfigured: false,
    webhookRouteImplemented: true,
    receiverAddressAvailability: 'confirmed_required',
    dummyKargoSupport: 'not_implemented',
    statusSyncSupport: 'not_implemented',
    missing,
    deprecatedEnvFallbacks: [],
    warnings: isKargonomi
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
    diagnostics.provider !== 'kargonomi' ||
    !vendorId
  ) {
    return diagnostics;
  }

  const config = mapShippingConfig(await getStoredShippingConfig(vendorId), vendorId);
  const configProviderSelected = mapProvider(config.preferredProvider) === diagnostics.provider;
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

  if (diagnostics.provider === 'navlungo') {
    const senderAddressId = resolveNavlungoSenderAddressId(config, env);
    const senderAddressIdConfigured = Boolean(senderAddressId);
    const senderAddressIdValid = Boolean(parseNavlungoSenderAddressId(senderAddressId));
    const carrierIdConfiguredOrDefaulted = Boolean(resolveNavlungoCarrierId(config.providerMetadata, env));
    const defaultDesiConfigured = Number(config.defaultDesi) > 0;
    const missing = [
      ...diagnostics.missing,
      !configProviderSelected ? 'VENDOR_PROVIDER_SELECTION' : null,
      !senderAddressIdValid ? 'VENDOR_NAVLUNGO_SENDER_ADDRESS_ID' : null,
      !carrierIdConfiguredOrDefaulted ? 'VENDOR_NAVLUNGO_CARRIER_ID' : null,
      !defaultDesiConfigured ? 'VENDOR_DEFAULT_DESI' : null,
    ].filter((value): value is string => Boolean(value));

    return {
      ...diagnostics,
      providerSelected: configProviderSelected,
      executionReady:
        diagnostics.executionReady &&
        configProviderSelected &&
        senderAddressIdValid &&
        carrierIdConfiguredOrDefaulted &&
        defaultDesiConfigured,
      warehouseIdConfigured: senderAddressIdConfigured,
      defaultDesiConfigured,
      missing,
      navlungo: {
        usernameConfigured: Boolean(env.NAVLUNGO_API_USERNAME),
        passwordConfigured: Boolean(env.NAVLUNGO_API_PASSWORD),
        defaultSenderAddressIdConfigured: senderAddressIdConfigured,
        defaultSenderAddressIdValid: senderAddressIdValid,
        senderFieldsConfigured: senderAddressIdValid,
        defaultBarcodeFormat: resolveNavlungoBarcodeFormat(config.providerMetadata, env),
        defaultCarrierId: String(resolveNavlungoCarrierId(config.providerMetadata, env) ?? ''),
        authDiagnosticsAvailable: true,
        runtimeShipmentExecutionEnabled: true,
        returnReverseImplementation: 'not_implemented' as const,
      },
    };
  }

  const warehouse = selectDefaultWarehouse(config, diagnostics.provider);
  const cargoIntegrationIdConfigured = Boolean(config.cargoIntegrationId);
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
    packageTypeUsed: '',
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

type NavlungoMappedRequestSummary = NonNullable<ShipmentExecutionDto['providerResponseSummary']>['navlungoRequestSummary'];

function hasRequiredNavlungoSummaryKeys(summary: NavlungoMappedRequestSummary) {
  if (!summary) {
    return false;
  }

  return (
    summary.senderKeys.length > 0 &&
    summary.recipientKeys.includes('district') &&
    summary.recipientKeys.includes('city') &&
    summary.recipientKeys.includes('address') &&
    summary.postKeys.includes('recipient') &&
    summary.postKeys.includes('sender') &&
    summary.postKeys.includes('post') &&
    summary.postPayloadKeys.includes('desi') &&
    summary.postPayloadKeys.includes('package_count')
  );
}

function isValidSuccessfulNavlungoRequestSummary(summary: NavlungoMappedRequestSummary) {
  return Boolean(
    summary &&
      hasRequiredNavlungoSummaryKeys(summary) &&
      summary.recipientDistrictPresent &&
      summary.recipientCityPresent &&
      summary.recipientAddressPresent &&
      summary.desiPresent &&
      summary.packageCountPresent,
  );
}

function isSuccessfulNavlungoExecutionStatus(status: ShipmentExecutionStatus) {
  return (
    status === ShipmentExecutionStatus.CREATED ||
    status === ShipmentExecutionStatus.IN_TRANSIT ||
    status === ShipmentExecutionStatus.DELIVERED ||
    status === ShipmentExecutionStatus.RETURNED
  );
}

async function findLatestSuccessfulNavlungoRequestSummary(vendorId: string, excludeExecutionId?: string | null) {
  const executions = await prisma.shipmentExecution.findMany({
    where: {
      vendorId,
      provider: ShippingProvider.NAVLUNGO,
      shipmentStatus: {
        in: [
          ShipmentExecutionStatus.CREATED,
          ShipmentExecutionStatus.IN_TRANSIT,
          ShipmentExecutionStatus.DELIVERED,
          ShipmentExecutionStatus.RETURNED,
        ],
      },
      ...(excludeExecutionId ? { id: { not: excludeExecutionId } } : {}),
    },
    orderBy: {
      updatedAt: 'desc',
    },
    take: 25,
  });

  if (!Array.isArray(executions)) {
    return null;
  }

  for (const execution of executions) {
    if (!isSuccessfulNavlungoExecutionStatus(execution.shipmentStatus)) {
      continue;
    }
    if (!hasPersistedShipmentEvidence(execution)) {
      continue;
    }
    const snapshot = isRecord(execution.responseSnapshot) ? execution.responseSnapshot : null;
    const summary = mapNavlungoRequestSummary(snapshot?.navlungoRequestSummary);
    if (isValidSuccessfulNavlungoRequestSummary(summary)) {
      return summary;
    }
  }

  return null;
}

async function buildProviderFailureSnapshotWithDurableDiagnostics(
  error: unknown,
  provider: ShippingProvider,
  baseSnapshot: unknown,
  options?: {
    vendorId?: string | null;
    executionId?: string | null;
  },
) {
  const snapshot: Record<string, unknown> = buildProviderFailureSnapshot(error, provider, baseSnapshot);
  if (provider !== ShippingProvider.NAVLUNGO || !options?.vendorId) {
    return snapshot;
  }

  const latestSummary = await findLatestSuccessfulNavlungoRequestSummary(options.vendorId, options.executionId);
  return latestSummary
    ? {
        ...snapshot,
        lastSuccessfulNavlungoRequestSummary: latestSummary,
        lastSuccessfulNavlungoRequestSummarySource: 'latest_successful_vendor_execution',
        lastSuccessfulNavlungoRequestSummaryReason: null,
      }
    : {
        ...snapshot,
        lastSuccessfulNavlungoRequestSummary: null,
        lastSuccessfulNavlungoRequestSummarySource: null,
        lastSuccessfulNavlungoRequestSummaryReason: 'no_valid_successful_real_navlungo_summary',
      };
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

function canRetryStaleNavlungoExecution(execution: ShipmentExecution) {
  return (
    execution.provider === ShippingProvider.NAVLUNGO &&
    !hasPersistedShipmentEvidence(execution) &&
    (execution.shipmentStatus === ShipmentExecutionStatus.PENDING || execution.shipmentStatus === ShipmentExecutionStatus.FAILED)
  );
}

function hasPersistedShipmentEvidence(execution: ShipmentExecution) {
  return Boolean(execution.providerShipmentId || execution.trackingNumber || execution.trackingUrl || execution.labelUrl);
}

function getRecordField(value: unknown, key: string) {
  return isRecord(value) ? value[key] : undefined;
}

function readNavlungoSnapshotEvidence(snapshot: unknown) {
  const data = getRecordField(snapshot, 'data');
  const post = getRecordField(data, 'post') ?? getRecordField(snapshot, 'post');
  const providerShipmentId =
    readString(snapshot, ['providerShipmentId', 'post_number', 'postNumber']) ??
    readString(data, ['post_number', 'postNumber']);
  const trackingNumber =
    readString(snapshot, ['trackingNumber', 'carrier_tracking_code', 'carrierTrackingCode', 'carrier_post_number', 'carrierPostNumber']) ??
    readString(data, ['carrier_tracking_code', 'carrierTrackingCode', 'carrier_post_number', 'carrierPostNumber']) ??
    providerShipmentId;
  const trackingUrl =
    readString(snapshot, ['trackingUrl', 'carrier_tracking_url', 'carrierTrackingUrl', 'tracking_url', 'trackingUrl']) ??
    readString(data, ['carrier_tracking_url', 'carrierTrackingUrl', 'tracking_url', 'trackingUrl']);
  const labelUrl =
    readString(snapshot, ['labelUrl', 'barcode', 'barcode_url', 'barcodeUrl']) ??
    readString(data, ['barcode', 'barcode_url', 'barcodeUrl']);
  const carrierName = readString(post, ['carrier_name', 'carrierName']);
  const carrierId = readString(post, ['carrier_id', 'carrierId']);
  const status = getRecordField(data, 'status') ?? getRecordField(snapshot, 'statusField') ?? getRecordField(snapshot, 'status');

  if (!providerShipmentId && !trackingNumber && !trackingUrl && !labelUrl) {
    return null;
  }

  return {
    providerShipmentId,
    trackingNumber,
    trackingUrl,
    labelUrl,
    carrierName,
    carrierId,
    statusField: isRecord(status)
      ? readString(status, ['status_name', 'statusName', 'name']) ?? readString(status, ['status_code', 'statusCode', 'code'])
      : typeof status === 'string'
        ? status
        : null,
  };
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

export async function ingestTryOtoWebhook(
  payload: unknown,
  options: {
    env: AppEnv;
    httpMethod?: string | null;
    contentType?: string | null;
    authenticityVerificationMode?: TryOtoWebhookAuthenticityVerification['mode'];
  },
): Promise<
  | {
      ok: true;
      matched: boolean;
      matchStatus: 'matched' | 'unmatched';
      shipmentExecutionId: string | null;
      shipmentStatus: ShipmentExecutionDto['shipmentStatus'] | null;
      authenticityVerification: TryOtoWebhookAuthenticityVerification;
      warning: string;
    }
  | { ok: false; code: number; message: string; authenticityVerification: TryOtoWebhookAuthenticityVerification }
> {
  const authenticityVerification = buildTryOtoWebhookAuthenticityVerification(options.authenticityVerificationMode);
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
    authenticityVerification,
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
      authenticityVerification,
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
      authenticityVerification,
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
      authenticityVerification,
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
      tryOtoWebhookAuthenticityVerification: authenticityVerification,
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
      authenticityVerification,
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
    tryOtoWebhookAuthenticityVerification: authenticityVerification,
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
    authenticityVerification,
    warning: signatureWarning,
  };
}

async function persistProviderShipmentResult(input: {
  executionId: string;
  env: AppEnv;
  allocation: {
    id: string;
    assignedVendorId: string;
    sourceShopifyOrderId: string;
    fulfillmentStatus: string;
    allocationStatus?: string | null;
    cancellationReason?: string | null;
    fulfillment: {
      shopifyFulfillmentId: string | null;
      shopifyFulfillmentOrderId?: string | null;
      shipmentCreatedAt: Date | null;
    } | null;
  };
  provider: ShippingProvider;
  result: Awaited<ReturnType<ShippingProviderAdapter['createShipment']>>;
}) {
  const { allocation, executionId, provider, result } = input;
  const providerCreated = Boolean(
    result.providerShipmentId ||
      result.trackingNumber ||
      result.trackingUrl ||
      result.labelUrl ||
      readString(result.responseSnapshot, ['post_number', 'postNumber', 'providerShipmentId', 'tracking_url', 'trackingUrl', 'barcode']),
  );
  const status = providerCreated ? mapProviderStatus(result.shipmentStatus === 'pending' ? 'created' : result.shipmentStatus) : ShipmentExecutionStatus.PENDING;
  const shippingVatPercent = SHIPPING_VAT_PERCENT;
  const shippingVat =
    result.shippingVat ??
    (result.shippingCost === null ? null : Number((result.shippingCost * (shippingVatPercent / 100)).toFixed(2)));
  const responseSnapshot = appendTimelineEvent(
    {
      ...result.responseSnapshot,
      providerStatus: readString(result.responseSnapshot, ['statusField', 'shipmentStatus', 'cargoStatus']),
      persistedProviderShipmentIdPresent: Boolean(result.providerShipmentId),
      persistedTrackingUrlPresent: Boolean(result.trackingUrl),
      persistedBarcodePresent: Boolean(result.labelUrl || readString(result.responseSnapshot, ['barcode', 'barcodeNumber'])),
      realPathPersistedProviderShipmentIdPresent: Boolean(result.providerShipmentId),
      realPathPersistedTrackingUrlPresent: Boolean(result.trackingUrl),
      realPathPersistedBarcodePresent: Boolean(result.labelUrl || readString(result.responseSnapshot, ['barcode', 'barcodeNumber'])),
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

  const shopifyFulfillmentSyncDiagnostics = await maybeSyncProviderShipmentToShopify({
    shipmentExecutionId: executionId,
    allocation,
    provider,
    result,
    env: input.env,
    persistedShipmentStatus: status,
  });

  if (shopifyFulfillmentSyncDiagnostics) {
    const updatedSnapshot = {
      ...responseSnapshot,
      ...shopifyFulfillmentSyncDiagnostics,
    };
    const syncedExecution = await prisma.shipmentExecution.update({
      where: {
        id: executionId,
      },
      data: {
        responseSnapshot: updatedSnapshot as Prisma.InputJsonValue,
      },
    });

    return mapShipmentExecution({
      ...syncedExecution,
      shippingCostLinked: Boolean('shippingCostLinked' in updated && updated.shippingCostLinked),
    });
  }

  return mapShipmentExecution(updated);
}

async function maybeSyncProviderShipmentToShopify(input: {
  shipmentExecutionId: string;
  allocation: {
    id: string;
    assignedVendorId: string;
    allocationStatus?: string | null;
    cancellationReason?: string | null;
    fulfillment: {
      shopifyFulfillmentId: string | null;
      shopifyFulfillmentOrderId?: string | null;
    } | null;
  };
  provider: ShippingProvider;
  result: Awaited<ReturnType<ShippingProviderAdapter['createShipment']>>;
  env: AppEnv;
  persistedShipmentStatus: ShipmentExecutionStatus;
}) {
  if (input.provider !== ShippingProvider.NAVLUNGO && input.provider !== ShippingProvider.KARGONOMI) {
    return null;
  }

  const isKargonomi = input.provider === ShippingProvider.KARGONOMI;
  const trackingNumber = isKargonomi
    ? input.result.trackingNumber?.trim() || null
    : input.result.trackingNumber?.trim() || input.result.providerShipmentId?.trim() || null;
  const trackingUrl = input.result.trackingUrl?.trim() || null;
  const carrier = isKargonomi
    ? readString(input.result.responseSnapshot, ['shippingProviderName', 'carrierName', 'providerName'])
    : readString(input.result.responseSnapshot, ['carrierName', 'shippingProviderName', 'providerName']) ?? 'Navlungo';

  function buildSkippedDiagnostics(reason: string, extra: Record<string, unknown> = {}) {
    return {
      shopifyFulfillmentSyncAttempted: false,
      shopifyFulfillmentSyncSkippedReason: reason,
      shopifyFulfillmentSynced: false,
      autoSyncAttempted: false,
      autoSyncSucceeded: false,
      autoSyncSkippedReason: reason,
      shopifyFulfillmentId: input.allocation.fulfillment?.shopifyFulfillmentId ?? null,
      shopifyFulfillmentOrderId: input.allocation.fulfillment?.shopifyFulfillmentOrderId ?? null,
      fulfillmentTrackingNumberPresent: Boolean(trackingNumber),
      fulfillmentTrackingUrlPresent: Boolean(trackingUrl),
      ...extra,
    };
  }

  if (isKargonomi) {
    if (input.allocation.fulfillment?.shopifyFulfillmentId) {
      return buildSkippedDiagnostics('already_fulfilled', {
        shopifyFulfillmentSyncAttempted: true,
        shopifyFulfillmentSynced: true,
        autoSyncAttempted: true,
        autoSyncSucceeded: true,
        shopifyFulfillmentIdPresent: true,
        shopifyFulfillmentOrderIdPresent: Boolean(input.allocation.fulfillment.shopifyFulfillmentOrderId),
      });
    }

    if (!input.result.providerShipmentId?.trim()) {
      return buildSkippedDiagnostics('provider_shipment_missing');
    }

    if (input.persistedShipmentStatus !== ShipmentExecutionStatus.CREATED) {
      return buildSkippedDiagnostics('shipment_not_created');
    }

    if (input.allocation.cancellationReason) {
      return buildSkippedDiagnostics('order_cancelled');
    }

    if (input.allocation.allocationStatus && input.allocation.allocationStatus !== 'ACTIVE') {
      return buildSkippedDiagnostics('allocation_not_active');
    }
  }

  if (!trackingNumber) {
    return buildSkippedDiagnostics(isKargonomi ? 'tracking_missing' : 'missing_tracking_number');
  }

  if (!carrier) {
    return buildSkippedDiagnostics('carrier_missing');
  }

  try {
    const fulfillmentService = createFulfillmentService(input.env);
    const syncResult = await fulfillmentService.updateAllocationTracking({
      allocationId: input.allocation.id,
      body: {
        trackingNumber,
        carrier,
        trackingUrl,
        notifyCustomer: false,
      },
      authUser: {
        id: `system-${mapProvider(input.provider)}-fulfillment-sync`,
        email: 'system@local',
        name: 'System',
        role: 'admin',
        status: 'active',
      },
      vendorContext: {
        vendorId: input.allocation.assignedVendorId,
        vendorName: input.allocation.assignedVendorId,
        vendorStatus: 'active',
        role: 'vendor',
        accessScope: 'vendor',
      },
      existingProviderShipmentExecutionId: input.shipmentExecutionId,
    });

    return {
      shopifyFulfillmentSyncAttempted: true,
      shopifyFulfillmentSyncSkippedReason: syncResult.ok ? syncResult.shopifyFulfillmentSkippedReason : syncResult.message,
      shopifyFulfillmentSynced: syncResult.ok,
      shopifyFulfillmentIdPresent: syncResult.ok ? syncResult.shopifyFulfillmentIdPresent : false,
      shopifyFulfillmentOrderIdPresent: syncResult.ok ? syncResult.shopifyFulfillmentOrderIdPresent : false,
      shopifyFulfillmentId: syncResult.ok ? syncResult.shopifyFulfillmentId ?? null : null,
      shopifyFulfillmentOrderId: syncResult.ok ? syncResult.shopifyFulfillmentOrderId ?? null : null,
      autoSyncAttempted: true,
      autoSyncSucceeded: syncResult.ok,
      autoSyncSkippedReason: syncResult.ok ? syncResult.shopifyFulfillmentSkippedReason ?? null : syncResult.message,
      fulfillmentTrackingNumberPresent: true,
      fulfillmentTrackingUrlPresent: Boolean(trackingUrl),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Shopify fulfillment sync failed.';
    return {
      shopifyFulfillmentSyncAttempted: true,
      shopifyFulfillmentSyncSkippedReason: message,
      shopifyFulfillmentSynced: false,
      autoSyncAttempted: true,
      autoSyncSucceeded: false,
      autoSyncSkippedReason: message,
      shopifyFulfillmentId: null,
      shopifyFulfillmentOrderId: null,
      fulfillmentTrackingNumberPresent: true,
      fulfillmentTrackingUrlPresent: Boolean(trackingUrl),
    };
  }
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

async function createNavlungoReturnPickup(
  existing: ShipmentExecution,
  options: {
    env: AppEnv;
    vendorId: string;
    adapter?: ShippingProviderAdapter;
    dryRun?: boolean;
    customerOverrides?: CreateShipmentExecutionDto['customerOverrides'];
  },
): Promise<ShipmentExecutionDto> {
  if (existing.vendorId !== options.vendorId) {
    throw new Error('Shipment execution not found.');
  }
  const existingSnapshot = readSnapshot(existing);
  if (isRecord(existingSnapshot.returnShipment) && !options.dryRun) {
    return mapShipmentExecution(existing);
  }

  const allocation = await prisma.vendorAllocation.findUnique({
    where: { id: existing.allocationId },
    include: {
      order: true,
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

  const config = await getVendorShippingConfig(existing.vendorId);
  const built = buildNavlungoReturnPickupPayload({
    allocation,
    config,
    env: options.env,
    customerOverrides: options.customerOverrides,
  });
  const diagnostics = {
    provider: 'navlungo',
    flow: 'return_pickup',
    endpoint: '/post/create',
    dryRun: options.dryRun === true,
    navlungoReturnPickupDryRun: options.dryRun === true,
    navlungoReturnPickupAttempted: options.dryRun !== true,
    navlungoReturnPickupSucceeded: false,
    navlungoReturnPickupPayloadSummary: built.summary,
    navlungoReturnPickupMissingFields: built.missingFields,
    recipientAddressIdPresent: built.summary.recipientKeys.includes('addressId'),
    recipientAddressIdValid: built.recipientAddressIdValid,
    missingFields: built.missingFields,
  };

  if (options.dryRun) {
    return {
      ...mapShipmentExecution(existing),
      providerResponseSummary: {
        ...(mapShipmentExecution(existing).providerResponseSummary ?? {}),
        ...diagnostics,
      } as ShipmentExecutionDto['providerResponseSummary'],
    };
  }

  if (built.missingFields.length > 0) {
    throw new Error(
      [
        'Missing required Navlungo return pickup fields:',
        ...built.missingFields.map((field) => `- ${field}`),
        '',
        'Provider request blocked before create call.',
      ].join('\n'),
    );
  }

  const adapter = options.adapter ?? createShippingProviderAdapter(options.env, 'navlungo');
  if (!adapter.createReturnShipment) {
    throw new Error('Navlungo return pickup creation is not supported by this adapter.');
  }
  const result = await adapter.createReturnShipment({
    orderId: existing.providerShipmentId ?? existing.id,
    items: [],
    requestSnapshot: built.payload as unknown as Record<string, unknown>,
  });
  const now = new Date().toISOString();
  const returnShipment = {
    provider: 'navlungo',
    endpoint: '/post/create',
    returnOrderId: result.returnOrderId,
    trackingNumber: result.returnTrackingNumber,
    trackingUrl: result.returnTrackingUrl,
    labelUrl: result.returnLabelUrl,
    barcode: result.returnBarcode,
    carrierName: result.returnCarrierName,
    status: result.returnStatus,
    createdAt: now,
    requestKeys: Object.keys(built.payload),
    responseKeys: Object.keys(result.responseSnapshot),
    trackingPresent: Boolean(result.returnTrackingNumber),
    labelPresent: Boolean(result.returnLabelUrl),
    labelRetrievalConfirmed: Boolean(result.returnLabelUrl),
    labelRetrievalNote: result.returnLabelUrl ? null : 'Navlungo return pickup created. Printable label is not available yet.',
    finalized: Boolean(result.returnOrderId),
    labelRetrievable: Boolean(result.returnLabelUrl),
    providerStatusSource: 'return_pickup_create',
    diagnostics: {
      ...diagnostics,
      dryRun: false,
      httpStatus: readNumber(result.responseSnapshot, ['createPostHttpStatus', 'httpStatus']),
      responseKeys: Object.keys(result.responseSnapshot),
      returnProviderIdPresent: Boolean(result.returnOrderId),
      returnTrackingPresent: Boolean(result.returnTrackingNumber),
      returnBarcodePresent: Boolean(result.returnBarcode),
      returnStatus: result.returnStatus,
      providerMessage: readString(result.responseSnapshot, ['providerMessage', 'providerError']),
      navlungoReturnPickupSucceeded: Boolean(result.returnOrderId),
    },
  };
  const mergedSnapshot = appendTimelineEvent(
    {
      ...existingSnapshot,
      returnShipment,
      lastProviderResponseAt: now,
    },
    {
      label: 'Navlungo return pickup created',
      status: result.returnStatus,
    },
  );
  const updated = await prisma.shipmentExecution.update({
    where: { id: existing.id },
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
    dryRun?: boolean;
    customerOverrides?: CreateShipmentExecutionDto['customerOverrides'];
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

  if (existing.provider === ShippingProvider.NAVLUNGO) {
    throw new Error('Navlungo return pickup creation must be started from the internal return request.');
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

export async function syncNavlungoShipmentStatus(
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

  if (existing.provider !== ShippingProvider.NAVLUNGO) {
    throw new Error('Navlungo status sync is only available for Navlungo shipments.');
  }

  if (!existing.providerShipmentId?.trim()) {
    throw new Error('Navlungo status sync requires a stored provider post number.');
  }

  const adapter = options.adapter ?? createShippingProviderAdapter(options.env, 'navlungo');
  let result;
  try {
    result = await adapter.getShipmentStatus(existing.providerShipmentId);
  } catch (error) {
    if (error instanceof ShippingProviderExecutionError) {
      const failedSnapshot = appendTimelineEvent(
        {
          ...readSnapshot(existing),
          ...error.responseSnapshot,
          navlungoStatusSyncSucceeded: false,
          lastProviderResponseAt: new Date().toISOString(),
        },
        {
          label: 'Navlungo status sync failed',
          status: readString(error.responseSnapshot, ['navlungoNormalizedStatus', 'statusField']) ?? 'failed',
        },
      );
      await prisma.shipmentExecution.update({
        where: {
          id: existing.id,
        },
        data: {
          responseSnapshot: failedSnapshot as Prisma.InputJsonValue,
        },
      });
    }
    throw error;
  }

  const existingSnapshot = readSnapshot(existing);
  const trackingNumber = result.trackingNumber ?? existing.trackingNumber;
  const trackingUrl = result.trackingUrl ?? existing.trackingUrl;
  const labelUrl = result.labelUrl ?? existing.labelUrl;
  const providerShipmentId = result.providerShipmentId ?? existing.providerShipmentId;
  const trackingEnriched =
    Boolean(result.trackingNumber && result.trackingNumber !== existing.trackingNumber) ||
    Boolean(result.trackingUrl && result.trackingUrl !== existing.trackingUrl) ||
    Boolean(result.labelUrl && result.labelUrl !== existing.labelUrl);
  const statusFromProvider = result.shipmentStatus === 'pending' ? existing.shipmentStatus : mapProviderStatus(result.shipmentStatus);
  const mergedSnapshotBase = {
    ...existingSnapshot,
    ...result.responseSnapshot,
    navlungoTrackingEnriched: trackingEnriched || readOptionalBoolean(result.responseSnapshot, ['navlungoTrackingEnriched']) === true,
    shopifyDeliveryStatusSyncSkippedReason: 'not_implemented',
    lastProviderResponseAt: new Date().toISOString(),
  };
  const statusSnapshot = appendTimelineEvent(
    appendNavlungoStatusLogTimelineEvents(mergedSnapshotBase),
    {
      label: 'Navlungo status synced',
      status:
        readString(result.responseSnapshot, ['navlungoNormalizedStatus']) ??
        result.shipmentStatus,
    },
  );

  const updated = await prisma.shipmentExecution.update({
    where: {
      id: existing.id,
    },
    data: {
      providerShipmentId,
      trackingNumber,
      trackingUrl,
      labelUrl,
      shipmentStatus: statusFromProvider,
      currency: result.currency ?? existing.currency,
      responseSnapshot: statusSnapshot as Prisma.InputJsonValue,
    },
  });

  return mapShipmentExecution(updated);
}

export async function refreshShipmentExecutionStatus(
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
    select: {
      provider: true,
    },
  });

  if (!existing) {
    throw new Error('Shipment execution not found.');
  }

  if (existing.provider === ShippingProvider.NAVLUNGO) {
    return syncNavlungoShipmentStatus(shipmentExecutionId, options);
  }

  return refreshTryOtoShipmentStatus(shipmentExecutionId, options);
}

export async function refreshKargonomiShipmentProviderData(
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
    include: {
      allocation: {
        include: {
          fulfillment: true,
        },
      },
    },
  });

  if (!existing || existing.vendorId !== options.vendorId) {
    throw new Error('Shipment execution not found.');
  }

  if (existing.provider !== ShippingProvider.KARGONOMI) {
    throw new Error('Provider data refresh is available only for Kargonomi shipments.');
  }

  const providerShipmentId = existing.providerShipmentId?.trim();
  if (!providerShipmentId) {
    throw new Error('Kargonomi provider data refresh requires a stored provider shipment id.');
  }

  const adapter = options.adapter ?? createShippingProviderAdapter(options.env, 'kargonomi');
  if (!adapter.refreshProviderData) {
    throw new Error('Kargonomi provider data refresh is not available.');
  }

  const attemptSnapshot = appendTimelineEvent(
    {
      ...readSnapshot(existing),
      providerDataRefreshAttempted: true,
      providerDataRefreshSucceeded: false,
      providerDataRefreshEndpointUsed: '/shipments/:id/refresh-provider-data',
      createShipmentCalled: false,
      createShipmentDraftCalled: false,
      confirmShippingPriceCalled: false,
      lastProviderStage: 'provider_data_refresh',
    },
    {
      label: 'Provider data refresh attempted',
      status: 'pending',
    },
  );

  await prisma.shipmentExecution.update({
    where: {
      id: existing.id,
    },
    data: {
      responseSnapshot: attemptSnapshot as Prisma.InputJsonValue,
    },
  });

  try {
    const result = await adapter.refreshProviderData(providerShipmentId);
    const carrier =
      readString(result.responseSnapshot, ['shippingProviderName', 'carrierName', 'providerName']) ??
      mapProvider(existing.provider);
    const trackingNumber = result.trackingNumber ?? existing.trackingNumber;
    const trackingUrl = result.trackingUrl ?? existing.trackingUrl;
    const labelUrl = result.labelUrl ?? existing.labelUrl;
    const kargonomiCancelled = result.shipmentStatus === 'cancelled';
    const mergedSnapshot = appendTimelineEvent(
      {
        ...attemptSnapshot,
        ...result.responseSnapshot,
        kargonomiCancelled,
        providerStatus: readString(result.responseSnapshot, ['providerStatus', 'status']),
        providerStatusLabel: readString(result.responseSnapshot, ['providerStatusLabel', 'statusLabel']),
        providerDataRefreshAttempted: true,
        providerDataRefreshSucceeded: true,
        providerDataRefreshEndpointUsed: '/shipments/:id/refresh-provider-data',
        refreshedProviderShipmentId: providerShipmentId,
        createShipmentCalled: false,
        createShipmentDraftCalled: false,
        confirmShippingPriceCalled: false,
        persistedProviderShipmentIdPresent: true,
        persistedTrackingUrlPresent: Boolean(trackingUrl),
        persistedBarcodePresent: Boolean(labelUrl || readString(result.responseSnapshot, ['barcode', 'barcodeNumber'])),
      },
      {
        label: 'Provider data refreshed',
        status: result.shipmentStatus,
      },
    );
    const status = mapProviderStatus(result.shipmentStatus);

    const updated = await prisma.$transaction(async (tx) => {
      const execution = await tx.shipmentExecution.update({
        where: {
          id: existing.id,
        },
        data: {
          providerShipmentId: result.providerShipmentId ?? providerShipmentId,
          trackingNumber,
          trackingUrl,
          labelUrl,
          shipmentStatus: status,
          responseSnapshot: mergedSnapshot as Prisma.InputJsonValue,
        },
      });

      await tx.vendorAllocation.update({
        where: {
          id: existing.allocationId,
        },
        data: {
          shippingStatus: allocationShippingStatus(mapStatus(status)),
          trackingNumber,
          carrier,
        },
      });

      await tx.fulfillment.upsert({
        where: {
          vendorAllocationId: existing.allocationId,
        },
        update: {
          trackingNumber,
          carrier,
          trackingUrl,
          shipmentUpdatedAt: new Date(),
          syncStatus: 'carrier_refreshed',
          errorMessage: null,
        },
        create: {
          vendorAllocationId: existing.allocationId,
          fulfillmentStatus: 'shipment_created',
          trackingNumber,
          carrier,
          trackingUrl,
          shipmentCreatedAt: existing.allocation.fulfillment?.shipmentCreatedAt ?? new Date(),
          shipmentUpdatedAt: new Date(),
          syncStatus: 'carrier_refreshed',
        },
      });

      return execution;
    });

    const shopifyFulfillmentSyncDiagnostics = await maybeSyncProviderShipmentToShopify({
      shipmentExecutionId: existing.id,
      allocation: {
        id: existing.allocationId,
        assignedVendorId: existing.vendorId,
        allocationStatus: existing.allocation.allocationStatus,
        cancellationReason: existing.allocation.cancellationReason,
        fulfillment: existing.allocation.fulfillment,
      },
      provider: existing.provider,
      result,
      env: options.env,
      persistedShipmentStatus: status,
    });

    if (shopifyFulfillmentSyncDiagnostics) {
      const updatedSnapshot = {
        ...mergedSnapshot,
        ...shopifyFulfillmentSyncDiagnostics,
      };
      const syncedExecution = await prisma.shipmentExecution.update({
        where: {
          id: existing.id,
        },
        data: {
          responseSnapshot: updatedSnapshot as Prisma.InputJsonValue,
        },
      });

      return mapShipmentExecution(syncedExecution);
    }

    return mapShipmentExecution(updated);
  } catch (error) {
    const providerSnapshot = error instanceof ShippingProviderExecutionError
      ? error.responseSnapshot
      : {
          providerError: error instanceof Error ? error.message : 'Unknown Kargonomi provider data refresh error.',
        };
    const failedSnapshot = appendTimelineEvent(
      {
        ...attemptSnapshot,
        ...providerSnapshot,
        providerDataRefreshAttempted: true,
        providerDataRefreshSucceeded: false,
        providerDataRefreshEndpointUsed: '/shipments/:id/refresh-provider-data',
      },
      {
        label: 'Provider data refresh failed',
        status: 'failed',
      },
    );
    const failed = await prisma.shipmentExecution.update({
      where: {
        id: existing.id,
      },
      data: {
        responseSnapshot: failedSnapshot as Prisma.InputJsonValue,
      },
    });

    return mapShipmentExecution(failed);
  }
}

export async function cancelNavlungoShipmentExecution(
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

  if (existing.provider !== ShippingProvider.NAVLUNGO) {
    throw new Error('Navlungo shipment cancellation is only available for Navlungo shipments.');
  }

  if (!existing.providerShipmentId?.trim()) {
    throw new Error('Navlungo shipment cancellation requires a stored provider post number.');
  }

  if (existing.shipmentStatus === ShipmentExecutionStatus.CANCELLED) {
    throw new Error('Navlungo shipment is already locally cancelled.');
  }

  if (existing.shipmentStatus === ShipmentExecutionStatus.DELIVERED) {
    throw new Error('Delivered Navlungo shipments cannot be cancelled locally.');
  }

  const attemptSnapshot = appendTimelineEvent(
    {
      ...readSnapshot(existing),
      navlungoCancelAttempted: true,
      navlungoCancelSucceeded: false,
      navlungoCancelProviderShipmentIdPresent: true,
      shopifyFulfillmentCancelSyncSkippedReason: 'not_implemented',
      lastProviderStage: 'cancel_post',
    },
    {
      label: 'Cancel attempted',
      status: 'pending',
    },
  );

  await prisma.shipmentExecution.update({
    where: {
      id: existing.id,
    },
    data: {
      responseSnapshot: attemptSnapshot as Prisma.InputJsonValue,
    },
  });

  const adapter = options.adapter ?? createShippingProviderAdapter(options.env, 'navlungo');
  try {
    const result = await adapter.cancelShipment(existing.providerShipmentId);
    const cancelledAt = readString(result.responseSnapshot, ['navlungoCancelledAt']) ?? new Date().toISOString();
    const mergedSnapshot = appendTimelineEvent(
      {
        ...attemptSnapshot,
        ...result.responseSnapshot,
        navlungoCancelAttempted: true,
        navlungoCancelSucceeded: true,
        navlungoCancelledAt: cancelledAt,
        shopifyFulfillmentCancelSyncSkippedReason: 'not_implemented',
        lastProviderStage: 'cancel_post',
      },
      {
        label: 'Shipment cancelled',
        status: 'cancelled',
      },
    );

    const updated = await prisma.shipmentExecution.update({
      where: {
        id: existing.id,
      },
      data: {
        shipmentStatus: ShipmentExecutionStatus.CANCELLED,
        responseSnapshot: mergedSnapshot as Prisma.InputJsonValue,
      },
    });

    return mapShipmentExecution(updated);
  } catch (error) {
    const providerSnapshot = error instanceof ShippingProviderExecutionError
      ? error.responseSnapshot
      : {
          providerError: error instanceof Error ? error.message : 'Unknown Navlungo cancel error.',
        };
    const mergedSnapshot = appendTimelineEvent(
      {
        ...attemptSnapshot,
        ...providerSnapshot,
        navlungoCancelAttempted: true,
        navlungoCancelSucceeded: false,
        shopifyFulfillmentCancelSyncSkippedReason: 'not_implemented',
        lastProviderStage: 'cancel_post',
      },
      {
        label: 'Cancel needs review',
        status: 'failed',
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
}

export async function updateNavlungoShipmentExecution(
  shipmentExecutionId: string,
  input: UpdateNavlungoShipmentDto,
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

  if (existing.provider !== ShippingProvider.NAVLUNGO) {
    throw new Error('Navlungo shipment update is only available for Navlungo shipments.');
  }

  if (!existing.providerShipmentId?.trim()) {
    throw new Error('Navlungo shipment update requires a stored provider post number.');
  }

  if (existing.shipmentStatus === ShipmentExecutionStatus.CANCELLED) {
    throw new Error('Cancelled Navlungo shipments cannot be updated locally.');
  }

  if (existing.shipmentStatus === ShipmentExecutionStatus.DELIVERED) {
    throw new Error('Delivered Navlungo shipments cannot be updated locally.');
  }

  const existingSnapshot = readSnapshot(existing);
  if (readString(existingSnapshot, ['flow']) === 'return' || isRecord(existingSnapshot.returnShipment)) {
    throw new Error('Navlungo update is available for forward shipments only.');
  }

  const allocation = await prisma.vendorAllocation.findUnique({
    where: {
      id: existing.allocationId,
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
    },
  });

  if (!allocation || allocation.assignedVendorId !== options.vendorId) {
    throw new Error('Allocation could not be found for the selected vendor.');
  }

  const existingUpdateOverrides = readNavlungoUpdateOverrides(existingSnapshot);
  const submittedRecipientOverrides = normalizeNavlungoUpdateRecipientOverrides(input.recipient);
  const mergedRecipientOverrides = {
    ...existingUpdateOverrides.recipient,
    ...submittedRecipientOverrides,
  };
  const submittedPostNote = typeof input.postNote === 'string' && input.postNote.trim()
    ? input.postNote.trim()
    : null;
  const submittedBarcodeFormat = typeof input.barcodeFormat === 'string' && input.barcodeFormat.trim()
    ? input.barcodeFormat.trim()
    : null;
  const mergedPostNote = submittedPostNote ?? existingUpdateOverrides.postNote ?? '';
  const mergedBarcodeFormat = submittedBarcodeFormat ?? existingUpdateOverrides.barcodeFormat ?? null;
  const updateOverrideSnapshot = buildNavlungoUpdateOverrideSnapshot({
    recipient: mergedRecipientOverrides,
    submittedRecipient: submittedRecipientOverrides,
    postNote: mergedPostNote,
    barcodeFormat: mergedBarcodeFormat,
    submittedOptionKeys: [
      submittedPostNote ? 'postNote' : null,
      submittedBarcodeFormat ? 'barcodeFormat' : null,
    ].filter((key): key is string => Boolean(key)),
  });

  const config = mapShippingConfig(await getStoredShippingConfig(options.vendorId), options.vendorId);
  const sender = buildNavlungoSender(config, { useFullSenderDetails: true, requireEmail: false });
  if (!sender.sender) {
    throw new Error(
      [
        'Missing required Navlungo update sender fields:',
        ...sender.missingFields.map((field) => `- ${field}`),
        '',
        'Provider request blocked before update call.',
      ].join('\n'),
    );
  }

  const recipient = buildNavlungoUpdateRecipient({
    order: allocation.order,
    customerName: allocation.order.customerName,
    customerEmail: allocation.order.customerEmail,
    recipient: mergedRecipientOverrides,
  });
  if (recipient.missingFields.length > 0) {
    throw new Error(
      [
        'Missing required Navlungo update fields:',
        ...recipient.missingFields.map((field) => `- ${field}`),
        '',
        'Provider request blocked before update call.',
      ].join('\n'),
    );
  }

  const barcodeFormat = mergedBarcodeFormat || resolveNavlungoBarcodeFormat(config.providerMetadata, options.env);
  const payload = {
    post_number: existing.providerShipmentId,
    sender: sender.sender,
    recipient: recipient.recipient,
    post: {
      note: mergedPostNote,
    },
    barcode_format: barcodeFormat,
    custom_data_1: '',
    custom_data_2: '',
    custom_data_3: '',
    custom_data_4: '',
  };

  const attemptSnapshot = appendTimelineEvent(
    {
      ...existingSnapshot,
      ...updateOverrideSnapshot,
      navlungoUpdateAttempted: true,
      navlungoUpdateSucceeded: false,
      navlungoUpdateProviderShipmentIdPresent: true,
      senderAddressIdPresent: false,
      senderAddressIdValid: false,
      senderUsesAddressId: false,
      senderMode: 'fullSender',
      navlungoUpdateSenderMode: 'fullSender',
      navlungoUpdateSenderFieldKeys: Object.keys(sender.sender).sort(),
      navlungoUpdateMissingSenderFields: sender.missingFields,
      shopifyFulfillmentUpdateSyncSkippedReason: 'not_implemented',
      lastProviderStage: 'update_post',
    },
    {
      label: 'Update attempted',
      status: 'pending',
    },
  );

  await prisma.shipmentExecution.update({
    where: {
      id: existing.id,
    },
    data: {
      responseSnapshot: attemptSnapshot as Prisma.InputJsonValue,
    },
  });

  const adapter = options.adapter ?? createShippingProviderAdapter(options.env, 'navlungo');
  if (!adapter.updateShipment) {
    throw new Error('Navlungo shipment update is not supported by this adapter.');
  }

  try {
    const result = await adapter.updateShipment({
      providerShipmentId: existing.providerShipmentId,
      requestSnapshot: payload,
    });
    const updatedAt = readString(result.responseSnapshot, ['navlungoUpdatedAt']) ?? new Date().toISOString();
    const mergedSnapshot = appendTimelineEvent(
      {
        ...attemptSnapshot,
        ...result.responseSnapshot,
        ...updateOverrideSnapshot,
        navlungoUpdateAttempted: true,
        navlungoUpdateSucceeded: true,
        navlungoUpdatedAt: updatedAt,
        shopifyFulfillmentUpdateSyncSkippedReason: 'not_implemented',
        lastProviderStage: 'update_post',
      },
      {
        label: 'Shipment updated',
        status: 'created',
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
        responseSnapshot: mergedSnapshot as Prisma.InputJsonValue,
      },
    });

    return mapShipmentExecution(updated);
  } catch (error) {
    const providerSnapshot = error instanceof ShippingProviderExecutionError
      ? error.responseSnapshot
      : {
          providerError: error instanceof Error ? error.message : 'Unknown Navlungo update error.',
        };
    const mergedSnapshot = appendTimelineEvent(
      {
        ...attemptSnapshot,
        ...providerSnapshot,
        ...updateOverrideSnapshot,
        navlungoUpdateAttempted: true,
        navlungoUpdateSucceeded: false,
        shopifyFulfillmentUpdateSyncSkippedReason: 'not_implemented',
        lastProviderStage: 'update_post',
      },
      {
        label: 'Update needs review',
        status: 'failed',
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
    allowNavlungoFullSenderDetails?: boolean;
    skipCustomerCancellationHoldPreview?: boolean;
  },
): Promise<ShipmentExecutionPreviewDto> {
  if (!input.allocationId) {
    throw new Error('allocationId is required.');
  }

  await prisma.$transaction((tx) => assertAllocationActionable(tx, input.allocationId));

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

  assertFullOrderOperationallyEligible(allocation.order);

  if (allocation.cancellationReason || allocation.allocationStatus !== 'ACTIVE') {
    throw new Error('Allocation is not eligible for shipment execution.');
  }

  if (!options.skipCustomerCancellationHoldPreview && await hasPendingCustomerCancellationHold(allocation.id)) {
    throw new CustomerCancellationShipmentHoldError();
  }

  const config = mapShippingConfig(await getStoredShippingConfig(options.vendorId), options.vendorId);
  if (!config.shippingEnabled) {
    throw new Error('Shipping execution is disabled for this vendor.');
  }

  const provider = normalizeProvider(input.provider ?? config.preferredProvider);
  assertActiveShippingProvider(provider);
  const providerDto = mapProvider(provider);
  const kargonomiWarehouseId =
    provider === ShippingProvider.KARGONOMI ? resolveKargonomiWarehouseId(config, options.env) : null;
  if (provider === ShippingProvider.KARGONOMI && !kargonomiWarehouseId) {
    throw new Error('Kargonomi warehouse ID is not configured for this vendor.');
  }
  const navlungoSenderAddressId =
    provider === ShippingProvider.NAVLUNGO ? resolveNavlungoSenderAddressId(config, options.env) : null;
  const parsedNavlungoSenderAddressId =
    provider === ShippingProvider.NAVLUNGO ? parseNavlungoSenderAddressId(navlungoSenderAddressId) : null;
  if (provider === ShippingProvider.NAVLUNGO && !parsedNavlungoSenderAddressId) {
    throw new Error('Navlungo sender address ID must be numeric.');
  }
  const navlungoCarrierId = provider === ShippingProvider.NAVLUNGO
    ? resolveNavlungoCarrierId(config.providerMetadata, options.env)
    : null;
  if (provider === ShippingProvider.NAVLUNGO && !navlungoCarrierId) {
    throw new Error('Navlungo carrier ID must be numeric.');
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
  const tryOtoCustomer = buildTryOtoCustomer({
    order: allocation.order,
    customerName: allocation.order.customerName,
    customerEmail: allocation.order.customerEmail,
    customerOverrides: input.customerOverrides,
  });
  let kargonomiDestinationResolution: Record<string, unknown> | null = null;
  let resolvedKargonomiDestination: { buyerStateId?: string | null; buyerCityId?: string | null } | undefined;
  if (provider === ShippingProvider.KARGONOMI) {
    const destinationValidity = validateKargonomiOrderDestination(allocation.order, input.customerOverrides);
    if (destinationValidity.invalid) {
      kargonomiDestinationResolution = {
        source: 'order_destination_validation',
        resolved: false,
        ...buildKargonomiDistrictResolutionDiagnostics(destinationValidity.destination),
        invalidOrderDestination: true,
        skippedReason: 'invalid_order_destination',
        missingFields: destinationValidity.missingFields,
        buyerStateIdPresent: false,
        buyerCityIdPresent: false,
      };
      throw new Error(
        [
          'Order destination address is invalid or incomplete. Kargonomi shipment was blocked before provider call.',
          'invalidOrderDestination: true',
          'skippedReason: invalid_order_destination',
          'Missing required shipment fields:',
          ...destinationValidity.missingFields.map((field) => `- ${field}`),
          '',
          'Provider request blocked before create call.',
        ].join('\n'),
      );
    }
  }
  if (provider === ShippingProvider.KARGONOMI && !hasKargonomiOrderDestinationIds(allocation.order)) {
    const fallbackStateId = resolveKargonomiBuyerStateId(config.providerMetadata);
    const fallbackCityId = resolveKargonomiBuyerCityId(config.providerMetadata);
    const destinationClient =
      options.kargonomiDestinationClient ??
      (options.env?.KARGONOMI_BASE_URL && options.env.KARGONOMI_API_TOKEN ? new KargonomiHttpClient(options.env) : null);

    if (destinationClient) {
      const destination = readKargonomiDestinationText(allocation.order, input.customerOverrides);
      const districtDiagnostics = buildKargonomiDistrictResolutionDiagnostics(destination);
      const resolution = await resolveKargonomiDestinationAddress(destination, destinationClient);
      if (resolution.ok) {
        resolvedKargonomiDestination = {
          buyerStateId: resolution.buyerStateId,
          buyerCityId: resolution.buyerCityId,
        };
        kargonomiDestinationResolution = {
          source: 'order_shipping_address_lookup',
          resolved: true,
          ...districtDiagnostics,
          stateSource: resolution.stateSource,
          citySource: resolution.citySource,
          buyerStateIdPresent: true,
          buyerCityIdPresent: true,
        };
      } else {
        kargonomiDestinationResolution = {
          source: fallbackStateId && fallbackCityId ? 'fallback_metadata_after_lookup_failure' : 'order_shipping_address_lookup',
          resolved: false,
          ...districtDiagnostics,
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
      const destination = readKargonomiDestinationText(allocation.order, input.customerOverrides);
      kargonomiDestinationResolution = {
        source: 'unavailable_lookup',
        resolved: false,
        ...buildKargonomiDistrictResolutionDiagnostics(destination),
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
      const destination = readKargonomiDestinationText(allocation.order, input.customerOverrides);
      kargonomiDestinationResolution = {
        source: 'fallback_metadata',
        resolved: false,
        ...buildKargonomiDistrictResolutionDiagnostics(destination),
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
  const navlungoRecipient = buildNavlungoRecipient({
    order: allocation.order,
    customerName: allocation.order.customerName,
    customerEmail: allocation.order.customerEmail,
    customerOverrides: input.customerOverrides,
  });
  const navlungoFullSenderRetryRequested =
    provider === ShippingProvider.NAVLUNGO &&
    options.allowNavlungoFullSenderDetails === true &&
    input.useFullSenderDetailsForThisRetry === true;
  const navlungoSender = provider === ShippingProvider.NAVLUNGO
    ? buildNavlungoSender(config, { useFullSenderDetails: navlungoFullSenderRetryRequested })
    : null;
  const missingCustomerFields = [
    ...(provider === ShippingProvider.TRY_OTO
        ? tryOtoCustomer.missingFields
        : provider === ShippingProvider.KARGONOMI
          ? kargonomiBuyer.missingFields
          : provider === ShippingProvider.NAVLUNGO
            ? [...(navlungoSender?.missingFields ?? []), ...navlungoRecipient.missingFields]
          : [
              customer.name ? null : 'customer.name',
              customer.surname ? null : 'customer.surname',
            ]),
  ].filter((field): field is string => Boolean(field));
  if (
    (provider === ShippingProvider.TRY_OTO ||
      provider === ShippingProvider.KARGONOMI ||
      provider === ShippingProvider.NAVLUNGO) &&
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
  const cargoIntegrationId = null;
  const warehouseId = null;
  const orderRecord = isRecord(allocation.order) ? allocation.order : {};
  const amount = lineItems.reduce((sum, lineItem) => sum + lineItem.lineAmount, 0);
  const tryOtoPayment = resolveTryOtoPayment(orderRecord, amount);
  const tryOtoPackageWeight = resolveTryOtoPackageWeight(config.providerMetadata, desi);
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
  const navlungoReferenceId = buildNavlungoReferenceId({
    vendorId: allocation.assignedVendorId,
    shopifyOrderNumber: allocation.sourceShopifyOrderNumber,
    providerMetadata: config.providerMetadata,
  });
  const navlungoBarcodeFormat = resolveNavlungoBarcodeFormat(config.providerMetadata, options.env);

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
            ...buildKargonomiDistrictResolutionDiagnostics(readKargonomiDestinationText(allocation.order, input.customerOverrides)),
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
    : provider === ShippingProvider.NAVLUNGO
      ? {
          platform: 'shopify',
          posts: [
            {
              reference_id: navlungoReferenceId,
              carrier_id: navlungoCarrierId,
              post_type: 2,
              cod_payment_type: '',
              sender: navlungoSender!.sender!,
              recipient: navlungoRecipient.recipient,
              post: {
                desi,
                package_count: 1,
                price: '',
                note: '',
              },
              barcode_format: navlungoBarcodeFormat,
              custom_data_1: allocation.id,
              custom_data_2: allocation.sourceShopifyOrderNumber ?? '',
              custom_data_3: allocation.assignedVendorId,
              custom_data_4: navlungoSenderAddressId ?? '',
            },
          ],
        }
    : {
        platform_id: allocation.sourceShopifyOrderId,
        platform_d_id: allocation.sourceShopifyOrderNumber,
        notification_url: notificationUrl,
        customer: {
          name: customer.name,
          surname: customer.surname,
          email: allocation.order.customerEmail,
        },
        desi,
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
          : provider === ShippingProvider.NAVLUNGO
            ? navlungoSenderAddressId
          : warehouseId,
    desi: toAmountString(desi),
    notificationUrl,
    payload,
    customerFieldsValid: missingCustomerFields.length === 0,
    missingCustomerFields,
    warnings:
      provider === ShippingProvider.TRY_OTO
          ? [
              'Try OTO is sandbox-only in this phase.',
              'Try OTO webhooks, returns, and production rollout are not implemented.',
            ]
          : provider === ShippingProvider.KARGONOMI
            ? ['Kargonomi return/reverse shipment is not implemented.']
            : provider === ShippingProvider.NAVLUNGO
              ? ['Navlungo return/reverse shipment is not implemented.']
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

async function assertShipmentProviderCallMayBegin(
  tx: Prisma.TransactionClient,
  input: {
    allocationId: string;
    vendorId: string;
    sourceShopifyOrderId: string;
  },
) {
  const actionability = await assertAllocationActionable(tx, input.allocationId);
  if (actionability.sourceShopifyOrderId !== input.sourceShopifyOrderId) {
    throw new Error('Allocation is no longer available for shipment execution.');
  }

  const currentAllocation = await tx.vendorAllocation.findUnique({
    where: {
      id: input.allocationId,
    },
    select: {
      assignedVendorId: true,
      allocationStatus: true,
      cancellationReason: true,
      order: {
        select: {
          cancelledAt: true,
          sourceShopifyOrderId: true,
        },
      },
    },
  });

  if (
    !currentAllocation ||
    currentAllocation.assignedVendorId !== input.vendorId ||
    currentAllocation.order.sourceShopifyOrderId !== input.sourceShopifyOrderId
  ) {
    throw new Error('Allocation is no longer available for shipment execution.');
  }
  assertFullOrderOperationallyEligible(currentAllocation.order);
  if (currentAllocation.cancellationReason || currentAllocation.allocationStatus !== 'ACTIVE') {
    throw new Error('Allocation is not eligible for shipment execution.');
  }

  await assertNoPendingCustomerCancellationHold(input.allocationId, tx);
}

function buildProviderCallClaimSnapshot(snapshot: unknown, claimKind: 'create' | 'dry_run_retry' | 'failed_retry') {
  return {
    ...(isRecord(snapshot) ? snapshot : {}),
    providerCallClaimedAt: new Date().toISOString(),
    providerCallClaimKind: claimKind,
  };
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
    skipCustomerCancellationHoldPreview: true,
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
    if (canRetryStaleNavlungoExecution(existing)) {
      const recoveredEvidence = readNavlungoSnapshotEvidence(existing.responseSnapshot);
      if (recoveredEvidence) {
        return persistProviderShipmentResult({
          executionId: existing.id,
          env: options.env,
          allocation,
          provider,
          result: {
            providerShipmentId: recoveredEvidence.providerShipmentId,
            trackingNumber: recoveredEvidence.trackingNumber,
            trackingUrl: recoveredEvidence.trackingUrl,
            labelUrl: recoveredEvidence.labelUrl,
            shipmentStatus: 'created',
            shippingCost: null,
            shippingVat: null,
            currency: 'TRY',
            responseSnapshot: {
              ...(isRecord(existing.responseSnapshot) ? existing.responseSnapshot : {}),
              ok: true,
              providerShipmentId: recoveredEvidence.providerShipmentId,
              trackingNumberPresent: Boolean(recoveredEvidence.trackingNumber),
              trackingUrlPresent: Boolean(recoveredEvidence.trackingUrl),
              labelUrlPresent: Boolean(recoveredEvidence.labelUrl),
              barcodePresent: Boolean(recoveredEvidence.labelUrl),
              barcode: recoveredEvidence.labelUrl,
              carrierName: recoveredEvidence.carrierName,
              carrierId: recoveredEvidence.carrierId,
              statusField: recoveredEvidence.statusField,
              navlungoPersistenceRecovery: true,
              lastProviderResponseAt: new Date().toISOString(),
            },
          },
        });
      }

      const retrySnapshot = buildProviderCallClaimSnapshot(
        appendTimelineEvent(existing.responseSnapshot, {
          label: 'Retry attempted',
          status: 'pending',
        }),
        'failed_retry',
      );
      const requestSnapshot = preview.payload;
      await prisma.$transaction(async (tx) => {
        await assertShipmentProviderCallMayBegin(tx, {
          allocationId: allocation.id,
          vendorId: allocation.assignedVendorId,
          sourceShopifyOrderId: allocation.order.sourceShopifyOrderId,
        });
        const currentExecution = await tx.shipmentExecution.findUnique({
          where: { id: existing.id },
        });
        if (!currentExecution || hasPersistedShipmentEvidence(currentExecution)) {
          throw new Error('Shipment execution changed before the provider retry could begin.');
        }
        await tx.shipmentExecution.update({
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
      });

      try {
        const adapter = options.adapter ?? createShippingProviderAdapter(options.env, providerDto);
        const result = await adapter.createShipment({
          allocationId: allocation.id,
          vendorId: allocation.assignedVendorId,
          provider: providerDto,
          requestSnapshot,
        });
        return persistProviderShipmentResult({
          executionId: existing.id,
          env: options.env,
          allocation,
          provider,
          result,
        });
      } catch (error) {
        const failed = await prisma.shipmentExecution.update({
          where: {
            id: existing.id,
          },
          data: {
            shipmentStatus: ShipmentExecutionStatus.FAILED,
            responseSnapshot: (await buildProviderFailureSnapshotWithDurableDiagnostics(error, provider, retrySnapshot, {
              vendorId: existing.vendorId,
              executionId: existing.id,
            })) as Prisma.InputJsonValue,
          },
        });

        return mapShipmentExecution(failed);
      }
    }

    return getShipmentExecutionById(existing.id, options.vendorId) as Promise<ShipmentExecutionDto>;
  }

  const desi = resolvePersistedShipmentDesi(preview);
  const requestSnapshot = preview.payload;
  const executionId = buildShipmentExecutionId({ allocationId: allocation.id, provider });
  const providerCallClaimSnapshot = buildProviderCallClaimSnapshot(null, 'create');

  const claim = await prisma.$transaction(async (tx) => {
    await assertShipmentProviderCallMayBegin(tx, {
      allocationId: allocation.id,
      vendorId: allocation.assignedVendorId,
      sourceShopifyOrderId: allocation.order.sourceShopifyOrderId,
    });
    const currentExecution = await tx.shipmentExecution.findUnique({
      where: {
        allocationId_provider: {
          allocationId: allocation.id,
          provider,
        },
      },
      select: { id: true },
    });
    if (currentExecution) {
      return { created: false as const, executionId: currentExecution.id };
    }
    await tx.shipmentExecution.create({
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
        responseSnapshot: providerCallClaimSnapshot as Prisma.InputJsonValue,
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
    return { created: true as const, executionId };
  });

  if (!claim.created) {
    return getShipmentExecutionById(claim.executionId, options.vendorId) as Promise<ShipmentExecutionDto>;
  }

  try {
    const adapter = options.adapter ?? createShippingProviderAdapter(options.env, providerDto);
    const result = await adapter.createShipment({
      allocationId: allocation.id,
      vendorId: allocation.assignedVendorId,
      provider: providerDto,
      requestSnapshot,
    });
    return persistProviderShipmentResult({
      executionId,
      env: options.env,
      allocation,
      provider,
      result,
    });
  } catch (error) {
    const attemptSnapshot = appendTimelineEvent(providerCallClaimSnapshot, {
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
        responseSnapshot: (await buildProviderFailureSnapshotWithDurableDiagnostics(error, provider, attemptSnapshot, {
          vendorId: allocation.assignedVendorId,
          executionId,
        })) as Prisma.InputJsonValue,
      },
    });

    return mapShipmentExecution(failed);
  }
}

async function assertShipmentRetryOperationallyEligible(allocationId: string) {
  await prisma.$transaction((tx) => assertAllocationActionable(tx, allocationId));

  const allocation = await prisma.vendorAllocation.findUnique({
    where: { id: allocationId },
    select: {
      order: {
        select: { cancelledAt: true },
      },
    },
  });
  assertFullOrderOperationallyEligible(allocation?.order);
}

export async function retryDryRunShipmentExecution(
  shipmentExecutionId: string,
  options: {
    env: AppEnv;
    actorRole?: string;
    notificationUrl?: string | null;
    customerOverrides?: CreateShipmentExecutionDto['customerOverrides'];
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

  await assertShipmentRetryOperationallyEligible(existing.allocationId);
  await assertNoPendingCustomerCancellationHold(existing.allocationId);

  const providerDto = mapProvider(existing.provider);
  assertActiveShippingProvider(providerDto);
  const diagnostics =
    providerDto === 'navlungo'
      ? await getShippingProviderReadinessDiagnostics(options.env, providerDto, existing.vendorId)
      : getShippingProviderGateDiagnostics(options.env, providerDto);
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
      skipCustomerCancellationHoldPreview: true,
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
  const retrySnapshot = buildProviderCallClaimSnapshot(existing.responseSnapshot, 'dry_run_retry');
  await prisma.$transaction(async (tx) => {
    await assertShipmentProviderCallMayBegin(tx, {
      allocationId: allocation.id,
      vendorId: allocation.assignedVendorId,
      sourceShopifyOrderId: allocation.order.sourceShopifyOrderId,
    });
    const currentExecution = await tx.shipmentExecution.findUnique({
      where: { id: existing.id },
    });
    if (!currentExecution) {
      throw new Error('Shipment execution not found.');
    }
    assertDryRunRetryEligible(currentExecution);
    await tx.shipmentExecution.update({
      where: {
        id: existing.id,
      },
      data: {
        desi: Number(preview.desi),
        cargoIntegrationId: preview.cargoIntegrationId,
        warehouseId: preview.warehouseId,
        requestSnapshot: requestSnapshot as Prisma.InputJsonValue,
        responseSnapshot: retrySnapshot as Prisma.InputJsonValue,
      },
    });
  });

  try {
    const adapter = options.adapter ?? createShippingProviderAdapter(options.env, providerDto);
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
      env: options.env,
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
        responseSnapshot: (await buildProviderFailureSnapshotWithDurableDiagnostics(error, provider, retrySnapshot, {
          vendorId: existing.vendorId,
          executionId: existing.id,
        })) as Prisma.InputJsonValue,
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
    useFullSenderDetailsForThisRetry?: boolean;
    actorRole?: string | null;
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

  if (options.useFullSenderDetailsForThisRetry && existing.provider !== ShippingProvider.NAVLUNGO) {
    throw new Error('Full sender detail retry is available only for Navlungo shipments.');
  }

  const retryingStaleNavlungo = canRetryStaleNavlungoExecution(existing);
  if (!retryingStaleNavlungo) {
    assertFailedRetryEligible(existing);
  }

  await assertShipmentRetryOperationallyEligible(existing.allocationId);
  await assertNoPendingCustomerCancellationHold(existing.allocationId);

  const providerDto = mapProvider(existing.provider);
  assertActiveShippingProvider(providerDto);
  const diagnostics = await getShippingProviderReadinessDiagnostics(options.env, providerDto, existing.vendorId);
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
      useFullSenderDetailsForThisRetry: options.useFullSenderDetailsForThisRetry === true,
    },
    {
      vendorId: existing.vendorId,
      env: options.env,
      allowNavlungoFullSenderDetails: options.useFullSenderDetailsForThisRetry === true,
      skipCustomerCancellationHoldPreview: true,
    },
  );

  const provider = normalizeProvider(preview.provider);
  if (provider !== existing.provider) {
    throw new Error('Vendor shipping provider no longer matches the shipment execution provider.');
  }
  const fullSenderRetryRequested = options.useFullSenderDetailsForThisRetry === true && provider === ShippingProvider.NAVLUNGO;
  const navlungoSenderMode = provider === ShippingProvider.NAVLUNGO
    ? fullSenderRetryRequested ? 'fullSender' : 'addressId'
    : null;

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

  const retrySnapshot = buildProviderCallClaimSnapshot(
    appendTimelineEvent({
      ...(isRecord(existing.responseSnapshot) ? existing.responseSnapshot : {}),
      retryEndpointUsed: '/shipments/:id/retry',
      existingExecutionId: existing.id,
      existingProvider: mapProvider(existing.provider),
      existingStatus: mapStatus(existing.shipmentStatus),
      existingHasProviderEvidence: hasPersistedShipmentEvidence(existing),
      staleRecoveryAttempted: retryingStaleNavlungo,
      providerCallAttempted: false,
      providerCallSkippedReason: null,
      fullSenderRetryRequested,
      senderMode: navlungoSenderMode,
    }, {
      label: 'Retry attempted',
      status: 'pending',
    }),
    'failed_retry',
  );
  const requestSnapshot = applyExistingTryOtoOrderReference(existing, preview.payload);
  await prisma.$transaction(async (tx) => {
    await assertShipmentProviderCallMayBegin(tx, {
      allocationId: allocation.id,
      vendorId: allocation.assignedVendorId,
      sourceShopifyOrderId: allocation.order.sourceShopifyOrderId,
    });
    const currentExecution = await tx.shipmentExecution.findUnique({
      where: { id: existing.id },
    });
    if (!currentExecution) {
      throw new Error('Shipment execution not found.');
    }
    if (retryingStaleNavlungo) {
      if (!canRetryStaleNavlungoExecution(currentExecution)) {
        throw new Error('Shipment execution changed before the provider retry could begin.');
      }
    } else {
      assertFailedRetryEligible(currentExecution);
    }
    await tx.shipmentExecution.update({
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
  });

  try {
    const adapter = options.adapter ?? createShippingProviderAdapter(options.env, providerDto);
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
      env: options.env,
      allocation,
      provider,
      result: {
        ...result,
        responseSnapshot: {
          ...result.responseSnapshot,
          retryEndpointUsed: '/shipments/:id/retry',
          existingExecutionId: existing.id,
          existingProvider: mapProvider(existing.provider),
          existingStatus: mapStatus(existing.shipmentStatus),
          existingHasProviderEvidence: hasPersistedShipmentEvidence(existing),
          staleRecoveryAttempted: retryingStaleNavlungo,
          providerCallAttempted: true,
          providerCallHttpStatus: readNumber(result.responseSnapshot, ['createPostHttpStatus', 'httpStatus', 'statusCode']),
          normalizedProviderShipmentIdPresent: Boolean(result.providerShipmentId),
          normalizedTrackingUrlPresent: Boolean(result.trackingUrl),
          normalizedBarcodePresent: Boolean(result.labelUrl || readString(result.responseSnapshot, ['barcode', 'barcodeNumber'])),
          persistedProviderShipmentIdPresent: Boolean(result.providerShipmentId),
          persistedTrackingUrlPresent: Boolean(result.trackingUrl),
          persistedBarcodePresent: Boolean(result.labelUrl || readString(result.responseSnapshot, ['barcode', 'barcodeNumber'])),
          fullSenderRetryRequested,
          senderMode: navlungoSenderMode,
        },
      },
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
        responseSnapshot: (await buildProviderFailureSnapshotWithDurableDiagnostics(error, provider, retrySnapshot, {
          vendorId: existing.vendorId,
          executionId: existing.id,
        })) as Prisma.InputJsonValue,
      },
    });

    return mapShipmentExecution(failed);
  }
}
