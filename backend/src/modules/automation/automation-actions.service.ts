import {
  AutomationActionStatus,
  AutomationActionType,
  AutomationExecutionMode,
  NotificationChannel,
  NotificationRecipientRole,
  NotificationStatus,
  OperationalSignalSeverity,
  OperationalSignalSourceArea,
  OperationalSignalStatus,
  Prisma,
  type AutomationAction,
  type OperationalSignal,
} from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { createOperationalJob, serializeOperationalJob } from '../operational-jobs/operational-jobs.service.js';
import { listOperationalSignals } from '../rules/rules.service.js';
import { logDashboardTiming, startDashboardTimer, withDashboardTiming } from '../../lib/dashboard-timing.js';
import type {
  AutomationActionDto,
  AutomationActionExecutionMode,
  AutomationActionsResponseDto,
  AutomationActionSummaryDto,
} from './automation-actions.types.js';

const ACTIVE_ACTION_STATUSES = [
  AutomationActionStatus.PENDING,
  AutomationActionStatus.SUGGESTED,
  AutomationActionStatus.FAILED,
];

function mapAutomationAction(action: AutomationAction): AutomationActionDto {
  return {
    id: action.id,
    signalId: action.signalId,
    type: action.type.trim().toLowerCase() as AutomationActionDto['type'],
    status: action.status.trim().toLowerCase() as AutomationActionDto['status'],
    executionMode: action.executionMode.trim().toLowerCase() as AutomationActionDto['executionMode'],
    vendorId: action.vendorId,
    allocationId: action.allocationId,
    financeLedgerEntryId: action.financeLedgerEntryId,
    payoutBatchId: action.payoutBatchId,
    operationalJobId: action.operationalJobId,
    title: action.title,
    description: action.description,
    resultSummary: action.resultSummary,
    executedAt: action.executedAt?.toISOString() ?? null,
    metadata: action.metadata,
    createdAt: action.createdAt.toISOString(),
    updatedAt: action.updatedAt.toISOString(),
  };
}

function buildSummary(actions: AutomationActionDto[]): AutomationActionSummaryDto {
  return {
    total: actions.length,
    suggested: actions.filter((action) => action.status === 'suggested' || action.status === 'pending').length,
    executed: actions.filter((action) => action.status === 'executed').length,
    failed: actions.filter((action) => action.status === 'failed').length,
    autoSafe: actions.filter((action) => action.executionMode === 'auto_safe').length,
  };
}

function buildActionId(input: { type: AutomationActionType; signalId: string }) {
  return `automation-${input.type.toLowerCase()}-${input.signalId}`;
}

function buildActionNotificationId(action: AutomationAction) {
  const target = action.vendorId ?? 'admins';
  return `notif-in_app-admin-${target}-${action.id}`;
}

