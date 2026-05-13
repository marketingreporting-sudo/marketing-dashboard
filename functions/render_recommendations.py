from __future__ import annotations

import json
import os
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any
from urllib.request import Request, urlopen

from openai import OpenAI

from render_supabase_analytics import get_cached_analytics_summary
from render_supabase_heatmaps import get_heatmap_summary, get_site_audit_summary
from render_supabase_reporting import get_property_reporting_overview_summary
from render_supabase_sync_state import _fetch_json, _table_query_url
from render_supabase_validation import _supabase_headers


RECOMMENDATIONS_MODEL = os.environ.get("OPENAI_RECOMMENDATIONS_MODEL", "gpt-4o-mini")
RECOMMENDATIONS_PROMPT_VERSION = "recommendations-v2-learning-loop"


def _to_number(value: Any) -> float:
    if isinstance(value, bool) or value is None:
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        normalized = value.replace("$", "").replace(",", "").replace("%", "").strip()
        try:
            return float(normalized)
        except ValueError:
            return 0.0
    return 0.0


def _sum_nested(items: list[dict[str, Any]], key: str) -> float:
    return sum(_to_number((item.get("totals") or {}).get(key)) for item in items)


def _safe_slice(items: Any, limit: int = 5) -> list[Any]:
    return items[:limit] if isinstance(items, list) else []


def _normalize_signature(value: Any) -> str:
    return " ".join(
        "".join(char.lower() if char.isalnum() else " " for char in str(value or "")).split()
    )


def _compact_reporting_context(payload: dict[str, Any]) -> dict[str, Any]:
    lead_items = payload.get("lead_items") if isinstance(payload.get("lead_items"), list) else []
    event_items = payload.get("event_items") if isinstance(payload.get("event_items"), list) else []
    lease_items = payload.get("lease_items") if isinstance(payload.get("lease_items"), list) else []
    invoice_items = payload.get("invoice_items") if isinstance(payload.get("invoice_items"), list) else []
    roi_daily_items = payload.get("roi_daily_items") if isinstance(payload.get("roi_daily_items"), list) else []
    availability = payload.get("availability_pricing_snapshot") if isinstance(payload.get("availability_pricing_snapshot"), dict) else {}
    specials = payload.get("specials_snapshot") if isinstance(payload.get("specials_snapshot"), dict) else {}

    source_totals: dict[str, dict[str, float | str]] = {}
    for item in roi_daily_items:
        for metric in item.get("source_metrics") or []:
            if not isinstance(metric, dict):
                continue
            source_key = str(metric.get("source_key") or metric.get("source_label") or "other")
            current = source_totals.setdefault(
                source_key,
                {
                    "sourceLabel": str(metric.get("source_label") or source_key),
                    "leases": 0.0,
                    "netEffectiveRevenue": 0.0,
                    "marketingSpend": 0.0,
                },
            )
            current["leases"] = _to_number(current["leases"]) + _to_number(metric.get("attributed_leases"))
            current["netEffectiveRevenue"] = _to_number(current["netEffectiveRevenue"]) + _to_number(metric.get("net_effective_revenue"))
            current["marketingSpend"] = _to_number(current["marketingSpend"]) + _to_number(metric.get("marketing_spend"))

    top_sources = sorted(
        (
            {
                **value,
                "roas": (
                    _to_number(value["netEffectiveRevenue"]) / _to_number(value["marketingSpend"])
                    if _to_number(value["marketingSpend"]) > 0
                    else None
                ),
            }
            for value in source_totals.values()
        ),
        key=lambda item: _to_number(item.get("netEffectiveRevenue")),
        reverse=True,
    )[:8]

    return {
        "status": payload.get("status"),
        "range": payload.get("range") or {},
        "counts": {
            "leads": len(lead_items),
            "events": len(event_items),
            "leases": len(lease_items),
            "invoices": len(invoice_items),
            "roiDailyRows": len(roi_daily_items),
        },
        "roi": {
            "attributedLeases": _sum_nested(roi_daily_items, "attributed_leases"),
            "unattributedLeases": _sum_nested(roi_daily_items, "unattributed_leases"),
            "grossLeaseValue": _sum_nested(roi_daily_items, "gross_lease_value"),
            "netEffectiveRevenue": _sum_nested(roi_daily_items, "net_effective_revenue"),
            "marketingSpend": _sum_nested(roi_daily_items, "marketing_spend"),
            "performanceMarketingSpend": _sum_nested(roi_daily_items, "performance_marketing_spend"),
            "topSources": top_sources,
        },
        "availability": {
            "floorplanCount": availability.get("floorplan_count") or availability.get("floorplanCount"),
            "unitCount": availability.get("unit_count") or availability.get("unitCount"),
            "lastSyncedAt": availability.get("last_synced_at") or payload.get("latest_availability_date"),
        },
        "specials": {
            "specialCount": specials.get("special_count") or len(specials.get("specials") or []),
            "lastSyncedAt": specials.get("last_synced_at"),
            "sample": _safe_slice(specials.get("specials"), 3),
        },
    }


