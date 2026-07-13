import {
  OperationalJobStatus,
  OperationalJobType,
  OperationalSignalSeverity,
  OperationalSignalSourceArea,
  OperationalSignalStatus,
  Prisma,
} from '@prisma/client';
import type { AppEnv } from '../../config/env.js';
import { prisma } from '../../db/prisma.js';
import { upsertSaleLedgerForAllocation } from '../finance/sale-ledger.service.js';
import { canonicalRefundToWebhookPayload } from '../reconciliation/canonical-refund-reconciliation.service.js';
import { applyCanonicalReturnsInTransaction } from '../reconciliation/canonical-return-reconciliation.service.js';
import { applyCanonicalCancellationInTransaction } from '../reconciliation/canonical-cancellation-reconciliation.service.js';
import { ingestShopifyRefundWebhook } from './refund-ingestion.service.js';
import {
  CanonicalShopifySnapshotParseError,
  createShopifyAdminService,
} from './shopify-admin.service.js';
import type {
  CanonicalShopifyOrderSnapshot,
  CanonicalShopifyRefundSnapshot,
  CanonicalShopifyReturnSnapshot,
} from './shopify-admin.types.js';

const REPAIR_OPERATION = 'shopify_current_state_order_repair';
const REPAIR_SIGNAL_RULE_KEY = 'shopify_current_state_order_repair';
const REPAIR_SIGNAL_ID_PREFIX = 'signal-shopify-current-state-order-repair';

type RepairRecordState = 'Created' | 'Existing';

export type CurrentStateOrderRepairSummary = {
  shopifyOrder: RepairRecordState;
  allocation: RepairRecordState;
  finance: RepairRecordState;
  cancellationApplied: boolean;
  refundApplied: boolean;
  returnApplied: boolean;
  warnings: string[];
  skipped: boolean;
};

export type CurrentStateOrderRepairResult = {
  ok: boolean;
  orderIdentifier: string;
  shopifyOrderId: string;
  shopifyOrderNumber: string;
  repairSource: 'shopify_admin_current_state';
  repairTimestamp: string;
  dryRun: boolean;
  executed: boolean;
  summary: CurrentStateOrderRepairSummary;
};

export type CurrentStateOrderRepairActor = {
  userId: string;
  email: string;
};

type CanonicalRepairBundle = {
  order: CanonicalShopifyOrderSnapshot;
  refunds: CanonicalShopifyRefundSnapshot[];
  returns: CanonicalShopifyReturnSnapshot[];
};

type CanonicalRepairSource = Pick<
  ReturnType<typeof createShopifyAdminService>,
  'fetchCanonicalOrderSnapshot' | 'fetchCanonicalRefundsForOrder' | 'fetchCanonicalReturnsForOrder'
>;

type LocalRepairState = {
  orderExists: boolean;
  allocationExists: boolean;
  financeExists: boolean;
  cancelledAt: string | null;
  existingRefundIds: string[];
  existingReturnIds: string[];
  duplicateOrderIdsForNumber: string[];
  vendorIds: string[];
  activeFinancialProfileVendorIds: string[];
};

export type CurrentStateOrderRepairDependencies = {
  fetchCanonicalBundle(orderIdentifier: string): Promise<CanonicalRepairBundle | null>;
  inspectLocalState(bundle: CanonicalRepairBundle): Promise<LocalRepairState>;
  executeRepair(input: {
    bundle: CanonicalRepairBundle;
    actor: CurrentStateOrderRepairActor;
    requestedIdentifier: string;
    inspectedState: LocalRepairState;
    repairTimestamp: Date;
  }): Promise<CurrentStateOrderRepairSummary>;
  recordFailure(input: {
    bundle: CanonicalRepairBundle;
    actor: CurrentStateOrderRepairActor;
    requestedIdentifier: string;
    repairTimestamp: Date;
    errorMessage: string;
  }): Promise<void>;
};

export class CurrentStateOrderRepairError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'CurrentStateOrderRepairError';
  }
}

function normalizeIdentifier(value: string) {
  const normalized = value.trim();
  if (/^\d+$/.test(normalized)) {
    return normalized;
  }
  if (/^#\d+$/.test(normalized)) {
    return normalized;
  }
  throw new CurrentStateOrderRepairError(
    'invalid_order_identifier',
    'Provide exactly one Shopify order ID or order number such as #1105.',
    400,
  );
}

function normalizeVendorId(value: string | undefined) {
  return value?.trim().toLowerCase() || null;
}

function toJson(value: Record<string, unknown>): Prisma.InputJsonObject {
  return value as Prisma.InputJsonObject;
}

function safeErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : 'Current-state order repair failed.';
  return message.replace(/[\r\n]+/g, ' ').slice(0, 500);
}

