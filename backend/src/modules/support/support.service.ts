import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import type { AuthUserContext } from '../auth/auth.types.js';
import type { RequestVendorContext } from '../vendor-access/vendor-access.types.js';
import type {
  AddSupportTicketNoteInput,
  CreateSupportTicketInput,
  SupportTicketCategory,
  SupportTicketContextType,
  SupportTicketDto,
  SupportTicketFilters,
  SupportTicketNoteDto,
  SupportTicketPriority,
  SupportTicketStatus,
  UpdateSupportTicketStatusInput,
} from './support.types.js';

const VALID_PRIORITIES = new Set<SupportTicketPriority>(['low', 'normal', 'high']);
const VALID_CONTEXT_TYPES = new Set<SupportTicketContextType>(['order', 'return', 'shipment', 'general']);
const VALID_STATUSES = new Set<SupportTicketStatus>(['OPEN', 'IN_REVIEW', 'WAITING_FOR_VENDOR', 'RESOLVED', 'CLOSED']);
const VALID_CATEGORIES = new Set<SupportTicketCategory>([
  'ORDER',
  'RETURN',
  'REFUND',
  'SHIPMENT',
  'TRACKING',
  'PAYOUT',
  'INVOICE',
  'OTHER',
]);
const UNRESOLVED_STATUSES = new Set<SupportTicketStatus>(['OPEN', 'IN_REVIEW', 'WAITING_FOR_VENDOR']);
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

function readStatus(value: unknown): SupportTicketStatus | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toUpperCase() as SupportTicketStatus;
  return VALID_STATUSES.has(normalized) ? normalized : null;
}

function readRequiredStatus(value: unknown): SupportTicketStatus {
  const status = readStatus(value);
  if (!status) {
    throw new SupportTicketError('Unsupported support ticket status.', 400);
  }
  return status;
}

function readCategory(value: unknown): SupportTicketCategory | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toUpperCase() as SupportTicketCategory;
  return VALID_CATEGORIES.has(normalized) ? normalized : null;
}

function readContextType(value: unknown): SupportTicketContextType {
  if (typeof value !== 'string') {
    return 'general';
  }

  const normalized = value.trim().toLowerCase() as SupportTicketContextType;
  return VALID_CONTEXT_TYPES.has(normalized) ? normalized : 'general';
}

function deriveCategory(contextType: SupportTicketContextType, explicitCategory: unknown): SupportTicketCategory {
  const category = readCategory(explicitCategory);
  if (category) {
    return category;
  }

  if (contextType === 'order') {
    return 'ORDER';
  }
  if (contextType === 'return') {
    return 'RETURN';
  }
  if (contextType === 'shipment') {
    return 'SHIPMENT';
  }
  return 'OTHER';
}

function normalizeStatus(value: string): SupportTicketStatus {
  const normalized = value.trim().toUpperCase();
  if (normalized === 'OPEN') {
    return 'OPEN';
  }
  if (normalized === 'IN_PROGRESS' || normalized === 'IN_REVIEW') {
    return 'IN_REVIEW';
  }
  if (normalized === 'WAITING_FOR_VENDOR') {
    return 'WAITING_FOR_VENDOR';
  }
  if (normalized === 'RESOLVED') {
    return 'RESOLVED';
  }
  if (normalized === 'CLOSED') {
    return 'CLOSED';
  }
  return 'OPEN';
}

function normalizeCategory(value: string | null | undefined): SupportTicketCategory {
  const normalized = value?.trim().toUpperCase() as SupportTicketCategory | undefined;
  return normalized && VALID_CATEGORIES.has(normalized) ? normalized : 'OTHER';
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

function mapNote(note: {
  id: string;
  supportTicketId: string;
  authorUserId: string;
  authorName: string;
  authorRole: string;
  content: string;
  createdAt: Date;
}): SupportTicketNoteDto {
  return {
    id: note.id,
    supportTicketId: note.supportTicketId,
    authorUserId: note.authorUserId,
    authorName: note.authorName,
    authorRole: note.authorRole,
    content: note.content,
    createdAt: note.createdAt.toISOString(),
  };
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
  category: string;
  contextType: string;
  contextId: string | null;
  contextSnapshot: Prisma.JsonValue | null;
  resolvedAt: Date | null;
  closedAt: Date | null;
  vendor?: { name: string } | null;
  notes?: Array<{
    id: string;
    supportTicketId: string;
    authorUserId: string;
    authorName: string;
    authorRole: string;
    content: string;
    createdAt: Date;
  }>;
}, options: { includeNotes?: boolean } = {}): SupportTicketDto {
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
    status: normalizeStatus(ticket.status),
    category: normalizeCategory(ticket.category),
    contextType: ticket.contextType as SupportTicketContextType,
    contextId: ticket.contextId,
    contextSnapshot: ticket.contextSnapshot,
    resolvedAt: ticket.resolvedAt?.toISOString() ?? null,
    closedAt: ticket.closedAt?.toISOString() ?? null,
    notes: options.includeNotes ? (ticket.notes ?? []).map(mapNote) : undefined,
  };
}

