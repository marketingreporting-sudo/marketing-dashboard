import React from 'react';
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  LineChart,
  Line,
} from 'recharts';
import { REPORTING_LAYOUT_URL } from './apiConfig';
import { authFetch } from './lib/authFetch';

const HeatmapAuditPanel = React.lazy(() => import('./HeatmapAuditPanel.jsx'));
const REPORTING_LAYOUT_STORAGE_KEY = 'reportingLayoutAdminEnabled';
const REPORTING_PANEL_LIBRARY = [
  { id: 'roi', title: 'ROAS Metrics', eyebrow: 'Revenue Efficiency' },
  { id: 'budget', title: 'Budget Tracking', eyebrow: 'Spend Control' },
  { id: 'entrata', title: 'Entrata Funnel', eyebrow: 'Leads to Leases' },
  { id: 'heatmaps-audit', title: 'Heatmaps + Site Audit', eyebrow: 'Website Experience' },
  { id: 'google-ads', title: 'Google Ads', eyebrow: 'Paid Search' },
  { id: 'ga4', title: 'Google Analytics', eyebrow: 'Behavior + Demand' },
  { id: 'opiniion', title: 'Opiniion', eyebrow: 'Resident Sentiment' },
  { id: 'local-falcon', title: 'Local Falcon', eyebrow: 'Local SEO' },
  { id: 'meta-ads', title: 'Meta Ads', eyebrow: 'Paid Social' }
];
const REPORTING_PANEL_IDS = REPORTING_PANEL_LIBRARY.map((panel) => panel.id);

const normalizeReportingLayoutRecord = (value) => {
  const order = Array.isArray(value?.panelOrder) ? value.panelOrder.map((item) => String(item)) : [];
  const hidden = Array.isArray(value?.hiddenPanelIds) ? value.hiddenPanelIds.map((item) => String(item)) : [];

  const uniqueOrder = order.filter((panelId, index) => REPORTING_PANEL_IDS.includes(panelId) && order.indexOf(panelId) === index);
  const normalizedOrder = [
    ...uniqueOrder,
    ...REPORTING_PANEL_IDS.filter((panelId) => !uniqueOrder.includes(panelId))
  ];

  return {
    panelOrder: normalizedOrder,
    hiddenPanelIds: hidden.filter((panelId, index) => REPORTING_PANEL_IDS.includes(panelId) && hidden.indexOf(panelId) === index)
  };
};

