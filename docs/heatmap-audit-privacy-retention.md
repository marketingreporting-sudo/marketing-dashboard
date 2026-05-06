# Heatmap and Site Audit Privacy/Retention Notes

## Collection Policy

- The Redstone tracker does not collect keystrokes, session replay streams, input values, hidden field values, full innerText, emails, or phone numbers.
- Sensitive controls such as password fields, text inputs, textareas, selects, and editable regions are ignored for click target labels.
- Consent mode is configured per tracking site:
  - `opt_out`: collect unless the page, cookie, or localStorage marks Redstone tracking as denied.
  - `required`: collect only after an explicit granted signal is present.
  - `disabled`: bypass Redstone consent checks for environments where consent is handled before script injection.
- Do Not Track is respected by default per tracking site and can be disabled only when the property has a separate compliance basis.

## Screenshot Policy

- Browser-side screenshots must request a signed upload URL before uploading to Supabase Storage.
- Scheduled screenshots are captured server-side by the `capture_site_screenshots` Render cron job when screenshots are enabled and capture frequency is `daily` or `weekly`.
- The scheduled capture job uses Playwright Chromium, writes temporary JPEG screenshots to `/tmp`, hashes them, uploads to Supabase Storage, and upserts `property_site_screenshots`.
- The API validates site key, allowed domain, page path, device type, MIME type, dimensions, file-size intent, and screenshot feature flags.
- Screenshot files are written to a stable object path per `property/site/page/device` with upload upsert enabled. This keeps the current screenshot set small and replaces the previous screenshot for that page/device.
- Relational rows store only screenshot metadata and object pointers, not base64/image blobs.
- The upload-url endpoint enforces a per-page/device minimum interval. The site-level `screenshot_capture_frequency` raises that minimum to at least 24 hours for daily and 168 hours for weekly.
- Render supports stricter bucket-specific public write limits. For screenshots, start with:
  - `PUBLIC_WRITE_RATE_LIMIT_SITE_AUDIT_SCREENSHOT_UPLOAD_URL_PER_IP=10`
  - `PUBLIC_WRITE_RATE_LIMIT_SITE_AUDIT_SCREENSHOT_UPLOAD_URL_PER_SITE=60`
  - `PUBLIC_WRITE_RATE_LIMIT_WINDOW_SECONDS=60`

## Retention Operations

- Raw event retention is controlled per tracking site in the dashboard, with a default of 90 days.
- Long-term reporting should read from aggregate tables after the aggregate job is scheduled:
  - `property_heatmap_daily_cells`
  - `property_site_page_daily_summaries`
- Run `public.refresh_property_site_tracking_aggregates(start_date, end_date)` on a rolling schedule before pruning raw events.
- Run `public.prune_property_site_tracking(retain_raw_days, retain_snapshot_days, retain_audit_days)` on a daily or weekly schedule. Supabase `pg_cron` is preferred when available; otherwise use a Render cron job with a service-role RPC call.
- Orphaned screenshot objects should be rare because current object paths are overwritten. If the path convention changes, run a storage cleanup comparing `site-screenshots` objects against `property_site_screenshots.storage_path`.

## Internal Rollout Defaults

- Start with sampling at 10%.
- Keep screenshots disabled until a property has allowed domains, consent behavior, and capture frequency reviewed.
- Keep consent mode at `opt_out` and `respect_dnt` enabled unless Legal/Compliance approves a different property-level default.
- Use the Render screenshot-preview endpoint for dashboard display; do not make the `site-screenshots` bucket public.
