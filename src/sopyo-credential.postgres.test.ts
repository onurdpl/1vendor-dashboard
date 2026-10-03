import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../backend/node_modules/@prisma/client/index.js';

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const describeWithPostgres = databaseUrl ? describe : describe.skip;

describeWithPostgres('Sopyo credential storage on isolated PostgreSQL', () => {
  let db: PrismaClient;
  let save: typeof import('../backend/src/modules/vendor-integration/sopyo-credential.service.js')['saveOrReplaceSopyoCredential'];
  let has: typeof import('../backend/src/modules/vendor-integration/sopyo-credential.service.js')['hasSopyoCredential'];
  let get: typeof import('../backend/src/modules/vendor-integration/sopyo-credential.service.js')['getDecryptedSopyoCredentialForInternalUse'];
  let originalKey: string | undefined;
  const key = Buffer.alloc(32, 11).toString('base64'); // Fake test-only key.
  const prefix = `sopyo-credential-${process.pid}-${Date.now()}`;

  beforeAll(async () => {
    const target = new URL(databaseUrl!);
    if (process.env.SOPYO_CREDENTIAL_TEST_DATABASE_ISOLATED !== '1' ||
        target.protocol !== 'postgresql:' ||
        !['127.0.0.1', 'localhost'].includes(target.hostname) ||
        target.pathname.slice(1) !== 'sopyo_credential_validation') {
      throw new Error('Sopyo credential PostgreSQL test requires isolated local sopyo_credential_validation.');
    }
    originalKey = process.env.SOPYO_CREDENTIAL_ENCRYPTION_KEY;
    process.env.SOPYO_CREDENTIAL_ENCRYPTION_KEY = key;
    process.env.DATABASE_URL = databaseUrl;
    ({ saveOrReplaceSopyoCredential: save, hasSopyoCredential: has,
      getDecryptedSopyoCredentialForInternalUse: get } = await import('../backend/src/modules/vendor-integration/sopyo-credential.service.js'));
    db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await db.$connect();
  });

  afterAll(async () => {
    if (db) {
      await db.$disconnect();
    }
    if (originalKey === undefined) delete process.env.SOPYO_CREDENTIAL_ENCRYPTION_KEY;
    else process.env.SOPYO_CREDENTIAL_ENCRYPTION_KEY = originalKey;
  });

  async function vendor(suffix: string) {
    const id = `${prefix}-${suffix}`;
    await db.vendor.create({ data: { id, name: 'Fake test vendor', status: 'inactive' } });
    return id;
  }

  it('persists ciphertext only and atomically replaces one vendor without affecting another', async () => {
    const vendorA = await vendor('a');
    const vendorB = await vendor('b');
    const before = await save(vendorA, 'fake-test-token-A', db);
    await save(vendorB, ' fake-test-token-B ', db);
    expect(before).toMatchObject({ vendorId: vendorA, configured: true });
    expect(JSON.stringify(before)).not.toContain('fake-test-token-A');
    expect(await has(vendorA, db)).toBe(true);
    const persisted = await db.sopyoVendorCredential.findUniqueOrThrow({ where: { vendorId: vendorA } });
    expect(Buffer.from(persisted.ciphertext).toString('utf8')).not.toContain('fake-test-token-A');
    expect(JSON.stringify(persisted)).not.toContain('fake-test-token-A');
    expect(await get(vendorA, db)).toBe('fake-test-token-A');

    const after = await save(vendorA, 'fake-test-token-A-rotated', db);
    expect(after.id).toBe(before.id);
    expect(await db.sopyoVendorCredential.count({ where: { vendorId: vendorA } })).toBe(1);
    expect(await get(vendorA, db)).toBe('fake-test-token-A-rotated');
    expect(await get(vendorB, db)).toBe(' fake-test-token-B ');
    await expect(db.sopyoVendorCredential.create({ data: {
      vendorId: vendorA, ciphertext: Buffer.from('x'), iv: Buffer.alloc(12), authTag: Buffer.alloc(16),
    } })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('does not alter inbound clients, shipping config, allocation snapshots, or delivered observations', async () => {
    const id = await vendor('isolation');
    const order = await db.shopifyOrder.create({ data: {
      sourceShopifyOrderId: id, sourceShopifyOrderNumber: `#${id}`,
    } });
    const allocation = await db.vendorAllocation.create({ data: {
      id, sourceShopifyOrderId: order.id, sourceShopifyOrderNumber: `#${id}`,
      originalVendorId: id, assignedVendorId: id,
      outboundMethodSnapshot: 'VENDOR_INTEGRATION', outboundIntegrationProviderSnapshot: 'SOPYO',
    } });
    const client = await db.vendorIntegrationClient.create({ data: {
      vendorIdentifier: id, providerName: 'Fake provider', providerCode: null,
      tokenHash: `${id}-inbound`, scopes: ['shipment:write'],
    } });
    const codedClient = await db.vendorIntegrationClient.create({ data: {
      vendorIdentifier: id, providerName: 'Fake coded provider', providerCode: 'SOPYO',
      tokenHash: `${id}-coded-inbound`, scopes: ['shipment:write'],
    } });
    const config = await db.vendorShippingConfig.create({ data: {
      vendorId: id, outboundMethod: 'VENDOR_INTEGRATION', selectedIntegrationProvider: 'SOPYO',
    } });
    const { recordVerifiedDeliveredObservation } = await import('../backend/src/modules/shipping/allocation-delivered-observation.service.js');
    await recordVerifiedDeliveredObservation({ allocationId: id, source: {
      method: 'VENDOR_INTEGRATION', providerCode: 'SOPYO', clientId: codedClient.id,
      sourceReference: 'fake-provider-order',
    } }, db);
    const before = {
      client: await db.vendorIntegrationClient.findUniqueOrThrow({ where: { id: client.id } }),
      codedClient: await db.vendorIntegrationClient.findUniqueOrThrow({ where: { id: codedClient.id } }),
      config: await db.vendorShippingConfig.findUniqueOrThrow({ where: { id: config.id } }),
      allocation: await db.vendorAllocation.findUniqueOrThrow({ where: { id: allocation.id } }),
      observation: await db.allocationDeliveredObservation.findUniqueOrThrow({ where: { vendorAllocationId: id } }),
    };
    await save(id, 'fake-token-first', db);
    await save(id, 'fake-token-replacement', db);
    expect(await db.vendorIntegrationClient.findUniqueOrThrow({ where: { id: client.id } })).toEqual(before.client);
    expect(await db.vendorIntegrationClient.findUniqueOrThrow({ where: { id: codedClient.id } })).toEqual(before.codedClient);
    expect(await db.vendorShippingConfig.findUniqueOrThrow({ where: { id: config.id } })).toEqual(before.config);
    expect(await db.vendorAllocation.findUniqueOrThrow({ where: { id: allocation.id } })).toEqual(before.allocation);
    expect(await db.allocationDeliveredObservation.findUniqueOrThrow({ where: { vendorAllocationId: id } })).toEqual(before.observation);
  });

  it('rejects blank tokens, absent credentials, and missing or malformed master key safely', async () => {
    const id = await vendor('fail-closed');
    await expect(save(id, '   ', db)).rejects.toThrow('required');
    await expect(get(id, db)).rejects.toThrow('not configured');
    process.env.SOPYO_CREDENTIAL_ENCRYPTION_KEY = '';
    try {
      await expect(save(id, 'fake-token', db)).rejects.toThrow('not configured');
      expect(await has(id, db)).toBe(false);
    } finally {
      process.env.SOPYO_CREDENTIAL_ENCRYPTION_KEY = key;
    }
    await save(id, 'fake-token', db);
    const saved = await db.sopyoVendorCredential.findUniqueOrThrow({ where: { vendorId: id } });
    process.env.SOPYO_CREDENTIAL_ENCRYPTION_KEY = '';
    try {
      await expect(get(id, db)).rejects.toThrow('not configured');
    } finally {
      process.env.SOPYO_CREDENTIAL_ENCRYPTION_KEY = key;
    }
    process.env.SOPYO_CREDENTIAL_ENCRYPTION_KEY = 'malformed';
    try {
      await expect(get(id, db)).rejects.toThrow('base64-encoded 32 bytes');
    } finally {
      process.env.SOPYO_CREDENTIAL_ENCRYPTION_KEY = key;
    }
    const broken = Buffer.from(saved.ciphertext);
    broken[0] ^= 1;
    await db.sopyoVendorCredential.update({ where: { vendorId: id }, data: { ciphertext: broken } });
    await expect(get(id, db)).rejects.toThrow('cannot be decrypted');
  });
});
