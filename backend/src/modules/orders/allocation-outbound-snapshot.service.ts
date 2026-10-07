import { VendorIntegrationProviderCode, VendorOutboundMethod, type Prisma } from '@prisma/client';
import { resolveVendorOutboundSelection } from '../vendor-integration/vendor-provider-code.js';

/** Resolve only the explicit vendor business selection for a newly created allocation. */
export async function resolveAllocationOutboundSnapshot(
  db: Pick<Prisma.TransactionClient, 'vendorShippingConfig'>,
  vendorId: string,
) {
  const config = await db.vendorShippingConfig.findUnique({
    where: { vendorId },
    select: { outboundMethod: true, selectedIntegrationProvider: true, shopifyLocationGid: true },
  });
  const selection = resolveVendorOutboundSelection({}, {
    outboundMethod: config?.outboundMethod ?? null,
    selectedIntegrationProvider: config?.selectedIntegrationProvider ?? null,
  });
  if (selection.outboundMethod === VendorOutboundMethod.VENDOR_INTEGRATION &&
      selection.selectedIntegrationProvider === VendorIntegrationProviderCode.SOPYO &&
      !config?.shopifyLocationGid?.trim()) {
    throw new Error('Shopify Location GID is required before creating a Sopyo allocation.');
  }
  return {
    outboundMethodSnapshot: selection.outboundMethod,
    outboundIntegrationProviderSnapshot: selection.selectedIntegrationProvider,
    shopifyLocationGidSnapshot: config?.shopifyLocationGid ?? null,
  };
}
