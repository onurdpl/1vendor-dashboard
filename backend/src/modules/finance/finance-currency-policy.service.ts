export const DEFAULT_FINANCE_CURRENCY = 'TRY';
export const SUPPORTED_FINANCE_CURRENCIES = [DEFAULT_FINANCE_CURRENCY] as const;

export type SupportedFinanceCurrency = (typeof SUPPORTED_FINANCE_CURRENCIES)[number];

export type FinanceCurrencyResolution =
  | {
      ok: true;
      currency: SupportedFinanceCurrency;
      usedDefault: boolean;
      unsupportedCurrency: null;
    }
  | {
      ok: false;
      currency: null;
      usedDefault: false;
      unsupportedCurrency: string;
    };

export function resolveFinanceCurrency(inputCurrency: string | null | undefined): FinanceCurrencyResolution {
  const normalized = inputCurrency?.trim().toUpperCase();

  if (!normalized) {
    return {
      ok: true,
      currency: DEFAULT_FINANCE_CURRENCY,
      usedDefault: true,
      unsupportedCurrency: null,
    };
  }

  if (normalized === DEFAULT_FINANCE_CURRENCY) {
    return {
      ok: true,
      currency: DEFAULT_FINANCE_CURRENCY,
      usedDefault: false,
      unsupportedCurrency: null,
    };
  }

  return {
    ok: false,
    currency: null,
    usedDefault: false,
    unsupportedCurrency: normalized,
  };
}
