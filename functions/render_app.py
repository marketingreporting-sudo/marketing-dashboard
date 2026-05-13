import os

import datetime
import json
import re
from time import time

from flask import Flask, jsonify, make_response, request

from render_auth import (
    RenderAuthError,
    RenderPermissionError,
    require_authenticated_user,
    user_has_platform_permission,
    user_has_property_permission,
)
from render_adapter_registry import get_cron_job_specs, get_http_endpoint_specs
from render_supabase_analytics import get_cached_analytics_summary
from render_runtime import (
    build_local_falcon_location_match_summary,
    configure_historical_backfill,
    configure_historical_lease_attribution,
    fetch_and_store_ga4_dashboard,
    fetch_and_store_google_ads_dashboard,
    fetch_and_store_local_falcon_dashboard,
    fetch_and_store_meta_ads_dashboard,
    fetch_and_store_reputation_dashboard,
    get_sync_state,
    install_render_storage_overrides,
    process_historical_backfill_batch,
    process_historical_lease_attribution_batch,
    run_named_cron_job,
    set_historical_archive_active,
    start_historical_archive_backfill,
    trigger_entrata_backfill,
)
from render_supabase_admin_content import (
    get_reporting_layout_summary,
    get_website_manager_schema_summary,
    get_website_manager_summary,
    publish_website_manager_summary,
    save_reporting_layout_summary,
    save_website_manager_schema_summary,
    save_website_manager_summary,
)
from render_supabase_admin_access import (
    generate_user_password_reset_summary,
    invite_user_with_access_summary,
    list_access_admin_summary,
    update_user_access_summary,
)
from render_supabase_reporting import (
    get_multi_property_call_prep_summary,
    get_multi_property_reporting_overview_summary,
    get_property_reporting_overview_summary,
)
from render_supabase_heatmaps import (
    collect_site_page_snapshot_payload,
    collect_heatmap_payload,
    create_site_screenshot_upload_url_payload,
    enqueue_site_audit_job_summary,
    get_heatmap_pages_summary,
    get_heatmap_summary,
    get_heatmap_tracker_health_summary,
    get_heatmap_tracker_payload,
    list_site_audit_portfolio_summary,
    get_site_audit_pages_summary,
    get_site_audit_summary,
    get_site_screenshot_preview_summary,
    list_heatmap_sites_summary,
    run_site_audit_summary,
    save_site_screenshot_metadata_payload,
    save_heatmap_site_summary,
)
from render_supabase_roi import get_supabase_roi_pipeline_status_summary
from render_recommendations import (
    build_recommendations_training_export_summary,
    create_recommendation_task_summary,
    generate_recommendations_summary,
    record_recommendation_feedback_summary,
    review_recommendation_impact_summary,
)
from render_tickets import (
    create_inbound_email_ticket_summary,
    create_inbound_outlook_ticket_summary,
    create_ticket_summary,
    list_ticket_options_summary,
    list_tickets_summary,
    OutlookPayloadError,
    OutlookWebhookAuthError,
    update_ticket_summary,
)
from render_supabase_sync_state import get_supabase_sync_health_summary, get_supabase_sync_state_summary
from render_supabase_validation import (
    SupabaseValidationConfigError,
    get_supabase_migration_validation_summary,
)


