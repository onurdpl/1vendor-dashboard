export type ShippingProviderDto = 'hepsijet' | 'kargo_entegrator' | 'mng' | 'yurtici' | 'aras';

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
};

export type ShippingProviderGateDiagnosticsDto = {
  provider: ShippingProviderDto;
  executionReady: boolean;
  sandboxModeEnabled: boolean;
  shippingExecutionEnabled: boolean;
  providerSelected: boolean;
  providerEnabled: boolean;
  webhookIngestEnabled: boolean;
  baseUrlConfigured: boolean;
  apiKeyConfigured: boolean;
  cargoIntegrationIdConfigured: boolean;
  warehouseIdConfigured: boolean;
  defaultDesiConfigured: boolean;
  notificationUrlConfigured: boolean;
  webhookRouteImplemented: boolean;
  receiverAddressAvailability: 'unknown_required';
  dummyKargoSupport: 'available' | 'not_implemented';
  statusSyncSupport: 'not_implemented';
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
  timeline: ShipmentTimelineEventDto[];
  createdAt: string;
  updatedAt: string;
};

export type CreateShipmentExecutionDto = {
  allocationId: string;
  provider?: ShippingProviderDto;
  notificationUrl?: string;
  carrierId?: 'dummy';
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
