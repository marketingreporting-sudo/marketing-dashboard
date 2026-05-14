from typing import Any

from urllib.error import HTTPError, URLError

from render_supabase_sync_state import _fetch_json
from render_supabase_validation import SupabaseValidationConfigError


ANALYTICS_SNAPSHOT_TYPES = {
    "ga4": "ga4_dashboard",
    "google_ads": "google_ads_dashboard",
    "meta_ads": "meta_ads_dashboard",
    "local_falcon": "local_falcon_dashboard",
    "reputation": "reputation_dashboard",
}


def get_cached_analytics_payload(property_id: str, analytics_kind: str) -> dict[str, Any]:
    snapshot_type = ANALYTICS_SNAPSHOT_TYPES[analytics_kind]
    rows = _fetch_json(
        "property_analytics_snapshots",
        [
            ("select", "property_id,snapshot_type,fetched_at,payload"),
            ("property_id", f"eq.{property_id}"),
            ("snapshot_type", f"eq.{snapshot_type}"),
            ("limit", "1"),
        ],
    )

    if not rows:
        raise LookupError(f"No cached {analytics_kind} snapshot found for property_id={property_id}.")

    row = rows[0]
    payload = row.get("payload") or {}
    if isinstance(payload, dict) and "fetchedAt" not in payload and row.get("fetched_at"):
        payload = {**payload, "fetchedAt": row["fetched_at"]}
    return payload


def get_cached_analytics_summary(property_id: str, analytics_kind: str) -> dict[str, Any]:
    try:
        payload = get_cached_analytics_payload(property_id, analytics_kind)
    except LookupError as error:
        return {
            "status": "error",
            "error": str(error),
            "staging_only": True,
        }
    except (HTTPError, URLError, SupabaseValidationConfigError) as error:
        return {
            "status": "error",
            "error": str(error),
            "staging_only": True,
        }

    payload["source"] = "supabase"
    payload["staging_only"] = True
    return payload
