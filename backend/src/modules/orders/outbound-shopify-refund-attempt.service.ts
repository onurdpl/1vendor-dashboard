import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import type { FulfillmentOrderCancellationClassificationResult } from '../shopify/shopify-fulfillment-order-cancel-classifier.service.js';

export const OUTBOUND_SHOPIFY_REFUND_ATTEMPT_STATUSES = {
  PREVIEWED: 'PREVIEWED',
  READY_TO_SUBMIT: 'READY_TO_SUBMIT',
  SHOPIFY_ACTION_PENDING: 'SHOPIFY_ACTION_PENDING',
  RESOLVED: 'RESOLVED',
  FAILED: 'FAILED',
} as const;

export type OutboundShopifyRefundAttemptStatus =
  (typeof OUTBOUND_SHOPIFY_REFUND_ATTEMPT_STATUSES)[keyof typeof OUTBOUND_SHOPIFY_REFUND_ATTEMPT_STATUSES];

export type OutboundShopifyRefundAttemptSummary = {
  id: string;
  status: string;
  restockType: string;
  refundShipping: boolean;
  notifyCustomer: boolean;
  shopifyRefundId: string | null;
  previewedAt: string | null;
  requestedAt: string;
  submittedAt: string | null;
  resolvedAt: string | null;
  failedAt: string | null;
  failureReason: string | null;
  postRefundFulfillmentCheckStatus: string | null;
  postRefundFulfillmentCheckMessage: string | null;
};

export type CreatePreviewAttemptInput = {
  vendorAllocationId: string;
  shopifyOrderId: string;
  restockType: string;
  refundShipping: boolean;
  notifyCustomer?: boolean;
  note?: string | null;
  requestedByUserId?: string | null;
  refundLineItems: Array<{
    lineItemId: string;
    quantity: number;
    restockType: string;
  }>;
  suggestedTransactions: Array<{
    gateway: string | null;
    amount: string | null;
    currencyCode: string | null;
    parentTransactionId: string | null;
  }>;
  fulfillmentOrderCancellation: FulfillmentOrderCancellationClassificationResult;
  blockers: string[];
  warnings: string[];
};

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function toInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export function buildOutboundShopifyRefundPreviewHash(input: {
  vendorAllocationId: string;
  shopifyOrderId: string;
  restockType: string;
  refundShipping: boolean;
  notifyCustomer: boolean;
  refundLineItems: unknown;
  suggestedTransactions: unknown;
  fulfillmentOrderCancellation: unknown;
  blockers: unknown;
  warnings: unknown;
}) {
  return createHash('sha256').update(stableJson(input)).digest('hex');
}

export function mapOutboundShopifyRefundAttemptSummary(attempt: {
  id: string;
  status: string;
  restockType: string;
  refundShipping: boolean;
  notifyCustomer: boolean;
  shopifyRefundId?: string | null;
  previewedAt: Date | null;
  requestedAt: Date;
  submittedAt: Date | null;
  resolvedAt: Date | null;
  failedAt: Date | null;
  failureReason: string | null;
  mutationResponseJson?: unknown;
}): OutboundShopifyRefundAttemptSummary {
  const mutationResponse =
    typeof attempt.mutationResponseJson === 'object' && attempt.mutationResponseJson !== null
      ? (attempt.mutationResponseJson as Record<string, unknown>)
      : null;
  const postRefundFulfillmentCheck =
    typeof mutationResponse?.postRefundFulfillmentCheck === 'object' && mutationResponse.postRefundFulfillmentCheck !== null
      ? (mutationResponse.postRefundFulfillmentCheck as Record<string, unknown>)
      : null;
  const postRefundFulfillmentCheckStatus =
    typeof postRefundFulfillmentCheck?.status === 'string' ? postRefundFulfillmentCheck.status : null;
  const postRefundFulfillmentCheckMessage =
    typeof postRefundFulfillmentCheck?.message === 'string' ? postRefundFulfillmentCheck.message : null;

  return {
    id: attempt.id,
    status: attempt.status,
    restockType: attempt.restockType,
    refundShipping: attempt.refundShipping,
    notifyCustomer: attempt.notifyCustomer,
    shopifyRefundId: attempt.shopifyRefundId ?? null,
    previewedAt: attempt.previewedAt?.toISOString() ?? null,
    requestedAt: attempt.requestedAt.toISOString(),
    submittedAt: attempt.submittedAt?.toISOString() ?? null,
    resolvedAt: attempt.resolvedAt?.toISOString() ?? null,
    failedAt: attempt.failedAt?.toISOString() ?? null,
    failureReason: attempt.failureReason,
    postRefundFulfillmentCheckStatus,
    postRefundFulfillmentCheckMessage,
  };
}

