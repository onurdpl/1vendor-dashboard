import { prisma } from '../../db/prisma.js';
import { logDashboardTiming, startDashboardTimer, withDashboardTiming } from '../../lib/dashboard-timing.js';
import type {
  AutomationAlertDto,
  AutomationAlertStatus,
  AutomationAlertType,
  AutomationDashboardDto,
  AutomationSuggestionDto,
} from './automation.types.js';
import {
  fullOrderOperationalAllocationWhere,
  isFullOrderCancelled,
} from '../orders/full-order-cancellation-policy.js';

type VendorAutomationSnapshot = {
  vendorId: string;
  vendorName: string;
};

function formatOrderNumber(orderNumber: string | number | null | undefined) {
  if (orderNumber === null || orderNumber === undefined) {
    return 'unknown';
  }

  const normalized = String(orderNumber).trim();
  if (!normalized) {
    return 'unknown';
  }

  return normalized.startsWith('#') ? normalized : `#${normalized}`;
}

function createAlert(input: {
  id: string;
  type: AutomationAlertType;
  message: string;
  status: AutomationAlertStatus;
  timestamp: Date;
  source: string;
}): AutomationAlertDto {
  return {
    id: input.id,
    type: input.type,
    message: input.message,
    status: input.status,
    timestamp: input.timestamp.toISOString(),
    source: input.source,
  };
}

function createSuggestionsFromAlerts(
  snapshot: VendorAutomationSnapshot,
  alerts: AutomationAlertDto[],
): AutomationSuggestionDto[] {
  const suggestions: AutomationSuggestionDto[] = [];
  const hasCritical = alerts.some((alert) => alert.type === 'Critical');
  const hasWarnings = alerts.some((alert) => alert.type === 'Warning');
  const hasActiveAlerts = alerts.some((alert) => alert.status !== 'Resolved');

  if (hasCritical) {
    suggestions.push({
      title: `Escalate ${snapshot.vendorName} critical issues`,
      description: 'Review the newest critical operational blockers before shipment and refund queues drift further.',
      actionLabel: 'Escalate',
    });
  }

  if (hasWarnings) {
    suggestions.push({
      title: `Prepare ${snapshot.vendorName} review queue`,
      description: 'Group warning-level alerts into one vendor-scoped review pass for the current shift.',
      actionLabel: 'Create queue',
    });
  }

  if (hasActiveAlerts) {
    suggestions.push({
      title: `Summarize ${snapshot.vendorName} operational signals`,
      description: 'Generate a handoff-ready summary of unresolved automation alerts for the selected vendor scope.',
      actionLabel: 'Summarize',
    });
  }

  if (suggestions.length === 0) {
    suggestions.push({
      title: `Monitor ${snapshot.vendorName} operational health`,
      description: 'No active exceptions are open right now. Keep the workspace available for new operational signals.',
      actionLabel: 'Monitor',
    });
  }

  return suggestions.slice(0, 3);
}

