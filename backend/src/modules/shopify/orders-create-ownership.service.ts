import { Prisma, type WebhookEvent } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import type { OrdersCreateFencedExecutionContext } from './order-ingestion.types.js';

export const ORDERS_CREATE_PROCESSING_LEASE_MS = 60_000;
export const ORDERS_CREATE_HEARTBEAT_CADENCE_MS = 10_000;

type FencedClaimRow = Pick<
  WebhookEvent,
  | 'id'
  | 'sourceShopifyOrderId'
  | 'processingGeneration'
  | 'executionAttemptCount'
  | 'executionMaxAttempts'
  | 'processingLeaseExpiresAt'
>;

type OwnershipRow = {
  id: string;
};

type OwnershipExistsRow = {
  owned: boolean;
};

type ClaimKind = 'RECEIVED' | 'FAILED' | 'EXPIRED_PROCESSING';

export type OrdersCreateFencedClaimResult =
  | {
      acquired: true;
      ownership: FencedClaimRow;
    }
  | {
      acquired: false;
    };

export class OrdersCreateLostFenceError extends Error {
  readonly code = 'orders_create_lost_fence';

  constructor(message = 'Shopify orders/create execution ownership was lost.') {
    super(message);
    this.name = 'OrdersCreateLostFenceError';
  }
}

export function isOrdersCreateLostFenceError(error: unknown): error is OrdersCreateLostFenceError {
  return error instanceof OrdersCreateLostFenceError;
}

function sanitizeFailureMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || 'Shopify orders/create processing failed.');
  return message.replace(/[\r\n]+/g, ' ').slice(0, 500);
}

function claimPredicate(kind: ClaimKind) {
  if (kind === 'RECEIVED') {
    return Prisma.sql`
      "status" = 'RECEIVED'
      AND "executionAvailableAt" IS NOT NULL
      AND "executionAvailableAt" <= CURRENT_TIMESTAMP
    `;
  }

  if (kind === 'FAILED') {
    return Prisma.sql`
      "status" = 'FAILED'
      AND "executionAvailableAt" IS NOT NULL
      AND "executionAvailableAt" <= CURRENT_TIMESTAMP
    `;
  }

  return Prisma.sql`
    "status" = 'PROCESSING'
    AND "processingLeaseExpiresAt" IS NOT NULL
    AND "processingLeaseExpiresAt" <= CURRENT_TIMESTAMP
  `;
}

async function claimFencedOrdersCreateEvent(input: {
  eventId: string;
  kind: ClaimKind;
  leaseDurationMs?: number;
}): Promise<OrdersCreateFencedClaimResult> {
  const leaseDurationMs = input.leaseDurationMs ?? ORDERS_CREATE_PROCESSING_LEASE_MS;
  const rows = await prisma.$queryRaw<FencedClaimRow[]>(Prisma.sql`
    UPDATE "WebhookEvent"
    SET
      "status" = 'PROCESSING',
      "processingGeneration" = "processingGeneration" + 1,
      "executionAttemptCount" = "executionAttemptCount" + 1,
      "executionAvailableAt" = NULL,
      "processingLeaseExpiresAt" = CURRENT_TIMESTAMP + (${leaseDurationMs} * INTERVAL '1 millisecond'),
      "errorMessage" = NULL
    WHERE "id" = ${input.eventId}
      AND "topic" = 'orders/create'
      AND "sourceShopifyOrderId" IS NOT NULL
      AND "executionAttemptCount" < "executionMaxAttempts"
      AND ${claimPredicate(input.kind)}
    RETURNING
      "id",
      "sourceShopifyOrderId",
      "processingGeneration",
      "executionAttemptCount",
      "executionMaxAttempts",
      "processingLeaseExpiresAt"
  `);

  const ownership = rows[0];
  return ownership
    ? { acquired: true, ownership }
    : { acquired: false };
}

export function claimDueReceivedOrdersCreateEvent(eventId: string, leaseDurationMs?: number) {
  return claimFencedOrdersCreateEvent({ eventId, kind: 'RECEIVED', leaseDurationMs });
}

