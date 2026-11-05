import type { FinanceTransaction } from './api/contracts';
import { safeArray } from '../services/real/formatting';
import { getFinanceOperationalProjection, isRefundDeductionSettlementReviewPending, normalizeFinanceStatus, type FinanceAudience } from './financeOperationalProjection';

export const UNKNOWN_FINANCE_VALUE = 'Unknown';

export function getPayoutActivityStatusLabel(record: FinanceTransaction, audience: 'admin' | 'vendor' = 'admin') {
  return getFinanceOperationalProjection(record, { audience }).legacyStatusLabel;
}

export function isZeroCurrencyValue(value: string | null | undefined) {
  return !/[1-9]/.test((value ?? '').replace(/[^\d]/g, ''));
}

export function parseCurrencyValue(value: string | null | undefined) {
  if (!value) {
    return 0;
  }
  const normalized = value.trim();
  const numeric = Number(normalized.replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return normalized.startsWith('-') ? -Math.abs(numeric) : numeric;
}

export function formatDeductionValue(value: string | null | undefined) {
  if (!value) {
    return UNKNOWN_FINANCE_VALUE;
  }
  if (value === UNKNOWN_FINANCE_VALUE) {
    return value;
  }
  if (value.startsWith('-') || isZeroCurrencyValue(value)) {
    return value;
  }
  return `-${value}`;
}

type VendorFinanceScenarioKind = 'sale' | 'refund' | 'adjustment' | 'shipping' | 'payout';
type VendorFinanceTypeLabel = 'Sipariş Geliri' | 'İade' | 'Bakiye Düzeltmesi' | 'Kargo' | 'Ödeme';
export type VendorFinanceStatusLabel = 'Hesaplanıyor' | 'İncelemede' | 'Hazır' | 'Beklemede' | 'Askıda' | 'Ödendi';
type VendorFinanceNextAction = 'İşlem Gerekmiyor' | 'İnceleme Bekleniyor' | 'Destek ile İletişime Geç';

export type VendorFinanceScenario = {
  kind: VendorFinanceScenarioKind;
  typeLabel: VendorFinanceTypeLabel;
  status: VendorFinanceStatusLabel;
  nextAction: VendorFinanceNextAction;
  tone: 'neutral' | 'info' | 'success' | 'warning' | 'attention' | 'danger';
};

function getAdjustmentStatuses(record: FinanceTransaction) {
  return safeArray(record.settlementRefundAdjustments).map((adjustment) => adjustment.status);
}

function hasAdjustmentStatus(record: FinanceTransaction, statuses: Array<NonNullable<FinanceTransaction['settlementRefundAdjustments']>[number]['status']>) {
  return getAdjustmentStatuses(record).some((status) => statuses.includes(status));
}

export function getPaymentEvidenceDate(record: FinanceTransaction) {
  return record.settlement?.settledAt ?? record.payoutBatch?.paidAt ?? null;
}

export function hasReliablePaidEvidence(record: FinanceTransaction) {
  return Boolean(
    record.payoutStatus?.trim().toLowerCase() === 'paid' &&
      record.settlement?.status === 'settled' &&
      getPaymentEvidenceDate(record),
  );
}

function isShippingFinanceScenario(record: FinanceTransaction) {
  const calculation = record.payoutCalculation;
  const shippingDeduction = parseCurrencyValue(calculation?.shippingDeduction);
  return Boolean(
    record.description?.toLowerCase().includes('shipping') ||
      calculation?.shippingCostStatus === 'pending_provider_cost' ||
      calculation?.shippingApplied ||
      calculation?.shippingCostSnapshot ||
      shippingDeduction !== 0,
  );
}

export function buildVendorFinanceScenario(
  kind: VendorFinanceScenarioKind,
  typeLabel: VendorFinanceTypeLabel,
  status: VendorFinanceStatusLabel,
  nextAction: VendorFinanceNextAction,
): VendorFinanceScenario {
  const tone =
    status === 'Hazır' || status === 'Ödendi'
      ? 'success'
      : status === 'İncelemede'
        ? 'attention'
        : status === 'Askıda'
          ? 'warning'
          : status === 'Beklemede'
            ? 'warning'
            : 'info';

  return {
    kind,
    typeLabel,
    status,
    nextAction,
    tone,
  };
}

export function getVendorFinanceScenario(record: FinanceTransaction): VendorFinanceScenario {
  const normalizedStatus = normalizeFinanceStatus(record.status);
  const payoutBatchStatus = record.payoutBatch?.status;

  if (isShippingFinanceScenario(record)) {
    if (record.payoutCalculation?.shippingCostStatus === 'pending_provider_cost') {
      return buildVendorFinanceScenario('shipping', 'Kargo', 'Beklemede', 'İnceleme Bekleniyor');
    }
    return buildVendorFinanceScenario('shipping', 'Kargo', 'Hazır', 'İşlem Gerekmiyor');
  }

  if (record.category === 'Refund') {
    if (hasReliablePaidEvidence(record)) {
      return buildVendorFinanceScenario('refund', 'İade', 'Ödendi', 'İşlem Gerekmiyor');
    }
    if (hasAdjustmentStatus(record, ['blocked', 'cancelled']) || normalizedStatus === 'Failed') {
      return buildVendorFinanceScenario('refund', 'İade', 'Beklemede', 'Destek ile İletişime Geç');
    }
    if (hasAdjustmentStatus(record, ['applied'])) {
      return buildVendorFinanceScenario('refund', 'İade', 'Hazır', 'İşlem Gerekmiyor');
    }
    if (
      hasAdjustmentStatus(record, ['pending', 'partially_applied']) ||
      record.settlement?.status === 'partially_refunded' ||
      isRefundDeductionSettlementReviewPending(record)
    ) {
      return buildVendorFinanceScenario('refund', 'İade', 'İncelemede', 'İnceleme Bekleniyor');
    }
    return buildVendorFinanceScenario('refund', 'İade', 'İncelemede', 'İnceleme Bekleniyor');
  }

  if (record.category === 'Adjustment') {
    if (hasAdjustmentStatus(record, ['blocked']) || normalizedStatus === 'Failed') {
      return buildVendorFinanceScenario('adjustment', 'Bakiye Düzeltmesi', 'Beklemede', 'Destek ile İletişime Geç');
    }
    if (hasAdjustmentStatus(record, ['pending', 'partially_applied'])) {
      return buildVendorFinanceScenario('adjustment', 'Bakiye Düzeltmesi', 'İncelemede', 'İnceleme Bekleniyor');
    }
    if (hasAdjustmentStatus(record, ['applied'])) {
      return buildVendorFinanceScenario('adjustment', 'Bakiye Düzeltmesi', 'Hazır', 'İşlem Gerekmiyor');
    }
    return buildVendorFinanceScenario('adjustment', 'Bakiye Düzeltmesi', 'Beklemede', 'İşlem Gerekmiyor');
  }

  if (record.category === 'Payout') {
    if (hasReliablePaidEvidence(record)) {
      return buildVendorFinanceScenario('payout', 'Ödeme', 'Ödendi', 'İşlem Gerekmiyor');
    }
    if (payoutBatchStatus === 'approved') {
      return buildVendorFinanceScenario('payout', 'Ödeme', 'Hazır', 'İşlem Gerekmiyor');
    }
    if (payoutBatchStatus === 'paid_placeholder') {
      return buildVendorFinanceScenario('payout', 'Ödeme', 'İncelemede', 'İnceleme Bekleniyor');
    }
    return buildVendorFinanceScenario('payout', 'Ödeme', 'Beklemede', 'İşlem Gerekmiyor');
  }

  if (hasReliablePaidEvidence(record)) {
    return buildVendorFinanceScenario('sale', 'Sipariş Geliri', 'Ödendi', 'İşlem Gerekmiyor');
  }
  if (record.settlement?.status === 'disputed' || normalizedStatus === 'Failed') {
    return buildVendorFinanceScenario('sale', 'Sipariş Geliri', 'Beklemede', 'Destek ile İletişime Geç');
  }
  if (record.settlement?.status === 'held') {
    return buildVendorFinanceScenario('sale', 'Sipariş Geliri', 'Askıda', 'İnceleme Bekleniyor');
  }
  if (record.settlement?.status === 'partially_refunded' || isRefundDeductionSettlementReviewPending(record)) {
    return buildVendorFinanceScenario('sale', 'Sipariş Geliri', 'İncelemede', 'İnceleme Bekleniyor');
  }
  if (payoutBatchStatus === 'approved') {
    return buildVendorFinanceScenario('sale', 'Sipariş Geliri', 'Hazır', 'İşlem Gerekmiyor');
  }
  if (payoutBatchStatus === 'paid_placeholder') {
    return buildVendorFinanceScenario('sale', 'Sipariş Geliri', 'İncelemede', 'İnceleme Bekleniyor');
  }
  if (payoutBatchStatus === 'draft' || payoutBatchStatus === 'review' || payoutBatchStatus === 'execution_pending') {
    return buildVendorFinanceScenario('sale', 'Sipariş Geliri', 'Beklemede', 'İşlem Gerekmiyor');
  }
  if (record.settlement?.status === 'payable' || record.settlement?.payoutReady) {
    return buildVendorFinanceScenario('sale', 'Sipariş Geliri', 'Hazır', 'İşlem Gerekmiyor');
  }
  return buildVendorFinanceScenario('sale', 'Sipariş Geliri', 'Hesaplanıyor', 'İşlem Gerekmiyor');
}

export function formatVendorScenarioAmount(value: string, scenario: VendorFinanceScenario) {
  if (scenario.kind === 'refund') {
    return formatDeductionValue(value);
  }
  return value;
}

export function formatAdminFinanceAmount(record: FinanceTransaction) {
  return `${record.category === 'Refund' || record.category === 'Adjustment' ? '-' : ''}${record.amount}`;
}

export function getFinanceSearchableText(
  record: FinanceTransaction,
  audience: FinanceAudience,
  vendor: { vendorId: string; vendorName: string },
) {
  const displayStatus = getPayoutActivityStatusLabel(record, audience);
  return [
    record.id,
    record.description,
    record.category,
    displayStatus,
    record.amount,
    record.counterparty,
    vendor.vendorName,
    vendor.vendorId,
    record.shopifyOrderNumber ?? '',
    record.shopifyOrderId ?? '',
    record.shopifyRefundId ?? '',
  ]
    .join(' ')
    .toLowerCase();
}

export function getFinancePresentation(
  record: FinanceTransaction,
  audience: FinanceAudience,
  vendor: { vendorId: string; vendorName: string },
) {
  const vendorScenario = getVendorFinanceScenario(record);
  return {
    adminDisplayedStatus: getPayoutActivityStatusLabel(record, 'admin'),
    vendorDisplayedStatus: vendorScenario.status,
    searchableStatus: getPayoutActivityStatusLabel(record, audience),
    formattedAmount: record.amount,
    displayedAmount: audience === 'vendor'
      ? formatVendorScenarioAmount(record.amount, vendorScenario)
      : formatAdminFinanceAmount(record),
    searchableText: getFinanceSearchableText(record, audience, vendor),
  };
}
