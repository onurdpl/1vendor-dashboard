import {
  NotificationChannel,
  NotificationRecipientRole,
  NotificationStatus,
  OperationalSignalSeverity,
  OperationalSignalSourceArea,
  type User,
  type NotificationIntent,
  type OperationalSignal,
} from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { evaluateOperationalSignals } from '../rules/rules.service.js';
import type { AuthRole } from '../auth/auth.types.js';
import { generateAutomationActionsForSignals } from '../automation/automation-actions.service.js';
import { runEmailDeliveryForIntent, type EmailDeliveryConfig } from './email-delivery.service.js';
import type {
  DashboardNotificationIntentDto,
  DashboardNotificationMetadataDto,
  DashboardNotificationsResponseDto,
  NotificationIntentDto,
  NotificationsResponseDto,
} from './notifications.types.js';
import { logDashboardTiming, startDashboardTimer, withDashboardTiming } from '../../lib/dashboard-timing.js';

const VENDOR_SAFE_SOURCE_AREAS = new Set<OperationalSignalSourceArea>([
  OperationalSignalSourceArea.PAYOUT,
  OperationalSignalSourceArea.REFUND,
  OperationalSignalSourceArea.FULFILLMENT,
  OperationalSignalSourceArea.SHIPPING_COST,
  OperationalSignalSourceArea.SETTLEMENT,
]);
const VENDOR_NOTIFICATION_SEVERITIES = new Set<OperationalSignalSeverity>([
  OperationalSignalSeverity.CRITICAL,
  OperationalSignalSeverity.HIGH,
  OperationalSignalSeverity.WARNING,
]);
const EMAIL_NOTIFICATION_SEVERITIES = new Set<OperationalSignalSeverity>([
  OperationalSignalSeverity.CRITICAL,
  OperationalSignalSeverity.HIGH,
]);

function mapNotification(notification: NotificationIntent): NotificationIntentDto {
  return {
    id: notification.id,
    signalId: notification.signalId,
    vendorId: notification.vendorId,
    recipientRole: notification.recipientRole.trim().toLowerCase() as NotificationIntentDto['recipientRole'],
    channel: notification.channel.trim().toLowerCase() as NotificationIntentDto['channel'],
    status: notification.status.trim().toLowerCase() as NotificationIntentDto['status'],
    title: notification.title,
    message: notification.message,
    severity: notification.severity.trim().toLowerCase() as NotificationIntentDto['severity'],
    deliveredAt: notification.deliveredAt?.toISOString() ?? null,
    readAt: notification.readAt?.toISOString() ?? null,
    metadata: notification.metadata,
    createdAt: notification.createdAt.toISOString(),
    updatedAt: notification.updatedAt.toISOString(),
  };
}

const DASHBOARD_NOTIFICATION_METADATA_KEYS = [
  'signalSourceArea',
  'category',
  'linkedEntityType',
  'linkedEntityId',
  'orderId',
  'returnRequestId',
  'supportTicketId',
] as const;

type DashboardNotificationRow = {
  id: string;
  signalId: string | null;
  vendorId: string | null;
  status: NotificationIntent['status'];
  title: string;
  message: string;
  severity: NotificationIntent['severity'];
  deliveredAt: Date | null;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
};

function pickDashboardNotificationMetadata(metadata: unknown): DashboardNotificationMetadataDto {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return {};
  }

  return DASHBOARD_NOTIFICATION_METADATA_KEYS.reduce<DashboardNotificationMetadataDto>((picked, key) => {
    const value = Reflect.get(metadata, key);
    if (typeof value === 'string' && value.trim()) {
      picked[key] = value;
    }
    return picked;
  }, {});
}

function mapDashboardNotification(notification: DashboardNotificationRow): DashboardNotificationIntentDto {
  return {
    id: notification.id,
    signalId: notification.signalId,
    vendorId: notification.vendorId,
    status: notification.status.trim().toLowerCase() as DashboardNotificationIntentDto['status'],
    title: notification.title,
    message: notification.message,
    severity: notification.severity.trim().toLowerCase() as DashboardNotificationIntentDto['severity'],
    deliveredAt: notification.deliveredAt?.toISOString() ?? null,
    metadata: pickDashboardNotificationMetadata(notification.metadata),
    createdAt: notification.createdAt.toISOString(),
    updatedAt: notification.updatedAt.toISOString(),
  };
}

function buildSummary(notifications: NotificationIntentDto[]): NotificationsResponseDto['summary'] {
  return {
    total: notifications.length,
    unread: notifications.filter((notification) => notification.status !== 'read' && notification.status !== 'dismissed').length,
    critical: notifications.filter((notification) => notification.severity === 'critical').length,
    high: notifications.filter((notification) => notification.severity === 'high').length,
    warning: notifications.filter((notification) => notification.severity === 'warning').length,
  };
}

function isAdminSignal(signal: OperationalSignal) {
  return signal.severity === OperationalSignalSeverity.CRITICAL || signal.severity === OperationalSignalSeverity.HIGH;
}

