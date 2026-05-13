from __future__ import annotations

import calendar
from datetime import date, datetime, timedelta
from typing import Any
from urllib.error import HTTPError, URLError

from property_catalog import PROPERTY_PORTFOLIO_BY_ID
from render_supabase_sync_state import _fetch_json
from render_supabase_validation import SupabaseValidationConfigError, _supabase_anon_headers

_LEAD_KEY_CANDIDATES = (
    "leadEventId", "eventId", "eventID", "leadId", "leadID", "prospectId",
    "prospectID", "customerId", "customerID", "applicationId", "id",
)
_LEASE_KEY_CANDIDATES = (
    "lease_interval_id", "leaseIntervalId", "lease_id", "leaseId", "leaseID",
    "application_id", "applicationId", "applicationID", "id",
)


def _parse_iso_date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def _default_date_window() -> tuple[date, date]:
    end = datetime.now().date()
    start = end - timedelta(days=27)
    return start, end


def _month_bounded_window(start_date: date, end_date: date) -> tuple[date, date]:
    invoice_start = start_date.replace(day=1)
    last_day = calendar.monthrange(end_date.year, end_date.month)[1]
    invoice_end = end_date.replace(day=last_day)
    return invoice_start, invoice_end


def _shift_year(value: date, year_delta: int) -> date:
    target_year = value.year + year_delta
    target_day = min(value.day, calendar.monthrange(target_year, value.month)[1])
    return date(target_year, value.month, target_day)


def _student_prelease_cycle(end_date: date) -> dict[str, date]:
    fall_year = end_date.year if end_date.month < 9 else end_date.year + 1
    return {
        "cycle_start": date(fall_year - 1, 11, 10),
        "fall_start": date(fall_year, 8, 15),
        "fall_window_start": date(fall_year, 8, 1),
        "fall_window_end": date(fall_year, 11, 30),
        "comparable_prior_end": _shift_year(end_date, -1),
        "prior_cycle_start": date(fall_year - 2, 11, 10),
        "prior_fall_window_start": date(fall_year - 1, 8, 1),
        "prior_fall_window_end": date(fall_year - 1, 11, 30),
    }


def _safe_number(value: Any, default: float = 0) -> float:
    try:
        if value in (None, ""):
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _stable_key(row: dict[str, Any], candidates: tuple[str, ...]) -> str:
    payload = row.get("raw_data") if isinstance(row.get("raw_data"), dict) else row
    for key in candidates:
        value = row.get(key) if row.get(key) not in (None, "") else payload.get(key)
        if value not in (None, ""):
            return f"{row.get('property_id') or payload.get('_propertyId') or ''}:{value}"
    return f"{row.get('property_id') or ''}:{row.get('id') or row.get('firestore_path') or str(payload)}"


def _unique_count(rows: list[dict[str, Any]], candidates: tuple[str, ...]) -> int:
    return len({_stable_key(row, candidates) for row in rows})


def _event_type_id(row: dict[str, Any]) -> int | None:
    payload = row.get("raw_data") if isinstance(row.get("raw_data"), dict) else row
    value = payload.get("typeId")
    try:
        return int(value) if value not in (None, "") else None
    except (TypeError, ValueError):
        return None


def _event_reason(row: dict[str, Any]) -> str:
    payload = row.get("raw_data") if isinstance(row.get("raw_data"), dict) else row
    value = payload.get("eventReason") or payload.get("type") or payload.get("name") or ""
    return " ".join(str(value).lower().replace(" :", ":").split())


def _is_completed_application_event(row: dict[str, Any]) -> bool:
    if _event_type_id(row) != 12:
        return False
    reason = _event_reason(row)
    return "application status: completed" in reason or "application: completed" in reason


def _is_approved_lease_event(row: dict[str, Any]) -> bool:
    if _event_type_id(row) != 13:
        return False
    reason = _event_reason(row)
    return "lease status: approved" in reason and "renewal lease" not in reason


def _date_value(row: dict[str, Any], key: str) -> date | None:
    value = row.get(key)
    if isinstance(value, date):
        return value
    return _parse_iso_date(str(value)) if value else None


def _active_lease_count(rows: list[dict[str, Any]], target_date: date, *, signed_as_of: date) -> int:
    active_keys = set()
    for row in rows:
        start = _date_value(row, "lease_start_date") or _date_value(row, "move_in_date")
        end = _date_value(row, "lease_end_date") or _date_value(row, "move_out_date")
        approved = _date_value(row, "attribution_event_date")
        if not start or start > target_date:
            continue
        if end and end < target_date:
            continue
        if approved and approved > signed_as_of:
            continue
        active_keys.add(_stable_key(row, _LEASE_KEY_CANDIDATES))
    return len(active_keys)


