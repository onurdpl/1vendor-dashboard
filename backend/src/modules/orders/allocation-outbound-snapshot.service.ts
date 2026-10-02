import type { Prisma } from '@prisma/client';
import { resolveVendorOutboundSelection } from '../vendor-integration/vendor-provider-code.js';

/** Resolve only the explicit vendor business selection for a newly created allocation. */
export async function resolveAllocationOutboundSnapshot(
  db: Pick<Prisma.TransactionClient, 'vendorShippingConfig'>,
  vendorId: string,
) {
  const config = await db.vendorShippingConfig.findUnique({
    where: { vendorId },
    select: { outboundMethod: true, selectedIntegrationProvider: true },
  });
  const selection = resolveVendorOutboundSelection({}, {
    outboundMethod: config?.outboundMethod ?? null,
    selectedIntegrationProvider: config?.selectedIntegrationProvider ?? null,
  });
  return {
    outboundMethodSnapshot: selection.outboundMethod,
    outboundIntegrationProviderSnapshot: selection.selectedIntegrationProvider,
  };
}
