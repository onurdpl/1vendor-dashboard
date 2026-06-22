import { apiClient } from '../../lib/api-client';
import type { OperationsAttentionDashboard, OperationsQueueDashboard, OperationsQueueItem } from '../../lib/api/contracts';

type OperationsResponseDto = {
  summary: OperationsSummaryDto;
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
    relatedShopifyOrderNumber?: string | null;
    relatedReturnId: string | null;
    relatedRefundId: string | null;
    status: string;
    createdAt: string;
    actionLabel: string;
    destinationPath: string | null;
    reassignmentRequired?: boolean;
  }>;
};

type OperationsSummaryDto = {
  total: number;
  critical: number;
  warning: number;
  attention: number;
  normal: number;
  pendingReassignment: number;
  vendorBlocked: number;
  awaitingShipment: number;
  refundAttention: number;
  financeIntegrityAlerts?: number;
  operationalSignals?: number;
  automationActions?: number;
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

function buildOperationsQueuePath(options: { limit?: number; offset?: number }) {
  const params = new URLSearchParams();
  if (options.limit) params.set('limit', String(options.limit));
  if (options.offset) params.set('offset', String(options.offset));

  return `/admin/operations${params.size ? `?${params.toString()}` : ''}`;
}

function mapOperationsSummary(summary: OperationsSummaryDto): OperationsQueueDashboard['summary'] {
  return {
    ...summary,
    financeIntegrityAlerts: summary.financeIntegrityAlerts ?? 0,
    operationalSignals: summary.operationalSignals ?? 0,
    automationActions: summary.automationActions ?? 0,
  };
}

function mapOperationsResponse(response: OperationsResponseDto): OperationsQueueDashboard {
  return {
    summary: mapOperationsSummary(response.summary),
    items: response.items.map((item) => ({
      id: item.id,
      type: item.type,
      severity: mapSeverity(item.severity),
      title: item.title,
      description: item.description,
      vendorId: item.vendorId,
      vendorName: item.vendorName,
      relatedOrderId: item.relatedOrderId ?? undefined,
      relatedShopifyOrderId: item.relatedShopifyOrderId ?? undefined,
      relatedShopifyOrderNumber: item.relatedShopifyOrderNumber ?? undefined,
      status: item.status,
      createdAt: item.createdAt,
      actionLabel: item.actionLabel,
      actionTo: item.destinationPath ?? undefined,
      reassignmentRequired: item.reassignmentRequired,
    })),
  };
}

export async function getAdminOperationsQueueDashboard(options: { limit?: number; offset?: number; signal?: AbortSignal; headers?: HeadersInit } = {}): Promise<OperationsQueueDashboard> {
  const response = await apiClient.get<OperationsResponseDto>(buildOperationsQueuePath(options), {
    signal: options.signal,
    headers: options.headers,
  });

  return mapOperationsResponse(response);
}

export async function getAdminOperationsQueueSummary(options: { signal?: AbortSignal; headers?: HeadersInit } = {}): Promise<OperationsQueueDashboard['summary']> {
  const response = await apiClient.get<OperationsSummaryDto>('/admin/operations/summary', {
    signal: options.signal,
    headers: options.headers,
  });

  return mapOperationsSummary(response);
}

export async function listAdminOperationsQueue(options: { limit?: number; offset?: number; signal?: AbortSignal; headers?: HeadersInit } = {}): Promise<OperationsQueueItem[]> {
  return (await getAdminOperationsQueueDashboard(options)).items;
}

export async function getAdminOperationsAttention(options: { signal?: AbortSignal } = {}): Promise<OperationsAttentionDashboard> {
  return apiClient.get<OperationsAttentionDashboard>('/admin/operations/attention', { signal: options.signal });
}
