import { Link } from 'react-router-dom';
import { StatusBadge } from './OperationalPrimitives';
import type { OperationsAttentionSeverity, OperationsRecommendation } from '../lib/api/contracts';

function getSeverityTone(severity: OperationsAttentionSeverity) {
  if (severity === 'critical') {
    return 'danger' as const;
  }
  if (severity === 'warning') {
    return 'warning' as const;
  }
  return 'info' as const;
}

export function OperationalRecommendations({
  title = 'Recommended actions',
  subtitle,
  recommendations,
  audience = 'admin',
  emptyMessage,
}: {
  title?: string;
  subtitle?: string;
  recommendations: OperationsRecommendation[];
  audience?: 'admin' | 'vendor';
  emptyMessage?: string;
}) {
  const visibleRecommendations = recommendations.filter((recommendation) => audience === 'admin' || recommendation.vendorVisible);

  if (!visibleRecommendations.length && !emptyMessage) {
    return null;
  }

  return (
    <article className="operational-card operational-recommendations-card">
      <div className="operational-card-heading">
        <div>
          <p className="eyebrow">Operations</p>
          <h3>{title}</h3>
          {subtitle ? <span>{subtitle}</span> : null}
        </div>
      </div>
      {visibleRecommendations.length ? (
        <div className="operational-recommendation-list">
          {visibleRecommendations.map((recommendation) => {
            const body = (
              <>
                <div className="operational-recommendation-copy">
                  <div>
                    <strong>{recommendation.title}</strong>
                    <StatusBadge tone={getSeverityTone(recommendation.severity)}>{recommendation.severity}</StatusBadge>
                  </div>
                  <p>{recommendation.description}</p>
                  <span>{recommendation.recommendedAction}</span>
                </div>
                <small>{recommendation.vendor.name}</small>
              </>
            );

            return recommendation.deepLink ? (
              <Link key={recommendation.id} to={recommendation.deepLink} className="operational-recommendation-row">
                {body}
              </Link>
            ) : (
              <div key={recommendation.id} className="operational-recommendation-row">
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
