import {
  CancellationReason,
  OperationalSignalSeverity,
  OperationalSignalSourceArea,
  OperationalSignalStatus,
  PayoutStatus,
  Prisma,
  SettlementStatus,
} from '@prisma/client';
import type { AppEnv } from '../../config/env.js';
import { prisma } from '../../db/prisma.js';
import { createShopifyAdminService } from '../shopify/shopify-admin.service.js';
import type { CanonicalShopifyOrderSnapshot } from '../shopify/shopify-admin.types.js';
import type {
  CanonicalOrderCancellationReconciliationReport,
  CanonicalOrderCancellationState,
} from './reconciliation.types.js';

const CANONICAL_CANCELLATION_SIGNAL_RULE_KEYS = {
  reconciled: 'canonical_order_cancelled_reconciled',
  requiresFinanceReview: 'canonical_order_cancellation_requires_finance_review',
  partialRequiresManualReview: 'canonical_order_partial_cancellation_requires_manual_review',
  conflictsWithOperationalState: 'canonical_order_cancellation_conflicts_with_operational_state',
  repairFailed: 'canonical_order_cancellation_repair_failed',
} as const;

type CanonicalCancellationSignalRuleKey =
  (typeof CANONICAL_CANCELLATION_SIGNAL_RULE_KEYS)[keyof typeof CANONICAL_CANCELLATION_SIGNAL_RULE_KEYS];

type CancellationClassification = {
  state: CanonicalOrderCancellationState;
  affectedLineItemIds: string[];
  reason: string | null;
};

function sanitizeSignalPart(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unknown';
}

function buildCanonicalCancellationSignalId(input: {
  ruleKey: CanonicalCancellationSignalRuleKey;
  sourceShopifyOrderId: string;
}) {
  return [
    'signal',
    sanitizeSignalPart(input.ruleKey),
    sanitizeSignalPart(input.sourceShopifyOrderId),
  ].join('-');
}

function toJsonObject(value: Record<string, unknown>): Prisma.InputJsonObject {
  return value as Prisma.InputJsonObject;
}

async function upsertCanonicalCancellationSignal(input: {
  ruleKey: CanonicalCancellationSignalRuleKey;
  sourceShopifyOrderId: string;
  severity?: OperationalSignalSeverity;
  title: string;
  description: string;
  suggestedAction: string;
  metadata?: Record<string, unknown>;
}) {
  await prisma.operationalSignal.upsert({
    where: {
      id: buildCanonicalCancellationSignalId(input),
    },
    create: {
      id: buildCanonicalCancellationSignalId(input),
      type: 'reconciliation_issue',
      severity: input.severity ?? OperationalSignalSeverity.WARNING,
      sourceArea: OperationalSignalSourceArea.RECONCILIATION,
      title: input.title,
      description: input.description,
      suggestedAction: input.suggestedAction,
      status: OperationalSignalStatus.ACTIVE,
      ruleKey: input.ruleKey,
      triggeredAt: new Date(),
      metadata: toJsonObject({
        sourceShopifyOrderId: input.sourceShopifyOrderId,
        ...(input.metadata ?? {}),
      }),
    },
    update: {
      severity: input.severity ?? OperationalSignalSeverity.WARNING,
      sourceArea: OperationalSignalSourceArea.RECONCILIATION,
      title: input.title,
      description: input.description,
      suggestedAction: input.suggestedAction,
      status: OperationalSignalStatus.ACTIVE,
      resolvedAt: null,
      triggeredAt: new Date(),
      metadata: toJsonObject({
        sourceShopifyOrderId: input.sourceShopifyOrderId,
        ...(input.metadata ?? {}),
      }),
    },
  });
}

async function resolveCanonicalCancellationSignals(input: {
  sourceShopifyOrderId: string;
  ruleKeys: CanonicalCancellationSignalRuleKey[];
}) {
  await prisma.operationalSignal.updateMany({
    where: {
      id: {
        in: input.ruleKeys.map((ruleKey) =>
          buildCanonicalCancellationSignalId({
            ruleKey,
            sourceShopifyOrderId: input.sourceShopifyOrderId,
          })
        ),
      },
      status: {
        in: [OperationalSignalStatus.ACTIVE, OperationalSignalStatus.ACKNOWLEDGED],
      },
    },
    data: {
      status: OperationalSignalStatus.RESOLVED,
      resolvedAt: new Date(),
    },
  });
}

