import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerPassiveSettlementAutoDraftScheduler } from '../backend/src/modules/finance/settlement-auto-draft-scheduler.service.js';

const disabledEnv = {
  SETTLEMENT_AUTO_DRAFT_SCHEDULER_ENABLED: false,
  SETTLEMENT_AUTO_DRAFT_SCHEDULER_UTC_TIME: undefined,
  SETTLEMENT_AUTO_DRAFT_JOB_ENABLED: true,
  SETTLEMENT_AUTO_DRAFT_JOB_DRY_RUN: false,
};

const previewResult = {
  ok: true, writesPerformed: false, runDate: '2026-06-24', mode: 'DRY_RUN', jobRun: null,
  summary: { vendorsChecked: 3, dueVendors: 2, readyVendors: 1 },
  vendors: [
    { vendorId: 'vendor-a', state: 'BLOCKED', blockers: ['Correction scope conflict'] },
    { vendorId: 'vendor-b', state: 'READY', blockers: [] },
    { vendorId: 'vendor-c', state: 'NOT_DUE', blockers: [] },
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

describe('automatic read-only settlement scheduler', () => {
  it('does not register or schedule when disabled, even with write flags enabled', () => {
    const { app, addHook } = appFixture();
    const runJob = vi.fn();
    const timer = vi.spyOn(globalThis, 'setTimeout');
    try {
      expect(registerPassiveSettlementAutoDraftScheduler(app, disabledEnv, { runJob: runJob as never })).toBeNull();
      expect(addHook).not.toHaveBeenCalled();
      expect(timer).not.toHaveBeenCalled();
      expect(runJob).not.toHaveBeenCalled();
    } finally {
      timer.mockRestore();
    }
  });

  it.each([undefined, '', '24:00', '12:60', '7:00', '12:00Z'])
  ('fails closed without a valid explicit UTC time: %s', (time) => {
    const { app, addHook } = appFixture();
    expect(() => registerPassiveSettlementAutoDraftScheduler(app, {
      ...disabledEnv, SETTLEMENT_AUTO_DRAFT_SCHEDULER_ENABLED: true,
      SETTLEMENT_AUTO_DRAFT_SCHEDULER_UTC_TIME: time,
    })).toThrow('SETTLEMENT_AUTO_DRAFT_SCHEDULER_UTC_TIME');
    expect(addHook).not.toHaveBeenCalled();
  });

  it('runs at the configured UTC time for the last completed day and logs outcomes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-25T00:59:59.000Z'));
    const { app, addHook, log, close } = appFixture();
    const runJob = vi.fn().mockResolvedValue(previewResult);
    const env = {
      ...disabledEnv,
      SETTLEMENT_AUTO_DRAFT_SCHEDULER_ENABLED: true,
      SETTLEMENT_AUTO_DRAFT_SCHEDULER_UTC_TIME: '01:00',
      SETTLEMENT_AUTO_DRAFT_JOB_ENABLED: false,
    };
    const scheduler = registerPassiveSettlementAutoDraftScheduler(app, env, { runJob: runJob as never });
    expect(scheduler).not.toBeNull();
    expect(registerPassiveSettlementAutoDraftScheduler(app, env, { runJob: runJob as never })).toBe(scheduler);
    expect(addHook).toHaveBeenCalledTimes(1);
    expect(runJob).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(runJob).toHaveBeenCalledExactlyOnceWith({
      env: { SETTLEMENT_AUTO_DRAFT_JOB_ENABLED: true, SETTLEMENT_AUTO_DRAFT_JOB_DRY_RUN: true },
      runDate: '2026-06-24', confirmScheduledSettlementAutoDraftJob: false,
    });
    expect(log.info).toHaveBeenCalledWith({
      runDate: '2026-06-24', outcome: 'COMPLETED', vendorsChecked: 3,
      dueVendors: 2, readyVendors: 1, blockedVendorCount: 1,
      blockedVendors: [{ vendorId: 'vendor-a', reasons: ['Correction scope conflict'] }],
    }, expect.any(String));
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1_000);
    expect(runJob).toHaveBeenCalledTimes(2);
    expect(runJob.mock.calls[1][0].runDate).toBe('2026-06-25');
    close();
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1_000);
    expect(runJob).toHaveBeenCalledTimes(2);
  });

  it('does not catch up after UTC time and skips overlapping executions', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-25T01:01:00.000Z'));
    const { app, log, close } = appFixture();
    let finish!: (value: typeof previewResult) => void;
    const pending = new Promise<typeof previewResult>((resolve) => { finish = resolve; });
    const runJob = vi.fn().mockReturnValueOnce(pending).mockResolvedValue(previewResult);
    const scheduler = registerPassiveSettlementAutoDraftScheduler(app, {
      ...disabledEnv,
      SETTLEMENT_AUTO_DRAFT_SCHEDULER_ENABLED: true,
      SETTLEMENT_AUTO_DRAFT_SCHEDULER_UTC_TIME: '01:00',
    }, { runJob: runJob as never });
    expect(runJob).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(23 * 60 * 60 * 1_000 + 59 * 60 * 1_000);
    expect(runJob).toHaveBeenCalledTimes(1);
    expect(runJob.mock.calls[0][0].runDate).toBe('2026-06-25');
    expect(await scheduler!.runReadOnlyTick('2026-06-25')).toBeNull();
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1_000);
    expect(runJob).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith({ runDate: '2026-06-26' }, expect.any(String));
    finish(previewResult);
    await Promise.resolve();
    await scheduler!.runReadOnlyTick('2026-06-26');
    expect(runJob).toHaveBeenCalledTimes(2);
    close();
    expect(await scheduler!.runReadOnlyTick('2026-06-27')).toBeNull();
  });

  it('reports a failed preview without logging the exception message or scheduling a write', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-25T00:59:59.000Z'));
    const { app, log, close } = appFixture();
    const runJob = vi.fn().mockRejectedValue(new Error('private source detail'));
    registerPassiveSettlementAutoDraftScheduler(app, {
      ...disabledEnv,
      SETTLEMENT_AUTO_DRAFT_SCHEDULER_ENABLED: true,
      SETTLEMENT_AUTO_DRAFT_SCHEDULER_UTC_TIME: '01:00',
    }, { runJob: runJob as never });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(log.error).toHaveBeenCalledWith({
      runDate: '2026-06-24', outcome: 'FAILED', errorType: 'Error',
    }, expect.any(String));
    expect(runJob.mock.calls[0][0]).toMatchObject({
      env: { SETTLEMENT_AUTO_DRAFT_JOB_DRY_RUN: true },
      confirmScheduledSettlementAutoDraftJob: false,
    });
    close();
  });
});
