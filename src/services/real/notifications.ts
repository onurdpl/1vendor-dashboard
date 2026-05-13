import { apiClient } from '../../lib/api-client';
import type { NotificationIntent, NotificationsResponse } from '../../lib/api/contracts';

export async function listNotifications(): Promise<NotificationsResponse> {
  return apiClient.get<NotificationsResponse>('/notifications');
}

export async function markNotificationRead(notificationId: string): Promise<NotificationIntent> {
  return apiClient.post<NotificationIntent>(`/notifications/${encodeURIComponent(notificationId)}/read`);
}

export async function dismissNotification(notificationId: string): Promise<NotificationIntent> {
  return apiClient.post<NotificationIntent>(`/notifications/${encodeURIComponent(notificationId)}/dismiss`);
}