export function claimDueFailedOrdersCreateEvent(eventId: string, leaseDurationMs?: number) {
  return claimFencedOrdersCreateEvent({ eventId, kind: 'FAILED', leaseDurationMs });
}

export function claimExpiredProcessingOrdersCreateEvent(eventId: string, leaseDurationMs?: number) {
  return claimFencedOrdersCreateEvent({ eventId, kind: 'EXPIRED_PROCESSING', leaseDurationMs });
}

export function createOrdersCreateFencedExecutionContext(
  ownership: FencedClaimRow,
  signal: AbortSignal,
): OrdersCreateFencedExecutionContext {
  if (!ownership.sourceShopifyOrderId) {
    throw new OrdersCreateLostFenceError('Claimed orders/create event did not retain a Shopify order identity.');
  }

  return {
    webhookEventId: ownership.id,
    processingGeneration: ownership.processingGeneration,
    sourceShopifyOrderId: ownership.sourceShopifyOrderId,
    signal,
  };
}

export async function heartbeatOrdersCreateOwnership(
  context: OrdersCreateFencedExecutionContext,
  leaseDurationMs = ORDERS_CREATE_PROCESSING_LEASE_MS,
) {
  const rows = await prisma.$queryRaw<Array<Pick<WebhookEvent, 'processingLeaseExpiresAt'>>>(Prisma.sql`
    UPDATE "WebhookEvent"
    SET "processingLeaseExpiresAt" = CURRENT_TIMESTAMP + (${leaseDurationMs} * INTERVAL '1 millisecond')
    WHERE "id" = ${context.webhookEventId}
      AND "topic" = 'orders/create'
      AND "status" = 'PROCESSING'
      AND "processingGeneration" = ${context.processingGeneration}
      AND "sourceShopifyOrderId" = ${context.sourceShopifyOrderId}
      AND "processingLeaseExpiresAt" IS NOT NULL
      AND "processingLeaseExpiresAt" > clock_timestamp()
    RETURNING "processingLeaseExpiresAt"
  `);

  if (!rows[0]?.processingLeaseExpiresAt) {
    throw new OrdersCreateLostFenceError('Shopify orders/create heartbeat rejected stale or expired ownership.');
  }

  return rows[0].processingLeaseExpiresAt;
}

export async function verifyOrdersCreateOwnership(context: OrdersCreateFencedExecutionContext) {
  const rows = await prisma.$queryRaw<OwnershipExistsRow[]>(Prisma.sql`
    SELECT EXISTS (
      SELECT 1
      FROM "WebhookEvent"
      WHERE "id" = ${context.webhookEventId}
        AND "topic" = 'orders/create'
        AND "status" = 'PROCESSING'
        AND "processingGeneration" = ${context.processingGeneration}
        AND "sourceShopifyOrderId" = ${context.sourceShopifyOrderId}
        AND "processingLeaseExpiresAt" IS NOT NULL
        AND "processingLeaseExpiresAt" > CURRENT_TIMESTAMP
    ) AS "owned"
  `);

  return rows[0]?.owned === true;
}

export async function assertOrdersCreateOwnership(context: OrdersCreateFencedExecutionContext) {
  if (!(await verifyOrdersCreateOwnership(context))) {
    throw new OrdersCreateLostFenceError();
  }
}

export async function finalizeRetryableOrdersCreateFailure(
  context: OrdersCreateFencedExecutionContext,
  error: unknown,
) {
  const message = sanitizeFailureMessage(error);
  const rows = await prisma.$queryRaw<OwnershipRow[]>(Prisma.sql`
    UPDATE "WebhookEvent"
    SET
      "status" = 'FAILED',
      "processingLeaseExpiresAt" = NULL,
      "executionAvailableAt" = CASE
        WHEN "executionAttemptCount" < "executionMaxAttempts"
          THEN CURRENT_TIMESTAMP + (
            (60000 * POWER(2, GREATEST("executionAttemptCount" - 1, 0))) * INTERVAL '1 millisecond'
          )
        ELSE NULL
      END,
      "errorMessage" = ${message}
    WHERE "id" = ${context.webhookEventId}
      AND "topic" = 'orders/create'
      AND "status" = 'PROCESSING'
      AND "processingGeneration" = ${context.processingGeneration}
      AND "sourceShopifyOrderId" = ${context.sourceShopifyOrderId}
      AND "processingLeaseExpiresAt" IS NOT NULL
      AND "processingLeaseExpiresAt" > CURRENT_TIMESTAMP
    RETURNING "id"
  `);

  if (!rows[0]) {
    throw new OrdersCreateLostFenceError('Stale orders/create owner cannot finalize a retryable failure.');
  }
}

