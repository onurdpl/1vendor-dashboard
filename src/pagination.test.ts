import { describe, expect, it } from 'vitest';
import { resolvePagination } from '../backend/src/lib/pagination.js';

describe('pagination foundation', () => {
  it('uses safe defaults when query values are absent', () => {
    expect(resolvePagination({})).toEqual({ limit: 100, offset: 0 });
  });

  it('clamps limit and offset for query-safe list endpoints', () => {
    expect(resolvePagination({ limit: '1000', offset: '-10' })).toEqual({ limit: 250, offset: 0 });
    expect(resolvePagination({ limit: '25', offset: '50' })).toEqual({ limit: 25, offset: 50 });
  });

  it('accepts endpoint-specific defaults without allowing unbounded scans', () => {
    expect(resolvePagination({}, { limit: 500, offset: 10 })).toEqual({ limit: 250, offset: 10 });
  });
});
