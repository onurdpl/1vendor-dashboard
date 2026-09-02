import { CustomerCancellationStatus, OperationalJobStatus, type Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { acquireShopifyOrderTransactionLock } from '../shopify/orders-create-ownership.service.js';
import { createShopifyAdminService } from '../shopify/shopify-admin.service.js';

type ShopifyAdminService = ReturnType<typeof createShopifyAdminService>;

export const CUSTOMER_CANCELLATION_ORDER_CANCEL_DEFAULT_NOTIFY_CUSTOMER = false;
export const CUSTOMER_CANCELLATION_ORDER_CANCEL_STAFF_NOTE =
  'Customer cancellation: product refund verified; cancelling order without additional refund.';

export type CustomerCancellationOrderCancelOutcome =
  | 'APPROVED'
  | 'ALREADY_CANCELLED_APPROVED'
  | 'AWAITING_JOB'
  | 'RETRYABLE'
  | 'TERMINAL_EXCEPTION'
  | 'SKIPPED';

export type CustomerCancellationOrderCancelResult = {
  outcome: CustomerCancellationOrderCancelOutcome;
  jobId: string | null;
  jobCompleted: boolean;
  orderCancelled: boolean;
  mutationAttempted: boolean;
  userErrors: Array<{ field: string[]; message: string; code?: string | null }>;
  reason: string;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function readObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readPersistedOrderCancelJobId(value: unknown) {
  const root = readObject(value);
  const orderCancel = readObject(root.orderCancel);
  const jobId = orderCancel.jobId;
  return typeof jobId === 'string' && jobId.trim() ? jobId.trim() : null;
}

function mergeOrderCancelEvidence(input: {
  existing: unknown;
  orderCancel: Record<string, unknown>;
}) {
  return {
    ...readObject(input.existing),
    orderCancel: {
      ...readObject(readObject(input.existing).orderCancel),
      ...input.orderCancel,
      updatedAt: new Date().toISOString(),
    },
  };
}

async function persistOrderCancelEvidence(input: {
  itemId: string;
  evidence: Record<string, unknown>;
}) {
  const attempt = await prisma.outboundShopifyRefundAttempt.findUnique({
    where: { customerCancellationRequestItemId: input.itemId },
    select: { id: true, mutationResponseJson: true },
  });
  if (!attempt) return;
  await prisma.outboundShopifyRefundAttempt.update({
    where: { id: attempt.id },
    data: {
      mutationResponseJson: json(
        mergeOrderCancelEvidence({
          existing: attempt.mutationResponseJson,
          orderCancel: input.evidence,
        }),
      ),
    },
  });
}

async function finalizeApproved(input: {
  itemId: string;
  sourceShopifyOrderId: string;
  reason: string;
}) {
  await prisma.$transaction(async (tx) => {
    await acquireShopifyOrderTransactionLock(tx, input.sourceShopifyOrderId);
    const current = await tx.customerCancellationRequestItem.findUnique({
      where: { id: input.itemId },
      include: {
        request: {
          include: {
            items: { select: { id: true, status: true } },
          },
        },
      },
    });
    if (!current || current.status === CustomerCancellationStatus.APPROVED) return;
    if (current.status !== CustomerCancellationStatus.REFUNDED_AWAITING_ORDER_CANCEL) return;
    await tx.customerCancellationRequestItem.update({
      where: { id: current.id },
      data: {
        status: CustomerCancellationStatus.APPROVED,
        resolvedQuantity: current.resolvedQuantity ?? current.requestedQuantity,
      },
    });
    const statuses = current.request.items.map((candidate) =>
      candidate.id === current.id ? CustomerCancellationStatus.APPROVED : candidate.status,
    );
    const parentStatus = new Set(statuses).size === 1 ? statuses[0]! : CustomerCancellationStatus.PARTIALLY_RESOLVED;
    const allTerminal = statuses.every((status) =>
      status !== CustomerCancellationStatus.PENDING &&
      status !== CustomerCancellationStatus.APPROVED_FOR_REFUND &&
      status !== CustomerCancellationStatus.REFUNDED_AWAITING_ORDER_CANCEL &&
      status !== CustomerCancellationStatus.PARTIALLY_RESOLVED,
    );
    await tx.customerCancellationRequest.update({
      where: { id: current.requestId },
      data: {
        status: parentStatus,
        resolvedAt: allTerminal ? new Date() : null,
      },
    });
    await tx.operationalJob.updateMany({
      where: { customerCancellationRequestItemId: current.id },
      data: {
        status: OperationalJobStatus.COMPLETED,
        completedAt: new Date(),
        processingLeaseExpiresAt: null,
        errorSummary: null,
        escalationReason: null,
        payload: {
          authority: 'CUSTOMER_CANCELLATION_REQUEST_ITEM',
          requestId: current.requestId,
          orderCancel: {
            status: 'CONFIRMED',
            reason: input.reason,
            confirmedAt: new Date().toISOString(),
          },
        },
      },
    });
  });
}

async function pollJob(input: {
  shopifyAdminService: ShopifyAdminService;
  jobId: string;
  timeoutMs: number;
  intervalMs: number;
}) {
  const deadline = Date.now() + input.timeoutMs;
  let lastDone = false;
  do {
    const job = await input.shopifyAdminService.fetchJobStatus(input.jobId);
    lastDone = job.done;
    if (job.done) return true;
    if (Date.now() >= deadline) break;
    await sleep(Math.min(input.intervalMs, Math.max(0, deadline - Date.now())));
  } while (Date.now() <= deadline);
  return lastDone;
}

export async function submitAndConfirmCustomerCancellationShopifyOrderCancel(input: {
  sourceShopifyOrderId: string;
  shopifyAdminService: ShopifyAdminService;
  existingJobId?: string | null;
  timeoutMs?: number;
  intervalMs?: number;
  persistEvidence?: (evidence: Record<string, unknown>) => Promise<void>;
}): Promise<CustomerCancellationOrderCancelResult> {
  const before = await input.shopifyAdminService.fetchCustomerCancellationOrderSnapshot(input.sourceShopifyOrderId);
  if (!before) {
    return { outcome: 'RETRYABLE', jobId: null, jobCompleted: false, orderCancelled: false, mutationAttempted: false, userErrors: [], reason: 'canonical_order_unavailable_before_cancel' };
  }
  if (before.cancelledAt) {
    return { outcome: 'ALREADY_CANCELLED_APPROVED', jobId: input.existingJobId ?? null, jobCompleted: true, orderCancelled: true, mutationAttempted: false, userErrors: [], reason: 'already_canonically_cancelled' };
  }

  let jobId = input.existingJobId?.trim() || null;
  let mutationAttempted = false;
  if (!jobId) {
    const mutation = await input.shopifyAdminService.cancelOrder({
      orderId: input.sourceShopifyOrderId,
      notifyCustomer: CUSTOMER_CANCELLATION_ORDER_CANCEL_DEFAULT_NOTIFY_CUSTOMER,
      staffNote: CUSTOMER_CANCELLATION_ORDER_CANCEL_STAFF_NOTE,
    });
    mutationAttempted = true;
    jobId = mutation.jobId;
    await input.persistEvidence?.({
      mutationAttempted: true,
      jobId,
      jobDone: mutation.jobDone,
      orderCancelUserErrors: mutation.orderCancelUserErrors,
      userErrors: mutation.userErrors,
      restock: false,
      refundMethod: { originalPaymentMethodsRefund: false },
      notifyCustomer: CUSTOMER_CANCELLATION_ORDER_CANCEL_DEFAULT_NOTIFY_CUSTOMER,
    });
    const userErrors = [...mutation.orderCancelUserErrors, ...mutation.userErrors];
    if (userErrors.length) {
      return { outcome: 'TERMINAL_EXCEPTION', jobId, jobCompleted: false, orderCancelled: false, mutationAttempted, userErrors, reason: 'shopify_order_cancel_user_errors' };
    }
    if (!jobId) {
      return { outcome: 'RETRYABLE', jobId: null, jobCompleted: false, orderCancelled: false, mutationAttempted, userErrors: [], reason: 'shopify_order_cancel_job_missing' };
    }
  }

  let jobCompleted = false;
  try {
    jobCompleted = await pollJob({
      shopifyAdminService: input.shopifyAdminService,
      jobId,
      timeoutMs: input.timeoutMs ?? 30_000,
      intervalMs: input.intervalMs ?? 1_000,
    });
  } catch (error) {
    await input.persistEvidence?.({
      jobId,
      jobStatusError: error instanceof Error ? error.message : String(error),
    });
    return { outcome: 'RETRYABLE', jobId, jobCompleted: false, orderCancelled: false, mutationAttempted, userErrors: [], reason: 'shopify_order_cancel_job_status_unavailable' };
  }
  await input.persistEvidence?.({
    jobId,
    jobDone: jobCompleted,
    restock: false,
    refundMethod: { originalPaymentMethodsRefund: false },
  });
  if (!jobCompleted) {
    return { outcome: 'AWAITING_JOB', jobId, jobCompleted: false, orderCancelled: false, mutationAttempted, userErrors: [], reason: 'shopify_order_cancel_job_timeout' };
  }

  const after = await input.shopifyAdminService.fetchCustomerCancellationOrderSnapshot(input.sourceShopifyOrderId);
  if (!after) {
    return { outcome: 'RETRYABLE', jobId, jobCompleted: true, orderCancelled: false, mutationAttempted, userErrors: [], reason: 'canonical_order_unavailable_after_cancel' };
  }
  if (!after.cancelledAt) {
    return { outcome: 'TERMINAL_EXCEPTION', jobId, jobCompleted: true, orderCancelled: false, mutationAttempted, userErrors: [], reason: 'job_completed_but_order_not_cancelled' };
  }

  await input.persistEvidence?.({
      jobId,
      jobDone: true,
      canonicalCancelledAt: after.cancelledAt,
      restock: false,
      refundMethod: { originalPaymentMethodsRefund: false },
    });
  return { outcome: 'APPROVED', jobId, jobCompleted: true, orderCancelled: true, mutationAttempted, userErrors: [], reason: 'canonical_order_cancelled_after_job' };
}

export async function processCustomerCancellationOrderCancel(input: {
  itemId: string;
  shopifyAdminService: ShopifyAdminService;
  timeoutMs?: number;
  intervalMs?: number;
}): Promise<CustomerCancellationOrderCancelResult> {
  const item = await prisma.customerCancellationRequestItem.findUnique({
    where: { id: input.itemId },
    include: {
      request: {
        include: {
          order: { select: { sourceShopifyOrderId: true } },
        },
      },
      outboundShopifyRefundAttempt: { select: { mutationResponseJson: true } },
    },
  });
  if (!item) {
    return { outcome: 'SKIPPED', jobId: null, jobCompleted: false, orderCancelled: false, mutationAttempted: false, userErrors: [], reason: 'item_not_found' };
  }
  if (item.status === CustomerCancellationStatus.APPROVED) {
    return { outcome: 'APPROVED', jobId: null, jobCompleted: true, orderCancelled: true, mutationAttempted: false, userErrors: [], reason: 'already_locally_approved' };
  }
  if (item.status !== CustomerCancellationStatus.REFUNDED_AWAITING_ORDER_CANCEL) {
    return { outcome: 'SKIPPED', jobId: null, jobCompleted: false, orderCancelled: false, mutationAttempted: false, userErrors: [], reason: 'item_not_refunded_awaiting_order_cancel' };
  }

  const sourceShopifyOrderId = item.request.order.sourceShopifyOrderId;
  const result = await submitAndConfirmCustomerCancellationShopifyOrderCancel({
    sourceShopifyOrderId,
    shopifyAdminService: input.shopifyAdminService,
    existingJobId: readPersistedOrderCancelJobId(item.outboundShopifyRefundAttempt?.mutationResponseJson),
    timeoutMs: input.timeoutMs,
    intervalMs: input.intervalMs,
    persistEvidence: (evidence) => persistOrderCancelEvidence({ itemId: item.id, evidence }),
  });
  if (result.orderCancelled) {
    await finalizeApproved({ itemId: item.id, sourceShopifyOrderId, reason: result.reason });
  }
  return result;
}
