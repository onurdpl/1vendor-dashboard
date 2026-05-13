export type AutomationActionStatusDto =
  | 'pending'
  | 'suggested'
  | 'executed'
  | 'skipped'
  | 'failed'
  | 'cancelled';

export type AutomationExecutionModeDto = 'manual' | 'assisted' | 'auto_safe';

export type AutomationActionTypeDto =
  | 'suggest_replay_webhook'
  | 'suggest_reconciliation'
  | 'suggest_payout_batch_review'
  | 'suggest_shipping_cost_attachment'
  | 'suggest_stale_fulfillment_review'
  | 'suggest_payout_review'
  | 'suggest_negative_payout_investigation'
  | 'suggest_dead_letter_investigation'
  | 'auto_create_reconciliation_candidate'
  | 'auto_generate_reminder_notification'
  | 'auto_prioritize_stale_queue_item';

export type AutomationActionDto = {
  id: string;
  signalId: string | null;
  type: AutomationActionTypeDto;
  status: AutomationActionStatusDto;
  executionMode: AutomationExecutionModeDto;
  vendorId: string | null;
  allocationId: string | null;
  financeLedgerEntryId: string | null;
  payoutBatchId: string | null;
  operationalJobId: string | null;
  title: string;
  description: string;
  resultSummary: string | null;
  executedAt: string | null;
  metadata: unknown;
  createdAt: string;
  updatedAt: string;
};

export type AutomationActionSummaryDto = {
  total: number;
  suggested: number;
  executed: number;
  failed: number;
  autoSafe: number;
};

export type AutomationActionsResponseDto = {
  summary: AutomationActionSummaryDto;
  actions: AutomationActionDto[];
};

export type AutomationActionExecutionMode = 'execute_safe' | 'mark_handled' | 'skip' | 'cancel';
