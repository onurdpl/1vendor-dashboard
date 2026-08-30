import { CustomerCancellationStatus, ShipmentExecutionStatus } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import {
  classifyCustomerCancellationException,
  readPostRefundFulfillmentCheckStatus,
} from '../orders/customer-cancellation-exception.service.js';
import { isPendingCustomerCancellationHoldState } from '../orders/customer-cancellation-hold.service.js';
import { FINANCE_INTEGRITY_ALERT_BLOCKING_STATUSES } from '../finance/finance-integrity-alert.service.js';
import type { OperationsQueueDashboardDto, OperationsQueueItemDto } from './operations.types.js';

const CANDIDATE_STATUSES = [
  CustomerCancellationStatus.PENDING,
  CustomerCancellationStatus.APPROVED_FOR_REFUND,
  CustomerCancellationStatus.TOO_LATE,
  CustomerCancellationStatus.CONFLICTED,
] as const;

async function loadCandidates() {
  return prisma.customerCancellationRequestItem.findMany({
    where: { status: { in: [...CANDIDATE_STATUSES] } },
    select: {
      id: true,
      status: true,
      requestedQuantity: true,
      resolvedQuantity: true,
      request: {
        select: {
          id: true,
          status: true,
          reasonCode: true,
          requestedAt: true,
          order: {
            select: {
              sourceShopifyOrderId: true,
              sourceShopifyOrderNumber: true,
            },
          },
        },
      },
      shopifyOrderLineItem: { select: { sku: true, title: true } },
      vendorAllocation: {
        select: {
          id: true,
          assignedVendorId: true,
          assignedVendor: { select: { name: true } },
          trackingNumber: true,
          fulfillment: { select: { id: true } },
          shipmentExecutions: {
            where: { shipmentStatus: { notIn: [ShipmentExecutionStatus.FAILED, ShipmentExecutionStatus.CANCELLED] } },
            select: { id: true },
            take: 1,
          },
          financeIntegrityAlerts: {
            where: {
              status: { in: [...FINANCE_INTEGRITY_ALERT_BLOCKING_STATUSES] },
              severity: { in: ['critical', 'warning'] },
            },
            select: { id: true },
            take: 1,
          },
        },
      },
      outboundShopifyRefundAttempt: {
        select: { status: true, mutationResponseJson: true },
      },
      operationalJob: {
        select: {
          status: true,
          retryCount: true,
          maxRetries: true,
          failureCategory: true,
          errorSummary: true,
        },
      },
    },
    orderBy: [{ request: { requestedAt: 'desc' } }, { id: 'asc' }],
  });
}

type Candidate = Awaited<ReturnType<typeof loadCandidates>>[number];

function mapCandidate(candidate: Candidate): OperationsQueueItemDto | null {
  const shipmentAuthorityExists = Boolean(
    candidate.vendorAllocation.fulfillment ||
      candidate.vendorAllocation.trackingNumber ||
      candidate.vendorAllocation.shipmentExecutions.length,
  );
  const reason = classifyCustomerCancellationException({
    itemStatus: candidate.status,
    attemptStatus: candidate.outboundShopifyRefundAttempt?.status,
    postRefundCheckStatus: readPostRefundFulfillmentCheckStatus(
      candidate.outboundShopifyRefundAttempt?.mutationResponseJson,
    ),
    jobStatus: candidate.operationalJob?.status,
    jobRetryCount: candidate.operationalJob?.retryCount,
    jobMaxRetries: candidate.operationalJob?.maxRetries,
    jobFailureCategory: candidate.operationalJob?.failureCategory,
    jobErrorSummary: candidate.operationalJob?.errorSummary,
    shipmentAuthorityExists,
    financeConflictExists: candidate.vendorAllocation.financeIntegrityAlerts.length > 0,
  });
  if (!reason) return null;

  const holdActive = isPendingCustomerCancellationHoldState({
    requestStatus: candidate.request.status,
    itemStatus: candidate.status,
  });
  const order = candidate.request.order;
  return {
    id: `customer-cancellation-exception-${candidate.id}`,
    type: 'customer_cancellation_exception',
    severity: 'warning',
    title: 'Customer cancellation exception',
    description: `${candidate.shopifyOrderLineItem.title ?? candidate.shopifyOrderLineItem.sku ?? 'Order item'} requires Admin review.`,
    vendorId: candidate.vendorAllocation.assignedVendorId,
    vendorName: candidate.vendorAllocation.assignedVendor.name,
    relatedOrderId: candidate.vendorAllocation.id,
    relatedShopifyOrderId: order.sourceShopifyOrderId,
    relatedShopifyOrderNumber: order.sourceShopifyOrderNumber,
    relatedReturnId: null,
    relatedRefundId: null,
    status: candidate.status,
    createdAt: candidate.request.requestedAt.toISOString(),
    actionLabel: 'Open order',
    destinationPath: `/admin/orders/${order.sourceShopifyOrderId}`,
    vendorAllocationId: candidate.vendorAllocation.id,
    customerCancellationRequestId: candidate.request.id,
    customerCancellationItemId: candidate.id,
    customerCancellationReason: candidate.request.reasonCode,
    customerCancellationItemStatus: candidate.status,
    customerCancellationExceptionReason: reason,
    requestedQuantity: candidate.requestedQuantity,
    resolvedQuantity: candidate.resolvedQuantity,
    itemSku: candidate.shopifyOrderLineItem.sku,
    itemTitle: candidate.shopifyOrderLineItem.title,
    requestedAt: candidate.request.requestedAt.toISOString(),
    refundAttemptStatus: candidate.outboundShopifyRefundAttempt?.status ?? null,
    operationalJobStatus: candidate.operationalJob?.status ?? null,
    shipmentHoldActive: holdActive,
    financeHoldActive: holdActive,
  };
}

export async function listCustomerCancellationExceptionQueueItems() {
  return (await loadCandidates())
    .map(mapCandidate)
    .filter((item): item is OperationsQueueItemDto => item !== null);
}

export async function getCustomerCancellationExceptionOperationsQueue(options: {
  limit: number;
  offset: number;
}): Promise<OperationsQueueDashboardDto> {
  const items = await listCustomerCancellationExceptionQueueItems();
  const total = items.length;
  return {
    summary: {
      total,
      critical: 0,
      warning: total,
      attention: 0,
      normal: 0,
      pendingReassignment: 0,
      vendorBlocked: 0,
      awaitingShipment: 0,
      refundAttention: 0,
      financeReview: 0,
      financeIntegrityAlerts: 0,
      customerCancellationExceptions: total,
      operationalSignals: 0,
      automationActions: 0,
    },
    items: items.slice(options.offset, options.offset + options.limit),
  };
}