def _unit_space_count_from_pricing_row(row: dict[str, Any] | None) -> int:
    if not row:
        return 0
    raw_result = row.get("raw_result") if isinstance(row.get("raw_result"), dict) else {}
    units = row.get("units") or raw_result.get("units") or []
    if not isinstance(units, list):
        return 0

    total = 0
    for unit in units:
        if not isinstance(unit, dict):
            continue
        unit_space = unit.get("UnitSpace")
        if isinstance(unit_space, dict):
            total += len(unit_space)
        elif isinstance(unit_space, list):
            total += len(unit_space)
    return total


def _availability_target_count(row: dict[str, Any] | None, portfolio: str) -> int:
    if not row:
        return 0
    raw_result = row.get("raw_result") if isinstance(row.get("raw_result"), dict) else {}
    unit_count = int(_safe_number(row.get("unit_count") or raw_result.get("unit_count") or raw_result.get("unitCount"), 0))
    if portfolio == "multifamily":
        return unit_count

    return max(
        unit_count,
        _unit_space_count_from_pricing_row(row),
        int(_safe_number(raw_result.get("bed_count") or raw_result.get("bedCount"), 0)),
        int(_safe_number(raw_result.get("unit_space_count") or raw_result.get("unitSpaceCount"), 0)),
    )


def _red_list_summary(
    *,
    property_id: str,
    portfolio: str,
    end_date: date,
    start_date: date,
    pricing_row: dict[str, Any] | None,
    leads_rows: list[dict[str, Any]],
    lead_60_day_rows: list[dict[str, Any]],
    event_60_day_rows: list[dict[str, Any]],
    prelease_lease_rows: list[dict[str, Any]],
    conventional_lease_rows: list[dict[str, Any]],
    prelease_cycle: dict[str, date],
    conventional_window_start: date,
    conventional_prior_date: date,
    conventional_forecast_date: date,
) -> dict[str, Any]:
    target_count = _availability_target_count(pricing_row, portfolio)

    if portfolio == "multifamily":
        forecast_occupied = _active_lease_count(conventional_lease_rows, conventional_forecast_date, signed_as_of=end_date)
        forecast_exposure_rate = max(0, 1 - min(1, forecast_occupied / target_count)) if target_count > 0 else None
        available_units = max(0, target_count - forecast_occupied) if target_count > 0 else None
        lead_count = _unique_count(lead_60_day_rows, _LEAD_KEY_CANDIDATES)
        lease_count = _unique_count([row for row in event_60_day_rows if _is_approved_lease_event(row)], _LEASE_KEY_CANDIDATES)
        required_leads_at_ten = int((available_units / 0.1) + 0.999999) if available_units is not None else None
        lead_deficit_at_ten = max(0, required_leads_at_ten - lead_count) if required_leads_at_ten is not None else None
        is_red_list = bool((forecast_exposure_rate or 0) > 0.12 and (lead_deficit_at_ten or 0) > 0)
        return {
            "property_id": property_id,
            "portfolio": portfolio,
            "is_red_list": is_red_list,
            "reason": "60-day exposure is above 12% and lead deficit at 10% close is positive." if is_red_list else "Conventional thresholds are currently clear.",
            "forecast_exposure_rate": forecast_exposure_rate,
            "lead_deficit_at_ten_close": lead_deficit_at_ten,
            "available_units_in_60_days": available_units,
            "lead_count_60_days": lead_count,
            "lease_count_60_days": lease_count,
            "forecast_date": conventional_forecast_date.isoformat(),
        }

    current_preleases = _unique_count(prelease_lease_rows, _LEASE_KEY_CANDIDATES)
    leases_remaining = max(0, target_count - current_preleases) if target_count > 0 else None
    lead_count = _unique_count(leads_rows, _LEAD_KEY_CANDIDATES)
    days_in_window = max(1, (end_date - start_date).days + 1)
    leads_per_month = lead_count / max(days_in_window / 30.4375, 0.1)
    days_to_fall = max(0, (prelease_cycle["fall_start"] - end_date).days)
    months_to_fall = max(days_to_fall / 30.4375, 0.1)
    leads_needed_at_thirty = int((leases_remaining / 0.3) + 0.999999) if leases_remaining is not None else None
    leads_needed_per_month_at_thirty = (leads_needed_at_thirty / months_to_fall) if leads_needed_at_thirty is not None else None
    projected_leads_before_fall = (lead_count / days_in_window) * days_to_fall
    lead_deficit_at_thirty = max(0, int((leads_needed_at_thirty - projected_leads_before_fall) + 0.999999)) if leads_needed_at_thirty is not None else None
    lead_deficit_percent_at_thirty = (lead_deficit_at_thirty / leads_needed_at_thirty) if leads_needed_at_thirty else None
    lead_fulfillment_rate = (
        leads_per_month / leads_needed_per_month_at_thirty
        if leads_needed_per_month_at_thirty and leads_needed_per_month_at_thirty > 0
        else None
    )
    is_red_list = bool(
        ((lead_deficit_at_thirty or 0) > 0 and (lead_deficit_percent_at_thirty or 0) > 0.8)
        or (lead_fulfillment_rate is not None and lead_fulfillment_rate < 0.5)
    )
    return {
        "property_id": property_id,
        "portfolio": portfolio,
        "is_red_list": is_red_list,
        "reason": "30% close-rate deficit is above 80% or lead fulfillment is below 50%." if is_red_list else "Student thresholds are currently clear.",
        "current_prelease_count": current_preleases,
        "target_lease_count": target_count,
        "lead_count": lead_count,
        "leads_per_month": leads_per_month,
        "leads_needed_per_month_at_thirty_close": leads_needed_per_month_at_thirty,
        "lead_fulfillment_rate": lead_fulfillment_rate,
        "lead_deficit_at_thirty_close": lead_deficit_at_thirty,
        "lead_deficit_percent_at_thirty_close": lead_deficit_percent_at_thirty,
        "fall_start": prelease_cycle["fall_start"].isoformat(),
    }


