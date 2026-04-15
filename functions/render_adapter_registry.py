from dataclasses import asdict, dataclass


@dataclass(frozen=True)
class HttpEndpointSpec:
    route: str
    methods: tuple[str, ...]
    firebase_handler: str
    purpose: str


@dataclass(frozen=True)
class CronJobSpec:
    name: str
    schedule: str
    firebase_handler: str
    purpose: str


HTTP_ENDPOINT_SPECS = (
    HttpEndpointSpec(
        route="/api/entrata/backfill",
        methods=("POST",),
        firebase_handler="trigger_entrata_backfill",
        purpose="Manual Entrata backfill trigger.",
    ),
    HttpEndpointSpec(
        route="/api/entrata/background-backfill/run",
        methods=("POST",),
        firebase_handler="trigger_background_backfill_batch",
        purpose="Run one background backfill batch.",
    ),
    HttpEndpointSpec(
        route="/api/entrata/daily-refresh/run",
        methods=("POST",),
        firebase_handler="trigger_daily_refresh_batch",
        purpose="Run one daily refresh batch.",
    ),
    HttpEndpointSpec(
        route="/api/entrata/retry-queue/run",
        methods=("POST",),
        firebase_handler="trigger_retry_queue_batch",
        purpose="Run one retry queue batch.",
    ),
    HttpEndpointSpec(
        route="/api/entrata/specials/sync",
        methods=("POST",),
        firebase_handler="sync_entrata_specials",
        purpose="Sync Entrata specials.",
    ),
    HttpEndpointSpec(
        route="/api/entrata/availability-pricing/sync",
        methods=("POST",),
        firebase_handler="sync_entrata_units_availability_pricing",
        purpose="Sync Entrata availability and pricing snapshots.",
    ),
    HttpEndpointSpec(
        route="/api/entrata/lease-attribution/sync",
        methods=("POST",),
        firebase_handler="sync_entrata_lease_attribution",
        purpose="Sync normalized lease attribution data.",
    ),
    HttpEndpointSpec(
        route="/api/roi/aggregate",
        methods=("POST",),
        firebase_handler="aggregate_live_roi",
        purpose="Aggregate ROI into property daily reporting rows.",
    ),
    HttpEndpointSpec(
        route="/api/roi/ytd-backfill",
        methods=("POST",),
        firebase_handler="start_ytd_roi_backfill",
        purpose="Launch the YTD ROI backfill pipeline.",
    ),
    HttpEndpointSpec(
        route="/api/entrata/sync-state",
        methods=("GET",),
        firebase_handler="get_entrata_sync_state",
        purpose="Read Entrata background sync state and retry queue preview.",
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
    ),
    HttpEndpointSpec(
        route="/api/analytics/google-ads",
        methods=("GET", "POST", "OPTIONS"),
        firebase_handler="get_google_ads_dashboard_data",
        purpose="Fetch Google Ads dashboard payloads and cache them.",
    ),
    HttpEndpointSpec(
        route="/api/analytics/meta-ads",
        methods=("GET", "POST", "OPTIONS"),
        firebase_handler="get_meta_ads_dashboard_data",
        purpose="Fetch Meta Ads dashboard payloads and cache them.",
    ),
    HttpEndpointSpec(
        route="/api/analytics/reputation",
        methods=("GET", "POST", "OPTIONS"),
        firebase_handler="get_reputation_dashboard_data",
        purpose="Fetch Opiniion reputation dashboard payloads and cache them.",
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
        schedule="0 2 * * * America/Denver",
        firebase_handler="fetch_daily_entrata_leads_scheduled",
        purpose="Daily lead sync.",
    ),
    CronJobSpec(
        name="fetch_daily_entrata_events",
        schedule="0 2 * * * America/Denver",
        firebase_handler="fetch_daily_entrata_events_scheduled",
        purpose="Daily events sync.",
    ),
    CronJobSpec(
        name="fetch_daily_entrata_leases",
        schedule="0 2 * * * America/Denver",
        firebase_handler="fetch_daily_entrata_leases_scheduled",
        purpose="Daily leases sync.",
    ),
    CronJobSpec(
        name="fetch_daily_entrata_invoices",
        schedule="0 2 * * * America/Denver",
        firebase_handler="fetch_daily_entrata_invoices_scheduled",
        purpose="Daily invoices sync.",
    ),
    CronJobSpec(
        name="fetch_daily_entrata_availability",
        schedule="0 2 * * * America/Denver",
        firebase_handler="fetch_daily_entrata_availability_scheduled",
        purpose="Daily availability sync.",
    ),
    CronJobSpec(
        name="sync_daily_entrata_specials",
        schedule="10 1 * * * America/Denver",
        firebase_handler="sync_daily_entrata_specials_scheduled",
        purpose="Daily specials sync.",
    ),
    CronJobSpec(
        name="sync_daily_entrata_units_availability_pricing",
        schedule="20 1 * * * America/Denver",
        firebase_handler="sync_daily_entrata_units_availability_pricing_scheduled",
        purpose="Daily availability pricing sync.",
    ),
    CronJobSpec(
        name="sync_daily_entrata_lease_attribution",
        schedule="30 2 * * * America/Denver",
        firebase_handler="sync_daily_entrata_lease_attribution_scheduled",
        purpose="Daily lease attribution sync.",
    ),
    CronJobSpec(
        name="aggregate_daily_roi",
        schedule="0 3 * * * America/Denver",
        firebase_handler="aggregate_daily_roi_scheduled",
        purpose="Daily ROI aggregation.",
    ),
    CronJobSpec(
        name="start_daily_roi_pipeline",
        schedule="0 2 * * * America/Denver",
        firebase_handler="start_daily_roi_pipeline_scheduled",
        purpose="Launch the daily ROI pipeline.",
    ),
    CronJobSpec(
        name="run_roi_pipeline_jobs",
        schedule="*/5 * * * * America/Denver",
        firebase_handler="run_roi_pipeline_jobs_scheduled",
        purpose="Advance ROI pipeline jobs.",
    ),
    CronJobSpec(
        name="run_background_entrata_backfill",
        schedule="* * * * * America/Denver",
        firebase_handler="run_background_entrata_backfill_scheduled",
        purpose="Advance background backfill work.",
    ),
    CronJobSpec(
        name="run_daily_entrata_refresh",
        schedule="20 * * * * America/Denver",
        firebase_handler="run_daily_entrata_refresh_scheduled",
        purpose="Advance the daily refresh job.",
    ),
    CronJobSpec(
        name="run_entrata_retry_queue",
        schedule="2-59/5 * * * * America/Denver",
        firebase_handler="run_entrata_retry_queue_scheduled",
        purpose="Advance the retry queue.",
    ),
    CronJobSpec(
        name="weekly_site_audit",
        schedule="0 3 * * 1 America/Denver",
        firebase_handler="weekly_site_audit_scheduled",
        purpose="Weekly marketing site audit.",
    ),
)


def get_http_endpoint_specs() -> list[dict]:
    return [asdict(spec) for spec in HTTP_ENDPOINT_SPECS]


def get_cron_job_specs() -> list[dict]:
    return [asdict(spec) for spec in CRON_JOB_SPECS]
