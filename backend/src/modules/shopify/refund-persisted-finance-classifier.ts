/** The persisted-evidence decision shared by refund ingestion and read-only review. */
export function classifyPersistedRefundFinanceEvidence<TSnapshot, TRefundRecord>(input: {
  snapshot: TSnapshot | null;
  ledgers: readonly { id: string; vendorAllocationId: string | null }[];
  expectedRefundLedgerId: string;
  legacyRefundLedgerId: string;
  vendorAllocationId: string;
  refundRecord: TRefundRecord | null;
  adjustment: unknown | null;
  debtEvent: unknown | null;
  financeEvents: readonly {
    financeLedgerEntry: { vendorAllocationId: string | null } | null;
    metadataJson: unknown;
  }[];
}) {
  if (input.snapshot) return { kind: 'snapshot' as const, snapshot: input.snapshot };

  const pairLedger = input.ledgers.some((ledger) => ledger.vendorAllocationId === input.vendorAllocationId);
  const unscopedLedger = input.ledgers.some((ledger) => ledger.vendorAllocationId == null);
  const conflictingIdentityLedger = input.ledgers.some((ledger) =>
    (ledger.id === input.expectedRefundLedgerId || ledger.id === input.legacyRefundLedgerId) &&
    ledger.vendorAllocationId !== null &&
    ledger.vendorAllocationId !== input.vendorAllocationId);
  const pairEvent = input.financeEvents.some((event) =>
    event.financeLedgerEntry?.vendorAllocationId === input.vendorAllocationId ||
    (typeof event.metadataJson === 'object' && event.metadataJson !== null &&
      !Array.isArray(event.metadataJson) &&
      (event.metadataJson as Record<string, unknown>).vendorAllocationId === input.vendorAllocationId));
  const ambiguousEvent = input.financeEvents.some((event) =>
    !event.financeLedgerEntry?.vendorAllocationId &&
    !(typeof event.metadataJson === 'object' && event.metadataJson !== null &&
      !Array.isArray(event.metadataJson) &&
      typeof (event.metadataJson as Record<string, unknown>).vendorAllocationId === 'string'));

  if (pairLedger || input.adjustment || input.debtEvent || pairEvent) {
    return { kind: 'historical_finance' as const, refundRecord: input.refundRecord };
  }
  if (unscopedLedger || conflictingIdentityLedger || ambiguousEvent) {
    return { kind: 'ambiguous_legacy' as const, refundRecord: input.refundRecord };
  }
  return { kind: 'new' as const, refundRecord: input.refundRecord };
}
