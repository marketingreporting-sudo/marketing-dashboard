from __future__ import annotations

import json
import os
import re
from html.parser import HTMLParser
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import unquote
from urllib.request import Request, urlopen

from render_auth import RenderPermissionError, user_has_platform_permission, user_has_property_permission
from render_supabase_sync_state import _table_query_url
from render_supabase_validation import _supabase_headers


TICKET_STATUSES = {"new", "in_progress", "on_hold", "awaiting_approval", "approved", "complete"}
TICKET_PRIORITIES = {"low", "normal", "high", "urgent"}
TICKET_CATEGORIES = {"general", "reporting", "website", "ads", "reputation", "resident_experience", "urgent_support"}


class OutlookPayloadError(ValueError):
    pass


class OutlookWebhookAuthError(PermissionError):
    pass


class _HTMLTextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self._parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() in {"br", "p", "div", "li", "tr", "h1", "h2", "h3", "h4", "blockquote"}:
            self._parts.append("\n")

    def handle_data(self, data: str) -> None:
        if data:
            self._parts.append(data)

    def get_text(self) -> str:
        return "".join(self._parts)


def _db_request(
    table_name: str,
    *,
    method: str = "GET",
    query_params: list[tuple[str, str]] | None = None,
    payload: Any | None = None,
    prefer: str | None = None,
) -> Any:
    headers = dict(_supabase_headers())
    data = None
    if prefer:
        headers["Prefer"] = prefer
    if payload is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(payload).encode("utf-8")

    request = Request(
        _table_query_url(table_name, query_params or []),
        headers=headers,
        data=data,
        method=method,
    )
    with urlopen(request, timeout=60) as response:
        body = response.read().decode("utf-8")
    return json.loads(body) if body else None


def _as_list(rows: Any) -> list[dict[str, Any]]:
    return rows if isinstance(rows, list) else []


def _first_row(rows: Any) -> dict[str, Any]:
    return rows[0] if isinstance(rows, list) and rows else {}


def _normalize_email(value: Any) -> str:
    return str(value or "").strip().lower()


def _parse_datetime(value: Any) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        parsed = value
    else:
        text = str(value).strip()
        if not text:
            return None
        if text.endswith("Z"):
            text = f"{text[:-1]}+00:00"
        try:
            parsed = datetime.fromisoformat(text)
        except ValueError as error:
            raise ValueError("Due date must be a valid date and time.") from error

    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _isoformat(value: datetime | None) -> str | None:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z") if value else None


def _require_title(value: Any) -> str:
    title = str(value or "").strip()
    if not title:
        raise ValueError("Ticket title is required.")
    return title[:180]


def _safe_text(value: Any, limit: int = 8000) -> str:
    return str(value or "").strip()[:limit]


def _strip_excess_whitespace(value: str) -> str:
    lines = [" ".join(line.split()) for line in str(value or "").replace("\r", "\n").split("\n")]
    compact_lines = [line for line in lines if line]
    return "\n".join(compact_lines).strip()


def _clean_email_body(value: Any) -> str:
    body = str(value or "")
    body = re.sub(r"(?is)<(script|style).*?>.*?</\1>", " ", body)
    if re.search(r"<[a-zA-Z][^>]*>", body):
        extractor = _HTMLTextExtractor()
        extractor.feed(body)
        body = extractor.get_text()
    body = re.sub(r"(?s)<[^>]+>", " ", body)
    return _safe_text(_strip_excess_whitespace(body), 12000)


def _validate_status(value: Any) -> str:
    status = str(value or "new").strip()
    return status if status in TICKET_STATUSES else "new"


def _validate_priority(value: Any) -> str:
    priority = str(value or "normal").strip()
    return priority if priority in TICKET_PRIORITIES else "normal"


def _validate_category(value: Any) -> str:
    category = str(value or "general").strip()
    return category if category in TICKET_CATEGORIES else "general"


def _user_id(user: dict[str, Any]) -> str:
    return str(user.get("id") or user.get("sub") or "").strip()


def _user_email(user: dict[str, Any]) -> str:
    return _normalize_email(user.get("email") or (user.get("user_metadata") or {}).get("email"))


def _fetch_profiles() -> list[dict[str, Any]]:
    return _as_list(
        _db_request(
            "profiles",
            query_params=[
                ("select", "id,email,full_name,global_role,is_active,created_at,updated_at"),
                ("order", "full_name.asc"),
            ],
        )
    )


def _fetch_memberships() -> list[dict[str, Any]]:
    return _as_list(
        _db_request(
            "property_memberships",
            query_params=[
                ("select", "user_id,property_id,role,is_active"),
                ("is_active", "eq.true"),
            ],
        )
    )


