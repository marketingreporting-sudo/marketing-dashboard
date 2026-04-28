import json
import os
import re
import datetime as dt
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

from render_supabase_validation import (
    SupabaseValidationConfigError,
    _require_env,
    _supabase_anon_headers,
    _supabase_headers,
)


def _table_query_url(table_name: str, query_params: list[tuple[str, str]]) -> str:
    base_url = _require_env("SUPABASE_URL").rstrip("/")
    query_string = urlencode(query_params, doseq=True)
    return f"{base_url}/rest/v1/{quote(table_name)}?{query_string}"


def _rpc_query_url(function_name: str) -> str:
    base_url = _require_env("SUPABASE_URL").rstrip("/")
    return f"{base_url}/rest/v1/rpc/{quote(function_name)}"


def _fetch_json(
    table_name: str,
    query_params: list[tuple[str, str]],
    *,
    headers: dict[str, str] | None = None,
) -> list[dict[str, Any]]:
    request = Request(
        _table_query_url(table_name, query_params),
        headers=headers or _supabase_headers(),
        method="GET",
    )
    with urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def _fetch_count(
    table_name: str,
    query_params: list[tuple[str, str]] | None = None,
    *,
    access_token: str | None = None,
) -> int:
    params = [("select", "id"), *(query_params or [])]
    headers = _supabase_anon_headers(access_token) if access_token else _supabase_headers()
    request = Request(
        _table_query_url(table_name, params),
        headers={**headers, "Prefer": "count=exact", "Range": "0-0"},
        method="GET",
    )
    with urlopen(request, timeout=30) as response:
        response.read()
        content_range = response.headers.get("Content-Range") or ""

    match = re.search(r"/(\d+)$", content_range)
    return int(match.group(1)) if match else 0


def _post_rpc(function_name: str, payload: dict[str, Any], *, headers: dict[str, str]) -> Any:
    request = Request(
        _rpc_query_url(function_name),
        headers={**headers, "Content-Type": "application/json"},
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
    )
    with urlopen(request, timeout=30) as response:
        body = response.read().decode("utf-8")
    if not body:
        return None
    return json.loads(body)


