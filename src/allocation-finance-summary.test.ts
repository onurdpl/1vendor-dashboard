import { describe, expect, it, vi } from 'vitest';
import {
  buildAllocationFinanceSummary,
  getAllocationFinanceSummary,
} from '../backend/src/modules/finance/allocation-finance-summary.service';

function approvedLine(input: {
  id?: string;
  status?: string;
  lineType?: string;
  payableImpactMinor?: number;
  payoutStatus?: string;
  paidAt?: Date | null;
  payoutAmount?: number;
} = {}) {
  const id = input.id ?? 'settlement-line-sale';
  const payoutBatchLines = input.payoutStatus
    ? [{
        settlementApprovalLineId: id,
        amountSnapshot: input.payoutAmount ?? 1540,
        payoutBatch: {
          id: 'payout-1',
          status: input.payoutStatus,
          paidAt: input.paidAt ?? null,
        },
      }]
    : [];
  return {
    id,
    lineType: input.lineType ?? 'SALE',
    amountMinor: 200000,
    commissionMinor: 30000,
    commissionVatMinor: 6000,
    payableImpactMinor: input.payableImpactMinor ?? 154000,
    settlementApproval: {
      id: 'approval-1',
      status: input.status ?? 'APPROVED',
      approvedAt: new Date('2026-06-01T09:00:00.000Z'),
      commissionInvoices: [],
    },
    payoutBatchLines,
  };
}

function ledgerFixture(input: {
  commissionSnapshot?: number | null;
  approvalLines?: ReturnType<typeof approvedLine>[];
  payoutStatus?: string;
  shippingMode?: string;
  shippingCost?: number | null;
} = {}) {
  const approvalLines = input.approvalLines ?? [];
  return {
    id: 'sale-1',
    vendorAllocationId: 'allocation-1',
    vendorId: 'vendor-1',
    entryType: 'sale',
    amount: 2000,
    payoutStatus: input.payoutStatus ?? 'PENDING',
    settlementStatus: 'PAYABLE',
    settlementEligibleAt: new Date('2026-05-31T09:00:00.000Z'),
    accruedAt: new Date('2026-05-01T09:00:00.000Z'),
    payableAt: new Date('2026-05-31T09:00:00.000Z'),
    settledAt: null,
    settlementHoldReason: null,
    settlementDelayDaysSnapshot: 21,
    commissionPercentSnapshot: input.commissionSnapshot === undefined ? 15 : input.commissionSnapshot,
    commissionVatPercentSnapshot: 20,
    deductShippingEnabledSnapshot: true,
    shippingModeSnapshot: input.shippingMode ?? 'FIXED',
    fixedShippingFeeSnapshot: 100,
    shippingCostSnapshot: input.shippingCost ?? null,
    shippingVatAmountSnapshot: null,
    shippingCostSourceSnapshot: null,
    shippingCostProviderSnapshot: null,
    createdAt: new Date('2026-05-01T09:00:00.000Z'),
    payoutBatchLines: [],
    settlementApprovalLines: approvalLines,
    vendorAllocation: {
      id: 'allocation-1',
      assignedVendorId: 'vendor-1',
      allocationStatus: 'FULFILLED',
      cancelRefundReviewStatus: null,
      fulfillmentStatus: 'Fulfilled',
      shippingStatus: 'Delivered',
      order: { cancelledAt: null },
      fulfillment: {
        fulfilledAt: new Date('2026-05-10T09:00:00.000Z'),
        shipmentUpdatedAt: new Date('2026-05-10T09:00:00.000Z'),
      },
      refundRecords: [],
      returnRecords: [],
      outboundShopifyRefundAttempts: [],
      customerCancellationRequestItems: [],
      financeEntries: [{
        id: 'sale-1',
        entryType: 'sale',
        payoutStatus: input.payoutStatus ?? 'PENDING',
        settlementStatus: 'PAYABLE',
        commissionPercentSnapshot: input.commissionSnapshot === undefined ? 15 : input.commissionSnapshot,
        commissionVatPercentSnapshot: 20,
        payoutBatchLines: approvalLines.flatMap((line) => line.payoutBatchLines.map((payoutLine) => ({
          payoutBatch: { status: payoutLine.payoutBatch.status },
        }))),
        settlementApprovalLines: approvalLines,
      }],
    },
  };
}

