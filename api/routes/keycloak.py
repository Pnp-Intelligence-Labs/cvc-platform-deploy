"""
api/routes/keycloak.py — Keycloak OIDC SSO authentication.

Env vars (all optional; if absent, SSO is disabled and username/password login still works):
    KEYCLOAK_URL           Base URL of Keycloak, e.g. https://auth.company.com
    KEYCLOAK_REALM         Realm name, e.g. master or vertical-os
    KEYCLOAK_CLIENT_ID     OIDC client ID registered in Keycloak
    KEYCLOAK_CLIENT_SECRET Client secret (leave empty for public/PKCE clients)
    KEYCLOAK_DEFAULT_ROLE  Platform role assigned to new users (default: Ventures)
    KEYCLOAK_ROLE_CLAIM    KC token claim to read platform role from.
                           Supports dot-notation for nested claims:
                             - "realm_access.roles"  → claims["realm_access"]["roles"] (list)
                             - "realm_access"         → claims["realm_access"] (dict with "roles" key)
                             - "groups"               → claims["groups"] (flat list of strings)
                             - "role"                 → claims["role"] (plain string)
    PLATFORM_BASE_URL      App's public base URL, e.g. https://app.company.com
                           Used to build redirect_uri = {PLATFORM_BASE_URL}/app/auth/callback

Endpoints (prefix /auth/keycloak set in main.py):
    GET  /auth/keycloak/config    — public; returns {enabled, client_id}
    GET  /auth/keycloak/login-url — returns Keycloak authorize URL; accepts ?from=<path>
    POST /auth/keycloak/exchange  — exchanges KC code for platform JWT; called by callback page

Flow:
    1. Frontend GET /auth/keycloak/login-url?from=/ventures → navigates to KC
    2. KC authenticates user (Google OAuth, etc.) → redirects to /app/auth/callback?code=&state=
    3. Callback page POST /auth/keycloak/exchange {code, state} → platform JWT
    4. Frontend decodes state JWT to recover pre-auth destination; stores JWT; navigates there
"""

import os
import secrets
import threading
import time
from datetime import UTC, datetime, timedelta
from urllib.parse import urlencode

import requests as http
from fastapi import APIRouter, HTTPException, Query, Request
from jose import JWTError, jwt
from pydantic import BaseModel

from api.middleware.rate_limit import RateLimiter
from api.routes.auth import (
    JWT_ALGORITHM,
    JWT_SECRET,
    _create_access_token,
    _create_refresh_token,
    _get_ip,
    _log_auth_event,
)
from core.db.connection import get_connection

_exchange_limiter = RateLimiter(max_calls=10, period_seconds=60)  # 10 / min per IP

router = APIRouter()

KC_URL = os.environ.get("KEYCLOAK_URL", "").rstrip("/")
KC_REALM = os.environ.get("KEYCLOAK_REALM", "")
KC_CLIENT_ID = os.environ.get("KEYCLOAK_CLIENT_ID", "")
KC_CLIENT_SECRET = os.environ.get("KEYCLOAK_CLIENT_SECRET", "")
KC_DEFAULT_ROLE = os.environ.get("KEYCLOAK_DEFAULT_ROLE", "Ventures")
KC_ROLE_CLAIM = os.environ.get("KEYCLOAK_ROLE_CLAIM", "")
PLATFORM_BASE_URL = os.environ.get("PLATFORM_BASE_URL", "http://localhost:8002").rstrip("/")

_VALID_ROLES = {"GP", "Principal", "Director", "Member", "Ventures", "PSM", "Senior PSM"}

# Keycloak OIDC base path
_KC_OIDC = f"{KC_URL}/realms/{KC_REALM}/protocol/openid-connect"

# Redirect URI registered in Keycloak client — must match exactly
_REDIRECT_URI = f"{PLATFORM_BASE_URL}/app/auth/callback"

# --- JWKS cache (refreshed every hour; 60s back-off on failure) ---
_jwks_cache: dict | None = None
_jwks_cache_ts: float = 0.0
_jwks_lock = threading.Lock()
_JWKS_TTL = 3600
_JWKS_FAILURE_TTL = 60  # retry after 60s on error instead of immediately


def _kc_enabled() -> bool:
    return bool(KC_URL and KC_REALM and KC_CLIENT_ID)


