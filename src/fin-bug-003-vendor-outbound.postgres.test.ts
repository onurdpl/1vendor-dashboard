import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '../backend/node_modules/@prisma/client/index.js';

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const describeWithPostgres = databaseUrl ? describe : describe.skip;

describeWithPostgres('FIN-BUG-003 Phase 1 outbound selection on isolated PostgreSQL', () => {
  let db: PrismaClient;
  let save: typeof import('../backend/src/modules/shipping/shipping-execution.service.js')['upsertVendorShippingConfig'];
  let activate: typeof import('../backend/src/modules/vendors/vendor-status.service.js')['updateVendorStatus'];
  let createToken: typeof import('../backend/src/modules/vendor-integration/vendor-integration.tokens.js')['createVendorIntegrationClientToken'];
  let vendorId: string;
  let otherVendorId: string;

  beforeEach(async () => {
    const target = new URL(databaseUrl!);
    if (process.env.FIN_BUG_003_TEST_DATABASE_ISOLATED !== '1' ||
        !['127.0.0.1', 'localhost'].includes(target.hostname) ||
        target.pathname.slice(1) !== 'fin_bug_003_validation') {
      throw new Error('FIN-BUG-003 test requires isolated local fin_bug_003_validation.');
    }
    process.env.DATABASE_URL = databaseUrl;
    ({ upsertVendorShippingConfig: save } = await import('../backend/src/modules/shipping/shipping-execution.service.js'));
    ({ updateVendorStatus: activate } = await import('../backend/src/modules/vendors/vendor-status.service.js'));
    ({ createVendorIntegrationClientToken: createToken } = await import('../backend/src/modules/vendor-integration/vendor-integration.tokens.js'));
    db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await db.$connect();
    vendorId = `outbound-${process.pid}-${Date.now()}`;
    otherVendorId = `${vendorId}-other`;
    await db.vendor.createMany({ data: [
      { id: vendorId, name: 'Outbound Test Vendor', status: 'inactive' },
      { id: otherVendorId, name: 'Other Test Vendor', status: 'inactive' },
    ] });
  });

  afterEach(async () => {
    if (!db) return;
    await db.vendorIntegrationClient.deleteMany({ where: { vendorIdentifier: { in: [vendorId, otherVendorId] } } });
    await db.vendor.deleteMany({ where: { id: { in: [vendorId, otherVendorId] } } });
    await db.$disconnect();
  });

  it('persists explicit Kargonomi selection and rejects an unconfigured activation', async () => {
    await expect(activate(vendorId, { status: 'active' })).rejects.toThrow('Outbound shipping must be configured');
    const saved = await save(vendorId, { outboundMethod: 'KARGONOMI' });
    expect(saved).toMatchObject({ outboundMethod: 'KARGONOMI', selectedIntegrationProvider: null });
    expect(await db.vendorShippingConfig.findUniqueOrThrow({ where: { vendorId } })).toMatchObject({
      outboundMethod: 'KARGONOMI', selectedIntegrationProvider: null,
    });
    await expect(activate(vendorId, { status: 'active' })).resolves.toMatchObject({ status: 'active' });
  });

  it('saves Sopyo before connection, ignores legacy/free-text and cross-vendor clients, then accepts a coded client', async () => {
    await save(vendorId, { outboundMethod: 'VENDOR_INTEGRATION', selectedIntegrationProvider: 'SOPYO' });
    await db.vendorIntegrationClient.create({ data: {
      vendorIdentifier: vendorId, providerName: 'Sopyo API', tokenHash: `${vendorId}-legacy`,
      scopes: ['orders:read', 'shipment:write'],
    } });
    await createToken({ vendorIdentifier: otherVendorId, providerName: 'Sopyo', providerCode: 'SOPYO', scopes: ['orders:read', 'shipment:write'] });
    await expect(activate(vendorId, { status: 'active' })).rejects.toThrow('active integration connection');
    expect((await db.vendorIntegrationClient.findFirstOrThrow({ where: { tokenHash: `${vendorId}-legacy` } })).providerCode).toBeNull();

    await createToken({ vendorIdentifier: vendorId, providerName: 'Sopyo', providerCode: 'SOPYO', scopes: ['orders:read'] });
    await expect(activate(vendorId, { status: 'active' })).rejects.toThrow('active integration connection');
    const created = await createToken({ vendorIdentifier: vendorId, providerName: 'Sopyo', providerCode: 'SOPYO', scopes: ['orders:read', 'shipment:write'] });
    await expect(activate(vendorId, { status: 'active' })).resolves.toMatchObject({ status: 'active' });
    expect(await db.vendorShippingConfig.findUniqueOrThrow({ where: { vendorId } })).toMatchObject({
      outboundMethod: 'VENDOR_INTEGRATION', selectedIntegrationProvider: 'SOPYO',
    });
    expect(await db.vendorIntegrationClient.findUniqueOrThrow({ where: { id: created.clientId } })).toMatchObject({ providerCode: 'SOPYO' });
  });

  it('rejects invalid provider pairs and preserves selection on unrelated config updates', async () => {
    await expect(save(vendorId, { outboundMethod: 'VENDOR_INTEGRATION' })).rejects.toThrow('providerCode must be SOPYO');
    await expect(save(vendorId, { outboundMethod: 'VENDOR_INTEGRATION', selectedIntegrationProvider: 'sopyo' as 'SOPYO' })).rejects.toThrow('providerCode must be SOPYO');
    await save(vendorId, { outboundMethod: 'VENDOR_INTEGRATION', selectedIntegrationProvider: 'SOPYO' });
    await expect(db.$executeRaw`
      UPDATE "VendorShippingConfig"
      SET "outboundMethod" = NULL, "selectedIntegrationProvider" = 'SOPYO'
      WHERE "vendorId" = ${vendorId}
    `).rejects.toThrow();
    await expect(db.$executeRaw`
      UPDATE "VendorShippingConfig"
      SET "selectedIntegrationProvider" = NULL
      WHERE "vendorId" = ${vendorId}
    `).rejects.toThrow();
    await save(vendorId, { shippingEnabled: false });
    expect(await db.vendorShippingConfig.findUniqueOrThrow({ where: { vendorId } })).toMatchObject({
      outboundMethod: 'VENDOR_INTEGRATION', selectedIntegrationProvider: 'SOPYO', shippingEnabled: false,
    });
  });

  it('does not allow an incomplete connection or a concurrent incomplete selection to activate a vendor', async () => {
    const concurrent = await Promise.allSettled([
      save(vendorId, { outboundMethod: 'VENDOR_INTEGRATION', selectedIntegrationProvider: 'SOPYO' }),
      activate(vendorId, { status: 'active' }),
    ]);
    expect(concurrent[0].status).toBe('fulfilled');
    expect(concurrent[1].status).toBe('rejected');
    expect((await db.vendor.findUniqueOrThrow({ where: { id: vendorId } })).status).toBe('inactive');

    const client = await db.vendorIntegrationClient.create({ data: {
      vendorIdentifier: vendorId, providerName: 'Sopyo', providerCode: 'SOPYO',
      tokenHash: `${vendorId}-disabled`, enabled: false, scopes: ['orders:read', 'shipment:write'],
    } });
    await expect(activate(vendorId, { status: 'active' })).rejects.toThrow('active integration connection');
    await db.vendorIntegrationClient.update({ where: { id: client.id }, data: { enabled: true, revokedAt: new Date() } });
    await expect(activate(vendorId, { status: 'active' })).rejects.toThrow('active integration connection');
    await db.vendorIntegrationClient.update({ where: { id: client.id }, data: { revokedAt: null, scopes: ['shipment:write'] } });
    await expect(activate(vendorId, { status: 'active' })).rejects.toThrow('active integration connection');
  });
});
