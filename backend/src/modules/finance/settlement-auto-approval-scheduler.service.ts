import type { FastifyInstance } from 'fastify';
import { SettlementApprovalStatus, SettlementAutoApprovalAttemptOutcome } from '@prisma/client';
import type { AppEnv } from '../../config/env.js';
import { prisma } from '../../db/prisma.js';
import { reconcileAutomaticApprovalAttempt } from './settlement-auto-approval.service.js';
import { runAutomaticSettlementApprovalWorker } from './settlement-auto-approval-worker.service.js';
import { operationalErrorRecordingAttempted, recordAutoApprovalOperationalErrorBestEffort } from
  './settlement-auto-approval-operational-error.service.js';

const INTERVAL_MS = 5 * 60 * 1_000;
type RunWorker = typeof runAutomaticSettlementApprovalWorker;
type Reconciliation = Awaited<ReturnType<typeof reconcileAutomaticApprovalAttempt>>;
type WorkerResult = Awaited<ReturnType<RunWorker>>;

export type AutomaticSettlementApprovalSweep = {
  reconciliations: Reconciliation[];
  reconciliationErrors: Array<{ vendorId: string; settlementApprovalId: string; attemptId: string; errorType: string }>;
  vendors: WorkerResult[];
  vendorErrors: Array<{ vendorId: string; errorType: string }>;
  skippedVendors: string[];
};

function errorType(error: unknown) {
  return error instanceof Error ? error.name : 'UNKNOWN';
}

