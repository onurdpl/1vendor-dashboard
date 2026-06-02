import type { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';

type VendorIntegrationAdminDb = Pick<
  Prisma.TransactionClient,
  'vendorIntegrationClient' | 'vendorIntegrationAuditLog'
>;

const RECENT_AUDIT_LOG_LIMIT = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

function toIsoDate(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function serializeAuditLog(log: {
  method: string;
  path: string;
  statusCode: number;
  requestId: string | null;
  createdAt: Date;
}) {
  return {
    method: log.method,
    path: log.path,
    statusCode: log.statusCode,
    requestId: log.requestId,
    createdAt: log.createdAt.toISOString(),
  };
}

export async function listAdminVendorIntegrationProviders(
  options: { now?: Date } = {},
  db: VendorIntegrationAdminDb = prisma,
) {
  const now = options.now ?? new Date();
  const since = new Date(now.getTime() - DAY_MS);
  const clients = await db.vendorIntegrationClient.findMany({
    select: {
      id: true,
      providerName: true,
      vendorIdentifier: true,
      scopes: true,
      enabled: true,
      revokedAt: true,
      createdAt: true,
      updatedAt: true,
      lastUsedAt: true,
      auditLogs: {
        select: {
          method: true,
          path: true,
          statusCode: true,
          requestId: true,
          createdAt: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: RECENT_AUDIT_LOG_LIMIT,
      },
    },
    orderBy: [
      { providerName: 'asc' },
      { vendorIdentifier: 'asc' },
      { createdAt: 'desc' },
    ],
  });
  const clientIds = clients.map((client) => client.id);
  const last24hLogs = clientIds.length
    ? await db.vendorIntegrationAuditLog.findMany({
        where: {
          clientId: { in: clientIds },
          createdAt: { gte: since },
        },
        select: {
          clientId: true,
          statusCode: true,
          createdAt: true,
        },
      })
    : [];
  const countsByClient = new Map<string, { requests: number; rateLimited: number; lastRequestAt: Date | null }>();

  for (const log of last24hLogs) {
    const counts = countsByClient.get(log.clientId) ?? {
      requests: 0,
      rateLimited: 0,
      lastRequestAt: null,
    };
    counts.requests += 1;
    counts.rateLimited += log.statusCode === 429 ? 1 : 0;
    counts.lastRequestAt = !counts.lastRequestAt || counts.lastRequestAt < log.createdAt ? log.createdAt : counts.lastRequestAt;
    countsByClient.set(log.clientId, counts);
  }

  return {
    generatedAt: now.toISOString(),
    providers: clients.map((client) => {
      const counts = countsByClient.get(client.id);
      const recentAuditLogs = client.auditLogs.map(serializeAuditLog);
      return {
        clientId: client.id,
        providerName: client.providerName,
        vendorIdentifier: client.vendorIdentifier,
        scopes: client.scopes,
        enabled: client.enabled,
        revokedAt: toIsoDate(client.revokedAt),
        createdAt: client.createdAt.toISOString(),
        updatedAt: client.updatedAt.toISOString(),
        lastUsedAt: toIsoDate(client.lastUsedAt),
        lastRequestAt: toIsoDate(counts?.lastRequestAt ?? client.auditLogs[0]?.createdAt),
        requestsLast24h: counts?.requests ?? 0,
        rateLimitedLast24h: counts?.rateLimited ?? 0,
        authFailuresLast24h: null,
        recentAuditLogs,
      };
    }),
  };
}
