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
  totalAmount: string;
  lineItemCount: number;
  createdAt: string;
  updatedAt: string;
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
      createShipmentRequestKeys: string[];
      createShipmentDeliveryOptionIdPresent: boolean | null;
      deliveryOptionIdPresent: boolean | null;
      orderStatusValue: string | null;
    };
  };
};

export type OrderDetailDto = OrderSummaryDto & {
  carrier: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  fulfilledAt: string | null;
  shipmentCreatedAt: string | null;
  shipmentUpdatedAt: string | null;
  reassignmentRequired: boolean;
  cancellationReason: string | null;
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
