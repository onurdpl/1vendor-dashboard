import type { WebhookEvent } from '@prisma/client';

export type WebhookDuplicateStrategy = 'webhook_id' | 'payload_hash';

export type WebhookIdempotencyAction = 'accepted' | 'duplicate_ignored';

export type GetOrCreateWebhookEventInput = {
  topic: string;
  shopDomain: string;
  webhookId: string | null;
  rawBody: string;
};

export type GetOrCreateWebhookEventResult = {
  event: WebhookEvent;
  isDuplicate: boolean;
  duplicateStrategy: WebhookDuplicateStrategy;
  action: WebhookIdempotencyAction;
};