def _shape_property_snapshot(row: dict[str, Any]) -> dict[str, Any]:
    payload = dict(row.get("raw_data") or {})
    payload.update(
        {
            "id": row.get("id"),
            "property_id": row.get("property_id"),
            "activity_date": row.get("activity_date"),
            "date": row.get("source_date_id") or row.get("activity_date"),
            "activity_at": row.get("activity_at"),
            "firestore_path": row.get("firestore_path"),
        }
    )
    return payload


def _shape_child_payload(row: dict[str, Any]) -> dict[str, Any]:
    payload = dict(row.get("raw_data") or {})
    payload.update(
        {
            "_date": row.get("activity_date"),
            "_parentId": row.get("property_snapshot_id"),
            "_propertyId": row.get("property_id"),
            "_firestorePath": row.get("firestore_path"),
        }
    )
    return payload


def _shape_property_lease(row: dict[str, Any]) -> dict[str, Any]:
    payload = dict(row.get("raw_data") or {})
    payload.update(
        {
            "_propertyId": row.get("property_id"),
            "_firestorePath": row.get("firestore_path"),
            "_date": row.get("attribution_event_date"),
            "id": row.get("id"),
            "property_id": row.get("property_id"),
            "reporting_window_start": row.get("reporting_window_start"),
            "reporting_window_end": row.get("reporting_window_end"),
            "attribution_status": row.get("attribution_status"),
            "attribution_event_date": row.get("attribution_event_date"),
            "lease_start_date": row.get("lease_start_date"),
            "lease_end_date": row.get("lease_end_date"),
            "move_in_date": row.get("move_in_date"),
            "move_out_date": row.get("move_out_date"),
            "gross_lease_value": row.get("gross_lease_value"),
            "net_effective_rent": row.get("net_effective_rent"),
            "net_effective_revenue": row.get("net_effective_revenue"),
            "concession_total": row.get("concession_total"),
        }
    )
    return payload


def _shape_current_snapshot(row: dict[str, Any] | None, *, fallback_array_keys: tuple[str, ...] = ()) -> dict[str, Any] | None:
    if not row:
        return None

    payload = dict(row.get("raw_result") or {})
    for key in fallback_array_keys:
        payload.setdefault(key, row.get(key) or [])

    payload.setdefault("property_id", row.get("property_id"))
    payload.setdefault("floorplan_count", row.get("floorplan_count"))
    payload.setdefault("unit_count", row.get("unit_count"))
    payload.setdefault("availability_url", row.get("availability_url"))
    payload.setdefault("portfolio", row.get("portfolio"))
    payload.setdefault("org_slug", row.get("org_slug"))
    payload.setdefault("last_changed_at", row.get("last_changed_at"))
    payload.setdefault("last_synced_at", row.get("last_synced_at"))
    payload.setdefault("firestore_path", row.get("firestore_path"))
    return payload


def _shape_roi_daily_row(row: dict[str, Any]) -> dict[str, Any]:
    payload = dict(row.get("raw_data") or {})
    payload.update(
        {
            "id": row.get("id"),
            "property_id": row.get("property_id"),
            "activity_date": row.get("activity_date"),
            "firestore_path": row.get("firestore_path"),
        }
    )
    return payload


def _sort_activity_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(
        rows,
        key=lambda row: (
            str(row.get("activity_date") or ""),
            str(row.get("property_id") or ""),
            str(row.get("id") or row.get("firestore_path") or ""),
        ),
    )


