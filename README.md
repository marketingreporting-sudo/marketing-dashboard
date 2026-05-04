# Data Analysis

This repository currently contains:

- a Vite/React dashboard frontend in `dashboard/`
- Firebase Cloud Functions and scheduled jobs in `functions/`
- Firebase and Firestore project config at the repo root
- a staged Firestore-to-Supabase migration utility in `scripts/`
- a first-pass Supabase schema in `supabase/`

The current production logic is still Firebase/Firestore-based. The new GitHub + Supabase + Render + Vercel stack is being prepared as staging work only.

## Project Structure

- Frontend root: `dashboard/`
- Backend/API root: `functions/`
- Firebase config: `firebase.json`, `.firebaserc`, `firestore.rules`, `firestore.indexes.json`
- Migration utility: `scripts/firestore-to-supabase.mjs`
- Supabase schema: `supabase/firestore_first_pass_schema.sql`

## Staging Prep Docs

- Architecture inventory: [docs/architecture-inventory.md](/Users/steele/Desktop/Data Analysis/docs/architecture-inventory.md)
- Deployment checklist: [docs/deployment-checklist.md](/Users/steele/Desktop/Data Analysis/docs/deployment-checklist.md)
- Environment matrix: [docs/environment-matrix.md](/Users/steele/Desktop/Data Analysis/docs/environment-matrix.md)
- Render deployment plan: [docs/render-deployment-plan.md](/Users/steele/Desktop/Data Analysis/docs/render-deployment-plan.md)
- Data migration flow: [docs/data-migration-flow.md](/Users/steele/Desktop/Data Analysis/docs/data-migration-flow.md)
- Migration validation report: [docs/migration-validation-report.md](/Users/steele/Desktop/Data Analysis/docs/migration-validation-report.md)
- Staging cutover plan: [docs/staging-cutover-plan.md](/Users/steele/Desktop/Data Analysis/docs/staging-cutover-plan.md)
- Supabase schema mapping: [docs/supabase-first-pass-schema.md](/Users/steele/Desktop/Data Analysis/docs/supabase-first-pass-schema.md)

## Frontend

The frontend is the Vite app in `dashboard/`.

- Install: `cd dashboard && npm install`
- Dev: `npm run dev`
- Build: `npm run build`
- Preview: `npm run preview`

Vercel should use:

- Root directory: `dashboard`
- Install command: `npm install`
- Build command: `npm run build`
- Output directory: `dist`

Browser-safe environment variables are documented in [dashboard/.env.example](/Users/steele/Desktop/Data Analysis/dashboard/.env.example).

For staging, the frontend can point selected read-only routes at the Render adapter by setting:

- `VITE_RENDER_API_BASE_URL=https://marketing-dashbaord.onrender.com`

That staged base URL currently covers:

- `VITE_ROI_PIPELINE_STATUS_URL` via `/api/roi/pipeline-status`
- `VITE_WEBSITE_MANAGER_URL` via `/api/admin/website-manager`
- `VITE_REPORTING_LAYOUT_URL` via `/api/admin/reporting-layout`
- `VITE_GA4_DASHBOARD_URL` via `/api/analytics/ga4`
- `VITE_GOOGLE_ADS_DASHBOARD_URL` via `/api/analytics/google-ads`
- `VITE_LOCAL_FALCON_DASHBOARD_URL` via `/api/analytics/local-falcon`
- `VITE_REPUTATION_DASHBOARD_URL` via `/api/analytics/reputation`

Explicit `VITE_*_URL` values still take precedence, so production can stay on Firebase endpoints while staging progressively shifts to Render.

## Backend

The backend logic currently lives in Firebase Functions under `functions/main.py`. It contains:

- HTTP endpoints exposed through `@https_fn.on_request`
- scheduled jobs exposed through `@scheduler_fn.on_schedule`
- Firestore reads/writes via `firebase_admin`

Render preparation is now active for the staged adapter layer. The Flask app and cron runner reuse the existing business logic while writing staged data to Supabase, and the remaining migration work is documented in [docs/architecture-inventory.md](/Users/steele/Desktop/Data Analysis/docs/architecture-inventory.md) and [docs/deployment-checklist.md](/Users/steele/Desktop/Data Analysis/docs/deployment-checklist.md).

Private backend environment variables are documented in [functions/.env.example](/Users/steele/Desktop/Data Analysis/functions/.env.example).

