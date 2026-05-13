import { describe, expect, it } from 'vitest';
import { __financeStatusMapping } from './finance';

describe('finance status mapping', () => {
  it('maps hold records to Recorded instead of Failed', () => {
    expect(__financeStatusMapping.mapRecordStatusLabel('hold')).toBe('Recorded');
    expect(__financeStatusMapping.mapTransactionStatus('hold')).toBe('Recorded');
  });

  it('keeps actual failed statuses as Failed', () => {
    expect(__financeStatusMapping.mapRecordStatusLabel('failed')).toBe('Failed');
    expect(__financeStatusMapping.mapRecordStatusLabel('error')).toBe('Failed');
    expect(__financeStatusMapping.mapTransactionStatus('failed')).toBe('Failed');
  });

  it('keeps completed and reconciled semantics', () => {
    expect(__financeStatusMapping.mapRecordStatusLabel('processed')).toBe('Completed');
    expect(__financeStatusMapping.mapRecordStatusLabel('reconciled')).toBe('Reconciled');
  });
});
