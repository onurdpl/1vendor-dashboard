import { describe, expect, it, vi } from 'vitest';
import { createSopyoDeliveryClient } from '../backend/src/modules/vendor-integration/sopyo-delivery.client.js';
import { readSopyoOrderDetailDiagnostic } from '../backend/src/modules/vendor-integration/sopyo-order-detail-diagnostic.service.js';
import { SopyoCredentialError } from '../backend/src/modules/vendor-integration/sopyo-credential.crypto.js';

const pushId = 'cmuv8h9hy000cje2cc0jg29qg';
const allocationId = 'alloc-yalispor-8272455762257';
const push = {
  vendorAllocationId: allocationId, assignedVendorId: 'vendor-a', orderCode: allocationId,
  status: 'SUCCEEDED', sopyoOrderId: '38154205',
  vendorAllocation: {
    id: allocationId, assignedVendorId: 'vendor-a',
    outboundMethodSnapshot: 'VENDOR_INTEGRATION', outboundIntegrationProviderSnapshot: 'SOPYO',
  },
};

function setup(options: {
  row?: typeof push | null;
  credentialError?: Error;
  login?: () => Promise<Response>;
  detail?: () => Promise<Response>;
} = {}) {
  const findUnique = vi.fn(async () => options.row === undefined ? push : options.row);
  const db = { sopyoOrderPush: { findUnique } };
  const loadCredential = vi.fn(async (vendorId: string) => {
    expect(vendorId).toBe('vendor-a');
    if (options.credentialError) throw options.credentialError;
    return 'api-secret';
  });
  const fetcher = vi.fn(async (url: string, init: RequestInit) => {
    const pathname = new URL(url).pathname;
    if (pathname === '/api/v2/auth/login') {
      expect(init.method).toBe('POST');
      return options.login?.() ?? Promise.resolve(Response.json({ access_token: { token: 'bearer-secret', type: 'bearer' } }));
    }
    expect(url).toBe('https://api.sopyo.dev/api/v2/orders/38154205');
    expect(init.method).toBe('GET');
    return options.detail?.() ?? Promise.resolve(Response.json({ data: {
      id: 38154205, order_code: allocationId, order_type: 'SOPYOAPI', order_status: 6,
      customer_info: { email: 'private@example.com', address: 'private street' },
    } }));
  });
  const run = (...id: [string?]) => readSopyoOrderDetailDiagnostic({
    pushId: id.length === 0 ? pushId : id[0], databaseUrl: 'postgresql://local-only/test', db: db as never,
    loadCredential, client: createSopyoDeliveryClient(fetcher as typeof fetch),
  });
  return { run, findUnique, loadCredential, fetcher };
}

