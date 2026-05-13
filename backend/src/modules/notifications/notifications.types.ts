export type NotificationChannelDto = 'in_app' | 'email_placeholder' | 'slack_placeholder';
export type NotificationStatusDto = 'pending' | 'delivered' | 'read' | 'dismissed' | 'skipped';
export type NotificationRecipientRoleDto = 'admin' | 'vendor';
export type NotificationSeverityDto = 'info' | 'warning' | 'high' | 'critical';

export type NotificationIntentDto = {
  id: string;
  signalId: string | null;
  vendorId: string | null;
  recipientRole: NotificationRecipientRoleDto;
  channel: NotificationChannelDto;
  status: NotificationStatusDto;
  title: string;
  message: string;
  severity: NotificationSeverityDto;
  deliveredAt: string | null;
  readAt: string | null;
  metadata: unknown;
  createdAt: string;
  updatedAt: string;
};

export type NotificationsResponseDto = {
  summary: {
    total: number;
    unread: number;
    critical: number;
    high: number;
    warning: number;
  };
  notifications: NotificationIntentDto[];
};
