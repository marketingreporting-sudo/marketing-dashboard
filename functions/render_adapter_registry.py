from dataclasses import asdict, dataclass


@dataclass(frozen=True)
class HttpEndpointSpec:
    route: str
    methods: tuple[str, ...]
    firebase_handler: str
    purpose: str
    render_handler: str | None = None


@dataclass(frozen=True)
class CronJobSpec:
    name: str
    schedule: str
    firebase_handler: str
    purpose: str
    render_command: str | None = None


HTTP_ENDPOINT_SPECS = (
    HttpEndpointSpec(
        route="/api/entrata/backfill",
        methods=("POST",),
        firebase_handler="trigger_entrata_backfill",
        purpose="Manual Entrata backfill trigger.",
        render_handler="trigger_entrata_backfill",
    ),
    HttpEndpointSpec(
        route="/api/entrata/background-backfill/run",
        methods=("POST",),
        firebase_handler="trigger_background_backfill_batch",
        purpose="Run one background backfill batch.",
        render_handler="run_named_cron_job(run_background_entrata_backfill)",
    ),
    HttpEndpointSpec(
        route="/api/entrata/daily-refresh/run",
        methods=("POST",),
        firebase_handler="trigger_daily_refresh_batch",
        purpose="Run one daily refresh batch.",
        render_handler="run_named_cron_job(run_daily_entrata_refresh)",
    ),
    HttpEndpointSpec(
        route="/api/entrata/retry-queue/run",
        methods=("POST",),
        firebase_handler="trigger_retry_queue_batch",
        purpose="Run one retry queue batch.",
        render_handler="run_named_cron_job(run_entrata_retry_queue)",
    ),
    HttpEndpointSpec(
        route="/api/entrata/specials/sync",
        methods=("POST",),
        firebase_handler="sync_entrata_specials",
        purpose="Sync Entrata specials.",
        render_handler="run_named_cron_job(sync_daily_entrata_specials)",
    ),
    HttpEndpointSpec(
        route="/api/entrata/availability-pricing/sync",
        methods=("POST",),
        firebase_handler="sync_entrata_units_availability_pricing",
        purpose="Sync Entrata availability and pricing snapshots.",
        render_handler="run_named_cron_job(sync_daily_entrata_units_availability_pricing)",
    ),
    HttpEndpointSpec(
        route="/api/entrata/lease-attribution/sync",
        methods=("POST",),
        firebase_handler="sync_entrata_lease_attribution",
        purpose="Sync normalized lease attribution data.",
        render_handler="run_named_cron_job(sync_daily_entrata_lease_attribution)",
    ),
    HttpEndpointSpec(
        route="/api/roi/aggregate",
        methods=("POST",),
        firebase_handler="aggregate_live_roi",
        purpose="Aggregate ROI into property daily reporting rows.",
        render_handler="run_named_cron_job(aggregate_daily_roi)",
    ),
    HttpEndpointSpec(
        route="/api/roi/ytd-backfill",
        methods=("POST",),
        firebase_handler="start_ytd_roi_backfill",
        purpose="Launch the YTD ROI backfill pipeline.",
        render_handler="run_named_cron_job(start_daily_roi_pipeline)",
    ),
    HttpEndpointSpec(
        route="/api/entrata/sync-state",
        methods=("GET",),
        firebase_handler="get_entrata_sync_state",
        purpose="Read Entrata background sync state and retry queue preview.",
    ),
    HttpEndpointSpec(
        route="/api/admin/sync-health",
        methods=("GET",),
        firebase_handler="render_only",
        purpose="Read admin sync health summary for Entrata refresh, retries, and key table freshness.",
        render_handler="get_supabase_sync_health_summary",
    ),
    HttpEndpointSpec(
        route="/api/roi/pipeline-status",
        methods=("GET",),
        firebase_handler="get_roi_pipeline_status",
        purpose="Read ROI pipeline status.",
    ),
    HttpEndpointSpec(
        route="/api/entrata/sync-state/reset",
        methods=("POST",),
        firebase_handler="reset_entrata_sync_state",
        purpose="Reset selected sync state documents.",
    ),
    HttpEndpointSpec(
        route="/api/entrata/lease-details",
        methods=("GET", "POST"),
        firebase_handler="fetch_entrata_lease_details",
        purpose="Fetch and cache lease detail payloads.",
    ),
    HttpEndpointSpec(
        route="/api/analytics/ga4",
        methods=("GET", "POST", "OPTIONS"),
        firebase_handler="get_ga4_dashboard_data",
        purpose="Fetch GA4 dashboard payloads and cache them.",
        render_handler="fetch_and_store_ga4_dashboard",
    ),
    HttpEndpointSpec(
        route="/api/analytics/google-ads",
        methods=("GET", "POST", "OPTIONS"),
        firebase_handler="get_google_ads_dashboard_data",
        purpose="Fetch Google Ads dashboard payloads and cache them.",
        render_handler="fetch_and_store_google_ads_dashboard",
    ),
    HttpEndpointSpec(
        route="/api/analytics/meta-ads",
        methods=("GET", "POST", "OPTIONS"),
        firebase_handler="get_meta_ads_dashboard_data",
        purpose="Fetch Meta Ads dashboard payloads and cache them.",
        render_handler="fetch_and_store_meta_ads_dashboard",
    ),
    HttpEndpointSpec(
        route="/api/analytics/local-falcon",
        methods=("GET", "POST", "OPTIONS"),
        firebase_handler="render_only",
        purpose="Fetch Local Falcon local SEO report payloads and cache them.",
        render_handler="fetch_and_store_local_falcon_dashboard",
    ),
    HttpEndpointSpec(
        route="/api/admin/local-falcon/location-matches",
        methods=("GET", "POST", "OPTIONS"),
        firebase_handler="render_only",
        purpose="Admin-only discovery endpoint for matching dashboard properties to Local Falcon locations.",
        render_handler="build_local_falcon_location_match_summary",
    ),
    HttpEndpointSpec(
        route="/api/heatmaps/tracker.js",
        methods=("GET", "OPTIONS"),
        firebase_handler="render_only",
        purpose="Serve the public heatmap tracking script for a configured property site key.",
        render_handler="get_heatmap_tracker_payload",
    ),
    HttpEndpointSpec(
        route="/api/heatmaps/collect",
        methods=("POST", "OPTIONS"),
        firebase_handler="render_only",
        purpose="Collect batched anonymous heatmap session and interaction events into Supabase.",
        render_handler="collect_heatmap_payload",
    ),
    HttpEndpointSpec(
        route="/api/heatmaps/summary",
        methods=("GET", "POST", "OPTIONS"),
        firebase_handler="render_only",
        purpose="Read property-scoped heatmap event summaries for reporting and analytics views.",
        render_handler="get_heatmap_summary",
    ),
    HttpEndpointSpec(
        route="/api/heatmaps/pages",
        methods=("GET", "POST", "OPTIONS"),
        firebase_handler="render_only",
        purpose="Read property-scoped page inventory and event counts for heatmap page selectors.",
        render_handler="get_heatmap_pages_summary",
    ),
    HttpEndpointSpec(
        route="/api/admin/heatmap-sites",
        methods=("GET", "POST", "OPTIONS"),
        firebase_handler="render_only",
        purpose="List and save property-scoped heatmap tracking site configuration.",
        render_handler="list_heatmap_sites_summary/save_heatmap_site_summary",
    ),
    HttpEndpointSpec(
        route="/api/site-audit/page-snapshot",
        methods=("POST", "OPTIONS"),
        firebase_handler="render_only",
        purpose="Collect safe page inventory and audit snapshot metadata from the shared Redstone snippet.",
        render_handler="collect_site_page_snapshot_payload",
    ),
    HttpEndpointSpec(
        route="/api/site-audit/pages",
        methods=("GET", "POST", "OPTIONS"),
        firebase_handler="render_only",
        purpose="Read property-scoped page inventory, latest snapshots, and screenshot metadata for site audits.",
        render_handler="get_site_audit_pages_summary",
    ),
    HttpEndpointSpec(
        route="/api/site-audit/run",
        methods=("POST", "OPTIONS"),
        firebase_handler="render_only",
        purpose="Run the first-pass deterministic site audit against latest page snapshots.",
        render_handler="run_site_audit_summary",
    ),
    HttpEndpointSpec(
        route="/api/site-audit/summary",
        methods=("GET", "POST", "OPTIONS"),
        firebase_handler="render_only",
        purpose="Read the latest property-scoped site audit result.",
        render_handler="get_site_audit_summary",
    ),
    HttpEndpointSpec(
        route="/api/site-audit/screenshot",
        methods=("POST", "OPTIONS"),
        firebase_handler="render_only",
        purpose="Register latest page screenshot metadata; binary upload must happen through object storage, not this endpoint.",
        render_handler="save_site_screenshot_metadata_payload",
    ),
    HttpEndpointSpec(
        route="/api/site-audit/screenshot-upload-url",
        methods=("POST", "OPTIONS"),
        firebase_handler="render_only",
        purpose="Create a validated Supabase Storage signed upload URL for the latest page screenshot object.",
        render_handler="create_site_screenshot_upload_url_payload",
    ),
    HttpEndpointSpec(
        route="/api/site-audit/screenshot-preview",
        methods=("GET", "POST", "OPTIONS"),
        firebase_handler="render_only",
        purpose="Create an authenticated short-lived signed read URL for a private site screenshot.",
        render_handler="get_site_screenshot_preview_summary",
    ),
    HttpEndpointSpec(
        route="/api/analytics/reputation",
        methods=("GET", "POST", "OPTIONS"),
        firebase_handler="get_reputation_dashboard_data",
        purpose="Fetch Opiniion reputation dashboard payloads and cache them.",
        render_handler="fetch_and_store_reputation_dashboard",
    ),
    HttpEndpointSpec(
        route="/api/cron/run",
        methods=("POST", "OPTIONS"),
        firebase_handler="not_available_in_firebase",
        purpose="Run a named cron job through the Render runtime.",
        render_handler="run_named_cron_job",
    ),
    HttpEndpointSpec(
        route="/api/reporting/property-overview",
        methods=("GET", "POST", "OPTIONS"),
        firebase_handler="staging_supabase_property_overview_only",
        purpose="Read a staging-only Supabase property reporting overview payload.",
    ),
    HttpEndpointSpec(
        route="/api/admin/website-manager",
        methods=("GET", "POST", "OPTIONS"),
        firebase_handler="staging_supabase_website_manager_only",
        purpose="Read, save, and publish staged website editor content from Supabase.",
    ),
    HttpEndpointSpec(
        route="/api/admin/website-manager/schema",
        methods=("GET", "POST", "OPTIONS"),
        firebase_handler="staging_supabase_website_manager_schema_only",
        purpose="Read and save admin-managed website editor field schemas.",
    ),
    HttpEndpointSpec(
        route="/api/admin/reporting-layout",
        methods=("GET", "POST", "OPTIONS"),
        firebase_handler="staging_supabase_reporting_layout_only",
        purpose="Read and save staging-only reporting layout content from Supabase.",
    ),
    HttpEndpointSpec(
        route="/api/staging/supabase/migration-validation",
        methods=("GET",),
        firebase_handler="staging_supabase_validation_only",
        purpose="Read a staging-only Supabase migration validation summary.",
    ),
)


