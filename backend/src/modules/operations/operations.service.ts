import {
  AllocationStatus,
  type AutomationAction,
  AutomationActionStatus,
  AutomationExecutionMode,
  type OperationalSignal,
  OperationalSignalSeverity,
  OperationalSignalStatus,
} from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import type {
  OperationsActivityDto,
  OperationsAttentionDashboardDto,
  OperationsAttentionItemDto,
  OperationsAttentionSectionDto,
  OperationsAttentionSeverity,
  OperationsRecommendationDto,
  OperationsQueueDashboardDto,
  OperationsQueueItemDto,
  OperationsQueueSeverity,
  OperationsVendorRiskDto,
} from './operations.types.js';
import { evaluateOperationalSignals } from '../rules/rules.service.js';
import type { OperationalSignalSeverityDto } from '../rules/rules.types.js';
import { generateAutomationActionsForSignals } from '../automation/automation-actions.service.js';
import { deriveSupportSlaState } from '../support/support.service.js';
import { logDashboardTiming, startDashboardTimer, withDashboardTiming } from '../../lib/dashboard-timing.js';

const ONE_HOUR_MS = 60 * 60 * 1000;
const UNRESOLVED_SUPPORT_STATUSES = new Set(['OPEN', 'IN_REVIEW', 'WAITING_FOR_VENDOR']);
const CLOSED_RETURN_STATUSES = new Set(['processed', 'refunded', 'closed', 'cancelled', 'declined', 'rejected']);
const ACTIVE_AUTOMATION_ACTION_STATUSES = [
  AutomationActionStatus.PENDING,
  AutomationActionStatus.SUGGESTED,
  AutomationActionStatus.FAILED,
];

function hoursSince(value: Date, now = new Date()) {
  return Math.max(0, Math.round(((now.getTime() - value.getTime()) / ONE_HOUR_MS) * 10) / 10);
}

export function deriveOperationalSeverity(input: {
  ageHours?: number;
  overdue?: boolean;
  priority?: string | null;
  status?: string | null;
}): OperationsAttentionSeverity {
  const priority = input.priority?.trim().toLowerCase();
  const status = input.status?.trim().toLowerCase();
  if (input.overdue || priority === 'high' || status === 'failed' || status === 'held' || status === 'disputed') {
    return 'critical';
  }
  if ((input.ageHours ?? 0) >= 24 || status === 'pending' || status === 'open' || status === 'needs_review') {
    return 'warning';
  }
  return 'info';
}

function mapAttentionSeverity(severity: OperationsQueueSeverity): OperationsAttentionSeverity {
  if (severity === 'critical') {
    return 'critical';
  }
  if (severity === 'warning' || severity === 'attention') {
    return 'warning';
  }
  return 'info';
}

function getSeverityWeight(severity: OperationsAttentionSeverity) {
  if (severity === 'critical') {
    return 0;
  }
  if (severity === 'warning') {
    return 1;
  }
  return 2;
}

function getAttentionSection(
  key: OperationsAttentionSectionDto['key'],
  title: string,
  items: OperationsAttentionItemDto[],
): OperationsAttentionSectionDto {
  const sectionItems = items.filter((item) => item.type === key).slice(0, 5);
  return {
    key,
    title,
    count: items.filter((item) => item.type === key).length,
    critical: items.filter((item) => item.type === key && item.severity === 'critical').length,
    warning: items.filter((item) => item.type === key && item.severity === 'warning').length,
    items: sectionItems,
  };
}