export async function findOpenOutboundShopifyRefundAttemptForAllocation(vendorAllocationId: string) {
  return prisma.outboundShopifyRefundAttempt.findFirst({
    where: {
      vendorAllocationId,
      status: OUTBOUND_SHOPIFY_REFUND_ATTEMPT_STATUSES.SHOPIFY_ACTION_PENDING,
    },
    orderBy: {
      requestedAt: 'desc',
    },
  });
}

export async function findActiveOutboundShopifyRefundAttemptForAllocation(vendorAllocationId: string) {
  return prisma.outboundShopifyRefundAttempt.findFirst({
    where: {
      vendorAllocationId,
      status: {
        in: [
          OUTBOUND_SHOPIFY_REFUND_ATTEMPT_STATUSES.READY_TO_SUBMIT,
          OUTBOUND_SHOPIFY_REFUND_ATTEMPT_STATUSES.SHOPIFY_ACTION_PENDING,
        ],
      },
    },
    orderBy: {
      requestedAt: 'desc',
    },
  });
}

export async function createPreviewOutboundShopifyRefundAttempt(input: CreatePreviewAttemptInput) {
  const now = new Date();
  const notifyCustomer = input.notifyCustomer ?? false;
  const previewHash = buildOutboundShopifyRefundPreviewHash({
    vendorAllocationId: input.vendorAllocationId,
    shopifyOrderId: input.shopifyOrderId,
    restockType: input.restockType,
    refundShipping: input.refundShipping,
    notifyCustomer,
    refundLineItems: input.refundLineItems,
    suggestedTransactions: input.suggestedTransactions,
    fulfillmentOrderCancellation: input.fulfillmentOrderCancellation,
    blockers: input.blockers,
    warnings: input.warnings,
  });
  const data = {
    shopifyOrderId: input.shopifyOrderId,
    status: OUTBOUND_SHOPIFY_REFUND_ATTEMPT_STATUSES.PREVIEWED,
    restockType: input.restockType,
    refundShipping: input.refundShipping,
    notifyCustomer,
    note: input.note?.trim() || null,
    requestedByUserId: input.requestedByUserId ?? null,
    requestedAt: now,
    refundLineItemsJson: toInputJson(input.refundLineItems),
    suggestedTransactionsJson: toInputJson(input.suggestedTransactions),
    fulfillmentOrderCancellationJson: toInputJson(input.fulfillmentOrderCancellation),
    blockersJson: toInputJson(input.blockers),
    warningsJson: toInputJson(input.warnings),
    previewHash,
    previewedAt: now,
  };

  const existingPreview = await prisma.outboundShopifyRefundAttempt.findFirst({
    where: {
      vendorAllocationId: input.vendorAllocationId,
      status: OUTBOUND_SHOPIFY_REFUND_ATTEMPT_STATUSES.PREVIEWED,
    },
    orderBy: {
      requestedAt: 'desc',
    },
  });

  if (existingPreview) {
    return prisma.outboundShopifyRefundAttempt.update({
      where: {
        id: existingPreview.id,
      },
      data,
    });
  }

  return prisma.outboundShopifyRefundAttempt.create({
    data: {
      vendorAllocationId: input.vendorAllocationId,
      ...data,
    },
  });
}

