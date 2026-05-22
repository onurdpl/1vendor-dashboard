import type { WebhookEvent } from '@prisma/client';

export type ReturnLifecycleTopic =
  | 'returns/request'
  | 'returns/approve'
  | 'returns/decline'
  | 'returns/close'
  | 'returns/cancel';

export type ReturnLifecycleWebhookPayload = Record<string, unknown>;

export type ReturnLifecycleIngestionInput = {
  event: WebhookEvent;
  payload: ReturnLifecycleWebhookPayload;
};

export type ReturnLifecycleIngestionResult =
  | {
      ok: true;
      action: 'accepted';
      processingStatus: 'processed';
      shopifyReturnGid: string;
      affectedRecordCount: number;
      navlungoReturnAutoCreateAttemptedCount?: number;
      navlungoReturnAutoCreateSkippedCount?: number;
    }
  | {
      ok: false;
      action: 'received_needs_attention';
      processingStatus: 'needs_attention';
      error: string;
    };
