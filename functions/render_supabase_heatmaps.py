from __future__ import annotations

import json
import re
import hashlib
import os
import tempfile
import subprocess
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError
from urllib.parse import quote, urlparse
from urllib.request import Request, urlopen

from render_supabase_sync_state import _fetch_json, _table_query_url
from render_supabase_validation import (
    _require_env,
    _supabase_anon_headers,
    _supabase_headers,
)


HEATMAP_EVENT_TYPES = {
    "click",
    "mousemove",
    "pointermove",
    "pointerdown",
    "touchstart",
    "scroll",
    "engagement",
    "visibility",
    "viewport",
    "first_interaction",
    "tracker_diagnostic",
    "pageview",
    "cta_click",
    "page_duration",
}
HEATMAP_BATCH_LIMIT = 250
HEATMAP_TAP_DEDUPE_WINDOW_MS = 900
HEATMAP_TAP_DEDUPE_GRID_SIZE = 80
HEATMAP_CLICK_LIKE_EVENTS = {"click", "cta_click", "pointerdown", "touchstart"}
HEATMAP_CLICK_EVENT_PRIORITY = {"cta_click": 4, "click": 3, "pointerdown": 2, "touchstart": 1}
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


def _env_int(name: str, default: int, *, minimum: int, maximum: int) -> int:
    try:
        value = int(os.environ.get(name, "") or default)
    except (TypeError, ValueError):
        value = default
    return max(minimum, min(maximum, value))


SITE_AUDIT_AI_MODEL = os.environ.get("SITE_AUDIT_OPENAI_MODEL", "gpt-4.1-mini")
SITE_AUDIT_AI_MAX_PAGES = _env_int("SITE_AUDIT_AI_MAX_PAGES", 20, minimum=1, maximum=200)
SITE_AUDIT_AI_MAX_SCREENSHOTS_PER_PAGE = _env_int("SITE_AUDIT_AI_MAX_SCREENSHOTS_PER_PAGE", 2, minimum=1, maximum=3)
SITE_AUDIT_AI_TIMEOUT_SECONDS = _env_int("SITE_AUDIT_AI_TIMEOUT_SECONDS", 120, minimum=15, maximum=600)
SITE_AUDIT_AI_PROMPT_VERSION = "redstone-site-audit-v1"
SITE_AUDIT_JOB_BATCH_LIMIT = _env_int("SITE_AUDIT_JOB_BATCH_LIMIT", 3, minimum=1, maximum=25)

SITE_AUDIT_RUBRIC = [
    {"key": "page_load_desktop_mobile", "label": "All pages load correctly on desktop and mobile"},
    {"key": "application_flow_visible", "label": "Application test: application path is visible and appears usable"},
    {"key": "floor_plan_availability", "label": "Floor plan availability is visible and appears current"},
    {"key": "pricing_accuracy", "label": "Pricing is visible, internally consistent, and not stale"},
    {"key": "homepage_cta", "label": "Homepage includes a clear call to action"},
    {"key": "homepage_value_add", "label": "Homepage includes a clear value-add"},
    {"key": "special_offers_current", "label": "Special offers are current when present"},
    {"key": "leasing_verbiage", "label": "Leasing verbiage is correct and confidence-building"},
    {"key": "contact_info_hours", "label": "Contact info and hours of operation are visible and correct-looking"},
]

SITE_AUDIT_AI_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "path": {"type": "string"},
        "score": {"type": "number"},
        "summary": {"type": "string"},
        "checklist": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "key": {"type": "string"},
                    "label": {"type": "string"},
                    "status": {"type": "string", "enum": ["pass", "warn", "fail", "not_verifiable"]},
                    "score": {"type": "number"},
                    "severity": {"type": "string", "enum": ["low", "medium", "high"]},
                    "evidence": {"type": "string"},
                    "recommendation": {"type": "string"},
                },
                "required": ["key", "label", "status", "score", "severity", "evidence", "recommendation"],
            },
        },
        "issues": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "rubric_key": {"type": "string"},
                    "severity": {"type": "string", "enum": ["low", "medium", "high"]},
                    "issue": {"type": "string"},
                    "evidence": {"type": "string"},
                    "recommendation": {"type": "string"},
                },
                "required": ["rubric_key", "severity", "issue", "evidence", "recommendation"],
            },
        },
        "recommendations": {"type": "array", "items": {"type": "string"}},
        "priority_actions": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["path", "score", "summary", "checklist", "issues", "recommendations", "priority_actions"],
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


def _json_object(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, dict) else {}
        except json.JSONDecodeError:
            return {}
    return {}


def _compact_dict(value: dict[str, Any]) -> dict[str, Any]:
    return {key: item for key, item in value.items() if item is not None and item != ""}


def _screenshot_capture_metrics(
    screenshot: dict[str, Any],
    *,
    device_type: str | None = None,
    fallback_width: int | None = None,
    fallback_height: int | None = None,
) -> dict[str, Any]:
    raw_data = _json_object(screenshot.get("raw_data") or screenshot.get("rawData"))
    supplied_metrics = _json_object(
        screenshot.get("captureMetrics")
        or screenshot.get("capture_metrics")
        or raw_data.get("captureMetrics")
        or raw_data.get("capture_metrics")
    )
    normalized_device_type = str(device_type or screenshot.get("device_type") or screenshot.get("deviceType") or "")
    viewport = SCREENSHOT_CAPTURE_VIEWPORTS.get(normalized_device_type, {})
    screenshot_width = _to_int(screenshot.get("width")) or fallback_width
    screenshot_height = _to_int(screenshot.get("height")) or fallback_height

    screenshot_mode = _normalize_text(
        supplied_metrics.get("screenshotMode")
        or supplied_metrics.get("screenshot_mode")
        or screenshot.get("screenshotMode")
        or screenshot.get("screenshot_mode")
        or raw_data.get("screenshotMode")
        or raw_data.get("screenshot_mode"),
        40,
    )
    if screenshot_mode not in {"full_page", "clipped"}:
        screenshot_mode = "full_page"

    clip = supplied_metrics.get("clip") if isinstance(supplied_metrics.get("clip"), dict) else None
    return _compact_dict(
        {
            "viewportWidth": _to_int(supplied_metrics.get("viewportWidth") or supplied_metrics.get("viewport_width"))
            or viewport.get("width"),
            "viewportHeight": _to_int(supplied_metrics.get("viewportHeight") or supplied_metrics.get("viewport_height"))
            or viewport.get("height"),
            "documentWidth": _to_int(supplied_metrics.get("documentWidth") or supplied_metrics.get("document_width"))
            or screenshot_width,
            "documentHeight": _to_int(supplied_metrics.get("documentHeight") or supplied_metrics.get("document_height"))
            or screenshot_height,
            "screenshotWidth": screenshot_width,
            "screenshotHeight": screenshot_height,
            "deviceScaleFactor": _to_float(supplied_metrics.get("deviceScaleFactor") or supplied_metrics.get("device_scale_factor"))
            or 1,
            "devicePixelRatio": _to_float(supplied_metrics.get("devicePixelRatio") or supplied_metrics.get("device_pixel_ratio")),
            "screenshotMode": screenshot_mode,
            "capturedUrl": _normalize_text(
                supplied_metrics.get("capturedUrl")
                or supplied_metrics.get("captured_url")
                or screenshot.get("capturedUrl")
                or screenshot.get("captured_url")
                or raw_data.get("capturedUrl")
                or raw_data.get("captured_url"),
                2048,
            ),
            "sourceUrl": _normalize_text(
                supplied_metrics.get("sourceUrl")
                or supplied_metrics.get("source_url")
                or screenshot.get("sourceUrl")
                or screenshot.get("source_url")
                or raw_data.get("sourceUrl")
                or raw_data.get("source_url"),
                2048,
            ),
            "clip": clip,
        }
    )


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


def _expand_allowed_domains(domains: list[Any]) -> list[str]:
    def preserve_www(value: Any) -> str:
        text = _normalize_text(value, 2048)
        if not text:
            return ""
        parsed = urlparse(text if "://" in text else f"https://{text}")
        return (parsed.hostname or "").lower()

    expanded: list[str] = []
    seen: set[str] = set()
    for item in domains:
        host = preserve_www(item)
        if not host:
            continue
        candidates = [host]
        if host.startswith("www."):
            candidates.append(host[4:])
        elif "." in host:
            candidates.append(f"www.{host}")
        for candidate in candidates:
            if candidate and candidate not in seen:
                seen.add(candidate)
                expanded.append(candidate)
    return expanded


def _shape_site(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row.get("id"),
        "propertyId": row.get("property_id"),
        "siteKey": row.get("site_key"),
        "name": row.get("name") or "",
        "allowedDomains": _expand_allowed_domains(row.get("allowed_domains") if isinstance(row.get("allowed_domains"), list) else []),
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
        "allowed_domains": _expand_allowed_domains(allowed_domains),
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

    capture_metrics = _screenshot_capture_metrics(
        screenshot,
        device_type=device_type,
        fallback_width=width,
        fallback_height=height,
    )
    if not capture_metrics.get("capturedUrl"):
        capture_metrics["capturedUrl"] = _normalize_text(
            payload.get("capturedUrl") or payload.get("captured_url") or payload.get("url"),
            2048,
        )
    if not capture_metrics.get("sourceUrl"):
        capture_metrics["sourceUrl"] = _normalize_text(payload.get("url") or capture_metrics.get("capturedUrl"), 2048)
    screenshot_raw_data = _json_object(screenshot.get("rawData") or screenshot.get("raw_data"))
    raw_data = {
        **screenshot_raw_data,
        "captureMetrics": capture_metrics,
        "screenshotMode": capture_metrics.get("screenshotMode"),
        "capturedUrl": capture_metrics.get("capturedUrl"),
    }

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
        "raw_data": raw_data,
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
                            device_scale_factor = 1
                            context = browser.new_context(
                                viewport=viewport,
                                device_scale_factor=device_scale_factor,
                                user_agent=(
                                    "Mozilla/5.0 (compatible; RedstoneSiteAuditBot/1.0; +https://redstoneresidential.com)"
                                ),
                            )
                            page = context.new_page()
                            try:
                                page.goto(page_url, wait_until="domcontentloaded", timeout=timeout_ms)
                                captured_url = page.url
                                try:
                                    page.wait_for_load_state("load", timeout=10_000)
                                except Exception:
                                    pass
                                page.wait_for_timeout(1500)
                                dimensions = page.evaluate(
                                    """() => ({
                                      documentWidth: Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0, window.innerWidth || 0),
                                      documentHeight: Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0, window.innerHeight || 0),
                                      viewportWidth: window.innerWidth || 0,
                                      viewportHeight: window.innerHeight || 0,
                                      devicePixelRatio: window.devicePixelRatio || 1
                                    })"""
                                )
                                document_width = int(dimensions.get("documentWidth") or viewport["width"])
                                document_height = int(dimensions.get("documentHeight") or viewport["height"])
                                viewport_width = int(dimensions.get("viewportWidth") or viewport["width"])
                                viewport_height = int(dimensions.get("viewportHeight") or viewport["height"])
                                device_pixel_ratio = float(dimensions.get("devicePixelRatio") or device_scale_factor)
                                width = min(document_width, SCREENSHOT_MAX_WIDTH)
                                height = min(document_height, SCREENSHOT_MAX_HEIGHT)
                                if width * height > SCREENSHOT_MAX_PIXELS:
                                    height = max(viewport["height"], SCREENSHOT_MAX_PIXELS // max(width, 1))
                                output_path = Path(tmpdir) / f"{page_row.get('id')}-{device_type}.jpg"
                                use_full_page = (
                                    document_width <= SCREENSHOT_MAX_WIDTH
                                    and document_height <= SCREENSHOT_MAX_HEIGHT
                                    and document_width * document_height <= SCREENSHOT_MAX_PIXELS
                                )
                                screenshot_mode = "full_page" if use_full_page else "clipped"
                                clip = None if use_full_page else {"x": 0, "y": 0, "width": width, "height": height}
                                screenshot_args = {
                                    "path": str(output_path),
                                    "type": "jpeg",
                                    "quality": 72,
                                }
                                if use_full_page:
                                    screenshot_args["full_page"] = True
                                else:
                                    screenshot_args["clip"] = clip
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
                                            "captureMetrics": {
                                                "viewportWidth": viewport_width,
                                                "viewportHeight": viewport_height,
                                                "documentWidth": document_width,
                                                "documentHeight": document_height,
                                                "deviceScaleFactor": device_scale_factor,
                                                "devicePixelRatio": device_pixel_ratio,
                                                "screenshotMode": screenshot_mode,
                                                "capturedUrl": captured_url,
                                                "sourceUrl": page_url,
                                                "clip": clip,
                                            },
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
                                        "screenshotMode": screenshot_mode,
                                        "capturedUrl": captured_url,
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


def _event_datetime(row: dict[str, Any]) -> datetime:
    parsed = _parse_datetime(row.get("occurred_at"))
    return parsed or datetime.now(timezone.utc)


def _event_target_identity(row: dict[str, Any]) -> str:
    raw_data = row.get("raw_data") if isinstance(row.get("raw_data"), dict) else {}
    for value in (
        raw_data.get("targetTrackId"),
        raw_data.get("targetCtaId"),
        raw_data.get("targetSelector"),
        raw_data.get("targetHref"),
        raw_data.get("targetLabel"),
        row.get("target_id"),
        row.get("target_role"),
        row.get("target_tag"),
    ):
        text = _normalize_text(value, 420).lower()
        if text:
            return text
    x_pct = row.get("x_pct")
    y_pct = row.get("y_pct")
    return f"area:{round(float(x_pct or 0) * HEATMAP_TAP_DEDUPE_GRID_SIZE)}:{round(float(y_pct or 0) * HEATMAP_TAP_DEDUPE_GRID_SIZE)}"


def _tap_dedupe_key(row: dict[str, Any]) -> str:
    x_pct = row.get("x_pct")
    y_pct = row.get("y_pct")
    return "|".join(
        [
            _normalize_text(row.get("session_key"), 160),
            _normalize_text(row.get("path"), 1024),
            _event_target_identity(row),
            str(round(float(x_pct or 0) * HEATMAP_TAP_DEDUPE_GRID_SIZE)),
            str(round(float(y_pct or 0) * HEATMAP_TAP_DEDUPE_GRID_SIZE)),
        ]
    )


def _merge_tap_duplicate(existing: dict[str, Any], candidate: dict[str, Any]) -> dict[str, Any]:
    existing_type = str(existing.get("event_type") or "")
    candidate_type = str(candidate.get("event_type") or "")
    keep_candidate = HEATMAP_CLICK_EVENT_PRIORITY.get(candidate_type, 0) > HEATMAP_CLICK_EVENT_PRIORITY.get(existing_type, 0)
    primary = dict(candidate if keep_candidate else existing)
    duplicate = existing if keep_candidate else candidate
    raw_data = dict(primary.get("raw_data") if isinstance(primary.get("raw_data"), dict) else {})
    duplicate_raw = duplicate.get("raw_data") if isinstance(duplicate.get("raw_data"), dict) else {}
    duplicate_types = raw_data.get("dedupedEventTypes") if isinstance(raw_data.get("dedupedEventTypes"), list) else []
    duplicate_types = list(duplicate_types)
    if isinstance(duplicate_raw.get("dedupedEventTypes"), list):
        duplicate_types.extend(duplicate_raw.get("dedupedEventTypes"))
    for event_type in (existing_type, candidate_type, str(duplicate.get("event_type") or "")):
        if event_type and event_type not in duplicate_types:
            duplicate_types.append(event_type)
    raw_data["dedupedEventTypes"] = duplicate_types
    primary_count = int(raw_data.get("dedupedTapCount") or 1)
    duplicate_count = int(duplicate_raw.get("dedupedTapCount") or 1)
    raw_data["dedupedTapCount"] = primary_count + duplicate_count
    raw_data["dedupedWithinMs"] = HEATMAP_TAP_DEDUPE_WINDOW_MS
    primary["raw_data"] = raw_data
    return primary


def _dedupe_click_like_event_rows(event_rows: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], int]:
    deduped_rows: list[dict[str, Any]] = []
    latest_by_key: dict[str, tuple[int, datetime]] = {}
    dropped = 0
    for row in event_rows:
        if str(row.get("event_type") or "") not in HEATMAP_CLICK_LIKE_EVENTS:
            deduped_rows.append(row)
            continue
        key = _tap_dedupe_key(row)
        occurred_at = _event_datetime(row)
        existing = latest_by_key.get(key)
        if existing:
            existing_index, existing_at = existing
            within_window = abs((occurred_at - existing_at).total_seconds() * 1000) <= HEATMAP_TAP_DEDUPE_WINDOW_MS
            if within_window:
                deduped_rows[existing_index] = _merge_tap_duplicate(deduped_rows[existing_index], row)
                latest_by_key[key] = (existing_index, max(existing_at, occurred_at))
                dropped += 1
                continue
        latest_by_key[key] = (len(deduped_rows), occurred_at)
        deduped_rows.append(row)
    return deduped_rows, dropped


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
    deduped_count = 0
    if event_rows:
        event_rows, deduped_count = _dedupe_click_like_event_rows(event_rows)
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
        "received": len(events_payload),
        "rejected": max(0, len(events_payload) - len(event_rows) - deduped_count),
        "deduped": deduped_count,
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

    site_id = None
    if site_key:
        site = _fetch_site_by_key(site_key)
        if site:
            site_id = site.get("id")
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
            "taps": 0,
            "ctaClicks": 0,
            "mouseMoves": 0,
            "cursorSamples": 0,
            "scrolls": 0,
            "engagements": 0,
            "diagnostics": 0,
            "maxScrollDepthPct": 0.0,
            "lastSeenAt": inventory.get("last_seen_at"),
        }

    aggregate_filters = [
        ("select", "*"),
        ("property_id", f"eq.{property_id}"),
        ("activity_date", f"gte.{start_date.isoformat()}"),
        ("activity_date", f"lte.{end_date.isoformat()}"),
        ("limit", "10000"),
    ]
    if site_id:
        aggregate_filters.append(("site_id", f"eq.{site_id}"))
    aggregate_rows = _fetch_json(
        "property_site_page_daily_summaries",
        aggregate_filters,
        headers=_supabase_anon_headers(access_token),
    )
    if aggregate_rows:
        device_breakdown: dict[str, dict[str, Any]] = {}
        for row in aggregate_rows:
            page_path = str(row.get("canonical_path") or "/")
            device_type = _normalize_text(row.get("device_type"), 40) or "unknown"
            device = device_breakdown.get(device_type) or {
                "deviceType": device_type,
                "sessions": 0,
                "events": 0,
                "clicks": 0,
                "taps": 0,
                "cursorSamples": 0,
                "scrolls": 0,
                "engagements": 0,
            }
            device["sessions"] += int(row.get("session_count") or 0)
            device["events"] += int(row.get("event_count") or 0)
            device["clicks"] += int(row.get("click_count") or 0)
            device["taps"] += int(row.get("tap_event_count") or 0)
            device["cursorSamples"] += int(row.get("cursor_sample_count") or 0)
            device["scrolls"] += int(row.get("scroll_event_count") or 0)
            device["engagements"] += int(row.get("engagement_event_count") or 0)
            device_breakdown[device_type] = device
            page = page_map.setdefault(
                page_path,
                {
                    "id": row.get("page_id"),
                    "path": page_path,
                    "url": None,
                    "title": None,
                    "metaDescription": None,
                    "latestSnapshotId": None,
                    "latestScreenshotId": None,
                    "events": 0,
                    "sessions": 0,
                    "clicks": 0,
                    "taps": 0,
                    "ctaClicks": 0,
                    "mouseMoves": 0,
                    "cursorSamples": 0,
                    "scrolls": 0,
                    "engagements": 0,
                    "diagnostics": 0,
                    "maxScrollDepthPct": 0.0,
                    "lastSeenAt": None,
                },
            )
            page["events"] += int(row.get("event_count") or 0)
            existing_sessions = page.get("sessions")
            page["sessions"] = (len(existing_sessions) if isinstance(existing_sessions, set) else int(existing_sessions or 0)) + int(row.get("session_count") or 0)
            page["clicks"] += int(row.get("click_count") or 0)
            page["taps"] += int(row.get("tap_event_count") or 0)
            page["ctaClicks"] += int(row.get("cta_click_count") or 0)
            page["mouseMoves"] += int(row.get("cursor_sample_count") or 0)
            page["cursorSamples"] += int(row.get("cursor_sample_count") or 0)
            page["scrolls"] += int(row.get("scroll_event_count") or 0)
            page["engagements"] += int(row.get("engagement_event_count") or 0)
            page["diagnostics"] += int(row.get("diagnostic_event_count") or 0)
            page["maxScrollDepthPct"] = max(float(page.get("maxScrollDepthPct") or 0), float(row.get("max_scroll_depth_pct") or 0))
            activity_date = row.get("activity_date")
            if activity_date and (not page.get("lastSeenAt") or str(activity_date) > str(page.get("lastSeenAt") or "")):
                page["lastSeenAt"] = activity_date
        click_target_filters = [
            ("select", "canonical_path,dead_click_count"),
            ("property_id", f"eq.{property_id}"),
            ("activity_date", f"gte.{start_date.isoformat()}"),
            ("activity_date", f"lte.{end_date.isoformat()}"),
            ("limit", "10000"),
        ]
        if site_id:
            click_target_filters.append(("site_id", f"eq.{site_id}"))
        click_target_rows = _fetch_optional_json(
            "property_site_click_daily_targets",
            click_target_filters,
            headers=_supabase_anon_headers(access_token),
        )
        friction_by_path: dict[str, dict[str, Any]] = {}
        for row in click_target_rows:
            page_path = str(row.get("canonical_path") or "/")
            current = friction_by_path.get(page_path) or {
                "path": page_path,
                "deadClicks": 0,
                "rageClicks": 0,
            }
            current["deadClicks"] += int(row.get("dead_click_count") or 0)
            friction_by_path[page_path] = current
        pages = [
            {
                **page,
                "sessions": len(page.get("sessions")) if isinstance(page.get("sessions"), set) else int(page.get("sessions") or 0),
                "deadClicks": int((friction_by_path.get(str(page.get("path") or "/")) or {}).get("deadClicks") or 0),
                "rageClicks": int((friction_by_path.get(str(page.get("path") or "/")) or {}).get("rageClicks") or 0),
            }
            for page in page_map.values()
        ]
        pages.sort(key=lambda item: item["events"], reverse=True)
        pages_by_path = {str(page.get("path") or "/"): page for page in pages}
        friction_pages = sorted(
            [
                {
                    **item,
                    "title": (pages_by_path.get(item["path"]) or {}).get("title"),
                    "events": int((pages_by_path.get(item["path"]) or {}).get("events") or 0),
                    "sessions": int((pages_by_path.get(item["path"]) or {}).get("sessions") or 0),
                }
                for item in friction_by_path.values()
                if int(item.get("deadClicks") or 0) > 0 or int(item.get("rageClicks") or 0) > 0
            ],
            key=lambda item: int(item.get("deadClicks") or 0) + int(item.get("rageClicks") or 0),
            reverse=True,
        )[:10]
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
            "dataSource": "daily_aggregates",
            "pages": pages,
            "deviceBreakdown": sorted(device_breakdown.values(), key=lambda item: int(item.get("events") or 0), reverse=True),
            "frictionPages": friction_pages,
            "staging_only": True,
        }

    filters = [
        ("select", "site_id,session_key,event_type,path,occurred_at,scroll_depth_pct,raw_data"),
        ("property_id", f"eq.{property_id}"),
        ("occurred_at", f"gte.{start_date.isoformat()}T00:00:00+00:00"),
        ("occurred_at", f"lte.{end_date.isoformat()}T23:59:59+00:00"),
        ("order", "occurred_at.desc"),
        ("limit", "10000"),
    ]
    if site_id:
        filters.append(("site_id", f"eq.{site_id}"))
    events = _fetch_json(
        "property_heatmap_events",
        filters,
        headers=_supabase_anon_headers(access_token),
    )
    device_breakdown: dict[str, dict[str, Any]] = {}
    for event in events:
        page_path = str(event.get("path") or "/")
        raw_data = event.get("raw_data") if isinstance(event.get("raw_data"), dict) else {}
        device_type = _normalize_text(raw_data.get("deviceType") or raw_data.get("device_type"), 40) or "unknown"
        device = device_breakdown.get(device_type) or {
            "deviceType": device_type,
            "sessions": set(),
            "events": 0,
            "clicks": 0,
            "taps": 0,
            "cursorSamples": 0,
            "scrolls": 0,
            "engagements": 0,
        }
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
                "taps": 0,
                "ctaClicks": 0,
                "mouseMoves": 0,
                "cursorSamples": 0,
                "scrolls": 0,
                "engagements": 0,
                "diagnostics": 0,
                "maxScrollDepthPct": 0.0,
                "lastSeenAt": event.get("occurred_at"),
            },
        )
        page["events"] += 1
        if event.get("session_key"):
            page["sessions"].add(str(event.get("session_key")))
            device["sessions"].add(str(event.get("session_key")))
        device["events"] += 1
        event_type = event.get("event_type")
        if event_type in {"click", "pointerdown", "touchstart"}:
            page["clicks"] += 1
            device["clicks"] += 1
            if event_type in {"pointerdown", "touchstart"}:
                page["taps"] += 1
                device["taps"] += 1
        elif event_type == "cta_click":
            page["ctaClicks"] += 1
        elif event_type in {"mousemove", "pointermove"}:
            page["mouseMoves"] += 1
            page["cursorSamples"] += 1
            device["cursorSamples"] += 1
        elif event_type == "scroll":
            page["scrolls"] += 1
            device["scrolls"] += 1
        elif event_type in {"engagement", "first_interaction", "page_duration"}:
            page["engagements"] += 1
            device["engagements"] += 1
        elif event_type == "tracker_diagnostic":
            page["diagnostics"] += 1
        if event.get("scroll_depth_pct") is not None:
            page["maxScrollDepthPct"] = max(page["maxScrollDepthPct"], float(event.get("scroll_depth_pct") or 0))
        if not page.get("lastSeenAt") or str(event.get("occurred_at") or "") > str(page.get("lastSeenAt") or ""):
            page["lastSeenAt"] = event.get("occurred_at")
        device_breakdown[device_type] = device

    pages = []
    for page in page_map.values():
        pages.append(
            {
                **{key: value for key, value in page.items() if key != "sessions"},
                "sessions": len(page["sessions"]),
            }
        )

    pages.sort(key=lambda item: item["events"], reverse=True)
    device_items = [
        {
            **{key: value for key, value in item.items() if key != "sessions"},
            "sessions": len(item["sessions"]),
        }
        for item in device_breakdown.values()
    ]
    device_items.sort(key=lambda item: item["events"], reverse=True)
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
        "deviceBreakdown": device_items,
        "frictionPages": [],
        "staging_only": True,
    }