function canonicalFetchError(
  error: unknown,
  code: 'canonical_order_fetch_failed' | 'canonical_refund_fetch_failed' | 'canonical_return_fetch_failed',
  message: string,
) {
  if (error instanceof CurrentStateOrderRepairError) {
    return error;
  }
  if (error instanceof CanonicalShopifySnapshotParseError) {
    return new CurrentStateOrderRepairError(
      'canonical_snapshot_parse_failed',
      'Shopify canonical current-state response could not be parsed.',
      502,
    );
  }
  return new CurrentStateOrderRepairError(code, message, 502);
}

async function fetchCanonicalRepairBundle(
  shopifyAdmin: CanonicalRepairSource,
  orderId: string,
): Promise<CanonicalRepairBundle | null> {
  const [orderResult, refundResult, returnResult] = await Promise.allSettled([
    shopifyAdmin.fetchCanonicalOrderSnapshot(orderId),
    shopifyAdmin.fetchCanonicalRefundsForOrder(orderId),
    shopifyAdmin.fetchCanonicalReturnsForOrder(orderId),
  ]);

  if (orderResult.status === 'rejected') {
    throw canonicalFetchError(
      orderResult.reason,
      'canonical_order_fetch_failed',
      'Shopify canonical order state could not be fetched.',
    );
  }
  if (refundResult.status === 'rejected') {
    throw canonicalFetchError(
      refundResult.reason,
      'canonical_refund_fetch_failed',
      'Shopify canonical refund state could not be fetched.',
    );
  }
  if (returnResult.status === 'rejected') {
    throw canonicalFetchError(
      returnResult.reason,
      'canonical_return_fetch_failed',
      'Shopify canonical return state could not be fetched.',
    );
  }

  const order = orderResult.value;
  if (!order) {
    return null;
  }
  if (!refundResult.value) {
    throw new CurrentStateOrderRepairError(
      'canonical_refund_fetch_failed',
      'Shopify canonical refund state could not be fetched.',
      502,
    );
  }
  if (!returnResult.value) {
    throw new CurrentStateOrderRepairError(
      'canonical_return_fetch_failed',
      'Shopify canonical return state could not be fetched.',
      502,
    );
  }

  return {
    order,
    refunds: refundResult.value.refunds,
    returns: returnResult.value.returns,
  };
}

function validateCanonicalBundle(bundle: CanonicalRepairBundle, state: LocalRepairState) {
  const problems: string[] = [];
  const order = bundle.order;
  if (!order.sourceShopifyOrderId || !order.sourceShopifyOrderNumber || !order.shopifyCreatedAt) {
    problems.push('Shopify order identity or creation timestamp is incomplete.');
  } else if (!Number.isFinite(Date.parse(order.shopifyCreatedAt))) {
    problems.push('Shopify order creation timestamp is invalid.');
  }
  if (order.cancelledAt && !Number.isFinite(Date.parse(order.cancelledAt))) {
    problems.push('Shopify order cancellation timestamp is invalid.');
  }
  if (order.lineItems.length === 0) {
    problems.push('Shopify order has no line items.');
  }
  if (!order.sellerInfo || Object.keys(order.sellerInfo).length === 0) {
    problems.push('Shopify seller_info is missing or invalid.');
  }

  const mappedVendorIds = new Set<string>();
  const lineItemIds = new Set<string>();
  for (const lineItem of order.lineItems) {
    if (!lineItem.sourceLineItemId || lineItemIds.has(lineItem.sourceLineItemId)) {
      problems.push(`Shopify line item ${lineItem.sourceLineItemId || 'unknown'} has a missing or duplicate identifier.`);
    }
    lineItemIds.add(lineItem.sourceLineItemId);
    if (!lineItem.sku) {
      problems.push(`Shopify line item ${lineItem.sourceLineItemId || 'unknown'} is missing SKU.`);
      continue;
    }
    if (!Number.isFinite(lineItem.quantity) || lineItem.quantity <= 0) {
      problems.push(`Shopify line item ${lineItem.sourceLineItemId} has an invalid quantity.`);
    }
    const vendorId = normalizeVendorId(order.sellerInfo?.[lineItem.sku]);
    if (!vendorId) {
      problems.push(`No seller_info mapping exists for SKU ${lineItem.sku}.`);
      continue;
    }
    mappedVendorIds.add(vendorId);
  }

  const knownVendors = new Set(state.vendorIds);
  const activeProfiles = new Set(state.activeFinancialProfileVendorIds);
  for (const vendorId of mappedVendorIds) {
    if (!knownVendors.has(vendorId)) {
      problems.push(`seller_info maps to unknown vendor ${vendorId}.`);
    } else if (!activeProfiles.has(vendorId)) {
      problems.push(`Vendor ${vendorId} does not have an active financial profile.`);
    }
  }

  const duplicateIds = state.duplicateOrderIdsForNumber.filter((id) => id !== order.sourceShopifyOrderId);
  if (duplicateIds.length > 0) {
    problems.push('Another local Shopify order already uses this order number.');
  }

  for (const refund of bundle.refunds) {
    if (!refund.sourceShopifyRefundId || refund.refundLineItems.length === 0) {
      problems.push(`Canonical refund ${refund.sourceShopifyRefundId || 'unknown'} is incomplete.`);
    }
    for (const lineItem of refund.refundLineItems) {
      if (!lineItem.sourceLineItemId || !lineItemIds.has(lineItem.sourceLineItemId) || !lineItem.sku) {
        problems.push(`Canonical refund line ${lineItem.sourceRefundLineItemId} cannot be mapped to an order SKU.`);
      }
    }
  }

  for (const returnRecord of bundle.returns) {
    if (!returnRecord.sourceShopifyReturnId || returnRecord.returnLineItems.length === 0) {
      problems.push(`Canonical return ${returnRecord.sourceShopifyReturnId || 'unknown'} is incomplete.`);
    }
    for (const lineItem of returnRecord.returnLineItems) {
      if (!lineItem.sourceLineItemId || !lineItemIds.has(lineItem.sourceLineItemId) || !lineItem.sku) {
        problems.push(`Canonical return line ${lineItem.returnLineItemGid} cannot be mapped to an order SKU.`);
      }
    }
  }

  const hasHistoricalFulfillment = order.fulfillmentOrders.some((fulfillmentOrder) =>
    fulfillmentOrder.lineItems.some((lineItem) =>
      typeof lineItem.totalQuantity === 'number' &&
      typeof lineItem.remainingQuantity === 'number' &&
      lineItem.remainingQuantity < lineItem.totalQuantity
    )
  );
  if (hasHistoricalFulfillment && !state.orderExists) {
    problems.push('A missing order with existing fulfillment progress requires manual review before repair.');
  }

  if (problems.length > 0) {
    throw new CurrentStateOrderRepairError(
      'repair_preflight_failed',
      `Current-state repair preflight failed: ${problems.join(' ')}`,
      409,
    );
  }
}

