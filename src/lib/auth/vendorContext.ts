import { getCurrentUser } from './session';

const VENDOR_STORAGE_KEY = 'vendor-dashboard.current-vendor-id';
const VENDOR_CHANGE_EVENT = 'vendor-dashboard:vendor-change';

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

function dispatchVendorChange() {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new Event(VENDOR_CHANGE_EVENT));
}

function resolveVendorIdForCurrentUser(storedVendorId: string | null) {
  const currentUser = getCurrentUser();

  if (!currentUser) {
    return isVendorId(storedVendorId) ? storedVendorId : availableVendors[0].vendorId;
  }

  const allowedVendorIds = currentUser.vendorAccess.filter(isVendorId);

  if (allowedVendorIds.length === 0) {
    return availableVendors[0].vendorId;
  }

  if (!currentUser.canSwitchVendors || allowedVendorIds.length === 1) {
    return allowedVendorIds[0];
  }

  if (isVendorId(storedVendorId) && allowedVendorIds.includes(storedVendorId)) {
    return storedVendorId;
  }

  if (allowedVendorIds.includes(currentUser.defaultVendorId as VendorId)) {
    return currentUser.defaultVendorId as VendorId;
  }

  return allowedVendorIds[0];
}

export function getAvailableVendors() {
  return availableVendors;
}

export function setCurrentVendorId(vendorId: VendorId) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(VENDOR_STORAGE_KEY, vendorId);
  dispatchVendorChange();
}

export function getCurrentVendorContext(): VendorContext {
  if (typeof window === 'undefined') {
    return availableVendors[0];
  }

  const storedVendorId = window.localStorage.getItem(VENDOR_STORAGE_KEY);
  const vendorId = resolveVendorIdForCurrentUser(storedVendorId);

  if (storedVendorId !== vendorId) {
    window.localStorage.setItem(VENDOR_STORAGE_KEY, vendorId);
  }

  return availableVendors.find((vendor) => vendor.vendorId === vendorId) ?? availableVendors[0];
}

export function onVendorChange(handler: () => void) {
  if (typeof window === 'undefined') {
    return () => {};
  }

  window.addEventListener(VENDOR_CHANGE_EVENT, handler);

  return () => {
    window.removeEventListener(VENDOR_CHANGE_EVENT, handler);
  };
}