function isVendorSafeSignal(signal: OperationalSignal) {
  return Boolean(
    signal.vendorId &&
      VENDOR_SAFE_SOURCE_AREAS.has(signal.sourceArea) &&
      VENDOR_NOTIFICATION_SEVERITIES.has(signal.severity),
  );
}

function buildNotificationId(input: {
  signalId: string;
  recipientRole: NotificationRecipientRole;
  vendorId?: string | null;
  channel: NotificationChannel;
}) {
  const target = input.recipientRole === NotificationRecipientRole.VENDOR ? input.vendorId ?? 'unknown-vendor' : 'admins';
  return `notif-${input.channel.toLowerCase()}-${input.recipientRole.toLowerCase()}-${target}-${input.signalId}`;
}

function buildNotificationMetadata(signal: OperationalSignal, extra: Record<string, unknown> = {}) {
  return {
    signalRuleKey: signal.ruleKey,
    signalSourceArea: signal.sourceArea,
    suggestedAction: signal.suggestedAction,
    relatedEntityLabel: signal.vendorId ? `Vendor ${signal.vendorId}` : 'Platform operations',
    dashboardPath: signal.allocationId ? '/admin/operations' : '/',
    ...extra,
  };
}

async function upsertNotification(input: {
  signal: OperationalSignal;
  recipientRole: NotificationRecipientRole;
  vendorId?: string | null;
}) {
  const channel = NotificationChannel.IN_APP;
  const id = buildNotificationId({
    signalId: input.signal.id,
    recipientRole: input.recipientRole,
    vendorId: input.vendorId,
    channel,
  });

  return prisma.notificationIntent.upsert({
    where: {
      id,
    },
    update: {
      title: input.signal.title,
      message: input.signal.description,
      severity: input.signal.severity,
      metadata: buildNotificationMetadata(input.signal),
    },
    create: {
      id,
      signalId: input.signal.id,
      vendorId: input.vendorId ?? null,
      recipientRole: input.recipientRole,
      channel,
      status: NotificationStatus.DELIVERED,
      title: input.signal.title,
      message: input.signal.description,
      severity: input.signal.severity,
      deliveredAt: new Date(),
      metadata: buildNotificationMetadata(input.signal),
    },
  });
}

function buildEmailNotificationId(input: {
  signalId: string;
  recipientRole: NotificationRecipientRole;
  vendorId?: string | null;
}) {
  return buildNotificationId({
    signalId: input.signalId,
    recipientRole: input.recipientRole,
    vendorId: input.vendorId,
    channel: NotificationChannel.EMAIL_PLACEHOLDER,
  });
}

function isEmailEligibleSignal(signal: OperationalSignal) {
  return EMAIL_NOTIFICATION_SEVERITIES.has(signal.severity);
}

async function getVendorRecipients(vendorId: string | null | undefined) {
  if (!vendorId) {
    return [];
  }

  const links = await prisma.userVendorAccess.findMany({
    where: {
      vendorId,
      user: {
        status: 'active',
      },
    },
    include: {
      user: true,
    },
    take: 20,
  });

  return links.map((link: { user: User }) => link.user.email).filter(Boolean);
}

async function upsertEmailNotification(input: {
  signal: OperationalSignal;
  recipientRole: NotificationRecipientRole;
  recipients: string[];
  vendorId?: string | null;
  env: EmailDeliveryConfig;
}) {
  const id = buildEmailNotificationId({
    signalId: input.signal.id,
    recipientRole: input.recipientRole,
    vendorId: input.vendorId,
  });

  const notification = await prisma.notificationIntent.upsert({
    where: {
      id,
    },
    update: {
      title: input.signal.title,
      message: input.signal.description,
      severity: input.signal.severity,
      metadata: buildNotificationMetadata(input.signal, {
        recipients: input.recipients,
        emailProvider: input.env.EMAIL_PROVIDER,
        emailEnabled: input.env.EMAIL_NOTIFICATIONS_ENABLED,
      }),
    },
    create: {
      id,
      signalId: input.signal.id,
      vendorId: input.vendorId ?? null,
      recipientRole: input.recipientRole,
      channel: NotificationChannel.EMAIL_PLACEHOLDER,
      status: NotificationStatus.PENDING,
      title: input.signal.title,
      message: input.signal.description,
      severity: input.signal.severity,
      metadata: buildNotificationMetadata(input.signal, {
        recipients: input.recipients,
        emailProvider: input.env.EMAIL_PROVIDER,
        emailEnabled: input.env.EMAIL_NOTIFICATIONS_ENABLED,
      }),
    },
  });

  if (notification.status === NotificationStatus.PENDING || notification.status === NotificationStatus.FAILED) {
    return runEmailDeliveryForIntent(notification, input.env);
  }

  return notification;
}

