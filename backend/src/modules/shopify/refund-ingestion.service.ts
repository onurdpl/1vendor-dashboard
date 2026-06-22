import { prisma } from '../../db/prisma.js';
import { FinanceEventType, type Prisma } from '@prisma/client';
import { createEventsIdempotently } from '../finance/finance-event.service.js';
import { assertResolvedEconomicOwnerForMoneyMovement } from '../finance/economic-owner-resolution.service.js';
import { CANCEL_REFUND_REVIEW_BLOCKING_STATUSES } from '../finance/cancel-refund-review-hold.service.js';
import { assertNoOpenFinanceIntegrityAlertForMoneyMovement } from '../finance/finance-integrity-alert.service.js';
import {
  calculateRefundOffsetAmounts,
  classifyPostApprovalRefundRisk,
  getUnsettledRefundOffsetEligibility,
} from '../finance/refund-offset.service.js';
import { createSettlementRefundAdjustmentForRefundLedger } from '../finance/settlement-refund-adjustment.service.js';
import { createVendorDebtForPaidRefund } from '../finance/vendor-balance.service.js';
import { OUTBOUND_SHOPIFY_REFUND_ATTEMPT_STATUSES } from '../orders/outbound-shopify-refund-attempt.service.js';
import type {
  ParsedShopifyRefundLineItem,
  ParsedShopifyRefundPayload,
  RefundIngestionInput,
  RefundIngestionResult,
  ShopifyRefundLineItemPayload,
  ShopifyRefundsCreateWebhookPayload,
} from './refund-ingestion.types.js';

const CANCEL_REFUND_REVIEW_RESOLVABLE_STATUS_SET = new Set<string>(CANCEL_REFUND_REVIEW_BLOCKING_STATUSES);

