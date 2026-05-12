const DEFAULT_CURRENCY = 'TRY';

export function formatCurrency(amount: string | number | null | undefined, currency = DEFAULT_CURRENCY) {
  const value = Number(amount ?? 0);
  const safeValue = Number.isFinite(value) ? value : 0;

  return safeValue.toLocaleString('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function toTitleCaseLabel(value: string | null | undefined) {
  if (!value) {
    return 'Not available';
  }

  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

