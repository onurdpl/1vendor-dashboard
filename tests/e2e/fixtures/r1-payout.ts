import { PrismaClient } from '../../../backend/node_modules/@prisma/client/index.js';
import { upsertSeedUser } from '../../../backend/prisma/seed-user-utils.js';

const databaseUrl = process.env.DATABASE_URL?.trim();
const target = databaseUrl ? new URL(databaseUrl) : null;
if (process.env.BROWSER_SMOKE_ALLOW_LOCAL_DB !== '1' || !target ||
    target.hostname !== '127.0.0.1' || !target.port ||
    !/^\/vendor_dashboard_browser_smoke_r1_[0-9]+$/.test(target.pathname)) {
  throw new Error('R1 browser fixture requires a dedicated disposable local database.');
}
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = databaseUrl;
const { normalizeRefundEvidence } = await import('../../../backend/src/modules/finance/refund-evidence-normalizer.service.js');
const { createSettlementRefundAdjustmentForRefundLedger } = await import('../../../backend/src/modules/finance/settlement-refund-adjustment.service.js');
const { recordVerifiedDeliveredObservation } = await import('../../../backend/src/modules/shipping/allocation-delivered-observation.service.js');
const { createDraftApproval, approveSettlementApproval } = await import('../../../backend/src/modules/finance/settlement-approval.service.js');
const { POST_APPROVAL_REFUND_ADJUSTMENT_REQUIRED_REASON } = await import('../../../backend/src/modules/finance/refund-offset.service.js');
const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

