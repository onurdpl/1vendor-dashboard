export type NotificationChannelDto = 'in_app' | 'email_placeholder' | 'slack_placeholder';
export type NotificationStatusDto = 'pending' | 'delivered' | 'read' | 'dismissed' | 'skipped' | 'failed';
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

export type DashboardNotificationMetadataDto = Partial<Record<
  | 'signalSourceArea'
  | 'category'
  | 'linkedEntityType'
  | 'linkedEntityId'
  | 'orderId'
  | 'returnRequestId'
  | 'supportTicketId',
  string
>>;

export type DashboardNotificationIntentDto = {
  id: string;
  signalId: string | null;
  vendorId: string | null;
  status: NotificationStatusDto;
  title: string;
  message: string;
  severity: NotificationSeverityDto;
  deliveredAt: string | null;
  metadata: DashboardNotificationMetadataDto;
  createdAt: string;
  updatedAt: string;
};

export type DashboardNotificationsResponseDto = {
  notifications: DashboardNotificationIntentDto[];
};
