# Heatmap + Site Audit Rollout Notes

## Future Aggregate Rendering

The current Reports heatmap renderer aggregates grid cells client-side from the heatmap summary endpoint's sampled event payload. That is fine for MVP and low-volume rollout.

Before broad rollout, wire the renderer to backend aggregate data from `property_heatmap_daily_cells` and `property_site_page_daily_summaries` so large traffic volumes do not require shipping thousands of raw events to the dashboard.

Target follow-up:
- Add scheduled aggregate jobs for click/cursor/scroll/engagement cells.
- Add an API shape that returns pre-aggregated cells by property, path, date range, device, and layer.
- Let `HeatmapRenderer` consume aggregate cells directly, keeping raw-event fallback for diagnostics.

## AI Website Audit

The site audit run endpoint can enrich deterministic audit output with OpenAI vision review when `OPENAI_API_KEY` is configured. The server signs the latest stored screenshots, sends them with page metadata to the Responses API, validates structured JSON output, and stores the results in the existing `property_site_audits.pages` and `raw_data.aiAudit` payloads.

AI audit runs can be queued for background processing by sending `background: true` to `/api/site-audit/run`. Render cron should run `python render_cron.py process_site_audit_jobs` after screenshot capture. The processor stores page-level AI responses in `property_site_audit_ai_cache`, keyed by model, prompt version, page context, and screenshot content hashes, so unchanged screenshots are not re-audited unnecessarily.

Structured checklist rows are also written to `property_site_audit_rubric_results` for trend reporting by property, page, and rubric key. The audit prompt includes calibration examples from the standardized Redstone website audit report, while Entrata availability/pricing and specials snapshots are included as truth data for pricing, availability, specials, and application-flow checks.

Optional controls:
- `SITE_AUDIT_AI_ENABLED=false` disables AI enrichment without changing the UI.
- `SITE_AUDIT_OPENAI_MODEL` overrides the default model.
- `SITE_AUDIT_AI_MAX_PAGES` limits how many pages are sent in one audit run.
- `SITE_AUDIT_AI_MAX_SCREENSHOTS_PER_PAGE` limits desktop/mobile/tablet screenshots sent for each page.
- `SITE_AUDIT_JOB_BATCH_LIMIT` controls how many queued audit jobs the background worker processes per run.
