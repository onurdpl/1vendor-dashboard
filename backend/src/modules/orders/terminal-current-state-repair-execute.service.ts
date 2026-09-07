import { OperationalJobStatus, OperationalJobType, Prisma } from '@prisma/client';
import type { AppEnv } from '../../config/env.js';
import { prisma } from '../../db/prisma.js';
import { createShopifyAdminService } from '../shopify/shopify-admin.service.js';
import {
  createAllocationFullRefundTerminalFactService,
  FULL_REFUND_TERMINAL_FACT_OUTCOMES,
  FULL_REFUND_TERMINAL_FACT_SOURCES,
  type FullRefundTerminalFactWriterResult,
} from './allocation-full-refund-terminal-fact.service.js';

export const TERMINAL_CURRENT_STATE_EXECUTE_STATES = {
  created: 'CREATED',
  alreadyTerminal: 'ALREADY_TERMINAL',
  doesNotQualify: 'DOES_NOT_QUALIFY',
  indeterminate: 'INDETERMINATE',
  conflict: 'CONFLICT',
  error: 'ERROR',
} as const;

export type TerminalCurrentStateExecuteState =
  (typeof TERMINAL_CURRENT_STATE_EXECUTE_STATES)[keyof typeof TERMINAL_CURRENT_STATE_EXECUTE_STATES];

export type TerminalCurrentStateExecuteAllocation = {
  vendorAllocationId: string;
  shopifyOrderGid: string;
  vendorId: string;
  state: TerminalCurrentStateExecuteState;
  reason: string | null;
};

export type TerminalCurrentStateExecuteResult = {
  dryRun: false;
  executed: true;
  operationalJobId: string;
  shopifyOrderGid: string;
  scanned: number;
  candidateAllocations: number;
  created: number;
  alreadyTerminal: number;
  doesNotQualify: number;
  indeterminate: number;
  conflict: number;
  errors: number;
  allocations: TerminalCurrentStateExecuteAllocation[];
};

export class TerminalCurrentStateExecuteError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'TerminalCurrentStateExecuteError';
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
    },
  },
} satisfies Prisma.ShopifyOrderSelect;

type ExactOrder = Prisma.ShopifyOrderGetPayload<{ select: typeof exactOrderSelect }>;
type TerminalFactWriter = {
  createVerifiedFact(input: {
    vendorAllocationId: string;
    verificationSource: typeof FULL_REFUND_TERMINAL_FACT_SOURCES.CURRENT_STATE_REPAIR;
  }): Promise<FullRefundTerminalFactWriterResult>;
};

type ExecuteCounters = Omit<
  TerminalCurrentStateExecuteResult,
  'dryRun' | 'executed' | 'operationalJobId' | 'shopifyOrderGid' | 'allocations'
>;

export type TerminalCurrentStateExecuteDependencies = {
  findByShopifyOrderId(sourceShopifyOrderId: string): Promise<ExactOrder | null>;
  findByOrderNumber(sourceShopifyOrderNumber: string): Promise<ExactOrder[]>;
  writer: TerminalFactWriter;
  createOperationalJob(input: {
    sourceShopifyOrderId: string;
    allocationIds: string[];
    startedAt: Date;
  }): Promise<{ id: string }>;
  finalizeOperationalJob(input: {
    jobId: string;
    allocationIds: string[];
    counters: ExecuteCounters;
    completedAt: Date;
  }): Promise<void>;
};

type ParsedIdentifier =
  | { kind: 'id'; value: string }
  | { kind: 'number'; value: string };

const OPERATION = 'terminal_current_state_repair';

export function buildTerminalCurrentStateRepairJobCreateData(input: {
  sourceShopifyOrderId: string;
  allocationIds: string[];
  startedAt: Date;
}) {
  return {
    jobType: OperationalJobType.RECONCILIATION,
    status: OperationalJobStatus.PROCESSING,
    sourceShopifyOrderId: input.sourceShopifyOrderId,
    maxRetries: 0,
    startedAt: input.startedAt,
    lastAttemptAt: input.startedAt,
    payload: toJson({
      operation: OPERATION,
      allocationIds: input.allocationIds,
    }),
  };
}

