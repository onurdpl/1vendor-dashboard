import {
  Prisma,
  ShipmentExecutionStatus,
  type AllocationFullRefundTerminalFact,
} from '@prisma/client';
import type { AppEnv } from '../../config/env.js';
import { prisma } from '../../db/prisma.js';
import {
  createAllocationFullRefundTerminalVerifier,
  type AllocationForFullRefundTerminalVerification,
  type AllocationFullRefundTerminalVerifierResult,
  type AllocationFullRefundTerminalVerifierShopifySource,
} from './allocation-full-refund-terminal-verifier.service.js';
import { acquireShopifyOrderTransactionLock } from '../shopify/orders-create-ownership.service.js';

export const FULL_REFUND_TERMINAL_FACT_SOURCES = {
  REFUND_WEBHOOK: 'refund_webhook',
  CANONICAL_RECONCILIATION: 'canonical_reconciliation',
  CURRENT_STATE_REPAIR: 'current_state_repair',
  HISTORICAL_BACKFILL: 'historical_backfill',
} as const;

export type FullRefundTerminalFactSource =
  (typeof FULL_REFUND_TERMINAL_FACT_SOURCES)[keyof typeof FULL_REFUND_TERMINAL_FACT_SOURCES];

export const FULL_REFUND_TERMINAL_FACT_OUTCOMES = {
  disabled: 'DISABLED',
  created: 'CREATED',
  alreadyExists: 'ALREADY_EXISTS_SAME_TERMINAL_STATE',
  doesNotQualify: 'DOES_NOT_QUALIFY',
  indeterminate: 'INDETERMINATE',
  outboundClaimConflict: 'CONFLICT_WITH_OUTBOUND_DURABLE_CLAIM',
} as const;

export type FullRefundTerminalFactWriterResult =
  | { outcome: 'DISABLED'; fact: null; reasonCode: 'writer_disabled' }
  | { outcome: 'CREATED'; fact: AllocationFullRefundTerminalFact; reasonCode: null }
  | {
      outcome: 'ALREADY_EXISTS_SAME_TERMINAL_STATE';
      fact: AllocationFullRefundTerminalFact;
      reasonCode: null;
    }
  | { outcome: 'DOES_NOT_QUALIFY'; fact: null; reasonCode: string }
  | { outcome: 'INDETERMINATE'; fact: null; reasonCode: string }
  | {
      outcome: 'CONFLICT_WITH_OUTBOUND_DURABLE_CLAIM';
      fact: null;
      reasonCode: 'shipment_execution_pending' | 'shopify_fulfillment_submission_pending';
    };

type TerminalVerifier = {
  verify(
    allocation: AllocationForFullRefundTerminalVerification,
  ): Promise<AllocationFullRefundTerminalVerifierResult>;
};

type WriterDependencies = {
  db?: typeof prisma;
  verifier?: TerminalVerifier;
  acquireOrderLock?: typeof acquireShopifyOrderTransactionLock;
};

const verificationAllocationSelect = {
  id: true,
  sourceShopifyOrderId: true,
  order: {
    select: {
      id: true,
      sourceShopifyOrderId: true,
    },
  },
  lineItems: {
    select: {
      id: true,
      shopifyLineItemId: true,
      quantity: true,
      shopifyOrderLineItem: {
        select: {
          id: true,
          sourceLineItemId: true,
        },
      },
    },
  },
} satisfies Prisma.VendorAllocationSelect;

function normalizeRequired(value: string | null | undefined) {
  const normalized = value?.trim() ?? '';
  return normalized || null;
}

