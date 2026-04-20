const trimTrailingSlash = (value) => String(value || '').replace(/\/+$/, '');

const normalizeKnownUrlTypos = (value) =>
  trimTrailingSlash(value).replace('marketing-dashbaord.onrender.com', 'marketing-dashboard.onrender.com');

export const RENDER_API_BASE_URL = normalizeKnownUrlTypos(import.meta.env.VITE_RENDER_API_BASE_URL || '');

const resolveApiUrl = (explicitUrl, renderPath, productionFallback = '') => {
  if (explicitUrl) {
    return normalizeKnownUrlTypos(explicitUrl);
  }
  if (RENDER_API_BASE_URL) {
    return `${RENDER_API_BASE_URL}${renderPath}`;
  }
  return normalizeKnownUrlTypos(productionFallback);
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

export const REPUTATION_DASHBOARD_URL = resolveApiUrl(
  import.meta.env.VITE_REPUTATION_DASHBOARD_URL || '',
  '/api/analytics/reputation',
  'https://us-central1-data-analysis-eeb4d.cloudfunctions.net/get_reputation_dashboard_data'
);
