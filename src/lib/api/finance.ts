import { runtimeServices } from '../../services/runtime-services';
import type { VendorDebtHistory, VendorFinancialProfile } from './contracts';

export function getFinanceDashboard(options: { vendorId?: string | null; signal?: AbortSignal } = {}) {
  return runtimeServices.finance.dashboard(options.vendorId ?? undefined, { signal: options.signal });
}

export function getFinanceProfile(options: { vendorId?: string | null; signal?: AbortSignal } = {}) {
  return runtimeServices.finance.profile(options.vendorId ?? undefined, { signal: options.signal });
}

export function getVendorDebtHistory(options: { vendorId?: string | null; signal?: AbortSignal } = {}): Promise<VendorDebtHistory> {
  return runtimeServices.finance.vendorDebtHistory(options.vendorId ?? undefined, { signal: options.signal });
}

export function getReturnFinanceRecords(options: {
  shopifyRefundId?: string | null;
  shopifyOrderNumber?: string | number | null;
  vendorId?: string | null;
  signal?: AbortSignal;
} = {}) {
  return runtimeServices.finance.returnRecords(
    {
      shopifyRefundId: options.shopifyRefundId,
      shopifyOrderNumber: options.shopifyOrderNumber,
      vendorId: options.vendorId,
    },
    { signal: options.signal },
  );
}

export function updateVendorFinancialProfile(
  vendorId: string,
  input: {
    commissionPercent: number;
    commissionVatPercent: number;
    deductShippingEnabled: boolean;
    shippingMode: VendorFinancialProfile['shippingMode'];
    fixedShippingFee: number | null;
    settlementDelayDays: number;
    settlementFrequencyType: VendorFinancialProfile['settlementFrequencyType'];
    weeklySettlementDay: VendorFinancialProfile['weeklySettlementDay'];
    monthlySettlementDay: number | null;
    autoSettlementDraftEnabled: boolean;
    autoSettlementApproveEnabled: boolean;
    autoSettlementInvoiceEnabled: boolean;
  },
) {
  return runtimeServices.finance.updateProfile(vendorId, input);
}

export function preparePayoutBatch(vendorId: string) {
  return runtimeServices.finance.preparePayoutBatch(vendorId);
}

export function attachShippingCost(input: {
  vendorId: string;
  financeLedgerEntryId: string;
  providerName: string;
  providerReference: string | null;
  shippingCost: number;
  shippingVatAmount: number | null;
  status: 'pending' | 'confirmed' | 'disputed' | 'ignored';
  sourceType: 'manual' | 'imported' | 'external_provider';
}) {
  return runtimeServices.finance.attachShippingCost(input);
}
