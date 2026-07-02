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
      data: { status: 'active' },
      select: {
        id: true,
        name: true,
        status: true,
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

  it('creates a status audit row when only the restriction reason changes', async () => {
    prismaMock.vendor.findUnique
      .mockResolvedValueOnce(vendorRecord('inactive'))
      .mockResolvedValueOnce(vendorRecord('inactive'));
    prismaMock.vendor.update.mockResolvedValue(vendorRecord('inactive'));
    prismaMock.vendorProfileAuditLog.findFirst
      .mockResolvedValueOnce(statusAudit('Operational review'))
      .mockResolvedValueOnce(statusAudit('Finance review'));

    const result = await updateVendorStatus(
      'vendor-a',
      { status: 'inactive', reason: 'Finance review' },
      { actor },
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
    prismaMock.vendor.findUnique
      .mockResolvedValueOnce(vendorRecord('inactive'))
      .mockResolvedValueOnce(vendorRecord('inactive'));
    prismaMock.vendor.update.mockResolvedValue(vendorRecord('inactive'));
    prismaMock.vendorProfileAuditLog.findFirst
      .mockResolvedValueOnce(statusAudit('Operational review'))
      .mockResolvedValueOnce(statusAudit('Operational review'));

    const result = await updateVendorStatus(
      'vendor-a',
      { status: 'inactive', reason: 'Operational review' },
      { actor },
    );

    expect(prismaMock.vendorProfileAuditLog.createMany).not.toHaveBeenCalled();
    expect(result.restrictionReason).toBe('Operational review');
  });

  it('returns the latest restriction reason when reading vendor status', async () => {
    prismaMock.vendor.findUnique.mockResolvedValue(vendorRecord('inactive'));
    prismaMock.vendorProfileAuditLog.findFirst.mockResolvedValue(statusAudit('Finance review'));

    const result = await getVendorStatus('vendor-a');

    expect(prismaMock.vendorProfileAuditLog.findFirst).toHaveBeenCalledWith({
      where: {
        vendorId: 'vendor-a',
        section: 'vendor_status',
        fieldName: 'status',
      },
      orderBy: {
        changedAt: 'desc',
      },
    });
    expect(result).toEqual(
      expect.objectContaining({
        status: 'inactive',
        restricted: true,
        restrictionReason: 'Finance review',
      }),
    );
  });
});