export function buildTerminalCurrentStateRepairJobFinalData(input: {
  allocationIds: string[];
  counters: ExecuteCounters;
  completedAt: Date;
}) {
  const failed = input.counters.errors > 0;
  return {
    status: failed ? OperationalJobStatus.FAILED : OperationalJobStatus.COMPLETED,
    completedAt: failed ? null : input.completedAt,
    failedAt: failed ? input.completedAt : null,
    errorSummary: failed ? 'One or more allocation terminal-writer evaluations failed.' : null,
    failureCategory: failed ? 'current_state_terminal_repair' : null,
    payload: toJson({
      operation: OPERATION,
      allocationIds: input.allocationIds,
      outcomeCounts: input.counters,
    }),
  };
}

function parseExactOrderIdentifier(value: string): ParsedIdentifier {
  const normalized = value.trim();
  if (/^\d+$/.test(normalized)) return { kind: 'id', value: normalized };
  if (/^#\d+$/.test(normalized)) return { kind: 'number', value: normalized };
  throw new TerminalCurrentStateExecuteError(
    'invalid_order_identifier',
    'Provide exactly one Shopify order ID or order number such as #1128.',
    400,
  );
}

function toOrderGid(sourceShopifyOrderId: string) {
  return `gid://shopify/Order/${sourceShopifyOrderId}`;
}

function toJson(value: Record<string, unknown>): Prisma.InputJsonObject {
  return value as Prisma.InputJsonObject;
}

function createDefaultDependencies(env: AppEnv): TerminalCurrentStateExecuteDependencies {
  const writer = createAllocationFullRefundTerminalFactService(
    env,
    createShopifyAdminService(env),
  );
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
    writer,
    createOperationalJob(input) {
      return prisma.operationalJob.create({
        data: buildTerminalCurrentStateRepairJobCreateData(input),
        select: { id: true },
      });
    },
    async finalizeOperationalJob(input) {
      await prisma.operationalJob.update({
        where: { id: input.jobId },
        data: buildTerminalCurrentStateRepairJobFinalData(input),
      });
    },
  };
}

function mapWriterResult(
  result: FullRefundTerminalFactWriterResult,
  fallbackShopifyOrderGid: string,
): Pick<TerminalCurrentStateExecuteAllocation, 'shopifyOrderGid' | 'state' | 'reason'> {
  if (result.outcome === FULL_REFUND_TERMINAL_FACT_OUTCOMES.created) {
    return { shopifyOrderGid: result.fact.shopifyOrderGid, state: 'CREATED', reason: null };
  }
  if (result.outcome === FULL_REFUND_TERMINAL_FACT_OUTCOMES.alreadyExists) {
    return { shopifyOrderGid: result.fact.shopifyOrderGid, state: 'ALREADY_TERMINAL', reason: null };
  }
  if (result.outcome === FULL_REFUND_TERMINAL_FACT_OUTCOMES.doesNotQualify) {
    return { shopifyOrderGid: fallbackShopifyOrderGid, state: 'DOES_NOT_QUALIFY', reason: result.reasonCode };
  }
  if (result.outcome === FULL_REFUND_TERMINAL_FACT_OUTCOMES.indeterminate) {
    return { shopifyOrderGid: fallbackShopifyOrderGid, state: 'INDETERMINATE', reason: result.reasonCode };
  }
  if (result.outcome === FULL_REFUND_TERMINAL_FACT_OUTCOMES.outboundClaimConflict) {
    return { shopifyOrderGid: fallbackShopifyOrderGid, state: 'CONFLICT', reason: result.reasonCode };
  }
  return { shopifyOrderGid: fallbackShopifyOrderGid, state: 'ERROR', reason: 'writer_disabled' };
}

function buildCounters(
  allocations: TerminalCurrentStateExecuteAllocation[],
  candidateAllocations: number,
): ExecuteCounters {
  const count = (state: TerminalCurrentStateExecuteState) =>
    allocations.filter((allocation) => allocation.state === state).length;
  return {
    scanned: allocations.length,
    candidateAllocations,
    created: count(TERMINAL_CURRENT_STATE_EXECUTE_STATES.created),
    alreadyTerminal: count(TERMINAL_CURRENT_STATE_EXECUTE_STATES.alreadyTerminal),
    doesNotQualify: count(TERMINAL_CURRENT_STATE_EXECUTE_STATES.doesNotQualify),
    indeterminate: count(TERMINAL_CURRENT_STATE_EXECUTE_STATES.indeterminate),
    conflict: count(TERMINAL_CURRENT_STATE_EXECUTE_STATES.conflict),
    errors: count(TERMINAL_CURRENT_STATE_EXECUTE_STATES.error),
  };
}