CRON_JOB_SPECS = (
    CronJobSpec(
        name="fetch_daily_entrata_leads",
        schedule="0 9 * * * UTC",
        firebase_handler="fetch_daily_entrata_leads_scheduled",
        purpose="Default-property Entrata leads canary; portfolio-wide daily import is run_daily_entrata_refresh.",
        render_command="python render_cron.py fetch_daily_entrata_leads",
    ),
    CronJobSpec(
        name="fetch_daily_entrata_events",
        schedule="5 9 * * * UTC",
        firebase_handler="fetch_daily_entrata_events_scheduled",
        purpose="Default-property Entrata events canary; portfolio-wide daily import is run_daily_entrata_refresh.",
        render_command="python render_cron.py fetch_daily_entrata_events",
    ),
    CronJobSpec(
        name="fetch_daily_entrata_leases",
        schedule="10 9 * * * UTC",
        firebase_handler="fetch_daily_entrata_leases_scheduled",
        purpose="Default-property Entrata leases canary; portfolio-wide daily import is run_daily_entrata_refresh.",
        render_command="python render_cron.py fetch_daily_entrata_leases",
    ),
    CronJobSpec(
        name="fetch_daily_entrata_invoices",
        schedule="15 9 * * * UTC",
        firebase_handler="fetch_daily_entrata_invoices_scheduled",
        purpose="Default-property Entrata invoices canary; portfolio-wide daily import is run_daily_entrata_refresh.",
        render_command="python render_cron.py fetch_daily_entrata_invoices",
    ),
    CronJobSpec(
        name="sync_daily_entrata_specials",
        schedule="10 */4 * * * UTC",
        firebase_handler="sync_daily_entrata_specials_scheduled",
        purpose="Entrata specials sync every four hours.",
        render_command="python render_cron.py sync_daily_entrata_specials",
    ),
    CronJobSpec(
        name="sync_daily_entrata_units_availability_pricing",
        schedule="20 */4 * * * UTC",
        firebase_handler="sync_daily_entrata_units_availability_pricing_scheduled",
        purpose="Entrata availability pricing sync every four hours.",
        render_command="python render_cron.py sync_daily_entrata_units_availability_pricing",
    ),
    CronJobSpec(
        name="sync_wordpress_website_manager",
        schedule="35 */4 * * * UTC",
        firebase_handler="render_only",
        purpose="Publish cached website editor + Entrata snapshot content to WordPress every four hours.",
        render_command="python render_cron.py sync_wordpress_website_manager",
    ),
    CronJobSpec(
        name="sync_daily_entrata_lease_attribution",
        schedule="30 10 * * * UTC",
        firebase_handler="sync_daily_entrata_lease_attribution_scheduled",
        purpose="Daily lease attribution sync.",
        render_command="python render_cron.py sync_daily_entrata_lease_attribution",
    ),
    CronJobSpec(
        name="aggregate_daily_roi",
        schedule="30 11 * * * UTC",
        firebase_handler="aggregate_daily_roi_scheduled",
        purpose="Daily ROI aggregation.",
        render_command="python render_cron.py aggregate_daily_roi",
    ),
    CronJobSpec(
        name="start_daily_roi_pipeline",
        schedule="30 9 * * * UTC",
        firebase_handler="start_daily_roi_pipeline_scheduled",
        purpose="Launch the daily ROI pipeline.",
        render_command="python render_cron.py start_daily_roi_pipeline",
    ),
    CronJobSpec(
        name="run_roi_pipeline_jobs",
        schedule="*/5 * * * * UTC",
        firebase_handler="run_roi_pipeline_jobs_scheduled",
        purpose="Advance ROI pipeline jobs.",
        render_command="python render_cron.py run_roi_pipeline_jobs",
    ),
    CronJobSpec(
        name="run_background_entrata_backfill",
        schedule="*/15 * * * * UTC",
        firebase_handler="run_background_entrata_backfill_scheduled",
        purpose="Advance recent background backfill work on a throttled cadence.",
        render_command="python render_cron.py run_background_entrata_backfill",
    ),
    CronJobSpec(
        name="run_historical_entrata_backfill",
        schedule="5-59/15 * * * * UTC",
        firebase_handler="render_only",
        purpose="Slowly backfill older Entrata raw data sequentially by date and property.",
        render_command="python render_cron.py run_historical_entrata_backfill",
    ),
    CronJobSpec(
        name="run_historical_lease_attribution",
        schedule="10-59/15 * * * * UTC",
        firebase_handler="render_only",
        purpose="Slowly backfill normalized lease attribution across properties for a configured historical window.",
        render_command="python render_cron.py run_historical_lease_attribution",
    ),
    CronJobSpec(
        name="run_daily_entrata_refresh",
        schedule="45 * * * * UTC",
        firebase_handler="run_daily_entrata_refresh_scheduled",
        purpose="Advance the daily refresh job.",
        render_command="python render_cron.py run_daily_entrata_refresh",
    ),
    CronJobSpec(
        name="run_entrata_retry_queue",
        schedule="2-59/5 * * * * UTC",
        firebase_handler="run_entrata_retry_queue_scheduled",
        purpose="Advance the retry queue.",
        render_command="python render_cron.py run_entrata_retry_queue",
    ),
    CronJobSpec(
        name="weekly_site_audit",
        schedule="0 10 * * 1 UTC",
        firebase_handler="weekly_site_audit_scheduled",
        purpose="Weekly marketing site audit.",
        render_command="python render_cron.py weekly_site_audit",
    ),
    CronJobSpec(
        name="maintain_site_tracking",
        schedule="15 9 * * * UTC",
        firebase_handler="n/a",
        purpose="Refresh heatmap/site audit aggregate tables, then prune old raw tracking rows.",
        render_command="python render_cron.py maintain_site_tracking",
    ),
    CronJobSpec(
        name="capture_site_screenshots",
        schedule="35 9 * * * UTC",
        firebase_handler="n/a",
        purpose="Capture latest page screenshots for heatmap backgrounds and site audits.",
        render_command="python render_cron.py capture_site_screenshots",
    ),
)


def get_http_endpoint_specs() -> list[dict]:
    return [asdict(spec) for spec in HTTP_ENDPOINT_SPECS]


def get_cron_job_specs() -> list[dict]:
    return [asdict(spec) for spec in CRON_JOB_SPECS]