export function buildVendorRiskSummaries(items: OperationsAttentionItemDto[]): OperationsVendorRiskDto[] {
  const grouped = new Map<string, OperationsAttentionItemDto[]>();
  for (const item of items) {
    if (item.vendorId === 'platform') {
      continue;
    }
    const list = grouped.get(item.vendorId) ?? [];
    list.push(item);
    grouped.set(item.vendorId, list);
  }

  return [...grouped.entries()]
    .map(([vendorId, vendorItems]) => {
      const criticalItems = vendorItems.filter((item) => item.severity === 'critical').length;
      const warningItems = vendorItems.filter((item) => item.severity === 'warning').length;
      const supportItems = vendorItems.filter((item) => item.type === 'support').length;
      const shipmentItems = vendorItems.filter((item) => item.type === 'shipment').length;
      const returnItems = vendorItems.filter((item) => item.type === 'return').length;
      const financeItems = vendorItems.filter((item) => item.type === 'finance').length;
      const drivers = [
        supportItems ? `${supportItems} support item${supportItems === 1 ? '' : 's'}` : null,
        shipmentItems ? `${shipmentItems} shipment item${shipmentItems === 1 ? '' : 's'}` : null,
        returnItems ? `${returnItems} return item${returnItems === 1 ? '' : 's'}` : null,
        financeItems ? `${financeItems} finance item${financeItems === 1 ? '' : 's'}` : null,
      ].filter((driver): driver is string => Boolean(driver));

      const riskLevel: OperationsAttentionSeverity =
        criticalItems > 0 || vendorItems.length >= 5 ? 'critical' : warningItems > 0 || vendorItems.length >= 2 ? 'warning' : 'info';

      return {
        vendorId,
        vendorName: vendorItems[0]?.vendorName ?? vendorId,
        riskLevel,
        totalAttentionItems: vendorItems.length,
        criticalItems,
        warningItems,
        supportItems,
        shipmentItems,
        returnItems,
        financeItems,
        drivers,
      };
    })
    .sort((left, right) => {
      const severityDelta = getSeverityWeight(left.riskLevel) - getSeverityWeight(right.riskLevel);
      if (severityDelta !== 0) {
        return severityDelta;
      }
      return right.totalAttentionItems - left.totalAttentionItems;
    })
    .slice(0, 8);
}

function getRecommendationForAttentionItem(item: OperationsAttentionItemDto): Pick<
  OperationsRecommendationDto,
  'type' | 'title' | 'description' | 'recommendedAction' | 'vendorVisible'
> | null {
  const status = item.status.trim().toLowerCase();
  const title = item.title.trim().toLowerCase();

  if (item.type === 'support') {
    if (item.severity === 'critical' || title.includes('overdue')) {
      return {
        type: 'support_escalation',
        title: 'Escalate overdue support request',
        description: `${item.objectReference} needs an admin response.`,
        recommendedAction: 'Review owner, respond, or move the ticket to the correct waiting state',
        vendorVisible: false,
      };
    }

    return {
      type: 'support_assignment',
      title: 'Assign support ownership',
      description: `${item.objectReference} is active and needs a clear owner.`,
      recommendedAction: 'Assign an operator and respond to the vendor',
      vendorVisible: false,
    };
  }

  if (item.type === 'shipment') {
    if (status === 'failed') {
      return {
        type: 'shipment_stale',
        title: 'Review failed shipment update',
        description: `${item.objectReference} needs shipment follow-up before tracking can be trusted.`,
        recommendedAction: 'Open the order and review carrier status',
        vendorVisible: true,
      };
    }

    return {
      type: item.ageHours >= 24 ? 'shipment_stale' : 'shipment_tracking',
      title: item.ageHours >= 24 ? 'Review stale shipment update' : 'Review shipment tracking',
      description: `${item.objectReference} is waiting for tracking or carrier progress.`,
      recommendedAction: 'Open the order and verify shipment tracking',
      vendorVisible: true,
    };
  }

  if (item.type === 'return') {
    const refundRelated = item.description.toLowerCase().includes('refund') || status.includes('refund');
    return {
      type: refundRelated ? 'return_refund' : 'return_review',
      title: refundRelated ? 'Review refund approval' : 'Review unresolved return',
      description: `${item.objectReference} is still waiting for return progress.`,
      recommendedAction: 'Open the return and review the next vendor action',
      vendorVisible: true,
    };
  }

  if (item.type === 'finance') {
    return {
      type: 'finance_review',
      title: 'Review payout issue',
      description: `${item.objectReference} needs finance operator review.`,
      recommendedAction: 'Open finance and review payout status',
      vendorVisible: false,
    };
  }

  if (item.type === 'automation' || item.type === 'operational_signal') {
    return {
      type: 'automation_review',
      title: 'Review operational suggestion',
      description: `${item.objectReference} has a suggested operator action.`,
      recommendedAction: 'Open the signal and decide the next manual step',
      vendorVisible: false,
    };
  }

  return null;
}

function createAttentionRecommendation(item: OperationsAttentionItemDto): OperationsRecommendationDto | null {
  const recommendation = getRecommendationForAttentionItem(item);
  if (!recommendation) {
    return null;
  }

  return {
    id: `recommendation-${item.id}`,
    type: recommendation.type,
    severity: item.severity,
    title: recommendation.title,
    description: recommendation.description,
    recommendedAction: recommendation.recommendedAction,
    relatedObjectType: item.objectType,
    relatedObjectId: item.objectId,
    vendor: {
      id: item.vendorId,
      name: item.vendorName,
    },
    createdFromSignal: item.id,
    deepLink: item.destinationPath,
    vendorVisible: recommendation.vendorVisible,
    createdAt: item.createdAt,
  };
}