function getActionDefinition(signal: OperationalSignal): {
  type: AutomationActionType;
  executionMode: AutomationExecutionMode;
  title: string;
  description: string;
} | null {
  if (signal.ruleKey === 'fulfillment.stale_awaiting_shipment') {
    return {
      type: AutomationActionType.SUGGEST_STALE_FULFILLMENT_REVIEW,
      executionMode: AutomationExecutionMode.ASSISTED,
      title: 'Review stale fulfillment',
      description: 'Check shipment progress and reconcile against Shopify before taking any vendor-facing action.',
    };
  }

  if (signal.ruleKey === 'shipping_cost.missing_after_fulfillment') {
    return {
      type: AutomationActionType.SUGGEST_SHIPPING_COST_ATTACHMENT,
      executionMode: AutomationExecutionMode.MANUAL,
      title: 'Attach shipping cost',
      description: 'Attach or import a confirmed provider shipping cost before final payout review.',
    };
  }

  if (signal.ruleKey === 'payout.review_sla_aging' || signal.ruleKey === 'settlement.payable_row_overdue') {
    return {
      type: AutomationActionType.SUGGEST_PAYOUT_REVIEW,
      executionMode: AutomationExecutionMode.MANUAL,
      title: 'Review payout readiness',
      description: 'Review the payout batch or payable rows and move the payout preparation lifecycle forward when safe.',
    };
  }

  if (signal.ruleKey === 'payout.negative_batch_net') {
    return {
      type: AutomationActionType.SUGGEST_PAYOUT_BATCH_REVIEW,
      executionMode: AutomationExecutionMode.MANUAL,
      title: 'Review negative payout batch',
      description: 'Investigate refund-heavy rows before moving this payout batch forward.',
    };
  }

  if (signal.ruleKey === 'finance.negative_payable_balance' || signal.ruleKey === 'refund.vendor_ratio_sla') {
    return {
      type: AutomationActionType.SUGGEST_NEGATIVE_PAYOUT_INVESTIGATION,
      executionMode: AutomationExecutionMode.MANUAL,
      title: 'Investigate payout risk',
      description: 'Review refund and payable balance drivers before preparing or approving payout work.',
    };
  }

  if (signal.ruleKey === 'diagnostics.operational_job_escalated') {
    return {
      type: AutomationActionType.SUGGEST_DEAD_LETTER_INVESTIGATION,
      executionMode: AutomationExecutionMode.ASSISTED,
      title: 'Investigate failed operational job',
      description: 'Review diagnostics and use replay, retry, or recover only after confirming the state is safe.',
    };
  }

  if (signal.ruleKey === 'return.request_sla_aging') {
    return {
      type: AutomationActionType.SUGGEST_RECONCILIATION,
      executionMode: AutomationExecutionMode.ASSISTED,
      title: 'Review aging return',
      description: 'Review the pending return request and reconcile if local return state appears stale.',
    };
  }

  return null;
}

function shouldCreateReconciliationCandidate(signal: OperationalSignal) {
  return Boolean(
    signal.allocationId &&
      (
        signal.sourceArea === OperationalSignalSourceArea.FULFILLMENT ||
        signal.sourceArea === OperationalSignalSourceArea.RECONCILIATION ||
        signal.ruleKey === 'return.request_sla_aging' ||
        signal.ruleKey === 'diagnostics.operational_job_escalated'
      ),
  );
}

function buildBaseMetadata(signal: OperationalSignal): Prisma.InputJsonObject {
  return {
    whySuggested: signal.description,
    recommendedOperatorAction: signal.suggestedAction ?? 'Review the related operational signal.',
    signalRuleKey: signal.ruleKey,
    signalSeverity: signal.severity,
    signalSourceArea: signal.sourceArea,
    signalMetadata: signal.metadata ? JSON.parse(JSON.stringify(signal.metadata)) as Prisma.InputJsonValue : null,
  };
}

async function upsertAction(input: {
  signal: OperationalSignal;
  type: AutomationActionType;
  executionMode: AutomationExecutionMode;
  title: string;
  description: string;
  metadata?: Prisma.InputJsonObject;
}) {
  const id = buildActionId({
    type: input.type,
    signalId: input.signal.id,
  });

  return prisma.automationAction.upsert({
    where: {
      id,
    },
    update: {
      signalId: input.signal.id,
      type: input.type,
      executionMode: input.executionMode,
      vendorId: input.signal.vendorId,
      allocationId: input.signal.allocationId,
      financeLedgerEntryId: input.signal.financeLedgerEntryId,
      payoutBatchId: input.signal.payoutBatchId,
      operationalJobId: input.signal.operationalJobId,
      title: input.title,
      description: input.description,
      metadata: input.metadata ?? buildBaseMetadata(input.signal),
    },
    create: {
      id,
      signalId: input.signal.id,
      type: input.type,
      status: AutomationActionStatus.SUGGESTED,
      executionMode: input.executionMode,
      vendorId: input.signal.vendorId,
      allocationId: input.signal.allocationId,
      financeLedgerEntryId: input.signal.financeLedgerEntryId,
      payoutBatchId: input.signal.payoutBatchId,
      operationalJobId: input.signal.operationalJobId,
      title: input.title,
      description: input.description,
      metadata: input.metadata ?? buildBaseMetadata(input.signal),
    },
  });
}

