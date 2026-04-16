from __future__ import annotations

import datetime
import json
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import main as legacy
from render_supabase_sync_state import _fetch_json, _table_query_url
from render_supabase_validation import SupabaseValidationConfigError, _supabase_headers


def _json_default(value: Any):
    if isinstance(value, (datetime.datetime, datetime.date)):
        return value.isoformat()
    return str(value)


def _request_json(
    table_name: str,
    *,
    method: str = "GET",
    query_params: list[tuple[str, str]] | None = None,
    payload: Any | None = None,
    prefer: str | None = None,
) -> Any:
    headers = dict(_supabase_headers())
    if prefer:
        headers["Prefer"] = prefer

    data = None
    if payload is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(payload, default=_json_default).encode("utf-8")

    request = Request(
        _table_query_url(table_name, query_params or []),
        headers=headers,
        data=data,
        method=method,
    )
    try:
        with urlopen(request, timeout=60) as response:
            body = response.read().decode("utf-8")
            if not body:
                return None
            return json.loads(body)
    except HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")[:1000]
        print(
            f"Supabase HTTPError table={table_name} method={method} "
            f"query_params={query_params or []} status={error.code} body={body!r}"
        )
        raise


def _get_row(table_name: str, filters: list[tuple[str, str]]) -> dict[str, Any] | None:
    rows = _fetch_json(table_name, [("select", "*"), *filters, ("limit", "1")])
    return rows[0] if rows else None


def _upsert_row(table_name: str, row: dict[str, Any], on_conflict: str) -> dict[str, Any]:
    payload = _request_json(
        table_name,
        method="POST",
        query_params=[("on_conflict", on_conflict)],
        payload=row,
        prefer="resolution=merge-duplicates,return=representation",
    )
    if isinstance(payload, list):
        return payload[0] if payload else row
    return payload or row


def _upsert_rows(table_name: str, rows: list[dict[str, Any]], on_conflict: str) -> list[dict[str, Any]]:
    if not rows:
        return []
    payload = _request_json(
        table_name,
        method="POST",
        query_params=[("on_conflict", on_conflict)],
        payload=rows,
        prefer="resolution=merge-duplicates,return=representation",
    )
    return payload if isinstance(payload, list) else rows


def _patch_rows(table_name: str, filters: list[tuple[str, str]], patch: dict[str, Any]) -> Any:
    return _request_json(
        table_name,
        method="PATCH",
        query_params=filters,
        payload=patch,
        prefer="return=representation",
    )


def _delete_rows(table_name: str, filters: list[tuple[str, str]]) -> None:
    _request_json(table_name, method="DELETE", query_params=filters, prefer="return=minimal")


def _iso_now() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


_SYNC_STATE_COLUMNS = {
    "id",
    "active",
    "completed",
    "run_date",
    "phase",
    "initiated_by",
    "target_offsets",
    "property_ids",
    "raw_start_date",
    "raw_end_date",
    "report_start_date",
    "report_end_date",
    "raw_day_index",
    "raw_property_index",
    "attribution_property_index",
    "aggregate_property_index",
    "batch_size",
    "raw_batch_size",
    "property_batch_size",
    "total_days",
    "next_day_offset",
    "next_property_index",
    "last_summary",
    "last_attribution_results",
    "last_aggregate_results",
    "last_processed_count",
    "last_skipped_count",
    "last_error_count",
    "started_at",
    "completed_at",
    "last_processed_at",
    "raw_data",
    "firestore_path",
    "created_at",
    "updated_at",
}


