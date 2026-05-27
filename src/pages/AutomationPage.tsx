import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ActionFeedback } from '../components/ActionFeedback';
import { SectionErrorRetry, SectionSkeleton } from '../components/OperationalPrimitives';
import { queryKeys } from '../lib/api/queryKeys';
import { useQueryResource } from '../hooks/useQueryResource';
import { useActionFeedback } from '../lib/ui';
import { getAutomationDashboard } from '../features/automation/api';
import { canPerformAction } from '../lib/auth';
import { useAppReadiness } from '../lib/appReadiness';
import { formatDateTime, safeArray } from '../services/real/formatting';

function formatDate(value: string) {
  return formatDateTime(value, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function getClassToken(value: string | null | undefined) {
  return (value ?? 'unknown').toLowerCase().replace(/\s+/g, '-');
}

export function AutomationPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const appReadiness = useAppReadiness();
  const currentVendor = appReadiness.currentVendor;
  const workflowActiveIssues = searchParams.get('workflow') === 'active-issue-groups';
  const { data: automation, isLoading, isError, error, refetch } = useQueryResource(
    queryKeys.automation.alerts(currentVendor.vendorId),
    ({ signal }) => getAutomationDashboard({ signal }),
    { enabled: appReadiness.ready },
  );
  const { message, tone, showFeedback } = useActionFeedback();
  const canRunAutomationAction = canPerformAction('automation:write');
  const currentRole = appReadiness.currentUser?.role ?? 'vendor';

  const automationView = useMemo(() => {
    const alerts = safeArray(automation?.alerts);
    const suggestions = safeArray(automation?.suggestions);
    const visibleAlerts = workflowActiveIssues
      ? alerts.filter((alert) => {
          const status = String(alert.status ?? '').toLowerCase();
          return !['closed', 'resolved', 'dismissed'].includes(status);
        })
      : alerts;

    return {
      alerts: visibleAlerts,
      suggestions,
    };
  }, [automation?.alerts, automation?.suggestions, workflowActiveIssues]);
  const totalAlerts = automationView.alerts.length;
  const criticalAlerts = automationView.alerts.filter((alert) => alert.type === 'Critical' || alert.status === 'New').length;
  const suggestedActions = automationView.suggestions.length;
  const restrictedActions = canRunAutomationAction ? 0 : suggestedActions;

  function clearWorkflowFilter() {
    if (!searchParams.has('workflow')) {
      return;
    }
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('workflow');
    setSearchParams(nextParams, { replace: true });
  }

  return (
    <section className="dashboard automation-dashboard automation-workspace">
      <div className="hero-card operational-card queue-header">
        <div className="queue-header-copy">
          <p className="eyebrow">Automation</p>
          <h2>{currentVendor.vendorName} alerts and actions workspace</h2>
          <p className="page-description">
            {canRunAutomationAction
              ? 'Review operational signals and run recommended automations for the selected vendor scope.'
              : 'Review operational signals. Automation actions are currently read-only for your role.'}
          </p>
        </div>
        <div className="queue-health">
          <span className="severity-chip severity-normal">Vendor {currentVendor.vendorName}</span>
          <span className="severity-chip severity-attention">Role {currentRole}</span>
        </div>
      </div>

      {workflowActiveIssues ? (
        <div className="workflow-filter-banner" aria-label="Active workflow filter">
          <div>
            <span>Workflow filter</span>
            <strong>Active automation issue groups</strong>
            <small>Showing active operational alerts before passive automation history.</small>
          </div>
          <button type="button" className="button button-secondary button-compact" onClick={clearWorkflowFilter}>
            Clear workflow
          </button>
        </div>
      ) : null}

      <div className="finance-summary-grid automation-summary-grid">
        <article className="finance-summary-card operational-card">
          <span>Total alerts</span>
          <strong>{totalAlerts}</strong>
        </article>
        <article className="finance-summary-card operational-card deduction-card">
          <span>Critical / needs attention</span>
          <strong>{criticalAlerts}</strong>
        </article>
        <article className="finance-summary-card operational-card">
          <span>Suggested actions</span>
          <strong>{suggestedActions}</strong>
        </article>
        <article className="finance-summary-card operational-card">
          <span>Read-only / restricted</span>
          <strong>{restrictedActions}</strong>
        </article>
      </div>

      <div className="automation-grid operational-grid">
        <article className="panel operational-card">
          <div className="queue-list-header">
            <h3>Operational alerts</h3>
          </div>
          {isError && !automation ? (
            <SectionErrorRetry
              title="Automation unavailable"
              description={error ?? 'The automation feed could not be loaded.'}
              onRetry={() => void refetch()}
            />
          ) : !appReadiness.ready || isLoading ? (
            <SectionSkeleton title="Loading operational signals" description="Fetching alerts and suggestions in the background." />
          ) : automationView.alerts.length === 0 ? (
            <div className="queue-empty">
              <p className="eyebrow">Alerts</p>
              <h3>{workflowActiveIssues ? 'No active automation issue groups' : 'No automation alerts'}</h3>
              <p className="page-description">
                {workflowActiveIssues
                  ? 'This workflow queue is clear. Clear the workflow to inspect passive automation history.'
                  : 'No active automation attention signals for this vendor scope. New webhook, shipment, or refund risks will appear here.'}
              </p>
            </div>
          ) : (
            <div className="automation-alerts">
              {automationView.alerts.map((alert) => (
                <article key={alert.id} className="automation-alert queue-item">
                  <div className="automation-alert-top">
                    <div className={`status-badge automation-type automation-${getClassToken(alert.type)}`}>
                      {alert.type ?? 'Unknown'}
                    </div>
                    <div className={`status-badge status-${getClassToken(alert.status)}`}>
                      {alert.status ?? 'Unknown'}
                    </div>
                  </div>
                  <div className="queue-title-block">
                    <h4>{alert.message}</h4>
                    <span className="queue-description">Source: {alert.source}</span>
                  </div>
                  <div className="automation-meta">
                    <span>
                      <strong>Alert:</strong> {alert.id}
                    </span>
                    <span>
                      <strong>Area:</strong> {alert.source}
                    </span>
                    <span>{formatDate(alert.timestamp)}</span>
                  </div>
                  <div className="queue-actions">
                    <span className="queue-muted-action">
                      Recommended: {alert.type === 'Critical' ? 'Review immediately' : 'Monitor and triage'}
                    </span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </article>

        <article className="panel operational-card">
          <div className="queue-list-header">
            <h3>Suggested actions</h3>
          </div>
          {!canRunAutomationAction ? (
            <p className="automation-permission-note">
              Your account has read-only automation access. Action execution requires `automation:write`.
            </p>
          ) : null}
          <div className="automation-actions">
            {isError && !automation ? (
            <SectionErrorRetry
              title="Suggested actions unavailable"
              description={error ?? 'The automation feed could not be loaded.'}
              onRetry={() => void refetch()}
            />
          ) : !appReadiness.ready || isLoading ? (
            <SectionSkeleton title="Loading suggested actions" description="Fetching recommended actions in the background." />
          ) : automationView.suggestions.length === 0 ? (
            <div className="queue-empty">
              <p className="eyebrow">Actions</p>
              <h3>No suggested automation actions</h3>
              <p className="page-description">No immediate operational automation actions are suggested for this vendor scope.</p>
            </div>
          ) : (
              automationView.suggestions.map((item) => (
                <article key={item.title} className="automation-action queue-item">
                  <div className="queue-title-block">
                    <h4>{item.title}</h4>
                    <span className="queue-description">{item.description}</span>
                    <span className="automation-permission-note">
                      Requires permission: <strong>automation:write</strong>
                    </span>
                  </div>
                  <div className="automation-action-stack">
                    <button
                      type="button"
                      className="button button-secondary"
                      disabled
                      title="Action execution coming in a future phase."
                      onClick={() => showFeedback('Action execution coming in a future phase.', 'info')}
                    >
                      {item.actionLabel}
                    </button>
                    <p className="automation-permission-note">
                      Action execution coming in a future phase. Safe automation actions are available through admin operations controls only.
                    </p>
                    {!canRunAutomationAction ? (
                      <p className="automation-permission-note">Action unavailable: read-only role.</p>
                    ) : null}
                  </div>
                </article>
              ))
            )}
          </div>
        </article>
      </div>

      {message ? <ActionFeedback tone={tone} message={message} /> : null}
    </section>
  );
}
