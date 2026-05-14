import React from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  BarChart,
  Bar,
} from 'recharts';

export default function DashboardView(props) {
  const {
    CHART_AXIS_DARK,
    CHART_AXIS_DARK_SOFT,
    CHART_COLOR_GREEN,
    CHART_COLOR_ORANGE,
    CHART_COLOR_PINK,
    CHART_COLOR_SECONDARY_TAN,
    CHART_COLOR_TAN,
    CHART_GRID_DARK,
    CHART_MARGIN_TALL,
    CHART_MARGIN_VERTICAL,
    CHART_TOOLTIP_ITEM_STYLE,
    CHART_TOOLTIP_LABEL_STYLE,
    CHART_TOOLTIP_STYLE,
    DollarSign,
    FileCheck,
    Home,
    MeasuredChart,
    TrendingUp,
    Users,
    adjustedMarketingSpend,
    activeRedListStatus,
    applicationConversion,
    applicationToLeaseConversion,
    attributedLeaseCount,
    attributionMatchRate,
    blendedRoas,
    blendedRoi,
    allCanonicalLeadItems,
    approvedLeaseRecords,
    completedApplicationRecords,
    conventionalLeadDeficitMetrics,
    costPerLead,
    costPerLease,
    formatCurrency,
    formatDateInputValue,
    formatNumber,
    formatPercent,
    formatReadableDate,
    formatSignedPercent,
    funnelMetricSource,
    invoiceLoading,
    isConventionalLeadDeficitPanel,
    leaseConversion,
    loading,
    marketingSpendBreakdown,
    rangeDates,
    redListSummary,
    renderMetricValue,
    roiLoading,
    roiTotals,
    studentLeadDeficitMetrics,
    toggleMarketingSpendLine,
    totalApplications,
    totalBlendedMarketingSpend,
    totalLeads,
    totalLeases,
  } = props;

  const leadSourceBreakdown = React.useMemo(() => {
    const sources = {};
    allCanonicalLeadItems.forEach((lead) => {
      const source = lead.leadSource || lead.internetListingService || 'Unknown';
      sources[source] = (sources[source] || 0) + 1;
    });
    return Object.entries(sources)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([name, value]) => ({ name: name.length > 20 ? `${name.slice(0, 20)}...` : name, value }));
  }, [allCanonicalLeadItems]);

  const dailyChartData = React.useMemo(() => {
    const dateMap = {};
    for (
      let cursor = new Date(rangeDates.start.getFullYear(), rangeDates.start.getMonth(), rangeDates.start.getDate());
      cursor <= rangeDates.end;
      cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1)
    ) {
      const dateKey = formatDateInputValue(cursor);
      dateMap[dateKey] = { date: dateKey, leads: 0, leases: 0, applications: 0 };
    }

    allCanonicalLeadItems.forEach((lead) => {
      if (lead._date && dateMap[lead._date]) {
        dateMap[lead._date].leads += 1;
      }
    });

    completedApplicationRecords.forEach((record) => {
      const dateKey = record.date ? formatDateInputValue(record.date) : null;
      if (dateKey && dateMap[dateKey]) {
        dateMap[dateKey].applications += 1;
      }
    });

    approvedLeaseRecords.forEach((record) => {
      const dateKey = record.date ? formatDateInputValue(record.date) : null;
      if (dateKey && dateMap[dateKey]) {
        dateMap[dateKey].leases += 1;
      }
    });

    return Object.values(dateMap)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((item) => ({
        ...item,
        label: new Date(`${item.date}T00:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' }),
      }));
  }, [allCanonicalLeadItems, approvedLeaseRecords, completedApplicationRecords, formatDateInputValue, rangeDates]);

  return <div className="grid-layout">
        {/* ── KPI Tiles ── */}
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Users size={16} style={{ opacity: 0.6 }} />
          <div className="card-title">Total Leads</div>
          </div>
          <div className="card-value">{renderMetricValue(loading, formatNumber(totalLeads))}</div>
          <div style={{ fontSize: '0.75rem', marginTop: '0.5rem', opacity: 0.7 }}>
            Apps: {formatNumber(totalApplications)} | Leases: {formatNumber(totalLeases)}
          </div>
        </div>

        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <FileCheck size={16} style={{ opacity: 0.6 }} />
            <div className="card-title">Applications Completed</div>
          </div>
          <div className="card-value">{renderMetricValue(loading, formatNumber(totalApplications))}</div>
          <div style={{ fontSize: '0.75rem', marginTop: '0.5rem', opacity: 0.7 }}>
            Lead-to-completed-app: {applicationConversion}% | {funnelMetricSource}
          </div>
        </div>

        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Home size={16} style={{ opacity: 0.6 }} />
            <div className="card-title">Leases Approved</div>
          </div>
          <div className="card-value">{renderMetricValue(loading, formatNumber(totalLeases))}</div>
          <div style={{ fontSize: '0.75rem', marginTop: '0.5rem', opacity: 0.7 }}>
            App-to-approved-lease: {applicationToLeaseConversion}% | Lead-to-lease: {leaseConversion}%
          </div>
        </div>

        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <DollarSign size={16} style={{ opacity: 0.6 }} />
            <div className="card-title">Lead-to-Lease Conversion</div>
          </div>
          <div className="card-value">
            {renderMetricValue(loading, `${leaseConversion}%`)}
          </div>
          <div style={{ fontSize: '0.75rem', marginTop: '0.5rem', opacity: 0.7 }}>
            Leads: {formatNumber(totalLeads)} | Leases: {formatNumber(totalLeases)}
          </div>
        </div>

        <div className="card" style={{ background: 'var(--pop-red)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <DollarSign size={16} style={{ opacity: 0.6 }} />
            <div className="card-title">Marketing Cost</div>
          </div>
          <div className="card-value">
            {renderMetricValue(loading || invoiceLoading, totalBlendedMarketingSpend > 0 ? formatCurrency(totalBlendedMarketingSpend) : 'No data')}
          </div>
          <div style={{ fontSize: '0.75rem', marginTop: '0.5rem', opacity: 0.7 }}>
            Marketing spend: {adjustedMarketingSpend > 0 ? formatCurrency(adjustedMarketingSpend) : '—'} | CPL: {costPerLead !== '—' ? formatCurrency(costPerLead, 2) : '—'}
          </div>
        </div>

        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <DollarSign size={16} style={{ opacity: 0.6 }} />
            <div className="card-title">Cost Per Lead</div>
          </div>
          <div className="card-value">
            {renderMetricValue(loading || invoiceLoading, costPerLead !== '—' ? formatCurrency(costPerLead, 2) : 'No spend')}
          </div>
          <div style={{ fontSize: '0.75rem', marginTop: '0.5rem', opacity: 0.7 }}>
            Leads: {formatNumber(totalLeads)} | Marketing spend: {adjustedMarketingSpend > 0 ? formatCurrency(adjustedMarketingSpend) : '—'}
          </div>
        </div>

        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <TrendingUp size={16} style={{ opacity: 0.6 }} />
            <div className="card-title">Cost Per Lease</div>
          </div>
          <div className="card-value">
            {renderMetricValue(roiLoading || invoiceLoading, costPerLease !== '—' ? formatCurrency(costPerLease, 2) : 'No spend')}
          </div>
          <div style={{ fontSize: '0.75rem', marginTop: '0.5rem', opacity: 0.7 }}>
            ROI: {blendedRoi != null ? `${(blendedRoi * 100).toFixed(0)}%` : '—'} | Leases: {formatNumber(totalLeases)}
          </div>
        </div>

        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <TrendingUp size={16} style={{ opacity: 0.6 }} />
            <div className="card-title">ROAS</div>
          </div>
          <div className="card-value">
            {renderMetricValue(roiLoading || invoiceLoading, blendedRoas != null ? `${blendedRoas.toFixed(2)}x` : 'No spend')}
          </div>
          <div style={{ fontSize: '0.75rem', marginTop: '0.5rem', opacity: 0.7 }}>
            Net revenue: {roiTotals.netEffectiveRevenue > 0 ? formatCurrency(roiTotals.netEffectiveRevenue) : '—'} | Spend: {adjustedMarketingSpend > 0 ? formatCurrency(adjustedMarketingSpend) : '—'}
          </div>
        </div>

        <section className="dashboard-detail-panel span-4">
          <div className="dashboard-detail-panel__header">
            <div>
              <div className="dashboard-detail-panel__eyebrow">{isConventionalLeadDeficitPanel ? 'Conventional Occupancy' : 'Student Prelease'}</div>
              <h3>Lead Deficit</h3>
            </div>
            <div className={`dashboard-detail-panel__status ${activeRedListStatus.isRedList ? 'is-red-list' : ''}`}>
              {activeRedListStatus.label}
            </div>
          </div>
          {isConventionalLeadDeficitPanel ? (
            <>
              <div className="reports-panel__grid reports-panel__grid--three">
                <div className="reports-stat"><span>Red List</span><strong>{activeRedListStatus.label}</strong><small>{activeRedListStatus.detail}</small></div>
                <div className="reports-stat"><span>Current Occupancy</span><strong>{formatPercent(conventionalLeadDeficitMetrics.currentOccupancyRate, 1)}</strong><small>{formatNumber(conventionalLeadDeficitMetrics.currentOccupiedUnits)} of {conventionalLeadDeficitMetrics.targetUnitCount > 0 ? formatNumber(conventionalLeadDeficitMetrics.targetUnitCount) : 'target missing'} units active</small></div>
                <div className="reports-stat"><span>60-Day Forecast Occupancy</span><strong>{formatPercent(conventionalLeadDeficitMetrics.forecastOccupancyRate, 1)}</strong><small>Forecast date {formatReadableDate(conventionalLeadDeficitMetrics.forecastDate)}</small></div>
                <div className="reports-stat"><span>60-Day Exposure</span><strong>{formatPercent(conventionalLeadDeficitMetrics.forecastExposureRate, 1)}</strong><small>{conventionalLeadDeficitMetrics.availableUnitsIn60Days != null ? `${formatNumber(conventionalLeadDeficitMetrics.availableUnitsIn60Days)} units available to rent` : 'Unit target needed'}</small></div>
                <div className="reports-stat"><span>Week-over-Week Exposure</span><strong>{formatSignedPercent(conventionalLeadDeficitMetrics.exposureVariance, 1)}</strong><small>{conventionalLeadDeficitMetrics.exposureVariance < 0 ? 'Improving exposure' : conventionalLeadDeficitMetrics.exposureVariance > 0 ? 'Exposure increasing' : 'Flat exposure'} vs {formatReadableDate(conventionalLeadDeficitMetrics.priorWeekDate)}</small></div>
                <div className="reports-stat"><span>Leads Last 60 Days</span><strong>{formatNumber(conventionalLeadDeficitMetrics.totalLeads60)}</strong><small>{formatReadableDate(conventionalLeadDeficitMetrics.windowStart)} - {formatReadableDate(rangeDates.end)}</small></div>
                <div className="reports-stat"><span>Close Rate Last 60 Days</span><strong>{formatPercent(conventionalLeadDeficitMetrics.currentCloseRate, 1)}</strong><small>{formatNumber(conventionalLeadDeficitMetrics.totalLeases60)} approved leases</small></div>
                <div className="reports-stat"><span>Lead Deficit at Current Rate</span><strong>{conventionalLeadDeficitMetrics.leadDeficitAtCurrentClose != null ? formatNumber(conventionalLeadDeficitMetrics.leadDeficitAtCurrentClose) : '—'}</strong><small>{conventionalLeadDeficitMetrics.requiredLeadsAtCurrentClose != null ? `${formatNumber(conventionalLeadDeficitMetrics.requiredLeadsAtCurrentClose)} required leads before 60-day run-rate offset` : 'Close rate needed'}</small></div>
                <div className="reports-stat"><span>Lead Deficit at 10%</span><strong>{conventionalLeadDeficitMetrics.leadDeficitAtTenClose != null ? formatNumber(conventionalLeadDeficitMetrics.leadDeficitAtTenClose) : '—'}</strong><small>{conventionalLeadDeficitMetrics.requiredLeadsAtTenClose != null ? `${formatNumber(conventionalLeadDeficitMetrics.requiredLeadsAtTenClose)} required leads before 60-day run-rate offset` : 'Unit target needed'}</small></div>
                <div className="reports-stat"><span>Tours Last 60 Days</span><strong>{formatNumber(conventionalLeadDeficitMetrics.totalTours60)}</strong><small>Tour events matched from Entrata activity</small></div>
              </div>
              <div className="reports-list dashboard-detail-panel__list">
                <div className="reports-list__row"><div><strong>Lead to tour</strong><small>Tours divided by leads in the last 60 days.</small></div><div>{formatPercent(conventionalLeadDeficitMetrics.leadToTourRate, 1)}</div></div>
                <div className="reports-list__row"><div><strong>Tour to completed application</strong><small>Completed applications divided by tours.</small></div><div>{formatPercent(conventionalLeadDeficitMetrics.tourToApplicationRate, 1)}</div></div>
                <div className="reports-list__row"><div><strong>Tour to approved lease</strong><small>Approved leases divided by tours.</small></div><div>{formatPercent(conventionalLeadDeficitMetrics.tourToLeaseRate, 1)}</div></div>
                <div className="reports-list__row"><div><strong>Lead to approved lease</strong><small>Standard 60-day lead-to-lease conversion.</small></div><div>{formatPercent(conventionalLeadDeficitMetrics.leadToLeaseRate, 1)}</div></div>
                <div className="reports-list__row"><div><strong>Lead to completed application</strong><small>Standard 60-day lead-to-application conversion.</small></div><div>{formatPercent(conventionalLeadDeficitMetrics.leadToApplicationRate, 1)}</div></div>
                <div className="reports-list__row"><div><strong>Completed application to approved lease</strong><small>Standard 60-day application-to-lease conversion.</small></div><div>{formatPercent(conventionalLeadDeficitMetrics.applicationToLeaseRate, 1)}</div></div>
                {conventionalLeadDeficitMetrics.targetUnitCount <= 0 && (
                  <div className="reports-empty">A unit target could not be inferred from the latest availability snapshot. Add unit capacity to enable occupancy, exposure, and lead deficit calculations.</div>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="reports-panel__grid reports-panel__grid--three">
                <div className="reports-stat"><span>Red List</span><strong>{activeRedListStatus.label}</strong><small>{activeRedListStatus.detail}</small></div>
                <div className="reports-stat"><span>Current Prelease</span><strong>{studentLeadDeficitMetrics.targetLeaseCount > 0 ? formatPercent(studentLeadDeficitMetrics.currentPreleaseRate, 1) : '—'}</strong><small>{formatNumber(studentLeadDeficitMetrics.currentPreleaseCount)} of {studentLeadDeficitMetrics.targetLeaseCount > 0 ? formatNumber(studentLeadDeficitMetrics.targetLeaseCount) : 'target missing'} fall leases</small></div>
                <div className="reports-stat"><span>Leases Remaining</span><strong>{studentLeadDeficitMetrics.leasesRemaining != null ? formatNumber(studentLeadDeficitMetrics.leasesRemaining) : '—'}</strong><small>Fall start {formatReadableDate(studentLeadDeficitMetrics.cycle.fallStart)} | {formatNumber(studentLeadDeficitMetrics.daysToFallStart)} days left</small></div>
                <div className="reports-stat"><span>Projected Occupancy</span><strong>{formatPercent(studentLeadDeficitMetrics.projectedOccupancyRate, 1)}</strong><small>{formatNumber(studentLeadDeficitMetrics.projectedAdditionalLeases, 1)} projected additional leases at current pace</small></div>
                <div className="reports-stat"><span>Current Leads / Month</span><strong>{formatNumber(studentLeadDeficitMetrics.leadsPerMonth, 1)}</strong><small>{formatNumber(totalLeads)} leads in the selected window</small></div>
                <div className="reports-stat"><span>Lead Deficit</span><strong>{studentLeadDeficitMetrics.leadDeficitAtCurrentClose != null ? formatNumber(studentLeadDeficitMetrics.leadDeficitAtCurrentClose) : '—'}</strong><small>{formatPercent(studentLeadDeficitMetrics.currentCloseRate, 1)} current lead-to-lease close rate</small></div>
                <div className="reports-stat"><span>Lead Deficit at 30%</span><strong>{studentLeadDeficitMetrics.leadDeficitAtThirtyClose != null ? formatNumber(studentLeadDeficitMetrics.leadDeficitAtThirtyClose) : '—'}</strong><small>{studentLeadDeficitMetrics.leadNeedAtThirtyClose != null ? `${formatNumber(studentLeadDeficitMetrics.leadNeedAtThirtyClose)} required leads before run-rate offset` : 'Target capacity needed'}</small></div>
                <div className="reports-stat"><span>Lead Fulfillment</span><strong>{formatPercent(redListSummary?.lead_fulfillment_rate ?? studentLeadDeficitMetrics.leadFulfillmentRate, 1)}</strong><small>{(redListSummary?.leads_needed_per_month_at_thirty_close ?? studentLeadDeficitMetrics.leadsNeededPerMonthAtThirtyClose) != null ? `${formatNumber(redListSummary?.leads_needed_per_month_at_thirty_close ?? studentLeadDeficitMetrics.leadsNeededPerMonthAtThirtyClose, 1)} leads needed/month at 30%` : 'Target capacity needed'}</small></div>
                <div className="reports-stat"><span>Lead to App Completed</span><strong>{formatPercent(studentLeadDeficitMetrics.leadToAppRate, 1)}</strong><small>{formatNumber(totalApplications)} completed applications</small></div>
                <div className="reports-stat"><span>App Completed to Lease</span><strong>{formatPercent(studentLeadDeficitMetrics.appToLeaseRate, 1)}</strong><small>{formatNumber(totalLeases)} approved leases</small></div>
                <div className="reports-stat"><span>Extra Spend Projection</span><strong>{studentLeadDeficitMetrics.extraSpendAtCurrentClose != null ? formatCurrency(studentLeadDeficitMetrics.extraSpendAtCurrentClose) : '—'}</strong><small>CPL {studentLeadDeficitMetrics.costPerLead != null ? formatCurrency(studentLeadDeficitMetrics.costPerLead, 2) : '—'} | 30% case {studentLeadDeficitMetrics.extraSpendAtThirtyClose != null ? formatCurrency(studentLeadDeficitMetrics.extraSpendAtThirtyClose) : '—'}</small></div>
              </div>
              <div className="reports-list dashboard-detail-panel__list">
                <div className="reports-list__row"><div><strong>Season window</strong><small>Approved fall-start leases counted from the November 10 student prelease update.</small></div><div>{formatReadableDate(studentLeadDeficitMetrics.cycle.cycleStart)} - {formatReadableDate(rangeDates.end)}</div></div>
                <div className="reports-list__row"><div><strong>Projected lead supply</strong><small>Current lead pace carried through fall start before calculating the gap.</small></div><div>{formatNumber(studentLeadDeficitMetrics.projectedLeadsBeforeFall)} leads</div></div>
                <div className="reports-list__row"><div><strong>Required leads at current close</strong><small>Leases remaining divided by the selected-window lead-to-approved-lease rate.</small></div><div>{studentLeadDeficitMetrics.leadNeedAtCurrentClose != null ? formatNumber(studentLeadDeficitMetrics.leadNeedAtCurrentClose) : '—'}</div></div>
                <div className="reports-list__row"><div><strong>Year-over-year prelease</strong><small>Comparable prior-year season through the same update date when historical lease records exist.</small></div><div>{studentLeadDeficitMetrics.priorPreleaseCount > 0 ? `${formatNumber(studentLeadDeficitMetrics.currentPreleaseCount)} vs ${formatNumber(studentLeadDeficitMetrics.priorPreleaseCount)} (${formatSignedPercent(studentLeadDeficitMetrics.yoyDelta, 1)})` : 'No prior year data'}</div></div>
                {studentLeadDeficitMetrics.targetLeaseCount <= 0 && (
                  <div className="reports-empty">A target lease count could not be inferred from the latest availability snapshot. Add bed/unit capacity to enable deficit and occupancy calculations.</div>
                )}
              </div>
            </>
          )}
        </section>

        <div className="card span-2">
          <div className="card-title" style={{ color: 'var(--primary-tan)', fontWeight: 'bold' }}>Marketing Plays</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.75rem', fontSize: '0.85rem' }}>
            {totalLeads > 0 && totalApplications / totalLeads < 0.15 && (
              <p>• <strong>Low App Rate</strong>: Only {((totalApplications / totalLeads) * 100).toFixed(0)}% of leads applied. Consider follow-up campaigns.</p>
            )}
            {totalLeads === 0 && (
              <p>• <strong>No Data</strong>: Expand the date range to see metrics.</p>
            )}
            {totalLeads > 0 && (
              <p>• <strong>Top Source</strong>: {leadSourceBreakdown[0]?.name || 'N/A'} drives {leadSourceBreakdown[0]?.value || 0} leads ({totalLeads > 0 ? ((leadSourceBreakdown[0]?.value / totalLeads) * 100).toFixed(0) : 0}%).</p>
            )}
            {adjustedMarketingSpend > 0 && (
              <p>• <strong>Cost per Lease</strong>: {costPerLease !== '—' ? `$${costPerLease}` : '—'} based on adjusted all-marketing spend for this range.</p>
            )}
            {totalBlendedMarketingSpend > 0 && (
              <p>• <strong>Total Marketing Spend</strong>: ${totalBlendedMarketingSpend.toLocaleString(undefined, { maximumFractionDigits: 0 })} allocated across the selected days from tracked monthly marketing invoices.</p>
            )}
            {blendedRoi != null && (
              <p>• <strong>Blended ROI</strong>: {(blendedRoi * 100).toFixed(0)}% from ${roiTotals.netEffectiveRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 })} net effective revenue on ${adjustedMarketingSpend.toLocaleString(undefined, { maximumFractionDigits: 0 })} adjusted spend.</p>
            )}
            {attributedLeaseCount > 0 && (
              <p>• <strong>Attribution Match Rate</strong>: {attributionMatchRate}% of tracked leases are tied back to a lead record for this range.</p>
            )}
          </div>
        </div>

        {/* ── Lead Source Breakdown ── */}
        <div className="card span-2">
          <div className="card-title">Top Lead Sources</div>
          {leadSourceBreakdown.length > 0 ? (
            <MeasuredChart className="analytics-chart analytics-chart--compact" fixedHeight={160}>
              {({ width, height }) => (
              <BarChart width={width} height={height} data={leadSourceBreakdown} layout="vertical" margin={CHART_MARGIN_VERTICAL}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11, fill: CHART_COLOR_TAN }} />
                <Tooltip contentStyle={CHART_TOOLTIP_STYLE} labelStyle={CHART_TOOLTIP_LABEL_STYLE} itemStyle={CHART_TOOLTIP_ITEM_STYLE} />
                <Bar dataKey="value" fill={CHART_COLOR_ORANGE} radius={[0, 4, 4, 0]} barSize={14} />
              </BarChart>
              )}
            </MeasuredChart>
          ) : (
            <div style={{ opacity: 0.5, fontSize: '0.85rem', marginTop: '1rem' }}>No source data</div>
          )}
        </div>

        {/* ── Performance Trends Chart ── */}
        <div className="chart-container span-4">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
            <h3 style={{ color: 'white', margin: 0 }}>Daily Performance Trends</h3>
            <div style={{ display: 'flex', gap: '1rem', fontSize: '0.75rem' }}>
              <span style={{ color: 'var(--chart-pink)' }}>● Leads</span>
              <span style={{ color: 'var(--chart-secondary-tan)' }}>● Applications</span>
              <span style={{ color: 'var(--chart-green)' }}>● Leases</span>
            </div>
          </div>
          {dailyChartData.length > 0 ? (
            <MeasuredChart className="analytics-chart analytics-chart--tall" fixedHeight={300}>
              {({ width, height }) => (
              <AreaChart width={width} height={height} data={dailyChartData} margin={CHART_MARGIN_TALL}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_DARK} vertical={false} />
                <XAxis dataKey="label" stroke={CHART_AXIS_DARK} tick={{ fontSize: 11, fill: CHART_COLOR_TAN }} />
                <YAxis stroke={CHART_AXIS_DARK_SOFT} tick={{ fill: CHART_COLOR_TAN }} />
                <Tooltip contentStyle={CHART_TOOLTIP_STYLE} labelStyle={CHART_TOOLTIP_LABEL_STYLE} itemStyle={CHART_TOOLTIP_ITEM_STYLE} />
                <Area type="monotone" dataKey="leads" stroke={CHART_COLOR_PINK} fill={CHART_COLOR_PINK} fillOpacity={0.16} name="Leads" />
                <Area type="monotone" dataKey="applications" stroke={CHART_COLOR_SECONDARY_TAN} fill={CHART_COLOR_SECONDARY_TAN} fillOpacity={0.18} name="Applications" />
                <Bar dataKey="leases" fill={CHART_COLOR_GREEN} barSize={6} radius={[4, 4, 0, 0]} name="Leases" />
              </AreaChart>
              )}
            </MeasuredChart>
          ) : (
            <div style={{ color: 'var(--primary-tan)', opacity: 0.5, textAlign: 'center', paddingTop: '4rem' }}>
              {loading ? 'Loading chart data…' : 'No data for this date range'}
            </div>
          )}
        </div>

        <div className="card span-4" style={{ background: 'var(--panel-soft)', color: 'var(--white)' }}>
          <div className="card-title" style={{ color: 'var(--primary-tan)', fontWeight: 'bold' }}>Marketing Spend Breakdown</div>
          {marketingSpendBreakdown.length > 0 ? (
            <div style={{ marginTop: '0.75rem', display: 'grid', gap: '0.75rem' }}>
              {marketingSpendBreakdown.map((item) => (
                <div
                  key={item.label}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '1rem',
                    paddingBottom: '0.75rem',
                    borderBottom: '1px solid var(--panel-border)',
                    opacity: item.excluded ? 0.48 : 1
                  }}
                >
                  <div style={{ maxWidth: '75%' }}>{item.label}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                    <button
                      type="button"
                      className={`marketing-spend-toggle ${item.excluded ? 'is-excluded' : 'is-included'}`}
                      aria-pressed={!item.excluded}
                      onClick={() => toggleMarketingSpendLine(item.label)}
                      title={item.excluded ? 'Include this spend line' : 'Exclude this spend line from totals'}
                    >
                      <span className="marketing-spend-toggle__track">
                        <span className="marketing-spend-toggle__knob" />
                      </span>
                      <span>{item.excluded ? 'Excluded' : 'Included'}</span>
                    </button>
                    <div style={{ fontWeight: 600, whiteSpace: 'nowrap', textDecoration: item.excluded ? 'line-through' : 'none' }}>
                      ${item.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ opacity: 0.6, marginTop: '1rem' }}>No marketing spend rows found for this date range.</div>
          )}
        </div>

      </div>;
}
