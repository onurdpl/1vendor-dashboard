import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  KPIStatCard,
  MetadataGroup,
  MetadataRow,
  OperationalTable,
  OperationalTableRow,
  SectionErrorRetry,
  StatusBadge,
} from '../components/OperationalPrimitives';
import { useAppReadiness } from '../lib/appReadiness';
import {
  approveSettlementApproval,
  cancelSettlementApproval,
  createSettlementApprovalDraft,
  getDatabaseHealth,
  getSettlementApproval,
  getSettlementApprovalAudit,
  getSettlementCommissionInvoiceDiagnostics,
  getSettlementCommissionInvoiceRecords,
  listSettlementApprovals,
  previewSettlementApproval,
  previewSettlementLogoCommissionInvoice,
  type DatabaseHealthResponse,
  type SettlementApproval,
  type SettlementApprovalAudit,
  type SettlementApprovalLine,
  type SettlementApprovalSummary,
  type SettlementApprovalPreview,
  type SettlementCommissionInvoiceDiagnostics,
  type SettlementCommissionInvoiceRecord,
  type SettlementLogoCommissionInvoicePreview,
} from '../features/finance/settlementApprovalsApi';
import { formatCurrency, formatDateTime, safeArray, safeStatusLabel } from '../services/real/formatting';

type ActionName =
  | 'preview'
  | 'createDraft'
  | 'fetchApproval'
  | 'approve'
  | 'cancel'
  | 'audit'
  | 'logoPreview'
  | 'invoiceRecords'
  | 'invoiceDiagnostics';

type WorkflowStepStatus = 'Waiting' | 'Ready' | 'Completed' | 'Blocked' | 'Warning';

type WorkflowStep = {
  number: number;
  title: string;
  status: WorkflowStepStatus;
  details: Array<{ label: string; value: unknown }>;
};

type QualityClassification = 'CLEAN' | 'WARNING' | 'BLOCKED';
type CandidateScopeMode = 'vendor_wide' | 'date_range' | 'selected_orders' | 'selected_allocations';
type WorkspaceTab = 'audit' | 'logo' | 'invoices' | 'history';

type RecommendedAction = {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  detail?: string;
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Request failed.';
}

function formatMinor(value: number | null | undefined, currency = 'TRY') {
  return formatCurrency((Number(value ?? 0) / 100).toFixed(2), currency);
}

function formatNumber(value: number | null | undefined) {
  return Number(value ?? 0).toLocaleString('en-US');
}

function formatDate(value: string | null | undefined) {
  return formatDateTime(value, undefined, 'Not set');
}

function valueOrDash(value: unknown) {
  if (value === null || value === undefined || value === '') {
    return '—';
  }
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }
  return String(value);
}

function formatPercentList(values: number[] | null | undefined) {
  return values?.length ? values.map((value) => `${value}%`).join(', ') : 'None';
}

function formatStringList(values: string[] | null | undefined) {
  return values?.length ? values.join(', ') : 'None';
}

function parseMultiValueInput(value: string) {
  return Array.from(new Set(value
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean)));
}

function readRecord(value: unknown): Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown) {
  return typeof value === 'string' ? value : null;
}

function getStatusTone(status: WorkflowStepStatus) {
  if (status === 'Completed') {
    return 'success';
  }
  if (status === 'Ready') {
    return 'info';
  }
  if (status === 'Blocked') {
    return 'danger';
  }
  if (status === 'Warning') {
    return 'warning';
  }
  return 'neutral';
}

function getQualityTone(classification: QualityClassification) {
  if (classification === 'CLEAN') {
    return 'success';
  }
  if (classification === 'BLOCKED') {
    return 'danger';
  }
  return 'warning';
}

function getScopeLabel(scope: string) {
  if (scope === 'date_range') {
    return 'Date Range';
  }
  if (scope === 'selected_orders') {
    return 'Selected Orders';
  }
  if (scope === 'selected_allocations') {
    return 'Selected Allocations';
  }
  return 'Vendor-wide';
}

function getDatabaseSourceLabel(health: DatabaseHealthResponse | null) {
  return (
    health?.financeAuditMetadata?.databaseSourceLabel ??
    health?.databaseSource?.databaseSourceLabel ??
    'unknown'
  );
}

function getDatabaseWarnings(health: DatabaseHealthResponse | null) {
  return [
    ...safeArray<string>(health?.databaseSource?.warnings),
    ...safeArray<string>(health?.financeAuditMetadata?.warnings),
  ];
}

function extractProductDetail(payload: Record<string, unknown> | null) {
  const details = Array.isArray(payload?.salesInvoiceDetails) ? payload?.salesInvoiceDetails : [];
  const firstDetail = details[0];
  if (!firstDetail || typeof firstDetail !== 'object' || Array.isArray(firstDetail)) {
    return null;
  }

  const productDetail = (firstDetail as Record<string, unknown>).productDetail;
  if (!productDetail || typeof productDetail !== 'object' || Array.isArray(productDetail)) {
    return null;
  }

  return productDetail as Record<string, unknown>;
}

function getApprovalTotals(approval: SettlementApproval | null) {
  if (!approval) {
    return null;
  }
  return {
    grossSalesMinor: approval.grossSalesMinor,
    refundTotalMinor: approval.refundTotalMinor,
    commissionMinor: approval.commissionMinor,
    commissionVatMinor: approval.commissionVatMinor,
    netPayableMinor: approval.netPayableMinor,
    currency: approval.currency,
  };
}

function LineSamples({ lines }: { lines: SettlementApprovalLine[] }) {
  const visibleLines = lines.slice(0, 10);

  if (!visibleLines.length) {
    return <p className="page-description">No eligible line samples returned.</p>;
  }

  return (
    <OperationalTable
      columns={['Ledger row', 'Type', 'Amount', 'Commission', 'VAT', 'Payable impact']}
      className="settlement-lines-table"
      stickyHeader={false}
    >
      {visibleLines.map((line) => (
        <OperationalTableRow key={`${line.financeLedgerEntryId}-${line.lineType}`}>
          <span>
            <strong>{line.financeLedgerEntryId}</strong>
            <small>{safeStatusLabel(line.eligibilityDecision, 'included')}</small>
          </span>
          <span>{line.lineType}</span>
          <span>{formatMinor(line.amountMinor)}</span>
          <span>{formatMinor(line.commissionMinor)}</span>
          <span>{formatMinor(line.commissionVatMinor)}</span>
          <span>{formatMinor(line.payableImpactMinor)}</span>
        </OperationalTableRow>
      ))}
    </OperationalTable>
  );
}

function AuditLines({ audit }: { audit: SettlementApprovalAudit | null }) {
  const lines = safeArray(audit?.lines).slice(0, 25);

  if (!audit) {
    return <p className="page-description">Load audit details after selecting an approval.</p>;
  }

  if (!lines.length) {
    return <p className="page-description">No audit lines returned for this approval.</p>;
  }

  return (
    <OperationalTable
      columns={['Ledger row', 'Stored', 'Derived', 'Payout', 'Decision', 'Reason']}
      className="settlement-audit-table"
      stickyHeader={false}
    >
      {lines.map((line) => (
        <OperationalTableRow key={`${line.financeLedgerEntryId}-${line.eligibilityReason}`}>
          <span>
            <strong>{line.financeLedgerEntryId}</strong>
          </span>
          <span>{valueOrDash(line.storedSettlementStatus)}</span>
          <span>{valueOrDash(line.derivedSettlementStatus)}</span>
          <span>{valueOrDash(line.payoutStatus)}</span>
          <span>
            <StatusBadge status={line.eligibilityDecision}>{safeStatusLabel(line.eligibilityDecision)}</StatusBadge>
          </span>
          <span>
            <strong>{line.eligibilityReason}</strong>
          </span>
        </OperationalTableRow>
      ))}
    </OperationalTable>
  );
}

