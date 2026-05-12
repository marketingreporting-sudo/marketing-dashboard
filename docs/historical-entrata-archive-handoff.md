# Historical Entrata Archive Handoff

This project has a long-running Render archive workflow for slowly backfilling historical Entrata raw data and then normalizing lease attribution after full raw years are available.

## Render jobs

These are the two Render cron services that keep the archive moving:

- `data-analysis-run-historical-entrata-backfill`
- `data-analysis-run-historical-lease-attribution`

The raw backfill job walks backward one property-day at a time. The lease-attribution job waits until the raw job completes a full year, then attributes leases for that year.

Do not use `data-analysis-run-background-entrata-backfill` for the long archive. That job is for recent rolling catch-up work.

## Start Archive To 2020

Use this endpoint once to start or reset the archive workflow:

```bash
curl -X POST "https://data-analysis-backend-staging.onrender.com/api/entrata/archive-backfill-to-2020" \
  -H "Authorization: Bearer YOUR_FRESH_SUPABASE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "raw_start_date": "2025-12-31",
    "target_start_date": "2020-01-01",
    "raw_batch_size": 48,
    "raw_delay_seconds": 2,
    "attribution_batch_size": 6,
    "attribution_delay_seconds": 2,
    "lead_lookback_days": 450,
    "active": true
  }'
```

This creates three sync-state rows:

- `entrata_historical_archive`: overall coordinator status.
- `entrata_historical_backfill`: raw day-by-day archive cursor.
- `entrata_historical_lease_attribution`: attribution cursor for the current completed raw year.

## Check Status

Use either status endpoint:

```bash
curl "https://data-analysis-backend-staging.onrender.com/api/entrata/archive-backfill-to-2020" \
  -H "Authorization: Bearer YOUR_FRESH_SUPABASE_TOKEN"
```

```bash
curl "https://data-analysis-backend-staging.onrender.com/api/entrata/sync-state" \
  -H "Authorization: Bearer YOUR_FRESH_SUPABASE_TOKEN"
```

Healthy archive status looks like this:

- `historical_archive.active` is `true`.
- `historical_archive.completed` is `false` until the archive reaches `2020-01-01` and attribution catches up.
- `historical_backfill.current_year` slowly moves backward from 2025 to 2020.
- `historical_backfill.last_error_count` may be non-zero occasionally; those failures are queued in `sync_retries`.
- `historical_archive.raw_completed_years` grows as raw years finish.
- `historical_archive.attribution_completed_years` grows after attribution finishes each completed raw year.
- `historical_archive.status_message` should explain what is happening in plain English.

## Pause Or Resume

Pause raw archive:

```bash
curl -X POST "https://data-analysis-backend-staging.onrender.com/api/entrata/archive-backfill-to-2020" \
  -H "Authorization: Bearer YOUR_FRESH_SUPABASE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action": "pause"}'
```

Resume without resetting the cursor:

```bash
curl -X POST "https://data-analysis-backend-staging.onrender.com/api/entrata/archive-backfill-to-2020" \
  -H "Authorization: Bearer YOUR_FRESH_SUPABASE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action": "resume"}'
```

Calling the archive endpoint without an `action` starts or resets the archive window. Use `pause` and `resume` when you want to preserve the current cursor.

## What Not To Touch

- Do not manually start `historical-lease-attribution` for old years before raw data exists for those years.
- Do not delete `entrata_historical_archive`, `entrata_historical_backfill`, or `entrata_historical_lease_attribution` unless intentionally restarting the archive.
- Do not raise `raw_batch_size` aggressively without watching Entrata/API errors. `48` every 15 minutes is intentionally conservative.
- Do not use stale bearer tokens in docs or commits. Always pull a fresh Supabase session token from the dashboard network request headers.

## If Something Looks Stuck

Check these first:

- Render cron service events for both historical jobs.
- `/api/entrata/sync-state` for `status_message`, `last_processed_at`, and `last_error_count`.
- `sync_retries` for repeat property/date failures.

If the raw job is still processing and `last_processed_at` is updating, leave it alone. Slow is expected.