function classifyCanonicalCancellation(snapshot: CanonicalShopifyOrderSnapshot): CancellationClassification {
  if (snapshot.cancelledAt) {
    return {
      state: 'full_order_cancelled',
      affectedLineItemIds: snapshot.lineItems.map((lineItem) => lineItem.sourceLineItemId),
      reason: snapshot.cancelReason ?? 'shopify_order_cancelled',
    };
  }

  const ambiguousReducedLines = snapshot.lineItems.filter((lineItem) =>
    typeof lineItem.currentQuantity === 'number' &&
    typeof lineItem.quantity === 'number' &&
    lineItem.currentQuantity < lineItem.quantity
  );

  if (ambiguousReducedLines.length > 0) {
    return {
      state: 'unknown_requires_manual_review',
      affectedLineItemIds: ambiguousReducedLines.map((lineItem) => lineItem.sourceLineItemId),
      reason: 'line_quantity_reduced_without_full_order_cancellation',
    };
  }

  return {
    state: 'none',
    affectedLineItemIds: [],
    reason: null,
  };
}

function isFulfillmentConflict(allocation: {
  fulfillmentStatus: string;
  shippingStatus: string;
  trackingNumber: string | null;
  carrier: string | null;
}) {
  const statusText = `${allocation.fulfillmentStatus} ${allocation.shippingStatus}`.toLowerCase();
  return (
    statusText.includes('fulfilled') ||
    statusText.includes('delivered') ||
    statusText.includes('shipped') ||
    Boolean(allocation.trackingNumber || allocation.carrier)
  );
}

function isFinanceReviewRequired(ledger: {
  payoutStatus: PayoutStatus;
  settlementApprovalLines: Array<{ settlementApproval: { status: string } }>;
  payoutBatchLines: Array<{ payoutBatch: { status: string } }>;
}) {
  if (ledger.payoutStatus === PayoutStatus.PAID) {
    return true;
  }
  if (ledger.settlementApprovalLines.some((line) => line.settlementApproval.status === 'APPROVED')) {
    return true;
  }
  return ledger.payoutBatchLines.some((line) => line.payoutBatch.status !== 'CANCELLED');
}

