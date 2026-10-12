/** Parse the bank-record wall time with an explicit UTC offset; never infer the browser timezone. */
export function parseAdminDeclaredEftTime(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) throw new Error('EFT time must include date, time and an explicit UTC offset.');
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fractionText, zone] = match;
  const [year, month, day, hour, minute, second] =
    [yearText, monthText, dayText, hourText, minuteText, secondText].map(Number);
  const millisecond = Number((fractionText ?? '').padEnd(3, '0'));
  const offsetHour = zone === 'Z' ? 0 : Number(zone.slice(1, 3));
  const offsetMinute = zone === 'Z' ? 0 : Number(zone.slice(4, 6));
  if (year < 1000 || offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0)) {
    throw new Error('EFT time or UTC offset is invalid.');
  }
  const offset = zone === 'Z' ? 0 : (zone[0] === '+' ? 1 : -1) * (offsetHour * 60 + offsetMinute);
  const instant = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond) - offset * 60_000);
  const local = new Date(instant.getTime() + offset * 60_000);
  if (!Number.isFinite(instant.getTime()) || local.getUTCFullYear() !== year ||
      local.getUTCMonth() + 1 !== month || local.getUTCDate() !== day ||
      local.getUTCHours() !== hour || local.getUTCMinutes() !== minute ||
      local.getUTCSeconds() !== second || local.getUTCMilliseconds() !== millisecond) {
    throw new Error('EFT date or time is invalid.');
  }
  return instant;
}
