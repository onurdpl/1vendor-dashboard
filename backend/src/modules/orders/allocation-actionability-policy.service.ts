export const ALLOCATION_ACTIONABILITY_REASONS = {
  refundTerminal: 'ALLOCATION_REFUND_TERMINAL',
} as const;

export type AllocationActionabilityDecision =
  | { actionable: true; reason: null }
  | {
      actionable: false;
      reason: (typeof ALLOCATION_ACTIONABILITY_REASONS)['refundTerminal'];
    };

export function evaluateAllocationActionability(input: {
  fullRefundTerminalFactPresent: boolean;
}): AllocationActionabilityDecision {
  if (input.fullRefundTerminalFactPresent) {
    return {
      actionable: false,
      reason: ALLOCATION_ACTIONABILITY_REASONS.refundTerminal,
    };
  }

  return { actionable: true, reason: null };
}
