const DEFAULT_CURRENCY = 'TRY';
const DEFAULT_DATE_LOCALE = 'en-US';

export type SafeDateParts = {
  date: string;
  time: string;
};

export function parseSafeDate(value: string | number | Date | null | undefined) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function getSafeTimestamp(value: string | number | Date | null | undefined, fallback = Number.POSITIVE_INFINITY) {
  return parseSafeDate(value)?.getTime() ?? fallback;
}

export function formatDateTime(
  value: string | number | Date | null | undefined,
  options: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  },
  fallback = '—',
) {
  const date = parseSafeDate(value);
  if (!date) {
    return fallback;
  }

  try {
    return new Intl.DateTimeFormat(DEFAULT_DATE_LOCALE, options).format(date);
  } catch {
    return fallback;
  }
}

export function formatDateParts(
  value: string | number | Date | null | undefined,
  fallback: SafeDateParts = { date: '—', time: '' },
) {
  const date = parseSafeDate(value);
  if (!date) {
    return fallback;
  }

  return {
    date: formatDateTime(
      date,
      {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      },
      fallback.date,
    ),
    time: formatDateTime(
      date,
      {
        hour: '2-digit',
        minute: '2-digit',
      },
      fallback.time,
    ),
  };
}

export function safeArray<T>(value: readonly T[] | null | undefined): T[];
export function safeArray<T = unknown>(value: unknown): T[];
export function safeArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? [...(value as T[])] : [];
}

export function safeStatusLabel(value: string | null | undefined, fallback = 'Unknown') {
  return toTitleCaseLabel((value?.trim() || fallback).toLowerCase());
}

export function formatCurrency(amount: string | number | null | undefined, currency = DEFAULT_CURRENCY) {
  const value = Number(amount ?? 0);
  const safeValue = Number.isFinite(value) ? value : 0;
  const safeCurrency = /^[A-Z]{3}$/.test(currency) ? currency : DEFAULT_CURRENCY;

  try {
    return safeValue.toLocaleString('en-US', {
      style: 'currency',
      currency: safeCurrency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  } catch {
    return safeValue.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
}

export function toTitleCaseLabel(value: string | null | undefined) {
  if (!value) {
    return 'Not available';
  }

  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
