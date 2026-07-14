import type { ReactNode } from 'react';
import { StatusBadge } from '../OperationalPrimitives';

type DiagnosticsTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'attention';

export function DiagnosticsTechnicalDetails({
  children,
  label = 'Advanced technical details',
  description,
}: {
  children: ReactNode;
  label?: string;
  description?: ReactNode;
}) {
  return (
    <details className="diagnostics-technical-details">
      <summary>
        <span>{label}</span>
        {description ? <small>{description}</small> : null}
      </summary>
      <div className="diagnostics-technical-details-content">{children}</div>
    </details>
  );
}

export function DiagnosticsEmptyState({
  title,
  description,
  status,
  tone = 'neutral',
}: {
  title: string;
  description: string;
  status: string;
  tone?: DiagnosticsTone;
}) {
  return (
    <div className="diagnostics-empty-state">
      <StatusBadge tone={tone}>{status}</StatusBadge>
      <div>
        <h4>{title}</h4>
        <p>{description}</p>
      </div>
    </div>
  );
}

export function DiagnosticsActionPanel({
  recommendation,
  stateLabel,
  tone = 'neutral',
  id = 'diagnostics-recommended-next-action',
  children,
}: {
  recommendation: ReactNode;
  stateLabel: ReactNode;
  tone?: DiagnosticsTone;
  id?: string;
  children?: ReactNode;
}) {
  return (
    <section className={`diagnostics-action-panel op-tone-${tone}`} aria-labelledby={id}>
      <div className="diagnostics-action-panel-heading">
        <div>
          <h4 id={id}>Recommended next action</h4>
          <strong>{recommendation}</strong>
        </div>
        <StatusBadge tone={tone}>{stateLabel}</StatusBadge>
      </div>
      {children ? <div className="diagnostics-action-panel-controls">{children}</div> : null}
    </section>
  );
}
