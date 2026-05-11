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
