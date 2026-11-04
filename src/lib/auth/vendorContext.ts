import { getCurrentUser, getCurrentUserVendorDetails, getToken, onSessionReset } from './session';
import { getAuthRestoreSnapshot } from './restoreState';
import { readSessionTransition } from './sessionTransition';
import { runtimeConfig } from '../../config/runtime';
import type { VendorStatus } from '../api/contracts';

const VENDOR_STORAGE_KEY = 'vendor-dashboard.current-vendor-id';
const VENDOR_CHANGE_EVENT = 'vendor-dashboard:vendor-change';

export type VendorId = string;

export type VendorContext = {
  vendorId: VendorId;
  vendorName: string;
  scope: string;
  status?: string;
  restrictionReason?: string | null;
  restrictionChangedByUserId?: string | null;
  restrictionChangedByEmail?: string | null;
  restrictionChangedAt?: string | null;
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

type AdminSelectionStatus = 'empty' | 'pending' | 'verified' | 'error';
let selectionGeneration = 0;
let verificationAttempt = 0;
let observedSession = '';
let observedVendorId = '';
let verifiedAdminVendor: VendorContext | null = null;
let adminSelectionStatus: AdminSelectionStatus = 'empty';

function adminSessionIdentity() {
  return JSON.stringify({
    user: getCurrentUser(),
    token: getToken(),
    transitionId: readSessionTransition()?.id ?? null,
    restoreAttemptId: getAuthRestoreSnapshot().restoreAttemptId,
  });
}

function invalidateAdminVerification() {
  selectionGeneration += 1;
  verificationAttempt += 1;
  verifiedAdminVendor = null;
  adminSelectionStatus = observedVendorId ? 'pending' : 'empty';
}

function syncAdminSelection() {
  if (typeof window === 'undefined') return;
  const session = adminSessionIdentity();
  const storedVendorId = window.localStorage.getItem(VENDOR_STORAGE_KEY) ?? '';
  const vendorId = storedVendorId.trim() ? storedVendorId : '';
  if (session !== observedSession || vendorId !== observedVendorId) {
    observedSession = session;
    observedVendorId = vendorId;
    invalidateAdminVerification();
  }
}

if (typeof window !== 'undefined') {
  onSessionReset(() => {
    syncAdminSelection();
    invalidateAdminVerification();
    dispatchVendorChange();
  });
  window.addEventListener('storage', (event) => {
    if (event.key !== null && ![
      VENDOR_STORAGE_KEY,
      'vendor-dashboard.current-user',
      'vendor-dashboard.session-token',
      'vendor-dashboard.session-transition',
    ].includes(event.key)) return;
    syncAdminSelection();
    invalidateAdminVerification();
    dispatchVendorChange();
  });
}

export function getAdminVendorSelection() {
  syncAdminSelection();
  return { vendorId: observedVendorId, status: adminSelectionStatus, generation: selectionGeneration };
}

export async function verifyAdminVendorSelection(
  loadStatus: (vendorId: string) => Promise<VendorStatus>,
  confirmMissing: (vendorId: string) => Promise<unknown>,
) {
  syncAdminSelection();
  if (runtimeConfig.apiMode !== 'real' || getCurrentUser()?.role !== 'admin' || !observedVendorId) return;
  const generation = selectionGeneration;
  const attempt = ++verificationAttempt;
  const session = observedSession;
  const vendorId = observedVendorId;
  const isCurrent = () => {
    syncAdminSelection();
    return generation === selectionGeneration && attempt === verificationAttempt
      && session === observedSession && vendorId === observedVendorId;
  };
  adminSelectionStatus = 'pending';
  verifiedAdminVendor = null;
  dispatchVendorChange();
  try {
    const result = await loadStatus(vendorId);
    if (!isCurrent()) return;
    if (result.vendorId !== vendorId || typeof result.vendorName !== 'string' || !result.vendorName.trim()
      || typeof result.status !== 'string' || !result.status.trim()) {
      adminSelectionStatus = 'error';
      return;
    }
    verifiedAdminVendor = {
      vendorId,
      vendorName: result.vendorName,
      scope: 'verified-admin-vendor-context',
      status: result.status,
      restrictionReason: result.restrictionReason,
      restrictionChangedByUserId: result.changedByUserId,
      restrictionChangedByEmail: result.changedByEmail,
      restrictionChangedAt: result.changedAt,
    };
    adminSelectionStatus = 'verified';
  } catch (error) {
    if (!isCurrent()) return;
    const status = error && typeof error === 'object' && 'status' in error ? error.status : null;
    if (status === 400 || status === 404) {
      try {
        await confirmMissing(vendorId);
      } catch (confirmationError) {
        if (!isCurrent()) return;
        const confirmationStatus = confirmationError && typeof confirmationError === 'object' && 'status' in confirmationError
          ? confirmationError.status : null;
        if (confirmationStatus === 404) {
          setCurrentVendorId('');
          return;
        }
      }
    }
    if (isCurrent()) adminSelectionStatus = 'error';
  } finally {
    if (isCurrent()) dispatchVendorChange();
  }
}

function dispatchVendorChange() {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new Event(VENDOR_CHANGE_EVENT));
}

function getResolvedAvailableVendors(): readonly VendorContext[] {
  const currentUser = getCurrentUser();
  const vendorDetails = getCurrentUserVendorDetails();
  if (currentUser?.role === 'admin' && runtimeConfig.apiMode === 'real') syncAdminSelection();

  if (!currentUser) {
    return defaultVendors;
  }

  if (vendorDetails.length === 0 && !(currentUser.role === 'admin' && verifiedAdminVendor)) {
    return [];
  }

  const available = vendorDetails.map((vendor) => ({
    vendorId: vendor.vendorId,
    vendorName: vendor.vendorName,
    scope: 'runtime-vendor-context',
    status: vendor.status ?? 'active',
    restrictionReason: vendor.restrictionReason ?? null,
    restrictionChangedByUserId: vendor.restrictionChangedByUserId ?? null,
    restrictionChangedByEmail: vendor.restrictionChangedByEmail ?? null,
    restrictionChangedAt: vendor.restrictionChangedAt ?? null,
  }));
  if (currentUser.role === 'admin' && runtimeConfig.apiMode === 'real') {
    syncAdminSelection();
    if (verifiedAdminVendor && !available.some((vendor) => vendor.vendorId === verifiedAdminVendor?.vendorId)) {
      return [...available, verifiedAdminVendor];
    }
  }
  return available;
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
  syncAdminSelection();
  dispatchVendorChange();
}

export function getCurrentVendorContext(): VendorContext {
  const currentUser = getCurrentUser();
  if (currentUser?.role === 'admin' && runtimeConfig.apiMode === 'real') {
    syncAdminSelection();
    return adminSelectionStatus === 'verified' && verifiedAdminVendor?.vendorId === observedVendorId
      ? verifiedAdminVendor
      : missingVendorContext;
  }
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