def get_property_red_list_summary(
    property_id: str,
    end_date_value: str | None = None,
    access_token: str | None = None,
) -> dict[str, Any]:
    headers = _supabase_anon_headers(access_token)
    end_date = _parse_iso_date(end_date_value)
    if not end_date:
        _, end_date = _default_date_window()

    start_date = end_date - timedelta(days=59)
    portfolio = PROPERTY_PORTFOLIO_BY_ID.get(str(property_id), "student")
    conventional_window_start = start_date
    conventional_prior_date = end_date - timedelta(days=7)
    conventional_forecast_date = end_date + timedelta(days=60)

    leads_rows = _fetch_json(
        "property_leads",
        [
            ("select", "property_snapshot_id,property_id,activity_date,raw_data,firestore_path"),
            ("property_id", f"eq.{property_id}"),
            ("activity_date", f"gte.{start_date.isoformat()}"),
            ("activity_date", f"lte.{end_date.isoformat()}"),
            ("order", "activity_date.asc"),
        ],
        headers=headers,
    )
    pricing_rows = _fetch_json(
        "property_availability_snapshots",
        [
            ("select", "property_id,floorplan_count,unit_count,availability_url,floorplans,units,portfolio,org_slug,last_synced_at,last_changed_at,raw_result,firestore_path"),
            ("property_id", f"eq.{property_id}"),
            ("limit", "1"),
        ],
        headers=headers,
    )

    if portfolio == "multifamily":
        event_60_day_rows = _fetch_json(
            "property_events",
            [
                ("select", "property_snapshot_id,property_id,activity_date,raw_data,firestore_path"),
                ("property_id", f"eq.{property_id}"),
                ("activity_date", f"gte.{start_date.isoformat()}"),
                ("activity_date", f"lte.{end_date.isoformat()}"),
                ("order", "activity_date.asc"),
            ],
            headers=headers,
        )
        conventional_lease_rows = _fetch_json(
            "property_leases",
            [
                (
                    "select",
                    "id,property_id,reporting_window_start,reporting_window_end,attribution_status,"
                    "attribution_event_date,lease_start_date,lease_end_date,move_in_date,move_out_date,"
                    "gross_lease_value,net_effective_rent,net_effective_revenue,concession_total,raw_data,firestore_path",
                ),
                ("property_id", f"eq.{property_id}"),
                ("lease_start_date", f"lte.{conventional_forecast_date.isoformat()}"),
                ("order", "lease_start_date.asc"),
            ],
            headers=headers,
        )
        return _red_list_summary(
            property_id=property_id,
            portfolio=portfolio,
            start_date=start_date,
            end_date=end_date,
            pricing_row=pricing_rows[0] if pricing_rows else None,
            leads_rows=leads_rows,
            lead_60_day_rows=leads_rows,
            event_60_day_rows=event_60_day_rows,
            prelease_lease_rows=[],
            conventional_lease_rows=conventional_lease_rows,
            prelease_cycle=_student_prelease_cycle(end_date),
            conventional_window_start=conventional_window_start,
            conventional_prior_date=conventional_prior_date,
            conventional_forecast_date=conventional_forecast_date,
        )

    prelease_cycle = _student_prelease_cycle(end_date)
    prelease_lease_rows = _fetch_json(
        "property_leases",
        [
            (
                "select",
                "id,property_id,reporting_window_start,reporting_window_end,attribution_status,"
                "attribution_event_date,lease_start_date,lease_end_date,move_in_date,move_out_date,"
                "gross_lease_value,net_effective_rent,net_effective_revenue,concession_total,raw_data,firestore_path",
            ),
            ("property_id", f"eq.{property_id}"),
            ("attribution_event_date", f"gte.{prelease_cycle['cycle_start'].isoformat()}"),
            ("attribution_event_date", f"lte.{end_date.isoformat()}"),
            ("lease_start_date", f"gte.{prelease_cycle['fall_window_start'].isoformat()}"),
            ("lease_start_date", f"lte.{prelease_cycle['fall_window_end'].isoformat()}"),
            ("order", "attribution_event_date.asc"),
        ],
        headers=headers,
    )

    return _red_list_summary(
        property_id=property_id,
        portfolio=portfolio,
        start_date=start_date,
        end_date=end_date,
        pricing_row=pricing_rows[0] if pricing_rows else None,
        leads_rows=leads_rows,
        lead_60_day_rows=leads_rows,
        event_60_day_rows=[],
        prelease_lease_rows=prelease_lease_rows,
        conventional_lease_rows=[],
        prelease_cycle=prelease_cycle,
        conventional_window_start=conventional_window_start,
        conventional_prior_date=conventional_prior_date,
        conventional_forecast_date=conventional_forecast_date,
    )


