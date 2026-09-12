import type { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { calculateVendorPayout, type ShippingMode, type VendorFinanceProfileConfig } from './payout-calculator.js';
import { resolveEconomicOwnerForAllocation } from './economic-owner-resolution.service.js';
import { getSettlementStatus } from './finance.service.js';
import type { AllocationFinanceSummaryDto } from './finance.types.js';

const ACTIVE_PAYOUT_BATCH_STATUSES = new Set([
  'DRAFT',
  'REVIEW',
  'APPROVED',
  'EXECUTION_PENDING',
  'PAID',
  'PAID_PLACEHOLDER',
]);

const allocationFinanceSummarySelect = {
  id: true,
  vendorAllocationId: true,
  vendorId: true,
  entryType: true,
  amount: true,
  payoutStatus: true,
  settlementStatus: true,
  settlementEligibleAt: true,
  accruedAt: true,
  payableAt: true,
  settledAt: true,
  settlementHoldReason: true,
  settlementDelayDaysSnapshot: true,
  commissionPercentSnapshot: true,
  commissionVatPercentSnapshot: true,
  deductShippingEnabledSnapshot: true,
  shippingModeSnapshot: true,
  fixedShippingFeeSnapshot: true,
  shippingCostSnapshot: true,
  shippingVatAmountSnapshot: true,
  shippingCostSourceSnapshot: true,
  shippingCostProviderSnapshot: true,
  createdAt: true,
  payoutBatchLines: {
    select: {
      settlementApprovalLineId: true,
      amountSnapshot: true,
      payoutBatch: {
        select: {
          id: true,
          status: true,
          paidAt: true,
        },
      },
    },
  },
  settlementApprovalLines: {
    select: {
      id: true,
      lineType: true,
      amountMinor: true,
      commissionMinor: true,
      commissionVatMinor: true,
      payableImpactMinor: true,
      settlementApproval: {
        select: {
          id: true,
          status: true,
          approvedAt: true,
          commissionInvoices: {
            select: {
              id: true,
              status: true,
              invoiceNo: true,
              providerUuid: true,
            },
          },
        },
      },
      payoutBatchLines: {
        select: {
          settlementApprovalLineId: true,
          amountSnapshot: true,
          payoutBatch: {
            select: {
              id: true,
              status: true,
              paidAt: true,
            },
          },
        },
      },
    },
  },
  vendorAllocation: {
    select: {
      id: true,
      assignedVendorId: true,
      allocationStatus: true,
      cancelRefundReviewStatus: true,
      fulfillmentStatus: true,
      shippingStatus: true,
      order: {
        select: {
          cancelledAt: true,
        },
      },
      fulfillment: {
        select: {
          fulfilledAt: true,
          shipmentUpdatedAt: true,
        },
      },
      refundRecords: {
        select: {
          id: true,
          sourceShopifyRefundId: true,
          amount: true,
        },
      },
      returnRecords: {
        select: {
          status: true,
          returnLifecycleStatus: true,
          sourceShopifyRefundId: true,
        },
      },
      outboundShopifyRefundAttempts: {
        select: {
          status: true,
        },
      },
      customerCancellationRequestItems: {
        select: {
          status: true,
          request: {
            select: {
              status: true,
            },
          },
        },
      },
      financeEntries: {
        where: {
          voidedAt: null,
        },
        select: {
          id: true,
          entryType: true,
          payoutStatus: true,
          settlementStatus: true,
          commissionPercentSnapshot: true,
          commissionVatPercentSnapshot: true,
          payoutBatchLines: {
            select: {
              payoutBatch: {
                select: {
                  status: true,
                },
              },
            },
          },
          settlementApprovalLines: {
            select: {
              id: true,
              lineType: true,
              amountMinor: true,
              commissionMinor: true,
              commissionVatMinor: true,
              payableImpactMinor: true,
              settlementApproval: {
                select: {
                  id: true,
                  status: true,
                  approvedAt: true,
                },
              },
              payoutBatchLines: {
                select: {
                  settlementApprovalLineId: true,
                  amountSnapshot: true,
                  payoutBatch: {
                    select: {
                      id: true,
                      status: true,
                      paidAt: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.FinanceLedgerEntrySelect;

type AllocationFinanceSummaryLedger = Prisma.FinanceLedgerEntryGetPayload<{
  select: typeof allocationFinanceSummarySelect;
}>;

type AllocationFinanceSummaryDbClient = Pick<
  Prisma.TransactionClient,
  'vendorAllocation' | 'financeLedgerEntry'
>;

function normalize(value: unknown) {
  return String(value ?? '').trim().toUpperCase();
}

function toAmountString(value: number) {
  return value.toFixed(2);
}

function minorToAmount(value: number) {
  return toAmountString(value / 100);
}

function unavailableSummary(
  resolutionStatus: AllocationFinanceSummaryDto['resolutionStatus'],
): AllocationFinanceSummaryDto {
  return {
    available: false,
    resolutionStatus,
    productValue: null,
    commission: null,
    commissionVat: null,
    shippingDeduction: null,
    shippingDeductionStatus: 'unavailable',
    primaryPayable: null,
    settlementStatus: null,
    payoutStatus: null,
    paidAt: null,
  };
}

function hasFulfillmentEvidence(ledger: AllocationFinanceSummaryLedger) {
  const allocation = ledger.vendorAllocation;
  const lifecycle = [allocation?.allocationStatus, allocation?.fulfillmentStatus, allocation?.shippingStatus]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return Boolean(
    allocation?.fulfillment?.fulfilledAt ||
      lifecycle.includes('fulfilled') ||
      lifecycle.includes('shipped') ||
      lifecycle.includes('in transit') ||
      lifecycle.includes('delivered'),
  );
}

function snapshotProfile(ledger: AllocationFinanceSummaryLedger): VendorFinanceProfileConfig | null {
  if (
    ledger.commissionPercentSnapshot === null ||
    ledger.commissionVatPercentSnapshot === null ||
    ledger.deductShippingEnabledSnapshot === null ||
    ledger.shippingModeSnapshot === null
  ) {
    return null;
  }

  const shippingMode = normalize(ledger.shippingModeSnapshot).toLowerCase();
  if (shippingMode !== 'disabled' && shippingMode !== 'fixed' && shippingMode !== 'external_provider') {
    return null;
  }

  if (
    ledger.deductShippingEnabledSnapshot &&
    shippingMode === 'fixed' &&
    ledger.fixedShippingFeeSnapshot === null
  ) {
    return null;
  }

  return {
    commissionPercent: Number(ledger.commissionPercentSnapshot),
    commissionVatPercent: Number(ledger.commissionVatPercentSnapshot),
    deductShippingEnabled: ledger.deductShippingEnabledSnapshot,
    shippingMode: shippingMode as ShippingMode,
    fixedShippingFee: ledger.fixedShippingFeeSnapshot === null ? null : Number(ledger.fixedShippingFeeSnapshot),
    externalProviderShippingCost: ledger.shippingCostSnapshot === null ? null : Number(ledger.shippingCostSnapshot),
    externalProviderShippingVatAmount:
      ledger.shippingVatAmountSnapshot === null ? null : Number(ledger.shippingVatAmountSnapshot),
    shippingCostSource: ledger.shippingCostSourceSnapshot,
    shippingCostProvider: ledger.shippingCostProviderSnapshot,
    settlementDelayDays: ledger.settlementDelayDaysSnapshot,
  };
}

function mapLedgerPayoutStatus(status: unknown): AllocationFinanceSummaryDto['payoutStatus'] {
  const normalized = normalize(status).toLowerCase();
  return normalized === 'pending' || normalized === 'approved' || normalized === 'paid' || normalized === 'hold'
    ? normalized
    : null;
}

function mapBatchPayoutStatus(status: unknown): AllocationFinanceSummaryDto['payoutStatus'] {
  const normalized = normalize(status).toLowerCase();
  return normalized === 'draft' ||
    normalized === 'review' ||
    normalized === 'approved' ||
    normalized === 'execution_pending' ||
    normalized === 'paid' ||
    normalized === 'paid_placeholder'
    ? normalized
    : null;
}

export function buildAllocationFinanceSummary(
  ledger: AllocationFinanceSummaryLedger,
): AllocationFinanceSummaryDto {
  const allocation = ledger.vendorAllocation;
  if (!allocation) {
    return unavailableSummary('finance_record_unavailable');
  }

  const settlementStatus = getSettlementStatus(ledger);
  const activeEntries = allocation.financeEntries;
  const approvedLines = activeEntries.flatMap((entry) =>
    entry.settlementApprovalLines.filter((line) => normalize(line.settlementApproval.status) === 'APPROVED'),
  );
  const approvedSaleLines = approvedLines.filter(
    (line) => normalize(line.lineType) === 'SALE' &&
      activeEntries.some((entry) => entry.id === ledger.id && entry.settlementApprovalLines.some((candidate) => candidate.id === line.id)),
  );

  if (approvedSaleLines.length > 1) {
    return unavailableSummary('ambiguous_settlement_authority');
  }

  const productValue = toAmountString(Number(ledger.amount));
  let commission: string;
  let commissionVat: string;
  let shippingDeduction: string;
  let shippingDeductionStatus: AllocationFinanceSummaryDto['shippingDeductionStatus'] = 'available';
  let estimatedPayable: string | null = null;

  if (approvedSaleLines.length === 1) {
    const saleLine = approvedSaleLines[0];
    commission = minorToAmount(saleLine.commissionMinor);
    commissionVat = minorToAmount(saleLine.commissionVatMinor);
    shippingDeduction = minorToAmount(
      saleLine.amountMinor - saleLine.commissionMinor - saleLine.commissionVatMinor - saleLine.payableImpactMinor,
    );
  } else {
    const profile = snapshotProfile(ledger);
    if (!profile) {
      return unavailableSummary('missing_finance_snapshot');
    }

    const fulfilled = hasFulfillmentEvidence(ledger);
    if (
      profile.deductShippingEnabled &&
      fulfilled &&
      profile.shippingMode === 'external_provider' &&
      ledger.shippingCostSnapshot === null
    ) {
      const unavailable = unavailableSummary('missing_finance_snapshot');
      return {
        ...unavailable,
        productValue,
        shippingDeductionStatus: 'pending',
        settlementStatus,
        payoutStatus: mapLedgerPayoutStatus(ledger.payoutStatus),
      };
    }

    if (allocation.refundRecords.some((refund) => refund.amount === null)) {
      return unavailableSummary('missing_finance_snapshot');
    }
    const refundAmount = allocation.refundRecords.reduce((sum, refund) => sum + Number(refund.amount ?? 0), 0);
    const calculation = calculateVendorPayout({
      grossAmount: Number(ledger.amount),
      refundAmount,
      fulfilled,
      profile,
    });
    commission = toAmountString(calculation.commission);
    commissionVat = toAmountString(calculation.commissionVat);
    shippingDeduction = toAmountString(calculation.shippingDeduction);
    estimatedPayable = toAmountString(calculation.estimatedPayout);
  }

  const activePayoutLines = approvedLines.flatMap((line) =>
    line.payoutBatchLines.filter((payoutLine) =>
      payoutLine.settlementApprovalLineId === line.id &&
      ACTIVE_PAYOUT_BATCH_STATUSES.has(normalize(payoutLine.payoutBatch.status)),
    ),
  );
  const activePayoutBatches = new Map(
    activePayoutLines.map((line) => [line.payoutBatch.id, line.payoutBatch]),
  );
  if (activePayoutBatches.size > 1) {
    return unavailableSummary('ambiguous_payout_authority');
  }

  const activeBatch = [...activePayoutBatches.values()][0] ?? null;
  if (normalize(activeBatch?.status) === 'PAID' && !activeBatch?.paidAt) {
    return unavailableSummary('ambiguous_payout_authority');
  }

  let primaryPayable: AllocationFinanceSummaryDto['primaryPayable'] = null;
  if (settlementStatus !== 'held' && settlementStatus !== 'disputed') {
    const allApprovedLinesPaid = approvedLines.length > 0 && approvedLines.every((line) =>
      line.payoutBatchLines.some((payoutLine) =>
        payoutLine.settlementApprovalLineId === line.id &&
        payoutLine.payoutBatch.id === activeBatch?.id &&
        normalize(payoutLine.payoutBatch.status) === 'PAID' &&
        Boolean(payoutLine.payoutBatch.paidAt),
      ),
    );
    if (allApprovedLinesPaid && activeBatch) {
      primaryPayable = {
        type: 'paid_payout_contribution',
        amount: toAmountString(activePayoutLines.reduce((sum, line) => sum + Number(line.amountSnapshot), 0)),
      };
    } else if (approvedLines.length > 0) {
      primaryPayable = {
        type: 'approved',
        amount: minorToAmount(approvedLines.reduce((sum, line) => sum + line.payableImpactMinor, 0)),
      };
    } else if (estimatedPayable !== null) {
      primaryPayable = {
        type: 'estimated',
        amount: estimatedPayable,
      };
    }
  }

  return {
    available: true,
    resolutionStatus: 'resolved',
    productValue,
    commission,
    commissionVat,
    shippingDeduction,
    shippingDeductionStatus,
    primaryPayable,
    settlementStatus,
    payoutStatus: activeBatch ? mapBatchPayoutStatus(activeBatch.status) : mapLedgerPayoutStatus(ledger.payoutStatus),
    paidAt: normalize(activeBatch?.status) === 'PAID' ? activeBatch?.paidAt?.toISOString() ?? null : null,
  };
}

export async function getAllocationFinanceSummary(input: {
  vendorAllocationId: string;
  expectedVendorId: string;
  db?: AllocationFinanceSummaryDbClient;
}): Promise<AllocationFinanceSummaryDto> {
  const db = input.db ?? prisma;
  const resolution = await resolveEconomicOwnerForAllocation({
    vendorAllocationId: input.vendorAllocationId,
    db,
  });
  if (resolution.resolutionStatus !== 'resolved' || !resolution.activeSaleLedgerId) {
    return unavailableSummary(resolution.resolutionStatus);
  }
  if (resolution.economicOwnerVendorId !== input.expectedVendorId) {
    return unavailableSummary('economic_owner_mismatch');
  }

  const ledger = await db.financeLedgerEntry.findUnique({
    where: {
      id: resolution.activeSaleLedgerId,
    },
    select: allocationFinanceSummarySelect,
  });
  if (
    !ledger ||
    ledger.vendorAllocationId !== input.vendorAllocationId ||
    ledger.vendorId !== input.expectedVendorId ||
    normalize(ledger.entryType) !== 'SALE'
  ) {
    return unavailableSummary('finance_record_unavailable');
  }

  return buildAllocationFinanceSummary(ledger);
}

export const __allocationFinanceSummaryTesting = {
  allocationFinanceSummarySelect,
};