function buildPlannedSummary(bundle: CanonicalRepairBundle, state: LocalRepairState): CurrentStateOrderRepairSummary {
  const lifecycleAlreadyCurrent =
    (!bundle.order.cancelledAt || state.cancelledAt === bundle.order.cancelledAt) &&
    bundle.refunds.every((refund) => state.existingRefundIds.includes(refund.sourceShopifyRefundId)) &&
    bundle.returns.every((returnRecord) => state.existingReturnIds.includes(returnRecord.sourceShopifyReturnId));
  return {
    shopifyOrder: state.orderExists ? 'Existing' : 'Created',
    allocation: state.allocationExists ? 'Existing' : 'Created',
    finance: state.financeExists ? 'Existing' : 'Created',
    cancellationApplied: Boolean(bundle.order.cancelledAt),
    refundApplied: bundle.refunds.length > 0,
    returnApplied: bundle.returns.length > 0,
    warnings: [],
    skipped: state.orderExists && state.allocationExists && state.financeExists && lifecycleAlreadyCurrent,
  };
}

function orderData(order: CanonicalShopifyOrderSnapshot) {
  return {
    sourceShopifyOrderNumber: order.sourceShopifyOrderNumber,
    shopifyCreatedAt: order.shopifyCreatedAt ? new Date(order.shopifyCreatedAt) : null,
    currency: order.currency,
    financialStatus: order.financialStatus,
    cancelledAt: order.cancelledAt ? new Date(order.cancelledAt) : null,
    cancelReason: order.cancelReason,
    paymentGatewayName: order.paymentGatewayName,
    taxesIncluded: order.taxesIncluded,
    orderTaxAmount: order.orderTaxAmount,
    shippingAmount: order.shippingAmount,
    discountAmount: order.discountAmount,
    totalPrice: order.totalPrice,
    orderNote: order.orderNote,
    orderTags: order.orderTags,
    customerName: order.customerName,
    customerEmail: order.customerEmail,
    customerPhone: order.customerPhone,
    billingFullName: order.billingFullName,
    billingCompany: order.billingCompany,
    billingPhone: order.billingPhone,
    billingCity: order.billingCity,
    billingDistrict: order.billingDistrict,
    billingAddress1: order.billingAddress1,
    billingAddress2: order.billingAddress2,
    billingPostcode: order.billingPostcode,
    shippingCountry: order.shippingCountry,
    shippingPostcode: order.shippingPostcode,
    shippingCity: order.shippingCity,
    shippingDistrict: order.shippingDistrict,
    shippingAddress: order.shippingAddress,
  };
}

function lineAmount(unitPrice: string | null, quantity: number) {
  const amount = Number(unitPrice ?? 0);
  return Number.isFinite(amount) ? (amount * quantity).toFixed(2) : '0.00';
}