def get_property_reporting_overview_payload(
    property_id: str,
    start_date_value: str | None = None,
    end_date_value: str | None = None,
    access_token: str | None = None,
) -> dict[str, Any]:
    headers = _supabase_anon_headers(access_token)
    start_date = _parse_iso_date(start_date_value)
    end_date = _parse_iso_date(end_date_value)
    if not start_date or not end_date:
        start_date, end_date = _default_date_window()
    if start_date > end_date:
        start_date, end_date = end_date, start_date

    portfolio = PROPERTY_PORTFOLIO_BY_ID.get(str(property_id), "student")
    invoice_start, invoice_end = _month_bounded_window(start_date, end_date)
    prelease_cycle = _student_prelease_cycle(end_date)
    conventional_window_start = end_date - timedelta(days=59)
    conventional_prior_date = end_date - timedelta(days=7)
    conventional_forecast_date = end_date + timedelta(days=60)

    parent_rows = _fetch_json(
        "property_daily_snapshots",
        [
            ("select", "id,property_id,activity_date,activity_at,source_date_id,raw_data,firestore_path"),
            ("property_id", f"eq.{property_id}"),
            ("activity_date", f"gte.{start_date.isoformat()}"),
            ("activity_date", f"lte.{end_date.isoformat()}"),
            ("order", "activity_date.asc"),
        ],
        headers=headers,
    )
    latest_activity_date = parent_rows[-1].get("activity_date") if parent_rows else None

    leads_rows = _fetch_json(
        "property_leads",
        [
            ("select", "property_snapshot_id,property_id,activity_date,raw_data,firestore_path"),
            ("property_id", f"eq.{property_id}"),
            ("activity_date", f"gte.{start_date.isoformat()}"),
            ("activity_date", f"lte.{end_date.isoformat()}"),
            ("order", "activity_date.asc"),
        ],
        headers=headers,
    )
    events_rows = _fetch_json(
        "property_events",
        [
            ("select", "property_snapshot_id,property_id,activity_date,raw_data,firestore_path"),
            ("property_id", f"eq.{property_id}"),
            ("activity_date", f"gte.{start_date.isoformat()}"),
            ("activity_date", f"lte.{end_date.isoformat()}"),
            ("order", "activity_date.asc"),
        ],
        headers=headers,
    )
    lead_60_day_rows = _fetch_json(
        "property_leads",
        [
            ("select", "property_snapshot_id,property_id,activity_date,raw_data,firestore_path"),
            ("property_id", f"eq.{property_id}"),
            ("activity_date", f"gte.{conventional_window_start.isoformat()}"),
            ("activity_date", f"lte.{end_date.isoformat()}"),
            ("order", "activity_date.asc"),
        ],
        headers=headers,
    )
    event_60_day_rows = _fetch_json(
        "property_events",
        [
            ("select", "property_snapshot_id,property_id,activity_date,raw_data,firestore_path"),
            ("property_id", f"eq.{property_id}"),
            ("activity_date", f"gte.{conventional_window_start.isoformat()}"),
            ("activity_date", f"lte.{end_date.isoformat()}"),
            ("order", "activity_date.asc"),
        ],
        headers=headers,
    )
    invoice_rows = _fetch_json(
        "property_invoices",
        [
            ("select", "property_snapshot_id,property_id,activity_date,raw_data,firestore_path"),
            ("property_id", f"eq.{property_id}"),
            ("activity_date", f"gte.{invoice_start.isoformat()}"),
            ("activity_date", f"lte.{invoice_end.isoformat()}"),
            ("order", "activity_date.asc"),
        ],
        headers=headers,
    )
    lease_rows = _fetch_json(
        "property_leases",
        [
            (
                "select",
                "id,property_id,reporting_window_start,reporting_window_end,attribution_status,"
                "attribution_event_date,lease_start_date,lease_end_date,move_in_date,move_out_date,"
                "gross_lease_value,net_effective_rent,net_effective_revenue,concession_total,raw_data,firestore_path",
            ),
            ("property_id", f"eq.{property_id}"),
            ("reporting_window_end", f"gte.{start_date.isoformat()}"),
            ("reporting_window_start", f"lte.{end_date.isoformat()}"),
            ("order", "attribution_event_date.asc"),
        ],
        headers=headers,
    )
    prelease_lease_rows = _fetch_json(
        "property_leases",
        [
            (
                "select",
                "id,property_id,reporting_window_start,reporting_window_end,attribution_status,"
                "attribution_event_date,lease_start_date,lease_end_date,move_in_date,move_out_date,"
                "gross_lease_value,net_effective_rent,net_effective_revenue,concession_total,raw_data,firestore_path",
            ),
            ("property_id", f"eq.{property_id}"),
            ("attribution_event_date", f"gte.{prelease_cycle['cycle_start'].isoformat()}"),
            ("attribution_event_date", f"lte.{end_date.isoformat()}"),
            ("lease_start_date", f"gte.{prelease_cycle['fall_window_start'].isoformat()}"),
            ("lease_start_date", f"lte.{prelease_cycle['fall_window_end'].isoformat()}"),
            ("order", "attribution_event_date.asc"),
        ],
        headers=headers,
    )
    prior_prelease_lease_rows = _fetch_json(
        "property_leases",
        [
            (
                "select",
                "id,property_id,reporting_window_start,reporting_window_end,attribution_status,"
                "attribution_event_date,lease_start_date,lease_end_date,move_in_date,move_out_date,"
                "gross_lease_value,net_effective_rent,net_effective_revenue,concession_total,raw_data,firestore_path",
            ),
            ("property_id", f"eq.{property_id}"),
            ("attribution_event_date", f"gte.{prelease_cycle['prior_cycle_start'].isoformat()}"),
            ("attribution_event_date", f"lte.{prelease_cycle['comparable_prior_end'].isoformat()}"),
            ("lease_start_date", f"gte.{prelease_cycle['prior_fall_window_start'].isoformat()}"),
            ("lease_start_date", f"lte.{prelease_cycle['prior_fall_window_end'].isoformat()}"),
            ("order", "attribution_event_date.asc"),
        ],
        headers=headers,
    )
    conventional_lease_rows = _fetch_json(
        "property_leases",
        [
            (
                "select",
                "id,property_id,reporting_window_start,reporting_window_end,attribution_status,"
                "attribution_event_date,lease_start_date,lease_end_date,move_in_date,move_out_date,"
                "gross_lease_value,net_effective_rent,net_effective_revenue,concession_total,raw_data,firestore_path",
            ),
            ("property_id", f"eq.{property_id}"),
            ("lease_start_date", f"lte.{conventional_forecast_date.isoformat()}"),
            ("order", "lease_start_date.asc"),
        ],
        headers=headers,
    )
    roi_rows = _fetch_json(
        "property_roi_daily",
        [
            ("select", "id,property_id,activity_date,raw_data,firestore_path"),
            ("property_id", f"eq.{property_id}"),
            ("activity_date", f"gte.{start_date.isoformat()}"),
            ("activity_date", f"lte.{end_date.isoformat()}"),
            ("order", "activity_date.asc"),
        ],
        headers=headers,
    )
    specials_rows = _fetch_json(
        "property_specials_current",
        [
            ("select", "property_id,special_count,specials,last_synced_at,raw_result,firestore_path"),
            ("property_id", f"eq.{property_id}"),
            ("limit", "1"),
        ],
        headers=headers,
    )
    pricing_rows = _fetch_json(
        "property_availability_snapshots",
        [
            ("select", "property_id,floorplan_count,unit_count,availability_url,floorplans,units,portfolio,org_slug,last_synced_at,last_changed_at,raw_result,firestore_path"),
            ("property_id", f"eq.{property_id}"),
            ("limit", "1"),
        ],
        headers=headers,
    )
    availability_pricing_snapshot = _shape_current_snapshot(
        pricing_rows[0] if pricing_rows else None,
        fallback_array_keys=("floorplans", "units"),
    )
    availability_snapshot_date = (
        availability_pricing_snapshot.get("last_synced_at")
        or availability_pricing_snapshot.get("last_changed_at")
        or latest_activity_date
    )
    red_list_summary = get_property_red_list_summary(property_id, None, access_token)

    return {
        "property_id": property_id,
        "portfolio": portfolio,
        "range": {
            "start_date": start_date.isoformat(),
            "end_date": end_date.isoformat(),
            "invoice_start_date": invoice_start.isoformat(),
            "invoice_end_date": invoice_end.isoformat(),
        },
        "parent_docs": [_shape_property_snapshot(row) for row in parent_rows],
        "lead_items": [_shape_child_payload(row) for row in leads_rows],
        "event_items": [_shape_child_payload(row) for row in events_rows],
        "lease_items": [_shape_property_lease(row) for row in lease_rows],
        "prelease_lease_items": [_shape_property_lease(row) for row in prelease_lease_rows],
        "prior_prelease_lease_items": [_shape_property_lease(row) for row in prior_prelease_lease_rows],
        "conventional_lease_items": [_shape_property_lease(row) for row in conventional_lease_rows],
        "lead_60_day_items": [_shape_child_payload(row) for row in lead_60_day_rows],
        "event_60_day_items": [_shape_child_payload(row) for row in event_60_day_rows],
        "invoice_items": [_shape_child_payload(row) for row in invoice_rows],
        "availability_items": [],
        "latest_availability_date": availability_snapshot_date,
        "specials_snapshot": _shape_current_snapshot(
            specials_rows[0] if specials_rows else None,
            fallback_array_keys=("specials",),
        ),
        "availability_pricing_snapshot": availability_pricing_snapshot,
        "roi_daily_items": [_shape_roi_daily_row(row) for row in roi_rows],
        "counts": {
            "parent_docs": len(parent_rows),
            "lead_items": len(leads_rows),
            "event_items": len(events_rows),
            "lease_items": len(lease_rows),
            "prelease_lease_items": len(prelease_lease_rows),
            "prior_prelease_lease_items": len(prior_prelease_lease_rows),
            "conventional_lease_items": len(conventional_lease_rows),
            "lead_60_day_items": len(lead_60_day_rows),
            "event_60_day_items": len(event_60_day_rows),
            "invoice_items": len(invoice_rows),
            "availability_items": 0,
            "roi_daily_items": len(roi_rows),
        },
        "source": "supabase",
        "red_list_summary": red_list_summary,
        "student_prelease_cycle": {
            "cycle_start": prelease_cycle["cycle_start"].isoformat(),
            "fall_start": prelease_cycle["fall_start"].isoformat(),
            "fall_window_start": prelease_cycle["fall_window_start"].isoformat(),
            "fall_window_end": prelease_cycle["fall_window_end"].isoformat(),
            "prior_cycle_start": prelease_cycle["prior_cycle_start"].isoformat(),
            "prior_comparable_end": prelease_cycle["comparable_prior_end"].isoformat(),
            "prior_fall_window_start": prelease_cycle["prior_fall_window_start"].isoformat(),
            "prior_fall_window_end": prelease_cycle["prior_fall_window_end"].isoformat(),
        },
        "conventional_occupancy_window": {
            "window_start": conventional_window_start.isoformat(),
            "prior_week_date": conventional_prior_date.isoformat(),
            "forecast_date": conventional_forecast_date.isoformat(),
        },
        "staging_only": True,
    }