function isUniqueConstraintError(error: unknown) {
  return (
    (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') ||
    (error !== null && typeof error === 'object' && Reflect.get(error, 'code') === 'P2002')
  );
}

export function createAllocationFullRefundTerminalFactService(
  env: Pick<AppEnv, 'FULL_REFUND_TERMINAL_WRITER_ENABLED' | 'SHOPIFY_API_VERSION'>,
  shopifyAdminService: AllocationFullRefundTerminalVerifierShopifySource,
  dependencies: WriterDependencies = {},
) {
  const db = dependencies.db ?? prisma;
  const verifier = dependencies.verifier ?? createAllocationFullRefundTerminalVerifier({ shopifyAdminService });
  const acquireOrderLock = dependencies.acquireOrderLock ?? acquireShopifyOrderTransactionLock;

  async function findExisting(vendorAllocationId: string) {
    return db.allocationFullRefundTerminalFact.findUnique({
      where: { vendorAllocationId },
    });
  }

  return {
    async createVerifiedFact(input: {
      vendorAllocationId: string;
      verificationSource: FullRefundTerminalFactSource;
    }): Promise<FullRefundTerminalFactWriterResult> {
      if (!env.FULL_REFUND_TERMINAL_WRITER_ENABLED) {
        return {
          outcome: FULL_REFUND_TERMINAL_FACT_OUTCOMES.disabled,
          fact: null,
          reasonCode: 'writer_disabled',
        };
      }

      const vendorAllocationId = normalizeRequired(input.vendorAllocationId);
      const shopifyApiVersion = normalizeRequired(env.SHOPIFY_API_VERSION);
      if (!vendorAllocationId || !shopifyApiVersion) {
        return {
          outcome: FULL_REFUND_TERMINAL_FACT_OUTCOMES.indeterminate,
          fact: null,
          reasonCode: !vendorAllocationId ? 'vendor_allocation_identity_missing' : 'shopify_api_version_missing',
        };
      }

      const allocation = await db.vendorAllocation.findUnique({
        where: { id: vendorAllocationId },
        select: verificationAllocationSelect,
      });
      if (!allocation) {
        return {
          outcome: FULL_REFUND_TERMINAL_FACT_OUTCOMES.indeterminate,
          fact: null,
          reasonCode: 'vendor_allocation_not_found',
        };
      }

      const verification = await verifier.verify(allocation);
      if (verification.state === 'DOES_NOT_QUALIFY') {
        return {
          outcome: FULL_REFUND_TERMINAL_FACT_OUTCOMES.doesNotQualify,
          fact: null,
          reasonCode: verification.reasonCode,
        };
      }
      if (verification.state === 'INDETERMINATE') {
        return {
          outcome: FULL_REFUND_TERMINAL_FACT_OUTCOMES.indeterminate,
          fact: null,
          reasonCode: verification.reasonCode,
        };
      }

      try {
        return await db.$transaction(async (tx): Promise<FullRefundTerminalFactWriterResult> => {
          const currentIdentity = await tx.vendorAllocation.findUnique({
            where: { id: vendorAllocationId },
            select: {
              id: true,
              sourceShopifyOrderId: true,
              order: {
                select: {
                  id: true,
                  sourceShopifyOrderId: true,
                },
              },
            },
          });
          const sourceShopifyOrderId = normalizeRequired(currentIdentity?.order.sourceShopifyOrderId);
          if (!currentIdentity || !sourceShopifyOrderId) {
            return {
              outcome: FULL_REFUND_TERMINAL_FACT_OUTCOMES.indeterminate,
              fact: null,
              reasonCode: 'canonical_shopify_order_identity_missing',
            };
          }

          await acquireOrderLock(tx, sourceShopifyOrderId);

          const current = await tx.vendorAllocation.findUnique({
            where: { id: vendorAllocationId },
            select: {
              id: true,
              sourceShopifyOrderId: true,
              order: {
                select: {
                  id: true,
                  sourceShopifyOrderId: true,
                },
              },
              fullRefundTerminalFact: true,
              shipmentExecutions: {
                where: { shipmentStatus: ShipmentExecutionStatus.PENDING },
                select: { id: true },
                take: 1,
              },
              fulfillment: {
                select: { syncStatus: true },
              },
            },
          });
          if (
            !current ||
            normalizeRequired(current.order.sourceShopifyOrderId) !== sourceShopifyOrderId
          ) {
            return {
              outcome: FULL_REFUND_TERMINAL_FACT_OUTCOMES.indeterminate,
              fact: null,
              reasonCode: 'canonical_shopify_order_identity_changed',
            };
          }
          if (current.fullRefundTerminalFact) {
            return {
              outcome: FULL_REFUND_TERMINAL_FACT_OUTCOMES.alreadyExists,
              fact: current.fullRefundTerminalFact,
              reasonCode: null,
            };
          }
          if (current.shipmentExecutions.length > 0) {
            return {
              outcome: FULL_REFUND_TERMINAL_FACT_OUTCOMES.outboundClaimConflict,
              fact: null,
              reasonCode: 'shipment_execution_pending',
            };
          }
          if (current.fulfillment?.syncStatus === 'fulfillment_submission_pending') {
            return {
              outcome: FULL_REFUND_TERMINAL_FACT_OUTCOMES.outboundClaimConflict,
              fact: null,
              reasonCode: 'shopify_fulfillment_submission_pending',
            };
          }

          const fact = await tx.allocationFullRefundTerminalFact.create({
            data: {
              vendorAllocationId,
              shopifyOrderGid: verification.shopifyOrderGid,
              verificationSource: input.verificationSource,
              shopifyApiVersion,
              evidenceJson: verification.evidence as Prisma.InputJsonValue,
            },
          });
          return {
            outcome: FULL_REFUND_TERMINAL_FACT_OUTCOMES.created,
            fact,
            reasonCode: null,
          };
        });
      } catch (error) {
        if (!isUniqueConstraintError(error)) throw error;
        const existing = await findExisting(vendorAllocationId);
        if (!existing) throw error;
        return {
          outcome: FULL_REFUND_TERMINAL_FACT_OUTCOMES.alreadyExists,
          fact: existing,
          reasonCode: null,
        };
      }
    },

    findByVendorAllocationId(vendorAllocationId: string) {
      return findExisting(vendorAllocationId);
    },
  };
}
