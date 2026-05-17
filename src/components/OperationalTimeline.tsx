import { Link } from 'react-router-dom';
import { StatusBadge } from './OperationalPrimitives';
import {
  filterOperationalEvents,
  filterOperationalLinks,
  type OperationalAudience,
  type OperationalEventInput,
  type OperationalLinkInput,
} from '../lib/operationalCrossLinks';

function formatTimelineDate(value?: string | null) {
  if (!value) {
    return '—';
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export function OperationalTimeline({
  title = 'Operational timeline',
  subtitle,
  events,
  audience = 'vendor',
  emptyMessage = 'No operational activity yet.',
}: {
  title?: string;
  subtitle?: string;
  events: OperationalEventInput[];
  audience?: OperationalAudience;
  emptyMessage?: string;
}) {
  const visibleEvents = filterOperationalEvents(events, audience);

  return (
    <article className="operational-card operational-timeline-card">
      <div className="operational-card-heading">
        <div>
          <p className="eyebrow">Timeline</p>
          <h3>{title}</h3>
          {subtitle ? <span>{subtitle}</span> : null}
        </div>
      </div>
      {visibleEvents.length ? (
        <ol className="unified-operational-timeline">
          {visibleEvents.map((event) => (
            <li key={event.id}>
              <span className={`unified-timeline-dot op-tone-${event.tone ?? 'neutral'}`} aria-hidden="true" />
              <div>
                <div className="unified-timeline-title-row">
                  {event.href ? <Link to={event.href}>{event.title}</Link> : <strong>{event.title}</strong>}
                  {event.status ? <StatusBadge tone={event.tone ?? 'neutral'}>{event.status}</StatusBadge> : null}
                </div>
                {event.description ? <p>{event.description}</p> : null}
                <small>{formatTimelineDate(event.at)}</small>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="operational-empty-copy">{emptyMessage}</p>
      )}
    </article>
  );
}

export function OperationalLinkCards({
  title,
  subtitle,
  links,
  audience = 'vendor',
  emptyMessage = 'No related records.',
}: {
  title: string;
  subtitle?: string;
  links: OperationalLinkInput[];
  audience?: OperationalAudience;
  emptyMessage?: string;
}) {
  const visibleLinks = filterOperationalLinks(links, audience);

  return (
    <article className="operational-card operational-links-card">
      <div className="operational-card-heading">
        <div>
          <p className="eyebrow">Linked records</p>
          <h3>{title}</h3>
          {subtitle ? <span>{subtitle}</span> : null}
        </div>
      </div>
      {visibleLinks.length ? (
        <div className="operational-link-list">
          {visibleLinks.map((link) => {
            const body = (
              <>
                <div>
                  {link.eyebrow ? <span>{link.eyebrow}</span> : null}
                  <strong>{link.title}</strong>
                  {link.description ? <small>{link.description}</small> : null}
                </div>
                {link.status ? <StatusBadge tone={link.tone ?? 'neutral'}>{link.status}</StatusBadge> : null}
              </>
            );

            return link.href ? (
              <Link key={link.id} to={link.href} className="operational-link-row">
                {body}
              </Link>
            ) : (
              <div key={link.id} className="operational-link-row">
                {body}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="operational-empty-copy">{emptyMessage}</p>
      )}
    </article>
  );
}
