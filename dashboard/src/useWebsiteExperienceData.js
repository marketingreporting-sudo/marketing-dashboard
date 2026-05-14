import React from 'react';
import {
  HEATMAP_PAGES_URL,
  HEATMAP_SUMMARY_URL,
  HEATMAP_TRACKER_HEALTH_URL,
  REPORTING_TAB_SUMMARY_URL,
  SITE_AUDIT_PAGES_URL,
  SITE_AUDIT_RUN_URL,
  SITE_AUDIT_SCREENSHOT_PREVIEW_URL,
  SITE_AUDIT_SUMMARY_URL,
} from './apiConfig';
import { authFetch } from './lib/authFetch';

export default function useWebsiteExperienceData({
  enabled = true,
  formatDateInputValue,
  heatmapSiteKey = '',
  rangeDates,
  selectedPropertyId,
}) {
  const [heatmapPagesLoading, setHeatmapPagesLoading] = React.useState(false);
  const [heatmapSummaryLoading, setHeatmapSummaryLoading] = React.useState(false);
  const [siteAuditLoading, setSiteAuditLoading] = React.useState(false);
  const [siteAuditRunning, setSiteAuditRunning] = React.useState(false);
  const [heatmapPanelError, setHeatmapPanelError] = React.useState(null);
  const [heatmapPagesData, setHeatmapPagesData] = React.useState(null);
  const [heatmapSummaryData, setHeatmapSummaryData] = React.useState(null);
  const [heatmapTrackerHealthData, setHeatmapTrackerHealthData] = React.useState(null);
  const [heatmapTrackerHealthLoading, setHeatmapTrackerHealthLoading] = React.useState(false);
  const [siteAuditPagesData, setSiteAuditPagesData] = React.useState(null);
  const [siteAuditSummaryData, setSiteAuditSummaryData] = React.useState(null);
  const [siteAuditNotice, setSiteAuditNotice] = React.useState(null);
  const [screenshotPreviewUrl, setScreenshotPreviewUrl] = React.useState('');
  const [screenshotPreviewLoading, setScreenshotPreviewLoading] = React.useState(false);
  const [screenshotPreviewError, setScreenshotPreviewError] = React.useState(null);
  const [selectedHeatmapPath, setSelectedHeatmapPath] = React.useState('');
  const [heatmapLayers, setHeatmapLayers] = React.useState({
    click: true,
    cursor: false,
    scroll: false,
    engagement: false,
  });
  const [heatmapLayersTouched, setHeatmapLayersTouched] = React.useState(false);
  const [selectedHeatmapDevice, setSelectedHeatmapDevice] = React.useState('desktop');
  const [highlightedHeatmapTarget, setHighlightedHeatmapTarget] = React.useState(null);
  const [heatmapClickSignalTab, setHeatmapClickSignalTab] = React.useState('top');
  const [websiteExperienceSummaryBypass, setWebsiteExperienceSummaryBypass] = React.useState(false);

  const shouldUseReportingSummary = Boolean(REPORTING_TAB_SUMMARY_URL) && !websiteExperienceSummaryBypass;
  const heatmapPageOptions = React.useMemo(() => heatmapPagesData?.pages || [], [heatmapPagesData]);
  const auditPageOptions = React.useMemo(() => siteAuditPagesData?.pages || [], [siteAuditPagesData]);
  const selectedAuditPage = React.useMemo(() => (
    auditPageOptions.find((page) => (page.path || '/') === selectedHeatmapPath) || auditPageOptions[0] || null
  ), [auditPageOptions, selectedHeatmapPath]);
  const selectedScreenshot = React.useMemo(() => {
    const screenshots = Array.isArray(selectedAuditPage?.screenshots) ? selectedAuditPage.screenshots : [];
    return screenshots.find((item) => item.deviceType === selectedHeatmapDevice) || screenshots[0] || null;
  }, [selectedAuditPage, selectedHeatmapDevice]);
  const heatmapTotals = heatmapSummaryData?.totals || {};

  React.useEffect(() => {
    setWebsiteExperienceSummaryBypass(false);
  }, [heatmapSiteKey, rangeDates, selectedHeatmapDevice, selectedHeatmapPath, selectedPropertyId]);

  React.useEffect(() => {
    if (!enabled || !shouldUseReportingSummary) return undefined;

    if (!selectedPropertyId) {
      setHeatmapPagesData(null);
      setHeatmapSummaryData(null);
      setHeatmapTrackerHealthData(null);
      setSiteAuditPagesData(null);
      setSiteAuditSummaryData(null);
      setHeatmapPagesLoading(false);
      setHeatmapSummaryLoading(false);
      setHeatmapTrackerHealthLoading(false);
      setSiteAuditLoading(false);
      return undefined;
    }

    const controller = new AbortController();

    const loadReportingTabSummary = async () => {
      setHeatmapPanelError(null);
      setHeatmapPagesLoading(true);
      setHeatmapSummaryLoading(true);
      setHeatmapTrackerHealthLoading(true);
      setSiteAuditLoading(true);

      try {
        const params = new URLSearchParams({
          property_id: selectedPropertyId,
          sections: 'heatmap,audit',
          start_date: formatDateInputValue(rangeDates.start),
          end_date: formatDateInputValue(rangeDates.end),
        });
        if (heatmapSiteKey) params.set('site_key', heatmapSiteKey);
        if (selectedHeatmapPath) params.set('path', selectedHeatmapPath);
        if (selectedHeatmapDevice) params.set('device_type', selectedHeatmapDevice);

        const response = await authFetch(`${REPORTING_TAB_SUMMARY_URL}?${params.toString()}`, {
          signal: controller.signal,
        });
        const payload = await response.json();
        if (!response.ok || payload?.status === 'error') {
          throw new Error(payload?.error || `Website experience summary fetch failed: ${response.status}`);
        }

        const panelErrors = [];
        const heatmap = payload.heatmap || {};
        setHeatmapPagesData(heatmap.pages?.payload || null);
        setHeatmapSummaryData(heatmap.summary?.payload || null);
        setHeatmapTrackerHealthData(heatmap.trackerHealth?.payload || null);
        if (heatmap.error) panelErrors.push(heatmap.error);

        const audit = payload.audit || {};
        setSiteAuditPagesData(audit.pages?.payload || null);
        setSiteAuditSummaryData(audit.summary?.payload || null);
        if (audit.error) panelErrors.push(audit.error);

        const returnedPath = heatmap.selectedPath || payload.filters?.path || '';
        if (!selectedHeatmapPath && returnedPath) {
          setSelectedHeatmapPath(returnedPath);
        }

        setHeatmapPanelError(panelErrors.length ? `Partial data loaded: ${panelErrors.join(' ')}` : null);
      } catch (error) {
        if (error.name === 'AbortError') return;
        console.error('Website experience summary fetch failed', error);
        setWebsiteExperienceSummaryBypass(true);
        setHeatmapPanelError(error.message || 'Unable to load website experience summary.');
      } finally {
        if (!controller.signal.aborted) {
          setHeatmapPagesLoading(false);
          setHeatmapSummaryLoading(false);
          setHeatmapTrackerHealthLoading(false);
          setSiteAuditLoading(false);
        }
      }
    };

    loadReportingTabSummary();
    return () => controller.abort();
  }, [
    enabled,
    formatDateInputValue,
    heatmapSiteKey,
    rangeDates,
    selectedHeatmapDevice,
    selectedHeatmapPath,
    selectedPropertyId,
    shouldUseReportingSummary,
  ]);

  React.useEffect(() => {
    if (!enabled || shouldUseReportingSummary) return undefined;

    if (!selectedPropertyId || !HEATMAP_PAGES_URL || !SITE_AUDIT_PAGES_URL || !SITE_AUDIT_SUMMARY_URL) {
      setHeatmapPagesData(null);
      setSiteAuditPagesData(null);
      setSiteAuditSummaryData(null);
      setHeatmapPanelError(selectedPropertyId ? 'Heatmap and audit endpoints are not fully configured.' : null);
      setHeatmapPagesLoading(false);
      setSiteAuditLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    const loadPanelData = async () => {
      setHeatmapPagesLoading(true);
      setSiteAuditLoading(true);
      setHeatmapPanelError(null);
      try {
        const params = new URLSearchParams({
          property_id: selectedPropertyId,
          start_date: formatDateInputValue(rangeDates.start),
          end_date: formatDateInputValue(rangeDates.end),
        });
        if (heatmapSiteKey) params.set('site_key', heatmapSiteKey);

        const fetchPanelPayload = async (label, url) => {
          const response = await authFetch(url, { signal: controller.signal });
          const payload = await response.json();
          if (!response.ok || payload?.status === 'error') {
            throw new Error(payload?.error || `${label} fetch failed: ${response.status}`);
          }
          return payload;
        };

        const [pagesResult, auditPagesResult, auditSummaryResult] = await Promise.allSettled([
          fetchPanelPayload('Heatmap pages', `${HEATMAP_PAGES_URL}?${params.toString()}`),
          fetchPanelPayload('Audit pages', `${SITE_AUDIT_PAGES_URL}?${params.toString()}`),
          fetchPanelPayload('Audit summary', `${SITE_AUDIT_SUMMARY_URL}?${params.toString()}`),
        ]);
        const partialErrors = [];
        if (pagesResult.status === 'fulfilled') setHeatmapPagesData(pagesResult.value);
        else {
          setHeatmapPagesData(null);
          partialErrors.push(pagesResult.reason?.message || 'Heatmap pages unavailable.');
        }
        if (auditPagesResult.status === 'fulfilled') setSiteAuditPagesData(auditPagesResult.value);
        else {
          setSiteAuditPagesData(null);
          partialErrors.push(auditPagesResult.reason?.message || 'Audit pages unavailable.');
        }
        if (auditSummaryResult.status === 'fulfilled') setSiteAuditSummaryData(auditSummaryResult.value);
        else {
          setSiteAuditSummaryData(null);
          partialErrors.push(auditSummaryResult.reason?.message || 'Audit summary unavailable.');
        }
        setHeatmapPanelError(partialErrors.length ? `Partial data loaded: ${partialErrors.join(' ')}` : null);
      } catch (error) {
        if (error.name === 'AbortError') return;
        console.error('Heatmap/audit panel fetch failed', error);
        setHeatmapPagesData(null);
        setSiteAuditPagesData(null);
        setSiteAuditSummaryData(null);
        setHeatmapPanelError(error.message || 'Unable to load heatmap and audit data.');
      } finally {
        if (!controller.signal.aborted) {
          setHeatmapPagesLoading(false);
          setSiteAuditLoading(false);
        }
      }
    };

    loadPanelData();
    return () => controller.abort();
  }, [enabled, formatDateInputValue, heatmapSiteKey, rangeDates, selectedPropertyId, shouldUseReportingSummary]);

  React.useEffect(() => {
    const pages = heatmapPageOptions.length ? heatmapPageOptions : auditPageOptions;
    if (!selectedHeatmapPath && pages.length > 0) {
      setSelectedHeatmapPath(pages[0].path || pages[0].canonicalPath || '/');
    }
    if (selectedHeatmapPath && pages.length > 0 && !pages.some((page) => (page.path || page.canonicalPath || '/') === selectedHeatmapPath)) {
      setSelectedHeatmapPath(pages[0].path || pages[0].canonicalPath || '/');
    }
  }, [auditPageOptions, heatmapPageOptions, selectedHeatmapPath]);

  React.useEffect(() => {
    if (!enabled || shouldUseReportingSummary) return undefined;

    if (!selectedPropertyId || !HEATMAP_SUMMARY_URL || !selectedHeatmapPath) {
      setHeatmapSummaryData(null);
      setHeatmapSummaryLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    const loadHeatmapSummary = async () => {
      setHeatmapSummaryLoading(true);
      setHeatmapPanelError(null);
      try {
        const params = new URLSearchParams({
          property_id: selectedPropertyId,
          path: selectedHeatmapPath,
          device_type: selectedHeatmapDevice,
          start_date: formatDateInputValue(rangeDates.start),
          end_date: formatDateInputValue(rangeDates.end),
        });
        if (heatmapSiteKey) params.set('site_key', heatmapSiteKey);
        const response = await authFetch(`${HEATMAP_SUMMARY_URL}?${params.toString()}`, { signal: controller.signal });
        const payload = await response.json();
        if (!response.ok || payload?.status === 'error') {
          throw new Error(payload?.error || `Heatmap summary fetch failed: ${response.status}`);
        }
        setHeatmapSummaryData(payload);
      } catch (error) {
        if (error.name === 'AbortError') return;
        console.error('Heatmap summary fetch failed', error);
        setHeatmapSummaryData(null);
        setHeatmapPanelError(error.message || 'Unable to load heatmap summary.');
      } finally {
        if (!controller.signal.aborted) setHeatmapSummaryLoading(false);
      }
    };

    loadHeatmapSummary();
    return () => controller.abort();
  }, [
    enabled,
    formatDateInputValue,
    heatmapSiteKey,
    rangeDates,
    selectedHeatmapDevice,
    selectedHeatmapPath,
    selectedPropertyId,
    shouldUseReportingSummary,
  ]);

  React.useEffect(() => {
    if (!enabled || shouldUseReportingSummary) return undefined;

    if (!selectedPropertyId || !HEATMAP_TRACKER_HEALTH_URL || !selectedHeatmapPath) {
      setHeatmapTrackerHealthData(null);
      setHeatmapTrackerHealthLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    const loadTrackerHealth = async () => {
      setHeatmapTrackerHealthLoading(true);
      try {
        const params = new URLSearchParams({
          property_id: selectedPropertyId,
          path: selectedHeatmapPath,
          device_type: selectedHeatmapDevice,
          start_date: formatDateInputValue(rangeDates.start),
          end_date: formatDateInputValue(rangeDates.end),
        });
        if (heatmapSiteKey) params.set('site_key', heatmapSiteKey);
        const response = await authFetch(`${HEATMAP_TRACKER_HEALTH_URL}?${params.toString()}`, { signal: controller.signal });
        const payload = await response.json();
        if (!response.ok || payload?.status === 'error') {
          throw new Error(payload?.error || `Tracker health fetch failed: ${response.status}`);
        }
        setHeatmapTrackerHealthData(payload);
      } catch (error) {
        if (error.name === 'AbortError') return;
        console.error('Tracker health fetch failed', error);
        setHeatmapTrackerHealthData(null);
      } finally {
        if (!controller.signal.aborted) setHeatmapTrackerHealthLoading(false);
      }
    };

    loadTrackerHealth();
    return () => controller.abort();
  }, [
    enabled,
    formatDateInputValue,
    heatmapSiteKey,
    rangeDates,
    selectedHeatmapDevice,
    selectedHeatmapPath,
    selectedPropertyId,
    shouldUseReportingSummary,
  ]);

  React.useEffect(() => {
    if (!enabled) {
      setScreenshotPreviewLoading(false);
      return undefined;
    }

    if (!selectedScreenshot?.id || !SITE_AUDIT_SCREENSHOT_PREVIEW_URL) {
      setScreenshotPreviewUrl('');
      setScreenshotPreviewError(null);
      setScreenshotPreviewLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    const loadScreenshotPreview = async () => {
      setScreenshotPreviewLoading(true);
      setScreenshotPreviewError(null);
      try {
        const params = new URLSearchParams({
          screenshot_id: selectedScreenshot.id,
          expires_in: '900',
        });
        const response = await authFetch(`${SITE_AUDIT_SCREENSHOT_PREVIEW_URL}?${params.toString()}`, {
          signal: controller.signal,
        });
        const payload = await response.json();
        if (!response.ok || payload?.status === 'error') {
          throw new Error(payload?.error || `Screenshot preview fetch failed: ${response.status}`);
        }
        setScreenshotPreviewUrl(payload.url || '');
      } catch (error) {
        if (error.name === 'AbortError') return;
        console.error('Screenshot preview fetch failed', error);
        setScreenshotPreviewUrl('');
        setScreenshotPreviewError(error.message || 'Unable to load screenshot preview.');
      } finally {
        if (!controller.signal.aborted) setScreenshotPreviewLoading(false);
      }
    };

    loadScreenshotPreview();
    return () => controller.abort();
  }, [enabled, selectedScreenshot?.id]);

  React.useEffect(() => {
    setHeatmapLayersTouched(false);
    setHighlightedHeatmapTarget(null);
  }, [rangeDates, selectedHeatmapDevice, selectedHeatmapPath, selectedPropertyId]);

  React.useEffect(() => {
    if (heatmapLayersTouched || heatmapSummaryLoading || !heatmapSummaryData) return;
    const clickCount = Number(heatmapTotals.clicks || 0) + Number(heatmapTotals.ctaClicks || 0);
    const scrollCount = Number(heatmapTotals.scrolls || 0);
    const maxScrollDepth = Number(heatmapTotals.maxScrollDepthPct || 0);
    if (clickCount > 0) {
      setHeatmapLayers({ click: true, cursor: false, scroll: false, engagement: false });
      return;
    }
    if (scrollCount > 0 || maxScrollDepth > 0) {
      setHeatmapLayers({ click: false, cursor: false, scroll: true, engagement: false });
      return;
    }
    setHeatmapLayers({ click: false, cursor: false, scroll: false, engagement: false });
  }, [heatmapLayersTouched, heatmapSummaryData, heatmapSummaryLoading, heatmapTotals.clicks, heatmapTotals.ctaClicks, heatmapTotals.scrolls, heatmapTotals.maxScrollDepthPct]);

  const updateHeatmapLayer = React.useCallback((field, value) => {
    setHeatmapLayersTouched(true);
    setHeatmapLayers((current) => ({
      ...current,
      [field]: value,
    }));
  }, []);

  const runSiteAudit = React.useCallback(async () => {
    if (!selectedPropertyId) {
      setHeatmapPanelError('No property is currently available for this account.');
      return;
    }
    if (!SITE_AUDIT_RUN_URL) {
      setHeatmapPanelError('Site audit run endpoint is not configured.');
      return;
    }

    setSiteAuditRunning(true);
    setHeatmapPanelError(null);
    setSiteAuditNotice(null);
    try {
      const params = new URLSearchParams({ property_id: selectedPropertyId });
      if (heatmapSiteKey) params.set('site_key', heatmapSiteKey);
      const response = await authFetch(`${SITE_AUDIT_RUN_URL}?${params.toString()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ property_id: selectedPropertyId, siteKey: heatmapSiteKey || undefined, includeAi: true, background: true }),
      });
      const payload = await response.json();
      if (!response.ok || payload?.status === 'error') {
        throw new Error(payload?.error || `Site audit run failed: ${response.status}`);
      }
      if (payload?.status === 'queued') {
        setSiteAuditNotice(payload.message || 'Site audit queued for background processing.');
        if (payload.audit) setSiteAuditSummaryData({ status: 'ok', audit: payload.audit });
      } else {
        setSiteAuditSummaryData(payload);
      }
    } catch (error) {
      console.error('Site audit run failed', error);
      setHeatmapPanelError(error.message || 'Unable to run the site audit.');
    } finally {
      setSiteAuditRunning(false);
    }
  }, [heatmapSiteKey, selectedPropertyId]);

  return {
    auditPageOptions,
    heatmapClickSignalTab,
    heatmapLayers,
    heatmapPageOptions,
    heatmapPagesData,
    heatmapPagesLoading,
    heatmapPanelError,
    heatmapSummaryData,
    heatmapSummaryLoading,
    heatmapTotals,
    heatmapTrackerHealthData,
    heatmapTrackerHealthLoading,
    highlightedHeatmapTarget,
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
    siteAuditLoading,
    siteAuditNotice,
    siteAuditRunning,
    siteAuditSummaryData,
    updateHeatmapLayer,
  };
}