async function findLocalOrderForCancellation(sourceShopifyOrderId: string) {
  return prisma.shopifyOrder.findUnique({
    where: {
      sourceShopifyOrderId,
    },
    include: {
      allocations: {
        include: {
          refundRecords: {
            select: {
              id: true,
            },
          },
          returnRecords: {
            select: {
              id: true,
            },
          },
          financeEntries: {
            where: {
              entryType: 'sale',
            },
            include: {
              settlementApprovalLines: {
                include: {
                  settlementApproval: {
                    select: {
                      status: true,
                    },
                  },
                },
              },
              payoutBatchLines: {
                include: {
                  payoutBatch: {
                    select: {
                      status: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
      lineItems: {
        select: {
          sourceLineItemId: true,
        },
      },
    },
  });
}

function buildEmptyReport(input: {
  shopifyOrderId: string;
  cancellationState: CanonicalOrderCancellationState;
  affectedLineItems?: string[];
}): CanonicalOrderCancellationReconciliationReport {
  return {
    shopifyOrderId: input.shopifyOrderId,
    cancellationState: input.cancellationState,
    affectedAllocations: [],
    affectedLineItems: input.affectedLineItems ?? [],
    ledgersHeldOrVoided: [],
    skippedCount: 0,
    failedCount: 0,
    signalsCreatedOrUpdated: 0,
    results: [],
  };
}

export function createCanonicalCancellationReconciliationService(env: AppEnv) {
  const shopifyAdminService = createShopifyAdminService(env);

  async function reconcileShopifyOrderCancellation(sourceShopifyOrderId: string): Promise<CanonicalOrderCancellationReconciliationReport | null> {
    const canonicalOrder = await shopifyAdminService.fetchCanonicalOrderSnapshot(sourceShopifyOrderId);
    if (!canonicalOrder) {
      return null;
    }

    const classification = classifyCanonicalCancellation(canonicalOrder);
    const report = buildEmptyReport({
      shopifyOrderId: sourceShopifyOrderId,
      cancellationState: classification.state,
      affectedLineItems: classification.affectedLineItemIds,
    });

    if (classification.state === 'none') {
      await resolveCanonicalCancellationSignals({
        sourceShopifyOrderId,
        ruleKeys: [
          CANONICAL_CANCELLATION_SIGNAL_RULE_KEYS.reconciled,
          CANONICAL_CANCELLATION_SIGNAL_RULE_KEYS.requiresFinanceReview,
          CANONICAL_CANCELLATION_SIGNAL_RULE_KEYS.partialRequiresManualReview,
          CANONICAL_CANCELLATION_SIGNAL_RULE_KEYS.conflictsWithOperationalState,
          CANONICAL_CANCELLATION_SIGNAL_RULE_KEYS.repairFailed,
        ],
      });
      return report;
    }

    if (classification.state === 'unknown_requires_manual_review') {
      await upsertCanonicalCancellationSignal({
        ruleKey: CANONICAL_CANCELLATION_SIGNAL_RULE_KEYS.partialRequiresManualReview,
        sourceShopifyOrderId,
        severity: OperationalSignalSeverity.HIGH,
        title: 'Canonical partial cancellation requires manual review',
        description: 'Shopify line quantities changed without full-order cancellation. The local allocation model cannot safely apply a partial cancellation automatically.',
        suggestedAction: 'Review affected Shopify line items and decide whether refund, return, or manual finance adjustment is required.',
        metadata: {
          affectedLineItemIds: classification.affectedLineItemIds,
          reason: classification.reason,
        },
      });
      report.signalsCreatedOrUpdated += 1;
      report.skippedCount += classification.affectedLineItemIds.length || 1;
      report.results.push({
        status: 'skipped',
        reason: 'canonical_order_partial_cancellation_requires_manual_review',
        vendorId: null,
        allocationId: null,
        financeLedgerEntryId: null,
      });
      return report;
    }

    const localOrder = await findLocalOrderForCancellation(sourceShopifyOrderId);
    if (!localOrder) {
      await upsertCanonicalCancellationSignal({
        ruleKey: CANONICAL_CANCELLATION_SIGNAL_RULE_KEYS.repairFailed,
        sourceShopifyOrderId,
        severity: OperationalSignalSeverity.CRITICAL,
        title: 'Canonical cancellation missing local order',
        description: 'Shopify shows the order as cancelled, but the local order record is missing. Cancellation state was not recreated automatically.',
        suggestedAction: 'Recover the missing order before cancellation reconciliation.',
        metadata: {
          cancelledAt: canonicalOrder.cancelledAt,
          cancelReason: canonicalOrder.cancelReason,
        },
      });
      report.signalsCreatedOrUpdated += 1;
      report.failedCount += 1;
      report.results.push({
        status: 'failed',
        reason: 'canonical_order_cancellation_missing_local_order',
        vendorId: null,
        allocationId: null,
        financeLedgerEntryId: null,
      });
      return report;
    }

    const affectedAllocations = localOrder.allocations;
    report.affectedAllocations = affectedAllocations.map((allocation) => allocation.id);

    const operationalConflict = affectedAllocations.find((allocation) =>
      isFulfillmentConflict(allocation) ||
      allocation.refundRecords.length > 0 ||
      allocation.returnRecords.length > 0
    );
    if (operationalConflict) {
      await upsertCanonicalCancellationSignal({
        ruleKey: CANONICAL_CANCELLATION_SIGNAL_RULE_KEYS.conflictsWithOperationalState,
        sourceShopifyOrderId,
        severity: OperationalSignalSeverity.HIGH,
        title: 'Canonical cancellation conflicts with operational state',
        description: 'Shopify shows the order as cancelled, but local fulfillment, refund, or return evidence already exists. Local state was preserved.',
        suggestedAction: 'Review the order before applying any cancellation or finance adjustment.',
        metadata: {
          allocationId: operationalConflict.id,
          cancelledAt: canonicalOrder.cancelledAt,
          cancelReason: canonicalOrder.cancelReason,
        },
      });
      report.signalsCreatedOrUpdated += 1;
      report.failedCount += 1;
      report.results.push({
        status: 'failed',
        reason: 'canonical_order_cancellation_conflicts_with_operational_state',
        vendorId: operationalConflict.assignedVendorId,
        allocationId: operationalConflict.id,
        financeLedgerEntryId: null,
      });
      return report;
    }

    const activeLedgers = affectedAllocations.flatMap((allocation) =>
      allocation.financeEntries
        .filter((ledger) => !ledger.voidedAt)
        .map((ledger) => ({ allocation, ledger }))
    );
    const financeReviewLedger = activeLedgers.find(({ ledger }) => isFinanceReviewRequired(ledger));
    if (financeReviewLedger) {
      await upsertCanonicalCancellationSignal({
        ruleKey: CANONICAL_CANCELLATION_SIGNAL_RULE_KEYS.requiresFinanceReview,
        sourceShopifyOrderId,
        severity: OperationalSignalSeverity.CRITICAL,
        title: 'Canonical cancellation requires finance review',
        description: 'Shopify shows the order as cancelled, but the sale is already connected to settlement, payout, or paid finance state. Local finance was preserved.',
        suggestedAction: 'Review settlement, payout, and vendor balance before applying cancellation adjustments.',
        metadata: {
          allocationId: financeReviewLedger.allocation.id,
          financeLedgerEntryId: financeReviewLedger.ledger.id,
          cancelledAt: canonicalOrder.cancelledAt,
          cancelReason: canonicalOrder.cancelReason,
        },
      });
      report.signalsCreatedOrUpdated += 1;
      report.failedCount += 1;
      report.results.push({
        status: 'failed',
        reason: 'canonical_order_cancellation_requires_finance_review',
        vendorId: financeReviewLedger.ledger.vendorId,
        allocationId: financeReviewLedger.allocation.id,
        financeLedgerEntryId: financeReviewLedger.ledger.id,
      });
      return report;
    }

    const voidedAt = canonicalOrder.cancelledAt ? new Date(canonicalOrder.cancelledAt) : new Date();
    const voidReason = `canonical_order_cancelled:${classification.reason ?? 'shopify'}`;
    await prisma.$transaction(async (tx) => {
      await tx.vendorAllocation.updateMany({
        where: {
          id: {
            in: affectedAllocations.map((allocation) => allocation.id),
          },
        },
        data: {
          cancellationReason: CancellationReason.VENDOR_CANCELLED,
          reassignmentRequired: false,
        },
      });

      for (const { ledger } of activeLedgers) {
        await tx.financeLedgerEntry.update({
          where: {
            id: ledger.id,
          },
          data: {
            payoutStatus: PayoutStatus.HOLD,
            settlementStatus: SettlementStatus.HELD,
            settlementHoldReason: 'Canonical Shopify order cancellation.',
            voidedAt,
            voidReason,
          },
        });
      }
    });

    report.ledgersHeldOrVoided = activeLedgers.map(({ ledger }) => ledger.id);
    if (activeLedgers.length === 0) {
      report.results.push(...affectedAllocations.map((allocation) => ({
        status: 'already_current' as const,
        reason: 'no_active_sale_ledgers',
        vendorId: allocation.assignedVendorId,
        allocationId: allocation.id,
        financeLedgerEntryId: null,
      })));
    } else {
      report.results.push(...activeLedgers.map(({ allocation, ledger }) => ({
        status: 'reconciled' as const,
        reason: 'canonical_order_cancelled',
        vendorId: ledger.vendorId,
        allocationId: allocation.id,
        financeLedgerEntryId: ledger.id,
      })));
    }

    await resolveCanonicalCancellationSignals({
      sourceShopifyOrderId,
      ruleKeys: [
        CANONICAL_CANCELLATION_SIGNAL_RULE_KEYS.requiresFinanceReview,
        CANONICAL_CANCELLATION_SIGNAL_RULE_KEYS.partialRequiresManualReview,
        CANONICAL_CANCELLATION_SIGNAL_RULE_KEYS.conflictsWithOperationalState,
        CANONICAL_CANCELLATION_SIGNAL_RULE_KEYS.repairFailed,
      ],
    });
    await upsertCanonicalCancellationSignal({
      ruleKey: CANONICAL_CANCELLATION_SIGNAL_RULE_KEYS.reconciled,
      sourceShopifyOrderId,
      severity: OperationalSignalSeverity.INFO,
      title: 'Canonical order cancellation reconciled',
      description: 'Shopify cancellation was reconciled locally by holding and voiding unpaid sale ledger rows.',
      suggestedAction: 'No action required unless separate refund, return, or settlement review remains pending.',
      metadata: {
        cancelledAt: canonicalOrder.cancelledAt,
        cancelReason: canonicalOrder.cancelReason,
        affectedAllocationIds: report.affectedAllocations,
        ledgerIds: report.ledgersHeldOrVoided,
      },
    });
    report.signalsCreatedOrUpdated += 1;

    return report;
  }

  return {
    reconcileShopifyOrderCancellation,
  };
}

export const __canonicalCancellationReconciliationTesting = {
  CANONICAL_CANCELLATION_SIGNAL_RULE_KEYS,
  buildCanonicalCancellationSignalId,
  classifyCanonicalCancellation,
};
