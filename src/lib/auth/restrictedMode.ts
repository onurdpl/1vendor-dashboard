import { getCurrentVendorContext, type VendorContext } from './vendorContext';

export const RESTRICTED_ACCOUNT_TITLE = 'Account Restricted';
export const RESTRICTED_ACCOUNT_BODY =
  'Your account is temporarily restricted.\n\nYou can continue viewing orders, returns, payments, and contact support.\n\nOperational actions are temporarily unavailable.';
export const RESTRICTED_ACTION_MESSAGE = 'Unavailable while your account is restricted.';

export function isRestrictedVendorStatus(status: string | null | undefined) {
  return String(status ?? 'active').trim().toLowerCase() !== 'active';
}

export function isVendorContextRestricted(vendor: Pick<VendorContext, 'status'> | null | undefined) {
  return isRestrictedVendorStatus(vendor?.status);
}

export function isCurrentVendorRestricted() {
  return isVendorContextRestricted(getCurrentVendorContext());
}