/** The optional scope is for controlled local validation; the scheduler always calls this without one. */
export async function runAutomaticSettlementApprovalSweep(input: { vendorIds?: readonly string[] } = {}):
Promise<AutomaticSettlementApprovalSweep> {
  const vendorIds = input.vendorIds;
  if (vendorIds && (!vendorIds.length || vendorIds.some((id) => !id || id.trim() !== id) ||
      new Set(vendorIds).size !== vendorIds.length)) {
    throw new Error('Automatic approval sweep requires distinct exact vendor identities.');
  }
  const vendorWhere = vendorIds ? { vendorId: { in: [...vendorIds] } } : {};
  const attempts = await prisma.settlementAutoApprovalAttempt.findMany({
    where: { ...vendorWhere, outcome: { in: [SettlementAutoApprovalAttemptOutcome.STARTED,
      SettlementAutoApprovalAttemptOutcome.UNKNOWN] } },
    select: { id: true, settlementApprovalId: true, vendorId: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  }).catch(async (error: unknown) => {
    await recordAutoApprovalOperationalErrorBestEffort({ phase: 'INITIAL_ATTEMPT_LOOKUP',
      category: 'DATABASE_READ_FAILED', error });
    throw error;
  });
  const reconciliations: Reconciliation[] = [];
  const reconciliationErrors: AutomaticSettlementApprovalSweep['reconciliationErrors'] = [];
  const unsafeVendors = new Set<string>();
  for (const attempt of attempts) {
    try {
      reconciliations.push(await reconcileAutomaticApprovalAttempt({
        attemptId: attempt.id, settlementApprovalId: attempt.settlementApprovalId,
        expectedVendorId: attempt.vendorId,
      }));
    } catch (error) {
      await recordAutoApprovalOperationalErrorBestEffort({ phase: 'ATTEMPT_RECONCILIATION',
        category: 'RECONCILIATION_FAILED', error, vendorId: attempt.vendorId,
        settlementApprovalId: attempt.settlementApprovalId, attemptId: attempt.id }, false);
      unsafeVendors.add(attempt.vendorId);
      reconciliationErrors.push({ vendorId: attempt.vendorId, settlementApprovalId: attempt.settlementApprovalId,
        attemptId: attempt.id, errorType: errorType(error) });
    }
  }
  const draftVendors = await prisma.settlementApproval.findMany({
    where: { ...vendorWhere, status: SettlementApprovalStatus.DRAFT },
    select: { vendorId: true }, distinct: ['vendorId'], orderBy: { vendorId: 'asc' },
  }).catch(async (error: unknown) => {
    await recordAutoApprovalOperationalErrorBestEffort({ phase: 'VENDOR_DISCOVERY',
      category: 'DATABASE_READ_FAILED', error });
    throw error;
  });
  const vendors: WorkerResult[] = [];
  const vendorErrors: AutomaticSettlementApprovalSweep['vendorErrors'] = [];
  const skippedVendors: string[] = [];
  for (const { vendorId } of draftVendors) {
    if (unsafeVendors.has(vendorId)) {
      skippedVendors.push(vendorId);
      continue;
    }
    try {
      vendors.push(await runAutomaticSettlementApprovalWorker({ vendorId }));
    } catch (error) {
      if (!operationalErrorRecordingAttempted(error)) {
        await recordAutoApprovalOperationalErrorBestEffort({ phase: 'VENDOR_WORKER',
          category: 'WORKER_FAILED', error, vendorId }, false);
      }
      vendorErrors.push({ vendorId, errorType: errorType(error) });
    }
  }
  return { reconciliations, reconciliationErrors, vendors, vendorErrors, skippedVendors };
}

type SchedulerEnv = Pick<AppEnv, 'SETTLEMENT_AUTO_APPROVAL_SCHEDULER_ENABLED'>;
type RunSweep = typeof runAutomaticSettlementApprovalSweep;
export type SettlementAutoApprovalScheduler = { runTick(): Promise<AutomaticSettlementApprovalSweep | null> };
const registrations = new WeakMap<FastifyInstance, SettlementAutoApprovalScheduler>();
let processRunActive = false;

/** Disabled unless explicitly opted in. No immediate startup run or missed-tick catch-up. */
export function registerSettlementAutoApprovalScheduler(app: FastifyInstance, env: SchedulerEnv,
  dependencies: { runSweep?: RunSweep;
    recordError?: typeof recordAutoApprovalOperationalErrorBestEffort } = {}): SettlementAutoApprovalScheduler | null {
  if (!env.SETTLEMENT_AUTO_APPROVAL_SCHEDULER_ENABLED) return null;
  const existing = registrations.get(app);
  if (existing) return existing;
  const runSweep = dependencies.runSweep ?? runAutomaticSettlementApprovalSweep;
  const recordError = dependencies.recordError ?? recordAutoApprovalOperationalErrorBestEffort;
  let closed = false;
  const scheduler: SettlementAutoApprovalScheduler = {
    async runTick() {
      if (closed || processRunActive) return null;
      processRunActive = true;
      try {
        return await runSweep();
      } finally {
        processRunActive = false;
      }
    },
  };
  const timer = globalThis.setInterval(() => {
    void scheduler.runTick().then((result) => {
      if (!result) {
        app.log.warn('Automatic settlement approval tick skipped because another execution is active.');
        return;
      }
      const nonCompleted = result.reconciliations.filter((item) =>
        item.classification !== 'VERIFIED_COMPLETED');
      const blocked = result.vendors.flatMap((vendor) => vendor.outcomes.filter((outcome) =>
        outcome.classification !== 'VERIFIED_COMPLETED').map((outcome) => ({
        vendorId: vendor.vendorId, settlementApprovalId: outcome.settlementApprovalId,
        attemptId: outcome.attemptId, classification: outcome.classification, reasonCode: outcome.reasonCode,
      })));
      app.log[result.reconciliationErrors.length || result.vendorErrors.length || nonCompleted.length || blocked.length
        ? 'warn' : 'info']({
        reconciledAttempts: result.reconciliations.length,
        nonCompletedReconciliations: nonCompleted.map((item) => ({ attemptId: item.attemptId,
          settlementApprovalId: item.settlementApprovalId, vendorId: item.vendorId,
          classification: item.classification, reasonCode: item.reasonCode })),
        reconciliationErrors: result.reconciliationErrors, vendorsChecked: result.vendors.length,
        vendorErrors: result.vendorErrors, skippedVendors: result.skippedVendors, blocked,
        approved: result.vendors.reduce((count, vendor) => count + vendor.outcomes.filter((outcome) =>
          outcome.classification === 'VERIFIED_COMPLETED').length, 0),
      }, 'Automatic settlement approval tick returned persisted outcomes.');
    }).catch(async (error: unknown) => {
      app.log.error({ errorType: errorType(error) },
        'Automatic settlement approval tick failed before complete reconciliation; outcome requires review.');
      if (!operationalErrorRecordingAttempted(error)) {
        await recordError({ phase: 'SCHEDULER_SWEEP',
          category: 'UNEXPECTED_SWEEP_FAILURE', error }, false);
      }
    });
  }, INTERVAL_MS);
  timer.unref?.();
  registrations.set(app, scheduler);
  app.addHook('onClose', (_instance, done) => {
    closed = true;
    globalThis.clearInterval(timer);
    registrations.delete(app);
    done();
  });
  return scheduler;
}
