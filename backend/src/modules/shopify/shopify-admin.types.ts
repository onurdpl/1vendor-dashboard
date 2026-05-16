export type SellerInfoMap = Record<string, string>;

export type FetchOrderSellerInfoResult = {
  sellerInfo: SellerInfoMap | null;
  source: 'mock' | 'shopify_admin';
};

export type ShopifyReturnLineItem = {
  returnLineItemGid: string;
  fulfillmentLineItemGid: string | null;
  lineItemGid: string | null;
  sku: string | null;
  returnReason: string | null;
  returnReasonNote: string | null;
  customerNote: string | null;
};

export type FetchShopifyReturnDetailsResult = {
  returnGid: string;
  orderGid: string;
  lineItems: ShopifyReturnLineItem[];
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

export type ShopifyOrderFulfillmentLineItem = {
  lineItemGid: string;
  sourceLineItemId: string;
  sku: string | null;
  quantity: number;
};

export type ShopifyOrderFulfillment = {
  id: string;
  sourceFulfillmentId: string;
  status: string;
  createdAt: string | null;
  updatedAt: string | null;
  events: Array<{
    status: string | null;
    happenedAt: string | null;
  }>;
  trackingInfo: Array<{
    company: string | null;
    number: string | null;
    url: string | null;
  }>;
  lineItems: ShopifyOrderFulfillmentLineItem[];
};

export type ShopifyOrderFulfillmentState = {
  orderGid: string;
  sourceShopifyOrderId: string;
  orderName: string | null;
  displayFulfillmentStatus: string | null;
  fulfillments: ShopifyOrderFulfillment[];
  fulfillmentOrders: ShopifyFulfillmentOrder[];
  source: 'mock' | 'shopify_admin';
};
