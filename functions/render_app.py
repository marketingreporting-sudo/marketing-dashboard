import os

from flask import Flask, jsonify, make_response, request

from render_adapter_registry import get_cron_job_specs, get_http_endpoint_specs
from render_supabase_analytics import get_cached_analytics_summary
from render_supabase_reporting import get_property_reporting_overview_summary
from render_supabase_roi import get_supabase_roi_pipeline_status_summary
from render_supabase_sync_state import get_supabase_sync_state_summary
from render_supabase_validation import (
    SupabaseValidationConfigError,
    get_supabase_migration_validation_summary,
)


def create_app() -> Flask:
    app = Flask(__name__)

    def build_cors_json_response(payload: dict, status_code: int = 200):
        response = make_response(jsonify(payload), status_code)
        response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type,Authorization"
        return response

    @app.get("/")
    def root():
        return jsonify(
            {
                "service": "data-analysis-render-adapter",
                "status": "ok",
                "mode": "staging-scaffold",
                "message": (
                    "This is the first Render-native adapter layer. "
                    "Firebase Functions remain the source of truth until cutover."
                ),
            }
        )

    @app.get("/healthz")
    def healthcheck():
        return jsonify({"status": "ok"})

    @app.get("/readyz")
    def readiness():
        return jsonify(
            {
                "status": "ready",
                "adapter_mode": "metadata-only",
                "firebase_runtime_preserved": True,
                "supabase_cutover_complete": False,
                "port": os.environ.get("PORT"),
            }
        )

    @app.get("/api/meta/architecture")
    def architecture():
        return jsonify(
            {
                "frontend_root": "dashboard",
                "backend_root": "functions",
                "current_backend_runtime": "firebase_functions",
                "render_adapter_runtime": "flask",
                "firebase_still_active": True,
                "notes": [
                    "This adapter does not replace existing business logic yet.",
                    "Use it as the first Render web-service entrypoint.",
                ],
            }
        )

    @app.get("/api/meta/routes")
    def route_inventory():
        return jsonify(
            {
                "count": len(get_http_endpoint_specs()),
                "routes": get_http_endpoint_specs(),
            }
        )

    @app.get("/api/entrata/sync-state")
    def staged_sync_state():
        payload = get_supabase_sync_state_summary()
        status_code = 200 if payload.get("status") == "ok" else 503
        return jsonify(payload), status_code

    @app.get("/api/roi/pipeline-status")
    def staged_roi_pipeline_status():
        payload = get_supabase_roi_pipeline_status_summary()
        status_code = 200 if payload.get("status") == "ok" else 503
        return jsonify(payload), status_code

    @app.route("/api/analytics/reputation", methods=["GET", "POST", "OPTIONS"])
    def staged_reputation_dashboard():
        if request.method == "OPTIONS":
            return build_cors_json_response({})

        req_json = request.get_json(silent=True) or {}
        property_id = request.args.get("property_id") or req_json.get("property_id")
        if not property_id:
            return build_cors_json_response(
                {
                    "status": "error",
                    "error": "Missing required parameter: property_id",
                    "staging_only": True,
                },
                status_code=400,
            )

        payload = get_cached_analytics_summary(str(property_id), "reputation")
        status_code = 200 if payload.get("status") != "error" else 404
        return build_cors_json_response(payload, status_code=status_code)

    @app.route("/api/analytics/ga4", methods=["GET", "POST", "OPTIONS"])
    def staged_ga4_dashboard():
        if request.method == "OPTIONS":
            return build_cors_json_response({})

        req_json = request.get_json(silent=True) or {}
        property_id = request.args.get("property_id") or req_json.get("property_id")
        if not property_id:
            return build_cors_json_response(
                {
                    "status": "error",
                    "error": "Missing required parameter: property_id",
                    "staging_only": True,
                },
                status_code=400,
            )

        payload = get_cached_analytics_summary(str(property_id), "ga4")
        status_code = 200 if payload.get("status") != "error" else 404
        return build_cors_json_response(payload, status_code=status_code)

    @app.route("/api/analytics/google-ads", methods=["GET", "POST", "OPTIONS"])
    def staged_google_ads_dashboard():
        if request.method == "OPTIONS":
            return build_cors_json_response({})

        req_json = request.get_json(silent=True) or {}
        property_id = request.args.get("property_id") or req_json.get("property_id")
        if not property_id:
            return build_cors_json_response(
                {
                    "status": "error",
                    "error": "Missing required parameter: property_id",
                    "staging_only": True,
                },
                status_code=400,
            )

        payload = get_cached_analytics_summary(str(property_id), "google_ads")
        status_code = 200 if payload.get("status") != "error" else 404
        return build_cors_json_response(payload, status_code=status_code)

    @app.route("/api/analytics/meta-ads", methods=["GET", "POST", "OPTIONS"])
    def staged_meta_ads_dashboard():
        if request.method == "OPTIONS":
            return build_cors_json_response({})

        req_json = request.get_json(silent=True) or {}
        property_id = request.args.get("property_id") or req_json.get("property_id")
        if not property_id:
            return build_cors_json_response(
                {
                    "status": "error",
                    "error": "Missing required parameter: property_id",
                    "staging_only": True,
                },
                status_code=400,
            )

        payload = get_cached_analytics_summary(str(property_id), "meta_ads")
        status_code = 200 if payload.get("status") != "error" else 404
        return build_cors_json_response(payload, status_code=status_code)

    @app.route("/api/reporting/property-overview", methods=["GET", "POST", "OPTIONS"])
    def staged_property_reporting_overview():
        if request.method == "OPTIONS":
            return build_cors_json_response({})

        req_json = request.get_json(silent=True) or {}
        property_id = request.args.get("property_id") or req_json.get("property_id")
        start_date = request.args.get("start_date") or req_json.get("start_date")
        end_date = request.args.get("end_date") or req_json.get("end_date")
        if not property_id:
            return build_cors_json_response(
                {
                    "status": "error",
                    "error": "Missing required parameter: property_id",
                    "staging_only": True,
                },
                status_code=400,
            )

        payload = get_property_reporting_overview_summary(str(property_id), start_date, end_date)
        status_code = 200 if payload.get("status") != "error" else 503
        return build_cors_json_response(payload, status_code=status_code)

    @app.get("/api/meta/cron-jobs")
    def cron_inventory():
        return jsonify(
            {
                "count": len(get_cron_job_specs()),
                "jobs": get_cron_job_specs(),
            }
        )

    @app.get("/api/staging/supabase/migration-validation")
    def supabase_migration_validation():
        try:
            return jsonify(get_supabase_migration_validation_summary())
        except SupabaseValidationConfigError as error:
            return (
                jsonify(
                    {
                        "status": "error",
                        "message": str(error),
                        "staging_only": True,
                    }
                ),
                503,
            )

    return app


app = create_app()