async function applyBaseOrderInTransaction(
  tx: Prisma.TransactionClient,
  bundle: CanonicalRepairBundle,
) {
  const snapshot = bundle.order;
  const existingOrder = await tx.shopifyOrder.findUnique({
    where: { sourceShopifyOrderId: snapshot.sourceShopifyOrderId },
    include: {
      allocations: {
        include: {
          financeEntries: { where: { entryType: 'sale' }, select: { id: true } },
        },
      },
    },
  });
  const shopifyOrder = existingOrder
    ? await tx.shopifyOrder.update({
        where: { id: existingOrder.id },
        data: orderData(snapshot),
      })
    : await tx.shopifyOrder.create({
        data: {
          sourceShopifyOrderId: snapshot.sourceShopifyOrderId,
          ...orderData(snapshot),
          createdAt: snapshot.shopifyCreatedAt ? new Date(snapshot.shopifyCreatedAt) : new Date(),
        },
      });

  const shouldCreateAllocationGraph = !existingOrder || existingOrder.allocations.length === 0;
  const allocationIds = new Set(existingOrder?.allocations.map((allocation) => allocation.id) ?? []);
  const allocationsWithSaleLedger = new Set(
    existingOrder?.allocations
      .filter((allocation) => allocation.financeEntries.length > 0)
      .map((allocation) => allocation.id) ?? [],
  );
  if (shouldCreateAllocationGraph) {
    for (const lineItem of snapshot.lineItems) {
      const sku = lineItem.sku as string;
      const vendorId = normalizeVendorId(snapshot.sellerInfo?.[sku]) as string;
      const orderLineItem = await tx.shopifyOrderLineItem.upsert({
        where: {
          shopifyOrderId_sourceLineItemId: {
            shopifyOrderId: shopifyOrder.id,
            sourceLineItemId: lineItem.sourceLineItemId,
          },
        },
        update: {
          shopifyProductId: lineItem.shopifyProductId,
          sourceVariantId: lineItem.sourceVariantId,
          sku,
          title: lineItem.title,
          imageUrl: lineItem.imageUrl,
          quantity: lineItem.quantity,
          unitPrice: lineItem.unitPrice,
          unitPriceVatIncluded: lineItem.unitPriceVatIncluded,
          lineTotalVatIncluded: lineItem.lineTotalVatIncluded,
          lineTaxAmount: lineItem.lineTaxAmount,
          vatRate: lineItem.vatRate ?? '10.00',
          originalVendorId: vendorId,
        },
        create: {
          shopifyOrderId: shopifyOrder.id,
          sourceLineItemId: lineItem.sourceLineItemId,
          shopifyProductId: lineItem.shopifyProductId,
          sourceVariantId: lineItem.sourceVariantId,
          sku,
          title: lineItem.title,
          imageUrl: lineItem.imageUrl,
          quantity: lineItem.quantity,
          unitPrice: lineItem.unitPrice,
          unitPriceVatIncluded: lineItem.unitPriceVatIncluded,
          lineTotalVatIncluded: lineItem.lineTotalVatIncluded,
          lineTaxAmount: lineItem.lineTaxAmount,
          vatRate: lineItem.vatRate ?? '10.00',
          originalVendorId: vendorId,
        },
      });
      const allocationId = `alloc-${vendorId}-${snapshot.sourceShopifyOrderId}`;
      allocationIds.add(allocationId);
      const allocation = await tx.vendorAllocation.upsert({
        where: { id: allocationId },
        update: {
          sourceShopifyOrderId: shopifyOrder.id,
          sourceShopifyOrderNumber: snapshot.sourceShopifyOrderNumber,
        },
        create: {
          id: allocationId,
          sourceShopifyOrderId: shopifyOrder.id,
          sourceShopifyOrderNumber: snapshot.sourceShopifyOrderNumber,
          originalVendorId: vendorId,
          assignedVendorId: vendorId,
          allocationStatus: 'ACTIVE',
          fulfillmentStatus: 'Pending',
          shippingStatus: 'Awaiting Shipment',
        },
      });
      await tx.vendorAllocationLineItem.upsert({
        where: {
          vendorAllocationId_shopifyLineItemId: {
            vendorAllocationId: allocation.id,
            shopifyLineItemId: orderLineItem.id,
          },
        },
        update: {
          quantity: lineItem.quantity,
          lineAmount: lineAmount(lineItem.unitPrice, lineItem.quantity),
        },
        create: {
          vendorAllocationId: allocation.id,
          shopifyLineItemId: orderLineItem.id,
          quantity: lineItem.quantity,
          lineAmount: lineAmount(lineItem.unitPrice, lineItem.quantity),
        },
      });
      await tx.allocationAssignmentHistory.upsert({
        where: { id: `assignment-history-${vendorId}-${snapshot.sourceShopifyOrderId}-initial` },
        update: {
          action: 'assigned',
          fromVendorId: null,
          toVendorId: vendorId,
          reason: 'Initial seller_info allocation from canonical current-state repair',
        },
        create: {
          id: `assignment-history-${vendorId}-${snapshot.sourceShopifyOrderId}-initial`,
          vendorAllocationId: allocation.id,
          action: 'assigned',
          fromVendorId: null,
          toVendorId: vendorId,
          reason: 'Initial seller_info allocation from canonical current-state repair',
        },
      });
    }
  }

  for (const allocationId of allocationIds) {
    if (!allocationsWithSaleLedger.has(allocationId)) {
      await upsertSaleLedgerForAllocation(tx, allocationId);
    }
  }

  return {
    shopifyOrder,
    allocationIds: [...allocationIds],
    summary: {
      shopifyOrder: existingOrder ? 'Existing' : 'Created',
      allocation: existingOrder?.allocations.length ? 'Existing' : 'Created',
      finance: existingOrder?.allocations.some((allocation) => allocation.financeEntries.length > 0)
        ? 'Existing'
        : 'Created',
    } satisfies Pick<CurrentStateOrderRepairSummary, 'shopifyOrder' | 'allocation' | 'finance'>,
  };
}

