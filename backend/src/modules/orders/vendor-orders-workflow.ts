import type { Prisma } from '@prisma/client';
import { allocationActionableWhere } from './allocation-actionability-policy.service.js';
import { fullOrderOperationalAllocationWhere } from './full-order-cancellation-policy.js';
import type { VendorOrdersWorkflow } from './orders.types.js';

export const VENDOR_ORDERS_WORKFLOW_ERROR =
  'workflow must be all, awaitingShipment, shipmentReview, or trackingMissing.';

const NON_AWAITING_SHIPPING_STATUSES = [
  'delivered',
  'in transit',
  'in_transit',
  'shipped',
  'partially_shipped',
  'label created',
  'label_created',
] as const;

function insensitiveEquals(value: string) {
  return {
    equals: value,
    mode: 'insensitive' as const,
  };
}

export function resolveVendorOrdersWorkflow(query: unknown): VendorOrdersWorkflow {
  const rawWorkflow = (query as { workflow?: unknown } | undefined)?.workflow;
  if (rawWorkflow === undefined || rawWorkflow === null || rawWorkflow === '') {
    return 'all';
  }
  if (
    rawWorkflow !== 'all' &&
    rawWorkflow !== 'awaitingShipment' &&
    rawWorkflow !== 'shipmentReview' &&
    rawWorkflow !== 'trackingMissing'
  ) {
    throw new Error(VENDOR_ORDERS_WORKFLOW_ERROR);
  }
  return rawWorkflow;
}

export function buildVendorOrdersWorkflowWhere(
  vendorId: string,
  workflow: VendorOrdersWorkflow,
): Prisma.VendorAllocationWhereInput {
  const vendorScope = { assignedVendorId: vendorId };
  if (workflow === 'all') {
    return vendorScope;
  }

  const forwardScope = {
    ...vendorScope,
    ...fullOrderOperationalAllocationWhere,
    ...allocationActionableWhere,
  };

  if (workflow === 'trackingMissing') {
    return {
      ...forwardScope,
      AND: [
        { OR: [{ trackingNumber: null }, { trackingNumber: '' }] },
        { OR: [{ carrier: null }, { carrier: '' }] },
      ],
    };
  }

  return {
    ...forwardScope,
    NOT: NON_AWAITING_SHIPPING_STATUSES.map((status) => ({
      shippingStatus: insensitiveEquals(status),
    })),
  };
}