def get_property_reporting_overview_summary(
    property_id: str,
    start_date_value: str | None = None,
    end_date_value: str | None = None,
    access_token: str | None = None,
) -> dict[str, Any]:
    try:
        payload = get_property_reporting_overview_payload(property_id, start_date_value, end_date_value, access_token)
    except (HTTPError, URLError, SupabaseValidationConfigError) as error:
        return {
            "status": "error",
            "message": str(error),
            "staging_only": True,
        }

    payload["status"] = "ok"
    return payload


def get_multi_property_reporting_overview_summary(
    property_ids: list[str],
    start_date_value: str | None = None,
    end_date_value: str | None = None,
    access_token: str | None = None,
    red_list_only: bool = False,
) -> dict[str, Any]:
    normalized_property_ids = [str(property_id) for property_id in property_ids if str(property_id).strip()]
    if not normalized_property_ids:
        return {
            "status": "error",
            "message": "No property IDs were supplied for aggregation.",
            "staging_only": True,
        }

    if red_list_only:
        red_list_summaries: list[dict[str, Any]] = []
        property_errors: list[dict[str, str]] = []
        for property_id in normalized_property_ids:
            try:
                red_list_summaries.append(
                    get_property_red_list_summary(property_id, end_date_value, access_token)
                )
            except (HTTPError, URLError, SupabaseValidationConfigError) as error:
                property_errors.append({
                    "property_id": property_id,
                    "error": str(error),
                })

        return {
            "status": "ok" if red_list_summaries else "error",
            "property_id": "all",
            "property_ids": normalized_property_ids,
            "property_count": len(normalized_property_ids),
            "properties_loaded": len(red_list_summaries),
            "properties_failed": len(property_errors),
            "red_list_summaries": red_list_summaries,
            "red_list_properties": [summary for summary in red_list_summaries if summary.get("is_red_list")],
            "property_errors": property_errors,
            "source": "supabase",
            "aggregated": True,
            "red_list_only": True,
            "staging_only": True,
        }

    payloads: list[dict[str, Any]] = []
    property_errors: list[dict[str, str]] = []
    for property_id in normalized_property_ids:
        try:
            payloads.append(
                get_property_reporting_overview_payload(property_id, start_date_value, end_date_value, access_token)
            )
        except (HTTPError, URLError, SupabaseValidationConfigError) as error:
            property_errors.append({
                "property_id": property_id,
                "error": str(error),
            })

    if not payloads:
        return {
            "status": "error",
            "message": "Unable to load any property overview payloads for the requested aggregate.",
            "property_errors": property_errors,
            "staging_only": True,
        }

    first_payload = payloads[0]
    aggregated_parent_docs = _sort_activity_rows([
        doc
        for payload in payloads
        for doc in payload.get("parent_docs", [])
    ])
    aggregated_lead_items = _sort_activity_rows([
        item
        for payload in payloads
        for item in payload.get("lead_items", [])
    ])
    aggregated_event_items = _sort_activity_rows([
        item
        for payload in payloads
        for item in payload.get("event_items", [])
    ])
    aggregated_lease_items = _sort_activity_rows([
        item
        for payload in payloads
        for item in payload.get("lease_items", [])
    ])
    aggregated_prelease_lease_items = _sort_activity_rows([
        item
        for payload in payloads
        for item in payload.get("prelease_lease_items", [])
    ])
    aggregated_prior_prelease_lease_items = _sort_activity_rows([
        item
        for payload in payloads
        for item in payload.get("prior_prelease_lease_items", [])
    ])
    aggregated_conventional_lease_items = _sort_activity_rows([
        item
        for payload in payloads
        for item in payload.get("conventional_lease_items", [])
    ])
    aggregated_lead_60_day_items = _sort_activity_rows([
        item
        for payload in payloads
        for item in payload.get("lead_60_day_items", [])
    ])
    aggregated_event_60_day_items = _sort_activity_rows([
        item
        for payload in payloads
        for item in payload.get("event_60_day_items", [])
    ])
    aggregated_invoice_items = _sort_activity_rows([
        item
        for payload in payloads
        for item in payload.get("invoice_items", [])
    ])
    aggregated_roi_daily_items = _sort_activity_rows([
        item
        for payload in payloads
        for item in payload.get("roi_daily_items", [])
    ])
    latest_availability_date = max(
        (payload.get("latest_availability_date") for payload in payloads if payload.get("latest_availability_date")),
        default=None,
    )
    loaded_portfolios = sorted({payload.get("portfolio") or "student" for payload in payloads})
    aggregate_portfolio = loaded_portfolios[0] if len(loaded_portfolios) == 1 else "mixed"
    red_list_summaries = [
        summary
        for payload in payloads
        for summary in [payload.get("red_list_summary")]
        if isinstance(summary, dict)
    ]

    return {
        "status": "ok",
        "property_id": "all",
        "property_ids": normalized_property_ids,
        "portfolio": aggregate_portfolio,
        "property_count": len(normalized_property_ids),
        "properties_loaded": len(payloads),
        "properties_failed": len(property_errors),
        "range": first_payload.get("range", {}),
        "parent_docs": aggregated_parent_docs,
        "lead_items": aggregated_lead_items,
        "event_items": aggregated_event_items,
        "lease_items": aggregated_lease_items,
        "prelease_lease_items": aggregated_prelease_lease_items,
        "prior_prelease_lease_items": aggregated_prior_prelease_lease_items,
        "conventional_lease_items": aggregated_conventional_lease_items,
        "lead_60_day_items": aggregated_lead_60_day_items,
        "event_60_day_items": aggregated_event_60_day_items,
        "invoice_items": aggregated_invoice_items,
        "availability_items": [],
        "latest_availability_date": latest_availability_date,
        "specials_snapshot": None,
        "availability_pricing_snapshot": None,
        "roi_daily_items": aggregated_roi_daily_items,
        "counts": {
            "parent_docs": len(aggregated_parent_docs),
            "lead_items": len(aggregated_lead_items),
            "event_items": len(aggregated_event_items),
            "lease_items": len(aggregated_lease_items),
            "prelease_lease_items": len(aggregated_prelease_lease_items),
            "prior_prelease_lease_items": len(aggregated_prior_prelease_lease_items),
            "conventional_lease_items": len(aggregated_conventional_lease_items),
            "lead_60_day_items": len(aggregated_lead_60_day_items),
            "event_60_day_items": len(aggregated_event_60_day_items),
            "invoice_items": len(aggregated_invoice_items),
            "availability_items": 0,
            "roi_daily_items": len(aggregated_roi_daily_items),
            "properties": len(normalized_property_ids),
            "properties_loaded": len(payloads),
            "properties_failed": len(property_errors),
        },
        "property_errors": property_errors,
        "source": "supabase",
        "aggregated": True,
        "red_list_summaries": red_list_summaries,
        "red_list_properties": [summary for summary in red_list_summaries if summary.get("is_red_list")],
        "student_prelease_cycle": first_payload.get("student_prelease_cycle", {}),
        "conventional_occupancy_window": first_payload.get("conventional_occupancy_window", {}),
        "staging_only": True,
    }
