import type { FastifyInstance } from 'fastify';
import type { AppEnv } from '../../config/env.js';
import { runSettlementScheduleAutoDraftJob } from './settlement-schedule-job.service.js';

type SchedulerEnv = Pick<AppEnv,
  | 'SETTLEMENT_AUTO_DRAFT_SCHEDULER_ENABLED'
  | 'SETTLEMENT_AUTO_DRAFT_SCHEDULER_UTC_TIME'
>;

type RunJob = typeof runSettlementScheduleAutoDraftJob;

export type PassiveSettlementAutoDraftScheduler = {
  runReadOnlyTick(runDate: string | Date): Promise<Awaited<ReturnType<RunJob>> | null>;
};

const registrations = new WeakMap<FastifyInstance, PassiveSettlementAutoDraftScheduler>();
let processRunActive = false;

function utcScheduleMinutes(value: string | undefined) {
  const match = /^(?:[01]\d|2[0-3]):[0-5]\d$/.exec(value ?? '');
  if (!match) {
    throw new Error('SETTLEMENT_AUTO_DRAFT_SCHEDULER_UTC_TIME must be explicitly configured as HH:mm UTC.');
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

/** Opt-in daily UTC read-only preview of the last completed UTC day. */
export function registerPassiveSettlementAutoDraftScheduler(
  app: FastifyInstance,
  env: SchedulerEnv,
  dependencies: { runJob?: RunJob } = {},
): PassiveSettlementAutoDraftScheduler | null {
  if (!env.SETTLEMENT_AUTO_DRAFT_SCHEDULER_ENABLED) return null;

  const existing = registrations.get(app);
  if (existing) return existing;
  const minutes = utcScheduleMinutes(env.SETTLEMENT_AUTO_DRAFT_SCHEDULER_UTC_TIME);

  const runJob = dependencies.runJob ?? runSettlementScheduleAutoDraftJob;
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const scheduler: PassiveSettlementAutoDraftScheduler = {
    async runReadOnlyTick(runDate) {
      if (closed || processRunActive) return null;
      if (!(runDate instanceof Date) && typeof runDate !== 'string') {
        throw new Error('An explicit settlement runDate is required.');
      }

      processRunActive = true;
      try {
        return await runJob({
          env: {
            SETTLEMENT_AUTO_DRAFT_JOB_ENABLED: true,
            SETTLEMENT_AUTO_DRAFT_JOB_DRY_RUN: true,
          },
          runDate,
          confirmScheduledSettlementAutoDraftJob: false,
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
      void scheduler.runReadOnlyTick(runDate).then((result) => {
        if (!result) {
          app.log.warn({ runDate }, 'Scheduled settlement read-only preview skipped because another execution is active.');
          return;
        }
        if (result.writesPerformed || result.mode !== 'DRY_RUN' || result.jobRun !== null) {
          app.log.error({ runDate }, 'Scheduled settlement preview returned an unexpected write outcome.');
          return;
        }
        const blockedVendors = result.vendors.filter((vendor) => vendor.state === 'BLOCKED')
          .map((vendor) => ({ vendorId: vendor.vendorId, reasons: vendor.blockers }));
        app.log.info({
          runDate: result.runDate,
          outcome: result.ok ? 'COMPLETED' : 'BLOCKED',
          vendorsChecked: result.summary.vendorsChecked,
          dueVendors: result.summary.dueVendors,
          readyVendors: result.summary.readyVendors,
          blockedVendorCount: blockedVendors.length,
          blockedVendors,
        }, 'Scheduled settlement read-only preview completed.');
      }).catch((error: unknown) => {
        app.log.error({
          runDate,
          outcome: 'FAILED',
          errorType: error instanceof Error ? error.name : 'UNKNOWN',
        }, 'Scheduled settlement read-only preview failed.');
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
