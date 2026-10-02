import { VendorIntegrationProviderCode, VendorOutboundMethod } from '@prisma/client';

export function parseVendorIntegrationProviderCode(value: unknown): VendorIntegrationProviderCode {
  if (value !== VendorIntegrationProviderCode.SOPYO) {
    throw new Error('providerCode must be SOPYO.');
  }
  return value;
}

export function resolveVendorOutboundSelection(
  input: { outboundMethod?: unknown; selectedIntegrationProvider?: unknown },
  current: { outboundMethod: VendorOutboundMethod | null; selectedIntegrationProvider: VendorIntegrationProviderCode | null },
) {
  const method = input.outboundMethod === undefined ? current.outboundMethod : input.outboundMethod;
  const provider = input.selectedIntegrationProvider === undefined
    ? method === VendorOutboundMethod.KARGONOMI ? null : current.selectedIntegrationProvider
    : input.selectedIntegrationProvider;

  if (method === null && provider === null) {
    return { outboundMethod: null, selectedIntegrationProvider: null };
  }
  if (method === VendorOutboundMethod.KARGONOMI && provider === null) {
    return { outboundMethod: method, selectedIntegrationProvider: null };
  }
  if (method === VendorOutboundMethod.VENDOR_INTEGRATION) {
    return { outboundMethod: method, selectedIntegrationProvider: parseVendorIntegrationProviderCode(provider) };
  }
  throw new Error('Invalid outbound shipping method/provider selection.');
}
