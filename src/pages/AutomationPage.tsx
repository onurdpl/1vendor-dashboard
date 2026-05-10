import { useEffect, useState } from 'react';
import { DataStatePanel } from '../components/DataStatePanel';
import { ActionFeedback } from '../components/ActionFeedback';
import { queryKeys } from '../lib/api/queryKeys';
import { useQueryResource } from '../hooks/useQueryResource';
import { useMutationAction } from '../hooks/useMutationAction';
import { useActionFeedback } from '../lib/ui';
import { getAutomationDashboard } from '../features/automation/api';
import { canPerformAction } from '../lib/auth';

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
  const { data: automation, isLoading, isError, error } = useQueryResource(
    queryKeys.automation.alerts(),
    getAutomationDashboard,
  );
  const { message, tone, showFeedback } = useActionFeedback();
  const [queuedActionMessage, setQueuedActionMessage] = useState<string | null>(null);
  const primaryActionTitle = automation?.suggestions[0]?.title ?? null;
  const canRunAutomationAction = canPerformAction('automation:write');
  const { mutateAsync: queueAction, isPending: isQueueingAction } = useMutationAction(
    async (title: string) => {
      await new Promise((resolve) => {
        globalThis.setTimeout(resolve, 300);
      });

      return title;
    },
    {
      invalidateQueryKeys: [queryKeys.automation.alerts(), queryKeys.automation.actions()],
    },
  );

  useEffect(() => {
    if (!queuedActionMessage) {
      return;
    }

    const timeout = globalThis.setTimeout(() => {
      setQueuedActionMessage(null);
    }, 2200);

    return () => {
      globalThis.clearTimeout(timeout);
    };
  }, [queuedActionMessage]);

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
                {item.title === primaryActionTitle ? (
                  <div className="automation-action-stack">
                    <button
                      type="button"
                      className="button button-secondary"
                      onClick={() => {
                        if (!canRunAutomationAction) {
                          showFeedback('You do not have permission to run this automation action.', 'error');
                          return;
                        }

                        setQueuedActionMessage(`${item.title} queued.`);
                        void queueAction(item.title).catch(() => {
                          setQueuedActionMessage(`${item.title} could not be queued.`);
                          showFeedback(`${item.title} could not be queued.`, 'error');
                        });
                        showFeedback(`${item.title} queued.`, 'success');
                      }}
                      disabled={isQueueingAction || !canRunAutomationAction}
                      title={
                        canRunAutomationAction
                          ? undefined
                          : 'Automation actions require write access.'
                      }
                    >
                      {item.actionLabel}
                    </button>
                    {!canRunAutomationAction ? (
                      <p className="automation-permission-note">
                        Automation actions are read-only for your account.
                      </p>
                    ) : null}
                    {queuedActionMessage ? (
                      <ActionFeedback tone={queuedActionMessage.includes('could not') ? 'error' : 'success'} message={queuedActionMessage} />
                    ) : null}
                  </div>
                ) : (
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => {
                      if (!canRunAutomationAction) {
                        showFeedback('You do not have permission to run automation actions.', 'error');
                        return;
                      }

                      showFeedback(`${item.title} queued.`, 'success');
                    }}
                    disabled={!canRunAutomationAction}
                    title={
                      canRunAutomationAction
                        ? undefined
                        : 'Automation actions require write access.'
                    }
                  >
                    {item.actionLabel}
                  </button>
                )}
              </div>
            ))}
          </div>
        </article>
      </div>

      {message ? <ActionFeedback tone={tone} message={message} /> : null}
    </section>
  );
}
