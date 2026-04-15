const trimTrailingSlash = (value) => String(value || '').replace(/\/+$/, '');

const RENDER_API_BASE_URL = trimTrailingSlash(import.meta.env.VITE_RENDER_API_BASE_URL || '');

const resolveApiUrl = (explicitUrl, renderPath, productionFallback = '') => {
  if (explicitUrl) {
    return explicitUrl;
  }
  if (RENDER_API_BASE_URL) {
    return `${RENDER_API_BASE_URL}${renderPath}`;
  }
  return productionFallback;
};

export const ROI_PIPELINE_STATUS_URL = resolveApiUrl(
  import.meta.env.VITE_ROI_PIPELINE_STATUS_URL || '',
  '/api/roi/pipeline-status'
);

export const PROPERTY_REPORTING_OVERVIEW_URL = resolveApiUrl(
  import.meta.env.VITE_PROPERTY_REPORTING_OVERVIEW_URL || '',
  '/api/reporting/property-overview'
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
