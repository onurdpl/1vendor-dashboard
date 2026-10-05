import { randomUUID } from 'node:crypto';
import { Prisma, SopyoOrderPushStatus, VendorIntegrationProviderCode, VendorOutboundMethod } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { getDecryptedSopyoCredentialForInternalUse } from './sopyo-credential.service.js';
import { createSopyoDeliveryClient } from './sopyo-delivery.client.js';
import {
  buildSopyoOrderPayload, SopyoOneShotBlockedError, sopyoPayloadAllocationSelect,
} from './sopyo-one-shot-order-create.service.js';

type Db = typeof prisma;
type Result = {
  pushId: string;
  status: SopyoOrderPushStatus | 'NOT_CLAIMED';
  result?: 'CREATED' | 'RECONCILED_EXISTING' | 'RECONCILED_AFTER_AMBIGUOUS';
  sopyoOrderId?: number;
  reasonCode?: string;
  httpStatus?: number;
};

const STALE_PROCESSING_MS = 30 * 60 * 1000;

function moneyIs(value: Prisma.Decimal | null, expected: string): boolean {
  return value !== null && value.equals(new Prisma.Decimal(expected));
}

async function loadCanonicalPayload(db: Db, push: {
  vendorAllocationId: string; assignedVendorId: string; orderCode: string;
}, reconcileOnly: boolean) {
  const allocation = await db.vendorAllocation.findUnique({
    where: { id: push.vendorAllocationId }, select: sopyoPayloadAllocationSelect,
  });
  if (!allocation || allocation.id !== push.orderCode ||
      allocation.assignedVendorId !== push.assignedVendorId ||
      allocation.outboundMethodSnapshot !== VendorOutboundMethod.VENDOR_INTEGRATION ||
      allocation.outboundIntegrationProviderSnapshot !== VendorIntegrationProviderCode.SOPYO ||
      allocation.allocationStatus !== 'ACTIVE' || allocation.reassignmentRequired ||
      allocation.order.cancelledAt !== null) {
    return { reasonCode: 'ALLOCATION_AUTHORITY_MISMATCH' } as const;
  }
  // An uncertain prior POST must remain lookup-reconcilable even if monetary or
  // retained payload evidence has since become unavailable. This mode never POSTs.
  if (reconcileOnly) return { payload: null } as const;

  const [allocationCount, orderLineCount] = await Promise.all([
    db.vendorAllocation.count({ where: { sourceShopifyOrderId: allocation.order.id } }),
    db.shopifyOrderLineItem.count({ where: { shopifyOrderId: allocation.order.id } }),
  ]);
  const line = allocation.lineItems[0];
  const amount = line?.lineAmount;
  const unitPrice = line?.shopifyOrderLineItem.unitPrice;
  if (allocationCount !== 1 || orderLineCount !== 1 || allocation.lineItems.length !== 1 ||
      !line || !amount || !unitPrice || !line.shopifyOrderLineItem.lineTotalVatIncluded ||
      !Number.isSafeInteger(line.quantity) || line.quantity <= 0 ||
      line.shopifyOrderLineItem.shopifyOrderId !== allocation.order.id ||
      line.shopifyOrderLineItem.quantity !== line.quantity ||
      !line.shopifyOrderLineItem.sku?.trim() || !line.shopifyOrderLineItem.title?.trim() ||
      allocation.order.currency !== 'TRY' || allocation.order.taxesIncluded !== true ||
      !moneyIs(allocation.order.discountAmount, '0') ||
      !allocation.order.shippingAmount || allocation.order.shippingAmount.lt(0) ||
      !amount.gt(0) || !amount.equals(line.shopifyOrderLineItem.lineTotalVatIncluded) ||
      !amount.equals(unitPrice.mul(line.quantity)) ||
      !allocation.order.totalPrice ||
      !allocation.order.totalPrice.equals(amount.plus(allocation.order.shippingAmount))) {
    return { reasonCode: 'MONETARY_MAPPING_UNSUPPORTED' } as const;
  }
  const events = await db.webhookEvent.findMany({
    where: {
      topic: 'orders/create', status: 'PROCESSED',
      OR: [
        { shopifyOrderId: allocation.order.id },
        { sourceShopifyOrderId: allocation.order.sourceShopifyOrderId },
      ],
    },
    select: { rawPayload: true },
  });
  if (events.length !== 1 || !events[0]?.rawPayload) return { reasonCode: 'RAW_WEBHOOK_NOT_UNIQUE' } as const;
  try {
    return { payload: buildSopyoOrderPayload(
      allocation, events[0].rawPayload, amount.toNumber(), line.quantity,
    ) } as const;
  } catch (error) {
    return { reasonCode: error instanceof SopyoOneShotBlockedError ? error.code : 'PAYLOAD_UNAVAILABLE' } as const;
  }
}

