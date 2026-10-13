import type { FastifyInstance } from 'fastify';
import type { AppEnv } from '../../config/env.js';
import { runSettlementScheduleAutoDraftJob } from './settlement-schedule-job.service.js';

type SchedulerEnv = Pick<AppEnv,
  | 'SETTLEMENT_AUTO_DRAFT_WRITE_SCHEDULER_ENABLED'
  | 'SETTLEMENT_AUTO_DRAFT_WRITE_SCHEDULER_UTC_TIME'
  | 'SETTLEMENT_AUTO_DRAFT_JOB_ENABLED'
  | 'SETTLEMENT_AUTO_DRAFT_JOB_DRY_RUN'
>;

type RunJob = typeof runSettlementScheduleAutoDraftJob;
export type SettlementAutoDraftWriteScheduler = {
  runWriteTick(runDate: string | Date): Promise<Awaited<ReturnType<RunJob>> | null>;
};

const registrations = new WeakMap<FastifyInstance, SettlementAutoDraftWriteScheduler>();
let processRunActive = false;

function utcScheduleMinutes(value: string | undefined) {
  const match = /^(?:[01]\d|2[0-3]):[0-5]\d$/.exec(value ?? '');
  if (!match) {
    throw new Error('SETTLEMENT_AUTO_DRAFT_WRITE_SCHEDULER_UTC_TIME must be explicitly configured as HH:mm UTC.');
  }
  const [hour, minute] = match[0].split(':').map(Number);
  return hour * 60 + minute;
}

function nextUtcExecution(now: Date, minutes: number) {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(),
    Math.floor(minutes / 60), minutes % 60));
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

function completedUtcRunDate(execution: Date) {
  const prior = new Date(Date.UTC(execution.getUTCFullYear(), execution.getUTCMonth(), execution.getUTCDate() - 1));
  return prior.toISOString().slice(0, 10);
}

/** Separate opt-in writer for the last completed UTC day; it never retries an existing JobRun. */
export function registerSettlementAutoDraftWriteScheduler(
  app: FastifyInstance,
  env: SchedulerEnv,
  dependencies: { runJob?: RunJob } = {},
): SettlementAutoDraftWriteScheduler | null {
  if (!env.SETTLEMENT_AUTO_DRAFT_WRITE_SCHEDULER_ENABLED) return null;

  const existing = registrations.get(app);
  if (existing) return existing;
  const minutes = utcScheduleMinutes(env.SETTLEMENT_AUTO_DRAFT_WRITE_SCHEDULER_UTC_TIME);
  if (!env.SETTLEMENT_AUTO_DRAFT_JOB_ENABLED || env.SETTLEMENT_AUTO_DRAFT_JOB_DRY_RUN) {
    throw new Error('Automatic DRAFT scheduling requires SETTLEMENT_AUTO_DRAFT_JOB_ENABLED=true and SETTLEMENT_AUTO_DRAFT_JOB_DRY_RUN=false.');
  }

  const runJob = dependencies.runJob ?? runSettlementScheduleAutoDraftJob;
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const scheduler: SettlementAutoDraftWriteScheduler = {
    async runWriteTick(runDate) {
      if (closed || processRunActive) return null;
      if (!(runDate instanceof Date) && typeof runDate !== 'string') {
        throw new Error('An explicit settlement runDate is required.');
      }
      processRunActive = true;
      try {
        return await runJob({
          env: {
            SETTLEMENT_AUTO_DRAFT_JOB_ENABLED: env.SETTLEMENT_AUTO_DRAFT_JOB_ENABLED,
            SETTLEMENT_AUTO_DRAFT_JOB_DRY_RUN: env.SETTLEMENT_AUTO_DRAFT_JOB_DRY_RUN,
          },
          runDate,
          confirmScheduledSettlementAutoDraftJob: true,
          triggeredBy: 'system:settlement_auto_draft_scheduler',
        });
      } finally {
        processRunActive = false;
      }
    },
  };

  const scheduleNext = () => {
    if (closed) return;
    const execution = nextUtcExecution(new Date(), minutes);
    timer = globalThis.setTimeout(() => {
      timer = null;
      scheduleNext();
      const runDate = completedUtcRunDate(execution);
      void scheduler.runWriteTick(runDate).then((result) => {
        if (!result) {
          app.log.warn({ runDate }, 'Scheduled settlement DRAFT execution skipped because another execution is active.');
          return;
        }
        if (result.mode !== 'WRITE' || !result.enabled || result.dryRun) {
          app.log.error({ runDate, mode: result.mode }, 'Scheduled settlement DRAFT execution returned an unexpected non-write mode.');
          return;
        }
        const blockedVendors = result.vendors.filter((vendor) => vendor.blockers.length > 0 || vendor.skippedReason)
          .map((vendor) => ({ vendorId: vendor.vendorId, reasons: vendor.blockers, skippedReason: vendor.skippedReason }));
        app.log[result.ok ? 'info' : 'warn']({
          runDate: result.runDate,
          outcome: result.jobRun?.status ?? (result.ok ? 'COMPLETED' : 'UNKNOWN'),
          jobRunId: result.jobRun?.id ?? null,
          existingRun: result.jobRun?.recordedWritesPerformed !== undefined,
          writesPerformed: result.writesPerformed,
          recordedWritesPerformed: result.jobRun?.recordedWritesPerformed ?? null,
          vendorsChecked: result.summary.vendorsChecked,
          dueVendors: result.summary.dueVendors,
          readyVendors: result.summary.readyVendors,
          createdDrafts: result.summary.createdDrafts,
          skipped: result.summary.skipped,
          blocked: result.summary.blocked,
          blockedVendors,
        }, 'Scheduled settlement DRAFT job returned an execution outcome.');
      }).catch((error: unknown) => {
        app.log.error({
          runDate,
          outcome: 'UNKNOWN',
          errorType: error instanceof Error ? error.name : 'UNKNOWN',
        }, 'Scheduled settlement DRAFT execution outcome requires operator review; it will not be retried automatically.');
      });
    }, Math.max(1, execution.getTime() - Date.now()));
    timer.unref?.();
  };

  registrations.set(app, scheduler);
  scheduleNext();
  app.addHook('onClose', (_instance, done) => {
    closed = true;
    if (timer) globalThis.clearTimeout(timer);
    registrations.delete(app);
    done();
  });
  return scheduler;
}
