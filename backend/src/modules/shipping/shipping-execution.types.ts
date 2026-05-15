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
  createdAt: string;
  updatedAt: string;
};

export type CreateShipmentExecutionDto = {
  allocationId: string;
  provider?: ShippingProviderDto;
  notificationUrl?: string;
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