def _normalize_sync_state_row(row: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(row, dict):
        return {}

    raw_data = row.get("raw_data")
    context = dict(raw_data) if isinstance(raw_data, dict) else {}
    for key, value in row.items():
        if key == "raw_data":
            continue
        if value is not None or key not in context:
            context[key] = value
    return context


def _coerce_date_id(date_str: str) -> str:
    return datetime.datetime.strptime(date_str, "%m/%d/%Y").strftime("%Y-%m-%d")


def _ensure_property_row(property_id: str, property_name: str | None = None) -> None:
    existing = _get_row("properties", [("id", f"eq.{property_id}")])
    if existing:
        return
    request_config = legacy.get_property_request_config(int(property_id))
    _upsert_row(
        "properties",
        {
            "id": str(property_id),
            "name": property_name or str(property_id),
            "portfolio": request_config["portfolio"],
            "org_slug": request_config["org_slug"],
            "raw_data": {},
            "firestore_path": f"properties/{property_id}",
        },
        "id",
    )


def _get_property_context(property_id: str) -> dict[str, Any]:
    row = _get_row("properties", [("id", f"eq.{property_id}")]) or {}
    raw_data = row.get("raw_data") if isinstance(row.get("raw_data"), dict) else {}
    context = dict(raw_data)
    if row.get("name") and not context.get("name"):
        context["name"] = row["name"]
    return context


def _parent_snapshot_id(property_id: int | str, date_id: str) -> str:
    return f"{property_id}_{date_id}"


def _upsert_parent_snapshot(property_id: int | str, date_id: str, extra_raw: dict[str, Any] | None = None) -> dict[str, Any]:
    _ensure_property_row(str(property_id))
    existing = _get_row(
        "property_daily_snapshots",
        [("property_id", f"eq.{property_id}"), ("activity_date", f"eq.{date_id}")],
    ) or {}
    raw_data = dict(existing.get("raw_data") or {})
    if extra_raw:
        raw_data.update(extra_raw)
    row = {
        "id": _parent_snapshot_id(property_id, date_id),
        "property_id": str(property_id),
        "activity_date": date_id,
        "activity_at": f"{date_id}T00:00:00+00:00",
        "source_date_id": date_id,
        "raw_data": raw_data,
        "firestore_path": f"property_data/{property_id}_{date_id}",
    }
    return _upsert_row("property_daily_snapshots", row, "property_id,activity_date")


def _lead_row(parent_id: str, property_id: int | str, date_id: str, item: dict[str, Any], item_doc_id: str) -> dict[str, Any]:
    return {
        "id": f"{parent_id}_lead_{item_doc_id}",
        "property_snapshot_id": parent_id,
        "property_id": str(property_id),
        "activity_date": date_id,
        "lead_id": legacy.normalize_string(
            legacy.first_non_empty(item.get("leadId"), item.get("leadID"), item.get("prospectId"), item.get("prospectID"), item.get("id"))
        ),
        "application_id": legacy.normalize_string(item.get("applicationId")),
        "customer_id": legacy.normalize_string(legacy.first_non_empty(item.get("customerId"), item.get("customerID"))),
        "prospect_id": legacy.normalize_string(legacy.first_non_empty(item.get("prospectId"), item.get("prospectID"))),
        "status": legacy.normalize_string(item.get("status")),
        "lead_source": legacy.get_lead_source(item),
        "internet_listing_service": legacy.normalize_string(item.get("internetListingService")),
        "attribution": item.get("attribution") if isinstance(item.get("attribution"), dict) else {},
        "lease_ids": item.get("leaseIds") if isinstance(item.get("leaseIds"), list) else [],
        "lease_paths": item.get("leasePaths") if isinstance(item.get("leasePaths"), list) else [],
        "raw_data": item,
        "firestore_path": f"property_data/{parent_id}/leads/{item_doc_id}",
    }


def _event_row(parent_id: str, property_id: int | str, date_id: str, item: dict[str, Any], item_doc_id: str) -> dict[str, Any]:
    type_id = item.get("typeId")
    try:
        type_id = int(type_id) if type_id not in (None, "") else None
    except (TypeError, ValueError):
        type_id = None
    return {
        "id": f"{parent_id}_event_{item_doc_id}",
        "property_snapshot_id": parent_id,
        "property_id": str(property_id),
        "activity_date": date_id,
        "event_id": legacy.normalize_string(legacy.first_non_empty(item.get("eventId"), item.get("eventID"), item.get("id"))),
        "type_id": type_id,
        "event_type": legacy.normalize_string(item.get("type")),
        "event_reason": legacy.normalize_string(item.get("eventReason")),
        "application_id": legacy.normalize_string(item.get("applicationId")),
        "lease_id": legacy.normalize_string(item.get("leaseId")),
        "lease_interval_id": legacy.normalize_string(item.get("leaseIntervalId")),
        "raw_data": item,
        "firestore_path": f"property_data/{parent_id}/events/{item_doc_id}",
    }


def _invoice_row(parent_id: str, property_id: int | str, date_id: str, item: dict[str, Any], item_doc_id: str) -> dict[str, Any]:
    amount = abs(float(legacy.get_invoice_amount(item) or 0))
    return {
        "id": f"{parent_id}_invoice_{item_doc_id}",
        "property_snapshot_id": parent_id,
        "property_id": str(property_id),
        "activity_date": date_id,
        "invoice_id": legacy.normalize_string(legacy.first_non_empty(item.get("invoiceId"), item.get("invoiceID"), item.get("id"))),
        "reference_number": legacy.normalize_string(item.get("referenceNumber")),
        "vendor_name": legacy.normalize_string(item.get("vendorName")),
        "contract": legacy.normalize_string(item.get("contract")),
        "post_date": legacy.serialize_date(legacy.parse_entrata_date(item.get("postDate"))),
        "invoice_date": legacy.serialize_date(legacy.parse_entrata_date(item.get("invoiceDate"))),
        "transaction_date": legacy.serialize_date(legacy.parse_entrata_date(item.get("transactionDate"))),
        "post_month": legacy.normalize_string(item.get("postMonth")),
        "amount": round(amount, 2),
        "gl_account_number": legacy.normalize_string(item.get("glAccount", {}).get("accountNumber")),
        "gl_account_name": legacy.normalize_string(item.get("glAccount", {}).get("accountName")),
        "raw_data": item,
        "firestore_path": f"property_data/{parent_id}/invoices/{item_doc_id}",
    }


def _availability_row(parent_id: str, property_id: int | str, date_id: str, item: dict[str, Any], item_doc_id: str) -> dict[str, Any]:
    attrs = item.get("@attributes", {}) if isinstance(item.get("@attributes"), dict) else {}
    price = legacy.get_availability_price(item)
    available_on = legacy.parse_entrata_date(legacy.get_availability_date(item))
    return {
        "id": f"{parent_id}_availability_{item_doc_id}",
        "property_snapshot_id": parent_id,
        "property_id": str(property_id),
        "activity_date": date_id,
        "unit_id": legacy.normalize_string(legacy.first_non_empty(item.get("unitId"), item.get("unitID"), attrs.get("Id"), item.get("id"))),
        "unit_number": legacy.normalize_string(legacy.first_non_empty(item.get("unitNumber"), attrs.get("UnitNumber"), attrs.get("MarketingUnitNumber"))),
        "floorplan_name": legacy.normalize_string(legacy.first_non_empty(item.get("floorplanName"), item.get("floorPlanName"), attrs.get("FloorPlanName"))),
        "availability_status": legacy.normalize_string(legacy.get_availability_status(item)),
        "available_on": legacy.serialize_date(available_on),
        "price": round(float(price), 2) if price is not None else None,
        "raw_data": item,
        "firestore_path": f"property_data/{parent_id}/availability/{item_doc_id}",
    }


def save_raw_data(property_id: int, subcollection_name: str, item_list: list[dict[str, Any]], date_str: str) -> dict[str, Any]:
    date_id = _coerce_date_id(date_str)
    parent_id = _parent_snapshot_id(property_id, date_id)
    _upsert_parent_snapshot(
        property_id,
        date_id,
        extra_raw={f"{subcollection_name}_count": len(item_list or [])},
    )

    if subcollection_name == "leases":
        existing = _get_row("property_daily_snapshots", [("id", f"eq.{parent_id}")]) or {}
        raw_data = dict(existing.get("raw_data") or {})
        raw_data["leases"] = item_list or []
        _upsert_row(
            "property_daily_snapshots",
            {
                "id": parent_id,
                "property_id": str(property_id),
                "activity_date": date_id,
                "activity_at": f"{date_id}T00:00:00+00:00",
                "source_date_id": date_id,
                "raw_data": raw_data,
                "firestore_path": f"property_data/{parent_id}",
            },
            "property_id,activity_date",
        )
        return {"property_id": property_id, "date": date_id, "subcollection": subcollection_name, "count": len(item_list or [])}

    table_name = {
        "leads": "property_leads",
        "events": "property_events",
        "invoices": "property_invoices",
        "availability": "property_availability",
    }[subcollection_name]
    row_builder = {
        "leads": _lead_row,
        "events": _event_row,
        "invoices": _invoice_row,
        "availability": _availability_row,
    }[subcollection_name]

    _delete_rows(table_name, [("property_snapshot_id", f"eq.{parent_id}")])

    rows: list[dict[str, Any]] = []
    for index, item in enumerate(item_list or []):
        if not item:
            continue
        item_doc_id = legacy.build_item_document_id(subcollection_name, item) or f"generated_{index}"
        rows.append(row_builder(parent_id, property_id, date_id, item, item_doc_id))
    _upsert_rows(table_name, rows, "id")
    return {"property_id": property_id, "date": date_id, "subcollection": subcollection_name, "count": len(rows)}


def store_property_specials(property_id: int, specials_items: list[dict[str, Any]], raw_result: dict[str, Any] | None = None) -> dict[str, Any]:
    _ensure_property_row(str(property_id))
    current_row = _get_row("property_specials_current", [("property_id", f"eq.{property_id}")]) or {}
    specials_hash = legacy.compute_specials_hash(specials_items)
    current_hash = current_row.get("specials_hash")
    changed = current_hash != specials_hash
    request_config = legacy.get_property_request_config(property_id)

    row = {
        "property_id": str(property_id),
        "special_count": len(specials_items),
        "specials_hash": specials_hash,
        "specials": specials_items,
        "raw_result": raw_result or {},
        "portfolio": request_config["portfolio"],
        "org_slug": request_config["org_slug"],
        "last_synced_at": _iso_now(),
        "firestore_path": f"properties/{property_id}/specials/current",
    }
    if changed:
        row["last_changed_at"] = _iso_now()
    _upsert_row("property_specials_current", row, "property_id")
    return {
        "property_id": property_id,
        "changed": changed,
        "special_count": len(specials_items),
        "specials_hash": specials_hash,
    }


def store_property_availability_pricing(property_id: int, result: dict[str, Any]) -> dict[str, Any]:
    _ensure_property_row(str(property_id))
    snapshot_payload = legacy.build_property_availability_snapshot(property_id, result)
    snapshot_hash = legacy.compute_payload_hash(snapshot_payload)
    current_row = _get_row("property_availability_snapshots", [("property_id", f"eq.{property_id}")]) or {}
    changed = current_row.get("snapshot_hash") != snapshot_hash
    request_config = legacy.get_property_request_config(property_id)

    row = {
        "property_id": str(property_id),
        "floorplan_count": snapshot_payload["floorplan_count"],
        "unit_count": snapshot_payload["unit_count"],
        "availability_url": snapshot_payload["availability_url"],
        "snapshot_hash": snapshot_hash,
        "property_payload": snapshot_payload["property"] or {},
        "floorplans": snapshot_payload["floorplans"] or [],
        "units": snapshot_payload["units"] or [],
        "raw_result": result or {},
        "portfolio": request_config["portfolio"],
        "org_slug": request_config["org_slug"],
        "last_synced_at": _iso_now(),
        "firestore_path": f"properties/{property_id}/availability_pricing/current",
    }
    if changed:
        row["last_changed_at"] = _iso_now()
    _upsert_row("property_availability_snapshots", row, "property_id")
    return {
        "property_id": property_id,
        "changed": changed,
        "floorplan_count": snapshot_payload["floorplan_count"],
        "unit_count": snapshot_payload["unit_count"],
        "snapshot_hash": snapshot_hash,
    }


def build_lead_index(property_id: int, lookback_days: int = legacy.LEASE_ATTRIBUTION_LEAD_LOOKBACK_DAYS) -> dict[str, Any]:
    end_dt = legacy.get_local_now().date()
    start_dt = end_dt - datetime.timedelta(days=max(lookback_days, 1))
    rows = _fetch_json(
        "property_leads",
        [
            ("select", "id,property_snapshot_id,activity_date,application_id,lead_id,prospect_id,status,lead_source,internet_listing_service,raw_data,firestore_path"),
            ("property_id", f"eq.{property_id}"),
            ("activity_date", f"gte.{start_dt.isoformat()}"),
            ("activity_date", f"lte.{end_dt.isoformat()}"),
            ("order", "activity_date.desc"),
        ],
    )

    identifier_map: dict[str, list[dict[str, Any]]] = {}
    lead_docs_by_path: dict[str, dict[str, Any]] = {}

    for row in rows:
        lead_data = dict(row.get("raw_data") or {})
        if legacy.is_guest_card_record(lead_data):
            continue
        identifiers = legacy.get_collection_identifiers(lead_data, legacy.LEAD_IDENTIFIER_KEYS)
        contact_fields = legacy.extract_lead_contact_fields(lead_data)
        if not identifiers and not any(contact_fields.values()):
            continue

        lead_record = {
            "document_path": row.get("firestore_path") or f"property_data/{row.get('property_snapshot_id')}/leads/{row.get('id')}",
            "document_id": row.get("id"),
            "parent_id": row.get("property_snapshot_id"),
            "parent_date": row.get("activity_date"),
            "data": lead_data,
            "identifiers": identifiers,
            "application_id": legacy.normalize_string(lead_data.get("applicationId")),
            "lease_id": legacy.normalize_string(legacy.first_non_empty(lead_data.get("leaseId"), lead_data.get("leaseID"))),
            **contact_fields,
        }
        lead_docs_by_path[lead_record["document_path"]] = lead_record
        for identifier in identifiers:
            identifier_map.setdefault(identifier, []).append(lead_record)

    return {
        "identifier_map": identifier_map,
        "lead_docs_by_path": lead_docs_by_path,
        "parent_count": len({row.get("property_snapshot_id") for row in rows}),
        "lead_count": len(lead_docs_by_path),
    }


def _patch_lead_attribution(correlation: dict[str, Any], lease_id: str, lease_path: str) -> None:
    lead_doc_id = correlation.get("lead_document_id")
    if not lead_doc_id:
        return
    existing = _get_row("property_leads", [("id", f"eq.{lead_doc_id}")]) or {}
    lease_ids = existing.get("lease_ids") if isinstance(existing.get("lease_ids"), list) else []
    lease_paths = existing.get("lease_paths") if isinstance(existing.get("lease_paths"), list) else []
    next_lease_ids = sorted({*lease_ids, lease_id})
    next_lease_paths = sorted({*lease_paths, lease_path})
    _patch_rows(
        "property_leads",
        [("id", f"eq.{lead_doc_id}")],
        {
            "attribution": {
                "latest_lease_id": lease_id,
                "latest_lease_path": lease_path,
                "last_linked_at": _iso_now(),
            },
            "lease_ids": next_lease_ids,
            "lease_paths": next_lease_paths,
        },
    )


def upsert_normalized_lease(property_id: int, normalized_lease: dict[str, Any], correlation: dict[str, Any] | None, window_start: datetime.date, window_end: datetime.date) -> bool:
    lease_id = normalized_lease.get("lease_id")
    if not lease_id:
        return False
    _ensure_property_row(str(property_id))
    lease_path = f"properties/{property_id}/leases/{lease_id}"
    lead_attribution: dict[str, Any] = {}
    if correlation:
        source_classification = legacy.canonicalize_source_label(
            legacy.first_non_empty(correlation.get("lead_source"), correlation.get("internet_listing_service")),
            default_label="Unknown",
        )
        lead_attribution = {
            "match_type": correlation.get("match_type"),
            "matched_identifier": correlation.get("matched_identifier"),
            "lead_document_path": correlation.get("lead_document_path"),
            "lead_document_id": correlation.get("lead_document_id"),
            "lead_parent_id": correlation.get("lead_parent_id"),
            "lead_parent_date": correlation.get("lead_parent_date"),
            "lead_id": correlation.get("lead_id"),
            "application_id": correlation.get("application_id"),
            "lead_source": correlation.get("lead_source"),
            "lead_status": correlation.get("lead_status"),
            "internet_listing_service": correlation.get("internet_listing_service"),
            "source_key": source_classification["source_key"],
            "source_label": source_classification["source_label"],
        }

    lease_term_months = int(normalized_lease.get("lease_term_months") or 0)
    net_effective_rent = float(normalized_lease.get("net_effective_rent") or 0.0)
    row = {
        "id": str(lease_id),
        "property_id": str(property_id),
        "reporting_window_start": legacy.serialize_date(window_start),
        "reporting_window_end": legacy.serialize_date(window_end),
        "attribution_status": "matched" if correlation else "unmatched",
        "attribution_event_date": normalized_lease.get("attribution_event_date"),
        "lease_term_months": lease_term_months,
        "lease_start_date": normalized_lease.get("lease_start_date"),
        "lease_end_date": normalized_lease.get("lease_end_date"),
        "move_in_date": normalized_lease.get("move_in_date"),
        "move_out_date": normalized_lease.get("move_out_date"),
        "gross_lease_value": float(normalized_lease.get("gross_lease_value") or 0.0),
        "net_effective_rent": net_effective_rent,
        "net_effective_revenue": round(net_effective_rent * lease_term_months, 2),
        "concession_total": float(normalized_lease.get("concession_total") or 0.0),
        "lead_attribution": lead_attribution,
        "raw_data": normalized_lease,
        "last_synced_at": _iso_now(),
        "firestore_path": lease_path,
    }
    _upsert_row("property_leases", row, "id")
    if correlation:
        _patch_lead_attribution(correlation, str(lease_id), lease_path)
    return True


def stream_property_leases(property_id: int) -> list[dict[str, Any]]:
    return _fetch_json(
        "property_leases",
        [
            ("select", "*"),
            ("property_id", f"eq.{property_id}"),
        ],
    )


def load_property_invoices(property_id: int, start_date: datetime.date, end_date: datetime.date) -> tuple[list[dict[str, Any]], int]:
    month_start, _ = legacy.get_month_range_for_date(start_date)
    _, month_end = legacy.get_month_range_for_date(end_date)
    rows = _fetch_json(
        "property_invoices",
        [
            ("select", "property_snapshot_id,activity_date,raw_data"),
            ("property_id", f"eq.{property_id}"),
            ("activity_date", f"gte.{month_start.isoformat()}"),
            ("activity_date", f"lte.{month_end.isoformat()}"),
            ("order", "activity_date.asc"),
        ],
    )

    invoices_by_key: dict[str, dict[str, Any]] = {}
    for row in rows:
        invoice = dict(row.get("raw_data") or {})
        invoice["_date"] = row.get("activity_date")
        invoice_key = legacy.get_invoice_key(invoice)
        existing = invoices_by_key.get(invoice_key)
        if existing is None:
            invoices_by_key[invoice_key] = invoice
            continue
        existing_date = legacy.get_invoice_effective_date(existing)
        next_date = legacy.get_invoice_effective_date(invoice)
        if next_date and (existing_date is None or next_date < existing_date):
            invoices_by_key[invoice_key] = invoice

    return list(invoices_by_key.values()), len({row.get("property_snapshot_id") for row in rows})


def write_roi_buckets(property_id: int, buckets: dict[str, dict[str, Any]]) -> None:
    rows: list[dict[str, Any]] = []
    for date_id in sorted(buckets.keys()):
        bucket = legacy.finalize_roi_bucket(buckets[date_id])
        totals = bucket["totals"]
        rows.append(
            {
                "id": f"properties/{property_id}/roi_daily/{date_id}",
                "property_id": str(property_id),
                "activity_date": date_id,
                "attributed_leases": totals.get("attributed_leases", 0),
                "unattributed_leases": totals.get("unattributed_leases", 0),
                "gross_lease_value": totals.get("gross_lease_value", 0),
                "net_effective_revenue": totals.get("net_effective_revenue", 0),
                "concession_total": totals.get("concession_total", 0),
                "marketing_spend": totals.get("marketing_spend", 0),
                "performance_marketing_spend": totals.get("performance_marketing_spend", 0),
                "roi": totals.get("roi"),
                "source_metrics": bucket.get("source_metrics", []),
                "invoice_channels": bucket.get("invoice_channels", []),
                "raw_data": bucket,
                "last_aggregated_at": _iso_now(),
                "firestore_path": f"properties/{property_id}/roi_daily/{date_id}",
            }
        )
    _upsert_rows("property_roi_daily", rows, "property_id,activity_date")


def property_day_doc_exists(property_id: int, date_id: str) -> bool:
    return _get_row(
        "property_daily_snapshots",
        [("property_id", f"eq.{property_id}"), ("activity_date", f"eq.{date_id}")],
    ) is not None


def get_sync_state(name: str) -> dict[str, Any]:
    return _normalize_sync_state_row(_get_row("sync_state", [("id", f"eq.{name}")]))


def set_sync_state(name: str, patch: dict[str, Any], *, replace: bool = False) -> dict[str, Any]:
    current = {} if replace else get_sync_state(name)
    state = {**current, **patch, "id": name}
    if "firestore_path" not in state:
        state["firestore_path"] = f"_sync_state/{name}"

    raw_data = {}
    if isinstance(current.get("raw_data"), dict):
        raw_data.update(current["raw_data"])
    if isinstance(patch.get("raw_data"), dict):
        raw_data.update(patch["raw_data"])

    row = {}
    for key, value in state.items():
        if key in _SYNC_STATE_COLUMNS:
            row[key] = value
        else:
            raw_data[key] = value

    row["id"] = name
    row["raw_data"] = raw_data
    if "firestore_path" not in row:
        row["firestore_path"] = f"_sync_state/{name}"
    return _normalize_sync_state_row(_upsert_row("sync_state", row, "id"))


def build_retry_doc_id(job_type: str, property_id: int, date_id: str) -> str:
    return legacy.build_retry_doc_id(job_type, property_id, date_id)


def queue_retry_job(job_type: str, property_id: int, date_str: str, error_message: str) -> dict[str, Any]:
    date_id = datetime.datetime.strptime(date_str, "%m/%d/%Y").strftime("%Y-%m-%d")
    doc_id = build_retry_doc_id(job_type, property_id, date_id)
    current = _get_row("sync_retries", [("id", f"eq.{doc_id}")]) or {}
    attempts = int(current.get("attempts", 0))
    row = {
        **current,
        "id": doc_id,
        "job_type": job_type,
        "property_id": str(property_id),
        "date_id": date_id,
        "date_str": date_str,
        "attempts": attempts + 1,
        "last_error": error_message,
        "last_queued_at": _iso_now(),
        "firestore_path": f"_sync_retries/{doc_id}",
    }
    return _upsert_row("sync_retries", row, "id")


def get_retry_jobs(limit: int) -> list[dict[str, Any]]:
    return _fetch_json(
        "sync_retries",
        [
            ("select", "*"),
            ("order", "abandoned.asc"),
            ("order", "attempts.asc"),
            ("order", "last_queued_at.asc"),
            ("limit", str(limit)),
        ],
    )


def sync_property_date(property_id: int, date_str: str) -> None:
    legacy.fetch_leads_for_date(property_id, date_str)
    legacy.fetch_events_for_date(property_id, date_str)
    legacy.fetch_leases_for_date(property_id, date_str)
    legacy.fetch_invoices_for_date(property_id, date_str)
    # Keep daily refresh focused on the core reporting entities. Availability
    # requests are handled by dedicated jobs and have known Entrata quirks that
    # can create noisy failures without helping the refresh path.


def sync_property_date_for_roi(property_id: int, date_str: str) -> None:
    legacy.fetch_leads_for_date(property_id, date_str)
    legacy.fetch_events_for_date(property_id, date_str)
    legacy.fetch_leases_for_date(property_id, date_str)
    legacy.fetch_invoices_for_date(property_id, date_str)


def process_retry_queue_batch() -> str:
    jobs = get_retry_jobs(max(legacy.RETRY_BATCH_SIZE, 1))
    processed = 0
    cleared = 0
    errors = 0
    abandoned = 0

    for job in jobs:
        if job.get("abandoned"):
            continue

        job_type = job.get("job_type", "background_backfill")
        property_id = int(job["property_id"])
        date_str = job["date_str"]
        attempts = int(job.get("attempts", 1))

        try:
            print(f"Retry queue syncing property {property_id} for {date_str} (attempt {attempts})")
            sync_property_date(property_id, date_str)
            _delete_rows("sync_retries", [("id", f"eq.{job['id']}")])
            processed += 1
            cleared += 1
        except Exception as error:
            errors += 1
            permanent_failure = legacy.is_permanent_retry_failure(str(error))
            if permanent_failure or attempts >= legacy.RETRY_MAX_ATTEMPTS:
                _patch_rows(
                    "sync_retries",
                    [("id", f"eq.{job['id']}")],
                    {
                        "abandoned": True,
                        "abandoned_at": _iso_now(),
                        "last_error": str(error),
                        "abandon_reason": "permanent_failure" if permanent_failure else "max_attempts",
                    },
                )
                abandoned += 1
            else:
                _patch_rows(
                    "sync_retries",
                    [("id", f"eq.{job['id']}")],
                    {
                        "attempts": attempts + 1,
                        "last_error": str(error),
                        "last_queued_at": _iso_now(),
                    },
                )
            time.sleep(2)

    return (
        f"Retry queue processed={processed}, cleared={cleared}, errors={errors}, "
        f"abandoned={abandoned}, remaining_checked={len(jobs)}"
    )


def process_background_backfill_batch() -> str:
    state = get_sync_state("entrata_background_backfill")
    total_days = max(legacy.BACKGROUND_BACKFILL_TOTAL_DAYS, 1)
    if not state:
        state = {
            "active": True,
            "batch_size": legacy.BACKGROUND_BACKFILL_BATCH_SIZE,
            "total_days": total_days,
            "next_day_offset": total_days - 1,
            "next_property_index": 0,
        }
    if not state.get("active", True):
        return "Background backfill paused."

    property_ids = legacy.get_automation_property_ids()
    if not property_ids:
        return "No property IDs configured."

    processed = 0
    skipped = 0
    errors = 0
    batch_size = max(int(state.get("batch_size", legacy.BACKGROUND_BACKFILL_BATCH_SIZE)), 1)

    while processed < batch_size and int(state["next_day_offset"]) >= 0:
        property_id = property_ids[int(state["next_property_index"])]
        date_offset = int(state["next_day_offset"])
        date_id = legacy.get_firestore_date_id_from_offset(date_offset)
        date_str = legacy.get_request_date_from_offset(date_offset)

        try:
            if property_day_doc_exists(property_id, date_id):
                skipped += 1
            else:
                print(f"Background backfill syncing property {property_id} for {date_str}")
                sync_property_date(property_id, date_str)
                processed += 1
        except Exception as error:
            errors += 1
            print(f"Background backfill error on property {property_id} for {date_str}: {error}")
            queue_retry_job("background_backfill", property_id, date_str, str(error))

        state["next_property_index"] += 1
        if state["next_property_index"] >= len(property_ids):
            state["next_property_index"] = 0
            state["next_day_offset"] -= 1
        time.sleep(2)

    completed = int(state["next_day_offset"]) < 0
    set_sync_state(
        "entrata_background_backfill",
        {
            **state,
            "completed": completed,
            "active": not completed,
            "last_processed_at": _iso_now(),
            "last_processed_count": processed,
            "last_skipped_count": skipped,
            "last_error_count": errors,
        },
    )
    return (
        f"Background backfill processed={processed}, skipped={skipped}, errors={errors}, "
        f"next_day_offset={state.get('next_day_offset')}, next_property_index={state.get('next_property_index')}"
    )


def process_daily_refresh_batch() -> str:
    run_date = legacy.get_local_now().strftime("%Y-%m-%d")
    target_offsets = list(range(1, max(legacy.DAILY_REFRESH_LOOKBACK_DAYS, 1) + 1))
    state = get_sync_state("entrata_daily_refresh")
    if state.get("run_date") != run_date:
        state = {
            "run_date": run_date,
            "target_offsets": target_offsets,
            "next_day_offset": target_offsets[0] if target_offsets else None,
            "offset_index": 0,
            "next_property_index": 0,
            "completed": False,
            "batch_size": legacy.DAILY_REFRESH_BATCH_SIZE,
        }
    if state.get("completed"):
        return f"Daily refresh already complete for {state['run_date']}."

    property_ids = legacy.get_automation_property_ids()
    if not property_ids:
        return "No property IDs configured."

    processed = 0
    errors = 0
    batch_size = max(int(state.get("batch_size", legacy.DAILY_REFRESH_BATCH_SIZE)), 1)
    offset_index = int(state.get("offset_index", 0))
    property_index = int(state.get("next_property_index", 0))

    while processed < batch_size and offset_index < len(target_offsets):
        property_id = property_ids[property_index]
        day_offset = int(target_offsets[offset_index])
        date_str = legacy.get_request_date_from_offset(day_offset)

        try:
            print(f"Daily refresh syncing property {property_id} for {date_str}")
            sync_property_date(property_id, date_str)
            processed += 1
        except Exception as error:
            errors += 1
            print(f"Daily refresh error on property {property_id} for {date_str}: {error}")
            queue_retry_job("daily_refresh", property_id, date_str, str(error))

        property_index += 1
        if property_index >= len(property_ids):
            property_index = 0
            offset_index += 1
        time.sleep(2)

    completed = offset_index >= len(target_offsets)
    set_sync_state(
        "entrata_daily_refresh",
        {
            **state,
            "target_offsets": target_offsets,
            "offset_index": offset_index,
            "next_day_offset": target_offsets[offset_index] if offset_index < len(target_offsets) else None,
            "next_property_index": property_index,
            "completed": completed,
            "last_processed_at": _iso_now(),
            "last_processed_count": processed,
            "last_error_count": errors,
        },
    )
    return (
        f"Daily refresh run_date={run_date}, processed={processed}, errors={errors}, "
        f"offset_index={offset_index}, property_index={property_index}, completed={completed}"
    )


def sync_lease_attribution_for_property(property_id: int, start_date: datetime.date, end_date: datetime.date, lead_lookback_days: int = legacy.LEASE_ATTRIBUTION_LEAD_LOOKBACK_DAYS) -> dict[str, Any]:
    query_end = end_date + datetime.timedelta(days=max(legacy.LEASE_ATTRIBUTION_FUTURE_MOVE_IN_DAYS, 0))
    params = {
        "propertyId": property_id,
        "moveInDateFrom": legacy.format_entrata_date(start_date),
        "moveInDateTo": legacy.format_entrata_date(query_end),
    }

    leases, meta = legacy.fetch_paginated_leases_for_range(property_id, params)
    lead_index = build_lead_index(property_id, lookback_days=lead_lookback_days)

    processed = 0
    matched = 0
    unmatched = 0
    skipped = 0

    for lease in leases:
        normalized_lease = legacy.normalize_lease_record(property_id, lease)
        if not normalized_lease.get("lease_id"):
            skipped += 1
            continue
        if not legacy.lease_is_in_reporting_window(normalized_lease, start_date, end_date):
            skipped += 1
            continue

        correlation = legacy.correlate_lease_to_lead(normalized_lease, lead_index)
        upsert_normalized_lease(property_id, normalized_lease, correlation, start_date, end_date)
        processed += 1
        if correlation:
            matched += 1
        else:
            unmatched += 1

    return {
        "property_id": property_id,
        "queried_move_in_start": legacy.serialize_date(start_date),
        "queried_move_in_end": legacy.serialize_date(query_end),
        "reporting_window_start": legacy.serialize_date(start_date),
        "reporting_window_end": legacy.serialize_date(end_date),
        "leases_fetched": len(leases),
        "leases_processed": processed,
        "leases_matched": matched,
        "leases_unmatched": unmatched,
        "leases_skipped": skipped,
        "lead_lookup_docs": lead_index.get("lead_count", 0),
        "lead_lookup_parents": lead_index.get("parent_count", 0),
        "meta": meta,
    }


def sync_lease_attribution(property_ids: list[int], start_date: datetime.date | None = None, end_date: datetime.date | None = None) -> list[dict[str, Any]]:
    if end_date is None:
        end_date = legacy.get_local_now().date()
    if start_date is None:
        start_date = end_date - datetime.timedelta(days=max(legacy.LEASE_ATTRIBUTION_LOOKBACK_DAYS - 1, 0))
    results = []
    for property_id in property_ids:
        try:
            results.append(sync_lease_attribution_for_property(property_id, start_date, end_date))
        except Exception as error:
            results.append(
                {
                    "property_id": property_id,
                    "error": str(error),
                    "queried_move_in_start": legacy.serialize_date(start_date),
                    "queried_move_in_end": legacy.serialize_date(end_date),
                }
            )
        time.sleep(2)
    return results


def aggregate_roi_for_property(property_id: int, start_date: datetime.date, end_date: datetime.date) -> dict[str, Any]:
    buckets = legacy.build_daily_roi_buckets(property_id, start_date, end_date)
    processed_leases = 0
    processed_invoices = 0

    for lease_row in stream_property_leases(property_id):
        lease_doc = dict(lease_row.get("raw_data") or {})
        lease_doc.update(
            {
                "attribution_event_date": lease_row.get("attribution_event_date"),
                "attribution_status": lease_row.get("attribution_status"),
                "lead_attribution": lease_row.get("lead_attribution") or {},
                "gross_lease_value": lease_row.get("gross_lease_value"),
                "net_effective_rent": lease_row.get("net_effective_rent"),
                "lease_term_months": lease_row.get("lease_term_months"),
                "concession_total": lease_row.get("concession_total"),
            }
        )
        event_date = legacy.parse_entrata_date(lease_doc.get("attribution_event_date"))
        if not event_date or event_date < start_date or event_date > end_date:
            continue
        if legacy.apply_lease_revenue_to_buckets(buckets, lease_doc):
            processed_leases += 1

    invoices, invoice_parent_count = load_property_invoices(property_id, start_date, end_date)
    for invoice in invoices:
        legacy.apply_invoice_spend_to_buckets(buckets, invoice, start_date, end_date)
        processed_invoices += 1

    write_roi_buckets(property_id, buckets)

    totals = {
        "attributed_leases": 0,
        "unattributed_leases": 0,
        "gross_lease_value": 0.0,
        "net_effective_revenue": 0.0,
        "concession_total": 0.0,
        "marketing_spend": 0.0,
        "performance_marketing_spend": 0.0,
    }
    for bucket in buckets.values():
        for key in totals.keys():
            totals[key] += bucket["totals"].get(key, 0) or 0

    roi = None
    if totals["marketing_spend"] > 0:
        roi = round((totals["net_effective_revenue"] - totals["marketing_spend"]) / totals["marketing_spend"], 4)

    return {
        "property_id": property_id,
        "start_date": legacy.serialize_date(start_date),
        "end_date": legacy.serialize_date(end_date),
        "days_written": len(buckets),
        "leases_aggregated": processed_leases,
        "invoices_aggregated": processed_invoices,
        "invoice_parent_docs": invoice_parent_count,
        "totals": {
            **{key: round(value, 2) if isinstance(value, float) else value for key, value in totals.items()},
            "roi": roi,
        },
    }


def aggregate_roi(property_ids: list[int], start_date: datetime.date | None = None, end_date: datetime.date | None = None) -> list[dict[str, Any]]:
    if end_date is None:
        end_date = legacy.get_local_now().date()
    if start_date is None:
        start_date = end_date - datetime.timedelta(days=max(legacy.LEASE_ATTRIBUTION_LOOKBACK_DAYS - 1, 0))
    summaries = []
    for property_id in property_ids:
        summaries.append(aggregate_roi_for_property(property_id, start_date, end_date))
        time.sleep(1)
    return summaries


def start_roi_pipeline_job(
    job_name: str,
    property_ids: list[int],
    raw_start_date: datetime.date,
    raw_end_date: datetime.date,
    report_start_date: datetime.date,
    report_end_date: datetime.date,
    initiated_by: str = "manual",
) -> dict[str, Any]:
    state = {
        "job_name": job_name,
        "active": True,
        "completed": False,
        "phase": "raw",
        "initiated_by": initiated_by,
        "property_ids": [int(property_id) for property_id in property_ids],
        "raw_start_date": legacy.serialize_date(raw_start_date),
        "raw_end_date": legacy.serialize_date(raw_end_date),
        "report_start_date": legacy.serialize_date(report_start_date),
        "report_end_date": legacy.serialize_date(report_end_date),
        "raw_day_index": 0,
        "raw_property_index": 0,
        "attribution_property_index": 0,
        "aggregate_property_index": 0,
        "raw_batch_size": legacy.ROI_PIPELINE_RAW_BATCH_SIZE,
        "property_batch_size": legacy.ROI_PIPELINE_PROPERTY_BATCH_SIZE,
        "started_at": _iso_now(),
        "last_processed_at": None,
        "last_summary": None,
    }
    return set_sync_state(job_name, state, replace=True)


def process_roi_pipeline_job(job_name: str) -> str:
    state = get_sync_state(job_name)
    if not state or not state.get("active"):
        return f"{job_name}: inactive"

    property_ids = [int(property_id) for property_id in state.get("property_ids", [])]
    if not property_ids:
        set_sync_state(
            job_name,
            {
                "active": False,
                "completed": True,
                "phase": "done",
                "last_summary": "No property IDs configured.",
                "last_processed_at": _iso_now(),
            },
        )
        return f"{job_name}: no property IDs configured"

    raw_start_date = legacy.parse_iso_date(state.get("raw_start_date"))
    raw_end_date = legacy.parse_iso_date(state.get("raw_end_date"))
    report_start_date = legacy.parse_iso_date(state.get("report_start_date"))
    report_end_date = legacy.parse_iso_date(state.get("report_end_date"))
    phase = state.get("phase", "raw")
    raw_batch_size = max(int(state.get("raw_batch_size", legacy.ROI_PIPELINE_RAW_BATCH_SIZE)), 1)
    property_batch_size = max(int(state.get("property_batch_size", legacy.ROI_PIPELINE_PROPERTY_BATCH_SIZE)), 1)

    if not raw_start_date or not raw_end_date or not report_start_date or not report_end_date:
        raise ValueError(f"{job_name}: invalid pipeline dates")

    summary = ""

    if phase == "raw":
        total_days = (raw_end_date - raw_start_date).days + 1
        raw_day_index = int(state.get("raw_day_index", 0))
        raw_property_index = int(state.get("raw_property_index", 0))
        processed = 0
        errors = 0

        while processed < raw_batch_size and raw_day_index < total_days:
            current_date = raw_start_date + datetime.timedelta(days=raw_day_index)
            property_id = property_ids[raw_property_index]
            date_str = legacy.format_entrata_date(current_date)
            try:
                print(f"{job_name}: raw sync property {property_id} for {date_str}")
                sync_property_date_for_roi(property_id, date_str)
                processed += 1
            except Exception as error:
                errors += 1
                print(f"{job_name}: raw sync error on property {property_id} for {date_str}: {error}")
                queue_retry_job(job_name, property_id, date_str, str(error))

            raw_property_index += 1
            if raw_property_index >= len(property_ids):
                raw_property_index = 0
                raw_day_index += 1
            time.sleep(1)

        phase_complete = raw_day_index >= total_days
        phase = "attribution" if phase_complete else "raw"
        set_sync_state(
            job_name,
            {
                "phase": phase,
                "raw_day_index": raw_day_index,
                "raw_property_index": raw_property_index,
                "last_processed_at": _iso_now(),
                "last_summary": f"raw processed={processed}, errors={errors}, next_day_index={raw_day_index}, next_property_index={raw_property_index}",
            },
        )
        summary = f"{job_name}: raw processed={processed}, errors={errors}"

    if phase == "attribution":
        state = get_sync_state(job_name)
        attribution_property_index = int(state.get("attribution_property_index", 0))
        processed = 0
        errors = 0
        last_results = []
        lead_lookback_days = max(
            legacy.LEASE_ATTRIBUTION_LEAD_LOOKBACK_DAYS,
            (report_end_date - report_start_date).days + 90,
        )

        while processed < property_batch_size and attribution_property_index < len(property_ids):
            property_id = property_ids[attribution_property_index]
            try:
                print(f"{job_name}: attribution sync for property {property_id}")
                result = sync_lease_attribution_for_property(
                    property_id,
                    report_start_date,
                    report_end_date,
                    lead_lookback_days=lead_lookback_days,
                )
                last_results.append(result)
                processed += 1
            except Exception as error:
                errors += 1
                print(f"{job_name}: attribution error on property {property_id}: {error}")
            attribution_property_index += 1
            time.sleep(1)

        phase_complete = attribution_property_index >= len(property_ids)
        phase = "aggregate" if phase_complete else "attribution"
        set_sync_state(
            job_name,
            {
                "phase": phase,
                "attribution_property_index": attribution_property_index,
                "last_processed_at": _iso_now(),
                "last_summary": f"attribution processed={processed}, errors={errors}, next_property_index={attribution_property_index}",
                "last_attribution_results": last_results[-3:],
            },
        )
        summary = f"{job_name}: attribution processed={processed}, errors={errors}"

    if phase == "aggregate":
        state = get_sync_state(job_name)
        aggregate_property_index = int(state.get("aggregate_property_index", 0))
        processed = 0
        errors = 0
        last_results = []

        while processed < property_batch_size and aggregate_property_index < len(property_ids):
            property_id = property_ids[aggregate_property_index]
            try:
                print(f"{job_name}: ROI aggregate for property {property_id}")
                result = aggregate_roi_for_property(property_id, report_start_date, report_end_date)
                last_results.append(result)
                processed += 1
            except Exception as error:
                errors += 1
                print(f"{job_name}: ROI aggregate error on property {property_id}: {error}")
            aggregate_property_index += 1
            time.sleep(1)

        phase_complete = aggregate_property_index >= len(property_ids)
        set_sync_state(
            job_name,
            {
                "phase": "done" if phase_complete else "aggregate",
                "aggregate_property_index": aggregate_property_index,
                "active": not phase_complete,
                "completed": phase_complete,
                "completed_at": _iso_now() if phase_complete else None,
                "last_processed_at": _iso_now(),
                "last_summary": f"aggregate processed={processed}, errors={errors}, next_property_index={aggregate_property_index}",
                "last_aggregate_results": last_results[-3:],
            },
        )
        summary = f"{job_name}: aggregate processed={processed}, errors={errors}"

    return summary or f"{job_name}: no work"


def fetch_and_store_ga4_dashboard(property_id: str, ga4_property_id: str, start_date_value: str | None = None, end_date_value: str | None = None, default_days: int = 90) -> dict[str, Any]:
    payload = legacy.fetch_ga4_dashboard_payload(
        property_id=property_id,
        ga4_property_id=ga4_property_id,
        start_date_value=start_date_value,
        end_date_value=end_date_value,
        default_days=default_days,
    )
    _ensure_property_row(str(property_id))
    _upsert_row(
        "property_analytics_snapshots",
        {
            "property_id": str(property_id),
            "snapshot_type": "ga4_dashboard",
            "fetched_at": _iso_now(),
            "payload": payload,
            "firestore_path": f"properties/{property_id}/analytics/ga4_dashboard",
        },
        "property_id,snapshot_type",
    )
    return {**payload, "source": "supabase", "staging_only": True}


def fetch_and_store_google_ads_dashboard(property_id: str, google_ads_customer_id: str, property_name: str | None = None, start_date_value: str | None = None, end_date_value: str | None = None, default_days: int = 90) -> dict[str, Any]:
    payload = legacy.fetch_google_ads_dashboard_payload(
        property_id=property_id,
        google_ads_customer_id=google_ads_customer_id,
        property_name=property_name,
        start_date_value=start_date_value,
        end_date_value=end_date_value,
        default_days=default_days,
    )
    _ensure_property_row(str(property_id), property_name=property_name)
    _upsert_row(
        "property_analytics_snapshots",
        {
            "property_id": str(property_id),
            "snapshot_type": "google_ads_dashboard",
            "fetched_at": _iso_now(),
            "payload": payload,
            "firestore_path": f"properties/{property_id}/analytics/google_ads_dashboard",
        },
        "property_id,snapshot_type",
    )
    return {**payload, "source": "supabase", "staging_only": True}


def fetch_and_store_meta_ads_dashboard(property_id: str, meta_ads_account_id: str, property_name: str | None = None, match_terms: Any | None = None, campaign_ids: Any | None = None, attribution_mode: str | None = None, start_date_value: str | None = None, end_date_value: str | None = None, default_days: int = 90, force_refresh: bool = False) -> dict[str, Any]:
    window = legacy.resolve_reporting_window(start_date_value, end_date_value, default_days=default_days)
    cache_key = legacy.build_meta_ads_cache_key(
        meta_ads_account_id,
        window["current_start"].isoformat(),
        window["current_end"].isoformat(),
        legacy.resolve_meta_ads_attribution_config(attribution_mode)["mode"],
        campaign_ids,
        match_terms,
    )
    current = _get_row(
        "property_analytics_snapshots",
        [("property_id", f"eq.{property_id}"), ("snapshot_type", "eq.meta_ads_dashboard")],
    )
    if not force_refresh and current:
        payload = current.get("payload") or {}
        fetched_at = current.get("fetched_at")
        fetched_at_dt = datetime.datetime.fromisoformat(str(fetched_at).replace("Z", "+00:00")) if fetched_at else None
        now_utc = datetime.datetime.now(datetime.timezone.utc)
        cache_max_minutes = int(legacy.os.environ.get("META_ADS_CACHE_MINUTES", "20"))
        cache_is_fresh = fetched_at_dt and (now_utc - fetched_at_dt).total_seconds() <= cache_max_minutes * 60
        if payload.get("cacheKey") == cache_key and cache_is_fresh:
            return {**payload, "source": "supabase", "staging_only": True}

    payload = legacy.fetch_meta_ads_dashboard_payload(
        property_id=property_id,
        meta_ads_account_id=meta_ads_account_id,
        property_name=property_name,
        match_terms=match_terms,
        campaign_ids=campaign_ids,
        attribution_mode=attribution_mode,
        start_date_value=start_date_value,
        end_date_value=end_date_value,
        default_days=default_days,
    )
    _ensure_property_row(str(property_id), property_name=property_name)
    _upsert_row(
        "property_analytics_snapshots",
        {
            "property_id": str(property_id),
            "snapshot_type": "meta_ads_dashboard",
            "fetched_at": _iso_now(),
            "payload": {**payload, "cacheKey": cache_key},
            "firestore_path": f"properties/{property_id}/analytics/meta_ads_dashboard",
        },
        "property_id,snapshot_type",
    )
    return {**payload, "cacheKey": cache_key, "source": "supabase", "staging_only": True}


def fetch_and_store_reputation_dashboard(property_id: str, location_id: str | None = None, location_name: str | None = None, property_name: str | None = None, property_city: str | None = None, start_date_value: str | None = None, end_date_value: str | None = None, default_days: int = 90) -> dict[str, Any]:
    email = legacy.os.environ.get("OPINIION_USER_EMAIL")
    password = legacy.os.environ.get("OPINIION_USER_PASSWORD")
    if not email or not password:
        raise ValueError("OPINIION_USER_EMAIL and OPINIION_USER_PASSWORD secrets must be configured.")

    property_context = _get_property_context(str(property_id))
    window = legacy.resolve_reporting_window(start_date_value, end_date_value, default_days=default_days)
    locations = legacy.fetch_opiniion_user_locations(email, password)
    if not locations:
        raise ValueError("No Opiniion locations were returned for the configured user.")

    resolved_location = legacy.resolve_opiniion_location(
        property_id,
        property_context,
        locations,
        explicit_location_id=location_id,
        explicit_location_name=location_name,
        property_name=property_name,
        property_city=property_city,
    )
    location_details = legacy.fetch_opiniion_location_details(
        resolved_location["locationId"],
        resolved_location["apiKey"],
    )

    start_dt = datetime.datetime.combine(window["current_start"], datetime.time.min, tzinfo=legacy.APP_TIMEZONE)
    end_dt = datetime.datetime.combine(window["current_end"], datetime.time.max, tzinfo=legacy.APP_TIMEZONE)
    reviews = legacy.fetch_opiniion_reviews(
        resolved_location["locationId"],
        resolved_location["apiKey"],
        start_ms=int(start_dt.timestamp() * 1000),
        end_ms=int(end_dt.timestamp() * 1000),
    )
    normalized = legacy.normalize_reputation_payload(
        {"location": location_details, "reviews": reviews},
        property_id,
        resolved_location["locationId"],
        resolved_location.get("name"),
        window,
    )
    normalized["overview"]["averageRating"] = legacy.parse_numeric_candidate(location_details.get("currentGoogleRating"))
    normalized["overview"]["reviewCount"] = len(reviews)
    normalized["recentReviews"] = legacy.map_opiniion_reviews(reviews, resolved_location["locationId"])
    normalized["summary"] = [
        f"Matched Opiniion location: {resolved_location.get('name')} ({resolved_location['locationId']})",
        f"Fetched {len(reviews)} reviews in the selected window.",
    ]
    normalized["rawTopLevelKeys"] = ["location", "reviews"]
    payload = normalized
    _ensure_property_row(str(property_id), property_name=property_name)
    _upsert_row(
        "property_analytics_snapshots",
        {
            "property_id": str(property_id),
            "snapshot_type": "reputation_dashboard",
            "fetched_at": _iso_now(),
            "payload": payload,
            "firestore_path": f"properties/{property_id}/analytics/reputation_dashboard",
        },
        "property_id,snapshot_type",
    )
    return {**payload, "source": "supabase", "staging_only": True}


def trigger_entrata_backfill(days: int = 30, start_from: int = 0, property_ids: list[int] | None = None) -> dict[str, Any]:
    property_ids = property_ids or legacy.get_automation_property_ids()
    success_count = 0
    error_count = 0
    for property_id in property_ids:
        for offset in range(start_from, days):
            requested = legacy.get_local_now() - datetime.timedelta(days=offset)
            date_str = requested.strftime("%m/%d/%Y")
            try:
                sync_property_date(property_id, date_str)
                success_count += 1
            except Exception as error:
                error_count += 1
                print(f"Error on property {property_id} for {date_str}: {error}")
            time.sleep(2)
    return {
        "status": "ok",
        "property_count": len(property_ids),
        "success_count": success_count,
        "error_count": error_count,
        "days": days,
        "start_from": start_from,
        "source": "supabase",
    }


def run_named_cron_job(job_name: str) -> dict[str, Any]:
    today_str = datetime.datetime.now().strftime("%m/%d/%Y")
    property_ids = legacy.get_automation_property_ids()
    default_property_id = int(legacy.ENTRATA_PROPERTY_ID)

    if job_name == "fetch_daily_entrata_leads":
        result = legacy.fetch_leads_for_date(default_property_id, today_str)
    elif job_name == "fetch_daily_entrata_events":
        result = legacy.fetch_events_for_date(default_property_id, today_str)
    elif job_name == "fetch_daily_entrata_leases":
        result = legacy.fetch_leases_for_date(default_property_id, today_str)
    elif job_name == "fetch_daily_entrata_invoices":
        result = legacy.fetch_invoices_for_date(default_property_id, today_str)
    elif job_name == "fetch_daily_entrata_availability":
        result = {
            "status": "skipped",
            "reason": "Legacy /v1/properties availability sync is disabled on Render; use propertyunits availability pricing snapshot instead.",
            "property_id": default_property_id,
            "date": today_str,
        }
    elif job_name == "sync_daily_entrata_specials":
        result = []
        for property_id in property_ids:
            try:
                result.append(legacy.fetch_specials(property_id))
            except Exception as error:
                result.append(
                    {
                        "property_id": property_id,
                        "changed": False,
                        "error": str(error),
                    }
                )
    elif job_name == "sync_daily_entrata_units_availability_pricing":
        result = []
        for property_id in property_ids:
            try:
                result.append(legacy.fetch_units_availability_and_pricing(property_id))
            except Exception as error:
                result.append(
                    {
                        "property_id": property_id,
                        "changed": False,
                        "error": str(error),
                    }
                )
    elif job_name == "sync_daily_entrata_lease_attribution":
        result = sync_lease_attribution(property_ids)
    elif job_name == "aggregate_daily_roi":
        result = aggregate_roi(property_ids)
    elif job_name == "start_daily_roi_pipeline":
        end_date = legacy.get_local_now().date()
        raw_start_date = end_date - datetime.timedelta(days=max(legacy.ROI_DAILY_RAW_LOOKBACK_DAYS - 1, 0))
        report_start_date = end_date - datetime.timedelta(days=max(legacy.ROI_DAILY_REPORT_LOOKBACK_DAYS - 1, 0))
        try:
            result = start_roi_pipeline_job(
                "roi_daily_pipeline",
                property_ids,
                raw_start_date=raw_start_date,
                raw_end_date=end_date,
                report_start_date=report_start_date,
                report_end_date=end_date,
                initiated_by="scheduler",
            )
        except Exception as error:
            print(
                "start_daily_roi_pipeline failed "
                f"raw_start_date={raw_start_date} raw_end_date={end_date} "
                f"report_start_date={report_start_date} report_end_date={end_date} "
                f"property_count={len(property_ids)} error={error}"
            )
            raise
    elif job_name == "run_roi_pipeline_jobs":
        result = [process_roi_pipeline_job("roi_ytd_backfill"), process_roi_pipeline_job("roi_daily_pipeline")]
    elif job_name == "run_background_entrata_backfill":
        result = process_background_backfill_batch()
    elif job_name == "run_daily_entrata_refresh":
        result = process_daily_refresh_batch()
    elif job_name == "run_entrata_retry_queue":
        result = process_retry_queue_batch()
    elif job_name == "weekly_site_audit":
        import site_audit

        result = site_audit.save_audit(site_audit.perform_site_audit())
    else:
        raise ValueError(f"Unsupported cron job: {job_name}")

    return {"status": "ok", "job_name": job_name, "result": result, "source": "supabase", "staging_only": True}


def install_render_storage_overrides() -> None:
    legacy.save_raw_data = save_raw_data
    legacy.store_property_specials = store_property_specials
    legacy.store_property_availability_pricing = store_property_availability_pricing