def _compact_analytics_context(payload: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(payload, dict) or payload.get("status") == "error":
        return {"status": "unavailable", "error": payload.get("error") if isinstance(payload, dict) else "No payload"}
    return {
        "fetchedAt": payload.get("fetchedAt"),
        "overview": payload.get("Overview"),
        "coverage": payload.get("Coverage"),
        "topCampaigns": _safe_slice(payload.get("Campaigns"), 6),
        "topKeywords": _safe_slice(payload.get("Keywords"), 6),
        "topAds": _safe_slice((payload.get("Ads") or {}).get("topAds"), 4),
        "topPages": _safe_slice(payload.get("Pages") or payload.get("LandingPages"), 6),
        "events": payload.get("Events"),
        "attribution": payload.get("Attribution"),
        "scoping": payload.get("Scoping"),
    }


def _compact_heatmap_context(payload: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(payload, dict) or payload.get("status") == "error":
        return {"status": "unavailable", "error": payload.get("error") if isinstance(payload, dict) else "No payload"}
    return {
        "range": payload.get("range"),
        "totals": payload.get("totals"),
        "topPaths": _safe_slice(payload.get("topPaths") or payload.get("paths"), 8),
        "topTargets": _safe_slice(payload.get("topTargets") or payload.get("targets"), 8),
        "scroll": payload.get("scroll"),
        "anomalies": payload.get("anomalies"),
    }


def _compact_audit_context(payload: dict[str, Any]) -> dict[str, Any]:
    audit = payload.get("audit") if isinstance(payload.get("audit"), dict) else None
    if not audit:
        return {"status": "unavailable", "error": "No completed site audit found."}
    return {
        "auditedAt": audit.get("audited_at"),
        "status": audit.get("status"),
        "pageCount": audit.get("page_count"),
        "scores": {
            "performance": audit.get("performance_score"),
            "urgency": audit.get("urgency_score"),
            "freshness": audit.get("freshness_score"),
            "links": audit.get("link_score"),
        },
        "summary": audit.get("summary"),
        "issues": _safe_slice(audit.get("issues"), 12),
        "recommendations": _safe_slice(audit.get("recommendations"), 12),
        "brokenLinks": _safe_slice(audit.get("broken_links"), 8),
        "staleDateFindings": _safe_slice(audit.get("stale_date_findings"), 8),
        "performanceNotes": _safe_slice(audit.get("performance_notes"), 8),
    }


def _safe_optional_context(loader, label: str) -> dict[str, Any]:
    try:
        payload = loader()
        return payload if isinstance(payload, dict) else {"status": "unavailable", "error": f"{label} returned no payload."}
    except Exception as error:
        return {"status": "unavailable", "error": f"{label} failed to load: {error}"}


def _build_recommendation_context(
    *,
    property_id: str,
    property_name: str | None,
    start_date_value: str | None,
    end_date_value: str | None,
    site_key: str | None,
    access_token: str | None,
) -> dict[str, Any]:
    reporting = get_property_reporting_overview_summary(
        property_id,
        start_date_value=start_date_value,
        end_date_value=end_date_value,
        access_token=access_token,
    )
    ga4 = _safe_optional_context(lambda: get_cached_analytics_summary(property_id, "ga4"), "GA4 context")
    google_ads = _safe_optional_context(lambda: get_cached_analytics_summary(property_id, "google_ads"), "Google Ads context")
    meta_ads = _safe_optional_context(lambda: get_cached_analytics_summary(property_id, "meta_ads"), "Meta Ads context")
    reputation = _safe_optional_context(lambda: get_cached_analytics_summary(property_id, "reputation"), "Reputation context")
    heatmap = _safe_optional_context(
        lambda: get_heatmap_summary(
            property_id,
            start_date_value=start_date_value,
            end_date_value=end_date_value,
            site_key=site_key,
            access_token=access_token,
        ),
        "Heatmap context",
    )
    audit = _safe_optional_context(
        lambda: get_site_audit_summary(property_id, site_key=site_key, access_token=access_token),
        "Site audit context",
    )

    return {
        "property": {
            "propertyId": property_id,
            "propertyName": property_name or "",
        },
        "requestedRange": {
            "startDate": start_date_value,
            "endDate": end_date_value,
        },
        "reporting": _compact_reporting_context(reporting),
        "analytics": {
            "ga4": _compact_analytics_context(ga4),
            "googleAds": _compact_analytics_context(google_ads),
            "metaAds": _compact_analytics_context(meta_ads),
            "reputation": _compact_analytics_context(reputation),
        },
        "website": {
            "heatmap": _compact_heatmap_context(heatmap),
            "siteAudit": _compact_audit_context(audit),
        },
    }


def _parse_recommendations_response(content: str) -> dict[str, Any]:
    try:
        parsed = json.loads(content)
    except json.JSONDecodeError as error:
        raise ValueError("OpenAI returned a non-JSON recommendations response.") from error

    recommendations = parsed.get("recommendations")
    if not isinstance(recommendations, list):
        raise ValueError("OpenAI response did not include a recommendations array.")

    normalized_recommendations = []
    for index, item in enumerate(recommendations[:8]):
        if not isinstance(item, dict):
            continue
        normalized_recommendations.append({
            "id": str(item.get("id") or f"recommendation-{index + 1}"),
            "title": str(item.get("title") or "Untitled recommendation"),
            "priority": str(item.get("priority") or "medium").lower(),
            "category": str(item.get("category") or "general").lower(),
            "reasoning": str(item.get("reasoning") or ""),
            "suggestedAction": str(item.get("suggestedAction") or item.get("suggested_action") or ""),
            "expectedImpact": str(item.get("expectedImpact") or item.get("expected_impact") or ""),
            "confidence": _to_number(item.get("confidence")),
            "evidence": [str(value) for value in item.get("evidence") or [] if value],
            "sourceAreas": [str(value) for value in item.get("sourceAreas") or item.get("source_areas") or [] if value],
        })

    return {
        "summary": str(parsed.get("summary") or ""),
        "recommendations": normalized_recommendations,
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
    request = Request(
        _table_query_url(table_name, query_params),
        headers=request_headers,
        data=json.dumps(payload).encode("utf-8") if payload is not None else None,
        method=method,
    )
    with urlopen(request, timeout=30) as response:
        body = response.read().decode("utf-8")
    if not body:
        return None
    return json.loads(body)


def _parse_date(value: str | None) -> str | None:
    if not value:
        return None
    return str(value)[:10]


def _parse_iso_date(value: Any) -> date | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value)[:10]).date()
    except ValueError:
        return None


def _today_iso() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def _recommendation_payload(row: dict[str, Any]) -> dict[str, Any]:
    payload = row.get("recommendation_payload")
    return payload if isinstance(payload, dict) else {}


def _shape_learning_example(row: dict[str, Any]) -> dict[str, Any]:
    payload = _recommendation_payload(row)
    feedback_notes = row.get("_feedback_notes") if isinstance(row.get("_feedback_notes"), list) else []
    feedback_tags = row.get("_feedback_tags") if isinstance(row.get("_feedback_tags"), list) else []
    return {
        "title": str(row.get("title") or payload.get("title") or ""),
        "category": str(row.get("category") or payload.get("category") or "general"),
        "priority": str(row.get("priority") or payload.get("priority") or "medium"),
        "suggestedAction": str(payload.get("suggestedAction") or ""),
        "reasoning": str(payload.get("reasoning") or ""),
        "expectedImpact": str(payload.get("expectedImpact") or ""),
        "evidence": _safe_slice(payload.get("evidence"), 3),
        "status": str(row.get("status") or "new"),
        "latestFeedbackType": row.get("latest_feedback_type"),
        "usefulCount": int(row.get("useful_count") or 0),
        "notUsefulCount": int(row.get("not_useful_count") or 0),
        "feedbackNotes": feedback_notes[:3],
        "feedbackTags": feedback_tags[:8],
    }


def _shape_feedback(row: dict[str, Any]) -> dict[str, Any]:
    payload = row.get("feedback_payload") if isinstance(row.get("feedback_payload"), dict) else {}
    tags = payload.get("tags") if isinstance(payload.get("tags"), list) else []
    return {
        "id": row.get("id"),
        "feedbackType": row.get("feedback_type"),
        "isUseful": row.get("is_useful"),
        "notes": row.get("notes") or "",
        "tags": [str(tag) for tag in tags if tag],
        "createdAt": row.get("created_at"),
    }


def _is_positive_learning_row(row: dict[str, Any]) -> bool:
    return (
        row.get("status") == "approved"
        or str(row.get("latest_feedback_type") or "") == "useful"
        or int(row.get("useful_count") or 0) > 0
    )


def _is_negative_learning_row(row: dict[str, Any]) -> bool:
    return (
        row.get("status") == "dismissed"
        or str(row.get("latest_feedback_type") or "") in {"dismiss", "not_useful"}
        or int(row.get("not_useful_count") or 0) > 0
    )


def _fetch_learning_context(property_id: str) -> dict[str, Any]:
    rows = _fetch_json(
        "ai_recommendations",
        [
            (
                "select",
                "id,property_id,prompt_version,model,source_context_summary,generation_summary,"
                "recommendation_payload,title,priority,category,status,latest_feedback_type,"
                "useful_count,not_useful_count,created_at",
            ),
            ("order", "created_at.desc"),
            ("limit", "240"),
        ],
        headers=_supabase_headers(),
    )
    recommendation_ids = [str(row.get("id")) for row in rows if row.get("id")]
    feedback_by_recommendation: dict[str, list[dict[str, Any]]] = {}
    if recommendation_ids:
        feedback_rows = _fetch_json(
            "ai_recommendation_feedback",
            [
                ("select", "id,recommendation_id,feedback_type,notes,feedback_payload,created_at"),
                ("recommendation_id", f"in.({','.join(recommendation_ids)})"),
                ("order", "created_at.desc"),
                ("limit", "500"),
            ],
            headers=_supabase_headers(),
        )
        for feedback in feedback_rows:
            feedback_by_recommendation.setdefault(str(feedback.get("recommendation_id")), []).append(feedback)
        for row in rows:
            feedback_items = feedback_by_recommendation.get(str(row.get("id")), [])
            notes = [str(item.get("notes") or "").strip() for item in feedback_items if str(item.get("notes") or "").strip()]
            tags = []
            for item in feedback_items:
                payload = item.get("feedback_payload") if isinstance(item.get("feedback_payload"), dict) else {}
                tags.extend([str(tag) for tag in payload.get("tags") or [] if tag])
            row["_feedback_notes"] = notes
            row["_feedback_tags"] = sorted(set(tags))
    property_rows = [row for row in rows if str(row.get("property_id") or "") == str(property_id)]
    portfolio_rows = [row for row in rows if str(row.get("property_id") or "") != str(property_id)]

    positive_rows = [row for row in [*property_rows, *portfolio_rows] if _is_positive_learning_row(row)]
    negative_rows = [row for row in [*property_rows, *portfolio_rows] if _is_negative_learning_row(row)]
    recent_rows = [row for row in property_rows if row.get("status") != "dismissed"]

    positive_examples = [_shape_learning_example(row) for row in positive_rows[:10]]
    suppressed_examples = [_shape_learning_example(row) for row in negative_rows[:10]]
    recent_titles = [
        str(row.get("title") or _recommendation_payload(row).get("title") or "")
        for row in recent_rows[:20]
        if row.get("title") or _recommendation_payload(row).get("title")
    ]

    return {
        "promptVersion": RECOMMENDATIONS_PROMPT_VERSION,
        "positiveExampleCount": len(positive_rows),
        "negativeExampleCount": len(negative_rows),
        "propertySpecificExampleCount": len(property_rows),
        "positiveExamples": positive_examples,
        "suppressedExamples": suppressed_examples,
        "recentRecommendationTitles": recent_titles,
        "suppressedTitleSignatures": [
            _normalize_signature(example.get("title"))
            for example in suppressed_examples
            if example.get("title")
        ],
        "recentTitleSignatures": [
            _normalize_signature(title)
            for title in recent_titles
            if title
        ],
    }


def _empty_learning_context(error: str | None = None) -> dict[str, Any]:
    return {
        "promptVersion": RECOMMENDATIONS_PROMPT_VERSION,
        "positiveExampleCount": 0,
        "negativeExampleCount": 0,
        "propertySpecificExampleCount": 0,
        "positiveExamples": [],
        "suppressedExamples": [],
        "recentRecommendationTitles": [],
        "suppressedTitleSignatures": [],
        "recentTitleSignatures": [],
        "error": error,
    }


def _safe_learning_context(property_id: str) -> dict[str, Any]:
    try:
        return _fetch_learning_context(property_id)
    except Exception as error:
        return _empty_learning_context(str(error))


def _apply_learning_suppression(
    recommendations: list[dict[str, Any]],
    learning_context: dict[str, Any],
) -> list[dict[str, Any]]:
    suppressed = set(learning_context.get("suppressedTitleSignatures") or [])
    recent = set(learning_context.get("recentTitleSignatures") or [])
    filtered = []
    for item in recommendations:
        signature = _normalize_signature(item.get("title"))
        if signature and (signature in suppressed or signature in recent):
            continue
        filtered.append(item)
    return filtered or recommendations


def _persist_recommendations(
    *,
    property_id: str,
    user_id: str | None,
    model: str,
    date_range: dict[str, Any],
    context_summary: dict[str, Any],
    context_snapshot: dict[str, Any],
    generation_summary: str,
    recommendations: list[dict[str, Any]],
) -> tuple[str, list[dict[str, Any]]]:
    if not recommendations:
        return str(uuid.uuid4()), []

    generation_id = str(uuid.uuid4())
    rows = []
    for item in recommendations:
        rows.append({
            "generation_id": generation_id,
            "property_id": property_id,
            "generated_by_user_id": user_id,
            "prompt_version": RECOMMENDATIONS_PROMPT_VERSION,
            "model": model,
            "date_range_start": _parse_date(date_range.get("startDate")),
            "date_range_end": _parse_date(date_range.get("endDate")),
            "source_context_summary": context_summary,
            "source_context_snapshot": context_snapshot,
            "generation_summary": generation_summary,
            "recommendation_payload": item,
            "title": item.get("title") or "Untitled recommendation",
            "priority": item.get("priority") if item.get("priority") in {"high", "medium", "low"} else "medium",
            "category": item.get("category") or "general",
        })

    saved_rows = _json_request(
        "ai_recommendations",
        [("select", "*")],
        method="POST",
        payload=rows,
        headers={**_supabase_headers(), "Prefer": "return=representation"},
    )
    stored_recommendations = []
    saved_list = saved_rows if isinstance(saved_rows, list) else []
    for index, item in enumerate(recommendations):
        saved = saved_list[index] if index < len(saved_list) and isinstance(saved_list[index], dict) else {}
        stored_recommendations.append({
            **item,
            "storedRecommendationId": saved.get("id"),
            "generationId": saved.get("generation_id") or generation_id,
            "status": saved.get("status") or "new",
            "taskId": saved.get("task_id"),
            "implementationStatus": saved.get("implementation_status") or "not_started",
            "implementationReview": saved.get("implementation_review_payload") or {},
            "createdAt": saved.get("created_at"),
            "feedbackHistory": [],
        })

    return generation_id, stored_recommendations


def _fetch_recommendation(recommendation_id: str) -> dict[str, Any]:
    rows = _fetch_json(
        "ai_recommendations",
        [
            ("select", "*"),
            ("id", f"eq.{recommendation_id}"),
            ("limit", "1"),
        ],
        headers=_supabase_headers(),
    )
    if not rows:
        raise LookupError("Recommendation was not found.")
    return rows[0]


def _patch_recommendation(recommendation_id: str, patch: dict[str, Any]) -> dict[str, Any]:
    rows = _json_request(
        "ai_recommendations",
        [
            ("id", f"eq.{recommendation_id}"),
            ("select", "*"),
        ],
        method="PATCH",
        payload=patch,
        headers={**_supabase_headers(), "Prefer": "return=representation"},
    )
    return rows[0] if isinstance(rows, list) and rows else patch


def _shape_task(row: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(row, dict):
        return None
    return {
        "id": row.get("id"),
        "propertyId": row.get("property_id"),
        "title": row.get("title"),
        "description": row.get("description"),
        "notes": row.get("notes"),
        "dueDate": row.get("due_date"),
        "status": row.get("status"),
        "createdAt": row.get("created_at"),
        "updatedAt": row.get("updated_at"),
    }


def create_recommendation_task_summary(
    *,
    recommendation_id: str,
    expected_property_id: str,
    user_id: str,
) -> dict[str, Any]:
    recommendation = _fetch_recommendation(recommendation_id)
    property_id = str(recommendation.get("property_id") or "")
    if property_id != str(expected_property_id):
        raise PermissionError("Recommendation does not belong to this property.")

    existing_task_id = recommendation.get("task_id")
    if existing_task_id:
        rows = _fetch_json(
            "user_tasks",
            [
                ("select", "*"),
                ("id", f"eq.{existing_task_id}"),
                ("limit", "1"),
            ],
            headers=_supabase_headers(),
        )
        if rows:
            return {
                "status": "ok",
                "task": _shape_task(rows[0]),
                "recommendation": {
                    "id": recommendation.get("id"),
                    "taskId": existing_task_id,
                    "implementationStatus": recommendation.get("implementation_status") or "task_created",
                },
                "staging_only": True,
            }

    payload = _recommendation_payload(recommendation)
    evidence = payload.get("evidence") if isinstance(payload.get("evidence"), list) else []
    task_description = "\n".join(
        line for line in [
            str(payload.get("suggestedAction") or ""),
            "",
            f"Why: {payload.get('reasoning')}" if payload.get("reasoning") else "",
            f"Expected impact: {payload.get('expectedImpact')}" if payload.get("expectedImpact") else "",
            "Evidence:\n" + "\n".join(f"- {item}" for item in evidence[:5]) if evidence else "",
        ]
        if line
    )
    task_rows = _json_request(
        "user_tasks",
        [("select", "*")],
        method="POST",
        payload={
            "owner_user_id": user_id,
            "property_id": property_id,
            "title": f"Implement: {recommendation.get('title') or payload.get('title') or 'AI recommendation'}",
            "description": task_description[:2000],
            "notes": f"Created from AI recommendation {recommendation_id}.",
            "status": "new",
            "recommendation_id": recommendation_id,
            "recommendation_snapshot": payload,
        },
        headers={**_supabase_headers(), "Prefer": "return=representation"},
    )
    task = task_rows[0] if isinstance(task_rows, list) and task_rows else {}
    updated = _patch_recommendation(
        recommendation_id,
        {
            "task_id": task.get("id"),
            "status": "approved",
            "implementation_status": "task_created",
            "latest_feedback_type": "approve",
        },
    )
    return {
        "status": "ok",
        "task": _shape_task(task),
        "recommendation": {
            "id": updated.get("id") or recommendation_id,
            "taskId": updated.get("task_id") or task.get("id"),
            "status": updated.get("status"),
            "latestFeedbackType": updated.get("latest_feedback_type"),
            "implementationStatus": updated.get("implementation_status"),
        },
        "staging_only": True,
    }


def record_recommendation_feedback_summary(
    *,
    recommendation_id: str,
    feedback_type: str,
    notes: str | None,
    user_id: str | None,
    tags: list[str] | None = None,
    expected_property_id: str | None = None,
) -> dict[str, Any]:
    normalized_feedback_type = str(feedback_type or "").strip().lower()
    if normalized_feedback_type not in {"approve", "dismiss", "useful", "not_useful"}:
        raise ValueError("feedback_type must be one of approve, dismiss, useful, or not_useful.")

    recommendation = _fetch_recommendation(recommendation_id)
    property_id = str(recommendation.get("property_id") or "")
    if expected_property_id and property_id != str(expected_property_id):
        raise PermissionError("Recommendation does not belong to this property.")
    normalized_tags = [str(tag).strip()[:80] for tag in (tags or []) if str(tag).strip()]
    feedback_row = {
        "recommendation_id": str(recommendation_id),
        "property_id": property_id,
        "user_id": user_id,
        "feedback_type": normalized_feedback_type,
        "is_useful": True if normalized_feedback_type == "useful" else False if normalized_feedback_type == "not_useful" else None,
        "notes": str(notes or "")[:2000],
        "feedback_payload": {"tags": normalized_tags},
    }
    saved_feedback = _json_request(
        "ai_recommendation_feedback",
        [("select", "*")],
        method="POST",
        payload=feedback_row,
        headers={**_supabase_headers(), "Prefer": "return=representation"},
    )
    feedback = saved_feedback[0] if isinstance(saved_feedback, list) and saved_feedback else feedback_row

    status_patch: dict[str, Any] = {"latest_feedback_type": normalized_feedback_type}
    if normalized_feedback_type == "approve":
        status_patch["status"] = "approved"
    elif normalized_feedback_type == "dismiss":
        status_patch["status"] = "dismissed"
    elif normalized_feedback_type == "useful":
        status_patch["useful_count"] = int(recommendation.get("useful_count") or 0) + 1
    elif normalized_feedback_type == "not_useful":
        status_patch["not_useful_count"] = int(recommendation.get("not_useful_count") or 0) + 1

    updated_recommendation = _patch_recommendation(recommendation_id, status_patch)

    return {
        "status": "ok",
        "feedback": feedback,
        "feedbackItem": _shape_feedback(feedback),
        "recommendation": {
            "id": updated_recommendation.get("id"),
            "property_id": updated_recommendation.get("property_id"),
            "status": updated_recommendation.get("status"),
            "latestFeedbackType": updated_recommendation.get("latest_feedback_type"),
            "usefulCount": updated_recommendation.get("useful_count"),
            "notUsefulCount": updated_recommendation.get("not_useful_count"),
        },
        "staging_only": True,
    }


def build_recommendations_training_export_summary(
    *,
    minimum_positive_examples: int = 25,
    limit: int = 500,
) -> dict[str, Any]:
    rows = _fetch_json(
        "ai_recommendations",
        [
            (
                "select",
                "id,property_id,prompt_version,model,source_context_summary,generation_summary,"
                "recommendation_payload,title,priority,category,status,latest_feedback_type,"
                "useful_count,not_useful_count,created_at",
            ),
            ("order", "created_at.desc"),
            ("limit", str(max(1, min(limit, 2000)))),
        ],
        headers=_supabase_headers(),
    )
    positive_rows = [row for row in rows if _is_positive_learning_row(row)]
    negative_rows = [row for row in rows if _is_negative_learning_row(row)]
    clean_rows = positive_rows[:limit]

    jsonl_lines = []
    for row in clean_rows:
        example = _shape_learning_example(row)
        context_summary = row.get("source_context_summary") if isinstance(row.get("source_context_summary"), dict) else {}
        training_record = {
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "You are a senior multifamily marketing and leasing analyst. "
                        "Return concise, practical recommendations grounded in the supplied context."
                    ),
                },
                {
                    "role": "user",
                    "content": json.dumps({
                        "task": "Generate a high-quality recommendation from this source context summary.",
                        "contextSummary": context_summary,
                    }, default=str),
                },
                {
                    "role": "assistant",
                    "content": json.dumps({
                        "recommendations": [
                            {
                                "title": example["title"],
                                "priority": example["priority"],
                                "category": example["category"],
                                "reasoning": example["reasoning"],
                                "suggestedAction": example["suggestedAction"],
                                "expectedImpact": example["expectedImpact"],
                                "evidence": example["evidence"],
                            }
                        ]
                    }, default=str),
                },
            ],
            "metadata": {
                "sourceRecommendationId": row.get("id"),
                "propertyId": row.get("property_id"),
                "promptVersion": row.get("prompt_version"),
                "feedbackSignal": row.get("latest_feedback_type") or row.get("status"),
                "usefulCount": row.get("useful_count") or 0,
            },
        }
        jsonl_lines.append(json.dumps(training_record, separators=(",", ":"), default=str))

    return {
        "status": "ok",
        "readyForFineTuning": len(positive_rows) >= minimum_positive_examples,
        "minimumPositiveExamples": minimum_positive_examples,
        "positiveExampleCount": len(positive_rows),
        "negativeExampleCount": len(negative_rows),
        "exportedExampleCount": len(jsonl_lines),
        "jsonl": "\n".join(jsonl_lines),
        "notes": [
            "Export contains only approved or useful recommendations.",
            "Dismissed and not-useful rows are used for prompt suppression, not as positive fine-tuning examples.",
        ],
        "staging_only": True,
    }