async function recordRepairSignal(input: {
  tx: Prisma.TransactionClient;
  bundle: CanonicalRepairBundle;
  actor: CurrentStateOrderRepairActor;
  requestedIdentifier: string;
  repairTimestamp: Date;
  summary: CurrentStateOrderRepairSummary;
  allocationId: string | null;
  jobId: string;
}) {
  const signalId = `${REPAIR_SIGNAL_ID_PREFIX}-${input.bundle.order.sourceShopifyOrderId}`;
  const metadata = toJson({
    operation: REPAIR_OPERATION,
    repairSource: 'shopify_admin_current_state',
    repairTimestamp: input.repairTimestamp.toISOString(),
    dryRun: false,
    executed: true,
    requestedIdentifier: input.requestedIdentifier,
    sourceShopifyOrderId: input.bundle.order.sourceShopifyOrderId,
    sourceShopifyOrderNumber: input.bundle.order.sourceShopifyOrderNumber,
    actorUserId: input.actor.userId,
    actorEmail: input.actor.email,
    summary: input.summary,
  });
  const hasWarnings = input.summary.warnings.length > 0;
  await input.tx.operationalSignal.upsert({
    where: { id: signalId },
    create: {
      id: signalId,
      type: REPAIR_OPERATION,
      severity: hasWarnings ? OperationalSignalSeverity.HIGH : OperationalSignalSeverity.INFO,
      sourceArea: OperationalSignalSourceArea.RECONCILIATION,
      allocationId: input.allocationId,
      operationalJobId: input.jobId,
      title: hasWarnings ? 'Shopify current-state order repair requires review' : 'Shopify current-state order repaired',
      description: hasWarnings
        ? 'Canonical current-state repair completed with review warnings.'
        : 'Canonical current-state repair completed successfully.',
      suggestedAction: hasWarnings ? 'Review the Order State Inspector before further operations.' : 'No action required.',
      status: hasWarnings ? OperationalSignalStatus.ACTIVE : OperationalSignalStatus.RESOLVED,
      ruleKey: REPAIR_SIGNAL_RULE_KEY,
      triggeredAt: input.repairTimestamp,
      resolvedAt: hasWarnings ? null : input.repairTimestamp,
      metadata,
    },
    update: {
      severity: hasWarnings ? OperationalSignalSeverity.HIGH : OperationalSignalSeverity.INFO,
      allocationId: input.allocationId,
      operationalJobId: input.jobId,
      title: hasWarnings ? 'Shopify current-state order repair requires review' : 'Shopify current-state order repaired',
      description: hasWarnings
        ? 'Canonical current-state repair completed with review warnings.'
        : 'Canonical current-state repair completed successfully.',
      suggestedAction: hasWarnings ? 'Review the Order State Inspector before further operations.' : 'No action required.',
      status: hasWarnings ? OperationalSignalStatus.ACTIVE : OperationalSignalStatus.RESOLVED,
      triggeredAt: input.repairTimestamp,
      resolvedAt: hasWarnings ? null : input.repairTimestamp,
      metadata,
    },
  });
}

