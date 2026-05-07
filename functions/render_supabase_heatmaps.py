from __future__ import annotations

import json
import re
import hashlib
import tempfile
import subprocess
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlparse
from urllib.request import Request, urlopen

from render_supabase_sync_state import _fetch_json, _table_query_url
from render_supabase_validation import (
    _require_env,
    _supabase_anon_headers,
    _supabase_headers,
)


HEATMAP_EVENT_TYPES = {"click", "mousemove", "scroll", "engagement", "visibility", "pageview", "cta_click", "page_duration"}
HEATMAP_BATCH_LIMIT = 250
HEATMAP_DEFAULT_DAYS = 28
HEATMAP_DEFAULT_SAMPLE_RATE = 0.10
HEATMAP_DEFAULT_FEATURE_FLAGS = {"heatmaps": True, "pageSnapshots": True, "screenshots": False}
SCREENSHOT_CAPTURE_FREQUENCIES = {"manual", "daily", "weekly"}
CONSENT_MODES = {"opt_out", "required", "disabled"}
HEATMAP_DEFAULT_CONSENT_MODE = "opt_out"
HEATMAP_DEFAULT_SCREENSHOT_MIN_INTERVAL_HOURS = 24
HEATMAP_DEFAULT_RAW_EVENT_RETENTION_DAYS = 90
HEATMAP_DEFAULT_AGGREGATE_RETENTION_DAYS = 730
PAGE_SNAPSHOT_HEADING_LIMIT = 24
PAGE_SNAPSHOT_CTA_LIMIT = 30
PAGE_SNAPSHOT_LINK_LIMIT = 100
PAGE_SNAPSHOT_DATE_LIMIT = 30
SCREENSHOT_MAX_WIDTH = 5000
SCREENSHOT_MAX_HEIGHT = 12000
SCREENSHOT_MAX_PIXELS = 20_000_000
SCREENSHOT_BUCKET = "site-screenshots"
SCREENSHOT_MAX_BYTES = 5 * 1024 * 1024
SCREENSHOT_ALLOWED_MIME_TYPES = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
}
SCREENSHOT_CAPTURE_VIEWPORTS = {
    "desktop": {"width": 1440, "height": 1200},
    "tablet": {"width": 834, "height": 1112},
    "mobile": {"width": 390, "height": 844},
}