def _get_jwks() -> dict:
    """Fetch and cache Keycloak JWKS. Thread-safe with double-checked locking."""
    global _jwks_cache, _jwks_cache_ts
    # Fast path: return cache if fresh (no lock needed)
    if _jwks_cache is not None and time.time() - _jwks_cache_ts <= _JWKS_TTL:
        return _jwks_cache
    with _jwks_lock:
        # Re-check inside lock — another thread may have just fetched
        if _jwks_cache is not None and time.time() - _jwks_cache_ts <= _JWKS_TTL:
            return _jwks_cache
        try:
            resp = http.get(f"{_KC_OIDC}/certs", timeout=10)
            resp.raise_for_status()
            _jwks_cache = resp.json()
            _jwks_cache_ts = time.time()
        except http.exceptions.RequestException as e:
            # Bump timestamp so the next retry is 60s away, not immediate
            _jwks_cache_ts = time.time() - _JWKS_TTL + _JWKS_FAILURE_TTL
            raise HTTPException(status_code=502, detail=f"Cannot reach Keycloak JWKS: {e}")
    assert _jwks_cache is not None
    return _jwks_cache


# --- State: signed short-lived JWT so no server-side session storage needed ---
# Works across multiple replicas without shared state.
# "typ": "oidc_state" prevents cross-use with platform session JWTs (same secret/algorithm).
# "from": path encodes the pre-auth destination so it survives the full-page Keycloak redirect.

