export const queryKeys = {
  orders: {
    list: () => ['orders', 'list'] as const,
    detail: (orderId: string) => ['orders', 'detail', orderId] as const,
  },
  returns: {
    list: () => ['returns', 'list'] as const,
    detail: (returnId: string) => ['returns', 'detail', returnId] as const,
  },
  finance: {
    summary: () => ['finance', 'summary'] as const,
    records: () => ['finance', 'records'] as const,
  },
  automation: {
    alerts: () => ['automation', 'alerts'] as const,
    actions: () => ['automation', 'actions'] as const,
  },
} as const;