function createDefaultDependencies(env: AppEnv): CurrentStateOrderRepairDependencies {
  const shopifyAdmin = createShopifyAdminService(env);

  async function resolveOrderId(orderIdentifier: string) {
    if (/^\d+$/.test(orderIdentifier)) {
      return orderIdentifier;
    }

    const mockRaw = (env as { SHOPIFY_MOCK_CANONICAL_ORDER_SNAPSHOT?: string }).SHOPIFY_MOCK_CANONICAL_ORDER_SNAPSHOT;
    if (mockRaw) {
      const parsed = JSON.parse(mockRaw) as Record<string, CanonicalShopifyOrderSnapshot>;
      const match = Object.values(parsed).find((order) => order.sourceShopifyOrderNumber === orderIdentifier);
      return match?.sourceShopifyOrderId ?? null;
    }
    if (!env.SHOPIFY_SHOP_DOMAIN || !env.SHOPIFY_ADMIN_ACCESS_TOKEN) {
      throw new CurrentStateOrderRepairError(
        'shopify_admin_not_configured',
        'Shopify Admin API configuration is required for current-state repair.',
        503,
      );
    }
    const response = await fetch(
      `https://${env.SHOPIFY_SHOP_DOMAIN}/admin/api/${env.SHOPIFY_API_VERSION}/graphql.json`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-shopify-access-token': env.SHOPIFY_ADMIN_ACCESS_TOKEN,
        },
        body: JSON.stringify({
          query: `query RepairOrderIdByName($query: String!) { orders(first: 5, query: $query) { nodes { id legacyResourceId name } } }`,
          variables: { query: `name:${orderIdentifier}` },
        }),
      },
    );
    if (!response.ok) {
      throw new CurrentStateOrderRepairError(
        'shopify_order_lookup_failed',
        `Shopify order lookup failed with status ${response.status}.`,
        502,
      );
    }
    const json = await response.json() as {
      data?: { orders?: { nodes?: Array<{ id: string; legacyResourceId?: string | null; name?: string | null }> } };
      errors?: Array<{ message?: string }>;
    };
    if (json.errors?.length) {
      throw new CurrentStateOrderRepairError('shopify_order_lookup_failed', 'Shopify order lookup returned errors.', 502);
    }
    const exactMatches = (json.data?.orders?.nodes ?? []).filter((order) => order.name === orderIdentifier);
    if (exactMatches.length > 1) {
      throw new CurrentStateOrderRepairError('shopify_order_lookup_ambiguous', 'Shopify order number matched multiple orders.', 409);
    }
    const match = exactMatches[0];
    return match?.legacyResourceId ?? match?.id.split('/').at(-1) ?? null;
  }

  return {
    async fetchCanonicalBundle(orderIdentifier) {
      const hasMockCanonicalOrder = Boolean(
        (env as { SHOPIFY_MOCK_CANONICAL_ORDER_SNAPSHOT?: string }).SHOPIFY_MOCK_CANONICAL_ORDER_SNAPSHOT,
      );
      if (!hasMockCanonicalOrder && (!env.SHOPIFY_SHOP_DOMAIN || !env.SHOPIFY_ADMIN_ACCESS_TOKEN)) {
        throw new CurrentStateOrderRepairError(
          'shopify_admin_not_configured',
          'Shopify Admin API configuration is required for current-state repair.',
          503,
        );
      }
      const orderId = await resolveOrderId(orderIdentifier);
      if (!orderId) {
        return null;
      }
      return fetchCanonicalRepairBundle(shopifyAdmin, orderId);
    },

    async inspectLocalState(bundle) {
      const [existingOrder, duplicateOrders, vendors, profiles] = await Promise.all([
        prisma.shopifyOrder.findUnique({
          where: { sourceShopifyOrderId: bundle.order.sourceShopifyOrderId },
          include: {
            allocations: {
              include: {
                financeEntries: { where: { entryType: 'sale' }, select: { id: true } },
                returnRecords: { select: { sourceShopifyReturnId: true } },
              },
            },
            refunds: { select: { sourceShopifyRefundId: true } },
          },
        }),
        prisma.shopifyOrder.findMany({
          where: { sourceShopifyOrderNumber: bundle.order.sourceShopifyOrderNumber },
          select: { sourceShopifyOrderId: true },
        }),
        prisma.vendor.findMany({ select: { id: true } }),
        prisma.vendorFinancialProfile.findMany({ where: { active: true }, select: { vendorId: true } }),
      ]);
      return {
        orderExists: Boolean(existingOrder),
        allocationExists: Boolean(existingOrder?.allocations.length),
        financeExists: Boolean(existingOrder?.allocations.some((allocation) => allocation.financeEntries.length > 0)),
        cancelledAt: existingOrder?.cancelledAt?.toISOString() ?? null,
        existingRefundIds: existingOrder?.refunds.map((refund) => refund.sourceShopifyRefundId) ?? [],
        existingReturnIds: existingOrder?.allocations.flatMap((allocation) =>
          allocation.returnRecords
            .map((record) => record.sourceShopifyReturnId)
            .filter((returnId): returnId is string => Boolean(returnId))
        ) ?? [],
        duplicateOrderIdsForNumber: duplicateOrders.map((order) => order.sourceShopifyOrderId),
        vendorIds: vendors.map((vendor) => vendor.id),
        activeFinancialProfileVendorIds: profiles.map((profile) => profile.vendorId),
      };
    },

    async executeRepair(input) {
      return prisma.$transaction(async (tx) => {
        const base = await applyBaseOrderInTransaction(tx, input.bundle);

        for (const refund of input.bundle.refunds) {
          const result = await ingestShopifyRefundWebhook({
            payload: canonicalRefundToWebhookPayload({
              sourceShopifyOrderId: input.bundle.order.sourceShopifyOrderId,
              refund,
            }),
            transactionClient: tx,
          });
          if (!result.ok) {
            throw new Error(result.error);
          }
        }

        const orderForReturns = await tx.shopifyOrder.findUnique({
          where: { sourceShopifyOrderId: input.bundle.order.sourceShopifyOrderId },
          include: { lineItems: true },
        });
        if (!orderForReturns) {
          throw new Error('Local Shopify order disappeared during current-state repair.');
        }
        await applyCanonicalReturnsInTransaction({
          tx,
          shopifyOrder: orderForReturns,
          canonicalReturns: input.bundle.returns,
        });

        const cancellation = await applyCanonicalCancellationInTransaction({
          tx,
          canonicalOrder: input.bundle.order,
        });
        const summary: CurrentStateOrderRepairSummary = {
          ...base.summary,
          cancellationApplied: cancellation.applied,
          refundApplied: input.bundle.refunds.length > 0,
          returnApplied: input.bundle.returns.length > 0,
          warnings: cancellation.warnings,
          skipped: base.summary.shopifyOrder === 'Existing' &&
            base.summary.allocation === 'Existing' &&
            base.summary.finance === 'Existing' &&
            cancellation.ledgerIds.length === 0 &&
            (!input.bundle.order.cancelledAt || input.inspectedState.cancelledAt === input.bundle.order.cancelledAt) &&
            input.bundle.refunds.every((refund) =>
              input.inspectedState.existingRefundIds.includes(refund.sourceShopifyRefundId)) &&
            input.bundle.returns.every((returnRecord) =>
              input.inspectedState.existingReturnIds.includes(returnRecord.sourceShopifyReturnId)),
        };

        const job = await tx.operationalJob.create({
          data: {
            jobType: OperationalJobType.RECONCILIATION,
            status: OperationalJobStatus.COMPLETED,
            sourceShopifyOrderId: input.bundle.order.sourceShopifyOrderId,
            vendorAllocationId: base.allocationIds[0] ?? null,
            startedAt: input.repairTimestamp,
            completedAt: new Date(),
            payload: toJson({
              operation: REPAIR_OPERATION,
              repairSource: 'shopify_admin_current_state',
              requestedIdentifier: input.requestedIdentifier,
              dryRun: false,
              executed: true,
              actorUserId: input.actor.userId,
              actorEmail: input.actor.email,
            }),
          },
        });
        await recordRepairSignal({
          tx,
          bundle: input.bundle,
          actor: input.actor,
          requestedIdentifier: input.requestedIdentifier,
          repairTimestamp: input.repairTimestamp,
          summary,
          allocationId: base.allocationIds[0] ?? null,
          jobId: job.id,
        });
        return summary;
      }, { timeout: 30_000 });
    },

    async recordFailure(input) {
      const errorSummary = input.errorMessage.slice(0, 500);
      const job = await prisma.operationalJob.create({
        data: {
          jobType: OperationalJobType.RECONCILIATION,
          status: OperationalJobStatus.FAILED,
          sourceShopifyOrderId: input.bundle.order.sourceShopifyOrderId,
          startedAt: input.repairTimestamp,
          failedAt: new Date(),
          errorSummary,
          failureCategory: 'current_state_order_repair',
          payload: toJson({
            operation: REPAIR_OPERATION,
            repairSource: 'shopify_admin_current_state',
            requestedIdentifier: input.requestedIdentifier,
            dryRun: false,
            executed: true,
            actorUserId: input.actor.userId,
            actorEmail: input.actor.email,
          }),
        },
      });
      const signalId = `${REPAIR_SIGNAL_ID_PREFIX}-${input.bundle.order.sourceShopifyOrderId}`;
      await prisma.operationalSignal.upsert({
        where: { id: signalId },
        create: {
          id: signalId,
          type: REPAIR_OPERATION,
          severity: OperationalSignalSeverity.HIGH,
          sourceArea: OperationalSignalSourceArea.RECONCILIATION,
          operationalJobId: job.id,
          title: 'Shopify current-state order repair failed',
          description: 'The repair transaction rolled back without retaining partial commerce or finance records.',
          suggestedAction: 'Review the safe failure summary and correct the blocker before retrying this order.',
          status: OperationalSignalStatus.ACTIVE,
          ruleKey: REPAIR_SIGNAL_RULE_KEY,
          triggeredAt: input.repairTimestamp,
          metadata: toJson({
            operation: REPAIR_OPERATION,
            repairSource: 'shopify_admin_current_state',
            repairTimestamp: input.repairTimestamp.toISOString(),
            dryRun: false,
            executed: true,
            requestedIdentifier: input.requestedIdentifier,
            sourceShopifyOrderId: input.bundle.order.sourceShopifyOrderId,
            sourceShopifyOrderNumber: input.bundle.order.sourceShopifyOrderNumber,
            actorUserId: input.actor.userId,
            actorEmail: input.actor.email,
            errorSummary,
          }),
        },
        update: {
          severity: OperationalSignalSeverity.HIGH,
          operationalJobId: job.id,
          title: 'Shopify current-state order repair failed',
          description: 'The repair transaction rolled back without retaining partial commerce or finance records.',
          suggestedAction: 'Review the safe failure summary and correct the blocker before retrying this order.',
          status: OperationalSignalStatus.ACTIVE,
          resolvedAt: null,
          triggeredAt: input.repairTimestamp,
          metadata: toJson({
            operation: REPAIR_OPERATION,
            repairSource: 'shopify_admin_current_state',
            repairTimestamp: input.repairTimestamp.toISOString(),
            dryRun: false,
            executed: true,
            requestedIdentifier: input.requestedIdentifier,
            sourceShopifyOrderId: input.bundle.order.sourceShopifyOrderId,
            sourceShopifyOrderNumber: input.bundle.order.sourceShopifyOrderNumber,
            actorUserId: input.actor.userId,
            actorEmail: input.actor.email,
            errorSummary,
          }),
        },
      });
    },
  };
}

