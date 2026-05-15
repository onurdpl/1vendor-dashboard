import { runtimeServices } from '../../services/runtime-services';
import type { VendorFinancialProfile } from './contracts';

export function getFinanceDashboard(options: { vendorId?: string | null } = {}) {
  return runtimeServices.finance.dashboard(options.vendorId ?? undefined);
}

export function updateVendorFinancialProfile(
  vendorId: string,
  input: {
    commissionPercent: number;
    commissionVatPercent: number;
    deductShippingEnabled: boolean;
    shippingMode: VendorFinancialProfile['shippingMode'];
    fixedShippingFee: number | null;
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

export function createInvoiceExecution(financeLedgerEntryId: string) {
  return runtimeServices.finance.createInvoiceExecution(financeLedgerEntryId);
}

export function retryInvoiceExecution(invoiceExecutionId: string) {
  return runtimeServices.finance.retryInvoiceExecution(invoiceExecutionId);
}

export function getInvoiceExecutionResponseSummary(invoiceExecutionId: string) {
  return runtimeServices.finance.getInvoiceExecutionResponseSummary(invoiceExecutionId);
}
