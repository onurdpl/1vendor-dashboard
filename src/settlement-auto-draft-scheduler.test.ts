import type { FastifyInstance } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { registerPassiveSettlementAutoDraftScheduler } from '../backend/src/modules/finance/settlement-auto-draft-scheduler.service.js';

const disabledEnv = {
  SETTLEMENT_AUTO_DRAFT_SCHEDULER_ENABLED: false,
  SETTLEMENT_AUTO_DRAFT_JOB_ENABLED: true,
  SETTLEMENT_AUTO_DRAFT_JOB_DRY_RUN: false,
};

function appFixture() {
  let close: ((_instance: FastifyInstance, done: () => void) => void) | undefined;
  const addHook = vi.fn((name: string, hook: typeof close) => {
    if (name === 'onClose') close = hook;
  });
  return {
    app: { addHook } as unknown as FastifyInstance,
    addHook,
    close: () => close?.({} as FastifyInstance, () => undefined),
  };
}

describe('passive settlement auto-draft scheduler foundation', () => {
  it('does not register or invoke anything when disabled', () => {
    const { app, addHook } = appFixture();
    const runJob = vi.fn();
    const timer = vi.spyOn(globalThis, 'setInterval');
    try {
      expect(registerPassiveSettlementAutoDraftScheduler(app, disabledEnv, { runJob: runJob as never })).toBeNull();
      expect(addHook).not.toHaveBeenCalled();
      expect(timer).not.toHaveBeenCalled();
      expect(runJob).not.toHaveBeenCalled();
    } finally {
      timer.mockRestore();
    }
  });

  it('registers once but installs no timer or implicit runDate', async () => {
    const { app, addHook, close } = appFixture();
    const runJob = vi.fn().mockResolvedValue({ ok: true, writesPerformed: false });
    const timer = vi.spyOn(globalThis, 'setInterval');
    try {
      const env = { ...disabledEnv, SETTLEMENT_AUTO_DRAFT_SCHEDULER_ENABLED: true };
      const scheduler = registerPassiveSettlementAutoDraftScheduler(app, env, { runJob: runJob as never });
      expect(scheduler).not.toBeNull();
      expect(registerPassiveSettlementAutoDraftScheduler(app, env, { runJob: runJob as never })).toBe(scheduler);
      expect(addHook).toHaveBeenCalledTimes(1);
      expect(timer).not.toHaveBeenCalled();
      expect(runJob).not.toHaveBeenCalled();
      await expect(scheduler!.runReadOnlyTick(undefined as never)).rejects.toThrow('An explicit settlement runDate is required.');
      expect(runJob).not.toHaveBeenCalled();
      close();
      expect(await scheduler!.runReadOnlyTick('2026-06-24')).toBeNull();
      expect(runJob).not.toHaveBeenCalled();
    } finally {
      timer.mockRestore();
    }
  });

  it('prevents overlapping ticks and cannot authorize writes even with job write flags enabled', async () => {
    const { app, close } = appFixture();
    let finish!: (value: { ok: boolean; writesPerformed: boolean }) => void;
    const pending = new Promise<{ ok: boolean; writesPerformed: boolean }>((resolve) => { finish = resolve; });
    const runJob = vi.fn().mockReturnValueOnce(pending).mockResolvedValue({ ok: true, writesPerformed: false });
    const scheduler = registerPassiveSettlementAutoDraftScheduler(app,
      { ...disabledEnv, SETTLEMENT_AUTO_DRAFT_SCHEDULER_ENABLED: true },
      { runJob: runJob as never });
    expect(scheduler).not.toBeNull();

    const first = scheduler!.runReadOnlyTick('2026-06-24');
    expect(await scheduler!.runReadOnlyTick('2026-06-24')).toBeNull();
    expect(runJob).toHaveBeenCalledTimes(1);
    expect(runJob).toHaveBeenCalledWith({
      env: {
        SETTLEMENT_AUTO_DRAFT_JOB_ENABLED: true,
        SETTLEMENT_AUTO_DRAFT_JOB_DRY_RUN: true,
      },
      runDate: '2026-06-24',
      confirmScheduledSettlementAutoDraftJob: false,
    });
    finish({ ok: true, writesPerformed: false });
    await first;
    await scheduler!.runReadOnlyTick(new Date('2026-06-25T00:00:00.000Z'));
    expect(runJob).toHaveBeenCalledTimes(2);
    expect(runJob.mock.calls.every(([input]) => input.confirmScheduledSettlementAutoDraftJob === false &&
      input.env.SETTLEMENT_AUTO_DRAFT_JOB_DRY_RUN === true)).toBe(true);
    close();
    expect(await scheduler!.runReadOnlyTick('2026-06-26')).toBeNull();
  });
});
