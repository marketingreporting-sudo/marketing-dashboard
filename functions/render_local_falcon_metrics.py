from __future__ import annotations

import datetime
from typing import Any


def parse_local_falcon_number(value: Any) -> float | None:
    if value in (None, "", False):
        return None
    try:
        return float(str(value).replace("+", "").replace(",", "").strip())
    except (TypeError, ValueError):
        return None


def average_local_falcon_metric(items: list[dict[str, Any]], key: str) -> float | None:
    values = [
        value
        for value in (parse_local_falcon_number(item.get(key)) for item in items if isinstance(item, dict))
        if value is not None
    ]
    if not values:
        return None
    return round(sum(values) / len(values), 2)


def normalize_local_falcon_rank(value: Any) -> int | None:
    if value in (None, "", False):
        return None
    try:
        return int(float(str(value).replace("+", "").strip()))
    except (TypeError, ValueError):
        return None


def normalize_local_falcon_date_label(value: Any) -> str:
    raw_value = str(value or "").strip()
    if not raw_value:
        return ""
    if len(raw_value) == 8 and raw_value.isdigit():
        return f"{raw_value[:4]}-{raw_value[4:6]}-{raw_value[6:8]}"
    for date_format in ("%m/%d/%Y", "%Y-%m-%d", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.datetime.strptime(raw_value[:19], date_format).date().isoformat()
        except ValueError:
            continue
    return raw_value[:10]


def summarize_local_falcon_scan_detail(detail: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(detail, dict):
        return {}
    raw_points = detail.get("data_points") if isinstance(detail.get("data_points"), list) else []
    ranks = [
        rank
        for rank in (normalize_local_falcon_rank(point.get("rank")) for point in raw_points if isinstance(point, dict))
        if rank is not None
    ]
    total_points = len(raw_points)
    if not total_points:
        return {}

    found_in = len(ranks)
    top_three_count = len([rank for rank in ranks if rank <= 3])
    return {
        "arp": round(sum(ranks) / found_in, 2) if found_in else None,
        "atrp": round((sum(ranks) + ((total_points - found_in) * 21)) / total_points, 2),
        "solv": round((top_three_count / total_points) * 100, 2),
        "foundIn": found_in,
        "points": total_points,
        "foundInPercent": round((found_in / total_points) * 100, 2),
    }


def normalize_local_falcon_trends(
    reports: list[dict[str, Any]],
    scan_details: dict[str, dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    rows = []
    scan_details = scan_details or {}
    for item in reports:
        if not isinstance(item, dict):
            continue
        report_key = item.get("report_key")
        detail = scan_details.get(str(report_key)) if report_key else None
        detail_summary = summarize_local_falcon_scan_detail(detail)
        raw_date = (
            item.get("looker_date")
            or item.get("looker_last_date")
            or (detail or {}).get("looker_date")
            or (detail or {}).get("date")
            or item.get("date")
        )
        rows.append(
            {
                "reportKey": report_key,
                "date": normalize_local_falcon_date_label(raw_date),
                "label": normalize_local_falcon_date_label(raw_date),
                "keyword": item.get("keyword"),
                "arp": detail_summary.get("arp") if detail_summary.get("arp") is not None else parse_local_falcon_number(item.get("arp")),
                "atrp": detail_summary.get("atrp") if detail_summary.get("atrp") is not None else parse_local_falcon_number(item.get("atrp")),
                "solv": detail_summary.get("solv") if detail_summary.get("solv") is not None else parse_local_falcon_number(item.get("solv")),
            }
        )
    return list(reversed(rows))
