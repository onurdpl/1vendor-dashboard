import { PrismaClient } from '../../../backend/node_modules/@prisma/client/index.js';
import { upsertSeedUser } from '../../../backend/prisma/seed-user-utils.js';

const databaseUrl = process.env.DATABASE_URL?.trim();
const target = databaseUrl ? new URL(databaseUrl) : null;
if (process.env.BROWSER_SMOKE_ALLOW_LOCAL_DB !== '1' || !target ||
    !['localhost', '127.0.0.1'].includes(target.hostname) ||
    !/^\/vendor_dashboard_browser_smoke_[0-9]+_[0-9]+$/.test(target.pathname)) {
  throw new Error('Replacement browser fixture requires a dedicated local browser-smoke database.');
}

process.env.DATABASE_URL = databaseUrl;
const { recordVerifiedDeliveredObservation } = await import('../../../backend/src/modules/shipping/allocation-delivered-observation.service.js');
const { createSettlementScheduleDrafts } = await import('../../../backend/src/modules/finance/settlement-schedule.service.js');
const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const run = 'browser-smoke-settlement-replacement';
const id = (suffix: string) => `${run}-${suffix}`;

try {
  await db.$connect();
  if (await db.user.count() || await db.vendor.count() || await db.settlementApproval.count()) {
    throw new Error('Replacement fixture refuses a populated database.');
  }
  for (const suffix of ['eligible', 'uncertain']) {
    const vendorId = id(`${suffix}-vendor`);
    const allocationId = id(`${suffix}-allocation`);
    const orderId = id(`${suffix}-order`);
    const shipmentExecutionId = id(`${suffix}-shipment-execution`);
    const sourceReference = id(`${suffix}-shipment`);
    await db.vendor.create({ data: { id: vendorId, name: `Replacement ${suffix} Vendor` } });
    await db.vendorFinancialProfile.create({ data: { vendorId, settlementDelayDays: 0,
      settlementFrequencyType: 'WEEKLY', weeklySettlementDay: 'WEDNESDAY', autoSettlementDraftEnabled: true } });
    await db.shopifyOrder.create({ data: { id: orderId, sourceShopifyOrderId: `gid://shopify/Order/${orderId}`,
      sourceShopifyOrderNumber: `#${orderId}` } });
    await db.vendorAllocation.create({ data: { id: allocationId, sourceShopifyOrderId: orderId,
      sourceShopifyOrderNumber: `#${orderId}`, originalVendorId: vendorId, assignedVendorId: vendorId,
      outboundMethodSnapshot: 'KARGONOMI', fulfillmentStatus: 'Fulfilled', shippingStatus: 'Delivered' } });
    await db.shipmentExecution.create({ data: { id: shipmentExecutionId, allocationId, vendorId,
      provider: 'KARGONOMI', providerShipmentId: sourceReference, shipmentStatus: 'DELIVERED', requestSnapshot: {} } });
    const observation = await recordVerifiedDeliveredObservation({ allocationId,
      source: { method: 'KARGONOMI', shipmentExecutionId, sourceReference } }, db as never);
    if (observation.vendorAllocationId !== allocationId || observation.sourceReference !== sourceReference) {
      throw new Error('Canonical delivery observation is not source-aligned.');
    }
    await db.fulfillment.create({ data: { id: id(`${suffix}-fulfillment`), vendorAllocationId: allocationId,
      fulfillmentStatus: 'Delivered', shipmentUpdatedAt: new Date() } });
    await db.financeLedgerEntry.create({ data: { id: id(`${suffix}-sale`), vendorAllocationId: allocationId,
      vendorId, entryType: 'sale', amount: '200.00', payoutStatus: 'PENDING', settlementStatus: 'PENDING',
      commissionPercentSnapshot: '10.00', commissionVatPercentSnapshot: '20.00', settlementDelayDaysSnapshot: 0 } });
  }
  const eligibleVendorId = id('eligible-vendor');
  const admin = await upsertSeedUser(db, { email: 'admin@demo.com', name: 'Replacement Browser Admin',
    role: 'ADMIN', vendorIds: [eligibleVendorId, id('uncertain-vendor')] });
  await upsertSeedUser(db, { email: 'vendor@demo.com', name: 'Replacement Browser Vendor',
    role: 'VENDOR', vendorIds: [eligibleVendorId] });

  // Canonical observations are recorded at actual database time. A later Wednesday
  // is required for source maturity; only this fixture process advances Date.now
  // past that UTC day-end while calling the existing scheduled DRAFT service.
  const runDateKey = process.env.BROWSER_SMOKE_RUN_DATE;
  if (!runDateKey || !/^\d{4}-\d{2}-\d{2}$/.test(runDateKey)) throw new Error('Fixture run date is required.');
  const runDate = new Date(`${runDateKey}T00:00:00.000Z`);
  const actualDateNow = Date.now;
  Date.now = () => runDate.getTime() + 86_400_001;
  try {
    for (const suffix of ['eligible', 'uncertain']) {
      const created = await createSettlementScheduleDrafts({ runDate: runDateKey,
        vendorId: id(`${suffix}-vendor`), confirmAutoSettlementDrafts: true });
      if (created.summary.created !== 1 || created.createdDrafts.length !== 1) {
        throw new Error(`Scheduled ${suffix} DRAFT was not created by the real service.`);
      }
    }
  } finally {
    Date.now = actualDateNow;
  }
  const originals = await db.settlementApproval.findMany({ where: { vendorId: { in: [eligibleVendorId, id('uncertain-vendor')] } },
    include: { lines: true } });
  if (originals.length !== 2 || originals.some((row) => row.status !== 'DRAFT' || !row.scheduledCycleKey ||
      row.lines.length !== 1 || row.netPayableMinor !== 17600 || row.approvedAt)) {
    throw new Error('Replacement browser originals lack intended scheduled source authority.');
  }
  console.log(JSON.stringify({ runDate: runDateKey, adminId: admin.id,
    originals: originals.map((row) => ({ id: row.id, vendorId: row.vendorId,
      ledgerId: row.lines[0].financeLedgerEntryId, scheduledCycleKey: row.scheduledCycleKey })) }));
} finally {
  await db.$disconnect();
  const { prisma } = await import('../../../backend/src/db/prisma.js');
  await prisma.$disconnect();
}
