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
  LineChart,
  Line,
} from 'recharts';
import {
  GA4_DASHBOARD_URL,
  GOOGLE_ADS_DASHBOARD_URL,
  META_ADS_DASHBOARD_URL,
  RENDER_API_BASE_URL,
  REPORTING_TAB_SUMMARY_URL,
} from './apiConfig';
import { authFetch } from './lib/authFetch';

const isRenderAdapterUrl = (value) => {
  if (!value || !RENDER_API_BASE_URL) return false;
  return String(value).startsWith(RENDER_API_BASE_URL);
};

const normalizeAnalyticsError = (message) => {
  const text = String(message || '').trim();
  if (!text) return null;
  const normalized = text.toLowerCase();
  if (normalized.includes('deleted_client') || normalized.includes('oauth client was deleted')) {
    return 'Google Ads access needs to be reconnected. The OAuth client in GOOGLE_ADS_CONFIG_JSON was deleted, so refresh the Google Ads credentials before live paid search metrics can load.';
  }
  if (
    normalized.includes('consumer_invalid')
    || normalized.includes('project #')
    || normalized.includes('project has been deleted')
  ) {
    return 'GA4 reporting credentials need to be updated. The Google Cloud project behind the Analytics API credential was deleted or disabled, so replace the service account/API credential and enable the Analytics Data API.';
  }
  if (text.includes('403') && normalized.includes('property')) {
    return 'GA4 access is not enabled for this property yet. Share the property with the reporting service account to unlock the GA4 sections.';
  }
  return text;
};

