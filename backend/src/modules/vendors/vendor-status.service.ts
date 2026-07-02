import { VendorProfileSnapshotImpact } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import {
  auditVendorProfileChanges,
  type VendorProfileAuditActor,
  type VendorProfileAuditLogDto,
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

async function findLatestStatusAudit(vendorId: string): Promise<VendorProfileAuditLogDto | null> {
  const log = await prisma.vendorProfileAuditLog.findFirst({
    where: {
      vendorId,
      section: 'vendor_status',
      fieldName: 'status',
    },
    orderBy: {
      changedAt: 'desc',
    },
  });

  if (!log) {
    return null;
  }

  return {
    id: log.id,
    vendorId: log.vendorId,
    section: log.section,
    fieldName: log.fieldName,
    oldValue: log.oldValue,
    newValue: log.newValue,
    changedByUserId: log.changedByUserId,
    changedByEmail: log.changedByEmail,
    changedAt: log.changedAt.toISOString(),
    reason: log.reason,
    snapshotImpact: log.snapshotImpact,
    source: log.source,
  };
}

function mapVendorStatus(
  vendor: { id: string; name: string; status: string },
  statusAudit: VendorProfileAuditLogDto | null,
): VendorStatusDto {
  const restricted = isVendorRestrictedStatus(vendor.status);
  return {
    vendorId: vendor.id,
    vendorName: vendor.name,
    status: vendor.status,
    restricted,
    restrictionReason: restricted ? statusAudit?.reason ?? null : null,
    changedByUserId: statusAudit?.changedByUserId ?? null,
    changedByEmail: statusAudit?.changedByEmail ?? null,
    changedAt: statusAudit?.changedAt ?? null,
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
    },
  });

  if (!vendor) {
    throw new Error('Vendor could not be found.');
  }

  return mapVendorStatus(vendor, await findLatestStatusAudit(vendorId));
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
    },
  });

  if (!existing) {
    throw new Error('Vendor could not be found.');
  }

  const latestStatusAudit = await findLatestStatusAudit(vendorId);
  const statusChanged = existing.status !== status;
  const reasonChanged = reason !== null && latestStatusAudit?.reason !== reason;

  const updated = await prisma.vendor.update({
    where: {
      id: vendorId,
    },
    data: {
      status,
    },
    select: {
      id: true,
      name: true,
      status: true,
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

  return getVendorStatus(vendorId);
}

export const __vendorStatusTesting = {
  normalizeVendorStatus,
  normalizeStatusReason,
};
