const VENDOR_STORAGE_KEY = 'vendor-dashboard.current-vendor-id';

export type VendorId = 'demo-vendor-a' | 'demo-vendor-b';

export type VendorContext = {
  vendorId: VendorId;
  vendorName: string;
  scope: 'demo-multi-vendor';
};

const availableVendors = [
  {
    vendorId: 'demo-vendor-a',
    vendorName: 'Demo Vendor A',
    scope: 'demo-multi-vendor',
  },
  {
    vendorId: 'demo-vendor-b',
    vendorName: 'Demo Vendor B',
    scope: 'demo-multi-vendor',
  },
] as const satisfies readonly VendorContext[];

function isVendorId(value: string | null): value is VendorId {
  return value === 'demo-vendor-a' || value === 'demo-vendor-b';
}

export function getAvailableVendors() {
  return availableVendors;
}

export function setCurrentVendorId(vendorId: VendorId) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(VENDOR_STORAGE_KEY, vendorId);
}

export function getCurrentVendorContext(): VendorContext {
  if (typeof window === 'undefined') {
    return availableVendors[0];
  }

  const storedVendorId = window.localStorage.getItem(VENDOR_STORAGE_KEY);
  const vendorId = isVendorId(storedVendorId) ? storedVendorId : availableVendors[0].vendorId;

  if (!isVendorId(storedVendorId)) {
    window.localStorage.setItem(VENDOR_STORAGE_KEY, vendorId);
  }

  return availableVendors.find((vendor) => vendor.vendorId === vendorId) ?? availableVendors[0];
}