async function upsertAutomationNotification(action: AutomationAction) {
  if (action.status !== AutomationActionStatus.SUGGESTED && action.status !== AutomationActionStatus.PENDING) {
    return null;
  }

  return prisma.notificationIntent.upsert({
    where: {
      id: buildActionNotificationId(action),
    },
    update: {
      title: action.title,
      message: action.description,
      severity: OperationalSignalSeverity.INFO,
      metadata: {
        automationActionId: action.id,
        automationActionType: action.type,
        executionMode: action.executionMode,
      },
    },
    create: {
      id: buildActionNotificationId(action),
      signalId: action.signalId,
      vendorId: action.vendorId,
      recipientRole: NotificationRecipientRole.ADMIN,
      channel: NotificationChannel.IN_APP,
      status: NotificationStatus.DELIVERED,
      title: action.title,
      message: action.description,
      severity: OperationalSignalSeverity.INFO,
      deliveredAt: new Date(),
      metadata: {
        automationActionId: action.id,
        automationActionType: action.type,
        executionMode: action.executionMode,
      },
    },
  });
}

export async function generateAutomationActionsForSignals(options: {
  includeNotifications?: boolean;
} = {}) {
  await listOperationalSignals({
    includeInternal: true,
    limit: 100,
  });
  const signals = await prisma.operationalSignal.findMany({
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
  });
  const actions: AutomationAction[] = [];

  for (const signal of signals) {
    const definition = getActionDefinition(signal);
    if (definition) {
      actions.push(await upsertAction({
        signal,
        ...definition,
      }));
    }

    if (shouldCreateReconciliationCandidate(signal)) {
      actions.push(await upsertAction({
        signal,
        type: AutomationActionType.AUTO_CREATE_RECONCILIATION_CANDIDATE,
        executionMode: AutomationExecutionMode.AUTO_SAFE,
        title: 'Create reconciliation candidate',
        description: 'Create a bounded reconciliation job candidate for operator review and canonical Shopify refresh.',
        metadata: {
          ...buildBaseMetadata(signal),
          boundedAction: 'Creates an OperationalJob with jobType RECONCILIATION only. It does not mutate Shopify, finance snapshots, payouts, or returns.',
        },
      }));
    }

    if (signal.severity === OperationalSignalSeverity.CRITICAL || signal.severity === OperationalSignalSeverity.HIGH) {
      actions.push(await upsertAction({
        signal,
        type: AutomationActionType.AUTO_PRIORITIZE_STALE_QUEUE_ITEM,
        executionMode: AutomationExecutionMode.AUTO_SAFE,
        title: 'Prioritize operations queue item',
        description: 'Keep this signal high in the operations queue using existing severity ordering.',
        metadata: {
          ...buildBaseMetadata(signal),
          boundedAction: 'Records prioritization intent only; queue ordering still derives from signal severity.',
        },
      }));
    }
  }

  if (options.includeNotifications) {
    await Promise.all(actions.map((action) => upsertAutomationNotification(action)));
  }

  return actions.map(mapAutomationAction);
}

export async function listAutomationActions(options: {
  status?: AutomationActionStatus;
  includeNotifications?: boolean;
} = {}): Promise<AutomationActionsResponseDto> {
  await withDashboardTiming('automation_actions.generate_for_signals_service', () =>
    generateAutomationActionsForSignals({
      includeNotifications: options.includeNotifications,
    }),
  );

  const actions = await withDashboardTiming('automation_actions.action_fetch', () => prisma.automationAction.findMany({
    where: {
      status: options.status ?? {
        in: ACTIVE_ACTION_STATUSES,
      },
    },
    orderBy: [
      {
        createdAt: 'desc',
      },
    ],
    take: 100,
  }));
  const aggregationStartedAt = startDashboardTimer();
  const mapped = actions.map(mapAutomationAction);

  const response = {
    summary: buildSummary(mapped),
    actions: mapped,
  };
  logDashboardTiming('automation_actions.metrics_aggregation', aggregationStartedAt);
  return response;
}

