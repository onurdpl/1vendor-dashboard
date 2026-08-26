import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import type {
  ClaimWebhookEventInput,
  ClaimWebhookEventResult,
  GetOrCreateWebhookEventInput,
  GetOrCreateWebhookEventResult,
  WebhookDuplicateStrategy,
} from './webhook-idempotency.types.js';

function computePayloadHash(rawBody: string) {
  return createHash('sha256').update(rawBody, 'utf8').digest('hex');
}

function getDuplicateStrategy(webhookId: string | null): WebhookDuplicateStrategy {
  return webhookId ? 'webhook_id' : 'payload_hash';
}

function computeIdempotencyKey(input: {
  topic: string;
  shopDomain: string;
  webhookId: string | null;
  payloadHash: string;
}) {
  if (input.webhookId) {
    return `${input.shopDomain}:${input.topic}:webhook:${input.webhookId}`;
  }

  return `${input.shopDomain}:${input.topic}:payload:${input.payloadHash}`;
}

function comparePayloadIdentity(storedPayloadHash: string | null, incomingPayloadHash: string) {
  return storedPayloadHash === incomingPayloadHash ? 'matched' as const : 'mismatched' as const;
}

export async function getOrCreateWebhookEvent(
  input: GetOrCreateWebhookEventInput,
): Promise<GetOrCreateWebhookEventResult> {
  const payloadHash = computePayloadHash(input.rawBody);
  const duplicateStrategy = getDuplicateStrategy(input.webhookId);
  const idempotencyKey = computeIdempotencyKey({
    topic: input.topic,
    shopDomain: input.shopDomain,
    webhookId: input.webhookId,
    payloadHash,
  });

  try {
    const event = await prisma.webhookEvent.create({
      data: {
        sourceShopDomain: input.shopDomain,
        topic: input.topic,
        webhookId: input.webhookId,
        idempotencyKey,
        payloadHash,
        rawPayload: input.rawBody,
        status: 'RECEIVED',
      },
    });

    return {
      event,
      isDuplicate: false,
      duplicateStrategy,
      action: 'accepted',
      incomingPayloadHash: payloadHash,
      payloadIdentity: 'matched',
    };
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
      throw error;
    }

    const existingEvent = await prisma.webhookEvent.findFirst({
      where: {
        OR: [
          { idempotencyKey },
          ...(input.webhookId
            ? [
                {
                  sourceShopDomain: input.shopDomain,
                  topic: input.topic,
                  webhookId: input.webhookId,
                },
              ]
            : []),
        ],
      },
    });

    if (!existingEvent) {
      throw error;
    }

    return {
      event: existingEvent,
      isDuplicate: true,
      duplicateStrategy,
      action: 'duplicate_ignored',
      incomingPayloadHash: payloadHash,
      payloadIdentity: comparePayloadIdentity(existingEvent.payloadHash, payloadHash),
    };
  }
}

export const __webhookIdempotencyTesting = {
  comparePayloadIdentity,
  computeIdempotencyKey,
  getDuplicateStrategy,
};

export async function claimWebhookEvent(
  input: ClaimWebhookEventInput,
): Promise<ClaimWebhookEventResult> {
  const claim = await prisma.webhookEvent.updateMany({
    where: {
      id: input.eventId,
      status: input.expectedStatus,
    },
    data: {
      status: 'PROCESSING',
      errorMessage: null,
    },
  });

  if (claim.count === 1) {
    return { acquired: true };
  }

  const event = await prisma.webhookEvent.findUnique({
    where: { id: input.eventId },
  });

  return {
    acquired: false,
    event,
  };
}
