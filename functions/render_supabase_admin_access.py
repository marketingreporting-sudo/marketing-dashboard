import json
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from render_supabase_sync_state import _table_query_url
from render_supabase_validation import SupabaseValidationConfigError, _require_env, _supabase_headers


def _auth_admin_url(path: str, query_params: list[tuple[str, str]] | None = None) -> str:
    base_url = _require_env("SUPABASE_URL").rstrip("/")
    query_string = f"?{urlencode(query_params, doseq=True)}" if query_params else ""
    return f"{base_url}/auth/v1{path}{query_string}"


def _auth_admin_headers() -> dict[str, str]:
    service_role_key = _require_env("SUPABASE_SERVICE_ROLE_KEY")
    return {
        "apikey": service_role_key,
        "Authorization": f"Bearer {service_role_key}",
        "Content-Type": "application/json",
    }


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
    if not body:
        return None
    return json.loads(body)


def _auth_admin_request(
    path: str,
    *,
    method: str = "GET",
    query_params: list[tuple[str, str]] | None = None,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = Request(
        _auth_admin_url(path, query_params),
        headers=_auth_admin_headers(),
        data=data,
        method=method,
    )
    with urlopen(request, timeout=60) as response:
        body = response.read().decode("utf-8")
    return json.loads(body) if body else {}


def _fetch_roles() -> list[dict[str, Any]]:
    rows = _db_request(
        "app_roles",
        query_params=[
            ("select", "name,scope,description"),
            ("order", "scope.asc"),
            ("order", "name.asc"),
        ],
    )
    return rows if isinstance(rows, list) else []


def _fetch_properties() -> list[dict[str, Any]]:
    rows = _db_request(
        "properties",
        query_params=[
            ("select", "id,name,city,state,portfolio"),
            ("order", "name.asc"),
        ],
    )
    return rows if isinstance(rows, list) else []


def _fetch_profiles() -> list[dict[str, Any]]:
    rows = _db_request(
        "profiles",
        query_params=[
            ("select", "id,email,full_name,global_role,is_active,created_at,updated_at"),
            ("order", "created_at.desc"),
        ],
    )
    return rows if isinstance(rows, list) else []


def _fetch_memberships() -> list[dict[str, Any]]:
    rows = _db_request(
        "property_memberships",
        query_params=[
            ("select", "id,user_id,property_id,role,is_active,created_at,updated_at"),
            ("order", "created_at.asc"),
        ],
    )
    return rows if isinstance(rows, list) else []


def _fetch_auth_users() -> list[dict[str, Any]]:
    payload = _auth_admin_request(
        "/admin/users",
        query_params=[("page", "1"), ("per_page", "1000")],
    )
    users = payload.get("users")
    return users if isinstance(users, list) else []


def _find_auth_user_by_email(email: str) -> dict[str, Any]:
    target = str(email or "").strip().lower()
    if not target:
        return {}

    for user in _fetch_auth_users():
        if str(user.get("email") or "").strip().lower() == target:
            return user
    return {}


def _fetch_access_audit_logs(limit: int = 25) -> list[dict[str, Any]]:
    rows = _db_request(
        "access_audit_logs",
        query_params=[
            ("select", "id,actor_user_id,actor_email,action,target_user_id,target_email,details,created_at"),
            ("order", "created_at.desc"),
            ("limit", str(limit)),
        ],
    )
    return rows if isinstance(rows, list) else []


def _fetch_single_profile(user_id: str) -> dict[str, Any]:
    rows = _db_request(
        "profiles",
        query_params=[
            ("select", "id,email,full_name,global_role,is_active,created_at,updated_at"),
            ("id", f"eq.{user_id}"),
            ("limit", "1"),
        ],
    )
    if isinstance(rows, list) and rows:
        return rows[0]
    return {}


def _fetch_single_memberships(user_id: str) -> list[dict[str, Any]]:
    rows = _db_request(
        "property_memberships",
        query_params=[
            ("select", "id,user_id,property_id,role,is_active,created_at,updated_at"),
            ("user_id", f"eq.{user_id}"),
            ("order", "property_id.asc"),
        ],
    )
    return rows if isinstance(rows, list) else []


def _fetch_single_auth_user(user_id: str) -> dict[str, Any]:
    payload = _auth_admin_request(f"/admin/users/{user_id}")
    user = payload.get("user")
    if isinstance(user, dict):
        return user
    return payload if isinstance(payload, dict) else {}


def _build_user_access_snapshot(user_id: str) -> dict[str, Any]:
    profile = _fetch_single_profile(user_id)
    memberships = _fetch_single_memberships(user_id)
    auth_user = _fetch_single_auth_user(user_id)

    return {
        "userId": user_id,
        "email": auth_user.get("email") or profile.get("email") or "",
        "fullName": profile.get("full_name") or "",
        "globalRole": profile.get("global_role"),
        "isActive": bool(profile.get("is_active", True)),
        "memberships": [
            {
                "propertyId": str(membership.get("property_id") or ""),
                "role": membership.get("role"),
                "isActive": bool(membership.get("is_active")),
            }
            for membership in memberships
        ],
    }


def _log_access_audit_event(
    *,
    actor_user_id: str | None,
    actor_email: str | None,
    action: str,
    target_user_id: str | None,
    target_email: str | None,
    details: dict[str, Any],
) -> None:
    _db_request(
        "access_audit_logs",
        method="POST",
        payload={
            "actor_user_id": actor_user_id or None,
            "actor_email": (actor_email or "").strip() or None,
            "action": action,
            "target_user_id": target_user_id or None,
            "target_email": (target_email or "").strip() or None,
            "details": details,
        },
        prefer="return=minimal",
    )


def list_access_admin_payload() -> dict[str, Any]:
    roles = _fetch_roles()
    properties = _fetch_properties()
    profiles = _fetch_profiles()
    memberships = _fetch_memberships()
    auth_users = _fetch_auth_users()
    audit_logs = _fetch_access_audit_logs()

    properties_by_id = {str(row.get("id")): row for row in properties if row.get("id")}
    profiles_by_id = {str(row.get("id")): row for row in profiles if row.get("id")}
    memberships_by_user: dict[str, list[dict[str, Any]]] = {}

    for membership in memberships:
        user_id = str(membership.get("user_id") or "")
        property_id = str(membership.get("property_id") or "")
        memberships_by_user.setdefault(user_id, []).append(
            {
                "id": membership.get("id"),
                "propertyId": property_id,
                "propertyName": properties_by_id.get(property_id, {}).get("name") or property_id,
                "role": membership.get("role"),
                "isActive": bool(membership.get("is_active")),
            }
        )

    users: list[dict[str, Any]] = []
    for auth_user in auth_users:
        user_id = str(auth_user.get("id") or "")
        profile = profiles_by_id.get(user_id, {})
        users.append(
            {
                "id": user_id,
                "email": auth_user.get("email") or profile.get("email") or "",
                "fullName": profile.get("full_name") or "",
                "globalRole": profile.get("global_role"),
                "isActive": bool(profile.get("is_active", True)),
                "createdAt": auth_user.get("created_at") or profile.get("created_at"),
                "lastSignInAt": auth_user.get("last_sign_in_at"),
                "emailConfirmedAt": auth_user.get("email_confirmed_at"),
                "invitedAt": auth_user.get("invited_at"),
                "memberships": memberships_by_user.get(user_id, []),
            }
        )

    return {
        "status": "ok",
        "users": users,
        "roles": roles,
        "properties": properties,
        "auditLogs": audit_logs,
    }


def _replace_user_memberships(user_id: str, property_role: str | None, property_ids: list[str]) -> list[dict[str, Any]]:
    _db_request(
        "property_memberships",
        method="DELETE",
        query_params=[("user_id", f"eq.{user_id}")],
        prefer="return=minimal",
    )

    cleaned_property_ids = [str(property_id) for property_id in property_ids if str(property_id).strip()]
    if not property_role or not cleaned_property_ids:
        return []

    payload = [
        {
            "user_id": user_id,
            "property_id": property_id,
            "role": property_role,
            "is_active": True,
        }
        for property_id in cleaned_property_ids
    ]
    rows = _db_request(
        "property_memberships",
        method="POST",
        query_params=[("on_conflict", "user_id,property_id")],
        payload=payload,
        prefer="resolution=merge-duplicates,return=representation",
    )
    return rows if isinstance(rows, list) else []


def update_user_access_payload(
    user_id: str,
    *,
    full_name: str | None = None,
    global_role: str | None = None,
    property_role: str | None = None,
    property_ids: list[str] | None = None,
    is_active: bool = True,
    actor_user_id: str | None = None,
    actor_email: str | None = None,
    log_event: bool = True,
) -> dict[str, Any]:
    before_state = _build_user_access_snapshot(user_id)
    patch = {
        "full_name": (full_name or "").strip(),
        "global_role": global_role or None,
        "is_active": bool(is_active),
    }
    _db_request(
        "profiles",
        method="PATCH",
        query_params=[("id", f"eq.{user_id}")],
        payload=patch,
        prefer="return=representation",
    )

    memberships = _replace_user_memberships(
        user_id,
        property_role=property_role,
        property_ids=property_ids or [],
    )

    after_state = _build_user_access_snapshot(user_id)
    if log_event:
        _log_access_audit_event(
            actor_user_id=actor_user_id,
            actor_email=actor_email,
            action="update_user_access",
            target_user_id=user_id,
            target_email=after_state.get("email") or before_state.get("email") or "",
            details={
                "before": before_state,
                "after": after_state,
                "requestedGlobalRole": global_role or None,
                "requestedPropertyRole": property_role or None,
                "requestedPropertyIds": property_ids or [],
            },
        )

    return {
        "status": "ok",
        "userId": user_id,
        "globalRole": global_role or None,
        "propertyRole": property_role or None,
        "propertyIds": property_ids or [],
        "memberships": memberships,
    }


def invite_user_with_access_payload(
    *,
    email: str,
    full_name: str | None = None,
    redirect_to: str | None = None,
    global_role: str | None = None,
    property_role: str | None = None,
    property_ids: list[str] | None = None,
    actor_user_id: str | None = None,
    actor_email: str | None = None,
) -> dict[str, Any]:
    invite_payload = {
        "type": "invite",
        "email": email.strip(),
        "data": {"full_name": (full_name or "").strip()},
    }
    if redirect_to:
        invite_payload["redirect_to"] = redirect_to

    generated = _auth_admin_request(
        "/admin/generate_link",
        method="POST",
        payload=invite_payload,
    )
    user = generated.get("user") if isinstance(generated.get("user"), dict) else {}
    properties = generated.get("properties") if isinstance(generated.get("properties"), dict) else {}
    fallback_user = _find_auth_user_by_email(email)
    user_id = str(
        generated.get("id")
        or user.get("id")
        or properties.get("id")
        or fallback_user.get("id")
        or ""
    )
    if not user_id:
        raise RuntimeError("Supabase did not return a user id for the generated invite.")

    access_payload = update_user_access_payload(
        user_id,
        full_name=full_name,
        global_role=global_role,
        property_role=property_role,
        property_ids=property_ids or [],
        is_active=True,
        actor_user_id=actor_user_id,
        actor_email=actor_email,
        log_event=False,
    )

    _log_access_audit_event(
        actor_user_id=actor_user_id,
        actor_email=actor_email,
        action="invite_user",
        target_user_id=user_id,
        target_email=email.strip(),
        details={
            "fullName": (full_name or "").strip(),
            "globalRole": global_role or None,
            "propertyRole": property_role or None,
            "propertyIds": property_ids or [],
            "redirectTo": redirect_to or None,
        },
    )

    return {
        "status": "ok",
        "invite": {
            "email": email.strip(),
            "actionLink": generated.get("action_link") or properties.get("action_link"),
            "hashedToken": generated.get("hashed_token") or properties.get("hashed_token"),
            "userId": user_id,
        },
        "access": access_payload,
    }


def generate_user_password_reset_payload(
    user_id: str,
    *,
    redirect_to: str | None = None,
    actor_user_id: str | None = None,
    actor_email: str | None = None,
) -> dict[str, Any]:
    auth_user = _fetch_single_auth_user(user_id)
    email = str(auth_user.get("email") or "").strip()
    if not email:
        raise RuntimeError("Supabase did not return an email for that user.")

    recovery_payload = {
        "type": "recovery",
        "email": email,
    }
    if redirect_to:
        recovery_payload["redirect_to"] = redirect_to

    generated = _auth_admin_request(
        "/admin/generate_link",
        method="POST",
        payload=recovery_payload,
    )
    properties = generated.get("properties") if isinstance(generated.get("properties"), dict) else {}
    action_link = generated.get("action_link") or properties.get("action_link") or ""
    hashed_token = generated.get("hashed_token") or properties.get("hashed_token") or ""

    _log_access_audit_event(
        actor_user_id=actor_user_id,
        actor_email=actor_email,
        action="update_user_access",
        target_user_id=user_id,
        target_email=email,
        details={
            "operation": "generate_password_reset_link",
            "redirectTo": redirect_to or None,
        },
    )

    return {
        "status": "ok",
        "reset": {
            "email": email,
            "actionLink": action_link,
            "hashedToken": hashed_token,
            "userId": user_id,
        },
    }


def list_access_admin_summary() -> dict[str, Any]:
    try:
        return list_access_admin_payload()
    except (HTTPError, URLError, SupabaseValidationConfigError, RuntimeError) as error:
        return {"status": "error", "error": str(error)}


def update_user_access_summary(
    user_id: str,
    payload: dict[str, Any],
    *,
    actor_user_id: str | None = None,
    actor_email: str | None = None,
) -> dict[str, Any]:
    try:
        return update_user_access_payload(
            user_id,
            full_name=payload.get("fullName"),
            global_role=payload.get("globalRole"),
            property_role=payload.get("propertyRole"),
            property_ids=payload.get("propertyIds") if isinstance(payload.get("propertyIds"), list) else [],
            is_active=bool(payload.get("isActive", True)),
            actor_user_id=actor_user_id,
            actor_email=actor_email,
        )
    except (HTTPError, URLError, SupabaseValidationConfigError, RuntimeError) as error:
        return {"status": "error", "error": str(error)}


def invite_user_with_access_summary(
    payload: dict[str, Any],
    *,
    actor_user_id: str | None = None,
    actor_email: str | None = None,
) -> dict[str, Any]:
    try:
        return invite_user_with_access_payload(
            email=str(payload.get("email") or ""),
            full_name=payload.get("fullName"),
            redirect_to=payload.get("redirectTo"),
            global_role=payload.get("globalRole"),
            property_role=payload.get("propertyRole"),
            property_ids=payload.get("propertyIds") if isinstance(payload.get("propertyIds"), list) else [],
            actor_user_id=actor_user_id,
            actor_email=actor_email,
        )
    except (HTTPError, URLError, SupabaseValidationConfigError, RuntimeError) as error:
        return {"status": "error", "error": str(error)}


def generate_user_password_reset_summary(
    user_id: str,
    payload: dict[str, Any],
    *,
    actor_user_id: str | None = None,
    actor_email: str | None = None,
) -> dict[str, Any]:
    try:
        return generate_user_password_reset_payload(
            user_id,
            redirect_to=payload.get("redirectTo"),
            actor_user_id=actor_user_id,
            actor_email=actor_email,
        )
    except (HTTPError, URLError, SupabaseValidationConfigError, RuntimeError) as error:
        return {"status": "error", "error": str(error)}
