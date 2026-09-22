import {
  LegacyRefundFinanceArtifactType,
  type LegacyRefundFinanceAttribution,
  type LegacyRefundFinanceResolutionOutcome,
  type LegacyRefundFinanceReviewStatus,
  Prisma,
  type RefundTerminalEvidenceResolutionOutcome,
  type RefundTerminalEvidenceReviewStatus,
} from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { classifyPersistedRefundFinanceEvidence } from '../shopify/refund-persisted-finance-classifier.js';
import { buildLegacyRefundLedgerEntryId, buildRefundLedgerEntryId } from './refund-ledger-id.service.js';

type Page = { limit: number; offset: number };
type LegacySourceRow = {
  artifactType: 'refund_ledger' | 'settlement_refund_adjustment' | 'vendor_debt_event' | 'finance_event';
  artifactId: string;
  vendorId: string;
  vendorName: string | null;
  sourceShopifyOrderId: string | null;
  sourceShopifyRefundId: string | null;
  vendorAllocationId: string | null;
  amount: Prisma.Decimal | null;
  amountMinor: number | null;
  currency: string | null;
  observedAt: Date;
  state: string | null;
  voidedAt: Date | null;
  supersededByLedgerId: string | null;
  exactRefundRecordId: string | null;
};

export type LegacyRefundFinanceCandidate = {
  artifactType: 'refund_ledger' | 'settlement_refund_adjustment' | 'vendor_debt_event' | 'finance_event';
  artifactId: string;
  attribution: 'exact' | 'ambiguous';
  sourceShopifyOrderId: string | null;
  sourceShopifyRefundId: string | null;
  vendorAllocationId: string | null;
  observedVendorId: string;
  vendorName: string | null;
  recordedAmount: string | null;
  recordedAmountMinor: number | null;
  recordedCurrency: string | null;
  observedAt: Date;
  state: string | null;
  voidedAt: Date | null;
  supersededByLedgerId: string | null;
};

