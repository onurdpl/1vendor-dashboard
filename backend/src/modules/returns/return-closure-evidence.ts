import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import type { CanonicalShopifyReturnSnapshot, FetchCanonicalShopifyReturnsForOrderResult, FetchShopifyReturnDetailsResult } from '../shopify/shopify-admin.types.js';

export type ReturnClosureObservation = { version: bigint; apiVersion: string };
type ClosureSnapshot = { returnGid: string; status?: string; closedAt?: string | null; closureObservation?: ReturnClosureObservation };
type ClosureDb = Pick<Prisma.TransactionClient, '$executeRaw'>;

// Only a complete canonical observation is admissible. Missing/invalid fields
// and failed reads are not evidence that a previously closed return reopened.
export function readClosureEvidence(snapshot: ClosureSnapshot) {
  if (!Object.prototype.hasOwnProperty.call(snapshot, 'closedAt')) return null;
  const status = snapshot.status?.trim().toUpperCase();
  if (!status || !['CLOSED', 'OPEN', 'REQUESTED', 'DECLINED', 'CANCELED', 'CANCELLED'].includes(status)) return null;
  const raw = snapshot.closedAt;
  if (raw !== null && (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(raw) || !Number.isFinite(Date.parse(raw)))) return null;
  if (!/^gid:\/\/shopify\/Return\/[^/]+$/.test(snapshot.returnGid)) return null;
  return { status, closedAt: status === 'CLOSED' && raw !== null ? new Date(raw!) : null };
}

export async function persistReturnClosure(db: ClosureDb, snapshot: ClosureSnapshot, orderId: string) {
  const evidence = readClosureEvidence(snapshot);
  const observation = snapshot.closureObservation;
  if (!evidence || !observation || !orderId) return;
  const orderTail = orderId.replace(/^gid:\/\/shopify\/Order\//, '');
  const returnId = snapshot.returnGid.slice('gid://shopify/Return/'.length);
  // Atomic version fence across processes. Raw SQL intentionally leaves the
  // operational @updatedAt, statuses and financial ownership untouched.
  await db.$executeRaw`
    UPDATE "ReturnRecord" r SET
      "shopifyClosedAt" = (${evidence.closedAt?.toISOString() ?? null}::timestamptz AT TIME ZONE 'UTC'),
      "shopifyClosureStatus" = ${evidence.status},
      "shopifyClosureVersion" = ${observation.version},
      "shopifyClosureApiVersion" = ${observation.apiVersion}
    FROM "VendorAllocation" a JOIN "ShopifyOrder" o ON a."sourceShopifyOrderId" = o.id
    WHERE r."vendorAllocationId" = a.id
      AND o."sourceShopifyOrderId" IN (${orderTail}, ${`gid://shopify/Order/${orderTail}`})
      AND (r."sourceShopifyReturnGid" = ${snapshot.returnGid}
        OR (r."sourceShopifyReturnGid" IS NULL AND r."sourceShopifyReturnId" = ${returnId}))
      AND (r."shopifyClosureVersion" IS NULL OR r."shopifyClosureVersion" < ${observation.version})
  `;
}

async function reserve(apiVersion: string): Promise<ReturnClosureObservation> {
  // Reserve BEFORE the external read. No transaction/lock spans that request.
  const [row] = await prisma.$queryRaw<Array<{ version: bigint }>>`SELECT nextval('"ReturnClosureObservationVersion"') AS version`;
  return { version: row.version, apiVersion };
}

export async function observeCanonicalReturnClosures(load: () => Promise<FetchCanonicalShopifyReturnsForOrderResult>, apiVersion: string, expectedOrderId: string) {
  const observation = await reserve(apiVersion);
  const result = await load();
  if (!result || result.source !== 'shopify_admin') return result;
  if (result.orderGid !== `gid://shopify/Order/${expectedOrderId.replace(/^gid:\/\/shopify\/Order\//, '')}`) throw new Error('Canonical closure order identity mismatch');
  const returns: CanonicalShopifyReturnSnapshot[] = result.returns.map((item) => ({ ...item, closureObservation: observation }));
  // Independent evidence persistence precedes operational status guards. An
  // operational rollback does not invalidate a successful canonical read.
  for (const item of returns) await persistReturnClosure(prisma, item, result.orderGid);
  return { ...result, returns };
}

export async function observeReturnDetailClosure(load: () => Promise<FetchShopifyReturnDetailsResult>, apiVersion: string, expectedReturnGid: string) {
  const observation = await reserve(apiVersion);
  const loaded = await load();
  if (loaded.source !== 'shopify_admin') return loaded;
  if (loaded.returnGid !== expectedReturnGid) throw new Error('Canonical closure return identity mismatch');
  const result = { ...loaded, closureObservation: observation };
  await persistReturnClosure(prisma, result, result.orderGid);
  return result;
}