export default function AnalyticsView(props) {
  const {
    CHART_AXIS_DARK,
    CHART_AXIS_DARK_SOFT,
    CHART_AXIS_LIGHT,
    CHART_AXIS_LIGHT_SOFT,
    CHART_COLOR_GOLD,
    CHART_COLOR_GREEN,
    CHART_COLOR_ORANGE,
    CHART_COLOR_PINK,
    CHART_COLOR_SECONDARY_TAN,
    CHART_COLOR_TAN,
    CHART_GRID_DARK,
    CHART_GRID_LIGHT,
    CHART_MARGIN_STANDARD,
    CHART_MARGIN_TALL,
    CHART_MARGIN_VERTICAL,
    CHART_TOOLTIP_ITEM_STYLE,
    CHART_TOOLTIP_LABEL_STYLE,
    CHART_TOOLTIP_STYLE,
    MeasuredChart,
    formatCurrency,
    formatDateInputValue,
    formatNumber,
    formatPercent,
    formatSignedPercent,
    getDeltaTone,
    metaAdsAttributionMode,
    rangeDates,
    renderMetricValue,
    selectedProperty,
    selectedPropertyId,
    selectedPropertyLabel,
    setMetaAdsAttributionMode,
    shortenLabel,
  } = props;

  const [ga4Data, setGa4Data] = React.useState(null);
  const [ga4Error, setGa4Error] = React.useState(null);
  const [ga4Loading, setGa4Loading] = React.useState(true);
  const [googleAdsData, setGoogleAdsData] = React.useState(null);
  const [googleAdsError, setGoogleAdsError] = React.useState(null);
  const [googleAdsLoading, setGoogleAdsLoading] = React.useState(true);
  const [metaAdsData, setMetaAdsData] = React.useState(null);
  const [metaAdsError, setMetaAdsError] = React.useState(null);
  const [metaAdsLoading, setMetaAdsLoading] = React.useState(true);
  const [analyticsSummaryBypass, setAnalyticsSummaryBypass] = React.useState(false);
  const propertyScopedSelectionId = selectedPropertyId || selectedProperty?.propertyId || '';
  const analyticsEndpointsConfigured = Boolean(GA4_DASHBOARD_URL && GOOGLE_ADS_DASHBOARD_URL && META_ADS_DASHBOARD_URL);
  const analyticsUsesRenderAdapter = React.useMemo(
    () => [GA4_DASHBOARD_URL, GOOGLE_ADS_DASHBOARD_URL, META_ADS_DASHBOARD_URL].every(isRenderAdapterUrl),
    []
  );
  const analyticsSourceBadge = React.useMemo(() => {
    if (REPORTING_TAB_SUMMARY_URL && !analyticsSummaryBypass && metaAdsAttributionMode === 'account_default') {
      return { label: 'Data source: Staged summary', className: 'analytics-chip analytics-chip--staged' };
    }
    if (analyticsUsesRenderAdapter) {
      return { label: 'Data source: Staged Render', className: 'analytics-chip analytics-chip--staged' };
    }
    if (analyticsEndpointsConfigured) {
      return { label: 'Data source: External endpoints', className: 'analytics-chip analytics-chip--fallback' };
    }
    return { label: 'Data source: Endpoint unavailable', className: 'analytics-chip analytics-chip--error' };
  }, [analyticsEndpointsConfigured, analyticsSummaryBypass, analyticsUsesRenderAdapter, metaAdsAttributionMode]);
  const shouldUseAnalyticsSummary = Boolean(REPORTING_TAB_SUMMARY_URL)
    && !analyticsSummaryBypass
    && metaAdsAttributionMode === 'account_default';

  React.useEffect(() => {
    setAnalyticsSummaryBypass(false);
  }, [propertyScopedSelectionId, rangeDates, metaAdsAttributionMode]);

  React.useEffect(() => {
    if (!shouldUseAnalyticsSummary) return undefined;

    if (!propertyScopedSelectionId) {
      setGa4Data(null);
      setGoogleAdsData(null);
      setMetaAdsData(null);
      setGa4Error(null);
      setGoogleAdsError(null);
      setMetaAdsError(null);
      setGa4Loading(false);
      setGoogleAdsLoading(false);
      setMetaAdsLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    const applySummaryEntry = (entry, setData, setError, fallbackMessage) => {
      if (entry?.status === 'ok' && entry.payload) {
        setData(entry.payload);
        setError(null);
        return;
      }
      setData(null);
      setError(entry?.error || fallbackMessage);
    };

    const loadAnalyticsSummary = async () => {
      setGa4Loading(true);
      setGoogleAdsLoading(true);
      setMetaAdsLoading(true);
      setGa4Error(null);
      setGoogleAdsError(null);
      setMetaAdsError(null);

      try {
        const params = new URLSearchParams({
          property_id: propertyScopedSelectionId,
          sections: 'analytics',
          start_date: formatDateInputValue(rangeDates.start),
          end_date: formatDateInputValue(rangeDates.end),
          attribution_mode: metaAdsAttributionMode,
        });
        const response = await authFetch(`${REPORTING_TAB_SUMMARY_URL}?${params.toString()}`, {
          signal: controller.signal,
        });
        const payload = await response.json();
        if (!response.ok || payload?.status === 'error') {
          throw new Error(payload?.error || `Analytics summary fetch failed: ${response.status}`);
        }

        const analytics = payload.analytics || {};
        applySummaryEntry(analytics.ga4, setGa4Data, setGa4Error, 'No cached GA4 summary is available yet.');
        applySummaryEntry(analytics.googleAds, setGoogleAdsData, setGoogleAdsError, 'No cached Google Ads summary is available yet.');
        applySummaryEntry(analytics.metaAds, setMetaAdsData, setMetaAdsError, 'No cached Meta Ads summary is available yet.');
      } catch (error) {
        if (error.name === 'AbortError') return;
        console.error('Analytics summary fetch failed', error);
        setAnalyticsSummaryBypass(true);
        setGa4Error(error.message || 'Unable to load analytics summary.');
        setGoogleAdsError(error.message || 'Unable to load paid search summary.');
        setMetaAdsError(error.message || 'Unable to load paid social summary.');
      } finally {
        if (!controller.signal.aborted) {
          setGa4Loading(false);
          setGoogleAdsLoading(false);
          setMetaAdsLoading(false);
        }
      }
    };

    loadAnalyticsSummary();
    return () => controller.abort();
  }, [formatDateInputValue, metaAdsAttributionMode, propertyScopedSelectionId, rangeDates, shouldUseAnalyticsSummary]);

  React.useEffect(() => {
    if (shouldUseAnalyticsSummary) return undefined;

    if (!propertyScopedSelectionId) {
      setGa4Data(null);
      setGa4Error(null);
      setGa4Loading(false);
      return undefined;
    }

    const ga4PropertyId = selectedProperty?.googleAnalyticsId;
    if (!ga4PropertyId) {
      setGa4Data(null);
      setGa4Error('No GA4 property ID is configured for this property.');
      setGa4Loading(false);
      return undefined;
    }

    const controller = new AbortController();
    const loadGa4Data = async () => {
      setGa4Loading(true);
      setGa4Error(null);

      try {
        if (!GA4_DASHBOARD_URL) {
          throw new Error('GA4 endpoint is not configured. Set VITE_GA4_DASHBOARD_URL to enable live refresh.');
        }

        const params = new URLSearchParams({
          property_id: propertyScopedSelectionId,
          ga4_property_id: ga4PropertyId,
          start_date: formatDateInputValue(rangeDates.start),
          end_date: formatDateInputValue(rangeDates.end),
        });
        const response = await authFetch(`${GA4_DASHBOARD_URL}?${params.toString()}`, {
          signal: controller.signal,
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload?.error || `GA4 fetch failed: ${response.status}`);
        }
        setGa4Data(payload);
      } catch (error) {
        if (error.name === 'AbortError') return;
        console.error('GA4 dashboard fetch failed', error);
        setGa4Data(null);
        setGa4Error(error.message || 'Unable to load GA4 analytics. The staged adapter may not be reachable yet.');
      } finally {
        if (!controller.signal.aborted) setGa4Loading(false);
      }
    };

    loadGa4Data();
    return () => controller.abort();
  }, [formatDateInputValue, propertyScopedSelectionId, rangeDates, selectedProperty, shouldUseAnalyticsSummary]);

  React.useEffect(() => {
    if (shouldUseAnalyticsSummary) return undefined;

    if (!propertyScopedSelectionId) {
      setGoogleAdsData(null);
      setGoogleAdsError(null);
      setGoogleAdsLoading(false);
      return undefined;
    }

    const googleAdsCustomerId = selectedProperty?.googleAdsId;
    if (!googleAdsCustomerId) {
      setGoogleAdsData(null);
      setGoogleAdsError('No Google Ads customer ID is configured for this property.');
      setGoogleAdsLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    const loadGoogleAdsData = async () => {
      setGoogleAdsLoading(true);
      setGoogleAdsError(null);

      try {
        if (!GOOGLE_ADS_DASHBOARD_URL) {
          throw new Error('Google Ads endpoint is not configured. Set VITE_GOOGLE_ADS_DASHBOARD_URL to enable live refresh.');
        }

        const params = new URLSearchParams({
          property_id: propertyScopedSelectionId,
          google_ads_customer_id: googleAdsCustomerId,
          property_name: selectedProperty?.name || '',
          start_date: formatDateInputValue(rangeDates.start),
          end_date: formatDateInputValue(rangeDates.end),
        });
        const response = await authFetch(`${GOOGLE_ADS_DASHBOARD_URL}?${params.toString()}`, {
          signal: controller.signal,
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload?.error || `Google Ads fetch failed: ${response.status}`);
        }
        setGoogleAdsData(payload);
      } catch (error) {
        if (error.name === 'AbortError') return;
        console.error('Google Ads dashboard fetch failed', error);
        setGoogleAdsData(null);
        setGoogleAdsError(error.message || 'Unable to load Google Ads analytics. The staged adapter may not be reachable yet.');
      } finally {
        if (!controller.signal.aborted) setGoogleAdsLoading(false);
      }
    };

    loadGoogleAdsData();
    return () => controller.abort();
  }, [formatDateInputValue, propertyScopedSelectionId, rangeDates, selectedProperty, shouldUseAnalyticsSummary]);

  React.useEffect(() => {
    if (shouldUseAnalyticsSummary) return undefined;

    if (!propertyScopedSelectionId) {
      setMetaAdsData(null);
      setMetaAdsError(null);
      setMetaAdsLoading(false);
      return undefined;
    }

    const metaAdsAccountId = selectedProperty?.metaAdsAccountId;
    if (!metaAdsAccountId) {
      setMetaAdsData(null);
      setMetaAdsError('No Meta Ads account ID is configured for this property.');
      setMetaAdsLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    const loadMetaAdsData = async () => {
      setMetaAdsLoading(true);
      setMetaAdsError(null);

      try {
        if (!META_ADS_DASHBOARD_URL) {
          throw new Error('Meta Ads endpoint is not configured. Set VITE_META_ADS_DASHBOARD_URL to enable live refresh.');
        }

        const params = new URLSearchParams({
          property_id: propertyScopedSelectionId,
          meta_ads_account_id: metaAdsAccountId,
          property_name: selectedProperty?.name || '',
          attribution_mode: metaAdsAttributionMode,
          start_date: formatDateInputValue(rangeDates.start),
          end_date: formatDateInputValue(rangeDates.end),
        });
        if (selectedProperty?.metaAdsCampaignIds?.length) {
          params.set('campaign_ids', JSON.stringify(selectedProperty.metaAdsCampaignIds));
        }
        if (selectedProperty?.metaAdsMatchTerms?.length) {
          params.set('match_terms', JSON.stringify(selectedProperty.metaAdsMatchTerms));
        }
        const response = await authFetch(`${META_ADS_DASHBOARD_URL}?${params.toString()}`, {
          signal: controller.signal,
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload?.error || `Meta Ads fetch failed: ${response.status}`);
        }
        setMetaAdsData(payload);
      } catch (error) {
        if (error.name === 'AbortError') return;
        console.error('Meta Ads dashboard fetch failed', error);
        setMetaAdsData(null);
        setMetaAdsError(error.message || 'Unable to load Meta Ads analytics. The staged adapter may not be reachable yet.');
      } finally {
        if (!controller.signal.aborted) setMetaAdsLoading(false);
      }
    };

    loadMetaAdsData();
    return () => controller.abort();
  }, [formatDateInputValue, metaAdsAttributionMode, propertyScopedSelectionId, rangeDates, selectedProperty, shouldUseAnalyticsSummary]);

  const ga4AcquisitionChannels = React.useMemo(() => ga4Data?.Acquisition?.channels || [], [ga4Data]);
  const ga4TopSources = React.useMemo(() => ga4Data?.Acquisition?.topSources || [], [ga4Data]);
  const ga4TrafficByMonth = React.useMemo(() => ga4Data?.Acquisition?.trafficByMonth || [], [ga4Data]);
  const ga4TrafficBySessionSource = React.useMemo(() => ga4Data?.Acquisition?.trafficBySessionSource || [], [ga4Data]);
  const ga4LlmTraffic = React.useMemo(() => ga4Data?.Acquisition?.llmTraffic || [], [ga4Data]);
  const ga4ConversionEvents = React.useMemo(() => ga4Data?.Conversion?.events || [], [ga4Data]);
  const ga4LandingPages = React.useMemo(() => ga4Data?.Conversion?.landingPages || [], [ga4Data]);
  const ga4DeviceBreakdown = React.useMemo(() => ga4Data?.Conversion?.deviceBreakdown || [], [ga4Data]);
  const ga4ConversionByMedium = React.useMemo(() => ga4Data?.Conversion?.conversionByMedium || [], [ga4Data]);
  const ga4ConversionsByDay = React.useMemo(() => ga4Data?.Conversion?.conversionsByDay || [], [ga4Data]);
  const ga4OrganicConversionBreakdown = React.useMemo(() => ga4Data?.Conversion?.organicConversionBreakdown || [], [ga4Data]);
  const ga4Cities = React.useMemo(() => ga4Data?.Geo?.cities || [], [ga4Data]);
  const ga4TopPages = React.useMemo(() => ga4Data?.Diagnostic?.topPages || [], [ga4Data]);
  const ga4ApplyPage = ga4Data?.Diagnostic?.applyPage || null;
  const ga4PathExploration = ga4Data?.Diagnostic?.pathExploration || null;
  const ga4DevicesDetailed = ga4Data?.Diagnostic?.devicesDetailed || [];
  const ga4PagePerformance = ga4Data?.Diagnostic?.pagePerformance || [];
  const ga4CoverageGaps = ga4Data?.CoverageGaps || null;
  const ga4Sessions = ga4Data?.Acquisition?.totals?.current?.sessions ?? null;
  const ga4NewUsers = ga4Data?.Acquisition?.totals?.current?.newUsers ?? null;
  const ga4EventTotal = ga4Data?.Conversion?.totals?.currentEventCount ?? null;
  const googleAdsOverview = googleAdsData?.Overview?.current || null;
  const googleAdsOverviewDelta = googleAdsData?.Overview?.delta || null;
  const googleAdsCampaigns = React.useMemo(() => googleAdsData?.Campaigns || [], [googleAdsData]);
  const googleAdsKeywords = React.useMemo(() => googleAdsData?.Keywords || [], [googleAdsData]);
  const googleAdsConversionActions = React.useMemo(() => googleAdsData?.ConversionActions?.items || [], [googleAdsData]);
  const googleAdsConversionActionNote = googleAdsData?.ConversionActions?.repeatRateNote || null;
  const googleAdsBrandSplit = googleAdsData?.BrandVsNonBrand || null;
  const googleAdsAds = React.useMemo(() => googleAdsData?.Ads?.topAds || [], [googleAdsData]);
  const googleAdsDailyPerformance = React.useMemo(() => googleAdsData?.Ads?.dailyPerformance || [], [googleAdsData]);
  const googleAdsCoverage = googleAdsData?.Coverage || null;
  const metaAdsOverview = metaAdsData?.Overview?.current || null;
  const metaAdsOverviewDelta = metaAdsData?.Overview?.delta || null;
  const metaAdsCampaigns = React.useMemo(() => metaAdsData?.Campaigns || [], [metaAdsData]);
  const metaAdsAdSets = React.useMemo(() => metaAdsData?.AdSets?.items || [], [metaAdsData]);
  const metaAdsPlacements = React.useMemo(() => metaAdsData?.Placements?.items || [], [metaAdsData]);
  const metaAdsTopAds = React.useMemo(() => metaAdsData?.Ads?.topAds || [], [metaAdsData]);
  const metaAdsDailyPerformance = React.useMemo(() => metaAdsData?.Ads?.dailyPerformance || [], [metaAdsData]);
  const metaAdsCoverage = metaAdsData?.Coverage || null;
  const metaAdsScoping = metaAdsData?.Scoping || null;
  const metaAdsAttribution = metaAdsData?.Attribution || null;
  const metaAdsKeyMetrics = metaAdsOverview?.keyMetrics || {};
  const googleAdsTopAd = googleAdsAds[0] || null;
  const ga4StatusMessage = normalizeAnalyticsError(ga4Error);
  const googleAdsStatusMessage = normalizeAnalyticsError(googleAdsError);
  const metaAdsStatusMessage = normalizeAnalyticsError(metaAdsError);
  const ga4Blocked = Boolean(ga4StatusMessage && !ga4Data);
  const metaAdsTopPreview = metaAdsTopAds[0] || null;

  const ga4OutcomeChartData = React.useMemo(() => (
    ga4ConversionEvents.map((item) => ({
      name: shortenLabel(item.eventName, 18),
      value: Number(item.current.eventCount || 0),
    }))
  ), [ga4ConversionEvents, shortenLabel]);
  const ga4AcquisitionChartData = React.useMemo(() => (
    ga4AcquisitionChannels.slice(0, 6).map((item) => ({
      name: shortenLabel(item.channel, 16),
      sessions: Number(item.current.sessions || 0),
      engagement: Number(item.current.engagementRate || 0),
    }))
  ), [ga4AcquisitionChannels, shortenLabel]);
  const ga4TrafficByMonthChartData = React.useMemo(() => (
    ga4TrafficByMonth.map((item) => ({
      name: String(item.month || ''),
      sessions: Number(item.sessions || 0),
      newUsers: Number(item.newUsers || 0),
    }))
  ), [ga4TrafficByMonth]);
  const ga4MarketChartData = React.useMemo(() => (
    ga4Cities.slice(0, 6).map((item) => ({
      name: shortenLabel(item.city || '(not set)', 16),
      users: Number(item.current.totalUsers || 0),
      keyEvents: Number(item.current.keyEvents || 0),
    }))
  ), [ga4Cities, shortenLabel]);
  const ga4DiagnosticChartData = React.useMemo(() => (
    ga4TopPages.slice(0, 6).map((item) => ({
      name: shortenLabel(item.pagePath || '(not set)', 18),
      views: Number(item.current.screenPageViews || 0),
      engagement: Number(item.current.engagementRate || 0),
    }))
  ), [ga4TopPages, shortenLabel]);
  const ga4PathStartChartData = React.useMemo(() => (
    (ga4PathExploration?.startPages || []).slice(0, 5).map((item) => ({
      name: shortenLabel(item.pagePath || '(not set)', 18),
      users: Number(item.activeUsers || 0),
    }))
  ), [ga4PathExploration, shortenLabel]);
  const ga4ConversionByDayChartData = React.useMemo(() => (
    ga4ConversionsByDay.slice(-14).map((item) => ({
      name: String(item.date || '').slice(4, 8),
      keyEvents: Number(item.keyEvents || 0),
      conversionRate: Number(item.conversionRate || 0),
    }))
  ), [ga4ConversionsByDay]);
  const googleAdsCampaignChartData = React.useMemo(() => (
    googleAdsCampaigns.slice(0, 6).map((item) => ({
      name: shortenLabel(item.campaignName, 18),
      clicks: Number(item.current?.clicks || 0),
      conversions: Number(item.current?.conversions || 0),
    }))
  ), [googleAdsCampaigns, shortenLabel]);
  const googleAdsDailyChartData = React.useMemo(() => (
    googleAdsDailyPerformance.slice(-14).map((item) => ({
      name: String(item.date || '').slice(5),
      clicks: Number(item.clicks || 0),
      cost: Number(item.cost || 0),
      conversions: Number(item.conversions || 0),
    }))
  ), [googleAdsDailyPerformance]);
  const googleAdsKeywordChartData = React.useMemo(() => (
    googleAdsKeywords.slice(0, 6).map((item) => ({
      name: shortenLabel(item.keywordText, 18),
      clicks: Number(item.clicks || 0),
      cost: Number(item.cost || 0),
    }))
  ), [googleAdsKeywords, shortenLabel]);
  const metaAdsCampaignChartData = React.useMemo(() => (
    metaAdsCampaigns.slice(0, 6).map((item) => ({
      name: shortenLabel(item.campaignName, 18),
      spend: Number(item.current?.spend || 0),
      clicks: Number(item.current?.clicks || 0),
    }))
  ), [metaAdsCampaigns, shortenLabel]);
  const metaAdsDailyChartData = React.useMemo(() => (
    metaAdsDailyPerformance.slice(-14).map((item) => ({
      name: String(item.date || '').slice(5),
      spend: Number(item.spend || 0),
      clicks: Number(item.clicks || 0),
    }))
  ), [metaAdsDailyPerformance]);

  const renderGa4SectionFallback = (label) => (
    <div className="analytics-placeholder">
      <div className="analytics-placeholder__title">{label} is waiting on GA4 access</div>
      <div className="analytics-placeholder__detail">
        {ga4StatusMessage || 'This section will populate once live GA4 reporting is available for the selected property.'}
      </div>
    </div>
  );

  return <div className="analytics-view">
        <div className="analytics-hero">
          <div className="analytics-hero__top">
            <div>
              <div className="analytics-kicker">Behavioral Intelligence Layer</div>
              <div className="analytics-headline">Analytics</div>
              <div className="analytics-subhead">
                Use this layer to understand traffic quality, conversion intent, geographic pull, and where users hesitate before they become leads or applications.
              </div>
            </div>
            <div className="analytics-chip-row">
              <div className="analytics-chip">{selectedPropertyLabel}</div>
              <div className="analytics-chip">
                {selectedProperty?.googleAnalyticsId ? `GA4 ${selectedProperty.googleAnalyticsId}` : 'GA4 ID missing'}
              </div>
              <div className="analytics-chip">
                {selectedProperty?.googleAdsId ? `Google Ads ${selectedProperty.googleAdsId}` : 'Google Ads ID missing'}
              </div>
              <div className="analytics-chip">
                {rangeDates.start.toLocaleDateString()} - {rangeDates.end.toLocaleDateString()}
              </div>
              <div className={analyticsSourceBadge.className}>{analyticsSourceBadge.label}</div>
            </div>
          </div>

          <div className="analytics-kpis">
            <div className="analytics-kpi">
              <div className="analytics-kpi__label">Sessions</div>
              <div className="analytics-kpi__value">{renderMetricValue(ga4Loading, ga4Blocked ? 'Locked' : formatNumber(ga4Sessions))}</div>
              <div className="analytics-kpi__meta">{ga4Blocked ? 'GA4 access required for this property' : 'Current period traffic volume'}</div>
            </div>
            <div className="analytics-kpi">
              <div className="analytics-kpi__label">New Users</div>
              <div className="analytics-kpi__value">{renderMetricValue(ga4Loading, ga4Blocked ? 'Locked' : formatNumber(ga4NewUsers))}</div>
              <div className="analytics-kpi__meta">{ga4Blocked ? 'Pending GA4 property access' : 'Fresh demand entering the funnel'}</div>
            </div>
            <div className="analytics-kpi">
              <div className="analytics-kpi__label">Tracked Events</div>
              <div className="analytics-kpi__value">{renderMetricValue(ga4Loading, ga4Blocked ? 'Locked' : formatNumber(ga4EventTotal))}</div>
              <div className="analytics-kpi__meta">{ga4Blocked ? 'Pending GA4 property access' : 'High-intent actions across the site'}</div>
            </div>
            <div className="analytics-kpi">
              <div className="analytics-kpi__label">Apply Drop-off</div>
              <div className="analytics-kpi__value">{renderMetricValue(ga4Loading, ga4Blocked ? 'Locked' : formatPercent(ga4ApplyPage?.abandonmentRate, 0))}</div>
              <div className="analytics-kpi__meta">{ga4Blocked ? 'Pending GA4 property access' : 'Proxy for friction on the apply flow'}</div>
            </div>
          </div>
        </div>

        <div className="analytics-grid">
        {ga4Blocked && (
          <div className="analytics-status analytics-status--warning" style={{ gridColumn: 'span 4' }}>
            <div className="analytics-status__title">GA4 access status</div>
            <div className="analytics-status__detail">{ga4StatusMessage}</div>
          </div>
        )}
        <div className="analytics-panel analytics-panel--dark" style={{ gridColumn: 'span 2' }}>
          <div className="analytics-panel__eyebrow">Outcome View</div>
          <div className="analytics-panel__title">What users actually did</div>
          <div className="analytics-panel__subhead">
            Focus on the actions that indicate real leasing intent, plus the entry pages and devices that triggered them.
          </div>
          {ga4Loading ? (
            <div className="analytics-note">Loading conversion analytics…</div>
          ) : ga4Blocked ? (
            renderGa4SectionFallback('Outcome view')
          ) : (
            <div className="analytics-stack">
              {ga4OutcomeChartData.length > 0 && (
                <MeasuredChart className="analytics-chart">
                  {({ width, height }) => (
                    <BarChart width={width} height={height} data={ga4OutcomeChartData} margin={CHART_MARGIN_STANDARD}>
                      <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_DARK} vertical={false} />
                      <XAxis dataKey="name" stroke={CHART_AXIS_DARK} tick={{ fontSize: 11, fill: CHART_COLOR_TAN }} interval={0} />
                      <YAxis stroke={CHART_AXIS_DARK_SOFT} tick={{ fontSize: 11, fill: CHART_COLOR_TAN }} />
                      <Tooltip contentStyle={CHART_TOOLTIP_STYLE} labelStyle={CHART_TOOLTIP_LABEL_STYLE} itemStyle={CHART_TOOLTIP_ITEM_STYLE} />
                      <Bar dataKey="value" fill={CHART_COLOR_GOLD} radius={[6, 6, 0, 0]} />
                    </BarChart>
                  )}
                </MeasuredChart>
              )}
              {ga4ConversionByDayChartData.length > 0 && (
                <MeasuredChart className="analytics-chart">
                  {({ width, height }) => (
                    <LineChart width={width} height={height} data={ga4ConversionByDayChartData} margin={CHART_MARGIN_STANDARD}>
                      <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_DARK} vertical={false} />
                      <XAxis dataKey="name" stroke={CHART_AXIS_DARK} tick={{ fontSize: 11, fill: CHART_COLOR_TAN }} />
                      <YAxis yAxisId="left" stroke={CHART_AXIS_DARK_SOFT} tick={{ fontSize: 11, fill: CHART_COLOR_TAN }} />
                      <YAxis yAxisId="right" orientation="right" stroke={CHART_AXIS_DARK_SOFT} tick={{ fontSize: 11, fill: CHART_COLOR_TAN }} tickFormatter={(value) => `${Math.round(value * 100)}%`} />
                      <Tooltip contentStyle={CHART_TOOLTIP_STYLE} labelStyle={CHART_TOOLTIP_LABEL_STYLE} itemStyle={CHART_TOOLTIP_ITEM_STYLE} />
                      <Bar yAxisId="left" dataKey="keyEvents" fill={CHART_COLOR_GREEN} radius={[6, 6, 0, 0]} />
                      <Line yAxisId="right" type="monotone" dataKey="conversionRate" stroke={CHART_COLOR_SECONDARY_TAN} strokeWidth={2} dot={{ r: 3, fill: CHART_COLOR_SECONDARY_TAN }} />
                    </LineChart>
                  )}
                </MeasuredChart>
              )}
              {ga4ConversionEvents.map((item) => (
                <div key={item.eventName} className="analytics-row analytics-row--split">
                  <div>
                    <div className="analytics-row__title">{item.eventName}</div>
                    <div className="analytics-row__detail">High-intent action volume in the selected window.</div>
                  </div>
                  <div style={{ display: 'grid', gap: '0.4rem', justifyItems: 'end' }}>
                    <div className="analytics-row__metric">{formatNumber(item.current.eventCount)} current</div>
                    <div className={`analytics-pill analytics-pill--${getDeltaTone(item.delta.eventCount)}`}>
                      {formatSignedPercent(item.delta.eventCount, 1)} vs prior
                    </div>
                  </div>
                </div>
              ))}
              {ga4LandingPages.slice(0, 3).map((item) => (
                <div key={item.landingPagePlusQueryString || '(not set)'} className="analytics-row">
                  <div className="analytics-row__title">{item.landingPagePlusQueryString || '(not set)'}</div>
                  <div className="analytics-row__detail">
                    Top landing page by tracked conversion actions with {formatNumber(item.current.eventCount)} event-driven conversions.
                  </div>
                </div>
              ))}
              {ga4DeviceBreakdown.length > 0 && (
                <div className="analytics-row">
                  <div className="analytics-row__title">Device conversion mix</div>
                  <div className="analytics-row__detail">
                    {ga4DeviceBreakdown.map((item) => `${item.deviceCategory} ${formatNumber(item.current.eventCount)}`).join(' | ')}
                  </div>
                </div>
              )}
              {ga4ConversionByMedium.slice(0, 4).map((item) => (
                <div key={item.firstUserMedium} className="analytics-row analytics-row--split">
                  <div>
                    <div className="analytics-row__title">First user medium: {item.firstUserMedium}</div>
                    <div className="analytics-row__detail">{formatNumber(item.keyEvents)} key events across {formatNumber(item.totalUsers)} users</div>
                  </div>
                  <div className="analytics-row__metric">{formatPercent(item.conversionRate, 1)}</div>
                </div>
              ))}
              {ga4OrganicConversionBreakdown.slice(0, 5).map((item) => (
                <div key={item.eventName} className="analytics-row analytics-row--split">
                  <div className="analytics-row__title">Organic event: {item.eventName}</div>
                  <div className="analytics-row__metric">{formatNumber(item.eventCount)}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="analytics-panel analytics-panel--dark" style={{ gridColumn: 'span 2' }}>
          <div className="analytics-panel__eyebrow">Acquisition View</div>
          <div className="analytics-panel__title">Is the traffic quality right?</div>
          <div className="analytics-panel__subhead">
            Compare channels by volume, freshness, and engagement so the team can tell whether demand is merely arriving or actually paying attention.
          </div>
          {ga4Loading ? (
            <div className="analytics-note">Loading acquisition analytics…</div>
          ) : ga4Blocked ? (
            renderGa4SectionFallback('Acquisition view')
          ) : (
            <div className="analytics-stack">
              {ga4AcquisitionChartData.length > 0 && (
                <MeasuredChart className="analytics-chart analytics-chart--tall">
                  {({ width, height }) => (
                    <LineChart width={width} height={height} data={ga4AcquisitionChartData} margin={CHART_MARGIN_TALL}>
                      <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_DARK} vertical={false} />
                      <XAxis dataKey="name" stroke={CHART_AXIS_DARK} tick={{ fontSize: 11, fill: CHART_COLOR_TAN }} interval={0} />
                      <YAxis yAxisId="left" stroke={CHART_AXIS_DARK_SOFT} tick={{ fontSize: 11, fill: CHART_COLOR_TAN }} />
                      <YAxis yAxisId="right" orientation="right" stroke={CHART_AXIS_DARK_SOFT} tick={{ fontSize: 11, fill: CHART_COLOR_TAN }} tickFormatter={(value) => `${Math.round(value * 100)}%`} />
                      <Tooltip contentStyle={CHART_TOOLTIP_STYLE} labelStyle={CHART_TOOLTIP_LABEL_STYLE} itemStyle={CHART_TOOLTIP_ITEM_STYLE} />
                      <Bar yAxisId="left" dataKey="sessions" fill={CHART_COLOR_GREEN} radius={[6, 6, 0, 0]} />
                      <Line yAxisId="right" type="monotone" dataKey="engagement" stroke={CHART_COLOR_SECONDARY_TAN} strokeWidth={2} dot={{ r: 3, fill: CHART_COLOR_SECONDARY_TAN }} />
                    </LineChart>
                  )}
                </MeasuredChart>
              )}
              {ga4TrafficByMonthChartData.length > 0 && (
                <MeasuredChart className="analytics-chart">
                  {({ width, height }) => (
                    <AreaChart width={width} height={height} data={ga4TrafficByMonthChartData} margin={CHART_MARGIN_STANDARD}>
                      <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_DARK} vertical={false} />
                      <XAxis dataKey="name" stroke={CHART_AXIS_DARK} tick={{ fontSize: 11, fill: CHART_COLOR_TAN }} />
                      <YAxis stroke={CHART_AXIS_DARK_SOFT} tick={{ fontSize: 11, fill: CHART_COLOR_TAN }} />
                      <Tooltip contentStyle={CHART_TOOLTIP_STYLE} labelStyle={CHART_TOOLTIP_LABEL_STYLE} itemStyle={CHART_TOOLTIP_ITEM_STYLE} />
                      <Area type="monotone" dataKey="sessions" stroke={CHART_COLOR_PINK} fill={CHART_COLOR_PINK} fillOpacity={0.16} strokeWidth={2} />
                      <Line type="monotone" dataKey="newUsers" stroke={CHART_COLOR_SECONDARY_TAN} strokeWidth={2} dot={{ r: 2, fill: CHART_COLOR_SECONDARY_TAN }} />
                    </AreaChart>
                  )}
                </MeasuredChart>
              )}
              {ga4AcquisitionChannels.slice(0, 6).map((item) => (
                <div key={item.channel} className="analytics-row analytics-row--triple">
                  <div>
                    <div className="analytics-row__title">{item.channel}</div>
                    <div className="analytics-row__detail">{formatNumber(item.current.newUsers)} new users</div>
                  </div>
                  <div className="analytics-row__metric">{formatNumber(item.current.sessions)} sessions</div>
                  <div style={{ display: 'grid', gap: '0.35rem', justifyItems: 'end' }}>
                    <div className="analytics-row__metric">{formatPercent(item.current.engagementRate, 1)} engaged</div>
                    <div className={`analytics-pill analytics-pill--${getDeltaTone(item.delta.sessions)}`}>
                      {formatSignedPercent(item.delta.sessions, 1)}
                    </div>
                  </div>
                </div>
              ))}
              {ga4TopSources.slice(0, 4).map((item) => (
                <div key={`${item.sessionSource}-${item.sessionMedium}`} className="analytics-row analytics-row--split">
                  <div>
                    <div className="analytics-row__title">{item.sessionSource} / {item.sessionMedium}</div>
                    <div className="analytics-row__detail">
                      {formatNumber(item.current.screenPageViews)} views | {formatPercent(item.current.engagementRate, 1)} engagement | {formatPercent(item.conversionRate, 1)} conversion rate
                    </div>
                  </div>
                  <div className={`analytics-pill analytics-pill--${getDeltaTone(item.delta.sessions)}`}>
                    {formatSignedPercent(item.delta.sessions, 1)}
                  </div>
                </div>
              ))}
              {ga4LlmTraffic.length > 0 && (
                <div className="analytics-row">
                  <div className="analytics-row__title">LLM traffic</div>
                  <div className="analytics-row__detail">
                    {ga4LlmTraffic.map((item) => `${item.dimensions?.sessionSource || '(not set)'} ${formatNumber(item.metrics?.sessions || 0)} sessions`).join(' | ')}
                  </div>
                </div>
              )}
              {ga4TrafficBySessionSource.length > 0 && (
                <div className="analytics-row">
                  <div className="analytics-row__title">Organic traffic by search source</div>
                  <div className="analytics-row__detail">
                    {ga4TrafficBySessionSource.slice(0, 5).map((item) => `${item.sessionSource} ${formatNumber(item.sessions)}`).join(' | ')}
                  </div>
                </div>
              )}
              <div className="analytics-note">
                Search Console query-level intent is the next recommended feed for branded vs generic search analysis.
              </div>
            </div>
          )}
        </div>

        <div className="analytics-panel analytics-panel--light" style={{ gridColumn: 'span 2' }}>
          <div className="analytics-panel__eyebrow">Market View</div>
          <div className="analytics-panel__title">Where demand is pulling from</div>
          <div className="analytics-panel__subhead">
            Geographic concentration helps regional teams spot relocation corridors, neighboring-city lift, and out-of-market curiosity worth acting on.
          </div>
          {ga4Loading ? (
            <div className="analytics-note">Loading market analytics…</div>
          ) : ga4Blocked ? (
            renderGa4SectionFallback('Market view')
          ) : (
            <div className="analytics-stack">
              {ga4MarketChartData.length > 0 && (
                <MeasuredChart className="analytics-chart analytics-chart--tall">
                  {({ width, height }) => (
                    <BarChart width={width} height={height} data={ga4MarketChartData} margin={CHART_MARGIN_TALL}>
                      <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_LIGHT} vertical={false} />
                      <XAxis dataKey="name" stroke={CHART_AXIS_LIGHT} tick={{ fontSize: 11, fill: CHART_COLOR_TAN }} />
                      <YAxis stroke={CHART_AXIS_LIGHT_SOFT} tick={{ fontSize: 11, fill: CHART_COLOR_TAN }} />
                      <Tooltip contentStyle={CHART_TOOLTIP_STYLE} labelStyle={CHART_TOOLTIP_LABEL_STYLE} itemStyle={CHART_TOOLTIP_ITEM_STYLE} />
                      <Bar dataKey="users" fill={CHART_COLOR_GREEN} radius={[6, 6, 0, 0]} />
                      <Bar dataKey="keyEvents" fill={CHART_COLOR_ORANGE} radius={[6, 6, 0, 0]} />
                    </BarChart>
                  )}
                </MeasuredChart>
              )}
              {ga4Cities.slice(0, 8).map((item) => (
                <div key={item.city || '(not set)'} className="analytics-row analytics-row--split">
                  <div>
                    <div className="analytics-row__title">{item.city || '(not set)'}</div>
                    <div className="analytics-row__detail">
                      <span className={`analytics-pill analytics-pill--${getDeltaTone(item.delta.totalUsers)}`}>
                        {formatSignedPercent(item.delta.totalUsers, 1)} users vs prior
                      </span>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', display: 'grid', gap: '0.3rem' }}>
                    <div className="analytics-row__metric">{formatNumber(item.current.totalUsers)} users</div>
                    <div className="analytics-row__detail">{formatNumber(item.current.keyEvents)} key events</div>
                  </div>
                </div>
              ))}
              <div className="analytics-note">
                GBP rank, share of local voice, and map heatmap pins can slot into this section next.
              </div>
            </div>
          )}
        </div>

        <div className="analytics-panel analytics-panel--light" style={{ gridColumn: 'span 2' }}>
          <div className="analytics-panel__eyebrow">Diagnostics View</div>
          <div className="analytics-panel__title">Where users hesitate or leave</div>
          <div className="analytics-panel__subhead">
            This is the friction layer: apply-flow weakness, engagement drop-offs, and the pages that deserve UX or messaging attention.
          </div>
          {ga4Loading ? (
            <div className="analytics-note">Loading drop-off diagnostics…</div>
          ) : ga4Blocked ? (
            renderGa4SectionFallback('Diagnostics view')
          ) : (
            <div className="analytics-stack">
              <div className="analytics-callout">
                <div className="analytics-panel__eyebrow">Apply Page</div>
                <div className="analytics-callout__value">{formatPercent(ga4ApplyPage?.abandonmentRate, 0)}</div>
                <div className="analytics-row__detail">
                  {formatNumber(ga4ApplyPage?.currentViews)} views | {formatNumber(ga4ApplyPage?.applicationSubmittedEvents)} submitted events
                </div>
              </div>
              {ga4PathExploration && (
                <div className="analytics-path-module">
                  <div className="analytics-panel__eyebrow">GA4 Path Exploration</div>
                  <div className="analytics-row__detail">
                    Starting at <strong>{ga4PathExploration.startingPoint}</strong> across {formatNumber(ga4PathExploration.startingUsers)} tracked starts.
                  </div>
                  {ga4PathStartChartData.length > 0 && (
                    <MeasuredChart className="analytics-chart">
                      {({ width, height }) => (
                        <BarChart width={width} height={height} data={ga4PathStartChartData} margin={CHART_MARGIN_STANDARD}>
                          <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_LIGHT} vertical={false} />
                          <XAxis dataKey="name" stroke={CHART_AXIS_LIGHT} tick={{ fontSize: 11, fill: CHART_COLOR_TAN }} interval={0} />
                          <YAxis stroke={CHART_AXIS_LIGHT_SOFT} tick={{ fontSize: 11, fill: CHART_COLOR_TAN }} />
                          <Tooltip contentStyle={CHART_TOOLTIP_STYLE} labelStyle={CHART_TOOLTIP_LABEL_STYLE} itemStyle={CHART_TOOLTIP_ITEM_STYLE} />
                          <Bar dataKey="users" fill={CHART_COLOR_GREEN} radius={[6, 6, 0, 0]} />
                        </BarChart>
                      )}
                    </MeasuredChart>
                  )}
                  <div className="analytics-path-branches">
                    {(ga4PathExploration.branches || []).slice(0, 4).map((branch) => (
                      <div key={branch.entryPage} className="analytics-path-branch">
                        <div className="analytics-path-branch__head">
                          <div>
                            <div className="analytics-row__title">{branch.entryPage || '(not set)'}</div>
                            <div className="analytics-row__detail">
                              {formatNumber(branch.entryUsers)} starts | {formatPercent(branch.shareOfStarts, 1)} of total starts
                            </div>
                          </div>
                          <div className="analytics-pill analytics-pill--neutral">
                            {formatPercent(branch.shownContinuationRate, 0)} shown continuation
                          </div>
                        </div>
                        <div className="analytics-path-list">
                          {(branch.nextSteps || []).slice(0, 4).map((step) => (
                            <div key={`${branch.entryPage}-${step.pagePath}`} className="analytics-path-step">
                              <div className="analytics-path-step__meta">
                                <span className="analytics-row__title">{step.pagePath || '(not set)'}</span>
                                <span className="analytics-row__metric">{formatNumber(step.activeUsers)}</span>
                              </div>
                              <div className="analytics-path-step__bar">
                                <span style={{ width: `${Math.max(6, Math.round((step.shareOfParent || 0) * 100))}%` }} />
                              </div>
                              <div className="analytics-row__detail">{formatPercent(step.shareOfParent, 1)} of this branch</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                  {ga4PathExploration.note && <div className="analytics-note">{ga4PathExploration.note}</div>}
                </div>
              )}
              {ga4DiagnosticChartData.length > 0 && (
                <MeasuredChart className="analytics-chart analytics-chart--tall">
                  {({ width, height }) => (
                    <AreaChart width={width} height={height} data={ga4DiagnosticChartData} margin={CHART_MARGIN_TALL}>
                      <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_LIGHT} vertical={false} />
                      <XAxis dataKey="name" stroke={CHART_AXIS_LIGHT} tick={{ fontSize: 11, fill: CHART_COLOR_TAN }} interval={0} />
                      <YAxis yAxisId="left" stroke={CHART_AXIS_LIGHT_SOFT} tick={{ fontSize: 11, fill: CHART_COLOR_TAN }} />
                      <YAxis yAxisId="right" orientation="right" stroke={CHART_AXIS_LIGHT_SOFT} tick={{ fontSize: 11, fill: CHART_COLOR_TAN }} tickFormatter={(value) => `${Math.round(value * 100)}%`} />
                      <Tooltip contentStyle={CHART_TOOLTIP_STYLE} labelStyle={CHART_TOOLTIP_LABEL_STYLE} itemStyle={CHART_TOOLTIP_ITEM_STYLE} />
                      <Area yAxisId="left" type="monotone" dataKey="views" stroke={CHART_COLOR_GOLD} fill={CHART_COLOR_GOLD} fillOpacity={0.14} strokeWidth={2} />
                      <Line yAxisId="right" type="monotone" dataKey="engagement" stroke={CHART_COLOR_GREEN} strokeWidth={2} dot={{ r: 3, fill: CHART_COLOR_GREEN }} />
                    </AreaChart>
                  )}
                </MeasuredChart>
              )}
              {ga4TopPages.slice(0, 6).map((item) => (
                <div key={item.pagePath || '(not set)'} className="analytics-row">
                  <div className="analytics-row__title">{item.pagePath || '(not set)'}</div>
                  <div className="analytics-row__detail">
                    {formatNumber(item.current.screenPageViews)} views | {formatNumber(item.current.userEngagementDuration, 0)} sec engaged | {formatPercent(item.current.engagementRate, 1)} engagement
                  </div>
                </div>
              ))}
              {ga4DevicesDetailed.slice(0, 3).map((item) => (
                <div key={item.deviceCategory} className="analytics-row analytics-row--split">
                  <div>
                    <div className="analytics-row__title">Device: {item.deviceCategory}</div>
                    <div className="analytics-row__detail">
                      {formatNumber(item.engagedSessions)} engaged sessions | {formatNumber(item.screenPageViews)} views | {formatNumber(item.screenPageViewsPerSession, 2)} views/session
                    </div>
                  </div>
                  <div className="analytics-row__metric">{formatPercent(item.engagementRate, 1)}</div>
                </div>
              ))}
              {ga4PagePerformance.slice(0, 4).map((item) => (
                <div key={item.pageTitle} className="analytics-row analytics-row--split">
                  <div>
                    <div className="analytics-row__title">{item.pageTitle}</div>
                    <div className="analytics-row__detail">
                      {formatNumber(item.sessions)} sessions | {formatNumber(item.userEngagementDuration, 0)} sec engaged | {formatNumber(item.keyEvents)} key events
                    </div>
                  </div>
                  <div className="analytics-row__metric">{formatPercent(item.engagementRate, 1)}</div>
                </div>
              ))}
              {ga4ApplyPage?.note && <div className="analytics-note">{ga4ApplyPage.note}</div>}
            </div>
          )}
        </div>

        <div className="analytics-panel analytics-panel--search" style={{ gridColumn: 'span 4' }}>
          <div className="analytics-panel__eyebrow">Paid Search Layer</div>
          <div className="analytics-panel__title">Google Search Ads</div>
          <div className="analytics-panel__subhead">
            Search-only paid media performance, keyword depth, branded demand mix, and the actual ad creative that is showing on desktop.
          </div>
          {googleAdsLoading ? (
            <div className="analytics-note">Loading Google Ads search performance…</div>
          ) : googleAdsStatusMessage ? (
            <div className="analytics-note">{googleAdsStatusMessage}</div>
          ) : (
            <div className="analytics-search-grid">
              <div className="analytics-search-card analytics-search-card--wide">
                <div className="analytics-panel__eyebrow">Conversion Actions</div>
                <div className="analytics-panel__subhead" style={{ marginBottom: 0 }}>
                  Imported and native Google Ads conversion actions, with totals by action type for the selected window.
                </div>
                <div className="analytics-conversion-table">
                  <div className="analytics-conversion-table__head">Action</div>
                  <div className="analytics-conversion-table__head">Source</div>
                  <div className="analytics-conversion-table__head">Optimization</div>
                  <div className="analytics-conversion-table__head">Count</div>
                  <div className="analytics-conversion-table__head">Included</div>
                  <div className="analytics-conversion-table__head">All conv.</div>
                  <div className="analytics-conversion-table__head">Value</div>
                  <div className="analytics-conversion-table__head">Repeat</div>
                  {googleAdsConversionActions.slice(0, 12).map((item) => (
                    <React.Fragment key={item.conversionActionId || item.name}>
                      <div className="analytics-conversion-table__cell">
                        <div className="analytics-row__title">{item.name}</div>
                        <div className="analytics-row__detail">{item.category || item.type || 'Conversion action'}</div>
                      </div>
                      <div className="analytics-conversion-table__cell">{item.source || '—'}</div>
                      <div className="analytics-conversion-table__cell">{item.primaryForGoal ? 'Primary' : 'Secondary'}</div>
                      <div className="analytics-conversion-table__cell">{item.countingType === 'MANY_PER_CLICK' ? 'Every' : item.countingType === 'ONE_PER_CLICK' ? 'One' : '—'}</div>
                      <div className="analytics-conversion-table__cell">{item.includeInConversionsMetric ? 'Yes' : 'No'}</div>
                      <div className="analytics-conversion-table__cell">{formatNumber(item.allConversions, 2)}</div>
                      <div className="analytics-conversion-table__cell">{formatNumber(item.allConversionsValue, 2)}</div>
                      <div className="analytics-conversion-table__cell">{item.repeatRateAvailable ? formatNumber(item.repeatRate, 2) : '—'}</div>
                    </React.Fragment>
                  ))}
                </div>
                {googleAdsConversionActionNote && (
                  <div className="analytics-note">{googleAdsConversionActionNote}</div>
                )}
              </div>

              <div className="analytics-search-card">
                <div className="analytics-panel__eyebrow">Paid Search Overview</div>
                <div className="analytics-search-kpis">
                  <div className="analytics-search-kpi">
                    <span className="analytics-search-kpi__label">Impressions</span>
                    <strong>{formatNumber(googleAdsOverview?.impressions)}</strong>
                  </div>
                  <div className="analytics-search-kpi">
                    <span className="analytics-search-kpi__label">Clicks</span>
                    <strong>{formatNumber(googleAdsOverview?.clicks)}</strong>
                  </div>
                  <div className="analytics-search-kpi">
                    <span className="analytics-search-kpi__label">Cost</span>
                    <strong>{formatCurrency(googleAdsOverview?.cost)}</strong>
                  </div>
                  <div className="analytics-search-kpi">
                    <span className="analytics-search-kpi__label">Conversions</span>
                    <strong>{formatNumber(googleAdsOverview?.conversions, 1)}</strong>
                  </div>
                </div>
                <div className="analytics-search-inline">
                  <span>CTR {formatPercent(googleAdsOverview?.ctr, 1)}</span>
                  <span>Avg CPC {formatCurrency(googleAdsOverview?.avgCpc, 2)}</span>
                  <span>Search IS {formatPercent(googleAdsOverview?.searchImpressionShare, 1)}</span>
                  <span className={`analytics-pill analytics-pill--${getDeltaTone(googleAdsOverviewDelta?.clicks)}`}>
                    Clicks {formatSignedPercent(googleAdsOverviewDelta?.clicks, 1)}
                  </span>
                </div>
                {googleAdsDailyChartData.length > 0 && (
                  <MeasuredChart className="analytics-chart analytics-chart--compact">
                    {({ width, height }) => (
                      <AreaChart width={width} height={height} data={googleAdsDailyChartData} margin={CHART_MARGIN_STANDARD}>
                        <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_LIGHT} vertical={false} />
                        <XAxis dataKey="name" stroke={CHART_AXIS_LIGHT} tick={{ fontSize: 11, fill: CHART_COLOR_TAN }} />
                        <YAxis yAxisId="left" stroke={CHART_AXIS_LIGHT_SOFT} tick={{ fontSize: 11, fill: CHART_COLOR_TAN }} />
                        <YAxis yAxisId="right" orientation="right" stroke={CHART_AXIS_LIGHT_SOFT} tick={{ fontSize: 11, fill: CHART_COLOR_TAN }} />
                        <Tooltip contentStyle={CHART_TOOLTIP_STYLE} labelStyle={CHART_TOOLTIP_LABEL_STYLE} itemStyle={CHART_TOOLTIP_ITEM_STYLE} />
                        <Area yAxisId="left" type="monotone" dataKey="clicks" stroke={CHART_COLOR_GOLD} fill={CHART_COLOR_GOLD} fillOpacity={0.16} strokeWidth={2} />
                        <Line yAxisId="right" type="monotone" dataKey="conversions" stroke={CHART_COLOR_ORANGE} strokeWidth={2} dot={{ r: 2, fill: CHART_COLOR_ORANGE }} />
                      </AreaChart>
                    )}
                  </MeasuredChart>
                )}
              </div>

              <div className="analytics-search-card">
                <div className="analytics-panel__eyebrow">Campaign Performance</div>
                {googleAdsCampaignChartData.length > 0 && (
                  <MeasuredChart className="analytics-chart analytics-chart--compact">
                    {({ width, height }) => (
                      <BarChart width={width} height={height} data={googleAdsCampaignChartData} margin={CHART_MARGIN_STANDARD}>
                        <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_LIGHT} vertical={false} />
                        <XAxis dataKey="name" stroke={CHART_AXIS_LIGHT} tick={{ fontSize: 11, fill: CHART_COLOR_TAN }} />
                        <YAxis stroke={CHART_AXIS_LIGHT_SOFT} tick={{ fontSize: 11, fill: CHART_COLOR_TAN }} />
                        <Tooltip contentStyle={CHART_TOOLTIP_STYLE} labelStyle={CHART_TOOLTIP_LABEL_STYLE} itemStyle={CHART_TOOLTIP_ITEM_STYLE} />
                        <Bar dataKey="clicks" fill={CHART_COLOR_GOLD} radius={[6, 6, 0, 0]} />
                        <Bar dataKey="conversions" fill={CHART_COLOR_ORANGE} radius={[6, 6, 0, 0]} />
                      </BarChart>
                    )}
                  </MeasuredChart>
                )}
                <div className="analytics-stack">
                  {googleAdsCampaigns.slice(0, 5).map((item) => (
                    <div key={item.campaignName} className="analytics-row analytics-row--split">
                      <div>
                        <div className="analytics-row__title">{item.campaignName}</div>
                        <div className="analytics-row__detail">
                          {formatNumber(item.current.impressions)} impressions | {formatPercent(item.current.ctr, 1)} CTR | {formatCurrency(item.current.avgCpc, 2)} avg CPC
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', display: 'grid', gap: '0.3rem' }}>
                        <div className="analytics-row__metric">{formatNumber(item.current.conversions, 1)} conv.</div>
                        <div className={`analytics-pill analytics-pill--${getDeltaTone(item.delta?.conversions)}`}>
                          {formatSignedPercent(item.delta?.conversions, 1)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="analytics-search-card">
                <div className="analytics-panel__eyebrow">Keyword Breakdown</div>
                {googleAdsKeywordChartData.length > 0 && (
                  <MeasuredChart className="analytics-chart analytics-chart--compact">
                    {({ width, height }) => (
                      <BarChart width={width} height={height} data={googleAdsKeywordChartData} layout="vertical" margin={CHART_MARGIN_VERTICAL}>
                        <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_LIGHT} horizontal={false} />
                        <XAxis type="number" stroke={CHART_AXIS_LIGHT_SOFT} tick={{ fontSize: 11, fill: CHART_COLOR_TAN }} />
                        <YAxis type="category" dataKey="name" width={120} stroke={CHART_AXIS_LIGHT} tick={{ fontSize: 11, fill: CHART_COLOR_TAN }} />
                        <Tooltip contentStyle={CHART_TOOLTIP_STYLE} labelStyle={CHART_TOOLTIP_LABEL_STYLE} itemStyle={CHART_TOOLTIP_ITEM_STYLE} />
                        <Bar dataKey="clicks" fill={CHART_COLOR_GOLD} radius={[0, 6, 6, 0]} />
                      </BarChart>
                    )}
                  </MeasuredChart>
                )}
                <div className="analytics-stack">
                  {googleAdsKeywords.slice(0, 6).map((item) => (
                    <div key={`${item.keywordText}-${item.matchType}`} className="analytics-row analytics-row--split">
                      <div>
                        <div className="analytics-row__title">{item.keywordText}</div>
                        <div className="analytics-row__detail">
                          {item.matchType} | {item.campaignName} | Search IS {formatPercent(item.searchImpressionShare, 1)}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', display: 'grid', gap: '0.3rem' }}>
                        <div className="analytics-row__metric">{formatNumber(item.clicks)} clicks</div>
                        <div className="analytics-row__detail">{formatCurrency(item.avgCpc, 2)} avg CPC</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="analytics-search-card">
                <div className="analytics-panel__eyebrow">Brand vs Non-Brand</div>
                <div className="analytics-stack">
                  {['brand', 'nonBrand'].map((group) => (
                    <div key={group} className="analytics-row analytics-row--split">
                      <div>
                        <div className="analytics-row__title">{group === 'brand' ? 'Brand' : 'Non-brand'}</div>
                        <div className="analytics-row__detail">
                          {formatNumber(googleAdsBrandSplit?.[group]?.impressions)} impressions | {formatPercent(googleAdsBrandSplit?.[group]?.searchImpressionShare, 1)} search impression share
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', display: 'grid', gap: '0.3rem' }}>
                        <div className="analytics-row__metric">{formatNumber(googleAdsBrandSplit?.[group]?.conversions, 1)} conv.</div>
                        <div className="analytics-row__detail">{formatCurrency(googleAdsBrandSplit?.[group]?.cost)}</div>
                      </div>
                    </div>
                  ))}
                  <div className="analytics-note">
                    Brand logic currently keys off the property name tokens: {(googleAdsBrandSplit?.brandTerms || []).join(', ') || 'No brand terms available'}.
                  </div>
                </div>
              </div>

              <div className="analytics-search-card analytics-search-card--preview">
                <div className="analytics-panel__eyebrow">Desktop Ad Preview</div>
                {googleAdsTopAd ? (
                  <div className="search-ad-preview">
                    <div className="search-ad-preview__meta">Sponsored</div>
                    <div className="search-ad-preview__url">{googleAdsTopAd.displayUrl || googleAdsTopAd.finalUrl || 'example.com'}</div>
                    <div className="search-ad-preview__headline">
                      {(googleAdsTopAd.headlines || []).slice(0, 3).join(' | ')}
                    </div>
                    <div className="search-ad-preview__desc">
                      {(googleAdsTopAd.descriptions || []).slice(0, 2).join(' ')}
                    </div>
                    <div className="search-ad-preview__footer">
                      <span>{googleAdsTopAd.campaignName}</span>
                      <span>{formatNumber(googleAdsTopAd.impressions)} impressions</span>
                      <span>{formatNumber(googleAdsTopAd.clicks)} clicks</span>
                      <span>{formatPercent(googleAdsTopAd.ctr, 1)} CTR</span>
                    </div>
                  </div>
                ) : (
                  <div className="analytics-note">No responsive search ad creative found for the selected window.</div>
                )}
                <div className="analytics-stack">
                  {googleAdsAds.slice(0, 3).map((ad) => (
                    <div key={ad.adId} className="analytics-row analytics-row--split">
                      <div>
                        <div className="analytics-row__title">{ad.campaignName}</div>
                        <div className="analytics-row__detail">
                          {(ad.headlines || []).slice(0, 2).join(' | ')}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', display: 'grid', gap: '0.3rem' }}>
                        <div className="analytics-row__metric">{formatNumber(ad.conversions, 1)} conv.</div>
                        <div className="analytics-row__detail">{formatCurrency(ad.cost)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="analytics-panel analytics-panel--search" style={{ gridColumn: 'span 4' }}>
          <div className="analytics-panel__eyebrow">Paid Social Layer</div>
          <div className="analytics-panel__title">Meta Ads</div>
          <div className="analytics-panel__subhead">
            Active Meta campaigns only, with strict property scoping, conversion actions, ad set and placement detail, plus a creative preview for the top-spend ad.
          </div>
          <div className="analytics-search-inline" style={{ marginBottom: '0.9rem' }}>
            {[
              ['account_default', 'Account default'],
              ['7d_click_1d_view', '7d click / 1d view'],
              ['1d_click', '1d click'],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setMetaAdsAttributionMode(value)}
                className={`analytics-pill analytics-pill--${metaAdsAttributionMode === value ? 'positive' : 'neutral'}`}
                style={{ border: 'none', cursor: 'pointer' }}
              >
                {label}
              </button>
            ))}
          </div>
          {metaAdsLoading ? (
            <div className="analytics-note">Loading Meta Ads campaign performance…</div>
          ) : metaAdsStatusMessage ? (
            <div className="analytics-note">{metaAdsStatusMessage}</div>
          ) : (
            <div className="analytics-search-grid">
              <div className="analytics-search-card">
                <div className="analytics-panel__eyebrow">Paid Social Overview</div>
                <div className="analytics-search-kpis">
                  <div className="analytics-search-kpi">
                    <span className="analytics-search-kpi__label">Impressions</span>
                    <strong>{formatNumber(metaAdsOverview?.impressions)}</strong>
                  </div>
                  <div className="analytics-search-kpi">
                    <span className="analytics-search-kpi__label">Clicks</span>
                    <strong>{formatNumber(metaAdsOverview?.clicks)}</strong>
                  </div>
                  <div className="analytics-search-kpi">
                    <span className="analytics-search-kpi__label">Spend</span>
                    <strong>{formatCurrency(metaAdsOverview?.spend)}</strong>
                  </div>
                  <div className="analytics-search-kpi">
                    <span className="analytics-search-kpi__label">Leads</span>
                    <strong>{formatNumber(metaAdsKeyMetrics.leads, 1)}</strong>
                  </div>
                </div>
                <div className="analytics-search-inline">
                  <span>CTR {formatPercent(metaAdsOverview?.ctr, 1)}</span>
                  <span>CPC {formatCurrency(metaAdsOverview?.cpc, 2)}</span>
                  <span>CPM {formatCurrency(metaAdsOverview?.cpm, 2)}</span>
                  <span>Freq {formatNumber(metaAdsOverview?.frequency, 2)}</span>
                  <span className={`analytics-pill analytics-pill--${getDeltaTone(metaAdsOverviewDelta?.clicks)}`}>
                    Clicks {formatSignedPercent(metaAdsOverviewDelta?.clicks, 1)}
                  </span>
                </div>
                <div className="analytics-stack">
                  <div className="analytics-row analytics-row--split">
                    <div>
                      <div className="analytics-row__title">Fixed Funnel Metrics</div>
                      <div className="analytics-row__detail">
                        Leads {formatNumber(metaAdsKeyMetrics.leads, 0)} | LPVs {formatNumber(metaAdsKeyMetrics.landingPageViews, 0)} | Link clicks {formatNumber(metaAdsKeyMetrics.linkClicks, 0)} | Outbound clicks {formatNumber(metaAdsKeyMetrics.outboundClicks, 0)}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', display: 'grid', gap: '0.3rem' }}>
                      <div className="analytics-row__metric">{formatCurrency(metaAdsOverview?.costPerResult, 2)}</div>
                      <div className="analytics-row__detail">Primary result: {metaAdsOverview?.resultLabel || '—'}</div>
                    </div>
                  </div>
                  {metaAdsAttribution?.label && (
                    <div className="analytics-note">
                      Attribution mode: {metaAdsAttribution.label}
                    </div>
                  )}
                  {metaAdsScoping?.note && (
                    <div className="analytics-note">
                      {metaAdsScoping.note} Matched campaigns: {formatNumber((metaAdsScoping.matchedCampaignIds || []).length, 0)}.
                    </div>
                  )}
                </div>
                {metaAdsDailyChartData.length > 0 && (
                  <MeasuredChart className="analytics-chart analytics-chart--compact">
                    {({ width, height }) => (
                      <AreaChart width={width} height={height} data={metaAdsDailyChartData} margin={CHART_MARGIN_STANDARD}>
                        <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_LIGHT} vertical={false} />
                        <XAxis dataKey="name" stroke={CHART_AXIS_LIGHT} tick={{ fontSize: 11, fill: CHART_COLOR_TAN }} />
                        <YAxis yAxisId="left" stroke={CHART_AXIS_LIGHT_SOFT} tick={{ fontSize: 11, fill: CHART_COLOR_TAN }} />
                        <YAxis yAxisId="right" orientation="right" stroke={CHART_AXIS_LIGHT_SOFT} tick={{ fontSize: 11, fill: CHART_COLOR_TAN }} />
                        <Tooltip contentStyle={CHART_TOOLTIP_STYLE} labelStyle={CHART_TOOLTIP_LABEL_STYLE} itemStyle={CHART_TOOLTIP_ITEM_STYLE} />
                        <Area yAxisId="left" type="monotone" dataKey="spend" stroke={CHART_COLOR_PINK} fill={CHART_COLOR_PINK} fillOpacity={0.16} strokeWidth={2} />
                        <Line yAxisId="right" type="monotone" dataKey="clicks" stroke={CHART_COLOR_ORANGE} strokeWidth={2} dot={{ r: 2, fill: CHART_COLOR_ORANGE }} />
                      </AreaChart>
                    )}
                  </MeasuredChart>
                )}
              </div>

              <div className="analytics-search-card">
                <div className="analytics-panel__eyebrow">Active Campaigns</div>
                {metaAdsCampaignChartData.length > 0 && (
                  <MeasuredChart className="analytics-chart analytics-chart--compact">
                    {({ width, height }) => (
                      <BarChart width={width} height={height} data={metaAdsCampaignChartData} margin={CHART_MARGIN_STANDARD}>
                        <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_LIGHT} vertical={false} />
                        <XAxis dataKey="name" stroke={CHART_AXIS_LIGHT} tick={{ fontSize: 11, fill: CHART_COLOR_TAN }} />
                        <YAxis stroke={CHART_AXIS_LIGHT_SOFT} tick={{ fontSize: 11, fill: CHART_COLOR_TAN }} />
                        <Tooltip contentStyle={CHART_TOOLTIP_STYLE} labelStyle={CHART_TOOLTIP_LABEL_STYLE} itemStyle={CHART_TOOLTIP_ITEM_STYLE} />
                        <Bar dataKey="spend" fill={CHART_COLOR_PINK} radius={[8, 8, 0, 0]} barSize={22} />
                      </BarChart>
                    )}
                  </MeasuredChart>
                )}
                <div className="analytics-stack">
                  {metaAdsCampaigns.slice(0, 6).map((item) => (
                    <div key={item.campaignId || item.campaignName} className="analytics-row analytics-row--split">
                      <div>
                        <div className="analytics-row__title">{item.campaignName}</div>
                        <div className="analytics-row__detail">
                          {item.effectiveStatus || item.status || 'Status unavailable'} | {item.objective || 'Objective unavailable'} | Freq {formatNumber(item.current?.frequency, 2)}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', display: 'grid', gap: '0.3rem' }}>
                        <div className="analytics-row__metric">{formatCurrency(item.current?.spend)}</div>
                        <div className="analytics-row__detail">
                          Leads {formatNumber(item.current?.keyMetrics?.leads, 0)} | LPVs {formatNumber(item.current?.keyMetrics?.landingPageViews, 0)}
                        </div>
                      </div>
                    </div>
                  ))}
                  {metaAdsCampaigns.length === 0 && (
                    <div className="analytics-note">No active Meta campaigns returned for this date range.</div>
                  )}
                </div>
              </div>

              <div className="analytics-search-card">
                <div className="analytics-panel__eyebrow">Placements</div>
                <div className="analytics-stack">
                  {metaAdsPlacements.slice(0, 6).map((item, index) => (
                    <div key={`${item.publisherPlatform}-${item.platformPosition}-${item.impressionDevice}-${index}`} className="analytics-row analytics-row--split">
                      <div>
                        <div className="analytics-row__title">
                          {item.publisherPlatform} / {item.platformPosition}
                        </div>
                        <div className="analytics-row__detail">
                          {item.impressionDevice} | CTR {formatPercent(item.ctr, 1)} | Freq {formatNumber(item.frequency, 2)}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', display: 'grid', gap: '0.3rem' }}>
                        <div className="analytics-row__metric">{formatCurrency(item.spend)}</div>
                        <div className="analytics-row__detail">Leads {formatNumber(item.keyMetrics?.leads, 0)} | LPVs {formatNumber(item.keyMetrics?.landingPageViews, 0)}</div>
                      </div>
                    </div>
                  ))}
                  {metaAdsPlacements.length === 0 && (
                    <div className="analytics-note">No placement breakdown returned for the selected window.</div>
                  )}
                </div>
              </div>

              <div className="analytics-search-card">
                <div className="analytics-panel__eyebrow">Ad Sets</div>
                <div className="analytics-stack">
                  {metaAdsAdSets.slice(0, 6).map((item) => (
                    <div key={item.id || item.name} className="analytics-row analytics-row--split">
                      <div>
                        <div className="analytics-row__title">{item.name}</div>
                        <div className="analytics-row__detail">
                          {item.campaign_name || 'Campaign unavailable'} | Freq {formatNumber(item.frequency, 2)} | CTR {formatPercent(item.ctr, 1)}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', display: 'grid', gap: '0.3rem' }}>
                        <div className="analytics-row__metric">{formatCurrency(item.spend)}</div>
                        <div className="analytics-row__detail">
                          Leads {formatNumber(item.keyMetrics?.leads, 0)} | LPVs {formatNumber(item.keyMetrics?.landingPageViews, 0)}
                        </div>
                      </div>
                    </div>
                  ))}
                  {metaAdsAdSets.length === 0 && (
                    <div className="analytics-note">No active ad sets returned for the selected window.</div>
                  )}
                </div>
              </div>

              <div className="analytics-search-card analytics-search-card--preview">
                <div className="analytics-panel__eyebrow">Meta Ad Preview</div>
                {metaAdsTopPreview ? (
                  <div className="search-ad-preview">
                    <div className="search-ad-preview__meta">
                      {metaAdsTopPreview.pageName || 'Meta Ad'} | {metaAdsTopPreview.format || 'ad'}
                    </div>
                    {metaAdsTopPreview.mediaUrl && metaAdsTopPreview.format !== 'carousel' && (
                      <img
                        src={metaAdsTopPreview.mediaUrl}
                        alt={metaAdsTopPreview.adName || 'Meta creative'}
                        style={{ width: '100%', borderRadius: '12px', marginBottom: '0.75rem', objectFit: 'cover', maxHeight: '180px', background: 'rgba(16,33,38,0.06)' }}
                      />
                    )}
                    {metaAdsTopPreview.format === 'carousel' && (metaAdsTopPreview.carouselCards || []).length > 0 && (
                      <div style={{ display: 'grid', gap: '0.5rem', marginBottom: '0.75rem' }}>
                        {metaAdsTopPreview.carouselCards.slice(0, 3).map((card, index) => (
                          <div key={`${metaAdsTopPreview.adId}-card-${index}`} style={{ display: 'grid', gridTemplateColumns: card.mediaUrl ? '72px 1fr' : '1fr', gap: '0.75rem', alignItems: 'center', padding: '0.5rem', background: 'rgba(16,33,38,0.04)', borderRadius: '10px' }}>
                            {card.mediaUrl && (
                              <img
                                src={card.mediaUrl}
                                alt={card.headline || `Carousel card ${index + 1}`}
                                style={{ width: '72px', height: '72px', objectFit: 'cover', borderRadius: '8px' }}
                              />
                            )}
                            <div>
                              <div className="analytics-row__title">{card.headline || `Card ${index + 1}`}</div>
                              <div className="analytics-row__detail">{card.description || card.destinationUrl || 'No card description available'}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="search-ad-preview__headline">
                      {metaAdsTopPreview.headline || metaAdsTopPreview.adName || 'Untitled Meta ad'}
                    </div>
                    <div className="search-ad-preview__desc">
                      {metaAdsTopPreview.primaryText || metaAdsTopPreview.description || 'Creative text was not available from the API response for this ad.'}
                    </div>
                    {metaAdsTopPreview.destinationUrl && (
                      <div className="search-ad-preview__url" style={{ marginBottom: '0.5rem' }}>
                        {metaAdsTopPreview.destinationUrl}
                      </div>
                    )}
                    <div className="search-ad-preview__footer">
                      <span>{metaAdsTopPreview.campaignName}</span>
                      <span>{metaAdsTopPreview.callToAction || 'CTA unavailable'}</span>
                      <span>{formatCurrency(metaAdsTopPreview.spend)}</span>
                      <span>LPVs {formatNumber(metaAdsTopPreview.keyMetrics?.landingPageViews, 0)}</span>
                    </div>
                  </div>
                ) : (
                  <div className="analytics-note">No active Meta ad creative was available for preview in the selected window.</div>
                )}
                <div className="analytics-stack">
                  {metaAdsTopAds.slice(0, 3).map((ad) => (
                    <div key={ad.adId} className="analytics-row analytics-row--split">
                      <div>
                        <div className="analytics-row__title">{ad.headline || ad.adName}</div>
                        <div className="analytics-row__detail">
                          {ad.pageName || 'Meta Ad'} | {ad.campaignName} | {ad.callToAction || 'CTA unavailable'}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', display: 'grid', gap: '0.3rem' }}>
                        <div className="analytics-row__metric">{formatCurrency(ad.spend)}</div>
                        <div className="analytics-row__detail">{formatNumber(ad.keyMetrics?.landingPageViews, 0)} LPVs</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
        {(ga4CoverageGaps || googleAdsCoverage || metaAdsCoverage) && (
          <div className="analytics-panel analytics-panel--light" style={{ gridColumn: 'span 4' }}>
            <div className="analytics-panel__eyebrow">Coverage Map</div>
            <div className="analytics-panel__title">What still needs external connectors</div>
            <div className="analytics-panel__subhead">
              The dashboard now covers the GA4-sourced competitor metrics and core Google Search Ads metrics. These remaining items still need dedicated Search Console, Meta, and deeper Google Ads connectors.
            </div>
            <div className="analytics-stack">
              {Object.entries(ga4CoverageGaps || {}).map(([group, items]) => (
                <div key={group} className="analytics-row">
                  <div className="analytics-row__title">{group}</div>
                  <div className="analytics-row__detail">{items.join(' | ')}</div>
                </div>
              ))}
              {googleAdsCoverage && (
                <>
                  <div className="analytics-row">
                    <div className="analytics-row__title">googleAdsIncluded</div>
                    <div className="analytics-row__detail">{(googleAdsCoverage.included || []).join(' | ')}</div>
                  </div>
                  <div className="analytics-row">
                    <div className="analytics-row__title">googleAdsRemaining</div>
                    <div className="analytics-row__detail">{(googleAdsCoverage.remaining || []).join(' | ')}</div>
                  </div>
                </>
              )}
              {metaAdsCoverage && (
                <>
                  <div className="analytics-row">
                    <div className="analytics-row__title">metaAdsIncluded</div>
                    <div className="analytics-row__detail">{(metaAdsCoverage.included || []).join(' | ')}</div>
                  </div>
                  <div className="analytics-row">
                    <div className="analytics-row__title">metaAdsRemaining</div>
                    <div className="analytics-row__detail">{(metaAdsCoverage.remaining || []).join(' | ')}</div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
        </div>
      </div>;
}