export function createTerminalCurrentStateRepairExecuteService(
  env: AppEnv,
  dependencies: TerminalCurrentStateExecuteDependencies = createDefaultDependencies(env),
) {
  async function loadExactOrder(identifier: ParsedIdentifier) {
    if (identifier.kind === 'id') {
      return dependencies.findByShopifyOrderId(identifier.value);
    }
    const matches = await dependencies.findByOrderNumber(identifier.value);
    if (matches.length > 1) {
      throw new TerminalCurrentStateExecuteError(
        'ambiguous_order_identifier',
        'The Shopify order number matched multiple local orders.',
        409,
      );
    }
    return matches[0] ?? null;
  }

  return {
    async execute(input: {
      orderIdentifier: string;
      execute: true;
    }): Promise<TerminalCurrentStateExecuteResult> {
      if (!env.FULL_REFUND_CURRENT_STATE_REPAIR_WRITE_ENABLED) {
        throw new TerminalCurrentStateExecuteError(
          'terminal_current_state_repair_write_disabled',
          'Terminal current-state repair write mode is disabled.',
          503,
        );
      }
      if (!env.FULL_REFUND_TERMINAL_WRITER_ENABLED) {
        throw new TerminalCurrentStateExecuteError(
          'full_refund_terminal_writer_disabled',
          'The full-refund terminal writer is disabled.',
          503,
        );
      }
      if (input.execute !== true) {
        throw new TerminalCurrentStateExecuteError(
          'execution_confirmation_required',
          'Literal execute=true is required.',
          400,
        );
      }

      const identifier = parseExactOrderIdentifier(input.orderIdentifier);
      const order = await loadExactOrder(identifier);
      if (!order) {
        throw new TerminalCurrentStateExecuteError(
          'order_not_found',
          'The exact local Shopify order was not found.',
          404,
        );
      }

      const shopifyOrderGid = toOrderGid(order.sourceShopifyOrderId);
      const orderedAllocations = [...order.allocations].sort((left, right) => left.id.localeCompare(right.id));
      const allocationIds = orderedAllocations.map((allocation) => allocation.id);
      const candidateAllocations = orderedAllocations.filter(
        (allocation) => !allocation.fullRefundTerminalFact,
      ).length;
      const startedAt = new Date();
      const job = await dependencies.createOperationalJob({
        sourceShopifyOrderId: order.sourceShopifyOrderId,
        allocationIds,
        startedAt,
      });
      const allocations: TerminalCurrentStateExecuteAllocation[] = [];

      for (const allocation of orderedAllocations) {
        if (allocation.fullRefundTerminalFact) {
          allocations.push({
            vendorAllocationId: allocation.id,
            shopifyOrderGid: allocation.fullRefundTerminalFact.shopifyOrderGid,
            vendorId: allocation.assignedVendorId,
            state: TERMINAL_CURRENT_STATE_EXECUTE_STATES.alreadyTerminal,
            reason: null,
          });
          continue;
        }

        try {
          const writerResult = await dependencies.writer.createVerifiedFact({
            vendorAllocationId: allocation.id,
            verificationSource: FULL_REFUND_TERMINAL_FACT_SOURCES.CURRENT_STATE_REPAIR,
          });
          allocations.push({
            vendorAllocationId: allocation.id,
            vendorId: allocation.assignedVendorId,
            ...mapWriterResult(writerResult, shopifyOrderGid),
          });
        } catch {
          allocations.push({
            vendorAllocationId: allocation.id,
            shopifyOrderGid,
            vendorId: allocation.assignedVendorId,
            state: TERMINAL_CURRENT_STATE_EXECUTE_STATES.error,
            reason: 'unexpected_writer_error',
          });
        }
      }

      allocations.sort((left, right) => left.vendorAllocationId.localeCompare(right.vendorAllocationId));
      const counters = buildCounters(allocations, candidateAllocations);
      await dependencies.finalizeOperationalJob({
        jobId: job.id,
        allocationIds,
        counters,
        completedAt: new Date(),
      });

      return {
        dryRun: false,
        executed: true,
        operationalJobId: job.id,
        shopifyOrderGid,
        ...counters,
        allocations,
      };
    },
  };
}