async function generateNotificationsForSignals(options: { role: AuthRole; vendorId?: string | null; env: EmailDeliveryConfig }) {
  if (options.role === 'admin') {
    await generateAutomationActionsForSignals({
      includeNotifications: true,
    });
    const signals = await prisma.operationalSignal.findMany({
      where: {
        status: 'ACTIVE',
      },
    });

    await Promise.all(
      signals
        .filter(isAdminSignal)
        .map(async (signal) => {
          await upsertNotification({
            signal,
            recipientRole: NotificationRecipientRole.ADMIN,
          });
          if (isEmailEligibleSignal(signal)) {
            await upsertEmailNotification({
              signal,
              recipientRole: NotificationRecipientRole.ADMIN,
              recipients: options.env.EMAIL_ADMIN_RECIPIENTS,
              env: options.env,
            });
          }
        }),
    );
    return;
  }

  if (!options.vendorId) {
    return;
  }

  await withDashboardTiming('signals.evaluate_operational_signals_service', () =>
    evaluateOperationalSignals({ vendorId: options.vendorId }),
  );
  const signals = await prisma.operationalSignal.findMany({
    where: {
      status: 'ACTIVE',
      vendorId: options.vendorId,
      sourceArea: {
        in: [...VENDOR_SAFE_SOURCE_AREAS],
      },
    },
  });

  await Promise.all(
    signals
      .filter(isVendorSafeSignal)
      .map(async (signal) => {
        await upsertNotification({
          signal,
          recipientRole: NotificationRecipientRole.VENDOR,
          vendorId: signal.vendorId,
        });
        if (isEmailEligibleSignal(signal)) {
          await upsertEmailNotification({
            signal,
            recipientRole: NotificationRecipientRole.VENDOR,
            vendorId: signal.vendorId,
            recipients: await getVendorRecipients(signal.vendorId),
            env: options.env,
          });
        }
      }),
  );
}

export async function listNotificationsForUser(input: {
  role: AuthRole;
  vendorId?: string | null;
  env: EmailDeliveryConfig;
}): Promise<NotificationsResponseDto> {
  const notifications = await withDashboardTiming('notifications.notification_fetch', () => prisma.notificationIntent.findMany({
    where:
      input.role === 'admin'
        ? {
            recipientRole: NotificationRecipientRole.ADMIN,
          }
        : {
            recipientRole: NotificationRecipientRole.VENDOR,
            vendorId: input.vendorId ?? undefined,
          },
    orderBy: {
      createdAt: 'desc',
    },
    take: 50,
  }));
  const aggregationStartedAt = startDashboardTimer();
  const mapped = notifications.map(mapNotification);

  const response = {
    summary: buildSummary(mapped),
    notifications: mapped,
  };
  logDashboardTiming('notifications.metrics_aggregation', aggregationStartedAt);
  return response;
}

export async function listDashboardNotificationsForUser(input: {
  role: AuthRole;
  vendorId?: string | null;
}): Promise<DashboardNotificationsResponseDto> {
  const notifications = await withDashboardTiming('notifications.dashboard_notification_fetch', () => prisma.notificationIntent.findMany({
    where:
      input.role === 'admin'
        ? {
            recipientRole: NotificationRecipientRole.ADMIN,
          }
        : {
            recipientRole: NotificationRecipientRole.VENDOR,
            vendorId: input.vendorId ?? undefined,
          },
    select: {
      id: true,
      signalId: true,
      vendorId: true,
      status: true,
      title: true,
      message: true,
      severity: true,
      deliveredAt: true,
      metadata: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: {
      createdAt: 'desc',
    },
    take: 50,
  }));

  return {
    notifications: notifications.map(mapDashboardNotification),
  };
}

export async function generateNotificationsForUser(input: {
  role: AuthRole;
  vendorId?: string | null;
  env: EmailDeliveryConfig;
}): Promise<NotificationsResponseDto> {
  await withDashboardTiming('notifications.generate_for_signals_service', () => generateNotificationsForSignals(input));
  return listNotificationsForUser(input);
}

export async function updateNotificationLifecycle(input: {
  notificationId: string;
  role: AuthRole;
  vendorId?: string | null;
  action: 'read' | 'dismiss';
}): Promise<NotificationIntentDto | null> {
  const where =
    input.role === 'admin'
      ? {
          id: input.notificationId,
          recipientRole: NotificationRecipientRole.ADMIN,
        }
      : {
          id: input.notificationId,
          recipientRole: NotificationRecipientRole.VENDOR,
          vendorId: input.vendorId ?? undefined,
        };
  const status = input.action === 'read' ? NotificationStatus.READ : NotificationStatus.DISMISSED;

  const existing = await prisma.notificationIntent.findFirst({
    where,
  });
  if (!existing) {
    return null;
  }

  try {
    const notification = await prisma.notificationIntent.update({
      where: {
        id: input.notificationId,
      },
      data: {
        status,
        readAt: status === NotificationStatus.READ ? new Date() : null,
      },
    });

    return mapNotification(notification);
  } catch {
    return null;
  }
}

export const notificationDeliveryChannels = {
  inApp: NotificationChannel.IN_APP,
  emailPlaceholder: NotificationChannel.EMAIL_PLACEHOLDER,
  slackPlaceholder: NotificationChannel.SLACK_PLACEHOLDER,
} as const;
