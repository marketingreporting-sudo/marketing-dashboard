import json
import os
import hmac
import hashlib
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlparse
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from render_supabase_sync_state import _table_query_url
from render_supabase_validation import (
    SupabaseValidationConfigError,
    _supabase_anon_headers,
    _supabase_headers,
)


WORDPRESS_FIELD_MAP = {
    "heroHeadline": "hero_headline",
    "heroSubheadline": "hero_subtitle",
    "heroPrimaryCtaLabel": "primary_cta_label",
    "heroPrimaryCtaUrl": "primary_cta_url",
    "heroSecondaryCtaLabel": "secondary_cta_label",
    "heroSecondaryCtaUrl": "secondary_cta_url",
    "bannerEyebrow": "banner_eyebrow",
    "bannerHeadline": "banner_headline",
    "bannerBody": "banner_body",
    "floorplansHeadline": "floorplans_headline",
    "floorplansBody": "floorplans_body",
    "availabilityNote": "availability_note",
}

DERIVED_CONTENT_DEFAULTS = {
    "specialsSummary": "",
    "specialsCount": 0,
    "pricingSummary": "",
    "availabilitySummary": "",
    "availabilityUrl": "",
    "startingPrice": "",
    "priceRange": "",
    "floorplanCount": 0,
    "availableUnitCount": 0,
    "specialsLastSyncedAt": None,
    "pricingLastSyncedAt": None,
}

WORDPRESS_DERIVED_FIELD_MAP = {
    "specialsSummary": "specials_summary",
    "specialsCount": "specials_count",
    "pricingSummary": "pricing_summary",
    "availabilitySummary": "availability_summary",
    "availabilityUrl": "availability_url",
    "startingPrice": "starting_price",
    "priceRange": "price_range",
    "floorplanCount": "floorplan_count",
    "availableUnitCount": "available_unit_count",
}

WORDPRESS_PUBLISH_USER_AGENT = "RedstoneWebsiteManager/1.1 (+https://github.com/marketingreporting-sudo/marketing-dashboard)"
WEBSITE_MANAGER_SCHEMA_META_KEY = "__schema"

WEBSITE_MANAGER_DEFAULT_SCHEMA = {
    "groups": [
        {
            "id": "homepage",
            "label": "Homepage",
            "fields": [
                {"key": "headline", "label": "Headline", "type": "richtext"},
                {"key": "subtitle", "label": "Subtitle", "type": "richtext"},
                {"key": "cta_button", "label": "Primary CTA Label", "type": "text"},
                {"key": "cta_button_link", "label": "Primary CTA URL", "type": "url"},
                {"key": "top_banner", "label": "Top Banner", "type": "richtext"},
                {"key": "top_banner_link", "label": "Top Banner URL", "type": "url"},
            ],
        }
    ]
}


def _normalize_text(value: Any) -> str:
    return str(value or "").strip()


def _normalize_slug(value: Any) -> str:
    return "".join(ch.lower() for ch in _normalize_text(value) if ch.isalnum())


def _humanize_identifier(value: Any) -> str:
    text = _normalize_text(value).replace("-", " ").replace("_", " ")
    words = [word for word in text.split() if word]
    return " ".join(word.upper() if word.lower() == "ada" else word.capitalize() for word in words) or "Untitled"


def _load_website_manager_seed_schemas() -> dict[str, Any]:
    seed_path = Path(__file__).with_name("website_manager_seed_schemas.json")
    if not seed_path.exists():
        return {}
    try:
        payload = json.loads(seed_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}
    return payload if isinstance(payload, dict) else {}


WEBSITE_MANAGER_SEED_SCHEMAS = _load_website_manager_seed_schemas()


def _normalize_schema_field(field: Any) -> dict[str, str] | None:
    if not isinstance(field, dict):
        return None
    key = _normalize_text(field.get("key"))
    if not key:
        return None
    field_type = _normalize_text(field.get("type")).lower() or "text"
    if field_type not in {"text", "url", "richtext"}:
        field_type = "text"
    return {
        "key": key,
        "label": _normalize_text(field.get("label")) or _humanize_identifier(key),
        "type": field_type,
        "placeholder": _normalize_text(field.get("placeholder")),
    }


