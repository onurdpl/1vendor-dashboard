import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(resolve(process.cwd(), 'backend/prisma/schema.prisma'), 'utf8');
const migration = readFileSync(resolve(
  process.cwd(),
  'backend/prisma/migrations/20260923120000_add_terminal_conflict_evidence/migration.sql',
), 'utf8');

describe('terminal conflict evidence persistence schema', () => {
  it('keeps old reviews valid through an optional one-to-one evidence relation', () => {
    expect(schema).toContain('incomingConflictEvidence           RefundTerminalConflictEvidence?');
    expect(schema).toMatch(/reviewId\s+String\s+@unique/);
    expect(migration).not.toMatch(/UPDATE\s+"RefundTerminalEvidenceReview"/i);
    expect(migration).not.toMatch(/ALTER TABLE "RefundTerminalEvidenceReview"\s+ADD COLUMN/i);
  });

  it('stores the normalized authority, versions, amount, currency, and proven lineage', () => {
    for (const field of [
      'sourceShopifyRefundId', 'sourceShopifyOrderId', 'vendorAllocationId', 'economicVendorId',
      'historicalSaleFinanceLedgerEntryId', 'supersededSaleLedgerIdsJson', 'refundTotalAmount',
      'currency', 'normalizedEvidenceJson', 'evidenceHash', 'hashAlgorithm', 'evidenceVersion',
      'normalizationVersion',
    ]) {
      expect(schema).toContain(field);
    }
  });

  it('prevents duplicate replacement and cascading deletion at the database boundary', () => {
    expect(migration).toContain('CREATE UNIQUE INDEX "RefundTerminalConflictEvidence_reviewId_key"');
    expect(migration).toContain('ON DELETE RESTRICT');
    expect(migration).not.toMatch(/UPDATE\s+"RefundTerminalConflictEvidence"/i);
    expect(migration).not.toContain('ON DELETE CASCADE');
  });
});
