export type ShippingMode = 'disabled' | 'fixed' | 'external_provider';

export type VendorFinanceProfileConfig = {
  commissionPercent: number;
  commissionVatPercent: number;
  deductShippingEnabled: boolean;
  shippingMode: ShippingMode;
  fixedShippingFee: number | null;
  externalProviderShippingCost?: number | null;
  externalProviderShippingVatAmount?: number | null;
  shippingCostSource?: string | null;
  shippingCostProvider?: string | null;
  settlementDelayDays: number;
};

export type PayoutCalculationInput = {
  grossAmount: number;
  refundAmount: number;
  fulfilled: boolean;
  profile: VendorFinanceProfileConfig;
};

export type PayoutCalculationResult = {
  grossAmount: number;
  commission: number;
  commissionVat: number;
  shippingDeduction: number;
  shippingVatAmount: number;
  refundImpact: number;
  estimatedPayout: number;
  shippingApplied: boolean;
  shippingMode: ShippingMode;
  shippingDeductionSource: 'none' | 'fixed' | 'external_provider';
  shippingCostProvider: string | null;
};

export const DEFAULT_VENDOR_FINANCIAL_PROFILE: VendorFinanceProfileConfig = {
  commissionPercent: 10,
  commissionVatPercent: 0,
  deductShippingEnabled: false,
  shippingMode: 'disabled',
  fixedShippingFee: null,
  settlementDelayDays: 21,
};

function clampMoney(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.round(value * 100) / 100;
}

export function calculateVendorPayout(input: PayoutCalculationInput): PayoutCalculationResult {
  const grossAmount = clampMoney(Math.max(input.grossAmount, 0));
  const refundImpact = clampMoney(Math.max(input.refundAmount, 0));
  const commission = clampMoney(grossAmount * (Math.max(input.profile.commissionPercent, 0) / 100));
  const commissionVat = clampMoney(commission * (Math.max(input.profile.commissionVatPercent, 0) / 100));
  const shippingApplied =
    input.profile.deductShippingEnabled &&
    input.fulfilled &&
    ((input.profile.shippingMode === 'fixed' && Number(input.profile.fixedShippingFee ?? 0) > 0) ||
      (input.profile.shippingMode === 'external_provider' && Number(input.profile.externalProviderShippingCost ?? 0) > 0));
  const shippingVatAmount =
    shippingApplied && input.profile.shippingMode === 'external_provider'
      ? clampMoney(Number(input.profile.externalProviderShippingVatAmount ?? 0))
      : 0;
  const shippingDeduction =
    shippingApplied && input.profile.shippingMode === 'external_provider'
      ? clampMoney(Number(input.profile.externalProviderShippingCost ?? 0) + shippingVatAmount)
      : shippingApplied
        ? clampMoney(Number(input.profile.fixedShippingFee))
        : 0;
  const estimatedPayout = clampMoney(grossAmount - commission - commissionVat - shippingDeduction - refundImpact);

  return {
    grossAmount,
    commission,
    commissionVat,
    shippingDeduction,
    shippingVatAmount,
    refundImpact,
    estimatedPayout,
    shippingApplied,
    shippingMode: input.profile.shippingMode,
    shippingDeductionSource: shippingApplied
      ? input.profile.shippingMode === 'external_provider'
        ? 'external_provider'
        : 'fixed'
      : 'none',
    shippingCostProvider: input.profile.shippingCostProvider ?? null,
  };
}
