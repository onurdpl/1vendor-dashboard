export type ShopifyVendorMetafieldValue = string | null | undefined;

export type ShopifyLineItemVendorMappingInput = {
  id: string;
  sku?: string | null;
  variantId?: string | null;
  title?: string | null;
  variantTitle?: string | null;
  quantity?: number | null;
  price?: string | number | null;
  vendorMetafieldValue?: ShopifyVendorMetafieldValue;
};

export type ShopifyVendorResolutionStatus = 'resolved' | 'unresolved';
export type ShopifyVendorResolutionConfidence = 'high' | 'none';

export type ShopifyVendorResolution = {
  vendorId: string | null;
  status: ShopifyVendorResolutionStatus;
  confidence: ShopifyVendorResolutionConfidence;
  normalizedVendorName: string | null;
  originalMetafieldValue: string | null;
  error: string | null;
};
