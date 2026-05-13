import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  notificationIntent: {
    update: vi.fn(),
  },
}));

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: prismaMock,
}));

const {
  buildEmailTemplate,
  deliverEmailNotificationIntent,
  runEmailDeliveryForIntent,
} = await import('../backend/src/modules/notifications/email-delivery.service.js');

function buildEmailIntent(overrides: Record<string, unknown> = {}) {
  const now = new Date('2026-05-13T10:00:00.000Z');
  return {
    id: 'notif-email_placeholder-admin-admins-signal-critical',
    signalId: 'signal-critical',
    vendorId: null,
    recipientRole: 'ADMIN',
    channel: 'EMAIL_PLACEHOLDER',
    status: 'PENDING',
    title: 'Operational job needs intervention',
    message: 'Operational job job-1 is dead_letter_ready after retry processing.',
    severity: 'CRITICAL',
    deliveredAt: null,
    readAt: null,
    metadata: {
      recipients: ['ops@example.test'],
      signalRuleKey: 'diagnostics.operational_job_escalated',
      signalSourceArea: 'DIAGNOSTICS',
      suggestedAction: 'Review diagnostics and use replay/recover only when safe.',
      payloadPreview: '{"secret":"must-not-render"}',
    },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('email notification delivery foundation', () => {
  beforeEach(() => {
    prismaMock.notificationIntent.update.mockReset();
    prismaMock.notificationIntent.update.mockImplementation(async ({ data, where }) => ({
      ...buildEmailIntent(),
      id: where.id,
      ...data,
    }));
  });

  it('skips delivery when email notifications are disabled', async () => {
    const result = await deliverEmailNotificationIntent(buildEmailIntent(), {
      EMAIL_NOTIFICATIONS_ENABLED: false,
      EMAIL_PROVIDER: 'console',
      EMAIL_FROM: 'ops@example.test',
      EMAIL_ADMIN_RECIPIENTS: ['ops@example.test'],
    });

    expect(result).toMatchObject({
      status: 'SKIPPED',
      summary: 'Email notifications are disabled by configuration.',
    });
  });

  it('records console provider delivery attempts when enabled', async () => {
    const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    const updated = await runEmailDeliveryForIntent(buildEmailIntent(), {
      EMAIL_NOTIFICATIONS_ENABLED: true,
      EMAIL_PROVIDER: 'console',
      EMAIL_FROM: 'ops@example.test',
      EMAIL_ADMIN_RECIPIENTS: ['ops@example.test'],
    });

    expect(updated).toMatchObject({
      status: 'DELIVERED',
    });
    expect(consoleSpy).toHaveBeenCalledWith(
      '[email:console]',
      expect.objectContaining({
        recipients: ['ops@example.test'],
        subject: '[CRITICAL] Operational job needs intervention',
      }),
    );

    consoleSpy.mockRestore();
  });

  it('marks unsupported provider delivery as failed safely', async () => {
    const result = await deliverEmailNotificationIntent(buildEmailIntent(), {
      EMAIL_NOTIFICATIONS_ENABLED: true,
      EMAIL_PROVIDER: 'unsupported' as 'console',
      EMAIL_FROM: 'ops@example.test',
      EMAIL_ADMIN_RECIPIENTS: ['ops@example.test'],
    });

    expect(result).toMatchObject({
      status: 'FAILED',
      summary: 'Unsupported email provider.',
    });
  });

  it('renders deterministic templates without raw payload previews', () => {
    const template = buildEmailTemplate(buildEmailIntent());

    expect(template.subject).toBe('[CRITICAL] Operational job needs intervention');
    expect(template.body).toContain('Severity: CRITICAL');
    expect(template.body).toContain('Suggested action: Review diagnostics and use replay/recover only when safe.');
    expect(template.body).not.toContain('must-not-render');
    expect(template.body).not.toContain('payloadPreview');
  });
});
