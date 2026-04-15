# Render Deployment Plan

This is a staging/prep document. It does not replace Firebase Functions yet.

## Current backend entrypoint

Current backend root: `functions/`

Current primary module: `functions/main.py`

Important limitation:

`functions/main.py` is written for Firebase Functions decorators, not for a direct Render-native WSGI/ASGI server.

This repo now includes a minimal Render-native adapter layer:

- `functions/render_app.py`
- `functions/render_wsgi.py`
- `functions/render_adapter_registry.py`
- `functions/requirements-render.txt`

This adapter does not execute the existing Firebase business logic yet. It provides:

- a real Flask web entrypoint for Render
- health and readiness routes
- route and cron inventory endpoints for staging verification
- a read-only staging Supabase validation endpoint at `/api/staging/supabase/migration-validation`
- a read-only staging Supabase-backed sync-state endpoint at `/api/entrata/sync-state`
- a concrete Gunicorn start command

## Recommended future Render service types

### 1. Web Service

Purpose:

- host the HTTP API endpoints that currently exist as `@https_fn.on_request` handlers

Future responsibility:

- Entrata sync triggers
- ROI status endpoints
- analytics endpoints
- reputation endpoint
- lease details endpoint

### 2. Cron Jobs

Purpose:

- replace Firebase scheduled functions

Future responsibility:

- daily Entrata syncs
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

### 3. Optional Worker / Long-running Service

Purpose:

- isolate heavy or long-running operations such as large backfills or pipeline processing

This may or may not be needed depending on how the API layer is adapted.

## Safe staging recommendation

For now:

- keep Firebase as the live backend runtime
- use the Render adapter as the staging web-service shell
- do not deploy `functions/main.py` directly to Render yet
- use the staging validation endpoint to confirm migrated Supabase counts before moving any runtime reads

The first real staging read path now available is:

- `GET /api/entrata/sync-state`
- `GET /api/roi/pipeline-status`
- `GET|POST|OPTIONS /api/analytics/ga4`
- `GET|POST|OPTIONS /api/analytics/google-ads`
- `GET|POST|OPTIONS /api/analytics/reputation`

These routes mirror the Firebase handlers' top-level payload shapes while reading from Supabase staging tables instead of Firestore.

## Future Render settings to prepare for

The staged Render web service can now use:

- Service type: `Web Service`
- Root directory: `functions`
- Build command: `pip install -r requirements-render.txt`
- Start command: `gunicorn render_wsgi:app --bind 0.0.0.0:$PORT --workers 2 --threads 8 --timeout 120`

There is also a staging Render blueprint at `render.yaml`.

## What this adapter intentionally does not do yet

- it does not replace Firebase HTTP handlers
- it does not run scheduled business logic
- it does not move Firestore persistence to Supabase
- it does not change production traffic

That work should come in the next stage, once you are ready to map selected Firebase handlers into Render-native routes one by one.
