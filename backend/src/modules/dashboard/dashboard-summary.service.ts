import { AllocationStatus } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { withDashboardTiming } from '../../lib/dashboard-timing.js';
import { buildReturnReviewAttentionWhere } from '../returns/return-review-status.js';
import type { DashboardOperationalSummaryDto } from './dashboard-summary.types.js';
import { fullOrderOperationalAllocationWhere } from '../orders/full-order-cancellation-policy.js';

const NON_AWAITING_SHIPPING_STATUSES = [
  'delivered',
  'in transit',
  'in_transit',
  'shipped',
  'partially_shipped',
  'label created',
  'label_created',
];

function insensitiveEquals(value: string) {
  return {
    equals: value,
    mode: 'insensitive' as const,
  };
}

function readAllocationStatusCount(
  groups: Array<{ allocationStatus: AllocationStatus; _count: { _all: number } }>,
  status: AllocationStatus,
) {
  return groups.find((group) => group.allocationStatus === status)?._count._all ?? 0;
}

export async function getDashboardOperationalSummary(vendorId: string): Promise<DashboardOperationalSummaryDto> {
  const [totalAllocations, allocationStatusGroups, awaitingShipment, refundAttention] = await Promise.all([
    withDashboardTiming('dashboard.summary.total_allocations_count', () =>
      prisma.vendorAllocation.count({
        where: {
          assignedVendorId: vendorId,
        },
      }),
    ),
    withDashboardTiming('dashboard.summary.allocation_status_group_count', () =>
      prisma.vendorAllocation.groupBy({
        by: ['allocationStatus'],
        where: {
          assignedVendorId: vendorId,
        },
        _count: {
          _all: true,
        },
      }),
    ),
    withDashboardTiming('dashboard.summary.awaiting_shipment_count', () =>
      prisma.vendorAllocation.count({
        where: {
          assignedVendorId: vendorId,
          ...fullOrderOperationalAllocationWhere,
          NOT: NON_AWAITING_SHIPPING_STATUSES.map((status) => ({
            shippingStatus: insensitiveEquals(status),
          })),
        },
      }),
    ),
    withDashboardTiming('dashboard.summary.return_refund_attention_count', () =>
      prisma.returnRecord.count({
        where: {
          vendorAllocation: {
            assignedVendorId: vendorId,
          },
          ...buildReturnReviewAttentionWhere(),
        },
      }),
    ),
  ]);

  const pendingReassignment = readAllocationStatusCount(allocationStatusGroups, AllocationStatus.PENDING_REASSIGNMENT);
  const vendorBlocked = readAllocationStatusCount(allocationStatusGroups, AllocationStatus.VENDOR_BLOCKED);

  return {
    vendorId,
    orders: {
      total: totalAllocations,
      awaitingShipment,
      blocked: pendingReassignment + vendorBlocked,
      pendingReassignment,
      vendorBlocked,
    },
    returns: {
      refundAttention,
    },
  };
}