function createVendorRiskRecommendation(risk: OperationsVendorRiskDto, generatedAt: string): OperationsRecommendationDto | null {
  if (risk.riskLevel === 'info') {
    return null;
  }

  return {
    id: `recommendation-vendor-risk-${risk.vendorId}`,
    type: 'vendor_risk',
    severity: risk.riskLevel,
    title: 'Review vendor operational risk',
    description: `${risk.vendorName} has ${risk.totalAttentionItems} active attention item${risk.totalAttentionItems === 1 ? '' : 's'}${
      risk.drivers.length ? `: ${risk.drivers.join(', ')}` : ''
    }.`,
    recommendedAction: 'Review vendor drivers and prioritize the highest severity item',
    relatedObjectType: 'Vendor',
    relatedObjectId: risk.vendorId,
    vendor: {
      id: risk.vendorId,
      name: risk.vendorName,
    },
    createdFromSignal: `vendor-risk:${risk.vendorId}`,
    deepLink: '/admin/operations',
    vendorVisible: false,
    createdAt: generatedAt,
  };
}

export function buildOperationalRecommendations(
  items: OperationsAttentionItemDto[],
  vendorRisks: OperationsVendorRiskDto[],
  generatedAt = new Date().toISOString(),
): OperationsRecommendationDto[] {
  const recommendations = [
    ...items.map(createAttentionRecommendation).filter((item): item is OperationsRecommendationDto => Boolean(item)),
    ...vendorRisks
      .map((risk) => createVendorRiskRecommendation(risk, generatedAt))
      .filter((item): item is OperationsRecommendationDto => Boolean(item)),
  ];

  const unique = new Map<string, OperationsRecommendationDto>();
  for (const recommendation of recommendations) {
    unique.set(recommendation.id, recommendation);
  }

  return [...unique.values()]
    .sort((left, right) => {
      const severityDelta = getSeverityWeight(left.severity) - getSeverityWeight(right.severity);
      if (severityDelta !== 0) {
        return severityDelta;
      }
      return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
    })
    .slice(0, 12);
}

function isAwaitingShipment(fulfillmentStatus: string, shippingStatus: string) {
  const fulfillment = fulfillmentStatus.trim().toLowerCase();
  const shipping = shippingStatus.trim().toLowerCase();
  return (
    fulfillment === 'processing' ||
    fulfillment === 'pending' ||
    shipping === 'awaiting shipment' ||
    shipping === 'awaiting_shipment'
  );
}

function insensitiveEquals(value: string) {
  return {
    equals: value,
    mode: 'insensitive' as const,
  };
}

function readSignalSeverityCount(
  groups: Array<{ severity: OperationalSignalSeverity; _count: { _all: number } }>,
  severity: OperationalSignalSeverity,
) {
  return groups.find((group) => group.severity === severity)?._count._all ?? 0;
}