def _normalize_schema(schema: Any) -> dict[str, Any]:
    if not isinstance(schema, dict):
        schema = {}
    groups_value = schema.get("groups")
    if not isinstance(groups_value, list):
        groups_value = WEBSITE_MANAGER_DEFAULT_SCHEMA["groups"]

    groups: list[dict[str, Any]] = []
    seen_field_keys: set[str] = set()
    for index, group in enumerate(groups_value):
        if not isinstance(group, dict):
            continue
        group_id = _normalize_text(group.get("id")) or f"group_{index + 1}"
        label = _normalize_text(group.get("label")) or _humanize_identifier(group_id)
        field_items = []
        for field in group.get("fields", []):
            normalized_field = _normalize_schema_field(field)
            if not normalized_field:
                continue
            if normalized_field["key"] in seen_field_keys:
                continue
            seen_field_keys.add(normalized_field["key"])
            field_items.append(normalized_field)
        if field_items:
            groups.append({"id": group_id, "label": label, "fields": field_items})

    if not groups:
        return _normalize_schema(WEBSITE_MANAGER_DEFAULT_SCHEMA)
    return {"groups": groups}


def _schema_content_defaults(schema: dict[str, Any]) -> dict[str, str]:
    defaults: dict[str, str] = {}
    for group in schema.get("groups", []):
        for field in group.get("fields", []):
            defaults[str(field.get("key"))] = ""
    return defaults


def _match_seed_schema(row: dict[str, Any]) -> dict[str, Any] | None:
    site_key = _normalize_text(row.get("wordpress_site_key"))
    if site_key and site_key in WEBSITE_MANAGER_SEED_SCHEMAS:
        return WEBSITE_MANAGER_SEED_SCHEMAS[site_key]

    website_url = _normalize_text(row.get("website_url"))
    hostname = _normalize_slug(urlparse(website_url if "://" in website_url else f"https://{website_url}").netloc)
    property_name = _normalize_slug(row.get("property_name"))

    for candidate in WEBSITE_MANAGER_SEED_SCHEMAS.values():
        if not isinstance(candidate, dict):
            continue
        candidate_host = _normalize_slug(
            urlparse(
                _normalize_text(candidate.get("websiteUrl"))
                if "://" in _normalize_text(candidate.get("websiteUrl"))
                else f"https://{_normalize_text(candidate.get('websiteUrl'))}"
            ).netloc
        )
        if hostname and candidate_host == hostname:
            return candidate
        if property_name and _normalize_slug(candidate.get("propertyName")) == property_name:
            return candidate
    return None


def _extract_schema_from_content(content: Any, row: dict[str, Any]) -> tuple[dict[str, str], dict[str, Any]]:
    safe_content = content if isinstance(content, dict) else {}
    schema = safe_content.get(WEBSITE_MANAGER_SCHEMA_META_KEY)
    if not isinstance(schema, dict):
        matched_seed = _match_seed_schema(row)
        schema = matched_seed if isinstance(matched_seed, dict) else WEBSITE_MANAGER_DEFAULT_SCHEMA
    normalized_schema = _normalize_schema(schema)
    content_values = {
        key: _normalize_text(value)
        for key, value in safe_content.items()
        if key != WEBSITE_MANAGER_SCHEMA_META_KEY
    }
    defaults = _schema_content_defaults(normalized_schema)
    defaults.update(content_values)
    return defaults, normalized_schema


def _compose_stored_content(content: Any, schema: dict[str, Any]) -> dict[str, Any]:
    safe_content = content if isinstance(content, dict) else {}
    merged = {
        key: _normalize_text(value)
        for key, value in safe_content.items()
        if key != WEBSITE_MANAGER_SCHEMA_META_KEY
    }
    merged[WEBSITE_MANAGER_SCHEMA_META_KEY] = _normalize_schema(schema)
    return merged


def _parse_number(value: Any) -> float | None:
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        return float(value)
    normalized = str(value).strip().replace("$", "").replace(",", "")
    try:
        return float(normalized)
    except ValueError:
        return None


def _format_currency(value: float | None) -> str:
    if value is None:
        return ""
    return f"${value:,.0f}"


def _format_timestamp(value: Any) -> str | None:
    if not value:
        return None
    if isinstance(value, str):
        return value
    if isinstance(value, datetime):
        return value.astimezone(UTC).isoformat()
    return str(value)


