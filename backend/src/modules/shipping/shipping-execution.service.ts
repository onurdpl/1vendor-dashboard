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

function buildTryOtoWebhookAuthenticityVerification(
  mode: TryOtoWebhookAuthenticityVerification['mode'] = 'disabled_dev_only',
): TryOtoWebhookAuthenticityVerification {
  return {
    mode,
    providerNativeSignatureVerified: false,
    note: TRY_OTO_WEBHOOK_AUTHENTICITY_NOTE,
  };
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
  const value = readString(providerMetadata, ['navlungoCarrierId', 'carrierId', 'carrier_id']) ?? '9';
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

function resolveNavlungoBarcodeFormat(providerMetadata: unknown, env?: AppEnv) {
  return readString(providerMetadata, ['navlungoBarcodeFormat', 'barcodeFormat', 'barcode_format']) ?? 'pdf-A6';
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
    throw new Error('Navlungo is retired. Kargonomi is the only active shipping provider.');
  }

  throw new Error('Try OTO is retired. Kargonomi is the only active shipping provider.');
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
