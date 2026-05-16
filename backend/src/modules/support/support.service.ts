import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import type { AuthUserContext } from '../auth/auth.types.js';
import type { RequestVendorContext } from '../vendor-access/vendor-access.types.js';
import type {
  CreateSupportTicketInput,
  SupportTicketContextType,
  SupportTicketDto,
  SupportTicketPriority,
  SupportTicketStatus,
} from './support.types.js';

const VALID_PRIORITIES = new Set<SupportTicketPriority>(['low', 'normal', 'high']);
const VALID_CONTEXT_TYPES = new Set<SupportTicketContextType>(['order', 'return', 'shipment', 'general']);
const SENSITIVE_KEY_PATTERN = /(address|phone|email|token|secret|password|payload|hmac|authorization|customer)/i;

export class SupportTicketError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message);
  }
}

function readText(value: unknown, field: string, maxLength: number) {
  if (typeof value !== 'string') {
    throw new SupportTicketError(`${field} is required.`, 400);
  }

  const text = value.trim();
  if (!text) {
    throw new SupportTicketError(`${field} is required.`, 400);
  }

  return text.slice(0, maxLength);
}

function readOptionalText(value: unknown, maxLength: number) {
  if (typeof value !== 'string') {
    return null;
  }

  const text = value.trim();
  return text ? text.slice(0, maxLength) : null;
}

function readPriority(value: unknown): SupportTicketPriority {
  if (typeof value !== 'string') {
    return 'normal';
  }

  const normalized = value.trim().toLowerCase() as SupportTicketPriority;
  return VALID_PRIORITIES.has(normalized) ? normalized : 'normal';
}

function readContextType(value: unknown): SupportTicketContextType {
  if (typeof value !== 'string') {
    return 'general';
  }

  const normalized = value.trim().toLowerCase() as SupportTicketContextType;
  return VALID_CONTEXT_TYPES.has(normalized) ? normalized : 'general';
}

function sanitizeSnapshotValue(value: unknown, depth = 0): unknown {
  if (depth > 4) {
    return '[truncated]';
  }

  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    return value;
  }

  if (typeof value === 'string') {
    return value.slice(0, 500);
  }

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeSnapshotValue(item, depth + 1));
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !SENSITIVE_KEY_PATTERN.test(key))
      .slice(0, 40)
      .map(([key, entryValue]) => [key, sanitizeSnapshotValue(entryValue, depth + 1)] as const);
    return Object.fromEntries(entries);
  }

  return null;
}

export function sanitizeSupportContextSnapshot(value: unknown): Prisma.InputJsonValue | null {
  if (value === undefined || value === null) {
    return null;
  }

  return sanitizeSnapshotValue(value) as Prisma.InputJsonValue;
}

async function assertContextBelongsToVendor(contextType: SupportTicketContextType, contextId: string | null, vendorId: string) {
  if (!contextId || contextType === 'general') {
    return;
  }

  if (contextType === 'order') {
    const allocation = await prisma.vendorAllocation.findFirst({
      where: {
        id: contextId,
        assignedVendorId: vendorId,
      },
      select: { id: true },
    });
    if (!allocation) {
      throw new SupportTicketError('Support context is not available for this vendor.', 403);
    }
    return;
  }

  if (contextType === 'return') {
    const returnRecord = await prisma.returnRecord.findFirst({
      where: {
        id: contextId,
        vendorAllocation: {
          assignedVendorId: vendorId,
        },
      },
      select: { id: true },
    });
    if (!returnRecord) {
      throw new SupportTicketError('Support context is not available for this vendor.', 403);
    }
    return;
  }

  if (contextType === 'shipment') {
    const shipment = await prisma.shipmentExecution.findFirst({
      where: {
        id: contextId,
        vendorId,
      },
      select: { id: true },
    });
    if (!shipment) {
      throw new SupportTicketError('Support context is not available for this vendor.', 403);
    }
  }
}

function mapTicket(ticket: {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  createdByUserId: string;
  createdByRole: string;
  vendorId: string;
  subject: string;
  message: string;
  priority: string;
  status: string;
  contextType: string;
  contextId: string | null;
  contextSnapshot: Prisma.JsonValue | null;
  vendor?: { name: string } | null;
}): SupportTicketDto {
  return {
    id: ticket.id,
    createdAt: ticket.createdAt.toISOString(),
    updatedAt: ticket.updatedAt.toISOString(),
    createdByUserId: ticket.createdByUserId,
    createdByRole: ticket.createdByRole,
    vendorId: ticket.vendorId,
    vendorName: ticket.vendor?.name ?? null,
    subject: ticket.subject,
    message: ticket.message,
    priority: ticket.priority as SupportTicketPriority,
    status: ticket.status as SupportTicketStatus,
    contextType: ticket.contextType as SupportTicketContextType,
    contextId: ticket.contextId,
    contextSnapshot: ticket.contextSnapshot,
  };
}

export async function createSupportTicket(
  authUser: AuthUserContext,
  vendorContext: RequestVendorContext,
  input: CreateSupportTicketInput,
): Promise<SupportTicketDto> {
  const subject = readText(input.subject, 'Subject', 160);
  const message = readText(input.message, 'Message', 2000);
  const priority = readPriority(input.priority);
  const contextType = readContextType(input.contextType);
  const contextId = readOptionalText(input.contextId, 160);

  await assertContextBelongsToVendor(contextType, contextId, vendorContext.vendorId);

  const ticket = await prisma.supportTicket.create({
    data: {
      createdByUserId: authUser.id,
      createdByRole: authUser.role,
      vendorId: vendorContext.vendorId,
      subject,
      message,
      priority,
      status: 'open',
      contextType,
      contextId,
      contextSnapshot: sanitizeSupportContextSnapshot(input.contextSnapshot) ?? Prisma.JsonNull,
    },
    include: {
      vendor: {
        select: { name: true },
      },
    },
  });

  return mapTicket(ticket);
}

export async function listAdminSupportTickets(): Promise<SupportTicketDto[]> {
  const tickets = await prisma.supportTicket.findMany({
    include: {
      vendor: {
        select: { name: true },
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
    take: 100,
  });

  return tickets.map(mapTicket);
}
