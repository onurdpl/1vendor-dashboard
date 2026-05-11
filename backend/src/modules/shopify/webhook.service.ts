import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { prisma } from '../../db/prisma.js';

function toBase64Buffer(value: string) {
  try {
    return Buffer.from(value, 'base64');
  } catch {
    return null;
  }
}

export function verifyShopifyWebhookHmac(rawBody: string, hmacHeader: string | null, secret: string): boolean {
  if (!hmacHeader) {
    return false;
  }

  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64');
  const expectedBuffer = toBase64Buffer(expected);
  const actualBuffer = toBase64Buffer(hmacHeader);

  if (!expectedBuffer || !actualBuffer || expectedBuffer.length !== actualBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, actualBuffer);
}

export async function recordVerifiedWebhook(input: {
  topic: string;
  shopDomain: string;
  webhookId: string;
  rawBody: string;
}) {
  const payloadHash = createHash('sha256').update(input.rawBody, 'utf8').digest('hex');

  await prisma.webhookEvent.upsert({
    where: {
      sourceShopDomain_topic_webhookId: {
        sourceShopDomain: input.shopDomain,
        topic: input.topic,
        webhookId: input.webhookId,
      },
    },
    update: {
      payloadHash,
      status: 'RECEIVED',
      errorMessage: null,
    },
    create: {
      sourceShopDomain: input.shopDomain,
      topic: input.topic,
      webhookId: input.webhookId,
      payloadHash,
      status: 'RECEIVED',
    },
  });
}
