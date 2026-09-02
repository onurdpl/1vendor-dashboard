import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CustomerCancellationStatus, OperationalJobStatus } from '@prisma/client';
import {
  ACTIVE_CUSTOMER_CANCELLATION_HOLD_ITEM_STATUSES,
  ACTIVE_CUSTOMER_CANCELLATION_REQUEST_STATUSES,
  isPendingCustomerCancellationHoldState,
} from '../src/modules/orders/customer-cancellation-hold.service.js';
import { classifyCustomerCancellationException } from '../src/modules/orders/customer-cancellation-exception.service.js';

const repoRoot = resolve(import.meta.dirname, '..');

function read(path: string) {
  return readFileSync(resolve(repoRoot, path), 'utf8');
}

const newState = CustomerCancellationStatus.REFUNDED_AWAITING_ORDER_CANCEL;

assert.equal(newState, 'REFUNDED_AWAITING_ORDER_CANCEL');

assert.ok(
  ACTIVE_CUSTOMER_CANCELLATION_REQUEST_STATUSES.includes(newState),
  'parent request remains active while orderCancel is pending',
);
assert.ok(
  ACTIVE_CUSTOMER_CANCELLATION_HOLD_ITEM_STATUSES.includes(newState),
  'item keeps shipment and finance hold while orderCancel is pending',
);
assert.equal(
  isPendingCustomerCancellationHoldState({
    requestStatus: newState,
    itemStatus: newState,
  }),
  true,
  'new state must keep the allocation hold active',
);
assert.equal(
  isPendingCustomerCancellationHoldState({
    requestStatus: CustomerCancellationStatus.APPROVED,
    itemStatus: CustomerCancellationStatus.APPROVED,
  }),
  false,
  'final APPROVED still releases the hold',
);

assert.equal(
  classifyCustomerCancellationException({
    itemStatus: newState,
    attemptStatus: 'RESOLVED',
    jobStatus: OperationalJobStatus.COMPLETED,
  }),
  null,
  'normal post-refund/pre-order-cancel state is not itself an exception',
);
assert.equal(
  classifyCustomerCancellationException({
    itemStatus: newState,
    attemptStatus: 'RESOLVED',
    jobStatus: OperationalJobStatus.FAILED,
    jobRetryCount: 8,
    jobMaxRetries: 8,
  }),
  'REFUND_RETRIES_EXHAUSTED',
  'failed future OperationalJob evidence can surface from the held state',
);

