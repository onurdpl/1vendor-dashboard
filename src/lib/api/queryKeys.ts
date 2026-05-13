import { getCurrentVendorContext } from '../auth/vendorContext';

export const queryKeys = {
  admin: {
    diagnostics: {
      webhooks: () => ['admin', 'diagnostics', 'webhooks'] as const,
      webhookDetail: (webhookEventId: string) => ['admin', 'diagnostics', 'webhooks', webhookEventId] as const,
      syncEvents: () => ['admin', 'diagnostics', 'sync-events'] as const,
      reconciliation: () => ['admin', 'diagnostics', 'reconciliation'] as const,
      reconciliationAction: (id: string) => ['admin', 'diagnostics', 'reconciliation-action', id] as const,
    },
    operations: {
      queue: () => ['admin', 'operations', 'queue'] as const,
    },
    observability: {
      summary: () => ['admin', 'observability', 'summary'] as const,
      metrics: () => ['admin', 'observability', 'metrics'] as const,
    },
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
