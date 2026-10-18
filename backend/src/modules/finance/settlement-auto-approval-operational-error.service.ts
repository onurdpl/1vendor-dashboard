import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';

export type AutoApprovalOperationalPhase =
  | 'INITIAL_ATTEMPT_LOOKUP' | 'ATTEMPT_RECONCILIATION' | 'VENDOR_DISCOVERY'
  | 'VENDOR_WORKER' | 'WORKER_PRE_ATTEMPT' | 'BLOCKED_RECOVERY_PROBE'
  | 'WORKER_RECONCILIATION' | 'SCHEDULER_SWEEP';

export type AutoApprovalOperationalCategory =
  | 'DATABASE_READ_FAILED' | 'RECONCILIATION_FAILED' | 'WORKER_FAILED'
  | 'UNEXPECTED_SWEEP_FAILURE';

type OperationalErrorInput = {
  phase: AutoApprovalOperationalPhase;
  category: AutoApprovalOperationalCategory;
  error: unknown;
  vendorId?: string;
  settlementApprovalId?: string;
  attemptId?: string;
};

const recordingAttempted = new WeakSet<object>();
export function operationalErrorRecordingAttempted(error: unknown): boolean {
  if (error === null || typeof error !== 'object' || !recordingAttempted.has(error)) return false;
  recordingAttempted.delete(error);
  return true;
}

/** Only structured, bounded error codes are retained. Never persist error.message or stack. */
export function safeOperationalErrorCode(error: unknown): string {
  if (error instanceof Prisma.PrismaClientKnownRequestError) return error.code;
  if (error instanceof Prisma.PrismaClientInitializationError) return 'PRISMA_INITIALIZATION';
  if (error instanceof Prisma.PrismaClientRustPanicError) return 'PRISMA_ENGINE_PANIC';
  if (error instanceof TypeError) return 'TYPE_ERROR';
  if (error instanceof RangeError) return 'RANGE_ERROR';
  return 'UNCLASSIFIED';
}

function boundedId(value: string | undefined): string | null {
  return value && value.length <= 128 && value.trim() === value ? value : null;
}

/** Identity is the operational failure class and exact known scope, not an untrusted exception message. */
export function operationalErrorIdentity(input: OperationalErrorInput) {
  const vendorId = boundedId(input.vendorId);
  const settlementApprovalId = boundedId(input.settlementApprovalId);
  const attemptId = boundedId(input.attemptId);
  const errorCode = safeOperationalErrorCode(input.error);
  const deduplicationKey = createHash('sha256').update(JSON.stringify([
    input.phase, input.category, errorCode, vendorId, settlementApprovalId, attemptId,
  ])).digest('hex');
  return { vendorId, settlementApprovalId, attemptId, errorCode, deduplicationKey };
}

/** Atomic database-side increment; the database clock preserves first and monotonic last occurrence. */
export async function recordAutoApprovalOperationalError(input: OperationalErrorInput): Promise<void> {
  const identity = operationalErrorIdentity(input);
  await prisma.$executeRaw`
    INSERT INTO "SettlementAutoApprovalOperationalError"
      ("id", "deduplicationKey", "category", "phase", "errorCode",
       "vendorId", "settlementApprovalId", "attemptId", "safeContextJson",
       "firstOccurredAt", "lastOccurredAt", "occurrenceCount")
    VALUES (${randomUUID()}, ${identity.deduplicationKey}, ${input.category}, ${input.phase},
      ${identity.errorCode}, ${identity.vendorId}, ${identity.settlementApprovalId},
      ${identity.attemptId}, NULL, clock_timestamp(), clock_timestamp(), 1)
    ON CONFLICT ("deduplicationKey") DO UPDATE SET
      "occurrenceCount" = "SettlementAutoApprovalOperationalError"."occurrenceCount" + 1,
      "lastOccurredAt" = GREATEST("SettlementAutoApprovalOperationalError"."lastOccurredAt", clock_timestamp())
  `;
}

/** Evidence storage is best effort: never replace the original finance/worker outcome with a storage error. */
export async function recordAutoApprovalOperationalErrorBestEffort(input: OperationalErrorInput,
  propagatedToCaller = true): Promise<boolean> {
  if (propagatedToCaller && input.error !== null && typeof input.error === 'object') recordingAttempted.add(input.error);
  try {
    await recordAutoApprovalOperationalError(input);
    return true;
  } catch {
    // Only finite, code-defined classifications reach logs; never include the source exception.
    console.warn('Automatic approval operational error evidence could not be stored.', {
      phase: input.phase, category: input.category, errorCode: safeOperationalErrorCode(input.error),
    });
    return false;
  }
}