describe('read-only Sopyo numeric-detail operator diagnostic', () => {
  it('fails locally for missing or malformed push ID without database or network access', async () => {
    const s = setup();
    for (const id of [undefined, '', 'bad-id']) {
      expect(await s.run(id)).toEqual({ SOPYO_ORDER_DETAIL_READ: 'FAILED',
        reason: 'LOCAL_VALIDATION_FAILED', stage: 'LOCAL_VALIDATION' });
    }
    expect(s.findUnique).not.toHaveBeenCalled();
    expect(s.fetcher).not.toHaveBeenCalled();
  });

  it('fails safely for missing or mismatched push identity before credential or network access', async () => {
    for (const row of [null, { ...push, assignedVendorId: 'other-vendor' },
      { ...push, vendorAllocation: { ...push.vendorAllocation, outboundIntegrationProviderSnapshot: null } }]) {
      const s = setup({ row: row as typeof push | null });
      expect(await s.run()).toEqual({ SOPYO_ORDER_DETAIL_READ: 'FAILED',
        reason: 'LOCAL_VALIDATION_FAILED', stage: 'PUSH_LOAD' });
      expect(s.loadCredential).not.toHaveBeenCalled();
      expect(s.fetcher).not.toHaveBeenCalled();
    }
  });

  it('classifies missing and undecryptable credentials without login', async () => {
    for (const message of ['Sopyo credential is not configured for this vendor.',
      'Sopyo credential cannot be decrypted.']) {
      const s = setup({ credentialError: new SopyoCredentialError(message) });
      expect(await s.run()).toEqual({ SOPYO_ORDER_DETAIL_READ: 'FAILED',
        reason: 'CREDENTIAL_FAILED', stage: 'CREDENTIAL' });
      expect(s.fetcher).not.toHaveBeenCalled();
    }
  });

  it('classifies login network, HTTP, and malformed responses without provider text', async () => {
    const cases: Array<[() => Promise<Response>, object]> = [
      [async () => { throw new Error('api-secret private@example.com'); },
        { reason: 'NETWORK_ERROR', stage: 'AUTH' }],
      [async () => Response.json({ message: 'api-secret' }, { status: 401 }),
        { reason: 'AUTH_FAILED', stage: 'AUTH', httpStatus: 401 }],
      [async () => Response.json({ message: 'private@example.com' }, { status: 500 }),
        { reason: 'AUTH_FAILED', stage: 'AUTH', httpStatus: 500 }],
      [async () => new Response('private@example.com', { status: 200 }),
        { reason: 'AUTH_FAILED', stage: 'AUTH', httpStatus: 200 }],
      [async () => Response.json({ access_token: { token: '', type: 'bearer' } }),
        { reason: 'AUTH_FAILED', stage: 'AUTH', httpStatus: 200 }],
    ];
    for (const [login, expected] of cases) {
      const s = setup({ login });
      expect(await s.run()).toEqual({ SOPYO_ORDER_DETAIL_READ: 'FAILED', ...expected });
      expect(s.fetcher).toHaveBeenCalledTimes(1);
    }
  });

  it('classifies detail network and HTTP statuses; no create or update request is made', async () => {
    const cases: Array<[() => Promise<Response>, object]> = [
      [async () => { throw new Error('bearer-secret private@example.com'); },
        { reason: 'NETWORK_ERROR', stage: 'DETAIL_GET' }],
      [async () => Response.json({ message: 'private@example.com' }, { status: 404 }),
        { reason: 'DETAIL_NOT_FOUND', stage: 'DETAIL_GET', httpStatus: 404 }],
      ...[401, 403, 500].map((status): [() => Promise<Response>, object] =>
        [async () => Response.json({ message: 'private@example.com' }, { status }),
          { reason: 'DETAIL_HTTP_ERROR', stage: 'DETAIL_GET', httpStatus: status }]),
    ];
    for (const [detail, expected] of cases) {
      const s = setup({ detail });
      expect(await s.run()).toEqual({ SOPYO_ORDER_DETAIL_READ: 'FAILED', ...expected });
      expect(s.fetcher).toHaveBeenCalledTimes(2);
      expect(s.fetcher.mock.calls.map(([, init]) => init.method)).toEqual(['POST', 'GET']);
      expect(s.findUnique).toHaveBeenCalledTimes(1);
    }
  });

  it('distinguishes HTTP 200 invalid JSON without printing its body', async () => {
    const s = setup({ detail: async () => new Response('private@example.com bearer-secret', { status: 200 }) });
    expect(await s.run()).toEqual({ SOPYO_ORDER_DETAIL_READ: 'FAILED',
      reason: 'DETAIL_JSON_INVALID', stage: 'DETAIL_PARSE', httpStatus: 200 });
  });

  it('reports only allowlisted structure when data is missing', async () => {
    const s = setup({ detail: async () => Response.json({
      id: 38154205, order_code: allocationId, order_type: 'SOPYOAPI', order_status: 6,
      customer_name: 'Private Customer', token: 'bearer-secret',
    }) });
    const result = await s.run();
    expect(result).toEqual({ SOPYO_ORDER_DETAIL_READ: 'FAILED',
      reason: 'DETAIL_SCHEMA_MISMATCH', stage: 'DETAIL_PARSE', httpStatus: 200,
      detailStructure: {
        bodyType: 'OBJECT', topLevelKeys: ['id', 'order_code', 'order_status', 'order_type'],
        dataPresent: false, dataType: 'ABSENT',
        requiredFieldTypes: { id: 'NUMBER', order_code: 'STRING', order_type: 'STRING', order_status: 'NUMBER' },
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/Private Customer|private@example.com|bearer-secret|alloc-yalispor|38154205/);
  });

  it('reports fixed field types for wrong types, never provider values or unknown keys', async () => {
    const s = setup({ detail: async () => Response.json({ data: { id: 38154205, order_code: allocationId,
      order_type: 'SOPYOAPI', order_status: '6', customer_info: { name: 'Private Customer' },
      tracking_number: 'SECRET-TRACKING', api_token: 'api-secret' } }) });
    const result = await s.run();
    expect(result).toEqual({ SOPYO_ORDER_DETAIL_READ: 'FAILED',
      reason: 'DETAIL_SCHEMA_MISMATCH', stage: 'DETAIL_PARSE', httpStatus: 200,
      detailStructure: {
        bodyType: 'OBJECT', topLevelKeys: ['data'],
        dataPresent: true, dataType: 'OBJECT',
        requiredFieldTypes: { id: 'ABSENT', order_code: 'ABSENT', order_type: 'ABSENT', order_status: 'ABSENT' },
        dataRequiredFieldTypes: { id: 'NUMBER', order_code: 'STRING', order_type: 'STRING', order_status: 'STRING' },
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/Private Customer|SECRET-TRACKING|api-secret|customer_info|tracking_number|api_token|alloc-yalispor|38154205/);
  });

  it('classifies null, array, and invalid data fields as schema mismatches', async () => {
    const valid = { id: 38154205, order_code: allocationId, order_type: 'SOPYOAPI', order_status: 6 };
    for (const body of [
      { data: null }, { data: [valid] },
      { data: { ...valid, id: 0 } },
      { data: { ...valid, order_code: '' } },
      { data: { ...valid, order_type: '' } },
      { data: { ...valid, order_status: '6' } },
    ]) {
      const result = await setup({ detail: async () => Response.json(body) }).run();
      expect(result).toMatchObject({ SOPYO_ORDER_DETAIL_READ: 'FAILED',
        reason: 'DETAIL_SCHEMA_MISMATCH', stage: 'DETAIL_PARSE', httpStatus: 200 });
      expect(JSON.stringify(result)).not.toMatch(/alloc-yalispor|38154205/);
    }
  });

  it('bounds non-object and null structural diagnostics', async () => {
    for (const [body, bodyType] of [[null, 'NULL'], [['private@example.com'], 'ARRAY'], ['private@example.com', 'STRING']] as const) {
      const s = setup({ detail: async () => Response.json(body) });
      expect(await s.run()).toEqual({ SOPYO_ORDER_DETAIL_READ: 'FAILED',
        reason: 'DETAIL_SCHEMA_MISMATCH', stage: 'DETAIL_PARSE', httpStatus: 200,
        detailStructure: {
          bodyType, topLevelKeys: [], dataPresent: false, dataType: 'ABSENT',
          requiredFieldTypes: { id: 'ABSENT', order_code: 'ABSENT', order_type: 'ABSENT', order_status: 'ABSENT' },
        },
      });
    }
  });

  it('detects provider identity mismatch and preserves the existing success output', async () => {
    const mismatched = setup({ detail: async () => Response.json({ data: {
      id: 38154205, order_code: 'another-allocation', order_type: 'SOPYOAPI', order_status: 6,
    } }) });
    expect(await mismatched.run()).toEqual({ SOPYO_ORDER_DETAIL_READ: 'FAILED',
      reason: 'PROVIDER_IDENTITY_MISMATCH', stage: 'IDENTITY_CHECK', httpStatus: 200 });
    const lookalikes = setup({ detail: async () => Response.json({
      id: 1, order_code: 'wrong-allocation', order_type: 'OTHER', order_status: 1,
      data: { id: 38154205, order_code: allocationId, order_type: 'SOPYOAPI', order_status: 6 },
    }) });
    expect(await lookalikes.run()).toEqual({
      id: 38154205, orderCode: allocationId, orderType: 'SOPYOAPI', orderStatus: 6,
    });
    const successful = setup();
    expect(await successful.run()).toEqual({
      id: 38154205, orderCode: allocationId, orderType: 'SOPYOAPI', orderStatus: 6,
    });
    expect(successful.fetcher.mock.calls.map(([, init]) => init.method)).toEqual(['POST', 'GET']);
  });

  it('never returns arbitrary exception text, provider bodies, credentials, tokens, or PII', async () => {
    const s = setup({ detail: async () => { throw new Error('bearer-secret api-secret private@example.com private street'); } });
    const result = JSON.stringify(await s.run());
    for (const sensitive of ['bearer-secret', 'api-secret', 'private@example.com', 'private street', 'stack']) {
      expect(result).not.toContain(sensitive);
    }
    expect(result).toContain('NETWORK_ERROR');
  });
});
