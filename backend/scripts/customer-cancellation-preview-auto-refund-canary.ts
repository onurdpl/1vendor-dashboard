import { CustomerCancellationStatus, OperationalJobStatus, OperationalJobType } from '@prisma/client';
import { loadEnv } from '../src/config/env.js';
import { prisma } from '../src/db/prisma.js';
import { createShopifyAdminService } from '../src/modules/shopify/shopify-admin.service.js';
import {
  classifyCustomerCancellationAutoRefundEligibility,
  processCustomerCancellationAutoRefundItem,
} from '../src/modules/orders/customer-cancellation-auto-refund.service.js';

const EXPECTED_DATABASE = 'vendor_dashboard_customer_cancellation_preview';
const EXPECTED_SHOP = 'sporgym-cancellation-dev.myshopify.com';

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

function orderIdTail(value: string) {
  return value.trim().split('/').at(-1) ?? value.trim();
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
        include: {
          lineItems: true,
          allocations: {
            include: {
              lineItems: true,
              fulfillment: true,
              shipmentExecutions: true,
              returnRecords: true,
              refundRecords: { include: { lineItems: true } },
              customerCancellationRequestItems: true,
            },
          },
        },
      },
      items: {
        include: {
          shopifyOrderLineItem: true,
          vendorAllocation: {
            include: {
              lineItems: true,
              fulfillment: true,
              shipmentExecutions: true,
              returnRecords: true,
              refundRecords: { include: { lineItems: true } },
            },
          },
          operationalJob: true,
          outboundShopifyRefundAttempt: true,
        },
      },
    },
  });
  if (!request) fail('Request does not exist in the guarded preview database.');

  const expectedTail = orderIdTail(args.shopifyOrderId);
  if (
    orderIdTail(request.order.sourceShopifyOrderId) !== expectedTail ||
    request.order.sourceShopifyOrderNumber.replace(/^#/, '') !== args.orderNumber
  ) {
    fail('Request does not belong to the expected dev canary order.');
  }
  if (request.shopDomain !== EXPECTED_SHOP) {
    fail('Request shop domain does not match the expected dev store.');
  }
  if (request.status !== CustomerCancellationStatus.PENDING) {
    fail(`Request status must be PENDING before this canary. Found ${request.status}.`);
  }
  if (request.items.length !== 1) {
    fail('This guarded canary runner only accepts exactly one request item.');
  }

  const item = request.items[0]!;
  if (item.status !== CustomerCancellationStatus.PENDING) {
    fail(`Request item status must be PENDING before this canary. Found ${item.status}.`);
  }
  if (item.requestedQuantity !== 2) {
    fail(`Request item quantity must be 2 for #1002. Found ${item.requestedQuantity}.`);
  }
  if (item.vendorAllocation.allocationStatus !== 'ACTIVE') {
    fail('Vendor allocation must remain ACTIVE before this canary.');
  }
  if (item.vendorAllocation.fulfillment || item.vendorAllocation.shipmentExecutions.length > 0) {
    fail('Shipment or fulfillment evidence exists; refusing auto-refund canary.');
  }
  if (item.vendorAllocation.returnRecords.length > 0 || item.vendorAllocation.refundRecords.length > 0) {
    fail('Return or refund evidence exists; refusing auto-refund canary.');
  }
  if (item.outboundShopifyRefundAttempt) {
    fail('Outbound Shopify refund attempt already exists; refusing duplicate canary.');
  }
  if (!item.operationalJob || item.operationalJob.jobType !== OperationalJobType.REFUND_SYNC) {
    fail('Expected one REFUND_SYNC OperationalJob for the request item.');
  }
  if (item.operationalJob.status !== OperationalJobStatus.PENDING) {
    fail(`OperationalJob must be PENDING before this canary. Found ${item.operationalJob.status}.`);
  }

  const unrelatedJobs = await prisma.operationalJob.count({
    where: {
      jobType: OperationalJobType.REFUND_SYNC,
      customerCancellationRequestItemId: { not: item.id },
      status: {
        in: [
          OperationalJobStatus.PENDING,
          OperationalJobStatus.PROCESSING,
          OperationalJobStatus.RETRY_SCHEDULED,
        ],
      },
    },
  });

  return { request, item, unrelatedJobs };
}