def review_recommendation_impact_summary(
    *,
    recommendation_id: str,
    expected_property_id: str,
    access_token: str | None,
) -> dict[str, Any]:
    recommendation = _fetch_recommendation(recommendation_id)
    property_id = str(recommendation.get("property_id") or "")
    if property_id != str(expected_property_id):
        raise PermissionError("Recommendation does not belong to this property.")

    baseline_start = _parse_iso_date(recommendation.get("date_range_start"))
    baseline_end = _parse_iso_date(recommendation.get("date_range_end"))
    window_days = max((baseline_end - baseline_start).days + 1, 7) if baseline_start and baseline_end else 28
    after_end = datetime.now(timezone.utc).date()
    after_start = after_end - timedelta(days=window_days - 1)
    current_context = _build_recommendation_context(
        property_id=property_id,
        property_name="",
        start_date_value=after_start.isoformat(),
        end_date_value=after_end.isoformat(),
        site_key=None,
        access_token=access_token,
    )
    baseline_context = (
        recommendation.get("source_context_snapshot")
        if isinstance(recommendation.get("source_context_snapshot"), dict) and recommendation.get("source_context_snapshot")
        else {"summaryOnly": recommendation.get("source_context_summary") or {}}
    )
    task = None
    if recommendation.get("task_id"):
        task_rows = _fetch_json(
            "user_tasks",
            [
                ("select", "id,status,updated_at,title"),
                ("id", f"eq.{recommendation.get('task_id')}"),
                ("limit", "1"),
            ],
            headers=_supabase_headers(),
        )
        task = task_rows[0] if task_rows else None

    payload = _recommendation_payload(recommendation)
    client = OpenAI()
    response = client.chat.completions.create(
        model=RECOMMENDATIONS_MODEL,
        messages=[
            {
                "role": "system",
                "content": (
                    "You are a senior multifamily marketing analyst reviewing whether an implemented recommendation worked. "
                    "Use only supplied baseline/current context. Be honest when the data is inconclusive."
                ),
            },
            {
                "role": "user",
                "content": json.dumps({
                    "reviewTask": "Compare baseline and current context and decide whether this recommendation worked, did not move the metric, or is inconclusive.",
                    "allowedOutcome": ["worked", "did_not_move_metric", "inconclusive"],
                    "recommendation": payload,
                    "implementationTask": task,
                    "baselineWindow": {
                        "startDate": recommendation.get("date_range_start"),
                        "endDate": recommendation.get("date_range_end"),
                    },
                    "currentWindow": {
                        "startDate": after_start.isoformat(),
                        "endDate": after_end.isoformat(),
                    },
                    "baselineContext": baseline_context,
                    "currentContext": current_context,
                    "requiredJsonShape": {
                        "outcome": "worked|did_not_move_metric|inconclusive",
                        "summary": "Short conclusion.",
                        "metricMovement": ["Observed changes in plain English."],
                        "caveats": ["Limitations or missing data."],
                        "nextStep": "What to do next.",
                        "confidence": 0.0,
                    },
                }, default=str),
            },
        ],
        response_format={"type": "json_object"},
        temperature=0.1,
    )
    try:
        review = json.loads(response.choices[0].message.content or "{}")
    except json.JSONDecodeError:
        review = {
            "outcome": "inconclusive",
            "summary": "The impact review response could not be parsed.",
            "metricMovement": [],
            "caveats": ["OpenAI returned invalid JSON."],
            "nextStep": "Run the review again.",
            "confidence": 0,
        }
    outcome = review.get("outcome") if review.get("outcome") in {"worked", "did_not_move_metric", "inconclusive"} else "inconclusive"
    review_payload = {
        **review,
        "outcome": outcome,
        "baselineWindow": {
            "startDate": recommendation.get("date_range_start"),
            "endDate": recommendation.get("date_range_end"),
        },
        "currentWindow": {
            "startDate": after_start.isoformat(),
            "endDate": after_end.isoformat(),
        },
    }
    updated = _patch_recommendation(
        recommendation_id,
        {
            "implementation_status": outcome,
            "implementation_review_payload": review_payload,
            "implementation_reviewed_at": datetime.now(timezone.utc).isoformat(),
        },
    )
    return {
        "status": "ok",
        "recommendation": {
            "id": updated.get("id") or recommendation_id,
            "implementationStatus": updated.get("implementation_status") or outcome,
            "implementationReview": updated.get("implementation_review_payload") or review_payload,
            "implementationReviewedAt": updated.get("implementation_reviewed_at"),
        },
        "staging_only": True,
    }


