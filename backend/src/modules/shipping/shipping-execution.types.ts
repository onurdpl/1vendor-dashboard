export type ShippingProviderDto =
  | 'hepsijet'
  | 'kargo_entegrator'
  | 'try_oto'
  | 'kargonomi'
  | 'navlungo'
  | 'mng'
  | 'yurtici'
  | 'aras';

export type ShipmentExecutionStatusDto =
  | 'pending'
  | 'created'
  | 'failed'
  | 'in_transit'
  | 'delivered'
  | 'returned'
  | 'cancelled';

export type NavlungoCreatePostRequestSummaryDto = {
  baseUrl: string | null;
  baseUrlHost: string | null;
  baseUrlPath: string | null;
  endpointPath: string;
  method: string;
  headerKeys: string[];
  topLevelBodyKeys: string[];
  postKeys: string[];
  senderKeys: string[];
  recipientKeys: string[];
  postPayloadKeys: string[];
  barcodeFormatPresent: boolean;
  barcodeFormatType: string | null;
  codPaymentTypePresent: boolean;
  codPaymentType: string | null;
  postPricePresent: boolean;
  postPriceType: string | null;
  requestedCarrierId: number | string | null;
  requestedPostType: number | string | null;
  requestedBarcodeFormat?: string | null;
  senderUsesAddressId: boolean;
  senderFullObjectKeysPresent: boolean;
  customData1Present: boolean;
  customData2Present: boolean;
  customData3Present: boolean;
  customData4Present: boolean;
  recipientDistrictPresent: boolean;
  recipientCityPresent: boolean;
  recipientCountryPresent: boolean;
  recipientPostCodePresent: boolean;
  recipientPhonePresent: boolean;
  recipientPhoneFormatValid: boolean;
  recipientEmailPresent: boolean;
  recipientEmailFormatValid: boolean;
  recipientAddressPresent: boolean;
  recipientAddressLength: number;
  packageCountPresent: boolean;
  packageCountType: string | null;
  requestedPackageCount: number | string | null;
  desiPresent: boolean;
  desiType: string | null;
  requestedDesi: number | string | null;
  postNotePresent: boolean;
  postNoteType: string | null;
  postNoteLength: number;
};

export type VendorShippingWarehouseDto = {
  id: string;
  vendorId: string;
  provider: ShippingProviderDto;
  warehouseId: string;
  name: string | null;
  address: string | null;
  isDefault: boolean;
};

export type VendorShippingConfigDto = {
  vendorId: string;
  preferredProvider: ShippingProviderDto;
  shippingEnabled: boolean;
  defaultDesi: string;
  cargoIntegrationId: string | null;
  defaultWarehouseId: string | null;
  shippingVatPercent: string;
  warehouses: VendorShippingWarehouseDto[];
  providerMetadata: unknown;
  source: 'configured' | 'default';
  updatedAt: string | null;
};

export type ShippingProviderGateDiagnosticsDto = {
  provider: ShippingProviderDto;
  supportedProviders: ShippingProviderDto[];
  executionReady: boolean;
  sandboxModeEnabled: boolean;
  shippingExecutionEnabled: boolean;
  providerSelected: boolean;
  providerEnabled: boolean;
  webhookIngestEnabled: boolean;
  lastWebhookReceived: boolean;
  lastWebhookReceivedAt: string | null;
  lastWebhookHttpMethod: string | null;
  lastWebhookContentType: string | null;
  lastWebhookPayloadKeys: string[];
  lastWebhookMatchedShipment: boolean | null;
  lastWebhookMatchStatus: 'matched' | 'unmatched' | 'disabled' | 'parse_error' | null;
  lastWebhookMatchedByField: string | null;
  lastWebhookStatusValue: string | null;
  lastWebhookStatusMapped: boolean | null;
  lastWebhookMappedLocalStatus: string | null;
  lastWebhookParseError: string | null;
  webhookSignatureVerificationImplemented: boolean;
  baseUrlConfigured: boolean;
  apiKeyConfigured: boolean;
  cargoIntegrationIdConfigured: boolean;
  warehouseIdConfigured: boolean;
  defaultDesiConfigured: boolean;
  packageTypeUsed: string;
  notificationUrlConfigured: boolean;
  webhookRouteImplemented: boolean;
  receiverAddressAvailability: 'confirmed_required';
  dummyKargoSupport: 'available' | 'not_implemented';
  statusSyncSupport: 'webhook_ingest' | 'not_implemented';
  missing: string[];
  deprecatedEnvFallbacks: string[];
  warnings: string[];
  navlungo?: {
    usernameConfigured: boolean;
    passwordConfigured: boolean;
    defaultSenderAddressIdConfigured: boolean;
    defaultSenderAddressIdValid?: boolean;
    senderFieldsConfigured?: boolean;
    defaultBarcodeFormat: string | null;
    defaultCarrierId: string | null;
    authDiagnosticsAvailable: boolean;
    runtimeShipmentExecutionEnabled: boolean;
    returnReverseImplementation: 'not_implemented';
  };
};

