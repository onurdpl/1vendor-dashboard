import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  vendor: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  vendorProfileAuditLog: {
    createMany: vi.fn(),
    findFirst: vi.fn(),
  },
}));

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: prismaMock,
}));

const { getVendorStatus, updateVendorStatus } = await import(
  '../backend/src/modules/vendors/vendor-status.service.js'
);

const actor = {
  userId: 'admin-user-1',
  email: 'admin@example.test',
};

function vendorRecord(status = 'inactive') {
  return {
    id: 'vendor-a',
    name: 'Vendor A',
    status,
    restrictionReason: status === 'active' ? null : 'Operational review',
    restrictedByUserId: status === 'active' ? null : 'admin-user-1',
    restrictedAt: status === 'active' ? null : new Date('2026-06-30T12:00:00.000Z'),
  };
}

function statusAudit(reason: string | null, overrides: Record<string, unknown> = {}) {
  return {
    id: 'audit-status-1',
    vendorId: 'vendor-a',
    section: 'vendor_status',
    fieldName: 'status',
    oldValue: 'inactive',
    newValue: 'inactive',
    changedByUserId: 'admin-user-1',
    changedByEmail: 'admin@example.test',
    changedAt: new Date('2026-06-30T12:00:00.000Z'),
    reason,
    snapshotImpact: 'UNKNOWN',
    source: 'admin_vendor_status_update',
    ...overrides,
  };
}

