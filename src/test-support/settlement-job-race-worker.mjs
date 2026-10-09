// Test-only independent process. The parent verifies and owns the disposable database.
process.on('message', async (message) => {
  if (message?.type !== 'START') return;
  // Explicit test-only clock offset from the verified disposable-DB parent.
  // Keep time progressing so lock/deadline tests retain real elapsed time.
  if (Number.isSafeInteger(message.testClockOffsetMs)) {
    const realNow = Date.now.bind(Date);
    Date.now = () => realNow() + message.testClockOffsetMs;
  }
  const startedAt = Date.now();
  try {
    const { runSettlementScheduleAutoDraftJob } = await import('../../backend/src/modules/finance/settlement-schedule-job.service.js');
    const result = await runSettlementScheduleAutoDraftJob({
      env: { SETTLEMENT_AUTO_DRAFT_JOB_ENABLED: true, SETTLEMENT_AUTO_DRAFT_JOB_DRY_RUN: false },
      runDate: message.runDate,
      confirmScheduledSettlementAutoDraftJob: true,
      triggeredBy: `test-worker-${process.pid}`,
    });
    process.send?.({ type: 'RESULT', startedAt, endedAt: Date.now(), result });
  } catch (error) {
    process.send?.({ type: 'ERROR', startedAt, endedAt: Date.now(), message: error instanceof Error ? error.message : String(error) });
  } finally {
    const { prisma } = await import('../../backend/src/db/prisma.js');
    await prisma.$disconnect();
    process.disconnect?.();
  }
});

process.send?.({ type: 'READY', pid: process.pid });
