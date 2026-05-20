export type ShippingProviderDto =
  | 'hepsijet'
  | 'kargo_entegrator'
  | 'try_oto'
  | 'kargonomi'
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
    provider: 'try_oto';
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
