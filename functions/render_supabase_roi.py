from typing import Any

from urllib.error import HTTPError, URLError

from render_supabase_sync_state import _fetch_json
from render_supabase_validation import SupabaseValidationConfigError


def _index_sync_state_rows(rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {str(row.get("id")): row for row in rows if row.get("id")}


def _parse_iso_date(date_value: str | None) -> tuple[int, int, int] | None:
    if not date_value:
        return None

    try:
        year, month, day = date_value.split("-")
        return int(year), int(month), int(day)
    except (TypeError, ValueError):
        return None


def _inclusive_day_span(start_value: str | None, end_value: str | None) -> int | None:
    start = _parse_iso_date(start_value)
    end = _parse_iso_date(end_value)
    if not start or not end:
        return None

    import datetime as _dt

    return (_dt.date(*end) - _dt.date(*start)).days + 1


def _summarize_state(job_name: str, state: dict[str, Any] | None) -> dict[str, Any]:
    state = state or {}
    property_ids = state.get("property_ids", []) if isinstance(state.get("property_ids"), list) else []
    total_properties = len(property_ids)
    total_days = _inclusive_day_span(state.get("raw_start_date"), state.get("raw_end_date"))
    raw_day_index = int(state.get("raw_day_index", 0) or 0)
    attribution_index = int(state.get("attribution_property_index", 0) or 0)
    aggregate_index = int(state.get("aggregate_property_index", 0) or 0)
    phase = state.get("phase", "unknown")

    progress: dict[str, Any] = {}
    if total_days is not None:
        progress["raw_days_processed"] = min(raw_day_index, total_days)
        progress["raw_days_total"] = total_days
    if total_properties:
        progress["attribution_properties_processed"] = min(attribution_index, total_properties)
        progress["attribution_properties_total"] = total_properties
        progress["aggregate_properties_processed"] = min(aggregate_index, total_properties)
        progress["aggregate_properties_total"] = total_properties

    return {
        "job_name": job_name,
        "active": bool(state.get("active")),
        "completed": bool(state.get("completed")),
        "phase": phase,
        "initiated_by": state.get("initiated_by"),
        "raw_start_date": state.get("raw_start_date"),
        "raw_end_date": state.get("raw_end_date"),
        "report_start_date": state.get("report_start_date"),
        "report_end_date": state.get("report_end_date"),
        "last_summary": state.get("last_summary"),
        "last_processed_at": state.get("last_processed_at"),
        "started_at": state.get("started_at"),
        "completed_at": state.get("completed_at"),
        "property_count": total_properties,
        "progress": progress,
    }


def get_supabase_roi_pipeline_status_payload() -> dict[str, Any]:
    rows = _fetch_json("sync_state", [("select", "*")])
    indexed = _index_sync_state_rows(rows)

    daily_state = indexed.get("roi_daily_refresh") or indexed.get("roi_daily_pipeline")
    ytd_state = indexed.get("roi_ytd_backfill")

    return {
        "roi_ytd_backfill": _summarize_state("roi_ytd_backfill", ytd_state),
        "roi_daily_refresh": _summarize_state("roi_daily_refresh", daily_state),
        "source": "supabase",
        "staging_only": True,
    }


def get_supabase_roi_pipeline_status_summary() -> dict[str, Any]:
    try:
        payload = get_supabase_roi_pipeline_status_payload()
    except (HTTPError, URLError, SupabaseValidationConfigError) as error:
        return {
            "status": "error",
            "message": str(error),
            "staging_only": True,
        }

    payload["status"] = "ok"
    return payload