def _make_state(from_path: str = "/") -> str:
    payload = {
        "nonce": secrets.token_hex(16),
        "typ":   "oidc_state",
        "from":  from_path,
        "exp":   datetime.now(UTC) + timedelta(minutes=10),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def _verify_state(state: str) -> None:
    try:
        payload = jwt.decode(state, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=400, detail="Invalid or expired OAuth state — please start login again")
    if payload.get("typ") != "oidc_state":
        raise HTTPException(status_code=400, detail="Invalid state token type")


# --- Role extraction ---

def _extract_role(claims: dict) -> str:
    """Extract platform role from KC ID token claims.

    KC_ROLE_CLAIM supports dot-notation: "realm_access.roles" traverses
    claims["realm_access"]["roles"]. A plain key like "groups" works as before.
    """
    if not KC_ROLE_CLAIM:
        return KC_DEFAULT_ROLE

    # Dot-notation traversal: "realm_access.roles" → claims["realm_access"]["roles"]
    keys = KC_ROLE_CLAIM.split(".")
    raw: object = claims
    for key in keys:
        if not isinstance(raw, dict):
            return KC_DEFAULT_ROLE
        raw = raw.get(key)  # type: ignore[assignment]
        if raw is None:
            return KC_DEFAULT_ROLE

    if isinstance(raw, list):
        for item in raw:
            if item in _VALID_ROLES:
                return item
    elif isinstance(raw, dict):
        # Keycloak realm_access format: {"roles": ["GP", ...]}
        for r in raw.get("roles", []):
            if r in _VALID_ROLES:
                return r
    elif isinstance(raw, str) and raw in _VALID_ROLES:
        return raw
    return KC_DEFAULT_ROLE


# --- User auto-provisioning ---

def _provision_user(claims: dict) -> dict:
    """Upsert user from Keycloak ID token claims. Returns user dict for _create_token."""
    kc_sub = claims["sub"]
    email = claims.get("email", "")
    full_name = (
        claims.get("name")
        or f"{claims.get('given_name', '')} {claims.get('family_name', '')}".strip()
        or None
    )
    username = (claims.get("preferred_username") or email or kc_sub).lower()
    role = _extract_role(claims)

    with get_connection() as conn:
        with conn.cursor() as cur:
            # 1. Look up by KC subject (fast path after first login)
            cur.execute(
                "SELECT id, username, role, full_name, assigned_partner_ids, is_active "
                "FROM cvc.users WHERE keycloak_sub = %s AND is_active = TRUE",
                (kc_sub,),
            )
            user = cur.fetchone()
            if user and not user.get("is_active"):
                raise HTTPException(status_code=403, detail="Account is deactivated")

            if not user and email:
                # 2. Existing user signing in via KC for the first time — match by email.
                # Only link if Keycloak has verified the email; unverified emails allow
                # account takeover if an attacker controls the KC identity provider.
                email_verified = claims.get("email_verified", False)
                if not email_verified:
                    raise HTTPException(
                        status_code=403,
                        detail="Keycloak email is not verified — cannot link to existing account",
                    )
                cur.execute(
                    "SELECT id, username, role, full_name, assigned_partner_ids, is_active "
                    "FROM cvc.users WHERE email = %s AND is_active = TRUE",
                    (email,),
                )
                user = cur.fetchone()
                if user and not user.get("is_active"):
                    raise HTTPException(status_code=403, detail="Account is deactivated")
                if user:
                    cur.execute(
                        "UPDATE cvc.users SET keycloak_sub = %s, updated_at = NOW() WHERE id = %s",
                        (kc_sub, user["id"]),
                    )

            if not user:
                # 3. Brand-new user — provision (or re-link on username conflict)
                cur.execute(
                    """
                    INSERT INTO cvc.users (username, keycloak_sub, role, full_name, email, is_active)
                    VALUES (%s, %s, %s, %s, %s, TRUE)
                    ON CONFLICT (username) DO UPDATE
                        SET keycloak_sub = EXCLUDED.keycloak_sub,
                            role         = EXCLUDED.role,
                            full_name    = COALESCE(EXCLUDED.full_name, cvc.users.full_name),
                            email        = COALESCE(EXCLUDED.email, cvc.users.email),
                            updated_at   = NOW()
                    RETURNING id, username, role, full_name, assigned_partner_ids, is_active
                    """,
                    (username, kc_sub, role, full_name, email or None),
                )
                user = cur.fetchone()
                if user and not user.get("is_active"):
                    raise HTTPException(status_code=403, detail="Account is deactivated")

        conn.commit()

    return dict(user)


# --- Endpoints ---

@router.get("/config")
def keycloak_config():
    """Public. Returns whether Keycloak SSO is enabled for this deployment."""
    return {
        "enabled": _kc_enabled(),
        "client_id": KC_CLIENT_ID if _kc_enabled() else None,
    }


@router.get("/login-url")
def login_url(from_path: str = Query(default="/", alias="from")):
    """Return the Keycloak authorize URL. Frontend navigates the browser to it.

    The optional ?from=<path> parameter encodes the pre-auth destination in the
    signed state JWT so OIDCCallback can restore it after the Keycloak redirect.
    """
    if not _kc_enabled():
        raise HTTPException(status_code=501, detail="Keycloak SSO not configured on this deployment")

    state = _make_state(from_path)
    params = {
        "client_id": KC_CLIENT_ID,
        "redirect_uri": _REDIRECT_URI,
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
    }
    url = f"{_KC_OIDC}/auth?{urlencode(params)}"
    return {"url": url}


class ExchangeRequest(BaseModel):
    code: str
    state: str


@router.post("/exchange")
def exchange(body: ExchangeRequest, request: Request):
    """Exchange KC authorization code for a platform JWT.
    Called by the frontend /app/auth/callback page.
    Returns the same shape as POST /auth/login so the frontend can use
    the same localStorage storage logic.
    """
    if not _kc_enabled():
        raise HTTPException(status_code=501, detail="Keycloak SSO not configured on this deployment")

    ip = _get_ip(request)
    ua = request.headers.get("User-Agent", "")

    if not _exchange_limiter.is_allowed(ip):
        _log_auth_event(
            "sso_rate_limited",
            ip_address=ip,
            user_agent=ua,
            success=False,
            detail="Rate limit exceeded on /keycloak/exchange",
        )
        raise HTTPException(status_code=429, detail="Too many SSO exchange requests — try again shortly")

    _verify_state(body.state)

    # Exchange authorization code for KC tokens
    token_data: dict = {
        "grant_type": "authorization_code",
        "code": body.code,
        "redirect_uri": _REDIRECT_URI,
        "client_id": KC_CLIENT_ID,
    }
    if KC_CLIENT_SECRET:
        token_data["client_secret"] = KC_CLIENT_SECRET

    try:
        resp = http.post(f"{_KC_OIDC}/token", data=token_data, timeout=15)
        resp.raise_for_status()
    except http.exceptions.RequestException as e:
        raise HTTPException(status_code=502, detail=f"KC token exchange failed: {e}")

    tokens = resp.json()
    id_token = tokens.get("id_token")
    if not id_token:
        raise HTTPException(status_code=502, detail="Keycloak did not return an id_token — check openid scope is enabled")

    # Validate ID token signature using KC's JWKS
    try:
        jwks = _get_jwks()
        claims = jwt.decode(
            id_token,
            jwks,
            algorithms=["RS256"],
            audience=KC_CLIENT_ID,
            options={"verify_at_hash": False},
        )
    except JWTError as e:
        raise HTTPException(status_code=401, detail=f"ID token validation failed: {e}")

    user = _provision_user(claims)

    _log_auth_event(
        "sso_login",
        user_id=user["id"],
        username=user["username"],
        ip_address=ip,
        user_agent=ua,
        success=True,
        detail=f"KC sub={claims.get('sub', '')[:16]}",
    )

    return {
        "access_token": _create_access_token(user),
        "refresh_token": _create_refresh_token(user),
        "token_type": "bearer",
        "username": user["username"],
        "role": user["role"],
        "full_name": user["full_name"],
    }
