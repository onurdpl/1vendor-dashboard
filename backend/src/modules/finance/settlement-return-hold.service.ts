export const APPROVED_OPEN_RETURN_HOLD_REASON = 'Open approved return pending refund outcome';

type SettlementReturnHoldRecord = {
  status?: string | null;
  returnLifecycleStatus?: string | null;
  sourceShopifyRefundId?: string | null;
};

type SettlementRefundImpactRecord = {
  id?: string | null;
  sourceShopifyRefundId?: string | null;
  amount?: unknown;
};

type SettlementReturnHoldInput = {
  entryType?: string | null;
  vendorAllocation?: {
    returnRecords?: SettlementReturnHoldRecord[] | null;
    refundRecords?: SettlementRefundImpactRecord[] | null;
  } | null;
};

function normalize(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? '';
}

function getCanonicalReturnStatus(record: SettlementReturnHoldRecord) {
  return normalize(record.returnLifecycleStatus) || normalize(record.status);
}

function hasRefundImpact(allocation: NonNullable<SettlementReturnHoldInput['vendorAllocation']>) {
  if ((allocation.refundRecords ?? []).length > 0) {
    return true;
  }

  return (allocation.returnRecords ?? []).some((record) => Boolean(record.sourceShopifyRefundId?.trim()));
}

export function hasApprovedOpenReturnHold(input: SettlementReturnHoldInput) {
  if (normalize(input.entryType) !== 'sale') {
    return false;
  }

  const allocation = input.vendorAllocation;
  if (!allocation || hasRefundImpact(allocation)) {
    return false;
  }

  return (allocation.returnRecords ?? []).some((record) => getCanonicalReturnStatus(record) === 'approved');
}
