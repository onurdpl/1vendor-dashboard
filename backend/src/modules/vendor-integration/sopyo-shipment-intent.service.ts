import {
  Prisma,
  SopyoOrderPushStatus,
  SopyoShipmentIntentStatus,
  VendorIntegrationProviderCode,
  VendorOutboundMethod,
} from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { assertAllocationActionable } from '../orders/allocation-actionability-guard.service.js';
import { assertNoPendingCustomerCancellationHold } from '../orders/customer-cancellation-hold.service.js';
import { assertFullOrderOperationallyEligible } from '../orders/full-order-cancellation-policy.js';
import { canonicalSopyoOrderId } from '../shipping/allocation-delivered-observation.service.js';
import type { SopyoOrderCargoDetail, SopyoOrderDetail } from './sopyo-delivery.client.js';

export class SopyoShipmentIntentError extends Error {
  constructor(readonly code: 'INVALID_CARGO' | 'IDENTITY_MISMATCH' | 'NOT_ACTIONABLE') {
    super(`Sopyo shipment intent rejected: ${code}.`);
    this.name = 'SopyoShipmentIntentError';
  }
}

type VerifiedCargo = Pick<SopyoOrderDetail, 'id' | 'orderCode' | 'orderType'> & SopyoOrderCargoDetail;

function boundedCargo(value: string | null): string | null {
  const normalized = value?.trim() ?? '';
  return normalized && normalized.length <= 200 && !/[\x00-\x1f\x7f]/.test(normalized) ? normalized : null;
}

/** Internal persistence boundary only. The caller must have verified this detail with Sopyo. */
export async function recordVerifiedSopyoShipmentIntent(
  input: { allocationId: string; pushId: string; detail: VerifiedCargo },
  db: typeof prisma = prisma,
) {
  const carrier = boundedCargo(input.detail.cargoCompany);
  const trackingNumber = boundedCargo(input.detail.cargoTrackingNumber);
  if (!carrier || !trackingNumber) throw new SopyoShipmentIntentError('INVALID_CARGO');

  const sopyoOrderId = canonicalSopyoOrderId(String(input.detail.id));
  if (!sopyoOrderId || input.detail.orderType !== 'SOPYOAPI') {
    throw new SopyoShipmentIntentError('IDENTITY_MISMATCH');
  }

  return db.$transaction(async (tx) => {
    const actionability = await assertAllocationActionable(tx, input.allocationId);
    const allocation = await tx.vendorAllocation.findUnique({
      where: { id: input.allocationId },
      select: {
        id: true, assignedVendorId: true, allocationStatus: true,
        cancellationReason: true, reassignmentRequired: true,
        outboundMethodSnapshot: true, outboundIntegrationProviderSnapshot: true,
        shopifyLocationGidSnapshot: true,
        order: { select: { cancelledAt: true } },
      },
    });
    if (!allocation || allocation.allocationStatus !== 'ACTIVE' || allocation.cancellationReason ||
        allocation.reassignmentRequired) {
      throw new SopyoShipmentIntentError('NOT_ACTIONABLE');
    }
    assertFullOrderOperationallyEligible(allocation.order);
    await assertNoPendingCustomerCancellationHold(input.allocationId, tx);

    const push = await tx.sopyoOrderPush.findUnique({
      where: { id: input.pushId },
      select: { id: true, vendorAllocationId: true, assignedVendorId: true,
        orderCode: true, sopyoOrderId: true, status: true },
    });
    const location = allocation.shopifyLocationGidSnapshot?.trim();
    if (actionability.allocation.id !== allocation.id ||
        allocation.outboundMethodSnapshot !== VendorOutboundMethod.VENDOR_INTEGRATION ||
        allocation.outboundIntegrationProviderSnapshot !== VendorIntegrationProviderCode.SOPYO ||
        !location || !push || push.status !== SopyoOrderPushStatus.SUCCEEDED ||
        push.vendorAllocationId !== allocation.id ||
        push.assignedVendorId !== allocation.assignedVendorId ||
        push.orderCode !== allocation.id || input.detail.orderCode !== push.orderCode ||
        push.sopyoOrderId !== sopyoOrderId) {
      throw new SopyoShipmentIntentError('IDENTITY_MISMATCH');
    }

    const existing = await tx.sopyoShipmentIntent.findUnique({ where: { vendorAllocationId: allocation.id } });
    if (existing) {
      if (existing.sopyoOrderPushId !== push.id || existing.assignedVendorId !== allocation.assignedVendorId ||
          existing.sopyoOrderId !== sopyoOrderId || existing.orderCode !== push.orderCode ||
          existing.shopifyLocationGid !== location) {
        throw new SopyoShipmentIntentError('IDENTITY_MISMATCH');
      }
      if (existing.carrier === carrier && existing.trackingNumber === trackingNumber) return existing;
      if (existing.status === SopyoShipmentIntentStatus.CONFLICT) return existing;
      return tx.sopyoShipmentIntent.update({
        where: { id: existing.id },
        data: { status: SopyoShipmentIntentStatus.CONFLICT,
          conflictReasonCode: 'CARGO_MISMATCH', conflictObservedAt: new Date() },
      });
    }

    return tx.sopyoShipmentIntent.create({
      data: {
        vendorAllocationId: allocation.id, sopyoOrderPushId: push.id,
        assignedVendorId: allocation.assignedVendorId,
        orderCode: push.orderCode, sopyoOrderId,
        carrier, trackingNumber, shopifyLocationGid: location,
      },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}