export type ShipmentTimelineEventDto = {
  label: string;
  at: string;
  status: string | null;
};

export type ShipmentExecutionDto = {
  id: string;
  allocationId: string;
  vendorId: string;
  sourceShopifyOrderId: string | null;
  sourceShopifyOrderNumber: string | null;
  sourceShopifyFulfillmentId: string | null;
  provider: ShippingProviderDto;
  providerShipmentId: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  labelUrl: string | null;
  shipmentStatus: ShipmentExecutionStatusDto;
  desi: string;
  cargoIntegrationId: string | null;
  warehouseId: string | null;
  shippingCost: string | null;
  shippingVat: string | null;
  currency: string;
  shippingCostLinked: boolean;
  providerStatus: string | null;
  barcode: string | null;
  lastProviderResponseAt: string | null;
  dummyCarrierDetected: boolean;
  webhookReceived: boolean;
  barcodeAssigned: boolean;
  trackingAssigned: boolean;
  returnShipment: {
    provider: 'try_oto' | 'navlungo';
    returnOrderId: string | null;
    trackingNumber: string | null;
    trackingUrl: string | null;
    labelUrl: string | null;
    barcode: string | null;
    carrierName: string | null;
    status: string | null;
    createdAt: string | null;
    requestKeys: string[];
    responseKeys: string[];
    trackingPresent: boolean;
    labelPresent: boolean;
    labelRetrievalConfirmed: boolean;
    labelRetrievalNote: string | null;
    finalized: boolean;
    labelRetrievable: boolean;
    providerStatusSource: string | null;
    diagnostics: {
      endpoint: string | null;
      httpStatus: number | null;
      requestKeys: string[];
      responseKeys: string[];
      returnProviderIdPresent: boolean;
      returnTrackingPresent: boolean;
      returnBarcodePresent: boolean;
      returnStatus: string | null;
      returnCarrierName: string | null;
      labelFieldPresent: boolean;
      returnLabelSourceChecked: string | null;
      returnTrackingSourceChecked: string | null;
      rawPrintReturnAwbUrlPresent: boolean;
      normalizedReturnLabelUrlPresent: boolean;
      returnLabelPersistenceStage: string | null;
      returnLabelOverwrittenByStaleSnapshot: boolean;
      providerMessage: string | null;
      returnSkippedReason: string | null;
      forwardDeliveryOptionIdPresent: boolean;
      forwardDeliveryOptionIdSource: string | null;
      forwardDeliveryOptionPersistedAt: string | null;
      forwardDeliveryOptionRetainedAfterWebhook: boolean;
      forwardDeliveryOptionRetainedAfterStatusRefresh: boolean;
      returnDeliveryOptionIdPresent: boolean;
      returnDeliveryOptionIdSource: string | null;
      pickupLocationCodePresent: boolean;
      returnItemSkuPresent: boolean;
      returnItemQuantityPresent: boolean;
      createReturnShipmentFinalized: boolean;
      returnDeliveryOptionLookupCalled: boolean;
      returnDeliveryOptionLookupImplemented: boolean;
      returnPriceLookupCalled: boolean;
      returnPriceLookupSuccess: boolean;
      returnPriceLookupOptionCount: number | null;
      selectedReturnPriceOptionIdPresent: boolean;
      reverseCreateShipmentCalled: boolean;
      reverseCreateShipmentSuccess: boolean;
      reverseCreateShipmentResponseKeys: string[];
      reverseCreateShipmentTrackingPresent: boolean;
      reverseCreateShipmentBarcodePresent: boolean;
      reverseCreateShipmentLabelPresent: boolean;
      returnFinalized: boolean;
      returnFinalizationEndpointConfirmed: boolean;
      returnFinalizeEndpointImplemented: boolean;
      returnLabelRetrievable: boolean;
      providerStatusSource: string | null;
    } | null;
    detailsProbe: {
      status: string;
      attemptedAt: string | null;
      endpoint: string | null;
      httpStatus: number | null;
      responseKeys: string[];
      nestedKeys: string[];
      labelLikeFieldsPresent: boolean;
      awbLikeFieldsPresent: boolean;
      pdfLikeFieldsPresent: boolean;
      urlLikeFieldsPresent: boolean;
      trackingPresent: boolean;
      barcodePresent: boolean;
      providerStatus: string | null;
      labelUrlPresent: boolean;
      errorMessage: string | null;
    } | null;
    linkProbe: {
      status: string;
      attemptedAt: string | null;
      endpoint: string | null;
      httpStatus: number | null;
      responseKeys: string[];
      nestedKeys: string[];
      labelLikeFieldsPresent: boolean;
      awbLikeFieldsPresent: boolean;
      pdfLikeFieldsPresent: boolean;
      urlLikeFieldsPresent: boolean;
      actionUrlPresent: boolean;
      trackingPresent: boolean;
      barcodePresent: boolean;
      providerStatus: string | null;
      labelUrlPresent: boolean;
      providerMessage: string | null;
      errorMessage: string | null;
    } | null;
    awbPrintProbe: {
      status: string;
      attemptedAt: string | null;
      endpoint: string | null;
      httpStatus: number | null;
      responseKeys: string[];
      nestedKeys: string[];
      labelLikeFieldsPresent: boolean;
      awbLikeFieldsPresent: boolean;
      pdfLikeFieldsPresent: boolean;
      urlLikeFieldsPresent: boolean;
      trackingPresent: boolean;
      barcodePresent: boolean;
      providerStatus: string | null;
      labelUrlPresent: boolean;
      providerMessage: string | null;
      errorMessage: string | null;
    } | null;
    shopifyReturnLabelUploadProbe: {
      status: string;
      attemptedAt: string | null;
      reverseFulfillmentOrderIdPresent: boolean;
      reverseLineItemIdsPresent: boolean;
      mutationUsed: string | null;
      shopifyUserErrors: Array<{
        field: string[];
        message: string;
      }>;
      reverseDeliveryIdPresent: boolean;
      shopifyReturnIdPresent: boolean;
      trackingAccepted: boolean;
      labelAccepted: boolean;
      returnedCarrierName: string | null;
      carrierNamePresent: boolean;
      trackingOnlyMode: boolean;
      labelInputSent: boolean;
      shopifyCallAttempted: boolean;
      skippedReason: string | null;
      errorMessage: string | null;
    } | null;
  } | null;
  timeline: ShipmentTimelineEventDto[];
  providerResponseSummary?: {
    httpStatus: number | null;
    ok: boolean | null;
    contentType: string | null;
    parsedBodyType: string | null;
    responseKeys: string[];
    providerError: string | null;
    dryRun: boolean | null;
    disabledGates: string[];
    providerValidationErrors: string[];
    validationErrorKeys?: string[];
    validationErrorMessages?: string[];
    failedFieldNames?: string[];
    validationErrorKeysCount?: number | null;
    failedFieldNamesCount?: number | null;
    validationErrorMessagesCount?: number | null;
    providerValidationErrorsShape?: string | null;
    createPostErrorShape?: string | null;
    topLevelErrorShape?: string | null;
    nestedCreatePostErrorShape?: string | null;
    providerErrorCode?: string | null;
    providerTrackingId?: string | null;
    validationResponseShape?: {
      kind: string;
      topLevelKeys: string[];
    } | null;
    providerShipmentIdPresent: boolean;
    trackingNumberPresent: boolean;
    trackingUrlPresent: boolean;
    labelPresent: boolean;
    barcodePresent: boolean;
    endpointUsed?: string | null;
    executionId?: string | null;
    providerAtExecution?: string | null;
    existingStatus?: string | null;
    hasProviderEvidenceBefore?: boolean | null;
    staleRecoveryAttempted?: boolean | null;
    providerCallAttempted?: boolean | null;
    providerCallHttpStatus?: number | null;
    normalizedProviderShipmentIdPresent?: boolean | null;
    normalizedTrackingUrlPresent?: boolean | null;
    normalizedBarcodePresent?: boolean | null;
    persistedProviderShipmentIdPresent?: boolean | null;
    persistedTrackingUrlPresent?: boolean | null;
    persistedBarcodePresent?: boolean | null;
    dtoProviderShipmentIdPresent?: boolean | null;
    dtoTrackingUrlPresent?: boolean | null;
    dtoBarcodePresent?: boolean | null;
    skipReason?: string | null;
    realPathProviderCallAttempted?: boolean | null;
    realPathCreatePostHttpStatus?: number | null;
    realPathRequestedCarrierId?: string | number | null;
    realPathRequestedPostType?: string | number | null;
    realPathRequestedBarcodeFormat?: string | null;
    realPathCodPaymentIncluded?: boolean | null;
    realPathPriceIncluded?: boolean | null;
    senderAddressIdPresent?: boolean | null;
    senderAddressIdValid?: boolean | null;
    senderUsesAddressId?: boolean | null;
    senderMode?: string | null;
    fullSenderRetryRequested?: boolean | null;
    shopifyFulfillmentSyncAttempted?: boolean | null;
    shopifyFulfillmentSyncSkippedReason?: string | null;
    shopifyFulfillmentSynced?: boolean | null;
    shopifyFulfillmentCancelSyncSkippedReason?: string | null;
    fulfillmentTrackingNumberPresent?: boolean | null;
    fulfillmentTrackingUrlPresent?: boolean | null;
    navlungoCancelAttempted?: boolean | null;
    navlungoCancelHttpStatus?: number | null;
    navlungoCancelSucceeded?: boolean | null;
    navlungoCancelProviderMessage?: string | null;
    navlungoCancelValidationFields?: string[];
    navlungoCancelValidationMessages?: string[];
    navlungoCancelProviderTrackingId?: string | null;
    navlungoCancelledAt?: string | null;
    navlungoUpdateAttempted?: boolean | null;
    navlungoUpdateHttpStatus?: number | null;
    navlungoUpdateSucceeded?: boolean | null;
    navlungoUpdateProviderMessage?: string | null;
    navlungoUpdateValidationFields?: string[];
    navlungoUpdateValidationMessages?: string[];
    navlungoUpdateProviderTrackingId?: string | null;
    navlungoUpdateResponseShape?: {
      kind: string;
      topLevelKeys: string[];
    } | null;
    navlungoUpdateSenderMode?: string | null;
    navlungoUpdateSenderFieldKeys?: string[];
    navlungoUpdateMissingSenderFields?: string[];
    navlungoUpdatedAt?: string | null;
    shopifyFulfillmentUpdateSyncSkippedReason?: string | null;
    navlungoReturnPickupDryRun?: boolean | null;
    navlungoReturnPickupAttempted?: boolean | null;
    navlungoReturnPickupSucceeded?: boolean | null;
    navlungoReturnPickupMissingFields?: string[];
    navlungoReturnPickupPayloadSummary?: NavlungoCreatePostRequestSummaryDto | null;
    recipientAddressIdValid?: boolean | null;
    navlungoReturnRecipientAddressIdPresent?: boolean | null;
    navlungoReturnRecipientAddressIdNumeric?: boolean | null;
    navlungoReturnRecipientAddressIdSource?: string | null;
    navlungoStatusSyncAttempted?: boolean | null;
    navlungoStatusSyncHttpStatus?: number | null;
    navlungoStatusSyncResolvedProviderUrl?: string | null;
    navlungoStatusSyncResolvedProviderPath?: string | null;
    navlungoStatusSyncRequestPayloadKeys?: string[];
    navlungoStatusSyncPostPayloadKeys?: string[];
    navlungoStatusSyncLimit?: number | null;
    navlungoStatusSyncResponseShape?: {
      kind: string;
      topLevelKeys: string[];
    } | null;
    navlungoProviderStatusCode?: string | number | null;
    navlungoProviderStatusName?: string | null;
    navlungoNormalizedStatus?: string | null;
    navlungoPickedUpDate?: string | null;
    navlungoDeliveredDate?: string | null;
    navlungoCancelDate?: string | null;
    navlungoCarrierTrackingCode?: string | null;
    navlungoCarrierTrackingUrl?: string | null;
    navlungoBarcodeStatus?: string | null;
    navlungoTrackingEnriched?: boolean | null;
    navlungoGeoStatus?: string | null;
    navlungoGeoBadAddress?: boolean | null;
    navlungoCarrierTrackingPresent?: boolean | null;
    navlungoLogsCount?: number | null;
    navlungoStatusLogs?: Array<{
      statusCode: string | number | null;
      action: string | null;
      actionResult: string | null;
      createdAt: string | null;
    }>;
    navlungoStatusSyncProviderTrackingId?: string | null;
    navlungoStatusSyncValidationFields?: string[];
    navlungoStatusSyncValidationMessages?: string[];
    shopifyDeliveryStatusSyncSkippedReason?: string | null;
    realPathPostNumberPresent?: boolean | null;
    realPathTrackingUrlPresent?: boolean | null;
    realPathBarcodePresent?: boolean | null;
    realPathPersistedProviderShipmentIdPresent?: boolean | null;
    realPathPersistedTrackingUrlPresent?: boolean | null;
    realPathPersistedBarcodePresent?: boolean | null;
    notificationUrlIncluded: boolean | null;
    statusField: string | null;
    detectedResponseFormat?: string | null;
    responseSnippet?: string | null;
    authHeaderMode?: string | null;
    requestId?: string | null;
    requestPath?: string | null;
    selectedEnvironment?: string | null;
    requestTargetHostname?: string | null;
    providerMode?: string | null;
    navlungoRequestSummary?: NavlungoCreatePostRequestSummaryDto | null;
    lastSuccessfulNavlungoRequestSummary?: NavlungoCreatePostRequestSummaryDto | null;
    lastSuccessfulNavlungoRequestSummarySource?: string | null;
    lastSuccessfulNavlungoRequestSummaryReason?: string | null;
    providerApiCallAttempted?: boolean | null;
    lastProviderStage?: string | null;
    createShipmentCalled?: boolean | null;
    priceComparisonCalled?: boolean | null;
    confirmShippingPriceCalled?: boolean | null;
    getShipmentCalled?: boolean | null;
    barcodeFetchCalled?: boolean | null;
  };
  createdAt: string;
  updatedAt: string;
};

