from __future__ import annotations

import calendar
from datetime import date, datetime, timedelta
from typing import Any
from urllib.error import HTTPError, URLError

from render_supabase_sync_state import _fetch_json
from render_supabase_validation import SupabaseValidationConfigError, _supabase_anon_headers


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

    invoice_start, invoice_end = _month_bounded_window(start_date, end_date)

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
            ("select", "property_id,floorplan_count,unit_count,availability_url,floorplans,units,last_synced_at,raw_result,firestore_path"),
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

    return {
        "property_id": property_id,
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
            "invoice_items": len(invoice_rows),
            "availability_items": 0,
            "roi_daily_items": len(roi_rows),
        },
        "source": "supabase",
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
) -> dict[str, Any]:
    normalized_property_ids = [str(property_id) for property_id in property_ids if str(property_id).strip()]
    if not normalized_property_ids:
        return {
            "status": "error",
            "message": "No property IDs were supplied for aggregation.",
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

    return {
        "status": "ok",
        "property_id": "all",
        "property_ids": normalized_property_ids,
        "property_count": len(normalized_property_ids),
        "properties_loaded": len(payloads),
        "properties_failed": len(property_errors),
        "range": first_payload.get("range", {}),
        "parent_docs": aggregated_parent_docs,
        "lead_items": aggregated_lead_items,
        "event_items": aggregated_event_items,
        "lease_items": aggregated_lease_items,
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
        "staging_only": True,
    }
