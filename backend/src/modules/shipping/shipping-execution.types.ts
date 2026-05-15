export type ShippingProviderDto = 'hepsijet' | 'mng' | 'yurtici' | 'aras';

export type ShipmentExecutionStatusDto =
  | 'pending'
  | 'created'
  | 'failed'
  | 'in_transit'
  | 'delivered'
  | 'returned'
  | 'cancelled';

export type VendorShippingConfigDto = {
  vendorId: string;
  preferredProvider: ShippingProviderDto;
  shippingEnabled: boolean;
  defaultDesi: string;
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
};

export type VendorShippingConfigUpdateDto = {
  preferredProvider?: ShippingProviderDto;
  shippingEnabled?: boolean;
  defaultDesi?: number;
  providerMetadata?: unknown;
};
