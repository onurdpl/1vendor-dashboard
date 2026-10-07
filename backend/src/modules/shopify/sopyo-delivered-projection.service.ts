import { Prisma, VendorIntegrationProviderCode, VendorOutboundMethod } from '@prisma/client';

const ordinaryProgression = new Set([
  'shipped', 'in_transit', 'partially_shipped', 'awaiting_shipment',
]);

/** Shopify's earlier ordinary shipment progression cannot undo verified Sopyo delivery. */
export function preserveVerifiedSopyoDelivered(input: {
  shippingStatus: string;
  outboundMethodSnapshot?: VendorOutboundMethod | null;
  outboundIntegrationProviderSnapshot?: VendorIntegrationProviderCode | null;
  deliveredObservation?: {
    vendorAllocationId: string;
    outboundMethod: VendorOutboundMethod;
    outboundIntegrationProvider: VendorIntegrationProviderCode | null;
  } | null;
  id: string;
}, nextStatus: string): boolean {
  const observation = input.deliveredObservation;
  return ordinaryProgression.has(nextStatus) &&
    input.shippingStatus.trim().toLowerCase() === 'delivered' &&
    input.outboundMethodSnapshot === VendorOutboundMethod.VENDOR_INTEGRATION &&
    input.outboundIntegrationProviderSnapshot === VendorIntegrationProviderCode.SOPYO &&
    observation?.vendorAllocationId === input.id &&
    observation.outboundMethod === VendorOutboundMethod.VENDOR_INTEGRATION &&
    observation.outboundIntegrationProvider === VendorIntegrationProviderCode.SOPYO;
}

/** Serialize with the Phase 1 allocation update, then read the committed observation. */
export async function preserveCurrentSopyoDelivered(
  tx: Prisma.TransactionClient, allocationId: string, nextStatus: string,
): Promise<boolean> {
  if (!ordinaryProgression.has(nextStatus)) return false;
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "VendorAllocation" WHERE "id" = ${allocationId} FOR UPDATE`);
  const current = await tx.vendorAllocation.findUnique({
    where: { id: allocationId }, include: { deliveredObservation: true },
  });
  return current ? preserveVerifiedSopyoDelivered(current, nextStatus) : false;
}