function toDate(value: string | null | undefined) {
  if (!value) {
    return new Date();
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function toRefundLineItemTitle(lineItem: ShopifyRefundLineItemPayload['line_item']) {
  if (!lineItem) {
    return null;
  }

  const baseTitle = typeof lineItem.title === 'string'
    ? lineItem.title
    : typeof lineItem.name === 'string'
      ? lineItem.name
      : null;
  const variantTitle = typeof lineItem.variant_title === 'string' ? lineItem.variant_title : null;

  if (baseTitle && variantTitle) {
    return `${baseTitle} / ${variantTitle}`;
  }

  return baseTitle;
}

function parseRefundPayload(payload: ShopifyRefundsCreateWebhookPayload): ParsedShopifyRefundPayload {
  const refundLineItems = Array.isArray(payload.refund_line_items) ? payload.refund_line_items : [];

  return {
    sourceShopifyRefundId: String(payload.id),
    sourceShopifyOrderId:
      payload.order_id !== undefined && payload.order_id !== null ? String(payload.order_id) : '',
    createdAt: toDate(payload.created_at),
    note: typeof payload.note === 'string' && payload.note.trim() ? payload.note.trim() : null,
    refundLineItems: refundLineItems.map<ParsedShopifyRefundLineItem>((lineItem, index) => ({
      sourceRefundLineItemId:
        lineItem.id !== undefined && lineItem.id !== null
          ? String(lineItem.id)
          : `refund-line-item-${index + 1}`,
      sourceLineItemId:
        lineItem.line_item?.id !== undefined && lineItem.line_item?.id !== null
          ? String(lineItem.line_item.id)
          : lineItem.line_item_id !== undefined && lineItem.line_item_id !== null
            ? String(lineItem.line_item_id)
            : null,
      sku: typeof lineItem.line_item?.sku === 'string' && lineItem.line_item.sku.trim()
        ? lineItem.line_item.sku
        : null,
      title: toRefundLineItemTitle(lineItem.line_item),
      quantity: typeof lineItem.quantity === 'number' && lineItem.quantity > 0 ? lineItem.quantity : 1,
      subtotal:
        lineItem.subtotal !== undefined && lineItem.subtotal !== null ? String(lineItem.subtotal) : null,
    })),
  };
}

function toAmountString(value: string | null, quantity: number) {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) {
    return '0.00';
  }

  return (numeric * quantity).toFixed(2);
}

function sumAmounts(values: string[]) {
  return values.reduce((sum, value) => {
    const numeric = Number(value);
    return sum + (Number.isFinite(numeric) ? numeric : 0);
  }, 0).toFixed(2);
}

function toNumber(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function toMinorUnits(value: number) {
  return Math.round(value * 100);
}

async function resolveCancelRefundReviewAfterRefundIngestion(
  tx: Prisma.TransactionClient,
  input: {
    vendorAllocationId: string;
    cancelRefundReviewStatus: string | null;
    sourceShopifyRefundId: string;
    resolvedAt: Date;
  },
) {
  const normalizedReviewStatus = input.cancelRefundReviewStatus?.trim().toUpperCase() ?? '';
  if (CANCEL_REFUND_REVIEW_RESOLVABLE_STATUS_SET.has(normalizedReviewStatus)) {
    await tx.vendorAllocation.updateMany({
      where: {
        id: input.vendorAllocationId,
        cancelRefundReviewStatus: {
          in: [...CANCEL_REFUND_REVIEW_BLOCKING_STATUSES],
        },
      },
      data: {
        cancelRefundReviewStatus: 'RESOLVED',
      },
    });
  }

  await tx.outboundShopifyRefundAttempt.updateMany({
    where: {
      vendorAllocationId: input.vendorAllocationId,
      status: {
        in: [
          OUTBOUND_SHOPIFY_REFUND_ATTEMPT_STATUSES.PREVIEWED,
          OUTBOUND_SHOPIFY_REFUND_ATTEMPT_STATUSES.SHOPIFY_ACTION_PENDING,
        ],
      },
    },
    data: {
      status: OUTBOUND_SHOPIFY_REFUND_ATTEMPT_STATUSES.RESOLVED,
      shopifyRefundId: input.sourceShopifyRefundId,
      resolvedAt: input.resolvedAt,
    },
  });
}

type ResolvedRefundLineItem = ParsedShopifyRefundLineItem & {
  vendorId: string;
  originalVendorId: string;
  vendorAllocationId: string;
  activeSaleLedgerId: string;
  supersededFromLedgerIds: string[];
  shopifyOrderLineItemId: string;
  sourceShopifyOrderNumber: string;
  cancelRefundReviewStatus: string | null;
  refundAmount: string;
};

export async function ingestShopifyRefundWebhook(input: RefundIngestionInput): Promise<RefundIngestionResult> {
  const parsedRefund = parseRefundPayload(input.payload);

  if (!parsedRefund.sourceShopifyOrderId) {
    await prisma.webhookEvent.update({
      where: { id: input.event.id },
      data: {
        status: 'FAILED',
        errorMessage: 'Shopify refunds/create payload did not include an order id.',
      },
    });

    return {
      ok: false,
      action: 'received_needs_attention',
      processingStatus: 'needs_attention',
      error: 'Shopify refunds/create payload did not include an order id.',
    };
  }

  if (parsedRefund.refundLineItems.length === 0) {
    await prisma.webhookEvent.update({
      where: { id: input.event.id },
      data: {
        status: 'FAILED',
        errorMessage: 'Shopify refunds/create payload did not include refund line items.',
      },
    });

    return {
      ok: false,
      action: 'received_needs_attention',
      processingStatus: 'needs_attention',
      error: 'Shopify refunds/create payload did not include refund line items.',
    };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.webhookEvent.update({
        where: { id: input.event.id },
        data: {
          status: 'PROCESSING',
          errorMessage: null,
        },
      });

      const shopifyOrder = await tx.shopifyOrder.findUnique({
        where: {
          sourceShopifyOrderId: parsedRefund.sourceShopifyOrderId,
        },
        include: {
          lineItems: true,
          allocations: true,
        },
      });

      if (!shopifyOrder) {
        throw new Error(`No ingested Shopify order found for refund order id ${parsedRefund.sourceShopifyOrderId}.`);
      }

      const vendorIds = new Set((await tx.vendor.findMany({ select: { id: true } })).map((vendor) => vendor.id));

      const resolvedLineItems: ResolvedRefundLineItem[] = [];
      for (const lineItem of parsedRefund.refundLineItems) {
        if (!lineItem.sku) {
          throw new Error(`Refund line item ${lineItem.sourceRefundLineItemId} is missing SKU and cannot be allocated.`);
        }

        const skuMatches = shopifyOrder.lineItems.filter((orderLineItem) => orderLineItem.sku === lineItem.sku);
        const matchedOrderLineItem = lineItem.sourceLineItemId
          ? skuMatches.find((orderLineItem) => orderLineItem.sourceLineItemId === lineItem.sourceLineItemId)
          : skuMatches.length === 1
            ? skuMatches[0]
            : null;

        if (!matchedOrderLineItem) {
          if (skuMatches.length > 1) {
            throw new Error(`Refund SKU ${lineItem.sku} matched multiple original order line items and could not be resolved safely.`);
          }

          throw new Error(`No original order mapping found for refund SKU ${lineItem.sku}.`);
        }

        const originalVendorId = matchedOrderLineItem.originalVendorId?.trim().toLowerCase() ?? null;
        if (!originalVendorId) {
          throw new Error(`Original seller_info mapping is missing for refund SKU ${lineItem.sku}.`);
        }

        if (!vendorIds.has(originalVendorId)) {
          throw new Error(`Original seller_info mapping resolved refund SKU ${lineItem.sku} to unknown vendor ${originalVendorId}.`);
        }

        const vendorAllocation = shopifyOrder.allocations.find(
          (allocation) => allocation.originalVendorId === originalVendorId,
        );

        if (!vendorAllocation) {
          throw new Error(`No vendor allocation found for refund SKU ${lineItem.sku} and vendor ${originalVendorId}.`);
        }

        const economicOwner = await assertResolvedEconomicOwnerForMoneyMovement({
          vendorAllocationId: vendorAllocation.id,
          db: tx,
        });
        await assertNoOpenFinanceIntegrityAlertForMoneyMovement({
          vendorAllocationId: vendorAllocation.id,
        }, tx);

        resolvedLineItems.push({
          ...lineItem,
          vendorId: economicOwner.economicOwnerVendorId,
          originalVendorId,
          vendorAllocationId: vendorAllocation.id,
          activeSaleLedgerId: economicOwner.activeSaleLedgerId,
          supersededFromLedgerIds: economicOwner.supersededFromLedgerIds,
          shopifyOrderLineItemId: matchedOrderLineItem.id,
          sourceShopifyOrderNumber: vendorAllocation.sourceShopifyOrderNumber,
          cancelRefundReviewStatus: vendorAllocation.cancelRefundReviewStatus ?? null,
          refundAmount: toAmountString(lineItem.subtotal, lineItem.quantity),
        });
      }

      const shopifyRefund = await tx.shopifyRefund.upsert({
        where: {
          sourceShopifyRefundId: parsedRefund.sourceShopifyRefundId,
        },
        update: {
          shopifyOrderId: shopifyOrder.id,
          sourceShopifyOrderId: shopifyOrder.sourceShopifyOrderId,
          sourceShopifyOrderNumber: shopifyOrder.sourceShopifyOrderNumber,
          createdAt: parsedRefund.createdAt,
        },
        create: {
          sourceShopifyRefundId: parsedRefund.sourceShopifyRefundId,
          shopifyOrderId: shopifyOrder.id,
          sourceShopifyOrderId: shopifyOrder.sourceShopifyOrderId,
          sourceShopifyOrderNumber: shopifyOrder.sourceShopifyOrderNumber,
          createdAt: parsedRefund.createdAt,
        },
      });

      const groupedByVendor = new Map<string, typeof resolvedLineItems>();
      for (const lineItem of resolvedLineItems) {
        const group = groupedByVendor.get(lineItem.vendorId) ?? [];
        group.push(lineItem);
        groupedByVendor.set(lineItem.vendorId, group);
      }

      for (const [vendorId, vendorLineItems] of groupedByVendor.entries()) {
        const vendorAllocationId = vendorLineItems[0].vendorAllocationId;
        const refundRecordId = `refund-${vendorId}-${parsedRefund.sourceShopifyRefundId}`;
        const totalRefundAmount = sumAmounts(vendorLineItems.map((lineItem) => lineItem.refundAmount));
        const orderNumber = vendorLineItems[0].sourceShopifyOrderNumber;
        const sourceLineItemIds = vendorLineItems
          .map((lineItem) => lineItem.sourceLineItemId)
          .filter((sourceLineItemId): sourceLineItemId is string => Boolean(sourceLineItemId));
        const linkedReturnRequest = sourceLineItemIds.length > 0
          ? await tx.returnRecord.findFirst({
              where: {
                vendorAllocationId,
                sourceShopifyOrderId: parsedRefund.sourceShopifyOrderId,
                returnRequestSource: 'shopify_return_request',
                sourceShopifyLineItemId: {
                  in: sourceLineItemIds,
                },
              },
              orderBy: {
                createdAt: 'desc',
              },
            })
          : null;
        const returnRecordOwnerId = vendorLineItems[0].originalVendorId;
        const returnRecordId = linkedReturnRequest?.id ?? `return-${returnRecordOwnerId}-${parsedRefund.sourceShopifyRefundId}`;

        await tx.returnRecord.upsert({
          where: {
            id: returnRecordId,
          },
          update: {
            vendorAllocationId,
            sourceShopifyOrderId: parsedRefund.sourceShopifyOrderId,
            sourceShopifyOrderNumber: orderNumber,
            sourceShopifyRefundId: parsedRefund.sourceShopifyRefundId,
            status: 'processed',
            reason: parsedRefund.note ?? linkedReturnRequest?.reason ?? null,
          },
          create: {
            id: returnRecordId,
            vendorAllocationId,
            ownerVendorId: vendorId,
            sourceShopifyOrderId: parsedRefund.sourceShopifyOrderId,
            sourceShopifyOrderNumber: orderNumber,
            sourceShopifyRefundId: parsedRefund.sourceShopifyRefundId,
            status: 'processed',
            reason: parsedRefund.note,
          },
        });

        await tx.refundRecord.upsert({
          where: {
            id: refundRecordId,
          },
          update: {
            vendorAllocationId,
            sourceShopifyOrderId: parsedRefund.sourceShopifyOrderId,
            sourceShopifyOrderNumber: orderNumber,
            sourceShopifyRefundId: parsedRefund.sourceShopifyRefundId,
            amount: totalRefundAmount,
            status: 'processed',
          },
          create: {
            id: refundRecordId,
            vendorAllocationId,
            sourceShopifyOrderId: parsedRefund.sourceShopifyOrderId,
            sourceShopifyOrderNumber: orderNumber,
            sourceShopifyRefundId: parsedRefund.sourceShopifyRefundId,
            amount: totalRefundAmount,
            status: 'processed',
          },
        });

        for (const lineItem of vendorLineItems) {
          await tx.shopifyRefundLineItem.upsert({
            where: {
              shopifyRefundId_sourceRefundLineItemId: {
                shopifyRefundId: shopifyRefund.id,
                sourceRefundLineItemId: lineItem.sourceRefundLineItemId,
              },
            },
            update: {
              refundRecordId,
              shopifyOrderLineItemId: lineItem.shopifyOrderLineItemId,
              sourceLineItemId: lineItem.sourceLineItemId ?? lineItem.sourceRefundLineItemId,
              sku: lineItem.sku,
              title: lineItem.title,
              quantity: lineItem.quantity,
              subtotal: lineItem.refundAmount,
            },
            create: {
              shopifyRefundId: shopifyRefund.id,
              refundRecordId,
              shopifyOrderLineItemId: lineItem.shopifyOrderLineItemId,
              sourceRefundLineItemId: lineItem.sourceRefundLineItemId,
              sourceLineItemId: lineItem.sourceLineItemId ?? lineItem.sourceRefundLineItemId,
              sku: lineItem.sku,
              title: lineItem.title,
              quantity: lineItem.quantity,
              subtotal: lineItem.refundAmount,
            },
          });
        }

        const refundLedgerId = `fin-${vendorId}-refund-${parsedRefund.sourceShopifyRefundId}`;
        const conflictingRefundLedgerEntries = await tx.financeLedgerEntry.findMany({
          where: {
            vendorAllocationId,
            entryType: 'refund',
            id: {
              endsWith: `-refund-${parsedRefund.sourceShopifyRefundId}`,
            },
            NOT: {
              id: refundLedgerId,
            },
            voidedAt: null,
          },
          select: {
            id: true,
            vendorId: true,
          },
          take: 1,
        });
        const conflictingRefundLedgerEntry = conflictingRefundLedgerEntries[0] ?? null;
        if (conflictingRefundLedgerEntry) {
          throw new Error(
            `Active refund ledger ${conflictingRefundLedgerEntry.id} already exists for allocation ${vendorAllocationId} and Shopify refund ${parsedRefund.sourceShopifyRefundId}.`,
          );
        }

        const existingRefundLedgerEntry = await tx.financeLedgerEntry.findUnique({
          where: {
            id: refundLedgerId,
          },
          select: {
            id: true,
            payoutStatus: true,
          },
        });
        const saleLedgerEntry = await tx.financeLedgerEntry.findFirst({
          where: {
            id: vendorLineItems[0].activeSaleLedgerId,
            entryType: 'sale',
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
              where: {
                payoutBatch: {
                  status: {
                    in: ['DRAFT', 'REVIEW', 'APPROVED', 'EXECUTION_PENDING', 'PAID_PLACEHOLDER'],
                  },
                },
              },
              select: {
                payoutBatch: {
                  select: {
                    status: true,
                  },
                },
              },
            },
            settlementApprovalLines: {
              where: {
                settlementApproval: {
                  status: {
                    in: ['DRAFT', 'APPROVED'],
                  },
                },
              },
              select: {
                settlementApproval: {
                  select: {
                    id: true,
                    status: true,
                  },
                },
              },
            },
          },
        });
        if (!saleLedgerEntry) {
          throw new Error(
            `Active sale ledger ${vendorLineItems[0].activeSaleLedgerId} could not be loaded for allocation ${vendorAllocationId}.`,
          );
        }

        const refundOffsetEligibility = getUnsettledRefundOffsetEligibility({
          refundRecord: {
            id: refundRecordId,
            sourceShopifyRefundId: parsedRefund.sourceShopifyRefundId,
          },
          relatedSaleLedgerEntry: saleLedgerEntry,
        });
        const postApprovalRefundRisk = classifyPostApprovalRefundRisk({
          refundRecord: {
            id: refundRecordId,
            sourceShopifyRefundId: parsedRefund.sourceShopifyRefundId,
          },
          relatedSaleLedgerEntry: saleLedgerEntry,
        });
        const refundPayoutStatus =
          existingRefundLedgerEntry?.payoutStatus === 'PAID'
            ? 'PAID'
            : refundOffsetEligibility.eligible
              ? 'PENDING'
              : 'HOLD';
        const refundSettlementHoldReason = refundOffsetEligibility.eligible
          ? null
          : postApprovalRefundRisk.reason ?? refundOffsetEligibility.reason;

        await tx.financeLedgerEntry.upsert({
          where: {
            id: refundLedgerId,
          },
          update: {
            vendorAllocationId,
            vendorId,
            entryType: 'refund',
            amount: totalRefundAmount,
            payoutStatus: refundPayoutStatus,
            commissionPercentSnapshot: saleLedgerEntry?.commissionPercentSnapshot ?? null,
            commissionVatPercentSnapshot: saleLedgerEntry?.commissionVatPercentSnapshot ?? null,
            settlementStatus: 'PARTIALLY_REFUNDED',
            settlementHoldReason: refundSettlementHoldReason,
            description: `Refund allocation for Shopify refund ${parsedRefund.sourceShopifyRefundId}`,
          },
          create: {
            id: refundLedgerId,
            vendorAllocationId,
            vendorId,
            entryType: 'refund',
            amount: totalRefundAmount,
            payoutStatus: refundPayoutStatus,
            commissionPercentSnapshot: saleLedgerEntry?.commissionPercentSnapshot ?? null,
            commissionVatPercentSnapshot: saleLedgerEntry?.commissionVatPercentSnapshot ?? null,
            settlementStatus: 'PARTIALLY_REFUNDED',
            settlementHoldReason: refundSettlementHoldReason,
            description: `Refund allocation for Shopify refund ${parsedRefund.sourceShopifyRefundId}`,
          },
        });

        if (postApprovalRefundRisk.state === 'already_paid_requires_vendor_debt') {
          await createVendorDebtForPaidRefund(tx, {
            vendorId,
            refundRecordId,
            sourceShopifyRefundId: parsedRefund.sourceShopifyRefundId,
            financeLedgerEntryId: refundLedgerId,
            refundAmount: totalRefundAmount,
            commissionPercentSnapshot: saleLedgerEntry?.commissionPercentSnapshot,
            commissionVatPercentSnapshot: saleLedgerEntry?.commissionVatPercentSnapshot,
            currency: shopifyOrder.currency ?? 'TRY',
            sourceShopifyOrderId: parsedRefund.sourceShopifyOrderId,
            sourceShopifyOrderNumber: orderNumber,
            vendorAllocationId,
          });
        } else {
          await createSettlementRefundAdjustmentForRefundLedger(tx, {
            refundFinanceLedgerEntryId: refundLedgerId,
            refundRecordId,
            createdBy: 'system:shopify_refunds_create',
          });
        }

        if (!existingRefundLedgerEntry) {
          const refundOffset = calculateRefundOffsetAmounts({
            refundAmount: totalRefundAmount,
            commissionPercentSnapshot: saleLedgerEntry?.commissionPercentSnapshot,
            commissionVatPercentSnapshot: saleLedgerEntry?.commissionVatPercentSnapshot,
          });
          const baseEvent = {
            vendorId,
            shopifyOrderId: shopifyOrder.id,
            financeLedgerEntryId: refundLedgerId,
            currency: shopifyOrder.currency ?? 'TRY',
            referenceType: 'shopify_refund',
            referenceId: parsedRefund.sourceShopifyRefundId,
            createdBy: 'system:shopify_refunds_create',
            metadataJson: {
              sourceShopifyOrderId: parsedRefund.sourceShopifyOrderId,
              sourceShopifyOrderNumber: orderNumber,
              sourceShopifyRefundId: parsedRefund.sourceShopifyRefundId,
              vendorAllocationId,
              financeLedgerEntryId: refundLedgerId,
              commissionPercentSnapshot: refundOffset.commissionPercent,
              commissionVatPercentSnapshot: refundOffset.commissionVatPercent,
              commissionReversalMinor: refundOffset.commissionReversalMinor,
              commissionVatReversalMinor: refundOffset.commissionVatReversalMinor,
              vendorPayableReversalMinor: refundOffset.vendorPayableReversalMinor,
              refundOffsetEligibility: refundOffsetEligibility.code,
              postApprovalRefundRisk: postApprovalRefundRisk.state,
              originalVendorIds: [...new Set(vendorLineItems.map((lineItem) => lineItem.originalVendorId))],
              activeSaleLedgerId: vendorLineItems[0].activeSaleLedgerId,
              supersededFromLedgerIds: [
                ...new Set(vendorLineItems.flatMap((lineItem) => lineItem.supersededFromLedgerIds)),
              ],
              sourceRefundLineItemIds: vendorLineItems.map((lineItem) => lineItem.sourceRefundLineItemId),
              sourceLineItemIds,
            },
          };

          const refundEvents = [
            {
              ...baseEvent,
              eventType: FinanceEventType.REFUND_RECORDED,
              amountMinor: refundOffset.refundMinor,
              idempotencyKey: `${refundLedgerId}:REFUND_RECORDED`,
            },
            {
              ...baseEvent,
              eventType: FinanceEventType.COMMISSION_REVERSED,
              amountMinor: -refundOffset.commissionReversalMinor,
              idempotencyKey: `${refundLedgerId}:COMMISSION_REVERSED`,
            },
            refundOffset.commissionVatReversalMinor > 0
              ? {
                  ...baseEvent,
                  eventType: FinanceEventType.COMMISSION_VAT_REVERSED,
                  amountMinor: -refundOffset.commissionVatReversalMinor,
                  idempotencyKey: `${refundLedgerId}:COMMISSION_VAT_REVERSED`,
                }
              : null,
            {
              ...baseEvent,
              eventType: FinanceEventType.VENDOR_PAYABLE_REVERSED,
              amountMinor: -refundOffset.vendorPayableReversalMinor,
              idempotencyKey: `${refundLedgerId}:VENDOR_PAYABLE_REVERSED`,
            },
          ].filter((event): event is NonNullable<typeof event> => Boolean(event));

          await createEventsIdempotently(refundEvents, tx);
        }

        await resolveCancelRefundReviewAfterRefundIngestion(tx, {
          vendorAllocationId,
          cancelRefundReviewStatus: vendorLineItems[0].cancelRefundReviewStatus,
          sourceShopifyRefundId: parsedRefund.sourceShopifyRefundId,
          resolvedAt: new Date(),
        });
      }

      await tx.webhookEvent.update({
        where: { id: input.event.id },
        data: {
          status: 'PROCESSED',
          processedAt: new Date(),
          errorMessage: null,
          shopifyOrderId: shopifyOrder.id,
        },
      });

      return {
        shopifyOrderId: parsedRefund.sourceShopifyOrderId,
        refundAllocationCount: groupedByVendor.size,
      };
    });

    return {
      ok: true,
      action: 'accepted',
      processingStatus: 'processed',
      shopifyOrderId: result.shopifyOrderId,
      refundAllocationCount: result.refundAllocationCount,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Shopify refund ingestion failed.';

    await prisma.webhookEvent.update({
      where: { id: input.event.id },
      data: {
        status: 'FAILED',
        errorMessage: message,
      },
    });

    return {
      ok: false,
      action: 'received_needs_attention',
      processingStatus: 'needs_attention',
      error: message,
    };
  }
}
