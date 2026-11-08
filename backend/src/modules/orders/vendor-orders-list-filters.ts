import { AllocationStatus, type Prisma } from '@prisma/client';
import type { OrderSummaryDto, VendorOrdersWorkflow } from './orders.types.js';
import { buildVendorOrdersWorkflowWhere } from './vendor-orders-workflow.js';

export type VendorOrdersListFilters = {
  allocationStatus?: 'active' | 'pending_reassignment' | 'vendor_blocked' | 'fulfilled';
  fulfillmentStatus?: 'Pending' | 'Processing' | 'Partially Fulfilled' | 'Fulfilled';
  shippingStatus?: 'Awaiting Shipment' | 'Label Created' | 'In Transit' | 'Delivered';
  blocked?: boolean;
  trackingMissing?: boolean;
};

const ALLOCATION_STATES = ['active', 'pending_reassignment', 'vendor_blocked', 'fulfilled'] as const;
const FULFILLMENT_STATES = ['Pending', 'Processing', 'Partially Fulfilled', 'Fulfilled'] as const;
const SHIPPING_STATES = ['Awaiting Shipment', 'Label Created', 'In Transit', 'Delivered'] as const;

function readChoice<T extends string>(query: Record<string, unknown>, name: string, choices: readonly T[]): T | undefined {
  const value = query[name];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !choices.includes(value as T)) {
    throw new Error(`${name} must be one of: ${choices.join(', ')}.`);
  }
  return value as T;
}

function readBoolean(query: Record<string, unknown>, name: string): boolean | undefined {
  const value = query[name];
  if (value === undefined) return undefined;
  if (value !== 'true' && value !== 'false') throw new Error(`${name} must be true or false.`);
  return value === 'true';
}

export function parseVendorOrdersListFilters(query: unknown): VendorOrdersListFilters {
  const source = query && typeof query === 'object' ? query as Record<string, unknown> : {};
  const allocationStatus = readChoice(source, 'allocationStatus', ALLOCATION_STATES);
  const fulfillmentStatus = readChoice(source, 'fulfillmentStatus', FULFILLMENT_STATES);
  const shippingStatus = readChoice(source, 'shippingStatus', SHIPPING_STATES);
  const blocked = readBoolean(source, 'blocked');
  const trackingMissing = readBoolean(source, 'trackingMissing');
  return {
    ...(allocationStatus ? { allocationStatus } : {}),
    ...(fulfillmentStatus ? { fulfillmentStatus } : {}),
    ...(shippingStatus ? { shippingStatus } : {}),
    ...(blocked !== undefined ? { blocked } : {}),
    ...(trackingMissing !== undefined ? { trackingMissing } : {}),
  };
}

const DB_ALLOCATION_STATES = {
  active: AllocationStatus.ACTIVE,
  pending_reassignment: AllocationStatus.PENDING_REASSIGNMENT,
  vendor_blocked: AllocationStatus.VENDOR_BLOCKED,
  fulfilled: AllocationStatus.FULFILLED,
} as const;

export function buildVendorOrdersListWhere(
  vendorId: string,
  workflow: VendorOrdersWorkflow,
  filters: VendorOrdersListFilters,
): Prisma.VendorAllocationWhereInput {
  const predicates: Prisma.VendorAllocationWhereInput[] = [buildVendorOrdersWorkflowWhere(vendorId, workflow)];
  if (filters.allocationStatus) {
    predicates.push({ allocationStatus: DB_ALLOCATION_STATES[filters.allocationStatus] });
  }
  if (filters.blocked) {
    predicates.push({
      allocationStatus: { in: [AllocationStatus.VENDOR_BLOCKED, AllocationStatus.PENDING_REASSIGNMENT] },
      order: { is: { cancelledAt: null } },
    });
  }
  if (filters.trackingMissing) {
    predicates.push(buildVendorOrdersWorkflowWhere(vendorId, 'trackingMissing'));
  }
  return predicates.length === 1 ? predicates[0] : { AND: predicates };
}

function normalizeFulfillment(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'fulfilled') return 'Fulfilled';
  if (normalized === 'partially fulfilled' || normalized === 'partially_fulfilled') return 'Partially Fulfilled';
  if (normalized === 'pending') return 'Pending';
  return 'Processing';
}

function normalizeShipping(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'delivered') return 'Delivered';
  if (['in transit', 'in_transit', 'shipped', 'partially_shipped'].includes(normalized)) return 'In Transit';
  if (normalized === 'label created' || normalized === 'label_created') return 'Label Created';
  return 'Awaiting Shipment';
}

// Mirrors the existing Orders DTO-to-display projection; cancelled orders with
// concrete fulfillment, shipping, tracking or refund evidence retain those labels.
export function matchesVendorOrdersDisplayFilters(order: OrderSummaryDto, filters: VendorOrdersListFilters): boolean {
  if (!filters.fulfillmentStatus && !filters.shippingStatus) return true;
  const fulfillment = normalizeFulfillment(order.fulfillmentStatus);
  const shipping = normalizeShipping(order.shippingStatus);
  const cancelled = order.isCancelled || Boolean(order.cancelledAt);
  const cancellationConflict = cancelled && (
    fulfillment === 'Fulfilled' || fulfillment === 'Partially Fulfilled' ||
    shipping === 'Delivered' || shipping === 'In Transit' || shipping === 'Label Created' ||
    Boolean(order.trackingNumber?.trim()) || Boolean(order.carrier?.trim()) || order.refundRecordCount > 0
  );
  const displayFulfillment = cancelled && !cancellationConflict ? 'Not Required' : fulfillment;
  const displayShipping = cancelled && !cancellationConflict ? 'Not Required' : shipping;
  return (!filters.fulfillmentStatus || displayFulfillment === filters.fulfillmentStatus) &&
    (!filters.shippingStatus || displayShipping === filters.shippingStatus);
}
