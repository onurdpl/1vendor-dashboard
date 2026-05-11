export type SellerInfoMap = Record<string, string>;

export type FetchOrderSellerInfoResult = {
  sellerInfo: SellerInfoMap | null;
  source: 'mock' | 'shopify_admin';
};

export type ShopifyGraphqlResponse<T> = {
  data?: T;
  errors?: Array<{
    message: string;
  }>;
};

export type ShopifyFulfillmentOrderLineItem = {
  id: string;
  lineItemId: string;
  quantity: number;
};

export type ShopifyFulfillmentOrder = {
  id: string;
  status: string;
  lineItems: ShopifyFulfillmentOrderLineItem[];
};

export type ShopifyFulfillmentOrdersResponse = {
  fulfillmentOrders: ShopifyFulfillmentOrder[];
  source: 'mock' | 'shopify_admin';
};

export type CreateFulfillmentTrackingInput = {
  allocationId: string;
  shopifyOrderId: string;
  trackingNumber: string;
  carrier: string;
  trackingUrl?: string | null;
  notifyCustomer: boolean;
  lineItemsByFulfillmentOrder: Array<{
    fulfillmentOrderId: string;
    fulfillmentOrderLineItems: Array<{
      id: string;
      quantity: number;
    }>;
  }>;
};

export type CreateFulfillmentTrackingResult = {
  fulfillmentId: string;
  status: 'submitted' | 'mock_submitted';
  source: 'mock' | 'shopify_admin';
};