def _parse_timestamp(value: Any) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value
    normalized = str(value).strip()
    if not normalized:
        return None
    if normalized.endswith("Z"):
        normalized = normalized[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(normalized)
    except ValueError:
        return None


def _max_timestamp(*values: Any) -> str | None:
    parsed = [item for item in (_parse_timestamp(value) for value in values) if item is not None]
    if not parsed:
        return None
    return max(parsed).astimezone(UTC).isoformat()


def _find_nested_value(value: Any, candidate_keys: tuple[str, ...]) -> Any:
    normalized_keys = {candidate.lower() for candidate in candidate_keys}

    def visit(current: Any) -> Any:
        if current is None:
            return None
        if isinstance(current, list):
            for item in current:
                found = visit(item)
                if found not in (None, ""):
                    return found
            return None
        if isinstance(current, dict):
            for key, nested in current.items():
                if str(key).lower() in normalized_keys and nested not in (None, ""):
                    if isinstance(nested, (dict, list)):
                        nested_value = visit(nested)
                        if nested_value not in (None, ""):
                            return nested_value
                    else:
                        return nested
            for nested in current.values():
                found = visit(nested)
                if found not in (None, ""):
                    return found
        return None

    return visit(value)


def _ensure_list(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]


def _get_property_unit_spaces(unit: Any) -> list[Any]:
    unit_space = unit.get("UnitSpace") if isinstance(unit, dict) else None
    if not isinstance(unit_space, dict):
        return []
    return [value for value in unit_space.values() if value is not None]


def _get_price_range_from_attrs(value: Any, min_key: str, max_key: str) -> tuple[float | None, float | None]:
    attrs = value.get("@attributes") if isinstance(value, dict) else None
    if not isinstance(attrs, dict):
        attrs = {}
    return _parse_number(attrs.get(min_key)), _parse_number(attrs.get(max_key))


def _get_floorplan_price_min(floorplan: Any) -> float | None:
    market_rent = floorplan.get("MarketRent") if isinstance(floorplan, dict) else None
    if not isinstance(market_rent, dict):
        return None
    min_price, max_price = _get_price_range_from_attrs(market_rent, "Min", "Max")
    return min_price if min_price is not None else max_price


def _get_unit_price(space: Any) -> float | None:
    rent = space.get("Rent") if isinstance(space, dict) else None
    if not isinstance(rent, dict):
        return None
    min_price, max_price = _get_price_range_from_attrs(rent, "MinRent", "MaxRent")
    return min_price if min_price is not None else max_price


def _is_available_unit(unit: Any) -> bool:
    status_value = _find_nested_value(
        unit,
        ("availabilityStatus", "status", "leaseStatus", "Availability", "Status", "Available", "IsAvailable"),
    )
    normalized = str(status_value or "").strip().lower()
    return "available" in normalized or normalized == "true"


def _extract_special_items(snapshot: Any) -> list[dict[str, Any]]:
    if isinstance(snapshot, dict) and isinstance(snapshot.get("specials"), list):
        return [item for item in snapshot["specials"] if isinstance(item, dict)]

    specials_root = snapshot.get("specials") if isinstance(snapshot, dict) else None
    if isinstance(specials_root, dict):
        grouped = specials_root.get("propertySpecials", {}).get("special") if isinstance(
            specials_root.get("propertySpecials"), dict
        ) else None
        if isinstance(grouped, dict):
            return [item for item in grouped.values() if isinstance(item, dict)]
        if isinstance(grouped, list):
            return [item for item in grouped if isinstance(item, dict)]

    return []


def _get_special_title(special: dict[str, Any]) -> str:
    title = _find_nested_value(
        special,
        ("specialName", "specialTitle", "marketingName", "headline", "title", "name", "label", "incentiveName"),
    )
    return _normalize_text(title) or "Untitled special"


def _build_derived_content(specials_row: dict[str, Any] | None, pricing_row: dict[str, Any] | None) -> dict[str, Any]:
    derived = dict(DERIVED_CONTENT_DEFAULTS)

    special_items = _extract_special_items(specials_row or {})
    special_titles = [_get_special_title(item) for item in special_items]
    if special_titles:
        derived["specialsSummary"] = "; ".join(special_titles[:3])
        if len(special_titles) > 3:
            derived["specialsSummary"] += f" +{len(special_titles) - 3} more"
    derived["specialsCount"] = len(special_titles)
    derived["specialsLastSyncedAt"] = _format_timestamp((specials_row or {}).get("last_synced_at"))

    floorplans = pricing_row.get("floorplans") if isinstance(pricing_row, dict) else None
    units = pricing_row.get("units") if isinstance(pricing_row, dict) else None
    floorplan_items = [item for item in _ensure_list(floorplans) if isinstance(item, dict)]
    unit_items = [item for item in _ensure_list(units) if isinstance(item, dict)]
    unit_spaces = [space for unit in unit_items for space in _get_property_unit_spaces(unit)]
    priced_values = [value for value in (_get_unit_price(space) for space in unit_spaces) if value is not None]
    if not priced_values:
        priced_values = [value for value in (_get_floorplan_price_min(plan) for plan in floorplan_items) if value is not None]

    available_units = [unit for unit in unit_items if _is_available_unit(unit)]
    min_price = min(priced_values) if priced_values else None
    max_price = max(priced_values) if priced_values else None

    derived["startingPrice"] = _format_currency(min_price)
    if min_price is not None and max_price is not None:
        derived["priceRange"] = (
            derived["startingPrice"]
            if min_price == max_price
            else f"{_format_currency(min_price)} - {_format_currency(max_price)}"
        )
    derived["floorplanCount"] = len(floorplan_items)
    derived["availableUnitCount"] = len(available_units)
    derived["availabilityUrl"] = _normalize_text((pricing_row or {}).get("availability_url"))
    derived["pricingLastSyncedAt"] = _format_timestamp((pricing_row or {}).get("last_synced_at"))

    availability_parts = []
    if derived["availableUnitCount"]:
        availability_parts.append(f"{derived['availableUnitCount']} units available")
    elif unit_items:
        availability_parts.append(f"{len(unit_items)} units tracked")
    if derived["floorplanCount"]:
        availability_parts.append(f"{derived['floorplanCount']} floorplans")
    derived["availabilitySummary"] = " | ".join(availability_parts)

    if min_price is not None:
        derived["pricingSummary"] = (
            f"Now leasing from {derived['startingPrice']}"
            + (f" across {derived['floorplanCount']} floorplans" if derived["floorplanCount"] else "")
        )

    return derived


def _build_wordpress_sync_status(row: dict[str, Any], derived_content: dict[str, Any]) -> dict[str, Any]:
    website_url = _normalize_text(row.get("website_url"))
    site_key = _normalize_text(row.get("wordpress_site_key"))
    platform = _normalize_text(row.get("platform")) or "unknown"
    target_url = urljoin(website_url.rstrip("/") + "/", "wp-json/redstone-site-manager/v1/content") if website_url else ""
    return {
        "publishEnabled": platform == "wordpress_custom" and bool(website_url and site_key),
        "targetUrl": target_url,
        "siteKeyConfigured": bool(site_key),
        "websiteUrlConfigured": bool(website_url),
        "latestEntrataSyncAt": _max_timestamp(
            derived_content.get("specialsLastSyncedAt"),
            derived_content.get("pricingLastSyncedAt"),
        ),
    }


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
        headers=_supabase_anon_headers(access_token) if access_token else _supabase_headers(),
        method="GET",
    )
    with urlopen(request, timeout=30) as response:
        rows = json.loads(response.read().decode("utf-8"))
    return rows[0] if rows else None


