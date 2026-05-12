import type { WebhookEvent } from '@prisma/client';

export type FulfillmentWebhookTopic =
  | 'fulfillments/create'
  | 'fulfillments/update'
  | 'fulfillment_events/create';

export type FulfillmentWebhookPayload = Record<string, unknown>;

export type FulfillmentIngestionInput = {
  event: WebhookEvent;
  payload: FulfillmentWebhookPayload;
  topic: FulfillmentWebhookTopic;
};

export type FulfillmentIngestionResult =
  | {
      ok: true;
      action: 'accepted';
      processingStatus: 'processed';
      shopifyOrderId: string;
      affectedAllocationCount: number;
    }
  | {
      ok: false;
      action: 'received_needs_attention';
      processingStatus: 'needs_attention';
      error: string;
    };
