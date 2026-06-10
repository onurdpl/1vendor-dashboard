import { useEffect, useMemo, useState } from 'react';
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
  previewSettlementApproval,
  previewSettlementLogoCommissionInvoice,
  type DatabaseHealthResponse,
  type SettlementApproval,
  type SettlementApprovalAudit,
  type SettlementApprovalLine,
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
  recommendedNextAction,
}: {
  steps: WorkflowStep[];
  recommendedNextAction: string;
}) {
  return (
    <section className="settlement-workflow">
      <div className="settlement-workflow-heading">
        <div>
          <span className="eyebrow">Settlement Workflow</span>
          <h2>Guided settlement workflow</h2>
        </div>
        <div className="settlement-next-action">
          <strong>Recommended Next Action</strong>
          <span>{recommendedNextAction}</span>
        </div>
      </div>
      <div className="settlement-workflow-steps">
        {steps.map((step) => (
          <article key={step.number} className={`settlement-workflow-step op-tone-${getStatusTone(step.status)}`}>
            <div className="settlement-workflow-step-header">
              <span className="settlement-step-number">{step.number}</span>
              <strong>{step.title}</strong>
              <StatusBadge tone={getStatusTone(step.status)}>{step.status}</StatusBadge>
            </div>
            <dl>
              {step.details.map((detail) => (
                <div key={`${step.number}-${detail.label}`}>
                  <dt>{detail.label}</dt>
                  <dd>{valueOrDash(detail.value)}</dd>
                </div>
              ))}
            </dl>
          </article>
        ))}
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
  const [notes, setNotes] = useState('Admin settlement approval draft');
  const [mixedVatAcknowledged, setMixedVatAcknowledged] = useState(false);
  const [health, setHealth] = useState<DatabaseHealthResponse | null>(null);
  const [preview, setPreview] = useState<SettlementApprovalPreview | null>(null);
  const [approval, setApproval] = useState<SettlementApproval | null>(null);
  const [audit, setAudit] = useState<SettlementApprovalAudit | null>(null);
  const [logoPreview, setLogoPreview] = useState<SettlementLogoCommissionInvoicePreview | null>(null);
  const [invoiceRecords, setInvoiceRecords] = useState<SettlementCommissionInvoiceRecord[]>([]);
  const [diagnostics, setDiagnostics] = useState<Record<string, SettlementCommissionInvoiceDiagnostics>>({});
  const [busyAction, setBusyAction] = useState<ActionName | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

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

  const activeInvoiceRecords = useMemo(
    () => invoiceRecords.filter((record) => record.status.toLowerCase() !== 'cancelled'),
    [invoiceRecords],
  );
  const productDetail = extractProductDetail(logoPreview?.logoPayloadPreview ?? null);
  const selectedApprovalId = approvalId.trim() || approval?.id || '';
  const currentTotals = getApprovalTotals(approval);
  const dbWarnings = getDatabaseWarnings(health);
  const previewRowsLockedInActiveApproval = Boolean(
    preview &&
    preview.summary.eligibleRowCount === 0 &&
    preview.summary.excludedActiveApprovalRowCount > 0,
  );
  const candidateQualityWarnings = safeArray<string>(preview?.summary.candidateQualityWarnings);
  const requiresMixedVatAcknowledgement = Boolean(preview?.summary.mixedCommissionVatRate);
  const draftBlockedByAcknowledgement = requiresMixedVatAcknowledgement && !mixedVatAcknowledged;
  const activeFilterSummary = [
    periodStart ? `Start ${periodStart}` : null,
    periodEnd ? `End ${periodEnd}` : null,
  ].filter(Boolean).join(' · ') || 'No period filters: vendor-wide preview';
  const vendorWideMode = !periodStart && !periodEnd;
  const approvalGeneratedAt = readString(readRecord(approval?.sourceSnapshotJson).generatedAt);
  const latestInvoiceRecord = invoiceRecords[0] ?? null;
  const auditReasonsAvailable = Boolean(audit?.lines.length && audit.lines.every((line) => line.eligibilityReason));
  const logoBindingReady = Boolean(
    logoPreview?.vendorBillingReadiness.logoCustomerCodePresent &&
    logoPreview.vendorBillingReadiness.logoCustomerIdPresent,
  );
  const qualityStepStatus: WorkflowStepStatus = !preview
    ? 'Waiting'
    : preview.summary.mixedCommissionVatRate || preview.summary.mixedShippingMode || candidateQualityWarnings.length
      ? 'Warning'
      : 'Completed';
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
  const workflowSteps: WorkflowStep[] = [
    {
      number: 1,
      title: 'Candidate Selection',
      status: vendorId.trim() ? 'Ready' : 'Blocked',
      details: [
        { label: 'Vendor selected', value: vendorId.trim() || null },
        { label: 'Period filters', value: activeFilterSummary },
        { label: 'Selection warning', value: vendorWideMode ? 'Vendor-wide selection can include historical or test rows.' : 'Period filter selected.' },
      ],
    },
    {
      number: 2,
      title: 'Settlement Preview',
      status: preview ? 'Completed' : vendorId.trim() ? 'Ready' : 'Waiting',
      details: [
        { label: 'Eligible rows', value: preview ? formatNumber(preview.summary.eligibleRowCount) : 'Not loaded' },
        { label: 'Excluded rows', value: preview ? formatNumber(preview.summary.excludedActiveApprovalRowCount) : 'Not loaded' },
        { label: 'Net payable', value: preview ? formatMinor(preview.summary.netPayableMinor, preview.summary.currency) : 'Not loaded' },
      ],
    },
    {
      number: 3,
      title: 'Candidate Quality Review',
      status: qualityStepStatus,
      details: [
        { label: 'Mixed commission VAT', value: preview ? (preview.summary.mixedCommissionVatRate ? 'Yes' : 'No') : 'Not reviewed' },
        { label: 'Mixed shipping mode', value: preview ? (preview.summary.mixedShippingMode ? 'Yes' : 'No') : 'Not reviewed' },
        { label: 'Financial profile groups', value: preview ? formatStringList(preview.summary.detectedFinancialProfileSnapshotIds) : 'Not reviewed' },
        { label: 'Warnings', value: candidateQualityWarnings.length ? candidateQualityWarnings.join(' ') : 'None' },
      ],
    },
    {
      number: 4,
      title: 'Draft Creation',
      status: draftStepStatus,
      details: [
        { label: 'Draft exists', value: Boolean(approval) },
        { label: 'Draft id', value: approval?.id ?? null },
        { label: 'Created at', value: approvalGeneratedAt ? formatDate(approvalGeneratedAt) : 'Not available' },
      ],
    },
    {
      number: 5,
      title: 'Settlement Approval',
      status: approvalStepStatus,
      details: [
        { label: 'Approval status', value: approval?.status ?? 'Not created' },
        { label: 'Approved at', value: approval?.approvedAt ? formatDate(approval.approvedAt) : 'Not approved' },
        { label: 'Approved by', value: approval?.approvedBy ?? null },
      ],
    },
    {
      number: 6,
      title: 'Audit Review',
      status: auditStepStatus,
      details: [
        { label: 'Audit loaded', value: Boolean(audit) },
        { label: 'Line count', value: audit ? formatNumber(audit.lines.length) : 'Not loaded' },
        { label: 'Eligibility reasons', value: audit ? (auditReasonsAvailable ? 'Available' : 'Missing') : 'Not loaded' },
      ],
    },
    {
      number: 7,
      title: 'Logo Readiness',
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
      number: 8,
      title: 'Commission Invoice Records',
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
    if (!preview) {
      return 'Next: Preview settlement candidates.';
    }
    if (!approval && candidateQualityWarnings.length) {
      return 'Next: Review candidate quality warnings.';
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
    return 'Workflow review is complete. Resolve blockers before any future invoice execution.';
  })();

  function buildSettlementApprovalInput() {
    return {
      vendorId: vendorId.trim(),
      periodStart: periodStart || null,
      periodEnd: periodEnd || null,
    };
  }

  function clearPeriodFilters() {
    setPeriodStart('');
    setPeriodEnd('');
    setMixedVatAcknowledged(false);
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
      <div className="op-page-heading">
        <div>
          <p className="eyebrow">Admin finance</p>
          <h1>Settlement Approvals</h1>
          <p className="page-description">
            Admin-only controls for local settlement approval records, audit snapshots, Logo readiness preview, and commission invoice record visibility.
          </p>
        </div>
        <div className="op-heading-meta">
          <StatusBadge tone="info">No external provider writes</StatusBadge>
          <StatusBadge tone="warning">Local DB write buttons are labeled</StatusBadge>
        </div>
      </div>

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
      {dbWarnings.length ? <ReadinessList title="Database warnings" items={dbWarnings} tone="warning" /> : null}

      {error ? <SectionErrorRetry title="Finance action failed" description={error} /> : null}
      {success ? <div className="settlement-alert op-tone-success"><strong>{success}</strong></div> : null}

      <WorkflowProgress steps={workflowSteps} recommendedNextAction={recommendedNextAction} />

      <div className="op-toolbar settlement-toolbar" aria-label="Settlement approval controls">
        <label>
          <span>Vendor id</span>
          <input value={vendorId} onChange={(event) => setVendorId(event.target.value)} placeholder="yalispor" />
        </label>
        <label>
          <span>Approval id</span>
          <input value={approvalId} onChange={(event) => setApprovalId(event.target.value)} placeholder="SettlementApproval id" />
        </label>
        <label>
          <span>Draft notes</span>
          <input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Internal admin note" />
        </label>
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
      <div className="settlement-filter-summary">
        <strong>Active candidate filter</strong>
        <span>{activeFilterSummary}</span>
        <button type="button" className="button button-secondary button-compact" onClick={clearPeriodFilters} disabled={busyAction !== null || (!periodStart && !periodEnd)}>
          Clear filters
        </button>
      </div>

      <div className="settlement-actions">
        <button type="button" className="button button-secondary" onClick={handlePreview} disabled={busyAction !== null || !vendorId.trim()}>
          Preview Settlement (read-only)
        </button>
        <button type="button" className="button button-primary" onClick={handleCreateDraft} disabled={busyAction !== null || !preview || draftBlockedByAcknowledgement}>
          Create Draft from preview (writes local DB)
        </button>
        <button type="button" className="button button-secondary" onClick={handleFetchApproval} disabled={busyAction !== null || !approvalId.trim()}>
          Fetch approval detail (read-only)
        </button>
        <button type="button" className="button button-primary" onClick={handleApprove} disabled={busyAction !== null || approval?.status !== 'draft'}>
          Approve DRAFT (writes local DB)
        </button>
        <button type="button" className="button button-danger" onClick={handleCancel} disabled={busyAction !== null || !selectedApprovalId}>
          Cancel DRAFT/APPROVED (writes local DB)
        </button>
      </div>

      {preview ? (
        <>
          <div className="op-kpi-row">
            <KPIStatCard label="Gross sales" value={formatMinor(preview.summary.grossSalesMinor, preview.summary.currency)} tone="info" />
            <KPIStatCard label="Refund total" value={formatMinor(preview.summary.refundTotalMinor, preview.summary.currency)} tone="warning" />
            <KPIStatCard label="Commission" value={formatMinor(preview.summary.commissionMinor, preview.summary.currency)} tone="info" />
            <KPIStatCard label="Commission VAT" value={formatMinor(preview.summary.commissionVatMinor, preview.summary.currency)} tone="info" />
            <KPIStatCard label="Net payable" value={formatMinor(preview.summary.netPayableMinor, preview.summary.currency)} tone="success" />
            <KPIStatCard label="Eligible lines" value={formatNumber(preview.summary.eligibleRowCount)} detail={preview.summary.currency} tone="neutral" />
          </div>

          <MetadataGroup title="Preview settlement impact">
            <MetadataRow label="writesPerformed" value={String(preview.writesPerformed)} />
            <MetadataRow label="Vendor" value={preview.vendorId} />
            <MetadataRow label="Period start" value={formatDate(preview.periodStart)} />
            <MetadataRow label="Period end" value={formatDate(preview.periodEnd)} />
            <MetadataRow label="Excluded active rows" value={formatNumber(preview.summary.excludedActiveApprovalRowCount)} />
          </MetadataGroup>
          <MetadataGroup title="Candidate quality summary">
            <MetadataRow label="Commission rates" value={formatPercentList(preview.summary.detectedCommissionRates)} />
            <MetadataRow label="Commission VAT rates" value={formatPercentList(preview.summary.detectedCommissionVatRates)} />
            <MetadataRow label="Shipping modes" value={formatStringList(preview.summary.detectedShippingModes)} />
            <MetadataRow label="Financial profile snapshots" value={formatStringList(preview.summary.detectedFinancialProfileSnapshotIds)} />
            <MetadataRow label="Mixed commission rate" value={preview.summary.mixedCommissionRate ? 'Yes' : 'No'} />
            <MetadataRow label="Mixed commission VAT" value={preview.summary.mixedCommissionVatRate ? 'Yes' : 'No'} />
            <MetadataRow label="Mixed shipping mode" value={preview.summary.mixedShippingMode ? 'Yes' : 'No'} />
          </MetadataGroup>
          <ReadinessList title="Candidate quality warnings" items={candidateQualityWarnings} tone="warning" />
          {requiresMixedVatAcknowledgement ? (
            <div className="settlement-alert op-tone-warning">
              <strong>Mixed VAT acknowledgement required before draft creation.</strong>
              <p>Logo readiness will block mixed VAT settlements. Create this draft only when the candidate set is intentionally mixed for review.</p>
              <label className="settlement-acknowledgement">
                <input
                  type="checkbox"
                  checked={mixedVatAcknowledged}
                  onChange={(event) => setMixedVatAcknowledged(event.target.checked)}
                />
                <span>I acknowledge this preview contains mixed commission VAT rates.</span>
              </label>
            </div>
          ) : null}
          {previewRowsLockedInActiveApproval ? (
            <div className="settlement-alert op-tone-warning">
              <strong>No eligible rows remain because rows are already locked in an active settlement approval.</strong>
            </div>
          ) : null}

          <section className="op-panel-section">
            <h3>Sample eligible lines</h3>
            <LineSamples lines={preview.lines} />
          </section>
        </>
      ) : null}

      <section className="settlement-grid">
        <article className="op-meta-group">
          <h3>Approval detail</h3>
          {approval ? (
            <MetadataGroup>
              <MetadataRow label="ID" value={approval.id} />
              <MetadataRow label="Status" value={<StatusBadge status={approval.status}>{safeStatusLabel(approval.status)}</StatusBadge>} />
              <MetadataRow label="Vendor" value={approval.vendorId} />
              <MetadataRow label="Lines" value={formatNumber(approval.lines.length)} />
              <MetadataRow label="Approved at" value={formatDate(approval.approvedAt)} />
              <MetadataRow label="Approved by" value={valueOrDash(approval.approvedBy)} />
              <MetadataRow label="Cancelled at" value={formatDate(approval.cancelledAt)} />
              <MetadataRow label="Cancelled by" value={valueOrDash(approval.cancelledBy)} />
              <MetadataRow label="Notes" value={valueOrDash(approval.notes)} />
            </MetadataGroup>
          ) : (
            <p className="page-description">Create a draft or fetch an existing approval to view status and timestamps.</p>
          )}
          {currentTotals ? (
            <MetadataGroup title="Approval snapshot totals">
              <MetadataRow label="Gross sales" value={formatMinor(currentTotals.grossSalesMinor, currentTotals.currency)} />
              <MetadataRow label="Refund total" value={formatMinor(currentTotals.refundTotalMinor, currentTotals.currency)} />
              <MetadataRow label="Commission" value={formatMinor(currentTotals.commissionMinor, currentTotals.currency)} />
              <MetadataRow label="Commission VAT" value={formatMinor(currentTotals.commissionVatMinor, currentTotals.currency)} />
              <MetadataRow label="Net payable" value={formatMinor(currentTotals.netPayableMinor, currentTotals.currency)} />
            </MetadataGroup>
          ) : null}
        </article>

        <article className="op-meta-group">
          <h3>Audit transparency</h3>
          <div className="op-action-group">
            <button type="button" className="button button-secondary" onClick={handleLoadAudit} disabled={busyAction !== null || !selectedApprovalId || approval?.status !== 'approved'}>
              Load audit snapshot (read-only)
            </button>
          </div>
          <AuditLines audit={audit} />
        </article>
      </section>

      <section className="settlement-grid">
        <article className="op-meta-group">
          <h3>Logo readiness panel</h3>
          <p className="page-description">Read-only preview. This does not call Logo create and does not create an invoice.</p>
          <button type="button" className="button button-secondary" onClick={handleLogoPreview} disabled={busyAction !== null || !selectedApprovalId || !audit}>
            Run Logo readiness preview (read-only)
          </button>
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
              <MetadataGroup title="Execution snapshot guard">
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
            </>
          ) : null}
        </article>

        <article className="op-meta-group">
          <h3>Commission invoice records</h3>
          <p className="page-description">Read-only settlement commission invoice record visibility and diagnostics.</p>
          <button type="button" className="button button-secondary" onClick={handleInvoiceRecords} disabled={busyAction !== null || !selectedApprovalId || !logoPreview}>
            Load commission invoice records (read-only)
          </button>
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
            <p className="page-description">No commission invoice records loaded.</p>
          )}
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
        </article>
      </section>
    </section>
  );
}