The repo now also includes a staged Render-native adapter entrypoint:

- WSGI entrypoint: `functions/render_wsgi.py`
- Flask app shell: `functions/render_app.py`
- cron CLI entrypoint: `functions/render_cron.py`
- Render runtime/storage bridge: `functions/render_runtime.py`
- Render build requirements: `functions/requirements-render.txt`
- Render blueprint: `render.yaml`

The staged adapter now includes live staging routes backed by Supabase:

- `GET /api/staging/supabase/migration-validation`
- `GET /api/entrata/sync-state`
- `GET /api/admin/sync-health`
- `GET /api/roi/pipeline-status`
- `POST /api/cron/run`
- `POST /api/entrata/backfill`
- `GET|POST|OPTIONS /api/analytics/ga4`
- `GET|POST|OPTIONS /api/analytics/google-ads`
- `GET|POST|OPTIONS /api/analytics/meta-ads`
- `GET|POST|OPTIONS /api/analytics/local-falcon`
- `GET|POST|OPTIONS /api/analytics/reputation`
- `GET|POST|OPTIONS /api/admin/local-falcon/location-matches`
- `GET|POST|OPTIONS /api/reporting/property-overview`
- `GET|POST|OPTIONS /api/admin/website-manager`
- `GET|POST|OPTIONS /api/admin/reporting-layout`

These routes are intended for staging verification and staged cutover work. They run against Supabase and Render-managed job execution without changing production Firebase traffic by default.

Concrete staged Render start command:

```bash
gunicorn render_wsgi:app --bind 0.0.0.0:$PORT --workers 2 --threads 8 --timeout 120
```

## Firestore to Supabase Migration

The repo includes a standalone Node.js migration utility that:

- triggers a managed Firestore export to Google Cloud Storage with `gcloud firestore export`
- recursively exports every Firestore top-level collection, document, and nested subcollection into local JSON
- normalizes Firestore-specific values into JSON-safe data
- batch-upserts each top-level collection into a same-named Supabase table
- writes a manifest with collection counts, discovered subcollection paths, and any failed documents

### Required environment variables

Copy [.env.example](/Users/steele/Desktop/Data Analysis/.env.example) to `.env` and set:

- `FIRESTORE_EXPORT_BUCKET`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_SERVICE_ACCOUNT_KEY_PATH`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_BATCH_SIZE`

The migration script also honors `GOOGLE_APPLICATION_CREDENTIALS` if you prefer to point Google SDKs at the service account file that way.

### Authenticate gcloud

Install the [Google Cloud CLI](https://cloud.google.com/sdk/docs/install), then authenticate before running the migration:

```bash
gcloud auth login
gcloud auth application-default login
gcloud config set project YOUR_PROJECT_ID
```

### Supply Firebase service account credentials

Create a service account in Firebase or Google Cloud with Firestore read access, then download its JSON key and point the script at it with either:

```bash
export FIREBASE_SERVICE_ACCOUNT_KEY_PATH=./service-account.json
```

or:

```bash
export GOOGLE_APPLICATION_CREDENTIALS=./service-account.json
```

### Run the export and migration

Install the migration dependencies at the repo root:

```bash
npm install
```

Then run:

```bash
npm run migrate:firestore-to-supabase
```

For the first-pass relational schema loader, run:

```bash
npm run migrate:firestore-to-supabase:relational
```

The script will:

1. run `gcloud firestore export gs://YOUR_BUCKET`
2. write JSON exports under `migration-output/firestore-json/`
3. write a manifest file under `migration-output/firestore-json/manifest.json`
4. upsert data into same-named top-level Supabase tables

If bucket IAM is not ready yet, you can temporarily bypass the managed export step for the relational loader with:

```bash
SKIP_MANAGED_EXPORT=1 npm run migrate:firestore-to-supabase:relational
```

### Required Supabase tables

The first-pass schema lives at [supabase/firestore_first_pass_schema.sql](/Users/steele/Desktop/Data Analysis/supabase/firestore_first_pass_schema.sql). The mapping and rollout notes live at [docs/supabase-first-pass-schema.md](/Users/steele/Desktop/Data Analysis/docs/supabase-first-pass-schema.md) and [docs/data-migration-flow.md](/Users/steele/Desktop/Data Analysis/docs/data-migration-flow.md).
