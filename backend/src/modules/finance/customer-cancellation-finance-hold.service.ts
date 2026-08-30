import { CustomerCancellationStatus, type Prisma } from '@prisma/client';
import {
  CUSTOMER_CANCELLATION_PENDING_CODE,
  isPendingCustomerCancellationHoldState,
} from '../orders/customer-cancellation-hold.service.js';

export const CUSTOMER_CANCELLATION_FINANCE_HOLD_CODE = CUSTOMER_CANCELLATION_PENDING_CODE;
export const CUSTOMER_CANCELLATION_FINANCE_HOLD_REASON =
  `${CUSTOMER_CANCELLATION_FINANCE_HOLD_CODE}: finance progression is held while customer cancellation review is pending.`;

export const customerCancellationFinanceHoldSelect = {
  status: true,
  request: {
    select: {
      status: true,
    },
  },
} satisfies Prisma.CustomerCancellationRequestItemSelect;

export type CustomerCancellationFinanceHoldSnapshot = {
  customerCancellationRequestItems?: Array<{
    status: CustomerCancellationStatus;
    request: {
      status: CustomerCancellationStatus;
    };
  }>;
};

export function hasActiveCustomerCancellationFinanceHold(
  allocation: CustomerCancellationFinanceHoldSnapshot | null | undefined,
) {
  return Boolean(allocation?.customerCancellationRequestItems?.some((item) =>
    isPendingCustomerCancellationHoldState({
      requestStatus: item.request.status,
      itemStatus: item.status,
    })
  ));
}
