import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerNotificationRoutes } from '../backend/src/modules/notifications/notifications.routes.js';

const generateNotificationsForUserMock = vi.hoisted(() => vi.fn());
const listDashboardNotificationsForUserMock = vi.hoisted(() => vi.fn());
const listNotificationsForUserMock = vi.hoisted(() => vi.fn());
const updateNotificationLifecycleMock = vi.hoisted(() => vi.fn());

vi.mock('../backend/src/modules/notifications/notifications.service.js', () => ({
  generateNotificationsForUser: generateNotificationsForUserMock,
  listDashboardNotificationsForUser: listDashboardNotificationsForUserMock,
  listNotificationsForUser: listNotificationsForUserMock,
  updateNotificationLifecycle: updateNotificationLifecycleMock,
}));

vi.mock('../backend/src/modules/auth/auth.service.js', () => ({
  createAuthService: vi.fn(() => ({})),
}));

vi.mock('../backend/src/modules/auth/auth.middleware.js', () => ({
  createAuthMiddleware: vi.fn(() => ({
    authenticateRequest: vi.fn(),
  })),
}));

vi.mock('../backend/src/modules/vendor-access/vendor-access.middleware.js', () => ({
  requireVendorAccess: vi.fn(),
}));

describe('notification route contract', () => {
  beforeEach(() => {
    generateNotificationsForUserMock.mockReset();
    listDashboardNotificationsForUserMock.mockReset();
    listNotificationsForUserMock.mockReset();
    updateNotificationLifecycleMock.mockReset();
  });

  it('keeps GET /notifications on the full notification response path', async () => {
    listNotificationsForUserMock.mockResolvedValueOnce({
      summary: {
        total: 0,
        unread: 0,
        critical: 0,
        high: 0,
        warning: 0,
      },
      notifications: [],
    });
    const gets = new Map<string, (request: { authUser?: { role?: string }; vendorContext?: { vendorId?: string } }) => unknown>();
    const app = {
      get: vi.fn((path: string, _options: unknown, handler: (request: { authUser?: { role?: string }; vendorContext?: { vendorId?: string } }) => unknown) => {
        gets.set(path, handler);
      }),
      post: vi.fn(),
    };

    registerNotificationRoutes(app as never, {} as never);
    await gets.get('/notifications')?.({
      authUser: { role: 'vendor' },
      vendorContext: { vendorId: 'sporjinal' },
    });

    expect(listNotificationsForUserMock).toHaveBeenCalledWith({
      role: 'vendor',
      vendorId: 'sporjinal',
      env: {},
    });
    expect(listDashboardNotificationsForUserMock).not.toHaveBeenCalled();
  });

  it('routes GET /notifications/dashboard to the dashboard projection path', async () => {
    listDashboardNotificationsForUserMock.mockResolvedValueOnce({
      notifications: [],
    });
    const gets = new Map<string, (request: { authUser?: { role?: string }; vendorContext?: { vendorId?: string } }) => unknown>();
    const app = {
      get: vi.fn((path: string, _options: unknown, handler: (request: { authUser?: { role?: string }; vendorContext?: { vendorId?: string } }) => unknown) => {
        gets.set(path, handler);
      }),
      post: vi.fn(),
    };

    registerNotificationRoutes(app as never, {} as never);
    const response = await gets.get('/notifications/dashboard')?.({
      authUser: { role: 'admin' },
      vendorContext: { vendorId: 'sporjinal' },
    });

    expect(response).toEqual({ notifications: [] });
    expect(listDashboardNotificationsForUserMock).toHaveBeenCalledWith({
      role: 'admin',
      vendorId: null,
    });
    expect(listNotificationsForUserMock).not.toHaveBeenCalled();
  });
});
