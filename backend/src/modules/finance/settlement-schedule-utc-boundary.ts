export function scheduledDraftAvailableAt(runDate: Date): Date {
  if (Number.isNaN(runDate.getTime()) || runDate.getUTCHours() !== 0 ||
      runDate.getUTCMinutes() !== 0 || runDate.getUTCSeconds() !== 0 ||
      runDate.getUTCMilliseconds() !== 0) {
    throw new Error('scheduledRunDate must be a valid UTC calendar date.');
  }
  return new Date(runDate.getTime() + 86_400_000);
}

export function assertScheduledDraftDayComplete(runDate: Date, now: Date = new Date(Date.now())): void {
  const availableAt = scheduledDraftAvailableAt(runDate);
  if (now.getTime() < availableAt.getTime()) {
    throw new Error(`Scheduled settlement drafts for ${runDate.toISOString().slice(0, 10)} cannot be created before ${availableAt.toISOString()} (UTC day end).`);
  }
}

export function assertScheduledDraftMetadata(input: {
  vendorId: string;
  periodStart?: Date | null;
  periodEnd?: Date | null;
  asOfDate?: Date | null;
  candidateScope?: string | null;
  scheduledRunDate?: Date | null;
  scheduledPeriodEnd?: Date | null;
  scheduledCycleKey?: string | null;
}): void {
  const { scheduledRunDate, scheduledPeriodEnd, scheduledCycleKey, vendorId } = input;
  if (scheduledRunDate == null && scheduledPeriodEnd == null && scheduledCycleKey == null) return;
  if (!scheduledRunDate || !scheduledPeriodEnd || !scheduledCycleKey) {
    throw new Error('Scheduled settlement draft requires complete run date, period end, and cycle key metadata.');
  }
  const availableAt = scheduledDraftAvailableAt(scheduledRunDate);
  const expectedKey = `scheduled-settlement:${vendorId}:${scheduledRunDate.toISOString().slice(0, 10)}`;
  if (scheduledPeriodEnd.getTime() !== availableAt.getTime() - 1 || scheduledCycleKey !== expectedKey ||
      input.periodStart != null || input.periodEnd?.getTime() !== scheduledPeriodEnd.getTime() ||
      input.asOfDate?.getTime() !== scheduledPeriodEnd.getTime() || input.candidateScope !== 'date_range') {
    throw new Error('Scheduled settlement draft metadata does not match its UTC run date and vendor.');
  }
  assertScheduledDraftDayComplete(scheduledRunDate);
}
