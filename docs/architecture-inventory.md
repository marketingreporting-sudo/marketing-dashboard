# Architecture Inventory

This inventory reflects the repo as it exists today, before the Firebase-to-Supabase / Render / Vercel runtime cutover.

## App roots

- Frontend app root: `dashboard/`
- Backend/API root: `functions/`
- Root migration tooling: `scripts/`

## Frontend inventory

Frontend root: `dashboard/`

- Framework: Vite + React
- Package manager: npm
- Primary package file: `dashboard/package.json`
- Vite config: `dashboard/vite.config.js`
- Vercel config: `dashboard/vercel.json`
- Firebase client bootstrap: `dashboard/src/firebase.js`
- Main app entry: `dashboard/src/main.jsx`
- Main dashboard implementation: `dashboard/src/App.jsx`

Current frontend data/runtime dependencies:

- Firestore client SDK via `dashboard/src/firebase.js`
- Firebase project config via `VITE_FIREBASE_*`
- backend endpoint overrides via:
  - `VITE_ROI_PIPELINE_STATUS_URL`
  - `VITE_GA4_DASHBOARD_URL`
  - `VITE_GOOGLE_ADS_DASHBOARD_URL`
  - `VITE_META_ADS_DASHBOARD_URL`
  - `VITE_REPUTATION_DASHBOARD_URL`

These endpoint variables already provide a safe staging path for Vercel to target future Render services without changing production defaults yet.

## Backend inventory

Backend root: `functions/`

- Language: Python
- Current runtime model: Firebase Functions + scheduler jobs
- Main backend module: `functions/main.py`
- Dependencies: `functions/requirements.txt`

Important note:

The backend is not yet structured as a Render-native WSGI/ASGI app. It still uses Firebase decorators and Firebase deployment conventions. For staging prep, this repo documents the migration path and environment separation, but does not switch backend execution away from Firebase yet.

## HTTP entrypoints in `functions/main.py`

These are the current function-like API surfaces that should later become Render API routes or internal job triggers:

- `trigger_entrata_backfill`
- `trigger_background_backfill_batch`
- `trigger_daily_refresh_batch`
- `trigger_retry_queue_batch`
- `sync_entrata_specials`
- `sync_entrata_units_availability_pricing`
- `sync_entrata_lease_attribution`
- `aggregate_live_roi`
- `start_ytd_roi_backfill`
- `get_entrata_sync_state`
- `get_roi_pipeline_status`
- `reset_entrata_sync_state`
- `fetch_entrata_lease_details`
- `get_ga4_dashboard_data`
- `get_google_ads_dashboard_data`
- `get_meta_ads_dashboard_data`
- `get_reputation_dashboard_data`

## Scheduled jobs in `functions/main.py`

These are the cron-like jobs that should later become Render Cron Jobs or worker schedules:

- `fetch_daily_entrata_leads_scheduled`
- `fetch_daily_entrata_events_scheduled`
- `fetch_daily_entrata_leases_scheduled`
- `fetch_daily_entrata_invoices_scheduled`
- `fetch_daily_entrata_availability_scheduled`
- `sync_daily_entrata_specials_scheduled`
- `sync_daily_entrata_units_availability_pricing_scheduled`
- `sync_daily_entrata_lease_attribution_scheduled`
- `aggregate_daily_roi_scheduled`
- `start_daily_roi_pipeline_scheduled`
- `run_roi_pipeline_jobs_scheduled`
- `run_background_entrata_backfill_scheduled`
- `run_daily_entrata_refresh_scheduled`
- `run_entrata_retry_queue_scheduled`
- `weekly_site_audit_scheduled`

## Other deployment-sensitive scripts

- `marketing_scraper.py`
  Writes Firestore `marketing_opportunities` documents.
- `site_audit.py`
  Writes Firestore `site_audits` documents.
- `functions/site_audit.py`
  Function-local copy of the site audit helper used by scheduled jobs.
- `scripts/firestore-to-supabase.mjs`
  Staging migration utility for Firestore export + Supabase upsert flow.

## Firebase-specific files and usages to preserve during transition

Root Firebase files:

- `firebase.json`
- `.firebaserc`
- `firestore.rules`
- `firestore.indexes.json`

Firebase/Firestore code usage:

- `dashboard/src/firebase.js`
  Firebase client app + Firestore browser connection
- `dashboard/src/App.jsx`
  Firestore document and collection reads/writes
- `functions/main.py`
  Firebase Functions decorators and Firestore Admin reads/writes
- `marketing_scraper.py`
  Firestore writes
- `site_audit.py`
  Firestore writes
- `functions/site_audit.py`
  Firestore writes

Transition rule:

None of the Firebase files above should be removed until staging validation is complete and production cutover is approved.
