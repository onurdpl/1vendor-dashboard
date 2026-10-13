import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerSettlementAutoDraftWriteScheduler } from '../backend/src/modules/finance/settlement-auto-draft-write-scheduler.service.js';

const disabledEnv = {
  SETTLEMENT_AUTO_DRAFT_WRITE_SCHEDULER_ENABLED: false,
  SETTLEMENT_AUTO_DRAFT_WRITE_SCHEDULER_UTC_TIME: undefined,
  SETTLEMENT_AUTO_DRAFT_JOB_ENABLED: true,
  SETTLEMENT_AUTO_DRAFT_JOB_DRY_RUN: false,
};

const result = {
  ok: true, writesPerformed: true, runDate: '2026-06-24', mode: 'WRITE', enabled: true, dryRun: false,
  jobRun: { id: 'run-1', status: 'COMPLETED', startedAt: '2026-06-25T01:00:00.000Z', finishedAt: '2026-06-25T01:00:01.000Z' },
  summary: { vendorsChecked: 3, dueVendors: 2, readyVendors: 1, createdDrafts: 1, skipped: 2, blocked: 1, existingDrafts: 0 },
  vendors: [
    { vendorId: 'vendor-a', blockers: ['Correction scope conflict'], skippedReason: 'Correction scope conflict' },
    { vendorId: 'vendor-b', blockers: [], skippedReason: null, createdSettlementApprovalId: 'draft-b' },
    { vendorId: 'vendor-c', blockers: [], skippedReason: 'Not due' },
  ],
};

function appFixture() {
  let close: ((_instance: FastifyInstance, done: () => void) => void) | undefined;
  const addHook = vi.fn((name: string, hook: typeof close) => {
    if (name === 'onClose') close = hook;
  });
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return {
    app: { addHook, log } as unknown as FastifyInstance,
    addHook, log,
    close: () => close?.({} as FastifyInstance, () => undefined),
  };
}

afterEach(() => vi.useRealTimers());

