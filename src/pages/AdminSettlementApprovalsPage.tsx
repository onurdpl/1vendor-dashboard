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

export function AdminSettlementApprovalsPage() {
  const appReadiness = useAppReadiness();
  const initialVendorId = appReadiness.currentVendor.vendorId || 'yalispor';
  const [vendorId, setVendorId] = useState(initialVendorId);
  const [approvalId, setApprovalId] = useState('');
  const [notes, setNotes] = useState('Admin settlement approval draft');
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
  const selectedApprovalId = approval?.id || approvalId.trim();
  const currentTotals = getApprovalTotals(approval);
  const dbWarnings = getDatabaseWarnings(health);

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
    const result = await runAction('preview', () => previewSettlementApproval({ vendorId: vendorId.trim() }), 'Preview loaded.');
    if (result) {
      setPreview(result);
      setApproval(null);
      setAudit(null);
      setLogoPreview(null);
      setInvoiceRecords([]);
      setDiagnostics({});
    }
  }

  async function handleCreateDraft() {
    const result = await runAction(
      'createDraft',
      () => createSettlementApprovalDraft({ vendorId: vendorId.trim(), notes: notes.trim() || null }),
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
      </div>

      <div className="settlement-actions">
        <button type="button" className="button button-secondary" onClick={handlePreview} disabled={busyAction !== null || !vendorId.trim()}>
          Preview Settlement (read-only)
        </button>
        <button type="button" className="button button-primary" onClick={handleCreateDraft} disabled={busyAction !== null || !preview}>
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
            <button type="button" className="button button-secondary" onClick={handleLoadAudit} disabled={busyAction !== null || !selectedApprovalId}>
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
          <button type="button" className="button button-secondary" onClick={handleLogoPreview} disabled={busyAction !== null || !selectedApprovalId}>
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
          <button type="button" className="button button-secondary" onClick={handleInvoiceRecords} disabled={busyAction !== null || !selectedApprovalId}>
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