export async function getAdminOperationsQueueSummary(): Promise<OperationsQueueDashboardDto['summary']> {
  const [
    pendingReassignment,
    vendorBlocked,
    awaitingShipment,
    refundAttention,
    signalSeverityGroups,
    automationActions,
    automationAutoSafe,
  ] = await Promise.all([
    withDashboardTiming('operations.summary.pending_reassignment_count', () =>
      prisma.vendorAllocation.count({
        where: {
          OR: [
            { reassignmentRequired: true },
            { allocationStatus: AllocationStatus.PENDING_REASSIGNMENT },
          ],
        },
      }),
    ),
    withDashboardTiming('operations.summary.vendor_blocked_count', () =>
      prisma.vendorAllocation.count({
        where: {
          allocationStatus: AllocationStatus.VENDOR_BLOCKED,
        },
      }),
    ),
    withDashboardTiming('operations.summary.awaiting_shipment_count', () =>
      prisma.vendorAllocation.count({
        where: {
          OR: [
            { fulfillmentStatus: insensitiveEquals('processing') },
            { fulfillmentStatus: insensitiveEquals('pending') },
            { shippingStatus: insensitiveEquals('awaiting shipment') },
            { shippingStatus: insensitiveEquals('awaiting_shipment') },
          ],
        },
      }),
    ),
    withDashboardTiming('operations.summary.refund_attention_count', () =>
      prisma.returnRecord.count({
        where: {
          status: {
            in: ['pending', 'open', 'needs_review'],
          },
        },
      }),
    ),
    withDashboardTiming('operations.summary.operational_signal_group_count', () =>
      prisma.operationalSignal.groupBy({
        by: ['severity'],
        where: {
          status: OperationalSignalStatus.ACTIVE,
        },
        _count: {
          _all: true,
        },
      }),
    ),
    withDashboardTiming('operations.summary.automation_action_count', () =>
      prisma.automationAction.count({
        where: {
          status: {
            in: ACTIVE_AUTOMATION_ACTION_STATUSES,
          },
        },
      }),
    ),
    withDashboardTiming('operations.summary.automation_auto_safe_count', () =>
      prisma.automationAction.count({
        where: {
          status: {
            in: ACTIVE_AUTOMATION_ACTION_STATUSES,
          },
          executionMode: AutomationExecutionMode.AUTO_SAFE,
        },
      }),
    ),
  ]);

  const criticalSignals = readSignalSeverityCount(signalSeverityGroups, OperationalSignalSeverity.CRITICAL);
  const highSignals = readSignalSeverityCount(signalSeverityGroups, OperationalSignalSeverity.HIGH);
  const warningSignals = readSignalSeverityCount(signalSeverityGroups, OperationalSignalSeverity.WARNING);
  const infoSignals = readSignalSeverityCount(signalSeverityGroups, OperationalSignalSeverity.INFO);
  const operationalSignals = criticalSignals + highSignals + warningSignals + infoSignals;
  const manualAutomationActions = Math.max(0, automationActions - automationAutoSafe);

  return {
    total: pendingReassignment + vendorBlocked + awaitingShipment + refundAttention + operationalSignals + automationActions,
    critical: pendingReassignment + criticalSignals,
    warning: vendorBlocked + highSignals,
    attention: awaitingShipment + refundAttention + warningSignals + automationAutoSafe,
    normal: infoSignals + manualAutomationActions,
    pendingReassignment,
    vendorBlocked,
    awaitingShipment,
    refundAttention,
    operationalSignals,
    automationActions,
  };
}

function getSeverityRank(severity: OperationsQueueSeverity) {
  if (severity === 'critical') {
    return 0;
  }
  if (severity === 'warning') {
    return 1;
  }
  if (severity === 'attention') {
    return 2;
  }
  return 3;
}

function mapSignalSeverity(severity: OperationalSignalSeverityDto): OperationsQueueSeverity {
  if (severity === 'critical') {
    return 'critical';
  }
  if (severity === 'high') {
    return 'warning';
  }
  if (severity === 'warning') {
    return 'attention';
  }
  return 'normal';
}

function getSignalRelatedShopifyOrderId(signal: OperationalSignal) {
  if (typeof signal.metadata !== 'object' || signal.metadata === null || Array.isArray(signal.metadata)) {
    return null;
  }

  if (!('sourceShopifyOrderId' in signal.metadata)) {
    return null;
  }

  const sourceShopifyOrderId = signal.metadata.sourceShopifyOrderId;
  return sourceShopifyOrderId === null || sourceShopifyOrderId === undefined
    ? null
    : String(sourceShopifyOrderId);
}

function mapPersistedSignalToQueueItem(signal: OperationalSignal): OperationsQueueItemDto {
  const relatedShopifyOrderId = getSignalRelatedShopifyOrderId(signal);

  return {
    id: `op-signal-${signal.id}`,
    type: 'operational_signal',
    severity: mapSignalSeverity(signal.severity.trim().toLowerCase() as OperationalSignalSeverityDto),
    title: signal.title,
    description: signal.description,
    vendorId: signal.vendorId ?? 'platform',
    vendorName: signal.vendorId ?? 'Platform',
    relatedOrderId: signal.allocationId,
    relatedShopifyOrderId,
    relatedReturnId: null,
    relatedRefundId: null,
    status: signal.status.trim().toLowerCase(),
    createdAt: signal.triggeredAt.toISOString(),
    actionLabel: signal.suggestedAction ? 'Review signal' : 'Inspect signal',
    destinationPath: relatedShopifyOrderId ? `/admin/orders/${relatedShopifyOrderId}` : '/admin/operations',
  };
}

function mapPersistedAutomationActionToQueueItem(action: AutomationAction): OperationsQueueItemDto | null {
  if (
    action.status !== AutomationActionStatus.SUGGESTED &&
    action.status !== AutomationActionStatus.PENDING &&
    action.status !== AutomationActionStatus.FAILED
  ) {
    return null;
  }

  return {
    id: `op-automation-${action.id}`,
    type: 'automation_action',
    severity: action.executionMode === AutomationExecutionMode.AUTO_SAFE ? 'attention' : 'normal',
    title: action.title,
    description: action.description,
    vendorId: action.vendorId ?? 'platform',
    vendorName: action.vendorId ?? 'Platform',
    relatedOrderId: action.allocationId,
    relatedShopifyOrderId: null,
    relatedReturnId: null,
    relatedRefundId: null,
    status: action.status.trim().toLowerCase(),
    createdAt: action.createdAt.toISOString(),
    actionLabel: action.executionMode === AutomationExecutionMode.AUTO_SAFE ? 'Review safe action' : 'Review suggestion',
    destinationPath: '/admin/operations',
  };
}