describe('vendor status service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.vendorProfileAuditLog.createMany.mockResolvedValue({ count: 0 });
    prismaMock.vendorProfileAuditLog.findFirst.mockResolvedValue(null);
    prismaMock.vendor.findUnique.mockResolvedValue(vendorRecord('active'));
    prismaMock.vendor.update.mockResolvedValue(vendorRecord('active'));
  });

  it('allows active status to be saved without a restriction reason', async () => {
    const result = await updateVendorStatus('vendor-a', { status: 'active' }, { actor });

    expect(prismaMock.vendor.update).toHaveBeenCalledWith({
      where: { id: 'vendor-a' },
      data: {
        status: 'active',
        restrictionReason: null,
        restrictedByUserId: null,
        restrictedAt: null,
      },
      select: {
        id: true,
        name: true,
        status: true,
        restrictionReason: true,
        restrictedByUserId: true,
        restrictedAt: true,
      },
    });
    expect(prismaMock.vendorProfileAuditLog.createMany).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        vendorId: 'vendor-a',
        status: 'active',
        restricted: false,
        restrictionReason: null,
      }),
    );
  });

  it('requires a restriction reason when saving inactive status', async () => {
    await expect(updateVendorStatus('vendor-a', { status: 'inactive' }, { actor })).rejects.toThrow(
      'status reason is required.',
    );

    expect(prismaMock.vendor.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.vendor.update).not.toHaveBeenCalled();
    expect(prismaMock.vendorProfileAuditLog.createMany).not.toHaveBeenCalled();
  });

  it('updates current Vendor restriction fields and audit history when restricting a vendor', async () => {
    prismaMock.vendor.findUnique.mockResolvedValue(vendorRecord('active'));
    prismaMock.vendor.update.mockResolvedValue({
      ...vendorRecord('inactive'),
      restrictionReason: 'Operational review',
      restrictedByUserId: 'admin-user-1',
      restrictedAt: new Date('2026-07-01T10:00:00.000Z'),
    });

    const result = await updateVendorStatus(
      'vendor-a',
      { status: 'inactive', reason: 'Operational review' },
      { actor },
    );

    expect(prismaMock.vendor.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'inactive',
          restrictionReason: 'Operational review',
          restrictedByUserId: 'admin-user-1',
          restrictedAt: expect.any(Date),
        }),
      }),
    );
    expect(prismaMock.vendorProfileAuditLog.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          vendorId: 'vendor-a',
          section: 'vendor_status',
          fieldName: 'status',
          oldValue: 'active',
          newValue: 'inactive',
          reason: 'Operational review',
          source: 'admin_vendor_status_update',
        }),
      ],
    });
    expect(result).toEqual(
      expect.objectContaining({
        status: 'inactive',
        restricted: true,
        restrictionReason: 'Operational review',
        changedByUserId: 'admin-user-1',
        changedAt: '2026-07-01T10:00:00.000Z',
      }),
    );
  });

  it('creates a status audit row when only the restriction reason changes', async () => {
    const existing = vendorRecord('inactive');
    const updated = {
      ...existing,
      restrictionReason: 'Finance review',
      restrictedAt: new Date('2026-07-01T10:00:00.000Z'),
    };
    prismaMock.vendor.findUnique.mockResolvedValue(existing);
    prismaMock.vendor.update.mockResolvedValue(updated);

    const result = await updateVendorStatus(
      'vendor-a',
      { status: 'inactive', reason: 'Finance review' },
      { actor },
    );

    expect(prismaMock.vendor.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'inactive',
          restrictionReason: 'Finance review',
          restrictedByUserId: 'admin-user-1',
          restrictedAt: expect.any(Date),
        }),
      }),
    );
    expect(prismaMock.vendorProfileAuditLog.createMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.vendorProfileAuditLog.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          vendorId: 'vendor-a',
          section: 'vendor_status',
          fieldName: 'status',
          oldValue: 'inactive',
          newValue: 'inactive',
          changedByUserId: 'admin-user-1',
          changedByEmail: 'admin@example.test',
          reason: 'Finance review',
          snapshotImpact: 'UNKNOWN',
          source: 'admin_vendor_status_update',
        }),
      ],
    });
    expect(result.restrictionReason).toBe('Finance review');
  });

  it('does not create duplicate status audit rows when status and reason are unchanged', async () => {
    const existing = vendorRecord('inactive');
    prismaMock.vendor.findUnique.mockResolvedValue(existing);
    prismaMock.vendor.update.mockResolvedValue(existing);

    const result = await updateVendorStatus(
      'vendor-a',
      { status: 'inactive', reason: 'Operational review' },
      { actor },
    );

    expect(prismaMock.vendorProfileAuditLog.createMany).not.toHaveBeenCalled();
    expect(prismaMock.vendor.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'inactive',
          restrictionReason: 'Operational review',
          restrictedByUserId: 'admin-user-1',
          restrictedAt: existing.restrictedAt,
        }),
      }),
    );
    expect(result.restrictionReason).toBe('Operational review');
  });

  it('clears current restriction fields when activating a vendor', async () => {
    prismaMock.vendor.findUnique.mockResolvedValue(vendorRecord('inactive'));
    prismaMock.vendor.update.mockResolvedValue(vendorRecord('active'));

    const result = await updateVendorStatus('vendor-a', { status: 'active' }, { actor });

    expect(prismaMock.vendor.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          status: 'active',
          restrictionReason: null,
          restrictedByUserId: null,
          restrictedAt: null,
        },
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        status: 'active',
        restricted: false,
        restrictionReason: null,
        changedByUserId: null,
        changedAt: null,
      }),
    );
  });

  it('returns current restriction state from the Vendor record instead of audit history', async () => {
    prismaMock.vendor.findUnique.mockResolvedValue({
      ...vendorRecord('inactive'),
      restrictionReason: 'Finance review',
      restrictedByUserId: 'admin-user-2',
      restrictedAt: new Date('2026-07-01T10:00:00.000Z'),
    });
    prismaMock.vendorProfileAuditLog.findFirst.mockResolvedValue(statusAudit('Stale audit reason'));

    const result = await getVendorStatus('vendor-a');

    expect(prismaMock.vendorProfileAuditLog.findFirst).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        status: 'inactive',
        restricted: true,
        restrictionReason: 'Finance review',
        changedByUserId: 'admin-user-2',
        changedAt: '2026-07-01T10:00:00.000Z',
      }),
    );
  });

  it('backfills current Vendor restriction fields from the latest status audit migration', () => {
    const migration = readFileSync(
      join(process.cwd(), 'backend/prisma/migrations/20260702153000_add_vendor_current_restriction_state/migration.sql'),
      'utf8',
    );

    expect(migration).toContain('ADD COLUMN "restrictionReason" TEXT');
    expect(migration).toContain('ADD COLUMN "restrictedByUserId" TEXT');
    expect(migration).toContain('ADD COLUMN "restrictedAt" TIMESTAMP(3)');
    expect(migration).toContain('SELECT DISTINCT ON ("vendorId")');
    expect(migration).toContain('FROM "VendorProfileAuditLog"');
    expect(migration).toContain('UPDATE "Vendor" AS vendor');
    expect(migration).toContain('"fieldName" = \'status\'');
    expect(migration).toContain('LOWER(COALESCE(vendor."status", \'active\')) <> \'active\'');
  });
});
