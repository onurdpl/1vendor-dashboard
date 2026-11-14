import Fastify from '../backend/node_modules/fastify/fastify.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppEnv } from '../backend/src/config/env.js';
const mocks = vi.hoisted(() => ({ prepare: vi.fn(), r1: vi.fn(), write: vi.fn(), list: vi.fn(), detail: vi.fn(), role: 'admin' }));
vi.mock('../backend/src/modules/auth/auth.middleware.js', () => ({ createAuthMiddleware: () => ({
  authenticateRequest: async (request: { authUser?: unknown }) => { request.authUser = { id: 'admin-test', role: mocks.role }; },
}) }));
vi.mock('../backend/src/modules/finance/finance.service.js', async (original) => ({
  ...await original<typeof import('../backend/src/modules/finance/finance.service.js')>(),
  preparePayoutBatch: mocks.prepare, prepareAdminPayoutBatchWithR1: mocks.r1,
}));
vi.mock('../backend/src/modules/finance/payout-preparation-failure.service.js', async (original) => ({
  ...await original<typeof import('../backend/src/modules/finance/payout-preparation-failure.service.js')>(),
  recordPayoutPreparationFailure: mocks.write, listPayoutPreparationFailures: mocks.list, getPayoutPreparationFailure: mocks.detail,
}));
const { registerFinanceRoutes } = await import('../backend/src/modules/finance/finance.routes.js');
const { PayoutPreparationExhaustedError } = await import('../backend/src/modules/finance/finance.service.js');
async function request(path: string, method: 'GET' | 'POST' = 'GET', r1 = false) {
  const app = Fastify();
  registerFinanceRoutes(app, { R1_PAYOUT_ADMIN_ENABLED: r1 } as AppEnv);
  try { return await app.inject({ url: path, method, ...(method === 'POST' ? { payload: { vendorId: 'frontend-b', requestId: 'caller-id' } } : {}) }); }
  finally { await app.close(); }
}
describe('legacy payout failure recording and Admin read routes', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.role = 'admin'; mocks.write.mockResolvedValue({ count: 1 }); });
  it('records only verified original Vendor context and keeps the safe response', async () => {
    const error = new PayoutPreparationExhaustedError('original-a'); mocks.prepare.mockRejectedValue(error);
    const result = await request('/admin/payout-batches/prepare', 'POST');
    expect(result.statusCode).toBe(400); expect(result.json()).toEqual({ message: error.message });
    expect(mocks.write).toHaveBeenCalledWith({ invocationId: expect.stringMatching(/^[0-9a-f-]{36}$/), verifiedVendorId: 'original-a', correlationReference: undefined });
  });
  it('keeps distinct server invocation IDs even when the caller reuses its request ID', async () => {
    mocks.prepare.mockRejectedValue(new PayoutPreparationExhaustedError('a'));
    await request('/admin/payout-batches/prepare', 'POST'); await request('/admin/payout-batches/prepare', 'POST');
    expect(mocks.write.mock.calls[0][0].invocationId).not.toBe(mocks.write.mock.calls[1][0].invocationId);
  });
  it('preserves the original error if history storage fails and never retries payout', async () => {
    const error = new PayoutPreparationExhaustedError('a'); mocks.prepare.mockRejectedValue(error); mocks.write.mockRejectedValue(new Error('private SQL details'));
    const result = await request('/admin/payout-batches/prepare', 'POST');
    expect(result.json()).toEqual({ message: error.message }); expect(mocks.prepare).toHaveBeenCalledTimes(1);
  });
  it.each([new Error('business rejection'), new Error('Connection lost during commit'), new Error(new PayoutPreparationExhaustedError('a').message), new PayoutPreparationExhaustedError(null)])('does not record unqualified errors %#', async (error) => {
    mocks.prepare.mockRejectedValue(error); await request('/admin/payout-batches/prepare', 'POST'); expect(mocks.write).not.toHaveBeenCalled();
  });
  it.each(['success', 'recovered retry'])('does not record %s', async () => {
    mocks.prepare.mockResolvedValue({ id: 'batch' }); expect((await request('/admin/payout-batches/prepare', 'POST')).statusCode).toBe(200); expect(mocks.write).not.toHaveBeenCalled();
  });
  it('leaves the R1 route outside recording', async () => {
    mocks.r1.mockRejectedValue(new PayoutPreparationExhaustedError('a'));
    await request('/admin/payout-batches/prepare', 'POST', true); expect(mocks.prepare).not.toHaveBeenCalled(); expect(mocks.write).not.toHaveBeenCalled();
  });
  it.each(['/admin/payout-preparation-failures', '/admin/payout-preparation-failures/id'])('denies Vendor history access %s', async (path) => {
    mocks.role = 'vendor'; expect((await request(path)).statusCode).toBe(403); expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.detail).not.toHaveBeenCalled();
  });
  it('denies Vendor preparation before recording or invoking a financial service', async () => {
    mocks.role = 'vendor';
    expect((await request('/admin/payout-batches/prepare', 'POST')).statusCode).toBe(403);
    expect(mocks.prepare).not.toHaveBeenCalled(); expect(mocks.write).not.toHaveBeenCalled();
  });
  it('serves Global and exact Vendor history to Admin', async () => {
    mocks.list.mockResolvedValue({ items: [], nextCursor: null });
    expect((await request('/admin/payout-preparation-failures')).statusCode).toBe(200);
    await request('/admin/payout-preparation-failures?vendorId=a&limit=10');
    expect(mocks.list.mock.calls.map(([value]) => value)).toEqual([{ vendorId: undefined, limit: 25, cursor: undefined }, { vendorId: 'a', limit: 10, cursor: undefined }]);
  });
  it.each(['limit=0', 'limit=51', 'vendorId=', 'vendorId=a&vendorId=b', 'unexpected=x'])('rejects invalid query %s', async (query) => {
    expect((await request(`/admin/payout-preparation-failures?${query}`)).statusCode).toBe(400); expect(mocks.list).not.toHaveBeenCalled();
  });
  it('returns nonrevealing 404 for missing or out-of-filter detail', async () => {
    mocks.detail.mockResolvedValue(null); expect((await request('/admin/payout-preparation-failures/id?vendorId=b')).statusCode).toBe(404);
    expect(mocks.detail).toHaveBeenCalledWith('id', 'b');
  });
});
