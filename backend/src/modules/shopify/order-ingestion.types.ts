import type { WebhookEvent } from '@prisma/client';
import type { FetchOrderTaxSnapshotResult, SellerInfoMap, ShopifyOrderLineItemImage } from './shopify-admin.types.js';

export type ShopifyRestTaxLinePayload = {
  title?: string | null;
  rate?: number | string | null;
  rate_percentage?: number | string | null;
  price?: string | number | null;
  price_set?: {
    shop_money?: {
      amount?: string | number | null;
      currency_code?: string | null;
    } | null;
  } | null;
};

export type ShopifyOrdersCreateLineItemPayload = {
  id: string | number;
  product_id?: string | number | null;
  variant_id?: string | number | null;
  sku?: string | null;
  title?: string | null;
  name?: string | null;
  variant_title?: string | null;
  quantity?: number | null;
  price?: string | number | null;
  tax_lines?: ShopifyRestTaxLinePayload[] | null;
};

export type ShopifyOrdersCreateWebhookPayload = {
  id: string | number;
  order_number?: string | number | null;
  name?: string | null;
  created_at?: string | null;
  currency?: string | null;
  financial_status?: string | null;
  gateway?: string | null;
  payment_gateway_names?: string[] | null;
  taxes_included?: boolean | null;
  total_tax?: string | number | null;
  current_total_tax?: string | number | null;
  tax_lines?: ShopifyRestTaxLinePayload[] | null;
  total_price?: string | number | null;
  total_discounts?: string | number | null;
  total_shipping_price_set?: {
    shop_money?: {
      amount?: string | number | null;
      currency_code?: string | null;
    } | null;
  } | null;
  shipping_lines?: Array<{
    price?: string | number | null;
  }> | null;
  note?: string | null;
  tags?: string | string[] | null;
  customer?: {
    email?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    phone?: string | null;
  } | null;
  email?: string | null;
  phone?: string | null;
  shipping_address?: {
    phone?: string | null;
    country?: string | null;
    country_code?: string | null;
    zip?: string | null;
    postcode?: string | null;
    city?: string | null;
    district?: string | null;
    districtName?: string | null;
    district_name?: string | null;
    cityArea?: string | null;
    city_area?: string | null;
    province?: string | null;
    province_code?: string | null;
    provinceCode?: string | null;
    county?: string | null;
    county_name?: string | null;
    countyName?: string | null;
    address1?: string | null;
    address2?: string | null;
    address?: string | null;
  } | null;
  billing_address?: {
    name?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    company?: string | null;
    phone?: string | null;
    country?: string | null;
    country_code?: string | null;
    city?: string | null;
    district?: string | null;
    districtName?: string | null;
    district_name?: string | null;
    cityArea?: string | null;
    city_area?: string | null;
    province?: string | null;
    province_code?: string | null;
    provinceCode?: string | null;
    county?: string | null;
    county_name?: string | null;
    countyName?: string | null;
    address1?: string | null;
    address2?: string | null;
    zip?: string | null;
    postcode?: string | null;
  } | null;
  line_items?: ShopifyOrdersCreateLineItemPayload[] | null;
};

export type ParsedShopifyOrderLineItem = {
  sourceLineItemId: string;
  shopifyProductId: string | null;
  sourceVariantId: string | null;
  sku: string | null;
  title: string | null;
  quantity: number;
  unitPrice: string | null;
  unitPriceVatIncluded: string | null;
  lineTotalVatIncluded: string | null;
  lineTaxAmount: string | null;
  vatRate: string;
  imageUrl: string | null;
};

export type ParsedShopifyOrderPayload = {
  sourceShopifyOrderId: string;
  sourceShopifyOrderNumber: string;
  createdAt: Date;
  shopifyCreatedAt: Date | null;
  currency: string | null;
  financialStatus: string | null;
  paymentGatewayName: string | null;
  taxesIncluded: boolean | null;
  orderTaxAmount: string | null;
  totalPrice: string | null;
  shippingAmount: string | null;
  discountAmount: string | null;
  orderNote: string | null;
  orderTags: string[];
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  billingFullName: string | null;
  billingCompany: string | null;
  billingPhone: string | null;
  billingCity: string | null;
  billingDistrict: string | null;
  billingAddress1: string | null;
  billingAddress2: string | null;
  billingPostcode: string | null;
  shippingCountry: string | null;
  shippingPostcode: string | null;
  shippingCity: string | null;
  shippingDistrict: string | null;
  shippingAddress: string | null;
  lineItems: ParsedShopifyOrderLineItem[];
};

export type OrderIngestionSuccessResult = {
  ok: true;
  action: 'accepted';
  processingStatus: 'processed';
  shopifyOrderId: string;
  allocationCount: number;
};

export type OrderIngestionFailureResult = {
  ok: false;
  action: 'received_needs_attention';
  processingStatus: 'needs_attention';
  error: string;
};

export type OrderIngestionResult = OrderIngestionSuccessResult | OrderIngestionFailureResult;

export type OrderIngestionInput = {
  event: WebhookEvent;
  payload: ShopifyOrdersCreateWebhookPayload;
  sellerInfo: SellerInfoMap;
  lineItemImages?: ShopifyOrderLineItemImage[];
  taxSnapshot?: FetchOrderTaxSnapshotResult | null;
};
