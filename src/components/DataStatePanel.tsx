import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

type DataStatePanelProps = {
  tone?: 'loading' | 'error' | 'empty' | 'info';
  eyebrow: string;
  title: string;
  description: string;
  actionLabel?: string;
  actionTo?: string;
  actionNode?: ReactNode;
};

export function DataStatePanel({
  tone = 'info',
  eyebrow,
  title,
  description,
  actionLabel,
  actionTo,
  actionNode,
}: DataStatePanelProps) {
  return (
    <section className="dashboard">
      <div className={`hero-card state-card state-${tone}`}>
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <div className="state-title-row">
            {tone === 'loading' ? <span className="spinner" aria-hidden="true" /> : null}
            <h2>{title}</h2>
          </div>
          <p className="page-description">{description}</p>
        </div>
        {actionNode ??
          (actionLabel && actionTo ? (
            <Link className="button button-secondary" to={actionTo}>
              {actionLabel}
            </Link>
          ) : null)}
      </div>
    </section>
  );
}