export async function executeAutomationAction(input: {
  actionId: string;
  execution: AutomationActionExecutionMode;
  actorUserId?: string | null;
}): Promise<AutomationActionDto | null> {
  const action = await prisma.automationAction.findUnique({
    where: {
      id: input.actionId,
    },
  });

  if (!action) {
    return null;
  }

  const now = new Date();
  const executionMetadata = {
    ...(typeof action.metadata === 'object' && action.metadata !== null && !Array.isArray(action.metadata)
      ? action.metadata
      : {}),
    executedByUserId: input.actorUserId ?? null,
    executionRequestedAt: now.toISOString(),
    executionRequest: input.execution,
  };

  if (input.execution === 'cancel') {
    const updated = await prisma.automationAction.update({
      where: {
        id: action.id,
      },
      data: {
        status: AutomationActionStatus.CANCELLED,
        executedAt: now,
        resultSummary: 'Automation suggestion cancelled by operator.',
        metadata: executionMetadata,
      },
    });
    return mapAutomationAction(updated);
  }

  if (input.execution === 'skip') {
    const updated = await prisma.automationAction.update({
      where: {
        id: action.id,
      },
      data: {
        status: AutomationActionStatus.SKIPPED,
        executedAt: now,
        resultSummary: 'Automation suggestion skipped by operator.',
        metadata: executionMetadata,
      },
    });
    return mapAutomationAction(updated);
  }

  if (input.execution === 'mark_handled' || action.type !== AutomationActionType.AUTO_CREATE_RECONCILIATION_CANDIDATE) {
    const updated = await prisma.automationAction.update({
      where: {
        id: action.id,
      },
      data: {
        status: AutomationActionStatus.EXECUTED,
        executedAt: now,
        resultSummary: 'Automation suggestion marked handled by operator. No operational state was mutated.',
        metadata: executionMetadata,
      },
    });
    return mapAutomationAction(updated);
  }

  if (!action.allocationId && !action.operationalJobId) {
    const updated = await prisma.automationAction.update({
      where: {
        id: action.id,
      },
      data: {
        status: AutomationActionStatus.FAILED,
        executedAt: now,
        resultSummary: 'Could not create reconciliation candidate because the action has no allocation or job linkage.',
        metadata: executionMetadata,
      },
    });
    return mapAutomationAction(updated);
  }

  const relatedJob = action.operationalJobId
    ? await prisma.operationalJob.findUnique({
        where: {
          id: action.operationalJobId,
        },
      })
    : null;
  const operationalJob = await createOperationalJob({
    jobType: 'reconciliation',
    vendorAllocationId: action.allocationId ?? relatedJob?.vendorAllocationId ?? null,
    sourceShopifyOrderId: relatedJob?.sourceShopifyOrderId ?? null,
    refundRecordId: relatedJob?.refundRecordId ?? null,
    returnRecordId: relatedJob?.returnRecordId ?? null,
    priority: 6,
    maxRetries: 1,
    payload: {
      source: 'automation_action',
      automationActionId: action.id,
      signalId: action.signalId,
      reason: action.description,
    },
  });

  const updated = await prisma.automationAction.update({
    where: {
      id: action.id,
    },
    data: {
      status: AutomationActionStatus.EXECUTED,
      executedAt: now,
      resultSummary: `Created reconciliation job ${operationalJob.id}.`,
      metadata: {
        ...executionMetadata,
        createdOperationalJob: serializeOperationalJob(operationalJob),
      },
    },
  });

  return mapAutomationAction(updated);
}

export const automationActionEnums = {
  status: AutomationActionStatus,
  type: AutomationActionType,
  executionMode: AutomationExecutionMode,
} as const;
