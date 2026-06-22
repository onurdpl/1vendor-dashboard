export type SellerInfoMap = Record<string, string>;

export type FetchOrderSellerInfoResult = {
  sellerInfo: SellerInfoMap | null;
  source: 'mock' | 'shopify_admin';
};

export type ShopifyOrderLineItemImage = {
  lineItemGid: string;
  sourceLineItemId: string;
  sku: string | null;
  imageUrl: string | null;
  imageSource: 'line_item' | 'variant' | 'product_featured_media' | null;
  altText: string | null;
};

export type FetchOrderLineItemImagesResult = {
  orderGid: string;
  sourceShopifyOrderId: string;
  lineItems: ShopifyOrderLineItemImage[];
  source: 'mock' | 'shopify_admin';
};

export type ShopifyMoneySnapshot = {
  amount: string | null;
  currencyCode: string | null;
};

export type ShopifyRefundRestockType = 'CANCEL' | 'NO_RESTOCK';

export type PreviewSuggestedRefundLineItemInput = {
  sourceLineItemId: string;
  quantity: number;
  restockType: ShopifyRefundRestockType;
};

export type PreviewSuggestedRefundInput = {
  shopifyOrderId: string;
  refundLineItems: PreviewSuggestedRefundLineItemInput[];
  refundShipping: boolean;
};

export type ShopifySuggestedRefundTransactionPreview = {
  gateway: string | null;
  formattedGateway: string | null;
  amount: string | null;
  currencyCode: string | null;
  parentTransactionId: string | null;
};

export type ShopifySuggestedRefundLineItemPreview = {
  lineItemId: string;
  quantity: number;
  restockType: ShopifyRefundRestockType | null;
  subtotalAmount: string | null;
  totalTaxAmount: string | null;
  currencyCode: string | null;
};

export type ShopifySuggestedRefundPreview = {
  totalRefundAmount: string | null;
  currencyCode: string | null;
  subtotalAmount: string | null;
  totalTaxAmount: string | null;
  shippingAmount: string | null;
  maximumRefundableAmount: string | null;
  suggestedTransactions: ShopifySuggestedRefundTransactionPreview[];
  refundLineItems: ShopifySuggestedRefundLineItemPreview[];
};

export type PreviewSuggestedRefundResult = {
  orderGid: string;
  sourceShopifyOrderId: string;
  refundLineItemsPreview: Array<{
    lineItemId: string;
    quantity: number;
    restockType: ShopifyRefundRestockType;
  }>;
  suggestedRefund: ShopifySuggestedRefundPreview | null;
  graphqlErrors: string[];
  source: 'shopify_admin';
};

export type ShopifyTaxLineSnapshot = {
  title: string | null;
  rate: number | null;
  ratePercentage: number | null;
  price: ShopifyMoneySnapshot;
};

export type ShopifyOrderLineItemTaxSnapshot = {
  lineItemGid: string;
  sourceLineItemId: string;
  sku: string | null;
  quantity: number;
  originalUnitPrice: ShopifyMoneySnapshot;
  discountedTotal: ShopifyMoneySnapshot;
  taxLines: ShopifyTaxLineSnapshot[];
};