function readBool(value: unknown) {
  if (value === true || value === 'true' || value === '1') {
    return true;
  }
  return false;
}

function ticketMatchesSearch(ticket: ReturnType<typeof mapTicket>, search: string) {
  const haystack = [
    ticket.id,
    ticket.subject,
    ticket.message,
    ticket.vendorId,
    ticket.vendorName,
    ticket.contextType,
    ticket.contextId,
    JSON.stringify(ticket.contextSnapshot ?? {}),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return haystack.includes(search.toLowerCase());
}

function applyFilters(tickets: SupportTicketDto[], filters: SupportTicketFilters = {}) {
  const status = readStatus(filters.status);
  const category = readCategory(filters.category);
  const priority = typeof filters.priority === 'string' && VALID_PRIORITIES.has(filters.priority.toLowerCase() as SupportTicketPriority)
    ? filters.priority.toLowerCase()
    : null;
  const search = readOptionalText(filters.search, 200);
  const unresolvedOnly = readBool(filters.unresolvedOnly);

  return tickets.filter((ticket) => {
    if (status && ticket.status !== status) {
      return false;
    }
    if (category && ticket.category !== category) {
      return false;
    }
    if (priority && ticket.priority !== priority) {
      return false;
    }
    if (unresolvedOnly && !UNRESOLVED_STATUSES.has(ticket.status)) {
      return false;
    }
    if (search && !ticketMatchesSearch(ticket, search)) {
      return false;
    }
    return true;
  });
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
  const category = deriveCategory(contextType, input.category);

  await assertContextBelongsToVendor(contextType, contextId, vendorContext.vendorId);

  const ticket = await prisma.supportTicket.create({
    data: {
      createdByUserId: authUser.id,
      createdByRole: authUser.role,
      vendorId: vendorContext.vendorId,
      subject,
      message,
      priority,
      status: 'OPEN',
      category,
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

export async function listAdminSupportTickets(filters: SupportTicketFilters = {}): Promise<SupportTicketDto[]> {
  const tickets = await prisma.supportTicket.findMany({
    include: {
      vendor: {
        select: { name: true },
      },
    },
    orderBy: {
      updatedAt: 'desc',
    },
    take: 250,
  });

  return applyFilters(tickets.map((ticket) => mapTicket(ticket)), filters);
}

export async function listVendorSupportTickets(vendorId: string, filters: SupportTicketFilters = {}): Promise<SupportTicketDto[]> {
  const tickets = await prisma.supportTicket.findMany({
    where: { vendorId },
    include: {
      vendor: {
        select: { name: true },
      },
    },
    orderBy: {
      updatedAt: 'desc',
    },
    take: 100,
  });

  return applyFilters(tickets.map((ticket) => mapTicket(ticket)), filters);
}

export async function getAdminSupportTicket(ticketId: string): Promise<SupportTicketDto | null> {
  const ticket = await prisma.supportTicket.findUnique({
    where: { id: ticketId },
    include: {
      vendor: {
        select: { name: true },
      },
      notes: {
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  return ticket ? mapTicket(ticket, { includeNotes: true }) : null;
}

export async function getVendorSupportTicket(ticketId: string, vendorId: string): Promise<SupportTicketDto | null> {
  const ticket = await prisma.supportTicket.findFirst({
    where: {
      id: ticketId,
      vendorId,
    },
    include: {
      vendor: {
        select: { name: true },
      },
    },
  });

  return ticket ? mapTicket(ticket, { includeNotes: false }) : null;
}

export async function updateAdminSupportTicketStatus(ticketId: string, input: UpdateSupportTicketStatusInput): Promise<SupportTicketDto> {
  const status = readRequiredStatus(input.status);
  const now = new Date();
  const ticket = await prisma.supportTicket.update({
    where: { id: ticketId },
    data: {
      status,
      resolvedAt: status === 'RESOLVED' ? now : status === 'OPEN' || status === 'IN_REVIEW' || status === 'WAITING_FOR_VENDOR' ? null : undefined,
      closedAt: status === 'CLOSED' ? now : status === 'OPEN' || status === 'IN_REVIEW' || status === 'WAITING_FOR_VENDOR' ? null : undefined,
    },
    include: {
      vendor: {
        select: { name: true },
      },
      notes: {
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  return mapTicket(ticket, { includeNotes: true });
}

export async function addAdminSupportTicketNote(
  ticketId: string,
  authUser: AuthUserContext,
  input: AddSupportTicketNoteInput,
): Promise<SupportTicketNoteDto> {
  const content = readText(input.content, 'Note', 2000);
  const ticket = await prisma.supportTicket.findUnique({
    where: { id: ticketId },
    select: { id: true },
  });
  if (!ticket) {
    throw new SupportTicketError('Support ticket not found.', 404);
  }

  const note = await prisma.supportTicketNote.create({
    data: {
      supportTicketId: ticketId,
      authorUserId: authUser.id,
      authorName: authUser.name,
      authorRole: authUser.role,
      content,
    },
  });

  return mapNote(note);
}
