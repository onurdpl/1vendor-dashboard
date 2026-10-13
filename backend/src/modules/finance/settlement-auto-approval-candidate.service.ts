import { SettlementApprovalLineType, SettlementApprovalStatus } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { assessSettlementApprovalReadiness } from './settlement-approval.service.js';

export type AutomaticApprovalCandidateAssessment = {
  settlementApprovalId: string;
  vendorId: string;
  classification: 'ELIGIBLE_EVIDENCE_ONLY' | 'BLOCKED' | 'UNKNOWN';
  writesPerformed: false;
  approvalAuthorized: false;
  requiresWriteTimeRevalidation: true;
  readinessClassification: 'VERIFIED_BY_EXISTING_CHECKS' | 'BLOCKED' | 'UNKNOWN' | null;
  adminReviewRequiredByExistingReadiness: true | null;
  vendorProfile: {
    active: boolean;
    autoSettlementApproveEnabled: boolean;
  } | null;
  reasonCodes: string[];
  blockers: string[];
  unresolvedAuthority: string[];
};

/** Read-only evidence for a future worker. This is never permission to approve a settlement. */
export async function assessAutomaticApprovalCandidate(input: {
  settlementApprovalId: string;
  vendorId: string;
}): Promise<AutomaticApprovalCandidateAssessment | null> {
  // Scope the initial lookup before requesting readiness, which otherwise accepts an ID alone.
  const approval = await prisma.settlementApproval.findFirst({
    where: { id: input.settlementApprovalId, vendorId: input.vendorId },
    select: {
      id: true,
      vendorId: true,
      status: true,
      replacesSettlementApprovalId: true,
      correctionCreditMinor: true,
      correctionDeductionMinor: true,
      lines: { select: { lineType: true } },
      correctionCreditLines: { select: { id: true } },
      correctionDeductionLines: { select: { id: true } },
    },
  });
  if (!approval) return null;

  const [profile, readiness] = await Promise.all([
    prisma.vendorFinancialProfile.findUnique({
      where: { vendorId: approval.vendorId },
      select: { active: true, autoSettlementApproveEnabled: true },
    }),
    assessSettlementApprovalReadiness(approval.id),
  ]);

  const base = {
    settlementApprovalId: approval.id,
    vendorId: approval.vendorId,
    writesPerformed: false as const,
    approvalAuthorized: false as const,
    requiresWriteTimeRevalidation: true as const,
    readinessClassification: readiness?.classification ?? null,
    adminReviewRequiredByExistingReadiness: readiness?.adminReviewRequired ?? null,
    vendorProfile: profile,
  };
  if (!readiness || readiness.vendorId !== approval.vendorId ||
      readiness.settlementApprovalId !== approval.id || readiness.status !== approval.status) {
    return {
      ...base,
      classification: 'UNKNOWN',
      reasonCodes: ['READINESS_IDENTITY_OR_STATUS_UNVERIFIED'],
      blockers: [],
      unresolvedAuthority: ['The settlement identity or status changed during read-only assessment.'],
    };
  }

  const sourceReasonCodes = readiness.sourceValidation.reasons.map((reason) => reason.code);
  if (approval.status !== SettlementApprovalStatus.DRAFT || readiness.classification === 'BLOCKED') {
    return {
      ...base,
      classification: 'BLOCKED',
      reasonCodes: [...new Set([
        ...(approval.status !== SettlementApprovalStatus.DRAFT ? ['NOT_DRAFT'] : []),
        ...sourceReasonCodes,
      ])],
      blockers: readiness.blockers,
      unresolvedAuthority: [],
    };
  }

  const unresolvedAuthority = [...readiness.blockers];
  const reasonCodes: string[] = [];
  if (approval.replacesSettlementApprovalId) {
    reasonCodes.push('REPLACEMENT_AUTHORITY_UNVERIFIED');
  }
  if (approval.correctionCreditMinor || approval.correctionDeductionMinor ||
      approval.correctionCreditLines.length || approval.correctionDeductionLines.length) {
    reasonCodes.push('CORRECTION_AUTHORITY_UNVERIFIED');
  }
  if (!approval.lines.length) {
    reasonCodes.push('ORDINARY_LINES_MISSING');
  }
  // The approved objective does not yet define which refund-bearing subtypes may be automated.
  if (approval.lines.some((line) => line.lineType !== SettlementApprovalLineType.SALE)) {
    reasonCodes.push('REFUND_BEARING_SUBTYPE_POLICY_UNDEFINED');
    unresolvedAuthority.push('Automatic approval policy for REFUND and REFUND_ADJUSTMENT lines is not defined.');
  }
  if (readiness.classification !== 'VERIFIED_BY_EXISTING_CHECKS') {
    reasonCodes.push('READINESS_AUTHORITY_UNVERIFIED');
  }
  if (reasonCodes.length) {
    return {
      ...base,
      classification: 'UNKNOWN',
      reasonCodes: [...new Set(reasonCodes)],
      blockers: [],
      unresolvedAuthority,
    };
  }

  return {
    ...base,
    classification: 'ELIGIBLE_EVIDENCE_ONLY',
    reasonCodes: ['ORDINARY_SALE_SOURCE_CHECKS_VERIFIED'],
    blockers: [],
    unresolvedAuthority: [],
  };
}
