import { approveSettlementApprovalAsTrustedSystem } from './settlement-approval.service.js';

/** Trusted backend-only entry point. No HTTP route or scheduler calls this service. */
export async function approveSettlementDraftInternally(input: {
  settlementApprovalId: string;
  expectedVendorId: string;
}) {
  return approveSettlementApprovalAsTrustedSystem(input);
}