def _fetch_properties() -> list[dict[str, Any]]:
    return _as_list(
        _db_request(
            "properties",
            query_params=[
                ("select", "id,name,city,state"),
                ("order", "name.asc"),
            ],
        )
    )


def _fetch_properties_for_matching() -> list[dict[str, Any]]:
    try:
        rows = _db_request(
            "properties",
            query_params=[
                ("select", "id,name,slug,short_name,city,state"),
                ("order", "name.asc"),
            ],
        )
        return _as_list(rows)
    except Exception:
        return _fetch_properties()


def _fetch_ticket_assignments() -> list[dict[str, Any]]:
    return _as_list(
        _db_request(
            "property_ticket_assignments",
            query_params=[
                ("select", "id,property_id,default_assignee_user_id,is_active,created_at,updated_at"),
                ("is_active", "eq.true"),
                ("order", "property_id.asc"),
            ],
        )
    )


def _fetch_profile_by_email(email: str) -> dict[str, Any]:
    normalized = _normalize_email(email)
    if not normalized:
        return {}
    return _first_row(
        _db_request(
            "profiles",
            query_params=[
                ("select", "id,email,full_name,global_role,is_active"),
                ("email", f"ilike.{normalized}"),
                ("limit", "1"),
            ],
        )
    )


def _fetch_single_ticket(ticket_id: str) -> dict[str, Any]:
    return _first_row(
        _db_request(
            "tickets",
            query_params=[
                (
                    "select",
                    "id,task_id,property_id,requester_user_id,requester_email,submitted_by_user_id,submitted_by_email,"
                    "assigned_user_id,source,category,priority,status,title,description,due_at,email_message_id,"
                    "email_subject,email_from,email_to,email_excerpt,metadata,created_at,updated_at",
                ),
                ("id", f"eq.{ticket_id}"),
                ("limit", "1"),
            ],
        )
    )


def _fetch_single_task(task_id: str) -> dict[str, Any]:
    return _first_row(
        _db_request(
            "user_tasks",
            query_params=[
                (
                    "select",
                    "id,owner_user_id,property_id,title,description,notes,due_date,status,ticket_id,assigned_by_user_id,"
                    "source,priority,requester_email,created_at,updated_at",
                ),
                ("id", f"eq.{task_id}"),
                ("limit", "1"),
            ],
        )
    )


def _has_property_ticket_access(access_token: str, property_id: str, permission: str = "tickets.submit") -> bool:
    return (
        user_has_property_permission(access_token, property_id, permission)
        or user_has_property_permission(access_token, property_id, "tasks.view")
        or user_has_platform_permission(access_token, "users.manage")
    )


def _profile_can_access_property(profile: dict[str, Any], property_id: str, memberships: list[dict[str, Any]]) -> bool:
    if not profile or not profile.get("is_active", True):
        return False
    if profile.get("global_role") == "admin":
        return True
    user_id = str(profile.get("id") or "")
    return any(
        str(membership.get("user_id") or "") == user_id
        and str(membership.get("property_id") or "") == str(property_id)
        and bool(membership.get("is_active", True))
        for membership in memberships
    )


def _shape_profile(row: dict[str, Any], memberships: list[dict[str, Any]]) -> dict[str, Any]:
    user_id = str(row.get("id") or "")
    return {
        "id": user_id,
        "email": row.get("email") or "",
        "fullName": row.get("full_name") or row.get("email") or "User",
        "globalRole": row.get("global_role"),
        "isActive": bool(row.get("is_active", True)),
        "propertyIds": [
            str(membership.get("property_id") or "")
            for membership in memberships
            if str(membership.get("user_id") or "") == user_id and bool(membership.get("is_active", True))
        ],
    }


def _shape_ticket(row: dict[str, Any], profiles_by_id: dict[str, dict[str, Any]] | None = None) -> dict[str, Any]:
    profiles_by_id = profiles_by_id or {}
    assigned_user_id = str(row.get("assigned_user_id") or "")
    submitted_by_user_id = str(row.get("submitted_by_user_id") or "")
    requester_user_id = str(row.get("requester_user_id") or "")
    return {
        "id": str(row.get("id") or ""),
        "taskId": str(row.get("task_id") or ""),
        "propertyId": str(row.get("property_id") or ""),
        "requesterUserId": requester_user_id,
        "requesterEmail": row.get("requester_email") or "",
        "submittedByUserId": submitted_by_user_id,
        "submittedByEmail": row.get("submitted_by_email") or "",
        "assignedUserId": assigned_user_id,
        "assignedUserName": (profiles_by_id.get(assigned_user_id) or {}).get("full_name") or (profiles_by_id.get(assigned_user_id) or {}).get("email") or "",
        "submittedByName": (profiles_by_id.get(submitted_by_user_id) or {}).get("full_name") or (profiles_by_id.get(submitted_by_user_id) or {}).get("email") or "",
        "requesterName": (profiles_by_id.get(requester_user_id) or {}).get("full_name") or (profiles_by_id.get(requester_user_id) or {}).get("email") or "",
        "source": row.get("source") or "dashboard_form",
        "category": row.get("category") or "general",
        "priority": row.get("priority") or "normal",
        "status": row.get("status") or "new",
        "title": row.get("title") or "",
        "description": row.get("description") or "",
        "dueAt": row.get("due_at") or "",
        "emailSubject": row.get("email_subject") or "",
        "emailFrom": row.get("email_from") or "",
        "emailTo": row.get("email_to") or "",
        "emailExcerpt": row.get("email_excerpt") or "",
        "metadata": row.get("metadata") if isinstance(row.get("metadata"), dict) else {},
        "createdAt": row.get("created_at") or "",
        "updatedAt": row.get("updated_at") or "",
    }


