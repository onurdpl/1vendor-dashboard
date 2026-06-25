export type RefundLedgerEntryIdInput = {
  vendorId: string;
  sourceShopifyRefundId: string;
  vendorAllocationId: string;
};

export function buildRefundLedgerEntryId(input: RefundLedgerEntryIdInput) {
  return `fin-${input.vendorId}-refund-${input.sourceShopifyRefundId}-${input.vendorAllocationId}`;
}

export function buildLegacyRefundLedgerEntryId(input: Omit<RefundLedgerEntryIdInput, 'vendorAllocationId'>) {
  return `fin-${input.vendorId}-refund-${input.sourceShopifyRefundId}`;
}

export function matchesRefundLedgerSource(input: {
  ledgerId: string;
  sourceShopifyRefundId: string;
}) {
  return input.ledgerId.includes(`-refund-${input.sourceShopifyRefundId}`);
}
