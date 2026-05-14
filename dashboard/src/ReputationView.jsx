import React from 'react';

export default function ReputationView(props) {
  const {
    formatDateInputValue,
    formatNumber,
    formatPercent,
    rangeDates,
    renderMetricValue,
    reputationData,
    reputationError,
    reputationLoading,
    selectedPropertyId,
    selectedPropertyLabel,
  } = props;

  const reputationOverview = reputationData?.overview || {};
  const reputationAverageRating = reputationOverview.averageRating ?? null;
  const reputationReviewCount = reputationOverview.reviewCount ?? null;
  const reputationResponseRate = reputationOverview.responseRate ?? null;
  const reputationSentimentScore = reputationOverview.sentimentScore ?? null;
  const reputationRecentReviews = reputationData?.recentReviews || [];
  const reputationSummary = reputationData?.summary || [];
  const reputationWindow = reputationData?.window || null;
  const reputationRawKeys = reputationData?.rawTopLevelKeys || [];

  return (
    <div className="reputation-view">
      <div className="reputation-hero">
        <div>
          <div className="reputation-kicker">Resident Sentiment Layer</div>
          <div className="reputation-headline">Reputation</div>
          <div className="reputation-subhead">
            Opiniion-backed reputation monitoring for {selectedPropertyLabel}. This view reads the live connector when available and falls back to the last cached Firestore snapshot if the refresh path is unavailable.
          </div>
        </div>
        <div className="reputation-pill-row">
          <div className="reputation-pill">{selectedPropertyLabel}</div>
          <div className="reputation-pill">
            {reputationWindow?.startDate && reputationWindow?.endDate
              ? `${reputationWindow.startDate} to ${reputationWindow.endDate}`
              : `${formatDateInputValue(rangeDates.start)} to ${formatDateInputValue(rangeDates.end)}`}
          </div>
          <div className="reputation-pill">
            {reputationLoading ? 'Refreshing...' : reputationError ? 'Cached / blocked' : 'Live connector'}
          </div>
        </div>
      </div>

      <div className="property-info-grid">
        <div className="property-info-card">
          <div className="property-info-card__label">Average Rating</div>
          <div className="property-info-card__value">{renderMetricValue(reputationLoading, formatNumber(reputationAverageRating, 2))}</div>
          <div className="property-info-card__meta">Normalized from the Opiniion payload when a rating-like field is present.</div>
        </div>
        <div className="property-info-card">
          <div className="property-info-card__label">Review Count</div>
          <div className="property-info-card__value">{renderMetricValue(reputationLoading, formatNumber(reputationReviewCount))}</div>
          <div className="property-info-card__meta">Public review volume recognized in the latest response.</div>
        </div>
        <div className="property-info-card">
          <div className="property-info-card__label">Response Rate</div>
          <div className="property-info-card__value">{renderMetricValue(reputationLoading, formatPercent(reputationResponseRate, 1))}</div>
          <div className="property-info-card__meta">Management reply coverage if the API exposes a response-rate field.</div>
        </div>
        <div className="property-info-card">
          <div className="property-info-card__label">Sentiment Score</div>
          <div className="property-info-card__value">{renderMetricValue(reputationLoading, formatPercent(reputationSentimentScore, 1))}</div>
          <div className="property-info-card__meta">Positive-share / satisfaction-style metric when available.</div>
        </div>
      </div>

      <div className="property-info-panels" style={{ marginTop: '1rem' }}>
        <div className="property-info-panel property-info-panel--wide">
          <div className="property-info-panel__header">
            <div>
              <div className="property-info-panel__eyebrow">Recent Feedback</div>
              <h3 className="property-info-panel__title">Latest reviews pulled into the dashboard</h3>
            </div>
          </div>
          {reputationLoading ? (
            <div className="property-info-panel__empty">Loading reputation feed...</div>
          ) : reputationRecentReviews.length > 0 ? (
            <div className="reputation-review-list">
              {reputationRecentReviews.map((review, index) => (
                <div key={`${review.author}-${review.publishedAt || index}`} className="reputation-review-card">
                  <div className="reputation-review-card__top">
                    <div>
                      <div className="reputation-review-card__author">{review.author || 'Anonymous'}</div>
                      <div className="reputation-review-card__meta">
                        {[review.source, review.publishedAt].filter(Boolean).join(' | ') || 'Review item'}
                      </div>
                    </div>
                    <div className="reputation-review-card__rating">
                      {review.rating != null ? `${formatNumber(review.rating, 1)} / 5` : 'No rating'}
                    </div>
                  </div>
                  <div className="reputation-review-card__body">
                    {review.message || 'This review row did not include a text body in the normalized payload.'}
                  </div>
                  {review.response && (
                    <div className="reputation-review-card__response">
                      Management response: {review.response}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="property-info-panel__empty">
              No recognizable review rows were returned yet. Once we confirm the exact Opiniion reputation route and each property's location mapping, this section should populate automatically.
            </div>
          )}
        </div>

        <div className="property-info-panel">
          <div className="property-info-panel__header">
            <div>
              <div className="property-info-panel__eyebrow">Connector Status</div>
              <h3 className="property-info-panel__title">What the integration recognized</h3>
            </div>
          </div>
          <div className="property-info-panel__stack">
            {reputationError ? (
              <div className="property-info-panel__empty">{reputationError}</div>
            ) : (
              <div className="property-info-panel__empty">
                Live Opiniion refresh succeeded for this property and date window.
              </div>
            )}
            {reputationSummary.map((line) => (
              <div key={line} className="property-info-panel__row">
                <div className="property-info-panel__row-label">{line}</div>
              </div>
            ))}
            <div className="property-info-panel__row">
              <div className="property-info-panel__row-label">Payload keys</div>
              <div className="property-info-panel__row-value">
                {reputationRawKeys.length ? reputationRawKeys.join(', ') : 'No top-level keys captured yet'}
              </div>
            </div>
            <div className="property-info-panel__row">
              <div className="property-info-panel__row-label">Snapshot path</div>
              <div className="property-info-panel__row-value">properties/{selectedPropertyId}/analytics/reputation_dashboard</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
