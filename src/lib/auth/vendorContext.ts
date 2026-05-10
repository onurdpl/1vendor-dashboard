export type VendorId = 'demo-vendor';

export type VendorContext = {
  vendorId: VendorId;
  vendorName: string;
  scope: 'single-vendor';
};

export function getCurrentVendorContext(): VendorContext {
  return {
    vendorId: 'demo-vendor',
    vendorName: 'Demo Vendor',
    scope: 'single-vendor',
  };
}
