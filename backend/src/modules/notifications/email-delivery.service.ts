import { NotificationChannel, NotificationStatus, type NotificationIntent } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import type { AppEnv } from '../../config/env.js';

export type EmailDeliveryConfig = Pick<
  AppEnv,
  'EMAIL_NOTIFICATIONS_ENABLED' | 'EMAIL_PROVIDER' | 'EMAIL_FROM' | 'EMAIL_ADMIN_RECIPIENTS'
>;

type EmailTemplate = {
  subject: string;
  body: string;
};

type EmailDeliveryResult = {
  status: 'DELIVERED' | 'SKIPPED' | 'FAILED';
  summary: string;
  template?: EmailTemplate;
};

function normalizeRecipientList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function readMetadata(notification: NotificationIntent) {
  return typeof notification.metadata === 'object' && notification.metadata !== null && !Array.isArray(notification.metadata)
    ? notification.metadata as Record<string, unknown>
    : {};
}

export function buildEmailTemplate(notification: NotificationIntent): EmailTemplate {
  const metadata = readMetadata(notification);
  const sourceArea = typeof metadata.signalSourceArea === 'string' ? metadata.signalSourceArea : 'operational';
  const suggestedAction = typeof metadata.suggestedAction === 'string'
    ? metadata.suggestedAction
    : 'Open the operational dashboard and review the related item.';
  const relatedEntityLabel = typeof metadata.relatedEntityLabel === 'string'
    ? metadata.relatedEntityLabel
    : notification.vendorId
      ? `Vendor ${notification.vendorId}`
      : 'Platform operations';
  const dashboardPath = typeof metadata.dashboardPath === 'string' ? metadata.dashboardPath : '/';

  return {
    subject: `[${notification.severity}] ${notification.title}`,
    body: [
      notification.title,
      '',
      `Severity: ${notification.severity}`,
      `Area: ${sourceArea}`,
      `Related: ${relatedEntityLabel}`,
      '',
      notification.message,
      '',
      `Suggested action: ${suggestedAction}`,
      `Dashboard path: ${dashboardPath}`,
    ].join('\n'),
  };
}

export async function deliverEmailNotificationIntent(
  notification: NotificationIntent,
  config: EmailDeliveryConfig,
): Promise<EmailDeliveryResult> {
  if (notification.channel !== NotificationChannel.EMAIL_PLACEHOLDER) {
    return {
      status: NotificationStatus.SKIPPED,
      summary: 'Notification is not an email channel intent.',
    };
  }

  const metadata = readMetadata(notification);
  const recipients = normalizeRecipientList(metadata.recipients);
  const template = buildEmailTemplate(notification);

  if (!config.EMAIL_NOTIFICATIONS_ENABLED) {
    return {
      status: NotificationStatus.SKIPPED,
      summary: 'Email notifications are disabled by configuration.',
      template,
    };
  }

  if (recipients.length === 0) {
    return {
      status: NotificationStatus.SKIPPED,
      summary: 'No email recipients were configured for this notification.',
      template,
    };
  }

  if (config.EMAIL_PROVIDER === 'noop') {
    return {
      status: NotificationStatus.SKIPPED,
      summary: `No-op email provider skipped delivery to ${recipients.length} recipient(s).`,
      template,
    };
  }

  if (config.EMAIL_PROVIDER === 'console') {
    // Console provider is a local/dev adapter only; it deliberately avoids printing secrets or payloads.
    console.info('[email:console]', {
      from: config.EMAIL_FROM ?? 'not-configured',
      recipients,
      subject: template.subject,
      body: template.body,
    });
    return {
      status: NotificationStatus.DELIVERED,
      summary: `Console email provider recorded delivery to ${recipients.length} recipient(s).`,
      template,
    };
  }

  return {
    status: NotificationStatus.FAILED,
    summary: 'Unsupported email provider.',
    template,
  };
}

export async function runEmailDeliveryForIntent(
  notification: NotificationIntent,
  config: EmailDeliveryConfig,
) {
  const result = await deliverEmailNotificationIntent(notification, config);
  return prisma.notificationIntent.update({
    where: {
      id: notification.id,
    },
    data: {
      status: result.status,
      deliveredAt: result.status === NotificationStatus.DELIVERED ? new Date() : notification.deliveredAt,
      metadata: {
        ...readMetadata(notification),
        emailDelivery: {
          provider: config.EMAIL_PROVIDER,
          enabled: config.EMAIL_NOTIFICATIONS_ENABLED,
          status: result.status,
          summary: result.summary,
          attemptedAt: new Date().toISOString(),
          subject: result.template?.subject,
        },
      },
    },
  });
}