def _upsert_singleton_row(table_name: str, row: dict[str, Any], *, access_token: str | None = None) -> dict[str, Any]:
    headers = {
        **(_supabase_anon_headers(access_token) if access_token else _supabase_headers()),
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


def _fetch_rows(
    table_name: str,
    query_pairs: list[tuple[str, str]],
    *,
    access_token: str | None = None,
) -> list[dict[str, Any]]:
    request = Request(
        _table_query_url(table_name, query_pairs),
        headers=_supabase_anon_headers(access_token) if access_token else _supabase_headers(),
        method="GET",
    )
    with urlopen(request, timeout=30) as response:
        rows = json.loads(response.read().decode("utf-8"))
    return rows if isinstance(rows, list) else []


def _fetch_property_row(property_id: str, *, access_token: str | None = None) -> dict[str, Any] | None:
    rows = _fetch_rows(
        "properties",
        [
            ("select", "id,name"),
            ("id", f"eq.{property_id}"),
            ("limit", "1"),
        ],
        access_token=access_token,
    )
    return rows[0] if rows else None


def _normalize_tracking_feature_flags(value: Any) -> dict[str, bool]:
    source = value if isinstance(value, dict) else {}
    return {
        "heatmaps": bool(source.get("heatmaps", True)),
        "pageSnapshots": bool(source.get("pageSnapshots", source.get("page_snapshots", True))),
        "screenshots": bool(source.get("screenshots", False)),
    }


def _normalize_tracking_consent_mode(value: Any) -> str:
    mode = str(value or "").strip().lower()
    return mode if mode in {"opt_out", "required", "disabled"} else "opt_out"


def _bounded_tracking_int(value: Any, default: int, minimum: int, maximum: int) -> int:
    try:
        number = int(float(value))
    except (TypeError, ValueError):
        number = default
    return max(minimum, min(maximum, number))


def _fetch_primary_heatmap_site(property_id: str, *, access_token: str | None = None) -> dict[str, Any] | None:
    rows = _fetch_rows(
        "property_heatmap_sites",
        [
            ("select", "id,site_key,name,allowed_domains,tracking_enabled,sampling_rate,feature_flags,screenshot_capture_frequency,consent_mode,respect_dnt,screenshot_min_interval_hours,raw_event_retention_days,aggregate_retention_days"),
            ("property_id", f"eq.{property_id}"),
            ("order", "created_at.asc"),
            ("limit", "1"),
        ],
        access_token=access_token,
    )
    if not rows:
        return None
    row = rows[0]
    return {
        "id": row.get("id"),
        "siteKey": row.get("site_key") or "",
        "name": row.get("name") or "",
        "allowedDomains": row.get("allowed_domains") if isinstance(row.get("allowed_domains"), list) else [],
        "trackingEnabled": bool(row.get("tracking_enabled")),
        "samplingRate": float(row.get("sampling_rate") or 0.10),
        "featureFlags": _normalize_tracking_feature_flags(row.get("feature_flags")),
        "screenshotCaptureFrequency": row.get("screenshot_capture_frequency") or "manual",
        "consentMode": _normalize_tracking_consent_mode(row.get("consent_mode")),
        "respectDnt": row.get("respect_dnt") is not False,
        "screenshotMinIntervalHours": _bounded_tracking_int(row.get("screenshot_min_interval_hours"), 24, 1, 720),
        "rawEventRetentionDays": _bounded_tracking_int(row.get("raw_event_retention_days"), 90, 1, 365),
        "aggregateRetentionDays": _bounded_tracking_int(row.get("aggregate_retention_days"), 730, 30, 3650),
        "trackerUrl": (
            os.environ.get("HEATMAP_TRACKER_PUBLIC_URL")
            or (f"{os.environ.get('RENDER_EXTERNAL_URL', '').rstrip('/')}/api/heatmaps/tracker.js" if os.environ.get("RENDER_EXTERNAL_URL") else "")
        ),
    }


def _shape_website_manager_row(row: dict[str, Any] | None, property_id: str) -> dict[str, Any]:
    safe_row = row or {}
    content_values, schema = _extract_schema_from_content(safe_row.get("content"), safe_row)
    derived_content = _build_derived_content(
        safe_row.get("_specials_row") if isinstance(safe_row.get("_specials_row"), dict) else None,
        safe_row.get("_pricing_row") if isinstance(safe_row.get("_pricing_row"), dict) else None,
    )
    return {
        "propertyId": property_id,
        "propertyName": safe_row.get("property_name") or "",
        "platform": safe_row.get("platform") or "unknown",
        "websiteUrl": safe_row.get("website_url") or "",
        "wordpressSiteKey": safe_row.get("wordpress_site_key") or "",
        "notes": safe_row.get("notes") or "",
        "editable": bool(safe_row.get("editable") or False),
        "content": content_values,
        "schema": schema,
        "derivedContent": derived_content,
        "wordpressSync": _build_wordpress_sync_status(safe_row, derived_content),
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
        property_row = _fetch_property_row(property_id, access_token=access_token)
        specials_row = _fetch_singleton_row("property_specials_current", property_id, access_token=access_token)
        pricing_row = _fetch_singleton_row("property_availability_snapshots", property_id, access_token=access_token)
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
        "record": _shape_website_manager_row(
            {
                **({"property_name": property_row.get("name")} if isinstance(property_row, dict) and property_row.get("name") else {}),
                **(row or {}),
                "_specials_row": specials_row,
                "_pricing_row": pricing_row,
            },
            property_id,
        ),
    }


def save_website_manager_summary(property_id: str, payload: dict[str, Any], access_token: str | None = None) -> dict[str, Any]:
    editable = str(payload.get("platform") or "unknown") == "wordpress_custom"
    try:
        existing_row = _fetch_singleton_row("property_website_manager_current", property_id, access_token=access_token) or {}
        property_row = _fetch_property_row(property_id, access_token=access_token)
    except (HTTPError, URLError, SupabaseValidationConfigError) as error:
        return {
            "status": "error",
            "error": str(error),
            "staging_only": True,
        }

    existing_content, existing_schema = _extract_schema_from_content(existing_row.get("content"), {**existing_row, **({"property_name": property_row.get("name")} if property_row else {})})
    row = {
        "property_id": property_id,
        "property_name": payload.get("propertyName") or (property_row.get("name") if isinstance(property_row, dict) else "") or "",
        "platform": payload.get("platform") or "unknown",
        "website_url": payload.get("websiteUrl") or "",
        "wordpress_site_key": payload.get("wordpressSiteKey") or "",
        "notes": payload.get("notes") or "",
        "editable": editable,
        "content": _compose_stored_content(
            {
                **existing_content,
                **(payload.get("content") if isinstance(payload.get("content"), dict) else {}),
            },
            payload.get("schema") if isinstance(payload.get("schema"), dict) else existing_schema,
        ),
        "firestore_path": payload.get("firestorePath") or f"properties/{property_id}/website_manager/current",
    }

    try:
        saved_row = _upsert_singleton_row("property_website_manager_current", row, access_token=access_token)
        specials_row = _fetch_singleton_row("property_specials_current", property_id, access_token=access_token)
        pricing_row = _fetch_singleton_row("property_availability_snapshots", property_id, access_token=access_token)
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
        "record": _shape_website_manager_row(
            {
                **({"property_name": property_row.get("name")} if isinstance(property_row, dict) and property_row.get("name") else {}),
                **saved_row,
                "_specials_row": specials_row,
                "_pricing_row": pricing_row,
            },
            property_id,
        ),
    }


