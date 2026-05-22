import { prisma } from '../../db/prisma.js';
import type {
  AdminOrderBreakdownDto,
  OrderDetailDto,
  OrderShipmentExecutionDto,
  OrderSummaryDto,
  ShopifyFulfillmentSyncDto,
  ShopifyReturnSignalDiscoveryDto,
} from './orders.types.js';
import { getFinanceLedgerPreviewForAllocation } from '../finance/finance-ledger-preview.service.js';
import {
  isShopifyReturnSignalTopic,
  mapWebhookEventToReturnSignalDiscovery,
} from '../shopify/return-signal-discovery.service.js';

function toAmountString(value: number) {
  return value.toFixed(2);
}

function computeTotalAmount(lineItems: Array<{ lineAmount: unknown; quantity: number }>) {
  return lineItems.reduce((sum, item) => {
    const numeric = Number(item.lineAmount ?? 0);
    if (!Number.isFinite(numeric)) {
      return sum;
    }

    return sum + numeric;
  }, 0);
}

function toNumber(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function toIsoString(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function mapShopifyFulfillmentSync(
  fulfillment:
    | {
        shopifyFulfillmentOrderId: string | null;
        shopifyFulfillmentId: string | null;
        syncStatus: string | null;
        errorMessage: string | null;
        trackingNumber: string | null;
        updatedAt: Date;
      }
    | null
    | undefined,
  allocation: { trackingNumber: string | null; carrier: string | null; trackingUrl?: string | null },
): ShopifyFulfillmentSyncDto {
  const fulfillmentOrderIdPresent = Boolean(fulfillment?.shopifyFulfillmentOrderId);
  const fulfillmentIdPresent = Boolean(fulfillment?.shopifyFulfillmentId);
  const localTrackingPresent = Boolean(
    allocation.trackingNumber || allocation.carrier || allocation.trackingUrl || fulfillment?.trackingNumber,
  );
  const failed = fulfillment?.syncStatus === 'fulfillment_sync_failed' || Boolean(fulfillment?.errorMessage);
  const status = fulfillmentIdPresent
    ? 'synced'
    : failed
      ? 'failed'
      : localTrackingPresent
        ? 'pending'
        : 'not_available';

  return {
    status,
    fulfillmentOrderIdPresent,
    fulfillmentIdPresent,
    syncStatus: fulfillment?.syncStatus ?? null,
    skippedReason: null,
    errorMessage: fulfillment?.errorMessage ?? null,
    lastAttemptedAt: fulfillment ? fulfillment.updatedAt.toISOString() : null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: Record<string, unknown> | null, keys: string[]) {
  if (!value) {
    return null;
  }

  for (const key of keys) {
    const raw = value[key];
    if (typeof raw === 'string' && raw.trim()) {
      return raw.trim().length > 220 ? `${raw.trim().slice(0, 217)}...` : raw.trim();
    }
  }

  return null;
}

function readBoolean(value: Record<string, unknown> | null, keys: string[]) {
  if (!value) {
    return false;
  }

  return keys.some((key) => value[key] === true);
}

function readStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
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

function readRecord(value: Record<string, unknown> | null, key: string) {
  if (!value) {
    return null;
  }

  const raw = value[key];
  return isRecord(raw) ? raw : null;
}

function readShipmentProviderCarrierName(snapshot: Record<string, unknown> | null) {
  return (
    readString(snapshot, ['selectedDeliveryCompanyName', 'deliveryCompany', 'deliveryCompanyName']) ??
    readString(readRecord(snapshot, 'deliveryOptionLookup'), ['selectedDeliveryCompanyName', 'deliveryCompanyName'])
  );
}

function readShipmentTimeline(value: Record<string, unknown> | null) {
  const events = Array.isArray(value?.timeline) ? value.timeline : [];
  return events
    .filter(isRecord)
    .map((event) => ({
      label: readString(event, ['label']) ?? 'Shipment update',
      at: readString(event, ['at']) ?? new Date().toISOString(),
      status: readString(event, ['status']),
    }));
}

function mapShopifyReturnLabelUploadProbe(returnShipment: Record<string, unknown>) {
  const probe = readRecord(returnShipment, 'shopifyReturnLabelUploadProbe');
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
  const diagnostics = readRecord(returnShipment, 'diagnostics');
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
  const probe = readRecord(returnShipment, 'detailsProbe');
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
  const probe = readRecord(returnShipment, 'linkProbe');
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
  const probe = readRecord(returnShipment, 'awbPrintProbe');
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

function mapReturnShipment(snapshot: Record<string, unknown> | null): OrderShipmentExecutionDto['returnShipment'] {
  const returnShipment = readRecord(snapshot, 'returnShipment');
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

function mapNavlungoRequestSummary(value: unknown): NonNullable<OrderShipmentExecutionDto['providerResponseSummary']>['navlungoRequestSummary'] {
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

function buildShipmentProviderResponseSummary(
  execution: {
    providerShipmentId: string | null;
    trackingNumber: string | null;
    labelUrl: string | null;
    responseSnapshot?: unknown;
  },
  includeSummary: boolean,
): OrderShipmentExecutionDto['providerResponseSummary'] | undefined {
  if (!includeSummary) {
    return undefined;
  }

  const snapshot = isRecord(execution.responseSnapshot) ? execution.responseSnapshot : null;
  const responseKeys = Array.isArray(snapshot?.bodyKeys)
    ? snapshot.bodyKeys.filter((key): key is string => typeof key === 'string')
    : snapshot
      ? Object.keys(snapshot).filter((key) => !['body', 'request', 'payload'].includes(key)).sort()
      : [];
  const disabledGates = Array.isArray(snapshot?.disabledGates)
    ? snapshot.disabledGates.filter((gate): gate is string => typeof gate === 'string')
    : [];
  const payloadDiagnostics = isRecord(snapshot?.payloadDiagnostics) ? snapshot.payloadDiagnostics : null;
  const addressFieldPresence: Record<string, unknown> = isRecord(payloadDiagnostics?.addressFieldPresence)
    ? payloadDiagnostics.addressFieldPresence
    : {};
  const createOrderDiagnostics = isRecord(snapshot?.createOrder) ? snapshot.createOrder : null;
  const createShipmentDiagnostics = isRecord(snapshot?.createShipment) ? snapshot.createShipment : null;
  const createPostDiagnostics = isRecord(snapshot?.createPost) ? snapshot.createPost : null;
  const updatePostDiagnostics = isRecord(snapshot?.updatePost) ? snapshot.updatePost : null;
  const createShipmentRequestDiagnostics = isRecord(snapshot?.createShipmentRequestDiagnostics)
    ? snapshot.createShipmentRequestDiagnostics
    : null;
  const orderStatusDiagnostics = isRecord(snapshot?.orderStatus) ? snapshot.orderStatus : null;
  const deliveryOptionLookupDiagnostics = isRecord(snapshot?.deliveryOptionLookup) ? snapshot.deliveryOptionLookup : null;
  const deliveryOptionLookupRequest = isRecord(deliveryOptionLookupDiagnostics?.request)
    ? deliveryOptionLookupDiagnostics.request
    : null;
  const deliveryOptionLookupResponse = isRecord(deliveryOptionLookupDiagnostics?.response)
    ? deliveryOptionLookupDiagnostics.response
    : null;
  const deliveryOptionLookupSourceFieldPresence = isRecord(deliveryOptionLookupRequest?.sourceFieldPresence)
    ? deliveryOptionLookupRequest.sourceFieldPresence
    : null;
  const tryOtoFinalization = snapshot?.provider === 'try_oto'
    ? {
        createOrderSuccess: typeof createOrderDiagnostics?.ok === 'boolean' ? createOrderDiagnostics.ok : null,
        createShipmentCalled: Boolean(createShipmentDiagnostics),
        createShipmentSuccess: typeof createShipmentDiagnostics?.ok === 'boolean' ? createShipmentDiagnostics.ok : null,
        createShipmentResponseKeys: Array.isArray(createShipmentDiagnostics?.bodyKeys)
          ? createShipmentDiagnostics.bodyKeys.filter((key): key is string => typeof key === 'string')
          : [],
        createShipmentProviderMessage: readString(createShipmentDiagnostics, ['providerError', 'message', 'reason']),
        createShipmentProviderErrorCode: readString(createShipmentDiagnostics, ['providerErrorCode', 'errorCode', 'otoErrorCode', 'code']),
        createShipmentEndpoint:
          readString(createShipmentRequestDiagnostics, ['endpoint']) ?? readString(createShipmentDiagnostics, ['requestPath']),
        createShipmentResponseStatus:
          typeof createShipmentDiagnostics?.status === 'number' ? createShipmentDiagnostics.status : null,
        createShipmentRequestKeys: Array.isArray(createShipmentRequestDiagnostics?.topLevelKeys)
          ? createShipmentRequestDiagnostics.topLevelKeys.filter((key): key is string => typeof key === 'string')
          : [],
        createShipmentDeliveryOptionIdPresent:
          typeof createShipmentRequestDiagnostics?.deliveryOptionIdPresent === 'boolean'
            ? createShipmentRequestDiagnostics.deliveryOptionIdPresent
            : null,
        deliveryOptionIdPresent:
          typeof payloadDiagnostics?.deliveryOptionIdPresent === 'boolean'
            ? payloadDiagnostics.deliveryOptionIdPresent
            : null,
        orderStatusValue:
          readString(snapshot, ['providerStatus', 'statusField', 'shipmentStatus', 'cargoStatus']) ??
          readString(orderStatusDiagnostics, ['providerError', 'statusField', 'shipmentStatus', 'cargoStatus']),
        deliveryOptionLookupCalled: deliveryOptionLookupDiagnostics?.called === true,
        deliveryOptionLookupSuccess:
          typeof deliveryOptionLookupDiagnostics?.success === 'boolean'
            ? deliveryOptionLookupDiagnostics.success
            : null,
        deliveryOptionLookupOptionCount:
          typeof deliveryOptionLookupDiagnostics?.optionCount === 'number'
            ? deliveryOptionLookupDiagnostics.optionCount
            : null,
        selectedDeliveryCompanyName: readString(deliveryOptionLookupDiagnostics, ['selectedDeliveryCompanyName']),
        selectedDeliveryOptionIdPresent: deliveryOptionLookupDiagnostics?.selectedDeliveryOptionIdPresent === true,
        deliveryOptionLookupErrorMessage:
          readString(deliveryOptionLookupDiagnostics, ['lookupErrorMessage', 'providerError']) ??
          readString(deliveryOptionLookupResponse, ['providerError']),
        deliveryOptionLookupEndpoint: readString(deliveryOptionLookupRequest, ['endpoint']),
        deliveryOptionLookupRequestKeys: Array.isArray(deliveryOptionLookupRequest?.topLevelKeys)
          ? deliveryOptionLookupRequest.topLevelKeys.filter((key): key is string => typeof key === 'string')
          : [],
        deliveryOptionLookupRequestPresence: deliveryOptionLookupRequest
          ? {
              pickupLocationCode: deliveryOptionLookupRequest.pickupLocationCodePresent === true,
              originCity: deliveryOptionLookupRequest.originCityPresent === true,
              packageWeight: deliveryOptionLookupRequest.packageWeightPresent === true,
              weight: deliveryOptionLookupRequest.weightPresent === true,
              customerCity: deliveryOptionLookupRequest.customerCityPresent === true,
              customerCountry: deliveryOptionLookupRequest.customerCountryPresent === true,
              paymentMethod: deliveryOptionLookupRequest.paymentMethodPresent === true,
            }
          : null,
        deliveryOptionLookupSourcePresence: deliveryOptionLookupSourceFieldPresence
          ? {
              pickupLocationCode: deliveryOptionLookupSourceFieldPresence.pickupLocationCode === true,
              originCity: deliveryOptionLookupSourceFieldPresence.originCity === true,
              packageWeight: deliveryOptionLookupSourceFieldPresence.packageWeight === true,
              customerCity: deliveryOptionLookupSourceFieldPresence.customerCity === true,
              customerCountry: deliveryOptionLookupSourceFieldPresence.customerCountry === true,
              paymentMethod: deliveryOptionLookupSourceFieldPresence.paymentMethod === true,
            }
          : null,
        deliveryOptionLookupResponseStatus:
          typeof deliveryOptionLookupResponse?.status === 'number' ? deliveryOptionLookupResponse.status : null,
        deliveryOptionLookupResponseKeys: Array.isArray(deliveryOptionLookupResponse?.topLevelKeys)
          ? deliveryOptionLookupResponse.topLevelKeys.filter((key): key is string => typeof key === 'string')
          : [],
        deliveryOptionLookupResponseBodyKeys: Array.isArray(deliveryOptionLookupResponse?.bodyKeys)
          ? deliveryOptionLookupResponse.bodyKeys.filter((key): key is string => typeof key === 'string')
          : [],
        deliveryOptionLookupResponseHasDeliveryOptionId:
          typeof deliveryOptionLookupResponse?.deliveryOptionIdPresent === 'boolean'
            ? deliveryOptionLookupResponse.deliveryOptionIdPresent
            : null,
        deliveryOptionLookupResponseHasDeliveryCompanyName:
          typeof deliveryOptionLookupResponse?.deliveryCompanyNamePresent === 'boolean'
            ? deliveryOptionLookupResponse.deliveryCompanyNamePresent
            : null,
        deliveryOptionLookupResponseHasPricing:
          typeof deliveryOptionLookupResponse?.pricingPresent === 'boolean' ? deliveryOptionLookupResponse.pricingPresent : null,
        deliveryOptionLookupResponsePricingKeys: Array.isArray(deliveryOptionLookupResponse?.pricingKeys)
          ? deliveryOptionLookupResponse.pricingKeys.filter((key): key is string => typeof key === 'string')
          : [],
        deliveryOptionLookupWeightFieldNames: Array.isArray(deliveryOptionLookupRequest?.weightFieldNames)
          ? deliveryOptionLookupRequest.weightFieldNames.filter((key): key is string => typeof key === 'string')
          : [],
        deliveryOptionLookupNumericWeightPresent:
          typeof deliveryOptionLookupRequest?.numericWeightPresent === 'boolean'
            ? deliveryOptionLookupRequest.numericWeightPresent
            : null,
        deliveryOptionLookupWeightType: readString(deliveryOptionLookupRequest, ['weightType']),
        lastWebhookReceivedAt: readString(snapshot, ['lastTryOtoWebhookReceivedAt']),
        lastWebhookMatchStatus: readString(snapshot, ['lastTryOtoWebhookMatchStatus']),
        lastWebhookMatchedByField: readString(snapshot, ['lastTryOtoWebhookMatchedByField']),
        lastWebhookHttpMethod: readString(snapshot, ['lastTryOtoWebhookHttpMethod']),
        lastWebhookContentType: readString(snapshot, ['lastTryOtoWebhookContentType']),
        lastWebhookStatusField: readString(snapshot, ['lastTryOtoWebhookStatusField']),
        lastWebhookStatusMapped:
          typeof snapshot?.lastTryOtoWebhookStatusMapped === 'boolean' ? snapshot.lastTryOtoWebhookStatusMapped : null,
        lastWebhookMappedShipmentStatus: readString(snapshot, ['lastTryOtoWebhookMappedShipmentStatus']),
        latestProviderStatusSource: readString(snapshot, ['latestProviderStatusSource']),
        lastWebhookParseError: readString(snapshot, ['lastTryOtoWebhookParseError']),
        webhookSignatureVerificationImplemented:
          typeof snapshot?.tryOtoWebhookSignatureVerificationImplemented === 'boolean'
            ? snapshot.tryOtoWebhookSignatureVerificationImplemented
            : null,
        webhookWarning: readString(snapshot, ['tryOtoWebhookWarning']),
      }
    : undefined;
  const validationResponseShape = isRecord(snapshot?.validationResponseShape)
    ? snapshot.validationResponseShape
    : isRecord(createPostDiagnostics?.validationResponseShape)
      ? createPostDiagnostics.validationResponseShape
      : null;
  const mappedValidationResponseShape = validationResponseShape
    ? {
        kind: readString(validationResponseShape, ['kind']) ?? 'unknown',
        topLevelKeys: readStringArray(validationResponseShape.topLevelKeys),
      }
    : null;
  const providerValidationErrors = mergeUniqueStrings(
    readValidationStringArray(snapshot?.providerValidationErrors),
    readValidationStringArray(createPostDiagnostics?.providerValidationErrors),
    readValidationStringArray(createPostDiagnostics?.validationErrorMessages),
    readValidationStringArray(snapshot?.navlungoUpdateValidationMessages),
    readValidationStringArray(updatePostDiagnostics?.validationErrorMessages),
  );
  const validationErrorKeys = mergeUniqueStrings(
    readStringArray(snapshot?.validationErrorKeys),
    readStringArray(createPostDiagnostics?.validationErrorKeys),
    readStringArray(updatePostDiagnostics?.validationErrorKeys),
  );
  const validationErrorMessages = mergeUniqueStrings(
    readValidationStringArray(snapshot?.validationErrorMessages),
    readValidationStringArray(createPostDiagnostics?.validationErrorMessages),
    readValidationStringArray(createPostDiagnostics?.providerValidationErrors),
    readValidationStringArray(snapshot?.navlungoUpdateValidationMessages),
    readValidationStringArray(updatePostDiagnostics?.validationErrorMessages),
  );
  const failedFieldNames = mergeUniqueStrings(
    readStringArray(snapshot?.failedFieldNames),
    readStringArray(createPostDiagnostics?.failedFieldNames),
    readStringArray(snapshot?.navlungoUpdateValidationFields),
    readStringArray(updatePostDiagnostics?.failedFieldNames),
  );

  return {
    httpStatus: readNumber(snapshot, ['status', 'httpStatus', 'createPostHttpStatus', 'providerCallHttpStatus', 'navlungoCancelHttpStatus', 'navlungoUpdateHttpStatus', 'statusCode']),
    ok: typeof snapshot?.ok === 'boolean' ? snapshot.ok : null,
    contentType: typeof snapshot?.contentType === 'string' ? snapshot.contentType : null,
    parsedBodyType: typeof snapshot?.parsedBodyType === 'string' ? snapshot.parsedBodyType : null,
    responseKeys,
    providerError: readString(snapshot, ['providerError', 'providerMessage', 'navlungoCancelProviderMessage', 'navlungoUpdateProviderMessage', 'error', 'message', 'reason']),
    dryRun: typeof snapshot?.dryRun === 'boolean' ? snapshot.dryRun : null,
    disabledGates,
    providerValidationErrors,
    validationErrorKeys,
    validationErrorMessages,
    failedFieldNames,
    validationErrorKeysCount:
      readNumber(snapshot, ['validationErrorKeysCount']) ??
      readNumber(createPostDiagnostics, ['validationErrorKeysCount']) ??
      validationErrorKeys.length,
    failedFieldNamesCount:
      readNumber(snapshot, ['failedFieldNamesCount']) ??
      readNumber(createPostDiagnostics, ['failedFieldNamesCount']) ??
      failedFieldNames.length,
    validationErrorMessagesCount:
      readNumber(snapshot, ['validationErrorMessagesCount']) ??
      readNumber(createPostDiagnostics, ['validationErrorMessagesCount']) ??
      validationErrorMessages.length,
    providerValidationErrorsShape:
      readString(snapshot, ['providerValidationErrorsShape']) ??
      readString(createPostDiagnostics, ['providerValidationErrorsShape']),
    createPostErrorShape:
      readString(snapshot, ['createPostErrorShape']) ?? readString(createPostDiagnostics, ['createPostErrorShape']),
    topLevelErrorShape:
      readString(snapshot, ['topLevelErrorShape']) ?? readString(createPostDiagnostics, ['topLevelErrorShape']),
    nestedCreatePostErrorShape:
      readString(snapshot, ['nestedCreatePostErrorShape']) ?? readString(createPostDiagnostics, ['nestedCreatePostErrorShape']),
    providerErrorCode:
      readString(snapshot, ['providerErrorCode', 'errorCode', 'code']) ??
      readString(createPostDiagnostics, ['providerErrorCode', 'errorCode', 'code']),
    providerTrackingId:
      readString(snapshot, ['providerTrackingId', 'navlungoUpdateProviderTrackingId']) ??
      readString(createPostDiagnostics, ['providerTrackingId']) ??
      readString(updatePostDiagnostics, ['providerTrackingId']),
    validationResponseShape: mappedValidationResponseShape,
    providerShipmentIdPresent: Boolean(execution.providerShipmentId),
    trackingNumberPresent: Boolean(execution.trackingNumber),
    labelPresent: Boolean(execution.labelUrl),
    barcodePresent: Boolean(readString(snapshot, ['barcode', 'barcodeNumber'])),
    notificationUrlIncluded: typeof snapshot?.notificationUrlIncluded === 'boolean' ? snapshot.notificationUrlIncluded : null,
    statusField: readString(snapshot, ['statusField', 'shipmentStatus', 'cargoStatus']),
    detectedResponseFormat: readString(snapshot, ['detectedResponseFormat']),
    responseSnippet: readString(snapshot, ['responseSnippet']),
    authHeaderMode: readString(snapshot, ['authHeaderMode']),
    requestId: readString(snapshot, ['requestId']),
    requestPath: readString(snapshot, ['requestPath']),
    selectedEnvironment: readString(snapshot, ['selectedEnvironment']),
    requestTargetHostname: readString(snapshot, ['requestTargetHostname']),
    providerMode: readString(snapshot, ['providerMode']),
    navlungoRequestSummary: mapNavlungoRequestSummary(snapshot?.navlungoRequestSummary),
    lastSuccessfulNavlungoRequestSummary: mapNavlungoRequestSummary(snapshot?.lastSuccessfulNavlungoRequestSummary),
    lastSuccessfulNavlungoRequestSummarySource: readString(snapshot, ['lastSuccessfulNavlungoRequestSummarySource']),
    lastSuccessfulNavlungoRequestSummaryReason: readString(snapshot, ['lastSuccessfulNavlungoRequestSummaryReason']),
    providerApiCallAttempted:
      typeof snapshot?.providerApiCallAttempted === 'boolean' ? snapshot.providerApiCallAttempted : null,
    senderAddressIdPresent: typeof snapshot?.senderAddressIdPresent === 'boolean' ? snapshot.senderAddressIdPresent : null,
    senderAddressIdValid: typeof snapshot?.senderAddressIdValid === 'boolean' ? snapshot.senderAddressIdValid : null,
    senderUsesAddressId: typeof snapshot?.senderUsesAddressId === 'boolean' ? snapshot.senderUsesAddressId : null,
    senderMode: readString(snapshot, ['senderMode']),
    fullSenderRetryRequested:
      typeof snapshot?.fullSenderRetryRequested === 'boolean' ? snapshot.fullSenderRetryRequested : null,
    shopifyFulfillmentSyncAttempted:
      typeof snapshot?.shopifyFulfillmentSyncAttempted === 'boolean' ? snapshot.shopifyFulfillmentSyncAttempted : null,
    shopifyFulfillmentSyncSkippedReason: readString(snapshot, ['shopifyFulfillmentSyncSkippedReason']),
    shopifyFulfillmentSynced:
      typeof snapshot?.shopifyFulfillmentSynced === 'boolean' ? snapshot.shopifyFulfillmentSynced : null,
    shopifyFulfillmentCancelSyncSkippedReason: readString(snapshot, ['shopifyFulfillmentCancelSyncSkippedReason']),
    fulfillmentTrackingNumberPresent:
      typeof snapshot?.fulfillmentTrackingNumberPresent === 'boolean' ? snapshot.fulfillmentTrackingNumberPresent : null,
    fulfillmentTrackingUrlPresent:
      typeof snapshot?.fulfillmentTrackingUrlPresent === 'boolean' ? snapshot.fulfillmentTrackingUrlPresent : null,
    navlungoCancelAttempted:
      typeof snapshot?.navlungoCancelAttempted === 'boolean' ? snapshot.navlungoCancelAttempted : null,
    navlungoCancelHttpStatus: readNumber(snapshot, ['navlungoCancelHttpStatus']),
    navlungoCancelSucceeded:
      typeof snapshot?.navlungoCancelSucceeded === 'boolean' ? snapshot.navlungoCancelSucceeded : null,
    navlungoCancelProviderMessage: readString(snapshot, ['navlungoCancelProviderMessage']),
    navlungoCancelValidationFields: readStringArray(snapshot?.navlungoCancelValidationFields),
    navlungoCancelValidationMessages: readValidationStringArray(snapshot?.navlungoCancelValidationMessages),
    navlungoCancelProviderTrackingId: readString(snapshot, ['navlungoCancelProviderTrackingId']),
    navlungoCancelledAt: readString(snapshot, ['navlungoCancelledAt']),
    navlungoUpdateAttempted:
      typeof snapshot?.navlungoUpdateAttempted === 'boolean' ? snapshot.navlungoUpdateAttempted : null,
    navlungoUpdateHttpStatus: readNumber(snapshot, ['navlungoUpdateHttpStatus']),
    navlungoUpdateSucceeded:
      typeof snapshot?.navlungoUpdateSucceeded === 'boolean' ? snapshot.navlungoUpdateSucceeded : null,
    navlungoUpdateProviderMessage: readString(snapshot, ['navlungoUpdateProviderMessage']),
    navlungoUpdateValidationFields: readStringArray(snapshot?.navlungoUpdateValidationFields),
    navlungoUpdateValidationMessages: readValidationStringArray(snapshot?.navlungoUpdateValidationMessages),
    navlungoUpdateProviderTrackingId: readString(snapshot, ['navlungoUpdateProviderTrackingId']),
    navlungoUpdatedAt: readString(snapshot, ['navlungoUpdatedAt']),
    shopifyFulfillmentUpdateSyncSkippedReason: readString(snapshot, ['shopifyFulfillmentUpdateSyncSkippedReason']),
    lastProviderStage: readString(snapshot, ['lastProviderStage']),
    createShipmentCalled:
      typeof snapshot?.createShipmentCalled === 'boolean'
        ? snapshot.createShipmentCalled
        : typeof snapshot?.createShipmentDraftCalled === 'boolean'
          ? snapshot.createShipmentDraftCalled
          : null,
    priceComparisonCalled:
      typeof snapshot?.priceComparisonCalled === 'boolean' ? snapshot.priceComparisonCalled : null,
    confirmShippingPriceCalled:
      typeof snapshot?.confirmShippingPriceCalled === 'boolean' ? snapshot.confirmShippingPriceCalled : null,
    getShipmentCalled:
      typeof snapshot?.getShipmentCalled === 'boolean'
        ? snapshot.getShipmentCalled
        : typeof snapshot?.getShipmentAfterConfirmCalled === 'boolean'
          ? snapshot.getShipmentAfterConfirmCalled
          : null,
    barcodeFetchCalled:
      typeof snapshot?.barcodeFetchCalled === 'boolean' ? snapshot.barcodeFetchCalled : null,
    payloadDiagnostics: payloadDiagnostics
      ? {
          topLevelKeys: Array.isArray(payloadDiagnostics.topLevelKeys)
            ? payloadDiagnostics.topLevelKeys.filter((key): key is string => typeof key === 'string')
            : [],
          customerKeys: Array.isArray(payloadDiagnostics.customerKeys)
            ? payloadDiagnostics.customerKeys.filter((key): key is string => typeof key === 'string')
            : [],
          receiverKeys: Array.isArray(payloadDiagnostics.receiverKeys)
            ? payloadDiagnostics.receiverKeys.filter((key): key is string => typeof key === 'string')
            : [],
          cargoIntegrationIdPresent: payloadDiagnostics.cargoIntegrationIdPresent === true,
          warehouseIdPresent: payloadDiagnostics.warehouseIdPresent === true,
          paymentType: readString(payloadDiagnostics, ['paymentType']),
          packageType: readString(payloadDiagnostics, ['packageType']),
          payorType: readString(payloadDiagnostics, ['payorType']),
          kgPresent: payloadDiagnostics.kgPresent === true,
          kgType: readString(payloadDiagnostics, ['kgType']),
          desiPresent: payloadDiagnostics.desiPresent === true,
          desiType: readString(payloadDiagnostics, ['desiType']),
          platformIdPresent: payloadDiagnostics.platformIdPresent === true,
          platformDIdPresent: payloadDiagnostics.platformDIdPresent === true,
          customerPhonePresent: payloadDiagnostics.customerPhonePresent === true,
          customerDistrictPresent: payloadDiagnostics.customerDistrictPresent === true,
          customerCityPresent: payloadDiagnostics.customerCityPresent === true,
          deliveryOptionIdPresent: payloadDiagnostics.deliveryOptionIdPresent === true,
          addressFieldPresence: {
            customerAddress: addressFieldPresence.customerAddress === true,
            customerPostcode: addressFieldPresence.customerPostcode === true,
            customerCountry: addressFieldPresence.customerCountry === true,
            customerCity: addressFieldPresence.customerCity === true,
            customerDistrict: addressFieldPresence.customerDistrict === true,
          },
        }
      : undefined,
    tryOtoFinalization,
  };
}

function mapShipmentExecution(execution: {
  id: string;
  provider: string;
  sourceShopifyOrderId: string | null;
  sourceShopifyOrderNumber: string | null;
  sourceShopifyFulfillmentId: string | null;
  providerShipmentId: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  labelUrl: string | null;
  shipmentStatus: string;
  desi: unknown;
  cargoIntegrationId: string | null;
  warehouseId: string | null;
  shippingCost: unknown;
  shippingVat: unknown;
  currency: string;
  responseSnapshot?: unknown;
  createdAt: Date;
  updatedAt: Date;
} | null | undefined, options: { includeProviderResponseSummary?: boolean } = {}): OrderShipmentExecutionDto | null {
  if (!execution) {
    return null;
  }
  const snapshot = isRecord(execution.responseSnapshot) ? execution.responseSnapshot : null;
  const barcode = readString(snapshot, ['barcode', 'barcodeNumber']);

  return {
    id: execution.id,
    provider: execution.provider.trim().toLowerCase(),
    sourceShopifyOrderId: execution.sourceShopifyOrderId,
    sourceShopifyOrderNumber: execution.sourceShopifyOrderNumber,
    sourceShopifyFulfillmentId: execution.sourceShopifyFulfillmentId,
    providerShipmentId: execution.providerShipmentId,
    providerCarrierName: readShipmentProviderCarrierName(snapshot),
    trackingNumber: execution.trackingNumber,
    trackingUrl: execution.trackingUrl,
    labelUrl: execution.labelUrl,
    shipmentStatus: execution.shipmentStatus.trim().toLowerCase(),
    desi: toAmountString(toNumber(execution.desi)),
    cargoIntegrationId: execution.cargoIntegrationId,
    warehouseId: execution.warehouseId,
    shippingCost: execution.shippingCost === null || execution.shippingCost === undefined ? null : toAmountString(toNumber(execution.shippingCost)),
    shippingVat: execution.shippingVat === null || execution.shippingVat === undefined ? null : toAmountString(toNumber(execution.shippingVat)),
    currency: execution.currency,
    providerStatus: readString(snapshot, ['providerStatus', 'statusField', 'shipmentStatus', 'cargoStatus']),
    barcode,
    lastProviderResponseAt: readString(snapshot, ['lastProviderResponseAt']),
    dummyCarrierDetected: readBoolean(snapshot, ['dummyCarrierDetected']),
    webhookReceived: readBoolean(snapshot, ['webhookReceived']),
    barcodeAssigned: Boolean(barcode),
    trackingAssigned: Boolean(execution.trackingNumber),
    returnShipment: mapReturnShipment(snapshot),
    timeline: readShipmentTimeline(snapshot),
    createdAt: execution.createdAt.toISOString(),
    updatedAt: execution.updatedAt.toISOString(),
    providerResponseSummary: buildShipmentProviderResponseSummary(
      execution,
      Boolean(options.includeProviderResponseSummary),
    ),
  };
}

async function getLatestShopifyReturnSignalForOrder(shopifyOrderDbId: string): Promise<ShopifyReturnSignalDiscoveryDto | null> {
  const events = await prisma.webhookEvent.findMany({
    where: {
      shopifyOrderId: shopifyOrderDbId,
      topic: {
        in: [
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
        ],
      },
    },
    orderBy: {
      receivedAt: 'desc',
    },
    take: 10,
  });

  for (const event of events) {
    if (!isShopifyReturnSignalTopic(event.topic)) {
      continue;
    }
    const summary = mapWebhookEventToReturnSignalDiscovery(event);
    if (summary) {
      return summary;
    }
  }

  return null;
}

export async function listVendorOrders(
  vendorId: string,
  options: { limit?: number; offset?: number } = {},
): Promise<OrderSummaryDto[]> {
  const allocations = await prisma.vendorAllocation.findMany({
    where: {
      assignedVendorId: vendorId,
    },
    include: {
      order: true,
      fulfillment: true,
      lineItems: true,
    },
    orderBy: {
      updatedAt: 'desc',
    },
    take: options.limit ?? 100,
    skip: options.offset ?? 0,
  });

  return allocations.map((allocation) => {
    const totalAmount = computeTotalAmount(allocation.lineItems);
    return {
      id: allocation.id,
      sourceShopifyOrderId: allocation.order.sourceShopifyOrderId,
      sourceShopifyOrderNumber: allocation.order.sourceShopifyOrderNumber,
      vendorId: allocation.assignedVendorId,
      assignedVendorId: allocation.assignedVendorId,
      originalVendorId: allocation.originalVendorId,
      allocationStatus: allocation.allocationStatus,
      fulfillmentStatus: allocation.fulfillmentStatus,
      shippingStatus: allocation.shippingStatus,
      carrier: allocation.carrier,
      trackingNumber: allocation.trackingNumber,
      trackingUrl: allocation.fulfillment?.trackingUrl ?? null,
      fulfilledAt: toIsoString(allocation.fulfillment?.fulfilledAt),
      shipmentCreatedAt: toIsoString(allocation.fulfillment?.shipmentCreatedAt),
      shipmentUpdatedAt: toIsoString(allocation.fulfillment?.shipmentUpdatedAt),
      totalAmount: toAmountString(totalAmount),
      lineItemCount: allocation.lineItems.length,
      createdAt: allocation.createdAt.toISOString(),
      updatedAt: allocation.updatedAt.toISOString(),
    };
  });
}

export async function getVendorOrderById(vendorId: string, orderId: string): Promise<OrderDetailDto | null> {
  const allocation = await prisma.vendorAllocation.findFirst({
    where: {
      id: orderId,
      assignedVendorId: vendorId,
    },
    include: {
      order: true,
      fulfillment: true,
      shipmentExecutions: {
        orderBy: {
          createdAt: 'desc',
        },
        take: 1,
      },
      lineItems: {
        include: {
          shopifyOrderLineItem: true,
        },
      },
      assignmentHistory: {
        orderBy: {
          createdAt: 'asc',
        },
      },
    },
  });

  if (!allocation) {
    return null;
  }

  const totalAmount = computeTotalAmount(allocation.lineItems);
  const shopifyReturnSignal = await getLatestShopifyReturnSignalForOrder(allocation.order.id);

  return {
    id: allocation.id,
    sourceShopifyOrderId: allocation.order.sourceShopifyOrderId,
    sourceShopifyOrderNumber: allocation.order.sourceShopifyOrderNumber,
    vendorId: allocation.assignedVendorId,
    assignedVendorId: allocation.assignedVendorId,
    originalVendorId: allocation.originalVendorId,
    allocationStatus: allocation.allocationStatus,
    fulfillmentStatus: allocation.fulfillmentStatus,
    shippingStatus: allocation.shippingStatus,
    totalAmount: toAmountString(totalAmount),
    lineItemCount: allocation.lineItems.length,
    createdAt: allocation.createdAt.toISOString(),
    updatedAt: allocation.updatedAt.toISOString(),
    carrier: allocation.carrier,
    trackingNumber: allocation.trackingNumber,
    trackingUrl: allocation.fulfillment?.trackingUrl ?? null,
    fulfilledAt: toIsoString(allocation.fulfillment?.fulfilledAt),
    shipmentCreatedAt: toIsoString(allocation.fulfillment?.shipmentCreatedAt),
    shipmentUpdatedAt: toIsoString(allocation.fulfillment?.shipmentUpdatedAt),
    shopifyFulfillmentSync: mapShopifyFulfillmentSync(allocation.fulfillment, {
      trackingNumber: allocation.trackingNumber,
      carrier: allocation.carrier,
      trackingUrl: allocation.fulfillment?.trackingUrl ?? null,
    }),
    shopifyReturnSignal,
    shipmentExecution: mapShipmentExecution(allocation.shipmentExecutions?.[0]),
    reassignmentRequired: allocation.reassignmentRequired,
    cancellationReason: allocation.cancellationReason,
    lineItems: allocation.lineItems.map((item) => ({
      id: item.id,
      sourceLineItemId: item.shopifyOrderLineItem.sourceLineItemId,
      sourceVariantId: item.shopifyOrderLineItem.sourceVariantId,
      sku: item.shopifyOrderLineItem.sku,
      title: item.shopifyOrderLineItem.title,
      quantity: item.quantity,
      lineAmount: toAmountString(Number(item.lineAmount ?? 0)),
    })),
    assignmentHistory: allocation.assignmentHistory.map((entry) => ({
      id: entry.id,
      action: entry.action,
      fromVendorId: entry.fromVendorId,
      toVendorId: entry.toVendorId,
      reason: entry.reason,
      actorUserId: entry.actorUserId,
      createdAt: entry.createdAt.toISOString(),
    })),
  };
}

export async function getVendorOrderByIdForUser(
  vendorId: string,
  orderId: string,
  options: { includeShipmentProviderResponseSummary?: boolean; includeFinanceLedgerPreview?: boolean } = {},
): Promise<OrderDetailDto | null> {
  const order = await getVendorOrderById(vendorId, orderId);
  if (!order) {
    return order;
  }

  const financeLedgerPreview = options.includeFinanceLedgerPreview
    ? await getFinanceLedgerPreviewForAllocation(vendorId, order.id)
    : undefined;

  const shipmentExecution = options.includeShipmentProviderResponseSummary
    ? await prisma.shipmentExecution.findFirst({
        where: {
          allocationId: order.id,
          vendorId,
        },
        orderBy: {
          createdAt: 'desc',
        },
      })
    : null;

  return {
    ...order,
    ...(financeLedgerPreview !== undefined ? { financeLedgerPreview } : {}),
    shipmentExecution: options.includeShipmentProviderResponseSummary
      ? mapShipmentExecution(shipmentExecution, {
          includeProviderResponseSummary: true,
        })
      : order.shipmentExecution,
  };
}

export async function getAdminShopifyOrderBreakdown(
  shopifyOrderId: string,
): Promise<AdminOrderBreakdownDto | null> {
  const order = await prisma.shopifyOrder.findUnique({
    where: {
      sourceShopifyOrderId: shopifyOrderId,
    },
    include: {
      allocations: {
        include: {
          assignedVendor: true,
          fulfillment: true,
          lineItems: {
            include: {
              shopifyOrderLineItem: true,
            },
          },
          assignmentHistory: {
            orderBy: {
              createdAt: 'asc',
            },
          },
          returnRecords: {
            orderBy: {
              createdAt: 'desc',
            },
          },
          refundRecords: {
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
  });

  if (!order) {
    return null;
  }

  const orderTotal = order.allocations.reduce(
    (sum, allocation) =>
      sum +
      allocation.lineItems.reduce((lineSum, lineItem) => lineSum + toNumber(lineItem.lineAmount), 0),
    0,
  );

  return {
    order: {
      sourceShopifyOrderId: order.sourceShopifyOrderId,
      sourceShopifyOrderNumber: order.sourceShopifyOrderNumber,
      customerName: order.customerName,
      customerEmail: order.customerEmail,
      totalAmount: order.totalPrice ? toAmountString(toNumber(order.totalPrice)) : toAmountString(orderTotal),
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
    },
    allocations: order.allocations.map((allocation) => {
      const allocationTotal = allocation.lineItems.reduce(
        (sum, lineItem) => sum + toNumber(lineItem.lineAmount),
        0,
      );

      return {
        id: allocation.id,
        vendorId: allocation.assignedVendorId,
        vendorName: allocation.assignedVendor.name,
        originalVendorId: allocation.originalVendorId,
        assignedVendorId: allocation.assignedVendorId,
        allocationStatus: allocation.allocationStatus,
        cancellationReason: allocation.cancellationReason,
        reassignmentRequired: allocation.reassignmentRequired,
        fulfillmentStatus: allocation.fulfillmentStatus,
        shippingStatus: allocation.shippingStatus,
        trackingNumber: allocation.trackingNumber,
        carrier: allocation.carrier,
        trackingUrl: allocation.fulfillment?.trackingUrl ?? null,
        fulfilledAt: toIsoString(allocation.fulfillment?.fulfilledAt),
        shipmentCreatedAt: toIsoString(allocation.fulfillment?.shipmentCreatedAt),
        shipmentUpdatedAt: toIsoString(allocation.fulfillment?.shipmentUpdatedAt),
        totalAmount: toAmountString(allocationTotal),
        lineItems: allocation.lineItems.map((lineItem) => ({
          id: lineItem.id,
          sourceLineItemId: lineItem.shopifyOrderLineItem.sourceLineItemId,
          sourceVariantId: lineItem.shopifyOrderLineItem.sourceVariantId,
          sku: lineItem.shopifyOrderLineItem.sku,
          title: lineItem.shopifyOrderLineItem.title,
          quantity: lineItem.quantity,
          lineAmount: toAmountString(toNumber(lineItem.lineAmount)),
        })),
        assignmentHistory: allocation.assignmentHistory.map((history) => ({
          id: history.id,
          action: history.action,
          fromVendorId: history.fromVendorId,
          toVendorId: history.toVendorId,
          reason: history.reason,
          actorUserId: history.actorUserId,
          createdAt: history.createdAt.toISOString(),
        })),
        returnRecords: allocation.returnRecords.map((returnRecord) => ({
          id: returnRecord.id,
          status: returnRecord.status,
          reason: returnRecord.reason,
          createdAt: returnRecord.createdAt.toISOString(),
          updatedAt: returnRecord.updatedAt.toISOString(),
        })),
        refundRecords: allocation.refundRecords.map((refundRecord) => ({
          id: refundRecord.id,
          sourceShopifyRefundId: refundRecord.sourceShopifyRefundId,
          amount: toAmountString(toNumber(refundRecord.amount)),
          status: refundRecord.status,
          createdAt: refundRecord.createdAt.toISOString(),
          updatedAt: refundRecord.updatedAt.toISOString(),
        })),
      };
    }),
  };
}
