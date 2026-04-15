import os

from flask import Flask, jsonify

from render_adapter_registry import get_cron_job_specs, get_http_endpoint_specs
from render_supabase_sync_state import get_supabase_sync_state_summary
from render_supabase_validation import (
    SupabaseValidationConfigError,
    get_supabase_migration_validation_summary,
)


def create_app() -> Flask:
    app = Flask(__name__)

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
