import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dismissNotification, markNotificationRead } from './notifications';

const notificationResponse = {
  id: 'notif-in_app-admin-sporjinal-long-notification-id-that-stays-out-of-the-url-path',
  signalId: 'signal-1',
  vendorId: 'sporjinal',
  recipientRole: 'admin',
  channel: 'in_app',
  status: 'read',
  title: 'Notification',
  message: 'Notification message.',
  severity: 'warning',
  deliveredAt: '2026-05-13T10:00:00.000Z',
  readAt: '2026-05-13T10:05:00.000Z',
  metadata: {},
  createdAt: '2026-05-13T10:00:00.000Z',
  updatedAt: '2026-05-13T10:05:00.000Z',
};

describe('real notification service', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(notificationResponse), {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it('marks notifications as read through the body route so long ids reach the backend handler', async () => {
    const notificationId = notificationResponse.id;

    await markNotificationRead(notificationId);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/notifications/read'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ notificationId }),
      }),
    );
  });

  it('dismisses notifications through the body route so cards can be removed immediately', async () => {
    const notificationId = notificationResponse.id;

    await dismissNotification(notificationId);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/notifications/dismiss'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ notificationId }),
      }),
    );
  });
});
