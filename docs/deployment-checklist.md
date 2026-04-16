# Deployment Checklist

This checklist is for staging preparation only. It does not switch production traffic or production logic.

## 1. GitHub

- Create a GitHub repository and push this repo as-is
- Set the default branch you want to treat as the source of truth
- Protect the main branch if desired
- Confirm that secrets and local artifacts are ignored by `.gitignore`
- Confirm that generated migration output is not tracked
- Confirm that service account JSON files are not tracked

## 2. Supabase

- Create the Supabase project
- Apply the first-pass schema from `supabase/firestore_first_pass_schema.sql`
- Store the connection details securely
- Keep the service role key backend-only
- Do not expose the service role key to Vercel
- Decide whether you need Supabase Auth now or later
- Prepare a staging database first, before any production cutover

## 3. Render

Current status:

- The backend logic is still implemented as Firebase Functions
- No Render-native server wrapper has been introduced yet
- This is intentional to avoid changing runtime behavior too early

Staging prep tasks:

- Create a Render web service from the staged adapter layer
- Create and verify Render cron jobs for the scheduled jobs that currently run in Firebase
- Add backend environment variables in Render, but do not disable Firebase jobs yet
- Decide whether the first Render backend step will be:
  - a Flask/FastAPI adapter around existing logic, or
  - a lighter internal job runner first, before public API cutover

Recommended future service split:

- Web API service
- Scheduled cron jobs
- Optional worker/service for long-running backfills

Cron candidates to recreate on Render:

- daily Entrata leads/events/leases/invoices/availability syncs
- specials sync
- availability pricing sync
- lease attribution sync
- ROI aggregation
- ROI pipeline launcher
- ROI pipeline runner
- background backfill runner
- daily refresh runner
- retry queue runner
- weekly site audit

## 4. Vercel

- Create a Vercel project from the GitHub repo
- Set root directory to `dashboard`
- Use `npm install`
- Use `npm run build`
- Use output directory `dist`
- Add the browser-safe `VITE_*` environment variables
- Remove Firebase client config from Vercel once backend dependencies are also cleared
- Optionally point the endpoint override variables at staging Render APIs later

## 5. Validation before any cutover

- Render adapter boots successfully with Gunicorn
- `/healthz`, `/readyz`, `/api/meta/routes`, and `/api/meta/cron-jobs` respond as expected
- Frontend builds successfully on Vercel
- Existing Firebase-powered frontend still works locally
- Supabase schema is applied
- Firestore export + migration utility runs in a staging environment
- Render service plan is finalized
- Render cron mapping is reviewed and `render_cron.py` commands are configured
- No secrets are committed
- Firebase remains intact until explicit cutover approval