def get_website_manager_schema_summary(property_id: str, access_token: str | None = None) -> dict[str, Any]:
    summary = get_website_manager_summary(property_id, access_token=access_token)
    if summary.get("status") == "error":
        return summary
    record = summary.get("record") if isinstance(summary.get("record"), dict) else {}
    return {
        "status": "ok",
        "source": "supabase",
        "staging_only": True,
        "record": {
            "propertyId": property_id,
            "propertyName": record.get("propertyName") or "",
            "websiteUrl": record.get("websiteUrl") or "",
            "wordpressSiteKey": record.get("wordpressSiteKey") or "",
            "schema": record.get("schema") if isinstance(record.get("schema"), dict) else _normalize_schema(WEBSITE_MANAGER_DEFAULT_SCHEMA),
        },
    }


def save_website_manager_schema_summary(property_id: str, payload: dict[str, Any], access_token: str | None = None) -> dict[str, Any]:
    try:
        existing_row = _fetch_singleton_row("property_website_manager_current", property_id, access_token=access_token) or {}
        property_row = _fetch_property_row(property_id, access_token=access_token)
    except (HTTPError, URLError, SupabaseValidationConfigError) as error:
        return {
            "status": "error",
            "error": str(error),
            "staging_only": True,
        }

    existing_content, _existing_schema = _extract_schema_from_content(
        existing_row.get("content"),
        {
            **existing_row,
            **({"property_name": property_row.get("name")} if isinstance(property_row, dict) and property_row.get("name") else {}),
        },
    )
    next_schema = _normalize_schema(payload.get("schema"))
    row = {
        "property_id": property_id,
        "property_name": payload.get("propertyName") or (property_row.get("name") if isinstance(property_row, dict) else "") or existing_row.get("property_name") or "",
        "platform": existing_row.get("platform") or "unknown",
        "website_url": existing_row.get("website_url") or "",
        "wordpress_site_key": existing_row.get("wordpress_site_key") or "",
        "notes": existing_row.get("notes") or "",
        "editable": bool(existing_row.get("editable") or False),
        "content": _compose_stored_content(existing_content, next_schema),
        "firestore_path": existing_row.get("firestore_path") or f"properties/{property_id}/website_manager/current",
    }

    try:
        saved_row = _upsert_singleton_row("property_website_manager_current", row, access_token=access_token)
    except (HTTPError, URLError, SupabaseValidationConfigError) as error:
        return {
            "status": "error",
            "error": str(error),
            "staging_only": True,
        }

    record = _shape_website_manager_row(
        {
            **({"property_name": property_row.get("name")} if isinstance(property_row, dict) and property_row.get("name") else {}),
            **saved_row,
        },
        property_id,
    )
    return {
        "status": "ok",
        "source": "supabase",
        "staging_only": True,
        "record": {
            "propertyId": property_id,
            "propertyName": record.get("propertyName") or "",
            "websiteUrl": record.get("websiteUrl") or "",
            "wordpressSiteKey": record.get("wordpressSiteKey") or "",
            "schema": record.get("schema"),
        },
    }


