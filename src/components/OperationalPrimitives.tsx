import type { ReactNode } from 'react';

type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'attention';

function toneClass(tone: Tone) {
  return `op-tone-${tone}`;
}

export function StatusBadge({ children, tone = 'neutral' }: { children: ReactNode; tone?: Tone }) {
  return <span className={`op-badge ${toneClass(tone)}`}>{children}</span>;
}

export function SeverityBadge({ children, tone = 'neutral' }: { children: ReactNode; tone?: Tone }) {
  return <span className={`op-severity ${toneClass(tone)}`}>{children}</span>;
}

export function KPISummaryCard({
  label,
  value,
  detail,
  tone = 'neutral',
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  tone?: Tone;
}) {
  return (
    <article className={`op-kpi ${toneClass(tone)}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </article>
  );
}

export function OperationalTable({
  columns,
  children,
  className = '',
}: {
  columns: string[];
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`op-table ${className}`}>
      <div className="op-table-head">
        {columns.map((column) => (
          <span key={column}>{column}</span>
        ))}
      </div>
      <div className="op-table-body">{children}</div>
    </div>
  );
}

export function MetadataRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="op-meta-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function ShopifyEntityDisplay({
  label,
  primary,
  secondary,
}: {
  label: string;
  primary: ReactNode;
  secondary?: ReactNode;
}) {
  return (
    <div className="shopify-entity">
      <span>{label}</span>
      <strong>{primary}</strong>
      {secondary ? <small>{secondary}</small> : null}
    </div>
  );
}

export function TimelineBlock({
  items,
}: {
  items: Array<{ label: string; at?: string | null; detail?: string }>;
}) {
  return (
    <ol className="op-timeline">
      {items.map((item) => (
        <li key={`${item.label}-${item.at ?? 'pending'}`}>
          <span className="op-timeline-dot" />
          <div>
            <strong>{item.label}</strong>
            <small>{item.at ?? item.detail ?? 'Pending'}</small>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function SideDetailPanel({
  title,
  eyebrow,
  children,
  action,
}: {
  title: ReactNode;
  eyebrow?: ReactNode;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <aside className="op-side-panel">
      <div className="op-side-panel-header">
        <div>
          {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
          <h3>{title}</h3>
        </div>
        {action}
      </div>
      {children}
    </aside>
  );
}

export function EmptyStatePanel({ title, description }: { title: string; description: string }) {
  return (
    <div className="op-empty-state">
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
}

export function OperationalActionGroup({ children }: { children: ReactNode }) {
  return <div className="op-action-group">{children}</div>;
}
