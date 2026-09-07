import { Prisma, ShipmentExecutionStatus } from '@prisma/client';
import type { AppEnv } from '../../config/env.js';
import { prisma } from '../../db/prisma.js';
import { createShopifyAdminService } from '../shopify/shopify-admin.service.js';
import {
  createAllocationFullRefundTerminalVerifier,
  type AllocationForFullRefundTerminalVerification,
  type AllocationFullRefundTerminalVerifierResult,
} from './allocation-full-refund-terminal-verifier.service.js';

export const TERMINAL_CURRENT_STATE_DRY_RUN_STATES = {
  alreadyTerminal: 'ALREADY_TERMINAL',
  qualifies: 'QUALIFIES',
  doesNotQualify: 'DOES_NOT_QUALIFY',
  indeterminate: 'INDETERMINATE',
  conflict: 'CONFLICT',
  error: 'ERROR',
} as const;

export type TerminalCurrentStateDryRunState =
  (typeof TERMINAL_CURRENT_STATE_DRY_RUN_STATES)[keyof typeof TERMINAL_CURRENT_STATE_DRY_RUN_STATES];

export type TerminalCurrentStateDryRunAllocation = {
  vendorAllocationId: string;
  shopifyOrderGid: string | null;
  vendorId: string;
  state: TerminalCurrentStateDryRunState;
  reason: string | null;
};

export type TerminalCurrentStateDryRunResult = {
  dryRun: true;
  shopifyOrderGid: string;
  scanned: number;
  candidateAllocations: number;
  qualifies: number;
  doesNotQualify: number;
  indeterminate: number;
  conflict: number;
  alreadyTerminal: number;
  errors: number;
  allocations: TerminalCurrentStateDryRunAllocation[];
};

export class TerminalCurrentStateDryRunError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'TerminalCurrentStateDryRunError';
  }
}

const exactOrderSelect = {
  id: true,
  sourceShopifyOrderId: true,
  sourceShopifyOrderNumber: true,
  allocations: {
    orderBy: { id: 'asc' as const },
    select: {
      id: true,
      assignedVendorId: true,
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
      fullRefundTerminalFact: {
        select: {
          id: true,
          shopifyOrderGid: true,
        },
      },
      shipmentExecutions: {
        where: { shipmentStatus: ShipmentExecutionStatus.PENDING },
        select: { id: true },
        take: 1,
      },
      fulfillment: {
        select: { syncStatus: true },
      },
    },
  },
} satisfies Prisma.ShopifyOrderSelect;

type ExactOrder = Prisma.ShopifyOrderGetPayload<{ select: typeof exactOrderSelect }>;

type TerminalVerifier = {
  verify(
    allocation: AllocationForFullRefundTerminalVerification,
  ): Promise<AllocationFullRefundTerminalVerifierResult>;
};

export type TerminalCurrentStateDryRunDependencies = {
  findByShopifyOrderId(sourceShopifyOrderId: string): Promise<ExactOrder | null>;
  findByOrderNumber(sourceShopifyOrderNumber: string): Promise<ExactOrder[]>;
  verifier: TerminalVerifier;
};

type ParsedIdentifier =
  | { kind: 'id'; value: string }
  | { kind: 'number'; value: string };

function parseExactOrderIdentifier(value: string): ParsedIdentifier {
  const normalized = value.trim();
  if (/^\d+$/.test(normalized)) return { kind: 'id', value: normalized };
  if (/^#\d+$/.test(normalized)) return { kind: 'number', value: normalized };
  throw new TerminalCurrentStateDryRunError(
    'invalid_order_identifier',
    'Provide exactly one Shopify order ID or order number such as #1128.',
    400,
  );
}

function toOrderGid(sourceShopifyOrderId: string) {
  return `gid://shopify/Order/${sourceShopifyOrderId}`;
}

function localIdentityFailure(
  allocation: ExactOrder['allocations'][number],
  sourceShopifyOrderId: string,
) {
  if (!allocation.assignedVendorId.trim()) return 'assigned_vendor_identity_missing';
  if (
    !allocation.order?.sourceShopifyOrderId?.trim() ||
    allocation.order.sourceShopifyOrderId !== sourceShopifyOrderId ||
    allocation.sourceShopifyOrderId !== allocation.order.id
  ) {
    return 'canonical_shopify_order_identity_missing';
  }
  if (allocation.lineItems.length === 0) return 'allocation_line_items_missing';

  const allocationLineIds = new Set<string>();
  for (const line of allocation.lineItems) {
    if (
      !line.id.trim() ||
      allocationLineIds.has(line.id) ||
      !line.shopifyLineItemId.trim() ||
      !line.shopifyOrderLineItem?.id?.trim() ||
      line.shopifyLineItemId !== line.shopifyOrderLineItem.id ||
      !line.shopifyOrderLineItem.sourceLineItemId.trim()
    ) {
      return 'allocation_line_identity_missing_or_ambiguous';
    }
    allocationLineIds.add(line.id);
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      return 'allocation_owned_quantity_invalid';
    }
  }
  return null;
}

function durableClaimConflict(allocation: ExactOrder['allocations'][number]) {
  if (allocation.shipmentExecutions.length > 0) return 'shipment_execution_pending';
  if (allocation.fulfillment?.syncStatus === 'fulfillment_submission_pending') {
    return 'shopify_fulfillment_submission_pending';
  }
  return null;
}

