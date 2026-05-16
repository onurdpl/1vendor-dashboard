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
    shipments: {
      providerConfig: (provider: string) => ['admin', 'shipments', 'provider-config', provider] as const,
    },
    support: {
      tickets: () => ['admin', 'support', 'tickets'] as const,
    },
  },
  dashboard: {
    overview: (vendorId = getCurrentVendorContext().vendorId) => ['dashboard', 'overview', vendorId] as const,
  },
  orders: {
    list: (vendorId = getCurrentVendorContext().vendorId) => ['orders', 'list', vendorId] as const,
    detail: (orderId: string, vendorId = getCurrentVendorContext().vendorId) => ['orders', 'detail', vendorId, orderId] as const,
  },
  returns: {
    list: (vendorId = getCurrentVendorContext().vendorId) => ['returns', 'list', vendorId] as const,
    detail: (returnId: string, vendorId = getCurrentVendorContext().vendorId) => ['returns', 'detail', vendorId, returnId] as const,
  },
  finance: {
    summary: (vendorId = getCurrentVendorContext().vendorId) => ['finance', 'summary', vendorId] as const,
    records: (vendorId = getCurrentVendorContext().vendorId) => ['finance', 'records', vendorId] as const,
    invoiceResponseSummary: (invoiceExecutionId: string) =>
      ['finance', 'invoice-response-summary', invoiceExecutionId] as const,
  },
  automation: {
    alerts: () => ['automation', 'alerts', getCurrentVendorContext().vendorId] as const,
    actions: () => ['automation', 'actions', getCurrentVendorContext().vendorId] as const,
  },
  notifications: {
    list: () => ['notifications', 'list', getCurrentVendorContext().vendorId] as const,
  },
} as const;