export async function getAdminOperationsQueue(options: { limit?: number; offset?: number } = {}): Promise<OperationsQueueDashboardDto> {
  const offset = options.offset ?? 0;
  const limit = options.limit ?? 100;
  const candidateTake = offset + limit;
  const allocations = await withDashboardTiming('operations.allocation_fetch', () => prisma.vendorAllocation.findMany({
    select: {
      id: true,
      assignedVendorId: true,
      allocationStatus: true,
      fulfillmentStatus: true,
      shippingStatus: true,
      reassignmentRequired: true,
      updatedAt: true,
      assignedVendor: {
        select: {
          name: true,
        },
      },
      returnRecords: {
        select: {
          id: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: 1,
      },
      refundRecords: {
        select: {
          sourceShopifyRefundId: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: 1,
      },
      order: {
        select: {
          sourceShopifyOrderId: true,
        },
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
    take: candidateTake,
  }));

  const items: OperationsQueueItemDto[] = [];
  const allocationAggregationStartedAt = startDashboardTimer();

  for (const allocation of allocations) {
    const vendorName = allocation.assignedVendor.name;
    const orderId = allocation.id;
    const shopifyOrderId = allocation.order.sourceShopifyOrderId;

    if (allocation.reassignmentRequired || allocation.allocationStatus === 'PENDING_REASSIGNMENT') {
      items.push({
        id: `op-pending-${allocation.id}`,
        type: 'pending_reassignment',
        severity: 'critical',
        title: 'Pending vendor reassignment',
        description: `Allocation ${allocation.id} requires reassignment review.`,
        vendorId: allocation.assignedVendorId,
        vendorName,
        relatedOrderId: orderId,
        relatedShopifyOrderId: shopifyOrderId,
        relatedReturnId: allocation.returnRecords[0]?.id ?? null,
        relatedRefundId: allocation.refundRecords[0]?.sourceShopifyRefundId ?? null,
        status: allocation.allocationStatus.toLowerCase(),
        createdAt: allocation.updatedAt.toISOString(),
        actionLabel: 'Review allocation',
        destinationPath: `/admin/orders/${shopifyOrderId}`,
      });
    }

    if (allocation.allocationStatus === 'VENDOR_BLOCKED') {
      items.push({
        id: `op-blocked-${allocation.id}`,
        type: 'vendor_blocked',
        severity: 'warning',
        title: 'Vendor blocked allocation',
        description: `Vendor ${vendorName} marked allocation ${allocation.id} as blocked.`,
        vendorId: allocation.assignedVendorId,
        vendorName,
        relatedOrderId: orderId,
        relatedShopifyOrderId: shopifyOrderId,
        relatedReturnId: allocation.returnRecords[0]?.id ?? null,
        relatedRefundId: allocation.refundRecords[0]?.sourceShopifyRefundId ?? null,
        status: allocation.allocationStatus.toLowerCase(),
        createdAt: allocation.updatedAt.toISOString(),
        actionLabel: 'Investigate blocker',
        destinationPath: `/admin/orders/${shopifyOrderId}`,
      });
    }

    if (isAwaitingShipment(allocation.fulfillmentStatus, allocation.shippingStatus)) {
      items.push({
        id: `op-shipment-${allocation.id}`,
        type: 'awaiting_shipment',
        severity: 'attention',
        title: 'Awaiting shipment update',
        description: `Allocation ${allocation.id} is waiting for shipment progress.`,
        vendorId: allocation.assignedVendorId,
        vendorName,
        relatedOrderId: orderId,
        relatedShopifyOrderId: shopifyOrderId,
        relatedReturnId: null,
        relatedRefundId: null,
        status: allocation.shippingStatus.toLowerCase(),
        createdAt: allocation.updatedAt.toISOString(),
        actionLabel: 'Check fulfillment',
        destinationPath: `/admin/orders/${shopifyOrderId}`,
      });
    }
  }
  logDashboardTiming('operations.allocation_aggregation', allocationAggregationStartedAt);

  const pendingReturns = await withDashboardTiming('operations.pending_return_fetch', () => prisma.returnRecord.findMany({
    where: {
      status: {
        in: ['pending', 'open', 'needs_review'],
      },
    },
    select: {
      id: true,
      status: true,
      createdAt: true,
      vendorAllocation: {
        select: {
          id: true,
          assignedVendorId: true,
          assignedVendor: {
            select: {
              name: true,
            },
          },
          order: {
            select: {
              sourceShopifyOrderId: true,
            },
          },
          refundRecords: {
            select: {
              sourceShopifyRefundId: true,
            },
            orderBy: {
              createdAt: 'desc',
            },
            take: 1,
          },
        },
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
    take: candidateTake,
  }));

  const returnAggregationStartedAt = startDashboardTimer();
  for (const returnRecord of pendingReturns) {
    items.push({
      id: `op-refund-${returnRecord.id}`,
      type: 'refund_attention',
      severity: 'attention',
      title: 'Refund requires attention',
      description: `Return ${returnRecord.id} is pending review.`,
      vendorId: returnRecord.vendorAllocation.assignedVendorId,
      vendorName: returnRecord.vendorAllocation.assignedVendor.name,
      relatedOrderId: returnRecord.vendorAllocation.id,
      relatedShopifyOrderId: returnRecord.vendorAllocation.order.sourceShopifyOrderId,
      relatedReturnId: returnRecord.id,
      relatedRefundId: returnRecord.vendorAllocation.refundRecords[0]?.sourceShopifyRefundId ?? null,
      status: returnRecord.status.toLowerCase(),
      createdAt: returnRecord.createdAt.toISOString(),
      actionLabel: 'Review return',
      destinationPath: `/admin/orders/${returnRecord.vendorAllocation.order.sourceShopifyOrderId}`,
    });
  }
  logDashboardTiming('operations.return_aggregation', returnAggregationStartedAt);

  const signals = await withDashboardTiming('operations.operational_signals_fetch', () => prisma.operationalSignal.findMany({
    where: {
      status: OperationalSignalStatus.ACTIVE,
    },
    orderBy: [
      {
        severity: 'desc',
      },
      {
        triggeredAt: 'desc',
      },
    ],
    take: 100,
  }));
  const signalAggregationStartedAt = startDashboardTimer();
  for (const signal of signals) {
    items.push(mapPersistedSignalToQueueItem(signal));
  }
  logDashboardTiming('operations.signal_aggregation', signalAggregationStartedAt);

  const automationActions = await withDashboardTiming('operations.automation_actions_fetch', () => prisma.automationAction.findMany({
    where: {
      status: {
        in: ACTIVE_AUTOMATION_ACTION_STATUSES,
      },
    },
    orderBy: [
      {
        createdAt: 'desc',
      },
    ],
    take: 100,
  }));
  const automationAggregationStartedAt = startDashboardTimer();
  for (const action of automationActions) {
    const item = mapPersistedAutomationActionToQueueItem(action);
    if (item) {
      items.push(item);
    }
  }
  logDashboardTiming('operations.automation_aggregation', automationAggregationStartedAt);

  const finalAggregationStartedAt = startDashboardTimer();
  const summary = await getAdminOperationsQueueSummary();
  items.sort((a, b) => {
    const severityDelta = getSeverityRank(a.severity) - getSeverityRank(b.severity);
    if (severityDelta !== 0) {
      return severityDelta;
    }
    return a.createdAt < b.createdAt ? 1 : -1;
  });

  const dashboard: OperationsQueueDashboardDto = {
    summary,
    items: items.slice(offset, offset + limit),
  };
  logDashboardTiming('operations.metrics_aggregation', finalAggregationStartedAt);
  return dashboard;
}

export async function generateAdminOperationsSignals() {
  const signals = await withDashboardTiming('operations.generate_signals_service', () => evaluateOperationalSignals());

  return {
    generated: signals.length,
    signals,
  };
}

export async function generateAdminOperationsAutomationActions() {
  const actions = await withDashboardTiming('operations.generate_automation_actions_service', () =>
    generateAutomationActionsForSignals(),
  );

  return {
    generated: actions.length,
    actions,
  };
}

export async function getAdminOperationsAttentionCenter(): Promise<OperationsAttentionDashboardDto> {
  const now = new Date();
  const queueDashboard = await getAdminOperationsQueue({ limit: 200, offset: 0 });
  const attentionItems: OperationsAttentionItemDto[] = queueDashboard.items.map((item) => ({
    id: item.id,
    type:
      item.type === 'awaiting_shipment'
        ? 'shipment'
        : item.type === 'refund_attention'
          ? 'return'
          : item.type === 'automation_action'
            ? 'automation'
            : item.type === 'operational_signal'
              ? 'operational_signal'
              : 'shipment',
    severity: mapAttentionSeverity(item.severity),
    vendorId: item.vendorId,
    vendorName: item.vendorName,
    objectType: item.type,
    objectReference: item.relatedShopifyOrderId ? `Order ${item.relatedShopifyOrderId}` : item.relatedOrderId ?? item.id,
    objectId: item.relatedOrderId,
    status: item.status,
    ageHours: hoursSince(new Date(item.createdAt), now),
    title: item.title,
    description: item.description,
    recommendedAction: item.actionLabel,
    destinationPath: item.destinationPath,
    createdAt: item.createdAt,
  }));

  const supportTickets = await prisma.supportTicket.findMany({
    where: {
      status: {
        in: ['OPEN', 'IN_REVIEW', 'WAITING_FOR_VENDOR'],
      },
    },
    include: {
      vendor: {
        select: { name: true },
      },
    },
    orderBy: {
      updatedAt: 'desc',
    },
    take: 200,
  });

  for (const ticket of supportTickets) {
    const sla = deriveSupportSlaState(ticket, now);
    const ageHours = hoursSince(ticket.updatedAt, now);
    const severity = deriveOperationalSeverity({
      ageHours,
      overdue: sla.isOverdue,
      priority: ticket.priority,
      status: ticket.status,
    });
    const needsResponse = ticket.adminUnreadCount > 0 || (ticket.status === 'OPEN' && !ticket.assigneeName);
    attentionItems.push({
      id: `attention-support-${ticket.id}`,
      type: 'support',
      severity,
      vendorId: ticket.vendorId,
      vendorName: ticket.vendor?.name ?? ticket.vendorId,
      objectType: 'Support ticket',
      objectReference: ticket.subject,
      objectId: ticket.id,
      status: ticket.status,
      ageHours,
      title: sla.isOverdue ? 'Overdue support ticket' : needsResponse ? 'Support needs response' : 'Support ticket active',
      description: sla.dueLabel,
      recommendedAction: ticket.assigneeName ? 'Review ticket' : 'Assign and respond',
      destinationPath: `/admin/support/${ticket.id}`,
      createdAt: ticket.updatedAt.toISOString(),
    });
  }

  const shipmentExecutions = await prisma.shipmentExecution.findMany({
    where: {
      shipmentStatus: {
        in: ['PENDING', 'FAILED'],
      },
    },
    include: {
      vendor: {
        select: { name: true },
      },
      allocation: {
        include: {
          order: true,
        },
      },
    },
    orderBy: {
      updatedAt: 'desc',
    },
    take: 100,
  });

  for (const shipment of shipmentExecutions) {
    const ageHours = hoursSince(shipment.updatedAt, now);
    attentionItems.push({
      id: `attention-shipment-${shipment.id}`,
      type: 'shipment',
      severity: deriveOperationalSeverity({
        ageHours,
        status: shipment.shipmentStatus === 'FAILED' ? 'failed' : 'pending',
      }),
      vendorId: shipment.vendorId,
      vendorName: shipment.vendor.name,
      objectType: 'Shipment',
      objectReference: shipment.sourceShopifyOrderNumber
        ? `Order ${shipment.sourceShopifyOrderNumber}`
        : shipment.allocation.order.sourceShopifyOrderNumber,
      objectId: shipment.id,
      status: shipment.shipmentStatus.toLowerCase(),
      ageHours,
      title: shipment.shipmentStatus === 'FAILED' ? 'Shipment execution failed' : 'Shipment pending carrier identifiers',
      description: shipment.trackingNumber ? 'Carrier record exists; tracking should be reviewed.' : 'Tracking is not available yet.',
      recommendedAction: shipment.shipmentStatus === 'FAILED' ? 'Review provider response' : 'Review shipment status',
      destinationPath: `/orders/${shipment.allocationId}`,
      createdAt: shipment.updatedAt.toISOString(),
    });
  }

  const recentReturns = await prisma.returnRecord.findMany({
    include: {
      vendorAllocation: {
        include: {
          assignedVendor: true,
          order: true,
        },
      },
    },
    orderBy: {
      updatedAt: 'desc',
    },
    take: 150,
  });

  for (const returnRecord of recentReturns) {
    const status = returnRecord.status.trim().toLowerCase();
    if (CLOSED_RETURN_STATUSES.has(status)) {
      continue;
    }
    const ageSource = returnRecord.requestUpdatedAt ?? returnRecord.updatedAt;
    const ageHours = hoursSince(ageSource, now);
    attentionItems.push({
      id: `attention-return-${returnRecord.id}`,
      type: 'return',
      severity: deriveOperationalSeverity({ ageHours, status }),
      vendorId: returnRecord.vendorAllocation.assignedVendorId,
      vendorName: returnRecord.vendorAllocation.assignedVendor.name,
      objectType: 'Return',
      objectReference: `Order ${returnRecord.sourceShopifyOrderNumber}`,
      objectId: returnRecord.id,
      status: returnRecord.status,
      ageHours,
      title: 'Return waiting review',
      description: returnRecord.sourceShopifyRefundId ? 'Refund linkage exists; review return completion.' : 'Refund is still pending.',
      recommendedAction: 'Review return',
      destinationPath: `/returns/${returnRecord.id}`,
      createdAt: ageSource.toISOString(),
    });
  }

  const financeEntries = await prisma.financeLedgerEntry.findMany({
    where: {
      OR: [
        { payoutStatus: 'HOLD' },
        { settlementStatus: { in: ['HELD', 'DISPUTED'] } },
      ],
    },
    include: {
      vendor: {
        select: { name: true },
      },
      vendorAllocation: {
        include: {
          order: true,
          returnRecords: true,
          refundRecords: true,
        },
      },
    },
    orderBy: {
      updatedAt: 'desc',
    },
    take: 100,
  });

  for (const entry of financeEntries) {
    const ageHours = hoursSince(entry.updatedAt, now);
    attentionItems.push({
      id: `attention-finance-${entry.id}`,
      type: 'finance',
      severity: deriveOperationalSeverity({
        ageHours,
        status: entry.payoutStatus === 'HOLD' || entry.settlementStatus === 'HELD' ? 'held' : 'disputed',
      }),
      vendorId: entry.vendorId,
      vendorName: entry.vendor.name,
      objectType: 'Finance row',
      objectReference: entry.vendorAllocation?.order.sourceShopifyOrderNumber
        ? `Order ${entry.vendorAllocation.order.sourceShopifyOrderNumber}`
        : entry.id,
      objectId: entry.id,
      status: entry.settlementStatus.toLowerCase(),
      ageHours,
      title: 'Payout review needed',
      description: entry.description ?? 'Finance row requires admin review.',
      recommendedAction: 'Review payout status',
      destinationPath: '/finance',
      createdAt: entry.updatedAt.toISOString(),
    });
  }

  const uniqueItems = new Map<string, OperationsAttentionItemDto>();
  for (const item of attentionItems) {
    uniqueItems.set(item.id, item);
  }
  const queue = [...uniqueItems.values()].sort((left, right) => {
    const severityDelta = getSeverityWeight(left.severity) - getSeverityWeight(right.severity);
    if (severityDelta !== 0) {
      return severityDelta;
    }
    return right.ageHours - left.ageHours;
  });
  const vendorRisks = buildVendorRiskSummaries(queue);
  const recommendations = buildOperationalRecommendations(queue, vendorRisks, now.toISOString());
  const recentActivity: OperationsActivityDto[] = queue
    .slice()
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .slice(0, 12)
    .map((item) => ({
      id: `activity-${item.id}`,
      type: item.type,
      severity: item.severity,
      vendorId: item.vendorId,
      vendorName: item.vendorName,
      title: item.title,
      description: item.objectReference,
      occurredAt: item.createdAt,
      destinationPath: item.destinationPath,
    }));

  return {
    generatedAt: now.toISOString(),
    summary: {
      total: queue.length,
      critical: queue.filter((item) => item.severity === 'critical').length,
      warning: queue.filter((item) => item.severity === 'warning').length,
      info: queue.filter((item) => item.severity === 'info').length,
      overdueSupport: queue.filter((item) => item.type === 'support' && item.severity === 'critical').length,
      shipmentIssues: queue.filter((item) => item.type === 'shipment').length,
      returnBacklog: queue.filter((item) => item.type === 'return').length,
      financeReview: queue.filter((item) => item.type === 'finance').length,
      vendorRisks: vendorRisks.filter((vendor) => vendor.riskLevel !== 'info').length,
    },
    queue: queue.slice(0, 100),
    sections: [
      getAttentionSection('support', 'Support attention', queue),
      getAttentionSection('shipment', 'Shipment attention', queue),
      getAttentionSection('return', 'Return backlog', queue),
      getAttentionSection('finance', 'Finance review', queue),
    ],
    recommendations,
    vendorRisks,
    recentActivity,
  };
}