def create_app() -> Flask:
    app = Flask(__name__)
    install_render_storage_overrides()
    public_write_rate_limits: dict[tuple[str, str], list[float]] = {}

    @app.after_request
    def apply_cors_headers(response):
        response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type,Authorization,X-Ticket-Webhook-Secret"
        return response

    def build_cors_json_response(payload: dict, status_code: int = 200):
        response = make_response(jsonify(payload), status_code)
        return response

    def get_request_json_payload() -> dict:
        payload = request.get_json(silent=True)
        if isinstance(payload, dict):
            return payload
        if request.data:
            try:
                parsed = json.loads(request.data.decode("utf-8"))
                return parsed if isinstance(parsed, dict) else {}
            except (UnicodeDecodeError, json.JSONDecodeError):
                return {}
        return {}

    def parse_property_ids_from_value(value):
        if isinstance(value, str):
            return [int(item.strip()) for item in value.split(",") if item.strip()]
        if isinstance(value, list):
            return [int(item) for item in value]
        return None

    def enforce_public_write_rate_limit(bucket: str, site_key: str | None = None):
        limit_window_seconds = int(os.environ.get("PUBLIC_WRITE_RATE_LIMIT_WINDOW_SECONDS", "60"))
        bucket_env_prefix = re.sub(r"[^A-Za-z0-9]+", "_", bucket).upper()
        ip_limit = int(os.environ.get(f"PUBLIC_WRITE_RATE_LIMIT_{bucket_env_prefix}_PER_IP", os.environ.get("PUBLIC_WRITE_RATE_LIMIT_PER_IP", "120")))
        site_limit = int(os.environ.get(f"PUBLIC_WRITE_RATE_LIMIT_{bucket_env_prefix}_PER_SITE", os.environ.get("PUBLIC_WRITE_RATE_LIMIT_PER_SITE", "600")))
        now = time()
        ip_address = request.headers.get("X-Forwarded-For", request.remote_addr or "unknown").split(",")[0].strip()
        keys = [("ip", f"{bucket}:{ip_address}", ip_limit)]
        if site_key:
            keys.append(("site", f"{bucket}:{site_key}", site_limit))

        for key_type, key_value, limit in keys:
            key = (key_type, key_value)
            recent = [item for item in public_write_rate_limits.get(key, []) if now - item < limit_window_seconds]
            if len(recent) >= limit:
                raise PermissionError(f"Public write rate limit exceeded for {key_type}.")
            recent.append(now)
            public_write_rate_limits[key] = recent

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

    def require_any_property_permission(property_id: str, permissions: tuple[str, ...]):
        access_token, user = get_authenticated_request_context()
        allowed = any(user_has_property_permission(access_token, property_id, permission) for permission in permissions)
        if not allowed:
            readable_permissions = ", ".join(f"'{permission}'" for permission in permissions)
            raise RenderPermissionError(
                f"Authenticated user does not have any of {readable_permissions} access for property {property_id}."
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

    @app.get("/api/admin/sync-health")
    def admin_sync_health():
        try:
            require_platform_permission("users.manage")
        except RenderPermissionError as error:
            return build_cors_json_response({"status": "error", "error": str(error)}, status_code=403)
        except RenderAuthError as error:
            return build_cors_json_response({"status": "error", "error": str(error)}, status_code=401)

        payload = get_supabase_sync_health_summary()
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

    @app.route("/api/recommendations/generate", methods=["POST", "OPTIONS"])
    def generate_recommendations():
        if request.method == "OPTIONS":
            return build_cors_json_response({})

        req_json = get_request_json_payload()
        property_id = request.args.get("property_id") or req_json.get("property_id")
        if not property_id:
            return build_cors_json_response(
                {"status": "error", "error": "Missing required parameter: property_id", "staging_only": True},
                status_code=400,
            )

        try:
            access_token, user = require_any_property_permission(str(property_id), ("reports.view", "analytics.view"))
            payload = generate_recommendations_summary(
                property_id=str(property_id),
                property_name=request.args.get("property_name") or req_json.get("property_name") or req_json.get("propertyName"),
                start_date_value=request.args.get("start_date") or req_json.get("start_date"),
                end_date_value=request.args.get("end_date") or req_json.get("end_date"),
                site_key=request.args.get("site_key") or req_json.get("site_key") or req_json.get("siteKey"),
                access_token=access_token,
                user_id=user.get("id"),
            )
            return build_cors_json_response(payload)
        except ValueError as error:
            return build_cors_json_response({"status": "error", "error": str(error), "staging_only": True}, status_code=400)
        except RenderPermissionError as error:
            return build_cors_json_response({"status": "error", "error": str(error)}, status_code=403)
        except RenderAuthError as error:
            return build_cors_json_response({"status": "error", "error": str(error)}, status_code=401)
        except Exception as error:
            return build_cors_json_response(
                {"status": "error", "error": str(error), "staging_only": True},
                status_code=500,
            )

    @app.route("/api/recommendations/<recommendation_id>/feedback", methods=["POST", "OPTIONS"])
    def record_recommendation_feedback(recommendation_id: str):
        if request.method == "OPTIONS":
            return build_cors_json_response({})

        req_json = get_request_json_payload()
        property_id = req_json.get("property_id") or req_json.get("propertyId")
        if not property_id:
            return build_cors_json_response(
                {"status": "error", "error": "Missing required parameter: property_id", "staging_only": True},
                status_code=400,
            )

        try:
            _access_token, user = require_property_permission(str(property_id), "reports.view")
            payload = record_recommendation_feedback_summary(
                recommendation_id=str(recommendation_id),
                feedback_type=req_json.get("feedback_type") or req_json.get("feedbackType"),
                notes=req_json.get("notes"),
                tags=req_json.get("tags") if isinstance(req_json.get("tags"), list) else [],
                user_id=user.get("id"),
                expected_property_id=str(property_id),
            )
            return build_cors_json_response(payload)
        except LookupError as error:
            return build_cors_json_response({"status": "error", "error": str(error), "staging_only": True}, status_code=404)
        except ValueError as error:
            return build_cors_json_response({"status": "error", "error": str(error), "staging_only": True}, status_code=400)
        except PermissionError as error:
            return build_cors_json_response({"status": "error", "error": str(error), "staging_only": True}, status_code=403)
        except RenderPermissionError as error:
            return build_cors_json_response({"status": "error", "error": str(error)}, status_code=403)
        except RenderAuthError as error:
            return build_cors_json_response({"status": "error", "error": str(error)}, status_code=401)
        except Exception as error:
            return build_cors_json_response(
                {"status": "error", "error": str(error), "staging_only": True},
                status_code=500,
            )

    @app.route("/api/recommendations/<recommendation_id>/task", methods=["POST", "OPTIONS"])
    def create_recommendation_task(recommendation_id: str):
        if request.method == "OPTIONS":
            return build_cors_json_response({})

        req_json = get_request_json_payload()
        property_id = req_json.get("property_id") or req_json.get("propertyId")
        if not property_id:
            return build_cors_json_response(
                {"status": "error", "error": "Missing required parameter: property_id", "staging_only": True},
                status_code=400,
            )

        try:
            _access_token, user = require_property_permission(str(property_id), "tasks.view")
            payload = create_recommendation_task_summary(
                recommendation_id=str(recommendation_id),
                expected_property_id=str(property_id),
                user_id=user.get("id"),
            )
            return build_cors_json_response(payload)
        except LookupError as error:
            return build_cors_json_response({"status": "error", "error": str(error), "staging_only": True}, status_code=404)
        except PermissionError as error:
            return build_cors_json_response({"status": "error", "error": str(error), "staging_only": True}, status_code=403)
        except RenderPermissionError as error:
            return build_cors_json_response({"status": "error", "error": str(error)}, status_code=403)
        except RenderAuthError as error:
            return build_cors_json_response({"status": "error", "error": str(error)}, status_code=401)
        except Exception as error:
            return build_cors_json_response(
                {"status": "error", "error": str(error), "staging_only": True},
                status_code=500,
            )

    @app.route("/api/recommendations/<recommendation_id>/impact-review", methods=["POST", "OPTIONS"])
    def review_recommendation_impact(recommendation_id: str):
        if request.method == "OPTIONS":
            return build_cors_json_response({})

        req_json = get_request_json_payload()
        property_id = req_json.get("property_id") or req_json.get("propertyId")
        if not property_id:
            return build_cors_json_response(
                {"status": "error", "error": "Missing required parameter: property_id", "staging_only": True},
                status_code=400,
            )

        try:
            access_token, _user = require_any_property_permission(str(property_id), ("reports.view", "analytics.view"))
            payload = review_recommendation_impact_summary(
                recommendation_id=str(recommendation_id),
                expected_property_id=str(property_id),
                access_token=access_token,
            )
            return build_cors_json_response(payload)
        except LookupError as error:
            return build_cors_json_response({"status": "error", "error": str(error), "staging_only": True}, status_code=404)
        except PermissionError as error:
            return build_cors_json_response({"status": "error", "error": str(error), "staging_only": True}, status_code=403)
        except RenderPermissionError as error:
            return build_cors_json_response({"status": "error", "error": str(error)}, status_code=403)
        except RenderAuthError as error:
            return build_cors_json_response({"status": "error", "error": str(error)}, status_code=401)
        except Exception as error:
            return build_cors_json_response(
                {"status": "error", "error": str(error), "staging_only": True},
                status_code=500,
            )

    @app.route("/api/recommendations/training-export", methods=["GET", "POST", "OPTIONS"])
    def export_recommendation_training_examples():
        if request.method == "OPTIONS":
            return build_cors_json_response({})

        req_json = get_request_json_payload()
        try:
            require_platform_permission("users.manage")
            payload = build_recommendations_training_export_summary(
                minimum_positive_examples=int(
                    request.args.get("minimum_positive_examples")
                    or req_json.get("minimum_positive_examples")
                    or req_json.get("minimumPositiveExamples")
                    or 25
                ),
                limit=int(request.args.get("limit") or req_json.get("limit") or 500),
            )
            return build_cors_json_response(payload)
        except ValueError as error:
            return build_cors_json_response({"status": "error", "error": str(error), "staging_only": True}, status_code=400)
        except RenderPermissionError as error:
            return build_cors_json_response({"status": "error", "error": str(error)}, status_code=403)
        except RenderAuthError as error:
            return build_cors_json_response({"status": "error", "error": str(error)}, status_code=401)
        except Exception as error:
            return build_cors_json_response(
                {"status": "error", "error": str(error), "staging_only": True},
                status_code=500,
            )

    @app.route("/api/tickets/options", methods=["GET", "OPTIONS"])
    def staged_ticket_options():
        if request.method == "OPTIONS":
            return build_cors_json_response({})

        try:
            access_token, _user = get_authenticated_request_context()
            payload = list_ticket_options_summary(access_token)
            return build_cors_json_response(payload)
        except RenderPermissionError as error:
            return build_cors_json_response({"status": "error", "error": str(error)}, status_code=403)
        except RenderAuthError as error:
            return build_cors_json_response({"status": "error", "error": str(error)}, status_code=401)
        except Exception as error:
            return build_cors_json_response({"status": "error", "error": str(error), "staging_only": True}, status_code=500)

    @app.route("/api/tickets", methods=["GET", "POST", "OPTIONS"])
    def staged_tickets():
        if request.method == "OPTIONS":
            return build_cors_json_response({})

        try:
            access_token, user = get_authenticated_request_context()
            if request.method == "POST":
                payload = create_ticket_summary(access_token, user, get_request_json_payload())
            else:
                payload = list_tickets_summary(access_token, user)
            return build_cors_json_response(payload)
        except ValueError as error:
            return build_cors_json_response({"status": "error", "error": str(error), "staging_only": True}, status_code=400)
        except RenderPermissionError as error:
            return build_cors_json_response({"status": "error", "error": str(error)}, status_code=403)
        except RenderAuthError as error:
            return build_cors_json_response({"status": "error", "error": str(error)}, status_code=401)
        except Exception as error:
            return build_cors_json_response({"status": "error", "error": str(error), "staging_only": True}, status_code=500)

    @app.route("/api/tickets/<ticket_id>", methods=["POST", "OPTIONS"])
    def staged_ticket_update(ticket_id: str):
        if request.method == "OPTIONS":
            return build_cors_json_response({})

        try:
            access_token, user = get_authenticated_request_context()
            payload = update_ticket_summary(access_token, user, ticket_id, get_request_json_payload())
            return build_cors_json_response(payload)
        except ValueError as error:
            return build_cors_json_response({"status": "error", "error": str(error), "staging_only": True}, status_code=400)
        except RenderPermissionError as error:
            return build_cors_json_response({"status": "error", "error": str(error)}, status_code=403)
        except RenderAuthError as error:
            return build_cors_json_response({"status": "error", "error": str(error)}, status_code=401)
        except Exception as error:
            return build_cors_json_response({"status": "error", "error": str(error), "staging_only": True}, status_code=500)

    @app.route("/api/tickets/inbound-email", methods=["POST", "OPTIONS"])
    def staged_inbound_email_ticket():
        if request.method == "OPTIONS":
            return build_cors_json_response({})

        configured_secret = os.environ.get("TICKET_WEBHOOK_SECRET", "").strip()
        provided_secret = request.headers.get("X-Ticket-Webhook-Secret", "").strip()
        if not configured_secret or provided_secret != configured_secret:
            return build_cors_json_response({"status": "error", "error": "Invalid ticket webhook secret."}, status_code=403)

        try:
            payload = create_inbound_email_ticket_summary(get_request_json_payload())
            return build_cors_json_response(payload)
        except ValueError as error:
            return build_cors_json_response({"status": "error", "error": str(error), "staging_only": True}, status_code=400)
        except Exception as error:
            return build_cors_json_response({"status": "error", "error": str(error), "staging_only": True}, status_code=500)

    @app.route("/api/tickets/inbound-outlook", methods=["POST", "OPTIONS"])
    def staged_inbound_outlook_ticket():
        if request.method == "OPTIONS":
            return build_cors_json_response({})

        req_json = get_request_json_payload()
        try:
            payload = create_inbound_outlook_ticket_summary(req_json)
            app.logger.info(
                "Created inbound Outlook ticket",
                extra={
                    "ticket_id": payload.get("ticket_id"),
                    "task_id": payload.get("task_id"),
                    "property_matched": payload.get("property_matched"),
                    "assigned": bool(payload.get("assigned_user_id")),
                    "duplicate": payload.get("duplicate"),
                },
            )
            return build_cors_json_response(payload)
        except OutlookWebhookAuthError:
            return build_cors_json_response({"success": False, "error": "Invalid Outlook webhook token."}, status_code=401)
        except OutlookPayloadError as error:
            return build_cors_json_response({"success": False, "error": str(error)}, status_code=400)
        except ValueError as error:
            return build_cors_json_response({"success": False, "error": str(error)}, status_code=400)
        except Exception as error:
            app.logger.exception(
                "Unexpected inbound Outlook ticket failure",
                extra={
                    "has_subject": bool(req_json.get("subject")) if isinstance(req_json, dict) else False,
                    "has_message_id": bool(req_json.get("messageId")) if isinstance(req_json, dict) else False,
                    "has_from": bool(req_json.get("from")) if isinstance(req_json, dict) else False,
                },
            )
            return build_cors_json_response({"success": False, "error": "Unable to create Outlook ticket."}, status_code=500)

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
        cache_only = str(request.args.get("cache_only") or req_json.get("cache_only") or "").lower() in {"1", "true", "yes"}
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
            if cache_only:
                payload = get_cached_analytics_summary(str(property_id), "ga4")
                status_code = 200 if payload.get("status") != "error" else 404
            else:
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
            cached_payload = get_cached_analytics_summary(str(property_id), "ga4")
            if cached_payload.get("status") == "error":
                payload = {"status": "error", "error": str(error), "staging_only": True}
                status_code = 500
            else:
                payload = {
                    **cached_payload,
                    "live_refresh_error": str(error),
                    "source": cached_payload.get("source") or "supabase",
                    "staging_only": True,
                }
                status_code = 200
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
        cache_only = str(request.args.get("cache_only") or req_json.get("cache_only") or "").lower() in {"1", "true", "yes"}
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
            if cache_only:
                payload = get_cached_analytics_summary(str(property_id), "google_ads")
                status_code = 200 if payload.get("status") != "error" else 404
            else:
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
            cached_payload = get_cached_analytics_summary(str(property_id), "google_ads")
            if cached_payload.get("status") == "error":
                payload = {"status": "error", "error": str(error), "staging_only": True}
                status_code = 500
            else:
                payload = {
                    **cached_payload,
                    "live_refresh_error": str(error),
                    "source": cached_payload.get("source") or "supabase",
                    "staging_only": True,
                }
                status_code = 200
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

    @app.route("/api/analytics/local-falcon", methods=["GET", "POST", "OPTIONS"])
    def staged_local_falcon_dashboard():
        if request.method == "OPTIONS":
            return build_cors_json_response({})

        req_json = request.get_json(silent=True) or {}
        property_id = request.args.get("property_id") or req_json.get("property_id")
        place_id = request.args.get("place_id") or req_json.get("place_id")
        property_name = request.args.get("property_name") or req_json.get("property_name")
        property_city = request.args.get("property_city") or req_json.get("property_city")
        property_state = request.args.get("property_state") or req_json.get("property_state")
        campaign_key = request.args.get("campaign_key") or req_json.get("campaign_key")
        keyword = request.args.get("keyword") or req_json.get("keyword")
        platform = request.args.get("platform") or req_json.get("platform") or "google"
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
            require_property_permission(str(property_id), "analytics.view")
            payload = fetch_and_store_local_falcon_dashboard(
                property_id=str(property_id),
                place_id=place_id,
                property_name=property_name,
                property_city=property_city,
                property_state=property_state,
                campaign_key=campaign_key,
                keyword=keyword,
                platform=platform,
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

    @app.route("/api/admin/local-falcon/location-matches", methods=["GET", "POST", "OPTIONS"])
    def admin_local_falcon_location_matches():
        if request.method == "OPTIONS":
            return build_cors_json_response({})

        try:
            require_platform_permission("users.manage")
        except RenderPermissionError as error:
            return build_cors_json_response({"status": "error", "error": str(error)}, status_code=403)
        except RenderAuthError as error:
            return build_cors_json_response({"status": "error", "error": str(error)}, status_code=401)

        req_json = request.get_json(silent=True) or {}
        properties = req_json.get("properties") if isinstance(req_json.get("properties"), list) else None
        limit = int(request.args.get("limit") or req_json.get("limit") or 100)
        try:
            payload = build_local_falcon_location_match_summary(properties=properties, limit=limit)
            status_code = 200
        except ValueError as error:
            payload = {"status": "error", "error": str(error), "staging_only": True}
            status_code = 400
        except Exception as error:
            payload = {"status": "error", "error": str(error), "staging_only": True}
            status_code = 500
        return build_cors_json_response(payload, status_code=status_code)

    @app.route("/api/heatmaps/tracker.js", methods=["GET", "OPTIONS"])
    def heatmap_tracker_script():
        if request.method == "OPTIONS":
            return build_cors_json_response({})

        site_key = request.args.get("site_key") or request.args.get("siteKey") or ""
        if not site_key:
            return make_response("/* Missing required query parameter: site_key */", 400)

        base_url = (
            os.environ.get("HEATMAP_COLLECTOR_BASE_URL")
            or os.environ.get("RENDER_EXTERNAL_URL")
            or request.host_url.rstrip("/")
        )
        collector_url = f"{base_url.rstrip('/')}/api/heatmaps/collect"
        try:
            script, _site = get_heatmap_tracker_payload(str(site_key), collector_url)
        except LookupError as error:
            return make_response(f"/* {str(error)} */", 404)
        except Exception as error:
            return make_response(f"/* Failed to build tracker: {str(error)} */", 500)

        response = make_response(script or "/* Heatmap tracking is disabled for this site. */", 200)
        response.headers["Content-Type"] = "application/javascript; charset=utf-8"
        response.headers["Cache-Control"] = "public, max-age=300"
        return response

    @app.route("/api/heatmaps/collect", methods=["POST", "OPTIONS"])
    def heatmap_collect():
        if request.method == "OPTIONS":
            return build_cors_json_response({})

        payload = get_request_json_payload()
        try:
            enforce_public_write_rate_limit(
                "heatmaps_collect",
                payload.get("siteKey") or payload.get("site_key"),
            )
            result = collect_heatmap_payload(
                payload,
                origin=request.headers.get("Origin"),
                referrer=request.headers.get("Referer"),
            )
            return build_cors_json_response(result)
        except ValueError as error:
            return build_cors_json_response({"status": "error", "error": str(error)}, status_code=400)
        except LookupError as error:
            return build_cors_json_response({"status": "error", "error": str(error)}, status_code=404)
        except PermissionError as error:
            return build_cors_json_response({"status": "error", "error": str(error)}, status_code=403)
        except Exception as error:
            return build_cors_json_response({"status": "error", "error": str(error)}, status_code=500)

    @app.route("/api/site-audit/page-snapshot", methods=["POST", "OPTIONS"])
    def site_audit_page_snapshot():
        if request.method == "OPTIONS":
            return build_cors_json_response({})

        payload = get_request_json_payload()
        try:
            enforce_public_write_rate_limit(
                "site_audit_page_snapshot",
                payload.get("siteKey") or payload.get("site_key"),
            )
            result = collect_site_page_snapshot_payload(
                payload,
                origin=request.headers.get("Origin"),
                referrer=request.headers.get("Referer"),
            )
            return build_cors_json_response(result)
        except ValueError as error:
            return build_cors_json_response({"status": "error", "error": str(error)}, status_code=400)
        except LookupError as error:
            return build_cors_json_response({"status": "error", "error": str(error)}, status_code=404)
        except PermissionError as error:
            return build_cors_json_response({"status": "error", "error": str(error)}, status_code=403)
        except Exception as error:
            return build_cors_json_response({"status": "error", "error": str(error)}, status_code=500)

    @app.route("/api/site-audit/screenshot", methods=["POST", "OPTIONS"])
    def site_audit_screenshot():
        if request.method == "OPTIONS":
            return build_cors_json_response({})

        payload = get_request_json_payload()
        try:
            enforce_public_write_rate_limit(
                "site_audit_screenshot",
                payload.get("siteKey") or payload.get("site_key"),
            )
            result = save_site_screenshot_metadata_payload(
                payload,
                origin=request.headers.get("Origin"),
                referrer=request.headers.get("Referer"),
            )
            return build_cors_json_response(result)
        except ValueError as error:
            return build_cors_json_response({"status": "error", "error": str(error)}, status_code=400)
        except LookupError as error:
            return build_cors_json_response({"status": "error", "error": str(error)}, status_code=404)
        except PermissionError as error:
            return build_cors_json_response({"status": "error", "error": str(error)}, status_code=403)
        except Exception as error:
            return build_cors_json_response({"status": "error", "error": str(error)}, status_code=500)

    @app.route("/api/site-audit/screenshot-upload-url", methods=["POST", "OPTIONS"])
    def site_audit_screenshot_upload_url():
        if request.method == "OPTIONS":
            return build_cors_json_response({})

        payload = get_request_json_payload()
        try:
            enforce_public_write_rate_limit(
                "site_audit_screenshot_upload_url",
                payload.get("siteKey") or payload.get("site_key"),
            )
            result = create_site_screenshot_upload_url_payload(
                payload,
                origin=request.headers.get("Origin"),
                referrer=request.headers.get("Referer"),
            )
            return build_cors_json_response(result)
        except ValueError as error:
            return build_cors_json_response({"status": "error", "error": str(error)}, status_code=400)
        except LookupError as error:
            return build_cors_json_response({"status": "error", "error": str(error)}, status_code=404)
        except PermissionError as error:
            return build_cors_json_response({"status": "error", "error": str(error)}, status_code=403)
        except Exception as error:
            return build_cors_json_response({"status": "error", "error": str(error)}, status_code=500)

    @app.route("/api/site-audit/screenshot-preview", methods=["GET", "POST", "OPTIONS"])
    def site_audit_screenshot_preview():
        if request.method == "OPTIONS":
            return build_cors_json_response({})

        req_json = get_request_json_payload()
        screenshot_id = request.args.get("screenshot_id") or request.args.get("screenshotId") or req_json.get("screenshot_id") or req_json.get("screenshotId")
        if not screenshot_id:
            return build_cors_json_response(
                {"status": "error", "error": "Missing required parameter: screenshot_id", "staging_only": True},
                status_code=400,
            )

        try:
            access_token, _user = get_authenticated_request_context()
            preview = get_site_screenshot_preview_summary(
                str(screenshot_id),
                access_token=access_token,
                expires_in=int(request.args.get("expires_in") or req_json.get("expiresIn") or req_json.get("expires_in") or 900),
            )
            property_id = str(preview.get("screenshot", {}).get("propertyId") or "")
            if not property_id:
                return build_cors_json_response({"status": "error", "error": "Screenshot is missing property scope."}, status_code=404)
            if not any(user_has_property_permission(access_token, property_id, permission) for permission in ("analytics.view", "reports.view")):
                raise RenderPermissionError(
                    f"Authenticated user does not have analytics.view or reports.view access for property {property_id}."
                )
            return build_cors_json_response(preview)
        except ValueError as error:
            return build_cors_json_response({"status": "error", "error": str(error)}, status_code=400)
        except LookupError as error:
            return build_cors_json_response({"status": "error", "error": str(error)}, status_code=404)
        except RenderPermissionError as error:
            return build_cors_json_response({"status": "error", "error": str(error)}, status_code=403)
        except RenderAuthError as error:
            return build_cors_json_response({"status": "error", "error": str(error)}, status_code=401)
        except Exception as error:
            return build_cors_json_response({"status": "error", "error": str(error)}, status_code=500)

    @app.route("/api/heatmaps/summary", methods=["GET", "POST", "OPTIONS"])
    def heatmap_summary():
        if request.method == "OPTIONS":
            return build_cors_json_response({})

        req_json = get_request_json_payload()
        property_id = request.args.get("property_id") or req_json.get("property_id")
        if not property_id:
            return build_cors_json_response(
                {"status": "error", "error": "Missing required parameter: property_id", "staging_only": True},
                status_code=400,
            )

        try:
            access_token, _user = require_any_property_permission(str(property_id), ("analytics.view", "reports.view"))
            payload = get_heatmap_summary(
                str(property_id),
                start_date_value=request.args.get("start_date") or req_json.get("start_date"),
                end_date_value=request.args.get("end_date") or req_json.get("end_date"),
                site_key=request.args.get("site_key") or req_json.get("site_key") or req_json.get("siteKey"),
                path=request.args.get("path") or req_json.get("path"),
                event_type=request.args.get("event_type") or req_json.get("event_type") or req_json.get("eventType"),
                device_type=request.args.get("device_type") or request.args.get("deviceType") or req_json.get("device_type") or req_json.get("deviceType"),
                access_token=access_token,
            )
            return build_cors_json_response(payload)
        except RenderPermissionError as error:
            return build_cors_json_response({"status": "error", "error": str(error)}, status_code=403)
        except RenderAuthError as error:
            return build_cors_json_response({"status": "error", "error": str(error)}, status_code=401)
        except Exception as error:
            return build_cors_json_response(
                {"status": "error", "error": str(error), "staging_only": True},
                status_code=500,
            )

    @app.route("/api/heatmaps/pages", methods=["GET", "POST", "OPTIONS"])
    def heatmap_pages():
        if request.method == "OPTIONS":
            return build_cors_json_response({})

        req_json = get_request_json_payload()
        property_id = request.args.get("property_id") or req_json.get("property_id")
        if not property_id:
            return build_cors_json_response(
                {"status": "error", "error": "Missing required parameter: property_id", "staging_only": True},
                status_code=400,
            )

        try:
            access_token, _user = require_any_property_permission(str(property_id), ("analytics.view", "reports.view"))
            payload = get_heatmap_pages_summary(
                str(property_id),
                start_date_value=request.args.get("start_date") or req_json.get("start_date"),
                end_date_value=request.args.get("end_date") or req_json.get("end_date"),
                site_key=request.args.get("site_key") or req_json.get("site_key") or req_json.get("siteKey"),
                access_token=access_token,
            )
            return build_cors_json_response(payload)
        except RenderPermissionError as error:
            return build_cors_json_response({"status": "error", "error": str(error)}, status_code=403)
        except RenderAuthError as error:
            return build_cors_json_response({"status": "error", "error": str(error)}, status_code=401)
        except Exception as error:
            return build_cors_json_response(
                {"status": "error", "error": str(error), "staging_only": True},
                status_code=500,
            )

    @app.route("/api/heatmaps/tracker-health", methods=["GET", "POST", "OPTIONS"])
    def heatmap_tracker_health():
        if request.method == "OPTIONS":
            return build_cors_json_response({})

        req_json = get_request_json_payload()
        property_id = request.args.get("property_id") or req_json.get("property_id")
        if not property_id:
            return build_cors_json_response(
                {"status": "error", "error": "Missing required parameter: property_id", "staging_only": True},
                status_code=400,
            )

        try:
            access_token, _user = require_any_property_permission(str(property_id), ("analytics.view", "reports.view"))
            payload = get_heatmap_tracker_health_summary(
                str(property_id),
                start_date_value=request.args.get("start_date") or req_json.get("start_date"),
                end_date_value=request.args.get("end_date") or req_json.get("end_date"),
                site_key=request.args.get("site_key") or req_json.get("site_key") or req_json.get("siteKey"),
                path=request.args.get("path") or req_json.get("path"),
                device_type=request.args.get("device_type") or request.args.get("deviceType") or req_json.get("device_type") or req_json.get("deviceType"),
                access_token=access_token,
            )
            return build_cors_json_response(payload)
        except RenderPermissionError as error:
            return build_cors_json_response({"status": "error", "error": str(error)}, status_code=403)
        except RenderAuthError as error:
            return build_cors_json_response({"status": "error", "error": str(error)}, status_code=401)
        except Exception as error:
            return build_cors_json_response(
                {"status": "error", "error": str(error), "staging_only": True},
                status_code=500,
            )

    @app.route("/api/site-audit/pages", methods=["GET", "POST", "OPTIONS"])
    def site_audit_pages():
        if request.method == "OPTIONS":
            return build_cors_json_response({})

        req_json = get_request_json_payload()
        property_id = request.args.get("property_id") or req_json.get("property_id")
        if not property_id:
            return build_cors_json_response(
                {"status": "error", "error": "Missing required parameter: property_id", "staging_only": True},
                status_code=400,
            )

        try:
            access_token, _user = require_any_property_permission(str(property_id), ("analytics.view", "reports.view"))
            payload = get_site_audit_pages_summary(
                str(property_id),
                site_key=request.args.get("site_key") or req_json.get("site_key") or req_json.get("siteKey"),
                access_token=access_token,
            )
            return build_cors_json_response(payload)
        except RenderPermissionError as error:
            return build_cors_json_response({"status": "error", "error": str(error)}, status_code=403)
        except RenderAuthError as error:
            return build_cors_json_response({"status": "error", "error": str(error)}, status_code=401)
        except Exception as error:
            return build_cors_json_response(
                {"status": "error", "error": str(error), "staging_only": True},
                status_code=500,
            )

    @app.route("/api/site-audit/run", methods=["POST", "OPTIONS"])
    def site_audit_run():
        if request.method == "OPTIONS":
            return build_cors_json_response({})

        req_json = get_request_json_payload()
        property_id = request.args.get("property_id") or req_json.get("property_id")
        if not property_id:
            return build_cors_json_response(
                {"status": "error", "error": "Missing required parameter: property_id", "staging_only": True},
                status_code=400,
            )

        try:
            access_token, _user = require_any_property_permission(str(property_id), ("analytics.view", "reports.view"))
            include_ai_value = (
                request.args.get("include_ai")
                or request.args.get("includeAi")
                or req_json.get("include_ai")
                or req_json.get("includeAi")
            )
            include_ai = str(include_ai_value).strip().lower() not in {"0", "false", "no", "off"} if include_ai_value is not None else True
            site_key = request.args.get("site_key") or req_json.get("site_key") or req_json.get("siteKey")
            background_value = (
                request.args.get("background")
                or request.args.get("async")
                or req_json.get("background")
                or req_json.get("async")
            )
            background = str(background_value).strip().lower() in {"1", "true", "yes", "on"} if background_value is not None else False
            if background:
                payload = enqueue_site_audit_job_summary(
                    str(property_id),
                    site_key=site_key,
                    access_token=access_token,
                    include_ai=include_ai,
                )
            else:
                payload = run_site_audit_summary(
                    str(property_id),
                    site_key=site_key,
                    access_token=access_token,
                    include_ai=include_ai,
                )
            return build_cors_json_response(payload)
        except RenderPermissionError as error:
            return build_cors_json_response({"status": "error", "error": str(error)}, status_code=403)
        except RenderAuthError as error:
            return build_cors_json_response({"status": "error", "error": str(error)}, status_code=401)
        except Exception as error:
            return build_cors_json_response(
                {"status": "error", "error": str(error), "staging_only": True},
                status_code=500,
            )

    @app.route("/api/site-audit/summary", methods=["GET", "POST", "OPTIONS"])
    def site_audit_summary():
        if request.method == "OPTIONS":
            return build_cors_json_response({})

        req_json = get_request_json_payload()
        property_id = request.args.get("property_id") or req_json.get("property_id")
        if not property_id:
            return build_cors_json_response(
                {"status": "error", "error": "Missing required parameter: property_id", "staging_only": True},
                status_code=400,
            )

        try:
            access_token, _user = require_any_property_permission(str(property_id), ("analytics.view", "reports.view"))
            payload = get_site_audit_summary(
                str(property_id),
                site_key=request.args.get("site_key") or req_json.get("site_key") or req_json.get("siteKey"),
                access_token=access_token,
            )
            return build_cors_json_response(payload)
        except RenderPermissionError as error:
            return build_cors_json_response({"status": "error", "error": str(error)}, status_code=403)
        except RenderAuthError as error:
            return build_cors_json_response({"status": "error", "error": str(error)}, status_code=401)
        except Exception as error:
            return build_cors_json_response(
                {"status": "error", "error": str(error), "staging_only": True},
                status_code=500,
            )

    @app.route("/api/site-audit/portfolio", methods=["GET", "POST", "OPTIONS"])
    def site_audit_portfolio():
        if request.method == "OPTIONS":
            return build_cors_json_response({})

        try:
            access_token, _user = require_platform_permission("properties.view_all")
            payload = list_site_audit_portfolio_summary(access_token=access_token)
            return build_cors_json_response(payload)
        except RenderPermissionError as error:
            return build_cors_json_response({"status": "error", "error": str(error)}, status_code=403)
        except RenderAuthError as error:
            return build_cors_json_response({"status": "error", "error": str(error)}, status_code=401)
        except Exception as error:
            return build_cors_json_response(
                {"status": "error", "error": str(error), "staging_only": True},
                status_code=500,
            )

    @app.route("/api/admin/heatmap-sites", methods=["GET", "POST", "OPTIONS"])
    def admin_heatmap_sites():
        if request.method == "OPTIONS":
            return build_cors_json_response({})

        req_json = get_request_json_payload()
        property_id = request.args.get("property_id") or req_json.get("property_id")
        if not property_id:
            return build_cors_json_response(
                {"status": "error", "error": "Missing required parameter: property_id", "staging_only": True},
                status_code=400,
            )

        try:
            if request.method == "POST":
                access_token, _user = require_any_property_permission(
                    str(property_id),
                    ("website_manager.edit", "reports.layout.edit"),
                )
                payload = save_heatmap_site_summary(str(property_id), req_json, access_token=access_token)
            else:
                access_token, _user = require_any_property_permission(str(property_id), ("analytics.view", "reports.view"))
                payload = list_heatmap_sites_summary(str(property_id), access_token=access_token)
            return build_cors_json_response(payload)
        except RenderPermissionError as error:
            return build_cors_json_response({"status": "error", "error": str(error)}, status_code=403)
        except RenderAuthError as error:
            return build_cors_json_response({"status": "error", "error": str(error)}, status_code=401)
        except Exception as error:
            return build_cors_json_response(
                {"status": "error", "error": str(error), "staging_only": True},
                status_code=500,
            )

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

    @app.route("/api/entrata/historical-backfill", methods=["GET", "POST", "OPTIONS"])
    def staged_historical_entrata_backfill():
        if request.method == "OPTIONS":
            return build_cors_json_response({})

        try:
            require_platform_permission("users.manage")
        except RenderPermissionError as error:
            return build_cors_json_response({"status": "error", "error": str(error)}, status_code=403)
        except RenderAuthError as error:
            return build_cors_json_response({"status": "error", "error": str(error)}, status_code=401)

        req_json = get_request_json_payload()
        if request.method == "GET":
            return build_cors_json_response(
                {
                    "status": "ok",
                    "job": "entrata_historical_backfill",
                    "state": get_sync_state("entrata_historical_backfill"),
                    "staging_only": True,
                }
            )

        try:
            current_date = request.args.get("current_date") or req_json.get("current_date")
            end_date = request.args.get("end_date") or req_json.get("end_date")
            batch_size = request.args.get("batch_size") or req_json.get("batch_size")
            delay_seconds = request.args.get("delay_seconds") or req_json.get("delay_seconds")
            active = request.args.get("active") or req_json.get("active")
            run_immediately = request.args.get("run_immediately") or req_json.get("run_immediately")
            property_ids = parse_property_ids_from_value(request.args.get("property_ids") or req_json.get("property_ids"))

            state = configure_historical_backfill(
                current_date=datetime.date.fromisoformat(current_date) if current_date else None,
                end_date=datetime.date.fromisoformat(end_date) if end_date else None,
                property_ids=property_ids,
                batch_size=int(batch_size) if batch_size not in (None, "") else None,
                delay_seconds=float(delay_seconds) if delay_seconds not in (None, "") else None,
                active=str(active).lower() not in {"false", "0", "no"} if active is not None else True,
            )
            result = process_historical_backfill_batch() if str(run_immediately).lower() in {"true", "1", "yes"} else None
            return build_cors_json_response(
                {
                    "status": "ok",
                    "job": "entrata_historical_backfill",
                    "state": state,
                    "result": result,
                    "staging_only": True,
                }
            )
        except Exception as error:
            return build_cors_json_response(
                {"status": "error", "error": str(error), "staging_only": True},
                status_code=500,
            )

    @app.route("/api/entrata/historical-lease-attribution", methods=["GET", "POST", "OPTIONS"])
    def staged_historical_lease_attribution():
        if request.method == "OPTIONS":
            return build_cors_json_response({})

        try:
            require_platform_permission("users.manage")
        except RenderPermissionError as error:
            return build_cors_json_response({"status": "error", "error": str(error)}, status_code=403)
        except RenderAuthError as error:
            return build_cors_json_response({"status": "error", "error": str(error)}, status_code=401)

        req_json = get_request_json_payload()
        if request.method == "GET":
            return build_cors_json_response(
                {
                    "status": "ok",
                    "job": "entrata_historical_lease_attribution",
                    "state": get_sync_state("entrata_historical_lease_attribution"),
                    "staging_only": True,
                }
            )

        try:
            start_date = request.args.get("start_date") or req_json.get("start_date")
            end_date = request.args.get("end_date") or req_json.get("end_date")
            batch_size = request.args.get("batch_size") or req_json.get("batch_size")
            delay_seconds = request.args.get("delay_seconds") or req_json.get("delay_seconds")
            lead_lookback_days = request.args.get("lead_lookback_days") or req_json.get("lead_lookback_days")
            active = request.args.get("active") or req_json.get("active")
            run_immediately = request.args.get("run_immediately") or req_json.get("run_immediately")
            property_ids = parse_property_ids_from_value(request.args.get("property_ids") or req_json.get("property_ids"))

            state = configure_historical_lease_attribution(
                start_date=datetime.date.fromisoformat(start_date) if start_date else None,
                end_date=datetime.date.fromisoformat(end_date) if end_date else None,
                property_ids=property_ids,
                batch_size=int(batch_size) if batch_size not in (None, "") else None,
                delay_seconds=float(delay_seconds) if delay_seconds not in (None, "") else None,
                lead_lookback_days=int(lead_lookback_days) if lead_lookback_days not in (None, "") else None,
                active=str(active).lower() not in {"false", "0", "no"} if active is not None else True,
            )
            result = process_historical_lease_attribution_batch() if str(run_immediately).lower() in {"true", "1", "yes"} else None
            return build_cors_json_response(
                {
                    "status": "ok",
                    "job": "entrata_historical_lease_attribution",
                    "state": state,
                    "result": result,
                    "staging_only": True,
                }
            )
        except Exception as error:
            return build_cors_json_response(
                {"status": "error", "error": str(error), "staging_only": True},
                status_code=500,
            )

    @app.route("/api/entrata/archive-backfill-to-2020", methods=["GET", "POST", "OPTIONS"])
    def staged_historical_archive_backfill():
        if request.method == "OPTIONS":
            return build_cors_json_response({})

        try:
            require_platform_permission("users.manage")
        except RenderPermissionError as error:
            return build_cors_json_response({"status": "error", "error": str(error)}, status_code=403)
        except RenderAuthError as error:
            return build_cors_json_response({"status": "error", "error": str(error)}, status_code=401)

        if request.method == "GET":
            return build_cors_json_response(
                {
                    "status": "ok",
                    "job": "entrata_historical_archive",
                    "state": get_sync_state("entrata_historical_archive"),
                    "raw_backfill": get_sync_state("entrata_historical_backfill"),
                    "lease_attribution": get_sync_state("entrata_historical_lease_attribution"),
                    "staging_only": True,
                }
            )

        req_json = get_request_json_payload()
        try:
            action = (request.args.get("action") or req_json.get("action") or "start").lower()
            if action in {"pause", "resume"}:
                state = set_historical_archive_active(action == "resume")
                return build_cors_json_response(
                    {
                        "status": "ok",
                        "job": "entrata_historical_archive",
                        "action": action,
                        "state": state,
                        "staging_only": True,
                    }
                )

            target_start_date = request.args.get("target_start_date") or req_json.get("target_start_date") or "2020-01-01"
            raw_start_date = request.args.get("raw_start_date") or req_json.get("raw_start_date") or "2025-12-31"
            raw_batch_size = request.args.get("raw_batch_size") or req_json.get("raw_batch_size")
            raw_delay_seconds = request.args.get("raw_delay_seconds") or req_json.get("raw_delay_seconds")
            attribution_batch_size = request.args.get("attribution_batch_size") or req_json.get("attribution_batch_size")
            attribution_delay_seconds = request.args.get("attribution_delay_seconds") or req_json.get("attribution_delay_seconds")
            lead_lookback_days = request.args.get("lead_lookback_days") or req_json.get("lead_lookback_days")
            active = request.args.get("active") or req_json.get("active")
            property_ids = parse_property_ids_from_value(request.args.get("property_ids") or req_json.get("property_ids"))

            state = start_historical_archive_backfill(
                target_start_date=datetime.date.fromisoformat(target_start_date),
                raw_start_date=datetime.date.fromisoformat(raw_start_date),
                property_ids=property_ids,
                raw_batch_size=int(raw_batch_size) if raw_batch_size not in (None, "") else None,
                raw_delay_seconds=float(raw_delay_seconds) if raw_delay_seconds not in (None, "") else None,
                attribution_batch_size=int(attribution_batch_size) if attribution_batch_size not in (None, "") else None,
                attribution_delay_seconds=float(attribution_delay_seconds) if attribution_delay_seconds not in (None, "") else None,
                lead_lookback_days=int(lead_lookback_days) if lead_lookback_days not in (None, "") else None,
                active=str(active).lower() not in {"false", "0", "no"} if active is not None else True,
            )
            return build_cors_json_response(
                {
                    "status": "ok",
                    "job": "entrata_historical_archive",
                    "state": state,
                    "staging_only": True,
                }
            )
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
        property_ids_value = request.args.get("property_ids") or req_json.get("property_ids")
        start_date = request.args.get("start_date") or req_json.get("start_date")
        end_date = request.args.get("end_date") or req_json.get("end_date")
        red_list_only = str(request.args.get("red_list_only") or req_json.get("red_list_only") or "").lower() in {"1", "true", "yes"}
        call_prep_only = str(request.args.get("call_prep_only") or req_json.get("call_prep_only") or "").lower() in {"1", "true", "yes"}
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

        if str(property_id) == "all":
            if isinstance(property_ids_value, str):
                try:
                    decoded = json.loads(property_ids_value)
                    property_ids = decoded if isinstance(decoded, list) else [item.strip() for item in property_ids_value.split(",") if item.strip()]
                except json.JSONDecodeError:
                    property_ids = [item.strip() for item in property_ids_value.split(",") if item.strip()]
            elif isinstance(property_ids_value, list):
                property_ids = property_ids_value
            else:
                property_ids = []

            allowed_property_ids = [
                str(candidate)
                for candidate in property_ids
                if any(
                    user_has_property_permission(access_token, str(candidate), permission)
                    for permission in ("analytics.view", "reports.view")
                )
            ]
            if not allowed_property_ids:
                return build_cors_json_response(
                    {
                        "status": "error",
                        "error": "Authenticated user does not have analytics.view or reports.view access for any requested property.",
                    },
                    status_code=403,
                )

            if call_prep_only:
                payload = get_multi_property_call_prep_summary(allowed_property_ids, start_date, end_date, access_token)
            else:
                payload = get_multi_property_reporting_overview_summary(allowed_property_ids, start_date, end_date, access_token, red_list_only=red_list_only)
        else:
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

    @app.route("/api/admin/website-manager/schema", methods=["GET", "POST", "OPTIONS"])
    def staged_website_manager_schema():
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
            require_platform_permission("users.manage")
        except RenderPermissionError as error:
            return build_cors_json_response({"status": "error", "error": str(error)}, status_code=403)
        except RenderAuthError as error:
            return build_cors_json_response({"status": "error", "error": str(error)}, status_code=401)

        if request.method == "POST":
            payload = save_website_manager_schema_summary(str(property_id), req_json)
        else:
            payload = get_website_manager_schema_summary(str(property_id))
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

    @app.route("/api/admin/access/users/<user_id>/password-reset", methods=["POST", "OPTIONS"])
    def staged_admin_access_user_password_reset(user_id: str):
        if request.method == "OPTIONS":
            return build_cors_json_response({})

        try:
            _access_token, user = require_platform_permission("users.manage")
        except RenderPermissionError as error:
            return build_cors_json_response({"status": "error", "error": str(error)}, status_code=403)
        except RenderAuthError as error:
            return build_cors_json_response({"status": "error", "error": str(error)}, status_code=401)

        req_json = request.get_json(silent=True) or {}
        payload = generate_user_password_reset_summary(
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