// The branches are exclusive by source artifact: a linked REFUND ledger owns
// its adjustments, debt events and finance events. Standalone events retain their own IDs.
function legacySources(vendorId: string | null) {
  const ledgerVendor = vendorId ? Prisma.sql`AND l."vendorId" = ${vendorId}` : Prisma.empty;
  const debtVendor = vendorId ? Prisma.sql`AND d."vendorId" = ${vendorId}` : Prisma.empty;
  const adjustmentVendor = vendorId ? Prisma.sql`AND j."vendorId" = ${vendorId}` : Prisma.empty;
  const eventVendor = vendorId ? Prisma.sql`AND e."vendorId" = ${vendorId}` : Prisma.empty;
  return Prisma.sql`
    SELECT 'refund_ledger'::text AS "artifactType", l.id AS "artifactId", l."vendorId", v.name AS "vendorName",
      o."sourceShopifyOrderId",
      CASE WHEN rr."sourceShopifyRefundId" IS NOT NULL AND linked_event."sourceShopifyRefundId" IS NOT NULL
        AND rr."sourceShopifyRefundId" <> linked_event."sourceShopifyRefundId" THEN NULL::text
        ELSE COALESCE(rr."sourceShopifyRefundId", linked_event."sourceShopifyRefundId") END AS "sourceShopifyRefundId",
      l."vendorAllocationId",
      l.amount, NULL::integer AS "amountMinor", NULL::text AS currency,
      l."createdAt" AS "observedAt", l."settlementStatus"::text AS state,
      l."voidedAt", l."supersededByLedgerId", rr.id AS "exactRefundRecordId"
    FROM "FinanceLedgerEntry" l
    JOIN "Vendor" v ON v.id = l."vendorId"
    LEFT JOIN "VendorAllocation" a ON a.id = l."vendorAllocationId"
    LEFT JOIN "ShopifyOrder" o ON o.id = a."sourceShopifyOrderId"
    LEFT JOIN LATERAL (
      SELECT
        CASE WHEN COUNT(DISTINCT matched."sourceShopifyRefundId") = 1 THEN MIN(matched.id) END AS id,
        CASE WHEN COUNT(DISTINCT matched."sourceShopifyRefundId") = 1 THEN MIN(matched."sourceShopifyRefundId") END AS "sourceShopifyRefundId",
        CASE WHEN COUNT(DISTINCT matched."sourceShopifyRefundId") = 1 THEN MIN(matched."vendorAllocationId") END AS "vendorAllocationId"
      FROM (
        SELECT r.id, r."sourceShopifyRefundId", r."vendorAllocationId"
        FROM "RefundRecord" r
        WHERE r."vendorAllocationId" = l."vendorAllocationId"
          AND (l.id = 'fin-' || l."vendorId" || '-refund-' || r."sourceShopifyRefundId" || '-' || r."vendorAllocationId"
            OR l.id = 'fin-' || l."vendorId" || '-refund-' || r."sourceShopifyRefundId"
            OR POSITION('-refund-' || r."sourceShopifyRefundId" || '-' IN l.id) > 0
            OR EXISTS (SELECT 1 FROM "SettlementRefundAdjustment" j WHERE j."refundFinanceLedgerEntryId" = l.id AND j."refundRecordId" = r.id)
            OR EXISTS (SELECT 1 FROM "VendorBalanceEvent" d WHERE d."financeLedgerEntryId" = l.id
              AND d."refundRecordId" = r.id AND d.type = 'VENDOR_DEBT_CREATED')
            OR EXISTS (SELECT 1 FROM "FinanceEvent" e WHERE e."financeLedgerEntryId" = l.id
              AND e."referenceType" = 'shopify_refund' AND e."referenceId" = r."sourceShopifyRefundId"))
      ) matched
    ) rr ON TRUE
    LEFT JOIN LATERAL (
      SELECT CASE WHEN COUNT(DISTINCT e."referenceId") = 1 THEN MIN(e."referenceId") END AS "sourceShopifyRefundId"
      FROM "FinanceEvent" e
      WHERE e."financeLedgerEntryId" = l.id AND e."referenceType" = 'shopify_refund'
    ) linked_event ON TRUE
    WHERE l."entryType" = 'refund' ${ledgerVendor}
      AND NOT EXISTS (SELECT 1 FROM "RefundEvidenceSnapshot" s WHERE s."refundFinanceLedgerEntryId" = l.id)
      AND NOT EXISTS (SELECT 1 FROM "RefundEvidenceSnapshot" s
        WHERE s."sourceShopifyRefundId" = CASE
          WHEN rr."sourceShopifyRefundId" IS NOT NULL AND linked_event."sourceShopifyRefundId" IS NOT NULL
            AND rr."sourceShopifyRefundId" <> linked_event."sourceShopifyRefundId" THEN NULL::text
          ELSE COALESCE(rr."sourceShopifyRefundId", linked_event."sourceShopifyRefundId") END
          AND s."vendorAllocationId" = l."vendorAllocationId")
    UNION ALL
    SELECT 'settlement_refund_adjustment'::text, j.id, j."vendorId", v.name,
      r."sourceShopifyOrderId", r."sourceShopifyRefundId", r."vendorAllocationId",
      NULL::numeric, j."amountMinor", j."currencyCode", j."createdAt", j.status::text,
      NULL::timestamp, NULL::text, r.id
    FROM "SettlementRefundAdjustment" j
    JOIN "Vendor" v ON v.id = j."vendorId"
    JOIN "RefundRecord" r ON r.id = j."refundRecordId"
    JOIN "FinanceLedgerEntry" l ON l.id = j."refundFinanceLedgerEntryId"
    WHERE l."entryType" <> 'refund' ${adjustmentVendor}
      AND NOT EXISTS (SELECT 1 FROM "RefundEvidenceSnapshot" s WHERE s."refundRecordId" = r.id)
    UNION ALL
    SELECT 'vendor_debt_event'::text, d.id, d."vendorId", v.name,
      r."sourceShopifyOrderId", r."sourceShopifyRefundId", r."vendorAllocationId",
      NULL::numeric, d."amountMinor", d.currency, d."createdAt", d.type::text,
      NULL::timestamp, NULL::text, r.id
    FROM "VendorBalanceEvent" d
    JOIN "Vendor" v ON v.id = d."vendorId"
    JOIN "RefundRecord" r ON r.id = d."refundRecordId"
    LEFT JOIN "FinanceLedgerEntry" l ON l.id = d."financeLedgerEntryId"
    WHERE d.type = 'VENDOR_DEBT_CREATED' ${debtVendor}
      AND (l.id IS NULL OR l."entryType" <> 'refund')
      AND NOT EXISTS (SELECT 1 FROM "RefundEvidenceSnapshot" s WHERE s."refundRecordId" = r.id)
    UNION ALL
    SELECT 'finance_event'::text, e.id, e."vendorId", v.name,
      COALESCE(ao."sourceShopifyOrderId", o."sourceShopifyOrderId"), e."referenceId",
      CASE WHEN a.id IS NOT NULL THEN a.id ELSE NULL::text END,
      NULL::numeric, e."amountMinor", e.currency, e."createdAt", e."eventType"::text,
      NULL::timestamp, NULL::text, NULL::text
    FROM "FinanceEvent" e
    JOIN "Vendor" v ON v.id = e."vendorId"
    LEFT JOIN "FinanceLedgerEntry" l ON l.id = e."financeLedgerEntryId"
    LEFT JOIN "VendorAllocation" a ON a.id = COALESCE(l."vendorAllocationId",
      CASE WHEN jsonb_typeof(e."metadataJson"->'vendorAllocationId') = 'string'
        THEN e."metadataJson"->>'vendorAllocationId' ELSE NULL END)
    LEFT JOIN "ShopifyOrder" ao ON ao.id = a."sourceShopifyOrderId"
    LEFT JOIN "ShopifyOrder" o ON o.id = e."shopifyOrderId"
    WHERE e."referenceType" = 'shopify_refund' ${eventVendor}
      AND (l.id IS NULL OR l."entryType" <> 'refund')
      AND NOT EXISTS (SELECT 1 FROM "RefundEvidenceSnapshot" s
        WHERE s."sourceShopifyRefundId" = e."referenceId" AND s."vendorAllocationId" = a.id)
  `;
}

