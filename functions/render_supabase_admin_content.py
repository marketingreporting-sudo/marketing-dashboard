import json
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from render_supabase_sync_state import _table_query_url
from render_supabase_validation import (
    SupabaseValidationConfigError,
    _supabase_anon_headers,
)


def _fetch_singleton_row(table_name: str, property_id: str, *, access_token: str | None = None) -> dict[str, Any] | None:
    request = Request(
        _table_query_url(
            table_name,
            [
                ("select", "*"),
                ("property_id", f"eq.{property_id}"),
                ("limit", "1"),
            ],
        ),
        headers=_supabase_anon_headers(access_token),
        method="GET",
    )
    with urlopen(request, timeout=30) as response:
        rows = json.loads(response.read().decode("utf-8"))
    return rows[0] if rows else None


def _upsert_singleton_row(table_name: str, row: dict[str, Any], *, access_token: str | None = None) -> dict[str, Any]:
    headers = {
        **_supabase_anon_headers(access_token),
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=representation",
    }
    request = Request(
        _table_query_url(
            table_name,
            [
                ("on_conflict", "property_id"),
            ],
        ),
        headers=headers,
        data=json.dumps(row).encode("utf-8"),
        method="POST",
    )
    with urlopen(request, timeout=30) as response:
        payload = json.loads(response.read().decode("utf-8"))

    if isinstance(payload, list):
        return payload[0] if payload else row
    if isinstance(payload, dict):
        return payload
    return row


def _shape_website_manager_row(row: dict[str, Any] | None, property_id: str) -> dict[str, Any]:
    safe_row = row or {}
    return {
        "propertyId": property_id,
        "propertyName": safe_row.get("property_name") or "",
        "platform": safe_row.get("platform") or "unknown",
        "websiteUrl": safe_row.get("website_url") or "",
        "wordpressSiteKey": safe_row.get("wordpress_site_key") or "",
        "notes": safe_row.get("notes") or "",
        "editable": bool(safe_row.get("editable") or False),
        "content": safe_row.get("content") if isinstance(safe_row.get("content"), dict) else {},
        "updatedAt": safe_row.get("updated_at"),
        "createdAt": safe_row.get("created_at"),
        "firestorePath": safe_row.get("firestore_path"),
    }


def _shape_reporting_layout_row(row: dict[str, Any] | None, property_id: str) -> dict[str, Any]:
    safe_row = row or {}
    panel_order = safe_row.get("panel_order")
    hidden_panel_ids = safe_row.get("hidden_panel_ids")
    return {
        "propertyId": property_id,
        "propertyName": safe_row.get("property_name") or "",
        "panelOrder": panel_order if isinstance(panel_order, list) else [],
        "hiddenPanelIds": hidden_panel_ids if isinstance(hidden_panel_ids, list) else [],
        "updatedAt": safe_row.get("updated_at"),
        "createdAt": safe_row.get("created_at"),
        "firestorePath": safe_row.get("firestore_path"),
    }


def get_website_manager_summary(property_id: str, access_token: str | None = None) -> dict[str, Any]:
    try:
        row = _fetch_singleton_row("property_website_manager_current", property_id, access_token=access_token)
    except (HTTPError, URLError, SupabaseValidationConfigError) as error:
        return {
            "status": "error",
            "error": str(error),
            "staging_only": True,
        }

    return {
        "status": "ok",
        "source": "supabase",
        "staging_only": True,
        "record": _shape_website_manager_row(row, property_id),
    }


def save_website_manager_summary(property_id: str, payload: dict[str, Any], access_token: str | None = None) -> dict[str, Any]:
    editable = str(payload.get("platform") or "unknown") == "wordpress_custom"
    row = {
        "property_id": property_id,
        "property_name": payload.get("propertyName") or "",
        "platform": payload.get("platform") or "unknown",
        "website_url": payload.get("websiteUrl") or "",
        "wordpress_site_key": payload.get("wordpressSiteKey") or "",
        "notes": payload.get("notes") or "",
        "editable": editable,
        "content": payload.get("content") if isinstance(payload.get("content"), dict) else {},
        "firestore_path": payload.get("firestorePath") or f"properties/{property_id}/website_manager/current",
    }

    try:
        saved_row = _upsert_singleton_row("property_website_manager_current", row, access_token=access_token)
    except (HTTPError, URLError, SupabaseValidationConfigError) as error:
        return {
            "status": "error",
            "error": str(error),
            "staging_only": True,
        }

    return {
        "status": "ok",
        "source": "supabase",
        "staging_only": True,
        "record": _shape_website_manager_row(saved_row, property_id),
    }


def get_reporting_layout_summary(property_id: str, access_token: str | None = None) -> dict[str, Any]:
    try:
        row = _fetch_singleton_row("property_reporting_layout_current", property_id, access_token=access_token)
    except (HTTPError, URLError, SupabaseValidationConfigError) as error:
        return {
            "status": "error",
            "error": str(error),
            "staging_only": True,
        }

    return {
        "status": "ok",
        "source": "supabase",
        "staging_only": True,
        "record": _shape_reporting_layout_row(row, property_id),
    }


def save_reporting_layout_summary(property_id: str, payload: dict[str, Any], access_token: str | None = None) -> dict[str, Any]:
    row = {
        "property_id": property_id,
        "property_name": payload.get("propertyName") or "",
        "panel_order": payload.get("panelOrder") if isinstance(payload.get("panelOrder"), list) else [],
        "hidden_panel_ids": payload.get("hiddenPanelIds") if isinstance(payload.get("hiddenPanelIds"), list) else [],
        "firestore_path": payload.get("firestorePath") or f"properties/{property_id}/reporting_layout/current",
    }

    try:
        saved_row = _upsert_singleton_row("property_reporting_layout_current", row, access_token=access_token)
    except (HTTPError, URLError, SupabaseValidationConfigError) as error:
        return {
            "status": "error",
            "error": str(error),
            "staging_only": True,
        }

    return {
        "status": "ok",
        "source": "supabase",
        "staging_only": True,
        "record": _shape_reporting_layout_row(saved_row, property_id),
    }
