import { createHash } from 'node:crypto';
import {
  OperationalSignalSeverity,
  OperationalSignalSourceArea,
  OperationalSignalStatus,
  Prisma,
} from '@prisma/client';
import type { AppEnv } from '../../config/env.js';
import { prisma } from '../../db/prisma.js';
import { createShopifyAdminService } from '../shopify/shopify-admin.service.js';
import type {
  CanonicalShopifyRefundLineItemSnapshot,
  CanonicalShopifyRefundSnapshot,
} from '../shopify/shopify-admin.types.js';
import { ingestVerifiedShopifyRefund } from '../shopify/refund-ingestion.service.js';
import {
  classifyCanonicalRefundMonetaryEvidence,
  findCanonicalRefundItemEvidence,
  isRefundEvidenceBlocked,
  REFUND_MONETARY_CLASSIFICATIONS,
  requiresRefundMonetaryEvidenceClassification,
} from '../shopify/shopify-refund-monetary-evidence.js';
import type { ShopifyRefundsCreateWebhookPayload } from '../shopify/refund-ingestion.types.js';
import type {
  CanonicalRefundReconciliationItemResult,
  CanonicalRefundReconciliationReport,
} from './reconciliation.types.js';

const CANONICAL_REFUND_SIGNAL_RULE_KEYS = {
  missingLocalOrder: 'canonical_refund_missing_local_order',
  lineItemUnmatched: 'canonical_refund_line_item_unmatched',
  requiresManualReview: 'canonical_refund_requires_manual_review',
  repaired: 'canonical_refund_repaired',
  repairFailed: 'canonical_refund_repair_failed',
} as const;

type CanonicalRefundSignalRuleKey =
  (typeof CANONICAL_REFUND_SIGNAL_RULE_KEYS)[keyof typeof CANONICAL_REFUND_SIGNAL_RULE_KEYS];

type RefundEvidenceCounts = {
  refundRecords: number;
  refundLedgers: number;
  financeEvents: number;
};

function sanitizeSignalPart(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unknown';
}

function buildCanonicalRefundSignalId(input: {
  ruleKey: CanonicalRefundSignalRuleKey;
  sourceShopifyOrderId: string;
  sourceShopifyRefundId?: string | null;
}) {
  return [
    'signal',
    sanitizeSignalPart(input.ruleKey),
    sanitizeSignalPart(input.sourceShopifyOrderId),
    input.sourceShopifyRefundId ? sanitizeSignalPart(input.sourceShopifyRefundId) : null,
  ].filter(Boolean).join('-');
}

function toJsonObject(value: Record<string, unknown>): Prisma.InputJsonObject {
  return value as Prisma.InputJsonObject;
}

async function upsertCanonicalRefundSignal(input: {
  ruleKey: CanonicalRefundSignalRuleKey;
  sourceShopifyOrderId: string;
  sourceShopifyRefundId?: string | null;
  severity?: OperationalSignalSeverity;
  title: string;
  description: string;
  suggestedAction: string;
  metadata?: Record<string, unknown>;
}) {
  await prisma.operationalSignal.upsert({
    where: {
      id: buildCanonicalRefundSignalId(input),
    },
    create: {
      id: buildCanonicalRefundSignalId(input),
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
        sourceShopifyRefundId: input.sourceShopifyRefundId ?? null,
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
        sourceShopifyRefundId: input.sourceShopifyRefundId ?? null,
        ...(input.metadata ?? {}),
      }),
    },
  });
}