export async function createOrLockOutboundShopifyRefundExecutionAttempt(input: CreatePreviewAttemptInput) {
  const now = new Date();
  const notifyCustomer = input.notifyCustomer ?? false;
  const previewHash = buildOutboundShopifyRefundPreviewHash({
    vendorAllocationId: input.vendorAllocationId,
    shopifyOrderId: input.shopifyOrderId,
    restockType: input.restockType,
    refundShipping: input.refundShipping,
    notifyCustomer,
    refundLineItems: input.refundLineItems,
    suggestedTransactions: input.suggestedTransactions,
    fulfillmentOrderCancellation: input.fulfillmentOrderCancellation,
    blockers: input.blockers,
    warnings: input.warnings,
  });
  const data = {
    shopifyOrderId: input.shopifyOrderId,
    status: OUTBOUND_SHOPIFY_REFUND_ATTEMPT_STATUSES.READY_TO_SUBMIT,
    restockType: input.restockType,
    refundShipping: input.refundShipping,
    notifyCustomer,
    note: input.note?.trim() || null,
    requestedByUserId: input.requestedByUserId ?? null,
    requestedAt: now,
    refundLineItemsJson: toInputJson(input.refundLineItems),
    suggestedTransactionsJson: toInputJson(input.suggestedTransactions),
    fulfillmentOrderCancellationJson: toInputJson(input.fulfillmentOrderCancellation),
    blockersJson: toInputJson(input.blockers),
    warningsJson: toInputJson(input.warnings),
    previewHash,
    previewedAt: now,
    submittedAt: null,
    resolvedAt: null,
    failedAt: null,
    failureReason: null,
    shopifyRefundId: null,
    shopifyUserErrorsJson: undefined,
    mutationResponseJson: undefined,
  };

  const existingPreview = await prisma.outboundShopifyRefundAttempt.findFirst({
    where: {
      vendorAllocationId: input.vendorAllocationId,
      status: OUTBOUND_SHOPIFY_REFUND_ATTEMPT_STATUSES.PREVIEWED,
    },
    orderBy: {
      requestedAt: 'desc',
    },
  });

  if (existingPreview) {
    return prisma.outboundShopifyRefundAttempt.update({
      where: {
        id: existingPreview.id,
      },
      data,
    });
  }

  return prisma.outboundShopifyRefundAttempt.create({
    data: {
      vendorAllocationId: input.vendorAllocationId,
      ...data,
    },
  });
}

export async function markOutboundShopifyRefundAttemptFailed(input: {
  attemptId: string;
  failureReason: string;
  shopifyUserErrors?: unknown;
  mutationResponse?: unknown;
  fulfillmentOrderCancellation?: unknown;
  blockers?: unknown;
  warnings?: unknown;
}) {
  return prisma.outboundShopifyRefundAttempt.update({
    where: {
      id: input.attemptId,
    },
    data: {
      status: OUTBOUND_SHOPIFY_REFUND_ATTEMPT_STATUSES.FAILED,
      failedAt: new Date(),
      failureReason: input.failureReason,
      shopifyUserErrorsJson: input.shopifyUserErrors === undefined ? undefined : toInputJson(input.shopifyUserErrors),
      mutationResponseJson: input.mutationResponse === undefined ? undefined : toInputJson(input.mutationResponse),
      fulfillmentOrderCancellationJson:
        input.fulfillmentOrderCancellation === undefined ? undefined : toInputJson(input.fulfillmentOrderCancellation),
      blockersJson: input.blockers === undefined ? undefined : toInputJson(input.blockers),
      warningsJson: input.warnings === undefined ? undefined : toInputJson(input.warnings),
    },
  });
}

export async function markOutboundShopifyRefundAttemptSubmitted(input: {
  attemptId: string;
  shopifyRefundId: string | null;
  mutationResponse: unknown;
  fulfillmentOrderCancellation?: unknown;
  suggestedTransactions?: unknown;
  blockers?: unknown;
  warnings?: unknown;
}) {
  return prisma.outboundShopifyRefundAttempt.update({
    where: {
      id: input.attemptId,
    },
    data: {
      status: OUTBOUND_SHOPIFY_REFUND_ATTEMPT_STATUSES.SHOPIFY_ACTION_PENDING,
      submittedAt: new Date(),
      shopifyRefundId: input.shopifyRefundId,
      mutationResponseJson: toInputJson(input.mutationResponse),
      fulfillmentOrderCancellationJson:
        input.fulfillmentOrderCancellation === undefined ? undefined : toInputJson(input.fulfillmentOrderCancellation),
      suggestedTransactionsJson: input.suggestedTransactions === undefined ? undefined : toInputJson(input.suggestedTransactions),
      blockersJson: input.blockers === undefined ? undefined : toInputJson(input.blockers),
      warningsJson: input.warnings === undefined ? undefined : toInputJson(input.warnings),
    },
  });
}
