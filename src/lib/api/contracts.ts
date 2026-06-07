import type { VendorId } from '../auth/vendorContext';

export type OrderStatus = 'Pending' | 'Processing' | 'Shipped' | 'Delivered' | 'On Hold';
export type FulfillmentStatus = 'Pending' | 'Processing' | 'Fulfilled' | 'Partially Fulfilled';
export type ShippingStatus = 'Awaiting Shipment' | 'Label Created' | 'In Transit' | 'Delivered';
export type FulfillmentActionState = 'awaiting_shipment' | 'label_created' | 'shipped' | 'delivered';
export type AllocationStatus = 'active' | 'vendor_blocked' | 'pending_reassignment' | 'reassigned' | 'fulfilled';
export type AllocationBlockReason =
  | 'out_of_stock'
  | 'vendor_cancelled'
  | 'damaged_inventory'
  | 'fulfillment_issue';

export type NavlungoCreatePostRequestSummary = {
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

export type ShipmentExecution = {
  id: string;
  allocationId: string;
  vendorId: string;
  sourceShopifyOrderId?: string | null;
  sourceShopifyOrderNumber?: string | null;
  sourceShopifyFulfillmentId?: string | null;
  provider: ShippingProvider;
  providerShipmentId: string | null;
  providerCarrierName?: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  labelUrl: string | null;
  shipmentStatus: 'pending' | 'created' | 'failed' | 'in_transit' | 'delivered' | 'returned' | 'cancelled';
  desi: string;
  cargoIntegrationId?: string | null;
  warehouseId?: string | null;
  shippingCost: string | null;
  shippingVat: string | null;
  currency: string;
  shippingCostLinked: boolean;
  providerStatus?: string | null;
  barcode?: string | null;
  lastProviderResponseAt?: string | null;
  dummyCarrierDetected?: boolean;
  webhookReceived?: boolean;
  barcodeAssigned?: boolean;
  trackingAssigned?: boolean;
  returnShipment?: {
    provider: 'try_oto' | 'navlungo';
    returnOrderId: string | null;
    trackingNumber: string | null;
    trackingUrl: string | null;
    labelUrl: string | null;
    barcode: string | null;
    carrierName?: string | null;
    status: string | null;
    createdAt: string | null;
    requestKeys: string[];
    responseKeys: string[];
    trackingPresent: boolean;
    labelPresent: boolean;
    labelRetrievalConfirmed: boolean;
    labelRetrievalNote: string | null;
    finalized?: boolean;
    labelRetrievable?: boolean;
    providerStatusSource?: string | null;
    diagnostics?: {
      endpoint: string | null;
      httpStatus: number | null;
      requestKeys: string[];
      responseKeys: string[];
      returnProviderIdPresent: boolean;
      returnTrackingPresent: boolean;
      returnBarcodePresent: boolean;
      returnStatus: string | null;
      returnCarrierName?: string | null;
      labelFieldPresent: boolean;
      returnLabelSourceChecked?: string | null;
      returnTrackingSourceChecked?: string | null;
      rawPrintReturnAwbUrlPresent?: boolean;
      normalizedReturnLabelUrlPresent?: boolean;
      returnLabelPersistenceStage?: string | null;
      returnLabelOverwrittenByStaleSnapshot?: boolean;
      providerMessage: string | null;
      returnSkippedReason?: string | null;
      forwardDeliveryOptionIdPresent?: boolean;
      forwardDeliveryOptionIdSource?: string | null;
      forwardDeliveryOptionPersistedAt?: string | null;
      forwardDeliveryOptionRetainedAfterWebhook?: boolean;
      forwardDeliveryOptionRetainedAfterStatusRefresh?: boolean;
      returnDeliveryOptionIdPresent: boolean;
      returnDeliveryOptionIdSource?: string | null;
      pickupLocationCodePresent?: boolean;
      returnItemSkuPresent?: boolean;
      returnItemQuantityPresent?: boolean;
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
    detailsProbe?: {
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
    linkProbe?: {
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
    awbPrintProbe?: {
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
    shopifyReturnLabelUploadProbe?: {
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
      shopifyReturnIdPresent?: boolean;
      trackingAccepted?: boolean;
      labelAccepted: boolean;
      returnedCarrierName?: string | null;
      carrierNamePresent?: boolean;
      trackingOnlyMode?: boolean;
      labelInputSent?: boolean;
      shopifyCallAttempted?: boolean;
      skippedReason: string | null;
      errorMessage: string | null;
    } | null;
  } | null;
  timeline?: Array<{
    label: string;
    at: string;
    status: string | null;
  }>;
  createdAt: string;
  updatedAt: string;
  providerResponseSummary?: {
    httpStatus: number | null;
    ok: boolean | null;
    contentType: string | null;
    parsedBodyType: string | null;
    responseKeys: string[];
    providerError: string | null;
    providerErrorMessage?: string | null;
    providerErrorErrors?: unknown;
    providerErrorBodyPreview?: unknown;
    confirmShipmentId?: string | null;
    confirmShippingProviderId?: string | null;
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
    trackingUrlPresent?: boolean;
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
    autoSyncAttempted?: boolean | null;
    autoSyncSucceeded?: boolean | null;
    autoSyncSkippedReason?: string | null;
    shopifyFulfillmentId?: string | null;
    shopifyFulfillmentOrderId?: string | null;
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
    navlungoUpdateRecipientOverridePresent?: boolean | null;
    navlungoUpdateRecipientOverrideKeys?: string[];
    navlungoUpdateSubmittedRecipientOverrideKeys?: string[];
    navlungoUpdateOptionOverrideKeys?: string[];
    navlungoUpdateRecipientOverrides?: Partial<Record<
      'name' | 'phone' | 'email' | 'country' | 'postcode' | 'city' | 'district' | 'address',
      string
    >>;
    navlungoUpdatePostNote?: string | null;
    navlungoUpdateBarcodeFormat?: string | null;
    navlungoUpdatedAt?: string | null;
    shopifyFulfillmentUpdateSyncSkippedReason?: string | null;
    navlungoReturnPickupDryRun?: boolean | null;
    navlungoReturnPickupAttempted?: boolean | null;
    navlungoReturnPickupSucceeded?: boolean | null;
    navlungoReturnPickupMissingFields?: string[];
    navlungoReturnPickupPayloadSummary?: NavlungoCreatePostRequestSummary | null;
    recipientAddressIdValid?: boolean | null;
    navlungoReturnRecipientAddressIdPresent?: boolean | null;
    navlungoReturnRecipientAddressIdNumeric?: boolean | null;
    navlungoReturnRecipientAddressIdSource?: string | null;
    navlungoReturnRecipientMetadataConfigured?: boolean | null;
    navlungoReturnRecipientName?: string | null;
    navlungoReturnRecipientCity?: string | null;
    navlungoReturnRecipientDistrict?: string | null;
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
    navlungoRequestSummary?: NavlungoCreatePostRequestSummary | null;
    lastSuccessfulNavlungoRequestSummary?: NavlungoCreatePostRequestSummary | null;
    lastSuccessfulNavlungoRequestSummarySource?: string | null;
    lastSuccessfulNavlungoRequestSummaryReason?: string | null;
    providerApiCallAttempted?: boolean | null;
    lastProviderStage?: string | null;
    createShipmentCalled?: boolean | null;
    priceComparisonCalled?: boolean | null;
    confirmShippingPriceCalled?: boolean | null;
    getShipmentCalled?: boolean | null;
    barcodeFetchCalled?: boolean | null;
    kargonomiPostCreateDiagnostics?: {
      getShipmentAfterConfirm: {
        httpStatus: number | null;
        contentType: string | null;
        bodyKeys: string[];
        safeFields: unknown;
      } | null;
      barcodeFetch: {
        httpStatus: number | null;
        contentType: string | null;
        topLevelKeys: string[];
        bodyKeys: string[];
        detectedFormat: string | null;
        pdfLikeValuePresent: boolean | null;
        labelUrlPresent: boolean | null;
      } | null;
    } | null;
    payloadDiagnostics?: {
      topLevelKeys: string[];
      customerKeys: string[];
      receiverKeys: string[];
      cargoIntegrationIdPresent: boolean;
      warehouseIdPresent: boolean;
      paymentType: string | null;
      packageType: string | null;
      payorType: string | null;
      kgPresent: boolean;
      kgType: string | null;
      desiPresent: boolean;
      desiType: string | null;
      platformIdPresent: boolean;
      platformDIdPresent: boolean;
      customerPhonePresent: boolean;
      customerDistrictPresent: boolean;
      customerCityPresent: boolean;
      deliveryOptionIdPresent?: boolean;
      addressFieldPresence: {
        customerAddress: boolean;
        customerPostcode: boolean;
        customerCountry: boolean;
        customerCity: boolean;
        customerDistrict: boolean;
      };
    };
    tryOtoFinalization?: {
      createOrderSuccess: boolean | null;
      createShipmentCalled: boolean;
      createShipmentSuccess: boolean | null;
      createShipmentResponseKeys: string[];
      createShipmentProviderMessage: string | null;
      createShipmentProviderErrorCode?: string | null;
      createShipmentEndpoint?: string | null;
      createShipmentResponseStatus?: number | null;
      createShipmentRequestKeys: string[];
      createShipmentDeliveryOptionIdPresent: boolean | null;
      deliveryOptionIdPresent: boolean | null;
      orderStatusValue: string | null;
      deliveryOptionLookupCalled?: boolean;
      deliveryOptionLookupSuccess?: boolean | null;
      deliveryOptionLookupOptionCount?: number | null;
      selectedDeliveryCompanyName?: string | null;
      selectedDeliveryOptionIdPresent?: boolean;
      deliveryOptionLookupErrorMessage?: string | null;
      deliveryOptionLookupEndpoint?: string | null;
      deliveryOptionLookupRequestKeys?: string[];
      deliveryOptionLookupRequestPresence?: {
        pickupLocationCode: boolean;
        originCity: boolean;
        packageWeight: boolean;
        weight?: boolean;
        customerCity: boolean;
        customerCountry: boolean;
        paymentMethod: boolean;
      } | null;
      deliveryOptionLookupSourcePresence?: {
        pickupLocationCode: boolean;
        originCity: boolean;
        packageWeight: boolean;
        customerCity: boolean;
        customerCountry: boolean;
        paymentMethod: boolean;
      } | null;
      deliveryOptionLookupResponseStatus?: number | null;
      deliveryOptionLookupResponseKeys?: string[];
      deliveryOptionLookupResponseBodyKeys?: string[];
      deliveryOptionLookupResponseHasDeliveryOptionId?: boolean | null;
      deliveryOptionLookupResponseHasDeliveryCompanyName?: boolean | null;
      deliveryOptionLookupResponseHasPricing?: boolean | null;
      deliveryOptionLookupResponsePricingKeys?: string[];
      deliveryOptionLookupWeightFieldNames?: string[];
      deliveryOptionLookupNumericWeightPresent?: boolean | null;
      deliveryOptionLookupWeightType?: string | null;
      lastWebhookReceivedAt?: string | null;
      lastWebhookMatchStatus?: string | null;
      lastWebhookMatchedByField?: string | null;
      lastWebhookHttpMethod?: string | null;
      lastWebhookContentType?: string | null;
      lastWebhookStatusField?: string | null;
      lastWebhookStatusMapped?: boolean | null;
      lastWebhookMappedShipmentStatus?: string | null;
      latestProviderStatusSource?: string | null;
      lastWebhookParseError?: string | null;
      webhookSignatureVerificationImplemented?: boolean | null;
      webhookAuthenticityVerification?: {
        mode: 'shared_secret' | 'disabled_dev_only';
        providerNativeSignatureVerified: false;
        note: string;
      } | null;
      webhookWarning?: string | null;
    };
  };
};

export type ShipmentCustomerField =
  | 'name'
  | 'surname'
  | 'phone'
  | 'email'
  | 'country'
  | 'postcode'
  | 'city'
  | 'district'
  | 'address';

export type ShipmentCustomerOverrides = Partial<Record<ShipmentCustomerField, string>>;

export type ShippingProviderDiagnostics = {
  provider: ShippingProvider | 'navlungo';
  supportedProviders?: Array<ShippingProvider | 'navlungo'>;
  executionReady: boolean;
  sandboxModeEnabled?: boolean;
  shippingExecutionEnabled: boolean;
  providerSelected?: boolean;
  providerEnabled: boolean;
  webhookIngestEnabled?: boolean;
  lastWebhookReceived?: boolean;
  lastWebhookReceivedAt?: string | null;
  lastWebhookHttpMethod?: string | null;
  lastWebhookContentType?: string | null;
  lastWebhookPayloadKeys?: string[];
  lastWebhookMatchedShipment?: boolean | null;
  lastWebhookMatchStatus?: 'matched' | 'unmatched' | 'disabled' | 'parse_error' | null;
  lastWebhookMatchedByField?: string | null;
  lastWebhookStatusValue?: string | null;
  lastWebhookStatusMapped?: boolean | null;
  lastWebhookMappedLocalStatus?: string | null;
  lastWebhookParseError?: string | null;
  webhookSignatureVerificationImplemented?: boolean;
  webhookAuthenticityVerification?: {
    mode: 'shared_secret' | 'disabled_dev_only';
    providerNativeSignatureVerified: false;
    note: string;
  };
  baseUrlConfigured: boolean;
  apiKeyConfigured: boolean;
  cargoIntegrationIdConfigured?: boolean;
  warehouseIdConfigured?: boolean;
  defaultDesiConfigured?: boolean;
  notificationUrlConfigured?: boolean;
  webhookRouteImplemented?: boolean;
  packageTypeUsed?: string;
  receiverAddressAvailability?: 'confirmed_required' | 'unknown_required';
  dummyKargoSupport?: 'available' | 'not_implemented';
  statusSyncSupport?: 'webhook_ingest' | 'not_implemented';
  missing: string[];
  deprecatedEnvFallbacks?: string[];
  warnings?: string[];
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

export type ShippingProvider = 'hepsijet' | 'kargo_entegrator' | 'try_oto' | 'kargonomi' | 'navlungo' | 'mng' | 'yurtici' | 'aras';

export type VendorShippingWarehouse = {
  id: string;
  vendorId: string;
  provider: ShippingProvider;
  warehouseId: string;
  name: string | null;
  address: string | null;
  isDefault: boolean;
};

export type VendorShippingConfig = {
  vendorId: string;
  preferredProvider: ShippingProvider;
  shippingEnabled: boolean;
  defaultDesi: string;
  cargoIntegrationId: string | null;
  defaultWarehouseId: string | null;
  shippingVatPercent: string;
  warehouses: VendorShippingWarehouse[];
  providerMetadata: unknown;
  source: 'configured' | 'default';
  updatedAt?: string | null;
};

export type VendorShippingConfigUpdate = {
  preferredProvider?: ShippingProvider;
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
    provider?: ShippingProvider;
  }>;
  providerMetadata?: unknown;
};

export type AssignmentHistoryAction = 'assigned' | 'vendor_blocked' | 'reassignment_requested' | 'reassigned';

export type AssignmentHistoryEntry = {
  action: AssignmentHistoryAction;
  fromVendorId: VendorId | null;
  toVendorId: VendorId;
  reason?: string;
  actorName: string;
  actorRole: 'admin' | 'vendor' | 'support' | 'finance' | 'system';
  createdAt: string;
};

export type OrderSummary = {
  originalVendorId: VendorId;
  assignedVendorId: VendorId;
  id: string;
  // Compatibility alias for current pages/hooks. Maps to assignedVendorId.
  vendorId: VendorId;
  sourceShopifyOrderId: string;
  sourceShopifyOrderNumber: string | number;
  status: OrderStatus;
  allocationStatus: AllocationStatus;
  cancellationReason?: AllocationBlockReason;
  reassignmentRequired: boolean;
  assignmentBlockedAt?: string;
  assignmentHistory: AssignmentHistoryEntry[];
  fulfillmentActionState: FulfillmentActionState;
  fulfillmentActionAvailable: boolean;
  fulfilledAt?: string;
  fulfilledByVendorId?: VendorId;
  shipmentCreatedAt?: string;
  shipmentUpdatedAt?: string;
  fulfillmentStatus: FulfillmentStatus;
  shippingStatus: ShippingStatus;
  trackingNumber?: string;
  carrier?: string;
  trackingUrl?: string;
  estimatedDelivery?: string;
  lineItemCount: number;
  date: string;
  customer: string;
  amount: string;
  channel: string;
};

export type OrderLineItem = {
  originalVendorId: VendorId;
  assignedVendorId: VendorId;
  id: string;
  sku: string;
  variantTitle: string;
  name: string;
  imageUrl?: string | null;
  quantity: number;
  price: string;
  shopifyProductId?: string | null;
  unitPriceVatIncluded?: string | null;
  lineTotalVatIncluded?: string | null;
  lineTaxAmount?: string | null;
  vatRate?: string | null;
  // Compatibility alias for current pages/hooks. Maps to assignedVendorId.
  vendorId: VendorId;
  fulfillmentStatus: FulfillmentStatus;
  allocationStatus: AllocationStatus;
  cancellationReason?: AllocationBlockReason;
  reassignmentRequired: boolean;
  assignmentBlockedAt?: string;
  fulfillmentActionState: FulfillmentActionState;
  fulfillmentActionAvailable: boolean;
  fulfilledAt?: string;
  fulfilledByVendorId?: VendorId;
  shipmentCreatedAt?: string;
  shipmentUpdatedAt?: string;
  shippingStatus: ShippingStatus;
  trackingNumber?: string;
  carrier?: string;
  trackingUrl?: string;
  estimatedDelivery?: string;
};

export type OrderIntegrationSnapshot = {
  shopifyCreatedAt: string | null;
  currency: string | null;
  financialStatus: string | null;
  paymentGatewayName: string | null;
  taxesIncluded: boolean | null;
  orderTaxAmount: string | null;
  shippingAmount: string | null;
  discountAmount: string | null;
  orderNote: string | null;
  orderTags: string[];
  vendorIntegrationStatus: string | null;
  vendorIntegrationStatusMessage: string | null;
  vendorIntegrationStatusUpdatedAt: string | null;
  vendorIntegrationProvider: string | null;
  vendorIntegrationTrackingUrl: string | null;
  vendorIntegrationShippedAt: string | null;
  vendorInvoiceNumber: string | null;
  vendorInvoiceDate: string | null;
  vendorInvoiceUrl: string | null;
  vendorInvoiceAmount: string | null;
  vendorInvoiceReceivedAt: string | null;
  billingAddress: {
    fullName: string | null;
    company: string | null;
    phone: string | null;
    city: string | null;
    district: string | null;
    address1: string | null;
    address2: string | null;
    postcode: string | null;
  };
};

export type FinanceLedgerPreviewEntry = {
  id: string;
  eventType:
    | 'ORDER_CREATED'
    | 'PAYMENT_CAPTURED'
    | 'MARKETPLACE_COMMISSION_RESERVED'
    | 'VENDOR_PAYABLE_RESERVED'
    | 'SHIPPING_COST_RESERVED'
    | 'RETURN_CREATED'
    | 'REFUND_APPROVED'
    | 'REFUND_COMPLETED'
    | 'COMMISSION_REVERSED'
    | 'VENDOR_PAYABLE_REVERSED'
    | 'VENDOR_DEBT_CREATED'
    | 'MANUAL_ADJUSTMENT';
  sourceType: 'shopify_order' | 'shopify_return' | 'shopify_refund' | 'manual' | 'system';
  lineItemId: string | null;
  returnId: string | null;
  refundId: string | null;
  amount: string;
  currency: string;
  occurredAt: string;
  impact: {
    grossSales: string | null;
    marketplaceCommission: string | null;
    vendorPayable: string | null;
    shippingCostReserved: string | null;
    vendorDebt: string | null;
  };
};

export type FinanceLedgerPreview = {
  status: 'ready' | 'partial';
  currency: string;
  entries: FinanceLedgerPreviewEntry[];
  balance: {
    grossSales: string;
    marketplaceCommission: string;
    vendorPayable: string;
    shippingCostReserved: string;
    vendorDebt: string;
    netVendorPosition: string;
  };
  unknowns: string[];
  assumptions: string[];
  sourceFields: {
    orderId: string;
    orderNumber: string;
    allocationId: string;
    vendorId: string;
    lineItemCount: number;
    returnCount: number;
    refundCount: number;
    commissionProfile: 'configured' | 'unknown';
    shippingCost: 'confirmed' | 'provider_snapshot' | 'unknown';
    payoutAlreadyPaid: boolean;
  };
};

export type OrderDetail = OrderSummary & {
  shippingAddress: string;
  notes: string;
  lineItems: OrderLineItem[];
  items: OrderLineItem[];
  orderSnapshot?: OrderIntegrationSnapshot | null;
  timeline: Array<{ label: string; at: string }>;
  shipmentExecution?: ShipmentExecution | null;
  shopifyFulfillmentSync?: {
    status: 'synced' | 'pending' | 'failed' | 'not_available';
    fulfillmentOrderIdPresent: boolean;
    fulfillmentIdPresent: boolean;
    syncStatus: string | null;
    skippedReason: string | null;
    errorMessage: string | null;
    lastAttemptedAt: string | null;
  };
  shopifyReturnSignal?: {
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
  } | null;
  financeLedgerPreview?: FinanceLedgerPreview | null;
};

export type VendorAllocationSummary = {
  originalVendorId: VendorId;
  assignedVendorId: VendorId;
  vendorId: VendorId;
  vendorName: string;
  allocationOrderId: string;
  status: OrderStatus;
  allocationStatus: AllocationStatus;
  cancellationReason?: AllocationBlockReason;
  reassignmentRequired: boolean;
  assignmentBlockedAt?: string;
  reassignmentCandidateVendorIds: VendorId[];
  reassignmentNote?: string;
  reassignedAt?: string;
  reassignedBy?: string;
  assignmentHistory: AssignmentHistoryEntry[];
  fulfillmentActionState: FulfillmentActionState;
  fulfillmentActionAvailable: boolean;
  fulfilledAt?: string;
  fulfilledByVendorId?: VendorId;
  shipmentCreatedAt?: string;
  shipmentUpdatedAt?: string;
  fulfillmentStatus: FulfillmentStatus;
  shippingStatus: ShippingStatus;
  trackingNumber?: string;
  carrier?: string;
  trackingUrl?: string;
  estimatedDelivery?: string;
  allocationTotal: string;
  lineItems: OrderLineItem[];
  refundedItems: ReturnLineItem[];
  refundTotal: string;
};

export type ShopifyOrderBreakdown = {
  sourceShopifyOrderId: string;
  sourceShopifyOrderNumber: string | number;
  customer: string;
  createdAt: string;
  allocations: VendorAllocationSummary[];
};

export type ParatikaSessionTokenLiveProbeResult = {
  ok: boolean;
  writesPerformed: boolean;
  provider: 'PARATIKA';
  mode: string;
  action: 'SESSIONTOKEN';
  model?: string;
  marketplaceModel?: string;
  paymentReference?: string | null;
  totalSellerCommissionPolicy?: string | null;
  httpStatus?: number;
  responseCode?: string | null;
  responseMsg?: string | null;
  errorCode?: string | null;
  errorMsg?: string | null;
  violatorParam?: string | null;
  sessionTokenReceived?: boolean;
  sessionTokenLength?: number;
  hostedPaymentUrl?: string | null;
  hostedPaymentUrlCandidates?: string[];
  rawBodyKeys?: string[];
  externalApiCallAttempted: boolean;
  cardDataIncluded: boolean;
  validationErrors?: string[];
};

export type ReturnStatus =
  | 'Requested'
  | 'Approved'
  | 'Declined'
  | 'Cancelled'
  | 'Closed'
  | 'Processed'
  | 'Refunded'
  | 'Rejected'
  | 'Pending'
  | 'In Review';

export type ReturnSummary = {
  originalVendorId: VendorId;
  assignedVendorId: VendorId;
  id: string;
  // Compatibility alias for current pages/hooks. Maps to assignedVendorId.
  vendorId: VendorId;
  sourceShopifyOrderId: string;
  sourceShopifyOrderNumber: string | number;
  sourceShopifyRefundId: string;
  sourceShopifyReturnId?: string | null;
  sourceType?: 'shopify_refund' | 'shopify_return_request';
  status: ReturnStatus;
  relatedOrderId: string;
  date: string;
  updatedAt?: string;
  customer: string;
  reason: string;
  returnReasonNote?: string | null;
  returnProvider?: string | null;
  returnProviderShipmentId?: string | null;
  returnLabel?: string | null;
  returnReferenceId?: string | null;
  navlungoReturnCreatedAt?: string | null;
  returnProviderSnapshot?: Record<string, unknown> | null;
  returnCarrierName?: string | null;
  returnTrackingNumber?: string | null;
  returnTrackingUrl?: string | null;
  vendorReceivedAt?: string | null;
  vendorReviewedAt?: string | null;
  vendorDecision?: 'approved' | 'rejected' | null;
  vendorDecisionReason?: string | null;
  amount: string;
  itemTitle?: string | null;
  displayTitle?: string | null;
  variantTitle?: string | null;
  refundedSkus?: string[];
  refundedItems?: ReturnLineItem[];
};

export type ReturnLineItem = {
  originalVendorId: VendorId;
  assignedVendorId: VendorId;
  id: string;
  sku: string;
  variantTitle: string;
  name: string;
  imageUrl?: string | null;
  quantity: number;
  condition: 'New' | 'Opened' | 'Damaged';
  refundAmount: string;
  // Compatibility alias for current pages/hooks. Maps to assignedVendorId.
  vendorId: VendorId;
};

export type ReturnDetail = ReturnSummary & {
  resolution: string;
  refundMethod: string;
  processedBy: string;
  refundedItems: ReturnLineItem[];
  items: ReturnLineItem[];
  timeline: Array<{ label: string; at: string }>;
};

export type KargonomiReturnPreview = {
  ok: true;
  provider: 'KARGONOMI';
  mode: 'return_preview';
  returnId: string;
  ready: boolean;
  missingFields: string[];
  direction: 'CUSTOMER_TO_VENDOR';
  senderSource: 'CUSTOMER_ORDER_ADDRESS';
  receiverSource: 'VENDOR_KARGONOMI_WAREHOUSE';
  previewPayload: Record<string, unknown>;
  notes: string[];
};

export type SupportTicketPriority = 'low' | 'normal' | 'high';
export type SupportTicketStatus = 'OPEN' | 'IN_REVIEW' | 'WAITING_FOR_VENDOR' | 'RESOLVED' | 'CLOSED';
export type SupportTicketCategory = 'ORDER' | 'RETURN' | 'REFUND' | 'SHIPMENT' | 'TRACKING' | 'PAYOUT' | 'INVOICE' | 'OTHER';
export type SupportTicketContextType = 'order' | 'return' | 'shipment' | 'general';

export type CreateSupportTicketInput = {
  subject: string;
  message: string;
  priority: SupportTicketPriority;
  category?: SupportTicketCategory;
  contextType: SupportTicketContextType;
  contextId?: string | null;
  contextSnapshot?: Record<string, unknown> | null;
};

export type SupportTicketNote = {
  id: string;
  supportTicketId: string;
  authorUserId: string;
  authorName: string;
  authorRole: string;
  content: string;
  createdAt: string;
};

export type SupportTicketReply = {
  id: string;
  supportTicketId: string;
  authorUserId: string;
  authorName: string;
  authorRole: 'ADMIN' | 'VENDOR';
  message: string;
  createdAt: string;
};

export type SupportTicketSla = {
  isOverdue: boolean;
  dueLabel: string;
  escalationLevel: 'none' | 'due_soon' | 'overdue' | 'escalated';
  dueAt: string | null;
  overdueByHours: number | null;
};

export type SupportTicketContextSummary = {
  route?: string;
  path?: string;
  orderNumber?: string;
  returnNumber?: string;
  status?: string;
  flags?: Record<string, boolean>;
};

export type SupportTicket = {
  id: string;
  createdAt: string;
  updatedAt: string;
  createdByUserId: string;
  createdByRole: string;
  vendorId: VendorId;
  vendorName: string | null;
  subject: string;
  message: string;
  priority: SupportTicketPriority;
  status: SupportTicketStatus;
  category: SupportTicketCategory;
  assigneeUserId: string | null;
  assigneeName: string | null;
  vendorUnreadCount: number;
  adminUnreadCount: number;
  lastReplyAt: string | null;
  lastReplyByRole: 'ADMIN' | 'VENDOR' | null;
  firstResponseDueAt: string | null;
  nextResponseDueAt: string | null;
  escalatedAt: string | null;
  escalationReason: string | null;
  sla: SupportTicketSla | null;
  contextType: SupportTicketContextType;
  contextId: string | null;
  contextSummary?: SupportTicketContextSummary | null;
  contextSnapshot?: unknown;
  resolvedAt: string | null;
  closedAt: string | null;
  notes?: SupportTicketNote[];
  replies?: SupportTicketReply[];
};

export type SupportAnalyticsKpis = {
  openTickets: number;
  overdueTickets: number;
  avgFirstResponseHours: number | null;
  avgResolutionHours: number | null;
  waitingOnVendor: number;
  resolvedToday: number;
};

export type SupportAnalyticsCategoryInsight = {
  category: SupportTicketCategory;
  ticketCount: number;
  overdueCount: number;
  overduePercent: number;
  avgResolutionHours: number | null;
};

export type SupportAnalyticsVendorInsight = {
  vendorId: VendorId;
  vendorName: string | null;
  ticketCount: number;
  unresolvedCount: number;
  overdueCount: number;
  overduePercent: number;
  avgResolutionHours: number | null;
  needsAttention: boolean;
};

export type SupportAnalyticsSla = {
  overdueTickets: number;
  overduePercent: number;
  avgResponseDelayHours: number | null;
  avgResolutionHours: number | null;
  breachesByCategory: Array<{
    category: SupportTicketCategory;
    overdueCount: number;
  }>;
};

export type SupportAnalyticsAssignmentInsight = {
  assigneeName: string;
  ticketCount: number;
  overdueCount: number;
  avgFirstResponseHours: number | null;
  unassignedOpenTickets: number;
};

export type SupportAnalyticsTrendPoint = {
  date: string;
  created: number;
  resolved: number;
  overdue: number;
};

export type SupportAnalytics = {
  generatedAt: string;
  kpis: SupportAnalyticsKpis;
  categoryInsights: SupportAnalyticsCategoryInsight[];
  vendorInsights: SupportAnalyticsVendorInsight[];
  slaInsights: SupportAnalyticsSla;
  assignmentInsights: SupportAnalyticsAssignmentInsight[];
  trends: SupportAnalyticsTrendPoint[];
};

export type FinanceTransactionStatus = 'Completed' | 'Pending' | 'Reconciled' | 'Failed' | 'Recorded';

export type FinanceSummary = {
  grossSales: string;
  refunds: string;
  netRevenue: string;
  platformFee: string;
  commissionVat?: string;
  shippingDeductions?: string;
  payoutEstimate: string;
  totalRevenue: string;
  availableBalance: string;
  pendingPayouts: string;
  refundsThisMonth: string;
  accruedBalance?: string;
  payableBalance?: string;
  heldBalance?: string;
  refundedBalance?: string;
  pendingSettlement?: string;
};

export type PayoutBatchStatus =
  | 'draft'
  | 'review'
  | 'approved'
  | 'cancelled'
  | 'execution_pending'
  | 'paid_placeholder';

export type PayoutBatch = {
  id: string;
  vendorId: string;
  status: PayoutBatchStatus;
  grossAmount: string;
  commissionAmount: string;
  commissionVatAmount: string;
  shippingDeductionAmount: string;
  refundAmount: string;
  netAmount: string;
  currency: string;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  lineCount: number;
  warning: string | null;
};

export type InvoiceExecutionReference = {
  id: string;
  provider: 'bizimhesap' | 'parasut' | 'birfatura';
  status: 'pending' | 'created' | 'failed' | 'cancelled' | 'unknown';
  visibilityStatus:
    | 'invoice_missing'
    | 'accounting_sync_pending'
    | 'accounting_synced'
    | 'invoice_linked'
    | 'invoice_visibility_incomplete'
    | 'provider_failed'
    | 'cancelled';
  visibilityLabel: string;
  reconciliationState:
    | 'invoice_missing'
    | 'invoice_pending'
    | 'accounting_sync_pending'
    | 'invoice_linked'
    | 'invoice_visibility_incomplete'
    | 'provider_failed'
    | 'cancelled';
  finalInvoiceState:
    | 'not_requested'
    | 'draft_or_synced'
    | 'finalized_visible'
    | 'visibility_unknown'
    | 'failed'
    | 'cancelled';
  syncSemantics: 'none' | 'draft_accounting_sync' | 'final_invoice_visibility';
  providerCapabilities: {
    supportsDraftSubmission: boolean;
    supportsFinalInvoiceVisibility: boolean;
    supportsPdfLink: boolean;
    supportsStatusSync: boolean;
    note: string;
  };
  providerInvoiceGuid: string | null;
  providerInvoiceNo: string | null;
  providerPdfUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

export type InvoiceExecutionResponseSummary = {
  id: string;
  provider: 'bizimhesap' | 'parasut' | 'birfatura';
  status: 'pending' | 'created' | 'failed' | 'cancelled' | 'unknown';
  providerInvoiceGuidPresent: boolean;
  providerInvoiceNoPresent: boolean;
  providerPdfUrlPresent: boolean;
  response: {
    httpStatus: number | null;
    ok: boolean | null;
    contentType: string | null;
    parsedBodyType: string | null;
    bodyKeys: string[];
    nestedBodyKeys: string[];
    providerError: string | null;
    parsedGuidPresent: boolean;
    parsedPdfUrlPresent: boolean;
  } | null;
};

export type PayoutBatchSummary = {
  eligibleRowCount: number;
  eligibleNetAmount: string;
  blockedRowCount: number;
  latestBatch: PayoutBatch | null;
};

export type VendorFinancialProfile = {
  vendorId: string;
  commissionPercent: string;
  commissionVatPercent: string;
  deductShippingEnabled: boolean;
  shippingMode: 'disabled' | 'fixed' | 'external_provider';
  fixedShippingFee: string | null;
  active: boolean;
  source: 'configured' | 'default';
};

export type VendorBillingProfile = {
  id: string;
  vendorId: string;
  legalCompanyName: string | null;
  taxNumber: string | null;
  taxOffice: string | null;
  billingAddress: string | null;
  billingCity: string | null;
  billingDistrict: string | null;
  iban: string | null;
  authorizedPerson: string | null;
  billingEmail: string | null;
  billingPhone: string | null;
  legalEntityType: string | null;
  logoIsbasiCustomerCode: string | null;
  logoIsbasiCustomerId: string | null;
  logoIsbasiEinvoiceEligible: boolean | null;
  logoIsbasiLastCheckedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type VendorBillingProfileInput = {
  legalCompanyName: string;
  taxNumber: string;
  taxOffice: string;
  billingAddress: string;
  billingCity?: string | null;
  billingDistrict?: string | null;
  iban?: string | null;
  authorizedPerson?: string | null;
  billingEmail?: string | null;
  billingPhone?: string | null;
  legalEntityType?: string | null;
  logoIsbasiCustomerCode?: string | null;
  logoIsbasiCustomerId?: string | null;
  logoIsbasiEinvoiceEligible?: boolean | null;
  logoIsbasiLastCheckedAt?: string | null;
};

export type PayoutCalculation = {
  grossAmount: string;
  commission: string;
  commissionVat: string;
  shippingDeduction: string;
  shippingVatAmount?: string;
  shippingDeductionSource?: 'none' | 'fixed' | 'external_provider';
  shippingCostProvider?: string | null;
  shippingCostSnapshot?: string | null;
  shippingCostStatus?: 'snapshot' | 'pending_provider_cost' | 'not_applicable';
  refundImpact: string;
  estimatedPayout: string;
  shippingApplied: boolean;
  shippingMode: 'disabled' | 'fixed' | 'external_provider';
  profileSource?: 'snapshot' | 'current' | 'default';
  commissionPercent?: string;
  commissionVatPercent?: string;
};

export type FinanceTransaction = {
  id: string;
  date: string;
  description: string;
  counterparty: string;
  category: 'Payout' | 'Refund' | 'Invoice' | 'Adjustment';
  amount: string;
  status: FinanceTransactionStatus;
  shopifyOrderNumber?: string;
  shopifyOrderId?: string;
  shopifyRefundId?: string;
  payoutCalculation?: PayoutCalculation | null;
  settlement?: {
    status: 'pending' | 'accruing' | 'payable' | 'partially_refunded' | 'held' | 'settled' | 'disputed';
    payoutReady: boolean;
    eligibleAt: string | null;
    accruedAt: string | null;
    payableAt: string | null;
    settledAt: string | null;
    holdReason: string | null;
    note: string;
  };
  payoutBatch?: {
    id: string;
    status: PayoutBatchStatus;
    netAmount: string;
    createdAt: string;
  } | null;
  invoiceExecution?: InvoiceExecutionReference | null;
};

export type FinanceDashboard = {
  summary: FinanceSummary;
  profile?: VendorFinancialProfile;
  payoutBatchSummary?: PayoutBatchSummary;
  transactions: FinanceTransaction[];
};

export type AutomationAlertType = 'Info' | 'Warning' | 'Critical';
export type AutomationAlertStatus = 'New' | 'In Progress' | 'Resolved';

export type AutomationAlert = {
  id: string;
  type: AutomationAlertType;
  message: string;
  status: AutomationAlertStatus;
  timestamp: string;
  source: string;
};

export type AutomationSuggestion = {
  title: string;
  description: string;
  actionLabel: string;
};

export type AutomationDashboard = {
  alerts: AutomationAlert[];
  suggestions: AutomationSuggestion[];
};

export type DashboardStat = {
  label: string;
  value: string;
};

export type DashboardPriorityItem = {
  label: string;
  value: string;
  tone: 'severity-normal' | 'severity-attention' | 'severity-warning' | 'severity-critical';
  description?: string;
};

export type DashboardOperationalSummary = {
  vendorId: string;
  orders: {
    total: number;
    awaitingShipment: number;
    blocked: number;
    pendingReassignment: number;
    vendorBlocked: number;
  };
  returns: {
    refundAttention: number;
  };
};

export type DashboardFinanceSnapshot = {
  grossSales: string;
  refunds: string;
  netRevenue: string;
  payoutEstimate: string;
};

export type DashboardDiagnosticsSummary = {
  failedWebhooks: number;
  stuckReceived: number;
  fulfillmentSyncFailures: number;
};

export type DashboardObservabilitySummary = {
  health: 'healthy' | 'warning' | 'degraded' | 'critical';
  retryPressureScore: number;
  deadLetterReady: number;
  failedWebhooks24h: number;
  successRate24h: number;
  reconciliationBacklog: number;
  staleStateCount: number;
  note: string;
};

export type OperationalSignalSeverity = 'info' | 'warning' | 'high' | 'critical';
export type OperationalSignalStatus = 'active' | 'acknowledged' | 'resolved' | 'ignored';
export type OperationalSignalSourceArea =
  | 'payout'
  | 'refund'
  | 'fulfillment'
  | 'diagnostics'
  | 'reconciliation'
  | 'shipping_cost'
  | 'settlement';

export type OperationalSignal = {
  id: string;
  type: string;
  severity: OperationalSignalSeverity;
  sourceArea: OperationalSignalSourceArea;
  vendorId: string | null;
  allocationId: string | null;
  financeLedgerEntryId: string | null;
  payoutBatchId: string | null;
  operationalJobId: string | null;
  title: string;
  description: string;
  suggestedAction: string | null;
  status: OperationalSignalStatus;
  ruleKey: string;
  triggeredAt: string;
  resolvedAt: string | null;
};

export type OperationalSignalsResponse = {
  summary: {
    total: number;
    critical: number;
    high: number;
    warning: number;
    info: number;
  };
  signals: OperationalSignal[];
};

export type NotificationStatus = 'pending' | 'delivered' | 'read' | 'dismissed' | 'skipped' | 'failed';
export type NotificationRecipientRole = 'admin' | 'vendor';
export type NotificationChannel = 'in_app' | 'email_placeholder' | 'slack_placeholder';

export type NotificationIntent = {
  id: string;
  signalId: string | null;
  vendorId: string | null;
  recipientRole: NotificationRecipientRole;
  channel: NotificationChannel;
  status: NotificationStatus;
  title: string;
  message: string;
  severity: OperationalSignalSeverity;
  deliveredAt: string | null;
  readAt: string | null;
  metadata?: unknown;
  createdAt: string;
  updatedAt: string;
};

export type NotificationsResponse = {
  summary: {
    total: number;
    unread: number;
    critical: number;
    high: number;
    warning: number;
  };
  notifications: NotificationIntent[];
};

export type DashboardNotificationSummary = {
  unread: number;
  highPriority: number;
  latest: Array<{
    id: string;
    title: string;
    severity: OperationalSignalSeverity;
    status: NotificationStatus;
  }>;
};

export type DashboardOperationalCountMetadata = {
  label: string;
  source: string;
  rawCount: number | null;
  groupedCount: number | null;
};

export type DashboardNormalizedOperationalCounts = {
  openSupportIssueCount: number | null;
  groupedAutomationIssueCount: number | null;
  financeReviewItemCount: number | null;
  staleFulfillmentGroupCount: number | null;
  metadata: {
    openSupportIssueCount: DashboardOperationalCountMetadata;
    groupedAutomationIssueCount: DashboardOperationalCountMetadata;
    financeReviewItemCount: DashboardOperationalCountMetadata;
    staleFulfillmentGroupCount: DashboardOperationalCountMetadata;
  };
};

export type DashboardOverview = {
  vendorId: string;
  vendorName: string;
  title: string;
  description: string;
  loadPhase?: 'initial' | 'deferred';
  stats: DashboardStat[];
  recentActivity: string[];
  workspaceStatus: string;
  priorityWork: DashboardPriorityItem[];
  financeSnapshot?: DashboardFinanceSnapshot;
  diagnosticsSummary?: DashboardDiagnosticsSummary;
  observabilitySummary?: DashboardObservabilitySummary;
  notificationSummary?: DashboardNotificationSummary;
  normalizedOperationalCounts?: DashboardNormalizedOperationalCounts;
  partialDataWarnings?: string[];
};

export type OperationsQueueItemType =
  | 'pending_reassignment'
  | 'vendor_blocked'
  | 'awaiting_shipment'
  | 'refund_attention'
  | 'operational_signal'
  | 'automation_action';
export type OperationsQueueSeverity = 'low' | 'medium' | 'high' | 'critical';

export type OperationsQueueItem = {
  id: string;
  type: OperationsQueueItemType;
  severity: OperationsQueueSeverity;
  title: string;
  description: string;
  vendorId: VendorId;
  vendorName?: string;
  relatedOrderId?: string;
  relatedShopifyOrderId?: string;
  status: string;
  createdAt: string;
  actionLabel?: string;
  actionTo?: string;
};

export type OperationsQueueSummary = {
  total: number;
  critical: number;
  warning: number;
  attention: number;
  normal: number;
  pendingReassignment: number;
  vendorBlocked: number;
  awaitingShipment: number;
  refundAttention: number;
  operationalSignals: number;
  automationActions: number;
};

export type OperationsQueueDashboard = {
  summary: OperationsQueueSummary;
  items: OperationsQueueItem[];
};

export type OperationsAttentionSeverity = 'info' | 'warning' | 'critical';
export type OperationsAttentionType =
  | 'support'
  | 'shipment'
  | 'return'
  | 'finance'
  | 'vendor_risk'
  | 'operational_signal'
  | 'automation';

export type OperationsAttentionItem = {
  id: string;
  type: OperationsAttentionType;
  severity: OperationsAttentionSeverity;
  vendorId: VendorId | string;
  vendorName: string;
  objectType: string;
  objectReference: string;
  objectId: string | null;
  status: string;
  ageHours: number;
  title: string;
  description: string;
  recommendedAction: string;
  destinationPath: string | null;
  createdAt: string;
};

export type OperationsAttentionSection = {
  key: 'support' | 'shipment' | 'return' | 'finance';
  title: string;
  count: number;
  critical: number;
  warning: number;
  items: OperationsAttentionItem[];
};

export type OperationsRecommendationType =
  | 'support_escalation'
  | 'support_assignment'
  | 'shipment_tracking'
  | 'shipment_stale'
  | 'return_review'
  | 'return_refund'
  | 'finance_review'
  | 'invoice_retry'
  | 'vendor_risk'
  | 'automation_review';

export type OperationsRecommendation = {
  id: string;
  type: OperationsRecommendationType;
  severity: OperationsAttentionSeverity;
  title: string;
  description: string;
  recommendedAction: string;
  relatedObjectType: string;
  relatedObjectId: string | null;
  vendor: {
    id: VendorId | string;
    name: string;
  };
  createdFromSignal: string;
  deepLink: string | null;
  vendorVisible: boolean;
  createdAt: string;
};

export type OperationsVendorRisk = {
  vendorId: VendorId | string;
  vendorName: string;
  riskLevel: OperationsAttentionSeverity;
  totalAttentionItems: number;
  criticalItems: number;
  warningItems: number;
  supportItems: number;
  shipmentItems: number;
  returnItems: number;
  financeItems: number;
  drivers: string[];
};

export type OperationsActivity = {
  id: string;
  type: OperationsAttentionType;
  severity: OperationsAttentionSeverity;
  vendorId: VendorId | string;
  vendorName: string;
  title: string;
  description: string;
  occurredAt: string;
  destinationPath: string | null;
};

export type OperationsAttentionDashboard = {
  generatedAt: string;
  summary: {
    total: number;
    critical: number;
    warning: number;
    info: number;
    overdueSupport: number;
    shipmentIssues: number;
    returnBacklog: number;
    financeReview: number;
    vendorRisks: number;
  };
  queue: OperationsAttentionItem[];
  sections: OperationsAttentionSection[];
  recommendations: OperationsRecommendation[];
  vendorRisks: OperationsVendorRisk[];
  recentActivity: OperationsActivity[];
};

export type VendorIntegrationProviderAuditLog = {
  method: string;
  path: string;
  statusCode: number;
  requestId: string | null;
  createdAt: string;
};

export type VendorIntegrationProviderSummary = {
  clientId: string;
  providerName: string;
  vendorIdentifier: string;
  scopes: string[];
  enabled: boolean;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
  lastRequestAt: string | null;
  requestsLast24h: number;
  rateLimitedLast24h: number;
  authFailuresLast24h: number | null;
  recentAuditLogs: VendorIntegrationProviderAuditLog[];
};

export type VendorIntegrationProviderManagement = {
  generatedAt: string;
  providers: VendorIntegrationProviderSummary[];
};

export type VendorIntegrationProviderRevokeResult = {
  clientId: string;
  vendorIdentifier: string;
  providerName: string;
  enabled: boolean;
  revokedAt: string | null;
};
