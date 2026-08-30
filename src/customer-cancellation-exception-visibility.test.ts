import type { CustomerCancellationStatus, OperationalJobStatus } from '../backend/node_modules/@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  CUSTOMER_CANCELLATION_EXCEPTION_REASONS,
  classifyCustomerCancellationException,
} from '../backend/src/modules/orders/customer-cancellation-exception.service.js';

describe('customer cancellation exception authority', () => {
  const status = (value: string) => value as CustomerCancellationStatus;
  const jobStatus = (value: string) => value as OperationalJobStatus;
  it('does not surface clean pending work merely because processing has not run', () => {
    expect(classifyCustomerCancellationException({ itemStatus: status('PENDING') })).toBeNull();
  });

  it.each([
    [status('CONFLICTED'), CUSTOMER_CANCELLATION_EXCEPTION_REASONS.conflicted],
    [status('TOO_LATE'), CUSTOMER_CANCELLATION_EXCEPTION_REASONS.tooLate],
  ])('classifies persisted terminal request state %s', (itemStatus, reason) => {
    expect(classifyCustomerCancellationException({ itemStatus })).toBe(reason);
  });

  it('classifies failed outbound Shopify refund attempts', () => {
    expect(classifyCustomerCancellationException({
      itemStatus: status('APPROVED_FOR_REFUND'),
      attemptStatus: 'FAILED',
    })).toBe(CUSTOMER_CANCELLATION_EXCEPTION_REASONS.failedRefundAttempt);
  });

  it('classifies retry exhaustion and ambiguous submitted state from terminal persisted jobs', () => {
    expect(classifyCustomerCancellationException({
      itemStatus: status('APPROVED_FOR_REFUND'),
      jobStatus: jobStatus('FAILED'),
      jobRetryCount: 8,
      jobMaxRetries: 8,
    })).toBe(CUSTOMER_CANCELLATION_EXCEPTION_REASONS.retriesExhausted);
    expect(classifyCustomerCancellationException({
      itemStatus: status('APPROVED_FOR_REFUND'),
      attemptStatus: 'SHOPIFY_ACTION_PENDING',
      jobStatus: jobStatus('FAILED'),
    })).toBe(CUSTOMER_CANCELLATION_EXCEPTION_REASONS.ambiguousRefundState);
  });

  it('surfaces terminal processing evidence even while the child lifecycle remains pending', () => {
    expect(classifyCustomerCancellationException({
      itemStatus: status('PENDING'),
      jobStatus: jobStatus('FAILED'),
      jobFailureCategory: 'CUSTOMER_CANCELLATION_EXCEPTION',
      jobErrorSummary: 'TERMINAL_EXCEPTION',
    })).toBe(CUSTOMER_CANCELLATION_EXCEPTION_REASONS.processingException);
  });

  it('classifies canonical mismatch, finance conflict, shipment race, and external partial mismatch', () => {
    expect(classifyCustomerCancellationException({
      itemStatus: status('APPROVED_FOR_REFUND'),
      postRefundCheckStatus: 'mismatch',
    })).toBe(CUSTOMER_CANCELLATION_EXCEPTION_REASONS.canonicalMismatch);
    expect(classifyCustomerCancellationException({
      itemStatus: status('PENDING'),
      financeConflictExists: true,
    })).toBe(CUSTOMER_CANCELLATION_EXCEPTION_REASONS.financeConflict);
    expect(classifyCustomerCancellationException({
      itemStatus: status('PENDING'),
      shipmentAuthorityExists: true,
    })).toBe(CUSTOMER_CANCELLATION_EXCEPTION_REASONS.shipmentRace);
    expect(classifyCustomerCancellationException({
      itemStatus: status('APPROVED_FOR_REFUND'),
      jobStatus: jobStatus('FAILED'),
      jobErrorSummary: 'REFUND_CONFLICT: external PARTIAL_REFUND evidence differs',
    })).toBe(CUSTOMER_CANCELLATION_EXCEPTION_REASONS.externalRefundMismatch);
  });

  it('keeps approved and declined history out of the active exception authority', () => {
    expect(classifyCustomerCancellationException({
      itemStatus: status('APPROVED'),
      attemptStatus: 'FAILED',
      financeConflictExists: true,
    })).toBeNull();
    expect(classifyCustomerCancellationException({
      itemStatus: status('DECLINED'),
      shipmentAuthorityExists: true,
    })).toBeNull();
  });
});
