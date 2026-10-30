import { beforeEach, expect, it, vi } from 'vitest';
import { apiClient } from '../../lib/api-client';
import { listSettlementHistory, listSettlementPeriods, getSettlementWorkflowCounts, listSettlementApprovals } from './settlementApprovalsApi';
vi.mock('../../lib/api-client', () => ({ apiClient: { get: vi.fn() } }));
beforeEach(() => vi.clearAllMocks());
it('passes typed full Search/filter/cursor inputs and AbortSignal losslessly', () => {
  const signal = new AbortController().signal;
  listSettlementHistory('vendor A', { limit: 20, cursor: 'opaque', search: 'İ_%', searchVendorName: 'Workspace',
    status: 'draft', periodKey: 'all', workflow: 'ready_for_approval', highValueOnly: true }, signal);
  const [url, options] = vi.mocked(apiClient.get).mock.calls[0];
  const query = new URL(String(url), 'http://local').searchParams;
  expect(Object.fromEntries(query)).toEqual({ vendorId: 'vendor A', pagination: 'cursor', limit: '20', cursor: 'opaque',
    search: 'İ_%', searchVendorName: 'Workspace', status: 'draft', periodKey: 'all', workflow: 'ready_for_approval', highValueOnly: 'true' });
  expect(options?.signal).toBe(signal);
});
it('metadata and counts send only their independent Vendor-scoped contracts', () => {
  listSettlementPeriods('A', { limit: 20, cursor: 'p' }); getSettlementWorkflowCounts('A');
  expect(vi.mocked(apiClient.get).mock.calls.map(call => call[0])).toEqual([
    '/admin/finance/settlement-approvals/periods?vendorId=A&limit=20&cursor=p',
    '/admin/finance/settlement-approvals/workflow-counts?vendorId=A',
  ]);
});
it('preserves legacy recent20 wrapper for action authority', () => {
  listSettlementApprovals('A');
  expect(apiClient.get).toHaveBeenCalledWith('/admin/finance/settlement-approvals?vendorId=A');
});
