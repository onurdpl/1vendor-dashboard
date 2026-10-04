export const DEFAULT_SETTLEMENT_DELAY_DAYS = 21;
export const MISSING_DELIVERY_DATE_REASON = 'Missing delivery date for settlement eligibility';
export const SETTLEMENT_DELAY_PENDING_REASON = 'Settlement delay period has not elapsed';

type SettlementDelayAllocationInput = {
  id?: string | null;
  outboundMethodSnapshot?: string | null;
  outboundIntegrationProviderSnapshot?: string | null;
  deliveredObservation?: {
    vendorAllocationId: string;
    outboundMethod: string;
    outboundIntegrationProvider: string | null;
    firstObservedDeliveredAt: Date;
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

export function resolveSettlementDeliveryDate(allocation: SettlementDelayAllocationInput | null | undefined) {
  const observation = allocation?.deliveredObservation;
  if (!allocation?.id || !observation ||
      observation.vendorAllocationId !== allocation.id ||
      !allocation.outboundMethodSnapshot ||
      observation.outboundMethod !== allocation.outboundMethodSnapshot ||
      observation.outboundIntegrationProvider !== allocation.outboundIntegrationProviderSnapshot ||
      !(observation.firstObservedDeliveredAt instanceof Date) ||
      !Number.isFinite(observation.firstObservedDeliveredAt.getTime())) {
    return null;
  }
  return observation.firstObservedDeliveredAt;
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
