import { CustomerCancellationStatus, OperationalJobStatus } from '@prisma/client';

export const CUSTOMER_CANCELLATION_EXCEPTION_REASONS = {
  conflicted: 'CANCELLATION_CONFLICTED',
  tooLate: 'CANCELLATION_TOO_LATE',
  shipmentRace: 'SHIPMENT_RACE',
  financeConflict: 'FINANCE_CONFLICT',
  failedRefundAttempt: 'SHOPIFY_REFUND_ATTEMPT_FAILED',
  retriesExhausted: 'REFUND_RETRIES_EXHAUSTED',
  canonicalMismatch: 'CANONICAL_POST_CHECK_MISMATCH',
  externalRefundMismatch: 'EXTERNAL_REFUND_MISMATCH',
  ambiguousRefundState: 'AMBIGUOUS_REFUND_STATE',
  processingException: 'AUTO_REFUND_PROCESSING_EXCEPTION',
} as const;

export type CustomerCancellationExceptionReason =
  (typeof CUSTOMER_CANCELLATION_EXCEPTION_REASONS)[keyof typeof CUSTOMER_CANCELLATION_EXCEPTION_REASONS];

export type CustomerCancellationExceptionEvidence = {
  itemStatus: CustomerCancellationStatus;
  attemptStatus?: string | null;
  postRefundCheckStatus?: string | null;
  jobStatus?: OperationalJobStatus | null;
  jobRetryCount?: number | null;
  jobMaxRetries?: number | null;
  jobFailureCategory?: string | null;
  jobErrorSummary?: string | null;
  shipmentAuthorityExists?: boolean;
  financeConflictExists?: boolean;
};

const TERMINAL_JOB_STATUSES = new Set<OperationalJobStatus>([
  OperationalJobStatus.FAILED,
  OperationalJobStatus.DEAD_LETTER_READY,
  OperationalJobStatus.PERMANENTLY_FAILED,
]);

function normalized(value: string | null | undefined) {
  return value?.trim().toUpperCase() ?? '';
}

/**
 * Central persisted-state authority for deciding whether a cancellation item
 * requires human attention. A pending item is deliberately not exceptional
 * without independent terminal/conflict evidence.
 */
export function classifyCustomerCancellationException(
  evidence: CustomerCancellationExceptionEvidence,
): CustomerCancellationExceptionReason | null {
  if (
    evidence.itemStatus === CustomerCancellationStatus.APPROVED ||
    evidence.itemStatus === CustomerCancellationStatus.DECLINED
  ) {
    return null;
  }

  if (evidence.itemStatus === CustomerCancellationStatus.CONFLICTED) {
    return CUSTOMER_CANCELLATION_EXCEPTION_REASONS.conflicted;
  }
  if (evidence.itemStatus === CustomerCancellationStatus.TOO_LATE) {
    return CUSTOMER_CANCELLATION_EXCEPTION_REASONS.tooLate;
  }
  if (evidence.financeConflictExists) {
    return CUSTOMER_CANCELLATION_EXCEPTION_REASONS.financeConflict;
  }
  if (evidence.shipmentAuthorityExists) {
    return CUSTOMER_CANCELLATION_EXCEPTION_REASONS.shipmentRace;
  }

  const postCheck = normalized(evidence.postRefundCheckStatus);
  if (postCheck && postCheck !== 'PASSED') {
    return CUSTOMER_CANCELLATION_EXCEPTION_REASONS.canonicalMismatch;
  }

  const attemptStatus = normalized(evidence.attemptStatus);
  if (attemptStatus === 'FAILED') {
    return CUSTOMER_CANCELLATION_EXCEPTION_REASONS.failedRefundAttempt;
  }

  const jobStatus = evidence.jobStatus ?? null;
  const terminalJob = jobStatus ? TERMINAL_JOB_STATUSES.has(jobStatus) : false;
  const failureCategory = normalized(evidence.jobFailureCategory);
  const errorSummary = normalized(evidence.jobErrorSummary);
  if (
    jobStatus === OperationalJobStatus.DEAD_LETTER_READY ||
    jobStatus === OperationalJobStatus.PERMANENTLY_FAILED ||
    failureCategory === 'RETRIES_EXHAUSTED' ||
    (terminalJob &&
      evidence.jobMaxRetries != null &&
      evidence.jobRetryCount != null &&
      evidence.jobRetryCount >= evidence.jobMaxRetries)
  ) {
    return CUSTOMER_CANCELLATION_EXCEPTION_REASONS.retriesExhausted;
  }
  if (terminalJob && (errorSummary.includes('REFUND_CONFLICT') || errorSummary.includes('PARTIAL_REFUND'))) {
    return CUSTOMER_CANCELLATION_EXCEPTION_REASONS.externalRefundMismatch;
  }
  if (terminalJob && attemptStatus === 'SHOPIFY_ACTION_PENDING') {
    return CUSTOMER_CANCELLATION_EXCEPTION_REASONS.ambiguousRefundState;
  }
  if (terminalJob && failureCategory === 'CUSTOMER_CANCELLATION_EXCEPTION') {
    return CUSTOMER_CANCELLATION_EXCEPTION_REASONS.processingException;
  }

  if (evidence.itemStatus !== CustomerCancellationStatus.APPROVED_FOR_REFUND) {
    return null;
  }

  return null;
}

export function readPostRefundFulfillmentCheckStatus(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const check = (value as Record<string, unknown>).postRefundFulfillmentCheck;
  if (!check || typeof check !== 'object' || Array.isArray(check)) return null;
  const status = (check as Record<string, unknown>).status;
  return typeof status === 'string' && status.trim() ? status.trim() : null;
}
