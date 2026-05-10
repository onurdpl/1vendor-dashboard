import { DataStatePanel } from '../components/DataStatePanel';
import { ActionFeedback } from '../components/ActionFeedback';
import { useServerResource } from '../lib/data';
import { useActionFeedback } from '../lib/ui';
import { getAutomationDashboard, type AutomationDashboard } from '../features/automation/api';

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

export function AutomationPage() {
  const { data: automation, isLoading, isError, error } = useServerResource(() => getAutomationDashboard(), []);
  const { message, tone, showFeedback } = useActionFeedback();

  if (isLoading) {
    return (
      <DataStatePanel
        tone="loading"
        eyebrow="Automation"
        title="Loading operational signals"
        description="Fetching alerts and suggestions from the central data layer."
      />
    );
  }

  if (isError || !automation) {
    return (
      <DataStatePanel
        tone="error"
        eyebrow="Automation"
        title="Automation unavailable"
        description={error ?? 'The automation feed could not be loaded.'}
      />
    );
  }

  return (
    <section className="dashboard automation-dashboard">
      <div className="hero-card">
        <div>
          <p className="eyebrow">Automation</p>
          <h2>Automation center</h2>
          <p className="page-description">
            Reserve space for scheduled tasks, rules, and repetitive workflow execution.
          </p>
        </div>
      </div>

      <div className="automation-grid">
        <article className="panel">
          <h3>Operational alerts</h3>
          {automation.alerts.length === 0 ? (
            <div className="inline-state">
              <DataStatePanel
                tone="empty"
                eyebrow="Automation"
                title="No alerts"
                description="Operational signals will appear here when the system generates new events."
              />
            </div>
          ) : (
            <div className="automation-alerts">
              {automation.alerts.map((alert) => (
                <div key={alert.id} className="automation-alert">
                  <div className="automation-alert-top">
                    <div className={`status-badge automation-type automation-${alert.type.toLowerCase()}`}>
                      {alert.type}
                    </div>
                    <div className={`status-badge status-${alert.status.toLowerCase().replace(/\s+/g, '-')}`}>
                      {alert.status}
                    </div>
                  </div>
                  <strong>{alert.message}</strong>
                  <div className="automation-meta">
                    <span>{alert.id}</span>
                    <span>{alert.source}</span>
                    <span>{formatDate(alert.timestamp)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="panel">
          <h3>Operational actions</h3>
          <div className="automation-actions">
            {automation.suggestions.map((item) => (
              <div key={item.title} className="automation-action">
                <div>
                  <strong>{item.title}</strong>
                  <p>{item.description}</p>
                </div>
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => showFeedback(`${item.title} queued.`, 'success')}
                >
                  {item.actionLabel}
                </button>
              </div>
            ))}
          </div>
        </article>
      </div>

      {message ? <ActionFeedback tone={tone} message={message} /> : null}
    </section>
  );
}