async function main() {
  const args = parseArgs();
  const env = loadEnv();
  if (env.SHOPIFY_SHOP_DOMAIN !== EXPECTED_SHOP) {
    fail('SHOPIFY_SHOP_DOMAIN must match the dedicated cancellation development store.');
  }
  if (env.SHIPPING_EXECUTION_ENABLED) {
    fail('SHIPPING_EXECUTION_ENABLED must remain false for this canary.');
  }
  if (args.execute && !env.CUSTOMER_CANCELLATION_AUTO_REFUND_ENABLED) {
    fail('--execute requires an in-process CUSTOMER_CANCELLATION_AUTO_REFUND_ENABLED=true override.');
  }
  if (!args.execute && env.CUSTOMER_CANCELLATION_AUTO_REFUND_ENABLED) {
    fail('Dry-run must not run with CUSTOMER_CANCELLATION_AUTO_REFUND_ENABLED=true.');
  }

  await assertRuntimeDatabase();
  const { request, item, unrelatedJobs } = await loadRequest(args);
  const shopifyAdminService = createShopifyAdminService(env);
  const eligibility = await classifyCustomerCancellationAutoRefundEligibility({
    itemId: item.id,
    shopifyAdminService,
  });
  if (eligibility.classification !== 'CLEAN' || !eligibility.context) {
    fail(`Request is not clean for auto-refund canary: ${eligibility.classification} ${eligibility.reason}`);
  }

  const suggestedRefund = eligibility.context.preview.suggestedRefund;
  const linePreview = eligibility.context.preview.refundLineItemsPreview[0];

  const summary = {
    mode: args.execute ? 'execute' : 'dry-run',
    request: request.id,
    order: `#${request.order.sourceShopifyOrderNumber.replace(/^#/, '')}`,
    shopifyOrderId: request.order.sourceShopifyOrderId,
    targetShop: env.SHOPIFY_SHOP_DOMAIN,
    quantity: item.requestedQuantity,
    productRefund: suggestedRefund?.subtotalAmount ?? null,
    shippingRefund: suggestedRefund?.shippingAmount ?? '0.00',
    total: suggestedRefund?.totalRefundAmount ?? null,
    currency: suggestedRefund?.currencyCode ?? suggestedRefund?.shippingCurrencyCode ?? request.order.currency,
    lineItemId: linePreview?.lineItemId ?? item.shopifyOrderLineItem.sourceLineItemId,
    unrelatedRefundSyncCandidatesNotProcessed: unrelatedJobs,
    shopifyMutation: args.execute ? 'refundCreate' : 'NO',
  };

  console.log(JSON.stringify(summary, null, 2));
  if (!args.execute) {
    console.log('DRY_RUN_ONLY');
    return;
  }

  const result = await processCustomerCancellationAutoRefundItem({
    itemId: item.id,
    shopifyAdminService,
  });
  const after = await prisma.customerCancellationRequest.findUnique({
    where: { id: args.requestId },
    include: {
      items: {
        include: {
          operationalJob: true,
          outboundShopifyRefundAttempt: true,
        },
      },
    },
  });
  console.log(
    JSON.stringify(
      {
        result,
        requestStatus: after?.status ?? null,
        itemStatus: after?.items[0]?.status ?? null,
        jobStatus: after?.items[0]?.operationalJob?.status ?? null,
        refundAttemptStatus: after?.items[0]?.outboundShopifyRefundAttempt?.status ?? null,
        shopifyRefundIdPresent: Boolean(after?.items[0]?.outboundShopifyRefundAttempt?.shopifyRefundId),
        shopifyMutation: 'refundCreate',
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
