import type { WebhookEvent, WebhookStatus } from '@prisma/client';

export type WebhookDuplicateStrategy = 'webhook_id' | 'payload_hash';

export type WebhookIdempotencyAction = 'accepted' | 'duplicate_ignored';

export type WebhookPayloadIdentity = 'matched' | 'mismatched';

export type WebhookClaimableStatus = Extract<WebhookStatus, 'RECEIVED' | 'FAILED'>;

export type GetOrCreateWebhookEventInput = {
  topic: string;
  shopDomain: string;
  webhookId: string | null;
  rawBody: string;
  executionEnrollment?: {
    sourceShopifyOrderId: string;
  };
};

export type GetOrCreateWebhookEventResult = {
  event: WebhookEvent;
  isDuplicate: boolean;
  duplicateStrategy: WebhookDuplicateStrategy;
  action: WebhookIdempotencyAction;
  incomingPayloadHash: string;
  payloadIdentity: WebhookPayloadIdentity;
};

export type ClaimWebhookEventInput = {
  eventId: string;
  expectedStatus: WebhookClaimableStatus;
};

export type ClaimWebhookEventResult =
  | {
      acquired: true;
    }
  | {
      acquired: false;
      event: WebhookEvent | null;
    };
