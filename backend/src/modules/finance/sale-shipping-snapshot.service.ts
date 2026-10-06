import {
  ShippingDeductionMode,
  VendorIntegrationProviderCode,
  VendorOutboundMethod,
  type VendorAllocation,
} from '@prisma/client';

/** New SALE authority only: a Sopyo-integrated vendor pays its own outbound carrier. */
export function vendorOwnedSopyoSaleShippingOverride(
  allocation: Pick<VendorAllocation, 'outboundMethodSnapshot' | 'outboundIntegrationProviderSnapshot'>,
) {
  if (
    allocation.outboundMethodSnapshot !== VendorOutboundMethod.VENDOR_INTEGRATION ||
    allocation.outboundIntegrationProviderSnapshot !== VendorIntegrationProviderCode.SOPYO
  ) {
    return {};
  }

  return {
    deductShippingEnabledSnapshot: false,
    shippingModeSnapshot: ShippingDeductionMode.DISABLED,
    fixedShippingFeeSnapshot: '0.00',
    shippingCostSnapshot: null,
    shippingVatAmountSnapshot: null,
    shippingCostSourceSnapshot: null,
    shippingCostProviderSnapshot: null,
    shippingCostIdSnapshot: null,
  };
}