HEATMAP_AGGREGATE_GRID_SIZE = 24
HEATMAP_RAGE_CLICK_WINDOW_SECONDS = 5
HEATMAP_CTA_FRUSTRATION_WINDOW_SECONDS = 12
HEATMAP_ANOMALY_GRID_SIZE = 32


def _numeric(value: Any, default: float = 0.0) -> float:
    parsed = _to_float(value)
    return parsed if parsed is not None else default


def _fetch_optional_json(
    table_name: str,
    query_params: list[tuple[str, str]],
    *,
    headers: dict[str, str] | None = None,
) -> list[dict[str, Any]]:
    try:
        return _fetch_json(table_name, query_params, headers=headers)
    except HTTPError as exc:
        if exc.code == 404:
            return []
        raise


def _aggregate_layer_for_event_type(event_type: str) -> str:
    if event_type in {"click", "cta_click", "pointerdown", "touchstart"}:
        return "click"
    if event_type in {"mousemove", "pointermove"}:
        return "cursor"
    if event_type == "scroll":
        return "scroll"
    if event_type in {"engagement", "first_interaction", "page_duration"}:
        return "engagement"
    return event_type


def _merge_top_targets(page_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    target_counts: dict[str, dict[str, Any]] = {}
    for row in page_rows:
        targets = row.get("top_targets") if isinstance(row.get("top_targets"), list) else []
        for target in targets:
            if not isinstance(target, dict):
                continue
            label = _normalize_text(target.get("label") or target.get("targetLabel"), 160)
            if not label or label == "unknown":
                continue
            key = label.lower()
            current = target_counts.get(key) or {"label": label, "clicks": 0}
            current["clicks"] += int(target.get("clicks") or target.get("count") or 0)
            target_counts[key] = current
    return sorted(target_counts.values(), key=lambda item: item.get("clicks", 0), reverse=True)[:20]


def _normalized_target_lookup_key(value: Any) -> str:
    return _normalize_text(value, 420).lower()


def _target_bounds_from_values(left: Any, top: Any, width: Any, height: Any) -> dict[str, float] | None:
    left_pct = _to_float(left)
    top_pct = _to_float(top)
    width_pct = _to_float(width)
    height_pct = _to_float(height)
    if left_pct is None or top_pct is None:
        return None
    return {
        "leftPct": _clamp_percent(left_pct),
        "topPct": _clamp_percent(top_pct),
        "widthPct": _clamp_percent(width_pct if width_pct is not None else 0),
        "heightPct": _clamp_percent(height_pct if height_pct is not None else 0),
    }


def _merge_click_target_rows(target_rows: list[dict[str, Any]], anomalies: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    target_map: dict[str, dict[str, Any]] = {}
    for row in target_rows:
        target_key = _normalize_text(row.get("target_key") or row.get("targetKey"), 420)
        label = _normalize_text(row.get("target_label") or row.get("label") or target_key, 180)
        if not target_key or not label or label == "unknown":
            continue
        lookup_key = _normalized_target_lookup_key(target_key)
        current = target_map.get(lookup_key) or {
            "targetKey": target_key,
            "label": label,
            "selector": _normalize_text(row.get("target_selector") or row.get("selector"), 420),
            "category": _normalize_text(row.get("target_category") or row.get("category"), 80) or "unknown",
            "href": _normalize_text(row.get("target_href") or row.get("href"), 1024),
            "trackId": _normalize_text(row.get("target_track_id") or row.get("trackId"), 160),
            "clicks": 0,
            "taps": 0,
            "ctaClicks": 0,
            "deadClicks": 0,
            "rageClicks": 0,
            "sessions": 0,
            "xWeighted": 0.0,
            "yWeighted": 0.0,
            "boundsWeighted": {"leftPct": 0.0, "topPct": 0.0, "widthPct": 0.0, "heightPct": 0.0},
            "boundsWeight": 0,
        }
        clicks = int(row.get("click_count") or row.get("clicks") or 0)
        taps = int(row.get("tap_count") or row.get("taps") or 0)
        cta_clicks = int(row.get("cta_click_count") or row.get("ctaClicks") or 0)
        dead_clicks = int(row.get("dead_click_count") or row.get("deadClicks") or 0)
        sessions = int(row.get("session_count") or row.get("sessions") or 0)
        weight = max(1, clicks + cta_clicks)
        current["clicks"] += clicks
        current["taps"] += taps
        current["ctaClicks"] += cta_clicks
        current["deadClicks"] += dead_clicks
        current["sessions"] += sessions
        current["xWeighted"] += _numeric(row.get("avg_x_pct"), 0) * weight
        current["yWeighted"] += _numeric(row.get("avg_y_pct"), 0) * weight
        current["eventWeight"] = int(current.get("eventWeight") or 0) + weight
        bounds = _target_bounds_from_values(row.get("avg_left_pct"), row.get("avg_top_pct"), row.get("avg_width_pct"), row.get("avg_height_pct"))
        if bounds:
            current["boundsWeight"] += weight
            for key, value in bounds.items():
                current["boundsWeighted"][key] += value * weight
        target_map[lookup_key] = current

    target_aliases: dict[str, dict[str, Any]] = {}
    for key, item in target_map.items():
        target_aliases[key] = item
        for alias in (item.get("label"), item.get("selector"), item.get("href"), item.get("trackId")):
            alias_key = _normalized_target_lookup_key(alias)
            if alias_key:
                target_aliases.setdefault(alias_key, item)

    anomalies = anomalies or {}
    for cluster in (anomalies.get("rageClicks") or {}).get("clusters") or []:
        key = _normalized_target_lookup_key(cluster.get("targetKey") or cluster.get("label"))
        matched_target = target_aliases.get(key)
        if matched_target is not None:
            matched_target["rageClicks"] += int(cluster.get("count") or 0)
    for target in (anomalies.get("deadClicks") or {}).get("targets") or []:
        key = _normalized_target_lookup_key(target.get("targetKey") or target.get("label"))
        matched_target = target_aliases.get(key)
        if matched_target is not None:
            matched_target["deadClicks"] = max(int(matched_target.get("deadClicks") or 0), int(target.get("count") or 0))

    merged = []
    for item in target_map.values():
        event_weight = max(1, int(item.get("eventWeight") or 0))
        bounds = None
        if int(item.get("boundsWeight") or 0) > 0:
            bounds_weight = int(item.get("boundsWeight") or 0)
            bounds = {
                key: _clamp_percent(value / bounds_weight)
                for key, value in item["boundsWeighted"].items()
            }
        merged.append({
            "targetKey": item.get("targetKey"),
            "label": item.get("label"),
            "selector": item.get("selector"),
            "category": item.get("category"),
            "href": item.get("href"),
            "trackId": item.get("trackId"),
            "clicks": int(item.get("clicks") or 0),
            "taps": int(item.get("taps") or 0),
            "ctaClicks": int(item.get("ctaClicks") or 0),
            "deadClicks": int(item.get("deadClicks") or 0),
            "rageClicks": int(item.get("rageClicks") or 0),
            "sessions": int(item.get("sessions") or 0),
            "xPct": _clamp_percent(float(item.get("xWeighted") or 0) / event_weight),
            "yPct": _clamp_percent(float(item.get("yWeighted") or 0) / event_weight),
            "bounds": bounds,
        })
    return sorted(merged, key=lambda item: (item.get("clicks", 0) + item.get("ctaClicks", 0), item.get("sessions", 0)), reverse=True)[:50]


def _merge_cursor_daily_rows(cursor_rows: list[dict[str, Any]]) -> dict[str, Any]:
    cells = []
    attention: dict[str, dict[str, Any]] = {}
    movement_samples = 0
    dwell_points = 0
    total_dwell_ms = 0
    total_sessions = 0

    for row in cursor_rows:
        samples = int(row.get("cursor_sample_count") or row.get("cursorSamples") or 0)
        dwell_count = int(row.get("dwell_event_count") or row.get("dwellPoints") or 0)
        sessions = int(row.get("session_count") or row.get("sessions") or 0)
        dwell_ms = int(float(row.get("total_dwell_ms") or row.get("totalDwellMs") or 0))
        avg_dwell_ms = _numeric(row.get("avg_dwell_ms") or row.get("avgDwellMs"), 0)
        grid_x = int(row.get("grid_x") if row.get("grid_x") is not None else row.get("gridX") or 0)
        grid_y = int(row.get("grid_y") if row.get("grid_y") is not None else row.get("gridY") or 0)
        raw_x_pct = row.get("avg_x_pct") if row.get("avg_x_pct") is not None else row.get("xPct")
        raw_y_pct = row.get("avg_y_pct") if row.get("avg_y_pct") is not None else row.get("yPct")
        x_pct = _clamp_percent(_numeric(raw_x_pct, (grid_x + 0.5) / HEATMAP_AGGREGATE_GRID_SIZE))
        y_pct = _clamp_percent(_numeric(raw_y_pct, (grid_y + 0.5) / HEATMAP_AGGREGATE_GRID_SIZE))
        label = _normalize_text(
            row.get("target_label") or row.get("section_label") or row.get("targetLabel") or row.get("sectionLabel"),
            180,
        )
        section_label = _normalize_text(row.get("section_label") or row.get("sectionLabel"), 180)
        selector = _normalize_text(row.get("target_selector") or row.get("selector"), 420)
        category = _normalize_text(row.get("target_category") or row.get("category"), 80) or "content"
        score = samples + dwell_count + (dwell_ms / 1000)
        if samples or dwell_count:
            cells.append({
                "key": f"cursor:{grid_x}:{grid_y}",
                "type": "cursor_attention",
                "eventType": "cursor_attention",
                "layer": "cursor",
                "gridX": grid_x,
                "gridY": grid_y,
                "gridSize": HEATMAP_AGGREGATE_GRID_SIZE,
                "count": samples + dwell_count,
                "eventCount": samples + dwell_count,
                "cursorSamples": samples,
                "dwellPoints": dwell_count,
                "sessionCount": sessions,
                "sessions": sessions,
                "xPct": x_pct,
                "yPct": y_pct,
                "totalDwellMs": dwell_ms,
                "avgDwellMs": avg_dwell_ms,
                "label": label or section_label or f"Cursor cell {grid_x + 1},{grid_y + 1}",
                "sectionLabel": section_label,
                "selector": selector,
                "category": category,
                "attentionScore": score,
            })
        movement_samples += samples
        dwell_points += dwell_count
        total_dwell_ms += dwell_ms
        total_sessions += sessions
        attention_key = (section_label or selector or label or f"cell:{grid_x}:{grid_y}").lower()
        current = attention.get(attention_key) or {
            "label": section_label or label or selector or f"Cell {grid_x + 1},{grid_y + 1}",
            "sectionLabel": section_label,
            "selector": selector,
            "category": category,
            "cursorSamples": 0,
            "dwellPoints": 0,
            "totalDwellMs": 0,
            "sessions": 0,
            "xWeighted": 0.0,
            "yWeighted": 0.0,
            "weight": 0.0,
        }
        weight = max(1.0, score)
        current["cursorSamples"] += samples
        current["dwellPoints"] += dwell_count
        current["totalDwellMs"] += dwell_ms
        current["sessions"] = max(int(current.get("sessions") or 0), sessions)
        current["xWeighted"] += (x_pct or 0) * weight
        current["yWeighted"] += (y_pct or 0) * weight
        current["weight"] += weight
        attention[attention_key] = current

    max_score = max([1.0, *[float(cell.get("attentionScore") or 0) for cell in cells]])
    normalized_cells = [
        {**cell, "intensity": float(cell.get("attentionScore") or 0) / max_score}
        for cell in cells
    ]
    top_attention = []
    for item in attention.values():
        weight = max(1.0, float(item.get("weight") or 0))
        dwell_points_for_avg = max(1, int(item.get("dwellPoints") or 0))
        top_attention.append({
            "label": item.get("label"),
            "sectionLabel": item.get("sectionLabel"),
            "selector": item.get("selector"),
            "category": item.get("category"),
            "cursorSamples": int(item.get("cursorSamples") or 0),
            "dwellPoints": int(item.get("dwellPoints") or 0),
            "totalDwellMs": int(item.get("totalDwellMs") or 0),
            "avgDwellMs": int(item.get("totalDwellMs") or 0) / dwell_points_for_avg,
            "sessions": int(item.get("sessions") or 0),
            "xPct": _clamp_percent(float(item.get("xWeighted") or 0) / weight),
            "yPct": _clamp_percent(float(item.get("yWeighted") or 0) / weight),
        })
    top_attention = sorted(
        top_attention,
        key=lambda item: (item.get("totalDwellMs", 0), item.get("dwellPoints", 0), item.get("cursorSamples", 0)),
        reverse=True,
    )[:20]
    return {
        "cells": normalized_cells,
        "topAttentionAreas": top_attention,
        "movementSamples": movement_samples,
        "dwellPoints": dwell_points,
        "totalDwellMs": total_dwell_ms,
        "avgDwellMs": (total_dwell_ms / dwell_points) if dwell_points else 0,
        "sessionSignals": total_sessions,
    }


def _merge_scroll_daily_rows(scroll_rows: list[dict[str, Any]]) -> dict[str, Any]:
    total_sessions = sum(int(row.get("session_count") or 0) for row in scroll_rows)
    scroll_sessions = sum(int(row.get("scroll_session_count") or 0) for row in scroll_rows)
    reach_counts: dict[str, int] = {}
    band_counts: dict[str, dict[str, Any]] = {}
    duration_totals: dict[str, int] = {}
    abandonment_counts: dict[str, dict[str, Any]] = {}
    first_scroll_count = 0
    first_scroll_weighted_ms = 0.0
    abandonment_weighted = 0.0
    abandonment_weight = 0
    section_totals: dict[str, dict[str, Any]] = {}

    for row in scroll_rows:
        row_sessions = int(row.get("session_count") or 0)
        reach = row.get("scroll_reach") if isinstance(row.get("scroll_reach"), dict) else {}
        for threshold, payload in reach.items():
            if not isinstance(payload, dict):
                continue
            reach_counts[str(threshold)] = reach_counts.get(str(threshold), 0) + int(payload.get("sessions") or 0)

        bands = row.get("scroll_bands") if isinstance(row.get("scroll_bands"), list) else []
        for band in bands:
            if not isinstance(band, dict):
                continue
            start_pct = int(_numeric(band.get("startPct"), 0))
            end_pct = int(_numeric(band.get("endPct"), 0))
            key = f"{start_pct}-{end_pct}"
            current = band_counts.get(key) or {"startPct": start_pct, "endPct": end_pct, "sessionsReached": 0}
            current["sessionsReached"] += int(band.get("sessionsReached") or band.get("sessions") or 0)
            band_counts[key] = current

        durations = row.get("scroll_band_durations_ms") if isinstance(row.get("scroll_band_durations_ms"), dict) else {}
        for band, duration_ms in durations.items():
            duration_totals[str(band)] = duration_totals.get(str(band), 0) + int(_numeric(duration_ms, 0))

        abandonment = row.get("abandonment_depth_distribution") if isinstance(row.get("abandonment_depth_distribution"), list) else []
        for band in abandonment:
            if not isinstance(band, dict):
                continue
            start_pct = int(_numeric(band.get("startPct"), 0))
            end_pct = int(_numeric(band.get("endPct"), 0))
            key = f"{start_pct}-{end_pct}"
            current = abandonment_counts.get(key) or {"startPct": start_pct, "endPct": end_pct, "sessions": 0}
            current["sessions"] += int(band.get("sessions") or 0)
            abandonment_counts[key] = current

        avg_abandonment = _to_float(row.get("avg_abandonment_depth_pct"))
        if avg_abandonment is not None and row_sessions > 0:
            abandonment_weighted += avg_abandonment * row_sessions
            abandonment_weight += row_sessions

        row_first_scroll_count = int(row.get("first_meaningful_scroll_count") or 0)
        row_first_scroll_avg = _to_float(row.get("avg_first_meaningful_scroll_ms"))
        first_scroll_count += row_first_scroll_count
        if row_first_scroll_avg is not None and row_first_scroll_count > 0:
            first_scroll_weighted_ms += row_first_scroll_avg * row_first_scroll_count

        sections = row.get("top_visible_sections") if isinstance(row.get("top_visible_sections"), list) else []
        for section in sections:
            if not isinstance(section, dict):
                continue
            label = _normalize_text(section.get("label"), 160)
            if not label:
                continue
            current = section_totals.get(label) or {"label": label, "visibleMs": 0, "maxVisiblePct": 0.0, "topPct": section.get("topPct")}
            current["visibleMs"] += int(_numeric(section.get("visibleMs"), 0))
            current["maxVisiblePct"] = max(_numeric(current.get("maxVisiblePct"), 0), _numeric(section.get("maxVisiblePct"), 0))
            if current.get("topPct") is None:
                current["topPct"] = section.get("topPct")
            section_totals[label] = current

    reach_summary = {
        threshold: {
            "thresholdPct": int(_numeric(threshold, 0)),
            "sessions": sessions,
            "percent": (sessions / total_sessions) if total_sessions else 0.0,
        }
        for threshold, sessions in sorted(reach_counts.items(), key=lambda item: _numeric(item[0], 0))
    }
    bands_summary = [
        {
            **band,
            "percentReached": (int(band.get("sessionsReached") or 0) / total_sessions) if total_sessions else 0.0,
        }
        for band in sorted(band_counts.values(), key=lambda item: int(item.get("endPct") or 0))
    ]
    abandonment_summary = [
        {
            **band,
            "percent": (int(band.get("sessions") or 0) / total_sessions) if total_sessions else 0.0,
        }
        for band in sorted(abandonment_counts.values(), key=lambda item: int(item.get("startPct") or 0))
    ]

    return {
        "sessionCount": total_sessions,
        "scrollSessionCount": scroll_sessions,
        "reach": reach_summary,
        "bands": bands_summary,
        "bandDurationsMs": duration_totals,
        "abandonmentDepthDistribution": abandonment_summary,
        "avgAbandonmentDepthPct": (abandonment_weighted / abandonment_weight) if abandonment_weight else 0.0,
        "firstMeaningfulScrollCount": first_scroll_count,
        "avgFirstMeaningfulScrollMs": (first_scroll_weighted_ms / first_scroll_count) if first_scroll_count else 0.0,
        "topSections": sorted(section_totals.values(), key=lambda item: item.get("visibleMs", 0), reverse=True)[:12],
    }


def _target_identity_from_event(event: dict[str, Any]) -> str:
    raw_data = event.get("raw_data") if isinstance(event.get("raw_data"), dict) else {}
    for value in (
        raw_data.get("targetTrackId"),
        raw_data.get("targetCtaId"),
        raw_data.get("targetSelector"),
        raw_data.get("targetHref"),
        raw_data.get("targetLabel"),
        event.get("target_id"),
        event.get("target_role"),
        event.get("target_tag"),
    ):
        text = _normalize_text(value, 420).lower()
        if text:
            return text
    grid_x = round(float(event.get("x_pct") or 0) * HEATMAP_ANOMALY_GRID_SIZE)
    grid_y = round(float(event.get("y_pct") or 0) * HEATMAP_ANOMALY_GRID_SIZE)
    return f"area:{grid_x}:{grid_y}"


def _target_label_from_event(event: dict[str, Any]) -> str:
    raw_data = event.get("raw_data") if isinstance(event.get("raw_data"), dict) else {}
    return _normalize_text(
        raw_data.get("targetLabel")
        or raw_data.get("targetTrackId")
        or raw_data.get("targetSelector")
        or raw_data.get("targetHref")
        or event.get("target_tag")
        or "Unknown element",
        180,
    )


def _is_dead_click_candidate(event: dict[str, Any]) -> bool:
    raw_data = event.get("raw_data") if isinstance(event.get("raw_data"), dict) else {}
    if raw_data.get("targetHref") or raw_data.get("targetTrackId") or raw_data.get("targetCtaId") or raw_data.get("isCta"):
        return False
    category = _normalize_text(raw_data.get("targetCategory"), 80).lower()
    if category in {"cta", "phone", "form", "floorplan", "gallery", "map", "nav", "link"}:
        return False
    selector = _normalize_text(raw_data.get("targetSelector"), 420).lower()
    role = _normalize_text(event.get("target_role") or raw_data.get("targetRole"), 80).lower()
    tag = _normalize_text(event.get("target_tag") or raw_data.get("targetTag"), 40).upper()
    label = _normalize_text(raw_data.get("targetLabel"), 120)
    clickable_hint = (
        tag in {"A", "BUTTON"}
        or role in {"button", "link", "menuitem"}
        or "button" in selector
        or "[role=\"button\"]" in selector
        or ".btn" in selector
        or ".button" in selector
        or bool(label)
    )
    return clickable_hint


def _has_page_transition(events: list[dict[str, Any]], session_key: str, start_at: datetime, current_path: str) -> bool:
    end_at = start_at + timedelta(seconds=HEATMAP_CTA_FRUSTRATION_WINDOW_SECONDS)
    for event in events:
        if str(event.get("session_key") or "") != session_key:
            continue
        if str(event.get("event_type") or "") != "pageview":
            continue
        occurred_at = _parse_datetime(event.get("occurred_at"))
        if not occurred_at or occurred_at < start_at or occurred_at > end_at:
            continue
        if str(event.get("path") or "/") != current_path:
            return True
    return False


def _detect_heatmap_click_anomalies(events: list[dict[str, Any]]) -> dict[str, Any]:
    click_events = [
        event for event in events
        if str(event.get("event_type") or "") in {"click", "cta_click", "pointerdown", "touchstart"}
    ]
    sorted_clicks = sorted(click_events, key=lambda event: str(event.get("occurred_at") or ""))
    rage_clusters: list[dict[str, Any]] = []
    cta_frustrations: list[dict[str, Any]] = []

    dead_counts: dict[str, dict[str, Any]] = {}
    for event in sorted_clicks:
        if not _is_dead_click_candidate(event):
            continue
        key = _target_identity_from_event(event)
        current = dead_counts.get(key) or {
            "targetKey": key,
            "label": _target_label_from_event(event),
            "count": 0,
            "path": event.get("path") or "/",
            "lastSeenAt": event.get("occurred_at"),
        }
        current["count"] += 1
        current["lastSeenAt"] = event.get("occurred_at") or current.get("lastSeenAt")
        dead_counts[key] = current

    grouped: dict[str, list[dict[str, Any]]] = {}
    for event in sorted_clicks:
        session_key = str(event.get("session_key") or "")
        if not session_key:
            continue
        x_grid = round(float(event.get("x_pct") or 0) * HEATMAP_ANOMALY_GRID_SIZE)
        y_grid = round(float(event.get("y_pct") or 0) * HEATMAP_ANOMALY_GRID_SIZE)
        key = "|".join([session_key, str(event.get("path") or "/"), _target_identity_from_event(event), str(x_grid), str(y_grid)])
        grouped.setdefault(key, []).append(event)

    for grouped_events in grouped.values():
        if len(grouped_events) < 3:
            continue
        parsed_events = [(event, _parse_datetime(event.get("occurred_at"))) for event in grouped_events]
        parsed_events = [(event, occurred_at) for event, occurred_at in parsed_events if occurred_at]
        for index in range(0, len(parsed_events)):
            window = [
                item for item in parsed_events[index:]
                if (item[1] - parsed_events[index][1]).total_seconds() <= HEATMAP_RAGE_CLICK_WINDOW_SECONDS
            ]
            if len(window) >= 3:
                first_event = window[0][0]
                rage_clusters.append(
                    {
                        "sessionKey": first_event.get("session_key"),
                        "path": first_event.get("path") or "/",
                        "targetKey": _target_identity_from_event(first_event),
                        "label": _target_label_from_event(first_event),
                        "count": len(window),
                        "windowSeconds": HEATMAP_RAGE_CLICK_WINDOW_SECONDS,
                        "startedAt": first_event.get("occurred_at"),
                    }
                )
                break

    cta_grouped: dict[str, list[dict[str, Any]]] = {}
    for event in sorted_clicks:
        if str(event.get("event_type") or "") != "cta_click":
            continue
        session_key = str(event.get("session_key") or "")
        if not session_key:
            continue
        key = "|".join([session_key, str(event.get("path") or "/"), _target_identity_from_event(event)])
        cta_grouped.setdefault(key, []).append(event)

    for grouped_events in cta_grouped.values():
        if len(grouped_events) < 2:
            continue
        parsed_events = [(event, _parse_datetime(event.get("occurred_at"))) for event in grouped_events]
        parsed_events = [(event, occurred_at) for event, occurred_at in parsed_events if occurred_at]
        for index in range(0, len(parsed_events)):
            first_event, started_at = parsed_events[index]
            window = [
                item for item in parsed_events[index:]
                if (item[1] - started_at).total_seconds() <= HEATMAP_CTA_FRUSTRATION_WINDOW_SECONDS
            ]
            if len(window) >= 2 and not _has_page_transition(events, str(first_event.get("session_key") or ""), started_at, str(first_event.get("path") or "/")):
                cta_frustrations.append(
                    {
                        "sessionKey": first_event.get("session_key"),
                        "path": first_event.get("path") or "/",
                        "targetKey": _target_identity_from_event(first_event),
                        "label": _target_label_from_event(first_event),
                        "count": len(window),
                        "windowSeconds": HEATMAP_CTA_FRUSTRATION_WINDOW_SECONDS,
                        "startedAt": first_event.get("occurred_at"),
                    }
                )
                break

    return {
        "rageClicks": {
            "count": len(rage_clusters),
            "clusters": sorted(rage_clusters, key=lambda item: item.get("count", 0), reverse=True)[:20],
            "definition": f"At least 3 repeated click/tap events in the same session, element/page area, and {HEATMAP_RAGE_CLICK_WINDOW_SECONDS}s window.",
        },
        "deadClicks": {
            "count": sum(int(item.get("count") or 0) for item in dead_counts.values()),
            "targets": sorted(dead_counts.values(), key=lambda item: item.get("count", 0), reverse=True)[:20],
            "definition": "Click/tap events on clickable-looking elements without href, CTA, or tracked action signals.",
        },
        "ctaFrustration": {
            "count": len(cta_frustrations),
            "clusters": sorted(cta_frustrations, key=lambda item: item.get("count", 0), reverse=True)[:20],
            "definition": f"Repeated CTA clicks in the same session/target within {HEATMAP_CTA_FRUSTRATION_WINDOW_SECONDS}s without a page transition.",
        },
    }


def _fetch_heatmap_anomaly_events(
    property_id: str,
    *,
    start_date: date,
    end_date: date,
    site_id: str | None = None,
    path: str | None = None,
    normalized_device_type: str = "",
    access_token: str | None = None,
) -> list[dict[str, Any]]:
    filters = [
        ("select", "event_type,occurred_at,path,raw_data,session_key,x_pct,y_pct,target_tag,target_id,target_role"),
        ("property_id", f"eq.{property_id}"),
        ("occurred_at", f"gte.{start_date.isoformat()}T00:00:00+00:00"),
        ("occurred_at", f"lte.{end_date.isoformat()}T23:59:59+00:00"),
        ("event_type", "in.(click,cta_click,pointerdown,touchstart,pageview)"),
        ("order", "occurred_at.asc"),
        ("limit", "5000"),
    ]
    if site_id:
        filters.append(("site_id", f"eq.{site_id}"))
    events = _fetch_json("property_heatmap_events", filters, headers=_supabase_anon_headers(access_token))
    if path:
        canonical_path = _normalize_text(path, 1024)
        events = [
            event for event in events
            if str(event.get("event_type") or "") == "pageview"
            or str(event.get("path") or "/") == canonical_path
        ]
    if normalized_device_type in {"desktop", "mobile", "tablet"}:
        events = [
            event for event in events
            if str(event.get("event_type") or "") == "pageview"
            or (event.get("raw_data") if isinstance(event.get("raw_data"), dict) else {}).get("deviceType") == normalized_device_type
        ]
    return events


def _heatmap_summary_from_aggregates(
    property_id: str,
    *,
    start_date: date,
    end_date: date,
    site_id: str | None = None,
    site_key: str | None = None,
    path: str | None = None,
    event_type: str | None = None,
    normalized_device_type: str = "",
    access_token: str | None = None,
    anomalies: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    cell_filters = [
        ("select", "*"),
        ("property_id", f"eq.{property_id}"),
        ("activity_date", f"gte.{start_date.isoformat()}"),
        ("activity_date", f"lte.{end_date.isoformat()}"),
        ("limit", "10000"),
    ]
    page_filters = [
        ("select", "*"),
        ("property_id", f"eq.{property_id}"),
        ("activity_date", f"gte.{start_date.isoformat()}"),
        ("activity_date", f"lte.{end_date.isoformat()}"),
        ("limit", "10000"),
    ]
    scroll_filters = [
        ("select", "*"),
        ("property_id", f"eq.{property_id}"),
        ("activity_date", f"gte.{start_date.isoformat()}"),
        ("activity_date", f"lte.{end_date.isoformat()}"),
        ("limit", "10000"),
    ]
    click_target_filters = [
        ("select", "*"),
        ("property_id", f"eq.{property_id}"),
        ("activity_date", f"gte.{start_date.isoformat()}"),
        ("activity_date", f"lte.{end_date.isoformat()}"),
        ("limit", "10000"),
    ]
    cursor_filters = [
        ("select", "*"),
        ("property_id", f"eq.{property_id}"),
        ("activity_date", f"gte.{start_date.isoformat()}"),
        ("activity_date", f"lte.{end_date.isoformat()}"),
        ("limit", "10000"),
    ]
    if site_id:
        cell_filters.append(("site_id", f"eq.{site_id}"))
        page_filters.append(("site_id", f"eq.{site_id}"))
        scroll_filters.append(("site_id", f"eq.{site_id}"))
        click_target_filters.append(("site_id", f"eq.{site_id}"))
        cursor_filters.append(("site_id", f"eq.{site_id}"))
    if path:
        canonical_path = _normalize_text(path, 1024)
        cell_filters.append(("canonical_path", f"eq.{canonical_path}"))
        page_filters.append(("canonical_path", f"eq.{canonical_path}"))
        scroll_filters.append(("canonical_path", f"eq.{canonical_path}"))
        click_target_filters.append(("canonical_path", f"eq.{canonical_path}"))
        cursor_filters.append(("canonical_path", f"eq.{canonical_path}"))
    if normalized_device_type in {"desktop", "mobile", "tablet"}:
        cell_filters.append(("device_type", f"eq.{normalized_device_type}"))
        page_filters.append(("device_type", f"eq.{normalized_device_type}"))
        scroll_filters.append(("device_type", f"eq.{normalized_device_type}"))
        click_target_filters.append(("device_type", f"eq.{normalized_device_type}"))
        cursor_filters.append(("device_type", f"eq.{normalized_device_type}"))
    if event_type and event_type in HEATMAP_EVENT_TYPES:
        cell_filters.append(("event_type", f"eq.{event_type}"))

    headers = _supabase_anon_headers(access_token)
    include_cursor_aggregate = not event_type or event_type in {"mousemove", "pointermove", "engagement"}
    cell_rows = _fetch_json("property_heatmap_daily_cells", cell_filters, headers=headers)
    page_rows = _fetch_json("property_site_page_daily_summaries", page_filters, headers=headers)
    scroll_rows = _fetch_optional_json("property_site_scroll_daily_summaries", scroll_filters, headers=headers)
    click_target_rows = _fetch_optional_json("property_site_click_daily_targets", click_target_filters, headers=headers)
    cursor_rows = _fetch_optional_json("property_site_cursor_daily_cells", cursor_filters, headers=headers) if include_cursor_aggregate else []
    if not cell_rows and not page_rows and not scroll_rows and not click_target_rows and not cursor_rows:
        return None
    scroll_metrics = _merge_scroll_daily_rows(scroll_rows)
    click_targets = _merge_click_target_rows(click_target_rows, anomalies=anomalies)
    cursor_metrics = _merge_cursor_daily_rows(cursor_rows)

    counts_by_type: dict[str, int] = {}
    counts_by_path: dict[str, int] = {}
    cell_groups: dict[str, dict[str, Any]] = {}
    scroll_band_distribution: dict[str, int] = {}
    max_scroll_depth = 0.0
    for row in cell_rows:
        row_event_type = str(row.get("event_type") or "")
        row_path = str(row.get("canonical_path") or "/")
        count = int(row.get("event_count") or 0)
        counts_by_type[row_event_type] = counts_by_type.get(row_event_type, 0) + count
        counts_by_path[row_path] = counts_by_path.get(row_path, 0) + count
        layer = _aggregate_layer_for_event_type(row_event_type)
        grid_x = int(row.get("grid_x") or 0)
        grid_y = int(row.get("grid_y") or 0)
        if row_event_type == "scroll":
            band_key = f"{round((grid_y / HEATMAP_AGGREGATE_GRID_SIZE) * 100)}-{round(((grid_y + 1) / HEATMAP_AGGREGATE_GRID_SIZE) * 100)}"
            scroll_band_distribution[band_key] = scroll_band_distribution.get(band_key, 0) + count
            max_scroll_depth = max(max_scroll_depth, _numeric(row.get("max_scroll_depth_pct"), (grid_y + 1) / HEATMAP_AGGREGATE_GRID_SIZE))
            continue
        if layer not in {"click", "cursor", "engagement"}:
            continue
        key = f"{layer}:{grid_x}:{grid_y}"
        current = cell_groups.get(key) or {
            "key": key,
            "type": row_event_type,
            "eventType": row_event_type,
            "layer": layer,
            "gridX": grid_x,
            "gridY": grid_y,
            "gridSize": HEATMAP_AGGREGATE_GRID_SIZE,
            "count": 0,
            "eventCount": 0,
            "sessionCount": 0,
            "xWeighted": 0.0,
            "yWeighted": 0.0,
        }
        x_pct = _numeric(row.get("avg_x_pct"), (grid_x + 0.5) / HEATMAP_AGGREGATE_GRID_SIZE)
        y_pct = _numeric(row.get("avg_y_pct"), (grid_y + 0.5) / HEATMAP_AGGREGATE_GRID_SIZE)
        current["count"] += count
        current["eventCount"] += count
        current["sessionCount"] += int(row.get("session_count") or 0)
        current["xWeighted"] += x_pct * count
        current["yWeighted"] += y_pct * count
        cell_groups[key] = current

    if cursor_metrics.get("cells"):
        for cursor_cell in cursor_metrics["cells"]:
            key = str(cursor_cell.get("key") or f"cursor:{cursor_cell.get('gridX', 0)}:{cursor_cell.get('gridY', 0)}")
            cell_groups[key] = {
                "key": key,
                "type": cursor_cell.get("eventType") or "cursor_attention",
                "eventType": cursor_cell.get("eventType") or "cursor_attention",
                "layer": "cursor",
                "gridX": cursor_cell.get("gridX"),
                "gridY": cursor_cell.get("gridY"),
                "gridSize": cursor_cell.get("gridSize") or HEATMAP_AGGREGATE_GRID_SIZE,
                "count": cursor_cell.get("count"),
                "eventCount": cursor_cell.get("eventCount"),
                "sessionCount": cursor_cell.get("sessionCount"),
                "xWeighted": _numeric(cursor_cell.get("xPct"), 0) * max(1, int(cursor_cell.get("count") or 0)),
                "yWeighted": _numeric(cursor_cell.get("yPct"), 0) * max(1, int(cursor_cell.get("count") or 0)),
                "cursorSamples": cursor_cell.get("cursorSamples"),
                "dwellPoints": cursor_cell.get("dwellPoints"),
                "totalDwellMs": cursor_cell.get("totalDwellMs"),
                "avgDwellMs": cursor_cell.get("avgDwellMs"),
                "label": cursor_cell.get("label"),
                "sectionLabel": cursor_cell.get("sectionLabel"),
                "selector": cursor_cell.get("selector"),
                "category": cursor_cell.get("category"),
                "intensity": cursor_cell.get("intensity"),
            }

    cells = []
    max_cell_count = max([1, *[int(item.get("count") or 0) for item in cell_groups.values()]])
    for cell in cell_groups.values():
        count = max(1, int(cell.get("count") or 0))
        cells.append(
            {
                "key": cell.get("key"),
                "type": cell.get("eventType"),
                "eventType": cell.get("eventType"),
                "layer": cell.get("layer"),
                "gridX": cell.get("gridX"),
                "gridY": cell.get("gridY"),
                "gridSize": cell.get("gridSize"),
                "count": cell.get("count"),
                "eventCount": cell.get("eventCount"),
                "sessionCount": cell.get("sessionCount"),
                "xPct": _clamp_percent(float(cell.get("xWeighted") or 0) / count),
                "yPct": _clamp_percent(float(cell.get("yWeighted") or 0) / count),
                "intensity": _numeric(cell.get("intensity"), float(cell.get("count") or 0) / max_cell_count),
                "cursorSamples": cell.get("cursorSamples"),
                "dwellPoints": cell.get("dwellPoints"),
                "totalDwellMs": cell.get("totalDwellMs"),
                "avgDwellMs": cell.get("avgDwellMs"),
                "label": cell.get("label"),
                "sectionLabel": cell.get("sectionLabel"),
                "selector": cell.get("selector"),
                "category": cell.get("category"),
            }
        )

    total_events = sum(int(row.get("event_count") or 0) for row in page_rows) if page_rows else sum(counts_by_type.values())
    total_sessions = sum(int(row.get("session_count") or 0) for row in page_rows) or int(scroll_metrics.get("sessionCount") or 0)
    total_scroll_events = sum(int(row.get("scroll_event_count") or 0) for row in page_rows)
    scroll_weighted_total = sum(_numeric(row.get("avg_scroll_depth_pct")) * int(row.get("scroll_event_count") or 0) for row in page_rows)
    page_duration_values = [_numeric(row.get("avg_page_duration_ms")) for row in page_rows if row.get("avg_page_duration_ms") is not None]
    page_max_scroll_values = [_numeric(row.get("max_scroll_depth_pct")) for row in page_rows]
    max_scroll_depth = max([max_scroll_depth, *(page_max_scroll_values or [0.0])])
    top_paths_map: dict[str, int] = {}
    for row in page_rows:
        row_path = str(row.get("canonical_path") or "/")
        top_paths_map[row_path] = top_paths_map.get(row_path, 0) + int(row.get("event_count") or 0)

    return {
        "status": "ok",
        "property_id": str(property_id),
        "range": {"start_date": start_date.isoformat(), "end_date": end_date.isoformat()},
        "filters": {
            "siteKey": site_key or "",
            "path": path or "",
            "eventType": event_type or "",
            "deviceType": normalized_device_type if normalized_device_type in {"desktop", "mobile", "tablet"} else "",
        },
        "dataSource": "daily_aggregates",
        "aggregate": {
            "gridSize": HEATMAP_AGGREGATE_GRID_SIZE,
            "cellCount": len(cells),
            "pageSummaryRows": len(page_rows),
            "scrollSummaryRows": len(scroll_rows),
            "clickTargetRows": len(click_target_rows),
            "cursorCellRows": len(cursor_rows),
        },
        "totals": {
            "sessions": total_sessions,
            "events": total_events,
            "clicks": sum(int(row.get("click_count") or 0) for row in page_rows) or counts_by_type.get("click", 0),
            "taps": sum(int(row.get("tap_event_count") or 0) for row in page_rows)
            or counts_by_type.get("pointerdown", 0)
            + counts_by_type.get("touchstart", 0),
            "ctaClicks": sum(int(row.get("cta_click_count") or 0) for row in page_rows) or counts_by_type.get("cta_click", 0),
            "pointerDowns": counts_by_type.get("pointerdown", 0),
            "touchStarts": counts_by_type.get("touchstart", 0),
            "mouseMoves": counts_by_type.get("mousemove", 0),
            "pointerMoves": counts_by_type.get("pointermove", 0),
            "cursorSamples": sum(int(row.get("cursor_sample_count") or 0) for row in page_rows)
            or counts_by_type.get("mousemove", 0)
            + counts_by_type.get("pointermove", 0),
            "cursorDwellPoints": cursor_metrics.get("dwellPoints", 0),
            "cursorAvgDwellMs": cursor_metrics.get("avgDwellMs", 0),
            "engagements": sum(int(row.get("engagement_event_count") or 0) for row in page_rows)
            or counts_by_type.get("engagement", 0)
            + counts_by_type.get("first_interaction", 0)
            + counts_by_type.get("page_duration", 0),
            "scrolls": total_scroll_events or counts_by_type.get("scroll", 0),
            "scrollSessions": scroll_metrics.get("scrollSessionCount", 0),
            "viewportEvents": counts_by_type.get("viewport", 0),
            "firstInteractions": counts_by_type.get("first_interaction", 0),
            "trackerDiagnostics": sum(int(row.get("diagnostic_event_count") or 0) for row in page_rows)
            or counts_by_type.get("tracker_diagnostic", 0),
            "pageDurationEvents": counts_by_type.get("page_duration", 0),
            "avgPageDurationMs": (sum(page_duration_values) / len(page_duration_values)) if page_duration_values else 0,
            "avgScrollDepthPct": (scroll_weighted_total / total_scroll_events) if total_scroll_events else 0.0,
            "maxScrollDepthPct": max_scroll_depth,
            "avgAbandonmentDepthPct": scroll_metrics.get("avgAbandonmentDepthPct", 0.0),
            "firstMeaningfulScrolls": scroll_metrics.get("firstMeaningfulScrollCount", 0),
            "avgFirstMeaningfulScrollMs": scroll_metrics.get("avgFirstMeaningfulScrollMs", 0.0),
        },
        "scroll": {
            "milestones": scroll_metrics.get("reach", {}),
            "reach": scroll_metrics.get("reach", {}),
            "bands": scroll_metrics.get("bands", []),
            "bandDistribution": scroll_band_distribution,
            "bandDurationsMs": scroll_metrics.get("bandDurationsMs", {}),
            "abandonmentDepthDistribution": scroll_metrics.get("abandonmentDepthDistribution", []),
            "topSections": scroll_metrics.get("topSections", []),
        },
        "cursor": {
            "movementSamples": cursor_metrics.get("movementSamples", 0),
            "dwellPoints": cursor_metrics.get("dwellPoints", 0),
            "totalDwellMs": cursor_metrics.get("totalDwellMs", 0),
            "avgDwellMs": cursor_metrics.get("avgDwellMs", 0),
            "topAttentionAreas": cursor_metrics.get("topAttentionAreas", []),
        },
        "countsByType": counts_by_type,
        "topPaths": [
            {"path": item_path, "events": count}
            for item_path, count in sorted((top_paths_map or counts_by_path).items(), key=lambda item: item[1], reverse=True)[:20]
        ],
        "topTargets": click_targets or _merge_top_targets(page_rows),
        "cells": sorted(cells, key=lambda item: item.get("count", 0), reverse=True)[:2500],
        "points": [],
        "sessions": [],
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

    site_id = None
    if site_key:
        site = _fetch_site_by_key(site_key)
        if site:
            site_id = site.get("id")
    normalized_device_type = _normalize_text(device_type, 40).lower()
    anomaly_events = _fetch_heatmap_anomaly_events(
        property_id,
        start_date=start_date,
        end_date=end_date,
        site_id=site_id,
        path=path,
        normalized_device_type=normalized_device_type,
        access_token=access_token,
    )
    anomalies = _detect_heatmap_click_anomalies(anomaly_events)
    aggregate_summary = _heatmap_summary_from_aggregates(
        property_id,
        start_date=start_date,
        end_date=end_date,
        site_id=site_id,
        site_key=site_key,
        path=path,
        event_type=event_type,
        normalized_device_type=normalized_device_type,
        access_token=access_token,
        anomalies=anomalies,
    )
    if aggregate_summary:
        aggregate_summary["anomalies"] = anomalies
        return aggregate_summary

    filters = [
        ("select", "*"),
        ("property_id", f"eq.{property_id}"),
        ("occurred_at", f"gte.{start_date.isoformat()}T00:00:00+00:00"),
        ("occurred_at", f"lte.{end_date.isoformat()}T23:59:59+00:00"),
        ("order", "occurred_at.desc"),
        ("limit", "5000"),
    ]
    if site_id:
        filters.append(("site_id", f"eq.{site_id}"))
    if path:
        filters.append(("path", f"eq.{_normalize_text(path, 1024)}"))
    if event_type and event_type in HEATMAP_EVENT_TYPES:
        filters.append(("event_type", f"eq.{event_type}"))

    events = _fetch_json(
        "property_heatmap_events",
        filters,
        headers=_supabase_anon_headers(access_token),
    )
    if normalized_device_type in {"desktop", "mobile", "tablet"}:
        events = [
            event for event in events
            if (event.get("raw_data") if isinstance(event.get("raw_data"), dict) else {}).get("deviceType") == normalized_device_type
        ]

    counts_by_type: dict[str, int] = {}
    counts_by_path: dict[str, int] = {}
    target_counts: dict[str, dict[str, Any]] = {}
    session_keys: set[str] = set()
    max_scroll_depth = 0.0
    scroll_depth_total = 0.0
    scroll_depth_count = 0
    scroll_milestones: dict[str, int] = {"25": 0, "50": 0, "75": 0, "90": 0, "100": 0}
    scroll_band_duration_totals: dict[str, int] = {}
    section_exposure_totals: dict[str, dict[str, Any]] = {}
    cursor_attention: dict[str, dict[str, Any]] = {}
    first_meaningful_scroll_count = 0
    first_meaningful_scroll_total = 0
    abandonment_depth_total = 0.0
    abandonment_depth_count = 0
    page_duration_total = 0
    page_duration_count = 0
    session_scroll_depths: dict[str, float] = {}
    session_abandonment_depths: dict[str, float] = {}
    points = []
    for event in events:
        event_kind = str(event.get("event_type") or "")
        event_path = str(event.get("path") or "/")
        raw_data = event.get("raw_data") if isinstance(event.get("raw_data"), dict) else {}
        if event.get("session_key"):
            session_keys.add(str(event.get("session_key")))
        counts_by_type[event_kind] = counts_by_type.get(event_kind, 0) + 1
        counts_by_path[event_path] = counts_by_path.get(event_path, 0) + 1
        if event_kind in {"click", "cta_click", "pointerdown", "touchstart"}:
            target_label = _normalize_text(
                raw_data.get("targetLabel")
                or raw_data.get("targetTrackId")
                or raw_data.get("targetSelector")
                or event.get("target_id")
                or event.get("target_classes")
                or event.get("target_tag"),
                160,
            )
            target_key = _normalize_text(raw_data.get("targetTrackId") or raw_data.get("targetSelector") or target_label, 240)
            if target_label and target_key:
                current = target_counts.get(target_key) or {
                    "targetKey": target_key,
                    "label": target_label,
                    "clicks": 0,
                    "taps": 0,
                    "ctaClicks": 0,
                    "deadClicks": 0,
                    "rageClicks": 0,
                    "sessions": set(),
                    "category": _normalize_text(raw_data.get("targetCategory"), 80),
                    "selector": _normalize_text(raw_data.get("targetSelector"), 420),
                    "trackId": _normalize_text(raw_data.get("targetTrackId"), 120),
                    "href": _normalize_text(raw_data.get("targetHref"), 1024),
                    "xTotal": 0.0,
                    "yTotal": 0.0,
                    "pointCount": 0,
                    "bounds": raw_data.get("targetBounds") if isinstance(raw_data.get("targetBounds"), dict) else None,
                }
                if event_kind in {"click", "pointerdown", "touchstart"}:
                    current["clicks"] += 1
                if event_kind in {"pointerdown", "touchstart"}:
                    current["taps"] += 1
                if event_kind == "cta_click":
                    current["ctaClicks"] += 1
                if _is_dead_click_candidate(event):
                    current["deadClicks"] += 1
                if event.get("session_key"):
                    current["sessions"].add(str(event.get("session_key")))
                if event.get("x_pct") is not None and event.get("y_pct") is not None:
                    current["xTotal"] += float(event.get("x_pct") or 0)
                    current["yTotal"] += float(event.get("y_pct") or 0)
                    current["pointCount"] += 1
                if not current.get("bounds") and isinstance(raw_data.get("targetBounds"), dict):
                    current["bounds"] = raw_data.get("targetBounds")
                target_counts[target_key] = current
        if event.get("scroll_depth_pct") is not None:
            scroll_depth = float(event.get("scroll_depth_pct") or 0)
            max_scroll_depth = max(max_scroll_depth, scroll_depth)
            scroll_depth_total += scroll_depth
            scroll_depth_count += 1
            if event.get("session_key"):
                session_key = str(event.get("session_key"))
                session_scroll_depths[session_key] = max(session_scroll_depths.get(session_key, 0.0), scroll_depth)
        milestone = raw_data.get("scrollMilestone")
        if milestone is not None:
            milestone_key = str(round(float(milestone) * 100))
            if milestone_key in scroll_milestones:
                scroll_milestones[milestone_key] += 1
        if raw_data.get("firstMeaningfulScroll"):
            first_meaningful_scroll_count += 1
            first_meaningful_scroll_total += int(raw_data.get("firstMeaningfulScrollMs") or 0)
        if raw_data.get("abandonmentDepthPct") is not None:
            abandonment_depth = float(raw_data.get("abandonmentDepthPct") or 0)
            abandonment_depth_total += abandonment_depth
            abandonment_depth_count += 1
            if event.get("session_key"):
                session_abandonment_depths[str(event.get("session_key"))] = abandonment_depth
        if event_kind == "page_duration" and event.get("engagement_ms") is not None:
            page_duration_total += int(event.get("engagement_ms") or 0)
            page_duration_count += 1
        band_durations = raw_data.get("scrollBandDurations") if isinstance(raw_data.get("scrollBandDurations"), dict) else {}
        if raw_data.get("finalScrollEvent"):
            for band, duration_ms in band_durations.items():
                scroll_band_duration_totals[str(band)] = scroll_band_duration_totals.get(str(band), 0) + int(duration_ms or 0)
        section_exposure = raw_data.get("sectionExposure") if raw_data.get("finalScrollEvent") and isinstance(raw_data.get("sectionExposure"), list) else []
        for section in section_exposure:
            if not isinstance(section, dict):
                continue
            label = _normalize_text(section.get("label"), 120)
            if not label:
                continue
            current = section_exposure_totals.get(label) or {"label": label, "visibleMs": 0, "maxVisiblePct": 0.0, "topPct": section.get("topPct")}
            current["visibleMs"] += int(section.get("visibleMs") or 0)
            current["maxVisiblePct"] = max(float(current.get("maxVisiblePct") or 0), float(section.get("maxVisiblePct") or 0))
            if current.get("topPct") is None:
                current["topPct"] = section.get("topPct")
            section_exposure_totals[label] = current
        if event_kind in {"mousemove", "pointermove", "engagement"} and event.get("x_pct") is not None and event.get("y_pct") is not None:
            grid_x = min(23, max(0, int(float(event.get("x_pct") or 0) * HEATMAP_AGGREGATE_GRID_SIZE)))
            grid_y = min(23, max(0, int(float(event.get("y_pct") or 0) * HEATMAP_AGGREGATE_GRID_SIZE)))
            section_label = _normalize_text(raw_data.get("sectionLabel"), 120)
            target_label = _normalize_text(
                raw_data.get("targetLabel") or section_label or raw_data.get("targetTrackId") or raw_data.get("targetSelector") or event.get("target_tag"),
                160,
            )
            cursor_key = (section_label or target_label or f"cell:{grid_x}:{grid_y}").lower()
            cursor_current = cursor_attention.get(cursor_key) or {
                "label": section_label or target_label or f"Cell {grid_x + 1},{grid_y + 1}",
                "sectionLabel": section_label,
                "selector": _normalize_text(raw_data.get("targetSelector"), 420),
                "category": _normalize_text(raw_data.get("targetCategory"), 80) or "content",
                "cursorSamples": 0,
                "dwellPoints": 0,
                "totalDwellMs": 0,
                "sessions": set(),
                "xTotal": 0.0,
                "yTotal": 0.0,
                "pointCount": 0,
            }
            if event_kind in {"mousemove", "pointermove"}:
                cursor_current["cursorSamples"] += 1
            if event_kind == "engagement":
                cursor_current["dwellPoints"] += 1
                cursor_current["totalDwellMs"] += int(event.get("engagement_ms") or 0)
            if event.get("session_key"):
                cursor_current["sessions"].add(str(event.get("session_key")))
            cursor_current["xTotal"] += float(event.get("x_pct") or 0)
            cursor_current["yTotal"] += float(event.get("y_pct") or 0)
            cursor_current["pointCount"] += 1
            cursor_attention[cursor_key] = cursor_current
        if event.get("x_pct") is not None or event.get("y_pct") is not None:
            points.append(
                {
                    "type": event_kind,
                    "path": event_path,
                    "sessionKey": event.get("session_key"),
                    "xPct": event.get("x_pct"),
                    "yPct": event.get("y_pct"),
                    "viewportWidth": event.get("viewport_width"),
                    "viewportHeight": event.get("viewport_height"),
                    "documentWidth": event.get("document_width"),
                    "documentHeight": event.get("document_height"),
                    "pageX": event.get("page_x"),
                    "pageY": event.get("page_y"),
                    "clientX": event.get("x"),
                    "clientY": event.get("y"),
                    "scrollDepthPct": event.get("scroll_depth_pct"),
                    "targetTag": event.get("target_tag"),
                    "targetId": event.get("target_id"),
                    "targetLabel": raw_data.get("targetLabel") or "",
                    "targetHref": raw_data.get("targetHref") or "",
                    "targetSelector": raw_data.get("targetSelector") or "",
                    "targetTrackId": raw_data.get("targetTrackId") or "",
                    "targetCtaId": raw_data.get("targetCtaId") or "",
                    "targetCategory": raw_data.get("targetCategory") or "",
                    "sectionLabel": raw_data.get("sectionLabel") or "",
                    "engagementMs": event.get("engagement_ms"),
                    "targetBounds": raw_data.get("targetBounds") if isinstance(raw_data.get("targetBounds"), dict) else None,
                    "deviceType": raw_data.get("deviceType") or "",
                    "occurredAt": event.get("occurred_at"),
                }
            )

    reach_denominator = len(session_keys)
    scroll_reach = {}
    scroll_bands = []
    for threshold in range(10, 101, 10):
        sessions_reached = sum(1 for depth in session_scroll_depths.values() if depth >= threshold / 100)
        percent_reached = (sessions_reached / reach_denominator) if reach_denominator else 0.0
        scroll_reach[str(threshold)] = {
            "thresholdPct": threshold,
            "sessions": sessions_reached,
            "percent": percent_reached,
        }
        scroll_bands.append({
            "startPct": threshold - 10,
            "endPct": threshold,
            "sessionsReached": sessions_reached,
            "percentReached": percent_reached,
        })
    abandonment_depth_distribution = []
    for start_pct in range(0, 100, 10):
        end_pct = start_pct + 10
        sessions_in_band = 0
        for session_key in session_keys:
            depth = session_abandonment_depths.get(session_key, session_scroll_depths.get(session_key, 0.0))
            if depth >= start_pct / 100 and (start_pct == 90 or depth < end_pct / 100):
                sessions_in_band += 1
        abandonment_depth_distribution.append({
            "startPct": start_pct,
            "endPct": end_pct,
            "sessions": sessions_in_band,
            "percent": (sessions_in_band / reach_denominator) if reach_denominator else 0.0,
        })

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
        "dataSource": "raw_sample",
        "aggregate": {
            "gridSize": HEATMAP_AGGREGATE_GRID_SIZE,
            "cellCount": 0,
            "pageSummaryRows": 0,
        },
        "totals": {
            "sessions": len(session_keys),
            "events": len(events),
            "clicks": counts_by_type.get("click", 0) + counts_by_type.get("pointerdown", 0) + counts_by_type.get("touchstart", 0),
            "taps": counts_by_type.get("pointerdown", 0) + counts_by_type.get("touchstart", 0),
            "ctaClicks": counts_by_type.get("cta_click", 0),
            "pointerDowns": counts_by_type.get("pointerdown", 0),
            "touchStarts": counts_by_type.get("touchstart", 0),
            "mouseMoves": counts_by_type.get("mousemove", 0),
            "pointerMoves": counts_by_type.get("pointermove", 0),
            "cursorSamples": counts_by_type.get("mousemove", 0) + counts_by_type.get("pointermove", 0),
            "engagements": counts_by_type.get("engagement", 0)
            + counts_by_type.get("first_interaction", 0)
            + counts_by_type.get("page_duration", 0),
            "scrolls": counts_by_type.get("scroll", 0),
            "scrollSessions": len(session_scroll_depths),
            "viewportEvents": counts_by_type.get("viewport", 0),
            "firstInteractions": counts_by_type.get("first_interaction", 0),
            "trackerDiagnostics": counts_by_type.get("tracker_diagnostic", 0),
            "pageDurationEvents": counts_by_type.get("page_duration", 0),
            "avgPageDurationMs": (page_duration_total / page_duration_count) if page_duration_count else 0,
            "avgScrollDepthPct": (scroll_depth_total / scroll_depth_count) if scroll_depth_count else 0.0,
            "maxScrollDepthPct": max_scroll_depth,
            "avgAbandonmentDepthPct": (abandonment_depth_total / abandonment_depth_count) if abandonment_depth_count else 0.0,
            "firstMeaningfulScrolls": first_meaningful_scroll_count,
            "avgFirstMeaningfulScrollMs": (first_meaningful_scroll_total / first_meaningful_scroll_count) if first_meaningful_scroll_count else 0,
        },
        "scroll": {
            "milestones": scroll_milestones,
            "reach": scroll_reach,
            "bands": scroll_bands,
            "bandDurationsMs": scroll_band_duration_totals,
            "abandonmentDepthDistribution": abandonment_depth_distribution,
            "topSections": sorted(section_exposure_totals.values(), key=lambda item: item.get("visibleMs", 0), reverse=True)[:12],
        },
        "cursor": {
            "movementSamples": counts_by_type.get("mousemove", 0) + counts_by_type.get("pointermove", 0),
            "dwellPoints": counts_by_type.get("engagement", 0),
            "totalDwellMs": sum(int(item.get("totalDwellMs") or 0) for item in cursor_attention.values()),
            "avgDwellMs": (
                sum(int(item.get("totalDwellMs") or 0) for item in cursor_attention.values())
                / max(1, sum(int(item.get("dwellPoints") or 0) for item in cursor_attention.values()))
            ) if cursor_attention else 0,
            "topAttentionAreas": [
                {
                    **{key: value for key, value in item.items() if key not in {"sessions", "xTotal", "yTotal", "pointCount"}},
                    "sessions": len(item.get("sessions") or []),
                    "avgDwellMs": (item.get("totalDwellMs", 0) / max(1, item.get("dwellPoints", 0))),
                    "xPct": (item.get("xTotal", 0) / item.get("pointCount", 1)) if item.get("pointCount") else None,
                    "yPct": (item.get("yTotal", 0) / item.get("pointCount", 1)) if item.get("pointCount") else None,
                }
                for item in sorted(
                    cursor_attention.values(),
                    key=lambda value: (value.get("totalDwellMs", 0), value.get("dwellPoints", 0), value.get("cursorSamples", 0)),
                    reverse=True,
                )[:20]
            ],
        },
        "countsByType": counts_by_type,
        "topPaths": [
            {"path": item_path, "events": count}
            for item_path, count in sorted(counts_by_path.items(), key=lambda item: item[1], reverse=True)[:20]
        ],
        "topTargets": [
            {
                **{key: value for key, value in target.items() if key not in {"sessions", "xTotal", "yTotal", "pointCount"}},
                "sessions": len(target.get("sessions") or []),
                "xPct": (target.get("xTotal", 0) / target.get("pointCount", 1)) if target.get("pointCount") else None,
                "yPct": (target.get("yTotal", 0) / target.get("pointCount", 1)) if target.get("pointCount") else None,
            }
            for target in sorted(target_counts.values(), key=lambda item: item.get("clicks", 0) + item.get("ctaClicks", 0), reverse=True)[:20]
        ],
        "anomalies": anomalies,
        "cells": [],
        "points": points[:2500],
        "sessions": sorted(session_keys)[:100],
        "staging_only": True,
    }


def get_heatmap_tracker_health_summary(
    property_id: str,
    *,
    start_date_value: str | None = None,
    end_date_value: str | None = None,
    site_key: str | None = None,
    path: str | None = None,
    device_type: str | None = None,
    access_token: str | None = None,
) -> dict[str, Any]:
    end_date = _parse_iso_date(end_date_value) or datetime.now(timezone.utc).date()
    start_date = _parse_iso_date(start_date_value) or (end_date - timedelta(days=HEATMAP_DEFAULT_DAYS - 1))
    if start_date > end_date:
        start_date, end_date = end_date, start_date

    site_rows: list[dict[str, Any]]
    if site_key:
        site = _fetch_site_by_key(site_key)
        site_rows = [site] if site and str(site.get("property_id")) == str(property_id) else []
    else:
        site_rows = _fetch_json(
            "property_heatmap_sites",
            [
                ("select", "*"),
                ("property_id", f"eq.{property_id}"),
                ("order", "created_at.asc"),
                ("limit", "1"),
            ],
            headers=_supabase_anon_headers(access_token),
        )
    site = site_rows[0] if site_rows else None
    shaped_site = _shape_site(site) if site else None
    site_id = str(site.get("id")) if site else ""

    filters = [
        ("select", "event_type,occurred_at,path,raw_data,session_key,x_pct,y_pct"),
        ("property_id", f"eq.{property_id}"),
        ("occurred_at", f"gte.{start_date.isoformat()}T00:00:00+00:00"),
        ("occurred_at", f"lte.{end_date.isoformat()}T23:59:59+00:00"),
        ("order", "occurred_at.desc"),
        ("limit", "1000"),
    ]
    if site_id:
        filters.append(("site_id", f"eq.{site_id}"))
    if path:
        filters.append(("path", f"eq.{_normalize_text(path, 1024)}"))

    events = _fetch_json("property_heatmap_events", filters, headers=_supabase_anon_headers(access_token))
    normalized_device_type = _normalize_text(device_type, 40).lower()
    if normalized_device_type in {"desktop", "mobile", "tablet"}:
        events = [
            event for event in events
            if (event.get("raw_data") if isinstance(event.get("raw_data"), dict) else {}).get("deviceType") == normalized_device_type
        ]

    counts_by_type: dict[str, int] = {}
    latest_event_at = None
    latest_collect_status = ""
    latest_diagnostic_at = None
    latest_diagnostic_data: dict[str, Any] = {}
    coordinate_events = 0
    deduped_tap_count = 0
    session_keys: set[str] = set()
    for event in events:
        event_type = str(event.get("event_type") or "")
        counts_by_type[event_type] = counts_by_type.get(event_type, 0) + 1
        if event.get("session_key"):
            session_keys.add(str(event.get("session_key")))
        if event.get("x_pct") is not None or event.get("y_pct") is not None:
            coordinate_events += 1
        occurred_at = event.get("occurred_at")
        latest_event_at = latest_event_at or occurred_at
        raw_data = event.get("raw_data") if isinstance(event.get("raw_data"), dict) else {}
        deduped_tap_count += max(0, int(raw_data.get("dedupedTapCount") or 1) - 1)
        if event_type == "tracker_diagnostic":
            latest_diagnostic_at = latest_diagnostic_at or occurred_at
            latest_collect_status = latest_collect_status or _normalize_text(raw_data.get("lastCollectStatus") or raw_data.get("stage"), 80)
            if not latest_diagnostic_data:
                latest_diagnostic_data = raw_data

    allowed_domains = shaped_site.get("allowedDomains") if shaped_site else []
    missing_domain_variants: list[str] = []
    for host in allowed_domains:
        if host.startswith("www."):
            counterpart = host[4:]
        else:
            counterpart = f"www.{host}" if "." in host else ""
        if counterpart and counterpart not in allowed_domains:
            missing_domain_variants.append(counterpart)

    sampling_rate = float(shaped_site.get("samplingRate") or 0) if shaped_site else 0
    recommendations = []
    if not shaped_site:
        recommendations.append("No heatmap site configuration was found for this property.")
    elif not shaped_site.get("trackingEnabled"):
        recommendations.append("Tracking is disabled for this site.")
    if shaped_site and not allowed_domains:
        recommendations.append("Add at least one allowed domain before testing live tracking.")
    if missing_domain_variants:
        recommendations.append(f"Add matching www/non-www allowed domain variants: {', '.join(missing_domain_variants[:4])}.")
    if shaped_site and sampling_rate < 1:
        recommendations.append("For QA, temporarily set sampling to 1.0 so test sessions are not sampled out.")
    if shaped_site and shaped_site.get("respectDnt"):
        recommendations.append("For QA, turn browser DNT off or temporarily disable Respect DNT.")
    if not latest_event_at:
        recommendations.append("No tracker event has been observed in the selected range yet.")

    script_detected = bool(latest_event_at)
    sample_accepted = bool(
        latest_diagnostic_data.get("sampleAccepted") is True
        or (latest_event_at and (not sampling_rate or sampling_rate > 0))
    )
    consent_dnt_allowed = bool(
        latest_diagnostic_data.get("consentAllowed") is True
        or latest_event_at
        or (shaped_site and not shaped_site.get("respectDnt") and shaped_site.get("consentMode") != "required")
    )
    collect_accepted_statuses = {"ok", "beacon_queued", "loaded", "hidden_flush", "pagehide_flush"}
    last_collect_accepted = bool(latest_collect_status in collect_accepted_statuses or len(events) > 0)
    domain_accepted = bool(latest_event_at)
    events_stored = len(events) > 0
    top_missing_reason = ""
    if not shaped_site:
        top_missing_reason = "No heatmap site configuration found."
    elif not shaped_site.get("trackingEnabled"):
        top_missing_reason = "Tracking is disabled for this site."
    elif not allowed_domains:
        top_missing_reason = "No allowed domain is configured."
    elif missing_domain_variants:
        top_missing_reason = f"Missing matching allowed domain variant: {missing_domain_variants[0]}."
    elif not consent_dnt_allowed:
        top_missing_reason = "Consent or Do Not Track may be blocking the tracker."
    elif not sample_accepted:
        top_missing_reason = "Sampling may be excluding this test session."
    elif not script_detected:
        top_missing_reason = "The tracker script has not produced an event for this page/range."
    elif not last_collect_accepted:
        top_missing_reason = "The last collect attempt was not accepted."
    elif not events_stored:
        top_missing_reason = "No heatmap events have been stored yet."
    else:
        top_missing_reason = "No blocker detected."

    return {
        "status": "ok",
        "property_id": str(property_id),
        "range": {"start_date": start_date.isoformat(), "end_date": end_date.isoformat()},
        "filters": {
            "siteKey": site_key or "",
            "path": path or "",
            "deviceType": normalized_device_type if normalized_device_type in {"desktop", "mobile", "tablet"} else "",
        },
        "site": shaped_site,
        "health": {
            "trackerScriptExpected": bool(shaped_site and shaped_site.get("trackingEnabled") and shaped_site.get("siteKey")),
            "trackerScriptObserved": bool(latest_event_at),
            "latestEventAt": latest_event_at,
            "latestDiagnosticAt": latest_diagnostic_at,
            "latestCollectStatus": latest_collect_status,
            "eventsAccepted": len(events),
            "eventsWithCoordinates": coordinate_events,
            "dedupedTapEvents": deduped_tap_count,
            "sessionsObserved": len(session_keys),
            "sampleRate": sampling_rate,
            "sampleMayRejectQaSessions": bool(sampling_rate and sampling_rate < 1),
            "consentMode": shaped_site.get("consentMode") if shaped_site else "",
            "respectDnt": bool(shaped_site.get("respectDnt")) if shaped_site else False,
            "allowedDomains": allowed_domains,
            "missingDomainVariants": missing_domain_variants,
            "countsByType": counts_by_type,
            "statuses": {
                "scriptDetected": {
                    "ok": script_detected,
                    "label": "Detected" if script_detected else "Not detected",
                    "detail": latest_event_at or "No tracker event observed",
                },
                "sampleAccepted": {
                    "ok": sample_accepted,
                    "label": "Accepted" if sample_accepted else "Not confirmed",
                    "detail": f"{round(sampling_rate * 100)}% sample rate" if sampling_rate else "No sample rate",
                },
                "consentDntAllowed": {
                    "ok": consent_dnt_allowed,
                    "label": "Allowed" if consent_dnt_allowed else "Blocked or unknown",
                    "detail": f"Consent {shaped_site.get('consentMode') if shaped_site else 'unknown'}; DNT {'on' if shaped_site and shaped_site.get('respectDnt') else 'off'}",
                },
                "lastCollectAccepted": {
                    "ok": last_collect_accepted,
                    "label": "Accepted" if last_collect_accepted else "Not accepted",
                    "detail": latest_collect_status or "No collect status",
                },
                "domainAccepted": {
                    "ok": domain_accepted,
                    "label": "Accepted" if domain_accepted else "Not confirmed",
                    "detail": f"{len(allowed_domains)} allowed domain(s)",
                },
                "eventsStored": {
                    "ok": events_stored,
                    "label": "Stored" if events_stored else "None stored",
                    "detail": f"{len(events)} event(s)",
                },
            },
            "topMissingReason": top_missing_reason,
        },
        "recommendations": recommendations,
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
    capture_metrics = _screenshot_capture_metrics(
        screenshot,
        device_type=str(screenshot.get("device_type") or ""),
        fallback_width=_to_int(screenshot.get("width")),
        fallback_height=_to_int(screenshot.get("height")),
    )

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
            "captureMetrics": capture_metrics,
            "screenshotMode": capture_metrics.get("screenshotMode"),
            "capturedUrl": capture_metrics.get("capturedUrl"),
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
                "captureMetrics": _screenshot_capture_metrics(
                    item,
                    device_type=str(item.get("device_type") or ""),
                    fallback_width=_to_int(item.get("width")),
                    fallback_height=_to_int(item.get("height")),
                ),
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


def _truthy(value: Any, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return _normalize_text(value, 40).lower() not in {"", "0", "false", "no", "off", "disabled"}


def _clamp_score(value: Any) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    return round(max(0.0, min(100.0, number)), 1)


def _dedupe_texts(values: list[Any], *, limit: int = 40) -> list[str]:
    seen: set[str] = set()
    results: list[str] = []
    for value in values:
        text = _normalize_text(value, 500)
        if not text or text in seen:
            continue
        seen.add(text)
        results.append(text)
        if len(results) >= limit:
            break
    return results


def _ensure_list(value: Any) -> list[Any]:
    if isinstance(value, list):
        return value
    if value in (None, ""):
        return []
    return [value]


def _json_hash(value: Any) -> str:
    encoded = json.dumps(value, sort_keys=True, default=str, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _find_nested_value(source: Any, keys: tuple[str, ...]) -> Any:
    if not isinstance(source, dict):
        return None
    stack = [source]
    while stack:
        current = stack.pop()
        if not isinstance(current, dict):
            continue
        for key in keys:
            if key in current and current[key] not in (None, ""):
                return current[key]
        for value in current.values():
            if isinstance(value, dict):
                stack.append(value)
            elif isinstance(value, list):
                stack.extend(item for item in value if isinstance(item, dict))
    return None


def _get_price_range_from_attrs(source: Any, min_key: str = "Min", max_key: str = "Max") -> tuple[float | None, float | None]:
    attrs = source.get("@attributes") if isinstance(source, dict) else None
    if not isinstance(attrs, dict):
        attrs = source if isinstance(source, dict) else {}
    return _to_float(attrs.get(min_key)), _to_float(attrs.get(max_key))


def _floorplan_price_min(plan: dict[str, Any]) -> float | None:
    rent = plan.get("MarketRent") or plan.get("marketRent") or plan.get("Rent")
    if not isinstance(rent, dict):
        return None
    min_price, max_price = _get_price_range_from_attrs(rent, "Min", "Max")
    return min_price if min_price is not None else max_price


def _unit_spaces(unit: dict[str, Any]) -> list[dict[str, Any]]:
    unit_space = unit.get("UnitSpace") if isinstance(unit, dict) else None
    if isinstance(unit_space, dict):
        spaces = unit_space.get("Space")
        return [item for item in _ensure_list(spaces) if isinstance(item, dict)]
    return [unit] if isinstance(unit, dict) else []


def _unit_price(space: dict[str, Any]) -> float | None:
    rent = space.get("Rent") if isinstance(space, dict) else None
    if not isinstance(rent, dict):
        return None
    min_price, max_price = _get_price_range_from_attrs(rent, "MinRent", "MaxRent")
    return min_price if min_price is not None else max_price


def _is_available_unit(unit: dict[str, Any]) -> bool:
    status_value = _find_nested_value(
        unit,
        ("availabilityStatus", "status", "leaseStatus", "Availability", "Status", "Available", "IsAvailable"),
    )
    normalized = _normalize_text(status_value, 80).lower()
    return "available" in normalized or normalized == "true"


def _extract_special_items(snapshot: Any) -> list[dict[str, Any]]:
    if isinstance(snapshot, dict) and isinstance(snapshot.get("specials"), list):
        return [item for item in snapshot["specials"] if isinstance(item, dict)]
    specials_root = snapshot.get("specials") if isinstance(snapshot, dict) else None
    if isinstance(specials_root, dict):
        property_specials = specials_root.get("propertySpecials")
        grouped = property_specials.get("special") if isinstance(property_specials, dict) else None
        if isinstance(grouped, dict):
            return [item for item in grouped.values() if isinstance(item, dict)]
        if isinstance(grouped, list):
            return [item for item in grouped if isinstance(item, dict)]
    return []


def _get_special_title(special: dict[str, Any]) -> str:
    return _normalize_text(
        _find_nested_value(
            special,
            ("specialName", "specialTitle", "marketingName", "headline", "title", "name", "label", "incentiveName"),
        ),
        160,
    ) or "Untitled special"


def _fetch_singleton_property_row(
    table_name: str,
    property_id: str,
    *,
    access_token: str | None = None,
) -> dict[str, Any] | None:
    rows = _fetch_json(
        table_name,
        [
            ("select", "*"),
            ("property_id", f"eq.{property_id}"),
            ("limit", "1"),
        ],
        headers=_supabase_anon_headers(access_token) if access_token else None,
    )
    return rows[0] if rows else None


def _get_entrata_site_audit_context(
    property_id: str,
    *,
    access_token: str | None = None,
) -> dict[str, Any]:
    try:
        pricing_row = _fetch_singleton_property_row("property_availability_snapshots", property_id, access_token=access_token)
    except Exception as error:
        pricing_row = {"error": str(error)}
    try:
        specials_row = _fetch_singleton_property_row("property_specials_current", property_id, access_token=access_token)
    except Exception as error:
        specials_row = {"error": str(error)}

    floorplans = [item for item in _ensure_list((pricing_row or {}).get("floorplans")) if isinstance(item, dict)]
    units = [item for item in _ensure_list((pricing_row or {}).get("units")) if isinstance(item, dict)]
    unit_spaces = [space for unit in units for space in _unit_spaces(unit)]
    priced_values = [value for value in (_unit_price(space) for space in unit_spaces) if value is not None]
    if not priced_values:
        priced_values = [value for value in (_floorplan_price_min(plan) for plan in floorplans) if value is not None]
    available_units = [unit for unit in units if _is_available_unit(unit)]
    special_items = _extract_special_items(specials_row or {})
    special_titles = [_get_special_title(item) for item in special_items]

    min_price = min(priced_values) if priced_values else None
    max_price = max(priced_values) if priced_values else None
    application_signals = [
        "apply",
        "application",
        "online leasing",
        "lease now",
    ]
    return {
        "pricing": {
            "hasSnapshot": bool(pricing_row and not pricing_row.get("error")),
            "lastSyncedAt": (pricing_row or {}).get("last_synced_at"),
            "floorplanCount": int((pricing_row or {}).get("floorplan_count") or len(floorplans) or 0),
            "unitCount": int((pricing_row or {}).get("unit_count") or len(units) or 0),
            "availableUnitCount": len(available_units),
            "minPrice": min_price,
            "maxPrice": max_price,
            "availabilityUrl": (pricing_row or {}).get("availability_url"),
            "snapshotHash": (pricing_row or {}).get("snapshot_hash"),
            "error": (pricing_row or {}).get("error"),
        },
        "specials": {
            "hasSnapshot": bool(specials_row and not specials_row.get("error")),
            "lastSyncedAt": (specials_row or {}).get("last_synced_at"),
            "specialCount": int((specials_row or {}).get("special_count") or len(special_items) or 0),
            "titles": special_titles[:8],
            "specialsHash": (specials_row or {}).get("specials_hash"),
            "error": (specials_row or {}).get("error"),
        },
        "applicationFlow": {
            "source": "website page snapshot CTA and Entrata funnel proxy",
            "expectedSignals": application_signals,
        },
    }


def _site_audit_ai_is_configured() -> bool:
    return bool(os.environ.get("OPENAI_API_KEY")) and _truthy(os.environ.get("SITE_AUDIT_AI_ENABLED"), True)


def _site_audit_ai_system_prompt() -> str:
    rubric_lines = "\n".join(f"- {item['key']}: {item['label']}" for item in SITE_AUDIT_RUBRIC)
    return (
        "You are Redstone Residential's website QA auditor for apartment property websites. "
        "Audit only observable evidence from the supplied page metadata and screenshots. "
        "Use Entrata truth data as the source of record for pricing, floor plan availability, current specials, "
        "and application-flow expectations. Use the screenshots to judge whether those facts are visible, clear, "
        "and consistent to a resident. Do not invent facts that are not visible or present in Entrata truth data. "
        "If pricing, availability, application function, contact hours, or offer currency cannot be verified from "
        "the supplied evidence, mark that checklist item not_verifiable and explain exactly what would need to be "
        "checked manually. Score each checklist item from 0 to 100, and reserve scores below 70 for concrete "
        "visible or data-backed problems. Produce concise, actionable recommendations.\n\n"
        f"Audit rubric:\n{rubric_lines}\n\n"
        "Calibration examples:\n"
        "- If Entrata has available units and pricing but the floor plans/pricing page screenshot does not show pricing "
        "or availability, mark floor_plan_availability or pricing_accuracy warn/fail depending on severity.\n"
        "- If a homepage has a single generic hero line and no resident benefit, mark homepage_value_add fail even if "
        "the design looks polished.\n"
        "- If specials exist in Entrata but the screenshot shows no matching offer, mark special_offers_current warn "
        "and recommend aligning site offer copy with Entrata.\n"
        "- If the screenshot clearly shows Apply Now, Lease Now, Start Application, or equivalent CTAs, application_flow_visible "
        "can pass visually, but note that a true transaction test still requires manual or browser-flow QA."
    )


def _site_audit_page_context(
    page: dict[str, Any],
    deterministic_result: dict[str, Any],
    entrata_context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "pageId": page.get("id"),
        "path": page.get("path") or "/",
        "url": page.get("url") or "",
        "title": page.get("title") or "",
        "metaDescription": page.get("metaDescription") or "",
        "headings": (page.get("headings") if isinstance(page.get("headings"), list) else [])[:20],
        "ctas": (page.get("ctas") if isinstance(page.get("ctas"), list) else [])[:20],
        "promoDateStrings": (page.get("promoDateStrings") if isinstance(page.get("promoDateStrings"), list) else [])[:20],
        "pageStructure": page.get("pageStructure") if isinstance(page.get("pageStructure"), dict) else {},
        "deterministicAudit": {
            "score": deterministic_result.get("score"),
            "issues": deterministic_result.get("issues") or [],
            "recommendations": deterministic_result.get("recommendations") or [],
            "categoryScores": deterministic_result.get("categoryScores") or {},
        },
        "entrataTruthData": entrata_context or {},
    }


def _site_audit_screenshot_image_inputs(page: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    content: list[dict[str, Any]] = []
    screenshot_refs: list[dict[str, Any]] = []
    screenshots = page.get("screenshots") if isinstance(page.get("screenshots"), list) else []
    for screenshot in screenshots[: max(1, SITE_AUDIT_AI_MAX_SCREENSHOTS_PER_PAGE)]:
        if not isinstance(screenshot, dict):
            continue
        storage_bucket = _normalize_text(screenshot.get("storageBucket") or screenshot.get("storage_bucket"), 160)
        storage_path = _normalize_text(screenshot.get("storagePath") or screenshot.get("storage_path"), 1024)
        if not storage_bucket or not storage_path:
            continue
        signed = _create_signed_read_url(storage_bucket, storage_path, expires_in=3600)
        signed_path = signed.get("signedURL") or signed.get("signedUrl") or signed.get("signed_url") or signed.get("url")
        preview_url = _resolve_storage_signed_url(signed_path)
        if not preview_url:
            continue
        device_type = _normalize_text(screenshot.get("deviceType") or screenshot.get("device_type") or "unknown", 40)
        content.append(
            {
                "type": "input_text",
                "text": (
                    f"Screenshot for {device_type} viewport. Captured at "
                    f"{screenshot.get('capturedAt') or screenshot.get('captured_at') or 'unknown time'}."
                ),
            }
        )
        content.append({"type": "input_image", "image_url": preview_url})
        screenshot_refs.append(
            {
                "id": screenshot.get("id"),
                "deviceType": device_type,
                "capturedAt": screenshot.get("capturedAt") or screenshot.get("captured_at"),
                "width": screenshot.get("width"),
                "height": screenshot.get("height"),
                "contentHash": screenshot.get("contentHash") or screenshot.get("content_hash"),
            }
        )
    return content, screenshot_refs


def _site_audit_cache_key(
    page_context: dict[str, Any],
    screenshot_refs: list[dict[str, Any]],
) -> tuple[str, str, str]:
    screenshot_hash = _json_hash(
        [
            {
                "id": item.get("id"),
                "deviceType": item.get("deviceType"),
                "contentHash": item.get("contentHash"),
                "capturedAt": item.get("capturedAt"),
            }
            for item in screenshot_refs
        ]
    )
    context_hash = _json_hash(page_context)
    cache_key = _json_hash(
        {
            "model": SITE_AUDIT_AI_MODEL,
            "promptVersion": SITE_AUDIT_AI_PROMPT_VERSION,
            "contextHash": context_hash,
            "screenshotHash": screenshot_hash,
        }
    )
    return cache_key, context_hash, screenshot_hash


def _get_cached_ai_page_audit(cache_key: str) -> dict[str, Any] | None:
    try:
        rows = _fetch_json(
            "property_site_audit_ai_cache",
            [
                ("select", "*"),
                ("cache_key", f"eq.{cache_key}"),
                ("limit", "1"),
            ],
        )
    except Exception:
        return None
    if not rows:
        return None
    cached = rows[0].get("ai_result") if isinstance(rows[0], dict) else None
    return cached if isinstance(cached, dict) else None


def _save_cached_ai_page_audit(
    *,
    cache_key: str,
    property_id: str,
    site_id: str | None,
    page_id: str | None,
    path: str,
    context_hash: str,
    screenshot_hash: str,
    ai_result: dict[str, Any],
) -> None:
    row = {
        "cache_key": cache_key,
        "property_id": property_id,
        "site_id": site_id,
        "page_id": page_id,
        "path": path,
        "model": SITE_AUDIT_AI_MODEL,
        "prompt_version": SITE_AUDIT_AI_PROMPT_VERSION,
        "page_context_hash": context_hash,
        "screenshot_hash": screenshot_hash,
        "score": ai_result.get("score"),
        "ai_result": ai_result,
        "raw_data": {
            "rubric": SITE_AUDIT_RUBRIC,
            "cachedAt": datetime.now(timezone.utc).isoformat(),
        },
    }
    try:
        _json_request(
            "property_site_audit_ai_cache",
            [("on_conflict", "cache_key")],
            method="POST",
            payload=row,
            headers={**_supabase_headers(), "Prefer": "resolution=merge-duplicates,return=minimal"},
        )
    except Exception:
        return


def _extract_openai_output_text(response_payload: dict[str, Any]) -> str:
    output_text = _normalize_text(response_payload.get("output_text"), 2_000_000)
    if output_text:
        return output_text
    output = response_payload.get("output") if isinstance(response_payload.get("output"), list) else []
    text_parts: list[str] = []
    for item in output:
        if not isinstance(item, dict):
            continue
        content = item.get("content") if isinstance(item.get("content"), list) else []
        for content_item in content:
            if not isinstance(content_item, dict):
                continue
            if content_item.get("type") in {"output_text", "text"} and content_item.get("text"):
                text_parts.append(str(content_item.get("text")))
    return "\n".join(text_parts).strip()


def _call_openai_site_audit(content: list[dict[str, Any]]) -> dict[str, Any]:
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not configured.")
    payload = {
        "model": SITE_AUDIT_AI_MODEL,
        "input": [
            {"role": "system", "content": _site_audit_ai_system_prompt()},
            {"role": "user", "content": content},
        ],
        "text": {
            "format": {
                "type": "json_schema",
                "name": "website_audit_page",
                "strict": True,
                "schema": SITE_AUDIT_AI_SCHEMA,
            }
        },
    }
    request = Request(
        "https://api.openai.com/v1/responses",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
    )
    with urlopen(request, timeout=SITE_AUDIT_AI_TIMEOUT_SECONDS) as response:
        response_body = json.loads(response.read().decode("utf-8"))
    output_text = _extract_openai_output_text(response_body)
    if not output_text:
        raise RuntimeError("OpenAI did not return audit JSON.")
    try:
        return json.loads(output_text)
    except json.JSONDecodeError as error:
        raise RuntimeError("OpenAI returned invalid audit JSON.") from error


def _normalize_ai_page_result(raw_result: dict[str, Any], page: dict[str, Any]) -> dict[str, Any]:
    checklist = []
    checklist_recommendations = []
    for item in raw_result.get("checklist") if isinstance(raw_result.get("checklist"), list) else []:
        if not isinstance(item, dict):
            continue
        normalized_item = {
            "key": _normalize_text(item.get("key"), 80),
            "label": _normalize_text(item.get("label"), 180),
            "status": _normalize_text(item.get("status"), 40) or "not_verifiable",
            "score": _clamp_score(item.get("score")),
            "severity": _normalize_text(item.get("severity"), 40) or "low",
            "evidence": _normalize_text(item.get("evidence"), 500),
            "recommendation": _normalize_text(item.get("recommendation"), 500),
        }
        checklist.append(normalized_item)
        if normalized_item["recommendation"] and normalized_item["status"] != "pass":
            checklist_recommendations.append(normalized_item["recommendation"])
    issues = []
    for item in raw_result.get("issues") if isinstance(raw_result.get("issues"), list) else []:
        if not isinstance(item, dict):
            continue
        issues.append(
            {
                "rubricKey": _normalize_text(item.get("rubric_key") or item.get("rubricKey"), 80),
                "severity": _normalize_text(item.get("severity"), 40) or "medium",
                "issue": _normalize_text(item.get("issue"), 500),
                "evidence": _normalize_text(item.get("evidence"), 500),
                "recommendation": _normalize_text(item.get("recommendation"), 500),
            }
        )
    return {
        "path": _normalize_text(raw_result.get("path") or page.get("path") or "/", 500),
        "score": _clamp_score(raw_result.get("score")),
        "summary": _normalize_text(raw_result.get("summary"), 700),
        "checklist": checklist,
        "issues": [item for item in issues if item.get("issue")],
        "recommendations": _dedupe_texts(
            [
                *checklist_recommendations,
                *([item.get("recommendation") for item in issues] if issues else []),
                *(raw_result.get("recommendations") if isinstance(raw_result.get("recommendations"), list) else []),
            ],
            limit=20,
        ),
        "priorityActions": _dedupe_texts(raw_result.get("priority_actions") if isinstance(raw_result.get("priority_actions"), list) else [], limit=10),
    }


def _merge_ai_page_audit_result(page_result: dict[str, Any], ai_result: dict[str, Any]) -> dict[str, Any]:
    ai_issues = [
        item.get("issue")
        for item in ai_result.get("issues", [])
        if isinstance(item, dict) and item.get("issue")
    ]
    ai_recommendations = ai_result.get("recommendations") if isinstance(ai_result.get("recommendations"), list) else []
    return {
        **page_result,
        "score": _clamp_score(ai_result.get("score")),
        "issues": _dedupe_texts([*(page_result.get("issues") or []), *ai_issues], limit=30),
        "recommendations": _dedupe_texts([*(page_result.get("recommendations") or []), *ai_recommendations], limit=30),
        "aiAudit": ai_result,
        "aiScore": _clamp_score(ai_result.get("score")),
        "aiSummary": ai_result.get("summary") or "",
    }


def _audit_page_with_openai(
    page: dict[str, Any],
    deterministic_result: dict[str, Any],
    *,
    property_id: str,
    site_id: str | None,
    entrata_context: dict[str, Any] | None = None,
) -> tuple[dict[str, Any] | None, dict[str, Any]]:
    image_inputs, screenshot_refs = _site_audit_screenshot_image_inputs(page)
    if not image_inputs:
        return None, {"status": "skipped", "reason": "No screenshots available for AI audit."}
    context = _site_audit_page_context(page, deterministic_result, entrata_context)
    cache_key, context_hash, screenshot_hash = _site_audit_cache_key(context, screenshot_refs)
    cached_result = _get_cached_ai_page_audit(cache_key)
    if cached_result:
        cached_result = {**cached_result, "cacheHit": True}
        return _merge_ai_page_audit_result(deterministic_result, cached_result), {
            "status": "cached",
            "screenshotCount": len(screenshot_refs),
            "cacheKey": cache_key,
        }
    content = [
        {
            "type": "input_text",
            "text": (
                "Audit this single property website page using the standardized website audit report. "
                "Return JSON only in the required schema.\n\n"
                f"Page context:\n{json.dumps(context, ensure_ascii=False)}"
            ),
        },
        *image_inputs,
    ]
    raw_result = _call_openai_site_audit(content)
    ai_result = _normalize_ai_page_result(raw_result, page)
    ai_result["screenshotsAudited"] = screenshot_refs
    ai_result["cacheHit"] = False
    _save_cached_ai_page_audit(
        cache_key=cache_key,
        property_id=property_id,
        site_id=site_id,
        page_id=page.get("id"),
        path=page.get("path") or "/",
        context_hash=context_hash,
        screenshot_hash=screenshot_hash,
        ai_result=ai_result,
    )
    return _merge_ai_page_audit_result(deterministic_result, ai_result), {
        "status": "ok",
        "screenshotCount": len(screenshot_refs),
        "cacheKey": cache_key,
    }


def _apply_ai_site_audit(
    pages: list[dict[str, Any]],
    page_results: list[dict[str, Any]],
    *,
    property_id: str,
    site_id: str | None,
    include_ai: bool,
    entrata_context: dict[str, Any] | None = None,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    meta = {
        "enabled": bool(include_ai),
        "configured": _site_audit_ai_is_configured(),
        "status": "disabled",
        "model": SITE_AUDIT_AI_MODEL,
        "pagesRequested": 0,
        "pagesScored": 0,
        "pagesSkipped": 0,
        "cacheHits": 0,
        "errors": [],
        "rubric": SITE_AUDIT_RUBRIC,
    }
    if not include_ai:
        meta["status"] = "not_requested"
        return page_results, meta
    if not _site_audit_ai_is_configured():
        meta["status"] = "not_configured"
        return page_results, meta

    next_results = list(page_results)
    page_lookup = {str(result.get("pageId") or result.get("path") or index): result for index, result in enumerate(next_results)}
    pages_to_audit = pages[: max(1, SITE_AUDIT_AI_MAX_PAGES)]
    meta["pagesRequested"] = len(pages_to_audit)
    for page_index, page in enumerate(pages_to_audit):
        page_key = str(page.get("id") or page.get("path") or "")
        deterministic_result = page_lookup.get(page_key)
        if not deterministic_result:
            deterministic_result = next_results[page_index] if page_index < len(next_results) else _audit_page(page)
        try:
            merged_result, page_meta = _audit_page_with_openai(
                page,
                deterministic_result,
                property_id=property_id,
                site_id=site_id,
                entrata_context=entrata_context,
            )
            if merged_result is None:
                meta["pagesSkipped"] += 1
                continue
            for index, result in enumerate(next_results):
                if result is deterministic_result or str(result.get("pageId") or result.get("path") or "") == page_key:
                    next_results[index] = merged_result
                    break
            meta["pagesScored"] += 1
            if page_meta.get("status") == "cached":
                meta["cacheHits"] += 1
            meta.setdefault("pageMeta", []).append({"path": page.get("path"), **page_meta})
        except Exception as error:
            meta["errors"].append({"path": page.get("path") or "/", "error": str(error)})

    if meta["pagesScored"]:
        meta["status"] = "ok" if not meta["errors"] else "partial"
    elif meta["errors"]:
        meta["status"] = "error"
    else:
        meta["status"] = "skipped"
    return next_results, meta


def _audit_page(page: dict[str, Any], entrata_context: dict[str, Any] | None = None) -> dict[str, Any]:
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

    safe_entrata = entrata_context if isinstance(entrata_context, dict) else {}
    pricing_context = safe_entrata.get("pricing") if isinstance(safe_entrata.get("pricing"), dict) else {}
    specials_context = safe_entrata.get("specials") if isinstance(safe_entrata.get("specials"), dict) else {}
    page_path = _normalize_text(page.get("path") or page.get("url"), 500).lower()
    page_text = " ".join(
        [
            title,
            meta,
            " ".join(_normalize_text(item.get("text") or item.get("label") or item, 180) for item in headings if isinstance(item, (dict, str))),
            " ".join(_normalize_text(item.get("label") if isinstance(item, dict) else item, 180) for item in ctas),
        ]
    ).lower()
    is_floorplan_page = any(token in page_path or token in page_text for token in ("floor", "availability", "pricing", "apartment"))
    is_homepage = page.get("path") in {"/", "", None}
    has_apply_cta = any(
        token in _normalize_text(cta.get("label") if isinstance(cta, dict) else cta, 180).lower()
        for cta in ctas
        for token in ("apply", "application", "lease now")
    )
    if has_apply_cta:
        recommendations.append("Use a browser-flow QA pass to confirm the application CTA completes successfully.")
    elif is_homepage or is_floorplan_page:
        issues.append("Application flow CTA is not clearly visible in captured page metadata.")
        recommendations.append("Add or verify a clear Apply Now / Start Application CTA on high-intent pages.")
    if pricing_context.get("hasSnapshot"):
        if is_floorplan_page and pricing_context.get("minPrice") is not None and "$" not in page_text:
            issues.append("Entrata pricing exists, but pricing is not visible in captured floor plan page metadata.")
            recommendations.append("Show current starting rent or price range on the floor plan / availability page.")
        if is_floorplan_page and int(pricing_context.get("availableUnitCount") or 0) > 0 and not any(token in page_text for token in ("available", "availability", "unit")):
            issues.append("Entrata has available units, but availability language is not visible in captured floor plan page metadata.")
            recommendations.append("Surface live availability count or availability status near floor plan CTAs.")
    else:
        recommendations.append("Sync Entrata availability/pricing before relying on pricing and floor plan audit checks.")
    if specials_context.get("hasSnapshot") and int(specials_context.get("specialCount") or 0) > 0:
        special_titles = [_normalize_text(item, 180).lower() for item in specials_context.get("titles") or []]
        if special_titles and not any(title_fragment and title_fragment in page_text for title_fragment in special_titles):
            issues.append("Entrata has active specials, but matching special offer copy is not visible in captured page metadata.")
            recommendations.append("Align website special offer copy with current Entrata specials.")

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
    cta_score -= 15 if (is_homepage or is_floorplan_page) and not has_apply_cta else 0

    stale_date_score = max(0, 100 - min(80, len(stale_dates) * 25))
    if specials_context.get("hasSnapshot") and int(specials_context.get("specialCount") or 0) > 0 and special_titles and not any(title_fragment and title_fragment in page_text for title_fragment in special_titles):
        stale_date_score = max(0, stale_date_score - 20)
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
    include_ai: bool = True,
) -> dict[str, Any]:
    pages_payload = get_site_audit_pages_summary(property_id, site_key=site_key, access_token=access_token)
    pages = pages_payload.get("pages") if isinstance(pages_payload.get("pages"), list) else []
    site_id = _fetch_site_id_filter(site_key)
    entrata_context = _get_entrata_site_audit_context(property_id, access_token=access_token)
    page_results = [_audit_page(page, entrata_context) for page in pages]
    page_results, ai_audit_meta = _apply_ai_site_audit(
        pages,
        page_results,
        property_id=property_id,
        site_id=site_id,
        include_ai=include_ai,
        entrata_context=entrata_context,
    )
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
    ai_pages = [page for page in page_results if isinstance(page.get("aiAudit"), dict)]
    if ai_pages:
        checklist_scores: dict[str, list[float]] = {}
        checklist_labels: dict[str, str] = {}
        for page in ai_pages:
            ai_audit = page.get("aiAudit") if isinstance(page.get("aiAudit"), dict) else {}
            for item in ai_audit.get("checklist") if isinstance(ai_audit.get("checklist"), list) else []:
                if not isinstance(item, dict):
                    continue
                key = _normalize_text(item.get("key"), 80)
                if not key:
                    continue
                checklist_scores.setdefault(key, []).append(_clamp_score(item.get("score")))
                checklist_labels[key] = item.get("label") or key
        category_keys = [item["key"] for item in SITE_AUDIT_RUBRIC if item["key"] in checklist_scores]
        category_labels = {item["key"]: item["label"] for item in SITE_AUDIT_RUBRIC}
        category_labels.update(checklist_labels)
        category_scores = {
            key: round(sum(values) / len(values), 1)
            for key, values in checklist_scores.items()
            if values
        }
        category_weights = {key: round(1 / len(category_keys), 4) for key in category_keys} if category_keys else {}
        weighted_score = average_score
        urgency_components = [
            category_scores.get("homepage_cta"),
            category_scores.get("application_flow_visible"),
            category_scores.get("homepage_value_add"),
        ]
        urgency_values = [value for value in urgency_components if value is not None]
        urgency_score = round(sum(urgency_values) / len(urgency_values), 1) if urgency_values else None
        freshness_score = category_scores.get("special_offers_current")
        link_score = category_scores.get("page_load_desktop_mobile")
    else:
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
                "aiScore": page.get("aiScore"),
                "aiSummary": page.get("aiSummary"),
                "aiChecklist": (page.get("aiAudit") or {}).get("checklist") if isinstance(page.get("aiAudit"), dict) else [],
            }
            for page in page_results
        ][:100],
        "pages": page_results[:500],
        "raw_data": {
            "siteKey": site_key or "",
            "algorithm": "redstone-ai-vision-site-audit-v1" if ai_pages else "redstone-weighted-site-audit-v2",
            "aiAudit": ai_audit_meta,
            "entrataAuditContext": entrata_context,
            "categoryScores": [
                {
                    "key": key,
                    "label": category_labels[key],
                    "score": category_scores[key],
                    "weight": category_weights[key],
                }
                for key in category_keys
                if key in category_scores
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
    rubric_result_count = _save_site_audit_rubric_results(audit, page_results)
    if isinstance(audit.get("raw_data"), dict):
        audit["raw_data"] = {**audit["raw_data"], "rubricResultCount": rubric_result_count}
    return {
        "status": "ok",
        "property_id": str(property_id),
        "audit": audit,
        "staging_only": True,
    }


def _save_site_audit_rubric_results(audit: dict[str, Any], page_results: list[dict[str, Any]]) -> int:
    audit_id = audit.get("id")
    if not audit_id:
        return 0
    rows = []
    for page in page_results:
        ai_audit = page.get("aiAudit") if isinstance(page.get("aiAudit"), dict) else {}
        checklist = ai_audit.get("checklist") if isinstance(ai_audit.get("checklist"), list) else []
        for item in checklist:
            if not isinstance(item, dict):
                continue
            rubric_key = _normalize_text(item.get("key"), 80)
            if not rubric_key:
                continue
            rows.append(
                {
                    "audit_id": audit_id,
                    "property_id": audit.get("property_id"),
                    "site_id": audit.get("site_id"),
                    "page_id": page.get("pageId"),
                    "path": page.get("path") or "/",
                    "rubric_key": rubric_key,
                    "label": item.get("label") or rubric_key,
                    "status": item.get("status") or "not_verifiable",
                    "score": item.get("score"),
                    "severity": item.get("severity") or "low",
                    "evidence": item.get("evidence") or "",
                    "recommendation": item.get("recommendation") or "",
                    "source": "openai_vision",
                    "model": SITE_AUDIT_AI_MODEL,
                    "prompt_version": SITE_AUDIT_AI_PROMPT_VERSION,
                    "raw_data": {
                        "aiSummary": ai_audit.get("summary"),
                        "cacheHit": ai_audit.get("cacheHit"),
                    },
                }
            )
    if not rows:
        return 0
    try:
        _json_request(
            "property_site_audit_rubric_results",
            [],
            method="POST",
            payload=rows,
            headers={**_supabase_headers(), "Prefer": "return=minimal"},
        )
    except Exception:
        return 0
    return len(rows)


def enqueue_site_audit_job_summary(
    property_id: str,
    *,
    site_key: str | None = None,
    include_ai: bool = True,
    access_token: str | None = None,
) -> dict[str, Any]:
    site_id = _fetch_site_id_filter(site_key)
    payload = {
        "property_id": str(property_id),
        "site_key": site_key or "",
        "include_ai": bool(include_ai),
    }
    existing = _fetch_json(
        "property_site_audit_jobs",
        [
            ("select", "*"),
            ("property_id", f"eq.{property_id}"),
            ("status", "in.(queued,running)"),
            ("order", "created_at.desc"),
            ("limit", "1"),
        ],
        headers=_supabase_anon_headers(access_token) if access_token else None,
    )
    job = existing[0] if existing else None
    if not job:
        rows = _json_request(
            "property_site_audit_jobs",
            [("select", "*")],
            method="POST",
            payload={
                "property_id": str(property_id),
                "site_id": site_id,
                "status": "queued",
                "job_type": "ai_site_audit" if include_ai else "site_audit",
                "payload": payload,
            },
            headers={**_supabase_headers(), "Prefer": "return=representation"},
        )
        job = rows[0] if isinstance(rows, list) and rows else {}
    latest = get_site_audit_summary(property_id, site_key=site_key, access_token=access_token)
    return {
        "status": "queued",
        "property_id": str(property_id),
        "job": job,
        "audit": latest.get("audit"),
        "message": "Site audit queued for background processing.",
        "staging_only": True,
    }


def _patch_site_audit_job(job_id: str, fields: dict[str, Any]) -> dict[str, Any]:
    rows = _json_request(
        "property_site_audit_jobs",
        [("id", f"eq.{job_id}"), ("select", "*")],
        method="PATCH",
        payload=fields,
        headers={**_supabase_headers(), "Prefer": "return=representation"},
    )
    return rows[0] if isinstance(rows, list) and rows else fields


def process_site_audit_jobs(limit: int = SITE_AUDIT_JOB_BATCH_LIMIT) -> dict[str, Any]:
    limit = max(1, min(25, int(limit or SITE_AUDIT_JOB_BATCH_LIMIT)))
    jobs = _fetch_json(
        "property_site_audit_jobs",
        [
            ("select", "*"),
            ("status", "eq.queued"),
            ("order", "created_at.asc"),
            ("limit", str(limit)),
        ],
    )
    processed = []
    for job in jobs:
        job_id = _normalize_text(job.get("id"), 120)
        if not job_id:
            continue
        payload = job.get("payload") if isinstance(job.get("payload"), dict) else {}
        property_id = _normalize_text(job.get("property_id") or payload.get("property_id"), 120)
        site_key = _normalize_text(payload.get("site_key") or payload.get("siteKey"), 160)
        include_ai = payload.get("include_ai")
        include_ai = bool(include_ai) if isinstance(include_ai, bool) else _truthy(include_ai, True)
        try:
            _patch_site_audit_job(job_id, {"status": "running", "started_at": datetime.now(timezone.utc).isoformat()})
            result = run_site_audit_summary(property_id, site_key=site_key or None, include_ai=include_ai)
            audit_id = result.get("audit", {}).get("id") if isinstance(result.get("audit"), dict) else None
            _patch_site_audit_job(
                job_id,
                {
                    "status": "completed",
                    "completed_at": datetime.now(timezone.utc).isoformat(),
                    "audit_id": audit_id,
                    "result": {"auditId": audit_id, "status": result.get("status")},
                },
            )
            processed.append({"jobId": job_id, "propertyId": property_id, "status": "completed", "auditId": audit_id})
        except Exception as error:
            attempts = int(job.get("attempts") or 0) + 1
            next_status = "failed" if attempts >= 3 else "queued"
            _patch_site_audit_job(
                job_id,
                {
                    "status": next_status,
                    "attempts": attempts,
                    "last_error": str(error),
                    "completed_at": datetime.now(timezone.utc).isoformat() if next_status == "failed" else None,
                },
            )
            processed.append({"jobId": job_id, "propertyId": property_id, "status": next_status, "error": str(error)})
    return {
        "status": "ok",
        "processed": processed,
        "count": len(processed),
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
                "property_id,audited_at,status,page_count,performance_score,urgency_score,freshness_score,link_score,summary,issues,recommendations,broken_links,stale_date_findings,performance_notes,raw_data",
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
        raw_data = audit_row.get("raw_data") if isinstance(audit_row, dict) and isinstance(audit_row.get("raw_data"), dict) else {}
        ai_audit = raw_data.get("aiAudit") if isinstance(raw_data.get("aiAudit"), dict) else {}
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
            "auditAlgorithm": raw_data.get("algorithm") if isinstance(raw_data, dict) else "",
            "aiAuditStatus": ai_audit.get("status") if isinstance(ai_audit, dict) else "",
            "aiPagesScored": int(ai_audit.get("pagesScored") or 0) if isinstance(ai_audit, dict) else 0,
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
  var SCROLL_MILESTONES = [0.25, 0.5, 0.75, 0.9, 1];
  var SCROLL_BANDS = [
    {{ key: '0-25', min: 0, max: 0.25 }},
    {{ key: '25-50', min: 0.25, max: 0.5 }},
    {{ key: '50-75', min: 0.5, max: 0.75 }},
    {{ key: '75-90', min: 0.75, max: 0.9 }},
    {{ key: '90-100', min: 0.9, max: 1.01 }}
  ];
  var startedAt = Date.now();
  var currentRouteKey = '';
  var routeChangeTimer = null;
  var status = window.__REDSTONE_TRACKER_STATUS = {{
    loaded: true,
    siteKey: SITE_KEY,
    scriptLoadedAt: new Date().toISOString(),
    sampleRate: SAMPLE_RATE,
    sampleAccepted: null,
    consentAllowed: null,
    blockedReason: '',
    lastCollectStatus: '',
    lastCollectAt: '',
    eventsAccepted: 0,
    eventsQueued: 0
  }};
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

  if (!hasConsent()) {{
    status.consentAllowed = false;
    status.blockedReason = 'consent_or_dnt';
    return;
  }}
  status.consentAllowed = true;

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

  if (!sampledIn()) {{
    status.sampleAccepted = false;
    status.blockedReason = 'sampled_out';
    return;
  }}
  status.sampleAccepted = true;

  var sid = sessionId();
  var queue = [];
  var lastMove = 0;
  var lastScroll = 0;
  var lastDwell = 0;
  var lastPointer = null;
  var lastDwellKey = '';
  var firstInteractionSent = false;
  var firstMeaningfulScrollSent = false;
  var reachedScrollMilestones = {{}};
  var scrollBandStartedAt = Date.now();
  var activeScrollBand = '';
  var scrollBandDurations = {{}};
  var sectionExposure = {{}};
  var lastSectionExposureAt = Date.now();
  var pageSent = false;

  function absoluteUrl(value) {{
    try {{
      return new URL(value || location.href, location.href).href;
    }} catch (e) {{
      return location.href;
    }}
  }}

  function routePath() {{
    return location.pathname || '/';
  }}

  function routeKey() {{
    return [location.pathname || '/', location.search || ''].join('');
  }}

  function routeKeyFromUrl(value) {{
    if (!value) return routeKey();
    try {{
      var parsed = new URL(value, location.href);
      return [parsed.pathname || '/', parsed.search || ''].join('');
    }} catch (e) {{
      return routeKey();
    }}
  }}

  function canonicalUrl() {{
    var canonical = document.querySelector('link[rel="canonical"]');
    var href = canonical && canonical.href ? canonical.href : location.href;
    try {{
      return new URL(href, location.href).href;
    }} catch (e) {{
      return location.href;
    }}
  }}

  function canonicalPath() {{
    return routePath();
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
      path: routePath(),
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
    var action = target.closest && target.closest('a, button, [role="button"], [data-redstone-track-id], [data-redstone-cta], [data-cta]');
    return action ? cleanText(action.textContent, 100) : '';
  }}

  function isCta(target) {{
    if (!target || isSensitiveElement(target)) return false;
    var action = target.closest && target.closest('a, button, [role="button"], [data-redstone-cta], [data-redstone-track-id], [data-cta], .cta, .button, .btn');
    if (!action) return false;
    var label = actionLabel(action).toLowerCase();
    var href = action.href || '';
    return Boolean(action.hasAttribute && (action.hasAttribute('data-redstone-cta') || action.hasAttribute('data-cta'))) ||
      /apply|lease|tour|schedule|availability|floor\\s*plan|contact|call|text|book|reserve|special|offer/.test(label + ' ' + href);
  }}

  function safeSelectorValue(value) {{
    return cleanText(value, 80).replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  }}

  function selectorSegment(node) {{
    if (!node || !node.tagName) return '';
    var tag = String(node.tagName).toLowerCase();
    var trackId = node.getAttribute && node.getAttribute('data-redstone-track-id');
    if (trackId) return '[data-redstone-track-id="' + safeSelectorValue(trackId) + '"]';
    if (node.id) return '#' + safeSelectorValue(node.id);
    var cta = node.getAttribute && node.getAttribute('data-redstone-cta');
    if (cta !== null && cta !== undefined) return tag + '[data-redstone-cta]';
    var role = node.getAttribute && node.getAttribute('role');
    if (role) return tag + '[role="' + safeSelectorValue(role) + '"]';
    var classes = [];
    if (node.classList && node.classList.length) {{
      classes = Array.prototype.slice.call(node.classList)
        .map(safeSelectorValue)
        .filter(function(item) {{ return item && item.length <= 42 && !/^\\d+$/.test(item); }})
        .slice(0, 2);
    }}
    var segment = tag + (classes.length ? '.' + classes.join('.') : '');
    if (!classes.length && node.parentElement) {{
      var index = 1;
      var sibling = node;
      while ((sibling = sibling.previousElementSibling)) {{
        if (sibling.tagName === node.tagName) index += 1;
      }}
      segment += ':nth-of-type(' + index + ')';
    }}
    return segment;
  }}

  function selectorPath(node) {{
    if (!node || !node.closest || isSensitiveElement(node)) return '';
    var parts = [];
    var current = node;
    var depth = 0;
    while (current && current.nodeType === 1 && depth < 6) {{
      var segment = selectorSegment(current);
      if (segment) parts.unshift(segment);
      if (segment.charAt(0) === '#' || segment.indexOf('[data-redstone-track-id=') === 0) break;
      current = current.parentElement;
      if (current && /^(HTML|BODY)$/i.test(current.tagName || '')) break;
      depth += 1;
    }}
    return parts.join(' > ').slice(0, 420);
  }}

  function trackedElement(target) {{
    if (!target || !target.closest) return target;
    return target.closest('[data-redstone-track-id], [data-redstone-cta], [data-cta], a, button, [role="button"]') || target;
  }}

  function elementBounds(node) {{
    if (!node || !node.getBoundingClientRect || isSensitiveElement(node)) return null;
    var rect = node.getBoundingClientRect();
    var size = docSize();
    var left = rect.left + window.scrollX;
    var top = rect.top + window.scrollY;
    return {{
      left: Math.round(left),
      top: Math.round(top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      leftPct: left / Math.max(1, size.documentWidth),
      topPct: top / Math.max(1, size.documentHeight),
      widthPct: rect.width / Math.max(1, size.documentWidth),
      heightPct: rect.height / Math.max(1, size.documentHeight)
    }};
  }}

  function targetCategory(target) {{
    if (!target || !target.closest) return 'unknown';
    var action = trackedElement(target);
    var href = action && action.href ? String(action.href).toLowerCase() : '';
    var label = actionLabel(action || target).toLowerCase();
    var descriptor = [
      label,
      href,
      action && action.id || '',
      action && typeof action.className === 'string' ? action.className : '',
      action && action.getAttribute ? (action.getAttribute('data-redstone-track-id') || action.getAttribute('data-redstone-cta') || '') : ''
    ].join(' ').toLowerCase();
    if (/^tel:|\\b(call|phone|text|sms)\\b/.test(href + ' ' + descriptor)) return 'phone';
    if (action && action.closest && action.closest('form, [role="form"]')) return 'form';
    if (/floor\\s*plans?|availability|unit|pricing/.test(descriptor)) return 'floorplan';
    if (/map|directions|location/.test(descriptor) || (action && action.closest && action.closest('[class*="map"], [id*="map"]'))) return 'map';
    if (/gallery|photo|virtual\\s*tour|video/.test(descriptor) || (action && action.closest && action.closest('[class*="gallery"], [class*="carousel"], [class*="slider"]'))) return 'gallery';
    if (action && action.closest && action.closest('nav, header, [role="navigation"], .menu')) return 'nav';
    if (isCta(target)) return 'cta';
    if (action && /^(A)$/i.test(action.tagName || '')) return 'link';
    if (action && /^(BUTTON)$/i.test(action.tagName || '')) return 'button';
    return 'content';
  }}

  function targetMeta(target) {{
    if (!target || target === document || target === window) return {{}};
    var tag = target.tagName || '';
    if (isSensitiveElement(target)) return {{ targetTag: tag, sensitive: true }};
    var action = trackedElement(target);
    var trackId = action && action.getAttribute ? cleanText(action.getAttribute('data-redstone-track-id'), 120) : '';
    var ctaId = action && action.getAttribute ? cleanText(action.getAttribute('data-redstone-cta'), 120) : '';
    var bounds = elementBounds(action || target);
    return {{
      targetTag: tag,
      targetId: (action && action.id) || target.id || '',
      targetClass: action && typeof action.className === 'string' ? action.className.slice(0, 300) : (typeof target.className === 'string' ? target.className.slice(0, 300) : ''),
      targetRole: action && action.getAttribute ? (action.getAttribute('role') || '') : (target.getAttribute ? (target.getAttribute('role') || '') : ''),
      targetHref: action && action.href ? absoluteUrl(action.href).slice(0, 1024) : '',
      targetLabel: actionLabel(action || target),
      targetSelector: selectorPath(action || target),
      targetTrackId: trackId,
      targetCtaId: ctaId,
      targetCategory: targetCategory(target),
      targetBounds: bounds,
      isCta: isCta(target)
    }};
  }}

  function markFirstInteraction(source, target) {{
    if (firstInteractionSent) return;
    firstInteractionSent = true;
    enqueue('first_interaction', Object.assign({{
      source: source || 'unknown',
      firstInteractionMs: Date.now() - startedAt
    }}, targetMeta(target)));
  }}

  function pointerPayload(e, extra) {{
    var size = docSize();
    var pageX = typeof e.pageX === 'number' ? e.pageX : (window.scrollX + (e.clientX || 0));
    var pageY = typeof e.pageY === 'number' ? e.pageY : (window.scrollY + (e.clientY || 0));
    return Object.assign({{
      x: e.clientX || 0,
      y: e.clientY || 0,
      pageX: pageX,
      pageY: pageY,
      viewportXPct: (e.clientX || 0) / Math.max(1, window.innerWidth || 1),
      viewportYPct: (e.clientY || 0) / Math.max(1, window.innerHeight || 1),
      xPct: pageX / Math.max(1, size.documentWidth),
      yPct: pageY / Math.max(1, size.documentHeight),
      pointerType: e.pointerType || extra && extra.pointerType || '',
      isPrimary: e.isPrimary !== false
    }}, extra || {{}});
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
      canonicalUrl: canonicalUrl(),
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

  function scrollBandForDepth(depth) {{
    for (var i = 0; i < SCROLL_BANDS.length; i += 1) {{
      if (depth >= SCROLL_BANDS[i].min && depth < SCROLL_BANDS[i].max) return SCROLL_BANDS[i].key;
    }}
    return 'unknown';
  }}

  function updateScrollBandTime() {{
    var now = Date.now();
    var depth = scrollDepth();
    var band = scrollBandForDepth(depth);
    if (!activeScrollBand) {{
      activeScrollBand = band;
      scrollBandStartedAt = now;
      return band;
    }}
    if (band !== activeScrollBand) {{
      scrollBandDurations[activeScrollBand] = (scrollBandDurations[activeScrollBand] || 0) + Math.max(0, now - scrollBandStartedAt);
      activeScrollBand = band;
      scrollBandStartedAt = now;
    }}
    return band;
  }}

  function currentScrollBandDurations() {{
    updateScrollBandTime();
    var durations = Object.assign({{}}, scrollBandDurations);
    if (activeScrollBand) {{
      durations[activeScrollBand] = (durations[activeScrollBand] || 0) + Math.max(0, Date.now() - scrollBandStartedAt);
    }}
    return durations;
  }}

  function sectionLabel(node) {{
    if (!node || !node.getAttribute) return '';
    var trackId = node.getAttribute('data-redstone-track-id');
    if (trackId) return 'track:' + cleanText(trackId, 80);
    var id = node.id ? safeSelectorValue(node.id) : '';
    if (id) return '#' + id;
    var role = node.getAttribute('role');
    if (role) return String(node.tagName || '').toLowerCase() + '[role="' + safeSelectorValue(role) + '"]';
    var heading = node.querySelector && node.querySelector('h1, h2, h3');
    if (heading) return String(heading.tagName || '').toLowerCase() + ':' + cleanText(heading.textContent, 80);
    var classes = node.classList && node.classList.length
      ? Array.prototype.slice.call(node.classList).map(safeSelectorValue).filter(Boolean).slice(0, 2).join('.')
      : '';
    return String(node.tagName || 'section').toLowerCase() + (classes ? '.' + classes : '');
  }}

  function visibleSections() {{
    var viewportHeight = Math.max(1, window.innerHeight || 1);
    return Array.prototype.slice.call(document.querySelectorAll('[data-redstone-track-id], main, section, article, header, footer, nav, [role="main"], [role="region"]'), 0, 80)
      .filter(function(node) {{
        if (!isVisibleElement(node) || isSensitiveElement(node) || !node.getBoundingClientRect) return false;
        var rect = node.getBoundingClientRect();
        return rect.height > 40 && rect.bottom > 0 && rect.top < viewportHeight;
      }})
      .slice(0, 8)
      .map(function(node) {{
        var rect = node.getBoundingClientRect();
        var visiblePx = Math.max(0, Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0));
        return {{
          label: sectionLabel(node).slice(0, 120),
          visiblePct: Math.min(1, visiblePx / Math.max(1, Math.min(rect.height, viewportHeight))),
          topPct: (rect.top + window.scrollY) / Math.max(1, docSize().documentHeight)
        }};
      }})
      .filter(function(item) {{ return item.label && item.visiblePct > 0.05; }});
  }}

  function nearestSectionLabel(target) {{
    var node = target && target.nodeType === 1 ? target : target && target.parentElement;
    var selector = '[data-redstone-track-id], main, section, article, header, footer, nav, [role="main"], [role="region"]';
    while (node && node !== document.body && node !== document.documentElement) {{
      if (node.matches && node.matches(selector) && !isSensitiveElement(node)) return sectionLabel(node).slice(0, 120);
      node = node.parentElement;
    }}
    var visible = visibleSections()[0];
    return visible && visible.label ? visible.label : '';
  }}

  function updateSectionExposure() {{
    var now = Date.now();
    var delta = Math.max(0, now - lastSectionExposureAt);
    lastSectionExposureAt = now;
    visibleSections().forEach(function(section) {{
      var current = sectionExposure[section.label] || {{ label: section.label, visibleMs: 0, maxVisiblePct: 0, topPct: section.topPct }};
      current.visibleMs += Math.round(delta * section.visiblePct);
      current.maxVisiblePct = Math.max(current.maxVisiblePct || 0, section.visiblePct);
      current.topPct = section.topPct;
      sectionExposure[section.label] = current;
    }});
  }}

  function sectionExposureSnapshot() {{
    updateSectionExposure();
    return Object.keys(sectionExposure).map(function(key) {{ return sectionExposure[key]; }})
      .sort(function(a, b) {{ return (b.visibleMs || 0) - (a.visibleMs || 0); }})
      .slice(0, 20);
  }}

  function scrollPayload(extra) {{
    var depth = scrollDepth();
    return Object.assign({{
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      scrollDepthPct: depth,
      scrollBand: updateScrollBandTime(),
      scrollBandDurations: currentScrollBandDurations(),
      visibleSections: visibleSections(),
      sectionExposure: sectionExposureSnapshot()
    }}, extra || {{}});
  }}

  function resetPageState(reason) {{
    startedAt = Date.now();
    pageSent = false;
    firstInteractionSent = false;
    firstMeaningfulScrollSent = false;
    reachedScrollMilestones = {{}};
    scrollBandDurations = {{}};
    sectionExposure = {{}};
    lastSectionExposureAt = Date.now();
    activeScrollBand = scrollBandForDepth(scrollDepth());
    scrollBandStartedAt = Date.now();
    lastDwellKey = '';
    lastPointer = null;
    updateSectionExposure();
    enqueue('pageview', scrollPayload({{ scrollMilestone: 0, routeChangeReason: reason || 'route_change' }}));
    enqueue('tracker_diagnostic', {{
      stage: 'route_change',
      routeChangeReason: reason || 'route_change',
      path: routePath(),
      canonicalPath: canonicalPath(),
      url: location.href,
      changedAt: new Date().toISOString()
    }});
  }}

  function handleRouteChange(reason) {{
    if (routeChangeTimer) window.clearTimeout(routeChangeTimer);
    routeChangeTimer = window.setTimeout(function() {{
      var nextRouteKey = routeKey();
      if (nextRouteKey === currentRouteKey) return;
      currentRouteKey = nextRouteKey;
      resetPageState(reason);
    }}, 250);
  }}

  function beforeVirtualRouteLeave(reason) {{
    enqueue('page_duration', Object.assign({{
      engagementMs: Date.now() - startedAt,
      abandonmentDepthPct: scrollDepth(),
      routeChangeReason: reason || 'route_change',
      virtualRouteEnd: true
    }}, scrollPayload({{ finalScrollEvent: true }})));
    flush();
  }}

  function installHistoryListener() {{
    if (!window.history || window.history.__redstoneTrackerPatched) return;
    var originalPushState = history.pushState;
    var originalReplaceState = history.replaceState;
    history.pushState = function() {{
      if (routeKeyFromUrl(arguments[2]) !== currentRouteKey) beforeVirtualRouteLeave('pushState');
      var result = originalPushState.apply(this, arguments);
      handleRouteChange('pushState');
      return result;
    }};
    history.replaceState = function() {{
      if (routeKeyFromUrl(arguments[2]) !== currentRouteKey) beforeVirtualRouteLeave('replaceState');
      var result = originalReplaceState.apply(this, arguments);
      handleRouteChange('replaceState');
      return result;
    }};
    window.addEventListener('popstate', function() {{ handleRouteChange('popstate'); }});
    window.addEventListener('hashchange', function() {{ handleRouteChange('hashchange'); }});
    history.__redstoneTrackerPatched = true;
  }}

  function enqueue(type, data) {{
    queue.push({{ type: type, occurredAt: new Date().toISOString(), data: Object.assign(common(), data || {{}}) }});
    status.eventsQueued += 1;
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
      var queuedCount = events.length;
      var beaconAccepted = navigator.sendBeacon(COLLECTOR_URL, new Blob([payload], {{ type: 'application/json' }}));
      status.lastCollectStatus = beaconAccepted ? 'beacon_queued' : 'beacon_rejected';
      status.lastCollectAt = new Date().toISOString();
      if (beaconAccepted) status.eventsAccepted += queuedCount;
    }} else {{
      fetch(COLLECTOR_URL, {{ method: 'POST', headers: {{ 'Content-Type': 'application/json' }}, body: payload, keepalive: true }})
        .then(function(response) {{
          status.lastCollectStatus = response.ok ? 'ok' : 'http_' + response.status;
          status.lastCollectAt = new Date().toISOString();
          return response.json ? response.json().catch(function() {{ return null; }}) : null;
        }})
        .then(function(result) {{
          if (result && typeof result.accepted === 'number') status.eventsAccepted += result.accepted;
        }})
        .catch(function() {{
          status.lastCollectStatus = 'fetch_error';
          status.lastCollectAt = new Date().toISOString();
        }});
    }}
  }}

  currentRouteKey = routeKey();
  installHistoryListener();
  activeScrollBand = scrollBandForDepth(scrollDepth());
  updateSectionExposure();
  enqueue('pageview', scrollPayload({{ scrollMilestone: 0 }}));
  enqueue('tracker_diagnostic', {{
    stage: 'loaded',
    sampleAccepted: true,
    consentAllowed: true,
    featureFlags: FEATURE_FLAGS,
    screenshotCaptureFrequency: SCREENSHOT_CAPTURE_FREQUENCY,
    loadedAt: new Date().toISOString()
  }});
  document.addEventListener('click', function(e) {{
    if (isSensitiveElement(e.target)) return;
    markFirstInteraction('click', e.target);
    var meta = targetMeta(e.target);
    var point = Object.assign(pointerPayload(e), meta);
    enqueue('click', point);
    if (meta.isCta) enqueue('cta_click', point);
  }}, true);

  function handlePointerMove(e, eventType) {{
    if (isSensitiveElement(e.target)) return;
    var now = Date.now();
    if (now - lastMove < MOVE_THROTTLE_MS) return;
    lastMove = now;
    var meta = targetMeta(e.target);
    var section = nearestSectionLabel(e.target);
    var point = Object.assign(pointerPayload(e), meta, {{ sectionLabel: section }});
    lastPointer = {{ x: point.x, y: point.y, pageX: point.pageX, pageY: point.pageY, pointerType: point.pointerType, at: now, meta: meta, sectionLabel: section }};
    lastDwellKey = '';
    enqueue(eventType, point);
  }}
  if (window.PointerEvent) {{
    document.addEventListener('pointermove', function(e) {{ handlePointerMove(e, 'pointermove'); }}, {{ passive: true }});
    document.addEventListener('pointerdown', function(e) {{
      if (isSensitiveElement(e.target)) return;
      markFirstInteraction('pointerdown', e.target);
      var point = Object.assign(pointerPayload(e), targetMeta(e.target));
      lastPointer = {{ x: point.x, y: point.y, pageX: point.pageX, pageY: point.pageY, pointerType: point.pointerType, at: Date.now() }};
      if (e.pointerType && e.pointerType !== 'mouse') enqueue('pointerdown', point);
    }}, {{ passive: true }});
  }} else {{
    document.addEventListener('mousemove', function(e) {{ handlePointerMove(e, 'mousemove'); }}, {{ passive: true }});
    document.addEventListener('touchstart', function(e) {{
      var touch = e.changedTouches && e.changedTouches[0];
      if (!touch || isSensitiveElement(e.target)) return;
      markFirstInteraction('touchstart', e.target);
      var synthetic = {{
        clientX: touch.clientX,
        clientY: touch.clientY,
        pageX: touch.pageX,
        pageY: touch.pageY,
        pointerType: 'touch',
        isPrimary: true
      }};
      enqueue('touchstart', Object.assign(pointerPayload(synthetic), targetMeta(e.target)));
    }}, {{ passive: true }});
  }}
  window.addEventListener('scroll', function() {{
    var now = Date.now();
    if (now - lastScroll < 1000) return;
    lastScroll = now;
    markFirstInteraction('scroll', document.documentElement);
    var depth = scrollDepth();
    var payload = scrollPayload();
    if (!firstMeaningfulScrollSent && (window.scrollY || 0) > Math.max(120, (window.innerHeight || 0) * 0.2)) {{
      firstMeaningfulScrollSent = true;
      enqueue('scroll', Object.assign({{ firstMeaningfulScroll: true, firstMeaningfulScrollMs: now - startedAt }}, payload));
    }}
    SCROLL_MILESTONES.forEach(function(milestone) {{
      if (depth >= milestone && !reachedScrollMilestones[String(milestone)]) {{
        reachedScrollMilestones[String(milestone)] = true;
        enqueue('scroll', Object.assign({{ scrollMilestone: milestone }}, payload));
      }}
    }});
    enqueue('scroll', payload);
  }}, {{ passive: true }});
  function enqueueViewport(reason) {{
    enqueue('viewport', Object.assign({{
      reason: reason || 'resize',
      orientation: window.screen && window.screen.orientation ? window.screen.orientation.type : '',
      scrollDepthPct: scrollDepth(),
      scrollBand: updateScrollBandTime()
    }}, docSize()));
  }}
  window.addEventListener('resize', function() {{ enqueueViewport('resize'); }}, {{ passive: true }});
  window.addEventListener('orientationchange', function() {{ enqueueViewport('orientationchange'); }}, {{ passive: true }});
  window.setInterval(function() {{
    if (!lastPointer) return;
    var now = Date.now();
    if (now - lastPointer.at < DWELL_MS || now - lastDwell < DWELL_MS) return;
    var dwellKey = [Math.round(lastPointer.pageX / 12), Math.round(lastPointer.pageY / 12), lastPointer.pointerType || ''].join(':');
    if (dwellKey === lastDwellKey) return;
    lastDwellKey = dwellKey;
    lastDwell = now;
    var size = docSize();
    enqueue('engagement', Object.assign({{
      x: lastPointer.x,
      y: lastPointer.y,
      pageX: lastPointer.pageX,
      pageY: lastPointer.pageY,
      viewportXPct: lastPointer.x / Math.max(1, window.innerWidth || 1),
      viewportYPct: lastPointer.y / Math.max(1, window.innerHeight || 1),
      xPct: lastPointer.pageX / Math.max(1, size.documentWidth),
      yPct: lastPointer.pageY / Math.max(1, size.documentHeight),
      sectionLabel: lastPointer.sectionLabel || '',
      engagementMs: Math.min(DWELL_MS, now - lastPointer.at)
    }}, lastPointer.meta || {{}}));
  }}, DWELL_MS);
  window.addEventListener('visibilitychange', function() {{
    if (document.visibilityState === 'hidden') {{
      enqueue('visibility', {{ state: 'hidden' }});
      enqueue('scroll', scrollPayload({{ abandonmentDepthPct: scrollDepth(), finalScrollEvent: true }}));
      enqueue('tracker_diagnostic', {{ stage: 'hidden_flush', lastCollectStatus: status.lastCollectStatus, eventsQueued: status.eventsQueued, eventsAccepted: status.eventsAccepted }});
      flush();
    }}
  }});
  window.addEventListener('pagehide', function() {{
    enqueue('page_duration', Object.assign({{ engagementMs: Date.now() - startedAt, abandonmentDepthPct: scrollDepth() }}, scrollPayload({{ finalScrollEvent: true }})));
    enqueue('tracker_diagnostic', {{ stage: 'pagehide_flush', lastCollectStatus: status.lastCollectStatus, eventsQueued: status.eventsQueued, eventsAccepted: status.eventsAccepted }});
    flush();
  }});
  window.setInterval(flush, FLUSH_MS);
}})();
"""
