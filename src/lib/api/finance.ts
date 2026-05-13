import { runtimeServices } from '../../services/runtime-services';
import type { VendorFinancialProfile } from './contracts';

export function getFinanceDashboard() {
  return runtimeServices.finance.dashboard();
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
