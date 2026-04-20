import os

from flask import Flask, jsonify, make_response, request

from render_auth import (
    RenderAuthError,
    RenderPermissionError,
    require_authenticated_user,
    user_has_platform_permission,
    user_has_property_permission,
)
from render_adapter_registry import get_cron_job_specs, get_http_endpoint_specs
from render_runtime import (
    fetch_and_store_ga4_dashboard,
    fetch_and_store_google_ads_dashboard,
    fetch_and_store_meta_ads_dashboard,
    fetch_and_store_reputation_dashboard,
    install_render_storage_overrides,
    run_named_cron_job,
    trigger_entrata_backfill,
)
from render_supabase_admin_content import (
    get_reporting_layout_summary,
    get_website_manager_summary,
    publish_website_manager_summary,
    save_reporting_layout_summary,
    save_website_manager_summary,
)
from render_supabase_admin_access import (
    invite_user_with_access_summary,
    list_access_admin_summary,
    update_user_access_summary,
)
from render_supabase_reporting import get_property_reporting_overview_summary
from render_supabase_roi import get_supabase_roi_pipeline_status_summary
from render_supabase_sync_state import get_supabase_sync_state_summary
from render_supabase_validation import (
    SupabaseValidationConfigError,
    get_supabase_migration_validation_summary,
)


