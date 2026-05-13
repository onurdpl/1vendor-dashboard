import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';

type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'attention' | 'stale';
type TableDensity = 'compact' | 'comfortable';
type TableRowProps = {
  children: ReactNode;
  selected?: boolean;
  className?: string;
  onSelect?: () => void;
};

function toneClass(tone: Tone) {
  return `op-tone-${tone}`;
}

export function resolveOperationalStatusTone(status: string): Tone {
  const normalized = status.toLowerCase().replace(/[\s_-]+/g, '-');
  if (['fulfilled', 'delivered', 'processed', 'recorded', 'reconciled', 'closed', 'approved', 'success'].includes(normalized)) {
    return 'success';
  }
  if (['failed', 'declined', 'cancelled', 'rejected', 'error'].includes(normalized)) {
    return 'danger';
  }
  if (['pending', 'requested', 'received', 'awaiting-shipment', 'warning', 'attention'].includes(normalized)) {
    return 'attention';
  }
  if (['stale', 'needs-attention', 'reconciliation', 'processing'].includes(normalized)) {
    return normalized === 'processing' ? 'info' : 'stale';
  }
  return 'neutral';
}

export function StatusBadge({
  children,
  tone,
  status,
}: {
  children: ReactNode;
  tone?: Tone;
  status?: string;
}) {
  return <span className={`op-badge ${toneClass(tone ?? (status ? resolveOperationalStatusTone(status) : 'neutral'))}`}>{children}</span>;
}

export function SeverityBadge({ children, tone = 'neutral' }: { children: ReactNode; tone?: Tone }) {
  return <span className={`op-severity ${toneClass(tone)}`}>{children}</span>;
}

export function KPIStatCard({
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

export const KPISummaryCard = KPIStatCard;

export function OperationalTable({
  columns,
  children,
  className = '',
  stickyHeader = true,
  density = 'compact',
}: {
  columns: string[];
  children: ReactNode;
  className?: string;
  stickyHeader?: boolean;
  density?: TableDensity;
}) {
  return (
    <div className={`op-table op-table-${density} ${stickyHeader ? 'op-table-sticky' : ''} ${className}`}>
      <div className="op-table-head" role="row">
        {columns.map((column) => (
          <span key={column} role="columnheader">{column}</span>
        ))}
      </div>
      <div className="op-table-body" role="rowgroup">{children}</div>
    </div>
  );
}

export function OperationalTableRow({ children, selected = false, className = '', onSelect }: TableRowProps) {
  const selectable = typeof onSelect === 'function';
  return (
    <div
      role={selectable ? 'button' : 'row'}
      tabIndex={selectable ? 0 : undefined}
      className={`op-table-row ${selected ? 'op-row-selected' : ''} ${className}`}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (!selectable) {
          return;
        }
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect?.();
        }
      }}
    >
      {children}
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

export function MetadataGroup({ children, title }: { children: ReactNode; title?: ReactNode }) {
  return (
    <section className="op-meta-group">
      {title ? <h4>{title}</h4> : null}
      <div className="op-meta-grid">{children}</div>
    </section>
  );
}

export function ShopifyEntityPill({
  label,
  primary,
  secondary,
}: {
  label: string;
  primary: ReactNode;
  secondary?: ReactNode;
}) {
  return (
    <div className="shopify-entity op-entity-pill">
      <span>{label}</span>
      <strong>{primary}</strong>
      {secondary ? <small>{secondary}</small> : null}
    </div>
  );
}

export const ShopifyEntityDisplay = ShopifyEntityPill;

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
  footer,
}: {
  title: ReactNode;
  eyebrow?: ReactNode;
  children: ReactNode;
  action?: ReactNode;
  footer?: ReactNode;
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
      <div className="op-side-panel-body">{children}</div>
      {footer ? <div className="op-side-panel-footer">{footer}</div> : null}
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

export const ActionGroup = OperationalActionGroup;

export function OperationalToolbar({ children }: { children: ReactNode }) {
  return <div className="op-toolbar">{children}</div>;
}

export function SearchInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} type="search" className={`op-search-input ${props.className ?? ''}`} />;
}

export function FilterBar({ children }: { children: ReactNode }) {
  return <div className="op-filter-bar">{children}</div>;
}

export function OperationalSection({
  title,
  description,
  children,
  action,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="op-section">
      <div className="op-section-heading">
        <div>
          <h3>{title}</h3>
          {description ? <p>{description}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function OperationalButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} className={`button ${props.className ?? ''}`} />;
}
