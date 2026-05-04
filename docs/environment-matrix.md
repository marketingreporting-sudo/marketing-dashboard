# Environment Matrix

This matrix separates local-only settings, frontend-safe variables, backend secrets, and migration credentials.

## Frontend public variables

These belong in:

- local frontend `.env` under `dashboard/`
- Vercel project environment variables

These are public-by-design because Vite exposes `VITE_*` values to the browser:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_FIREBASE_MEASUREMENT_ID`
- `VITE_ROI_PIPELINE_STATUS_URL`
- `VITE_GA4_DASHBOARD_URL`
- `VITE_GOOGLE_ADS_DASHBOARD_URL`
- `VITE_META_ADS_DASHBOARD_URL`
- `VITE_LOCAL_FALCON_DASHBOARD_URL`
- `VITE_REPUTATION_DASHBOARD_URL`

## Backend private variables

These belong in:

- local backend `.env` under `functions/`
- Render private environment variables

Do not place these in Vercel:

- `FIREBASE_PROJECT_ID`
- `SYNC_STATE_COLLECTION`
- `SYNC_RETRY_COLLECTION`
- `ENTRATA_PROPERTY_ID`
- `ENTRATA_STUDENT_ORG_SLUG`
- `ENTRATA_MULTIFAMILY_ORG_SLUG`
- `ENTRATA_API_KEY`
- `ENTRATA_API_KEY_MULTIFAMILY`
- `GOOGLE_ADS_CONFIG_JSON`
- `META_ACCESS_TOKEN`
- `META_GRAPH_API_VERSION`
- `META_ACTIVE_CAMPAIGN_STATUSES`
- `META_ADS_CACHE_MINUTES`
- `LOCAL_FALCON_API_KEY`
- `OPINIION_API_BASE_URL`
- `OPINIION_LOCATION_FIELD`
- `OPINIION_USER_EMAIL`
- `OPINIION_USER_PASSWORD`
- `SITE_AUDIT_BASE_URL`
- `APP_TIMEZONE`
- `BACKGROUND_BACKFILL_BATCH_SIZE`
- `BACKGROUND_BACKFILL_TOTAL_DAYS`
- `DAILY_REFRESH_BATCH_SIZE`
- `DAILY_REFRESH_LOOKBACK_DAYS`
- `RETRY_BATCH_SIZE`
- `RETRY_MAX_ATTEMPTS`
- `LEASE_ATTRIBUTION_LOOKBACK_DAYS`
- `LEASE_ATTRIBUTION_FUTURE_MOVE_IN_DAYS`
- `LEASE_ATTRIBUTION_LEAD_LOOKBACK_DAYS`
- `LEASE_ATTRIBUTION_PAGE_SIZE`
- `ROI_PIPELINE_RAW_BATCH_SIZE`
- `ROI_PIPELINE_PROPERTY_BATCH_SIZE`
- `ROI_DAILY_RAW_LOOKBACK_DAYS`
- `ROI_DAILY_REPORT_LOOKBACK_DAYS`
- `MARKETING_GL_ACCOUNT_FROM`
- `MARKETING_GL_ACCOUNT_TO`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

## Root migration-tool variables

These belong in a root `.env` for local migration runs or secure CI/CD contexts:

- `FIRESTORE_EXPORT_BUCKET`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_SERVICE_ACCOUNT_KEY_PATH`
- `GOOGLE_APPLICATION_CREDENTIALS`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_BATCH_SIZE`

## Supabase-managed values

These are obtained from Supabase and then distributed appropriately:

- `SUPABASE_URL`
  Public in the browser as `VITE_SUPABASE_URL`, and private in backend contexts as `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
  Public key exposed as `VITE_SUPABASE_ANON_KEY` in the frontend and also supplied privately to Render for JWT verification and user-scoped PostgREST requests
- `SUPABASE_SERVICE_ROLE_KEY`
  Backend-only, never public

The frontend now uses client-side Supabase auth and property-access reads with the anon key. Keep using the service-role key only in backend environments.

## Transition guidance

- Keep Firebase variables documented and available during staging
- Keep backend secrets only in Render/local private env stores
- Keep browser-safe frontend variables only in Vercel/local frontend env files
- Do not reuse the service role key in frontend builds
