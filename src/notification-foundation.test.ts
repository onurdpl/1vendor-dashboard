import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  notificationIntent: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
  },
  operationalSignal: {
    findMany: vi.fn(),
  },
}));

const listOperationalSignalsMock = vi.hoisted(() => vi.fn());

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: prismaMock,
}));

vi.mock('../backend/src/modules/rules/rules.service.js', () => ({
  listOperationalSignals: listOperationalSignalsMock,
}));

const { listNotificationsForUser, updateNotificationLifecycle } = await import(
  '../backend/src/modules/notifications/notifications.service.js'
);

function buildSignal(overrides: Record<string, unknown>) {
  const now = new Date('2026-05-13T10:00:00.000Z');
  return {
    id: 'signal-test',
    type: 'missing_shipping_cost',
    severity: 'WARNING',
    sourceArea: 'SHIPPING_COST',
    vendorId: 'sporjinal',
    allocationId: 'alloc-1',
    financeLedgerEntryId: 'fin-1',
    payoutBatchId: null,
    operationalJobId: null,
    title: 'Shipping cost is pending',
    description: 'External-provider shipping cost is missing.',
    suggestedAction: 'Attach confirmed provider cost.',
    status: 'ACTIVE',
    ruleKey: 'shipping_cost.missing_after_fulfillment',
    triggeredAt: now,
    resolvedAt: null,
    metadata: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function buildNotification(overrides: Record<string, unknown>) {
  const now = new Date('2026-05-13T10:00:00.000Z');
  return {
    id: 'notif-in_app-vendor-sporjinal-signal-test',
    signalId: 'signal-test',
    vendorId: 'sporjinal',
    recipientRole: 'VENDOR',
    channel: 'IN_APP',
    status: 'DELIVERED',
    title: 'Shipping cost is pending',
    message: 'External-provider shipping cost is missing.',
    severity: 'WARNING',
    deliveredAt: now,
    readAt: null,
    metadata: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('notification foundation', () => {
  beforeEach(() => {
    prismaMock.notificationIntent.findFirst.mockReset();
    prismaMock.notificationIntent.findMany.mockReset();
    prismaMock.notificationIntent.update.mockReset();
    prismaMock.notificationIntent.upsert.mockReset();
    prismaMock.operationalSignal.findMany.mockReset();
    listOperationalSignalsMock.mockReset();

    listOperationalSignalsMock.mockResolvedValue({ summary: { total: 0 }, signals: [] });
    prismaMock.notificationIntent.findMany.mockResolvedValue([]);
    prismaMock.notificationIntent.upsert.mockImplementation(async ({ create, update, where }) =>
      buildNotification({
        ...create,
        ...update,
        id: where.id,
      }),
    );
  });

  it('creates one duplicate-safe in-app notification for an active vendor-safe signal', async () => {
    prismaMock.operationalSignal.findMany.mockResolvedValue([buildSignal({ id: 'signal-1' })]);

    await listNotificationsForUser({ role: 'vendor', vendorId: 'sporjinal' });
    await listNotificationsForUser({ role: 'vendor', vendorId: 'sporjinal' });

    expect(prismaMock.notificationIntent.upsert).toHaveBeenCalledTimes(2);
    expect(prismaMock.notificationIntent.upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {
          id: 'notif-in_app-vendor-sporjinal-signal-1',
        },
      }),
    );
  });

  it('keeps vendor notifications scoped and skips internal diagnostics signals for vendors', async () => {
    prismaMock.operationalSignal.findMany.mockResolvedValue([
      buildSignal({
        id: 'signal-diagnostics',
        sourceArea: 'DIAGNOSTICS',
        severity: 'HIGH',
        vendorId: 'sporjinal',
      }),
      buildSignal({
        id: 'signal-vendor',
        sourceArea: 'FULFILLMENT',
        severity: 'HIGH',
        vendorId: 'sporjinal',
      }),
    ]);

    await listNotificationsForUser({ role: 'vendor', vendorId: 'sporjinal' });

    expect(prismaMock.operationalSignal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          vendorId: 'sporjinal',
        }),
      }),
    );
    expect(prismaMock.notificationIntent.upsert).toHaveBeenCalledTimes(1);
    expect(prismaMock.notificationIntent.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'notif-in_app-vendor-sporjinal-signal-vendor',
        },
      }),
    );
  });

  it('lets admins receive high or critical internal signal notifications', async () => {
    prismaMock.operationalSignal.findMany.mockResolvedValue([
      buildSignal({
        id: 'signal-job',
        sourceArea: 'DIAGNOSTICS',
        severity: 'CRITICAL',
        vendorId: null,
      }),
    ]);

    await listNotificationsForUser({ role: 'admin' });

    expect(prismaMock.notificationIntent.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'notif-in_app-admin-admins-signal-job',
        },
      }),
    );
    expect(prismaMock.notificationIntent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          recipientRole: 'ADMIN',
        },
      }),
    );
  });

  it('updates read and dismiss lifecycle without touching the signal', async () => {
    prismaMock.notificationIntent.findFirst.mockResolvedValue(buildNotification({ id: 'notif-1' }));
    prismaMock.notificationIntent.update.mockResolvedValue(
      buildNotification({
        id: 'notif-1',
        status: 'READ',
        readAt: new Date('2026-05-13T10:30:00.000Z'),
      }),
    );

    const notification = await updateNotificationLifecycle({
      notificationId: 'notif-1',
      role: 'vendor',
      vendorId: 'sporjinal',
      action: 'read',
    });

    expect(notification).toMatchObject({
      id: 'notif-1',
      status: 'read',
      readAt: '2026-05-13T10:30:00.000Z',
    });
    expect(prismaMock.notificationIntent.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'notif-1',
        recipientRole: 'VENDOR',
        vendorId: 'sporjinal',
      },
    });
    expect(prismaMock.notificationIntent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'READ',
        }),
      }),
    );
  });
});
