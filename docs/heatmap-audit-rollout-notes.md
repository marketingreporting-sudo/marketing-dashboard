# Heatmap + Site Audit Rollout Notes

## Future Aggregate Rendering

The current Reports heatmap renderer aggregates grid cells client-side from the heatmap summary endpoint's sampled event payload. That is fine for MVP and low-volume rollout.

Before broad rollout, wire the renderer to backend aggregate data from `property_heatmap_daily_cells` and `property_site_page_daily_summaries` so large traffic volumes do not require shipping thousands of raw events to the dashboard.

Target follow-up:
- Add scheduled aggregate jobs for click/cursor/scroll/engagement cells.
- Add an API shape that returns pre-aggregated cells by property, path, date range, device, and layer.
- Let `HeatmapRenderer` consume aggregate cells directly, keeping raw-event fallback for diagnostics.
