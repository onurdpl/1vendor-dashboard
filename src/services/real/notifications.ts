import { apiClient } from '../../lib/api-client';
import type { NotificationIntent, NotificationsResponse } from '../../lib/api/contracts';

export async function listNotifications(vendorId?: string | null, options: { signal?: AbortSignal; headers?: HeadersInit } = {}): Promise<NotificationsResponse> {
  return vendorId
    ? apiClient.get<NotificationsResponse>('/notifications', { vendorId, signal: options.signal, headers: options.headers })
    : apiClient.get<NotificationsResponse>('/notifications', { signal: options.signal, headers: options.headers });
}

export async function markNotificationRead(notificationId: string): Promise<NotificationIntent> {
  return apiClient.post<NotificationIntent>('/notifications/read', { notificationId });
}

export async function dismissNotification(notificationId: string): Promise<NotificationIntent> {
  return apiClient.post<NotificationIntent>('/notifications/dismiss', { notificationId });
}