async function resolveCanonicalRefundSignals(input: {
  sourceShopifyOrderId: string;
  sourceShopifyRefundId?: string | null;
  ruleKeys: CanonicalRefundSignalRuleKey[];
}) {
  await prisma.operationalSignal.updateMany({
    where: {
      id: {
        in: input.ruleKeys.map((ruleKey) =>
          buildCanonicalRefundSignalId({
            ruleKey,
            sourceShopifyOrderId: input.sourceShopifyOrderId,
            sourceShopifyRefundId: input.sourceShopifyRefundId,
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

function amountPerUnit(totalAmount: string | null, quantity: number) {
  const numeric = Number(totalAmount ?? 0);
  const safeQuantity = Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return (numeric / safeQuantity).toFixed(2);
}

function canonicalRefundLineToWebhookLine(lineItem: CanonicalShopifyRefundLineItemSnapshot) {
  return {
    id: lineItem.sourceRefundLineItemId,
    line_item_id: lineItem.sourceLineItemId,
    quantity: lineItem.quantity,
    subtotal: amountPerUnit(lineItem.subtotalAmount, lineItem.quantity),
    line_item: {
      id: lineItem.sourceLineItemId,
      sku: lineItem.sku,
      title: lineItem.title,
      name: lineItem.name,
      variant_title: lineItem.variantTitle,
    },
  };
}

export function canonicalRefundToWebhookPayload(input: {
  sourceShopifyOrderId: string;
  refund: CanonicalShopifyRefundSnapshot;
}): ShopifyRefundsCreateWebhookPayload {
  return {
    id: input.refund.sourceShopifyRefundId,
    order_id: input.sourceShopifyOrderId,
    created_at: input.refund.createdAt,
    note: input.refund.note,
    refund_line_items: input.refund.refundLineItems.map(canonicalRefundLineToWebhookLine),
  };
}

function buildSyntheticWebhookRawBody(payload: ShopifyRefundsCreateWebhookPayload) {
  return JSON.stringify(payload);
}

function payloadHash(rawPayload: string) {
  return createHash('sha256').update(rawPayload, 'utf8').digest('hex');
}

async function upsertSyntheticRefundWebhookEvent(input: {
  shopDomain: string;
  sourceShopifyOrderId: string;
  sourceShopifyRefundId: string;
  rawPayload: string;
}) {
  const idempotencyKey = [
    'canonical_refund_reconciliation',
    input.shopDomain,
    input.sourceShopifyOrderId,
    input.sourceShopifyRefundId,
  ].join(':');

  return prisma.webhookEvent.upsert({
    where: {
      idempotencyKey,
    },
    create: {
      sourceShopDomain: input.shopDomain,
      topic: 'refunds/create',
      webhookId: `canonical-refund-reconciliation-${input.sourceShopifyRefundId}`,
      idempotencyKey,
      payloadHash: payloadHash(input.rawPayload),
      rawPayload: input.rawPayload,
      status: 'RECEIVED',
    },
    update: {
      payloadHash: payloadHash(input.rawPayload),
      rawPayload: input.rawPayload,
      status: 'RECEIVED',
      errorMessage: null,
      processedAt: null,
    },
  });
}

async function getRefundEvidenceCounts(sourceShopifyRefundId: string): Promise<RefundEvidenceCounts> {
  const [refundRecords, refundLedgers, financeEvents] = await Promise.all([
    prisma.refundRecord.count({
      where: {
        sourceShopifyRefundId,
      },
    }),
    prisma.financeLedgerEntry.count({
      where: {
        entryType: 'refund',
        voidedAt: null,
        id: {
          contains: `-refund-${sourceShopifyRefundId}`,
        },
      },
    }),
    prisma.financeEvent.count({
      where: {
        referenceType: 'shopify_refund',
        referenceId: sourceShopifyRefundId,
      },
    }),
  ]);

  return {
    refundRecords,
    refundLedgers,
    financeEvents,
  };
}

async function getRefundRecordSummary(sourceShopifyRefundId: string) {
  return prisma.refundRecord.findMany({
    where: {
      sourceShopifyRefundId,
    },
    select: {
      id: true,
      vendorAllocationId: true,
      vendorAllocation: {
        select: {
          assignedVendorId: true,
        },
      },
    },
    orderBy: {
      createdAt: 'asc',
    },
  });
}

function summarizeItemStatus(input: {
  before: RefundEvidenceCounts;
  after: RefundEvidenceCounts;
  ingestionOk: boolean;
}) {
  if (!input.ingestionOk) {
    return 'failed' as const;
  }
  if (input.before.refundRecords === 0 && input.after.refundRecords > 0) {
    return 'created' as const;
  }
  if (
    input.after.refundLedgers > input.before.refundLedgers ||
    input.after.financeEvents > input.before.financeEvents
  ) {
    return 'repaired' as const;
  }
  return 'already_present' as const;
}

export function createCanonicalRefundReconciliationService(env: AppEnv) {
  const shopifyAdminService = createShopifyAdminService(env);

  async function reconcileShopifyOrderRefunds(sourceShopifyOrderId: string): Promise<CanonicalRefundReconciliationReport | null> {
    const canonicalRefunds = await shopifyAdminService.fetchCanonicalRefundsForOrder(sourceShopifyOrderId);
    if (!canonicalRefunds) {
      return null;
    }

    const report: CanonicalRefundReconciliationReport = {
      shopifyOrderId: sourceShopifyOrderId,
      refundsFetched: canonicalRefunds.refunds.length,
      refundsAlreadyPresent: 0,
      refundsCreated: 0,
      ledgersRepaired: 0,
      eventsRepaired: 0,
      skippedCount: 0,
      failedCount: 0,
      signalsCreatedOrUpdated: 0,
      results: [],
    };

    const monetaryEvidence = requiresRefundMonetaryEvidenceClassification(canonicalRefunds)
      ? classifyCanonicalRefundMonetaryEvidence(canonicalRefunds)
      : null;

    if (monetaryEvidence && isRefundEvidenceBlocked(monetaryEvidence)) {
      const blockedRefunds = canonicalRefunds.refunds.length > 0 ? canonicalRefunds.refunds : [null];
      for (const refund of blockedRefunds) {
        await upsertCanonicalRefundSignal({
          ruleKey: CANONICAL_REFUND_SIGNAL_RULE_KEYS.requiresManualReview,
          sourceShopifyOrderId,
          sourceShopifyRefundId: refund?.sourceShopifyRefundId,
          severity: OperationalSignalSeverity.HIGH,
          title: 'Canonical refund requires monetary evidence review',
          description: 'Canonical Shopify refund evidence is incomplete, non-final, or inconsistent. No refund finance records were created.',
          suggestedAction: 'Review the safe classification reason and canonical Shopify refund state before retrying.',
          metadata: {
            classification: monetaryEvidence.classification,
            reasonCode: monetaryEvidence.reasonCode,
            aggregateMismatch: monetaryEvidence.aggregateMismatch,
            currencyMismatch: monetaryEvidence.currencyMismatch,
            incompletePagination: monetaryEvidence.incompletePagination,
          },
        });
        report.signalsCreatedOrUpdated += 1;
        report.failedCount += 1;
        if (refund) {
          report.results.push({
            refundId: refund.sourceShopifyRefundId,
            status: 'failed',
            reason: monetaryEvidence.reasonCode,
            affectedAllocationIds: [],
            affectedVendorIds: [],
            affectedRefundRecordIds: [],
          });
        }
      }
      return report;
    }

    if (monetaryEvidence?.classification === REFUND_MONETARY_CLASSIFICATIONS.zeroValueVoid) {
      for (const refund of canonicalRefunds.refunds) {
        const refundEvidence = findCanonicalRefundItemEvidence(monetaryEvidence, refund.sourceShopifyRefundId);
        await resolveCanonicalRefundSignals({
          sourceShopifyOrderId,
          sourceShopifyRefundId: refund.sourceShopifyRefundId,
          ruleKeys: [
            CANONICAL_REFUND_SIGNAL_RULE_KEYS.missingLocalOrder,
            CANONICAL_REFUND_SIGNAL_RULE_KEYS.lineItemUnmatched,
            CANONICAL_REFUND_SIGNAL_RULE_KEYS.requiresManualReview,
            CANONICAL_REFUND_SIGNAL_RULE_KEYS.repairFailed,
            CANONICAL_REFUND_SIGNAL_RULE_KEYS.repaired,
          ],
        });
        report.skippedCount += 1;
        report.results.push({
          refundId: refund.sourceShopifyRefundId,
          status: 'skipped',
          reason: refundEvidence?.reasonCode ?? 'zero_value_void_not_monetary_refund',
          affectedAllocationIds: [],
          affectedVendorIds: [],
          affectedRefundRecordIds: [],
        });
      }
      return report;
    }

    const localOrder = await prisma.shopifyOrder.findUnique({
      where: {
        sourceShopifyOrderId,
      },
      select: {
        id: true,
      },
    });

    if (!localOrder) {
      for (const refund of canonicalRefunds.refunds) {
        const refundEvidence = monetaryEvidence
          ? findCanonicalRefundItemEvidence(monetaryEvidence, refund.sourceShopifyRefundId)
          : null;
        if (refundEvidence?.classification === REFUND_MONETARY_CLASSIFICATIONS.zeroValueVoid) {
          report.skippedCount += 1;
          report.results.push({
            refundId: refund.sourceShopifyRefundId,
            status: 'skipped',
            reason: refundEvidence.reasonCode,
            affectedAllocationIds: [],
            affectedVendorIds: [],
            affectedRefundRecordIds: [],
          });
          continue;
        }
        await upsertCanonicalRefundSignal({
          ruleKey: CANONICAL_REFUND_SIGNAL_RULE_KEYS.missingLocalOrder,
          sourceShopifyOrderId,
          sourceShopifyRefundId: refund.sourceShopifyRefundId,
          severity: OperationalSignalSeverity.CRITICAL,
          title: 'Canonical refund missing local order',
          description: 'Shopify refund exists but the local order record is missing. Refund commerce state was not recreated automatically.',
          suggestedAction: 'Replay or recover the missing order before refund reconciliation.',
          metadata: {
            refundGid: refund.refundGid,
            refundLineItemIds: refund.refundLineItems.map((lineItem) => lineItem.sourceRefundLineItemId),
          },
        });
        report.signalsCreatedOrUpdated += 1;
        report.skippedCount += 1;
        report.results.push({
          refundId: refund.sourceShopifyRefundId,
          status: 'skipped',
          reason: 'canonical_refund_missing_local_order',
          affectedAllocationIds: [],
          affectedVendorIds: [],
          affectedRefundRecordIds: [],
        });
      }
      return report;
    }

    for (const refund of canonicalRefunds.refunds) {
      const refundEvidence = monetaryEvidence
        ? findCanonicalRefundItemEvidence(monetaryEvidence, refund.sourceShopifyRefundId)
        : null;
      if (refundEvidence?.classification === REFUND_MONETARY_CLASSIFICATIONS.zeroValueVoid) {
        await resolveCanonicalRefundSignals({
          sourceShopifyOrderId,
          sourceShopifyRefundId: refund.sourceShopifyRefundId,
          ruleKeys: [
            CANONICAL_REFUND_SIGNAL_RULE_KEYS.missingLocalOrder,
            CANONICAL_REFUND_SIGNAL_RULE_KEYS.lineItemUnmatched,
            CANONICAL_REFUND_SIGNAL_RULE_KEYS.requiresManualReview,
            CANONICAL_REFUND_SIGNAL_RULE_KEYS.repairFailed,
            CANONICAL_REFUND_SIGNAL_RULE_KEYS.repaired,
          ],
        });
        report.skippedCount += 1;
        report.results.push({
          refundId: refund.sourceShopifyRefundId,
          status: 'skipped',
          reason: refundEvidence.reasonCode,
          affectedAllocationIds: [],
          affectedVendorIds: [],
          affectedRefundRecordIds: [],
        });
        continue;
      }
      if (!refundEvidence || refundEvidence.classification !== REFUND_MONETARY_CLASSIFICATIONS.monetaryRefund) {
        report.failedCount += 1;
        report.results.push({
          refundId: refund.sourceShopifyRefundId,
          status: 'failed',
          reason: refundEvidence?.reasonCode ?? 'monetary_refund_transaction_missing',
          affectedAllocationIds: [],
          affectedVendorIds: [],
          affectedRefundRecordIds: [],
        });
        continue;
      }

      const before = await getRefundEvidenceCounts(refund.sourceShopifyRefundId);
      const payload = canonicalRefundToWebhookPayload({
        sourceShopifyOrderId: canonicalRefunds.sourceShopifyOrderId,
        refund,
      });
      const rawPayload = buildSyntheticWebhookRawBody(payload);
      const webhookEvent = await upsertSyntheticRefundWebhookEvent({
        shopDomain: env.SHOPIFY_SHOP_DOMAIN ?? 'canonical-shopify-admin',
        sourceShopifyOrderId,
        sourceShopifyRefundId: refund.sourceShopifyRefundId,
        rawPayload,
      });

      const ingestionResult = await ingestVerifiedShopifyRefund({
        event: webhookEvent,
        payload,
        monetaryEvidence: refundEvidence,
      });
      const after = await getRefundEvidenceCounts(refund.sourceShopifyRefundId);
      const recordSummary = await getRefundRecordSummary(refund.sourceShopifyRefundId);

      if (!ingestionResult.ok) {
        const lineItemUnmatched = /line item|sku|mapping|allocated/i.test(ingestionResult.error);
        await upsertCanonicalRefundSignal({
          ruleKey: lineItemUnmatched
            ? CANONICAL_REFUND_SIGNAL_RULE_KEYS.lineItemUnmatched
            : CANONICAL_REFUND_SIGNAL_RULE_KEYS.requiresManualReview,
          sourceShopifyOrderId,
          sourceShopifyRefundId: refund.sourceShopifyRefundId,
          severity: OperationalSignalSeverity.HIGH,
          title: lineItemUnmatched
            ? 'Canonical refund line item unmatched'
            : 'Canonical refund requires manual review',
          description: 'Canonical Shopify refund reconciliation could not safely map the refund into local ownership and finance records.',
          suggestedAction: 'Review Shopify refund line items, local order allocation ownership, and finance integrity alerts before retrying.',
          metadata: {
            error: ingestionResult.error,
            refundGid: refund.refundGid,
            refundLineItems: refund.refundLineItems.map((lineItem) => ({
              sourceRefundLineItemId: lineItem.sourceRefundLineItemId,
              sourceLineItemId: lineItem.sourceLineItemId,
              sku: lineItem.sku,
            })),
          },
        });
        report.signalsCreatedOrUpdated += 1;
        report.failedCount += 1;
        report.results.push({
          refundId: refund.sourceShopifyRefundId,
          status: 'failed',
          reason: ingestionResult.error,
          affectedAllocationIds: [],
          affectedVendorIds: [],
          affectedRefundRecordIds: [],
        });
        continue;
      }

      const shippingOnlyReconciliation = ingestionResult.reconciliationMode === 'shipping_only';
      const status = shippingOnlyReconciliation
        ? ingestionResult.terminalStateChanged
          ? 'repaired' as const
          : 'already_present' as const
        : summarizeItemStatus({
            before,
            after,
            ingestionOk: ingestionResult.ok,
          });
      const ledgerDelta = Math.max(0, after.refundLedgers - before.refundLedgers);
      const eventDelta = Math.max(0, after.financeEvents - before.financeEvents);
      report.ledgersRepaired += ledgerDelta;
      report.eventsRepaired += eventDelta;

      if (status === 'created') {
        report.refundsCreated += 1;
      } else if (status === 'already_present') {
        report.refundsAlreadyPresent += 1;
      }

      await resolveCanonicalRefundSignals({
        sourceShopifyOrderId,
        sourceShopifyRefundId: refund.sourceShopifyRefundId,
        ruleKeys: [
          CANONICAL_REFUND_SIGNAL_RULE_KEYS.missingLocalOrder,
          CANONICAL_REFUND_SIGNAL_RULE_KEYS.lineItemUnmatched,
          CANONICAL_REFUND_SIGNAL_RULE_KEYS.requiresManualReview,
          CANONICAL_REFUND_SIGNAL_RULE_KEYS.repairFailed,
        ],
      });

      if (status === 'created' || status === 'repaired') {
        await upsertCanonicalRefundSignal({
          ruleKey: CANONICAL_REFUND_SIGNAL_RULE_KEYS.repaired,
          sourceShopifyOrderId,
          sourceShopifyRefundId: refund.sourceShopifyRefundId,
          severity: OperationalSignalSeverity.INFO,
          title: shippingOnlyReconciliation ? 'Canonical shipping refund reconciled' : 'Canonical refund repaired',
          description: shippingOnlyReconciliation
            ? 'Canonical Shopify refund reconciliation terminalized the owned shipping-only refund without product finance records.'
            : 'Canonical Shopify refund reconciliation created or repaired local refund finance records.',
          suggestedAction: shippingOnlyReconciliation
            ? 'No action required unless customer refund completion remains unresolved.'
            : 'No action required unless settlement review remains pending.',
          metadata: {
            status,
            ledgerDelta,
            eventDelta,
            refundRecordIds: recordSummary.map((record) => record.id),
          },
        });
        report.signalsCreatedOrUpdated += 1;
      }

      report.results.push({
        refundId: refund.sourceShopifyRefundId,
        status,
        reason: status === 'already_present' ? 'local_refund_already_present' : null,
        affectedAllocationIds: [...new Set(recordSummary.map((record) => record.vendorAllocationId))],
        affectedVendorIds: [...new Set(recordSummary.map((record) => record.vendorAllocation.assignedVendorId))],
        affectedRefundRecordIds: recordSummary.map((record) => record.id),
      });
    }

    return report;
  }

  return {
    reconcileShopifyOrderRefunds,
  };
}

export const __canonicalRefundReconciliationTesting = {
  CANONICAL_REFUND_SIGNAL_RULE_KEYS,
  canonicalRefundToWebhookPayload,
  buildCanonicalRefundSignalId,
};
