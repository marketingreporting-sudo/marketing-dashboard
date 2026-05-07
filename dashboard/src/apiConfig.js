const trimTrailingSlash = (value) => String(value || '').replace(/\/+$/, '');

const normalizeApiUrl = (value) => trimTrailingSlash(value);

export const RENDER_API_BASE_URL = normalizeApiUrl(import.meta.env.VITE_RENDER_API_BASE_URL || '');

const resolveApiUrl = (explicitUrl, renderPath, productionFallback = '') => {
  if (explicitUrl) {
    return normalizeApiUrl(explicitUrl);
  }
  if (RENDER_API_BASE_URL) {
    return `${RENDER_API_BASE_URL}${renderPath}`;
  }
  return normalizeApiUrl(productionFallback);
};

export const ROI_PIPELINE_STATUS_URL = resolveApiUrl(
  import.meta.env.VITE_ROI_PIPELINE_STATUS_URL || '',
  '/api/roi/pipeline-status'
);

export const PROPERTY_REPORTING_OVERVIEW_URL = resolveApiUrl(
  import.meta.env.VITE_PROPERTY_REPORTING_OVERVIEW_URL || '',
  '/api/reporting/property-overview'
);

export const WEBSITE_MANAGER_URL = resolveApiUrl(
  import.meta.env.VITE_WEBSITE_MANAGER_URL || '',
  '/api/admin/website-manager'
);

export const WEBSITE_MANAGER_SCHEMA_URL = resolveApiUrl(
  import.meta.env.VITE_WEBSITE_MANAGER_SCHEMA_URL || '',
  '/api/admin/website-manager/schema'
);

export const REPORTING_LAYOUT_URL = resolveApiUrl(
  import.meta.env.VITE_REPORTING_LAYOUT_URL || '',
  '/api/admin/reporting-layout'
);

export const ADMIN_ACCESS_USERS_URL = resolveApiUrl(
  import.meta.env.VITE_ADMIN_ACCESS_USERS_URL || '',
  '/api/admin/access/users'
);

export const GA4_DASHBOARD_URL = resolveApiUrl(
  import.meta.env.VITE_GA4_DASHBOARD_URL || '',
  '/api/analytics/ga4',
  'https://us-central1-data-analysis-eeb4d.cloudfunctions.net/get_ga4_dashboard_data'
);

export const GOOGLE_ADS_DASHBOARD_URL = resolveApiUrl(
  import.meta.env.VITE_GOOGLE_ADS_DASHBOARD_URL || '',
  '/api/analytics/google-ads',
  'https://us-central1-data-analysis-eeb4d.cloudfunctions.net/get_google_ads_dashboard_data'
);

export const META_ADS_DASHBOARD_URL = resolveApiUrl(
  import.meta.env.VITE_META_ADS_DASHBOARD_URL || '',
  '/api/analytics/meta-ads',
  'https://us-central1-data-analysis-eeb4d.cloudfunctions.net/get_meta_ads_dashboard_data'
);

export const LOCAL_FALCON_DASHBOARD_URL = resolveApiUrl(
  import.meta.env.VITE_LOCAL_FALCON_DASHBOARD_URL || '',
  '/api/analytics/local-falcon'
);

export const REPUTATION_DASHBOARD_URL = resolveApiUrl(
  import.meta.env.VITE_REPUTATION_DASHBOARD_URL || '',
  '/api/analytics/reputation',
  'https://us-central1-data-analysis-eeb4d.cloudfunctions.net/get_reputation_dashboard_data'
);

export const HEATMAP_SITES_URL = resolveApiUrl(
  import.meta.env.VITE_HEATMAP_SITES_URL || '',
  '/api/admin/heatmap-sites'
);

export const HEATMAP_SUMMARY_URL = resolveApiUrl(
  import.meta.env.VITE_HEATMAP_SUMMARY_URL || '',
  '/api/heatmaps/summary'
);

export const HEATMAP_PAGES_URL = resolveApiUrl(
  import.meta.env.VITE_HEATMAP_PAGES_URL || '',
  '/api/heatmaps/pages'
);

export const HEATMAP_TRACKER_URL = resolveApiUrl(
  import.meta.env.VITE_HEATMAP_TRACKER_URL || '',
  '/api/heatmaps/tracker.js'
);

export const SITE_AUDIT_PAGE_SNAPSHOT_URL = resolveApiUrl(
  import.meta.env.VITE_SITE_AUDIT_PAGE_SNAPSHOT_URL || '',
  '/api/site-audit/page-snapshot'
);

export const SITE_AUDIT_PAGES_URL = resolveApiUrl(
  import.meta.env.VITE_SITE_AUDIT_PAGES_URL || '',
  '/api/site-audit/pages'
);

export const SITE_AUDIT_RUN_URL = resolveApiUrl(
  import.meta.env.VITE_SITE_AUDIT_RUN_URL || '',
  '/api/site-audit/run'
);

export const SITE_AUDIT_SUMMARY_URL = resolveApiUrl(
  import.meta.env.VITE_SITE_AUDIT_SUMMARY_URL || '',
  '/api/site-audit/summary'
);

export const SITE_AUDIT_PORTFOLIO_URL = resolveApiUrl(
  import.meta.env.VITE_SITE_AUDIT_PORTFOLIO_URL || '',
  '/api/site-audit/portfolio'
);

export const SITE_AUDIT_SCREENSHOT_URL = resolveApiUrl(
  import.meta.env.VITE_SITE_AUDIT_SCREENSHOT_URL || '',
  '/api/site-audit/screenshot'
);

export const SITE_AUDIT_SCREENSHOT_UPLOAD_URL = resolveApiUrl(
  import.meta.env.VITE_SITE_AUDIT_SCREENSHOT_UPLOAD_URL || '',
  '/api/site-audit/screenshot-upload-url'
);

export const SITE_AUDIT_SCREENSHOT_PREVIEW_URL = resolveApiUrl(
  import.meta.env.VITE_SITE_AUDIT_SCREENSHOT_PREVIEW_URL || '',
  '/api/site-audit/screenshot-preview'
);