describe('gated automatic settlement DRAFT scheduler', () => {
  it('does not register or run when its separate gate is disabled', () => {
    const { app, addHook } = appFixture();
    const runJob = vi.fn();
    expect(registerSettlementAutoDraftWriteScheduler(app, disabledEnv, { runJob: runJob as never })).toBeNull();
    expect(addHook).not.toHaveBeenCalled();
    expect(runJob).not.toHaveBeenCalled();
  });

  it.each([undefined, '', '24:00', '12:60', '7:00', '12:00Z'])
  ('fails closed without explicit UTC HH:mm configuration: %s', (time) => {
    const { app, addHook } = appFixture();
    expect(() => registerSettlementAutoDraftWriteScheduler(app, {
      ...disabledEnv, SETTLEMENT_AUTO_DRAFT_WRITE_SCHEDULER_ENABLED: true,
      SETTLEMENT_AUTO_DRAFT_WRITE_SCHEDULER_UTC_TIME: time,
    })).toThrow('SETTLEMENT_AUTO_DRAFT_WRITE_SCHEDULER_UTC_TIME');
    expect(addHook).not.toHaveBeenCalled();
  });

  it.each([
    { SETTLEMENT_AUTO_DRAFT_JOB_ENABLED: false, SETTLEMENT_AUTO_DRAFT_JOB_DRY_RUN: false },
    { SETTLEMENT_AUTO_DRAFT_JOB_ENABLED: true, SETTLEMENT_AUTO_DRAFT_JOB_DRY_RUN: true },
  ])('requires the existing job write gates too: %o', (gates) => {
    const { app, addHook } = appFixture();
    expect(() => registerSettlementAutoDraftWriteScheduler(app, {
      ...disabledEnv, ...gates,
      SETTLEMENT_AUTO_DRAFT_WRITE_SCHEDULER_ENABLED: true,
      SETTLEMENT_AUTO_DRAFT_WRITE_SCHEDULER_UTC_TIME: '01:00',
    })).toThrow('SETTLEMENT_AUTO_DRAFT_JOB_ENABLED=true');
    expect(addHook).not.toHaveBeenCalled();
  });

  it('uses the completed UTC day, explicit confirmation, and system provenance', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-25T00:59:59.000Z'));
    const { app, log, close } = appFixture();
    const runJob = vi.fn().mockResolvedValue(result);
    const env = {
      ...disabledEnv, SETTLEMENT_AUTO_DRAFT_WRITE_SCHEDULER_ENABLED: true,
      SETTLEMENT_AUTO_DRAFT_WRITE_SCHEDULER_UTC_TIME: '01:00',
    };
    const scheduler = registerSettlementAutoDraftWriteScheduler(app, env, { runJob: runJob as never });
    expect(registerSettlementAutoDraftWriteScheduler(app, env, { runJob: runJob as never })).toBe(scheduler);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(runJob).toHaveBeenCalledExactlyOnceWith({
      env: { SETTLEMENT_AUTO_DRAFT_JOB_ENABLED: true, SETTLEMENT_AUTO_DRAFT_JOB_DRY_RUN: false },
      runDate: '2026-06-24', confirmScheduledSettlementAutoDraftJob: true,
      triggeredBy: 'system:settlement_auto_draft_scheduler',
    });
    expect(log.info).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'COMPLETED', jobRunId: 'run-1', createdDrafts: 1, blocked: 1,
      blockedVendors: expect.arrayContaining([{ vendorId: 'vendor-a', reasons: ['Correction scope conflict'], skippedReason: 'Correction scope conflict' }]),
    }), expect.any(String));
    close();
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1_000);
    expect(runJob).toHaveBeenCalledTimes(1);
  });

  it('skips overlapping executions and never catches up on registration', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-25T01:01:00.000Z'));
    const { app, log, close } = appFixture();
    let finish!: (value: typeof result) => void;
    const pending = new Promise<typeof result>((resolve) => { finish = resolve; });
    const runJob = vi.fn().mockReturnValueOnce(pending).mockResolvedValue(result);
    const scheduler = registerSettlementAutoDraftWriteScheduler(app, {
      ...disabledEnv, SETTLEMENT_AUTO_DRAFT_WRITE_SCHEDULER_ENABLED: true,
      SETTLEMENT_AUTO_DRAFT_WRITE_SCHEDULER_UTC_TIME: '01:00',
    }, { runJob: runJob as never });
    expect(runJob).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(23 * 60 * 60 * 1_000 + 59 * 60 * 1_000);
    expect(runJob.mock.calls[0][0].runDate).toBe('2026-06-25');
    expect(await scheduler!.runWriteTick('2026-06-25')).toBeNull();
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1_000);
    expect(runJob).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith({ runDate: '2026-06-26' }, expect.any(String));
    finish(result);
    await Promise.resolve();
    close();
  });

  it.each(['FAILED', 'PROCESSING'])('reports an existing %s run without attempting a second write', async (status) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-25T00:59:59.000Z'));
    const { app, log, close } = appFixture();
    const runJob = vi.fn().mockResolvedValue({
      ...result, ok: false, writesPerformed: false,
      jobRun: { ...result.jobRun, status, recordedWritesPerformed: true },
      summary: { ...result.summary, createdDrafts: null, blocked: null },
    });
    registerSettlementAutoDraftWriteScheduler(app, {
      ...disabledEnv, SETTLEMENT_AUTO_DRAFT_WRITE_SCHEDULER_ENABLED: true,
      SETTLEMENT_AUTO_DRAFT_WRITE_SCHEDULER_UTC_TIME: '01:00',
    }, { runJob: runJob as never });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(log.warn).toHaveBeenCalledWith(expect.objectContaining({
      outcome: status, existingRun: true, writesPerformed: false,
      recordedWritesPerformed: true, createdDrafts: null,
    }), expect.any(String));
    expect(runJob).toHaveBeenCalledTimes(1);
    close();
  });

  it('reports uncertain persistence without an automatic same-day retry', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-25T00:59:59.000Z'));
    const { app, log, close } = appFixture();
    const runJob = vi.fn().mockRejectedValue(new Error('private financial detail'));
    registerSettlementAutoDraftWriteScheduler(app, {
      ...disabledEnv, SETTLEMENT_AUTO_DRAFT_WRITE_SCHEDULER_ENABLED: true,
      SETTLEMENT_AUTO_DRAFT_WRITE_SCHEDULER_UTC_TIME: '01:00',
    }, { runJob: runJob as never });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(log.error).toHaveBeenCalledWith({
      runDate: '2026-06-24', outcome: 'UNKNOWN', errorType: 'Error',
    }, expect.any(String));
    expect(JSON.stringify(log.error.mock.calls)).not.toContain('private financial detail');
    expect(runJob).toHaveBeenCalledTimes(1);
    close();
  });
});
