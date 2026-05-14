import React from 'react';

const getCallPrepMetricValue = (metrics, key) => {
  if (!metrics) return null;
  if (key === 'leadToAppRate') return metrics.leadToAppRate;
  if (key === 'leadToLeaseRate') return metrics.leadToLeaseRate;
  if (key === 'appToLeaseRate') return metrics.appToLeaseRate;
  if (key === 'performanceMarketingSpend') return metrics.performanceMarketingSpend;
  if (key === 'totalMarketingSpend') return metrics.totalMarketingSpend;
  if (key === 'costPerLead') return metrics.costPerLead;
  if (key === 'costPerLease') return metrics.costPerLease;
  return metrics[key];
};

const percentChange = (current, previous) => {
  const currentValue = Number(current || 0);
  const previousValue = Number(previous || 0);
  if (previousValue === 0) return currentValue === 0 ? 0 : null;
  return (currentValue - previousValue) / previousValue;
};

const formatCallPrepValue = ({ value, type = 'number', formatPercent, formatCurrency, formatNumber }) => {
  if (type === 'percent') return formatPercent(value, 1);
  if (type === 'currency') return formatCurrency(value, value != null && Number(value) < 100 ? 2 : 0);
  return formatNumber(value);
};

export default function CallPrepView({
  selectedProperty,
  selectedPropertyLabel,
  selectedPropertyId,
  isAllPropertiesSelected,
  callPrepLoading,
  callPrepError,
  callPrepSections,
  callPrepMetricsLoading,
  callPrepPortfolioLoading,
  callPrepSixtyDayRange,
  callPrepRecentTasks,
  callPrepTasksLoading,
  callPrepTasksError,
  callPrepSpendError,
  callPrepSpendLoading,
  callPrepSummary,
  callPrepBudgetedMonthly,
  callPrepActiveBudgetItems,
  callPrepActualMarketingSpendLast30,
  callPrepMarketingBudgetVarianceLast30,
  callPrepSpendRows,
  marketingBudgetLoading,
  recommendationsData,
  recommendationsError,
  recommendationsLoading,
  generateRecommendations,
  metricRows,
  taskStatuses,
  buildTaskTalkingPoint,
  formatDateInputValue,
  formatReadableDate,
  formatNumber,
  formatCurrency,
  formatPercent,
  formatSignedPercent,
  getDeltaTone,
  renderMetricValue,
  miniMetricLoader,
  normalizeAnalyticsError,
  parseCurrency,
}) {
  const recommendations = Array.isArray(recommendationsData?.recommendations) ? recommendationsData.recommendations : [];

  const renderMetricTable = (section) => (
    <div className="call-prep-table-wrap">
      <table className="call-prep-table">
        <thead>
          <tr>
            <th>Metric</th>
            <th>{selectedProperty?.name || 'Property'}</th>
            <th>Vs Prior</th>
            <th>Portfolio Avg</th>
          </tr>
        </thead>
        <tbody>
          {metricRows.map((row) => {
            const currentValue = getCallPrepMetricValue(section.current, row.key);
            const delta = section.delta && Object.prototype.hasOwnProperty.call(section.delta, row.key)
              ? section.delta[row.key]
              : percentChange(currentValue, getCallPrepMetricValue(section.prior, row.key));
            const portfolioValue = getCallPrepMetricValue(section.portfolioAverage, row.key);
            const portfolioSampleSize = section.portfolioAverage?.metricSampleSizes?.[row.key]
              ?? section.portfolioAverage?.portfolioSampleSize;
            return (
              <tr key={`${section.days}-${row.key}`}>
                <td>{row.label}</td>
                <td>
                  {renderMetricValue(callPrepMetricsLoading, formatCallPrepValue({
                    value: currentValue,
                    type: row.format,
                    formatPercent,
                    formatCurrency,
                    formatNumber,
                  }))}
                </td>
                <td>
                  {callPrepMetricsLoading ? (
                    miniMetricLoader
                  ) : (
                    <span className={`analytics-pill analytics-pill--${getDeltaTone(delta)}`}>
                      {delta == null ? 'New' : formatSignedPercent(delta, 1)}
                    </span>
                  )}
                </td>
                <td>
                  <span className="call-prep-table__portfolio-cell">
                    {renderMetricValue(callPrepPortfolioLoading, section.portfolioAverage ? formatCallPrepValue({
                      value: portfolioValue,
                      type: row.format,
                      formatPercent,
                      formatCurrency,
                      formatNumber,
                    }) : '—')}
                    {!callPrepPortfolioLoading && section.portfolioAverage && portfolioSampleSize != null ? (
                      <span className="call-prep-table__sample">n={formatNumber(portfolioSampleSize)}</span>
                    ) : null}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  const renderAnalyticsTable = (section) => {
    const googleAds = section.analytics?.googleAds;
    const googleAdsLoadingForSection = callPrepLoading && !googleAds && !section.analytics?.googleAdsError;
    const googleAdsOverviewCurrent = googleAds?.Overview?.current || {};
    const googleAdsOverviewDelta = googleAds?.Overview?.delta || {};
    const ga4 = section.analytics?.ga4;
    const ga4LoadingForSection = callPrepLoading && !ga4 && !section.analytics?.ga4Error;
    const ga4Current = ga4?.Acquisition?.totals?.current || {};
    const ga4Previous = ga4?.Acquisition?.totals?.previous || {};
    const ga4EventCurrent = ga4?.Conversion?.totals?.currentEventCount;
    const ga4EventPrevious = ga4?.Conversion?.totals?.previousEventCount;
    const topGa4Event = ga4?.Conversion?.events?.[0] || null;

    return (
      <div className="call-prep-channel-grid">
        <div className="call-prep-mini-panel">
          <div className="reports-panel__eyebrow">Google Ads</div>
          <div className="call-prep-stat-grid">
            <div><span>Clicks</span><strong>{renderMetricValue(googleAdsLoadingForSection, formatNumber(googleAdsOverviewCurrent.clicks))}</strong><small>{googleAdsLoadingForSection ? 'Loading...' : `${formatSignedPercent(googleAdsOverviewDelta.clicks, 1)} vs prior`}</small></div>
            <div><span>Conversions</span><strong>{renderMetricValue(googleAdsLoadingForSection, formatNumber(googleAdsOverviewCurrent.conversions, 1))}</strong><small>{googleAdsLoadingForSection ? 'Loading...' : `${formatSignedPercent(googleAdsOverviewDelta.conversions, 1)} vs prior`}</small></div>
            <div><span>Spend</span><strong>{renderMetricValue(googleAdsLoadingForSection, formatCurrency(googleAdsOverviewCurrent.cost))}</strong><small>{googleAdsLoadingForSection ? 'Loading...' : `CTR ${formatPercent(googleAdsOverviewCurrent.ctr, 1)}`}</small></div>
          </div>
          <div className="reports-list">
            {(googleAds?.ConversionActions?.items || []).slice(0, 3).map((item) => (
              <div className="reports-list__row" key={item.resourceName || item.name}>
                <div><strong>{item.name || 'Conversion action'}</strong><small>{item.category || item.source || 'Google Ads conversion'}</small></div>
                <div>{formatNumber(item.allConversions, 1)}</div>
              </div>
            ))}
            {!googleAds && <div className="reports-empty">{normalizeAnalyticsError(section.analytics?.googleAdsError) || 'Google Ads metrics are not configured for this property.'}</div>}
          </div>
        </div>

        <div className="call-prep-mini-panel">
          <div className="reports-panel__eyebrow">GA4</div>
          <div className="call-prep-stat-grid">
            <div><span>Sessions</span><strong>{renderMetricValue(ga4LoadingForSection, formatNumber(ga4Current.sessions))}</strong><small>{ga4LoadingForSection ? 'Loading...' : `${formatSignedPercent(percentChange(ga4Current.sessions, ga4Previous.sessions), 1)} vs prior`}</small></div>
            <div><span>Engagement</span><strong>{renderMetricValue(ga4LoadingForSection, formatPercent(ga4Current.engagementRate, 1))}</strong><small>{ga4LoadingForSection ? 'Loading...' : `${formatNumber(ga4Current.engagedSessions)} engaged sessions`}</small></div>
            <div><span>Key Events</span><strong>{renderMetricValue(ga4LoadingForSection, formatNumber(ga4EventCurrent))}</strong><small>{ga4LoadingForSection ? 'Loading...' : `${formatSignedPercent(percentChange(ga4EventCurrent, ga4EventPrevious), 1)} vs prior`}</small></div>
          </div>
          <div className="reports-list">
            {topGa4Event && (
              <div className="reports-list__row">
                <div><strong>{topGa4Event.eventName}</strong><small>Top key event in this window</small></div>
                <div>{formatNumber(topGa4Event.current?.eventCount)}</div>
              </div>
            )}
            {(ga4?.Acquisition?.channels || []).slice(0, 2).map((item) => (
              <div className="reports-list__row" key={item.channel}>
                <div><strong>{item.channel}</strong><small>{formatPercent(item.current?.engagementRate, 1)} engagement</small></div>
                <div>{formatNumber(item.current?.sessions)} sessions</div>
              </div>
            ))}
            {!ga4 && <div className="reports-empty">{normalizeAnalyticsError(section.analytics?.ga4Error) || 'GA4 metrics are not configured for this property.'}</div>}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="call-prep-view">
      <div className="reports-hero call-prep-hero">
        <div>
          <div className="reports-kicker">Manager call prep</div>
          <div className="reports-headline">{selectedPropertyLabel}</div>
          <div className="reports-subhead">
            Fixed 7, 30, and 60 day talking points with prior-period comparisons, portfolio averages, channel performance, recent task changes, and active marketing spend.
          </div>
        </div>
        <div className="reports-chip-row">
          <span className="reports-chip reports-chip--staged">{callPrepLoading ? 'Refreshing call prep...' : 'Fixed-window view'}</span>
          <button
            type="button"
            className="reports-admin-toggle"
            onClick={() => generateRecommendations(callPrepSixtyDayRange)}
            disabled={recommendationsLoading || !selectedPropertyId || isAllPropertiesSelected}
          >
            {recommendationsLoading ? 'Generating...' : 'Generate AI Recommendations'}
          </button>
        </div>
      </div>

      {callPrepError && <div className="tasks-message tasks-message--error">{callPrepError}</div>}

      <div className="call-prep-period-grid">
        {callPrepSections.map((section) => (
          <section className="reports-panel call-prep-period" key={section.days}>
            <div className="call-prep-period__header">
              <div>
                <div className="reports-panel__eyebrow">{section.shortLabel} performance</div>
                <div className="reports-panel__title">{section.label}</div>
                <small>{formatDateInputValue(section.currentRange.start)} to {formatDateInputValue(section.currentRange.end)}</small>
              </div>
              <span className="analytics-pill analytics-pill--neutral">Prior: {formatDateInputValue(section.priorRange.start)} to {formatDateInputValue(section.priorRange.end)}</span>
            </div>
            {renderMetricTable(section)}
            <div className="call-prep-source-list">
              {(section.sourceBreakdown || []).map((source) => (
                <div key={`${section.days}-${source.source}`} className="reports-list__row">
                  <div><strong>{source.source}</strong><small>Lead source share {formatPercent(source.share, 1)}</small></div>
                  <div>{formatNumber(source.leads)} leads</div>
                </div>
              ))}
              {(section.sourceBreakdown || []).length === 0 && <div className="reports-empty">No lead source data in this window.</div>}
            </div>
            {renderAnalyticsTable(section)}
          </section>
        ))}
      </div>

      <div className="call-prep-bottom-grid">
        <section className="reports-panel">
          <div className="reports-panel__eyebrow">AI recommendations</div>
          <div className="reports-panel__title">Off-the-cuff talking points</div>
          <div className="reports-list">
            {recommendations.slice(0, 5).map((recommendation) => (
              <div className="reports-list__row" key={recommendation.storedRecommendationId || recommendation.id}>
                <div>
                  <strong>{recommendation.title}</strong>
                  <small>{recommendation.reasoning || recommendation.suggestedAction || 'Recommendation detail available in the Recommendations tab.'}</small>
                </div>
                <div>{recommendation.priority || 'medium'}</div>
              </div>
            ))}
            {recommendations.length === 0 && (
              <div className="reports-empty">{recommendationsError || 'Generate recommendations to populate manager-ready AI talking points for the 60 day prep window.'}</div>
            )}
          </div>
        </section>

        <section className="reports-panel">
          <div className="reports-panel__eyebrow">Recent changes</div>
          <div className="reports-panel__title">Task-driven updates</div>
          <div className="reports-list">
            {callPrepRecentTasks.map((task) => (
              <div className="reports-list__row call-prep-task-row" key={task.id}>
                <div>
                  <strong>{task.title}</strong>
                  <small>{task.talkingPoint || buildTaskTalkingPoint(task)}</small>
                  <small>Created {formatReadableDate(task.createdAt)} | Updated {formatReadableDate(task.updatedAt)} | Due {formatReadableDate(task.dueDate)}</small>
                </div>
                <div>{taskStatuses.find((status) => status.id === task.status)?.label || task.status}</div>
              </div>
            ))}
            {callPrepRecentTasks.length === 0 && (
              <div className="reports-empty">
                {callPrepTasksLoading ? 'Loading property tasks...' : callPrepTasksError || 'No property tasks were created, updated, or due in the last 60 days.'}
              </div>
            )}
          </div>
        </section>

        <section className="reports-panel call-prep-spend-panel">
          <div className="reports-panel__eyebrow">Active spend</div>
          <div className="reports-panel__title">Budget vs actual marketing spend</div>
          {callPrepSpendError && (
            <div className="tasks-message tasks-message--error">
              {callPrepSpendError}
            </div>
          )}
          <div className="reports-panel__grid reports-panel__grid--three call-prep-budget-summary">
            <div className="reports-stat">
              <span>Budgeted spend now</span>
              <strong>{renderMetricValue(callPrepSpendLoading || (marketingBudgetLoading && !callPrepSummary), formatCurrency(callPrepBudgetedMonthly))}</strong>
              <small>{formatNumber(callPrepActiveBudgetItems.length)} Active status item{callPrepActiveBudgetItems.length === 1 ? '' : 's'}</small>
            </div>
            <div className="reports-stat">
              <span>Actual GL spend</span>
              <strong>{renderMetricValue(callPrepSpendLoading, formatCurrency(callPrepActualMarketingSpendLast30))}</strong>
              <small>Last 30 days from posted marketing invoices</small>
            </div>
            <div className="reports-stat">
              <span>Budget less actual</span>
              <strong>{renderMetricValue(callPrepSpendLoading || (marketingBudgetLoading && !callPrepSummary), formatCurrency(callPrepMarketingBudgetVarianceLast30))}</strong>
              <small>{callPrepMarketingBudgetVarianceLast30 >= 0 ? 'Under approved monthly budget' : 'Over approved monthly budget'}</small>
            </div>
          </div>

          <div className="call-prep-spend-section">
            <div className="reports-panel__eyebrow">Budgeted monthly items</div>
            <div className="reports-list">
              {callPrepActiveBudgetItems.map((item) => (
                <div className="reports-list__row" key={item.id}>
                  <div>
                    <strong>{item.itemName || 'Marketing budget item'}</strong>
                    <small>
                      Active {formatReadableDate(item.startDate)}
                      {item.endDate ? ` to ${formatReadableDate(item.endDate)}` : ' onward'}
                    </small>
                  </div>
                  <div>
                    {formatCurrency(parseCurrency(item.monthlyAmount))}
                    <small>{item.contractFileName || item.listingUrl ? 'Documentation attached' : 'No document attached'}</small>
                  </div>
                </div>
              ))}
              {callPrepActiveBudgetItems.length === 0 && (
                <div className="reports-empty">
                  {callPrepSpendLoading || (marketingBudgetLoading && !callPrepSummary) ? 'Loading active budget items...' : 'No Active status marketing budget items were found for this property.'}
                </div>
              )}
            </div>
          </div>

          <div className="call-prep-spend-section">
            <div className="reports-panel__eyebrow">Actual GL lines</div>
            <div className="reports-list">
              {callPrepSpendRows.map((row) => (
                <div className="reports-list__row" key={row.key}>
                  <div>
                    <strong>{row.label}</strong>
                    <small>{row.glCodes || 'Marketing GL'} | {row.month.toLocaleDateString([], { month: 'long', year: 'numeric' })}</small>
                  </div>
                  <div>
                    {formatCurrency(row.amount)}
                    <small>{formatCurrency(row.allocatedInWindow)} in 60D</small>
                  </div>
                </div>
              ))}
              {callPrepSpendRows.length === 0 && <div className="reports-empty">No active marketing GL spend was found for the 60 day call prep window.</div>}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