def _index_sync_state_rows(rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {str(row.get("id")): row for row in rows if row.get("id")}


def _fetch_sync_state_rows(*, access_token: str | None = None) -> dict[str, dict[str, Any]]:
    rows = _fetch_json(
        "sync_state",
        [
            ("select", "*"),
        ],
        headers=_supabase_anon_headers(access_token) if access_token else None,
    )
    return _index_sync_state_rows(rows)


def _fetch_retry_queue_preview(limit: int = 25, *, access_token: str | None = None) -> list[dict[str, Any]]:
    return _fetch_json(
        "sync_retries",
        [
            ("select", "id,job_type,property_id,date_id,attempts,abandoned,last_error"),
            ("order", "abandoned.asc"),
            ("order", "attempts.asc"),
            ("order", "last_queued_at.asc"),
            ("limit", str(limit)),
        ],
        headers=_supabase_anon_headers(access_token) if access_token else None,
    )


def _current_local_date() -> str:
    timezone_name = os.environ.get("APP_TIMEZONE", "America/Denver")
    return dt.datetime.now(ZoneInfo(timezone_name)).date().isoformat()


def _latest_table_timestamp(
    table_name: str,
    timestamp_fields: list[str],
    *,
    access_token: str | None = None,
) -> dict[str, Any]:
    headers = _supabase_anon_headers(access_token) if access_token else None

    for field in timestamp_fields:
        rows = _fetch_json(
            table_name,
            [
                ("select", field),
                (field, "not.is.null"),
                ("order", f"{field}.desc"),
                ("limit", "1"),
            ],
            headers=headers,
        )
        if rows and rows[0].get(field):
            return {
                "table": table_name,
                "field": field,
                "latest": rows[0].get(field),
            }

    return {
        "table": table_name,
        "field": timestamp_fields[0] if timestamp_fields else None,
        "latest": None,
    }


KEY_SNAPSHOT_TABLES: dict[str, list[str]] = {
    "property_daily_snapshots": ["activity_at", "activity_date", "updated_at"],
    "property_leads": ["activity_date", "updated_at"],
    "property_events": ["activity_date", "updated_at"],
    "property_invoices": ["activity_date", "updated_at"],
    "property_leases": ["last_synced_at", "attribution_event_date", "updated_at"],
    "property_roi_daily": ["last_aggregated_at", "activity_date", "updated_at"],
    "property_specials_current": ["last_synced_at", "last_changed_at", "updated_at"],
    "property_availability_snapshots": ["last_synced_at", "last_changed_at", "updated_at"],
    "property_analytics_snapshots": ["fetched_at", "updated_at"],
}


def get_supabase_sync_state_payload(access_token: str | None = None) -> dict[str, Any]:
    sync_state_rows = _fetch_sync_state_rows(access_token=access_token)
    retry_queue_preview = _fetch_retry_queue_preview(access_token=access_token)

    return {
        "background_backfill": sync_state_rows.get("entrata_background_backfill"),
        "daily_refresh": sync_state_rows.get("entrata_daily_refresh"),
        "retry_queue_preview": retry_queue_preview,
        "source": "supabase",
        "staging_only": True,
    }


def get_supabase_sync_state_summary(access_token: str | None = None) -> dict[str, Any]:
    try:
        payload = get_supabase_sync_state_payload(access_token=access_token)
    except (HTTPError, URLError, SupabaseValidationConfigError) as error:
        return {
            "status": "error",
            "message": str(error),
            "staging_only": True,
        }

    payload["status"] = "ok"
    return payload


def get_supabase_sync_health_payload(access_token: str | None = None) -> dict[str, Any]:
    sync_state_rows = _fetch_sync_state_rows(access_token=access_token)
    daily_refresh = sync_state_rows.get("entrata_daily_refresh") or {}
    today = _current_local_date()
    daily_refresh_run_date = str(daily_refresh.get("run_date") or "")

    latest_snapshot_timestamps = {
        table_name: _latest_table_timestamp(table_name, timestamp_fields, access_token=access_token)
        for table_name, timestamp_fields in KEY_SNAPSHOT_TABLES.items()
    }

    retry_queue_count = _fetch_count(
        "sync_retries",
        [("abandoned", "eq.false")],
        access_token=access_token,
    )
    abandoned_retry_count = _fetch_count(
        "sync_retries",
        [("abandoned", "eq.true")],
        access_token=access_token,
    )

    return {
        "daily_refresh": {
            "run_date": daily_refresh.get("run_date"),
            "completed": bool(daily_refresh.get("completed")),
            "completed_today": daily_refresh_run_date == today and bool(daily_refresh.get("completed")),
            "last_processed_at": daily_refresh.get("last_processed_at"),
            "last_processed_count": daily_refresh.get("last_processed_count"),
            "last_error_count": daily_refresh.get("last_error_count"),
            "next_day_offset": daily_refresh.get("next_day_offset"),
            "next_property_index": daily_refresh.get("next_property_index"),
        },
        "retry_queue": {
            "active_count": retry_queue_count,
            "abandoned_count": abandoned_retry_count,
        },
        "latest_snapshot_timestamps": latest_snapshot_timestamps,
        "today": today,
        "source": "supabase",
        "staging_only": True,
    }


def get_supabase_sync_health_summary(access_token: str | None = None) -> dict[str, Any]:
    try:
        payload = get_supabase_sync_health_payload(access_token=access_token)
    except (HTTPError, URLError, SupabaseValidationConfigError) as error:
        return {
            "status": "error",
            "message": str(error),
            "staging_only": True,
        }

    payload["status"] = "ok"
    return payload