/** One explicit push. No scan, scheduler, or automatic retry is performed here. */
export async function dispatchSopyoOrderPush(options: {
  pushId: string;
  reconcileOnly?: boolean;
  db?: Db;
  fetcher?: typeof fetch;
  loadCredential?: (vendorId: string) => Promise<string>;
  now?: () => Date;
}): Promise<Result> {
  const db = options.db ?? prisma;
  const now = options.now ?? (() => new Date());
  const push = await db.sopyoOrderPush.findUnique({ where: { id: options.pushId } });
  if (!push) return { pushId: options.pushId, status: 'NOT_CLAIMED', reasonCode: 'PUSH_NOT_FOUND' };
  const claimedPush = push;
  const token = randomUUID();
  const claimTime = now();
  if (options.reconcileOnly) {
    const staleBefore = new Date(claimTime.getTime() - STALE_PROCESSING_MS);
    const claim = await db.sopyoOrderPush.updateMany({
      where: {
        id: push.id,
        OR: [
          { status: SopyoOrderPushStatus.RECONCILE_REQUIRED },
          { status: SopyoOrderPushStatus.PROCESSING, processingStartedAt: { lte: staleBefore } },
        ],
      },
      data: { status: SopyoOrderPushStatus.PROCESSING, claimToken: token, processingStartedAt: claimTime },
    });
    if (claim.count !== 1) return { pushId: push.id, status: 'NOT_CLAIMED', reasonCode: 'NOT_RECONCILABLE' };
  } else {
    const claim = await db.sopyoOrderPush.updateMany({
      where: { id: push.id, status: SopyoOrderPushStatus.PENDING },
      data: { status: SopyoOrderPushStatus.PROCESSING, claimToken: token, processingStartedAt: claimTime },
    });
    if (claim.count !== 1) return { pushId: push.id, status: 'NOT_CLAIMED', reasonCode: 'ALREADY_CLAIMED' };
  }

  async function finish(
    status: SopyoOrderPushStatus, reasonCode?: string, sopyoOrderId?: number, httpStatus?: number,
    result?: Result['result'],
  ): Promise<Result> {
    const update = await db.sopyoOrderPush.updateMany({
      where: { id: claimedPush.id, status: SopyoOrderPushStatus.PROCESSING, claimToken: token },
      data: {
        status, claimToken: null, reasonCode: reasonCode ?? null,
        sopyoOrderId: sopyoOrderId === undefined ? null : String(sopyoOrderId), httpStatus: httpStatus ?? null,
        completedAt: status === SopyoOrderPushStatus.SUCCEEDED || status === SopyoOrderPushStatus.BLOCKED ? now() : null,
      },
    });
    if (update.count !== 1) return { pushId: claimedPush.id, status: 'NOT_CLAIMED', reasonCode: 'CLAIM_LOST' };
    return { pushId: claimedPush.id, status, ...(reasonCode ? { reasonCode } : {}),
      ...(sopyoOrderId ? { sopyoOrderId } : {}), ...(httpStatus !== undefined ? { httpStatus } : {}),
      ...(result ? { result } : {}) };
  }

  const canonical = await loadCanonicalPayload(db, push, options.reconcileOnly === true);
  if ('reasonCode' in canonical) {
    return finish(options.reconcileOnly ? SopyoOrderPushStatus.RECONCILE_REQUIRED : SopyoOrderPushStatus.BLOCKED,
      canonical.reasonCode);
  }
  let credential: string;
  let bearer: string;
  const client = createSopyoDeliveryClient(options.fetcher);
  try {
    credential = await (options.loadCredential ?? getDecryptedSopyoCredentialForInternalUse)(push.assignedVendorId);
    bearer = await client.authenticate(credential);
  } catch {
    return finish(options.reconcileOnly ? SopyoOrderPushStatus.RECONCILE_REQUIRED : SopyoOrderPushStatus.BLOCKED,
      'AUTH_UNAVAILABLE');
  }

  async function lookup() {
    return client.ordersByCode(bearer, claimedPush.orderCode);
  }
  let existing;
  try {
    existing = await lookup();
  } catch {
    return finish(options.reconcileOnly ? SopyoOrderPushStatus.RECONCILE_REQUIRED : SopyoOrderPushStatus.BLOCKED,
      'LOOKUP_UNAVAILABLE');
  }
  if (existing.length === 1 && existing[0]?.orderType === 'SOPYOAPI') {
    return finish(SopyoOrderPushStatus.SUCCEEDED, undefined, existing[0].id, undefined, 'RECONCILED_EXISTING');
  }
  if (existing.length > 0) return finish(SopyoOrderPushStatus.RECONCILE_REQUIRED, 'EXISTING_ORDER_CONFLICT');
  if (options.reconcileOnly) return finish(SopyoOrderPushStatus.RECONCILE_REQUIRED, 'ORDER_NOT_FOUND');
  if (!canonical.payload) return finish(SopyoOrderPushStatus.BLOCKED, 'PAYLOAD_UNAVAILABLE');
  const beforeCreate = await loadCanonicalPayload(db, push, false);
  if ('reasonCode' in beforeCreate || !beforeCreate.payload ||
      JSON.stringify(beforeCreate.payload) !== JSON.stringify(canonical.payload)) {
    return finish(SopyoOrderPushStatus.BLOCKED, 'SOURCE_CHANGED_BEFORE_CREATE');
  }

  // After this call starts, absence from a subsequent lookup cannot prove no external create occurred.
  const created = await client.createOrderOnce(bearer, beforeCreate.payload, credential);
  if (created.kind === 'CREATED') {
    if (created.orderCode === push.orderCode && created.orderType === 'SOPYOAPI') {
      return finish(SopyoOrderPushStatus.SUCCEEDED, undefined, created.id, 201, 'CREATED');
    }
    return finish(SopyoOrderPushStatus.RECONCILE_REQUIRED, 'CREATE_IDENTITY_CONFLICT', undefined, 201);
  }
  if (created.kind === 'REJECTED') {
    return finish(SopyoOrderPushStatus.BLOCKED, 'PROVIDER_REJECTED', undefined, created.httpStatus);
  }
  try {
    const after = await lookup();
    if (after.length === 1 && after[0]?.orderType === 'SOPYOAPI') {
      return finish(SopyoOrderPushStatus.SUCCEEDED, undefined, after[0].id,
        'httpStatus' in created ? created.httpStatus : undefined, 'RECONCILED_AFTER_AMBIGUOUS');
    }
    return finish(SopyoOrderPushStatus.RECONCILE_REQUIRED,
      after.length === 0 ? 'NOT_FOUND_AFTER_AMBIGUOUS_CREATE' : 'AMBIGUOUS_ORDER_CONFLICT',
      undefined, 'httpStatus' in created ? created.httpStatus : undefined);
  } catch {
    return finish(SopyoOrderPushStatus.RECONCILE_REQUIRED, 'LOOKUP_FAILED_AFTER_AMBIGUOUS_CREATE',
      undefined, 'httpStatus' in created ? created.httpStatus : undefined);
  }
}
