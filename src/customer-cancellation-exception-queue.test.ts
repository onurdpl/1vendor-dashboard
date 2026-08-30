import type { CustomerCancellationStatus, OperationalJobStatus } from '../backend/node_modules/@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  customerCancellationRequestItem: { findMany: vi.fn() },
}));
vi.mock('../backend/src/db/prisma.js', () => ({ prisma: prismaMock }));

const { getCustomerCancellationExceptionOperationsQueue } = await import(
  '../backend/src/modules/operations/customer-cancellation-exception-queue.service.js'
);
const status = (value: string) => value as CustomerCancellationStatus;

function candidate(input: {
  id: string;
  status: CustomerCancellationStatus;
  vendorId: string;
  vendorName: string;
  jobStatus?: OperationalJobStatus;
  attemptStatus?: string;
}) {
  return {
    id: input.id,
    status: input.status,
    requestedQuantity: 1,
    resolvedQuantity: null,
    request: {
      id: `request-${input.id}`,
      status: input.status === status('APPROVED') ? status('PARTIALLY_RESOLVED') : input.status,
      reasonCode: 'CUSTOMER_CHANGED_MIND',
      customerNote: null,
      requestedAt: new Date('2026-08-30T10:00:00.000Z'),
      order: { sourceShopifyOrderId: `order-${input.id}`, sourceShopifyOrderNumber: `#${input.id}` },
    },
    shopifyOrderLineItem: { sku: `SKU-${input.id}`, title: `Item ${input.id}` },
    vendorAllocation: {
      id: `allocation-${input.id}`,
      assignedVendorId: input.vendorId,
      assignedVendor: { name: input.vendorName },
      trackingNumber: null,
      fulfillment: null,
      shipmentExecutions: [],
      financeIntegrityAlerts: [],
    },
    outboundShopifyRefundAttempt: input.attemptStatus
      ? { status: input.attemptStatus, mutationResponseJson: null }
      : null,
    operationalJob: input.jobStatus
      ? { status: input.jobStatus, retryCount: 1, maxRetries: 8, failureCategory: 'CUSTOMER_CANCELLATION_EXCEPTION', errorSummary: null }
      : null,
  };
}

describe('customer cancellation exception Operations Queue', () => {
  beforeEach(() => prismaMock.customerCancellationRequestItem.findMany.mockReset());

  it('counts only exceptional children and preserves multi-vendor item scope', async () => {
    prismaMock.customerCancellationRequestItem.findMany.mockResolvedValue([
      candidate({ id: 'a', status: status('APPROVED'), vendorId: 'vendor-a', vendorName: 'Vendor A' }),
      candidate({ id: 'b', status: status('APPROVED_FOR_REFUND'), vendorId: 'vendor-b', vendorName: 'Vendor B', attemptStatus: 'FAILED' }),
      candidate({ id: 'c', status: status('CONFLICTED'), vendorId: 'vendor-c', vendorName: 'Vendor C' }),
      candidate({ id: 'd', status: status('PENDING'), vendorId: 'vendor-d', vendorName: 'Vendor D' }),
    ]);

    const firstPage = await getCustomerCancellationExceptionOperationsQueue({ limit: 1, offset: 0 });
    const secondPage = await getCustomerCancellationExceptionOperationsQueue({ limit: 1, offset: 1 });

    expect(firstPage.summary.total).toBe(2);
    expect(firstPage.summary.customerCancellationExceptions).toBe(2);
    expect(firstPage.items).toHaveLength(1);
    expect(secondPage.items).toHaveLength(1);
    expect([...firstPage.items, ...secondPage.items].map((item) => item.vendorId)).toEqual(['vendor-b', 'vendor-c']);
    expect([...firstPage.items, ...secondPage.items].every((item) => item.type === 'customer_cancellation_exception')).toBe(true);
  });
});
