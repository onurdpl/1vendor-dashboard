import { PrismaClient } from '../../../backend/node_modules/@prisma/client/index.js';
import { upsertSeedUser } from '../../../backend/prisma/seed-user-utils.js';

const url = new URL(process.env.DATABASE_URL ?? 'file:invalid');
const proof = process.env.AUTH_BROWSER_DB_PROOF ?? '';
if (process.env.AUTH_BROWSER_ALLOW_LOCAL_DB !== '1' ||
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    !/^\/vendor_dashboard_auth_browser_\d+_\d+$/.test(url.pathname) ||
    !/^[a-f0-9]{64}$/.test(proof)) {
  throw new Error('Unverified vendor context fixture target.');
}

const db = new PrismaClient();
try {
  const [identity] = await db.$queryRawUnsafe<Array<{
    major: number; cluster: string; owner: string; databaseOwner: string; proof: string | null;
  }>>(`SELECT current_setting('server_version_num')::int/10000 AS major,
    (pg_control_system()).system_identifier::text AS cluster,
    current_user AS owner, pg_get_userbyid(datdba) AS "databaseOwner",
    shobj_description(oid, 'pg_database') AS proof
    FROM pg_database WHERE datname = current_database()`);
  if (identity.major !== 18 || identity.cluster !== process.env.AUTH_BROWSER_CLUSTER_ID ||
      identity.owner !== identity.databaseOwner || identity.proof !== `auth-browser:${proof}`) {
    throw new Error('Vendor context fixture database identity mismatch.');
  }
  if (await db.user.count() || await db.vendor.count() || await db.shopifyOrder.count()) {
    throw new Error('Vendor context fixture requires an empty database.');
  }
  for (const key of ['a', 'b'] as const) {
    const vendorId = `context-vendor-${key}`;
    const orderId = `context-order-${key}`;
    const allocationId = `context-allocation-${key}`;
    await db.vendor.create({ data: { id: vendorId, name: `Context Vendor ${key.toUpperCase()}` } });
    await db.shopifyOrder.create({ data: { id: orderId,
      sourceShopifyOrderId: `gid://shopify/Order/context-${key}`,
      sourceShopifyOrderNumber: `#CTX-${key.toUpperCase()}` } });
    await db.vendorAllocation.create({ data: { id: allocationId, sourceShopifyOrderId: orderId,
      sourceShopifyOrderNumber: `#CTX-${key.toUpperCase()}`,
      originalVendorId: vendorId, assignedVendorId: vendorId } });
    await db.returnRecord.create({ data: { id: `context-return-${key}`,
      vendorAllocationId: allocationId, sourceShopifyOrderId: orderId,
      sourceShopifyOrderNumber: `#CTX-${key.toUpperCase()}`,
      sourceShopifyReturnId: `CTX-${key.toUpperCase()}-RETURN`, status: 'requested' } });
    await db.financeLedgerEntry.create({ data: { id: `context-ledger-${key}`,
      vendorAllocationId: allocationId, vendorId, entryType: 'sale',
      amount: key === 'a' ? '111.11' : '222.22', description: `Context ${key.toUpperCase()} sale` } });
  }
  await db.vendor.createMany({ data: Array.from({ length: 101 }, (_, index) => ({
    id: `context-page-${String(index).padStart(3, '0')}`,
    name: `Context Page Vendor ${String(index).padStart(3, '0')}`,
  })) });
  const admin = await upsertSeedUser(db, { email: 'context-admin@demo.test', name: 'Context Admin',
    role: 'ADMIN', vendorIds: [] });
  await upsertSeedUser(db, { email: 'context-vendor-a@demo.test', name: 'Context Vendor A User',
    role: 'VENDOR', vendorIds: ['context-vendor-a'] });
  for (const [id, vendorId, contextType, contextId, category, snapshot] of [
    ['context-ticket-a1', 'context-vendor-a', 'order', 'context-allocation-a', 'ORDER', { orderNumber: '#CTX-A' }],
    ['context-ticket-a2', 'context-vendor-a', 'order', 'context-allocation-a', 'ORDER', { orderNumber: '#CTX-A' }],
    ['context-ticket-b-order', 'context-vendor-b', 'order', 'context-allocation-b', 'ORDER', { orderNumber: '#CTX-B' }],
    ['context-ticket-b-return', 'context-vendor-b', 'return', 'context-return-b', 'REFUND', { returnNumber: 'CTX-B-RETURN' }],
    ['context-ticket-b-finance', 'context-vendor-b', 'order', 'context-allocation-b', 'REFUND',
      { orderNumber: '#CTX-B', financeLedgerEntryId: 'context-ledger-b' }],
  ] as const) {
    await db.supportTicket.create({ data: { id, createdByUserId: admin.id, createdByRole: 'admin',
      vendorId, subject: id, message: 'Disposable navigation fixture', contextType, contextId,
      category, contextSnapshot: snapshot } });
  }
  console.log('Vendor context fixture verified: two distinct record-owning Vendors, 101 pagination Vendors, zero-membership Admin.');
} finally {
  await db.$disconnect();
}