const autoRefundService = read('src/modules/orders/customer-cancellation-auto-refund.service.ts');
assert.match(
  autoRefundService,
  /CustomerCancellationStatus\.REFUNDED_AWAITING_ORDER_CANCEL/,
  'auto-refund reconciliation uses the new post-refund state',
);
assert.match(
  autoRefundService,
  /item\.status === CustomerCancellationStatus\.REFUNDED_AWAITING_ORDER_CANCEL\) return true;/,
  'processor skips already-refunded awaiting-cancel items instead of creating another refund',
);
assert.match(
  autoRefundService,
  /shippingMaximumPreview = await input\.shopifyAdminService\.previewSuggestedRefund\(\{\s*shopifyOrderId: sourceOrderId,\s*refundLineItems: \[\],\s*refundShipping: false,/s,
  'customer cancellation reads Shopify shipping.maximumRefundableSet before refund submission',
);
assert.match(
  autoRefundService,
  /shippingAmount: isPositiveMoneyAmount\(shippingRefundAmount\) \? shippingRefundAmount : null/,
  'customer cancellation includes shipping in trusted combined preview only when Shopify reports a positive refundable amount',
);
assert.match(
  autoRefundService,
  /intendedShippingRefundAmount: context\.shippingRefundAmount/,
  'intended customer-cancellation shipping refund amount is persisted',
);
assert.match(
  autoRefundService,
  /refundShipping: isPositiveMoneyAmount\(context\.shippingRefundAmount\)/,
  'attempt marks shipping refund only when canonical refundable shipping is positive',
);
assert.match(
  autoRefundService,
  /shipping: shippingRefundAmount && isPositiveMoneyAmount\(shippingRefundAmount\)\s*\?\s*\{ amount: shippingRefundAmount \}\s*:\s*null/,
  'refundCreate shipping input is included only for positive canonical shipping',
);
assert.match(
  autoRefundService,
  /refundedShippingAmount !== intendedShippingRefundAmount/,
  'canonical reconciliation requires intended shipping refund evidence before orderCancel',
);
assert.doesNotMatch(
  autoRefundService,
  /data: \{ status: CustomerCancellationStatus\.APPROVED, resolvedQuantity: current\.requestedQuantity \}/,
  'canonical refund reconciliation must not transition directly to APPROVED',
);

const refundIngestionService = read('src/modules/shopify/refund-ingestion.service.ts');
assert.match(
  refundIngestionService,
  /hasPositiveIntendedCustomerCancellationShippingRefund/,
  'refund webhook ingestion does not complete shipping-scoped customer cancellations without canonical processor verification',
);
assert.doesNotMatch(
  refundIngestionService,
  /data: \{ status: CustomerCancellationStatus\.APPROVED, resolvedQuantity: item\.requestedQuantity \}/,
  'refund webhook ingestion must not transition customer cancellations directly to APPROVED',
);

const shopifyAdminService = read('src/modules/shopify/shopify-admin.service.ts');
assert.match(
  shopifyAdminService,
  /orderCancel\(\s*orderId: \$orderId\s*notifyCustomer: \$notifyCustomer\s*refundMethod: \$refundMethod\s*restock: \$restock\s*reason: \$reason/s,
  'Shopify orderCancel uses the supported refundMethod/restock mutation shape',
);
assert.match(
  shopifyAdminService,
  /refundMethod:\s*\{\s*originalPaymentMethodsRefund: false,\s*\}/,
  'orderCancel does not create another original-payment refund',
);
assert.match(shopifyAdminService, /restock: false,/, 'orderCancel uses restock=false');
assert.doesNotMatch(
  shopifyAdminService,
  /orderCancel[\s\S]*\brefund:\s*\{/,
  'orderCancel must not use the deprecated refund argument or invented refund shape',
);

const orderCancelService = read('src/modules/orders/customer-cancellation-order-cancel.service.ts');
assert.match(
  orderCancelService,
  /item\.status !== CustomerCancellationStatus\.REFUNDED_AWAITING_ORDER_CANCEL/,
  'orderCancel is only started from the post-refund/pre-cancel state',
);
assert.match(
  orderCancelService,
  /if \(!after\.cancelledAt\)/,
  'final APPROVED requires canonical Shopify cancellation evidence',
);
assert.match(
  orderCancelService,
  /readPersistedOrderCancelJobId/,
  'accepted orderCancel Job ID is persisted for idempotent recovery',
);
assert.match(
  autoRefundService,
  /processCustomerCancellationOrderCancel/,
  'auto-refund processor continues from canonical refund verification into orderCancel',
);

const schema = read('prisma/schema.prisma');
assert.match(schema, /REFUNDED_AWAITING_ORDER_CANCEL/, 'Prisma schema persists the new state');

const migration = read('prisma/migrations/20260902120000_add_customer_cancellation_refunded_awaiting_order_cancel/migration.sql');
assert.match(migration, /ADD VALUE 'REFUNDED_AWAITING_ORDER_CANCEL'/, 'migration adds exactly the persisted state');

const envConfig = read('src/config/env.ts');
assert.match(
  envConfig,
  /CUSTOMER_CANCELLATION_AUTO_REFUND_ENABLED: parseBoolean\(\s*process\.env\.CUSTOMER_CANCELLATION_AUTO_REFUND_ENABLED,\s*false/s,
  'production auto-refund flag remains default-off',
);

console.log('customer cancellation lifecycle state checks passed');
