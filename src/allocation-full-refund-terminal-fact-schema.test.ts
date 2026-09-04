import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(join(process.cwd(), 'backend/prisma/schema.prisma'), 'utf8');
const migration = readFileSync(
  join(
    process.cwd(),
    'backend/prisma/migrations/20260904120000_add_allocation_full_refund_terminal_fact/migration.sql',
  ),
  'utf8',
);
const appSource = readFileSync(join(process.cwd(), 'backend/src/app.ts'), 'utf8');

describe('allocation full-refund terminal fact schema foundation', () => {
  it('matches the authoritative Prisma model and allocation relation', () => {
    const model = schema.match(/model AllocationFullRefundTerminalFact \{[\s\S]*?\n\}/)?.[0] ?? '';

    expect(schema).toContain('fullRefundTerminalFact                 AllocationFullRefundTerminalFact?');
    expect(model).toMatch(/id\s+String\s+@id @default\(cuid\(\)\)/);
    expect(model).toMatch(/vendorAllocationId\s+String\s+@unique/);
    expect(model).toMatch(/shopifyOrderGid\s+String/);
    expect(model).toMatch(/verificationSource\s+String/);
    expect(model).toMatch(/shopifyApiVersion\s+String/);
    expect(model).toMatch(/verifiedAt\s+DateTime\s+@default\(now\(\)\)/);
    expect(model).toMatch(/evidenceJson\s+Json/);
    expect(model).toMatch(/onDelete: Restrict, onUpdate: Cascade/);
    expect(model).toContain('@@index([shopifyOrderGid])');
    expect(model).not.toContain('updatedAt');
  });

  it('uses an additive migration with the approved constraints', () => {
    expect(migration).toContain('CREATE TABLE "AllocationFullRefundTerminalFact"');
    expect(migration).toContain('"id" TEXT NOT NULL');
    expect(migration).toContain('"vendorAllocationId" TEXT NOT NULL');
    expect(migration).toContain('"shopifyOrderGid" TEXT NOT NULL');
    expect(migration).toContain('"verificationSource" TEXT NOT NULL');
    expect(migration).toContain('"shopifyApiVersion" TEXT NOT NULL');
    expect(migration).toContain('"verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP');
    expect(migration).toContain('"evidenceJson" JSONB NOT NULL');
    expect(migration).toContain('CONSTRAINT "AllocationFullRefundTerminalFact_pkey"');
    expect(migration).toContain('PRIMARY KEY ("id")');
    expect(migration).toContain('"AllocationFullRefundTerminalFact_vendorAllocationId_key"');
    expect(migration).toContain('"AllocationFullRefundTerminalFact_shopifyOrderGid_idx"');
    expect(migration).toContain('REFERENCES "VendorAllocation"("id")');
    expect(migration).toMatch(/ON DELETE RESTRICT\s+ON UPDATE CASCADE/);
    expect(migration).not.toMatch(/^\s*(?:UPDATE|INSERT\s+INTO|DELETE\s+FROM|DROP|TRUNCATE)\b/im);
    expect(migration).not.toContain('AllocationStatus');
  });

  it('registers the migration-critical allocation column with schema readiness', () => {
    expect(appSource).toContain("tableName: 'AllocationFullRefundTerminalFact'");
    expect(appSource).toContain("columnName: 'vendorAllocationId'");
    expect(appSource).toContain("migration: '20260904120000_add_allocation_full_refund_terminal_fact'");
  });
});
