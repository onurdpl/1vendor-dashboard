import { getCurrentUser, getCurrentUserVendorDetails } from './session';

const VENDOR_STORAGE_KEY = 'vendor-dashboard.current-vendor-id';
const VENDOR_CHANGE_EVENT = 'vendor-dashboard:vendor-change';

export type VendorId = string;

export type VendorContext = {
  vendorId: VendorId;
  vendorName: string;
  scope: string;
};

const defaultVendors = [
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

const missingVendorContext: VendorContext = {
  vendorId: '',
  vendorName: '',
  scope: 'missing-vendor-context',
};

function dispatchVendorChange() {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new Event(VENDOR_CHANGE_EVENT));
}

function getResolvedAvailableVendors(): readonly VendorContext[] {
  const currentUser = getCurrentUser();
  const vendorDetails = getCurrentUserVendorDetails();

  if (!currentUser) {
    return defaultVendors;
  }

  if (vendorDetails.length === 0) {
    return [];
  }

  return vendorDetails.map((vendor) => ({
    vendorId: vendor.vendorId,
    vendorName: vendor.vendorName,
    scope: 'runtime-vendor-context',
  }));
}

function resolveVendorIdForCurrentUser(storedVendorId: string | null) {
  const currentUser = getCurrentUser();
  const availableVendors = getResolvedAvailableVendors();

  if (availableVendors.length === 0) {
    return '';
  }

  if (!currentUser) {
    return storedVendorId && availableVendors.some((vendor) => vendor.vendorId === storedVendorId)
      ? storedVendorId
      : availableVendors[0].vendorId;
  }

  const allowedVendorIds = currentUser.vendorAccess.filter((vendorId) =>
    availableVendors.some((vendor) => vendor.vendorId === vendorId),
  );

  if (allowedVendorIds.length === 0) {
    return availableVendors[0].vendorId;
  }

  if (!currentUser.canSwitchVendors || allowedVendorIds.length === 1) {
    return allowedVendorIds[0];
  }

  if (storedVendorId && allowedVendorIds.includes(storedVendorId)) {
    return storedVendorId;
  }

  if (allowedVendorIds.includes(currentUser.defaultVendorId)) {
    return currentUser.defaultVendorId;
  }

  return allowedVendorIds[0];
}

export function getAvailableVendors() {
  return getResolvedAvailableVendors();
}

export function setCurrentVendorId(vendorId: VendorId) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(VENDOR_STORAGE_KEY, vendorId);
  dispatchVendorChange();
}

export function getCurrentVendorContext(): VendorContext {
  const availableVendors = getResolvedAvailableVendors();

  if (availableVendors.length === 0) {
    return missingVendorContext;
  }

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