async function createCandidate(name: string, capacityMinor: number, refundMinor: number, adminId: string) {
  const vendorId = `r1-browser-${name}`;
  const historicalOrderId = `${vendorId}-historical-order`;
  const historicalAllocationId = `${vendorId}-historical-allocation`;
  const historicalSaleId = `${vendorId}-historical-sale`;
  const orderGid = `gid://shopify/Order/${historicalOrderId}`;
  const refundRecordId = `${vendorId}-refund-record`;
  const refundLedgerId = `${vendorId}-refund-ledger`;
  const refundGid = `gid://shopify/Refund/${refundRecordId}`;
  await db.vendor.create({ data: { id: vendorId, name: `R1 Browser ${name}` } });
  await db.shopifyOrder.create({ data: { id: historicalOrderId, sourceShopifyOrderId: orderGid,
    sourceShopifyOrderNumber: `#${historicalOrderId}`, currency: 'TRY' } });
  await db.vendorAllocation.create({ data: { id: historicalAllocationId,
    sourceShopifyOrderId: historicalOrderId, sourceShopifyOrderNumber: `#${historicalOrderId}`,
    originalVendorId: vendorId, assignedVendorId: vendorId } });
  await db.financeLedgerEntry.create({ data: { id: historicalSaleId,
    vendorAllocationId: historicalAllocationId, vendorId, entryType: 'sale',
    amount: (Math.max(refundMinor, 1000) / 100).toFixed(2),
    commissionPercentSnapshot: 0, commissionVatPercentSnapshot: 20 } });
  await db.settlementApproval.create({ data: { id: `${vendorId}-historical-approval`,
    vendorId, currency: 'TRY', status: 'APPROVED', approvedAt: new Date('2026-01-01T00:00:00Z'),
    grossSalesMinor: Math.max(refundMinor, 1000), refundTotalMinor: 0, commissionMinor: 0,
    commissionVatMinor: 0, netPayableMinor: Math.max(refundMinor, 1000), sourceSnapshotJson: {},
    lines: { create: [{ id: `${vendorId}-historical-line`, financeLedgerEntryId: historicalSaleId,
      lineType: 'SALE', amountMinor: Math.max(refundMinor, 1000), commissionMinor: 0,
      commissionVatMinor: 0, payableImpactMinor: Math.max(refundMinor, 1000), sourceSnapshotJson: {} }] },
  } });

  const payableOrderId = `${vendorId}-payable-order`;
  const payableAllocationId = `${vendorId}-payable-allocation`;
  const payableSaleId = `${vendorId}-payable-sale`;
  const executionId = `${vendorId}-shipment-execution`;
  const sourceReference = `${vendorId}-shipment`;
  await db.shopifyOrder.create({ data: { id: payableOrderId,
    sourceShopifyOrderId: `gid://shopify/Order/${payableOrderId}`,
    sourceShopifyOrderNumber: `#${payableOrderId}`, currency: 'TRY' } });
  await db.vendorAllocation.create({ data: { id: payableAllocationId,
    sourceShopifyOrderId: payableOrderId, sourceShopifyOrderNumber: `#${payableOrderId}`,
    originalVendorId: vendorId, assignedVendorId: vendorId, outboundMethodSnapshot: 'KARGONOMI',
    fulfillmentStatus: 'Fulfilled', shippingStatus: 'Delivered' } });
  await db.shipmentExecution.create({ data: { id: executionId, allocationId: payableAllocationId,
    vendorId, provider: 'KARGONOMI', providerShipmentId: sourceReference,
    shipmentStatus: 'DELIVERED', requestSnapshot: {} } });
  const observation = await recordVerifiedDeliveredObservation({ allocationId: payableAllocationId,
    source: { method: 'KARGONOMI', shipmentExecutionId: executionId, sourceReference },
  }, db as never);
  await db.fulfillment.create({ data: { id: `${vendorId}-fulfillment`,
    vendorAllocationId: payableAllocationId, fulfillmentStatus: 'Fulfilled',
    fulfilledAt: new Date(), shipmentUpdatedAt: new Date() } });
  await db.financeLedgerEntry.create({ data: { id: payableSaleId,
    vendorAllocationId: payableAllocationId, vendorId, entryType: 'sale',
    amount: (capacityMinor / 100).toFixed(2), settlementDelayDaysSnapshot: 0,
    commissionPercentSnapshot: 0, commissionVatPercentSnapshot: 20,
    settlementStatus: 'PENDING', payoutStatus: 'PENDING' } });
  while (Date.now() <= observation.firstObservedDeliveredAt.getTime()) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  const draft = await createDraftApproval({ vendorId, candidateScope: 'selected_allocations',
    selectedAllocationIds: [payableAllocationId], asOfDate: new Date() });
  if (draft.lines.length !== 1 || draft.lines[0]?.financeLedgerEntryId !== payableSaleId) {
    throw new Error('R1 browser payable SALE is not canonically eligible.');
  }
  await approveSettlementApproval(draft.id, adminId);

  await db.refundRecord.create({ data: { id: refundRecordId, vendorAllocationId: historicalAllocationId,
    sourceShopifyOrderId: orderGid, sourceShopifyOrderNumber: `#${historicalOrderId}`,
    sourceShopifyRefundId: refundGid, amount: (refundMinor / 100).toFixed(2), status: 'processed' } });
  await db.financeLedgerEntry.create({ data: { id: refundLedgerId,
    vendorAllocationId: historicalAllocationId, vendorId, entryType: 'refund',
    amount: (refundMinor / 100).toFixed(2), commissionPercentSnapshot: 0,
    commissionVatPercentSnapshot: 20, payoutStatus: 'HOLD', settlementStatus: 'PARTIALLY_REFUNDED',
    settlementHoldReason: POST_APPROVAL_REFUND_ADJUSTMENT_REQUIRED_REASON } });
  const accepted = normalizeRefundEvidence({ sourceShopifyRefundId: refundGid,
    sourceShopifyOrderId: orderGid, vendorAllocationId: historicalAllocationId,
    monetaryClassification: 'MONETARY_REFUND', refundTotalAmount: (refundMinor / 100).toFixed(2),
    currency: 'TRY', transactions: [{ transactionGid: `gid://shopify/OrderTransaction/${refundRecordId}`,
      kind: 'REFUND', status: 'SUCCESS', amount: (refundMinor / 100).toFixed(2), currency: 'TRY' }],
    refundLines: [{ sourceLineItemId: `gid://shopify/LineItem/${refundRecordId}`, quantity: 1,
      subtotalAmount: (refundMinor / 100).toFixed(2), currency: 'TRY' }],
    historicalEconomicVendorId: vendorId, historicalSaleFinanceLedgerEntryId: historicalSaleId,
    supersededSaleLedgerIds: [] });
  await db.refundEvidenceSnapshot.create({ data: { id: `${vendorId}-refund-snapshot`,
    sourceShopifyRefundId: refundGid, sourceShopifyOrderId: orderGid,
    vendorAllocationId: historicalAllocationId, refundRecordId,
    refundFinanceLedgerEntryId: refundLedgerId, historicalEconomicVendorId: vendorId,
    historicalSaleFinanceLedgerEntryId: historicalSaleId,
    monetaryClassification: 'MONETARY_REFUND', refundTotalAmount: (refundMinor / 100).toFixed(2),
    currency: 'TRY', normalizedTransactionsJson: accepted.normalizedTransactionsJson,
    normalizedRefundLinesJson: accepted.normalizedRefundLinesJson,
    normalizedOwnershipJson: accepted.normalizedOwnershipJson,
    normalizedEvidenceJson: accepted.normalizedEvidenceJson, supersededSaleLedgerIdsJson: [],
    evidenceHash: accepted.evidenceHash, hashAlgorithm: accepted.hashAlgorithm,
    evidenceVersion: accepted.evidenceVersion, normalizationVersion: accepted.normalizationVersion,
    evidenceSource: 'r1_browser_disposable_fixture', capturedAt: new Date() } });
  const adjustment = await createSettlementRefundAdjustmentForRefundLedger(db, {
    refundFinanceLedgerEntryId: refundLedgerId, refundRecordId, createdBy: adminId,
  });
  if (!adjustment || adjustment.originalAmountMinor !== refundMinor) {
    throw new Error('R1 browser exact refund obligation was not established.');
  }
  return { vendorId, payableSaleId, adjustmentId: adjustment.id };
}