export type CreateShipmentExecutionDto = {
  allocationId: string;
  provider?: ShippingProviderDto;
  notificationUrl?: string;
  carrierId?: 'dummy';
  customerOverrides?: Partial<Record<
    'name' | 'surname' | 'phone' | 'email' | 'country' | 'postcode' | 'city' | 'district' | 'address',
    string | null
  >>;
  useFullSenderDetailsForThisRetry?: boolean;
};

export type UpdateNavlungoShipmentDto = {
  recipient?: Partial<Record<
    'name' | 'phone' | 'email' | 'country' | 'postcode' | 'city' | 'district' | 'address',
    string | null
  >>;
  postNote?: string | null;
  barcodeFormat?: string | null;
};

export type ShipmentExecutionPreviewDto = {
  allocationId: string;
  vendorId: string;
  provider: ShippingProviderDto;
  cargoIntegrationId: string | null;
  warehouseId: string | null;
  desi: string;
  notificationUrl: string | null;
  payload: Record<string, unknown>;
  customerFieldsValid: boolean;
  missingCustomerFields: string[];
  warnings: string[];
};

export type VendorShippingConfigUpdateDto = {
  preferredProvider?: ShippingProviderDto;
  shippingEnabled?: boolean;
  defaultDesi?: number;
  cargoIntegrationId?: string | null;
  defaultWarehouseId?: string | null;
  shippingVatPercent?: number;
  warehouses?: Array<{
    warehouseId: string;
    name?: string | null;
    address?: string | null;
    isDefault?: boolean;
    provider?: ShippingProviderDto;
  }>;
  providerMetadata?: unknown;
};
