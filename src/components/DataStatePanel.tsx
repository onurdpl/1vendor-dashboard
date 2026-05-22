import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { ApiErrorDiagnostics } from '../lib/api/errors';

type DataStatePanelProps = {
  tone?: 'loading' | 'error' | 'empty' | 'info';
  eyebrow: string;
  title: string;
  description: string;
  actionLabel?: string;
  actionTo?: string;
  actionNode?: ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  diagnostics?: ApiErrorDiagnostics | null;
};

export function DataStatePanel({
  tone = 'info',
  eyebrow,
  title,
  description,
  actionLabel,
  actionTo,
  actionNode,
  onRetry,
  retryLabel = 'Retry',
  diagnostics,
}: DataStatePanelProps) {
  const showDiagnostics = tone === 'error' && diagnostics;

  return (
    <section className="dashboard state-workspace">
      <div className={`hero-card operational-card state-card state-${tone}`}>
        <div className="state-copy">
          <p className="eyebrow">{eyebrow}</p>
          <div className="state-title-row">
            {tone === 'loading' ? <span className="spinner" aria-hidden="true" /> : null}
            <h2>{title}</h2>
          </div>
          <p className="page-description">{description}</p>
          {showDiagnostics ? (
            <details className="api-error-diagnostics">
              <summary>Diagnostics</summary>
              <dl>
                <div>
                  <dt>Status</dt>
                  <dd>{diagnostics.status ?? 'Unavailable'}</dd>
                </div>
                <div>
                  <dt>Endpoint</dt>
                  <dd>{diagnostics.endpoint}</dd>
                </div>
                <div>
                  <dt>Readiness</dt>
                  <dd>{diagnostics.readinessState}</dd>
                </div>
                <div>
                  <dt>Authorization header</dt>
                  <dd>{diagnostics.hasAuthHeader ? 'Present' : 'Missing'}</dd>
                </div>
                <div>
                  <dt>Vendor header</dt>
                  <dd>{diagnostics.hasVendorHeader ? 'Present' : 'Missing'}</dd>
                </div>
                <div>
                  <dt>Selected vendor</dt>
                  <dd>{diagnostics.selectedVendorPresent ? 'Present' : 'Missing'}</dd>
                </div>
                <div>
                  <dt>Request ID</dt>
                  <dd>{diagnostics.requestId ?? 'Unavailable'}</dd>
                </div>
              </dl>
            </details>
          ) : null}
        </div>
        {actionNode || onRetry || (actionLabel && actionTo) ? (
          <div className="state-actions">
            {onRetry ? (
              <button type="button" className="button button-secondary" onClick={onRetry}>
                {retryLabel}
              </button>
            ) : null}
            {actionLabel && actionTo ? (
              <Link className="button button-secondary" to={actionTo}>
                {actionLabel}
              </Link>
            ) : null}
            {actionNode}
          </div>
        ) : null}
      </div>
    </section>
  );
}