def _shape_task(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row.get("id") or "",
        "owner_user_id": row.get("owner_user_id") or "",
        "property_id": row.get("property_id") or "",
        "title": row.get("title") or "",
        "description": row.get("description") or "",
        "notes": row.get("notes") or "",
        "due_date": row.get("due_date") or "",
        "status": row.get("status") or "new",
        "ticket_id": row.get("ticket_id") or "",
        "assigned_by_user_id": row.get("assigned_by_user_id") or "",
        "source": row.get("source") or "manual",
        "priority": row.get("priority") or "normal",
        "requester_email": row.get("requester_email") or "",
        "created_at": row.get("created_at") or "",
        "updated_at": row.get("updated_at") or "",
    }


def _assignment_for_property(property_id: str, assignments: list[dict[str, Any]]) -> str:
    for assignment in assignments:
        if str(assignment.get("property_id") or "") == str(property_id) and bool(assignment.get("is_active", True)):
            return str(assignment.get("default_assignee_user_id") or assignment.get("assigned_user_id") or "")
    return ""


def _choose_assignee(
    *,
    requested_assignee_id: str,
    property_id: str,
    fallback_user_id: str,
    profiles: list[dict[str, Any]],
    memberships: list[dict[str, Any]],
    assignments: list[dict[str, Any]],
) -> str:
    profiles_by_id = {str(profile.get("id") or ""): profile for profile in profiles}
    candidate_ids = [
        requested_assignee_id,
        _assignment_for_property(property_id, assignments),
        fallback_user_id,
    ]
    for candidate_id in candidate_ids:
        candidate_id = str(candidate_id or "").strip()
        if candidate_id and _profile_can_access_property(profiles_by_id.get(candidate_id, {}), property_id, memberships):
            return candidate_id
    raise ValueError("No active assignee is available for this property.")


def _task_notes(ticket_row: dict[str, Any]) -> str:
    lines = [
        f"Ticket ID: {ticket_row.get('id')}",
        f"Source: {ticket_row.get('source') or 'dashboard_form'}",
        f"Priority: {ticket_row.get('priority') or 'normal'}",
    ]
    requester = ticket_row.get("requester_email") or ticket_row.get("submitted_by_email")
    if requester:
        lines.append(f"Requester: {requester}")
    if ticket_row.get("category"):
        lines.append(f"Category: {ticket_row.get('category')}")
    if ticket_row.get("email_subject"):
        lines.append(f"Email subject: {ticket_row.get('email_subject')}")
    return "\n".join(lines)


def _create_linked_task(ticket_row: dict[str, Any], assigned_by_user_id: str | None = None) -> dict[str, Any]:
    due_at = _parse_datetime(ticket_row.get("due_at"))
    task_payload = {
        "owner_user_id": ticket_row.get("assigned_user_id"),
        "property_id": ticket_row.get("property_id"),
        "title": f"Ticket: {ticket_row.get('title')}",
        "description": ticket_row.get("description") or "",
        "notes": _task_notes(ticket_row),
        "due_date": due_at.date().isoformat() if due_at else None,
        "status": ticket_row.get("status") or "new",
        "ticket_id": ticket_row.get("id"),
        "assigned_by_user_id": assigned_by_user_id,
        "source": "ticket",
        "priority": ticket_row.get("priority") or "normal",
        "requester_email": ticket_row.get("requester_email") or ticket_row.get("submitted_by_email"),
    }
    return _first_row(
        _db_request(
            "user_tasks",
            method="POST",
            payload=task_payload,
            prefer="return=representation",
        )
    )


