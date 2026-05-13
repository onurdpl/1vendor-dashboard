export type OperationalSignalSeverityDto = 'info' | 'warning' | 'high' | 'critical';
export type OperationalSignalStatusDto = 'active' | 'acknowledged' | 'resolved' | 'ignored';
export type OperationalSignalSourceAreaDto =
  | 'payout'
  | 'refund'
  | 'fulfillment'
  | 'diagnostics'
  | 'reconciliation'
  | 'shipping_cost'
  | 'settlement';

export type OperationalSignalDto = {
  id: string;
  type: string;
  severity: OperationalSignalSeverityDto;
  sourceArea: OperationalSignalSourceAreaDto;
  vendorId: string | null;
  allocationId: string | null;
  financeLedgerEntryId: string | null;
  payoutBatchId: string | null;
  operationalJobId: string | null;
  title: string;
  description: string;
  suggestedAction: string | null;
  status: OperationalSignalStatusDto;
  ruleKey: string;
  triggeredAt: string;
  resolvedAt: string | null;
  metadata: unknown;
  createdAt: string;
  updatedAt: string;
};

export type OperationalSignalSummaryDto = {
  total: number;
  critical: number;
  high: number;
  warning: number;
  info: number;
};

export type OperationalSignalsResponseDto = {
  summary: OperationalSignalSummaryDto;
  signals: OperationalSignalDto[];
};

export type OperationalSignalLifecycleAction = 'acknowledge' | 'resolve' | 'ignore';
