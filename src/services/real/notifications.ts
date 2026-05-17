import { apiClient } from '../../lib/api-client';
import type { NotificationIntent, NotificationsResponse } from '../../lib/api/contracts';

export async function listNotifications(vendorId?: string | null): Promise<NotificationsResponse> {
  return vendorId
    ? apiClient.get<NotificationsResponse>('/notifications', { vendorId })
    : apiClient.get<NotificationsResponse>('/notifications');
}

export async function markNotificationRead(notificationId: string): Promise<NotificationIntent> {
  return apiClient.post<NotificationIntent>('/notifications/read', { notificationId });
}

export async function dismissNotification(notificationId: string): Promise<NotificationIntent> {
  return apiClient.post<NotificationIntent>('/notifications/dismiss', { notificationId });
}