def _load_wordpress_secret(site_key: str) -> str:
    raw_value = os.environ.get("WORDPRESS_SITE_SECRETS_JSON", "").strip()
    if not raw_value:
        raise ValueError("WORDPRESS_SITE_SECRETS_JSON is not configured.")
    try:
        payload = json.loads(raw_value)
    except json.JSONDecodeError as error:
        raise ValueError("WORDPRESS_SITE_SECRETS_JSON must be valid JSON.") from error
    if not isinstance(payload, dict):
        raise ValueError("WORDPRESS_SITE_SECRETS_JSON must decode to an object.")
    secret = payload.get(site_key)
    if not secret:
        raise ValueError(f"No WordPress shared secret is configured for site key '{site_key}'.")
    return str(secret)


def _truncate_preview(value: str, limit: int = 180) -> str:
    normalized = " ".join(str(value or "").split())
    if len(normalized) <= limit:
        return normalized
    return normalized[: limit - 3] + "..."


def _build_wordpress_payload(record: dict[str, Any], tracking_config: dict[str, Any] | None = None) -> dict[str, Any]:
    content = record.get("content") if isinstance(record.get("content"), dict) else {}
    derived = record.get("derivedContent") if isinstance(record.get("derivedContent"), dict) else {}
    has_explicit_schema = isinstance(record.get("schema"), dict)
    schema = record.get("schema") if has_explicit_schema else WEBSITE_MANAGER_DEFAULT_SCHEMA
    schema_keys = {
        str(field.get("key"))
        for group in schema.get("groups", [])
        if isinstance(group, dict)
        for field in group.get("fields", [])
        if isinstance(field, dict) and field.get("key")
    }

    payload = {
        "property_name": record.get("propertyName") or "",
        "website_url": record.get("websiteUrl") or "",
        "__schema": schema,
    }
    if tracking_config and tracking_config.get("siteKey"):
        payload["tracking_config"] = {
            "siteKey": tracking_config.get("siteKey") or "",
            "trackingEnabled": bool(tracking_config.get("trackingEnabled")),
            "samplingRate": float(tracking_config.get("samplingRate") or 0.10),
            "featureFlags": _normalize_tracking_feature_flags(tracking_config.get("featureFlags")),
            "screenshotCaptureFrequency": tracking_config.get("screenshotCaptureFrequency") or "manual",
            "consentMode": _normalize_tracking_consent_mode(tracking_config.get("consentMode")),
            "respectDnt": tracking_config.get("respectDnt") is not False,
            "screenshotMinIntervalHours": _bounded_tracking_int(tracking_config.get("screenshotMinIntervalHours"), 24, 1, 720),
            "rawEventRetentionDays": _bounded_tracking_int(tracking_config.get("rawEventRetentionDays"), 90, 1, 365),
            "aggregateRetentionDays": _bounded_tracking_int(tracking_config.get("aggregateRetentionDays"), 730, 30, 3650),
            "trackerUrl": tracking_config.get("trackerUrl") or "",
        }
    for source_key, raw_value in content.items():
        if source_key == WEBSITE_MANAGER_SCHEMA_META_KEY:
            continue
        if has_explicit_schema and schema_keys and source_key not in schema_keys:
            continue
        target_key = WORDPRESS_FIELD_MAP.get(source_key, source_key)
        payload[target_key] = _normalize_text(raw_value)
    for source_key, target_key in WORDPRESS_DERIVED_FIELD_MAP.items():
        value = derived.get(source_key)
        payload[target_key] = "" if value is None else value
    return payload


