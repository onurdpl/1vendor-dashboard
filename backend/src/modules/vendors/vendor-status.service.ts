import { VendorProfileSnapshotImpact } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import {
  auditVendorProfileChanges,
  type VendorProfileAuditActor,
} from './vendor-profile-audit-log.service.js';
import { isVendorRestrictedStatus } from '../vendor-access/restricted-vendor.js';

const SUPPORTED_VENDOR_STATUSES = new Set(['active', 'inactive']);
const MAX_STATUS_REASON_LENGTH = 500;

export type VendorStatusDto = {
  vendorId: string;
  vendorName: string;
  status: string;
  restricted: boolean;
  restrictionReason: string | null;
  changedByUserId: string | null;
  changedByEmail: string | null;
  changedAt: string | null;
};

export type VendorStatusUpdateInputDto = {
  status?: unknown;
  reason?: unknown;
};

type VendorRestrictionStateRecord = {
  id: string;
  name: string;
  status: string;
  restrictionReason: string | null;
  restrictedByUserId: string | null;
  restrictedAt: Date | null;
};

function normalizeVendorStatus(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('status is required.');
  }

  const normalized = value.trim().toLowerCase() === 'restricted' ? 'inactive' : value.trim().toLowerCase();
  if (!SUPPORTED_VENDOR_STATUSES.has(normalized)) {
    throw new Error('status must be active or inactive.');
  }

  return normalized;
}

function normalizeStatusReason(value: unknown, status: string) {
  if (!isVendorRestrictedStatus(status)) {
    return null;
  }

  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('status reason is required.');
  }

  const reason = value.trim();
  if (reason.length > MAX_STATUS_REASON_LENGTH) {
    throw new Error(`status reason must be ${MAX_STATUS_REASON_LENGTH} characters or fewer.`);
  }

  return reason;
}

function mapVendorStatus(vendor: VendorRestrictionStateRecord): VendorStatusDto {
  const restricted = isVendorRestrictedStatus(vendor.status);
  return {
    vendorId: vendor.id,
    vendorName: vendor.name,
    status: vendor.status,
    restricted,
    restrictionReason: restricted ? vendor.restrictionReason ?? null : null,
    changedByUserId: restricted ? vendor.restrictedByUserId ?? null : null,
    changedByEmail: null,
    changedAt: restricted ? vendor.restrictedAt?.toISOString() ?? null : null,
  };
}

async function createReasonOnlyStatusAudit(input: {
  vendorId: string;
  status: string;
  reason: string;
  actor?: VendorProfileAuditActor | null;
}) {
  await prisma.vendorProfileAuditLog.createMany({
    data: [
      {
        vendorId: input.vendorId,
        section: 'vendor_status',
        fieldName: 'status',
        oldValue: input.status,
        newValue: input.status,
        changedByUserId: input.actor?.userId ?? null,
        changedByEmail: input.actor?.email ?? null,
        reason: input.reason,
        snapshotImpact: VendorProfileSnapshotImpact.UNKNOWN,
        source: 'admin_vendor_status_update',
      },
    ],
  });
}

export async function getVendorStatus(vendorId: string): Promise<VendorStatusDto> {
  const vendor = await prisma.vendor.findUnique({
    where: {
      id: vendorId,
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

  if (!vendor) {
    throw new Error('Vendor could not be found.');
  }

  return mapVendorStatus(vendor);
}

export async function updateVendorStatus(
  vendorId: string,
  input: VendorStatusUpdateInputDto,
  auditContext: {
    actor?: VendorProfileAuditActor | null;
  } = {},
): Promise<VendorStatusDto> {
  const status = normalizeVendorStatus(input.status);
  const reason = normalizeStatusReason(input.reason, status);
  const existing = await prisma.vendor.findUnique({
    where: {
      id: vendorId,
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

  if (!existing) {
    throw new Error('Vendor could not be found.');
  }

  const statusChanged = existing.status !== status;
  const reasonChanged = reason !== null && existing.restrictionReason !== reason;
  const restricted = isVendorRestrictedStatus(status);
  const restrictedAt = statusChanged || reasonChanged ? new Date() : existing.restrictedAt;

  const updated = await prisma.vendor.update({
    where: {
      id: vendorId,
    },
    data: {
      status,
      restrictionReason: restricted ? reason : null,
      restrictedByUserId: restricted ? auditContext.actor?.userId ?? existing.restrictedByUserId : null,
      restrictedAt: restricted ? restrictedAt : null,
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

  await auditVendorProfileChanges({
    vendorId,
    section: 'vendor_status',
    before: existing,
    after: updated,
    fields: ['status'],
    actor: auditContext.actor,
    reason,
    source: 'admin_vendor_status_update',
  });

  if (!statusChanged && reasonChanged) {
    await createReasonOnlyStatusAudit({
      vendorId,
      status,
      reason,
      actor: auditContext.actor,
    });
  }

  return mapVendorStatus(updated);
}

export const __vendorStatusTesting = {
  normalizeVendorStatus,
  normalizeStatusReason,
};