function ReadinessList({ title, items, tone }: { title: string; items: string[]; tone: 'danger' | 'warning' }) {
  if (!items.length) {
    return null;
  }

  return (
    <div className={`settlement-alert op-tone-${tone}`}>
      <strong>{title}</strong>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function WorkflowProgress({
  steps,
}: {
  steps: WorkflowStep[];
}) {
  return (
    <section className="settlement-workflow" aria-label="Settlement workflow progress">
      <div className="settlement-workflow-steps">
        {steps.map((step) => (
          <article key={step.number} className={`settlement-workflow-step op-tone-${getStatusTone(step.status)}`}>
            <div className="settlement-workflow-step-header">
              <strong>{step.title}</strong>
              <StatusBadge tone={getStatusTone(step.status)}>{step.status}</StatusBadge>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function SummaryField({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="settlement-summary-field">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function WorkspaceHeader({
  vendor,
  scope,
  quality,
  approvalStatus,
  rows,
  netPayable,
}: {
  vendor: string;
  scope: string;
  quality: QualityClassification | 'Not previewed';
  approvalStatus: string;
  rows: string;
  netPayable: string;
}) {
  return (
    <section className="settlement-workspace-header">
      <div>
        <p className="eyebrow">Admin finance</p>
        <h1>Settlement Workspace</h1>
        <p className="page-description">
          {vendor} · {scope} · {quality} quality · {safeStatusLabel(approvalStatus)} · {rows} rows · {netPayable}
        </p>
      </div>
      <div className="settlement-executive-summary" aria-label="Settlement executive summary">
        <SummaryField label="Vendor" value={vendor} />
        <SummaryField label="Scope" value={scope} />
        <SummaryField label="Quality" value={<StatusBadge tone={quality === 'Not previewed' ? 'neutral' : getQualityTone(quality)}>{quality}</StatusBadge>} />
        <SummaryField label="Approval" value={<StatusBadge status={approvalStatus}>{safeStatusLabel(approvalStatus)}</StatusBadge>} />
        <SummaryField label="Rows" value={rows} />
        <SummaryField label="Net Payable" value={netPayable} />
      </div>
    </section>
  );
}

function NextActionPanel({
  recommendedNextAction,
  recommendedAction,
}: {
  recommendedNextAction: string;
  recommendedAction: RecommendedAction;
}) {
  return (
    <aside className="settlement-next-action">
      <span className="eyebrow">Next Action</span>
      <h2>{recommendedAction.label}</h2>
      <p>{recommendedNextAction}</p>
      {recommendedAction.detail ? <small>{recommendedAction.detail}</small> : null}
      <button
        type="button"
        className="button button-primary"
        onClick={recommendedAction.onClick}
        disabled={recommendedAction.disabled || !recommendedAction.onClick}
      >
        {recommendedAction.label}
      </button>
    </aside>
  );
}

function RecentApprovalsPanel({
  approvals,
  loading,
  onOpenApproval,
  activeApprovalId,
}: {
  approvals: SettlementApprovalSummary[];
  loading: boolean;
  onOpenApproval: (id: string) => void;
  activeApprovalId: string;
}) {
  const visibleApprovals = safeArray(approvals);
  return (
    <section className="settlement-history-panel">
      <h3>Recent approvals</h3>
      <p className="page-description">Newest first for the selected vendor. Opening an approval loads this workspace context.</p>
      {loading ? <p className="page-description">Loading recent approvals...</p> : null}
      {!loading && visibleApprovals.length === 0 ? <p className="page-description">No settlement approvals found.</p> : null}
      {visibleApprovals.length ? (
        <OperationalTable
          columns={['Created', 'Status', 'Vendor', 'Lines', 'Gross sales', 'Net payable', 'Approved', 'Workspace']}
          className="settlement-approvals-table"
          stickyHeader={false}
        >
          {visibleApprovals.map((item) => (
            <OperationalTableRow key={item.id}>
              <span>
                <strong>{formatDate(item.createdAt)}</strong>
                {item.id === activeApprovalId ? <small>Open in workspace</small> : null}
              </span>
              <span><StatusBadge status={item.status}>{safeStatusLabel(item.status)}</StatusBadge></span>
              <span>{item.vendorId}</span>
              <span>{formatNumber(item.lineCount)}</span>
              <span>{formatMinor(item.grossSalesMinor, item.currency)}</span>
              <span>{formatMinor(item.netPayableMinor, item.currency)}</span>
              <span>{formatDate(item.approvedAt)}</span>
              <span>
                <button type="button" className="button button-secondary button-compact" onClick={() => onOpenApproval(item.id)}>
                  Open
                </button>
              </span>
            </OperationalTableRow>
          ))}
        </OperationalTable>
      ) : null}
    </section>
  );
}

function CandidateSelectionSummary({ preview }: { preview: SettlementApprovalPreview }) {
  const selection = preview.candidateSelectionSummary;
  return (
    <MetadataGroup title="Candidate selection">
      <MetadataRow label="Candidate Scope" value={getScopeLabel(preview.candidateScope)} />
      <MetadataRow label="Requested Orders" value={formatStringList(selection.requestedOrders)} />
      <MetadataRow label="Matched Orders" value={formatStringList(selection.matchedOrders)} />
      <MetadataRow label="Unmatched Orders" value={formatStringList(selection.unmatchedOrders)} />
      <MetadataRow label="Requested Allocations" value={formatStringList(selection.requestedAllocations)} />
      <MetadataRow label="Matched Allocations" value={formatStringList(selection.matchedAllocations)} />
      <MetadataRow label="Unmatched Allocations" value={formatStringList(selection.unmatchedAllocations)} />
      <MetadataRow label="Candidate Rows" value={formatNumber(selection.candidateRowCount)} />
    </MetadataGroup>
  );
}

function CandidateQualityCard({
  preview,
  classification,
  reasons,
  requiresAcknowledgement,
  acknowledged,
  onAcknowledgedChange,
}: {
  preview: SettlementApprovalPreview;
  classification: QualityClassification;
  reasons: string[];
  requiresAcknowledgement: boolean;
  acknowledged: boolean;
  onAcknowledgedChange: (value: boolean) => void;
}) {
  const summary = preview.summary;

  return (
    <section id="candidate-quality-card" className={`settlement-quality-card op-tone-${getQualityTone(classification)}`}>
      <div className="settlement-quality-heading">
        <div>
          <h3>Candidate Quality</h3>
          <p className="page-description">Review settlement quality before creating a draft.</p>
        </div>
        <StatusBadge tone={getQualityTone(classification)}>{classification}</StatusBadge>
      </div>
      <div className="settlement-quality-grid">
        <MetadataGroup title="Snapshot groups">
          <MetadataRow label="Commission Rates" value={formatPercentList(summary.detectedCommissionRates)} />
          <MetadataRow label="Detected Commission VAT Rates" value={formatPercentList(summary.detectedCommissionVatRates)} />
          <MetadataRow label="Shipping Modes" value={formatStringList(summary.detectedShippingModes)} />
          <MetadataRow label="Financial Profile Snapshot Groups" value={formatStringList(summary.detectedFinancialProfileSnapshotIds)} />
        </MetadataGroup>
        <MetadataGroup title="Candidate rows">
          <MetadataRow label="Candidate Scope" value={getScopeLabel(preview.candidateScope)} />
          <MetadataRow label="Eligible Rows" value={formatNumber(summary.eligibleRowCount)} />
          <MetadataRow label="Excluded Rows" value={formatNumber(summary.excludedActiveApprovalRowCount)} />
          <MetadataRow label="Profile Group Count" value={formatNumber(summary.detectedFinancialProfileSnapshotIds.length)} />
          <MetadataRow label="Quality" value={classification} />
        </MetadataGroup>
      </div>
      {reasons.length ? (
        <div className={`settlement-alert op-tone-${classification === 'BLOCKED' ? 'danger' : 'warning'}`}>
          <strong>Reason</strong>
          <ul>
            {reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className={`settlement-alert op-tone-${getQualityTone(classification)}`}>
        <strong>Draft Safety</strong>
        <p>This settlement contains {formatNumber(summary.eligibleRowCount)} rows. Quality classification: {classification}.</p>
        {requiresAcknowledgement ? (
          <label className="settlement-acknowledgement">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => onAcknowledgedChange(event.target.checked)}
            />
            <span>I acknowledge this candidate is BLOCKED for Logo readiness and still want to create a review draft.</span>
          </label>
        ) : null}
      </div>
    </section>
  );
}

export function AdminSettlementApprovalsPage() {
  const appReadiness = useAppReadiness();
  const initialVendorId = appReadiness.currentVendor.vendorId || 'yalispor';
  const [vendorId, setVendorId] = useState(initialVendorId);
  const [approvalId, setApprovalId] = useState('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [candidateScopeMode, setCandidateScopeMode] = useState<CandidateScopeMode>('vendor_wide');
  const [selectedOrderNumbers, setSelectedOrderNumbers] = useState('');
  const [selectedShopifyOrderIds, setSelectedShopifyOrderIds] = useState('');
  const [selectedAllocationIds, setSelectedAllocationIds] = useState('');
  const [notes, setNotes] = useState('Admin settlement approval draft');
  const [mixedVatAcknowledged, setMixedVatAcknowledged] = useState(false);
  const [health, setHealth] = useState<DatabaseHealthResponse | null>(null);
  const [preview, setPreview] = useState<SettlementApprovalPreview | null>(null);
  const [approval, setApproval] = useState<SettlementApproval | null>(null);
  const [recentApprovals, setRecentApprovals] = useState<SettlementApprovalSummary[]>([]);
  const [recentApprovalsLoading, setRecentApprovalsLoading] = useState(false);
  const [audit, setAudit] = useState<SettlementApprovalAudit | null>(null);
  const [logoPreview, setLogoPreview] = useState<SettlementLogoCommissionInvoicePreview | null>(null);
  const [invoiceRecords, setInvoiceRecords] = useState<SettlementCommissionInvoiceRecord[]>([]);
  const [diagnostics, setDiagnostics] = useState<Record<string, SettlementCommissionInvoiceDiagnostics>>({});
  const [busyAction, setBusyAction] = useState<ActionName | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('history');

  useEffect(() => {
    setVendorId((current) => current || appReadiness.currentVendor.vendorId || 'yalispor');
  }, [appReadiness.currentVendor.vendorId]);

  useEffect(() => {
    let cancelled = false;
    void getDatabaseHealth()
      .then((response) => {
        if (!cancelled) {
          setHealth(response);
        }
      })
      .catch((requestError) => {
        if (!cancelled) {
          setError(getErrorMessage(requestError));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const selectedVendorId = vendorId.trim();
    if (!selectedVendorId) {
      setRecentApprovals([]);
      return;
    }

    let cancelled = false;
    setRecentApprovalsLoading(true);
    void listSettlementApprovals(selectedVendorId)
      .then((response) => {
        if (!cancelled) {
          setRecentApprovals(safeArray(response?.approvals));
        }
      })
      .catch((requestError) => {
        if (!cancelled) {
          setRecentApprovals([]);
          setError(getErrorMessage(requestError));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setRecentApprovalsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [vendorId]);

  const activeInvoiceRecords = useMemo(
    () => invoiceRecords.filter((record) => record.status.toLowerCase() !== 'cancelled'),
    [invoiceRecords],
  );
  const productDetail = extractProductDetail(logoPreview?.logoPayloadPreview ?? null);
  const selectedApprovalId = approvalId.trim() || approval?.id || '';
  const currentTotals = getApprovalTotals(approval);
  const workspaceTotals = preview
    ? {
        grossSalesMinor: preview.summary.grossSalesMinor,
        refundTotalMinor: preview.summary.refundTotalMinor,
        commissionMinor: preview.summary.commissionMinor,
        commissionVatMinor: preview.summary.commissionVatMinor,
        netPayableMinor: preview.summary.netPayableMinor,
        currency: preview.summary.currency,
      }
    : currentTotals;
  const dbWarnings = getDatabaseWarnings(health);
  const previewRowsLockedInActiveApproval = Boolean(
    preview &&
    preview.summary.eligibleRowCount === 0 &&
    preview.summary.excludedActiveApprovalRowCount > 0,
  );
  const candidateQualityWarnings = safeArray<string>(preview?.summary.candidateQualityWarnings);
  const selectedOrderNumberList = parseMultiValueInput(selectedOrderNumbers);
  const selectedShopifyOrderIdList = parseMultiValueInput(selectedShopifyOrderIds);
  const selectedAllocationIdList = parseMultiValueInput(selectedAllocationIds);
  const activeFilterSummary = (() => {
    if (candidateScopeMode === 'selected_orders') {
      return [
        selectedOrderNumberList.length ? `Orders ${formatStringList(selectedOrderNumberList)}` : null,
        selectedShopifyOrderIdList.length ? `Shopify IDs ${formatStringList(selectedShopifyOrderIdList)}` : null,
      ].filter(Boolean).join(' · ') || 'Selected Orders: no identifiers entered';
    }
    if (candidateScopeMode === 'selected_allocations') {
      return selectedAllocationIdList.length
        ? `Allocations ${formatStringList(selectedAllocationIdList)}`
        : 'Selected Allocations: no identifiers entered';
    }
    if (candidateScopeMode === 'date_range') {
      return [
        periodStart ? `Start ${periodStart}` : null,
        periodEnd ? `End ${periodEnd}` : null,
      ].filter(Boolean).join(' · ') || 'Date Range: no dates entered';
    }
    return 'Vendor-wide preview';
  })();
  const vendorWideMode = candidateScopeMode === 'vendor_wide';
  const approvalGeneratedAt = readString(readRecord(approval?.sourceSnapshotJson).generatedAt);
  const latestInvoiceRecord = invoiceRecords[0] ?? null;
  const auditReasonsAvailable = Boolean(audit?.lines.length && audit.lines.every((line) => line.eligibilityReason));
  const logoBindingReady = Boolean(
    logoPreview?.vendorBillingReadiness.logoCustomerCodePresent &&
    logoPreview.vendorBillingReadiness.logoCustomerIdPresent,
  );
  const candidateQualityClassification: QualityClassification = !preview
    ? 'WARNING'
    : preview.summary.mixedCommissionVatRate
      ? 'BLOCKED'
      : preview.summary.mixedShippingMode || preview.summary.detectedFinancialProfileSnapshotIds.length > 1
        ? 'WARNING'
        : 'CLEAN';
  const candidateQualityReasons = (() => {
    if (!preview) {
      return [];
    }
    const reasons: string[] = [];
    if (preview.summary.mixedCommissionVatRate) {
      reasons.push('Mixed VAT rates prevent Logo commission invoice readiness.');
    }
    if (preview.summary.mixedShippingMode) {
      reasons.push('Multiple shipping modes require review before settlement approval.');
    }
    if (preview.summary.detectedFinancialProfileSnapshotIds.length > 1) {
      reasons.push('Multiple financial profile snapshot groups are included.');
    }
    return reasons.length ? reasons : ['Candidate snapshots are uniform for VAT, shipping mode, and financial profile group.'];
  })();
  const candidateScopeReady = candidateScopeMode !== 'date_range' || Boolean(periodStart || periodEnd);
  const draftBlockedByAcknowledgement = candidateQualityClassification === 'BLOCKED' && !mixedVatAcknowledged;
  const draftStepStatus: WorkflowStepStatus = approval
    ? 'Completed'
    : draftBlockedByAcknowledgement || (preview ? preview.summary.eligibleRowCount === 0 : false)
      ? 'Blocked'
      : preview
        ? 'Ready'
        : 'Waiting';
  const approvalStepStatus: WorkflowStepStatus = approval?.status === 'approved'
    ? 'Completed'
    : approval?.status === 'draft'
      ? 'Ready'
      : approval?.status === 'cancelled'
        ? 'Blocked'
        : 'Waiting';
  const auditStepStatus: WorkflowStepStatus = audit
    ? 'Completed'
    : approval?.status === 'approved'
      ? 'Ready'
      : 'Waiting';
  const logoStepStatus: WorkflowStepStatus = logoPreview
    ? logoPreview.readiness.canCreateLogoInvoiceLater && logoPreview.executionSnapshotGuard.ok
      ? 'Completed'
      : 'Blocked'
    : audit
      ? 'Ready'
      : 'Waiting';
  const invoiceRecordsStepStatus: WorkflowStepStatus = invoiceRecords.length ? 'Completed' : logoPreview ? 'Ready' : 'Waiting';
  const workspaceRows = preview
    ? formatNumber(preview.summary.eligibleRowCount)
    : approval
      ? formatNumber(approval.lines.length)
      : '0';
  const workspaceNetPayable = workspaceTotals
    ? formatMinor(workspaceTotals.netPayableMinor, workspaceTotals.currency)
    : formatMinor(0);
  const workspaceApprovalStatus = approval?.status ?? 'not created';
  const workspaceQualityLabel = preview ? candidateQualityClassification : 'Not previewed';
  const selectedOrdersOrAllocations = (() => {
    if (candidateScopeMode === 'selected_orders') {
      return formatStringList([...selectedOrderNumberList, ...selectedShopifyOrderIdList]);
    }
    if (candidateScopeMode === 'selected_allocations') {
      return formatStringList(selectedAllocationIdList);
    }
    if (candidateScopeMode === 'date_range') {
      return activeFilterSummary;
    }
    return 'All eligible vendor rows';
  })();
  const workflowSteps: WorkflowStep[] = [
    {
      number: 1,
      title: 'Selected',
      status: vendorId.trim() ? 'Ready' : 'Blocked',
      details: [
        { label: 'Vendor selected', value: vendorId.trim() || null },
        { label: 'Candidate scope', value: getScopeLabel(candidateScopeMode) },
        { label: 'Candidate filter', value: activeFilterSummary },
        { label: 'Selection warning', value: vendorWideMode ? 'Vendor-wide selection can include historical or test rows.' : 'Explicit candidate filter selected.' },
      ],
    },
    {
      number: 2,
      title: 'Previewed',
      status: preview ? 'Completed' : vendorId.trim() ? 'Ready' : 'Waiting',
      details: [
        { label: 'Eligible rows', value: preview ? formatNumber(preview.summary.eligibleRowCount) : 'Not loaded' },
        { label: 'Excluded rows', value: preview ? formatNumber(preview.summary.excludedActiveApprovalRowCount) : 'Not loaded' },
        { label: 'Net payable', value: preview ? formatMinor(preview.summary.netPayableMinor, preview.summary.currency) : 'Not loaded' },
      ],
    },
    {
      number: 3,
      title: 'Drafted',
      status: draftStepStatus,
      details: [
        { label: 'Draft exists', value: Boolean(approval) },
        { label: 'Draft id', value: approval?.id ?? null },
        { label: 'Created at', value: approval?.createdAt ? formatDate(approval.createdAt) : approvalGeneratedAt ? formatDate(approvalGeneratedAt) : 'Not available' },
      ],
    },
    {
      number: 4,
      title: 'Approved',
      status: approvalStepStatus,
      details: [
        { label: 'Approval status', value: approval?.status ?? 'Not created' },
        { label: 'Approved at', value: approval?.approvedAt ? formatDate(approval.approvedAt) : 'Not approved' },
        { label: 'Approved by', value: approval?.approvedBy ?? null },
      ],
    },
    {
      number: 5,
      title: 'Audited',
      status: auditStepStatus,
      details: [
        { label: 'Audit loaded', value: Boolean(audit) },
        { label: 'Line count', value: audit ? formatNumber(audit.lines.length) : 'Not loaded' },
        { label: 'Eligibility reasons', value: audit ? (auditReasonsAvailable ? 'Available' : 'Missing') : 'Not loaded' },
      ],
    },
    {
      number: 6,
      title: 'Logo Ready',
      status: logoStepStatus,
      details: [
        { label: 'Can create later', value: logoPreview ? (logoPreview.readiness.canCreateLogoInvoiceLater ? 'Yes' : 'No') : 'Not checked' },
        { label: 'VAT source', value: logoPreview ? safeStatusLabel(logoPreview.vatRateSource) : 'Not checked' },
        { label: 'Detected VAT rates', value: logoPreview ? formatPercentList(logoPreview.detectedVatRates) : 'Not checked' },
        { label: 'Snapshot guard', value: logoPreview ? (logoPreview.executionSnapshotGuard.ok ? 'Pass' : 'Blocked') : 'Not checked' },
        { label: 'Billing readiness', value: logoPreview ? (logoPreview.vendorBillingReadiness.complete ? 'Complete' : 'Incomplete') : 'Not checked' },
        { label: 'Logo binding', value: logoPreview ? (logoBindingReady ? 'Ready' : 'Missing') : 'Not checked' },
      ],
    },
    {
      number: 7,
      title: 'Invoice Ready',
      status: invoiceRecordsStepStatus,
      details: [
        { label: 'Record count', value: formatNumber(invoiceRecords.length) },
        { label: 'Active record exists', value: activeInvoiceRecords.length > 0 },
        { label: 'Latest status', value: latestInvoiceRecord?.status ?? 'None loaded' },
      ],
    },
  ];
  const recommendedNextAction = (() => {
    if (!vendorId.trim()) {
      return 'Next: Select a vendor.';
    }
    if (!preview && !approval) {
      return 'Next: Preview settlement candidates.';
    }
    if (preview && !approval && draftBlockedByAcknowledgement) {
      return 'Next: Acknowledge blocked candidate quality before creating a draft.';
    }
    if (!approval) {
      return 'Next: Create Draft.';
    }
    if (approval.status === 'draft') {
      return 'Next: Approve Settlement.';
    }
    if (approval.status === 'cancelled') {
      return 'Settlement is cancelled. Select or create another approval.';
    }
    if (!audit) {
      return 'Next: Load Audit Snapshot.';
    }
    if (!logoPreview) {
      return 'Next: Run Logo Readiness.';
    }
    if (!invoiceRecords.length) {
      return 'Next: Load Commission Invoice Records.';
    }
    return 'Workflow review is complete. Preview another candidate scope when needed.';
  })();
  const recommendedAction: RecommendedAction = (() => {
    if (!vendorId.trim()) {
      return { label: 'Select vendor', disabled: true };
    }
    if (!preview && !approval) {
      return {
        label: 'Preview Settlement',
        detail: 'Read-only candidate preview.',
        onClick: () => void handlePreview(),
        disabled: busyAction !== null || !vendorId.trim() || !candidateScopeReady,
      };
    }
    if (!approval) {
      return {
        label: 'Create Draft',
        detail: 'Writes local DB only. No external provider calls.',
        onClick: () => void handleCreateDraft(),
        disabled: busyAction !== null || !preview || draftBlockedByAcknowledgement || !candidateScopeReady,
      };
    }
    if (approval.status === 'draft') {
      return {
        label: 'Approve Settlement',
        detail: 'Writes local DB approval state only.',
        onClick: () => void handleApprove(),
        disabled: busyAction !== null,
      };
    }
    if (approval.status === 'cancelled') {
      return { label: 'Select another approval', disabled: true };
    }
    if (!audit) {
      return {
        label: 'Load Audit',
        detail: 'Read-only audit snapshot.',
        onClick: () => void handleLoadAudit(),
        disabled: busyAction !== null,
      };
    }
    if (!logoPreview) {
      return {
        label: 'Run Logo Readiness',
        detail: 'Read-only Logo readiness preview. No Logo invoice is created.',
        onClick: () => void handleLogoPreview(),
        disabled: busyAction !== null,
      };
    }
    if (!invoiceRecords.length) {
      return {
        label: 'Load Commission Invoice Records',
        detail: 'Read-only invoice record list.',
        onClick: () => void handleInvoiceRecords(),
        disabled: busyAction !== null,
      };
    }
    return {
      label: 'Preview Settlement',
      detail: 'Read-only candidate preview for the current scope.',
      onClick: () => void handlePreview(),
      disabled: busyAction !== null || !vendorId.trim() || !candidateScopeReady,
    };
  })();

  function buildSettlementApprovalInput() {
    const base = {
      vendorId: vendorId.trim(),
      candidateScope: candidateScopeMode,
      periodStart: candidateScopeMode === 'date_range' ? periodStart || null : null,
      periodEnd: candidateScopeMode === 'date_range' ? periodEnd || null : null,
    };
    if (candidateScopeMode === 'selected_orders') {
      return {
        ...base,
        selectedOrderIds: selectedOrderNumberList,
        selectedShopifyOrderIds: selectedShopifyOrderIdList,
        selectedAllocationIds: [],
      };
    }
    if (candidateScopeMode === 'selected_allocations') {
      return {
        ...base,
        selectedOrderIds: [],
        selectedShopifyOrderIds: [],
        selectedAllocationIds: selectedAllocationIdList,
      };
    }
    return {
      ...base,
      selectedOrderIds: [],
      selectedShopifyOrderIds: [],
      selectedAllocationIds: [],
    };
  }

  function clearPeriodFilters() {
    setPeriodStart('');
    setPeriodEnd('');
    setSelectedOrderNumbers('');
    setSelectedShopifyOrderIds('');
    setSelectedAllocationIds('');
    setCandidateScopeMode('vendor_wide');
    setMixedVatAcknowledged(false);
  }

  function rememberApprovalSummary(nextApproval: SettlementApproval) {
    const summary: SettlementApprovalSummary = {
      id: nextApproval.id,
      createdAt: nextApproval.createdAt,
      vendorId: nextApproval.vendorId,
      status: nextApproval.status,
      currency: nextApproval.currency,
      grossSalesMinor: nextApproval.grossSalesMinor,
      netPayableMinor: nextApproval.netPayableMinor,
      approvedAt: nextApproval.approvedAt,
      lineCount: nextApproval.lines.length,
    };
    setRecentApprovals((current) => [summary, ...current.filter((item) => item.id !== summary.id)]
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
      .slice(0, 20));
  }

  async function runAction<T>(action: ActionName, callback: () => Promise<T>, successMessage?: string) {
    setBusyAction(action);
    setError(null);
    setSuccess(null);
    try {
      const result = await callback();
      if (successMessage) {
        setSuccess(successMessage);
      }
      return result;
    } catch (requestError) {
      setError(getErrorMessage(requestError));
      return null;
    } finally {
      setBusyAction(null);
    }
  }

  async function handlePreview() {
    setMixedVatAcknowledged(false);
    const result = await runAction('preview', () => previewSettlementApproval(buildSettlementApprovalInput()), 'Preview loaded.');
    if (result) {
      setPreview(result);
    }
  }

  async function handleCreateDraft() {
    const result = await runAction(
      'createDraft',
      () => createSettlementApprovalDraft({ ...buildSettlementApprovalInput(), notes: notes.trim() || null }),
      'Draft settlement approval created.',
    );
    if (result) {
      setApproval(result);
      setApprovalId(result.id);
      rememberApprovalSummary(result);
      setAudit(null);
      setLogoPreview(null);
      setInvoiceRecords([]);
      setDiagnostics({});
    }
  }

  async function handleFetchApproval() {
    const id = approvalId.trim();
    if (!id) {
      setError('Settlement approval id is required.');
      return;
    }
    const result = await runAction('fetchApproval', () => getSettlementApproval(id), 'Approval detail loaded.');
    if (result) {
      setApproval(result);
      setVendorId(result.vendorId);
      rememberApprovalSummary(result);
      setAudit(null);
      setLogoPreview(null);
      setInvoiceRecords([]);
      setDiagnostics({});
    }
  }

  async function handleOpenRecentApproval(id: string) {
    setApprovalId(id);
    const result = await runAction('fetchApproval', () => getSettlementApproval(id), 'Approval detail loaded.');
    if (result) {
      setApproval(result);
      setVendorId(result.vendorId);
      rememberApprovalSummary(result);
      setAudit(null);
      setLogoPreview(null);
      setInvoiceRecords([]);
      setDiagnostics({});
    }
  }

  async function handleApprove() {
    if (!selectedApprovalId) {
      setError('Settlement approval id is required.');
      return;
    }
    const result = await runAction('approve', () => approveSettlementApproval(selectedApprovalId), 'Draft approved.');
    if (result) {
      setApproval(result);
      rememberApprovalSummary(result);
    }
  }

  async function handleCancel() {
    if (!selectedApprovalId) {
      setError('Settlement approval id is required.');
      return;
    }
    const result = await runAction('cancel', () => cancelSettlementApproval(selectedApprovalId), 'Settlement approval cancelled.');
    if (result) {
      setApproval(result);
      rememberApprovalSummary(result);
    }
  }

  async function handleLoadAudit() {
    if (!selectedApprovalId) {
      setError('Settlement approval id is required.');
      return;
    }
    const result = await runAction('audit', () => getSettlementApprovalAudit(selectedApprovalId), 'Audit detail loaded.');
    if (result) {
      setAudit(result);
      setActiveTab('audit');
    }
  }

  async function handleLogoPreview() {
    if (!selectedApprovalId) {
      setError('Settlement approval id is required.');
      return;
    }
    const result = await runAction(
      'logoPreview',
      () => previewSettlementLogoCommissionInvoice(selectedApprovalId),
      'Logo readiness preview loaded.',
    );
    if (result) {
      setLogoPreview(result);
      setActiveTab('logo');
    }
  }

  async function handleInvoiceRecords() {
    if (!selectedApprovalId) {
      setError('Settlement approval id is required.');
      return;
    }
    const result = await runAction(
      'invoiceRecords',
      () => getSettlementCommissionInvoiceRecords(selectedApprovalId),
      'Commission invoice records loaded.',
    );
    if (result) {
      setInvoiceRecords(result.records);
      setActiveTab('invoices');
    }
  }

  async function handleDiagnostics(recordId: string) {
    const result = await runAction(
      'invoiceDiagnostics',
      () => getSettlementCommissionInvoiceDiagnostics(recordId),
      'Commission invoice diagnostics loaded.',
    );
    if (result) {
      setDiagnostics((current) => ({ ...current, [recordId]: result }));
    }
  }

  return (
    <section className="op-page settlement-approvals-page">
      <WorkspaceHeader
        vendor={vendorId.trim() || 'No vendor selected'}
        scope={getScopeLabel(candidateScopeMode)}
        quality={workspaceQualityLabel}
        approvalStatus={workspaceApprovalStatus}
        rows={workspaceRows}
        netPayable={workspaceNetPayable}
      />

      {dbWarnings.length ? <ReadinessList title="Database warnings" items={dbWarnings} tone="warning" /> : null}

      {error ? <SectionErrorRetry title="Finance action failed" description={error} /> : null}
      {success ? <div className="settlement-alert op-tone-success"><strong>{success}</strong></div> : null}

      <section className="settlement-workspace-grid">
        <aside className="settlement-context-panel">
          <div>
            <p className="eyebrow">Settlement Context</p>
            <h2>Current settlement</h2>
          </div>
          <div className="op-toolbar settlement-toolbar" aria-label="Settlement vendor controls">
            <label>
              <span>Vendor</span>
              <input value={vendorId} onChange={(event) => setVendorId(event.target.value)} placeholder="yalispor" />
            </label>
            <label>
              <span>Draft notes</span>
              <input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Internal admin note" />
            </label>
          </div>
          <div className="settlement-context-summary">
            <SummaryField label="Scope" value={getScopeLabel(candidateScopeMode)} />
            <SummaryField label="Selected Orders / Allocations" value={selectedOrdersOrAllocations} />
            <SummaryField label="Candidate Rows" value={preview ? formatNumber(preview.candidateSelectionSummary.candidateRowCount) : 'Not previewed'} />
            <SummaryField label="Quality" value={workspaceQualityLabel} />
            <SummaryField label="Approval Status" value={safeStatusLabel(workspaceApprovalStatus)} />
          </div>
          <section className="settlement-candidate-scope">
            <h3>Candidate Scope</h3>
            <div className="settlement-scope-options" role="radiogroup" aria-label="Candidate Scope">
              {(['vendor_wide', 'date_range', 'selected_orders', 'selected_allocations'] as CandidateScopeMode[]).map((scope) => (
                <label key={scope}>
                  <input
                    type="radio"
                    name="candidateScope"
                    value={scope}
                    checked={candidateScopeMode === scope}
                    onChange={() => {
                      setCandidateScopeMode(scope);
                      setMixedVatAcknowledged(false);
                    }}
                  />
                  <span>{getScopeLabel(scope)}</span>
                </label>
              ))}
            </div>
            {candidateScopeMode === 'date_range' ? (
              <div className="op-toolbar settlement-toolbar" aria-label="Settlement date range controls">
                <label>
                  <span>Period start</span>
                  <input
                    type="date"
                    value={periodStart}
                    onChange={(event) => {
                      setPeriodStart(event.target.value);
                      setMixedVatAcknowledged(false);
                    }}
                  />
                </label>
                <label>
                  <span>Period end</span>
                  <input
                    type="date"
                    value={periodEnd}
                    onChange={(event) => {
                      setPeriodEnd(event.target.value);
                      setMixedVatAcknowledged(false);
                    }}
                  />
                </label>
              </div>
            ) : null}
            {candidateScopeMode === 'date_range' && !candidateScopeReady ? (
              <div className="settlement-alert op-tone-warning">
                <strong>Date Range mode requires a period start or period end before preview.</strong>
              </div>
            ) : null}
            {candidateScopeMode === 'selected_orders' ? (
              <div className="settlement-selection-grid">
                <label>
                  <span>Order numbers</span>
                  <textarea
                    value={selectedOrderNumbers}
                    onChange={(event) => {
                      setSelectedOrderNumbers(event.target.value);
                      setMixedVatAcknowledged(false);
                    }}
                    placeholder="#1074, #1075"
                    rows={3}
                  />
                </label>
                <label>
                  <span>Shopify order ids</span>
                  <textarea
                    value={selectedShopifyOrderIds}
                    onChange={(event) => {
                      setSelectedShopifyOrderIds(event.target.value);
                      setMixedVatAcknowledged(false);
                    }}
                    placeholder="gid://shopify/Order/..."
                    rows={3}
                  />
                </label>
              </div>
            ) : null}
            {candidateScopeMode === 'selected_allocations' ? (
              <div className="settlement-selection-grid">
                <label>
                  <span>Allocation ids</span>
                  <textarea
                    value={selectedAllocationIds}
                    onChange={(event) => {
                      setSelectedAllocationIds(event.target.value);
                      setMixedVatAcknowledged(false);
                    }}
                    placeholder="allocation id, one per line or comma-separated"
                    rows={3}
                  />
                </label>
              </div>
            ) : null}
          </section>
          <div className="settlement-filter-summary">
            <strong>Active candidate filter</strong>
            <span>{activeFilterSummary}</span>
            <button
              type="button"
              className="button button-secondary button-compact"
              onClick={clearPeriodFilters}
              disabled={busyAction !== null || (candidateScopeMode === 'vendor_wide' && !periodStart && !periodEnd && !selectedOrderNumbers && !selectedShopifyOrderIds && !selectedAllocationIds)}
            >
              Clear filters
            </button>
          </div>
          {previewRowsLockedInActiveApproval ? (
            <div className="settlement-alert op-tone-warning">
              <strong>No eligible rows remain because rows are already locked in an active settlement approval.</strong>
            </div>
          ) : null}
        </aside>

        <main className="settlement-summary-panel">
          <div>
            <p className="eyebrow">Settlement Summary</p>
            <h2>Operational totals</h2>
          </div>
          {workspaceTotals ? (
            <div className="op-kpi-row settlement-summary-cards">
              <KPIStatCard label="Gross sales" value={formatMinor(workspaceTotals.grossSalesMinor, workspaceTotals.currency)} tone="info" />
              <KPIStatCard label="Commission" value={formatMinor(workspaceTotals.commissionMinor, workspaceTotals.currency)} tone="info" />
              <KPIStatCard label="Commission VAT" value={formatMinor(workspaceTotals.commissionVatMinor, workspaceTotals.currency)} tone="info" />
              <KPIStatCard label="Net payable" value={formatMinor(workspaceTotals.netPayableMinor, workspaceTotals.currency)} tone="success" />
            </div>
          ) : (
            <p className="page-description">Preview a settlement or open an approval to populate summary totals.</p>
          )}
          {preview ? (
            <>
              <CandidateQualityCard
                preview={preview}
                classification={candidateQualityClassification}
                reasons={candidateQualityReasons}
                requiresAcknowledgement={candidateQualityClassification === 'BLOCKED'}
                acknowledged={mixedVatAcknowledged}
                onAcknowledgedChange={setMixedVatAcknowledged}
              />
              <ReadinessList title="Candidate quality warnings" items={candidateQualityWarnings} tone="warning" />
              <CandidateSelectionSummary preview={preview} />
              <section className="op-panel-section">
                <h3>Sample eligible lines</h3>
                <LineSamples lines={preview.lines} />
              </section>
            </>
          ) : null}
        </main>

        <NextActionPanel recommendedNextAction={recommendedNextAction} recommendedAction={recommendedAction} />
      </section>

      <WorkflowProgress steps={workflowSteps} />

      <section className="settlement-tabs">
        <div className="settlement-tab-list" role="tablist" aria-label="Settlement workspace tabs">
          {[
            ['audit', 'Audit'],
            ['logo', 'Logo Readiness'],
            ['invoices', 'Commission Invoice Records'],
            ['history', 'History'],
          ].map(([tab, label]) => (
            <button
              key={tab}
              type="button"
              role="tab"
              className={activeTab === tab ? 'is-active' : ''}
              aria-selected={activeTab === tab}
              onClick={() => setActiveTab(tab as WorkspaceTab)}
            >
              {label}
            </button>
          ))}
        </div>

        {activeTab === 'audit' ? (
          <article className="settlement-tab-panel" role="tabpanel">
            <h3>Audit</h3>
            {audit ? (
              <>
                <MetadataGroup title="Audit snapshot">
                  <MetadataRow label="Status" value={safeStatusLabel(audit.status)} />
                  <MetadataRow label="Gross sales" value={formatMinor(audit.totals.grossSalesMinor, audit.totals.currency)} />
                  <MetadataRow label="Commission" value={formatMinor(audit.totals.commissionMinor, audit.totals.currency)} />
                  <MetadataRow label="Commission VAT" value={formatMinor(audit.totals.commissionVatMinor, audit.totals.currency)} />
                  <MetadataRow label="Net payable" value={formatMinor(audit.totals.netPayableMinor, audit.totals.currency)} />
                  <MetadataRow label="Eligibility reasons" value={auditReasonsAvailable ? 'Available' : 'Missing'} />
                </MetadataGroup>
                <AuditLines audit={audit} />
              </>
            ) : (
              <p className="page-description">Approve a draft, then use the next action to load the audit snapshot.</p>
            )}
          </article>
        ) : null}

        {activeTab === 'logo' ? (
          <article className="settlement-tab-panel" role="tabpanel">
            <h3>Logo Readiness</h3>
            <p className="page-description">Read-only preview. This does not call Logo create and does not create an invoice.</p>
            {logoPreview ? (
              <>
                <MetadataGroup title="Readiness">
                  <MetadataRow label="writesPerformed" value={String(logoPreview.writesPerformed)} />
                  <MetadataRow label="Can create later" value={logoPreview.readiness.canCreateLogoInvoiceLater ? 'Yes' : 'No'} />
                  <MetadataRow label="Currency" value={logoPreview.amounts.currency} />
                  <MetadataRow label="VAT included" value={String(logoPreview.amounts.vatIncluded)} />
                  <MetadataRow label="Tax rate" value={logoPreview.amounts.taxRate === null ? 'Requires confirmation' : `${logoPreview.amounts.taxRate.toFixed(2)}%`} />
                  <MetadataRow label="VAT rate source" value={safeStatusLabel(logoPreview.vatRateSource)} />
                  <MetadataRow label="Detected VAT rates" value={logoPreview.detectedVatRates.length ? logoPreview.detectedVatRates.map((rate) => `${rate}%`).join(', ') : 'None'} />
                  <MetadataRow
                    label="Current profile VAT"
                    value={
                      logoPreview.configuredVendorCommissionVatPercent === null
                        ? 'Not available'
                        : `${logoPreview.configuredVendorCommissionVatPercent}%`
                    }
                  />
                  <MetadataRow label="Commission" value={formatCurrency(logoPreview.amounts.commissionAmount, logoPreview.amounts.currency)} />
                  <MetadataRow label="Commission VAT" value={formatCurrency(logoPreview.amounts.commissionVatAmount, logoPreview.amounts.currency)} />
                  <MetadataRow label="Expected gross" value={formatCurrency(logoPreview.amounts.expectedGrossInvoiceAmount, logoPreview.amounts.currency)} />
                </MetadataGroup>
                <ReadinessList title="Logo blockers" items={logoPreview.readiness.blockers} tone="danger" />
                <ReadinessList title="Logo warnings" items={logoPreview.readiness.warnings} tone="warning" />
                <details className="settlement-advanced-diagnostics" open>
                  <summary>Execution snapshot guard</summary>
                  <MetadataGroup>
                    <MetadataRow label="Guard status" value={logoPreview.executionSnapshotGuard.ok ? 'Pass' : 'Blocked'} />
                    <MetadataRow label="Required snapshots" value={logoPreview.executionSnapshotGuard.requiredSnapshotsPresent ? 'Present' : 'Missing'} />
                    <MetadataRow label="Settlement status" value={valueOrDash(logoPreview.executionSnapshotGuard.snapshotCompleteness.settlementApprovalStatus)} />
                    <MetadataRow label="Execution lines" value={formatNumber(logoPreview.executionSnapshotGuard.snapshotCompleteness.executionLineCount)} />
                    <MetadataRow
                      label="Detected commission VAT"
                      value={
                        logoPreview.executionSnapshotGuard.detectedCommissionVatRates.length
                          ? logoPreview.executionSnapshotGuard.detectedCommissionVatRates.map((rate) => `${rate}%`).join(', ')
                          : 'None'
                      }
                    />
                    <MetadataRow
                      label="Detected shipping modes"
                      value={logoPreview.executionSnapshotGuard.detectedShippingModes.join(', ') || 'None'}
                    />
                  </MetadataGroup>
                  <ReadinessList title="Execution snapshot blockers" items={logoPreview.executionSnapshotGuard.blockers} tone="danger" />
                  <ReadinessList title="Execution snapshot warnings" items={logoPreview.executionSnapshotGuard.warnings} tone="warning" />
                </details>
                <details className="settlement-advanced-diagnostics">
                  <summary>Vendor billing and payload diagnostics</summary>
                  <MetadataGroup title="Vendor billing readiness">
                    <MetadataRow label="Complete" value={logoPreview.vendorBillingReadiness.complete ? 'Yes' : 'No'} />
                    <MetadataRow label="Missing fields" value={logoPreview.vendorBillingReadiness.missingFields.join(', ') || 'None'} />
                    <MetadataRow label="Logo customer code" value={logoPreview.vendorBillingReadiness.logoCustomerCodePresent ? 'Present' : 'Missing'} />
                    <MetadataRow label="Logo customer id" value={logoPreview.vendorBillingReadiness.logoCustomerIdPresent ? 'Present' : 'Missing'} />
                    <MetadataRow label="E-invoice eligible" value={valueOrDash(logoPreview.vendorBillingReadiness.logoEinvoiceEligible)} />
                  </MetadataGroup>
                  <MetadataGroup title="Product detail shape">
                    <MetadataRow label="Payload exists" value={logoPreview.logoPayloadPreview ? 'Yes' : 'No'} />
                    <MetadataRow label="itemCode" value={valueOrDash(productDetail?.itemCode)} />
                    <MetadataRow label="itemType" value={valueOrDash(productDetail?.itemType)} />
                  </MetadataGroup>
                </details>
              </>
            ) : (
              <p className="page-description">Load audit first, then use the next action to run Logo readiness.</p>
            )}
          </article>
        ) : null}

        {activeTab === 'invoices' ? (
          <article className="settlement-tab-panel" role="tabpanel">
            <h3>Commission Invoice Records</h3>
            {activeInvoiceRecords.length ? (
              <div className="settlement-alert op-tone-warning">
                <strong>Active commission invoice record exists.</strong>
                <p>Settlement cancellation should be blocked while a non-CANCELLED record exists.</p>
              </div>
            ) : null}
            {invoiceRecords.length ? (
              <OperationalTable
                columns={['Record', 'Provider', 'Status', 'Invoice no', 'Retry', 'Diagnostics']}
                className="settlement-invoice-table"
                stickyHeader={false}
              >
                {invoiceRecords.map((record) => (
                  <OperationalTableRow key={record.id}>
                    <span>
                      <strong>{record.id}</strong>
                      <small>{formatDate(record.createdAt)}</small>
                    </span>
                    <span>{safeStatusLabel(record.provider)}</span>
                    <span><StatusBadge status={record.status}>{safeStatusLabel(record.status)}</StatusBadge></span>
                    <span>{valueOrDash(record.invoiceNo)}</span>
                    <span>{formatNumber(record.retryCount)}</span>
                    <span>
                      <button
                        type="button"
                        className="button button-secondary button-compact"
                        onClick={() => void handleDiagnostics(record.id)}
                        disabled={busyAction !== null}
                      >
                        Read diagnostics (read-only)
                      </button>
                    </span>
                  </OperationalTableRow>
                ))}
              </OperationalTable>
            ) : (
              <p className="page-description">Run Logo readiness first, then use the next action to load commission invoice records.</p>
            )}
            {Object.values(diagnostics).length ? (
              <details className="settlement-advanced-diagnostics" open>
                <summary>Invoice diagnostics</summary>
                {Object.values(diagnostics).map((item) => (
                  <MetadataGroup key={item.record.id} title={`Diagnostics ${item.record.id}`}>
                    <MetadataRow label="writesPerformed" value={String(item.writesPerformed)} />
                    <MetadataRow label="Status" value={safeStatusLabel(item.record.status)} />
                    <MetadataRow label="Provider UUID" value={valueOrDash(item.record.providerIdentifiers.providerUuid)} />
                    <MetadataRow label="Invoice no" value={valueOrDash(item.record.providerIdentifiers.invoiceNo)} />
                    <MetadataRow label="Request snapshot" value={`${item.record.snapshots.request.present ? 'Present' : 'Missing'} · ${item.record.snapshots.request.type}`} />
                    <MetadataRow label="Response snapshot" value={`${item.record.snapshots.response.present ? 'Present' : 'Missing'} · ${item.record.snapshots.response.type}`} />
                    <MetadataRow label="Failure" value={valueOrDash(item.record.failure.failureMessage ?? item.record.failure.failureCode)} />
                  </MetadataGroup>
                ))}
              </details>
            ) : null}
          </article>
        ) : null}

        {activeTab === 'history' ? (
          <article className="settlement-tab-panel" role="tabpanel">
            <RecentApprovalsPanel
              approvals={recentApprovals}
              loading={recentApprovalsLoading}
              activeApprovalId={selectedApprovalId}
              onOpenApproval={(id) => void handleOpenRecentApproval(id)}
            />
          </article>
        ) : null}
      </section>

      <details className="settlement-details-drawer">
        <summary>Workspace details and advanced controls</summary>
        <section className="settlement-db-banner">
          <div>
            <span className="eyebrow">Database source</span>
            <strong>{valueOrDash(getDatabaseSourceLabel(health))}</strong>
            <small>
              Host {valueOrDash(health?.financeAuditMetadata?.databaseHost ?? health?.databaseSource?.databaseHost)}
              {' · '}
              DB {valueOrDash(health?.financeAuditMetadata?.databaseName ?? health?.databaseSource?.databaseName)}
              {' · '}
              Schema {health?.financeAuditMetadata?.schemaReady === false ? 'not ready' : 'ready/unknown'}
            </small>
          </div>
          {health?.databaseSource?.duplicateDatabaseUrlDefinitionsDetected ? (
            <StatusBadge tone="warning">Multiple DATABASE_URL definitions detected</StatusBadge>
          ) : (
            <StatusBadge tone="success">Secret-safe diagnostics</StatusBadge>
          )}
        </section>
        <div className="op-toolbar settlement-toolbar" aria-label="Advanced settlement approval controls">
          <label>
            <span>Approval id</span>
            <input value={approvalId} onChange={(event) => setApprovalId(event.target.value)} placeholder="SettlementApproval id" />
          </label>
          <button type="button" className="button button-secondary" onClick={handleFetchApproval} disabled={busyAction !== null || !approvalId.trim()}>
            Fetch approval detail (read-only)
          </button>
          <button type="button" className="button button-danger" onClick={handleCancel} disabled={busyAction !== null || !selectedApprovalId}>
            Cancel DRAFT/APPROVED (writes local DB)
          </button>
        </div>
        {approval ? (
          <MetadataGroup title="Approval detail">
            <MetadataRow label="Approval id" value={approval.id} />
            <MetadataRow label="Created at" value={formatDate(approval.createdAt)} />
            <MetadataRow label="Approved at" value={formatDate(approval.approvedAt)} />
            <MetadataRow label="Approved by" value={valueOrDash(approval.approvedBy)} />
            <MetadataRow label="Cancelled at" value={formatDate(approval.cancelledAt)} />
            <MetadataRow label="Cancelled by" value={valueOrDash(approval.cancelledBy)} />
            <MetadataRow label="Notes" value={valueOrDash(approval.notes)} />
          </MetadataGroup>
        ) : null}
      </details>
    </section>
  );
}