export async function finalizeTerminalOrdersCreateFailure(
  context: OrdersCreateFencedExecutionContext,
  error: unknown,
) {
  const message = sanitizeFailureMessage(error);
  const rows = await prisma.$queryRaw<OwnershipRow[]>(Prisma.sql`
    UPDATE "WebhookEvent"
    SET
      "status" = 'FAILED',
      "processingLeaseExpiresAt" = NULL,
      "executionAvailableAt" = NULL,
      "errorMessage" = ${message}
    WHERE "id" = ${context.webhookEventId}
      AND "topic" = 'orders/create'
      AND "status" = 'PROCESSING'
      AND "processingGeneration" = ${context.processingGeneration}
      AND "sourceShopifyOrderId" = ${context.sourceShopifyOrderId}
      AND "processingLeaseExpiresAt" IS NOT NULL
      AND "processingLeaseExpiresAt" > CURRENT_TIMESTAMP
    RETURNING "id"
  `);

  if (!rows[0]) {
    throw new OrdersCreateLostFenceError('Stale orders/create owner cannot finalize a terminal failure.');
  }
}

export async function lockAndVerifyOrdersCreateOwnership(
  tx: Prisma.TransactionClient,
  context: OrdersCreateFencedExecutionContext,
) {
  await tx.$queryRaw(Prisma.sql`
    SELECT pg_advisory_xact_lock(hashtextextended(${context.sourceShopifyOrderId}, 0))
  `);

  const rows = await tx.$queryRaw<OwnershipRow[]>(Prisma.sql`
    SELECT "id"
    FROM "WebhookEvent"
    WHERE "id" = ${context.webhookEventId}
      AND "topic" = 'orders/create'
      AND "status" = 'PROCESSING'
      AND "processingGeneration" = ${context.processingGeneration}
      AND "sourceShopifyOrderId" = ${context.sourceShopifyOrderId}
      AND "processingLeaseExpiresAt" IS NOT NULL
      AND "processingLeaseExpiresAt" > clock_timestamp()
    FOR UPDATE
  `);

  if (!rows[0]) {
    throw new OrdersCreateLostFenceError();
  }
}

export async function finalizeFencedOrdersCreateSuccess(input: {
  tx: Prisma.TransactionClient;
  context: OrdersCreateFencedExecutionContext;
  shopifyOrderId: string;
}) {
  const updated = await input.tx.$executeRaw(Prisma.sql`
    UPDATE "WebhookEvent"
    SET
      "status" = 'PROCESSED',
      "processedAt" = clock_timestamp(),
      "errorMessage" = NULL,
      "shopifyOrderId" = ${input.shopifyOrderId},
      "processingLeaseExpiresAt" = NULL,
      "executionAvailableAt" = NULL
    WHERE "id" = ${input.context.webhookEventId}
      AND "topic" = 'orders/create'
      AND "status" = 'PROCESSING'
      AND "processingGeneration" = ${input.context.processingGeneration}
      AND "sourceShopifyOrderId" = ${input.context.sourceShopifyOrderId}
      AND "processingLeaseExpiresAt" IS NOT NULL
      AND "processingLeaseExpiresAt" > clock_timestamp()
  `);

  if (updated !== 1) {
    throw new OrdersCreateLostFenceError('Stale orders/create owner cannot commit successful processing.');
  }
}

export const __ordersCreateOwnershipTesting = {
  sanitizeFailureMessage,
};
