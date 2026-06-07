import type { FastifyInstance } from 'fastify';
import type { AppEnv } from '../../config/env.js';
import { createAuthMiddleware } from '../auth/auth.middleware.js';
import { createAuthService } from '../auth/auth.service.js';
import { requireVendorAccess } from '../vendor-access/vendor-access.middleware.js';
import { generateNotificationsForUser, listNotificationsForUser, updateNotificationLifecycle } from './notifications.service.js';
import { withDashboardRouteTiming } from '../../lib/dashboard-timing.js';

type NotificationActionBody = {
  notificationId?: string;
};

export function registerNotificationRoutes(app: FastifyInstance, env: AppEnv) {
  const authService = createAuthService(env);
  const authMiddleware = createAuthMiddleware(authService);

  app.get(
    '/notifications',
    {
      preHandler: [authMiddleware.authenticateRequest, requireVendorAccess],
    },
    async (request) => {
      return withDashboardRouteTiming('GET /notifications', () =>
        listNotificationsForUser({
          role: request.authUser?.role ?? 'vendor',
          vendorId: request.authUser?.role === 'admin' ? null : request.vendorContext?.vendorId,
          env,
        }),
      );
    },
  );

  app.post(
    '/notifications/generate',
    {
      preHandler: [authMiddleware.authenticateRequest, requireVendorAccess],
    },
    async (request) => {
      return withDashboardRouteTiming('POST /notifications/generate', () =>
        generateNotificationsForUser({
          role: request.authUser?.role ?? 'vendor',
          vendorId: request.authUser?.role === 'admin' ? null : request.vendorContext?.vendorId,
          env,
        }),
      );
    },
  );

  app.post<{ Body: NotificationActionBody }>(
    '/notifications/read',
    {
      preHandler: [authMiddleware.authenticateRequest, requireVendorAccess],
    },
    async (request, reply) => {
      const notificationId = request.body?.notificationId?.trim();
      if (!notificationId) {
        return reply.code(400).send({ message: 'notificationId is required.' });
      }

      const notification = await updateNotificationLifecycle({
        notificationId,
        role: request.authUser?.role ?? 'vendor',
        vendorId: request.authUser?.role === 'admin' ? null : request.vendorContext?.vendorId,
        action: 'read',
      });
      if (!notification) {
        return reply.code(404).send({ message: 'Notification not found.' });
      }

      return notification;
    },
  );

  app.post<{ Body: NotificationActionBody }>(
    '/notifications/dismiss',
    {
      preHandler: [authMiddleware.authenticateRequest, requireVendorAccess],
    },
    async (request, reply) => {
      const notificationId = request.body?.notificationId?.trim();
      if (!notificationId) {
        return reply.code(400).send({ message: 'notificationId is required.' });
      }

      const notification = await updateNotificationLifecycle({
        notificationId,
        role: request.authUser?.role ?? 'vendor',
        vendorId: request.authUser?.role === 'admin' ? null : request.vendorContext?.vendorId,
        action: 'dismiss',
      });
      if (!notification) {
        return reply.code(404).send({ message: 'Notification not found.' });
      }

      return notification;
    },
  );

  app.post<{ Params: { notificationId: string } }>(
    '/notifications/:notificationId/read',
    {
      preHandler: [authMiddleware.authenticateRequest, requireVendorAccess],
    },
    async (request, reply) => {
      const notification = await updateNotificationLifecycle({
        notificationId: request.params.notificationId,
        role: request.authUser?.role ?? 'vendor',
        vendorId: request.authUser?.role === 'admin' ? null : request.vendorContext?.vendorId,
        action: 'read',
      });
      if (!notification) {
        return reply.code(404).send({ message: 'Notification not found.' });
      }

      return notification;
    },
  );

  app.post<{ Params: { notificationId: string } }>(
    '/notifications/:notificationId/dismiss',
    {
      preHandler: [authMiddleware.authenticateRequest, requireVendorAccess],
    },
    async (request, reply) => {
      const notification = await updateNotificationLifecycle({
        notificationId: request.params.notificationId,
        role: request.authUser?.role ?? 'vendor',
        vendorId: request.authUser?.role === 'admin' ? null : request.vendorContext?.vendorId,
        action: 'dismiss',
      });
      if (!notification) {
        return reply.code(404).send({ message: 'Notification not found.' });
      }

      return notification;
    },
  );
}