def generate_recommendations_summary(
    *,
    property_id: str,
    property_name: str | None = None,
    start_date_value: str | None = None,
    end_date_value: str | None = None,
    site_key: str | None = None,
    access_token: str | None = None,
    user_id: str | None = None,
) -> dict[str, Any]:
    if not os.environ.get("OPENAI_API_KEY"):
        raise ValueError("OPENAI_API_KEY must be configured in Render.")

    context = _build_recommendation_context(
        property_id=property_id,
        property_name=property_name,
        start_date_value=start_date_value,
        end_date_value=end_date_value,
        site_key=site_key,
        access_token=access_token,
    )
    learning_context = _safe_learning_context(property_id)

    system_prompt = (
        "You are a senior multifamily marketing and leasing analyst. "
        "Use only the supplied context. Return concise, practical recommendations that can be acted on by a property marketing team. "
        "Do not invent exact metrics that are not present. If data is unavailable, mention that as a limitation in evidence. "
        "Use feedback memory carefully: prefer patterns similar to approved/useful examples and avoid repeating recent or dismissed ideas."
    )
    user_prompt = {
        "task": "Generate 3 to 6 recommendations for leasing, marketing spend, paid media, website UX, audit issues, and reputation.",
        "learningInstructions": [
            "Use positiveExamples as style and pattern guidance when the current property context supports similar advice.",
            "Avoid suppressedExamples and recentRecommendationTitles unless current data provides a materially different reason.",
            "Do not mention the feedback memory directly in the recommendation copy.",
            "Always return confidence as a number from 0.0 to 1.0 for every recommendation.",
        ],
        "requiredJsonShape": {
            "summary": "One sentence summary of the biggest opportunity.",
            "recommendations": [
                {
                    "id": "short-slug",
                    "title": "Short recommendation title",
                    "priority": "high|medium|low",
                    "category": "leasing|paid_media|website|reputation|operations|analytics",
                    "reasoning": "Why this matters.",
                    "suggestedAction": "Specific next action.",
                    "expectedImpact": "Likely business impact.",
                    "confidence": 0.0,
                    "evidence": ["metric or fact from supplied context"],
                    "sourceAreas": ["reporting", "googleAds", "siteAudit"],
                }
            ],
        },
        "context": context,
        "feedbackMemory": {
            "positiveExampleCount": learning_context["positiveExampleCount"],
            "negativeExampleCount": learning_context["negativeExampleCount"],
            "propertySpecificExampleCount": learning_context["propertySpecificExampleCount"],
            "positiveExamples": learning_context["positiveExamples"],
            "suppressedExamples": learning_context["suppressedExamples"],
            "recentRecommendationTitles": learning_context["recentRecommendationTitles"],
        },
    }

    client = OpenAI()
    response = client.chat.completions.create(
        model=RECOMMENDATIONS_MODEL,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": json.dumps(user_prompt, default=str)},
        ],
        response_format={"type": "json_object"},
        temperature=0.2,
    )
    content = response.choices[0].message.content or "{}"
    parsed = _parse_recommendations_response(content)
    parsed["recommendations"] = _apply_learning_suppression(parsed["recommendations"], learning_context)
    context_summary = {
        "reportingCounts": context["reporting"].get("counts"),
        "analyticsLoaded": {
            key: value.get("status") != "unavailable"
            for key, value in context["analytics"].items()
        },
        "websiteLoaded": {
            key: value.get("status") != "unavailable"
            for key, value in context["website"].items()
        },
    }
    generation_id, stored_recommendations = _persist_recommendations(
        property_id=property_id,
        user_id=user_id,
        model=RECOMMENDATIONS_MODEL,
        date_range=context["requestedRange"],
        context_summary=context_summary,
        context_snapshot=context,
        generation_summary=parsed["summary"],
        recommendations=parsed["recommendations"],
    )

    return {
        "status": "ok",
        "model": RECOMMENDATIONS_MODEL,
        "promptVersion": RECOMMENDATIONS_PROMPT_VERSION,
        "generationId": generation_id,
        "property_id": property_id,
        "propertyName": property_name or "",
        "range": context["requestedRange"],
        "contextSummary": context_summary,
        "contextSnapshot": context,
        "learningSummary": {
            "positiveExampleCount": learning_context["positiveExampleCount"],
            "negativeExampleCount": learning_context["negativeExampleCount"],
            "propertySpecificExampleCount": learning_context["propertySpecificExampleCount"],
        },
        "summary": parsed["summary"],
        "recommendations": stored_recommendations,
        "staging_only": True,
    }