def _create_outlook_linked_task(ticket_row: dict[str, Any]) -> dict[str, Any]:
    task_payload = {
        "owner_user_id": ticket_row.get("assigned_user_id") or None,
        "property_id": ticket_row.get("property_id") or None,
        "title": ticket_row.get("title") or "Outlook ticket",
        "description": ticket_row.get("description") or "",
        "notes": _task_notes(ticket_row),
        "due_date": None,
        "status": "new",
        "ticket_id": ticket_row.get("id"),
        "source": "ticket_email",
        "priority": "normal",
        "requester_email": ticket_row.get("requester_email") or ticket_row.get("submitted_by_email"),
    }
    return _first_row(
        _db_request(
            "user_tasks",
            method="POST",
            payload=task_payload,
            prefer="return=representation",
        )
    )


def _sync_task_from_ticket(ticket_row: dict[str, Any]) -> dict[str, Any]:
    if not ticket_row.get("task_id"):
        return {}
    due_at = _parse_datetime(ticket_row.get("due_at"))
    patch_payload = {
        "owner_user_id": ticket_row.get("assigned_user_id"),
        "property_id": ticket_row.get("property_id"),
        "title": f"Ticket: {ticket_row.get('title')}",
        "description": ticket_row.get("description") or "",
        "notes": _task_notes(ticket_row),
        "due_date": due_at.date().isoformat() if due_at else None,
        "status": ticket_row.get("status") or "new",
        "priority": ticket_row.get("priority") or "normal",
        "requester_email": ticket_row.get("requester_email") or ticket_row.get("submitted_by_email"),
    }
    return _first_row(
        _db_request(
            "user_tasks",
            method="PATCH",
            query_params=[("id", f"eq.{ticket_row.get('task_id')}")],
            payload=patch_payload,
            prefer="return=representation",
        )
    )


def _record_activity(ticket_id: str, action: str, actor_user_id: str | None, actor_email: str | None, details: dict[str, Any]) -> None:
    _db_request(
        "ticket_activity_log",
        method="POST",
        payload={
            "ticket_id": ticket_id,
            "actor_user_id": actor_user_id,
            "actor_email": actor_email,
            "action": action,
            "details": details,
        },
    )


def list_ticket_options_summary(access_token: str) -> dict[str, Any]:
    properties = _fetch_properties()
    profiles = _fetch_profiles()
    memberships = _fetch_memberships()
    assignments = _fetch_ticket_assignments()

    accessible_property_ids = {
        str(property_row.get("id") or "")
        for property_row in properties
        if _has_property_ticket_access(access_token, str(property_row.get("id") or ""), "tickets.submit")
    }
    active_profiles = [profile for profile in profiles if bool(profile.get("is_active", True))]

    return {
        "status": "ok",
        "properties": [
            {
                "id": str(property_row.get("id") or ""),
                "name": property_row.get("name") or "",
                "city": property_row.get("city") or "",
                "state": property_row.get("state") or "",
            }
            for property_row in properties
            if str(property_row.get("id") or "") in accessible_property_ids
        ],
        "users": [_shape_profile(profile, memberships) for profile in active_profiles],
        "assignments": [
            {
                "id": assignment.get("id") or "",
                "propertyId": str(assignment.get("property_id") or ""),
                "defaultAssigneeUserId": str(assignment.get("default_assignee_user_id") or ""),
            }
            for assignment in assignments
            if str(assignment.get("property_id") or "") in accessible_property_ids
        ],
    }


def list_ticket_assignment_admin_summary() -> dict[str, Any]:
    assignments = _fetch_ticket_assignments()
    return {
        "status": "ok",
        "assignments": [
            {
                "id": assignment.get("id") or "",
                "propertyId": str(assignment.get("property_id") or ""),
                "defaultAssigneeUserId": str(assignment.get("default_assignee_user_id") or assignment.get("assigned_user_id") or ""),
                "isActive": bool(assignment.get("is_active", True)),
                "createdAt": assignment.get("created_at") or "",
                "updatedAt": assignment.get("updated_at") or "",
            }
            for assignment in assignments
        ],
    }


def save_ticket_assignment_admin_summary(payload: dict[str, Any]) -> dict[str, Any]:
    raw_assignments = payload.get("assignments")
    if not isinstance(raw_assignments, list):
        raise ValueError("Assignments must be provided as a list.")

    properties_by_id = {str(row.get("id") or ""): row for row in _fetch_properties()}
    profiles = _fetch_profiles()
    profiles_by_id = {str(profile.get("id") or ""): profile for profile in profiles}
    memberships = _fetch_memberships()

    saved_count = 0
    cleared_count = 0
    for item in raw_assignments:
        if not isinstance(item, dict):
            continue
        property_id = str(item.get("propertyId") or item.get("property_id") or "").strip()
        assignee_user_id = str(
            item.get("defaultAssigneeUserId")
            or item.get("default_assignee_user_id")
            or item.get("assignedUserId")
            or item.get("assigned_user_id")
            or ""
        ).strip()
        if not property_id:
            continue
        if property_id not in properties_by_id:
            raise ValueError(f"Property {property_id} was not found.")

        if not assignee_user_id:
            _db_request(
                "property_ticket_assignments",
                method="DELETE",
                query_params=[("property_id", f"eq.{property_id}")],
                prefer="return=minimal",
            )
            cleared_count += 1
            continue

        if not _profile_can_access_property(profiles_by_id.get(assignee_user_id, {}), property_id, memberships):
            property_name = properties_by_id.get(property_id, {}).get("name") or property_id
            raise ValueError(f"Default assignee must be active and have access to {property_name}.")

        _db_request(
            "property_ticket_assignments",
            method="POST",
            query_params=[("on_conflict", "property_id")],
            payload={
                "property_id": property_id,
                "default_assignee_user_id": assignee_user_id,
                "is_active": True,
            },
            prefer="resolution=merge-duplicates,return=minimal",
        )
        saved_count += 1

    refreshed = list_ticket_assignment_admin_summary()
    refreshed["savedCount"] = saved_count
    refreshed["clearedCount"] = cleared_count
    return refreshed


