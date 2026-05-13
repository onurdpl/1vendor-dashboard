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
