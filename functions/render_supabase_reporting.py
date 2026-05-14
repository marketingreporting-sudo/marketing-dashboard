from __future__ import annotations

import calendar
import re
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
_APPLICATION_KEY_CANDIDATES = (
    "application_id", "applicationId", "applicationID", "lease_interval_id",
    "leaseIntervalId", "lease_id", "leaseId", "applicantId", "applicantID",
    "prospectId", "prospectID", "eventId", "eventID", "id",
)
_CALL_PREP_PERIODS = (
    {"days": 7, "label": "Last 7 Days", "shortLabel": "7D"},
    {"days": 30, "label": "Last 30 Days", "shortLabel": "30D"},
    {"days": 60, "label": "Last 60 Days", "shortLabel": "60D"},
)
_CALL_PREP_METRIC_KEYS = (
    "leads",
    "applications",
    "leases",
    "leadToAppRate",
    "leadToLeaseRate",
    "appToLeaseRate",
    "totalMarketingSpend",
    "performanceMarketingSpend",
    "costPerLead",
    "costPerLease",
)
_PERFORMANCE_MARKETING_GL_CODES = {"5300-0030", "5300-0210"}
_ALL_MARKETING_GL_CODES = {
    "5300-0010",
    "5300-0030",
    "5300-0210",
    "5300-0320",
    "5300-0330",
    "5300-0400",
    "5300-0410",
}
_PERFORMANCE_MARKETING_DESCRIPTIONS = ("internet advertising", "ppc management fees")
_ALL_MARKETING_DESCRIPTIONS = (
    "general advertising & marketing",
    "internet advertising",
    "ppc management fees",
    "seo",
    "reputation management",
    "social media management",
    "website expense",
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


def _parse_currency_amount(value: Any) -> float:
    if value in (None, ""):
        return 0
    if isinstance(value, (int, float)):
        return float(value)
    cleaned = re.sub(r"[^0-9.\-]", "", str(value))
    if cleaned in ("", "-", ".", "-."):
        return 0
    try:
        return float(cleaned)
    except ValueError:
        return 0


def _collect_primitive_values(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, (str, int, float, bool)):
        return [str(value)]
    if isinstance(value, list):
        collected: list[str] = []
        for item in value:
            collected.extend(_collect_primitive_values(item))
        return collected
    if isinstance(value, dict):
        collected: list[str] = []
        for item in value.values():
            collected.extend(_collect_primitive_values(item))
        return collected
    return []


def _find_nested_value(value: Any, candidate_keys: tuple[str, ...]) -> Any:
    normalized = {key.lower() for key in candidate_keys}
    if isinstance(value, dict):
        for key, nested in value.items():
            if str(key).lower() in normalized and nested not in (None, ""):
                if isinstance(nested, (dict, list)):
                    nested_value = _find_nested_value(nested, candidate_keys)
                    if nested_value not in (None, ""):
                        return nested_value
                else:
                    return nested
        for nested in value.values():
            nested_value = _find_nested_value(nested, candidate_keys)
            if nested_value not in (None, ""):
                return nested_value
    elif isinstance(value, list):
        for nested in value:
            nested_value = _find_nested_value(nested, candidate_keys)
            if nested_value not in (None, ""):
                return nested_value
    return None


def _row_property_id(row: dict[str, Any]) -> str:
    payload = row.get("raw_data") if isinstance(row.get("raw_data"), dict) else {}
    return str(row.get("_propertyId") or row.get("property_id") or row.get("propertyId") or payload.get("_propertyId") or payload.get("property_id") or "")


def _item_matches_property(row: dict[str, Any], property_id: str | None) -> bool:
    return not property_id or _row_property_id(row) == str(property_id)


def _stable_key(row: dict[str, Any], candidates: tuple[str, ...]) -> str:
    payload = row.get("raw_data") if isinstance(row.get("raw_data"), dict) else row
    for key in candidates:
        value = row.get(key) if row.get(key) not in (None, "") else payload.get(key)
        if value not in (None, ""):
            return f"{_row_property_id(row)}:{value}"
    return f"{_row_property_id(row)}:{row.get('id') or row.get('firestore_path') or row.get('_firestorePath') or str(payload)}"


def _unique_count(rows: list[dict[str, Any]], candidates: tuple[str, ...]) -> int:
    return len({_stable_key(row, candidates) for row in rows})


def _event_type_id(row: dict[str, Any]) -> int | None:
    payload = row.get("raw_data") if isinstance(row.get("raw_data"), dict) else row
    candidates = [
        payload.get("typeId"),
        payload.get("type_id"),
        payload.get("eventTypeId"),
        payload.get("event_type_id"),
    ]
    for container_key in ("eventType", "event_type", "type"):
        value = payload.get(container_key)
        if isinstance(value, dict):
            candidates.extend([
                value.get("typeId"),
                value.get("type_id"),
                value.get("eventTypeId"),
                value.get("event_type_id"),
                value.get("id"),
            ])
    candidates.append(_find_nested_value(payload, ("typeId", "type_id", "eventTypeId", "event_type_id")))

    for value in candidates:
        try:
            if value not in (None, ""):
                return int(value)
        except (TypeError, ValueError):
            continue
    return None


def _event_reason(row: dict[str, Any]) -> str:
    payload = row.get("raw_data") if isinstance(row.get("raw_data"), dict) else row
    candidates: list[Any] = [
        payload.get("eventReason"),
        payload.get("event_reason"),
        payload.get("type") if isinstance(payload.get("type"), str) else None,
        payload.get("eventType") if isinstance(payload.get("eventType"), str) else None,
        payload.get("event_type") if isinstance(payload.get("event_type"), str) else None,
        payload.get("name"),
        _find_nested_value(payload.get("type"), ("eventReason", "event_reason", "name", "label", "description")),
        _find_nested_value(payload.get("eventType"), ("eventReason", "event_reason", "name", "label", "description")),
        _find_nested_value(payload.get("event_type"), ("eventReason", "event_reason", "name", "label", "description")),
    ]
    value = next((candidate for candidate in candidates if candidate not in (None, "")), "")
    return re.sub(r"\s+", " ", str(value).lower().replace(" :", ":").replace(": ", ":")).strip()


def _is_completed_application_event(row: dict[str, Any]) -> bool:
    type_id = _event_type_id(row)
    if type_id not in (None, 12):
        return False
    reason = _event_reason(row)
    return (
        "application status:completed" in reason
        or "application status completed" in reason
        or "application:completed" in reason
    )


def _is_approved_lease_event(row: dict[str, Any]) -> bool:
    type_id = _event_type_id(row)
    if type_id not in (None, 13):
        return False
    reason = _event_reason(row)
    return ("lease status:approved" in reason or "lease status approved" in reason) and "renewal lease" not in reason


def _date_value(row: dict[str, Any], key: str) -> date | None:
    value = row.get(key)
    if isinstance(value, date):
        return value
    return _parse_iso_date(str(value)) if value else None


def _parse_activity_date(value: Any) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if value in (None, ""):
        return None
    text = str(value).strip()
    token_match = re.search(r"\d{4}-\d{2}-\d{2}|\d{4}/\d{2}/\d{2}|\d{1,2}/\d{1,2}/\d{4}", text)
    if not token_match:
        return None
    token = token_match.group(0)
    if "/" in token:
        parts = token.split("/")
        if len(parts[0]) == 4:
            year, month, day = (int(part) for part in parts)
        else:
            month, day, year = (int(part) for part in parts)
        try:
            return date(year, month, day)
        except ValueError:
            return None
    return _parse_iso_date(token)


def _parse_analytics_date(value: Any) -> date | None:
    parsed = _parse_activity_date(value)
    if parsed:
        return parsed
    text = str(value or "").strip()
    if re.fullmatch(r"\d{8}", text):
        try:
            return date(int(text[:4]), int(text[4:6]), int(text[6:8]))
        except ValueError:
            return None
    return None


def _event_date(row: dict[str, Any]) -> date | None:
    payload = row.get("raw_data") if isinstance(row.get("raw_data"), dict) else row
    return _parse_activity_date(
        payload.get("eventDate")
        or payload.get("event_date")
        or payload.get("eventDateTime")
        or payload.get("eventDatetime")
        or payload.get("date")
        or payload.get("timestamp")
        or payload.get("createdAt")
        or payload.get("created_at")
        or row.get("_date")
        or row.get("activity_date")
    )


def _lease_approval_date(row: dict[str, Any]) -> date | None:
    payload = row.get("raw_data") if isinstance(row.get("raw_data"), dict) else row
    return _parse_activity_date(
        row.get("attribution_event_date")
        or row.get("_date")
        or payload.get("attribution_event_date")
        or _find_nested_value(payload, ("approvalDate", "approvedDate", "leaseApprovedDate", "leaseSignedDate", "signedDate", "eventDate", "date"))
    )


def _has_application_identifier(row: dict[str, Any]) -> bool:
    payload = row.get("raw_data") if isinstance(row.get("raw_data"), dict) else row
    return any(payload.get(key) not in (None, "") or row.get(key) not in (None, "") for key in ("application_id", "applicationId", "applicationID"))


def _safe_rate(numerator: float, denominator: float) -> float | None:
    denominator_value = float(denominator or 0)
    if denominator_value <= 0:
        return None
    return float(numerator or 0) / denominator_value


def _percent_change(current: float | None, previous: float | None) -> float | None:
    current_value = float(current or 0)
    previous_value = float(previous or 0)
    if previous_value == 0:
        return 0 if current_value == 0 else None
    return (current_value - previous_value) / previous_value


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


def _compact_lead_payload(row: dict[str, Any]) -> dict[str, Any]:
    payload = row.get("raw_data") if isinstance(row.get("raw_data"), dict) else {}
    compact = {
        "_date": row.get("activity_date"),
        "_parentId": row.get("property_snapshot_id"),
        "_propertyId": row.get("property_id"),
        "id": row.get("id"),
    }
    for key in (
        "leadEventId", "eventId", "eventID", "leadId", "leadID", "prospectId",
        "prospectID", "customerId", "customerID", "applicationId", "leadSource",
        "internetListingService",
    ):
        if payload.get(key) not in (None, ""):
            compact[key] = payload.get(key)
    return compact


def _compact_event_payload(row: dict[str, Any]) -> dict[str, Any]:
    payload = row.get("raw_data") if isinstance(row.get("raw_data"), dict) else {}
    compact = {
        "_date": row.get("activity_date"),
        "_parentId": row.get("property_snapshot_id"),
        "_propertyId": row.get("property_id"),
        "id": row.get("id"),
    }
    for key in (
        "typeId", "type_id", "eventTypeId", "event_type_id", "eventReason",
        "type", "name", "eventDate", "event_date", "eventDateTime",
        "eventDatetime", "date", "timestamp", "createdAt", "created_at",
        "application_id", "applicationId", "applicationID", "lease_interval_id",
        "leaseIntervalId", "lease_id", "leaseId", "leaseID", "applicantId",
        "applicantID", "prospectId", "prospectID", "eventId", "eventID",
    ):
        if payload.get(key) not in (None, ""):
            compact[key] = payload.get(key)
    return compact


def _compact_invoice_payload(row: dict[str, Any]) -> dict[str, Any]:
    payload = row.get("raw_data") if isinstance(row.get("raw_data"), dict) else {}
    compact = {
        "_date": row.get("activity_date"),
        "_parentId": row.get("property_snapshot_id"),
        "_propertyId": row.get("property_id"),
        "id": row.get("id"),
    }
    for key in (
        "@attributes", "apDetailId", "reference", "memo", "debit", "credit",
        "totalAmount", "amount", "invoiceAmount", "total", "amountDue",
        "total_due", "currentAmount", "postDate", "transactionDate",
        "invoiceDate", "postMonth", "glAccount", "vendorName", "contract",
        "vendorCode", "description", "accountName", "accountNumber",
    ):
        if payload.get(key) not in (None, ""):
            compact[key] = payload.get(key)
    return compact


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


def _invoice_gl_codes(invoice: dict[str, Any]) -> list[str]:
    search_space = " ".join(_collect_primitive_values(invoice))
    compact_matches = re.findall(r"\b\d{4}-\d{4}\b", search_space)
    spaced_matches = re.findall(r"\b\d{4}\s+\d{4}\b", search_space)
    codes = [*compact_matches, *(value.replace(" ", "-") for value in spaced_matches)]
    return list(dict.fromkeys(codes))


def _invoice_has_classification(invoice: dict[str, Any], allowed_codes: set[str], allowed_descriptions: tuple[str, ...]) -> bool:
    if any(code in allowed_codes for code in _invoice_gl_codes(invoice)):
        return True
    search_space = " ".join(_collect_primitive_values(invoice)).lower()
    return any(description in search_space for description in allowed_descriptions)


def _invoice_amount(invoice: dict[str, Any]) -> float:
    detail_amounts = [
        abs(_parse_currency_amount(invoice.get("debit"))),
        abs(_parse_currency_amount(invoice.get("credit"))),
    ]
    detail_amounts = [amount for amount in detail_amounts if amount != 0]
    if detail_amounts:
        return max(detail_amounts)
    for key in ("totalAmount", "amount", "invoiceAmount", "total", "amountDue", "total_due", "currentAmount"):
        amount = abs(_parse_currency_amount(invoice.get(key)))
        if amount != 0:
            return amount
    return 0


def _invoice_effective_date(invoice: dict[str, Any]) -> date | None:
    return (
        _parse_activity_date(invoice.get("postDate"))
        or _parse_activity_date(invoice.get("transactionDate"))
        or _parse_activity_date(invoice.get("invoiceDate"))
        or _parse_activity_date(invoice.get("_date"))
        or _parse_activity_date(invoice.get("activity_date"))
    )


def _invoice_key(invoice: dict[str, Any]) -> str:
    attrs = invoice.get("@attributes") if isinstance(invoice.get("@attributes"), dict) else {}
    candidates = [
        attrs.get("id"),
        invoice.get("id"),
        invoice.get("apDetailId"),
        invoice.get("reference"),
        invoice.get("memo"),
    ]
    stable_id = next((value for value in candidates if value not in (None, "")), None)
    return f"{_row_property_id(invoice)}:{stable_id or str(invoice)}"


def _invoice_allocation_month(invoice: dict[str, Any]) -> tuple[date, date] | None:
    post_month = str(invoice.get("postMonth") or "").strip()
    if post_month:
        for pattern in ("%B %Y", "%b %Y", "%Y-%m"):
            try:
                parsed = datetime.strptime(post_month, pattern).date()
                month_start = parsed.replace(day=1)
                month_end = parsed.replace(day=calendar.monthrange(parsed.year, parsed.month)[1])
                return month_start, month_end
            except ValueError:
                continue
    effective = _invoice_effective_date(invoice)
    if not effective:
        return None
    month_start = effective.replace(day=1)
    month_end = effective.replace(day=calendar.monthrange(effective.year, effective.month)[1])
    return month_start, month_end


def _allocated_invoice_amount(invoice: dict[str, Any], start_date: date, end_date: date) -> float:
    allocation = _invoice_allocation_month(invoice)
    if not allocation:
        effective = _invoice_effective_date(invoice)
        return _invoice_amount(invoice) if effective and start_date <= effective <= end_date else 0
    month_start, month_end = allocation
    overlap_start = max(month_start, start_date)
    overlap_end = min(month_end, end_date)
    if overlap_start > overlap_end:
        return 0
    month_days = (month_end - month_start).days + 1
    overlap_days = (overlap_end - overlap_start).days + 1
    return _invoice_amount(invoice) * (overlap_days / month_days)


def _invoice_breakdown_label(invoice: dict[str, Any]) -> str:
    gl_account = invoice.get("glAccount") if isinstance(invoice.get("glAccount"), dict) else {}
    account_number = gl_account.get("accountNumber") or invoice.get("accountNumber")
    account_name = gl_account.get("accountName") or invoice.get("accountName")
    vendor_name = invoice.get("vendorName") or invoice.get("contract") or invoice.get("vendorCode")
    parts = [part for part in (account_number, account_name, vendor_name) if part]
    return " - ".join(str(part) for part in parts) or "Marketing Spend"


def _marketing_invoices(invoice_items: list[dict[str, Any]], property_id: str | None = None) -> list[dict[str, Any]]:
    unique: dict[str, dict[str, Any]] = {}
    for invoice in invoice_items:
        if not _item_matches_property(invoice, property_id):
            continue
        if not _invoice_has_classification(invoice, _ALL_MARKETING_GL_CODES, _ALL_MARKETING_DESCRIPTIONS):
            continue
        key = _invoice_key(invoice)
        existing = unique.get(key)
        if not existing:
            unique[key] = invoice
            continue
        effective = _invoice_effective_date(invoice)
        existing_effective = _invoice_effective_date(existing)
        if effective and existing_effective and effective < existing_effective:
            unique[key] = invoice
    return list(unique.values())


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


def _postgrest_in_filter(values: list[str]) -> str:
    encoded_values = []
    for value in values:
        text = str(value).strip()
        if re.fullmatch(r"[A-Za-z0-9_.:-]+", text):
            encoded_values.append(text)
        else:
            encoded_values.append(f'"{text.replace(chr(34), chr(92) + chr(34))}"')
    return f"in.({','.join(encoded_values)})"


def _fetch_call_prep_pages(
    table_name: str,
    query_params: list[tuple[str, str]],
    *,
    headers: dict[str, str],
    page_size: int = 1000,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        page = _fetch_json(
            table_name,
            [
                *query_params,
                ("limit", str(page_size)),
                ("offset", str(offset)),
            ],
            headers=headers,
        )
        rows.extend(page)
        if len(page) < page_size:
            break
        offset += page_size
    return rows


def _increment_call_prep_row_count(property_row_counts: dict[str, dict[str, int]], row: dict[str, Any], key: str) -> None:
    property_id = str(row.get("property_id") or "")
    if not property_id:
        return
    row_counts = property_row_counts.setdefault(
        property_id,
        {
            "lead_items": 0,
            "event_items": 0,
            "lease_items": 0,
            "invoice_items": 0,
        },
    )
    row_counts[key] = row_counts.get(key, 0) + 1


def get_multi_property_call_prep_summary(
    property_ids: list[str],
    start_date_value: str | None = None,
    end_date_value: str | None = None,
    access_token: str | None = None,
) -> dict[str, Any]:
    normalized_property_ids = [str(property_id) for property_id in property_ids if str(property_id).strip()]
    if not normalized_property_ids:
        return {
            "status": "error",
            "message": "No property IDs were supplied for call prep aggregation.",
            "staging_only": True,
        }

    headers = _supabase_anon_headers(access_token)
    start_date = _parse_iso_date(start_date_value)
    end_date = _parse_iso_date(end_date_value)
    if not start_date or not end_date:
        start_date, end_date = _default_date_window()
    if start_date > end_date:
        start_date, end_date = end_date, start_date
    invoice_start, invoice_end = _month_bounded_window(start_date, end_date)

    lead_items: list[dict[str, Any]] = []
    event_items: list[dict[str, Any]] = []
    lease_items: list[dict[str, Any]] = []
    invoice_items: list[dict[str, Any]] = []
    property_errors: list[dict[str, str]] = []
    loaded_property_ids: list[str] = list(normalized_property_ids)
    property_row_counts: dict[str, dict[str, int]] = {
        str(property_id): {
            "lead_items": 0,
            "event_items": 0,
            "lease_items": 0,
            "invoice_items": 0,
        }
        for property_id in normalized_property_ids
    }

    property_filter = _postgrest_in_filter(normalized_property_ids)
    try:
        leads_rows = _fetch_call_prep_pages(
            "property_leads",
            [
                ("select", "property_snapshot_id,property_id,activity_date,raw_data"),
                ("property_id", property_filter),
                ("activity_date", f"gte.{start_date.isoformat()}"),
                ("activity_date", f"lte.{end_date.isoformat()}"),
                ("order", "property_id.asc"),
                ("order", "activity_date.asc"),
            ],
            headers=headers,
        )
        events_rows = _fetch_call_prep_pages(
            "property_events",
            [
                ("select", "property_snapshot_id,property_id,activity_date,raw_data"),
                ("property_id", property_filter),
                ("activity_date", f"gte.{start_date.isoformat()}"),
                ("activity_date", f"lte.{end_date.isoformat()}"),
                ("order", "property_id.asc"),
                ("order", "activity_date.asc"),
            ],
            headers=headers,
        )
        lease_rows = _fetch_call_prep_pages(
            "property_leases",
            [
                (
                    "select",
                    "id,property_id,reporting_window_start,reporting_window_end,attribution_status,"
                    "attribution_event_date,lease_start_date,lease_end_date,move_in_date,move_out_date,"
                    "gross_lease_value,net_effective_rent,net_effective_revenue,concession_total,raw_data,firestore_path",
                ),
                ("property_id", property_filter),
                ("reporting_window_end", f"gte.{start_date.isoformat()}"),
                ("reporting_window_start", f"lte.{end_date.isoformat()}"),
                ("order", "property_id.asc"),
                ("order", "attribution_event_date.asc"),
            ],
            headers=headers,
        )
        invoices_rows = _fetch_call_prep_pages(
            "property_invoices",
            [
                ("select", "property_snapshot_id,property_id,activity_date,raw_data"),
                ("property_id", property_filter),
                ("activity_date", f"gte.{invoice_start.isoformat()}"),
                ("activity_date", f"lte.{invoice_end.isoformat()}"),
                ("order", "property_id.asc"),
                ("order", "activity_date.asc"),
            ],
            headers=headers,
        )
    except (HTTPError, URLError, SupabaseValidationConfigError) as error:
        property_errors = [{"property_id": property_id, "error": str(error)} for property_id in normalized_property_ids]
        loaded_property_ids = []
        leads_rows = []
        events_rows = []
        lease_rows = []
        invoices_rows = []

    for row in leads_rows:
        _increment_call_prep_row_count(property_row_counts, row, "lead_items")
    for row in events_rows:
        _increment_call_prep_row_count(property_row_counts, row, "event_items")
    for row in lease_rows:
        _increment_call_prep_row_count(property_row_counts, row, "lease_items")
    for row in invoices_rows:
        _increment_call_prep_row_count(property_row_counts, row, "invoice_items")

    lead_items.extend(_compact_lead_payload(row) for row in leads_rows)
    event_items.extend(_compact_event_payload(row) for row in events_rows)
    lease_items.extend(_shape_property_lease(row) for row in lease_rows)
    invoice_items.extend(_compact_invoice_payload(row) for row in invoices_rows)

    if not lead_items and not event_items and not lease_items and not invoice_items and property_errors:
        return {
            "status": "error",
            "message": "Unable to load any property data for call prep aggregation.",
            "property_errors": property_errors,
            "staging_only": True,
        }

    return {
        "status": "ok",
        "property_id": "all",
        "property_ids": normalized_property_ids,
        "property_count": len(normalized_property_ids),
        "properties_loaded": len(loaded_property_ids),
        "properties_failed": len(property_errors),
        "loaded_property_ids": loaded_property_ids,
        "property_row_counts": property_row_counts,
        "range": {
            "start_date": start_date.isoformat(),
            "end_date": end_date.isoformat(),
            "invoice_start_date": invoice_start.isoformat(),
            "invoice_end_date": invoice_end.isoformat(),
        },
        "lead_items": lead_items,
        "event_items": event_items,
        "lease_items": lease_items,
        "invoice_items": invoice_items,
        "counts": {
            "lead_items": len(lead_items),
            "event_items": len(event_items),
            "lease_items": len(lease_items),
            "invoice_items": len(invoice_items),
            "properties": len(normalized_property_ids),
            "properties_loaded": len(loaded_property_ids),
            "properties_failed": len(property_errors),
        },
        "property_errors": property_errors,
        "source": "supabase",
        "aggregated": True,
        "call_prep_only": True,
        "staging_only": True,
    }


def _call_prep_range(end_date: date, days: int, *, offset_days: int = 0) -> tuple[date, date]:
    current_end = end_date - timedelta(days=offset_days)
    current_start = current_end - timedelta(days=days - 1)
    return current_start, current_end


def _prior_call_prep_range(current_start: date, days: int) -> tuple[date, date]:
    prior_end = current_start - timedelta(days=1)
    prior_start = prior_end - timedelta(days=days - 1)
    return prior_start, prior_end


def _call_prep_metric_value(metrics: dict[str, Any], key: str) -> float | int | None:
    return metrics.get(key)


def _build_call_prep_metrics(payload: dict[str, Any], start_date: date, end_date: date, property_id: str | None = None) -> dict[str, Any]:
    lead_rows = [
        lead
        for lead in payload.get("lead_items", [])
        if _item_matches_property(lead, property_id)
        and (lead_date := _parse_activity_date(lead.get("_date") or lead.get("activity_date") or lead.get("date")))
        and start_date <= lead_date <= end_date
    ]

    canonical_leads: dict[str, dict[str, Any]] = {}
    for lead in lead_rows:
        key = _stable_key(lead, _LEAD_KEY_CANDIDATES)
        existing = canonical_leads.get(key)
        if not existing or str(lead.get("_date") or "") < str(existing.get("_date") or "9999-12-31"):
            canonical_leads[key] = lead
    leads = list(canonical_leads.values())

    application_records: dict[str, dict[str, Any]] = {}
    lease_records: dict[str, dict[str, Any]] = {}
    for event in payload.get("event_items", []):
        if not _item_matches_property(event, property_id):
            continue
        event_date = _event_date(event)
        if not event_date or event_date < start_date or event_date > end_date:
            continue
        if _is_completed_application_event(event):
            key = _stable_key(event, _APPLICATION_KEY_CANDIDATES)
            existing = application_records.get(key)
            if not existing or event_date < existing["date"]:
                application_records[key] = {"date": event_date, "item": event}
        if _is_approved_lease_event(event):
            key = _stable_key(event, _LEASE_KEY_CANDIDATES)
            existing = lease_records.get(key)
            if not existing or event_date < existing["date"]:
                lease_records[key] = {"date": event_date, "item": event}

    for lease in payload.get("lease_items", []):
        if not _item_matches_property(lease, property_id):
            continue
        approval_date = _lease_approval_date(lease)
        if not approval_date or approval_date < start_date or approval_date > end_date:
            continue
        key = _stable_key(lease, _LEASE_KEY_CANDIDATES)
        existing = lease_records.get(key)
        if not existing or approval_date < existing["date"]:
            lease_records[key] = {"date": approval_date, "item": lease}

    if not application_records:
        for record in [*lead_rows, *payload.get("lease_items", [])]:
            if not _item_matches_property(record, property_id) or not _has_application_identifier(record):
                continue
            application_date = (
                _event_date(record)
                or _parse_activity_date(record.get("_date"))
                or _parse_activity_date(record.get("activity_date"))
                or _lease_approval_date(record)
            )
            if not application_date or application_date < start_date or application_date > end_date:
                continue
            key = _stable_key(record, _APPLICATION_KEY_CANDIDATES)
            existing = application_records.get(key)
            if not existing or application_date < existing["date"]:
                application_records[key] = {"date": application_date, "item": record}

    marketing_invoices = _marketing_invoices(payload.get("invoice_items", []), property_id)
    performance_invoices = [
        invoice
        for invoice in marketing_invoices
        if _invoice_has_classification(invoice, _PERFORMANCE_MARKETING_GL_CODES, _PERFORMANCE_MARKETING_DESCRIPTIONS)
    ]
    total_marketing_spend = sum(_allocated_invoice_amount(invoice, start_date, end_date) for invoice in marketing_invoices)
    performance_marketing_spend = sum(_allocated_invoice_amount(invoice, start_date, end_date) for invoice in performance_invoices)

    lead_count = len(leads)
    application_count = len(application_records)
    lease_count = len(lease_records)
    source_counts: dict[str, int] = {}
    for lead in leads:
        source = str(lead.get("leadSource") or lead.get("internetListingService") or "Unknown")
        source_counts[source] = source_counts.get(source, 0) + 1

    return {
        "leads": lead_count,
        "applications": application_count,
        "leases": lease_count,
        "leadToAppRate": _safe_rate(application_count, lead_count),
        "leadToLeaseRate": _safe_rate(lease_count, lead_count),
        "appToLeaseRate": _safe_rate(lease_count, application_count),
        "totalMarketingSpend": total_marketing_spend,
        "performanceMarketingSpend": performance_marketing_spend,
        "costPerLead": total_marketing_spend / lead_count if lead_count > 0 and total_marketing_spend > 0 else None,
        "costPerLease": total_marketing_spend / lease_count if lease_count > 0 and total_marketing_spend > 0 else None,
        "sourceBreakdown": [
            {
                "source": source,
                "leads": count,
                "share": _safe_rate(count, lead_count),
            }
            for source, count in sorted(source_counts.items(), key=lambda item: item[1], reverse=True)[:6]
        ],
        "dataQuality": {
            "leadRows": len(lead_rows),
            "eventRows": len(payload.get("event_items", [])),
            "leaseRows": len(payload.get("lease_items", [])),
            "invoiceRows": len(payload.get("invoice_items", [])),
            "applicationFallbackUsed": application_count > 0 and not any(_is_completed_application_event(event) for event in payload.get("event_items", [])),
            "leaseFallbackAvailable": bool(payload.get("lease_items")),
        },
    }


def _call_prep_source_counts(payload: dict[str, Any], property_id: str) -> dict[str, int]:
    lead_rows = [lead for lead in payload.get("lead_items", []) if _item_matches_property(lead, property_id)]
    event_rows = [event for event in payload.get("event_items", []) if _item_matches_property(event, property_id)]
    lease_rows = [lease for lease in payload.get("lease_items", []) if _item_matches_property(lease, property_id)]
    invoice_rows = [invoice for invoice in payload.get("invoice_items", []) if _item_matches_property(invoice, property_id)]
    application_identifier_rows = [
        row
        for row in [*lead_rows, *event_rows, *lease_rows]
        if _has_application_identifier(row)
    ]
    return {
        "leadRows": len(lead_rows),
        "eventRows": len(event_rows),
        "leaseRows": len(lease_rows),
        "invoiceRows": len(invoice_rows),
        "applicationIdentifierRows": len(application_identifier_rows),
        "marketingInvoiceRows": len(_marketing_invoices(payload.get("invoice_items", []), property_id)),
    }


def _call_prep_has_metric_source(metric_key: str, source_counts: dict[str, int], metrics: dict[str, Any]) -> bool:
    has_lead_source = source_counts.get("leadRows", 0) > 0
    has_application_source = (
        source_counts.get("eventRows", 0) > 0
        or source_counts.get("leaseRows", 0) > 0
        or source_counts.get("applicationIdentifierRows", 0) > 0
    )
    has_lease_source = source_counts.get("eventRows", 0) > 0 or source_counts.get("leaseRows", 0) > 0
    has_spend_source = source_counts.get("marketingInvoiceRows", 0) > 0
    lead_count = float(metrics.get("leads") or 0)
    application_count = float(metrics.get("applications") or 0)
    lease_count = float(metrics.get("leases") or 0)

    if metric_key == "leads":
        return has_lead_source
    if metric_key == "applications":
        return has_application_source
    if metric_key == "leases":
        return has_lease_source
    if metric_key == "leadToAppRate":
        return has_lead_source and has_application_source and lead_count > 0
    if metric_key == "leadToLeaseRate":
        return has_lead_source and has_lease_source and lead_count > 0
    if metric_key == "appToLeaseRate":
        return has_application_source and has_lease_source and application_count > 0
    if metric_key in ("totalMarketingSpend", "performanceMarketingSpend"):
        return has_spend_source
    if metric_key == "costPerLead":
        return has_spend_source and has_lead_source and lead_count > 0
    if metric_key == "costPerLease":
        return has_spend_source and has_lease_source and lease_count > 0
    return any(value > 0 for value in source_counts.values())


def _average_call_prep_metrics(payload: dict[str, Any], start_date: date, end_date: date, property_ids: list[str], selected_property_id: str) -> dict[str, Any] | None:
    comparison_ids = [str(property_id) for property_id in property_ids if str(property_id) and str(property_id) != str(selected_property_id)]
    if not comparison_ids:
        return None

    loaded_property_ids = [str(property_id) for property_id in payload.get("loaded_property_ids", []) if str(property_id)]
    loaded_lookup = set(loaded_property_ids)
    loaded_comparison_ids = [
        property_id
        for property_id in comparison_ids
        if not loaded_lookup or property_id in loaded_lookup
    ]
    unloaded_property_ids = [
        property_id
        for property_id in comparison_ids
        if loaded_lookup and property_id not in loaded_lookup
    ]

    metric_records = []
    for property_id in loaded_comparison_ids:
        metrics = _build_call_prep_metrics(payload, start_date, end_date, property_id)
        source_counts = _call_prep_source_counts(payload, property_id)
        has_any_data = any(
            source_counts.get(key, 0) > 0
            for key in ("leadRows", "eventRows", "leaseRows", "marketingInvoiceRows")
        )
        metric_records.append({
            "propertyId": property_id,
            "metrics": metrics,
            "sourceCounts": source_counts,
            "hasAnyData": has_any_data,
        })

    def average_metric(key: str) -> float | None:
        values = [
            _call_prep_metric_value(record["metrics"], key)
            for record in metric_records
            if record["hasAnyData"]
            and _call_prep_has_metric_source(key, record["sourceCounts"], record["metrics"])
            and _call_prep_metric_value(record["metrics"], key) is not None
        ]
        return sum(float(value) for value in values) / len(values) if values else None

    metric_sample_sizes = {
        key: sum(
            1
            for record in metric_records
            if record["hasAnyData"]
            and _call_prep_has_metric_source(key, record["sourceCounts"], record["metrics"])
            and _call_prep_metric_value(record["metrics"], key) is not None
        )
        for key in _CALL_PREP_METRIC_KEYS
    }
    no_data_property_ids = [record["propertyId"] for record in metric_records if not record["hasAnyData"]]

    return {
        "propertyCount": len(comparison_ids),
        "propertiesLoaded": len(loaded_comparison_ids),
        "portfolioSampleSize": sum(1 for record in metric_records if record["hasAnyData"]),
        "metricSampleSizes": metric_sample_sizes,
        "loadedPropertyIds": loaded_comparison_ids,
        "excludedPropertyIds": [*unloaded_property_ids, *no_data_property_ids],
        "noDataPropertyIds": no_data_property_ids,
        "leads": average_metric("leads"),
        "applications": average_metric("applications"),
        "leases": average_metric("leases"),
        "leadToAppRate": average_metric("leadToAppRate"),
        "leadToLeaseRate": average_metric("leadToLeaseRate"),
        "appToLeaseRate": average_metric("appToLeaseRate"),
        "totalMarketingSpend": average_metric("totalMarketingSpend"),
        "performanceMarketingSpend": average_metric("performanceMarketingSpend"),
        "costPerLead": average_metric("costPerLead"),
        "costPerLease": average_metric("costPerLease"),
    }


def _build_call_prep_spend_rows(payload: dict[str, Any], start_date: date, end_date: date, property_id: str) -> list[dict[str, Any]]:
    grouped: dict[str, dict[str, Any]] = {}
    for invoice in _marketing_invoices(payload.get("invoice_items", []), property_id):
        allocation = _invoice_allocation_month(invoice)
        if not allocation:
            continue
        month_start, month_end = allocation
        if month_end < start_date or month_start > end_date:
            continue
        label = _invoice_breakdown_label(invoice)
        key = f"{month_start.isoformat()}:{label}"
        row = grouped.setdefault(
            key,
            {
                "key": key,
                "month": month_start.isoformat(),
                "label": label,
                "glCodes": ", ".join(_invoice_gl_codes(invoice)),
                "amount": 0,
                "allocatedInWindow": 0,
            },
        )
        row["amount"] += _invoice_amount(invoice)
        row["allocatedInWindow"] += _allocated_invoice_amount(invoice, start_date, end_date)

    return sorted(grouped.values(), key=lambda item: (item["month"], item["amount"]), reverse=True)[:12]


def _fetch_call_prep_budget(property_id: str, as_of_date: date, headers: dict[str, str]) -> dict[str, Any]:
    try:
        rows = _fetch_json(
            "property_marketing_budget_items",
            [
                ("select", "id,property_id,status,item_name,monthly_amount,start_date,end_date,listing_url,contract_file_name,contract_storage_path,contract_mime_type,notes,created_at,updated_at"),
                ("property_id", f"eq.{property_id}"),
                ("order", "start_date.desc,updated_at.desc"),
            ],
            headers=headers,
        )
    except (HTTPError, URLError, SupabaseValidationConfigError) as error:
        return {"items": [], "activeItems": [], "activeApprovedMonthly": 0, "error": str(error)}

    items: list[dict[str, Any]] = []
    active_items: list[dict[str, Any]] = []
    for row in rows:
        item = {
            "id": row.get("id") or "",
            "propertyId": str(row.get("property_id") or ""),
            "status": row.get("status") or "new",
            "itemName": row.get("item_name") or "",
            "monthlyAmount": _safe_number(row.get("monthly_amount"), 0),
            "startDate": row.get("start_date") or "",
            "endDate": row.get("end_date") or "",
            "listingUrl": row.get("listing_url") or "",
            "contractFileName": row.get("contract_file_name") or "",
            "contractStoragePath": row.get("contract_storage_path") or "",
            "contractMimeType": row.get("contract_mime_type") or "",
            "notes": row.get("notes") or "",
            "createdAt": row.get("created_at") or "",
            "updatedAt": row.get("updated_at") or "",
        }
        items.append(item)
        start = _parse_activity_date(item["startDate"])
        end = _parse_activity_date(item["endDate"])
        if item["status"] == "active" and start and start <= as_of_date and (not end or end >= as_of_date):
            active_items.append(item)

    active_total = sum(item["monthlyAmount"] for item in active_items)
    return {
        "items": items,
        "activeItems": active_items,
        "activeApprovedMonthly": active_total,
        "activeItemCount": len(active_items),
    }


def _task_touched_in_range(task: dict[str, Any], start_date: date, end_date: date) -> bool:
    for key in ("created_at", "updated_at", "due_date"):
        value = _parse_activity_date(task.get(key))
        if value and start_date <= value <= end_date:
            return True
    return False


def _build_task_talking_point(task: dict[str, Any]) -> str:
    status = str(task.get("status") or "new")
    title = task.get("title") or "Task"
    summary = task.get("description") or task.get("notes") or title
    if status == "complete":
        return f"{title} has been completed. Client-ready note: {summary}"
    if status == "approved":
        return f"{title} is approved and ready to discuss as an active or recently approved change. Client-ready note: {summary}"
    if status == "in_progress":
        return f"{title} is currently in progress. Client-ready note: {summary}"
    return f"{title} is currently {status.replace('_', ' ')}. Client-ready note: {summary}"


def _fetch_call_prep_tasks(property_id: str, start_date: date, end_date: date, headers: dict[str, str]) -> dict[str, Any]:
    try:
        rows = _fetch_json(
            "user_tasks",
            [
                ("select", "id,owner_user_id,property_id,title,description,notes,due_date,status,created_at,updated_at"),
                ("property_id", f"eq.{property_id}"),
                ("order", "updated_at.desc"),
            ],
            headers=headers,
        )
    except (HTTPError, URLError, SupabaseValidationConfigError) as error:
        return {"items": [], "error": str(error)}

    items = []
    for row in rows:
        if not _task_touched_in_range(row, start_date, end_date):
            continue
        task = {
            "id": row.get("id") or "",
            "ownerUserId": row.get("owner_user_id") or "",
            "propertyId": str(row.get("property_id") or ""),
            "title": row.get("title") or "",
            "description": row.get("description") or "",
            "notes": row.get("notes") or "",
            "dueDate": row.get("due_date") or "",
            "status": row.get("status") or "new",
            "createdAt": row.get("created_at") or "",
            "updatedAt": row.get("updated_at") or "",
        }
        task["talkingPoint"] = _build_task_talking_point(row)
        items.append(task)

    items.sort(key=lambda item: str(item.get("updatedAt") or item.get("createdAt") or ""), reverse=True)
    return {"items": items[:8]}


def _analytics_rows_for_range(rows: list[dict[str, Any]], start_date: date, end_date: date) -> list[dict[str, Any]]:
    return [
        row
        for row in rows
        if (row_date := _parse_analytics_date(row.get("date")))
        and start_date <= row_date <= end_date
    ]


def _google_ads_daily_totals(rows: list[dict[str, Any]]) -> dict[str, Any]:
    impressions = sum(int(_safe_number(row.get("impressions"), 0)) for row in rows)
    clicks = sum(int(_safe_number(row.get("clicks"), 0)) for row in rows)
    conversions = sum(_safe_number(row.get("conversions"), 0) for row in rows)
    cost = sum(_safe_number(row.get("cost"), 0) for row in rows)
    return {
        "impressions": impressions,
        "clicks": clicks,
        "conversions": round(conversions, 2),
        "cost": round(cost, 2),
        "ctr": round(clicks / impressions, 4) if impressions > 0 else None,
        "avgCpc": round(cost / clicks, 2) if clicks > 0 else None,
        "conversionRate": round(conversions / clicks, 4) if clicks > 0 else None,
        "searchImpressionShare": None,
    }


def _derive_google_ads_call_prep_window(
    payload: dict[str, Any] | None,
    current_start: date,
    current_end: date,
    prior_start: date,
    prior_end: date,
) -> dict[str, Any] | None:
    if not payload:
        return None
    daily_rows = payload.get("Ads", {}).get("dailyPerformance") or []
    current_rows = _analytics_rows_for_range(daily_rows, current_start, current_end)
    prior_rows = _analytics_rows_for_range(daily_rows, prior_start, prior_end)
    if not current_rows and not prior_rows:
        return {
            **payload,
            "callPrepWindow": {
                "mode": "cached_snapshot_fallback",
                "currentRange": {"startDate": current_start.isoformat(), "endDate": current_end.isoformat()},
                "priorRange": {"startDate": prior_start.isoformat(), "endDate": prior_end.isoformat()},
                "note": "Cached Google Ads daily rows did not cover this call prep window, so the stored dashboard snapshot is shown.",
            },
        }

    current = _google_ads_daily_totals(current_rows)
    prior = _google_ads_daily_totals(prior_rows)
    return {
        **payload,
        "window": {
            "days": (current_end - current_start).days + 1,
            "current": {"startDate": current_start.isoformat(), "endDate": current_end.isoformat()},
            "previous": {"startDate": prior_start.isoformat(), "endDate": prior_end.isoformat()},
        },
        "Overview": {
            "current": current,
            "previous": prior,
            "delta": {
                "clicks": _percent_change(current.get("clicks"), prior.get("clicks")),
                "conversions": _percent_change(current.get("conversions"), prior.get("conversions")),
                "cost": _percent_change(current.get("cost"), prior.get("cost")),
            },
        },
        "Ads": {
            **(payload.get("Ads") or {}),
            "dailyPerformance": current_rows,
        },
        "callPrepWindow": {
            "mode": "derived_from_cached_daily_rows",
            "currentDailyRows": len(current_rows),
            "priorDailyRows": len(prior_rows),
        },
    }


def _ga4_daily_totals(rows: list[dict[str, Any]]) -> dict[str, Any]:
    sessions = sum(_safe_number(row.get("sessions"), 0) for row in rows)
    key_events = sum(_safe_number(row.get("keyEvents"), 0) for row in rows)
    return {
        "sessions": int(sessions),
        "keyEvents": key_events,
    }


def _derive_ga4_call_prep_window(
    payload: dict[str, Any] | None,
    current_start: date,
    current_end: date,
    prior_start: date,
    prior_end: date,
) -> dict[str, Any] | None:
    if not payload:
        return None
    daily_rows = payload.get("Conversion", {}).get("conversionsByDay") or []
    current_rows = _analytics_rows_for_range(daily_rows, current_start, current_end)
    prior_rows = _analytics_rows_for_range(daily_rows, prior_start, prior_end)
    if not current_rows and not prior_rows:
        return {
            **payload,
            "callPrepWindow": {
                "mode": "cached_snapshot_fallback",
                "currentRange": {"startDate": current_start.isoformat(), "endDate": current_end.isoformat()},
                "priorRange": {"startDate": prior_start.isoformat(), "endDate": prior_end.isoformat()},
                "note": "Cached GA4 daily rows did not cover this call prep window, so the stored dashboard snapshot is shown.",
            },
        }

    current_daily = _ga4_daily_totals(current_rows)
    prior_daily = _ga4_daily_totals(prior_rows)
    original_acquisition = payload.get("Acquisition") or {}
    original_conversion = payload.get("Conversion") or {}
    current_totals = {
        **(original_acquisition.get("totals", {}).get("current") or {}),
        "sessions": current_daily["sessions"],
        "keyEvents": current_daily["keyEvents"],
    }
    previous_totals = {
        **(original_acquisition.get("totals", {}).get("previous") or {}),
        "sessions": prior_daily["sessions"],
        "keyEvents": prior_daily["keyEvents"],
    }
    return {
        **payload,
        "window": {
            "days": (current_end - current_start).days + 1,
            "current": {"startDate": current_start.isoformat(), "endDate": current_end.isoformat()},
            "previous": {"startDate": prior_start.isoformat(), "endDate": prior_end.isoformat()},
        },
        "Acquisition": {
            **original_acquisition,
            "totals": {
                "current": current_totals,
                "previous": previous_totals,
            },
        },
        "Conversion": {
            **original_conversion,
            "totals": {
                **(original_conversion.get("totals") or {}),
                "currentEventCount": current_daily["keyEvents"],
                "previousEventCount": prior_daily["keyEvents"],
            },
            "conversionsByDay": current_rows,
        },
        "callPrepWindow": {
            "mode": "derived_from_cached_daily_rows",
            "currentDailyRows": len(current_rows),
            "priorDailyRows": len(prior_rows),
        },
    }


def _build_cached_call_prep_analytics_by_period(property_id: str, end_date: date) -> dict[int, dict[str, Any]]:
    from render_supabase_analytics import get_cached_analytics_summary

    google_ads = get_cached_analytics_summary(property_id, "google_ads")
    ga4 = get_cached_analytics_summary(property_id, "ga4")
    google_ads_payload = google_ads if google_ads.get("status") != "error" else None
    ga4_payload = ga4 if ga4.get("status") != "error" else None

    analytics_by_period: dict[int, dict[str, Any]] = {}
    for period in _CALL_PREP_PERIODS:
        days = int(period["days"])
        current_start, current_end = _call_prep_range(end_date, days)
        prior_start, prior_end = _prior_call_prep_range(current_start, days)
        analytics_by_period[days] = {
            "googleAds": _derive_google_ads_call_prep_window(google_ads_payload, current_start, current_end, prior_start, prior_end),
            "googleAdsError": google_ads.get("error") if google_ads.get("status") == "error" else None,
            "ga4": _derive_ga4_call_prep_window(ga4_payload, current_start, current_end, prior_start, prior_end),
            "ga4Error": ga4.get("error") if ga4.get("status") == "error" else None,
            "mode": "cached_analytics_by_period",
        }
    return analytics_by_period


def get_property_call_prep_summary(
    property_id: str,
    property_ids: list[str] | None = None,
    start_date_value: str | None = None,
    end_date_value: str | None = None,
    access_token: str | None = None,
) -> dict[str, Any]:
    selected_property_id = str(property_id)
    end_date = _parse_iso_date(end_date_value) or datetime.now().date()
    default_start = end_date - timedelta(days=119)
    start_date = _parse_iso_date(start_date_value) or default_start
    if start_date > end_date:
        start_date, end_date = end_date, start_date

    headers = _supabase_anon_headers(access_token)
    property_payload = get_multi_property_call_prep_summary([selected_property_id], start_date.isoformat(), end_date.isoformat(), access_token)
    if property_payload.get("status") == "error":
        return property_payload

    portfolio_ids = [str(candidate) for candidate in (property_ids or []) if str(candidate) and str(candidate) != selected_property_id]
    portfolio_payload = (
        get_multi_property_call_prep_summary(portfolio_ids, start_date.isoformat(), end_date.isoformat(), access_token)
        if portfolio_ids
        else None
    )
    if portfolio_payload and portfolio_payload.get("status") == "error":
        portfolio_payload = None

    analytics_by_period = _build_cached_call_prep_analytics_by_period(selected_property_id, end_date)
    periods = []
    for period in _CALL_PREP_PERIODS:
        days = int(period["days"])
        current_start, current_end = _call_prep_range(end_date, days)
        prior_start, prior_end = _prior_call_prep_range(current_start, days)
        current = _build_call_prep_metrics(property_payload, current_start, current_end, selected_property_id)
        prior = _build_call_prep_metrics(property_payload, prior_start, prior_end, selected_property_id)
        periods.append({
            **period,
            "currentRange": {"startDate": current_start.isoformat(), "endDate": current_end.isoformat()},
            "priorRange": {"startDate": prior_start.isoformat(), "endDate": prior_end.isoformat()},
            "current": current,
            "prior": prior,
            "delta": {key: _percent_change(current.get(key), prior.get(key)) for key in _CALL_PREP_METRIC_KEYS},
            "portfolioAverage": _average_call_prep_metrics(portfolio_payload or {}, current_start, current_end, portfolio_ids, selected_property_id) if portfolio_payload else None,
            "sourceBreakdown": current.get("sourceBreakdown") or [],
            "analytics": analytics_by_period.get(days, {}),
        })

    sixty_start, sixty_end = _call_prep_range(end_date, 60)
    thirty_start, thirty_end = _call_prep_range(end_date, 30)
    budget = _fetch_call_prep_budget(selected_property_id, end_date, headers)
    recent_tasks = _fetch_call_prep_tasks(selected_property_id, sixty_start, sixty_end, headers)
    marketing_invoices = _marketing_invoices(property_payload.get("invoice_items", []), selected_property_id)
    actual_last_30 = sum(_allocated_invoice_amount(invoice, thirty_start, thirty_end) for invoice in marketing_invoices)
    performance_last_30 = sum(
        _allocated_invoice_amount(invoice, thirty_start, thirty_end)
        for invoice in marketing_invoices
        if _invoice_has_classification(invoice, _PERFORMANCE_MARKETING_GL_CODES, _PERFORMANCE_MARKETING_DESCRIPTIONS)
    )
    budget_total = float(budget.get("activeApprovedMonthly") or 0)

    return {
        "status": "ok",
        "property_id": selected_property_id,
        "property_ids": [selected_property_id, *portfolio_ids],
        "range": {
            "startDate": start_date.isoformat(),
            "endDate": end_date.isoformat(),
            "basis": "fixed_7_30_60_day_windows",
        },
        "periods": periods,
        "analyticsByPeriod": {str(key): value for key, value in analytics_by_period.items()},
        "analytics": analytics_by_period.get(60, {}),
        "recentTasks": recent_tasks,
        "activeSpend": {
            "budget": budget,
            "actual": {
                "last30": actual_last_30,
                "performanceMarketingLast30": performance_last_30,
                "marketingLineCount": len(marketing_invoices),
                "budgetLessActual": budget_total - actual_last_30,
                "basis": "Budget uses active approved monthly items; actuals use posted invoice allocation for the last 30 days.",
            },
            "glRows": _build_call_prep_spend_rows(property_payload, sixty_start, sixty_end, selected_property_id),
        },
        "dataQuality": {
            "propertyCounts": property_payload.get("counts") or {},
            "portfolioCounts": portfolio_payload.get("counts") if portfolio_payload else None,
            "propertiesLoaded": portfolio_payload.get("properties_loaded") if portfolio_payload else 0,
            "propertiesFailed": portfolio_payload.get("properties_failed") if portfolio_payload else 0,
            "portfolioLoadedPropertyIds": portfolio_payload.get("loaded_property_ids") if portfolio_payload else [],
            "portfolioPropertyRowCounts": portfolio_payload.get("property_row_counts") if portfolio_payload else {},
            "cachedAnalytics": True,
            "analyticsMode": "cached_analytics_by_period",
        },
        "source": "supabase",
        "staging_only": True,
    }


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
