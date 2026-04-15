import json
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

from render_supabase_validation import SupabaseValidationConfigError, _require_env, _supabase_headers


def _table_query_url(table_name: str, query_params: list[tuple[str, str]]) -> str:
    base_url = _require_env("SUPABASE_URL").rstrip("/")
    query_string = urlencode(query_params, doseq=True)
    return f"{base_url}/rest/v1/{quote(table_name)}?{query_string}"


def _fetch_json(table_name: str, query_params: list[tuple[str, str]]) -> list[dict[str, Any]]:
    request = Request(_table_query_url(table_name, query_params), headers=_supabase_headers(), method="GET")
    with urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def _index_sync_state_rows(rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {str(row.get("id")): row for row in rows if row.get("id")}


def _fetch_sync_state_rows() -> dict[str, dict[str, Any]]:
    rows = _fetch_json(
        "sync_state",
        [
            ("select", "*"),
        ],
    )
    return _index_sync_state_rows(rows)


def _fetch_retry_queue_preview(limit: int = 25) -> list[dict[str, Any]]:
    return _fetch_json(
        "sync_retries",
        [
            ("select", "id,job_type,property_id,date_id,attempts,abandoned,last_error"),
            ("order", "abandoned.asc"),
            ("order", "attempts.asc"),
            ("order", "last_queued_at.asc"),
            ("limit", str(limit)),
        ],
    )


def get_supabase_sync_state_payload() -> dict[str, Any]:
    sync_state_rows = _fetch_sync_state_rows()
    retry_queue_preview = _fetch_retry_queue_preview()

    return {
        "background_backfill": sync_state_rows.get("entrata_background_backfill"),
        "daily_refresh": sync_state_rows.get("entrata_daily_refresh"),
        "retry_queue_preview": retry_queue_preview,
        "source": "supabase",
        "staging_only": True,
    }


def get_supabase_sync_state_summary() -> dict[str, Any]:
    try:
        payload = get_supabase_sync_state_payload()
    except (HTTPError, URLError, SupabaseValidationConfigError) as error:
        return {
            "status": "error",
            "message": str(error),
            "staging_only": True,
        }

    payload["status"] = "ok"
    return payload
