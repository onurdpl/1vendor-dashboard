import { apiClient } from '../../lib/api-client';
import type { NotificationIntent, NotificationsResponse } from '../../lib/api/contracts';

export async function listNotifications(vendorId?: string | null, options: { signal?: AbortSignal } = {}): Promise<NotificationsResponse> {
  return vendorId
    ? apiClient.get<NotificationsResponse>('/notifications', { vendorId, signal: options.signal })
    : apiClient.get<NotificationsResponse>('/notifications', { signal: options.signal });
}

export async function markNotificationRead(notificationId: string): Promise<NotificationIntent> {
  return apiClient.post<NotificationIntent>('/notifications/read', { notificationId });
}

export async function dismissNotification(notificationId: string): Promise<NotificationIntent> {
  return apiClient.post<NotificationIntent>('/notifications/dismiss', { notificationId });
}
