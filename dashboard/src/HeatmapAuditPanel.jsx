import React from 'react';
import HeatmapRenderer from './components/HeatmapRenderer';

export default function HeatmapAuditPanel(props) {
  const {
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
  } = props;

  const heatmapScrollSummary = heatmapSummaryData?.scroll || {};
  const heatmapScrollMilestones = heatmapScrollSummary.milestones || {};
  const heatmapScrollReach = heatmapScrollSummary.reach || heatmapScrollMilestones || {};
  const heatmapTopSections = Array.isArray(heatmapScrollSummary.topSections) ? heatmapScrollSummary.topSections : [];
  const heatmapBandDurations = heatmapScrollSummary.bandDurationsMs || {};
  const heatmapCursorSummary = heatmapSummaryData?.cursor || {};
  const heatmapTopAttentionAreas = Array.isArray(heatmapCursorSummary.topAttentionAreas) ? heatmapCursorSummary.topAttentionAreas : [];
  const topScrollBand = Object.entries(heatmapBandDurations)
    .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))[0] || null;
  const heatmapPoints = React.useMemo(() => (
    (heatmapSummaryData?.points || [])
      .filter((point) => !point.deviceType || point.deviceType === selectedHeatmapDevice)
  ), [heatmapSummaryData, selectedHeatmapDevice]);
  const heatmapCells = React.useMemo(() => (
    (heatmapSummaryData?.cells || [])
      .filter((cell) => !cell.deviceType || cell.deviceType === selectedHeatmapDevice)
  ), [heatmapSummaryData, selectedHeatmapDevice]);
  const heatmapCoordinateDiagnostics = React.useMemo(() => {
    const allPoints = Array.isArray(heatmapSummaryData?.points) ? heatmapSummaryData.points : [];
    const allCells = Array.isArray(heatmapSummaryData?.cells) ? heatmapSummaryData.cells : [];
    const selectedDevicePoints = allPoints.filter((point) => !point.deviceType || point.deviceType === selectedHeatmapDevice);
    const deviceMismatchCount = allPoints.length - selectedDevicePoints.length;
    const parseCoordinate = (value) => {
      if (value === null || value === undefined || value === '') return null;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    };
    const hasRendererCoordinate = (point) => {
      const xPct = parseCoordinate(point.xPct);
      const yPct = parseCoordinate(point.yPct);
      if (xPct === null || yPct === null) return false;
      if (xPct <= 0.001 && yPct <= 0.001 && !point.targetLabel && !point.targetHref) return false;
      return true;
    };
    const coordinateCount = selectedDevicePoints.filter((point) => point.xPct != null || point.yPct != null).length;
    const rendererAcceptedCount = selectedDevicePoints.filter(hasRendererCoordinate).length;
    const aggregateCoordinateCount = allCells.filter((cell) => cell.xPct != null && cell.yPct != null).length;
    return {
      rawEvents: Number(heatmapTotals.events || 0),
      withCoordinates: aggregateCoordinateCount || coordinateCount,
      rejectedFromRenderer: Math.max(0, coordinateCount - rendererAcceptedCount),
      deviceMismatch: Math.max(0, deviceMismatchCount),
    };
  }, [heatmapSummaryData, selectedHeatmapDevice, heatmapTotals.events]);
  const heatmapClickAnomalies = React.useMemo(() => {
    const serverAnomalies = heatmapSummaryData?.anomalies;
    if (serverAnomalies) {
      return {
        deadClicks: Number(serverAnomalies.deadClicks?.count || 0),
        rageClusters: Number(serverAnomalies.rageClicks?.count || 0),
        ctaFrustrations: Number(serverAnomalies.ctaFrustration?.count || 0),
        deadClickTargets: serverAnomalies.deadClicks?.targets || [],
        rageClickClusters: serverAnomalies.rageClicks?.clusters || [],
        ctaFrustrationClusters: serverAnomalies.ctaFrustration?.clusters || [],
      };
    }
    const clickPoints = heatmapPoints.filter((point) => ['click', 'pointerdown', 'touchstart'].includes(point.type));
    const deadClicks = clickPoints.filter((point) => !point.targetHref && !point.targetLabel && !point.targetTrackId && !point.targetSelector).length;
    const clusterMap = new Map();
    clickPoints.forEach((point) => {
      const x = Math.round(Number(point.xPct || 0) * 25);
      const y = Math.round(Number(point.yPct || 0) * 25);
      const key = `${point.sessionKey || 'unknown'}:${point.targetTrackId || point.targetSelector || point.targetLabel || point.targetId || point.targetTag || 'unknown'}:${x}:${y}`;
      clusterMap.set(key, (clusterMap.get(key) || 0) + 1);
    });
    const rageClusters = Array.from(clusterMap.values()).filter((count) => count >= 3).length;
    return { deadClicks, rageClusters, ctaFrustrations: 0, deadClickTargets: [], rageClickClusters: [], ctaFrustrationClusters: [] };
  }, [heatmapPoints, heatmapSummaryData]);
  const heatmapTopTargets = React.useMemo(() => heatmapSummaryData?.topTargets || [], [heatmapSummaryData]);
  const heatmapSignalKey = (item) => (
    item?.targetKey || item?.trackId || item?.targetTrackId || item?.selector || item?.targetSelector || item?.label || item?.path || 'unknown-target'
  );
  const heatmapDeadClickTargets = React.useMemo(() => {
    const enrichedTargets = heatmapTopTargets
      .filter((item) => Number(item.deadClicks || 0) > 0)
      .map((item) => ({ ...item, signalCount: Number(item.deadClicks || 0), signalLabel: 'dead clicks' }));
    if (enrichedTargets.length) return enrichedTargets;
    return (heatmapClickAnomalies.deadClickTargets || []).map((item) => ({
      ...item,
      signalCount: Number(item.count || item.deadClicks || 0),
      signalLabel: 'dead clicks',
      label: item.label || item.targetLabel || item.path || 'Dead click target',
    }));
  }, [heatmapTopTargets, heatmapClickAnomalies.deadClickTargets]);
  const heatmapRageClickTargets = React.useMemo(() => {
    const enrichedTargets = heatmapTopTargets
      .filter((item) => Number(item.rageClicks || 0) > 0)
      .map((item) => ({ ...item, signalCount: Number(item.rageClicks || 0), signalLabel: 'rage clicks' }));
    if (enrichedTargets.length) return enrichedTargets;
    return (heatmapClickAnomalies.rageClickClusters || []).map((item) => ({
      ...item,
      signalCount: Number(item.count || item.rageClicks || 0),
      signalLabel: 'rage clicks',
      label: item.label || item.targetLabel || item.path || 'Rage click cluster',
    }));
  }, [heatmapTopTargets, heatmapClickAnomalies.rageClickClusters]);
  const heatmapClickSignalTabs = React.useMemo(() => ([
    {
      key: 'top',
      label: 'Top clicked',
      count: heatmapTopTargets.length,
      empty: 'No clicked elements collected yet for this page and date range.',
      items: heatmapTopTargets.map((item) => ({
        ...item,
        signalCount: Number(item.clicks || 0) + Number(item.ctaClicks || 0),
        signalLabel: 'clicks',
      })),
    },
    {
      key: 'dead',
      label: 'Dead clicks',
      count: heatmapClickAnomalies.deadClicks,
      empty: 'No dead clicks detected for this page and date range.',
      items: heatmapDeadClickTargets,
    },
    {
      key: 'rage',
      label: 'Rage clicks',
      count: heatmapClickAnomalies.rageClusters,
      empty: 'No rage click clusters detected for this page and date range.',
      items: heatmapRageClickTargets,
    },
  ]), [heatmapTopTargets, heatmapClickAnomalies.deadClicks, heatmapClickAnomalies.rageClusters, heatmapDeadClickTargets, heatmapRageClickTargets]);
  const activeHeatmapClickSignalTab = heatmapClickSignalTabs.find((tab) => tab.key === heatmapClickSignalTab) || heatmapClickSignalTabs[0];
  const heatmapOverviewPages = React.useMemo(() => (
    (heatmapPageOptions || [])
      .map((page) => ({
        ...page,
        events: Number(page.events || 0),
        sessions: Number(page.sessions || 0),
        clicks: Number(page.clicks || 0) + Number(page.ctaClicks || 0),
        deadClicks: Number(page.deadClicks || 0),
        rageClicks: Number(page.rageClicks || 0),
      }))
      .sort((a, b) => (b.sessions - a.sessions) || (b.events - a.events))
  ), [heatmapPageOptions]);
  const heatmapDeviceBreakdown = React.useMemo(() => (
    (heatmapPagesData?.deviceBreakdown || [])
      .map((item) => ({
        ...item,
        deviceType: item.deviceType || 'unknown',
        sessions: Number(item.sessions || 0),
        events: Number(item.events || 0),
      }))
      .sort((a, b) => b.events - a.events)
  ), [heatmapPagesData]);
  const heatmapFrictionPages = React.useMemo(() => {
    const fromApi = Array.isArray(heatmapPagesData?.frictionPages) ? heatmapPagesData.frictionPages : [];
    if (fromApi.length) return fromApi;
    return heatmapOverviewPages
      .filter((page) => Number(page.deadClicks || 0) > 0 || Number(page.rageClicks || 0) > 0)
      .sort((a, b) => (Number(b.deadClicks || 0) + Number(b.rageClicks || 0)) - (Number(a.deadClicks || 0) + Number(a.rageClicks || 0)))
      .slice(0, 6);
  }, [heatmapPagesData, heatmapOverviewPages]);
  const heatmapRageSignals = React.useMemo(() => (
    (heatmapClickAnomalies.rageClickClusters || [])
      .map((item, index) => ({
        label: item.label || item.targetLabel || item.path || `Cluster ${index + 1}`,
        count: Number(item.count || item.rageClicks || 0),
      }))
      .filter((item) => item.count > 0)
      .slice(0, 7)
  ), [heatmapClickAnomalies.rageClickClusters]);
  const heatmapFrictionTotals = React.useMemo(() => {
    const pageDeadClicks = heatmapOverviewPages.reduce((total, page) => total + Number(page.deadClicks || 0), 0);
    const pageRageClicks = heatmapOverviewPages.reduce((total, page) => total + Number(page.rageClicks || 0), 0);
    return {
      deadClicks: pageDeadClicks || Number(heatmapClickAnomalies.deadClicks || 0),
      rageClicks: pageRageClicks || Number(heatmapClickAnomalies.rageClusters || 0),
    };
  }, [heatmapClickAnomalies.deadClicks, heatmapClickAnomalies.rageClusters, heatmapOverviewPages]);
  const selectedHeatmapPageOverview = heatmapOverviewPages.find((page) => (page.path || '/') === selectedHeatmapPath) || heatmapOverviewPages[0] || null;
  const latestAudit = siteAuditSummaryData?.audit || null;
  const latestAuditRawData = latestAudit?.raw_data || latestAudit?.rawData || {};
  const aiAuditMeta = latestAuditRawData?.aiAudit || {};
  const isAiAudit = String(latestAuditRawData?.algorithm || '').includes('ai') || ['ok', 'partial'].includes(aiAuditMeta?.status);
  const auditModeLabel = isAiAudit ? 'AI screenshot audit' : 'Deterministic audit';
  const auditPageResult = React.useMemo(() => {
    const pages = Array.isArray(latestAudit?.pages) ? latestAudit.pages : [];
    return pages.find((page) => (page.path || '/') === selectedHeatmapPath) || pages[0] || null;
  }, [latestAudit, selectedHeatmapPath]);
  const auditIssues = auditPageResult?.issues || latestAudit?.issues || [];
  const auditRecommendations = auditPageResult?.recommendations || latestAudit?.recommendations || [];
  const auditStaleDates = auditPageResult?.staleDateStrings || latestAudit?.stale_date_findings || latestAudit?.staleDateFindings || [];
  const auditBrokenLinks = auditPageResult?.suspiciousLinks || latestAudit?.broken_links || latestAudit?.brokenLinks || [];
  const aiAuditChecklist = React.useMemo(() => {
    const directChecklist = auditPageResult?.aiAudit?.checklist;
    if (Array.isArray(directChecklist)) return directChecklist;
    const note = (latestAudit?.performance_notes || latestAudit?.performanceNotes || [])
      .find((item) => item?.path === auditPageResult?.path || item?.path === selectedHeatmapPath);
    return Array.isArray(note?.aiChecklist) ? note.aiChecklist : [];
  }, [auditPageResult, latestAudit, selectedHeatmapPath]);
  const auditCategoryScores = React.useMemo(() => {
    const rawCategories = latestAudit?.raw_data?.categoryScores || latestAudit?.rawData?.categoryScores;
    if (Array.isArray(rawCategories) && rawCategories.length) return rawCategories;
    const pageCategories = auditPageResult?.categoryScores;
    if (pageCategories && typeof pageCategories === 'object') {
      const labels = {
        seoBasics: 'SEO basics',
        ctaClarity: 'CTA clarity',
        staleDates: 'Stale dates',
        internalLinks: 'Internal links',
        pageStructure: 'Page structure',
        performanceProxy: 'Performance proxy',
        page_load_desktop_mobile: 'Desktop/mobile load',
        application_flow_visible: 'Application flow',
        floor_plan_availability: 'Floor plan availability',
        pricing_accuracy: 'Pricing',
        homepage_cta: 'Homepage CTA',
        homepage_value_add: 'Homepage value-add',
        special_offers_current: 'Special offers',
        leasing_verbiage: 'Leasing verbiage',
        contact_info_hours: 'Contact/hours',
      };
      return Object.entries(pageCategories).map(([key, score]) => ({
        key,
        label: labels[key] || key,
        score,
      })).filter((item) => item.score != null);
    }
    return [
      { key: 'ctaClarity', label: 'CTA clarity', score: latestAudit?.urgency_score },
      { key: 'staleDates', label: 'Stale dates', score: latestAudit?.freshness_score },
      { key: 'internalLinks', label: 'Internal links', score: latestAudit?.link_score },
    ].filter((item) => item.score != null);
  }, [latestAudit, auditPageResult]);
  const lastTrackerEventAt = React.useMemo(() => {
    const latestPoint = heatmapPoints
      .map((point) => point.occurredAt)
      .filter(Boolean)
      .sort()
      .pop();
    return latestPoint || selectedAuditPage?.lastSeenAt || '';
  }, [heatmapPoints, selectedAuditPage]);
  const trackerHealth = heatmapTrackerHealthData?.health || {};
  const trackerRecommendations = Array.isArray(heatmapTrackerHealthData?.recommendations)
    ? heatmapTrackerHealthData.recommendations
    : [];
  const trackerHealthStatuses = trackerHealth.statuses || {};
  const trackerHealthStatusRows = [
    ['Script detected', trackerHealthStatuses.scriptDetected],
    ['Sample accepted', trackerHealthStatuses.sampleAccepted],
    ['Consent/DNT allowed', trackerHealthStatuses.consentDntAllowed],
    ['Last collect accepted', trackerHealthStatuses.lastCollectAccepted],
    ['Domain accepted', trackerHealthStatuses.domainAccepted],
    ['Events stored', trackerHealthStatuses.eventsStored],
  ];

  const getAuditItemText = (item, fallback = 'Review latest audit finding') => {
    if (typeof item === 'string') return item;
    if (!item || typeof item !== 'object') return fallback;
    return item.issue || item.recommendation || item.text || item.message || item.url || fallback;
  };

  const getAuditStatus = ({ score, issueCount = 0, warnCount = 0, healthyWhenZero = false }) => {
    if (issueCount > 0) return { label: 'Issue found', tone: 'danger' };
    if (healthyWhenZero && issueCount === 0 && warnCount === 0) return { label: 'Healthy', tone: 'healthy' };
    if (score == null) return { label: 'Needs review', tone: 'warning' };
    const numericScore = Number(score);
    if (!Number.isFinite(numericScore)) return { label: 'Needs review', tone: 'warning' };
    if (numericScore >= 90) return { label: 'Healthy', tone: 'healthy' };
    if (numericScore >= 70) return { label: 'Needs review', tone: 'warning' };
    return { label: 'Issue found', tone: 'danger' };
  };

  const renderAuditActionCard = ({ title, status, count, finding, details = [] }) => {
    const safeDetails = (details || []).map((item) => getAuditItemText(item)).filter(Boolean);
    return (
      <details className="heatmap-audit-card">
        <summary>
          <div>
            <div className="heatmap-audit-card__title-row">
              <strong>{title}</strong>
              <span className={`heatmap-audit-badge heatmap-audit-badge--${status.tone}`}>{status.label}</span>
            </div>
            <small>{finding}</small>
          </div>
          <div className="heatmap-audit-card__count">{count}</div>
        </summary>
        <div className="heatmap-audit-card__details">
          {safeDetails.length > 0 ? (
            safeDetails.slice(0, 5).map((item, index) => <p key={`${title}-detail-${index}`}>{item}</p>)
          ) : (
            <p>No additional details for this check.</p>
          )}
        </div>
      </details>
    );
  };

  return <section id="reporting-panel-heatmaps-audit" className="reports-panel">
        <div className="reports-panel__eyebrow">Website Experience</div>
        <div className="reports-panel__title">Heatmaps + Site Audit</div>
        {heatmapPanelError && <div className="reports-empty" style={{ marginBottom: '1rem' }}>{heatmapPanelError}</div>}
        {siteAuditNotice && <div className="reports-empty" style={{ marginBottom: '1rem' }}>{siteAuditNotice}</div>}

        <div className="heatmap-audit-controls">
          <label className="website-manager-field">
            <span className="website-manager-field__label">Page</span>
            <select className="website-manager-field__input" value={selectedHeatmapPath} onChange={(event) => setSelectedHeatmapPath(event.target.value)}>
              {heatmapPageOptions.map((page) => <option key={page.path || page.id} value={page.path || '/'}>{page.title || page.path || '/'}</option>)}
              {heatmapPageOptions.length === 0 && <option value="">No pages tracked yet</option>}
            </select>
          </label>
          <label className="website-manager-field">
            <span className="website-manager-field__label">Device</span>
            <select className="website-manager-field__input" value={selectedHeatmapDevice} onChange={(event) => setSelectedHeatmapDevice(event.target.value)}>
              {HEATMAP_DEVICE_OPTIONS.map((device) => <option key={device} value={device}>{device}</option>)}
            </select>
          </label>
          <div style={{ display: 'flex', alignItems: 'end' }}>
            <button type="button" className="website-manager-button website-manager-button--primary" onClick={runSiteAudit} disabled={siteAuditRunning || siteAuditLoading}>
              {siteAuditRunning ? 'Queueing…' : 'Queue AI Audit'}
            </button>
          </div>
        </div>

        <div className="website-experience-kpis">
          {[
            ['Tracked sessions', formatNumber(heatmapTotals.sessions || 0), `${formatNumber(heatmapTotals.events || 0)} events`],
            ['Avg. page duration', formatDurationMs(heatmapTotals.avgPageDurationMs), `${formatNumber(heatmapTotals.pageDurationEvents || 0)} duration events`],
            ['Avg. scroll depth', `${Math.round(Number(heatmapTotals.avgScrollDepthPct || 0) * 100)}%`, `Max ${Math.round(Number(heatmapTotals.maxScrollDepthPct || 0) * 100)}%`],
            ['Clicks / taps', `${formatNumber(Number(heatmapTotals.clicks || 0) + Number(heatmapTotals.ctaClicks || 0))} / ${formatNumber(heatmapTotals.taps || 0)}`, `${formatNumber(heatmapTotals.ctaClicks || 0)} CTA clicks`],
            ['Rage clicks', formatNumber(heatmapFrictionTotals.rageClicks), heatmapFrictionTotals.rageClicks ? 'Across tracked pages' : 'No rage signals yet'],
            ['Dead clicks', formatNumber(heatmapFrictionTotals.deadClicks), heatmapFrictionTotals.deadClicks ? 'Across tracked pages' : 'No dead clicks yet'],
          ].map(([label, value, meta]) => (
            <div key={label} className="website-experience-kpi">
              <span>{label}</span>
              <strong>{value}</strong>
              <small>{meta}</small>
            </div>
          ))}
        </div>

        <div className="website-experience-dashboard">
          <div className="website-experience-card website-experience-card--list">
            <div className="heatmap-audit-section-heading">
              <div>
                <strong>Top pages</strong>
                <small>Ranked by tracked sessions, then events.</small>
              </div>
            </div>
            {heatmapOverviewPages.slice(0, 5).map((page) => {
              const share = Number(heatmapTotals.events || 0) > 0 ? Math.min(1, Number(page.events || 0) / Number(heatmapTotals.events || 1)) : 0;
              return (
                <button
                  key={page.path || page.id}
                  type="button"
                  className="website-experience-page-row"
                  onClick={() => setSelectedHeatmapPath(page.path || '/')}
                >
                  <div>
                    <strong>{page.title || page.path || '/'}</strong>
                    <small>{page.path || '/'} · {formatNumber(page.sessions || 0)} sessions</small>
                    <span style={{ '--bar-width': `${Math.round(share * 100)}%` }} />
                  </div>
                  <em>{formatNumber(page.events || 0)} events</em>
                </button>
              );
            })}
            {heatmapOverviewPages.length === 0 && <div className="heatmap-audit-compact-empty">No page traffic has been collected yet.</div>}
          </div>

          <div className="website-experience-card website-experience-page-overview">
            <div className="heatmap-audit-section-heading">
              <div>
                <strong>Page overview</strong>
                <small>{selectedHeatmapPageOverview?.path || selectedHeatmapPath || '/'}</small>
              </div>
              <button type="button" className="website-experience-link-button" onClick={() => document.getElementById('heatmap-detail-view')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
                View heatmap
              </button>
            </div>
            <div className="website-experience-preview-card">
              {screenshotPreviewUrl ? (
                <img src={screenshotPreviewUrl} alt="" />
              ) : (
                <div className="website-experience-preview-empty">No screenshot yet</div>
              )}
              <div>
                <span>{formatNumber(selectedHeatmapPageOverview?.sessions || 0)}</span>
                <small>Sessions</small>
              </div>
              <div>
                <span>{formatNumber(selectedHeatmapPageOverview?.clicks || 0)}</span>
                <small>Clicks</small>
              </div>
              <div>
                <span>{Math.round(Number(selectedHeatmapPageOverview?.maxScrollDepthPct || heatmapTotals.maxScrollDepthPct || 0) * 100)}%</span>
                <small>Max scroll</small>
              </div>
            </div>
          </div>

          <div className="website-experience-card">
            <div className="heatmap-audit-section-heading">
              <div>
                <strong>Rage click signals</strong>
                <small>Cluster severity for the selected page.</small>
              </div>
            </div>
            <div className="website-experience-mini-bars">
              {heatmapRageSignals.map((item) => {
                const maxCount = Math.max(1, ...heatmapRageSignals.map((signal) => signal.count));
                return (
                  <div key={item.label}>
                    <span>{item.label}</span>
                    <i style={{ '--bar-width': `${Math.round((item.count / maxCount) * 100)}%` }} />
                    <strong>{formatNumber(item.count)}</strong>
                  </div>
                );
              })}
              {heatmapRageSignals.length === 0 && <div className="heatmap-audit-compact-empty">No rage click clusters detected for the selected page.</div>}
            </div>
          </div>

          <div className="website-experience-card">
            <div className="heatmap-audit-section-heading">
              <div>
                <strong>Pages with friction</strong>
                <small>Dead click page signals from the click target aggregate.</small>
              </div>
            </div>
            <div className="website-experience-mini-list">
              {heatmapFrictionPages.slice(0, 5).map((page) => (
                <button key={page.path} type="button" onClick={() => setSelectedHeatmapPath(page.path || '/')}>
                  <span>{page.title || page.path || '/'}</span>
                  <strong>{formatNumber(Number(page.deadClicks || 0) + Number(page.rageClicks || 0))}</strong>
                </button>
              ))}
              {heatmapFrictionPages.length === 0 && <div className="heatmap-audit-compact-empty">No page-level rage or dead click signals yet.</div>}
            </div>
          </div>

          <div className="website-experience-card">
            <div className="heatmap-audit-section-heading">
              <div>
                <strong>Device breakdown</strong>
                <small>Tracked events and sessions by viewport type.</small>
              </div>
            </div>
            <div className="website-experience-device-list">
              {heatmapDeviceBreakdown.map((device) => {
                const share = Number(heatmapTotals.events || 0) > 0 ? Math.min(1, Number(device.events || 0) / Number(heatmapTotals.events || 1)) : 0;
                return (
                  <div key={device.deviceType}>
                    <span>{device.deviceType}</span>
                    <i style={{ '--bar-width': `${Math.round(share * 100)}%` }} />
                    <strong>{formatNumber(device.sessions)} sessions</strong>
                  </div>
                );
              })}
              {heatmapDeviceBreakdown.length === 0 && <div className="heatmap-audit-compact-empty">Device data will appear after events are collected.</div>}
            </div>
          </div>

          <div className="website-experience-card website-experience-card--muted">
            <strong>Audience + traffic context</strong>
            <small>New vs returning users and top referrers can be added once the tracker stores visitor classification and referrer/channel enrichment.</small>
          </div>
        </div>

        <div className="heatmap-audit-status-grid">
          <div className={`heatmap-audit-status-card ${selectedScreenshot ? 'is-healthy' : 'is-pending'}`}>
            <span>{selectedScreenshot ? 'Screenshot captured' : 'Screenshot pending'}</span>
            <strong>{selectedScreenshot ? `${selectedScreenshot.deviceType || selectedHeatmapDevice} screenshot` : 'Waiting for capture'}</strong>
            <small>{selectedScreenshot?.capturedAt ? getSnapshotTimestampLabel(selectedScreenshot.capturedAt) : 'No screenshot stored for this page/device yet.'}</small>
          </div>
          <div className={`heatmap-audit-status-card ${latestAudit ? 'is-healthy' : 'is-pending'}`}>
            <span>{latestAudit ? 'Audit complete' : 'Audit pending'}</span>
            <strong>{latestAudit ? `Score ${auditPageResult?.score ?? latestAudit?.performance_score ?? '—'}` : 'Run audit'}</strong>
            <small>{latestAudit?.audited_at ? `${auditModeLabel} · ${getSnapshotTimestampLabel(latestAudit.audited_at)}` : 'Audit data is separate from heatmap traffic.'}</small>
          </div>
          <div className={`heatmap-audit-status-card ${Number(heatmapTotals.events || 0) > 0 ? 'is-healthy' : 'is-pending'}`}>
            <span>{Number(heatmapTotals.events || 0) > 0 ? 'Heatmap traffic active' : 'Heatmap traffic pending'}</span>
            <strong>{heatmapSummaryLoading ? 'Loading…' : `${formatNumber(heatmapTotals.events || 0)} events`}</strong>
            <small>{Number(heatmapTotals.events || 0) > 0 ? `${formatNumber(heatmapTotals.sessions || 0)} tracked sessions in range.` : 'Audit and screenshots can be ready before visitor interaction data arrives.'}</small>
          </div>
          <div className={`heatmap-audit-status-card ${selectedAuditPage?.capturedAt || selectedAuditPage?.latestSnapshotId ? 'is-healthy' : 'is-pending'}`}>
            <span>{selectedAuditPage?.capturedAt || selectedAuditPage?.latestSnapshotId ? 'Snapshot captured' : 'Snapshot pending'}</span>
            <strong>{selectedAuditPage?.capturedAt || selectedAuditPage?.latestSnapshotId ? 'Page snapshot' : 'Waiting for snapshot'}</strong>
            <small>{selectedAuditPage?.capturedAt ? getSnapshotTimestampLabel(selectedAuditPage.capturedAt) : selectedAuditPage?.latestSnapshotId ? 'Snapshot record available.' : 'No page snapshot yet.'}</small>
          </div>
          <div className={`heatmap-audit-status-card ${trackerHealth.trackerScriptObserved || lastTrackerEventAt ? 'is-healthy' : 'is-pending'}`}>
            <span>{trackerHealth.trackerScriptObserved || lastTrackerEventAt ? 'Tracker event seen' : 'Tracker event pending'}</span>
            <strong>{heatmapTrackerHealthLoading ? 'Checking…' : trackerHealth.latestCollectStatus || (lastTrackerEventAt ? 'Tracker active' : 'No event yet')}</strong>
            <small>{trackerHealth.latestEventAt ? getSnapshotTimestampLabel(trackerHealth.latestEventAt) : lastTrackerEventAt ? getSnapshotTimestampLabel(lastTrackerEventAt) : 'No tracker event observed for this page yet.'}</small>
          </div>
        </div>

        {reportingAdminEnabled && (
          <div className="heatmap-coordinate-diagnostics">
            <div className="heatmap-coordinate-diagnostics__heading">
              <strong>Coordinate diagnostics</strong>
              <small>Admin-only tracker validation for the selected page/device/range.</small>
            </div>
            <div className="heatmap-coordinate-diagnostics__grid" style={{ marginBottom: '0.75rem' }}>
              {trackerHealthStatusRows.map(([label, status]) => (
                <div key={label}>
                  <span>{label}</span>
                  <strong style={{ color: status?.ok ? 'var(--success-green)' : 'var(--primary-tan)' }}>{status?.label || 'Unknown'}</strong>
                  <small>{status?.detail || 'No signal yet'}</small>
                </div>
              ))}
            </div>
            <div className="reports-empty" style={{ marginBottom: '0.75rem' }}>
              <strong>Top missing-data reason:</strong> {trackerHealth.topMissingReason || 'No tracker health result yet.'}
            </div>
            <div className="heatmap-coordinate-diagnostics__grid">
              <div><span>Raw events received</span><strong>{formatNumber(heatmapCoordinateDiagnostics.rawEvents)}</strong></div>
              <div><span>Events with coordinates</span><strong>{formatNumber(heatmapCoordinateDiagnostics.withCoordinates)}</strong></div>
              <div><span>Rejected from renderer</span><strong>{formatNumber(heatmapCoordinateDiagnostics.rejectedFromRenderer)}</strong></div>
              <div><span>Device mismatch count</span><strong>{formatNumber(heatmapCoordinateDiagnostics.deviceMismatch)}</strong></div>
              <div><span>Tracker diagnostics</span><strong>{formatNumber(trackerHealth.countsByType?.tracker_diagnostic || 0)}</strong></div>
              <div><span>Deduped taps</span><strong>{formatNumber(trackerHealth.dedupedTapEvents || 0)}</strong></div>
              <div><span>Sample rate</span><strong>{trackerHealth.sampleRate != null ? `${Math.round(Number(trackerHealth.sampleRate || 0) * 100)}%` : '—'}</strong></div>
              <div><span>DNT respected</span><strong>{trackerHealth.respectDnt ? 'Yes' : 'No'}</strong></div>
              <div><span>Allowed domains</span><strong>{formatNumber((trackerHealth.allowedDomains || []).length)}</strong></div>
            </div>
            {trackerRecommendations.length > 0 && (
              <div className="heatmap-tracker-health-list">
                {trackerRecommendations.slice(0, 4).map((item) => <span key={item}>{item}</span>)}
              </div>
            )}
          </div>
        )}

        <div id="heatmap-detail-view" className="heatmap-audit-layout">
          <div className="heatmap-audit-preview">
            <div className="heatmap-audit-section-heading">
              <div>
                <strong>Page preview</strong>
                <small>{selectedHeatmapPath || '/'} · {selectedHeatmapDevice}</small>
              </div>
              <span>{screenshotPreviewLoading ? 'Loading screenshot' : selectedScreenshot ? 'Screenshot available' : 'No screenshot yet'}</span>
            </div>
            <HeatmapRenderer
              points={heatmapPoints}
              cells={heatmapCells}
              totals={heatmapTotals}
              deviceType={selectedHeatmapDevice}
              screenshotUrl={screenshotPreviewUrl}
              screenshot={selectedScreenshot}
              loading={screenshotPreviewLoading || heatmapSummaryLoading}
              error={screenshotPreviewError}
              activeLayers={heatmapLayers}
              onLayerChange={updateHeatmapLayer}
              highlightedTarget={highlightedHeatmapTarget}
              targetHotspots={heatmapTopTargets}
              scrollSummary={heatmapScrollSummary}
              formatNumber={formatNumber}
            />
          </div>
          <div className="reports-list heatmap-audit-rail">
            <div className="heatmap-audit-section-heading">
              <div>
                <strong>Audit summary</strong>
                <small>{latestAudit?.audited_at ? `Last audited ${getSnapshotTimestampLabel(latestAudit.audited_at)}` : 'Audit pending'}</small>
              </div>
            </div>
            <div className="heatmap-audit-rail-score">
              <span>Combined score</span>
              <strong>{renderMetricValue(siteAuditLoading, auditPageResult?.score ?? latestAudit?.performance_score ?? '—')}</strong>
              <small>{latestAudit ? auditModeLabel : 'Run audit to score this page'}</small>
            </div>
            {renderAuditActionCard({
              title: 'Audit score',
              status: getAuditStatus({ score: auditPageResult?.score ?? latestAudit?.performance_score, issueCount: (auditIssues || []).length }),
              count: siteAuditLoading ? <MiniMetricLoader /> : auditPageResult?.score ?? latestAudit?.performance_score ?? '—',
              finding: latestAudit
                ? isAiAudit
                  ? `AI reviewed ${formatNumber(aiAuditMeta?.pagesScored || 0)} screenshot page${Number(aiAuditMeta?.pagesScored || 0) === 1 ? '' : 's'} against the website audit rubric.`
                  : 'Weighted score across SEO, CTA, freshness, links, structure, and performance proxy.'
                : 'Run an audit to generate a score.',
              details: auditCategoryScores.length
                ? auditCategoryScores.map((item) => `${item.label}: ${formatNumber(item.score, 1)}${item.weight != null ? ` (${Math.round(Number(item.weight) * 100)}% weight)` : ''}`)
                : auditIssues.length ? auditIssues : auditRecommendations,
            })}
            {isAiAudit && auditPageResult?.aiSummary && (
              <div className="reports-empty">{auditPageResult.aiSummary}</div>
            )}
            {aiAuditChecklist.length > 0 && (
              <div className="heatmap-audit-category-grid">
                {aiAuditChecklist.map((item) => (
                  <div key={item.key || item.label} className="heatmap-audit-category">
                    <span>{item.label || item.key}</span>
                    <strong>{formatNumber(item.score, 1)}</strong>
                    <small>{[item.status, item.severity].filter(Boolean).join(' | ') || 'AI checklist'}</small>
                    <small>{item.recommendation || item.evidence || 'No additional note.'}</small>
                  </div>
                ))}
              </div>
            )}
            {auditCategoryScores.length > 0 && (
              <div className="heatmap-audit-category-grid">
                {auditCategoryScores.map((item) => (
                  <div key={item.key || item.label} className="heatmap-audit-category">
                    <span>{item.label}</span>
                    <strong>{formatNumber(item.score, 1)}</strong>
                    <small>{item.weight != null ? `${Math.round(Number(item.weight) * 100)}% weight` : 'Category score'}</small>
                  </div>
                ))}
              </div>
            )}
            {renderAuditActionCard({
              title: 'CTA / urgency',
              status: getAuditStatus({
                score: latestAudit?.urgency_score,
                issueCount: (auditPageResult?.ctaCount ?? selectedAuditPage?.ctas?.length ?? 0) > 0 ? 0 : 1,
              }),
              count: auditPageResult?.ctaCount ?? selectedAuditPage?.ctas?.length ?? 0,
              finding: `${auditPageResult?.ctaCount ?? selectedAuditPage?.ctas?.length ?? 0} CTA-like elements detected.`,
              details: selectedAuditPage?.ctas || auditRecommendations,
            })}
            {renderAuditActionCard({
              title: 'Broken/internal links',
              status: getAuditStatus({ score: latestAudit?.link_score, issueCount: Array.isArray(auditBrokenLinks) ? auditBrokenLinks.length : 0, healthyWhenZero: true }),
              count: formatNumber(Array.isArray(auditBrokenLinks) ? auditBrokenLinks.length : 0),
              finding: Array.isArray(auditBrokenLinks) && auditBrokenLinks.length ? 'Suspicious internal links need review.' : 'No suspicious internal links detected.',
              details: auditBrokenLinks,
            })}
            <div className="reports-list__row"><div><strong>Last captured / audited</strong><small>{selectedAuditPage?.capturedAt ? getSnapshotTimestampLabel(selectedAuditPage.capturedAt) : 'No page capture yet'}</small></div><div>{latestAudit?.audited_at ? getSnapshotTimestampLabel(latestAudit.audited_at) : '—'}</div></div>
            {renderAuditActionCard({
              title: 'Stale date findings',
              status: getAuditStatus({ issueCount: (auditStaleDates || []).length, healthyWhenZero: true }),
              count: formatNumber((auditStaleDates || []).length),
              finding: (auditStaleDates || []).length ? 'Potential stale or expired dates found.' : 'None detected.',
              details: auditStaleDates,
            })}
            {renderAuditActionCard({
              title: 'Recommendations',
              status: getAuditStatus({ warnCount: (auditRecommendations || []).length, score: (auditRecommendations || []).length ? 75 : 100 }),
              count: formatNumber((auditRecommendations || []).length),
              finding: (auditRecommendations || []).length ? 'Suggested improvements are available.' : 'No recommendations generated for this page.',
              details: auditRecommendations,
            })}
            {!latestAudit && <div className="reports-empty">Run an audit after page snapshots are collected to populate recommendations.</div>}
          </div>
        </div>

        <div className="heatmap-audit-interactions">
          <div className="heatmap-audit-section-heading">
            <div>
              <strong>Click and engagement signals</strong>
              <small>Rage clicks, dead clicks, and the top clicked elements for the selected page.</small>
            </div>
          </div>
          <div className="heatmap-audit-interaction-grid">
            <div className="reports-list__row"><div><strong>Rage click clusters</strong><small>Repeated clicks in the same session, element, and page area.</small></div><div>{formatNumber(heatmapClickAnomalies.rageClusters)}</div></div>
            <div className="reports-list__row"><div><strong>Dead clicks</strong><small>Clicks without a CTA label or href signal.</small></div><div>{formatNumber(heatmapClickAnomalies.deadClicks)}</div></div>
            <div className="reports-list__row"><div><strong>CTA frustration</strong><small>Repeated CTA clicks without a page transition signal.</small></div><div>{formatNumber(heatmapClickAnomalies.ctaFrustrations)}</div></div>
            <div className="reports-list__row"><div><strong>Cursor movement</strong><small>Movement samples represented in the cursor density layer.</small></div><div>{formatNumber(heatmapCursorSummary.movementSamples || heatmapTotals.cursorSamples || 0)}</div></div>
            <div className="reports-list__row"><div><strong>Stationary dwell</strong><small>Cursor rest points with average dwell duration.</small></div><div>{formatNumber(heatmapCursorSummary.dwellPoints || 0)} · {Math.round(Number(heatmapCursorSummary.avgDwellMs || 0) / 100) / 10}s</div></div>
            <div className="heatmap-audit-top-clicks">
              <div className="heatmap-click-tabs" role="tablist" aria-label="Click signal lists">
                {heatmapClickSignalTabs.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    role="tab"
                    aria-selected={heatmapClickSignalTab === tab.key}
                    className={`heatmap-click-tab${heatmapClickSignalTab === tab.key ? ' is-active' : ''}`}
                    onClick={() => setHeatmapClickSignalTab(tab.key)}
                  >
                    <span>{tab.label}</span>
                    <strong>{formatNumber(tab.count || 0)}</strong>
                  </button>
                ))}
              </div>
              <div className="heatmap-audit-list-heading">{activeHeatmapClickSignalTab.label}</div>
              {activeHeatmapClickSignalTab.items.slice(0, 8).map((item, index) => (
                <button
                  key={`${activeHeatmapClickSignalTab.key}-${heatmapSignalKey(item)}-${index}`}
                  type="button"
                  className="reports-list__row heatmap-target-row"
                  onMouseEnter={() => setHighlightedHeatmapTarget(item)}
                  onMouseLeave={() => setHighlightedHeatmapTarget(null)}
                  onFocus={() => setHighlightedHeatmapTarget(item)}
                  onBlur={() => setHighlightedHeatmapTarget(null)}
                  onClick={() => setHighlightedHeatmapTarget((current) => (
                    heatmapSignalKey(current) === heatmapSignalKey(item) ? null : item
                  ))}
                >
                  <div>
                    <strong>{item.label || item.trackId || item.selector || item.path || 'Tracked element'}</strong>
                    <small>{[item.category, item.trackId ? `ID: ${item.trackId}` : '', item.selector && !item.trackId ? item.selector : '', item.sessions ? `${formatNumber(item.sessions)} sessions` : ''].filter(Boolean).join(' · ') || 'Tracked click target'}</small>
                  </div>
                  <div>{formatNumber(item.signalCount ?? item.clicks ?? item.count ?? 0)}</div>
                </button>
              ))}
              {activeHeatmapClickSignalTab.items.length === 0 && <div className="heatmap-audit-compact-empty">{activeHeatmapClickSignalTab.empty}</div>}
            </div>
            <div className="heatmap-audit-top-clicks">
              <div className="heatmap-audit-list-heading">Top attention areas</div>
              {heatmapTopAttentionAreas.slice(0, 6).map((item, index) => (
                <div key={`${item.sectionLabel || item.selector || item.label || 'attention'}-${index}`} className="reports-list__row">
                  <div>
                    <strong>{item.sectionLabel || item.label || item.selector || 'Attention area'}</strong>
                    <small>{[
                      item.category,
                      item.sessions ? `${formatNumber(item.sessions)} sessions` : '',
                      item.dwellPoints ? `${formatNumber(item.dwellPoints)} dwell points` : '',
                      item.cursorSamples ? `${formatNumber(item.cursorSamples)} movement samples` : '',
                    ].filter(Boolean).join(' · ') || 'Cursor attention area'}</small>
                  </div>
                  <div>{Math.round(Number(item.totalDwellMs || 0) / 1000)}s</div>
                </div>
              ))}
              {heatmapTopAttentionAreas.length === 0 && <div className="heatmap-audit-compact-empty">No cursor attention areas collected yet for this page and date range.</div>}
            </div>
          </div>
        </div>

        <div className="heatmap-audit-interactions">
          <div className="heatmap-audit-section-heading">
            <div>
              <strong>Scroll behavior</strong>
              <small>Milestones, abandonment depth, scroll bands, and visible page sections.</small>
            </div>
          </div>
          <div className="heatmap-audit-interaction-grid">
            <div className="reports-list__row">
              <div><strong>Reach thresholds</strong><small>10 / 50 / 90 / 100 percent scroll depth.</small></div>
              <div>{['10', '50', '90', '100'].map((key) => {
                const value = heatmapScrollReach[key] || heatmapScrollMilestones[key] || 0;
                if (value && typeof value === 'object') {
                  return `${Math.round(Number(value.percent || 0) * 100)}%`;
                }
                return formatNumber(value || 0);
              }).join(' / ')}</div>
            </div>
            <div className="reports-list__row">
              <div><strong>Abandonment depth</strong><small>Average final depth from page duration/exit events.</small></div>
              <div>{Math.round(Number(heatmapTotals.avgAbandonmentDepthPct || 0) * 100)}%</div>
            </div>
            <div className="reports-list__row">
              <div><strong>First meaningful scroll</strong><small>Tracked once users move beyond the first viewport threshold.</small></div>
              <div>{formatNumber(heatmapTotals.firstMeaningfulScrolls || 0)}</div>
            </div>
            <div className="reports-list__row">
              <div><strong>Top scroll band</strong><small>Band with the most accumulated viewport time.</small></div>
              <div>{topScrollBand ? `${topScrollBand[0]} · ${Math.round(Number(topScrollBand[1] || 0) / 1000)}s` : '—'}</div>
            </div>
            <div className="heatmap-audit-top-clicks">
              <div className="heatmap-audit-list-heading">Most viewed sections</div>
              {heatmapTopSections.slice(0, 6).map((item) => (
                <div key={item.label} className="reports-list__row">
                  <div>
                    <strong>{item.label}</strong>
                    <small>{Math.round(Number(item.maxVisiblePct || 0) * 100)}% max visible</small>
                  </div>
                  <div>{Math.round(Number(item.visibleMs || 0) / 1000)}s</div>
                </div>
              ))}
              {heatmapTopSections.length === 0 && <div className="heatmap-audit-compact-empty">No section exposure data collected yet for this page and date range.</div>}
            </div>
          </div>
        </div>
      </section>;
}