try {
  await db.$connect();
  const [identity] = await db.$queryRaw<Array<{ version: string; name: string; owner: string; port: number }>>`
    SELECT current_setting('server_version_num') AS version, current_database() AS name,
      current_user AS owner, inet_server_port() AS port`;
  if (Number(identity.version) < 180000 || Number(identity.version) >= 190000 ||
      identity.name !== target.pathname.slice(1) || identity.owner !== target.username ||
      identity.port !== Number(target.port) || await db.user.count() || await db.vendor.count()) {
    throw new Error('R1 browser fixture requires an empty, owned PostgreSQL 18 database.');
  }
  await db.vendor.create({ data: { id: 'r1-browser-seed-vendor', name: 'R1 Browser Seed Vendor' } });
  const admin = await upsertSeedUser(db, { email: 'admin@demo.com', name: 'R1 Browser Admin',
    role: 'ADMIN', vendorIds: ['r1-browser-seed-vendor'] });
  const positive = await createCandidate('positive', 100000, 20000, admin.id);
  const cashless = await createCandidate('cashless', 440, 880, admin.id);
  const cancellation = await createCandidate('cancel', 100000, 20000, admin.id);
  await db.userVendorAccess.createMany({ data: [positive, cashless, cancellation].map(({ vendorId }) =>
    ({ userId: admin.id, vendorId })), skipDuplicates: true });
  await upsertSeedUser(db, { email: 'vendor@demo.com', name: 'R1 Browser Vendor',
    role: 'VENDOR', vendorIds: [positive.vendorId] });
  console.log(JSON.stringify({ positive, cashless, cancellation }));
} finally {
  await db.$disconnect();
  const { prisma } = await import('../../../backend/src/db/prisma.js');
  await prisma.$disconnect();
}