def list_tickets_summary(access_token: str, user: dict[str, Any]) -> dict[str, Any]:
    user_id = _user_id(user)
    rows = _as_list(
        _db_request(
            "tickets",
            query_params=[
                (
                    "select",
                    "id,task_id,property_id,requester_user_id,requester_email,submitted_by_user_id,submitted_by_email,"
                    "assigned_user_id,source,category,priority,status,title,description,due_at,email_message_id,"
                    "email_subject,email_from,email_to,email_excerpt,metadata,created_at,updated_at",
                ),
                ("order", "updated_at.desc"),
                ("limit", "500"),
            ],
        )
    )
    profiles_by_id = {str(profile.get("id") or ""): profile for profile in _fetch_profiles()}
    visible = []
    for row in rows:
        property_id = str(row.get("property_id") or "")
        related_user_ids = {
            str(row.get("assigned_user_id") or ""),
            str(row.get("submitted_by_user_id") or ""),
            str(row.get("requester_user_id") or ""),
        }
        if (
            user_id in related_user_ids
            or user_has_property_permission(access_token, property_id, "tickets.view_property")
            or user_has_platform_permission(access_token, "tickets.manage")
        ):
            visible.append(_shape_ticket(row, profiles_by_id))
    return {"status": "ok", "tickets": visible}


