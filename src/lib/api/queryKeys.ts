import { getCurrentVendorContext } from '../auth/vendorContext';

export const queryKeys = {
  admin: {
    orders: {
      breakdown: (shopifyOrderId: string) => ['admin', 'orders', 'breakdown', shopifyOrderId] as const,
    },
  },
  dashboard: {
    overview: () => ['dashboard', 'overview', getCurrentVendorContext().vendorId] as const,
  },
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
    alerts: () => ['automation', 'alerts', getCurrentVendorContext().vendorId] as const,
    actions: () => ['automation', 'actions', getCurrentVendorContext().vendorId] as const,
  },
} as const;
