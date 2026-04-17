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


def user_has_platform_permission(access_token: str, permission: str) -> bool:
    result = _post_rpc(
        "user_has_platform_permission",
        {
            "target_permission": permission,
        },
        headers=_supabase_anon_headers(access_token),
    )
    return bool(result)