function mapLegacySource(row: LegacySourceRow): LegacyRefundFinanceCandidate {
  const exact = row.sourceShopifyRefundId && row.vendorAllocationId &&
    (row.exactRefundRecordId || row.artifactType === 'refund_ledger' || row.artifactType === 'finance_event');
  const classified = exact ? classifyPersistedRefundFinanceEvidence({
    snapshot: null,
    ledgers: row.artifactType === 'refund_ledger' ? [{ id: row.artifactId, vendorAllocationId: row.vendorAllocationId }] : [],
    expectedRefundLedgerId: buildRefundLedgerEntryId({ vendorId: row.vendorId, sourceShopifyRefundId: row.sourceShopifyRefundId!, vendorAllocationId: row.vendorAllocationId! }),
    legacyRefundLedgerId: buildLegacyRefundLedgerEntryId({ vendorId: row.vendorId, sourceShopifyRefundId: row.sourceShopifyRefundId! }),
    vendorAllocationId: row.vendorAllocationId!,
    refundRecord: row.exactRefundRecordId ? { id: row.exactRefundRecordId } : null,
    adjustment: row.artifactType === 'settlement_refund_adjustment' ? { id: row.artifactId } : null,
    debtEvent: row.artifactType === 'vendor_debt_event' ? { id: row.artifactId } : null,
    financeEvents: row.artifactType === 'finance_event' ? [{ financeLedgerEntry: { vendorAllocationId: row.vendorAllocationId! }, metadataJson: null }] : [],
  }) : null;
  return {
    artifactType: row.artifactType,
    artifactId: row.artifactId,
    attribution: classified?.kind === 'historical_finance' ? 'exact' : 'ambiguous',
    sourceShopifyOrderId: row.sourceShopifyOrderId,
    sourceShopifyRefundId: row.sourceShopifyRefundId,
    vendorAllocationId: row.vendorAllocationId,
    observedVendorId: row.vendorId,
    vendorName: row.vendorName,
    recordedAmount: row.amount?.toString() ?? null,
    recordedAmountMinor: row.amountMinor,
    recordedCurrency: row.currency,
    observedAt: row.observedAt,
    state: row.state,
    voidedAt: row.voidedAt,
    supersededByLedgerId: row.supersededByLedgerId,
  };
}

