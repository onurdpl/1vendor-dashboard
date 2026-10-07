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

  it('rejects Sopyo without location and preserves the saved pair on a partial clear', async () => {
    const location = 'gid://shopify/Location/121454952785';
    await expect(save(vendorId, { outboundMethod: 'VENDOR_INTEGRATION',
      selectedIntegrationProvider: 'SOPYO' })).rejects.toThrow('Shopify Location GID is required');
    expect(await db.vendorShippingConfig.findUnique({ where: { vendorId } })).toBeNull();

    const saved = await save(vendorId, { outboundMethod: 'VENDOR_INTEGRATION',
      selectedIntegrationProvider: 'SOPYO', shopifyLocationGid: location });
    expect(saved).toMatchObject({ outboundMethod: 'VENDOR_INTEGRATION',
      selectedIntegrationProvider: 'SOPYO', shopifyLocationGid: location });
    await expect(save(vendorId, { shopifyLocationGid: null })).rejects.toThrow('Shopify Location GID is required');
    await expect(save(vendorId, { shopifyLocationGid: '  ' })).rejects.toThrow('Shopify Location GID is required');
    expect(await db.vendorShippingConfig.findUniqueOrThrow({ where: { vendorId } })).toMatchObject({
      outboundMethod: 'VENDOR_INTEGRATION', selectedIntegrationProvider: 'SOPYO', shopifyLocationGid: location,
    });
    await save(vendorId, { shippingEnabled: false });
    expect(await db.vendorShippingConfig.findUniqueOrThrow({ where: { vendorId } })).toMatchObject({
      outboundMethod: 'VENDOR_INTEGRATION', selectedIntegrationProvider: 'SOPYO',
      shopifyLocationGid: location, shippingEnabled: false,
    });
    await save(vendorId, { outboundMethod: 'KARGONOMI', shopifyLocationGid: null });
    expect(await db.vendorShippingConfig.findUniqueOrThrow({ where: { vendorId } })).toMatchObject({
      outboundMethod: 'KARGONOMI', selectedIntegrationProvider: null, shopifyLocationGid: null,
    });
  });

  it('rejects a direct Admin shipping-config API save that bypasses the UI', async () => {
    const { registerShippingExecutionRoutes } = await import('../backend/src/modules/shipping/shipping-execution.routes.js');
    let saveHandler: ((request: unknown, reply: unknown) => Promise<unknown>) | undefined;
    const app = {
      get: () => undefined,
      post: () => undefined,
      put: (path: string, _options: unknown, handler: typeof saveHandler) => {
        if (path === '/admin/vendors/:vendorId/shipping-config') saveHandler = handler;
      },
    };
    registerShippingExecutionRoutes(app as never, { JWT_SECRET: 'isolated-test-secret' } as never);
    expect(saveHandler).toBeDefined();
    const response = await saveHandler!(
      { authUser: { role: 'admin' }, params: { vendorId }, body: {
        outboundMethod: 'VENDOR_INTEGRATION', selectedIntegrationProvider: 'SOPYO', shopifyLocationGid: null,
      } },
      { code: (status: number) => ({ send: (body: unknown) => ({ status, body }) }) },
    );
    expect(response).toMatchObject({ status: 400, body: { message: 'Shopify Location GID is required for Sopyo outbound shipping.' } });
    expect(await db.vendorShippingConfig.findUnique({ where: { vendorId } })).toBeNull();
  });

  it('rejects a partial save when a legacy Sopyo configuration has an invalid stored location', async () => {
    await db.vendorShippingConfig.create({ data: {
      vendorId, outboundMethod: 'VENDOR_INTEGRATION', selectedIntegrationProvider: 'SOPYO',
      shopifyLocationGid: 'not-a-shopify-gid',
    } });
    await expect(save(vendorId, { shippingEnabled: false })).rejects.toThrow('must be a Shopify Location GID');
    expect(await db.vendorShippingConfig.findUniqueOrThrow({ where: { vendorId } })).toMatchObject({
      shopifyLocationGid: 'not-a-shopify-gid', shippingEnabled: true,
    });
  });

  it('saves Sopyo before connection, ignores legacy/free-text and cross-vendor clients, then accepts a coded client', async () => {
    await save(vendorId, { outboundMethod: 'VENDOR_INTEGRATION', selectedIntegrationProvider: 'SOPYO',
      shopifyLocationGid: 'gid://shopify/Location/101' });
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
    await save(vendorId, { outboundMethod: 'VENDOR_INTEGRATION', selectedIntegrationProvider: 'SOPYO',
      shopifyLocationGid: 'gid://shopify/Location/101' });
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
      save(vendorId, { outboundMethod: 'VENDOR_INTEGRATION', selectedIntegrationProvider: 'SOPYO',
        shopifyLocationGid: 'gid://shopify/Location/101' }),
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