export function createCurrentStateOrderRepairService(
  env: AppEnv,
  dependencies: CurrentStateOrderRepairDependencies = createDefaultDependencies(env),
) {
  async function repair(input: {
    orderIdentifier: string;
    execute?: boolean;
    actor: CurrentStateOrderRepairActor;
  }): Promise<CurrentStateOrderRepairResult> {
    const orderIdentifier = normalizeIdentifier(input.orderIdentifier);
    let bundle: CanonicalRepairBundle | null;
    try {
      bundle = await dependencies.fetchCanonicalBundle(orderIdentifier);
    } catch (error) {
      if (error instanceof CurrentStateOrderRepairError) {
        throw error;
      }
      throw new CurrentStateOrderRepairError(
        'canonical_snapshot_parse_failed',
        'Shopify canonical current-state response could not be parsed.',
        502,
      );
    }
    if (!bundle) {
      throw new CurrentStateOrderRepairError('shopify_order_not_found', 'Shopify order was not found.', 404);
    }
    const inspectedState = await dependencies.inspectLocalState(bundle);
    validateCanonicalBundle(bundle, inspectedState);
    const repairTimestamp = new Date();
    const dryRun = input.execute !== true;
    if (dryRun) {
      return {
        ok: true,
        orderIdentifier,
        shopifyOrderId: bundle.order.sourceShopifyOrderId,
        shopifyOrderNumber: bundle.order.sourceShopifyOrderNumber,
        repairSource: 'shopify_admin_current_state',
        repairTimestamp: repairTimestamp.toISOString(),
        dryRun: true,
        executed: false,
        summary: buildPlannedSummary(bundle, inspectedState),
      };
    }

    try {
      const summary = await dependencies.executeRepair({
        bundle,
        actor: input.actor,
        requestedIdentifier: orderIdentifier,
        inspectedState,
        repairTimestamp,
      });
      return {
        ok: true,
        orderIdentifier,
        shopifyOrderId: bundle.order.sourceShopifyOrderId,
        shopifyOrderNumber: bundle.order.sourceShopifyOrderNumber,
        repairSource: 'shopify_admin_current_state',
        repairTimestamp: repairTimestamp.toISOString(),
        dryRun: false,
        executed: true,
        summary,
      };
    } catch (error) {
      const errorMessage = safeErrorMessage(error);
      await dependencies.recordFailure({
        bundle,
        actor: input.actor,
        requestedIdentifier: orderIdentifier,
        repairTimestamp,
        errorMessage,
      }).catch(() => undefined);
      throw new CurrentStateOrderRepairError(
        'repair_transaction_failed',
        `Current-state repair failed and was rolled back: ${errorMessage}`,
        409,
      );
    }
  }

  return { repair };
}

export const __currentStateOrderRepairTesting = {
  REPAIR_OPERATION,
  REPAIR_SIGNAL_RULE_KEY,
  normalizeIdentifier,
  validateCanonicalBundle,
  fetchCanonicalRepairBundle,
  applyBaseOrderInTransaction,
};
