import { CustomerCancellationStatus, type Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';

export const ACTIVE_CUSTOMER_CANCELLATION_REQUEST_STATUSES = [
  CustomerCancellationStatus.PENDING,
  CustomerCancellationStatus.PARTIALLY_RESOLVED,
  CustomerCancellationStatus.APPROVED_FOR_REFUND,
  CustomerCancellationStatus.REFUNDED_AWAITING_ORDER_CANCEL,
] as const;

export const CUSTOMER_CANCELLATION_PENDING_ITEM_STATUS = CustomerCancellationStatus.PENDING;
export const ACTIVE_CUSTOMER_CANCELLATION_HOLD_ITEM_STATUSES = [
  CustomerCancellationStatus.PENDING,
  CustomerCancellationStatus.APPROVED_FOR_REFUND,
  CustomerCancellationStatus.REFUNDED_AWAITING_ORDER_CANCEL,
] as const;
export const CUSTOMER_CANCELLATION_PENDING_CODE = 'CUSTOMER_CANCELLATION_PENDING';
export const CUSTOMER_CANCELLATION_PENDING_MESSAGE =
  'A pending customer cancellation request blocks new shipment and tracking actions.';

type CustomerCancellationHoldDb = Pick<Prisma.TransactionClient, 'customerCancellationRequestItem'>;

export class CustomerCancellationShipmentHoldError extends Error {
  readonly code = CUSTOMER_CANCELLATION_PENDING_CODE;
  readonly statusCode = 409;

  constructor(message = CUSTOMER_CANCELLATION_PENDING_MESSAGE) {
    super(message);
    this.name = 'CustomerCancellationShipmentHoldError';
    Object.setPrototypeOf(this, CustomerCancellationShipmentHoldError.prototype);
  }
}

export function isPendingCustomerCancellationHoldState(input: {
  requestStatus: CustomerCancellationStatus;
  itemStatus: CustomerCancellationStatus;
}) {
  return (
    (ACTIVE_CUSTOMER_CANCELLATION_REQUEST_STATUSES as readonly CustomerCancellationStatus[]).includes(
      input.requestStatus,
    ) && (ACTIVE_CUSTOMER_CANCELLATION_HOLD_ITEM_STATUSES as readonly CustomerCancellationStatus[]).includes(
      input.itemStatus,
    )
  );
}

export async function hasPendingCustomerCancellationHold(
  vendorAllocationId: string,
  db: CustomerCancellationHoldDb = prisma,
) {
  const normalizedAllocationId = vendorAllocationId.trim();
  if (!normalizedAllocationId) {
    return false;
  }

  const pendingItem = await db.customerCancellationRequestItem.findFirst({
    where: {
      vendorAllocationId: normalizedAllocationId,
      status: {
        in: [...ACTIVE_CUSTOMER_CANCELLATION_HOLD_ITEM_STATUSES],
      },
      request: {
        status: {
          in: [...ACTIVE_CUSTOMER_CANCELLATION_REQUEST_STATUSES],
        },
      },
    },
    select: {
      id: true,
    },
  });

  return Boolean(pendingItem);
}

export async function assertNoPendingCustomerCancellationHold(
  vendorAllocationId: string,
  db: CustomerCancellationHoldDb = prisma,
) {
  if (await hasPendingCustomerCancellationHold(vendorAllocationId, db)) {
    throw new CustomerCancellationShipmentHoldError();
  }
}
