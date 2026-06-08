import { apiClient } from '../../lib/api-client';
import type { DashboardNotificationsResponse, NotificationIntent, NotificationsResponse } from '../../lib/api/contracts';

export async function listNotifications(vendorId?: string | null, options: { signal?: AbortSignal; headers?: HeadersInit } = {}): Promise<NotificationsResponse> {
  return vendorId
    ? apiClient.get<NotificationsResponse>('/notifications', { vendorId, signal: options.signal, headers: options.headers })
    : apiClient.get<NotificationsResponse>('/notifications', { signal: options.signal, headers: options.headers });
}

export async function listDashboardNotifications(vendorId?: string | null, options: { signal?: AbortSignal; headers?: HeadersInit } = {}): Promise<DashboardNotificationsResponse> {
  return vendorId
    ? apiClient.get<DashboardNotificationsResponse>('/notifications/dashboard', { vendorId, signal: options.signal, headers: options.headers })
    : apiClient.get<DashboardNotificationsResponse>('/notifications/dashboard', { signal: options.signal, headers: options.headers });
}

export async function markNotificationRead(notificationId: string): Promise<NotificationIntent> {
  return apiClient.post<NotificationIntent>('/notifications/read', { notificationId });
}

export async function dismissNotification(notificationId: string): Promise<NotificationIntent> {
  return apiClient.post<NotificationIntent>('/notifications/dismiss', { notificationId });
}