def create_ticket_summary(access_token: str, user: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    property_id = str(payload.get("propertyId") or payload.get("property_id") or "").strip()
    if not property_id:
        raise ValueError("Property is required.")
    if not _has_property_ticket_access(access_token, property_id, "tickets.submit"):
        raise RenderPermissionError("You do not have ticket access for this property.")

    due_at = _parse_datetime(payload.get("dueAt") or payload.get("due_at"))
    if due_at:
        minimum_due_at = datetime.now(timezone.utc) + timedelta(hours=24)
        if due_at < minimum_due_at:
            raise ValueError("Ticket due date must be at least 24 hours in the future.")

    profiles = _fetch_profiles()
    memberships = _fetch_memberships()
    assignments = _fetch_ticket_assignments()
    current_user_id = _user_id(user)
    submitted_by_email = _user_email(user)
    assigned_user_id = _choose_assignee(
        requested_assignee_id=str(payload.get("assignedUserId") or payload.get("assigned_user_id") or "").strip(),
        property_id=property_id,
        fallback_user_id=current_user_id,
        profiles=profiles,
        memberships=memberships,
        assignments=assignments,
    )
    requester_email = _normalize_email(payload.get("requesterEmail") or payload.get("requester_email") or submitted_by_email)

    ticket_payload = {
        "property_id": property_id,
        "requester_user_id": current_user_id,
        "requester_email": requester_email,
        "submitted_by_user_id": current_user_id,
        "submitted_by_email": submitted_by_email,
        "assigned_user_id": assigned_user_id,
        "source": "dashboard_form",
        "category": _validate_category(payload.get("category")),
        "priority": _validate_priority(payload.get("priority")),
        "status": _validate_status(payload.get("status")),
        "title": _require_title(payload.get("title")),
        "description": _safe_text(payload.get("description"), 12000),
        "due_at": _isoformat(due_at),
        "metadata": payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {},
    }
    ticket_row = _first_row(
        _db_request(
            "tickets",
            method="POST",
            payload=ticket_payload,
            prefer="return=representation",
        )
    )
    task_row = _create_linked_task(ticket_row, current_user_id)
    if task_row.get("id"):
        ticket_row = _first_row(
            _db_request(
                "tickets",
                method="PATCH",
                query_params=[("id", f"eq.{ticket_row.get('id')}")],
                payload={"task_id": task_row.get("id")},
                prefer="return=representation",
            )
        )
    _record_activity(
        str(ticket_row.get("id")),
        "created",
        current_user_id,
        submitted_by_email,
        {"assignedUserId": assigned_user_id, "source": "dashboard_form"},
    )
    profiles_by_id = {str(profile.get("id") or ""): profile for profile in profiles}
    return {"status": "ok", "ticket": _shape_ticket(ticket_row, profiles_by_id), "task": _shape_task(task_row)}


def update_ticket_summary(access_token: str, user: dict[str, Any], ticket_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    ticket_row = _fetch_single_ticket(ticket_id)
    if not ticket_row:
        raise ValueError("Ticket was not found.")
    property_id = str(ticket_row.get("property_id") or "")
    current_user_id = _user_id(user)
    can_update = (
        str(ticket_row.get("assigned_user_id") or "") == current_user_id
        or user_has_property_permission(access_token, property_id, "tickets.assign")
        or user_has_platform_permission(access_token, "tickets.manage")
    )
    if not can_update:
        raise RenderPermissionError("You do not have permission to update this ticket.")

    patch_payload: dict[str, Any] = {}
    if "title" in payload:
        patch_payload["title"] = _require_title(payload.get("title"))
    if "description" in payload:
        patch_payload["description"] = _safe_text(payload.get("description"), 12000)
    if "status" in payload:
        patch_payload["status"] = _validate_status(payload.get("status"))
    if "priority" in payload:
        patch_payload["priority"] = _validate_priority(payload.get("priority"))
    if "category" in payload:
        patch_payload["category"] = _validate_category(payload.get("category"))
    if "assignedUserId" in payload or "assigned_user_id" in payload:
        assigned_user_id = str(payload.get("assignedUserId") or payload.get("assigned_user_id") or "").strip()
        profiles = _fetch_profiles()
        memberships = _fetch_memberships()
        profiles_by_id = {str(profile.get("id") or ""): profile for profile in profiles}
        if not _profile_can_access_property(profiles_by_id.get(assigned_user_id, {}), property_id, memberships):
            raise ValueError("Assigned user must be active and have access to this property.")
        patch_payload["assigned_user_id"] = assigned_user_id
    if "dueAt" in payload or "due_at" in payload:
        due_at = _parse_datetime(payload.get("dueAt") or payload.get("due_at"))
        if due_at:
            existing_due_at = _parse_datetime(ticket_row.get("due_at"))
            due_date_changed = (
                existing_due_at is None
                or abs((due_at - existing_due_at).total_seconds()) > 60
            )
            minimum_due_at = datetime.now(timezone.utc) + timedelta(hours=24)
            if due_date_changed and due_at < minimum_due_at and patch_payload.get("status", ticket_row.get("status")) != "complete":
                raise ValueError("Ticket due date must be at least 24 hours in the future.")
        patch_payload["due_at"] = _isoformat(due_at)

    if not patch_payload:
        profiles_by_id = {str(profile.get("id") or ""): profile for profile in _fetch_profiles()}
        task_row = _fetch_single_task(str(ticket_row.get("task_id") or ""))
        return {"status": "ok", "ticket": _shape_ticket(ticket_row, profiles_by_id), "task": _shape_task(task_row)}

    updated_ticket = _first_row(
        _db_request(
            "tickets",
            method="PATCH",
            query_params=[("id", f"eq.{ticket_id}")],
            payload=patch_payload,
            prefer="return=representation",
        )
    )
    task_row = _sync_task_from_ticket(updated_ticket)
    _record_activity(
        ticket_id,
        "updated",
        current_user_id,
        _user_email(user),
        {"fields": sorted(patch_payload.keys())},
    )
    profiles_by_id = {str(profile.get("id") or ""): profile for profile in _fetch_profiles()}
    return {"status": "ok", "ticket": _shape_ticket(updated_ticket, profiles_by_id), "task": _shape_task(task_row)}


def _extract_forwarded_email(value: Any) -> str:
    text = str(value or "")
    matches = re.findall(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+", text)
    return _normalize_email(matches[0]) if matches else ""


def _extract_property_id_from_email_payload(payload: dict[str, Any]) -> str:
    explicit = str(payload.get("propertyId") or payload.get("property_id") or "").strip()
    if explicit:
        return explicit

    searchable = " ".join(
        str(payload.get(key) or "")
        for key in ("recipient", "to", "subject", "text", "html", "body")
    )
    bracket_match = re.search(r"\[(?:property|property_id)\s*:\s*([A-Za-z0-9_-]+)\]", searchable, re.IGNORECASE)
    if bracket_match:
        return bracket_match.group(1)

    plus_match = re.search(r"tickets\+([A-Za-z0-9_-]+)@", searchable, re.IGNORECASE)
    if plus_match:
        return plus_match.group(1)
    return ""


def _match_property_from_email_text(subject: str, body: str) -> dict[str, Any]:
    searchable = f"{subject}\n{body}".casefold()
    best_match: dict[str, Any] = {}
    best_length = 0
    for property_row in _fetch_properties_for_matching():
        tokens = [
            str(property_row.get(key) or "").strip()
            for key in ("name", "slug", "short_name")
        ]
        for token in tokens:
            normalized = token.casefold()
            if len(normalized) < 3:
                continue
            if normalized in searchable and len(normalized) > best_length:
                best_match = property_row
                best_length = len(normalized)
    return best_match


def _validate_outlook_payload(payload: dict[str, Any]) -> dict[str, str]:
    if not isinstance(payload, dict):
        raise OutlookPayloadError("Request body must be a JSON object.")
    required_fields = ("token", "from", "subject", "body", "messageId")
    missing = [field for field in required_fields if not str(payload.get(field) or "").strip()]
    if missing:
        raise OutlookPayloadError(f"Missing required field(s): {', '.join(missing)}.")

    configured_token = os.environ.get("OUTLOOK_WEBHOOK_TOKEN", "").strip()
    if not configured_token or str(payload.get("token") or "") != configured_token:
        raise OutlookWebhookAuthError("Invalid Outlook webhook token.")

    return {
        "from": _normalize_email(payload.get("from")),
        "subject": _safe_text(payload.get("subject"), 300),
        "body": str(payload.get("body") or ""),
        "messageId": _safe_text(payload.get("messageId"), 500),
        "receivedDateTime": _safe_text(payload.get("receivedDateTime"), 80),
    }


def _fetch_existing_outlook_ticket(message_id: str) -> dict[str, Any]:
    return _first_row(
        _db_request(
            "tickets",
            query_params=[
                ("select", "id,task_id,property_id,assigned_user_id,created_at,updated_at"),
                ("original_email_message_id", f"eq.{message_id}"),
                ("limit", "1"),
            ],
        )
    )


def _outlook_assignee_for_property(property_id: str | None, assignments: list[dict[str, Any]]) -> str | None:
    assigned_user_id = _assignment_for_property(property_id or "", assignments) if property_id else ""
    if assigned_user_id:
        return assigned_user_id
    fallback_user_id = str(os.environ.get("TICKET_TRIAGE_USER_ID") or "").strip()
    return fallback_user_id or None


def create_inbound_outlook_ticket_summary(payload: dict[str, Any]) -> dict[str, Any]:
    normalized = _validate_outlook_payload(payload)
    sender_email = normalized["from"]
    if not sender_email:
        raise OutlookPayloadError("Field 'from' must be a valid email address.")

    existing_ticket = _fetch_existing_outlook_ticket(normalized["messageId"])
    if existing_ticket:
        return {
            "success": True,
            "duplicate": True,
            "ticket_id": str(existing_ticket.get("id") or ""),
        }

    original_body = normalized["body"]
    cleaned_body = _clean_email_body(original_body)
    if not cleaned_body:
        raise OutlookPayloadError("Field 'body' did not contain readable ticket content.")

    matched_property = _match_property_from_email_text(normalized["subject"], cleaned_body)
    property_id = str(matched_property.get("id") or "") or None
    assignments = _fetch_ticket_assignments()
    assigned_user_id = _outlook_assignee_for_property(property_id, assignments)
    submitter_profile = _fetch_profile_by_email(sender_email)
    submitted_by_user_id = str(submitter_profile.get("id") or "") or None

    ticket_payload = {
        "property_id": property_id,
        "requester_email": sender_email,
        "submitted_by_email": sender_email,
        "submitted_by_user_id": submitted_by_user_id,
        "assigned_user_id": assigned_user_id,
        "source": "outlook_email",
        "category": "general",
        "status": "new",
        "priority": "normal",
        "title": normalized["subject"],
        "description": cleaned_body,
        "email_message_id": normalized["messageId"],
        "email_subject": normalized["subject"],
        "email_from": sender_email,
        "email_excerpt": cleaned_body[:500],
        "original_email_message_id": normalized["messageId"],
        "original_email_subject": normalized["subject"],
        "original_email_from": sender_email,
        "original_email_body": original_body,
        "metadata": {
            "receivedDateTime": normalized["receivedDateTime"],
            "provider": "outlook_power_automate",
            "propertyMatched": bool(property_id),
        },
    }

    ticket_row = _first_row(
        _db_request(
            "tickets",
            method="POST",
            payload=ticket_payload,
            prefer="return=representation",
        )
    )
    task_row = _create_outlook_linked_task(ticket_row)
    if task_row.get("id"):
        ticket_row = _first_row(
            _db_request(
                "tickets",
                method="PATCH",
                query_params=[("id", f"eq.{ticket_row.get('id')}")],
                payload={"task_id": task_row.get("id")},
                prefer="return=representation",
            )
        )
    _record_activity(
        str(ticket_row.get("id")),
        "created_from_outlook",
        submitted_by_user_id,
        sender_email,
        {
            "assignedUserId": assigned_user_id,
            "propertyMatched": bool(property_id),
            "messageId": normalized["messageId"],
        },
    )

    return {
        "success": True,
        "duplicate": False,
        "ticket_id": str(ticket_row.get("id") or ""),
        "task_id": str(task_row.get("id") or ""),
        "property_id": property_id,
        "property_matched": bool(property_id),
        "assigned_user_id": assigned_user_id,
    }


def create_inbound_email_ticket_summary(payload: dict[str, Any]) -> dict[str, Any]:
    property_id = _extract_property_id_from_email_payload(payload)
    if not property_id:
        raise ValueError("Inbound email did not include a property id. Use tickets+PROPERTY_ID@... or [property: PROPERTY_ID].")

    sender_email = _normalize_email(payload.get("from") or payload.get("sender") or payload.get("envelope_from"))
    forwarded_by_email = _extract_forwarded_email(payload.get("headers") or payload.get("text") or payload.get("body")) or sender_email
    submitter_profile = _fetch_profile_by_email(forwarded_by_email) or _fetch_profile_by_email(sender_email)

    profiles = _fetch_profiles()
    memberships = _fetch_memberships()
    assignments = _fetch_ticket_assignments()
    submitter_user_id = str(submitter_profile.get("id") or "")
    assigned_user_id = _choose_assignee(
        requested_assignee_id=str(payload.get("assignedUserId") or payload.get("assigned_user_id") or "").strip(),
        property_id=property_id,
        fallback_user_id=submitter_user_id,
        profiles=profiles,
        memberships=memberships,
        assignments=assignments,
    )

    subject = _safe_text(payload.get("subject") or "Forwarded ticket request", 180)
    body = _safe_text(payload.get("text") or payload.get("body") or payload.get("stripped_text") or payload.get("html"), 12000)
    excerpt = " ".join(body.split())[:500]
    due_at = _parse_datetime(payload.get("dueAt") or payload.get("due_at"))
    if due_at and due_at < datetime.now(timezone.utc) + timedelta(hours=24):
        raise ValueError("Ticket due date must be at least 24 hours in the future.")

    ticket_payload = {
        "property_id": property_id,
        "requester_user_id": submitter_user_id or None,
        "requester_email": forwarded_by_email or sender_email,
        "submitted_by_user_id": submitter_user_id or None,
        "submitted_by_email": forwarded_by_email or sender_email,
        "assigned_user_id": assigned_user_id,
        "source": "forwarded_email",
        "category": _validate_category(payload.get("category")),
        "priority": _validate_priority(payload.get("priority")),
        "status": "new",
        "title": subject,
        "description": body,
        "due_at": _isoformat(due_at),
        "email_message_id": _safe_text(payload.get("message_id") or payload.get("Message-Id") or payload.get("messageId"), 300) or None,
        "email_subject": subject,
        "email_from": sender_email,
        "email_to": _safe_text(payload.get("to") or payload.get("recipient"), 300),
        "email_excerpt": excerpt,
        "metadata": {
            "rawProvider": _safe_text(payload.get("provider"), 80),
            "forwardedByEmail": forwarded_by_email,
            "decodedRecipient": unquote(str(payload.get("recipient") or payload.get("to") or "")),
        },
    }
    existing = []
    if ticket_payload["email_message_id"]:
        existing = _as_list(
            _db_request(
                "tickets",
                query_params=[
                    ("select", "id,task_id,property_id,status,title,created_at,updated_at"),
                    ("email_message_id", f"eq.{ticket_payload['email_message_id']}"),
                    ("limit", "1"),
                ],
            )
        )
    if existing:
        return {"status": "ok", "duplicate": True, "ticket": _shape_ticket(existing[0])}

    ticket_row = _first_row(
        _db_request(
            "tickets",
            method="POST",
            payload=ticket_payload,
            prefer="return=representation",
        )
    )
    task_row = _create_linked_task(ticket_row, submitter_user_id or None)
    if task_row.get("id"):
        ticket_row = _first_row(
            _db_request(
                "tickets",
                method="PATCH",
                query_params=[("id", f"eq.{ticket_row.get('id')}")],
                payload={"task_id": task_row.get("id")},
                prefer="return=representation",
            )
        )
    _record_activity(
        str(ticket_row.get("id")),
        "created_from_email",
        submitter_user_id or None,
        forwarded_by_email or sender_email,
        {"assignedUserId": assigned_user_id, "source": "forwarded_email"},
    )
    profiles_by_id = {str(profile.get("id") or ""): profile for profile in profiles}
    return {"status": "ok", "ticket": _shape_ticket(ticket_row, profiles_by_id), "task": _shape_task(task_row)}