export async function getAutomationDashboard(
  vendorId: string,
  vendorName: string,
): Promise<AutomationDashboardDto> {
  const [allocations, pendingReturns, failedFulfillments, vendorWebhookEvents] = await Promise.all([
    withDashboardTiming('automation.allocation_fetch', () => prisma.vendorAllocation.findMany({
      where: {
        assignedVendorId: vendorId,
        ...fullOrderOperationalAllocationWhere,
      },
      include: {
        order: true,
      },
      orderBy: {
        updatedAt: 'desc',
      },
      take: 12,
    })),
    withDashboardTiming('automation.pending_return_fetch', () => prisma.returnRecord.findMany({
      where: {
        vendorAllocation: {
          assignedVendorId: vendorId,
          ...fullOrderOperationalAllocationWhere,
        },
        status: {
          in: ['pending', 'open', 'needs_review'],
        },
      },
      include: {
        vendorAllocation: {
          include: {
            order: true,
          },
        },
      },
      orderBy: {
        updatedAt: 'desc',
      },
      take: 8,
    })),
    withDashboardTiming('automation.failed_fulfillment_fetch', () => prisma.fulfillment.findMany({
      where: {
        vendorAllocation: {
          assignedVendorId: vendorId,
        },
        syncStatus: {
          in: ['failed', 'fulfillment_sync_failed', 'error'],
          mode: 'insensitive',
        },
      },
      include: {
        vendorAllocation: {
          include: {
            order: true,
          },
        },
      },
      orderBy: {
        updatedAt: 'desc',
      },
      take: 8,
    })),
    withDashboardTiming('automation.failed_webhook_fetch', () => prisma.webhookEvent.findMany({
      where: {
        status: 'FAILED',
        shopifyOrder: {
          allocations: {
            some: {
              assignedVendorId: vendorId,
            },
          },
        },
      },
      include: {
        shopifyOrder: true,
      },
      orderBy: {
        receivedAt: 'desc',
      },
      take: 8,
    })),
  ]);
  const aggregationStartedAt = startDashboardTimer();

  const alerts: AutomationAlertDto[] = [];
  const seenAlertIds = new Set<string>();

  for (const allocation of allocations) {
    if (isFullOrderCancelled(allocation.order)) {
      continue;
    }

    const allocationStatus = allocation.allocationStatus.toLowerCase();
    const shippingStatus = allocation.shippingStatus.trim().toLowerCase();

    if (allocationStatus === 'vendor_blocked') {
      const alert = createAlert({
        id: `automation-allocation-blocked-${allocation.id}`,
        type: 'Critical',
        message: `Allocation ${allocation.id} is vendor-blocked and needs recovery before fulfillment can continue.`,
        status: 'New',
        timestamp: allocation.updatedAt,
        source: 'Fulfillment monitor',
      });
      if (!seenAlertIds.has(alert.id)) {
        seenAlertIds.add(alert.id);
        alerts.push(alert);
      }
    }

    if (allocation.reassignmentRequired || allocationStatus === 'pending_reassignment') {
      const alert = createAlert({
        id: `automation-reassignment-${allocation.id}`,
        type: 'Critical',
        message: `Allocation ${allocation.id} is waiting for reassignment review for Shopify order ${formatOrderNumber(allocation.sourceShopifyOrderNumber)}.`,
        status: 'In Progress',
        timestamp: allocation.updatedAt,
        source: 'Allocation monitor',
      });
      if (!seenAlertIds.has(alert.id)) {
        seenAlertIds.add(alert.id);
        alerts.push(alert);
      }
    }

    if (shippingStatus === 'awaiting shipment' || shippingStatus === 'awaiting_shipment') {
      const alert = createAlert({
        id: `automation-shipment-${allocation.id}`,
        type: 'Warning',
        message: `Allocation ${allocation.id} is still awaiting shipment update.`,
        status: 'New',
        timestamp: allocation.updatedAt,
        source: 'Shipment watcher',
      });
      if (!seenAlertIds.has(alert.id)) {
        seenAlertIds.add(alert.id);
        alerts.push(alert);
      }
    }
  }

  for (const returnRecord of pendingReturns) {
    const alert = createAlert({
      id: `automation-return-${returnRecord.id}`,
      type: 'Warning',
      message: `Return ${returnRecord.id} for Shopify order ${formatOrderNumber(returnRecord.sourceShopifyOrderNumber)} is waiting for review.`,
      status: 'In Progress',
      timestamp: returnRecord.updatedAt,
      source: 'Returns engine',
    });
    if (!seenAlertIds.has(alert.id)) {
      seenAlertIds.add(alert.id);
      alerts.push(alert);
    }
  }

  for (const fulfillment of failedFulfillments) {
    const alert = createAlert({
      id: `automation-fulfillment-${fulfillment.id}`,
      type: 'Critical',
      message: `Fulfillment sync failed for allocation ${fulfillment.vendorAllocationId}.`,
      status: 'New',
      timestamp: fulfillment.updatedAt,
      source: 'Fulfillment sync',
    });
    if (!seenAlertIds.has(alert.id)) {
      seenAlertIds.add(alert.id);
      alerts.push(alert);
    }
  }

  for (const webhookEvent of vendorWebhookEvents) {
    const orderNumber = formatOrderNumber(webhookEvent.shopifyOrder?.sourceShopifyOrderNumber);
    const alert = createAlert({
      id: `automation-webhook-${webhookEvent.id}`,
      type: 'Critical',
      message: webhookEvent.errorMessage
        ? `Webhook ${webhookEvent.topic} failed${orderNumber !== 'unknown' ? ` for Shopify order ${orderNumber}` : ''}: ${webhookEvent.errorMessage}`
        : `Webhook ${webhookEvent.topic} failed${orderNumber !== 'unknown' ? ` for Shopify order ${orderNumber}` : ''}.`,
      status: 'New',
      timestamp: webhookEvent.processedAt ?? webhookEvent.receivedAt,
      source: 'Webhook diagnostics',
    });
    if (!seenAlertIds.has(alert.id)) {
      seenAlertIds.add(alert.id);
      alerts.push(alert);
    }
  }

  alerts.sort((left, right) => {
    const leftTime = new Date(left.timestamp).getTime();
    const rightTime = new Date(right.timestamp).getTime();
    return rightTime - leftTime;
  });

  const dashboard = {
    alerts: alerts.slice(0, 12),
    suggestions: createSuggestionsFromAlerts({ vendorId, vendorName }, alerts),
  };
  logDashboardTiming('automation.metrics_aggregation', aggregationStartedAt);
  return dashboard;
}