def publish_website_manager_summary(property_id: str, access_token: str | None = None) -> dict[str, Any]:
    summary = get_website_manager_summary(property_id, access_token=access_token)
    if summary.get("status") == "error":
        return summary

    record = summary.get("record") if isinstance(summary.get("record"), dict) else {}
    if _normalize_text(record.get("platform")) != "wordpress_custom":
        return {"status": "error", "error": "This property is not configured for WordPress publishing.", "staging_only": True}

    site_key = _normalize_text(record.get("wordpressSiteKey"))
    website_url = _normalize_text(record.get("websiteUrl"))
    if not site_key or not website_url:
        return {
            "status": "error",
            "error": "WordPress publishing requires both a public website URL and a WordPress site key.",
            "staging_only": True,
        }

    target_url = urljoin(website_url.rstrip("/") + "/", "wp-json/redstone-site-manager/v1/content")
    tracking_config = _fetch_primary_heatmap_site(property_id, access_token=access_token)
    payload = _build_wordpress_payload(record, tracking_config)
    body = json.dumps(payload).encode("utf-8")
    timestamp = str(int(datetime.now(tz=UTC).timestamp()))
    secret = _load_wordpress_secret(site_key)
    signature = hmac.new(
        secret.encode("utf-8"),
        msg=b"\n".join((timestamp.encode("utf-8"), site_key.encode("utf-8"), body)),
        digestmod=hashlib.sha256,
    ).hexdigest()

    request = Request(
        target_url,
        data=body,
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": WORDPRESS_PUBLISH_USER_AGENT,
            "X-Redstone-Site-Key": site_key,
            "X-Redstone-Timestamp": timestamp,
            "X-Redstone-Signature": signature,
        },
        method="POST",
    )

    try:
        with urlopen(request, timeout=30) as response:
            response_body = response.read().decode("utf-8")
            content_type = response.headers.get("Content-Type", "")
            try:
                response_payload = json.loads(response_body) if response_body else {}
            except json.JSONDecodeError:
                return {
                    "status": "error",
                    "error": (
                        "WordPress publish endpoint returned a non-JSON response. "
                        f"Content-Type was '{content_type or 'unknown'}'. "
                        f"Response preview: {_truncate_preview(response_body)}"
                    ),
                    "targetUrl": target_url,
                    "staging_only": True,
                }
            return {
                "status": "ok",
                "staging_only": True,
                "targetUrl": target_url,
                "publishedAt": datetime.now(tz=UTC).isoformat(),
                "wordpress": response_payload,
            }
    except HTTPError as error:
        message = error.read().decode("utf-8") if hasattr(error, "read") else str(error)
        return {
            "status": "error",
            "error": f"WordPress publish failed ({error.code}): {message or error.reason}",
            "targetUrl": target_url,
            "staging_only": True,
        }
    except URLError as error:
        return {
            "status": "error",
            "error": f"WordPress publish failed: {error.reason}",
            "targetUrl": target_url,
            "staging_only": True,
        }


def publish_all_wordpress_website_manager_sites(access_token: str | None = None) -> dict[str, Any]:
    try:
        rows = _fetch_rows(
            "property_website_manager_current",
            [
                ("select", "property_id"),
                ("platform", "eq.wordpress_custom"),
                ("editable", "eq.true"),
                ("wordpress_site_key", "not.is.null"),
                ("website_url", "not.is.null"),
                ("limit", "500"),
            ],
            access_token=access_token,
        )
    except (HTTPError, URLError, SupabaseValidationConfigError) as error:
        return {"status": "error", "error": str(error), "staging_only": True}

    results = []
    for row in rows:
        property_id = _normalize_text(row.get("property_id"))
        if not property_id:
            continue
        results.append(publish_website_manager_summary(property_id, access_token=access_token))

    success_count = sum(1 for result in results if result.get("status") == "ok")
    return {
        "status": "ok" if all(result.get("status") == "ok" for result in results) else "error",
        "staging_only": True,
        "successCount": success_count,
        "errorCount": max(len(results) - success_count, 0),
        "results": results,
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