describe('allocation finance summary', () => {
  it('uses only stored sale snapshots for the authoritative estimate', () => {
    const summary = buildAllocationFinanceSummary(ledgerFixture() as never);

    expect(summary).toMatchObject({
      available: true,
      resolutionStatus: 'resolved',
      productValue: '2000.00',
      commission: '300.00',
      commissionVat: '60.00',
      shippingDeduction: '100.00',
      primaryPayable: { type: 'estimated', amount: '1540.00' },
      payoutStatus: 'pending',
    });
  });

  it('fails closed instead of using a current/default commission profile', () => {
    const summary = buildAllocationFinanceSummary(ledgerFixture({ commissionSnapshot: null }) as never);

    expect(summary).toMatchObject({
      available: false,
      resolutionStatus: 'missing_finance_snapshot',
      commission: null,
      primaryPayable: null,
    });
  });

  it('uses frozen approved settlement contributions instead of an estimate', () => {
    const summary = buildAllocationFinanceSummary(ledgerFixture({
      commissionSnapshot: null,
      approvalLines: [approvedLine()],
    }) as never);

    expect(summary).toMatchObject({
      available: true,
      commission: '300.00',
      commissionVat: '60.00',
      shippingDeduction: '100.00',
      primaryPayable: { type: 'approved', amount: '1540.00' },
    });
  });

  it('uses an exact paid payout-line contribution only with local paidAt evidence', () => {
    const paidAt = new Date('2026-06-10T11:00:00.000Z');
    const summary = buildAllocationFinanceSummary(ledgerFixture({
      approvalLines: [approvedLine({ payoutStatus: 'PAID', paidAt })],
      payoutStatus: 'PAID',
    }) as never);

    expect(summary).toMatchObject({
      primaryPayable: { type: 'paid_payout_contribution', amount: '1540.00' },
      payoutStatus: 'paid',
      paidAt: paidAt.toISOString(),
    });
  });

  it('fails closed when a PAID batch lacks local paidAt evidence', () => {
    const summary = buildAllocationFinanceSummary(ledgerFixture({
      approvalLines: [approvedLine({ payoutStatus: 'PAID', paidAt: null })],
      payoutStatus: 'PAID',
    }) as never);

    expect(summary).toMatchObject({
      available: false,
      resolutionStatus: 'ambiguous_payout_authority',
      primaryPayable: null,
    });
  });

  it('does not treat PAID_PLACEHOLDER as paid and ignores cancelled payout authority', () => {
    const placeholder = buildAllocationFinanceSummary(ledgerFixture({
      approvalLines: [approvedLine({ payoutStatus: 'PAID_PLACEHOLDER' })],
    }) as never);
    const cancelled = buildAllocationFinanceSummary(ledgerFixture({
      approvalLines: [approvedLine({ payoutStatus: 'CANCELLED' })],
    }) as never);

    expect(placeholder.primaryPayable?.type).toBe('approved');
    expect(placeholder.payoutStatus).toBe('paid_placeholder');
    expect(cancelled.primaryPayable?.type).toBe('approved');
    expect(cancelled.payoutStatus).toBe('pending');
  });

  it('ignores cancelled settlement authority', () => {
    const summary = buildAllocationFinanceSummary(ledgerFixture({
      approvalLines: [approvedLine({ status: 'CANCELLED' })],
    }) as never);

    expect(summary.primaryPayable?.type).toBe('estimated');
  });

  it('returns pending shipping authority without reading provider execution cost', () => {
    const summary = buildAllocationFinanceSummary(ledgerFixture({
      shippingMode: 'EXTERNAL_PROVIDER',
      shippingCost: null,
    }) as never);

    expect(summary).toMatchObject({
      available: false,
      resolutionStatus: 'missing_finance_snapshot',
      productValue: '2000.00',
      shippingDeductionStatus: 'pending',
      primaryPayable: null,
    });
  });

  it.each([
    ['multiple active sales', {
      id: 'allocation-1',
      financeEntries: [
        { id: 'sale-1', vendorId: 'vendor-1', entryType: 'sale', voidedAt: null, supersededByLedgerId: null, supersededBy: null },
        { id: 'sale-2', vendorId: 'vendor-1', entryType: 'sale', voidedAt: null, supersededByLedgerId: null, supersededBy: null },
      ],
      economicTransfers: [],
    }, 'multiple_active_sale_ledgers'],
    ['transfer in progress', {
      id: 'allocation-1',
      financeEntries: [],
      economicTransfers: [{ id: 'transfer-1', status: 'IN_PROGRESS', createdAt: new Date() }],
    }, 'transfer_in_progress'],
    ['transfer failed', {
      id: 'allocation-1',
      financeEntries: [],
      economicTransfers: [{ id: 'transfer-1', status: 'FAILED', createdAt: new Date() }],
    }, 'transfer_failed'],
  ])('fails closed for %s without querying finance details', async (_label, allocation, expectedStatus) => {
    const db = {
      vendorAllocation: { findUnique: vi.fn().mockResolvedValue(allocation) },
      financeLedgerEntry: { findUnique: vi.fn() },
    };

    const summary = await getAllocationFinanceSummary({
      vendorAllocationId: 'allocation-1',
      expectedVendorId: 'vendor-1',
      db: db as never,
    });

    expect(summary).toMatchObject({ available: false, resolutionStatus: expectedStatus });
    expect(db.financeLedgerEntry.findUnique).not.toHaveBeenCalled();
  });

  it('uses the resolver-selected replacement/economic-owner ledger and performs reads only', async () => {
    const ledger = ledgerFixture();
    const db = {
      vendorAllocation: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'allocation-1',
          financeEntries: [{
            id: 'sale-1',
            vendorId: 'vendor-1',
            entryType: 'sale',
            voidedAt: null,
            supersededByLedgerId: null,
            supersededBy: null,
          }],
          economicTransfers: [{ id: 'transfer-complete', status: 'COMPLETED', createdAt: new Date() }],
        }),
      },
      financeLedgerEntry: { findUnique: vi.fn().mockResolvedValue(ledger) },
    };

    const summary = await getAllocationFinanceSummary({
      vendorAllocationId: 'allocation-1',
      expectedVendorId: 'vendor-1',
      db: db as never,
    });

    expect(summary.available).toBe(true);
    expect(db.financeLedgerEntry.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'sale-1' },
    }));
    expect(Object.keys(db)).toEqual(['vendorAllocation', 'financeLedgerEntry']);
  });

  it('fails closed before reading finance details when the resolved economic owner differs from vendor scope', async () => {
    const db = {
      vendorAllocation: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'allocation-1',
          financeEntries: [{
            id: 'sale-foreign',
            vendorId: 'vendor-2',
            entryType: 'sale',
            voidedAt: null,
            supersededByLedgerId: null,
            supersededBy: null,
          }],
          economicTransfers: [],
        }),
      },
      financeLedgerEntry: { findUnique: vi.fn() },
    };

    const summary = await getAllocationFinanceSummary({
      vendorAllocationId: 'allocation-1',
      expectedVendorId: 'vendor-1',
      db: db as never,
    });

    expect(summary).toMatchObject({ available: false, resolutionStatus: 'economic_owner_mismatch' });
    expect(db.financeLedgerEntry.findUnique).not.toHaveBeenCalled();
  });
});
