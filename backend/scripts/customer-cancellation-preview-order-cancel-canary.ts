import { CustomerCancellationStatus } from '@prisma/client';
import { loadEnv } from '../src/config/env.js';
import { prisma } from '../src/db/prisma.js';
import { createShopifyAdminService } from '../src/modules/shopify/shopify-admin.service.js';
import { submitAndConfirmCustomerCancellationShopifyOrderCancel } from '../src/modules/orders/customer-cancellation-order-cancel.service.js';

const EXPECTED_DATABASE = 'vendor_dashboard_customer_cancellation_preview';
const EXPECTED_SHOP = 'sporgym-cancellation-dev.myshopify.com';
const EXPECTED_ORDER_NUMBER = '1002';
const EXPECTED_ORDER_GID = 'gid://shopify/Order/6661668470969';
const EXPECTED_PRODUCT_REFUND = '200.00';
const EXPECTED_SHIPPING_REFUND = '0.00';

type Args = {
  requestId: string;
  orderNumber: string;
  shopifyOrderId: string;
  execute: boolean;
};

function fail(message: string): never {
  throw new Error(message);
}

function parseArgs(argv = process.argv.slice(2)): Args {
  const args: Partial<Args> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--execute') {
      args.execute = true;
      continue;
    }
    if (arg === '--dry-run') {
      args.execute = false;
      continue;
    }
    if (arg === '--request-id') {
      args.requestId = argv[++index];
      continue;
    }
    if (arg === '--order-number') {
      args.orderNumber = argv[++index];
      continue;
    }
    if (arg === '--shopify-order-id') {
      args.shopifyOrderId = argv[++index];
      continue;
    }
    fail(`Unsupported argument: ${arg}`);
  }
  if (!args.requestId?.trim()) fail('Customer cancellation request ID is required.');
  if (!args.orderNumber?.trim()) fail('Expected order number is required.');
  if (!args.shopifyOrderId?.trim()) fail('Expected Shopify order ID is required.');
  return {
    requestId: args.requestId.trim(),
    orderNumber: args.orderNumber.trim().replace(/^#/, ''),
    shopifyOrderId: args.shopifyOrderId.trim(),
    execute: args.execute === true,
  };
}

function gidTail(value: string) {
  return value.trim().split('/').at(-1) ?? value.trim();
}

function money(value: string | null | undefined) {
  const parsed = Number(value ?? '');
  return Number.isFinite(parsed) ? parsed.toFixed(2) : null;
}

async function assertRuntimeDatabase() {
  const [database] = await prisma.$queryRaw<{ database_name: string }[]>`
    select current_database() as database_name
  `;
  if (database?.database_name !== EXPECTED_DATABASE) {
    fail(`Refusing to run outside ${EXPECTED_DATABASE}.`);
  }
}