export async function loadLegacyRefundFinanceCandidates(vendorId: string | null = null) {
  const rows = await prisma.$queryRaw<LegacySourceRow[]>(Prisma.sql`
    SELECT * FROM (${legacySources(vendorId)}) candidates
    ORDER BY "observedAt" ASC, "artifactId" ASC, "artifactType" ASC
  `);
  return rows.map(mapLegacySource);
}

export async function listAdminRefundReviews(input: {
  vendorId: string | null;
  terminalStatus?: RefundTerminalEvidenceReviewStatus | null;
  terminalResolutionOutcome?: RefundTerminalEvidenceResolutionOutcome | null;
  legacyStatus?: LegacyRefundFinanceReviewStatus | null;
  legacyResolutionOutcome?: LegacyRefundFinanceResolutionOutcome | null;
  legacyAttribution?: LegacyRefundFinanceAttribution | null;
  legacyArtifactType?: LegacyRefundFinanceArtifactType | null;
  terminal: Page;
  legacy: Page;
}) {
  const terminalWhere: Prisma.RefundTerminalEvidenceReviewWhereInput = {
    ...(input.vendorId ? { economicVendorId: input.vendorId } : {}),
    ...(input.terminalStatus ? { status: input.terminalStatus } : {}),
    ...(input.terminalResolutionOutcome ? { resolutionOutcome: input.terminalResolutionOutcome } : {}),
  };
  const legacyWhere: Prisma.LegacyRefundFinanceReviewWhereInput = {
    ...(input.vendorId ? { observedVendorId: input.vendorId } : {}),
    ...(input.legacyStatus ? { status: input.legacyStatus } : {}),
    ...(input.legacyResolutionOutcome ? { resolutionOutcome: input.legacyResolutionOutcome } : {}),
    ...(input.legacyAttribution ? { attribution: input.legacyAttribution } : {}),
    ...(input.legacyArtifactType ? { sources: { some: { artifactType: input.legacyArtifactType } } } : {}),
  };
  const [terminalResult, legacyResult] = await Promise.allSettled([
    Promise.all([
      prisma.refundTerminalEvidenceReview.count({ where: terminalWhere }),
      prisma.refundTerminalEvidenceReview.findMany({
        where: terminalWhere,
        orderBy: [{ lastObservedAt: 'desc' }, { id: 'desc' }],
        skip: input.terminal.offset,
        take: input.terminal.limit,
        select: {
          id: true, status: true, resolutionOutcome: true, sourceShopifyRefundId: true, sourceShopifyOrderId: true,
          vendorAllocationId: true, economicVendorId: true, economicVendor: { select: { name: true } },
          terminalRefundFinanceLedgerEntryId: true, storedEvidenceSnapshotId: true,
          storedEvidenceSnapshot: { select: { currency: true } },
          conflictCategory: true, storedEvidenceHash: true, incomingEvidenceHash: true,
          occurrenceCount: true, firstObservedAt: true, lastObservedAt: true, createdAt: true, updatedAt: true,
          terminalRefundFinanceLedgerEntry: { select: { amount: true } },
        },
      }),
    ]),
    Promise.all([
      prisma.legacyRefundFinanceReview.count({ where: legacyWhere }),
      prisma.legacyRefundFinanceReview.findMany({
        where: legacyWhere,
        orderBy: [{ lastObservedAt: 'desc' }, { id: 'desc' }],
        skip: input.legacy.offset,
        take: input.legacy.limit,
        select: {
          id: true, status: true, resolutionOutcome: true, attribution: true,
          sourceShopifyOrderId: true, sourceShopifyRefundId: true, vendorAllocationId: true,
          observedVendorId: true, observedVendor: { select: { name: true } },
          firstObservedAt: true, lastObservedAt: true, occurrenceCount: true, createdAt: true, updatedAt: true,
          _count: { select: { sources: true } },
        },
      }),
    ]),
  ]);

  const terminalCount = terminalResult.status === 'fulfilled' ? terminalResult.value[0] : 0;
  const reviews = terminalResult.status === 'fulfilled' ? terminalResult.value[1] : [];
  const legacyCount = legacyResult.status === 'fulfilled' ? legacyResult.value[0] : 0;
  const legacyReviews = legacyResult.status === 'fulfilled' ? legacyResult.value[1] : [];

  return {
    ok: true as const,
    writesPerformed: false as const,
    terminalReviews: {
      error: terminalResult.status === 'rejected' ? 'Unable to load refund evidence conflicts.' : null,
      count: terminalCount,
      limit: input.terminal.limit,
      offset: input.terminal.offset,
      items: reviews.map((review) => ({
        type: 'terminal_conflict' as const,
        id: review.id,
        status: review.status,
        resolutionOutcome: review.resolutionOutcome,
        sourceShopifyRefundId: review.sourceShopifyRefundId,
        sourceShopifyOrderId: review.sourceShopifyOrderId,
        vendorAllocationId: review.vendorAllocationId,
        economicVendorId: review.economicVendorId,
        vendorName: review.economicVendor.name,
        terminalRefundFinanceLedgerEntryId: review.terminalRefundFinanceLedgerEntryId,
        storedEvidenceSnapshotId: review.storedEvidenceSnapshotId,
        conflictCategory: review.conflictCategory,
        storedEvidenceHash: review.storedEvidenceHash,
        incomingEvidenceHash: review.incomingEvidenceHash,
        occurrenceCount: review.occurrenceCount,
        firstObservedAt: review.firstObservedAt.toISOString(),
        lastObservedAt: review.lastObservedAt.toISOString(),
        createdAt: review.createdAt.toISOString(),
        updatedAt: review.updatedAt.toISOString(),
        acceptedRecordedAmount: review.terminalRefundFinanceLedgerEntry.amount.toString(),
        acceptedRecordedCurrency: review.storedEvidenceSnapshot?.currency ?? null,
      })),
    },
    legacyCandidates: {
      error: legacyResult.status === 'rejected' ? 'Unable to load legacy refund finance.' : null,
      count: legacyCount,
      limit: input.legacy.limit,
      offset: input.legacy.offset,
      items: legacyReviews.map((review) => ({
        type: 'legacy_refund_finance' as const,
        id: review.id, status: review.status, resolutionOutcome: review.resolutionOutcome,
        attribution: review.attribution.toLowerCase() as 'exact' | 'ambiguous',
        sourceShopifyOrderId: review.sourceShopifyOrderId,
        sourceShopifyRefundId: review.sourceShopifyRefundId,
        vendorAllocationId: review.vendorAllocationId,
        observedVendorId: review.observedVendorId,
        vendorName: review.observedVendor?.name ?? null,
        sourceCount: review._count.sources,
        firstObservedAt: review.firstObservedAt.toISOString(),
        lastObservedAt: review.lastObservedAt.toISOString(),
        occurrenceCount: review.occurrenceCount,
        createdAt: review.createdAt.toISOString(), updatedAt: review.updatedAt.toISOString(),
      })),
    },
  };
}
