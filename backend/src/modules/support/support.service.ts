import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import type { AuthUserContext } from '../auth/auth.types.js';
import type { RequestVendorContext } from '../vendor-access/vendor-access.types.js';
import type {
  AddSupportTicketReplyInput,
  AddSupportTicketNoteInput,
  CreateSupportTicketInput,
  SupportTicketCategory,
  SupportTicketContextType,
  SupportTicketContextSummaryDto,
  SupportTicketDto,
  SupportTicketFilters,
  SupportTicketNoteDto,
  SupportTicketPriority,
  SupportTicketReplyDto,
  SupportTicketSlaDto,
  SupportTicketStatus,
  SupportAnalyticsDto,
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
const ONE_HOUR_MS = 60 * 60 * 1000;
const DUE_SOON_WINDOW_MS = 2 * ONE_HOUR_MS;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

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

export function calculateSupportResponseDueAt(priority: SupportTicketPriority, baseDate = new Date()) {
  const hours = priority === 'high' ? 4 : priority === 'low' ? 48 : 24;
  return new Date(baseDate.getTime() + hours * ONE_HOUR_MS);
}

function getActiveDueAt(ticket: {
  firstResponseDueAt?: Date | null;
  nextResponseDueAt?: Date | null;
}) {
  return ticket.firstResponseDueAt ?? ticket.nextResponseDueAt ?? null;
}

function getDueLabel(dueAt: Date | null, now = new Date()) {
  if (!dueAt) {
    return 'No active SLA';
  }

  const deltaMs = dueAt.getTime() - now.getTime();
  const absHours = Math.max(1, Math.ceil(Math.abs(deltaMs) / ONE_HOUR_MS));
  if (deltaMs < 0) {
    return `Overdue by ${absHours}h`;
  }
  return `Due in ${absHours}h`;
}

export function deriveSupportSlaState(ticket: {
  status: string;
  firstResponseDueAt?: Date | null;
  nextResponseDueAt?: Date | null;
  escalatedAt?: Date | null;
  escalationReason?: string | null;
}, now = new Date()): SupportTicketSlaDto {
  const status = normalizeStatus(ticket.status);
  if (status === 'RESOLVED' || status === 'CLOSED') {
    return {
      isOverdue: false,
      dueLabel: 'Closed',
      escalationLevel: 'none',
      dueAt: null,
      overdueByHours: null,
    };
  }

  const dueAt = getActiveDueAt(ticket);
  if (!dueAt) {
    return {
      isOverdue: false,
      dueLabel: 'No active SLA',
      escalationLevel: 'none',
      dueAt: null,
      overdueByHours: null,
    };
  }

  const deltaMs = dueAt.getTime() - now.getTime();
  const isOverdue = deltaMs < 0;
  const overdueByHours = isOverdue ? Math.max(1, Math.ceil(Math.abs(deltaMs) / ONE_HOUR_MS)) : null;
  const escalationLevel = ticket.escalatedAt
    ? 'escalated'
    : isOverdue
      ? 'overdue'
      : deltaMs <= DUE_SOON_WINDOW_MS
        ? 'due_soon'
        : 'none';

  return {
    isOverdue,
    dueLabel: getDueLabel(dueAt, now),
    escalationLevel,
    dueAt: dueAt.toISOString(),
    overdueByHours,
  };
}

type SupportAnalyticsRecord = {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  vendorId: string;
  priority: string;
  status: string;
  category: string;
  assigneeName?: string | null;
  firstResponseDueAt?: Date | null;
  nextResponseDueAt?: Date | null;
  escalatedAt?: Date | null;
  escalationReason?: string | null;
  resolvedAt?: Date | null;
  closedAt?: Date | null;
  vendor?: { name: string } | null;
  replies?: Array<{
    authorRole: string;
    createdAt: Date;
  }>;
};

function roundHours(value: number) {
  return Math.round(value * 10) / 10;
}

function average(values: number[]) {
  if (!values.length) {
    return null;
  }
  return roundHours(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function hoursBetween(start: Date, end: Date) {
  return Math.max(0, (end.getTime() - start.getTime()) / ONE_HOUR_MS);
}

function dateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function getResolutionAt(ticket: SupportAnalyticsRecord) {
  return ticket.resolvedAt ?? ticket.closedAt ?? null;
}

function getFirstAdminReplyAt(ticket: SupportAnalyticsRecord) {
  const adminReplies = (ticket.replies ?? [])
    .filter((reply) => reply.authorRole === 'ADMIN')
    .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
  return adminReplies[0]?.createdAt ?? null;
}

function percent(numerator: number, denominator: number) {
  if (!denominator) {
    return 0;
  }
  return Math.round((numerator / denominator) * 1000) / 10;
}

function createEmptyCategoryMap<T>(factory: (category: SupportTicketCategory) => T) {
  return Object.fromEntries([...VALID_CATEGORIES].map((category) => [category, factory(category)])) as Record<SupportTicketCategory, T>;
}

export function buildSupportAnalytics(tickets: SupportAnalyticsRecord[], now = new Date()): SupportAnalyticsDto {
  const today = dateKey(now);
  const lastSevenDays = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(now.getTime() - (6 - index) * ONE_DAY_MS);
    return dateKey(date);
  });
  const unresolvedTickets = tickets.filter((ticket) => UNRESOLVED_STATUSES.has(normalizeStatus(ticket.status)));
  const slaStates = new Map(tickets.map((ticket) => [ticket.id, deriveSupportSlaState(ticket, now)]));
  const overdueTickets = tickets.filter((ticket) => slaStates.get(ticket.id)?.isOverdue);
  const firstResponseHours = tickets
    .map((ticket) => {
      const firstAdminReplyAt = getFirstAdminReplyAt(ticket);
      return firstAdminReplyAt ? hoursBetween(ticket.createdAt, firstAdminReplyAt) : null;
    })
    .filter((value): value is number => value !== null);
  const resolutionHours = tickets
    .map((ticket) => {
      const resolutionAt = getResolutionAt(ticket);
      return resolutionAt ? hoursBetween(ticket.createdAt, resolutionAt) : null;
    })
    .filter((value): value is number => value !== null);
  const overdueDelayHours = overdueTickets
    .map((ticket) => {
      const dueAt = ticket.firstResponseDueAt ?? ticket.nextResponseDueAt ?? null;
      return dueAt ? hoursBetween(dueAt, now) : null;
    })
    .filter((value): value is number => value !== null);

  const categoryStats = createEmptyCategoryMap((category) => ({
    category,
    ticketCount: 0,
    overdueCount: 0,
    resolutionHours: [] as number[],
  }));
  const vendorStats = new Map<string, {
    vendorId: string;
    vendorName: string | null;
    ticketCount: number;
    unresolvedCount: number;
    overdueCount: number;
    resolutionHours: number[];
  }>();
  const assignmentStats = new Map<string, {
    assigneeName: string;
    ticketCount: number;
    overdueCount: number;
    firstResponseHours: number[];
    unassignedOpenTickets: number;
  }>();
  const trends = new Map(lastSevenDays.map((day) => [day, { date: day, created: 0, resolved: 0, overdue: 0 }]));

  for (const ticket of tickets) {
    const status = normalizeStatus(ticket.status);
    const category = normalizeCategory(ticket.category);
    const resolutionAt = getResolutionAt(ticket);
    const resolutionDuration = resolutionAt ? hoursBetween(ticket.createdAt, resolutionAt) : null;
    const firstAdminReplyAt = getFirstAdminReplyAt(ticket);
    const firstResponseDuration = firstAdminReplyAt ? hoursBetween(ticket.createdAt, firstAdminReplyAt) : null;
    const isOverdue = Boolean(slaStates.get(ticket.id)?.isOverdue);

    const categoryEntry = categoryStats[category];
    categoryEntry.ticketCount += 1;
    categoryEntry.overdueCount += isOverdue ? 1 : 0;
    if (resolutionDuration !== null) {
      categoryEntry.resolutionHours.push(resolutionDuration);
    }

    const vendorEntry = vendorStats.get(ticket.vendorId) ?? {
      vendorId: ticket.vendorId,
      vendorName: ticket.vendor?.name ?? null,
      ticketCount: 0,
      unresolvedCount: 0,
      overdueCount: 0,
      resolutionHours: [],
    };
    vendorEntry.ticketCount += 1;
    vendorEntry.unresolvedCount += UNRESOLVED_STATUSES.has(status) ? 1 : 0;
    vendorEntry.overdueCount += isOverdue ? 1 : 0;
    if (resolutionDuration !== null) {
      vendorEntry.resolutionHours.push(resolutionDuration);
    }
    vendorStats.set(ticket.vendorId, vendorEntry);

    const assigneeName = ticket.assigneeName?.trim() || 'Unassigned';
    const assignmentEntry = assignmentStats.get(assigneeName) ?? {
      assigneeName,
      ticketCount: 0,
      overdueCount: 0,
      firstResponseHours: [],
      unassignedOpenTickets: 0,
    };
    assignmentEntry.ticketCount += 1;
    assignmentEntry.overdueCount += isOverdue ? 1 : 0;
    assignmentEntry.unassignedOpenTickets += assigneeName === 'Unassigned' && status === 'OPEN' ? 1 : 0;
    if (firstResponseDuration !== null) {
      assignmentEntry.firstResponseHours.push(firstResponseDuration);
    }
    assignmentStats.set(assigneeName, assignmentEntry);

    const createdKey = dateKey(ticket.createdAt);
    trends.get(createdKey) && (trends.get(createdKey)!.created += 1);
    if (resolutionAt) {
      const resolvedKey = dateKey(resolutionAt);
      trends.get(resolvedKey) && (trends.get(resolvedKey)!.resolved += 1);
    }
    if (isOverdue) {
      const overdueKey = dateKey(ticket.firstResponseDueAt ?? ticket.nextResponseDueAt ?? now);
      trends.get(overdueKey) && (trends.get(overdueKey)!.overdue += 1);
    }
  }

  const categoryInsights = [...VALID_CATEGORIES].map((category) => {
    const entry = categoryStats[category];
    return {
      category,
      ticketCount: entry.ticketCount,
      overdueCount: entry.overdueCount,
      overduePercent: percent(entry.overdueCount, entry.ticketCount),
      avgResolutionHours: average(entry.resolutionHours),
    };
  });

  const vendorInsights = [...vendorStats.values()]
    .map((entry) => ({
      vendorId: entry.vendorId,
      vendorName: entry.vendorName,
      ticketCount: entry.ticketCount,
      unresolvedCount: entry.unresolvedCount,
      overdueCount: entry.overdueCount,
      overduePercent: percent(entry.overdueCount, entry.ticketCount),
      avgResolutionHours: average(entry.resolutionHours),
      needsAttention: entry.overdueCount > 0 || entry.unresolvedCount >= 3,
    }))
    .sort((left, right) => right.ticketCount - left.ticketCount)
    .slice(0, 10);

  const assignmentInsights = [...assignmentStats.values()]
    .map((entry) => ({
      assigneeName: entry.assigneeName,
      ticketCount: entry.ticketCount,
      overdueCount: entry.overdueCount,
      avgFirstResponseHours: average(entry.firstResponseHours),
      unassignedOpenTickets: entry.unassignedOpenTickets,
    }))
    .sort((left, right) => right.ticketCount - left.ticketCount);

  return {
    generatedAt: now.toISOString(),
    kpis: {
      openTickets: unresolvedTickets.length,
      overdueTickets: overdueTickets.length,
      avgFirstResponseHours: average(firstResponseHours),
      avgResolutionHours: average(resolutionHours),
      waitingOnVendor: tickets.filter((ticket) => normalizeStatus(ticket.status) === 'WAITING_FOR_VENDOR').length,
      resolvedToday: tickets.filter((ticket) => {
        const resolutionAt = getResolutionAt(ticket);
        return resolutionAt ? dateKey(resolutionAt) === today : false;
      }).length,
    },
    categoryInsights,
    vendorInsights,
    slaInsights: {
      overdueTickets: overdueTickets.length,
      overduePercent: percent(overdueTickets.length, tickets.length),
      avgResponseDelayHours: average(overdueDelayHours),
      avgResolutionHours: average(resolutionHours),
      breachesByCategory: categoryInsights
        .filter((entry) => entry.overdueCount > 0)
        .map((entry) => ({ category: entry.category, overdueCount: entry.overdueCount })),
    },
    assignmentInsights,
    trends: [...trends.values()],
  };
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

function mapReply(reply: {
  id: string;
  supportTicketId: string;
  authorUserId: string;
  authorName: string;
  authorRole: string;
  message: string;
  createdAt: Date;
}): SupportTicketReplyDto {
  return {
    id: reply.id,
    supportTicketId: reply.supportTicketId,
    authorUserId: reply.authorUserId,
    authorName: reply.authorName,
    authorRole: reply.authorRole === 'ADMIN' ? 'ADMIN' : 'VENDOR',
    message: reply.message,
    createdAt: reply.createdAt.toISOString(),
  };
}

const SAFE_CONTEXT_STRING_KEYS = ['route', 'path', 'orderNumber', 'returnNumber'] as const;
const SAFE_CONTEXT_STATUS_KEYS = ['status', 'returnStatus', 'refundStatus', 'orderStatus', 'shippingStatus', 'fulfillmentStatus'] as const;
const SAFE_CONTEXT_BOOLEAN_KEYS = [
  'trackingPresent',
  'returnTrackingPresent',
  'returnCarrierPresent',
  'shipmentTrackingPresent',
  'pdfAvailable',
  'labelAvailable',
] as const;

function readSummaryString(snapshot: Record<string, unknown>, keys: readonly string[], maxLength = 140) {
  for (const key of keys) {
    const value = snapshot[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim().slice(0, maxLength);
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value).slice(0, maxLength);
    }
  }
  return undefined;
}

function buildContextSummary(snapshot: Prisma.JsonValue | null): SupportTicketContextSummaryDto | null {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return null;
  }

  const source = snapshot as Record<string, unknown>;
  const summary: SupportTicketContextSummaryDto = {};

  for (const key of SAFE_CONTEXT_STRING_KEYS) {
    const value = readSummaryString(source, [key]);
    if (value) {
      summary[key] = value;
    }
  }

  const status = readSummaryString(source, SAFE_CONTEXT_STATUS_KEYS, 80);
  if (status) {
    summary.status = status;
  }

  const flags = SAFE_CONTEXT_BOOLEAN_KEYS.reduce<Record<string, boolean>>((accumulator, key) => {
    if (typeof source[key] === 'boolean') {
      accumulator[key] = source[key];
    }
    return accumulator;
  }, {});

  if (Object.keys(flags).length) {
    summary.flags = flags;
  }

  return Object.keys(summary).length ? summary : null;
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
  assigneeUserId?: string | null;
  assigneeName?: string | null;
  vendorUnreadCount?: number;
  adminUnreadCount?: number;
  lastReplyAt?: Date | null;
  lastReplyByRole?: string | null;
  firstResponseDueAt?: Date | null;
  nextResponseDueAt?: Date | null;
  escalatedAt?: Date | null;
  escalationReason?: string | null;
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
  replies?: Array<{
    id: string;
    supportTicketId: string;
    authorUserId: string;
    authorName: string;
    authorRole: string;
    message: string;
    createdAt: Date;
  }>;
}, options: { includeNotes?: boolean; includeReplies?: boolean; includeSla?: boolean; includeContextSnapshot?: boolean } = {}): SupportTicketDto {
  const includeSla = options.includeSla ?? false;
  const dto: SupportTicketDto = {
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
    assigneeUserId: ticket.assigneeUserId ?? null,
    assigneeName: ticket.assigneeName ?? null,
    vendorUnreadCount: ticket.vendorUnreadCount ?? 0,
    adminUnreadCount: ticket.adminUnreadCount ?? 0,
    lastReplyAt: ticket.lastReplyAt?.toISOString() ?? null,
    lastReplyByRole: ticket.lastReplyByRole === 'ADMIN' ? 'ADMIN' : ticket.lastReplyByRole === 'VENDOR' ? 'VENDOR' : null,
    firstResponseDueAt: includeSla ? ticket.firstResponseDueAt?.toISOString() ?? null : null,
    nextResponseDueAt: includeSla ? ticket.nextResponseDueAt?.toISOString() ?? null : null,
    escalatedAt: includeSla ? ticket.escalatedAt?.toISOString() ?? null : null,
    escalationReason: includeSla ? ticket.escalationReason ?? null : null,
    sla: includeSla ? deriveSupportSlaState({
      status: ticket.status,
      firstResponseDueAt: ticket.firstResponseDueAt,
      nextResponseDueAt: ticket.nextResponseDueAt,
      escalatedAt: ticket.escalatedAt,
      escalationReason: ticket.escalationReason,
    }) : null,
    contextType: ticket.contextType as SupportTicketContextType,
    contextId: ticket.contextId,
    contextSummary: buildContextSummary(ticket.contextSnapshot),
    resolvedAt: ticket.resolvedAt?.toISOString() ?? null,
    closedAt: ticket.closedAt?.toISOString() ?? null,
    notes: options.includeNotes ? (ticket.notes ?? []).map(mapNote) : undefined,
    replies: options.includeReplies ? (ticket.replies ?? []).map(mapReply) : undefined,
  };

  if (options.includeContextSnapshot) {
    dto.contextSnapshot = ticket.contextSnapshot;
  }

  return dto;
}