export type FetchOrderTaxSnapshotResult = {
  orderGid: string;
  sourceShopifyOrderId: string;
  taxesIncluded: boolean | null;
  orderTaxAmount: ShopifyMoneySnapshot;
  currentTaxLines: ShopifyTaxLineSnapshot[];
  lineItems: ShopifyOrderLineItemTaxSnapshot[];
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

export type ShopifyReturnTrackingInfo = {
  carrierName: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
};

export type ShopifyReverseDeliveryLineItem = {
  id: string;
  quantity: number;
  lineItemGid: string | null;
  sku: string | null;
};

export type ShopifyReverseDeliveryInfo = {
  id: string;
  labelPublicFileUrl: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  carrierName: string | null;
};

export type ShopifyReverseFulfillmentOrderInfo = {
  id: string;
  status: string | null;
  lineItems: ShopifyReverseDeliveryLineItem[];
  reverseDeliveries: ShopifyReverseDeliveryInfo[];
};

export type FetchShopifyReturnReverseDeliveryInputsResult = {
  returnGid: string;
  reverseFulfillmentOrders: ShopifyReverseFulfillmentOrderInfo[];
  source: 'mock' | 'shopify_admin';
};

export type FetchShopifyReturnDetailsResult = {
  returnGid: string;
  orderGid: string;
  lineItems: ShopifyReturnLineItem[];
  returnTracking: ShopifyReturnTrackingInfo | null;
  source: 'mock' | 'shopify_admin';
};

export type ShopifyReturnCancellationState = {
  returnGid: string;
  status: string;
  requestApprovedAt: string | null;
  closedAt: string | null;
  refundIds: string[];
  transactionIds: string[];
  reverseFulfillmentOrders: ShopifyReverseFulfillmentOrderInfo[];
  source: 'shopify_admin';
};

export type ShopifyUserError = {
  field: string[];
  message: string;
};

export type CancelShopifyReturnResult = {
  returnGid: string | null;
  status: string | null;
  userErrors: ShopifyUserError[];
  source: 'shopify_admin';
};

export type ProbeShopifyReturnLabelUploadInput = {
  returnGid: string;
  trackingNumber: string;
  trackingUrl?: string | null;
  labelUrl?: string | null;
  carrierName?: string | null;
};

export type ProbeShopifyReturnLabelUploadResult = {
  mutationUsed: 'reverseDeliveryCreateWithShipping' | 'reverseDeliveryShippingUpdate';
  reverseFulfillmentOrderIdPresent: boolean;
  reverseLineItemIdsPresent: boolean;
  reverseDeliveryId: string | null;
  trackingAccepted: boolean;
  labelAccepted: boolean;
  returnedCarrierName: string | null;
  userErrors: ShopifyUserError[];
  source: 'mock' | 'shopify_admin';
};

export type SyncShopifyReturnShippingInput = {
  returnGid: string;
  sourceLineItemId: string;
  trackingNumber: string;
  trackingUrl?: string | null;
  labelUrl?: string | null;
  notifyCustomer: boolean;
};

export type SyncShopifyReturnShippingResult = {
  mutationUsed: 'reverseDeliveryCreateWithShipping' | 'reverseDeliveryShippingUpdate';
  reverseFulfillmentOrderId: string | null;
  reverseDeliveryId: string | null;
  trackingAccepted: boolean;
  labelAccepted: boolean;
  returnedCarrierName: string | null;
  userErrors: ShopifyUserError[];
  labelInputSent: boolean;
  labelUploadAttempted: boolean;
  labelUploadSucceeded: boolean;
  labelUploadSkippedReason: string | null;
  labelUploadSource: 'public_url' | 'staged_upload' | 'missing' | 'unsupported';
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

export type ShopifyFulfillmentOrderCancellationLineItem = {
  id: string;
  lineItemId: string;
  remainingQuantity: number | null;
  totalQuantity: number | null;
};

export type ShopifyFulfillmentOrderForCancellationClassification = {
  id: string;
  status: string | null;
  requestStatus: string | null;
  supportedActions: string[] | null;
  assignedLocationId: string | null;
  assignedLocationName: string | null;
  lineItems: ShopifyFulfillmentOrderCancellationLineItem[];
};

export type ShopifyFulfillmentOrderCancellationClassificationResponse = {
  fulfillmentOrders: ShopifyFulfillmentOrderForCancellationClassification[];
  source: 'mock' | 'shopify_admin';
};

export type CancelFulfillmentOrderResult = {
  fulfillmentOrderId: string | null;
  fulfillmentOrderStatus: string | null;
  replacementFulfillmentOrderId: string | null;
  replacementFulfillmentOrderStatus: string | null;
  userErrors: ShopifyUserError[];
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
  fulfillmentCreated: boolean;
  skippedReason: string | null;
  fulfillmentOrderIdPresent: boolean;
  fulfillmentIdPresent: boolean;
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
