export type OrderSummaryDto = {
  id: string;
  sourceShopifyOrderId: string;
  sourceShopifyOrderNumber: string;
  vendorId: string;
  assignedVendorId: string;
  originalVendorId: string;
  allocationStatus: string;
  fulfillmentStatus: string;
  shippingStatus: string;
  carrier: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  fulfilledAt: string | null;
  shipmentCreatedAt: string | null;
  shipmentUpdatedAt: string | null;
  totalAmount: string;
  lineItemCount: number;
  createdAt: string;
  updatedAt: string;
};

export type ShopifyFulfillmentSyncDto = {
  status: 'synced' | 'pending' | 'failed' | 'not_available';
  fulfillmentOrderIdPresent: boolean;
  fulfillmentIdPresent: boolean;
  syncStatus: string | null;
  skippedReason: string | null;
  errorMessage: string | null;
  lastAttemptedAt: string | null;
};

export type ShopifyReturnSignalDiscoveryDto = {
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

export type OrderDetailLineItemDto = {
  id: string;
  sourceLineItemId: string;
  sourceVariantId: string | null;
  sku: string | null;
  title: string | null;
  quantity: number;
  lineAmount: string;
};

export type OrderAssignmentHistoryDto = {
  id: string;
  action: string;
  fromVendorId: string | null;
  toVendorId: string;
  reason: string | null;
  actorUserId: string | null;
  createdAt: string;
};

export type OrderShipmentExecutionDto = {
  id: string;
  provider: string;
  sourceShopifyOrderId: string | null;
  sourceShopifyOrderNumber: string | null;
  sourceShopifyFulfillmentId: string | null;
  providerShipmentId: string | null;
  providerCarrierName: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  labelUrl: string | null;
  shipmentStatus: string;
  desi: string;
  cargoIntegrationId: string | null;
  warehouseId: string | null;
  shippingCost: string | null;
  shippingVat: string | null;
  currency: string;
  providerStatus: string | null;
  barcode: string | null;
  lastProviderResponseAt: string | null;
  dummyCarrierDetected: boolean;
  webhookReceived: boolean;
  barcodeAssigned: boolean;
  trackingAssigned: boolean;
  returnShipment: {
    provider: 'try_oto';
    returnOrderId: string | null;
    trackingNumber: string | null;
    trackingUrl: string | null;
    labelUrl: string | null;
    barcode: string | null;
    status: string | null;
    createdAt: string | null;
    requestKeys: string[];
    responseKeys: string[];
    trackingPresent: boolean;
    labelPresent: boolean;
    labelRetrievalConfirmed: boolean;
    labelRetrievalNote: string | null;
  } | null;
  timeline: Array<{
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
    dryRun: boolean | null;
    disabledGates: string[];
    providerValidationErrors: string[];
    providerShipmentIdPresent: boolean;
    trackingNumberPresent: boolean;
    labelPresent: boolean;
    barcodePresent: boolean;
    notificationUrlIncluded: boolean | null;
    statusField: string | null;
    detectedResponseFormat: string | null;
    responseSnippet: string | null;
    authHeaderMode: string | null;
    requestId: string | null;
    requestPath?: string | null;
    selectedEnvironment?: string | null;
    requestTargetHostname?: string | null;
    providerMode?: string | null;
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
      webhookWarning?: string | null;
    };
  };
};

export type OrderDetailDto = OrderSummaryDto & {
  reassignmentRequired: boolean;
  cancellationReason: string | null;
  shopifyFulfillmentSync: ShopifyFulfillmentSyncDto;
  shopifyReturnSignal: ShopifyReturnSignalDiscoveryDto | null;
  lineItems: OrderDetailLineItemDto[];
  assignmentHistory: OrderAssignmentHistoryDto[];
  shipmentExecution: OrderShipmentExecutionDto | null;
};

export type AdminOrderBreakdownLineItemDto = {
  id: string;
  sourceLineItemId: string;
  sourceVariantId: string | null;
  sku: string | null;
  title: string | null;
  quantity: number;
  lineAmount: string;
};

export type AdminOrderBreakdownAllocationDto = {
  id: string;
  vendorId: string;
  vendorName: string;
  originalVendorId: string;
  assignedVendorId: string;
  allocationStatus: string;
  cancellationReason: string | null;
  reassignmentRequired: boolean;
  fulfillmentStatus: string;
  shippingStatus: string;
  trackingNumber: string | null;
  carrier: string | null;
  trackingUrl: string | null;
  fulfilledAt: string | null;
  shipmentCreatedAt: string | null;
  shipmentUpdatedAt: string | null;
  totalAmount: string;
  lineItems: AdminOrderBreakdownLineItemDto[];
  assignmentHistory: OrderAssignmentHistoryDto[];
  returnRecords: Array<{
    id: string;
    status: string;
    reason: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  refundRecords: Array<{
    id: string;
    sourceShopifyRefundId: string;
    amount: string;
    status: string;
    createdAt: string;
    updatedAt: string;
  }>;
};

export type AdminOrderBreakdownDto = {
  order: {
    sourceShopifyOrderId: string;
    sourceShopifyOrderNumber: string;
    customerName: string | null;
    customerEmail: string | null;
    totalAmount: string;
    createdAt: string;
    updatedAt: string;
  };
  allocations: AdminOrderBreakdownAllocationDto[];
};
