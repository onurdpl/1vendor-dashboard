import type { WebhookEvent } from '@prisma/client';
import type { SellerInfoMap, ShopifyOrderLineItemImage } from './shopify-admin.types.js';

export type ShopifyOrdersCreateLineItemPayload = {
  id: string | number;
  variant_id?: string | number | null;
  sku?: string | null;
  title?: string | null;
  name?: string | null;
  variant_title?: string | null;
  quantity?: number | null;
  price?: string | number | null;
};

export type ShopifyOrdersCreateWebhookPayload = {
  id: string | number;
  order_number?: string | number | null;
  name?: string | null;
  created_at?: string | null;
  total_price?: string | number | null;
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
    district_name?: string | null;
    city_area?: string | null;
    province?: string | null;
    address1?: string | null;
    address2?: string | null;
    address?: string | null;
  } | null;
  line_items?: ShopifyOrdersCreateLineItemPayload[] | null;
};

export type ParsedShopifyOrderLineItem = {
  sourceLineItemId: string;
  sourceVariantId: string | null;
  sku: string | null;
  title: string | null;
  quantity: number;
  unitPrice: string | null;
  imageUrl: string | null;
};

export type ParsedShopifyOrderPayload = {
  sourceShopifyOrderId: string;
  sourceShopifyOrderNumber: string;
  createdAt: Date;
  totalPrice: string | null;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
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
};