def create_app() -> Flask:
    app = Flask(__name__)
    install_render_storage_overrides()

    @app.after_request
    def apply_cors_headers(response):
        response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type,Authorization"
        return response

    def build_cors_json_response(payload: dict, status_code: int = 200):
        response = make_response(jsonify(payload), status_code)
        return response

    def get_authenticated_request_context():
        access_token, user = require_authenticated_user(request.headers.get("Authorization"))
        return access_token, user

    def require_property_permission(property_id: str, permission: str):
        access_token, user = get_authenticated_request_context()
        if not user_has_property_permission(access_token, property_id, permission):
            raise RenderPermissionError(
                f"Authenticated user does not have '{permission}' access for property {property_id}."
            )
        return access_token, user

    def require_platform_permission(permission: str):
        access_token, user = get_authenticated_request_context()
        if not user_has_platform_permission(access_token, permission):
            raise RenderPermissionError(f"Authenticated user does not have '{permission}' access.")
        return access_token, user

    @app.get("/")
    def root():
        return jsonify(
            {
                "service": "data-analysis-render-adapter",
                "status": "ok",
                "mode": "render-runtime-active",
                "message": (
                    "Render runtime is active for staging APIs, analytics fetchers, "
                    "and Entrata cron execution."
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
                "adapter_mode": "live-runtime",
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
                "current_backend_runtime": "render_plus_legacy_logic",
                "render_adapter_runtime": "flask",
                "firebase_still_active": True,
                "notes": [
                    "Render now executes staged analytics fetchers and Entrata sync jobs.",
                    "Some Firebase-era backend jobs may still remain outside this adapter.",
                ],
            }
        )

    @app.route("/api/cron/run", methods=["POST", "OPTIONS"])
    def run_cron_job():
        if request.method == "OPTIONS":
            return build_cors_json_response({})

        try:
            require_platform_permission("users.manage")
        except RenderPermissionError as error:
            return build_cors_json_response({"status": "error", "error": str(error)}, status_code=403)
        except RenderAuthError as error:
            return build_cors_json_response({"status": "error", "error": str(error)}, status_code=401)

        req_json = request.get_json(silent=True) or {}
        job_name = request.args.get("job_name") or req_json.get("job_name")
        if not job_name:
            return build_cors_json_response(
                {"status": "error", "error": "Missing required parameter: job_name", "staging_only": True},
                status_code=400,
            )
        try:
            payload = run_named_cron_job(str(job_name))
            return build_cors_json_response(payload)
        except Exception as error:
            return build_cors_json_response(
                {"status": "error", "error": str(error), "job_name": job_name, "staging_only": True},
                status_code=500,
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
        try:
            access_token, _user = get_authenticated_request_context()
        except RenderAuthError as error:
            return build_cors_json_response({"status": "error", "error": str(error)}, status_code=401)

        payload = get_supabase_sync_state_summary(access_token=access_token)
        status_code = 200 if payload.get("status") == "ok" else 503
        return jsonify(payload), status_code

    @app.get("/api/roi/pipeline-status")
    def staged_roi_pipeline_status():
        try:
            access_token, _user = get_authenticated_request_context()
        except RenderAuthError as error:
            return build_cors_json_response({"status": "error", "error": str(error)}, status_code=401)

        payload = get_supabase_roi_pipeline_status_summary(access_token=access_token)
        status_code = 200 if payload.get("status") == "ok" else 503
        return jsonify(payload), status_code

    @app.route("/api/analytics/reputation", methods=["GET", "POST", "OPTIONS"])
    def staged_reputation_dashboard():
        if request.method == "OPTIONS":
            return build_cors_json_response({})

        req_json = request.get_json(silent=True) or {}
        property_id = request.args.get("property_id") or req_json.get("property_id")
        location_id = request.args.get("location_id") or req_json.get("location_id")
        location_name = request.args.get("location_name") or req_json.get("location_name")
        property_name = request.args.get("property_name") or req_json.get("property_name")
        property_city = request.args.get("property_city") or req_json.get("property_city")
        start_date_value = request.args.get("start_date") or req_json.get("start_date")
        end_date_value = request.args.get("end_date") or req_json.get("end_date")
        default_days = request.args.get("days") or req_json.get("days") or 90
        if not property_id:
            return build_cors_json_response(
                {
                    "status": "error",
                    "error": "Missing required parameter: property_id",
                    "staging_only": True,
                },
                status_code=400,
            )

        try:
            require_property_permission(str(property_id), "reputation.view")
            payload = fetch_and_store_reputation_dashboard(
                property_id=str(property_id),
                location_id=location_id,
                location_name=location_name,
                property_name=property_name,
                property_city=property_city,
                start_date_value=start_date_value,
                end_date_value=end_date_value,
                default_days=int(default_days),
            )
            status_code = 200
        except ValueError as error:
            payload = {"status": "error", "error": str(error), "staging_only": True}
            status_code = 400
        except RenderPermissionError as error:
            payload = {"status": "error", "error": str(error), "staging_only": True}
            status_code = 403
        except RenderAuthError as error:
            payload = {"status": "error", "error": str(error), "staging_only": True}
            status_code = 401
        except Exception as error:
            payload = {"status": "error", "error": str(error), "staging_only": True}
            status_code = 500
        return build_cors_json_response(payload, status_code=status_code)

    @app.route("/api/analytics/ga4", methods=["GET", "POST", "OPTIONS"])
    def staged_ga4_dashboard():
        if request.method == "OPTIONS":
            return build_cors_json_response({})

        req_json = request.get_json(silent=True) or {}
        property_id = request.args.get("property_id") or req_json.get("property_id")
        ga4_property_id = request.args.get("ga4_property_id") or req_json.get("ga4_property_id")
        start_date_value = request.args.get("start_date") or req_json.get("start_date")
        end_date_value = request.args.get("end_date") or req_json.get("end_date")
        default_days = request.args.get("days") or req_json.get("days") or 90
        if not property_id:
            return build_cors_json_response(
                {
                    "status": "error",
                    "error": "Missing required parameter: property_id",
                    "staging_only": True,
                },
                status_code=400,
            )
        if not ga4_property_id:
            return build_cors_json_response(
                {"status": "error", "error": "Missing required parameter: ga4_property_id", "staging_only": True},
                status_code=400,
            )

        try:
            require_property_permission(str(property_id), "analytics.view")
            payload = fetch_and_store_ga4_dashboard(
                property_id=str(property_id),
                ga4_property_id=str(ga4_property_id),
                start_date_value=start_date_value,
                end_date_value=end_date_value,
                default_days=int(default_days),
            )
            status_code = 200
        except ValueError as error:
            payload = {"status": "error", "error": str(error), "staging_only": True}
            status_code = 400
        except RenderPermissionError as error:
            payload = {"status": "error", "error": str(error), "staging_only": True}
            status_code = 403
        except RenderAuthError as error:
            payload = {"status": "error", "error": str(error), "staging_only": True}
            status_code = 401
        except Exception as error:
            payload = {"status": "error", "error": str(error), "staging_only": True}
            status_code = 500
        return build_cors_json_response(payload, status_code=status_code)

    @app.route("/api/analytics/google-ads", methods=["GET", "POST", "OPTIONS"])
    def staged_google_ads_dashboard():
        if request.method == "OPTIONS":
            return build_cors_json_response({})

        req_json = request.get_json(silent=True) or {}
        property_id = request.args.get("property_id") or req_json.get("property_id")
        google_ads_customer_id = request.args.get("google_ads_customer_id") or req_json.get("google_ads_customer_id")
        property_name = request.args.get("property_name") or req_json.get("property_name")
        start_date_value = request.args.get("start_date") or req_json.get("start_date")
        end_date_value = request.args.get("end_date") or req_json.get("end_date")
        default_days = request.args.get("days") or req_json.get("days") or 90
        if not property_id:
            return build_cors_json_response(
                {
                    "status": "error",
                    "error": "Missing required parameter: property_id",
                    "staging_only": True,
                },
                status_code=400,
            )
        if not google_ads_customer_id:
            return build_cors_json_response(
                {"status": "error", "error": "Missing required parameter: google_ads_customer_id", "staging_only": True},
                status_code=400,
            )

        try:
            require_property_permission(str(property_id), "analytics.view")
            payload = fetch_and_store_google_ads_dashboard(
                property_id=str(property_id),
                google_ads_customer_id=str(google_ads_customer_id),
                property_name=property_name,
                start_date_value=start_date_value,
                end_date_value=end_date_value,
                default_days=int(default_days),
            )
            status_code = 200
        except ValueError as error:
            payload = {"status": "error", "error": str(error), "staging_only": True}
            status_code = 400
        except RenderPermissionError as error:
            payload = {"status": "error", "error": str(error), "staging_only": True}
            status_code = 403
        except RenderAuthError as error:
            payload = {"status": "error", "error": str(error), "staging_only": True}
            status_code = 401
        except Exception as error:
            payload = {"status": "error", "error": str(error), "staging_only": True}
            status_code = 500
        return build_cors_json_response(payload, status_code=status_code)

    @app.route("/api/analytics/meta-ads", methods=["GET", "POST", "OPTIONS"])
    def staged_meta_ads_dashboard():
        if request.method == "OPTIONS":
            return build_cors_json_response({})

        req_json = request.get_json(silent=True) or {}
        property_id = request.args.get("property_id") or req_json.get("property_id")
        meta_ads_account_id = request.args.get("meta_ads_account_id") or req_json.get("meta_ads_account_id")
        property_name = request.args.get("property_name") or req_json.get("property_name")
        match_terms = request.args.get("match_terms") or req_json.get("match_terms")
        campaign_ids = request.args.get("campaign_ids") or req_json.get("campaign_ids")
        attribution_mode = request.args.get("attribution_mode") or req_json.get("attribution_mode")
        start_date_value = request.args.get("start_date") or req_json.get("start_date")
        end_date_value = request.args.get("end_date") or req_json.get("end_date")
        default_days = request.args.get("days") or req_json.get("days") or 90
        force_refresh = str(request.args.get("force_refresh") or req_json.get("force_refresh") or "0") == "1"
        if not property_id:
            return build_cors_json_response(
                {
                    "status": "error",
                    "error": "Missing required parameter: property_id",
                    "staging_only": True,
                },
                status_code=400,
            )
        if not meta_ads_account_id:
            return build_cors_json_response(
                {"status": "error", "error": "Missing required parameter: meta_ads_account_id", "staging_only": True},
                status_code=400,
            )

        try:
            require_property_permission(str(property_id), "analytics.view")
            payload = fetch_and_store_meta_ads_dashboard(
                property_id=str(property_id),
                meta_ads_account_id=str(meta_ads_account_id),
                property_name=property_name,
                match_terms=match_terms,
                campaign_ids=campaign_ids,
                attribution_mode=attribution_mode,
                start_date_value=start_date_value,
                end_date_value=end_date_value,
                default_days=int(default_days),
                force_refresh=force_refresh,
            )
            status_code = 200
        except ValueError as error:
            payload = {"status": "error", "error": str(error), "staging_only": True}
            status_code = 400
        except RenderPermissionError as error:
            payload = {"status": "error", "error": str(error), "staging_only": True}
            status_code = 403
        except RenderAuthError as error:
            payload = {"status": "error", "error": str(error), "staging_only": True}
            status_code = 401
        except Exception as error:
            payload = {"status": "error", "error": str(error), "staging_only": True}
            status_code = 500
        return build_cors_json_response(payload, status_code=status_code)

    @app.route("/api/entrata/backfill", methods=["POST", "OPTIONS"])
    def staged_entrata_backfill():
        if request.method == "OPTIONS":
            return build_cors_json_response({})

        try:
            require_platform_permission("users.manage")
        except RenderPermissionError as error:
            return build_cors_json_response({"status": "error", "error": str(error)}, status_code=403)
        except RenderAuthError as error:
            return build_cors_json_response({"status": "error", "error": str(error)}, status_code=401)

        req_json = request.get_json(silent=True) or {}
        days = int(request.args.get("days") or req_json.get("days") or 30)
        start_from = int(request.args.get("start_from") or req_json.get("start_from") or 0)
        property_ids_value = request.args.get("property_ids") or req_json.get("property_ids")
        if isinstance(property_ids_value, str):
            property_ids = [int(item.strip()) for item in property_ids_value.split(",") if item.strip()]
        elif isinstance(property_ids_value, list):
            property_ids = [int(item) for item in property_ids_value]
        else:
            property_ids = None

        try:
            payload = trigger_entrata_backfill(days=days, start_from=start_from, property_ids=property_ids)
            return build_cors_json_response(payload)
        except Exception as error:
            return build_cors_json_response(
                {"status": "error", "error": str(error), "staging_only": True},
                status_code=500,
            )

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

        try:
            access_token, _user = get_authenticated_request_context()
        except RenderAuthError as error:
            return build_cors_json_response({"status": "error", "error": str(error)}, status_code=401)

        payload = get_property_reporting_overview_summary(str(property_id), start_date, end_date, access_token)
        status_code = 200 if payload.get("status") != "error" else 503
        return build_cors_json_response(payload, status_code=status_code)

    @app.route("/api/admin/website-manager", methods=["GET", "POST", "OPTIONS"])
    def staged_website_manager():
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

        try:
            if request.method == "POST":
                access_token, _user = require_property_permission(str(property_id), "website_manager.edit")
            else:
                access_token, _user = require_property_permission(str(property_id), "website_manager.view")
        except RenderPermissionError as error:
            return build_cors_json_response({"status": "error", "error": str(error)}, status_code=403)
        except RenderAuthError as error:
            return build_cors_json_response({"status": "error", "error": str(error)}, status_code=401)

        if request.method == "POST":
            payload = save_website_manager_summary(str(property_id), req_json, access_token=access_token)
            if payload.get("status") != "error" and bool(req_json.get("publish")):
                publish_result = publish_website_manager_summary(str(property_id), access_token=access_token)
                payload["publishResult"] = publish_result
                if publish_result.get("status") == "error":
                    payload["status"] = "error"
                    payload["error"] = publish_result.get("error")
        else:
            payload = get_website_manager_summary(str(property_id), access_token=access_token)
        status_code = 200 if payload.get("status") != "error" else 503
        return build_cors_json_response(payload, status_code=status_code)

    @app.route("/api/admin/reporting-layout", methods=["GET", "POST", "OPTIONS"])
    def staged_reporting_layout():
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

        try:
            access_token, _user = get_authenticated_request_context()
        except RenderAuthError as error:
            return build_cors_json_response({"status": "error", "error": str(error)}, status_code=401)

        if request.method == "POST":
            payload = save_reporting_layout_summary(str(property_id), req_json, access_token=access_token)
        else:
            payload = get_reporting_layout_summary(str(property_id), access_token=access_token)
        status_code = 200 if payload.get("status") != "error" else 503
        return build_cors_json_response(payload, status_code=status_code)

    @app.route("/api/admin/access/users", methods=["GET", "POST", "OPTIONS"])
    def staged_admin_access_users():
        if request.method == "OPTIONS":
            return build_cors_json_response({})

        try:
            _access_token, user = require_platform_permission("users.manage")
        except RenderPermissionError as error:
            return build_cors_json_response({"status": "error", "error": str(error)}, status_code=403)
        except RenderAuthError as error:
            return build_cors_json_response({"status": "error", "error": str(error)}, status_code=401)

        req_json = request.get_json(silent=True) or {}
        if request.method == "POST":
            payload = invite_user_with_access_summary(
                req_json,
                actor_user_id=str(user.get("id") or ""),
                actor_email=str(user.get("email") or ""),
            )
        else:
            payload = list_access_admin_summary()
        status_code = 200 if payload.get("status") != "error" else 503
        return build_cors_json_response(payload, status_code=status_code)

    @app.route("/api/admin/access/users/<user_id>", methods=["POST", "OPTIONS"])
    def staged_admin_access_user_update(user_id: str):
        if request.method == "OPTIONS":
            return build_cors_json_response({})

        try:
            _access_token, user = require_platform_permission("users.manage")
        except RenderPermissionError as error:
            return build_cors_json_response({"status": "error", "error": str(error)}, status_code=403)
        except RenderAuthError as error:
            return build_cors_json_response({"status": "error", "error": str(error)}, status_code=401)

        req_json = request.get_json(silent=True) or {}
        payload = update_user_access_summary(
            user_id,
            req_json,
            actor_user_id=str(user.get("id") or ""),
            actor_email=str(user.get("email") or ""),
        )
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
