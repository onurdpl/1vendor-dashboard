import type { FastifyInstance } from 'fastify';
import type { AppEnv } from '../../config/env.js';
import { runSettlementScheduleAutoDraftJob } from './settlement-schedule-job.service.js';

type SchedulerEnv = Pick<AppEnv,
  | 'SETTLEMENT_AUTO_DRAFT_SCHEDULER_ENABLED'
  | 'SETTLEMENT_AUTO_DRAFT_JOB_ENABLED'
  | 'SETTLEMENT_AUTO_DRAFT_JOB_DRY_RUN'
>;

type RunJob = typeof runSettlementScheduleAutoDraftJob;

export type PassiveSettlementAutoDraftScheduler = {
  runReadOnlyTick(runDate: string | Date): Promise<Awaited<ReturnType<RunJob>> | null>;
};

const registrations = new WeakMap<FastifyInstance, PassiveSettlementAutoDraftScheduler>();

/** No timer is installed until the run-date and cadence contract is approved. */
export function registerPassiveSettlementAutoDraftScheduler(
  app: FastifyInstance,
  env: SchedulerEnv,
  dependencies: { runJob?: RunJob } = {},
): PassiveSettlementAutoDraftScheduler | null {
  if (!env.SETTLEMENT_AUTO_DRAFT_SCHEDULER_ENABLED) return null;

  const existing = registrations.get(app);
  if (existing) return existing;

  const runJob = dependencies.runJob ?? runSettlementScheduleAutoDraftJob;
  let running = false;
  let closed = false;
  const scheduler: PassiveSettlementAutoDraftScheduler = {
    async runReadOnlyTick(runDate) {
      if (closed || running) return null;
      if (!(runDate instanceof Date) && typeof runDate !== 'string') {
        throw new Error('An explicit settlement runDate is required.');
      }

      running = true;
      try {
        return await runJob({
          env: {
            SETTLEMENT_AUTO_DRAFT_JOB_ENABLED: env.SETTLEMENT_AUTO_DRAFT_JOB_ENABLED,
            SETTLEMENT_AUTO_DRAFT_JOB_DRY_RUN: true,
          },
          runDate,
          confirmScheduledSettlementAutoDraftJob: false,
        });
      } finally {
        running = false;
      }
    },
  };

  registrations.set(app, scheduler);
  app.addHook('onClose', (_instance, done) => {
    closed = true;
    registrations.delete(app);
    done();
  });
  return scheduler;
}
