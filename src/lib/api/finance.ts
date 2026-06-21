import { runtimeServices } from '../../services/runtime-services';
import type {
  SettlementScheduleAutoDraftJobResponse,
  SettlementScheduleAutoDraftJobStatusResponse,
  SettlementScheduleCreateDraftsResponse,
  SettlementScheduleDryRunResponse,
  VendorDebtHistory,
  VendorFinancialProfile,
} from './contracts';

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
    autoSettlementDraftEnabled: boolean;
    autoSettlementApproveEnabled: boolean;
    autoSettlementInvoiceEnabled: boolean;
  },
) {
  return runtimeServices.finance.updateProfile(vendorId, input);
}

export function getSettlementScheduleDryRun(options: {
  runDate?: string | null;
  vendorId?: string | null;
  limit?: number | null;
  signal?: AbortSignal;
} = {}): Promise<SettlementScheduleDryRunResponse> {
  return runtimeServices.finance.settlementScheduleDryRun(options, { signal: options.signal });
}

export function createSettlementScheduleDrafts(input: {
  runDate?: string | null;
  vendorId?: string | null;
  limit?: number | null;
  confirmAutoSettlementDrafts: true;
}): Promise<SettlementScheduleCreateDraftsResponse> {
  return runtimeServices.finance.createSettlementScheduleDrafts(input);
}

export function getSettlementScheduleAutoDraftJobStatus(options: {
  signal?: AbortSignal;
} = {}): Promise<SettlementScheduleAutoDraftJobStatusResponse> {
  return runtimeServices.finance.settlementScheduleAutoDraftJobStatus({ signal: options.signal });
}

export function runSettlementScheduleAutoDraftJob(input: {
  runDate?: string | null;
  confirmScheduledSettlementAutoDraftJob: true;
}): Promise<SettlementScheduleAutoDraftJobResponse> {
  return runtimeServices.finance.runSettlementScheduleAutoDraftJob(input);
}

export function acknowledgeFinanceIntegrityAlert(alertId: string, input: { note: string }) {
  return runtimeServices.finance.acknowledgeFinanceIntegrityAlert(alertId, input);
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
