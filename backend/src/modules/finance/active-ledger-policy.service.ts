import type { Prisma } from '@prisma/client';

export const activeFinanceLedgerWhere = {
  voidedAt: null,
} satisfies Prisma.FinanceLedgerEntryWhereInput;

export type LedgerVoidState = {
  voidedAt?: Date | string | null;
  voidReason?: string | null;
  supersededByLedgerId?: string | null;
} | null | undefined;

export function isLedgerVoided(ledger: LedgerVoidState): boolean {
  return ledger?.voidedAt !== null && ledger?.voidedAt !== undefined;
}

export function assertLedgerActiveForMoneyMovement(
  ledger: LedgerVoidState,
  message = 'Ledger has been voided or superseded and cannot participate in money movement.',
): void {
  if (isLedgerVoided(ledger)) {
    throw new Error(message);
  }
}
