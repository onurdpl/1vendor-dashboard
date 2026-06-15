export const DEFAULT_SETTLEMENT_DELAY_DAYS = 21;
export const MISSING_DELIVERY_DATE_REASON = 'Missing delivery date for settlement eligibility';
export const SETTLEMENT_DELAY_PENDING_REASON = 'Settlement delay period has not elapsed';

type SettlementDelayAllocationInput = {
  shippingStatus?: string | null;
  fulfillment?: {
    fulfilledAt?: Date | null;
    shipmentUpdatedAt?: Date | null;
  } | null;
};

type SettlementDelayInput = {
  entryType?: string | null;
  settlementDelayDaysSnapshot?: unknown;
  vendorAllocation?: SettlementDelayAllocationInput | null;
};

function normalize(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? '';
}

export function normalizeSettlementDelayDays(value: unknown, fallback = DEFAULT_SETTLEMENT_DELAY_DAYS) {
  const numeric = Number(value ?? fallback);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return fallback;
  }
  return Math.round(numeric);
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function isDelivered(allocation: SettlementDelayAllocationInput | null | undefined) {
  return normalize(allocation?.shippingStatus).includes('delivered');
}

export function resolveSettlementDeliveryDate(allocation: SettlementDelayAllocationInput | null | undefined) {
  if (!isDelivered(allocation)) {
    return null;
  }

  return allocation?.fulfillment?.shipmentUpdatedAt ?? null;
}

export function evaluateSaleSettlementDelay(input: SettlementDelayInput, now = new Date()) {
  if (normalize(input.entryType) !== 'sale') {
    return {
      applies: false,
      eligible: true,
      delayDays: normalizeSettlementDelayDays(input.settlementDelayDaysSnapshot),
      deliveryDate: null,
      eligibleAt: null,
      blockerReason: null,
    };
  }

  const delayDays = normalizeSettlementDelayDays(input.settlementDelayDaysSnapshot);
  const deliveryDate = resolveSettlementDeliveryDate(input.vendorAllocation);
  if (!deliveryDate) {
    return {
      applies: true,
      eligible: false,
      delayDays,
      deliveryDate: null,
      eligibleAt: null,
      blockerReason: MISSING_DELIVERY_DATE_REASON,
    };
  }

  const eligibleAt = addDays(deliveryDate, delayDays);
  const eligible = eligibleAt.getTime() <= now.getTime();
  return {
    applies: true,
    eligible,
    delayDays,
    deliveryDate,
    eligibleAt,
    blockerReason: eligible ? null : SETTLEMENT_DELAY_PENDING_REASON,
  };
}