async function loadRequest(args: Args) {
  const request = await prisma.customerCancellationRequest.findUnique({
    where: { id: args.requestId },
    include: {
      order: {
        select: {
          sourceShopifyOrderId: true,
          sourceShopifyOrderNumber: true,
        },
      },
      items: {
        include: {
          outboundShopifyRefundAttempt: true,
          operationalJob: true,
        },
      },
    },
  });
  if (!request) fail('Request does not exist in the guarded preview database.');
  if (args.orderNumber !== EXPECTED_ORDER_NUMBER || args.shopifyOrderId !== EXPECTED_ORDER_GID) {
    fail('This guarded canary only accepts the exact #1002 Shopify order arguments.');
  }
  if (
    gidTail(request.order.sourceShopifyOrderId) !== gidTail(args.shopifyOrderId) ||
    request.order.sourceShopifyOrderNumber.replace(/^#/, '') !== args.orderNumber
  ) {
    fail('Request does not belong to the expected dev canary order.');
  }
  if (request.shopDomain !== EXPECTED_SHOP) {
    fail('Request shop domain does not match the expected dev store.');
  }
  if (request.status !== CustomerCancellationStatus.APPROVED) {
    fail(`Recovery canary expects existing #1002 request to be APPROVED. Found ${request.status}.`);
  }
  if (request.items.length !== 1) {
    fail('This guarded recovery canary only accepts exactly one request item.');
  }
  const item = request.items[0]!;
  if (item.status !== CustomerCancellationStatus.APPROVED) {
    fail(`Recovery canary expects existing #1002 item to be APPROVED. Found ${item.status}.`);
  }
  return request;
}

async function canonicalSnapshot(input: {
  shopifyOrderId: string;
  shopifyAdminService: ReturnType<typeof createShopifyAdminService>;
}) {
  const [order, refunds, returns, fulfillment] = await Promise.all([
    input.shopifyAdminService.fetchCustomerCancellationOrderSnapshot(input.shopifyOrderId),
    input.shopifyAdminService.fetchCanonicalRefundsForOrder(input.shopifyOrderId),
    input.shopifyAdminService.fetchCanonicalReturnsForOrder(input.shopifyOrderId),
    input.shopifyAdminService.fetchOrderFulfillmentState(input.shopifyOrderId),
  ]);
  if (!order) fail('Canonical Shopify order snapshot is unavailable.');
  if (!refunds) fail('Canonical Shopify refund snapshot is unavailable.');
  if (!returns) fail('Canonical Shopify return snapshot is unavailable.');
  if (!fulfillment) fail('Canonical Shopify fulfillment snapshot is unavailable.');

  const refundTransactions = refunds.refunds.flatMap((refund) =>
    refund.transactions.filter((transaction) =>
      transaction.kind?.toUpperCase() === 'REFUND' &&
      transaction.status?.toUpperCase() === 'SUCCESS' &&
      Number(transaction.amount ?? '0') > 0
    ),
  );
  return {
    order,
    refunds,
    returns,
    fulfillment,
    summary: {
      cancelled: Boolean(order.cancelledAt),
      cancelReason: order.cancelReason,
      refundCount: refunds.refunds.length,
      refundTransactionCount: refundTransactions.length,
      totalRefunded: money(refunds.orderTotalRefundedAmount),
      shippingRefunded: money(refunds.orderTotalRefundedShippingAmount),
      returnCount: returns.returns.length,
      fulfillmentCount: fulfillment.fulfillments.length,
    },
  };
}

function assertPreCancelGuards(snapshot: Awaited<ReturnType<typeof canonicalSnapshot>>) {
  if (snapshot.summary.cancelled) fail('Order is already canonically cancelled; refusing pre-cancel canary.');
  if (snapshot.summary.refundCount !== 1) fail(`Expected exactly one existing Shopify refund. Found ${snapshot.summary.refundCount}.`);
  if (snapshot.summary.refundTransactionCount !== 1) {
    fail(`Expected exactly one successful REFUND transaction. Found ${snapshot.summary.refundTransactionCount}.`);
  }
  if (snapshot.summary.totalRefunded !== EXPECTED_PRODUCT_REFUND) {
    fail(`Expected total refunded ${EXPECTED_PRODUCT_REFUND} TRY. Found ${snapshot.summary.totalRefunded}.`);
  }
  if (snapshot.summary.shippingRefunded !== EXPECTED_SHIPPING_REFUND) {
    fail(`Expected shipping refunded ${EXPECTED_SHIPPING_REFUND} TRY. Found ${snapshot.summary.shippingRefunded}.`);
  }
  if (snapshot.summary.returnCount !== 0) fail(`Expected no returns. Found ${snapshot.summary.returnCount}.`);
  if (snapshot.summary.fulfillmentCount !== 0) fail(`Expected no fulfillments. Found ${snapshot.summary.fulfillmentCount}.`);
}

function assertPostCancelGuards(snapshot: Awaited<ReturnType<typeof canonicalSnapshot>>) {
  if (!snapshot.summary.cancelled) fail('Order was not canonically cancelled after orderCancel.');
  if (snapshot.summary.refundCount !== 1) fail(`Expected refund count to remain 1. Found ${snapshot.summary.refundCount}.`);
  if (snapshot.summary.refundTransactionCount !== 1) {
    fail(`Expected successful REFUND transaction count to remain 1. Found ${snapshot.summary.refundTransactionCount}.`);
  }
  if (snapshot.summary.totalRefunded !== EXPECTED_PRODUCT_REFUND) {
    fail(`Expected total refunded to remain ${EXPECTED_PRODUCT_REFUND} TRY. Found ${snapshot.summary.totalRefunded}.`);
  }
  if (snapshot.summary.shippingRefunded !== EXPECTED_SHIPPING_REFUND) {
    fail(`Expected shipping refunded to remain ${EXPECTED_SHIPPING_REFUND} TRY. Found ${snapshot.summary.shippingRefunded}.`);
  }
  if (snapshot.summary.returnCount !== 0) fail(`Expected no returns after orderCancel. Found ${snapshot.summary.returnCount}.`);
  if (snapshot.summary.fulfillmentCount !== 0) fail(`Expected no fulfillments after orderCancel. Found ${snapshot.summary.fulfillmentCount}.`);
}

async function main() {
  const args = parseArgs();
  const env = loadEnv();
  if (env.SHOPIFY_SHOP_DOMAIN !== EXPECTED_SHOP) fail('SHOPIFY_SHOP_DOMAIN must match the dedicated cancellation development store.');
  if (env.SHOPIFY_API_VERSION !== '2026-01') fail('SHOPIFY_API_VERSION must be 2026-01 for this canary.');
  if (env.SHIPPING_EXECUTION_ENABLED) fail('SHIPPING_EXECUTION_ENABLED must remain false for this canary.');
  if (env.CUSTOMER_CANCELLATION_AUTO_REFUND_ENABLED) fail('CUSTOMER_CANCELLATION_AUTO_REFUND_ENABLED must remain false for this recovery canary.');

  await assertRuntimeDatabase();
  const request = await loadRequest(args);
  const shopifyAdminService = createShopifyAdminService(env);
  const before = await canonicalSnapshot({ shopifyOrderId: args.shopifyOrderId, shopifyAdminService });
  assertPreCancelGuards(before);

  const base = {
    mode: args.execute ? 'execute' : 'dry-run',
    request: request.id,
    order: `#${request.order.sourceShopifyOrderNumber.replace(/^#/, '')}`,
    shopifyOrderId: request.order.sourceShopifyOrderId,
    targetShop: env.SHOPIFY_SHOP_DOMAIN,
    shopifyMutation: args.execute ? 'orderCancel' : 'NO',
    refundMethod: { originalPaymentMethodsRefund: false },
    restock: false,
    before: before.summary,
  };

  if (!args.execute) {
    console.log(JSON.stringify({ ...base, dryRunPassed: true }, null, 2));
    console.log('DRY_RUN_ONLY');
    return;
  }

  const result = await submitAndConfirmCustomerCancellationShopifyOrderCancel({
    sourceShopifyOrderId: args.shopifyOrderId,
    shopifyAdminService,
    timeoutMs: 45_000,
    intervalMs: 1_000,
  });
  const after = await canonicalSnapshot({ shopifyOrderId: args.shopifyOrderId, shopifyAdminService });
  assertPostCancelGuards(after);
  console.log(JSON.stringify({ ...base, result, after: after.summary }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