function mapAdminTicket(
  ticket: Parameters<typeof mapTicket>[0],
  options: Omit<Parameters<typeof mapTicket>[1], 'includeContextSnapshot'> = {},
) {
  return mapTicket(ticket, { ...options, includeContextSnapshot: true });
}

function mapVendorTicket(
  ticket: Parameters<typeof mapTicket>[0],
  options: Omit<Parameters<typeof mapTicket>[1], 'includeContextSnapshot' | 'includeSla' | 'includeNotes'> = {},
) {
  return mapTicket(ticket, { ...options, includeContextSnapshot: false, includeSla: false, includeNotes: false });
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
    ticket.assigneeName,
    ticket.assigneeUserId,
    ticket.lastReplyByRole,
    ticket.lastReplyAt,
    ticket.firstResponseDueAt,
    ticket.nextResponseDueAt,
    ticket.escalationReason,
    JSON.stringify(ticket.contextSnapshot ?? {}),
    JSON.stringify(ticket.contextSummary ?? {}),
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
      firstResponseDueAt: calculateSupportResponseDueAt(priority),
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

  return mapVendorTicket(ticket);
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

  return applyFilters(tickets.map((ticket) => mapAdminTicket(ticket, { includeSla: true })), filters)
    .sort((left, right) => {
      const leftRank = left.sla?.isOverdue ? 0 : left.sla?.escalationLevel === 'due_soon' ? 1 : 2;
      const rightRank = right.sla?.isOverdue ? 0 : right.sla?.escalationLevel === 'due_soon' ? 1 : 2;
      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }
      return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    });
}

