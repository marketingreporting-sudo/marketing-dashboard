import json
import os
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen


VALIDATION_TABLES = (
    "sync_state",
    "sync_retries",
    "marketing_opportunities",
    "site_audits",
    "property_daily_snapshots",
    "property_leads",
    "property_events",
    "property_invoices",
    "property_availability",
    "property_leases",
    "property_roi_daily",
    "property_snapshot_leases",
)


class SupabaseValidationConfigError(RuntimeError):
    pass


def _require_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
      raise SupabaseValidationConfigError(f"Missing required environment variable: {name}")
    return value


def _supabase_headers() -> dict[str, str]:
    service_role_key = _require_env("SUPABASE_SERVICE_ROLE_KEY")
    return {
        "apikey": service_role_key,
        "Authorization": f"Bearer {service_role_key}",
        "Prefer": "count=exact",
    }


def _supabase_anon_headers(access_token: str | None = None) -> dict[str, str]:
    anon_key = _require_env("SUPABASE_ANON_KEY")
    headers = {
        "apikey": anon_key,
        "Prefer": "count=exact",
    }
    if access_token:
        headers["Authorization"] = f"Bearer {access_token}"
    else:
        headers["Authorization"] = f"Bearer {anon_key}"
    return headers


def _table_url(table_name: str) -> str:
    base_url = _require_env("SUPABASE_URL").rstrip("/")
    return f"{base_url}/rest/v1/{quote(table_name)}?select=*"


def _parse_content_range(content_range: str | None) -> int | None:
    if not content_range or "/" not in content_range:
        return None

    try:
        return int(content_range.split("/")[-1])
    except ValueError:
        return None


def fetch_supabase_table_count(table_name: str) -> int | None:
    request = Request(_table_url(table_name), headers=_supabase_headers(), method="HEAD")
    with urlopen(request, timeout=30) as response:
        return _parse_content_range(response.headers.get("Content-Range"))


def get_supabase_migration_validation_summary() -> dict[str, Any]:
    if os.environ.get("SUPABASE_VALIDATION_ENABLED", "1") != "1":
        raise SupabaseValidationConfigError("SUPABASE_VALIDATION_ENABLED is not enabled.")

    table_counts = {}
    table_errors = {}

    for table_name in VALIDATION_TABLES:
        try:
            table_counts[table_name] = fetch_supabase_table_count(table_name)
        except (HTTPError, URLError, SupabaseValidationConfigError) as error:
            table_errors[table_name] = str(error)

    return {
        "status": "ok" if not table_errors else "partial",
        "source": "supabase",
        "staging_only": True,
        "table_counts": table_counts,
        "table_errors": table_errors,
        "notes": [
            "This endpoint is intended for staging validation only.",
            "Firebase remains the production source of truth until cutover.",
        ],
        "lease_modeling": {
            "direct_property_leases_table": "property_leases",
            "snapshot_scoped_leases_table": "property_snapshot_leases",
        },
    }


def get_supabase_migration_validation_json() -> str:
    return json.dumps(get_supabase_migration_validation_summary(), indent=2)
