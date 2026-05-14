import json
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from render_supabase_sync_state import _post_rpc
from render_supabase_validation import (
    SupabaseValidationConfigError,
    _require_env,
    _supabase_anon_headers,
)


class RenderAuthError(RuntimeError):
    pass


class RenderPermissionError(RenderAuthError):
    pass


def extract_bearer_token(auth_header: str | None) -> str:
    if not auth_header:
        raise RenderAuthError("Missing Authorization header.")

    scheme, _, token = auth_header.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise RenderAuthError("Authorization header must use the Bearer scheme.")

    return token.strip()


def verify_supabase_jwt(access_token: str) -> dict[str, Any]:
    supabase_url = _require_env("SUPABASE_URL").rstrip("/")
    request = Request(
        f"{supabase_url}/auth/v1/user",
        headers=_supabase_anon_headers(access_token),
        method="GET",
    )
    try:
        with urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except (HTTPError, URLError, SupabaseValidationConfigError) as error:
        raise RenderAuthError(f"Invalid or expired Supabase access token: {error}") from error


def require_authenticated_user(auth_header: str | None) -> tuple[str, dict[str, Any]]:
    access_token = extract_bearer_token(auth_header)
    user = verify_supabase_jwt(access_token)
    return access_token, user


def user_has_property_permission(access_token: str, property_id: str, permission: str) -> bool:
    result = _post_rpc(
        "user_has_property_permission",
        {
            "target_property_id": str(property_id),
            "target_permission": permission,
        },
        headers=_supabase_anon_headers(access_token),
    )
    return bool(result)


def user_property_permissions(
    access_token: str,
    property_ids: list[str],
    permissions: tuple[str, ...],
) -> dict[str, set[str]]:
    normalized_property_ids = [str(property_id) for property_id in property_ids if str(property_id).strip()]
    normalized_permissions = [str(permission) for permission in permissions if str(permission).strip()]
    if not normalized_property_ids or not normalized_permissions:
        return {}

    try:
        rows = _post_rpc(
            "user_property_permissions_for_ids",
            {
                "target_property_ids": normalized_property_ids,
                "target_permissions": normalized_permissions,
            },
            headers=_supabase_anon_headers(access_token),
        )
    except (HTTPError, URLError, SupabaseValidationConfigError):
        rows = None

    if isinstance(rows, list):
        permissions_by_property: dict[str, set[str]] = {}
        for row in rows:
            if not isinstance(row, dict):
                continue
            property_id = str(row.get("property_id") or "")
            row_permissions = row.get("permissions") or []
            if property_id:
                permissions_by_property[property_id] = {str(permission) for permission in row_permissions}
        return permissions_by_property

    permissions_by_property: dict[str, set[str]] = {}
    for property_id in normalized_property_ids:
        allowed = {
            permission
            for permission in normalized_permissions
            if user_has_property_permission(access_token, property_id, permission)
        }
        if allowed:
            permissions_by_property[property_id] = allowed
    return permissions_by_property


def user_has_platform_permission(access_token: str, permission: str) -> bool:
    result = _post_rpc(
        "user_has_platform_permission",
        {
            "target_permission": permission,
        },
        headers=_supabase_anon_headers(access_token),
    )
    return bool(result)
