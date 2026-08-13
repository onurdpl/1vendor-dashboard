import type { Prisma, WebhookEvent } from '@prisma/client';

export type ShopifyRefundLineItemPayload = {
  id?: string | number | null;
  line_item_id?: string | number | null;
  quantity?: number | null;
  subtotal?: string | number | null;
  line_item?: {
    id?: string | number | null;
    variant_id?: string | number | null;
    sku?: string | null;
    title?: string | null;
    name?: string | null;
    variant_title?: string | null;
  } | null;
};

export type ShopifyRefundsCreateWebhookPayload = {
  id: string | number;
  order_id?: string | number | null;
  created_at?: string | null;
  note?: string | null;
  refund_line_items?: ShopifyRefundLineItemPayload[] | null;
};

export type ParsedShopifyRefundLineItem = {
  sourceRefundLineItemId: string;
  sourceLineItemId: string | null;
  sku: string | null;
  title: string | null;
  quantity: number;
  subtotal: string | null;
};

export type ParsedShopifyRefundPayload = {
  sourceShopifyRefundId: string;
  sourceShopifyOrderId: string;
  createdAt: Date;
  note: string | null;
  refundLineItems: ParsedShopifyRefundLineItem[];
};

export type RefundIngestionSuccessResult = {
  ok: true;
  action: 'accepted';
  processingStatus: 'processed';
  shopifyOrderId: string;
  refundAllocationCount: number;
  reconciliationMode?: 'shipping_only';
  terminalStateChanged?: boolean;
};

export type RefundIngestionFailureResult = {
  ok: false;
  action: 'received_needs_attention';
  processingStatus: 'needs_attention';
  error: string;
};

export type RefundIngestionResult = RefundIngestionSuccessResult | RefundIngestionFailureResult;

type RefundIngestionSource =
  | { event: WebhookEvent; transactionClient?: never }
  | { event?: never; transactionClient: Prisma.TransactionClient };

export type RefundIngestionInput = RefundIngestionSource & {
  payload: ShopifyRefundsCreateWebhookPayload;
};
