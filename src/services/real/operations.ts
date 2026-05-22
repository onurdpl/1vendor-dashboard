import { apiClient } from '../../lib/api-client';
import type { OperationsAttentionDashboard, OperationsQueueItem } from '../../lib/api/contracts';

type OperationsResponseDto = {
  summary: {
    total: number;
    critical: number;
    warning: number;
    attention: number;
    normal: number;
    pendingReassignment: number;
    vendorBlocked: number;
    awaitingShipment: number;
    refundAttention: number;
    operationalSignals?: number;
    automationActions?: number;
  };
  items: Array<{
    id: string;
    type: OperationsQueueItem['type'];
    severity: 'critical' | 'warning' | 'attention' | 'normal';
    title: string;
    description: string;
    vendorId: string;
    vendorName: string;
    relatedOrderId: string | null;
    relatedShopifyOrderId: string | null;
    relatedReturnId: string | null;
    relatedRefundId: string | null;
    status: string;
    createdAt: string;
    actionLabel: string;
    destinationPath: string | null;
  }>;
};

function mapSeverity(severity: OperationsResponseDto['items'][number]['severity']): OperationsQueueItem['severity'] {
  if (severity === 'warning') {
    return 'high';
  }
  if (severity === 'attention') {
    return 'medium';
  }
  if (severity === 'normal') {
    return 'low';
  }
  return 'critical';
}

export async function listAdminOperationsQueue(options: { limit?: number; offset?: number; signal?: AbortSignal } = {}): Promise<OperationsQueueItem[]> {
  const params = new URLSearchParams();
  if (options.limit) params.set('limit', String(options.limit));
  if (options.offset) params.set('offset', String(options.offset));
  const response = await apiClient.get<OperationsResponseDto>(`/admin/operations${params.size ? `?${params.toString()}` : ''}`, {
    signal: options.signal,
  });

  return response.items.map((item) => ({
    id: item.id,
    type: item.type,
    severity: mapSeverity(item.severity),
    title: item.title,
    description: item.description,
    vendorId: item.vendorId,
    vendorName: item.vendorName,
    relatedOrderId: item.relatedOrderId ?? undefined,
    relatedShopifyOrderId: item.relatedShopifyOrderId ?? undefined,
    status: item.status,
    createdAt: item.createdAt,
    actionLabel: item.actionLabel,
    actionTo: item.destinationPath ?? undefined,
  }));
}

export async function getAdminOperationsAttention(options: { signal?: AbortSignal } = {}): Promise<OperationsAttentionDashboard> {
  return apiClient.get<OperationsAttentionDashboard>('/admin/operations/attention', { signal: options.signal });
}