def _json_request(
    table_name: str,
    query_params: list[tuple[str, str]],
    *,
    method: str,
    payload: Any | None = None,
    headers: dict[str, str] | None = None,
) -> Any:
    request_headers = {
        **(headers or _supabase_headers()),
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = Request(
        _table_query_url(table_name, query_params),
        headers=request_headers,
        data=data,
        method=method,
    )
    with urlopen(request, timeout=30) as response:
        body = response.read().decode("utf-8")
    if not body:
        return None
    return json.loads(body)


def _rpc_request(function_name: str, payload: dict[str, Any]) -> Any:
    request_headers = {
        **_supabase_headers(),
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    request = Request(
        f"{_require_env('SUPABASE_URL').rstrip('/')}/rest/v1/rpc/{quote(function_name)}",
        headers=request_headers,
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
    )
    with urlopen(request, timeout=120) as response:
        body = response.read().decode("utf-8")
    if not body:
        return None
    return json.loads(body)


def run_site_tracking_maintenance(
    *,
    aggregate_lookback_days: int = 7,
    retain_raw_days: int = HEATMAP_DEFAULT_RAW_EVENT_RETENTION_DAYS,
    retain_snapshot_days: int = 30,
    retain_audit_days: int = 365,
    retain_aggregate_days: int = HEATMAP_DEFAULT_AGGREGATE_RETENTION_DAYS,
) -> dict[str, Any]:
    end_date = datetime.now(timezone.utc).date()
    start_date = end_date - timedelta(days=max(aggregate_lookback_days, 1))
    aggregate_result = _rpc_request(
        "refresh_property_site_tracking_aggregates",
        {
            "start_date": start_date.isoformat(),
            "end_date": end_date.isoformat(),
        },
    )
    prune_result = _rpc_request(
        "prune_property_site_tracking",
        {
            "retain_raw_days": retain_raw_days,
            "retain_snapshot_days": retain_snapshot_days,
            "retain_audit_days": retain_audit_days,
            "retain_aggregate_days": retain_aggregate_days,
        },
    )
    return {
        "status": "ok",
        "aggregateLookbackDays": aggregate_lookback_days,
        "startDate": start_date.isoformat(),
        "endDate": end_date.isoformat(),
        "aggregate": aggregate_result,
        "prune": prune_result,
    }


def _normalize_text(value: Any, limit: int | None = None) -> str:
    text = str(value or "").strip()
    if limit and len(text) > limit:
        return text[:limit]
    return text


def _parse_iso_date(value: Any) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def _parse_timestamp(value: Any) -> str:
    parsed = _parse_datetime(value)
    return parsed.isoformat() if parsed else datetime.now(timezone.utc).isoformat()


def _parse_datetime(value: Any) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc)
    if isinstance(value, (int, float)):
        timestamp = value / 1000 if value > 10_000_000_000 else value
        return datetime.fromtimestamp(timestamp, timezone.utc)
    normalized = str(value).strip()
    if not normalized:
        return None
    if normalized.endswith("Z"):
        normalized = normalized[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(normalized).astimezone(timezone.utc)
    except ValueError:
        return None


def _to_int(value: Any) -> int | None:
    try:
        if value is None or value == "":
            return None
        return int(float(value))
    except (TypeError, ValueError):
        return None


def _to_float(value: Any) -> float | None:
    try:
        if value is None or value == "":
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _clamp_percent(value: Any) -> float | None:
    number = _to_float(value)
    if number is None:
        return None
    return max(0.0, min(1.0, number))


def _first_present(*values: Any) -> Any:
    for value in values:
        if value is not None and value != "":
            return value
    return None


def _path_from_url(value: Any) -> str:
    parsed = urlparse(_normalize_text(value, 2048))
    path = parsed.path or "/"
    return path[:1024]


def _hostname_from_value(value: Any) -> str:
    text = _normalize_text(value, 2048)
    if not text:
        return ""
    parsed = urlparse(text if "://" in text else f"https://{text}")
    return (parsed.hostname or "").lower().removeprefix("www.")


def _safe_list(value: Any, limit: int) -> list[Any]:
    if not isinstance(value, list):
        return []
    return value[:limit]


def _normalize_heading_items(value: Any) -> list[dict[str, Any]]:
    headings = []
    for item in _safe_list(value, PAGE_SNAPSHOT_HEADING_LIMIT):
        if not isinstance(item, dict):
            continue
        level = _normalize_text(item.get("level"), 4).lower()
        if level not in {"h1", "h2", "h3"}:
            continue
        text = _normalize_text(item.get("text"), 160)
        if text:
            headings.append({"level": level, "text": text})
    return headings


def _normalize_cta_items(value: Any) -> list[dict[str, Any]]:
    ctas = []
    for item in _safe_list(value, PAGE_SNAPSHOT_CTA_LIMIT):
        if not isinstance(item, dict):
            continue
        label = _normalize_text(item.get("label"), 120)
        href = _normalize_text(item.get("href"), 1024)
        tag = _normalize_text(item.get("tag"), 24).lower()
        if label or href:
            ctas.append({"label": label, "href": href, "tag": tag})
    return ctas


def _normalize_link_items(value: Any) -> list[dict[str, Any]]:
    links = []
    for item in _safe_list(value, PAGE_SNAPSHOT_LINK_LIMIT):
        if not isinstance(item, dict):
            continue
        href = _normalize_text(item.get("href"), 1024)
        path = _path_from_url(href)
        label = _normalize_text(item.get("label"), 100)
        if href:
            links.append({"href": href, "path": path, "label": label})
    return links


def _normalize_date_strings(value: Any) -> list[str]:
    return [_normalize_text(item, 80) for item in _safe_list(value, PAGE_SNAPSHOT_DATE_LIMIT) if _normalize_text(item, 80)]


def _has_inline_image_payload(value: Any) -> bool:
    if isinstance(value, str):
        return value.startswith("data:image/") or len(value) > 4096
    if isinstance(value, dict):
        return any(_has_inline_image_payload(item) for item in value.values())
    if isinstance(value, list):
        return any(_has_inline_image_payload(item) for item in value)
    return False


def _safe_storage_segment(value: Any, fallback: str = "unknown") -> str:
    normalized = re.sub(r"[^a-zA-Z0-9._-]+", "-", _normalize_text(value, 160).lower()).strip("-._")
    return normalized or fallback


def _storage_api_url(path: str) -> str:
    return f"{_require_env('SUPABASE_URL').rstrip('/')}/storage/v1/{path.lstrip('/')}"


def _resolve_storage_signed_url(value: Any) -> str:
    signed_path = _normalize_text(value, 4096)
    if not signed_path:
        return ""
    if signed_path.startswith("http://") or signed_path.startswith("https://"):
        return signed_path
    base_url = _require_env("SUPABASE_URL").rstrip("/")
    if signed_path.startswith("/storage/v1/"):
        return f"{base_url}{signed_path}"
    if signed_path.startswith("storage/v1/"):
        return f"{base_url}/{signed_path}"
    return _storage_api_url(signed_path)


def _create_signed_upload_url(bucket: str, storage_path: str, *, upsert: bool = True) -> dict[str, Any]:
    request = Request(
        _storage_api_url(f"object/upload/sign/{quote(bucket, safe='')}/{quote(storage_path, safe='/')}"),
        headers={**_supabase_headers(), "Content-Type": "application/json", "Accept": "application/json"},
        data=json.dumps({"expiresIn": 7200}).encode("utf-8"),
        method="POST",
    )
    with urlopen(request, timeout=30) as response:
        body = response.read().decode("utf-8")
    return json.loads(body) if body else {}


def _create_signed_read_url(bucket: str, storage_path: str, *, expires_in: int = 900) -> dict[str, Any]:
    request = Request(
        _storage_api_url(f"object/sign/{quote(bucket, safe='')}/{quote(storage_path, safe='/')}"),
        headers={**_supabase_headers(), "Content-Type": "application/json", "Accept": "application/json"},
        data=json.dumps({"expiresIn": expires_in}).encode("utf-8"),
        method="POST",
    )
    with urlopen(request, timeout=30) as response:
        body = response.read().decode("utf-8")
    return json.loads(body) if body else {}


def _upload_storage_object(bucket: str, storage_path: str, data: bytes, *, content_type: str) -> dict[str, Any]:
    request = Request(
        _storage_api_url(f"object/{quote(bucket, safe='')}/{quote(storage_path, safe='/')}"),
        headers={
            **_supabase_headers(),
            "Content-Type": content_type,
            "Accept": "application/json",
            "x-upsert": "true",
        },
        data=data,
        method="POST",
    )
    with urlopen(request, timeout=120) as response:
        body = response.read().decode("utf-8")
    return json.loads(body) if body else {}


def _validate_screenshot_dimensions(width: int | None, height: int | None) -> None:
    if not width or width <= 0:
        raise ValueError("Screenshot width must be a positive integer.")
    if not height or height <= 0:
        raise ValueError("Screenshot height must be a positive integer.")
    if width > SCREENSHOT_MAX_WIDTH:
        raise ValueError(f"Screenshot width exceeds limit of {SCREENSHOT_MAX_WIDTH}.")
    if height > SCREENSHOT_MAX_HEIGHT:
        raise ValueError(f"Screenshot height exceeds limit of {SCREENSHOT_MAX_HEIGHT}.")
    if width * height > SCREENSHOT_MAX_PIXELS:
        raise ValueError(f"Screenshot pixel area exceeds limit of {SCREENSHOT_MAX_PIXELS}.")


def _normalize_screenshot_device_type(value: Any) -> str:
    device_type = _normalize_text(value, 40).lower()
    if device_type not in {"desktop", "mobile", "tablet"}:
        raise ValueError("Screenshot requires deviceType of desktop, mobile, or tablet.")
    return device_type


def _expected_screenshot_path(site: dict[str, Any], page_row: dict[str, Any], device_type: str, extension: str) -> str:
    return "/".join(
        [
            _safe_storage_segment(site.get("property_id"), "property"),
            _safe_storage_segment(site.get("id"), "site"),
            _safe_storage_segment(page_row.get("id"), "page"),
            f"{device_type}.{extension}",
        ]
    )


def _request_hosts(payload: dict[str, Any], origin: str | None, referrer: str | None) -> set[str]:
    hosts = {
        _hostname_from_value(payload.get("url")),
        _hostname_from_value(payload.get("landingUrl")),
        _hostname_from_value(origin),
        _hostname_from_value(referrer),
        _hostname_from_value(payload.get("referrer")),
    }
    session = payload.get("session") if isinstance(payload.get("session"), dict) else {}
    hosts.add(_hostname_from_value(session.get("url") or session.get("landingUrl")))
    hosts.add(_hostname_from_value(session.get("referrer")))
    page = payload.get("page") if isinstance(payload.get("page"), dict) else {}
    hosts.add(_hostname_from_value(page.get("url") or page.get("canonicalUrl")))
    return {host for host in hosts if host}


def _domain_allowed(hosts: set[str], allowed_domains: Any) -> bool:
    domains = allowed_domains if isinstance(allowed_domains, list) else []
    normalized_domains = {
        _hostname_from_value(item)
        for item in domains
        if _normalize_text(item)
    }
    normalized_domains = {domain for domain in normalized_domains if domain}
    if not normalized_domains:
        return False
    for host in hosts:
        if host in normalized_domains:
            return True
        if any(host.endswith(f".{domain}") for domain in normalized_domains):
            return True
    return False


def _validate_sampling_rate(payload: dict[str, Any], site: dict[str, Any]) -> None:
    payload_sample_rate = _to_float(payload.get("sampleRate") or payload.get("samplingRate"))
    site_sample_rate = float(site.get("sampling_rate") or HEATMAP_DEFAULT_SAMPLE_RATE)
    if payload_sample_rate is not None and payload_sample_rate > site_sample_rate:
        raise PermissionError("Payload sampling rate exceeds the configured site sampling rate.")


def _normalize_feature_flags(value: Any) -> dict[str, bool]:
    source = value if isinstance(value, dict) else {}
    return {
        "heatmaps": bool(source.get("heatmaps", HEATMAP_DEFAULT_FEATURE_FLAGS["heatmaps"])),
        "pageSnapshots": bool(source.get("pageSnapshots", source.get("page_snapshots", HEATMAP_DEFAULT_FEATURE_FLAGS["pageSnapshots"]))),
        "screenshots": bool(source.get("screenshots", HEATMAP_DEFAULT_FEATURE_FLAGS["screenshots"])),
    }


def _normalize_capture_frequency(value: Any) -> str:
    frequency = _normalize_text(value, 24).lower()
    return frequency if frequency in SCREENSHOT_CAPTURE_FREQUENCIES else "manual"


def _normalize_consent_mode(value: Any) -> str:
    mode = _normalize_text(value, 32).lower()
    return mode if mode in CONSENT_MODES else HEATMAP_DEFAULT_CONSENT_MODE


def _bounded_int(value: Any, default: int, minimum: int, maximum: int) -> int:
    number = _to_int(value)
    if number is None:
        return default
    return max(minimum, min(maximum, number))


def _screenshot_min_interval_hours(site: dict[str, Any]) -> int:
    configured = _bounded_int(
        site.get("screenshot_min_interval_hours"),
        HEATMAP_DEFAULT_SCREENSHOT_MIN_INTERVAL_HOURS,
        1,
        720,
    )
    frequency = _normalize_capture_frequency(site.get("screenshot_capture_frequency"))
    if frequency == "daily":
        return max(configured, 24)
    if frequency == "weekly":
        return max(configured, 168)
    return configured


def _next_screenshot_allowed_at(site: dict[str, Any], page_id: str, device_type: str) -> tuple[bool, str | None, str | None]:
    rows = _fetch_json(
        "property_site_screenshots",
        [
            ("select", "id,captured_at"),
            ("page_id", f"eq.{page_id}"),
            ("device_type", f"eq.{device_type}"),
            ("order", "captured_at.desc"),
            ("limit", "1"),
        ],
    )
    if not rows:
        return True, None, None
    captured_at = _parse_datetime(rows[0].get("captured_at"))
    if not captured_at:
        return True, None, rows[0].get("id")
    next_allowed = captured_at + timedelta(hours=_screenshot_min_interval_hours(site))
    if datetime.now(timezone.utc) < next_allowed:
        return False, next_allowed.isoformat(), rows[0].get("id")
    return True, next_allowed.isoformat(), rows[0].get("id")


def _fetch_site_by_key(site_key: str) -> dict[str, Any] | None:
    rows = _fetch_json(
        "property_heatmap_sites",
        [
            ("select", "*"),
            ("site_key", f"eq.{site_key}"),
            ("limit", "1"),
        ],
    )
    return rows[0] if rows else None


def _shape_site(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row.get("id"),
        "propertyId": row.get("property_id"),
        "siteKey": row.get("site_key"),
        "name": row.get("name") or "",
        "allowedDomains": row.get("allowed_domains") or [],
        "trackingEnabled": bool(row.get("tracking_enabled")),
        "samplingRate": float(row.get("sampling_rate") or 0),
        "featureFlags": _normalize_feature_flags(row.get("feature_flags")),
        "screenshotCaptureFrequency": _normalize_capture_frequency(row.get("screenshot_capture_frequency")),
        "consentMode": _normalize_consent_mode(row.get("consent_mode")),
        "respectDnt": row.get("respect_dnt") is not False,
        "screenshotMinIntervalHours": _screenshot_min_interval_hours(row),
        "rawEventRetentionDays": _bounded_int(row.get("raw_event_retention_days"), HEATMAP_DEFAULT_RAW_EVENT_RETENTION_DAYS, 1, 365),
        "aggregateRetentionDays": _bounded_int(row.get("aggregate_retention_days"), HEATMAP_DEFAULT_AGGREGATE_RETENTION_DAYS, 30, 3650),
        "notes": row.get("notes") or "",
        "createdAt": row.get("created_at"),
        "updatedAt": row.get("updated_at"),
    }


def list_heatmap_sites_summary(property_id: str, access_token: str | None = None) -> dict[str, Any]:
    rows = _fetch_json(
        "property_heatmap_sites",
        [
            ("select", "*"),
            ("property_id", f"eq.{property_id}"),
            ("order", "created_at.asc"),
        ],
        headers=_supabase_anon_headers(access_token),
    )
    return {
        "status": "ok",
        "property_id": str(property_id),
        "sites": [_shape_site(row) for row in rows],
        "staging_only": True,
    }


def get_heatmap_tracker_payload(site_key: str, collector_url: str) -> tuple[str, dict[str, Any]]:
    site = _fetch_site_by_key(site_key)
    if not site:
        raise LookupError("Unknown heatmap site key.")
    if not bool(site.get("tracking_enabled")):
        return "", _shape_site(site)
    script = build_tracker_script(
        property_id=str(site.get("property_id") or ""),
        site_key=site_key,
        collector_url=collector_url,
        sampling_rate=float(site.get("sampling_rate") or HEATMAP_DEFAULT_SAMPLE_RATE),
        feature_flags=_normalize_feature_flags(site.get("feature_flags")),
        screenshot_capture_frequency=_normalize_capture_frequency(site.get("screenshot_capture_frequency")),
        consent_mode=_normalize_consent_mode(site.get("consent_mode")),
        respect_dnt=site.get("respect_dnt") is not False,
    )
    return script, _shape_site(site)


def save_heatmap_site_summary(property_id: str, payload: dict[str, Any], access_token: str | None = None) -> dict[str, Any]:
    allowed_domains = payload.get("allowedDomains")
    if not isinstance(allowed_domains, list):
        allowed_domains = payload.get("allowed_domains")
    if not isinstance(allowed_domains, list):
        allowed_domains = []

    sampling_rate = _to_float(payload.get("samplingRate", payload.get("sampling_rate", HEATMAP_DEFAULT_SAMPLE_RATE)))
    if sampling_rate is None:
        sampling_rate = HEATMAP_DEFAULT_SAMPLE_RATE

    row = {
        "property_id": str(property_id),
        "name": _normalize_text(payload.get("name"), 160),
        "allowed_domains": [_hostname_from_value(item) for item in allowed_domains if _hostname_from_value(item)],
        "tracking_enabled": bool(payload.get("trackingEnabled", payload.get("tracking_enabled", True))),
        "sampling_rate": max(0, min(1, sampling_rate)),
        "feature_flags": _normalize_feature_flags(payload.get("featureFlags") or payload.get("feature_flags")),
        "screenshot_capture_frequency": _normalize_capture_frequency(
            payload.get("screenshotCaptureFrequency") or payload.get("screenshot_capture_frequency")
        ),
        "consent_mode": _normalize_consent_mode(payload.get("consentMode") or payload.get("consent_mode")),
        "respect_dnt": payload.get("respectDnt", payload.get("respect_dnt", True)) is not False,
        "screenshot_min_interval_hours": _bounded_int(
            payload.get("screenshotMinIntervalHours") or payload.get("screenshot_min_interval_hours"),
            HEATMAP_DEFAULT_SCREENSHOT_MIN_INTERVAL_HOURS,
            1,
            720,
        ),
        "raw_event_retention_days": _bounded_int(
            payload.get("rawEventRetentionDays") or payload.get("raw_event_retention_days"),
            HEATMAP_DEFAULT_RAW_EVENT_RETENTION_DAYS,
            1,
            365,
        ),
        "aggregate_retention_days": _bounded_int(
            payload.get("aggregateRetentionDays") or payload.get("aggregate_retention_days"),
            HEATMAP_DEFAULT_AGGREGATE_RETENTION_DAYS,
            30,
            3650,
        ),
        "notes": _normalize_text(payload.get("notes"), 1000),
    }
    if row["tracking_enabled"] and not row["allowed_domains"]:
        raise ValueError("At least one allowed domain is required before tracking can be enabled.")
    if payload.get("id"):
        row["id"] = str(payload.get("id"))
    if payload.get("siteKey") or payload.get("site_key"):
        row["site_key"] = _normalize_text(payload.get("siteKey") or payload.get("site_key"), 80)

    rows = _json_request(
        "property_heatmap_sites",
        [
            ("on_conflict", "id"),
            ("select", "*"),
        ],
        method="POST",
        payload=row,
        headers={
            **_supabase_anon_headers(access_token),
            "Prefer": "resolution=merge-duplicates,return=representation",
        },
    )
    saved = rows[0] if isinstance(rows, list) and rows else row
    return {
        "status": "ok",
        "property_id": str(property_id),
        "site": _shape_site(saved),
        "staging_only": True,
    }


def _upsert_session(site: dict[str, Any], session_payload: dict[str, Any], fallback_payload: dict[str, Any]) -> dict[str, Any]:
    session_key = _normalize_text(
        session_payload.get("sessionId")
        or session_payload.get("session_id")
        or fallback_payload.get("sessionId")
        or fallback_payload.get("session_id"),
        160,
    )
    if not session_key:
        raise ValueError("Missing required field: sessionId")

    landing_url = _normalize_text(
        session_payload.get("url")
        or session_payload.get("landingUrl")
        or fallback_payload.get("url")
        or fallback_payload.get("landingUrl"),
        2048,
    )
    row = {
        "site_id": site["id"],
        "property_id": site["property_id"],
        "session_key": session_key,
        "landing_url": landing_url,
        "landing_path": _path_from_url(landing_url),
        "referrer": _normalize_text(session_payload.get("referrer") or fallback_payload.get("referrer"), 2048),
        "user_agent": _normalize_text(session_payload.get("userAgent") or fallback_payload.get("userAgent"), 512),
        "device_type": _normalize_text(session_payload.get("deviceType") or fallback_payload.get("deviceType"), 80),
        "viewport_width": _to_int(session_payload.get("viewportWidth") or fallback_payload.get("viewportWidth")),
        "viewport_height": _to_int(session_payload.get("viewportHeight") or fallback_payload.get("viewportHeight")),
        "screen_width": _to_int(session_payload.get("screenWidth") or fallback_payload.get("screenWidth")),
        "screen_height": _to_int(session_payload.get("screenHeight") or fallback_payload.get("screenHeight")),
        "last_seen_at": datetime.now(timezone.utc).isoformat(),
        "raw_data": {
            key: value
            for key, value in session_payload.items()
            if key not in {"sessionId", "session_id"}
        },
    }
    rows = _json_request(
        "property_heatmap_sessions",
        [
            ("on_conflict", "site_id,session_key"),
            ("select", "*"),
        ],
        method="POST",
        payload=row,
        headers={
            **_supabase_headers(),
            "Prefer": "resolution=merge-duplicates,return=representation",
        },
    )
    return rows[0] if isinstance(rows, list) and rows else row


def _upsert_page(site: dict[str, Any], page_payload: dict[str, Any], fallback_payload: dict[str, Any]) -> dict[str, Any] | None:
    url = _normalize_text(page_payload.get("url") or fallback_payload.get("url"), 2048)
    canonical_path = _normalize_text(page_payload.get("canonicalPath") or page_payload.get("canonical_path"), 1024)
    if not canonical_path:
        canonical_path = _path_from_url(url)
    if not canonical_path:
        return None

    row = {
        "site_id": site["id"],
        "property_id": site["property_id"],
        "canonical_path": canonical_path,
        "canonical_url": _normalize_text(page_payload.get("canonicalUrl") or page_payload.get("canonical_url") or url, 2048),
        "last_seen_at": datetime.now(timezone.utc).isoformat(),
        "latest_title": _normalize_text(page_payload.get("title"), 220),
        "latest_meta_description": _normalize_text(page_payload.get("metaDescription") or page_payload.get("meta_description"), 320),
    }
    rows = _json_request(
        "property_site_pages",
        [
            ("on_conflict", "site_id,canonical_path"),
            ("select", "*"),
        ],
        method="POST",
        payload=row,
        headers={
            **_supabase_headers(),
            "Prefer": "resolution=merge-duplicates,return=representation",
        },
    )
    return rows[0] if isinstance(rows, list) and rows else row


def _store_page_snapshot(
    site: dict[str, Any],
    page_row: dict[str, Any] | None,
    page_payload: dict[str, Any],
    fallback_payload: dict[str, Any],
) -> dict[str, Any] | None:
    if not page_row:
        return None
    url = _normalize_text(page_payload.get("url") or fallback_payload.get("url"), 2048)
    canonical_path = _normalize_text(page_payload.get("canonicalPath") or page_payload.get("canonical_path"), 1024) or _path_from_url(url)
    screenshot = page_payload.get("screenshot") if isinstance(page_payload.get("screenshot"), dict) else {}
    row = {
        "page_id": page_row.get("id"),
        "site_id": site["id"],
        "property_id": site["property_id"],
        "captured_at": _parse_timestamp(page_payload.get("capturedAt") or page_payload.get("captured_at")),
        "url": url,
        "canonical_path": canonical_path,
        "title": _normalize_text(page_payload.get("title"), 220),
        "meta_description": _normalize_text(page_payload.get("metaDescription") or page_payload.get("meta_description"), 320),
        "headings": _normalize_heading_items(page_payload.get("headings")),
        "ctas": _normalize_cta_items(page_payload.get("ctas")),
        "internal_links": _normalize_link_items(page_payload.get("internalLinks") or page_payload.get("internal_links")),
        "promo_date_strings": _normalize_date_strings(page_payload.get("promoDateStrings") or page_payload.get("promo_date_strings")),
        "page_structure": page_payload.get("pageStructure") if isinstance(page_payload.get("pageStructure"), dict) else {},
        "screenshot": {
            "available": bool(screenshot.get("available")),
            "storageBucket": _normalize_text(screenshot.get("storageBucket"), 120),
            "storagePath": _normalize_text(screenshot.get("storagePath"), 1024),
            "width": _to_int(screenshot.get("width")),
            "height": _to_int(screenshot.get("height")),
            "capturedAt": _normalize_text(screenshot.get("capturedAt"), 80),
        },
        "raw_data": {
            "source": "redstone-tracker",
            "structure": page_payload.get("pageStructure") if isinstance(page_payload.get("pageStructure"), dict) else {},
        },
    }
    rows = _json_request(
        "property_site_page_snapshots",
        [("select", "id")],
        method="POST",
        payload=row,
        headers={**_supabase_headers(), "Prefer": "return=representation"},
    )
    snapshot_id = rows[0].get("id") if isinstance(rows, list) and rows else None
    if snapshot_id:
        _json_request(
            "property_site_pages",
            [
                ("id", f"eq.{page_row.get('id')}"),
                ("select", "id"),
            ],
            method="PATCH",
            payload={"latest_snapshot_id": snapshot_id},
            headers={**_supabase_headers(), "Prefer": "return=minimal"},
        )
    return {"id": snapshot_id} if snapshot_id else None


def collect_site_page_snapshot_payload(
    payload: dict[str, Any],
    *,
    origin: str | None = None,
    referrer: str | None = None,
) -> dict[str, Any]:
    site_key = _normalize_text(payload.get("siteKey") or payload.get("site_key"), 100)
    if not site_key:
        raise ValueError("Missing required field: siteKey")
    if _has_inline_image_payload(payload):
        raise ValueError("Inline screenshot/image payloads are not accepted. Store screenshots separately and send metadata only.")

    site = _fetch_site_by_key(site_key)
    if not site:
        raise LookupError("Unknown heatmap site key.")
    if not bool(site.get("tracking_enabled")):
        return {"status": "disabled", "siteKey": site_key}
    if not _normalize_feature_flags(site.get("feature_flags")).get("pageSnapshots"):
        return {"status": "disabled", "siteKey": site_key, "reason": "pageSnapshots disabled"}
    if not _domain_allowed(_request_hosts(payload, origin, referrer), site.get("allowed_domains")):
        raise PermissionError("Request origin is not allowed for this site.")
    _validate_sampling_rate(payload, site)

    page_payload = payload.get("page") if isinstance(payload.get("page"), dict) else payload
    if not isinstance(page_payload, dict):
        raise ValueError("Missing page snapshot payload.")

    if len(_safe_list(page_payload.get("headings"), PAGE_SNAPSHOT_HEADING_LIMIT + 1)) > PAGE_SNAPSHOT_HEADING_LIMIT:
        raise ValueError(f"Page snapshot exceeds heading limit of {PAGE_SNAPSHOT_HEADING_LIMIT}.")
    if len(_safe_list(page_payload.get("ctas"), PAGE_SNAPSHOT_CTA_LIMIT + 1)) > PAGE_SNAPSHOT_CTA_LIMIT:
        raise ValueError(f"Page snapshot exceeds CTA limit of {PAGE_SNAPSHOT_CTA_LIMIT}.")
    links_value = page_payload.get("internalLinks") or page_payload.get("internal_links")
    if len(_safe_list(links_value, PAGE_SNAPSHOT_LINK_LIMIT + 1)) > PAGE_SNAPSHOT_LINK_LIMIT:
        raise ValueError(f"Page snapshot exceeds internal link limit of {PAGE_SNAPSHOT_LINK_LIMIT}.")

    page_row = _upsert_page(site, page_payload, payload)
    snapshot = _store_page_snapshot(site, page_row, page_payload, payload)
    return {
        "status": "ok",
        "siteKey": site_key,
        "propertyId": site.get("property_id"),
        "pageId": page_row.get("id") if page_row else None,
        "pageSnapshotId": snapshot.get("id") if snapshot else None,
    }


def save_site_screenshot_metadata_payload(
    payload: dict[str, Any],
    *,
    origin: str | None = None,
    referrer: str | None = None,
) -> dict[str, Any]:
    site_key = _normalize_text(payload.get("siteKey") or payload.get("site_key"), 100)
    if not site_key:
        raise ValueError("Missing required field: siteKey")
    if _has_inline_image_payload(payload):
        raise ValueError("Inline screenshot/image payloads are not accepted by this endpoint.")

    site = _fetch_site_by_key(site_key)
    if not site:
        raise LookupError("Unknown heatmap site key.")
    if not bool(site.get("tracking_enabled")):
        return {"status": "disabled", "siteKey": site_key}
    if not _normalize_feature_flags(site.get("feature_flags")).get("screenshots"):
        return {"status": "disabled", "siteKey": site_key, "reason": "screenshots disabled"}
    if not _domain_allowed(_request_hosts(payload, origin, referrer), site.get("allowed_domains")):
        raise PermissionError("Request origin is not allowed for this site.")
    _validate_sampling_rate(payload, site)

    screenshot = payload.get("screenshot") if isinstance(payload.get("screenshot"), dict) else payload
    storage_bucket = _normalize_text(screenshot.get("storageBucket") or screenshot.get("storage_bucket"), 160)
    storage_path = _normalize_text(screenshot.get("storagePath") or screenshot.get("storage_path"), 1024)
    if not storage_bucket or not storage_path:
        raise ValueError("Screenshot metadata requires storageBucket and storagePath.")
    if storage_bucket != SCREENSHOT_BUCKET:
        raise ValueError(f"Screenshot metadata must use the {SCREENSHOT_BUCKET} bucket.")

    width = _to_int(screenshot.get("width"))
    height = _to_int(screenshot.get("height"))
    _validate_screenshot_dimensions(width, height)

    page_payload = payload.get("page") if isinstance(payload.get("page"), dict) else {
        "url": payload.get("url"),
        "canonicalPath": payload.get("canonicalPath") or payload.get("canonical_path"),
        "canonicalUrl": payload.get("canonicalUrl") or payload.get("canonical_url"),
    }
    page_row = _upsert_page(site, page_payload, payload)
    if not page_row:
        raise ValueError("Unable to resolve screenshot page.")

    device_type = _normalize_screenshot_device_type(screenshot.get("deviceType") or payload.get("deviceType"))
    extension = storage_path.rsplit(".", 1)[-1].lower() if "." in storage_path else ""
    if extension not in set(SCREENSHOT_ALLOWED_MIME_TYPES.values()):
        raise ValueError("Screenshot storage path must use png, jpg, or webp extension.")
    expected_path = _expected_screenshot_path(site, page_row, device_type, extension)
    if storage_path != expected_path:
        raise ValueError("Screenshot storage path does not match the expected property/page/device path.")

    row = {
        "page_id": page_row.get("id"),
        "site_id": site.get("id"),
        "property_id": site.get("property_id"),
        "device_type": device_type,
        "storage_bucket": storage_bucket,
        "storage_path": storage_path,
        "width": width,
        "height": height,
        "content_hash": _normalize_text(screenshot.get("contentHash") or screenshot.get("content_hash"), 160),
        "captured_at": _parse_timestamp(screenshot.get("capturedAt") or screenshot.get("captured_at")),
    }
    rows = _json_request(
        "property_site_screenshots",
        [
            ("on_conflict", "page_id,device_type"),
            ("select", "*"),
        ],
        method="POST",
        payload=row,
        headers={**_supabase_headers(), "Prefer": "resolution=merge-duplicates,return=representation"},
    )
    screenshot_row = rows[0] if isinstance(rows, list) and rows else row
    if screenshot_row.get("id"):
        _json_request(
            "property_site_pages",
            [("id", f"eq.{page_row.get('id')}")],
            method="PATCH",
            payload={"latest_screenshot_id": screenshot_row.get("id")},
            headers={**_supabase_headers(), "Prefer": "return=minimal"},
        )
    return {
        "status": "ok",
        "siteKey": site_key,
        "propertyId": site.get("property_id"),
        "pageId": page_row.get("id"),
        "screenshotId": screenshot_row.get("id"),
    }


def _site_homepage_url(site: dict[str, Any]) -> str:
    domains = site.get("allowed_domains") if isinstance(site.get("allowed_domains"), list) else []
    host = _hostname_from_value(domains[0]) if domains else ""
    return f"https://{host}/" if host else ""


def _page_capture_url(site: dict[str, Any], page: dict[str, Any]) -> str:
    canonical_url = _normalize_text(page.get("canonical_url"), 2048)
    if canonical_url:
        return canonical_url
    homepage = _site_homepage_url(site)
    if not homepage:
        return ""
    canonical_path = _normalize_text(page.get("canonical_path"), 1024) or "/"
    return f"{homepage.rstrip('/')}{canonical_path if canonical_path.startswith('/') else f'/{canonical_path}'}"


def _capture_pages_for_site(site: dict[str, Any], limit: int) -> list[dict[str, Any]]:
    rows = _fetch_json(
        "property_site_pages",
        [
            ("select", "id,site_id,property_id,canonical_path,canonical_url,latest_title,last_seen_at"),
            ("site_id", f"eq.{site.get('id')}"),
            ("order", "last_seen_at.desc"),
            ("limit", str(max(1, limit))),
        ],
    )
    if rows:
        return rows
    homepage = _site_homepage_url(site)
    if not homepage:
        return []
    return [
        _upsert_page(
            site,
            {
                "url": homepage,
                "canonicalUrl": homepage,
                "canonicalPath": "/",
                "title": "Homepage",
            },
            {"url": homepage},
        )
    ]


def _should_capture_site_screenshots(site: dict[str, Any]) -> tuple[bool, str]:
    if not bool(site.get("tracking_enabled")):
        return False, "tracking disabled"
    if not _normalize_feature_flags(site.get("feature_flags")).get("screenshots"):
        return False, "screenshots disabled"
    if _normalize_capture_frequency(site.get("screenshot_capture_frequency")) == "manual":
        return False, "manual screenshot frequency"
    if not _domain_allowed({_hostname_from_value(_site_homepage_url(site))}, site.get("allowed_domains")):
        return False, "missing allowed domain"
    return True, ""


def capture_site_screenshots(
    *,
    site_key: str | None = None,
    devices: list[str] | None = None,
    page_limit_per_site: int = 25,
    timeout_ms: int = 30_000,
) -> dict[str, Any]:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as error:
        raise RuntimeError("Playwright is not installed. Add it to requirements and run `python -m playwright install chromium`.") from error

    selected_devices = [
        _normalize_screenshot_device_type(device)
        for device in (devices or list(SCREENSHOT_CAPTURE_VIEWPORTS.keys()))
    ]
    selected_devices = list(dict.fromkeys(selected_devices))
    site_filters = [
        ("select", "*"),
        ("tracking_enabled", "eq.true"),
        ("order", "created_at.asc"),
        ("limit", "100"),
    ]
    if site_key:
        site_filters.append(("site_key", f"eq.{_normalize_text(site_key, 100)}"))
    sites = _fetch_json("property_heatmap_sites", site_filters)

    results: list[dict[str, Any]] = []
    captured_count = 0
    skipped_count = 0
    failed_count = 0

    with tempfile.TemporaryDirectory(prefix="redstone-site-shots-") as tmpdir:
        with sync_playwright() as playwright:
            try:
                browser = playwright.chromium.launch(headless=True)
            except Exception as launch_error:
                error_text = str(launch_error)
                if "Executable doesn't exist" not in error_text and "playwright install" not in error_text:
                    raise
                subprocess.run(
                    [sys.executable, "-m", "playwright", "install", "chromium"],
                    check=True,
                )
                browser = playwright.chromium.launch(headless=True)
            try:
                for site in sites:
                    should_capture, skip_reason = _should_capture_site_screenshots(site)
                    if not should_capture:
                        skipped_count += 1
                        results.append({"siteKey": site.get("site_key"), "status": "skipped", "reason": skip_reason})
                        continue
                    site_pages = _capture_pages_for_site(site, page_limit_per_site)
                    if not site_pages:
                        skipped_count += 1
                        results.append({"siteKey": site.get("site_key"), "status": "skipped", "reason": "no pages to capture"})
                        continue

                    for page_row in site_pages:
                        page_url = _page_capture_url(site, page_row)
                        if not page_url:
                            skipped_count += 1
                            results.append({"siteKey": site.get("site_key"), "pageId": page_row.get("id"), "status": "skipped", "reason": "missing page URL"})
                            continue
                        for device_type in selected_devices:
                            allowed, next_allowed_at, existing_id = _next_screenshot_allowed_at(site, str(page_row.get("id")), device_type)
                            if not allowed:
                                skipped_count += 1
                                results.append(
                                    {
                                        "siteKey": site.get("site_key"),
                                        "pageId": page_row.get("id"),
                                        "deviceType": device_type,
                                        "status": "skipped",
                                        "reason": "frequency limit",
                                        "screenshotId": existing_id,
                                        "nextAllowedAt": next_allowed_at,
                                    }
                                )
                                continue

                            viewport = SCREENSHOT_CAPTURE_VIEWPORTS[device_type]
                            context = browser.new_context(
                                viewport=viewport,
                                device_scale_factor=1,
                                user_agent=(
                                    "Mozilla/5.0 (compatible; RedstoneSiteAuditBot/1.0; +https://redstoneresidential.com)"
                                ),
                            )
                            page = context.new_page()
                            try:
                                page.goto(page_url, wait_until="domcontentloaded", timeout=timeout_ms)
                                try:
                                    page.wait_for_load_state("load", timeout=10_000)
                                except Exception:
                                    pass
                                page.wait_for_timeout(1500)
                                dimensions = page.evaluate(
                                    """() => ({
                                      width: Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0, window.innerWidth || 0),
                                      height: Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0, window.innerHeight || 0)
                                    })"""
                                )
                                width = min(int(dimensions.get("width") or viewport["width"]), SCREENSHOT_MAX_WIDTH)
                                height = min(int(dimensions.get("height") or viewport["height"]), SCREENSHOT_MAX_HEIGHT)
                                if width * height > SCREENSHOT_MAX_PIXELS:
                                    height = max(viewport["height"], SCREENSHOT_MAX_PIXELS // max(width, 1))
                                output_path = Path(tmpdir) / f"{page_row.get('id')}-{device_type}.jpg"
                                use_full_page = (
                                    int(dimensions.get("width") or 0) <= SCREENSHOT_MAX_WIDTH
                                    and int(dimensions.get("height") or 0) <= SCREENSHOT_MAX_HEIGHT
                                    and int(dimensions.get("width") or 0) * int(dimensions.get("height") or 0) <= SCREENSHOT_MAX_PIXELS
                                )
                                screenshot_args = {
                                    "path": str(output_path),
                                    "type": "jpeg",
                                    "quality": 72,
                                }
                                if use_full_page:
                                    screenshot_args["full_page"] = True
                                else:
                                    screenshot_args["clip"] = {"x": 0, "y": 0, "width": width, "height": height}
                                page.screenshot(**screenshot_args)
                                image_bytes = output_path.read_bytes()
                                if len(image_bytes) > SCREENSHOT_MAX_BYTES:
                                    screenshot_args["quality"] = 55
                                    page.screenshot(
                                        **screenshot_args,
                                    )
                                    image_bytes = output_path.read_bytes()
                                if len(image_bytes) > SCREENSHOT_MAX_BYTES:
                                    raise ValueError(f"Captured screenshot exceeds {SCREENSHOT_MAX_BYTES} bytes after compression.")

                                storage_path = _expected_screenshot_path(site, page_row, device_type, "jpg")
                                content_hash = hashlib.sha256(image_bytes).hexdigest()
                                _upload_storage_object(SCREENSHOT_BUCKET, storage_path, image_bytes, content_type="image/jpeg")
                                metadata = save_site_screenshot_metadata_payload(
                                    {
                                        "siteKey": site.get("site_key"),
                                        "url": page_url,
                                        "page": {
                                            "url": page_url,
                                            "canonicalUrl": page_row.get("canonical_url") or page_url,
                                            "canonicalPath": page_row.get("canonical_path") or _path_from_url(page_url),
                                            "title": page_row.get("latest_title"),
                                        },
                                        "screenshot": {
                                            "storageBucket": SCREENSHOT_BUCKET,
                                            "storagePath": storage_path,
                                            "deviceType": device_type,
                                            "width": width,
                                            "height": height,
                                            "contentHash": content_hash,
                                            "capturedAt": datetime.now(timezone.utc).isoformat(),
                                        },
                                    },
                                    origin=page_url,
                                    referrer=page_url,
                                )
                                captured_count += 1
                                results.append(
                                    {
                                        "siteKey": site.get("site_key"),
                                        "pageId": page_row.get("id"),
                                        "deviceType": device_type,
                                        "status": "ok",
                                        "screenshotId": metadata.get("screenshotId"),
                                        "storagePath": storage_path,
                                        "width": width,
                                        "height": height,
                                        "bytes": len(image_bytes),
                                    }
                                )
                            except Exception as error:
                                failed_count += 1
                                results.append(
                                    {
                                        "siteKey": site.get("site_key"),
                                        "pageId": page_row.get("id"),
                                        "url": page_url,
                                        "deviceType": device_type,
                                        "status": "error",
                                        "error": str(error),
                                    }
                                )
                            finally:
                                context.close()
            finally:
                browser.close()

    return {
        "status": "ok",
        "sitesChecked": len(sites),
        "captured": captured_count,
        "skipped": skipped_count,
        "failed": failed_count,
        "results": results[:500],
    }


def create_site_screenshot_upload_url_payload(
    payload: dict[str, Any],
    *,
    origin: str | None = None,
    referrer: str | None = None,
) -> dict[str, Any]:
    site_key = _normalize_text(payload.get("siteKey") or payload.get("site_key"), 100)
    if not site_key:
        raise ValueError("Missing required field: siteKey")
    if _has_inline_image_payload(payload):
        raise ValueError("Inline screenshot/image payloads are not accepted by this endpoint.")

    site = _fetch_site_by_key(site_key)
    if not site:
        raise LookupError("Unknown heatmap site key.")
    if not bool(site.get("tracking_enabled")):
        return {"status": "disabled", "siteKey": site_key}
    if not _normalize_feature_flags(site.get("feature_flags")).get("screenshots"):
        return {"status": "disabled", "siteKey": site_key, "reason": "screenshots disabled"}
    if not _domain_allowed(_request_hosts(payload, origin, referrer), site.get("allowed_domains")):
        raise PermissionError("Request origin is not allowed for this site.")
    _validate_sampling_rate(payload, site)

    upload_intent = payload.get("screenshot") if isinstance(payload.get("screenshot"), dict) else payload
    mime_type = _normalize_text(upload_intent.get("mimeType") or upload_intent.get("mime_type"), 80).lower()
    extension = SCREENSHOT_ALLOWED_MIME_TYPES.get(mime_type)
    if not extension:
        raise ValueError("Unsupported screenshot MIME type.")

    file_size_bytes = _to_int(upload_intent.get("fileSizeBytes") or upload_intent.get("file_size_bytes"))
    if not file_size_bytes or file_size_bytes <= 0:
        raise ValueError("Missing required field: fileSizeBytes")
    if file_size_bytes > SCREENSHOT_MAX_BYTES:
        raise ValueError(f"Screenshot upload intent exceeds limit of {SCREENSHOT_MAX_BYTES} bytes.")

    device_type = _normalize_screenshot_device_type(upload_intent.get("deviceType") or upload_intent.get("device_type"))

    width = _to_int(upload_intent.get("width"))
    height = _to_int(upload_intent.get("height"))
    _validate_screenshot_dimensions(width, height)

    page_payload = payload.get("page") if isinstance(payload.get("page"), dict) else {
        "url": payload.get("url"),
        "canonicalPath": payload.get("canonicalPath") or payload.get("canonical_path"),
        "canonicalUrl": payload.get("canonicalUrl") or payload.get("canonical_url"),
        "title": payload.get("title"),
        "metaDescription": payload.get("metaDescription") or payload.get("meta_description"),
    }
    page_url = _normalize_text(page_payload.get("url"), 2048)
    canonical_path = _normalize_text(page_payload.get("canonicalPath") or page_payload.get("canonical_path"), 1024)
    if not page_url and not canonical_path:
        raise ValueError("Screenshot upload requires a page URL or canonical path.")
    if canonical_path and not canonical_path.startswith("/"):
        raise ValueError("Screenshot canonical path must start with '/'.")

    page_row = _upsert_page(site, page_payload, payload)
    if not page_row:
        raise ValueError("Unable to resolve screenshot page.")

    is_allowed, next_allowed_at, existing_screenshot_id = _next_screenshot_allowed_at(site, str(page_row.get("id")), device_type)
    if not is_allowed:
        return {
            "status": "skipped",
            "siteKey": site_key,
            "propertyId": site.get("property_id"),
            "pageId": page_row.get("id"),
            "screenshotId": existing_screenshot_id,
            "reason": "screenshot capture frequency limit",
            "nextAllowedAt": next_allowed_at,
            "screenshotCaptureFrequency": _normalize_capture_frequency(site.get("screenshot_capture_frequency")),
            "screenshotMinIntervalHours": _screenshot_min_interval_hours(site),
        }

    storage_path = _expected_screenshot_path(site, page_row, device_type, extension)
    signed_upload = _create_signed_upload_url(SCREENSHOT_BUCKET, storage_path, upsert=True)
    signed_url = (
        signed_upload.get("signedUrl")
        or signed_upload.get("signedURL")
        or signed_upload.get("signed_url")
        or signed_upload.get("url")
    )
    if not signed_url and not signed_upload.get("token"):
        raise RuntimeError("Supabase did not return a signed screenshot upload URL.")

    return {
        "status": "ok",
        "siteKey": site_key,
        "propertyId": site.get("property_id"),
        "pageId": page_row.get("id"),
        "bucket": SCREENSHOT_BUCKET,
        "storageBucket": SCREENSHOT_BUCKET,
        "path": storage_path,
        "storagePath": storage_path,
        "mimeType": mime_type,
        "maxBytes": SCREENSHOT_MAX_BYTES,
        "expiresIn": 7200,
        "signedUrl": signed_url,
        "token": signed_upload.get("token"),
        "uploadHeaders": {"x-upsert": "true", "Content-Type": mime_type},
        "upload": signed_upload,
        "next": {
            "method": "POST",
            "endpoint": "/api/site-audit/screenshot",
            "metadataShape": {
                "siteKey": site_key,
                "page": {
                    "url": page_payload.get("url"),
                    "canonicalPath": page_row.get("canonical_path"),
                    "canonicalUrl": page_row.get("canonical_url"),
                },
                "screenshot": {
                    "storageBucket": SCREENSHOT_BUCKET,
                    "storagePath": storage_path,
                    "deviceType": device_type,
                    "width": width,
                    "height": height,
                    "contentHash": "sha256-or-equivalent",
                },
            },
        },
    }


def _normalize_event(
    site: dict[str, Any],
    session_row: dict[str, Any],
    event_payload: dict[str, Any],
    fallback_payload: dict[str, Any],
) -> dict[str, Any] | None:
    event_type = _normalize_text(event_payload.get("type") or event_payload.get("eventType"), 40).lower()
    if event_type not in HEATMAP_EVENT_TYPES:
        return None

    data = event_payload.get("data") if isinstance(event_payload.get("data"), dict) else event_payload
    url = _normalize_text(event_payload.get("url") or data.get("url") or fallback_payload.get("url"), 2048)
    viewport_width = _to_int(data.get("viewportWidth") or fallback_payload.get("viewportWidth"))
    viewport_height = _to_int(data.get("viewportHeight") or fallback_payload.get("viewportHeight"))
    document_width = _to_int(data.get("documentWidth") or fallback_payload.get("documentWidth"))
    document_height = _to_int(data.get("documentHeight") or fallback_payload.get("documentHeight"))
    page_x = _to_float(data.get("pageX"))
    page_y = _to_float(data.get("pageY"))
    x = _to_float(data.get("x"))
    y = _to_float(data.get("y"))

    x_pct = _clamp_percent(_first_present(data.get("xPct"), data.get("x_pct")))
    y_pct = _clamp_percent(_first_present(data.get("yPct"), data.get("y_pct")))
    if x_pct is None and page_x is not None and document_width:
        x_pct = _clamp_percent(page_x / document_width)
    if y_pct is None and page_y is not None and document_height:
        y_pct = _clamp_percent(page_y / document_height)

    scroll_y = _to_float(data.get("scrollY"))
    scroll_depth_pct = _clamp_percent(_first_present(data.get("scrollDepthPct"), data.get("scroll_depth_pct")))
    if scroll_depth_pct is None and scroll_y is not None and viewport_height and document_height:
        scroll_depth_pct = _clamp_percent((scroll_y + viewport_height) / document_height)

    return {
        "site_id": site["id"],
        "session_id": session_row.get("id"),
        "property_id": site["property_id"],
        "session_key": session_row.get("session_key"),
        "event_type": event_type,
        "occurred_at": _parse_timestamp(event_payload.get("occurredAt") or event_payload.get("timestamp")),
        "url": url,
        "path": _path_from_url(url),
        "viewport_width": viewport_width,
        "viewport_height": viewport_height,
        "document_width": document_width,
        "document_height": document_height,
        "x": x,
        "y": y,
        "page_x": page_x,
        "page_y": page_y,
        "x_pct": x_pct,
        "y_pct": y_pct,
        "scroll_x": _to_float(data.get("scrollX")),
        "scroll_y": scroll_y,
        "scroll_depth_pct": scroll_depth_pct,
        "target_tag": _normalize_text(data.get("targetTag"), 80),
        "target_id": _normalize_text(data.get("targetId"), 160),
        "target_classes": _normalize_text(data.get("targetClass"), 300),
        "target_role": _normalize_text(data.get("targetRole"), 80),
        "engagement_ms": _to_int(data.get("engagementMs")),
        "raw_data": {
            key: value
            for key, value in data.items()
            if key not in {"targetText", "text", "value", "inputValue"}
        },
    }


def collect_heatmap_payload(
    payload: dict[str, Any],
    *,
    origin: str | None = None,
    referrer: str | None = None,
) -> dict[str, Any]:
    site_key = _normalize_text(payload.get("siteKey") or payload.get("site_key"), 100)
    if not site_key:
        raise ValueError("Missing required field: siteKey")

    site = _fetch_site_by_key(site_key)
    if not site:
        raise LookupError("Unknown heatmap site key.")
    if not bool(site.get("tracking_enabled")):
        return {"status": "disabled", "accepted": 0, "siteKey": site_key}
    feature_flags = _normalize_feature_flags(site.get("feature_flags"))
    if not feature_flags.get("heatmaps") and not feature_flags.get("pageSnapshots"):
        return {"status": "disabled", "accepted": 0, "siteKey": site_key}
    if not _domain_allowed(_request_hosts(payload, origin, referrer), site.get("allowed_domains")):
        raise PermissionError("Request origin is not allowed for this heatmap site.")
    _validate_sampling_rate(payload, site)

    session_payload = payload.get("session") if isinstance(payload.get("session"), dict) else payload
    session_row = _upsert_session(site, session_payload, payload)
    page_payload = payload.get("page") if isinstance(payload.get("page"), dict) else {}
    page_row = _upsert_page(site, page_payload, payload) if page_payload and feature_flags.get("pageSnapshots") else None
    page_snapshot = _store_page_snapshot(site, page_row, page_payload, payload) if page_payload and feature_flags.get("pageSnapshots") else None

    events_payload = payload.get("events")
    if not isinstance(events_payload, list):
        event_type = payload.get("type") or payload.get("eventType")
        events_payload = [{"type": event_type, "data": payload.get("data") or payload}]
    if len(events_payload) > HEATMAP_BATCH_LIMIT:
        raise ValueError(f"Heatmap event batch exceeds the limit of {HEATMAP_BATCH_LIMIT} events.")

    event_rows = []
    if feature_flags.get("heatmaps"):
        event_rows = [
            event_row
            for event in events_payload
            if isinstance(event, dict)
            for event_row in [_normalize_event(site, session_row, event, payload)]
            if event_row
        ]
    if event_rows:
        _json_request(
            "property_heatmap_events",
            [],
            method="POST",
            payload=event_rows,
            headers={**_supabase_headers(), "Prefer": "return=minimal"},
        )

    return {
        "status": "ok",
        "accepted": len(event_rows),
        "siteKey": site_key,
        "propertyId": site.get("property_id"),
        "pageId": page_row.get("id") if page_row else None,
        "pageSnapshotId": page_snapshot.get("id") if page_snapshot else None,
    }


def get_heatmap_pages_summary(
    property_id: str,
    *,
    start_date_value: str | None = None,
    end_date_value: str | None = None,
    site_key: str | None = None,
    access_token: str | None = None,
) -> dict[str, Any]:
    end_date = _parse_iso_date(end_date_value) or datetime.now(timezone.utc).date()
    start_date = _parse_iso_date(start_date_value) or (end_date - timedelta(days=HEATMAP_DEFAULT_DAYS - 1))
    if start_date > end_date:
        start_date, end_date = end_date, start_date

    filters = [
        ("select", "site_id,session_key,event_type,path,occurred_at,scroll_depth_pct"),
        ("property_id", f"eq.{property_id}"),
        ("occurred_at", f"gte.{start_date.isoformat()}T00:00:00+00:00"),
        ("occurred_at", f"lte.{end_date.isoformat()}T23:59:59+00:00"),
        ("order", "occurred_at.desc"),
        ("limit", "10000"),
    ]
    site_id = None
    if site_key:
        site = _fetch_site_by_key(site_key)
        if site:
            site_id = site.get("id")
            filters.append(("site_id", f"eq.{site_id}"))

    events = _fetch_json(
        "property_heatmap_events",
        filters,
        headers=_supabase_anon_headers(access_token),
    )
    page_filters = [
        ("select", "id,site_id,canonical_path,canonical_url,latest_title,latest_meta_description,latest_snapshot_id,latest_screenshot_id,last_seen_at"),
        ("property_id", f"eq.{property_id}"),
        ("order", "last_seen_at.desc"),
        ("limit", "500"),
    ]
    if site_id:
        page_filters.append(("site_id", f"eq.{site_id}"))
    inventory_rows = _fetch_json(
        "property_site_pages",
        page_filters,
        headers=_supabase_anon_headers(access_token),
    )

    page_map: dict[str, dict[str, Any]] = {}
    for inventory in inventory_rows:
        page_path = str(inventory.get("canonical_path") or "/")
        page_map[page_path] = {
            "id": inventory.get("id"),
            "path": page_path,
            "url": inventory.get("canonical_url"),
            "title": inventory.get("latest_title"),
            "metaDescription": inventory.get("latest_meta_description"),
            "latestSnapshotId": inventory.get("latest_snapshot_id"),
            "latestScreenshotId": inventory.get("latest_screenshot_id"),
            "events": 0,
            "sessions": set(),
            "clicks": 0,
            "ctaClicks": 0,
            "mouseMoves": 0,
            "scrolls": 0,
            "maxScrollDepthPct": 0.0,
            "lastSeenAt": inventory.get("last_seen_at"),
        }
    for event in events:
        page_path = str(event.get("path") or "/")
        page = page_map.setdefault(
            page_path,
            {
                "id": None,
                "path": page_path,
                "url": None,
                "title": None,
                "metaDescription": None,
                "latestSnapshotId": None,
                "latestScreenshotId": None,
                "events": 0,
                "sessions": set(),
                "clicks": 0,
                "ctaClicks": 0,
                "mouseMoves": 0,
                "scrolls": 0,
                "maxScrollDepthPct": 0.0,
                "lastSeenAt": event.get("occurred_at"),
            },
        )
        page["events"] += 1
        if event.get("session_key"):
            page["sessions"].add(str(event.get("session_key")))
        event_type = event.get("event_type")
        if event_type == "click":
            page["clicks"] += 1
        elif event_type == "cta_click":
            page["ctaClicks"] += 1
        elif event_type == "mousemove":
            page["mouseMoves"] += 1
        elif event_type == "scroll":
            page["scrolls"] += 1
        if event.get("scroll_depth_pct") is not None:
            page["maxScrollDepthPct"] = max(page["maxScrollDepthPct"], float(event.get("scroll_depth_pct") or 0))
        if not page.get("lastSeenAt") or str(event.get("occurred_at") or "") > str(page.get("lastSeenAt") or ""):
            page["lastSeenAt"] = event.get("occurred_at")

    pages = []
    for page in page_map.values():
        pages.append(
            {
                **{key: value for key, value in page.items() if key != "sessions"},
                "sessions": len(page["sessions"]),
            }
        )

    pages.sort(key=lambda item: item["events"], reverse=True)
    return {
        "status": "ok",
        "property_id": str(property_id),
        "range": {
            "start_date": start_date.isoformat(),
            "end_date": end_date.isoformat(),
        },
        "filters": {
            "siteKey": site_key or "",
        },
        "pages": pages,
        "staging_only": True,
    }


def get_heatmap_summary(
    property_id: str,
    *,
    start_date_value: str | None = None,
    end_date_value: str | None = None,
    site_key: str | None = None,
    path: str | None = None,
    event_type: str | None = None,
    device_type: str | None = None,
    access_token: str | None = None,
) -> dict[str, Any]:
    end_date = _parse_iso_date(end_date_value) or datetime.now(timezone.utc).date()
    start_date = _parse_iso_date(start_date_value) or (end_date - timedelta(days=HEATMAP_DEFAULT_DAYS - 1))
    if start_date > end_date:
        start_date, end_date = end_date, start_date

    filters = [
        ("select", "*"),
        ("property_id", f"eq.{property_id}"),
        ("occurred_at", f"gte.{start_date.isoformat()}T00:00:00+00:00"),
        ("occurred_at", f"lte.{end_date.isoformat()}T23:59:59+00:00"),
        ("order", "occurred_at.desc"),
        ("limit", "5000"),
    ]
    if site_key:
        site = _fetch_site_by_key(site_key)
        if site:
            filters.append(("site_id", f"eq.{site.get('id')}"))
    if path:
        filters.append(("path", f"eq.{_normalize_text(path, 1024)}"))
    if event_type and event_type in HEATMAP_EVENT_TYPES:
        filters.append(("event_type", f"eq.{event_type}"))

    events = _fetch_json(
        "property_heatmap_events",
        filters,
        headers=_supabase_anon_headers(access_token),
    )
    normalized_device_type = _normalize_text(device_type, 40).lower()
    if normalized_device_type in {"desktop", "mobile", "tablet"}:
        events = [
            event for event in events
            if (event.get("raw_data") if isinstance(event.get("raw_data"), dict) else {}).get("deviceType") == normalized_device_type
        ]

    counts_by_type: dict[str, int] = {}
    counts_by_path: dict[str, int] = {}
    target_counts: dict[str, int] = {}
    session_keys: set[str] = set()
    max_scroll_depth = 0.0
    scroll_depth_total = 0.0
    scroll_depth_count = 0
    points = []
    for event in events:
        event_kind = str(event.get("event_type") or "")
        event_path = str(event.get("path") or "/")
        raw_data = event.get("raw_data") if isinstance(event.get("raw_data"), dict) else {}
        if event.get("session_key"):
            session_keys.add(str(event.get("session_key")))
        counts_by_type[event_kind] = counts_by_type.get(event_kind, 0) + 1
        counts_by_path[event_path] = counts_by_path.get(event_path, 0) + 1
        if event_kind in {"click", "cta_click"}:
            target_label = _normalize_text(raw_data.get("targetLabel") or event.get("target_id") or event.get("target_classes") or event.get("target_tag"), 160)
            if target_label:
                target_counts[target_label] = target_counts.get(target_label, 0) + 1
        if event.get("scroll_depth_pct") is not None:
            scroll_depth = float(event.get("scroll_depth_pct") or 0)
            max_scroll_depth = max(max_scroll_depth, scroll_depth)
            scroll_depth_total += scroll_depth
            scroll_depth_count += 1
        if event.get("x_pct") is not None or event.get("y_pct") is not None:
            points.append(
                {
                    "type": event_kind,
                    "path": event_path,
                    "sessionKey": event.get("session_key"),
                    "xPct": event.get("x_pct"),
                    "yPct": event.get("y_pct"),
                    "scrollDepthPct": event.get("scroll_depth_pct"),
                    "targetTag": event.get("target_tag"),
                    "targetId": event.get("target_id"),
                    "targetLabel": raw_data.get("targetLabel") or "",
                    "targetHref": raw_data.get("targetHref") or "",
                    "deviceType": raw_data.get("deviceType") or "",
                    "occurredAt": event.get("occurred_at"),
                }
            )

    return {
        "status": "ok",
        "property_id": str(property_id),
        "range": {
            "start_date": start_date.isoformat(),
            "end_date": end_date.isoformat(),
        },
        "filters": {
            "siteKey": site_key or "",
            "path": path or "",
            "eventType": event_type or "",
            "deviceType": normalized_device_type if normalized_device_type in {"desktop", "mobile", "tablet"} else "",
        },
        "totals": {
            "sessions": len(session_keys),
            "events": len(events),
            "clicks": counts_by_type.get("click", 0),
            "ctaClicks": counts_by_type.get("cta_click", 0),
            "mouseMoves": counts_by_type.get("mousemove", 0),
            "engagements": counts_by_type.get("engagement", 0),
            "scrolls": counts_by_type.get("scroll", 0),
            "pageDurationEvents": counts_by_type.get("page_duration", 0),
            "avgScrollDepthPct": (scroll_depth_total / scroll_depth_count) if scroll_depth_count else 0.0,
            "maxScrollDepthPct": max_scroll_depth,
        },
        "countsByType": counts_by_type,
        "topPaths": [
            {"path": item_path, "events": count}
            for item_path, count in sorted(counts_by_path.items(), key=lambda item: item[1], reverse=True)[:20]
        ],
        "topTargets": [
            {"label": label, "clicks": count}
            for label, count in sorted(target_counts.items(), key=lambda item: item[1], reverse=True)[:20]
        ],
        "points": points[:2500],
        "sessions": sorted(session_keys)[:100],
        "staging_only": True,
    }


def _fetch_site_id_filter(site_key: str | None) -> str | None:
    if not site_key:
        return None
    site = _fetch_site_by_key(site_key)
    return str(site.get("id")) if site else None


def _latest_snapshots_by_page(
    property_id: str,
    *,
    site_id: str | None = None,
    access_token: str | None = None,
) -> dict[str, dict[str, Any]]:
    filters = [
        ("select", "*"),
        ("property_id", f"eq.{property_id}"),
        ("order", "captured_at.desc"),
        ("limit", "1000"),
    ]
    if site_id:
        filters.append(("site_id", f"eq.{site_id}"))
    rows = _fetch_json(
        "property_site_page_snapshots",
        filters,
        headers=_supabase_anon_headers(access_token) if access_token else None,
    )
    latest: dict[str, dict[str, Any]] = {}
    for row in rows:
        page_id = str(row.get("page_id") or "")
        if page_id and page_id not in latest:
            latest[page_id] = row
    return latest


def _screenshots_by_page(
    property_id: str,
    *,
    site_id: str | None = None,
    access_token: str | None = None,
) -> dict[str, list[dict[str, Any]]]:
    filters = [
        ("select", "*"),
        ("property_id", f"eq.{property_id}"),
        ("order", "captured_at.desc"),
        ("limit", "1000"),
    ]
    if site_id:
        filters.append(("site_id", f"eq.{site_id}"))
    rows = _fetch_json(
        "property_site_screenshots",
        filters,
        headers=_supabase_anon_headers(access_token) if access_token else None,
    )
    grouped: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        grouped.setdefault(str(row.get("page_id") or ""), []).append(row)
    return grouped


def get_site_screenshot_preview_summary(
    screenshot_id: str,
    *,
    access_token: str | None = None,
    expires_in: int = 900,
) -> dict[str, Any]:
    screenshot_id = _normalize_text(screenshot_id, 120)
    if not screenshot_id:
        raise ValueError("Missing required parameter: screenshot_id")

    rows = _fetch_json(
        "property_site_screenshots",
        [
            ("select", "*"),
            ("id", f"eq.{screenshot_id}"),
            ("limit", "1"),
        ],
        headers=_supabase_anon_headers(access_token),
    )
    if not rows:
        raise LookupError("Screenshot was not found.")

    screenshot = rows[0]
    storage_bucket = _normalize_text(screenshot.get("storage_bucket"), 160)
    storage_path = _normalize_text(screenshot.get("storage_path"), 1024)
    if not storage_bucket or not storage_path:
        raise ValueError("Screenshot row does not have a storage bucket/path.")

    expires_in = max(60, min(3600, int(expires_in or 900)))
    signed = _create_signed_read_url(storage_bucket, storage_path, expires_in=expires_in)
    signed_path = signed.get("signedURL") or signed.get("signedUrl") or signed.get("signed_url") or signed.get("url")
    if not signed_path:
        raise RuntimeError("Supabase did not return a signed screenshot preview URL.")
    preview_url = _resolve_storage_signed_url(signed_path)

    return {
        "status": "ok",
        "url": preview_url,
        "expiresIn": expires_in,
        "screenshot": {
            "id": screenshot.get("id"),
            "propertyId": screenshot.get("property_id"),
            "pageId": screenshot.get("page_id"),
            "deviceType": screenshot.get("device_type"),
            "storageBucket": storage_bucket,
            "storagePath": storage_path,
            "width": screenshot.get("width"),
            "height": screenshot.get("height"),
            "contentHash": screenshot.get("content_hash"),
            "capturedAt": screenshot.get("captured_at"),
        },
        "staging_only": True,
    }


def _shape_audit_page(page: dict[str, Any], snapshot: dict[str, Any] | None, screenshots: list[dict[str, Any]] | None) -> dict[str, Any]:
    safe_snapshot = snapshot or {}
    return {
        "id": page.get("id"),
        "path": page.get("canonical_path"),
        "url": page.get("canonical_url"),
        "title": safe_snapshot.get("title") or page.get("latest_title"),
        "metaDescription": safe_snapshot.get("meta_description") or page.get("latest_meta_description"),
        "lastSeenAt": page.get("last_seen_at"),
        "latestSnapshotId": page.get("latest_snapshot_id"),
        "latestScreenshotId": page.get("latest_screenshot_id"),
        "capturedAt": safe_snapshot.get("captured_at"),
        "headings": safe_snapshot.get("headings") or [],
        "ctas": safe_snapshot.get("ctas") or [],
        "internalLinks": safe_snapshot.get("internal_links") or [],
        "promoDateStrings": safe_snapshot.get("promo_date_strings") or [],
        "pageStructure": safe_snapshot.get("page_structure") or {},
        "screenshots": [
            {
                "id": item.get("id"),
                "deviceType": item.get("device_type"),
                "storageBucket": item.get("storage_bucket"),
                "storagePath": item.get("storage_path"),
                "width": item.get("width"),
                "height": item.get("height"),
                "contentHash": item.get("content_hash"),
                "capturedAt": item.get("captured_at"),
            }
            for item in (screenshots or [])[:5]
        ],
    }


def get_site_audit_pages_summary(
    property_id: str,
    *,
    site_key: str | None = None,
    access_token: str | None = None,
) -> dict[str, Any]:
    site_id = _fetch_site_id_filter(site_key)
    filters = [
        ("select", "*"),
        ("property_id", f"eq.{property_id}"),
        ("order", "last_seen_at.desc"),
        ("limit", "500"),
    ]
    if site_id:
        filters.append(("site_id", f"eq.{site_id}"))
    pages = _fetch_json(
        "property_site_pages",
        filters,
        headers=_supabase_anon_headers(access_token),
    )
    snapshots = _latest_snapshots_by_page(property_id, site_id=site_id, access_token=access_token)
    screenshots = _screenshots_by_page(property_id, site_id=site_id, access_token=access_token)
    return {
        "status": "ok",
        "property_id": str(property_id),
        "filters": {"siteKey": site_key or ""},
        "pages": [
            _shape_audit_page(page, snapshots.get(str(page.get("id"))), screenshots.get(str(page.get("id"))))
            for page in pages
        ],
        "staging_only": True,
    }


def _date_strings_with_possible_expiry(values: list[Any]) -> list[str]:
    current_year = datetime.now(timezone.utc).year
    stale = []
    for value in values:
        text = _normalize_text(value, 80)
        if not text:
            continue
        year_matches = [int(match) for match in re.findall(r"\b(20\d{2})\b", text)]
        if any(year < current_year for year in year_matches):
            stale.append(text)
    return stale


def _audit_page(page: dict[str, Any]) -> dict[str, Any]:
    title = _normalize_text(page.get("title"), 220)
    meta = _normalize_text(page.get("metaDescription"), 320)
    headings = page.get("headings") if isinstance(page.get("headings"), list) else []
    ctas = page.get("ctas") if isinstance(page.get("ctas"), list) else []
    links = page.get("internalLinks") if isinstance(page.get("internalLinks"), list) else []
    date_strings = page.get("promoDateStrings") if isinstance(page.get("promoDateStrings"), list) else []
    structure = page.get("pageStructure") if isinstance(page.get("pageStructure"), dict) else {}

    issues = []
    recommendations = []
    if not title:
        issues.append("Missing page title.")
    if not meta:
        issues.append("Missing meta description.")
    if not any(item.get("level") == "h1" for item in headings if isinstance(item, dict)):
        issues.append("Missing visible H1 heading.")
    if not ctas:
        issues.append("No visible CTA-like links or buttons detected.")
    stale_dates = _date_strings_with_possible_expiry(date_strings)
    if stale_dates:
        issues.append(f"Possible stale date or expired offer text: {', '.join(stale_dates[:3])}.")

    suspicious_links = []
    for link in links:
        if not isinstance(link, dict):
            continue
        href = _normalize_text(link.get("href"), 1024)
        if not href or href.startswith(("javascript:", "mailto:", "tel:")):
            continue
        parsed = urlparse(href)
        if parsed.scheme and parsed.scheme != "https":
            suspicious_links.append(href)
    if suspicious_links:
        issues.append(f"Internal non-HTTPS links detected: {len(suspicious_links)}.")

    if not meta:
        recommendations.append("Add a concise meta description for search and sharing previews.")
    if not ctas:
        recommendations.append("Add or strengthen visible tour, apply, availability, or contact CTAs.")
    if stale_dates:
        recommendations.append("Review promo and date language for expired leasing offers.")
    if int(structure.get("imageCount") or 0) > 35:
        recommendations.append("Review image weight and lazy-loading on this page.")

    h1_count = sum(1 for item in headings if isinstance(item, dict) and item.get("level") == "h1")
    h2_count = sum(1 for item in headings if isinstance(item, dict) and item.get("level") == "h2")
    link_count = int(structure.get("linkCount") or len(links) or 0)
    image_count = int(structure.get("imageCount") or 0)
    form_count = int(structure.get("formCount") or 0)

    seo_score = 100
    seo_score -= 30 if not title else 0
    seo_score -= 25 if not meta else 0
    seo_score -= 25 if h1_count == 0 else 0
    seo_score -= 10 if h1_count > 1 else 0
    seo_score -= 10 if h2_count == 0 else 0

    cta_score = 100
    cta_score -= 45 if not ctas else 0
    cta_score -= 15 if len(ctas) == 1 else 0
    cta_score -= 10 if form_count == 0 and not any("apply" in _normalize_text(cta.get("label") if isinstance(cta, dict) else cta, 160).lower() for cta in ctas) else 0

    stale_date_score = max(0, 100 - min(80, len(stale_dates) * 25))
    internal_link_score = max(0, 100 - min(70, len(suspicious_links) * 18))

    page_structure_score = 100
    page_structure_score -= 20 if h1_count == 0 else 0
    page_structure_score -= 15 if h2_count == 0 else 0
    page_structure_score -= 15 if link_count == 0 else 0
    page_structure_score -= 10 if form_count == 0 and not ctas else 0

    performance_proxy_score = 100
    performance_proxy_score -= min(30, max(0, image_count - 20) * 2)
    performance_proxy_score -= 10 if not page.get("screenshots") else 0
    performance_proxy_score -= min(20, max(0, link_count - 120) // 10)

    category_scores = {
        "seoBasics": max(0, min(100, round(seo_score, 1))),
        "ctaClarity": max(0, min(100, round(cta_score, 1))),
        "staleDates": max(0, min(100, round(stale_date_score, 1))),
        "internalLinks": max(0, min(100, round(internal_link_score, 1))),
        "pageStructure": max(0, min(100, round(page_structure_score, 1))),
        "performanceProxy": max(0, min(100, round(performance_proxy_score, 1))),
    }
    category_weights = {
        "seoBasics": 0.2,
        "ctaClarity": 0.2,
        "staleDates": 0.15,
        "internalLinks": 0.15,
        "pageStructure": 0.15,
        "performanceProxy": 0.15,
    }
    score = round(sum(category_scores[key] * weight for key, weight in category_weights.items()), 1)

    return {
        "pageId": page.get("id"),
        "path": page.get("path"),
        "url": page.get("url"),
        "score": score,
        "categoryScores": category_scores,
        "categoryWeights": category_weights,
        "issues": issues,
        "recommendations": recommendations,
        "staleDateStrings": stale_dates,
        "suspiciousLinks": suspicious_links[:10],
        "hasMetaDescription": bool(meta),
        "hasH1": any(item.get("level") == "h1" for item in headings if isinstance(item, dict)),
        "ctaCount": len(ctas),
        "internalLinkCount": len(links),
        "screenshotCount": len(page.get("screenshots") or []),
        "imageCount": image_count,
        "formCount": form_count,
    }


def run_site_audit_summary(
    property_id: str,
    *,
    site_key: str | None = None,
    access_token: str | None = None,
) -> dict[str, Any]:
    pages_payload = get_site_audit_pages_summary(property_id, site_key=site_key, access_token=access_token)
    pages = pages_payload.get("pages") if isinstance(pages_payload.get("pages"), list) else []
    page_results = [_audit_page(page) for page in pages]
    all_issues = [
        {"path": page.get("path"), "issue": issue}
        for page in page_results
        for issue in page.get("issues", [])
    ]
    broken_links = [
        {"path": page.get("path"), "href": href}
        for page in page_results
        for href in page.get("suspiciousLinks", [])
    ]
    stale_date_findings = [
        {"path": page.get("path"), "text": text}
        for page in page_results
        for text in page.get("staleDateStrings", [])
    ]
    recommendations = []
    seen_recommendations = set()
    for page in page_results:
        for recommendation in page.get("recommendations", []):
            if recommendation not in seen_recommendations:
                seen_recommendations.add(recommendation)
                recommendations.append(recommendation)

    average_score = round(sum(page.get("score", 0) for page in page_results) / len(page_results), 1) if page_results else 0
    category_keys = ["seoBasics", "ctaClarity", "staleDates", "internalLinks", "pageStructure", "performanceProxy"]
    category_labels = {
        "seoBasics": "SEO basics",
        "ctaClarity": "CTA clarity",
        "staleDates": "Stale dates",
        "internalLinks": "Internal links",
        "pageStructure": "Page structure",
        "performanceProxy": "Performance proxy",
    }
    category_scores = {
        key: round(
            sum((page.get("categoryScores") or {}).get(key, 0) for page in page_results) / len(page_results),
            1,
        )
        for key in category_keys
    } if page_results else {key: 0 for key in category_keys}
    category_weights = {
        "seoBasics": 0.2,
        "ctaClarity": 0.2,
        "staleDates": 0.15,
        "internalLinks": 0.15,
        "pageStructure": 0.15,
        "performanceProxy": 0.15,
    }
    weighted_score = round(sum(category_scores[key] * category_weights[key] for key in category_keys), 1) if page_results else 0
    urgency_score = category_scores["ctaClarity"]
    freshness_score = category_scores["staleDates"]
    link_score = category_scores["internalLinks"]

    site_id = _fetch_site_id_filter(site_key)
    row = {
        "property_id": str(property_id),
        "site_id": site_id,
        "status": "ok" if not all_issues else "needs_attention",
        "audited_at": datetime.now(timezone.utc).isoformat(),
        "page_count": len(page_results),
        "performance_score": weighted_score,
        "urgency_score": urgency_score,
        "freshness_score": freshness_score,
        "link_score": link_score,
        "summary": (
            f"Audited {len(page_results)} pages. Weighted score {weighted_score}."
            if page_results
            else "No page snapshots are available yet."
        ),
        "issues": all_issues[:100],
        "recommendations": recommendations[:20],
        "broken_links": broken_links[:100],
        "stale_date_findings": stale_date_findings[:100],
        "performance_notes": [
            {
                "path": page.get("path"),
                "score": page.get("score"),
                "categoryScores": page.get("categoryScores"),
                "screenshotCount": page.get("screenshotCount"),
                "internalLinkCount": page.get("internalLinkCount"),
                "ctaCount": page.get("ctaCount"),
                "imageCount": page.get("imageCount"),
                "formCount": page.get("formCount"),
            }
            for page in page_results
        ][:100],
        "pages": page_results[:500],
        "raw_data": {
            "siteKey": site_key or "",
            "algorithm": "redstone-weighted-site-audit-v2",
            "categoryScores": [
                {
                    "key": key,
                    "label": category_labels[key],
                    "score": category_scores[key],
                    "weight": category_weights[key],
                }
                for key in category_keys
            ],
            "legacyAverageScore": average_score,
        },
    }
    rows = _json_request(
        "property_site_audits",
        [("select", "*")],
        method="POST",
        payload=row,
        headers={**_supabase_headers(), "Prefer": "return=representation"},
    )
    audit = rows[0] if isinstance(rows, list) and rows else row
    return {
        "status": "ok",
        "property_id": str(property_id),
        "audit": audit,
        "staging_only": True,
    }


def get_site_audit_summary(
    property_id: str,
    *,
    site_key: str | None = None,
    access_token: str | None = None,
) -> dict[str, Any]:
    site_id = _fetch_site_id_filter(site_key)
    filters = [
        ("select", "*"),
        ("property_id", f"eq.{property_id}"),
        ("order", "audited_at.desc"),
        ("limit", "1"),
    ]
    if site_id:
        filters.append(("site_id", f"eq.{site_id}"))
    rows = _fetch_json(
        "property_site_audits",
        filters,
        headers=_supabase_anon_headers(access_token),
    )
    return {
        "status": "ok",
        "property_id": str(property_id),
        "filters": {"siteKey": site_key or ""},
        "audit": rows[0] if rows else None,
        "staging_only": True,
    }


def list_site_audit_portfolio_summary(
    *,
    access_token: str,
) -> dict[str, Any]:
    property_rows = _fetch_json(
        "properties",
        [
            ("select", "id,name,city,state,portfolio,org_slug"),
            ("order", "name.asc"),
        ],
        headers=_supabase_anon_headers(access_token),
    )
    audit_rows = _fetch_json(
        "property_site_audits",
        [
            (
                "select",
                "property_id,audited_at,status,page_count,performance_score,urgency_score,freshness_score,link_score,summary,issues,recommendations,broken_links,stale_date_findings,performance_notes",
            ),
            ("order", "audited_at.desc"),
            ("limit", "5000"),
        ],
        headers=_supabase_anon_headers(access_token),
    )

    latest_audit_by_property: dict[str, dict[str, Any]] = {}
    for row in audit_rows or []:
        property_id = _normalize_text(row.get("property_id"), 120)
        if property_id and property_id not in latest_audit_by_property:
            latest_audit_by_property[property_id] = row

    summaries = []
    for property_row in property_rows or []:
        property_id = _normalize_text(property_row.get("id"), 120)
        audit_row = latest_audit_by_property.get(property_id)
        issues = audit_row.get("issues") if isinstance(audit_row, dict) and isinstance(audit_row.get("issues"), list) else []
        recommendations = (
            audit_row.get("recommendations")
            if isinstance(audit_row, dict) and isinstance(audit_row.get("recommendations"), list)
            else []
        )
        broken_links = (
            audit_row.get("broken_links")
            if isinstance(audit_row, dict) and isinstance(audit_row.get("broken_links"), list)
            else []
        )
        stale_dates = (
            audit_row.get("stale_date_findings")
            if isinstance(audit_row, dict) and isinstance(audit_row.get("stale_date_findings"), list)
            else []
        )
        performance_notes = (
            audit_row.get("performance_notes")
            if isinstance(audit_row, dict) and isinstance(audit_row.get("performance_notes"), list)
            else []
        )
        screenshot_pages = sum(
            1
            for note in performance_notes
            if isinstance(note, dict) and int(note.get("screenshotCount") or 0) > 0
        )
        cta_missing_pages = sum(
            1 for note in performance_notes if isinstance(note, dict) and int(note.get("ctaCount") or 0) <= 0
        )
        summary = {
            "propertyId": property_id,
            "propertyName": property_row.get("name") or f"Property {property_id}",
            "city": property_row.get("city") or "",
            "state": property_row.get("state") or "",
            "portfolio": property_row.get("portfolio") or "",
            "orgSlug": property_row.get("org_slug") or "",
            "hasAudit": bool(audit_row),
            "auditStatus": audit_row.get("status") if isinstance(audit_row, dict) else "not_started",
            "auditedAt": audit_row.get("audited_at") if isinstance(audit_row, dict) else None,
            "pageCount": int(audit_row.get("page_count") or 0) if isinstance(audit_row, dict) else 0,
            "performanceScore": _to_float(audit_row.get("performance_score")) if isinstance(audit_row, dict) else None,
            "urgencyScore": _to_float(audit_row.get("urgency_score")) if isinstance(audit_row, dict) else None,
            "freshnessScore": _to_float(audit_row.get("freshness_score")) if isinstance(audit_row, dict) else None,
            "linkScore": _to_float(audit_row.get("link_score")) if isinstance(audit_row, dict) else None,
            "issueCount": len(issues),
            "recommendationCount": len(recommendations),
            "brokenLinkCount": len(broken_links),
            "staleDateCount": len(stale_dates),
            "screenshotPageCount": screenshot_pages,
            "ctaMissingPageCount": cta_missing_pages,
            "summary": audit_row.get("summary") if isinstance(audit_row, dict) else "No audit has been run yet.",
            "topIssue": (
                issues[0].get("issue")
                if issues and isinstance(issues[0], dict)
                else issues[0] if issues else "Run an audit to generate property findings."
            ),
        }
        summaries.append(summary)

    def _sort_key(item: dict[str, Any]) -> tuple[float, int, int, str]:
        score = item.get("performanceScore")
        normalized_score = float(score) if score is not None else -1.0
        return (
            normalized_score,
            -int(item.get("issueCount") or 0),
            -int(item.get("brokenLinkCount") or 0),
            str(item.get("propertyName") or ""),
        )

    ranked = sorted(summaries, key=_sort_key)
    return {
        "status": "ok",
        "count": len(ranked),
        "properties": ranked,
        "staging_only": True,
    }


def build_tracker_script(
    property_id: str,
    site_key: str,
    collector_url: str,
    sampling_rate: float = HEATMAP_DEFAULT_SAMPLE_RATE,
    feature_flags: dict[str, bool] | None = None,
    screenshot_capture_frequency: str = "manual",
    consent_mode: str = HEATMAP_DEFAULT_CONSENT_MODE,
    respect_dnt: bool = True,
) -> str:
    encoded_property_id = json.dumps(property_id)
    encoded_site_key = json.dumps(site_key)
    encoded_collector_url = json.dumps(collector_url)
    encoded_sampling_rate = max(0, min(1, float(sampling_rate if sampling_rate is not None else HEATMAP_DEFAULT_SAMPLE_RATE)))
    encoded_feature_flags = json.dumps(_normalize_feature_flags(feature_flags))
    encoded_capture_frequency = json.dumps(_normalize_capture_frequency(screenshot_capture_frequency))
    encoded_consent_mode = json.dumps(_normalize_consent_mode(consent_mode))
    encoded_respect_dnt = json.dumps(bool(respect_dnt))
    return f"""(function() {{
  var PROPERTY_ID = {encoded_property_id};
  var SITE_KEY = {encoded_site_key};
  var COLLECTOR_URL = {encoded_collector_url};
  var SAMPLE_RATE = {encoded_sampling_rate};
  var FEATURE_FLAGS = {encoded_feature_flags};
  var SCREENSHOT_CAPTURE_FREQUENCY = {encoded_capture_frequency};
  var CONSENT_MODE = {encoded_consent_mode};
  var RESPECT_DNT = {encoded_respect_dnt};
  var MAX_QUEUE = 40;
  var FLUSH_MS = 5000;
  var MOVE_THROTTLE_MS = 750;
  var SCROLL_THROTTLE_MS = 1000;
  var DWELL_MS = 2000;
  var startedAt = Date.now();
  if (!SITE_KEY) return;
  if (!FEATURE_FLAGS.heatmaps && !FEATURE_FLAGS.pageSnapshots && !FEATURE_FLAGS.screenshots) return;

  function hasConsent() {{
    if (RESPECT_DNT && (navigator.doNotTrack === '1' || window.doNotTrack === '1')) return false;
    if (CONSENT_MODE === 'disabled') return true;
    var explicitAllow = window.redstoneTrackingConsent === true || window.REDSTONE_TRACKING_CONSENT === true;
    var explicitDeny = window.redstoneTrackingConsent === false || window.REDSTONE_TRACKING_CONSENT === false;
    var storageConsent = '';
    try {{
      storageConsent = localStorage.getItem('redstone_tracking_consent') || '';
    }} catch (e) {{}}
    var cookie = document.cookie || '';
    if (storageConsent === 'granted' || /(^|;\\s*)redstone_tracking_consent=granted(;|$)/.test(cookie)) explicitAllow = true;
    if (storageConsent === 'denied' || /(^|;\\s*)redstone_tracking_consent=denied(;|$)/.test(cookie)) explicitDeny = true;
    if (explicitDeny) return false;
    if (CONSENT_MODE === 'required') return explicitAllow;
    return true;
  }}

  if (!hasConsent()) return;

  function sessionId() {{
    var key = '__redstone_tracker_sid';
    var existing = sessionStorage.getItem(key);
    if (existing) return existing;
    var value = 'sess_' + Math.random().toString(36).slice(2) + '_' + Date.now();
    sessionStorage.setItem(key, value);
    return value;
  }}

  function sampledIn() {{
    var key = '__redstone_tracker_sample_' + SITE_KEY;
    var existing = sessionStorage.getItem(key);
    if (existing === '1') return true;
    if (existing === '0') return false;
    var included = Math.random() <= SAMPLE_RATE;
    sessionStorage.setItem(key, included ? '1' : '0');
    return included;
  }}

  if (!sampledIn()) return;

  var sid = sessionId();
  var queue = [];
  var lastMove = 0;
  var lastScroll = 0;
  var lastDwell = 0;
  var lastPointer = null;
  var pageSent = false;

  function absoluteUrl(value) {{
    try {{
      return new URL(value || location.href, location.href).href;
    }} catch (e) {{
      return location.href;
    }}
  }}

  function canonicalPath() {{
    var canonical = document.querySelector('link[rel="canonical"]');
    var href = canonical && canonical.href ? canonical.href : location.href;
    try {{
      return new URL(href, location.href).pathname || '/';
    }} catch (e) {{
      return location.pathname || '/';
    }}
  }}

  function deviceType() {{
    var width = window.innerWidth || 0;
    if (width <= 767) return 'mobile';
    if (width <= 1024) return 'tablet';
    return 'desktop';
  }}

  function docSize() {{
    return {{
      documentWidth: Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0, window.innerWidth || 0),
      documentHeight: Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0, window.innerHeight || 0)
    }};
  }}

  function common() {{
    var size = docSize();
    return {{
      propertyId: PROPERTY_ID,
      url: location.href,
      path: location.pathname || '/',
      canonicalPath: canonicalPath(),
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      documentWidth: size.documentWidth,
      documentHeight: size.documentHeight,
      deviceType: deviceType()
    }};
  }}

  function cleanText(value, max) {{
    return String(value || '').replace(/\\s+/g, ' ').trim().slice(0, max || 120);
  }}

  function isSensitiveElement(target) {{
    if (!target || !target.closest) return false;
    return Boolean(target.closest('input, textarea, select, option, [contenteditable="true"], [data-redstone-private], [data-private], [aria-hidden="true"]'));
  }}

  function isVisibleElement(target) {{
    if (!target || target === document || target === window) return true;
    var style = window.getComputedStyle ? window.getComputedStyle(target) : null;
    return !style || (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0');
  }}

  function actionLabel(target) {{
    if (!target || isSensitiveElement(target)) return '';
    var text = cleanText(target.getAttribute && (target.getAttribute('aria-label') || target.getAttribute('title')), 100);
    if (text) return text;
    if (/^(A|BUTTON)$/i.test(target.tagName || '')) return cleanText(target.textContent, 100);
    var action = target.closest && target.closest('a, button, [role="button"]');
    return action ? cleanText(action.textContent, 100) : '';
  }}

  function isCta(target) {{
    if (!target || isSensitiveElement(target)) return false;
    var action = target.closest && target.closest('a, button, [role="button"], [data-cta], .cta, .button, .btn');
    if (!action) return false;
    var label = actionLabel(action).toLowerCase();
    var href = action.href || '';
    return Boolean(action.hasAttribute && action.hasAttribute('data-cta')) ||
      /apply|lease|tour|schedule|availability|floor\\s*plan|contact|call|text|book|reserve|special|offer/.test(label + ' ' + href);
  }}

  function targetMeta(target) {{
    if (!target || target === document || target === window) return {{}};
    var tag = target.tagName || '';
    if (isSensitiveElement(target)) return {{ targetTag: tag, sensitive: true }};
    var action = target.closest && target.closest('a, button, [role="button"]');
    return {{
      targetTag: tag,
      targetId: target.id || '',
      targetClass: typeof target.className === 'string' ? target.className.slice(0, 300) : '',
      targetRole: target.getAttribute ? (target.getAttribute('role') || '') : '',
      targetHref: action && action.href ? absoluteUrl(action.href).slice(0, 1024) : '',
      targetLabel: actionLabel(action || target),
      isCta: isCta(target)
    }};
  }}

  function findMetaDescription() {{
    var meta = document.querySelector('meta[name="description"]');
    return meta ? cleanText(meta.getAttribute('content'), 320) : '';
  }}

  function collectHeadings() {{
    return Array.prototype.slice.call(document.querySelectorAll('h1, h2, h3'), 0, 24).filter(isVisibleElement).map(function(node) {{
      return {{ level: String(node.tagName || '').toLowerCase(), text: cleanText(node.textContent, 160) }};
    }}).filter(function(item) {{ return item.text; }});
  }}

  function collectCtas() {{
    return Array.prototype.slice.call(document.querySelectorAll('a, button, [role="button"], [data-cta], .cta, .button, .btn'), 0, 80)
      .filter(function(node) {{ return isVisibleElement(node) && !isSensitiveElement(node) && isCta(node); }})
      .slice(0, 30)
      .map(function(node) {{
        return {{
          label: actionLabel(node),
          href: node.href ? absoluteUrl(node.href).slice(0, 1024) : '',
          tag: String(node.tagName || '').toLowerCase()
        }};
      }});
  }}

  function collectInternalLinks() {{
    var host = location.hostname.replace(/^www\\./, '');
    var seen = {{}};
    return Array.prototype.slice.call(document.querySelectorAll('a[href]'), 0, 250).map(function(anchor) {{
      if (!isVisibleElement(anchor) || isSensitiveElement(anchor)) return null;
      var href = absoluteUrl(anchor.href);
      var parsed;
      try {{ parsed = new URL(href); }} catch (e) {{ return null; }}
      if (parsed.hostname.replace(/^www\\./, '') !== host) return null;
      var path = parsed.pathname || '/';
      if (seen[path]) return null;
      seen[path] = true;
      return {{ href: href.slice(0, 1024), path: path.slice(0, 1024), label: cleanText(anchor.textContent, 100) }};
    }}).filter(Boolean).slice(0, 100);
  }}

  function collectPromoDateStrings() {{
    var matches = [];
    var seen = {{}};
    var walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT, {{
      acceptNode: function(node) {{
        var parent = node.parentElement;
        if (!parent || !isVisibleElement(parent) || isSensitiveElement(parent) || /^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA|INPUT)$/i.test(parent.tagName || '')) {{
          return NodeFilter.FILTER_REJECT;
        }}
        return NodeFilter.FILTER_ACCEPT;
      }}
    }});
    var pattern = /\\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?|\\d{{1,2}}[\\/.-]\\d{{1,2}})(?:\\s+\\d{{1,2}})?(?:,?\\s+\\d{{2,4}})?\\b/g;
    var node;
    while ((node = walker.nextNode()) && matches.length < 30) {{
      var text = cleanText(node.nodeValue, 240);
      var found = text.match(pattern) || [];
      found.forEach(function(item) {{
        var cleaned = cleanText(item, 80);
        if (cleaned && !seen[cleaned] && matches.length < 30) {{
          seen[cleaned] = true;
          matches.push(cleaned);
        }}
      }});
    }}
    return matches;
  }}

  function collectPageStructure() {{
    return {{
      h1Count: document.querySelectorAll('h1').length,
      h2Count: document.querySelectorAll('h2').length,
      h3Count: document.querySelectorAll('h3').length,
      linkCount: document.querySelectorAll('a[href]').length,
      ctaCount: collectCtas().length,
      imageCount: document.querySelectorAll('img').length,
      formCount: document.querySelectorAll('form').length
    }};
  }}

  function collectPageSnapshot() {{
    return {{
      url: location.href,
      canonicalUrl: absoluteUrl((document.querySelector('link[rel="canonical"]') || {{}}).href || location.href),
      canonicalPath: canonicalPath(),
      title: cleanText(document.title, 220),
      metaDescription: findMetaDescription(),
      headings: collectHeadings(),
      ctas: collectCtas(),
      internalLinks: collectInternalLinks(),
      promoDateStrings: collectPromoDateStrings(),
      pageStructure: collectPageStructure(),
      screenshot: {{ available: false }},
      capturedAt: new Date().toISOString()
    }};
  }}

  function scrollDepth() {{
    var size = docSize();
    return Math.min(1, (window.scrollY + window.innerHeight) / Math.max(1, size.documentHeight));
  }}

  function enqueue(type, data) {{
    queue.push({{ type: type, occurredAt: new Date().toISOString(), data: Object.assign(common(), data || {{}}) }});
    if (queue.length >= MAX_QUEUE) flush();
  }}

  function flush() {{
    if (!queue.length && pageSent) return;
    var events = queue.splice(0, queue.length);
    var pageSnapshot = (!pageSent && FEATURE_FLAGS.pageSnapshots) ? collectPageSnapshot() : undefined;
    var payload = JSON.stringify({{
      propertyId: PROPERTY_ID,
      siteKey: SITE_KEY,
      sampleRate: SAMPLE_RATE,
      featureFlags: FEATURE_FLAGS,
      screenshotCaptureFrequency: SCREENSHOT_CAPTURE_FREQUENCY,
      url: location.href,
      path: location.pathname || '/',
      session: {{
        sessionId: sid,
        propertyId: PROPERTY_ID,
        url: location.href,
        referrer: document.referrer,
        userAgent: navigator.userAgent,
        screenWidth: screen.width,
        screenHeight: screen.height,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        deviceType: deviceType()
      }},
      page: pageSnapshot,
      events: FEATURE_FLAGS.heatmaps ? events : []
    }});
    pageSent = true;
    if (navigator.sendBeacon) {{
      navigator.sendBeacon(COLLECTOR_URL, new Blob([payload], {{ type: 'application/json' }}));
    }} else {{
      fetch(COLLECTOR_URL, {{ method: 'POST', headers: {{ 'Content-Type': 'application/json' }}, body: payload, keepalive: true }}).catch(function() {{}});
    }}
  }}

  enqueue('pageview', {{ scrollY: window.scrollY, scrollDepthPct: scrollDepth() }});
  document.addEventListener('click', function(e) {{
    if (isSensitiveElement(e.target)) return;
    var size = docSize();
    var meta = targetMeta(e.target);
    var point = Object.assign({{
      x: e.clientX,
      y: e.clientY,
      pageX: e.pageX,
      pageY: e.pageY,
      viewportXPct: e.clientX / Math.max(1, window.innerWidth || 1),
      viewportYPct: e.clientY / Math.max(1, window.innerHeight || 1),
      xPct: e.pageX / Math.max(1, size.documentWidth),
      yPct: e.pageY / Math.max(1, size.documentHeight)
    }}, meta);
    enqueue('click', point);
    if (meta.isCta) enqueue('cta_click', point);
  }}, true);
  document.addEventListener('mousemove', function(e) {{
    if (isSensitiveElement(e.target)) return;
    var now = Date.now();
    if (now - lastMove < MOVE_THROTTLE_MS) return;
    lastMove = now;
    var size = docSize();
    lastPointer = {{ x: e.clientX, y: e.clientY, pageX: e.pageX, pageY: e.pageY, at: now }};
    enqueue('mousemove', {{
      x: e.clientX,
      y: e.clientY,
      pageX: e.pageX,
      pageY: e.pageY,
      viewportXPct: e.clientX / Math.max(1, window.innerWidth || 1),
      viewportYPct: e.clientY / Math.max(1, window.innerHeight || 1),
      xPct: e.pageX / Math.max(1, size.documentWidth),
      yPct: e.pageY / Math.max(1, size.documentHeight)
    }});
  }}, {{ passive: true }});
  window.addEventListener('scroll', function() {{
    var now = Date.now();
    if (now - lastScroll < 1000) return;
    lastScroll = now;
    enqueue('scroll', {{
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      scrollDepthPct: scrollDepth()
    }});
  }}, {{ passive: true }});
  window.setInterval(function() {{
    if (!lastPointer) return;
    var now = Date.now();
    if (now - lastDwell < DWELL_MS) return;
    lastDwell = now;
    var size = docSize();
    enqueue('engagement', {{
      x: lastPointer.x,
      y: lastPointer.y,
      pageX: lastPointer.pageX,
      pageY: lastPointer.pageY,
      viewportXPct: lastPointer.x / Math.max(1, window.innerWidth || 1),
      viewportYPct: lastPointer.y / Math.max(1, window.innerHeight || 1),
      xPct: lastPointer.pageX / Math.max(1, size.documentWidth),
      yPct: lastPointer.pageY / Math.max(1, size.documentHeight),
      engagementMs: Math.min(DWELL_MS, now - lastPointer.at)
    }});
  }}, DWELL_MS);
  window.addEventListener('visibilitychange', function() {{
    if (document.visibilityState === 'hidden') {{
      enqueue('visibility', {{ state: 'hidden' }});
      flush();
    }}
  }});
  window.addEventListener('pagehide', function() {{
    enqueue('page_duration', {{ engagementMs: Date.now() - startedAt, scrollDepthPct: scrollDepth() }});
    flush();
  }});
  window.setInterval(flush, FLUSH_MS);
}})();
"""