export default function ReportsView(props) {
  const {
    CHART_AXIS_LIGHT,
    CHART_AXIS_LIGHT_SOFT,
    CHART_COLOR_GOLD,
    CHART_COLOR_GREEN,
    CHART_COLOR_ORANGE,
    CHART_COLOR_TAN,
    CHART_GRID_LIGHT,
    CHART_MARGIN_STANDARD,
    CHART_TOOLTIP_ITEM_STYLE,
    CHART_TOOLTIP_LABEL_STYLE,
    CHART_TOOLTIP_STYLE,
    HEATMAP_DEVICE_OPTIONS,
    MeasuredChart,
    MiniMetricLoader,
    adjustedMarketingSpend,
    applicationConversion,
    applicationToLeaseConversion,
    attributedLeaseCount,
    blendedRoas,
    blendedRoi,
    canEditReportingLayout,
    clientReportLink,
    costPerLead,
    costPerLease,
    formatCurrency,
    formatDurationMs,
    formatNumber,
    formatPercent,
    formatSignedPercent,
    funnelMetricSource,
    ga4AcquisitionChannels,
    ga4ApplyPage,
    ga4Blocked,
    ga4EventTotal,
    ga4Loading,
    ga4NewUsers,
    ga4Sessions,
    ga4StatusMessage,
    getLocalFalconRankTone,
    getSnapshotTimestampLabel,
    googleAdsCampaigns,
    googleAdsLoading,
    googleAdsOverview,
    googleAdsStatusMessage,
    heatmapClickSignalTab,
    heatmapLayers,
    heatmapPagesData,
    heatmapPageOptions,
    heatmapPanelError,
    heatmapSummaryData,
    heatmapSummaryLoading,
    heatmapTotals,
    heatmapTrackerHealthData,
    heatmapTrackerHealthLoading,
    highlightedHeatmapTarget,
    invoiceLoading,
    isClientReportMode,
    leadStatusBreakdown,
    leaseConversion,
    loading,
    localFalconCompetitors,
    localFalconData,
    localFalconGridPoints,
    localFalconGridSize,
    localFalconHeatmapUrl,
    localFalconKeywords,
    localFalconLatestReport,
    localFalconLatestScan,
    localFalconLoading,
    localFalconLocation,
    localFalconMapImageUrl,
    localFalconOverview,
    localFalconPdfUrl,
    localFalconReportUrl,
    localFalconReports,
    localFalconStatusMessage,
    marketingSpendBreakdown,
    metaAdsCampaigns,
    metaAdsLoading,
    metaAdsOverview,
    metaAdsStatusMessage,
    rangeDates,
    renderMetricValue,
    reportingSourceBadge,
    reputationAverageRating,
    reputationLoading,
    reputationResponseRate,
    reputationReviewCount,
    reputationSentimentScore,
    reputationStatusMessage,
    reputationSummary,
    reputationWindow,
    roiLoading,
    roiPipelineStatus,
    roiPipelineStatusLoading,
    roiSourceBreakdown,
    roiTotals,
    runSiteAudit,
    screenshotPreviewError,
    screenshotPreviewLoading,
    screenshotPreviewUrl,
    selectedAuditPage,
    selectedHeatmapDevice,
    selectedHeatmapPath,
    selectedPropertyId,
    selectedPropertyLabel,
    selectedScreenshot,
    setHeatmapClickSignalTab,
    setHighlightedHeatmapTarget,
    setSelectedHeatmapDevice,
    setSelectedHeatmapPath,
    shortenLabel,
    siteAuditSummaryData,
    siteAuditLoading,
    siteAuditNotice,
    siteAuditRunning,
    toggleMarketingSpendLine,
    totalApplications,
    totalBlendedMarketingSpend,
    totalLeads,
    totalLeases,
    totalPerformanceMarketingCost,
    unattributedLeaseCount,
    updateHeatmapLayer,
  } = props;

  const reportingLayoutUsesStagedAdapter = Boolean(REPORTING_LAYOUT_URL);
  const [reportingLayoutLoading, setReportingLayoutLoading] = React.useState(true);
  const [reportingLayoutSaving, setReportingLayoutSaving] = React.useState(false);
  const [reportingLayoutError, setReportingLayoutError] = React.useState(null);
  const [reportingLayoutNotice, setReportingLayoutNotice] = React.useState(null);
  const [reportingLayoutDoc, setReportingLayoutDoc] = React.useState(() => normalizeReportingLayoutRecord(null));
  const [reportingLayoutDraft, setReportingLayoutDraft] = React.useState(() => normalizeReportingLayoutRecord(null));
  const [copiedClientReportLink, setCopiedClientReportLink] = React.useState(false);
  const [reportingAdminEnabled, setReportingAdminEnabled] = React.useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(REPORTING_LAYOUT_STORAGE_KEY) === 'true';
  });
  const reportingLayoutDirty = React.useMemo(
    () => JSON.stringify(reportingLayoutDraft) !== JSON.stringify(reportingLayoutDoc),
    [reportingLayoutDraft, reportingLayoutDoc]
  );
  const activeReportingPanels = React.useMemo(() => {
    const hiddenIds = new Set(reportingLayoutDraft.hiddenPanelIds);
    return reportingLayoutDraft.panelOrder
      .map((panelId) => REPORTING_PANEL_LIBRARY.find((panel) => panel.id === panelId))
      .filter(Boolean)
      .filter((panel) => !hiddenIds.has(panel.id));
  }, [reportingLayoutDraft]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(REPORTING_LAYOUT_STORAGE_KEY, reportingAdminEnabled ? 'true' : 'false');
  }, [reportingAdminEnabled]);

  React.useEffect(() => {
    if (!canEditReportingLayout && reportingAdminEnabled) {
      setReportingAdminEnabled(false);
    }
  }, [canEditReportingLayout, reportingAdminEnabled]);

  React.useEffect(() => {
    let cancelled = false;

    const loadReportingLayout = async () => {
      if (!selectedPropertyId) {
        const fallback = normalizeReportingLayoutRecord(null);
        setReportingLayoutDoc(fallback);
        setReportingLayoutDraft(fallback);
        setReportingLayoutError('No property is currently available for this account.');
        setReportingLayoutLoading(false);
        return;
      }

      if (!reportingLayoutUsesStagedAdapter) {
        const fallback = normalizeReportingLayoutRecord(null);
        setReportingLayoutDoc(fallback);
        setReportingLayoutDraft(fallback);
        setReportingLayoutError('Reporting layout endpoint is not configured.');
        setReportingLayoutLoading(false);
        return;
      }

      setReportingLayoutLoading(true);
      setReportingLayoutError(null);
      setReportingLayoutNotice(null);

      try {
        const params = new URLSearchParams({ property_id: selectedPropertyId });
        const response = await authFetch(`${REPORTING_LAYOUT_URL}?${params.toString()}`);
        const payload = await response.json();
        if (!response.ok || payload?.status === 'error') {
          throw new Error(payload?.error || `Reporting layout fetch failed: ${response.status}`);
        }

        if (cancelled) return;

        const normalized = normalizeReportingLayoutRecord(payload.record);
        setReportingLayoutDoc(normalized);
        setReportingLayoutDraft(normalized);
        setReportingLayoutLoading(false);
      } catch (error) {
        console.error('Reporting layout staged fetch failed', error);
        if (cancelled) return;
        const fallback = normalizeReportingLayoutRecord(null);
        setReportingLayoutDoc(fallback);
        setReportingLayoutDraft(fallback);
        setReportingLayoutError('Unable to load the saved reporting layout from the staged adapter.');
        setReportingLayoutLoading(false);
      }
    };

    loadReportingLayout();
    return () => {
      cancelled = true;
    };
  }, [reportingLayoutUsesStagedAdapter, selectedPropertyId]);

  const toggleReportingAdminMode = () => {
    if (!canEditReportingLayout) {
      setReportingLayoutError('Your current role can view reports, but cannot change reporting layout.');
      return;
    }
    setReportingLayoutNotice(null);
    setReportingLayoutError(null);
    setReportingAdminEnabled((current) => !current);
  };

  const moveReportingPanel = (panelId, direction) => {
    setReportingLayoutNotice(null);
    setReportingLayoutError(null);
    setReportingLayoutDraft((current) => {
      const currentIndex = current.panelOrder.indexOf(panelId);
      if (currentIndex === -1) return current;
      const nextIndex = currentIndex + direction;
      if (nextIndex < 0 || nextIndex >= current.panelOrder.length) return current;
      const nextOrder = [...current.panelOrder];
      const [moved] = nextOrder.splice(currentIndex, 1);
      nextOrder.splice(nextIndex, 0, moved);
      return {
        ...current,
        panelOrder: nextOrder
      };
    });
  };

  const toggleReportingPanelVisibility = (panelId) => {
    setReportingLayoutNotice(null);
    setReportingLayoutError(null);
    setReportingLayoutDraft((current) => {
      const hidden = new Set(current.hiddenPanelIds);
      if (hidden.has(panelId)) hidden.delete(panelId);
      else hidden.add(panelId);
      return {
        ...current,
        hiddenPanelIds: REPORTING_PANEL_IDS.filter((id) => hidden.has(id))
      };
    });
  };

  const resetReportingLayoutDraft = () => {
    setReportingLayoutDraft(reportingLayoutDoc);
    setReportingLayoutNotice('Unsaved reporting layout changes were discarded.');
    setReportingLayoutError(null);
  };

  const saveReportingLayoutDraft = async () => {
    if (!selectedPropertyId) {
      setReportingLayoutError('No property is currently available for this account.');
      return;
    }
    if (!canEditReportingLayout) {
      setReportingLayoutError('Your current role can view reporting, but cannot change panel layout.');
      return;
    }

    setReportingLayoutSaving(true);
    setReportingLayoutError(null);
    setReportingLayoutNotice(null);

    try {
      if (!reportingLayoutUsesStagedAdapter) {
        throw new Error('Reporting layout endpoint is not configured.');
      }
      const normalizedDraft = normalizeReportingLayoutRecord(reportingLayoutDraft);
      const response = await authFetch(REPORTING_LAYOUT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          property_id: selectedPropertyId,
          propertyId: selectedPropertyId,
          propertyName: selectedPropertyLabel || '',
          ...normalizedDraft,
        }),
      });
      const payload = await response.json();
      if (!response.ok || payload?.status === 'error') {
        throw new Error(payload?.error || `Reporting layout save failed: ${response.status}`);
      }
      const savedRecord = normalizeReportingLayoutRecord(payload.record);
      setReportingLayoutDoc(savedRecord);
      setReportingLayoutDraft(savedRecord);
      setReportingLayoutNotice('Reporting layout saved for this property.');
    } catch (error) {
      console.error('Reporting layout save failed', error);
      setReportingLayoutError(error.message || 'Unable to save the reporting layout.');
    } finally {
      setReportingLayoutSaving(false);
    }
  };

  const scrollToReportingPanel = (panelId) => {
    const target = document.getElementById(`reporting-panel-${panelId}`);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const copyClientReportLink = async () => {
    if (!clientReportLink) return;

    try {
      await navigator.clipboard.writeText(clientReportLink);
      setCopiedClientReportLink(true);
      window.setTimeout(() => setCopiedClientReportLink(false), 1800);
    } catch {
      setReportingLayoutError('Unable to copy the client report link. Select the link text and copy it manually.');
    }
  };

  const activeMarketingSpendLineCount = React.useMemo(() => (
    marketingSpendBreakdown.filter((item) => !item.excluded).length
  ), [marketingSpendBreakdown]);
  const localFalconTrendChartData = React.useMemo(() => {
    const toMetric = (value) => {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : null;
    };
    const rows = (Array.isArray(localFalconData?.Trends) ? localFalconData.Trends : [])
      .map((item) => ({
        label: String(item.label || item.date || '').slice(0, 10),
        keyword: item.keyword || '',
        arp: toMetric(item.arp),
        atrp: toMetric(item.atrp),
        solv: toMetric(item.solv),
      }))
      .filter((item) => item.label && [item.arp, item.atrp, item.solv].some((value) => value !== null));
    const labelCounts = rows.reduce((counts, item) => {
      counts[item.label] = (counts[item.label] || 0) + 1;
      return counts;
    }, {});
    return rows.map((item) => ({
      ...item,
      name: labelCounts[item.label] > 1 && item.keyword ? `${item.label} ${shortenLabel(item.keyword, 14)}` : item.label,
    }));
  }, [localFalconData, shortenLabel]);
  const formatPipelineTimestamp = (value) => {
    if (!value) return '-';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return String(value);
    return parsed.toLocaleString();
  };
  const renderPipelineStatusCard = (title, status) => {
    const progress = status?.progress || {};
    const phase = status?.phase || 'unknown';
    const isComplete = Boolean(status?.completed);
    const isActive = Boolean(status?.active);

    const progressRows = [];
    if (progress.raw_days_total) {
      progressRows.push(`Raw days: ${progress.raw_days_processed}/${progress.raw_days_total}`);
    }
    if (progress.attribution_properties_total) {
      progressRows.push(`Attribution props: ${progress.attribution_properties_processed}/${progress.attribution_properties_total}`);
    }
    if (progress.aggregate_properties_total) {
      progressRows.push(`Aggregate props: ${progress.aggregate_properties_processed}/${progress.aggregate_properties_total}`);
    }

    return (
      <div className="card span-2" style={{ background: 'var(--panel-soft)', color: 'var(--white)' }}>
        <div className="card-title" style={{ color: 'var(--primary-tan)', fontWeight: 'bold' }}>{title}</div>
        {roiPipelineStatusLoading ? (
          <div style={{ marginTop: '1rem', opacity: 0.6 }}>Loading pipeline status...</div>
        ) : !status ? (
          <div style={{ marginTop: '1rem', opacity: 0.6 }}>No pipeline status available.</div>
        ) : (
          <div style={{ marginTop: '0.85rem', display: 'grid', gap: '0.45rem', fontSize: '0.88rem' }}>
            <div><strong>Status:</strong> {isComplete ? 'Completed' : isActive ? 'Active' : 'Idle'}</div>
            <div><strong>Phase:</strong> {phase}</div>
            <div><strong>Window:</strong> {status.report_start_date || '-'} to {status.report_end_date || '-'}</div>
            <div><strong>Last update:</strong> {formatPipelineTimestamp(status.last_processed_at)}</div>
            {progressRows.map((row) => (
              <div key={row}>{row}</div>
            ))}
            <div style={{ opacity: 0.75 }}><strong>Summary:</strong> {status.last_summary || '-'}</div>
          </div>
        )}
      </div>
    );
  };
  const reportingPanelSummaries = React.useMemo(() => ({
    executive: `${formatCurrency(roiTotals.netEffectiveRevenue)} net revenue | ${formatCurrency(totalBlendedMarketingSpend)} spend`,
    roi: blendedRoi != null ? `${(blendedRoi * 100).toFixed(0)}% ROI | ${blendedRoas != null ? `${blendedRoas.toFixed(2)}x ROAS` : 'ROAS pending'}` : 'Waiting on spend and revenue data',
    budget: `${activeMarketingSpendLineCount} active spend lines | ${formatCurrency(totalPerformanceMarketingCost)} paid media`,
    entrata: `${totalLeads} leads | ${totalApplications} apps | ${totalLeases} leases`,
    'google-ads': googleAdsLoading ? 'Loading paid search metrics' : googleAdsStatusMessage ? 'Google Ads connection needs attention' : `${formatNumber(googleAdsOverview?.clicks)} clicks | ${formatCurrency(googleAdsOverview?.cost)} spend`,
    ga4: ga4Loading ? 'Loading analytics metrics' : ga4Blocked ? 'GA4 access required' : `${formatNumber(ga4Sessions)} sessions | ${formatNumber(ga4EventTotal)} tracked events`,
    opiniion: reputationLoading ? 'Loading reputation metrics' : `${formatNumber(reputationReviewCount)} reviews | ${formatNumber(reputationAverageRating, 2)} avg rating`,
    'local-falcon': localFalconLoading ? 'Loading local SEO metrics' : localFalconStatusMessage ? 'Local Falcon mapping needed' : `${formatNumber(localFalconOverview?.avgSolv, 2)} SoLV | ${formatNumber(localFalconOverview?.scanCount)} scans`,
    'meta-ads': metaAdsLoading ? 'Loading paid social metrics' : `${formatNumber(metaAdsOverview?.clicks)} clicks | ${formatCurrency(metaAdsOverview?.spend)} spend`,
    'heatmaps-audit': heatmapSummaryLoading ? 'Loading website experience data' : `${formatNumber(heatmapTotals.sessions)} sessions | ${formatNumber(heatmapTotals.clicks)} clicks`
  }), [
    activeMarketingSpendLineCount,
    blendedRoi,
    blendedRoas,
    formatCurrency,
    formatNumber,
    ga4Blocked,
    ga4EventTotal,
    ga4Loading,
    ga4Sessions,
    googleAdsLoading,
    googleAdsOverview,
    googleAdsStatusMessage,
    heatmapSummaryLoading,
    heatmapTotals.clicks,
    heatmapTotals.sessions,
    localFalconLoading,
    localFalconOverview,
    localFalconStatusMessage,
    metaAdsLoading,
    metaAdsOverview,
    reputationAverageRating,
    reputationLoading,
    reputationReviewCount,
    roiTotals.netEffectiveRevenue,
    totalApplications,
    totalBlendedMarketingSpend,
    totalLeads,
    totalLeases,
    totalPerformanceMarketingCost,
  ]);



  return <div className="reports-view">
        <div className="reports-shell">
          <div className="reports-hero">
            <div>
              <div className="reports-kicker">Reporting Workspace</div>
              <div className="reports-headline">{selectedPropertyLabel}</div>
              <div className="reports-subhead">
                A property-filtered reporting dashboard for asset managers that combines revenue efficiency, budget, funnel, paid media, analytics, and reputation into one configurable view.
              </div>
            </div>
            <div className="reports-chip-row">
              <div className="reports-chip">Entrata {selectedPropertyId}</div>
              <div className="reports-chip">{rangeDates.start.toLocaleDateString()} - {rangeDates.end.toLocaleDateString()}</div>
              <div className="reports-chip">{activeReportingPanels.length} live panels</div>
              <div className={reportingSourceBadge.className}>{reportingSourceBadge.label}</div>
              {!isClientReportMode && canEditReportingLayout && clientReportLink && (
                <button
                  type="button"
                  className="reports-admin-toggle"
                  onClick={copyClientReportLink}
                  title={clientReportLink}
                >
                  {copiedClientReportLink ? 'Copied Report Link' : 'Copy Client Report Link'}
                </button>
              )}
              {canEditReportingLayout && (
                <button type="button" className={`reports-admin-toggle ${reportingAdminEnabled ? 'active' : ''}`} onClick={toggleReportingAdminMode}>
                  {reportingAdminEnabled ? 'Exit Admin Layout' : 'Admin Layout Mode'}
                </button>
              )}
            </div>
          </div>

          <div className="reports-kpi-grid">
            <div className="reports-kpi-card">
              <div className="reports-kpi-card__label">Total Leads</div>
              <div className="reports-kpi-card__value">{renderMetricValue(loading, formatNumber(totalLeads))}</div>
              <div className="reports-kpi-card__meta">Apps {formatNumber(totalApplications)} | Leases {formatNumber(totalLeases)}</div>
            </div>
            <div className="reports-kpi-card">
              <div className="reports-kpi-card__label">Applications Completed</div>
              <div className="reports-kpi-card__value">{renderMetricValue(loading, formatNumber(totalApplications))}</div>
              <div className="reports-kpi-card__meta">Lead-to-completed-app {applicationConversion}% | {funnelMetricSource}</div>
            </div>
            <div className="reports-kpi-card">
              <div className="reports-kpi-card__label">Leases Approved</div>
              <div className="reports-kpi-card__value">{renderMetricValue(loading, formatNumber(totalLeases))}</div>
              <div className="reports-kpi-card__meta">App-to-approved-lease {applicationToLeaseConversion}% | Lead-to-lease {leaseConversion}%</div>
            </div>
            <div className="reports-kpi-card">
              <div className="reports-kpi-card__label">Marketing Cost</div>
              <div className="reports-kpi-card__value">{renderMetricValue(loading || invoiceLoading, totalBlendedMarketingSpend > 0 ? formatCurrency(totalBlendedMarketingSpend) : 'No data')}</div>
              <div className="reports-kpi-card__meta">Marketing spend {adjustedMarketingSpend > 0 ? formatCurrency(adjustedMarketingSpend) : '—'} | CPL {costPerLead !== '—' ? formatCurrency(costPerLead, 2) : '—'}</div>
            </div>
            <div className="reports-kpi-card">
              <div className="reports-kpi-card__label">Lead-to-Lease Conversion</div>
              <div className="reports-kpi-card__value">{renderMetricValue(loading, `${leaseConversion}%`)}</div>
              <div className="reports-kpi-card__meta">Leads {formatNumber(totalLeads)} | Leases {formatNumber(totalLeases)}</div>
            </div>
            <div className="reports-kpi-card">
              <div className="reports-kpi-card__label">Cost Per Lead</div>
              <div className="reports-kpi-card__value">{renderMetricValue(loading || invoiceLoading, costPerLead !== '—' ? formatCurrency(costPerLead, 2) : 'No spend')}</div>
              <div className="reports-kpi-card__meta">Leads {formatNumber(totalLeads)} | Marketing spend {adjustedMarketingSpend > 0 ? formatCurrency(adjustedMarketingSpend) : '—'}</div>
            </div>
            <div className="reports-kpi-card">
              <div className="reports-kpi-card__label">Cost Per Lease</div>
              <div className="reports-kpi-card__value">{renderMetricValue(roiLoading || invoiceLoading, costPerLease !== '—' ? formatCurrency(costPerLease, 2) : 'No spend')}</div>
              <div className="reports-kpi-card__meta">ROI {blendedRoi != null ? `${(blendedRoi * 100).toFixed(0)}%` : '—'} | Leases {formatNumber(totalLeases)}</div>
            </div>
            <div className="reports-kpi-card">
              <div className="reports-kpi-card__label">ROAS</div>
              <div className="reports-kpi-card__value">{renderMetricValue(roiLoading || invoiceLoading, blendedRoas != null ? `${blendedRoas.toFixed(2)}x` : 'No spend')}</div>
              <div className="reports-kpi-card__meta">Net revenue {roiTotals.netEffectiveRevenue > 0 ? formatCurrency(roiTotals.netEffectiveRevenue) : '—'} | Spend {adjustedMarketingSpend > 0 ? formatCurrency(adjustedMarketingSpend) : '—'}</div>
            </div>
          </div>

          <div className="reports-workspace">
            {!isClientReportMode && (
              <aside className="reports-minimap">
                <div className="reports-minimap__header">
                  <div>
                    <div className="reports-minimap__eyebrow">Mini-Map</div>
                    <div className="reports-minimap__title">Jump between reporting panels</div>
                  </div>
                </div>
                <div className="reports-minimap__list">
                  {reportingLayoutDraft.panelOrder.map((panelId, index) => {
                    const panel = REPORTING_PANEL_LIBRARY.find((item) => item.id === panelId);
                    const isHidden = reportingLayoutDraft.hiddenPanelIds.includes(panelId);
                    if (!panel) return null;

                    return (
                      <div key={panelId} className={`reports-minimap__item ${isHidden ? 'is-hidden' : ''}`}>
                        <button type="button" className="reports-minimap__jump" onClick={() => scrollToReportingPanel(panelId)} disabled={isHidden}>
                          <span className="reports-minimap__index">{String(index + 1).padStart(2, '0')}</span>
                          <span>
                            <strong>{panel.title}</strong>
                            <small>{reportingPanelSummaries[panelId]}</small>
                          </span>
                        </button>
                        {reportingAdminEnabled && (
                          <div className="reports-minimap__actions">
                            <button type="button" onClick={() => moveReportingPanel(panelId, -1)} disabled={index === 0}>Up</button>
                            <button type="button" onClick={() => moveReportingPanel(panelId, 1)} disabled={index === reportingLayoutDraft.panelOrder.length - 1}>Down</button>
                            <button type="button" onClick={() => toggleReportingPanelVisibility(panelId)}>
                              {isHidden ? 'Show' : 'Hide'}
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="reports-minimap__footer">
                  {reportingLayoutLoading && <div className="reports-layout-message">Loading saved layout…</div>}
                  {reportingLayoutError && <div className="reports-layout-message reports-layout-message--error">{reportingLayoutError}</div>}
                  {reportingLayoutNotice && <div className="reports-layout-message reports-layout-message--success">{reportingLayoutNotice}</div>}
                  {reportingAdminEnabled && (
                    <div className="reports-admin-actions">
                      <button type="button" onClick={resetReportingLayoutDraft} disabled={!reportingLayoutDirty || reportingLayoutSaving}>Reset</button>
                      <button type="button" onClick={saveReportingLayoutDraft} disabled={!reportingLayoutDirty || reportingLayoutSaving}>
                        {reportingLayoutSaving ? 'Saving…' : 'Save Layout'}
                      </button>
                    </div>
                  )}
                  {!reportingAdminEnabled && (
                    <div className="reports-layout-hint">
                      {canEditReportingLayout
                        ? 'Admin layout mode unlocks per-property panel ordering and hide/show controls.'
                        : 'This account can review reporting, but layout changes are reserved for roles with reporting admin access.'}
                    </div>
                  )}
                </div>
              </aside>
            )}

            <div className="reports-panels">
              {activeReportingPanels.some((panel) => panel.id === 'roi') && (
                <section id="reporting-panel-roi" className="reports-panel">
                  <div className="reports-panel__eyebrow">Revenue Efficiency</div>
                  <div className="reports-panel__title">ROAS Metrics</div>
                  <div className="reports-panel__grid reports-panel__grid--three">
                    <div className="reports-stat"><span>Net Effective Revenue</span><strong>{formatCurrency(roiTotals.netEffectiveRevenue)}</strong><small>{formatCurrency(roiTotals.grossLeaseValue)} gross lease value</small></div>
                    <div className="reports-stat"><span>Blended ROAS</span><strong>{blendedRoas != null ? `${blendedRoas.toFixed(2)}x` : '—'}</strong><small>{formatCurrency(adjustedMarketingSpend)} adjusted spend</small></div>
                    <div className="reports-stat"><span>Cost Per Lease</span><strong>{costPerLease !== '—' ? formatCurrency(costPerLease) : '—'}</strong><small>{formatCurrency(adjustedMarketingSpend)} adjusted spend</small></div>
                  </div>
                  <div className="reports-list">
                    {roiSourceBreakdown.slice(0, 5).map((item) => (
                      <div key={item.sourceKey} className="reports-list__row">
                        <div>
                          <strong>{item.sourceLabel}</strong>
                          <small>{item.attributedLeases} leases | {formatCurrency(item.marketingSpend)} spend</small>
                        </div>
                        <div>{item.roas != null ? `${item.roas.toFixed(2)}x ROAS` : 'No ROAS yet'}</div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {activeReportingPanels.some((panel) => panel.id === 'budget') && (
                <section id="reporting-panel-budget" className="reports-panel">
                  <div className="reports-panel__eyebrow">Spend Control</div>
                  <div className="reports-panel__title">Budget Tracking</div>
                  <div className="reports-panel__grid reports-panel__grid--three">
                    <div className="reports-stat"><span>Total Marketing</span><strong>{formatCurrency(totalBlendedMarketingSpend)}</strong><small>{activeMarketingSpendLineCount} active marketing GL lines</small></div>
                    <div className="reports-stat"><span>Performance Marketing</span><strong>{formatCurrency(totalPerformanceMarketingCost)}</strong><small>Paid media + PPC management</small></div>
                    <div className="reports-stat"><span>Tracked Cost Lines</span><strong>{formatNumber(activeMarketingSpendLineCount)}</strong><small>{marketingSpendBreakdown.length - activeMarketingSpendLineCount} excluded from totals</small></div>
                  </div>
                  <div className="reports-list">
                    {marketingSpendBreakdown.slice(0, 6).map((item) => (
                      <div key={item.label} className={`reports-list__row marketing-spend-report-row ${item.excluded ? 'is-excluded' : ''}`}>
                        <div>
                          <strong>{item.label}</strong>
                          <small>{item.excluded ? 'Excluded from selected reporting window totals' : 'Included in selected reporting window totals'}</small>
                        </div>
                        <div className="marketing-spend-report-row__actions">
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
                          <div>{formatCurrency(item.amount)}</div>
                        </div>
                      </div>
                    ))}
                    {marketingSpendBreakdown.length === 0 && <div className="reports-empty">No marketing spend rows matched this date range.</div>}
                  </div>
                </section>
              )}

              {activeReportingPanels.some((panel) => panel.id === 'entrata') && (
                <section id="reporting-panel-entrata" className="reports-panel">
                  <div className="reports-panel__eyebrow">Leads to Leases</div>
                  <div className="reports-panel__title">Entrata Funnel</div>
                  <div className="reports-panel__grid reports-panel__grid--three">
                    <div className="reports-stat"><span>Lead to App</span><strong>{applicationConversion}%</strong><small>{formatNumber(totalApplications)} applications</small></div>
                    <div className="reports-stat"><span>App to Lease</span><strong>{applicationToLeaseConversion}%</strong><small>{formatNumber(totalLeases)} leases</small></div>
                    <div className="reports-stat"><span>Lead to Lease</span><strong>{leaseConversion}%</strong><small>{attributedLeaseCount} attributed | {unattributedLeaseCount} unattributed</small></div>
                  </div>
                  <div className="reports-list">
                    {Object.entries(leadStatusBreakdown).slice(0, 6).map(([status, count]) => (
                      <div key={status} className="reports-list__row">
                        <div>
                          <strong>{status}</strong>
                          <small>Current lead status count in scope</small>
                        </div>
                        <div>{formatNumber(count)}</div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {activeReportingPanels.some((panel) => panel.id === 'heatmaps-audit') && (
                <React.Suspense fallback={<div className="reports-empty">Loading heatmap audit...</div>}>
                  <HeatmapAuditPanel
                    {...{
                      HEATMAP_DEVICE_OPTIONS,
                      MiniMetricLoader,
                      formatDurationMs,
                      formatNumber,
                      getSnapshotTimestampLabel,
                      heatmapClickSignalTab,
                      heatmapLayers,
                      heatmapPagesData,
                      heatmapPageOptions,
                      heatmapPanelError,
                      heatmapSummaryData,
                      heatmapSummaryLoading,
                      heatmapTotals,
                      heatmapTrackerHealthData,
                      heatmapTrackerHealthLoading,
                      highlightedHeatmapTarget,
                      renderMetricValue,
                      reportingAdminEnabled,
                      runSiteAudit,
                      screenshotPreviewError,
                      screenshotPreviewLoading,
                      screenshotPreviewUrl,
                      selectedAuditPage,
                      selectedHeatmapDevice,
                      selectedHeatmapPath,
                      selectedScreenshot,
                      setHeatmapClickSignalTab,
                      setHighlightedHeatmapTarget,
                      setSelectedHeatmapDevice,
                      setSelectedHeatmapPath,
                      siteAuditSummaryData,
                      siteAuditLoading,
                      siteAuditNotice,
                      siteAuditRunning,
                      updateHeatmapLayer,
                    }}
                  />
                </React.Suspense>
              )}

              {activeReportingPanels.some((panel) => panel.id === 'google-ads') && (
                <section id="reporting-panel-google-ads" className="reports-panel">
                  <div className="reports-panel__eyebrow">Paid Search</div>
                  <div className="reports-panel__title">Google Ads Metrics</div>
                  <div className="reports-panel__grid reports-panel__grid--three">
                    <div className="reports-stat"><span>Clicks</span><strong>{renderMetricValue(googleAdsLoading, formatNumber(googleAdsOverview?.clicks))}</strong><small>{googleAdsLoading ? 'Loading...' : formatNumber(googleAdsOverview?.impressions)} impressions</small></div>
                    <div className="reports-stat"><span>Spend</span><strong>{renderMetricValue(googleAdsLoading, formatCurrency(googleAdsOverview?.cost))}</strong><small>{googleAdsLoading ? 'Loading...' : formatNumber(googleAdsOverview?.conversions, 1)} conversions</small></div>
                    <div className="reports-stat"><span>CTR</span><strong>{renderMetricValue(googleAdsLoading, formatPercent(googleAdsOverview?.ctr, 1))}</strong><small>{googleAdsStatusMessage || 'Live paid search view'}</small></div>
                  </div>
                  <div className="reports-list">
                    {googleAdsCampaigns.slice(0, 5).map((item) => (
                      <div key={item.campaignName} className="reports-list__row">
                        <div>
                          <strong>{item.campaignName}</strong>
                          <small>{formatCurrency(item.current.cost)} spend | {formatNumber(item.current.conversions, 1)} conversions</small>
                        </div>
                        <div>{formatNumber(item.current.clicks)} clicks</div>
                      </div>
                    ))}
                    {googleAdsCampaigns.length === 0 && <div className="reports-empty">{googleAdsStatusMessage || 'No Google Ads campaign data is available for this property.'}</div>}
                  </div>
                </section>
              )}

              {activeReportingPanels.some((panel) => panel.id === 'ga4') && (
                <section id="reporting-panel-ga4" className="reports-panel">
                  <div className="reports-panel__eyebrow">Behavior + Demand</div>
                  <div className="reports-panel__title">Google Analytics Metrics</div>
                  <div className="reports-panel__grid reports-panel__grid--three">
                    <div className="reports-stat"><span>Sessions</span><strong>{renderMetricValue(ga4Loading, ga4Blocked ? 'Locked' : formatNumber(ga4Sessions))}</strong><small>{ga4Loading ? 'Loading...' : ga4Blocked ? ga4StatusMessage : `${formatNumber(ga4NewUsers)} new users`}</small></div>
                    <div className="reports-stat"><span>Tracked Events</span><strong>{renderMetricValue(ga4Loading, ga4Blocked ? 'Locked' : formatNumber(ga4EventTotal))}</strong><small>{ga4Loading ? 'Loading...' : ga4Blocked ? 'Access required' : formatPercent(ga4ApplyPage?.abandonmentRate, 1)} apply drop-off</small></div>
                    <div className="reports-stat"><span>Top Channel</span><strong>{ga4AcquisitionChannels[0]?.channel || '—'}</strong><small>{ga4StatusMessage || 'Top GA4 acquisition channel in range'}</small></div>
                  </div>
                  <div className="reports-list">
                    {ga4AcquisitionChannels.slice(0, 5).map((item) => (
                      <div key={item.channel} className="reports-list__row">
                        <div>
                          <strong>{item.channel}</strong>
                          <small>{formatPercent(item.current.engagementRate, 1)} engagement | {formatSignedPercent(item.delta.sessions, 1)} vs prior</small>
                        </div>
                        <div>{formatNumber(item.current.sessions)} sessions</div>
                      </div>
                    ))}
                    {ga4AcquisitionChannels.length === 0 && <div className="reports-empty">{ga4StatusMessage || 'No GA4 acquisition data is available for this property.'}</div>}
                  </div>
                </section>
              )}

              {activeReportingPanels.some((panel) => panel.id === 'opiniion') && (
                <section id="reporting-panel-opiniion" className="reports-panel">
                  <div className="reports-panel__eyebrow">Resident Sentiment</div>
                  <div className="reports-panel__title">Opiniion Metrics</div>
                  <div className="reports-panel__grid reports-panel__grid--three">
                    <div className="reports-stat"><span>Average Rating</span><strong>{renderMetricValue(reputationLoading, formatNumber(reputationAverageRating, 2))}</strong><small>{reputationLoading ? 'Loading...' : formatNumber(reputationReviewCount)} reviews</small></div>
                    <div className="reports-stat"><span>Response Rate</span><strong>{renderMetricValue(reputationLoading, formatPercent(reputationResponseRate, 1))}</strong><small>{reputationStatusMessage || 'Latest Opiniion response coverage'}</small></div>
                    <div className="reports-stat"><span>Sentiment Score</span><strong>{renderMetricValue(reputationLoading, formatNumber(reputationSentimentScore, 1))}</strong><small>{reputationWindow?.start_date || 'Current window'} to {reputationWindow?.end_date || 'today'}</small></div>
                  </div>
                  <div className="reports-list">
                    {reputationSummary.slice(0, 5).map((item, index) => (
                      <div key={`${item.label || 'summary'}-${index}`} className="reports-list__row">
                        <div>
                          <strong>{item.label || 'Summary point'}</strong>
                          <small>{item.detail || 'Reputation summary insight'}</small>
                        </div>
                        <div>{item.value || '—'}</div>
                      </div>
                    ))}
                    {reputationSummary.length === 0 && <div className="reports-empty">{reputationStatusMessage || 'No Opiniion summary metrics are available for this property.'}</div>}
                  </div>
                </section>
              )}

              {activeReportingPanels.some((panel) => panel.id === 'local-falcon') && (
                <section id="reporting-panel-local-falcon" className="reports-panel">
                  <div className="reports-panel__eyebrow">Local SEO</div>
                  <div className="reports-panel__title">Local Falcon Metrics</div>
                  <div className="reports-panel__grid reports-panel__grid--three">
                    <div className="reports-stat"><span>Share of Local Voice</span><strong>{renderMetricValue(localFalconLoading, formatNumber(localFalconOverview?.avgSolv, 2))}</strong><small>{localFalconLoading ? 'Loading...' : `${formatNumber(localFalconOverview?.scanCount)} scans in range`}</small></div>
                    <div className="reports-stat"><span>Average Rank</span><strong>{renderMetricValue(localFalconLoading, formatNumber(localFalconOverview?.avgArp, 2))}</strong><small>{localFalconLoading ? 'Loading...' : `${formatNumber(localFalconOverview?.keywordCount)} tracked keywords`}</small></div>
                    <div className="reports-stat"><span>Top Rank Position</span><strong>{renderMetricValue(localFalconLoading, formatNumber(localFalconOverview?.avgAtrp, 2))}</strong><small>{localFalconStatusMessage || localFalconOverview?.lastRunDate || localFalconData?.Status?.message || 'Latest Local Falcon scan set'}</small></div>
                  </div>
                  <div className="reports-panel__grid reports-panel__grid--three" style={{ marginTop: '0.9rem' }}>
                    <div className="reports-stat"><span>Found In</span><strong>{renderMetricValue(localFalconLoading, `${formatNumber(localFalconOverview?.foundInPercent, 1)}%`)}</strong><small>{formatNumber(localFalconOverview?.foundIn)} of {formatNumber(localFalconOverview?.points)} grid points</small></div>
                    <div className="reports-stat"><span>Latest Keyword</span><strong>{renderMetricValue(localFalconLoading, shortenLabel(localFalconLatestScan?.keyword || localFalconLatestReport?.keyword || '—', 28))}</strong><small>{localFalconLatestScan?.date || localFalconOverview?.lastRunDate || 'Latest scan date pending'}</small></div>
                    <div className="reports-stat"><span>Grid</span><strong>{renderMetricValue(localFalconLoading, `${formatNumber(localFalconGridSize)}x${formatNumber(localFalconGridSize)}`)}</strong><small>{localFalconLatestScan?.radius ? `${localFalconLatestScan.radius}${localFalconLatestScan.measurement || ''} radius` : 'Grid radius pending'}</small></div>
                  </div>

                  {(localFalconReportUrl || localFalconPdfUrl) && (
                    <div className="local-falcon-report-card">
                      <div className="local-falcon-report-card__content">
                        <div className="reports-panel__eyebrow">Latest Scan Detail</div>
                        <div className="reports-list">
                          <div className="reports-list__row"><div><strong>{localFalconLatestScan?.keyword || localFalconLatestReport?.keyword || 'Latest Local Falcon scan'}</strong><small>{localFalconLatestScan?.date || localFalconOverview?.lastRunDate || 'Scan date pending'}</small></div><div>{formatNumber(localFalconOverview?.avgSolv, 2)} SoLV</div></div>
                          <div className="reports-list__row"><div><strong>{localFalconLocation?.match?.name || localFalconLocation?.name || 'Matched Local Falcon location'}</strong><small>{localFalconLocation?.placeId || 'Place ID pending'}</small></div><div>{formatNumber(localFalconCompetitors.length)} competitors</div></div>
                        </div>
                        <div className="local-falcon-report-card__actions">
                          {localFalconReportUrl && <a href={localFalconReportUrl} target="_blank" rel="noreferrer">Open Report</a>}
                          {localFalconPdfUrl && <a href={localFalconPdfUrl} target="_blank" rel="noreferrer">PDF</a>}
                        </div>
                      </div>
                    </div>
                  )}

                  {localFalconGridPoints.length > 0 && (
                    <div className="local-falcon-section">
                      <div className="reports-panel__eyebrow">Grid Rank Map</div>
                      <div
                        className={`local-falcon-grid-map ${localFalconMapImageUrl ? 'local-falcon-grid-map--with-image' : ''}`}
                        style={localFalconMapImageUrl ? { backgroundImage: `url(${localFalconMapImageUrl})` } : undefined}
                      >
                        <div className="local-falcon-grid-map__shade" />
                        <div className="local-falcon-grid" style={{ gridTemplateColumns: `repeat(${Math.max(localFalconGridSize, 1)}, minmax(0, 1fr))` }}>
                          {localFalconGridPoints.map((point) => (
                            <div key={point.index} className={`local-falcon-grid__cell local-falcon-grid__cell--${getLocalFalconRankTone(point.rank)}`}>
                              <strong>{point.rankLabel}</strong>
                              <small>{formatNumber(point.resultCount)} results</small>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="local-falcon-grid-legend">
                        <span><i className="local-falcon-grid-legend__dot local-falcon-grid-legend__dot--strong" /> 1-3 strong</span>
                        <span><i className="local-falcon-grid-legend__dot local-falcon-grid-legend__dot--moderate" /> 4-10 moderate</span>
                        <span><i className="local-falcon-grid-legend__dot local-falcon-grid-legend__dot--weak" /> 11-20 weak</span>
                        <span><i className="local-falcon-grid-legend__dot local-falcon-grid-legend__dot--missing" /> 20+ missing</span>
                      </div>
                    </div>
                  )}

                  {localFalconTrendChartData.length > 1 && (
                    <div className="local-falcon-section">
                      <div className="reports-panel__eyebrow">Ranking Trend</div>
                      <MeasuredChart className="analytics-chart analytics-chart--compact">
                        {({ width, height }) => (
                          <LineChart width={width} height={height} data={localFalconTrendChartData} margin={CHART_MARGIN_STANDARD}>
                            <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_LIGHT} vertical={false} />
                            <XAxis dataKey="name" stroke={CHART_AXIS_LIGHT} tick={{ fontSize: 11, fill: CHART_COLOR_TAN }} />
                            <YAxis yAxisId="rank" stroke={CHART_AXIS_LIGHT_SOFT} tick={{ fontSize: 11, fill: CHART_COLOR_TAN }} reversed />
                            <YAxis yAxisId="solv" orientation="right" stroke={CHART_AXIS_LIGHT_SOFT} tick={{ fontSize: 11, fill: CHART_COLOR_TAN }} />
                            <Tooltip contentStyle={CHART_TOOLTIP_STYLE} labelStyle={CHART_TOOLTIP_LABEL_STYLE} itemStyle={CHART_TOOLTIP_ITEM_STYLE} />
                            <Line yAxisId="rank" type="monotone" dataKey="arp" name="ARP" stroke={CHART_COLOR_GOLD} strokeWidth={2} dot={{ r: 2, fill: CHART_COLOR_GOLD }} />
                            <Line yAxisId="rank" type="monotone" dataKey="atrp" name="ATRP" stroke={CHART_COLOR_ORANGE} strokeWidth={2} dot={{ r: 2, fill: CHART_COLOR_ORANGE }} />
                            <Line yAxisId="solv" type="monotone" dataKey="solv" name="SoLV" stroke={CHART_COLOR_GREEN} strokeWidth={2} dot={{ r: 2, fill: CHART_COLOR_GREEN }} />
                          </LineChart>
                        )}
                      </MeasuredChart>
                    </div>
                  )}

                  {localFalconCompetitors.length > 0 && (
                    <div className="local-falcon-section">
                      <div className="reports-panel__eyebrow">Competitor Comparison</div>
                      <div className="local-falcon-competitor-table">
                        <div className="local-falcon-competitor-table__head">Business</div>
                        <div className="local-falcon-competitor-table__head">ARP</div>
                        <div className="local-falcon-competitor-table__head">ATRP</div>
                        <div className="local-falcon-competitor-table__head">SoLV</div>
                        <div className="local-falcon-competitor-table__head">Found</div>
                        <div className="local-falcon-competitor-table__head">Rating</div>
                        {localFalconCompetitors.slice(0, 12).map((item) => (
                          <React.Fragment key={item.placeId || item.name}>
                            <div className="local-falcon-competitor-table__cell">
                              <strong>{item.name || 'Unnamed competitor'}{item.isTarget ? ' (Selected)' : ''}</strong>
                              <small>{item.address || item.placeId || 'Address unavailable'}</small>
                            </div>
                            <div className="local-falcon-competitor-table__cell">{formatNumber(item.arp, 2)}</div>
                            <div className="local-falcon-competitor-table__cell">{formatNumber(item.atrp, 2)}</div>
                            <div className="local-falcon-competitor-table__cell">{formatNumber(item.solv, 2)}</div>
                            <div className="local-falcon-competitor-table__cell">{formatNumber(item.foundIn)} pts</div>
                            <div className="local-falcon-competitor-table__cell">{item.rating != null ? `${formatNumber(item.rating, 1)} (${formatNumber(item.reviews)})` : '—'}</div>
                          </React.Fragment>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="reports-list">
                    {localFalconKeywords.slice(0, 5).map((item) => (
                      <div key={item.keyword || item.lastScanReportKey} className="reports-list__row">
                        <div>
                          <strong>{item.keyword || 'Tracked keyword'}</strong>
                          <small>SoLV {formatNumber(item.solv, 2)} | ARP {formatNumber(item.arp, 2)} | {formatNumber(item.scanCount)} scans</small>
                        </div>
                        <div>{formatNumber(item.solv, 2)} SoLV</div>
                      </div>
                    ))}
                    {localFalconKeywords.length === 0 && localFalconReports.slice(0, 5).map((item) => (
                      <div key={item.reportKey || item.keyword} className="reports-list__row">
                        <div>
                          <strong>{item.keyword || 'Local Falcon scan'}</strong>
                          <small>{item.date || 'Latest scan'} | {item.gridSize || 'Grid'} {item.radius ? `${item.radius}${item.measurement || ''}` : ''}</small>
                        </div>
                        <div>{formatNumber(item.solv, 2)} SoLV</div>
                      </div>
                    ))}
                    {localFalconKeywords.length === 0 && localFalconReports.length === 0 && <div className="reports-empty">{localFalconStatusMessage || 'No Local Falcon reports are available for this property and date range.'}</div>}
                  </div>
                  {(localFalconReportUrl || localFalconHeatmapUrl || localFalconPdfUrl || localFalconLocation?.placeId) && (
                    <div className="reports-list" style={{ marginTop: '0.9rem' }}>
                      <div className="reports-list__row">
                        <div>
                          <strong>{localFalconLocation?.match?.name || localFalconLocation?.name || 'Matched Local Falcon location'}</strong>
                          <small>{localFalconLocation?.placeId || 'Place ID pending'}</small>
                        </div>
                        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                          {localFalconReportUrl && <a href={localFalconReportUrl} target="_blank" rel="noreferrer">Open report</a>}
                          {localFalconHeatmapUrl && <a href={localFalconHeatmapUrl} target="_blank" rel="noreferrer">Heatmap</a>}
                          {localFalconPdfUrl && <a href={localFalconPdfUrl} target="_blank" rel="noreferrer">PDF</a>}
                        </div>
                      </div>
                    </div>
                  )}
                </section>
              )}

              {activeReportingPanels.some((panel) => panel.id === 'meta-ads') && (
                <section id="reporting-panel-meta-ads" className="reports-panel">
                  <div className="reports-panel__eyebrow">Paid Social</div>
                  <div className="reports-panel__title">Meta Ads Metrics</div>
                  <div className="reports-panel__grid reports-panel__grid--three">
                    <div className="reports-stat"><span>Clicks</span><strong>{renderMetricValue(metaAdsLoading, formatNumber(metaAdsOverview?.clicks))}</strong><small>{metaAdsLoading ? 'Loading...' : formatCurrency(metaAdsOverview?.spend)} spend</small></div>
                    <div className="reports-stat"><span>CTR</span><strong>{renderMetricValue(metaAdsLoading, formatPercent(metaAdsOverview?.ctr, 1))}</strong><small>{metaAdsLoading ? 'Loading...' : formatNumber(metaAdsOverview?.frequency, 2)} frequency</small></div>
                    <div className="reports-stat"><span>Results</span><strong>{renderMetricValue(metaAdsLoading, formatNumber(metaAdsOverview?.results, 1))}</strong><small>{metaAdsStatusMessage || `${metaAdsOverview?.resultLabel || 'Results'} in range`}</small></div>
                  </div>
                  <div className="reports-list">
                    {metaAdsCampaigns.slice(0, 5).map((item) => (
                      <div key={item.campaignName} className="reports-list__row">
                        <div>
                          <strong>{item.campaignName}</strong>
                          <small>{formatCurrency(item.current.spend)} spend | {formatPercent(item.current.ctr, 1)} CTR</small>
                        </div>
                        <div>{formatNumber(item.current.clicks)} clicks</div>
                      </div>
                    ))}
                    {metaAdsCampaigns.length === 0 && <div className="reports-empty">{metaAdsStatusMessage || 'No Meta Ads data is available for this property.'}</div>}
                  </div>
                </section>
              )}

              <div className="reports-pipeline-grid">
                {renderPipelineStatusCard('YTD ROI Backfill Status', roiPipelineStatus?.roi_ytd_backfill)}
                {renderPipelineStatusCard('Daily ROI Refresh Status', roiPipelineStatus?.roi_daily_refresh)}
              </div>
            </div>
          </div>
        </div>
      </div>;
}
