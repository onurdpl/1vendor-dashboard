import { getCurrentVendorContext } from '../auth/vendorContext';

export const queryKeys = {
  orders: {
    list: () => ['orders', 'list', getCurrentVendorContext().vendorId] as const,
    detail: (orderId: string) => ['orders', 'detail', getCurrentVendorContext().vendorId, orderId] as const,
  },
  returns: {
    list: () => ['returns', 'list', getCurrentVendorContext().vendorId] as const,
    detail: (returnId: string) => ['returns', 'detail', getCurrentVendorContext().vendorId, returnId] as const,
  },
  finance: {
    summary: () => ['finance', 'summary', getCurrentVendorContext().vendorId] as const,
    records: () => ['finance', 'records', getCurrentVendorContext().vendorId] as const,
  },
  automation: {
    alerts: () => ['automation', 'alerts'] as const,
    actions: () => ['automation', 'actions'] as const,
  },
} as const;