export async function getAdminSupportAnalytics(): Promise<SupportAnalyticsDto> {
  const tickets = await prisma.supportTicket.findMany({
    include: {
      vendor: {
        select: { name: true },
      },
      replies: {
        select: {
          authorRole: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
    take: 1000,
  });

  return buildSupportAnalytics(tickets);
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

  return applyFilters(tickets.map((ticket) => mapVendorTicket(ticket)), filters);
}

export async function getAdminSupportTicket(ticketId: string): Promise<SupportTicketDto | null> {
  await prisma.supportTicket.updateMany({
    where: {
      id: ticketId,
      adminUnreadCount: { gt: 0 },
    },
    data: {
      adminUnreadCount: 0,
    },
  });

  const ticket = await prisma.supportTicket.findUnique({
    where: { id: ticketId },
    include: {
      vendor: {
        select: { name: true },
      },
      notes: {
        orderBy: { createdAt: 'asc' },
      },
      replies: {
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  return ticket ? mapAdminTicket(ticket, { includeNotes: true, includeReplies: true, includeSla: true }) : null;
}

export async function getVendorSupportTicket(ticketId: string, vendorId: string): Promise<SupportTicketDto | null> {
  await prisma.supportTicket.updateMany({
    where: {
      id: ticketId,
      vendorId,
      vendorUnreadCount: { gt: 0 },
    },
    data: {
      vendorUnreadCount: 0,
    },
  });

  const ticket = await prisma.supportTicket.findFirst({
    where: {
      id: ticketId,
      vendorId,
    },
    include: {
      vendor: {
        select: { name: true },
      },
      replies: {
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  return ticket ? mapVendorTicket(ticket, { includeReplies: true }) : null;
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
      firstResponseDueAt: status === 'RESOLVED' || status === 'CLOSED' ? null : undefined,
      nextResponseDueAt: status === 'RESOLVED' || status === 'CLOSED' ? null : undefined,
      escalatedAt: status === 'RESOLVED' || status === 'CLOSED' ? null : undefined,
      escalationReason: status === 'RESOLVED' || status === 'CLOSED' ? null : undefined,
    },
    include: {
      vendor: {
        select: { name: true },
      },
      notes: {
        orderBy: { createdAt: 'asc' },
      },
      replies: {
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  return mapAdminTicket(ticket, { includeNotes: true, includeReplies: true, includeSla: true });
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

async function loadTicketForReply(ticketId: string, vendorId?: string) {
  if (vendorId) {
    return prisma.supportTicket.findFirst({
      where: { id: ticketId, vendorId },
      select: { id: true, status: true, priority: true, firstResponseDueAt: true, nextResponseDueAt: true },
    });
  }

  return prisma.supportTicket.findUnique({
    where: { id: ticketId },
    select: { id: true, status: true, priority: true, firstResponseDueAt: true, nextResponseDueAt: true },
  });
}

async function loadTicketDetailForActor(ticketId: string, includeNotes: boolean, vendorId?: string) {
  if (vendorId) {
    return getVendorSupportTicket(ticketId, vendorId);
  }
  return getAdminSupportTicket(ticketId).then((ticket) => ticket ? {
    ...ticket,
    notes: includeNotes ? ticket.notes : undefined,
  } : null);
}

export async function addVendorSupportTicketReply(
  ticketId: string,
  vendorId: string,
  authUser: AuthUserContext,
  input: AddSupportTicketReplyInput,
): Promise<SupportTicketDto> {
  const message = readText(input.message, 'Reply', 2000);
  const ticket = await loadTicketForReply(ticketId, vendorId);
  if (!ticket) {
    throw new SupportTicketError('Support ticket not found.', 404);
  }

  const currentStatus = normalizeStatus(ticket.status);
  if (currentStatus === 'CLOSED') {
    throw new SupportTicketError('Closed support tickets cannot receive replies.', 400);
  }

  await prisma.supportTicketReply.create({
    data: {
      supportTicketId: ticketId,
      authorUserId: authUser.id,
      authorName: authUser.name,
      authorRole: 'VENDOR',
      message,
    },
  });

  const now = new Date();
  const priority = readPriority(ticket.priority);
  await prisma.supportTicket.update({
    where: { id: ticketId },
    data: {
      status: currentStatus === 'WAITING_FOR_VENDOR' ? 'IN_REVIEW' : currentStatus,
      resolvedAt: currentStatus === 'WAITING_FOR_VENDOR' ? null : undefined,
      closedAt: currentStatus === 'WAITING_FOR_VENDOR' ? null : undefined,
      nextResponseDueAt: calculateSupportResponseDueAt(priority, now),
      escalatedAt: null,
      escalationReason: null,
      adminUnreadCount: { increment: 1 },
      vendorUnreadCount: 0,
      lastReplyAt: now,
      lastReplyByRole: 'VENDOR',
    },
  });

  const updated = await loadTicketDetailForActor(ticketId, false, vendorId);
  if (!updated) {
    throw new SupportTicketError('Support ticket not found.', 404);
  }
  return updated;
}

export async function addAdminSupportTicketReply(
  ticketId: string,
  authUser: AuthUserContext,
  input: AddSupportTicketReplyInput,
): Promise<SupportTicketDto> {
  const message = readText(input.message, 'Reply', 2000);
  const requestedStatus = readStatus(input.status);
  const ticket = await loadTicketForReply(ticketId);
  if (!ticket) {
    throw new SupportTicketError('Support ticket not found.', 404);
  }

  const currentStatus = normalizeStatus(ticket.status);
  if (currentStatus === 'CLOSED') {
    throw new SupportTicketError('Closed support tickets cannot receive replies.', 400);
  }

  const nextStatus = requestedStatus ?? currentStatus;
  if (nextStatus === 'CLOSED') {
    throw new SupportTicketError('Use the ticket status action to close support tickets.', 400);
  }

  await prisma.supportTicketReply.create({
    data: {
      supportTicketId: ticketId,
      authorUserId: authUser.id,
      authorName: authUser.name,
      authorRole: 'ADMIN',
      message,
    },
  });

  const now = new Date();
  await prisma.supportTicket.update({
    where: { id: ticketId },
    data: {
      status: nextStatus,
      resolvedAt: nextStatus === 'RESOLVED' ? now : nextStatus === 'OPEN' || nextStatus === 'IN_REVIEW' || nextStatus === 'WAITING_FOR_VENDOR' ? null : undefined,
      closedAt: nextStatus === 'OPEN' || nextStatus === 'IN_REVIEW' || nextStatus === 'WAITING_FOR_VENDOR' || nextStatus === 'RESOLVED' ? null : undefined,
      firstResponseDueAt: null,
      nextResponseDueAt: null,
      escalatedAt: nextStatus === 'RESOLVED' ? null : undefined,
      escalationReason: nextStatus === 'RESOLVED' ? null : undefined,
      vendorUnreadCount: { increment: 1 },
      adminUnreadCount: 0,
      lastReplyAt: now,
      lastReplyByRole: 'ADMIN',
    },
  });

  const updated = await loadTicketDetailForActor(ticketId, true);
  if (!updated) {
    throw new SupportTicketError('Support ticket not found.', 404);
  }
  return updated;
}

export async function assignSupportTicketToSelf(ticketId: string, authUser: AuthUserContext): Promise<SupportTicketDto> {
  const ticket = await prisma.supportTicket.update({
    where: { id: ticketId },
    data: {
      assigneeUserId: authUser.id,
      assigneeName: authUser.name,
    },
    include: {
      vendor: {
        select: { name: true },
      },
      notes: {
        orderBy: { createdAt: 'asc' },
      },
      replies: {
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  return mapAdminTicket(ticket, { includeNotes: true, includeReplies: true, includeSla: true });
}

export async function unassignSupportTicket(ticketId: string): Promise<SupportTicketDto> {
  const ticket = await prisma.supportTicket.update({
    where: { id: ticketId },
    data: {
      assigneeUserId: null,
      assigneeName: null,
    },
    include: {
      vendor: {
        select: { name: true },
      },
      notes: {
        orderBy: { createdAt: 'asc' },
      },
      replies: {
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  return mapAdminTicket(ticket, { includeNotes: true, includeReplies: true, includeSla: true });
}