function createDefaultDependencies(env: AppEnv): TerminalCurrentStateDryRunDependencies {
  const verifier = createAllocationFullRefundTerminalVerifier({
    shopifyAdminService: createShopifyAdminService(env),
  });
  return {
    findByShopifyOrderId(sourceShopifyOrderId) {
      return prisma.shopifyOrder.findUnique({
        where: { sourceShopifyOrderId },
        select: exactOrderSelect,
      });
    },
    findByOrderNumber(sourceShopifyOrderNumber) {
      return prisma.shopifyOrder.findMany({
        where: { sourceShopifyOrderNumber },
        select: exactOrderSelect,
        take: 2,
      });
    },
    verifier,
  };
}

export function createTerminalCurrentStateRepairDryRunService(
  env: AppEnv,
  dependencies: TerminalCurrentStateDryRunDependencies = createDefaultDependencies(env),
) {
  async function loadExactOrder(identifier: ParsedIdentifier) {
    if (identifier.kind === 'id') {
      return dependencies.findByShopifyOrderId(identifier.value);
    }
    const matches = await dependencies.findByOrderNumber(identifier.value);
    if (matches.length > 1) {
      throw new TerminalCurrentStateDryRunError(
        'ambiguous_order_identifier',
        'The Shopify order number matched multiple local orders.',
        409,
      );
    }
    return matches[0] ?? null;
  }

  return {
    async plan(input: { orderIdentifier: string }): Promise<TerminalCurrentStateDryRunResult> {
      const identifier = parseExactOrderIdentifier(input.orderIdentifier);
      const order = await loadExactOrder(identifier);
      if (!order) {
        throw new TerminalCurrentStateDryRunError(
          'order_not_found',
          'The exact local Shopify order was not found.',
          404,
        );
      }

      const shopifyOrderGid = toOrderGid(order.sourceShopifyOrderId);
      const allocations: TerminalCurrentStateDryRunAllocation[] = [];

      for (const allocation of order.allocations) {
        if (allocation.fullRefundTerminalFact) {
          allocations.push({
            vendorAllocationId: allocation.id,
            shopifyOrderGid: allocation.fullRefundTerminalFact.shopifyOrderGid,
            vendorId: allocation.assignedVendorId,
            state: TERMINAL_CURRENT_STATE_DRY_RUN_STATES.alreadyTerminal,
            reason: null,
          });
          continue;
        }

        const identityFailure = localIdentityFailure(allocation, order.sourceShopifyOrderId);
        if (identityFailure) {
          allocations.push({
            vendorAllocationId: allocation.id,
            shopifyOrderGid,
            vendorId: allocation.assignedVendorId,
            state: TERMINAL_CURRENT_STATE_DRY_RUN_STATES.indeterminate,
            reason: identityFailure,
          });
          continue;
        }

        try {
          const verification = await dependencies.verifier.verify(allocation);
          if (verification.state === 'QUALIFIES') {
            const conflict = durableClaimConflict(allocation);
            allocations.push({
              vendorAllocationId: allocation.id,
              shopifyOrderGid: verification.shopifyOrderGid,
              vendorId: allocation.assignedVendorId,
              state: conflict
                ? TERMINAL_CURRENT_STATE_DRY_RUN_STATES.conflict
                : TERMINAL_CURRENT_STATE_DRY_RUN_STATES.qualifies,
              reason: conflict ?? verification.reasonCode,
            });
          } else {
            allocations.push({
              vendorAllocationId: allocation.id,
              shopifyOrderGid,
              vendorId: allocation.assignedVendorId,
              state: verification.state,
              reason: verification.reasonCode,
            });
          }
        } catch {
          allocations.push({
            vendorAllocationId: allocation.id,
            shopifyOrderGid,
            vendorId: allocation.assignedVendorId,
            state: TERMINAL_CURRENT_STATE_DRY_RUN_STATES.error,
            reason: 'terminal_verification_failed',
          });
        }
      }

      allocations.sort((left, right) => left.vendorAllocationId.localeCompare(right.vendorAllocationId));
      const count = (state: TerminalCurrentStateDryRunState) =>
        allocations.filter((allocation) => allocation.state === state).length;

      return {
        dryRun: true,
        shopifyOrderGid,
        scanned: allocations.length,
        candidateAllocations: allocations.length - count(TERMINAL_CURRENT_STATE_DRY_RUN_STATES.alreadyTerminal),
        qualifies: count(TERMINAL_CURRENT_STATE_DRY_RUN_STATES.qualifies),
        doesNotQualify: count(TERMINAL_CURRENT_STATE_DRY_RUN_STATES.doesNotQualify),
        indeterminate: count(TERMINAL_CURRENT_STATE_DRY_RUN_STATES.indeterminate),
        conflict: count(TERMINAL_CURRENT_STATE_DRY_RUN_STATES.conflict),
        alreadyTerminal: count(TERMINAL_CURRENT_STATE_DRY_RUN_STATES.alreadyTerminal),
        errors: count(TERMINAL_CURRENT_STATE_DRY_RUN_STATES.error),
        allocations,
      };
    },
  };
}

