"""
api/routes/auth.py — JWT authentication for CVC Intelligence Platform.

Endpoints (prefix /auth set in main.py):
    POST /auth/login                      — username + password → dual JWT tokens
    POST /auth/mfa/challenge              — complete MFA step → full tokens
    POST /auth/refresh                    — {refresh_token} → new dual tokens
    GET  /auth/me                         — token → current user + role
    GET  /auth/team                       — active team list
    GET  /auth/users                      — list all users (admin only)
    POST /auth/users                      — create user (admin only)
    PATCH  /auth/users/{id}              — update user
    DELETE /auth/users/{id}              — deactivate user (GP only)
    POST /auth/users/{id}/reset-password — reset password
    DELETE /auth/users/{id}/lockout      — unlock account (GP only)
    POST /auth/avatar                    — upload avatar

Compliance controls (ISO 27001 A.8.5 / NIST 3.3+3.5 / SOC 2 CC6.1):
    - Rate limiting on /login (5 / 15 min per IP) — Phase 1
    - Auth event logging to cvc.auth_events — Phase 1
    - Token revocation via token_invalidated_at — Phase 1
    - Password policy: 12-char min, complexity, HIBP, history — Phase 2
    - Account lockout: 5 failures → 30-min lock, DB-backed — Phase 2
    - Dual-token: 15-min access + 8-hour refresh tokens — Phase 2
    - MFA challenge flow for TOTP-enrolled users — Phase 2
"""

import hashlib
import os
import re
import shutil
from datetime import UTC, datetime, timedelta
from pathlib import Path
from urllib.parse import urlencode
from uuid import uuid4

import bcrypt
import requests as http
from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from fastapi.responses import RedirectResponse
from fastapi.security import HTTPBearer
from jose import JWTError, jwt
from pydantic import BaseModel

from api.middleware.rate_limit import RateLimiter
from core.db.connection import get_connection

AVATARS_DIR = Path(__file__).parent.parent / "static" / "avatars"
AVATARS_DIR.mkdir(parents=True, exist_ok=True)
_ALLOWED_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}

router = APIRouter()

_jwt_secret_raw = os.environ.get("JWT_SECRET")
if not _jwt_secret_raw:
    raise RuntimeError("JWT_SECRET is required. Set it in the environment or local .env file.")
JWT_SECRET: str = _jwt_secret_raw
JWT_ALGORITHM = "HS256"
JWT_ACCESS_MINUTES = 15
JWT_REFRESH_HOURS = 8

# Roles that MUST have MFA enabled to log in. Default: none enforced.
_MFA_REQUIRED_ROLES = {
    r.strip() for r in os.environ.get("MFA_REQUIRED_ROLES", "").split(",") if r.strip()
}
_HIBP_ENABLED = os.environ.get("HIBP_CHECK_ENABLED", "true").lower() == "true"

_bearer = HTTPBearer(auto_error=False)

# Rate limiters
_login_limiter = RateLimiter(max_calls=5, period_seconds=900)     # 5 / 15 min per IP
_create_limiter = RateLimiter(max_calls=20, period_seconds=3600)  # 20 / hr per caller


# ── Models ────────────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    username: str
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str


class MFAChallengeRequest(BaseModel):
    mfa_token: str
    totp_code: str


class TokenResponse(BaseModel):
    # Full-auth fields (access + refresh returned together)
    access_token: str | None = None
    refresh_token: str | None = None
    token_type: str = "bearer"
    username: str | None = None
    role: str | None = None
    full_name: str | None = None
    # MFA challenge: mfa_required=True means the caller must POST /auth/mfa/challenge
    mfa_required: bool = False
    mfa_token: str | None = None


class UserInfo(BaseModel):
    user_id: int
    username: str
    role: str
    full_name: str | None
    assigned_partner_ids: list[int]


# ── Token helpers ─────────────────────────────────────────────────────────────

def _create_access_token(user: dict) -> str:
    now = datetime.now(UTC)
    return jwt.encode(
        {
            "sub": str(user["id"]),
            "username": user["username"],
            "role": user["role"],
            "full_name": user["full_name"],
            "assigned_partner_ids": user["assigned_partner_ids"] or [],
            "typ": "access",
            "jti": str(uuid4()),
            "iat": now,
            "exp": now + timedelta(minutes=JWT_ACCESS_MINUTES),
        },
        JWT_SECRET,
        algorithm=JWT_ALGORITHM,
    )


def _create_refresh_token(user: dict) -> str:
    now = datetime.now(UTC)
    return jwt.encode(
        {
            "sub": str(user["id"]),
            "typ": "refresh",
            "jti": str(uuid4()),
            "iat": now,
            "exp": now + timedelta(hours=JWT_REFRESH_HOURS),
        },
        JWT_SECRET,
        algorithm=JWT_ALGORITHM,
    )


# Alias kept for keycloak.py import compatibility (updated separately)
_create_token = _create_access_token


def _create_mfa_challenge_token(user: dict) -> str:
    now = datetime.now(UTC)
    return jwt.encode(
        {
            "sub": str(user["id"]),
            "username": user["username"],
            "typ": "mfa_challenge",
            "exp": now + timedelta(minutes=5),
        },
        JWT_SECRET,
        algorithm=JWT_ALGORITHM,
    )


def _decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )


# ── Auth event logging ────────────────────────────────────────────────────────

def _log_auth_event(
    event_type: str,
    *,
    user_id: int | None = None,
    username: str | None = None,
    ip_address: str | None = None,
    user_agent: str | None = None,
    success: bool = True,
    detail: str | None = None,
) -> None:
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO cvc.auth_events
                        (user_id, username, event_type, ip_address, user_agent, success, detail)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    """,
                    (user_id, username, event_type, ip_address, user_agent, success, detail),
                )
            conn.commit()
    except Exception:
        pass  # logging must never block authentication


def _get_ip(request: Request) -> str:
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


# ── Password policy helpers ───────────────────────────────────────────────────

_PW_SPECIAL = set(r"""!"#$%&'()*+,-./:;<=>?@[\]^_`{|}~""")


def _check_password_policy(password: str) -> None:
    """Raise HTTPException if password fails complexity requirements."""
    errors = []
    if len(password) < 12:
        errors.append("at least 12 characters")
    if not re.search(r"[A-Z]", password):
        errors.append("one uppercase letter")
    if not re.search(r"[a-z]", password):
        errors.append("one lowercase letter")
    if not re.search(r"\d", password):
        errors.append("one digit")
    if not any(c in _PW_SPECIAL for c in password):
        errors.append("one special character")
    if errors:
        raise HTTPException(
            status_code=400,
            detail=f"Password must contain: {', '.join(errors)}",
        )


def _check_hibp(password: str) -> str | None:
    """K-anonymity HIBP check. Returns breach message or None. Never raises."""
    if not _HIBP_ENABLED:
        return None
    try:
        sha1 = hashlib.sha1(password.encode()).hexdigest().upper()
        prefix, suffix = sha1[:5], sha1[5:]
        resp = http.get(
            f"https://api.pwnedpasswords.com/range/{prefix}",
            timeout=3,
            headers={"Add-Padding": "true"},
        )
        resp.raise_for_status()
        for line in resp.text.splitlines():
            h, count = line.split(":")
            if h == suffix:
                return f"Password found in {count.strip()} known data breach(es) — choose a different password"
    except Exception:
        pass  # fail open if HIBP unreachable
    return None


def _check_pw_history(user_id: int, password: str, conn) -> None:
    """Raise if password matches any of the last 5 hashes for this user."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT pw_hash FROM cvc.user_password_history WHERE user_id = %s ORDER BY created_at DESC LIMIT 5",
            (user_id,),
        )
        rows = cur.fetchall()
    for row in rows:
        if bcrypt.checkpw(password.encode(), row["pw_hash"].encode()):
            raise HTTPException(
                status_code=400,
                detail="Cannot reuse one of your last 5 passwords",
            )


def _record_pw_history(user_id: int, pw_hash: str, conn) -> None:
    """Store hash and prune to last 5."""
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO cvc.user_password_history (user_id, pw_hash) VALUES (%s, %s)",
            (user_id, pw_hash),
        )
        # Keep only the 5 most recent
        cur.execute(
            """
            DELETE FROM cvc.user_password_history
            WHERE user_id = %s
              AND id NOT IN (
                  SELECT id FROM cvc.user_password_history
                  WHERE user_id = %s
                  ORDER BY created_at DESC
                  LIMIT 5
              )
            """,
            (user_id, user_id),
        )


# ── Account lockout helpers ───────────────────────────────────────────────────

_LOCKOUT_MAX_ATTEMPTS = 5
_LOCKOUT_DURATION_MIN = 30


def _check_lockout(user_id: int, conn) -> None:
    """Raise 423 if account is currently locked."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT locked_until FROM cvc.auth_lockouts WHERE user_id = %s",
            (user_id,),
        )
        row = cur.fetchone()
    if not row or row["locked_until"] is None:
        return
    locked_until = row["locked_until"]
    if locked_until.tzinfo is None:
        locked_until = locked_until.replace(tzinfo=UTC)
    if datetime.now(UTC) < locked_until:
        raise HTTPException(
            status_code=status.HTTP_423_LOCKED,
            detail=f"Account locked after too many failed attempts. Try again after {locked_until.strftime('%H:%M UTC')}",
        )


def _record_failure(user_id: int, conn) -> None:
    """Increment failure count; lock account if threshold reached."""
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO cvc.auth_lockouts (user_id, attempt_count, locked_until)
            VALUES (%s, 1, NULL)
            ON CONFLICT (user_id) DO UPDATE
                SET attempt_count = cvc.auth_lockouts.attempt_count + 1,
                    locked_until  = CASE
                        WHEN cvc.auth_lockouts.attempt_count + 1 >= %s
                        THEN NOW() + INTERVAL '%s minutes'
                        ELSE NULL
                    END,
                    updated_at = NOW()
            """,
            (user_id, _LOCKOUT_MAX_ATTEMPTS, _LOCKOUT_DURATION_MIN),
        )


def _clear_lockout(user_id: int, conn) -> None:
    with conn.cursor() as cur:
        cur.execute("DELETE FROM cvc.auth_lockouts WHERE user_id = %s", (user_id,))


# ── Token revocation check ────────────────────────────────────────────────────

def require_jwt(credentials=Depends(_bearer)) -> UserInfo:
    """FastAPI dependency — validates JWT (access type only) and checks revocation."""
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
        )
    payload = _decode_token(credentials.credentials)

    # Reject non-access tokens (refresh, mfa_challenge, oidc_state)
    if payload.get("typ") not in ("access", None):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token type",
        )

    user_id = int(payload["sub"])

    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT is_active, token_invalidated_at FROM cvc.users WHERE id = %s",
                    (user_id,),
                )
                row = cur.fetchone()
    except Exception:
        row = None

    if row:
        if not row["is_active"]:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Account is deactivated",
            )
        invalidated_at = row["token_invalidated_at"]
        if invalidated_at is not None:
            iat = payload.get("iat")
            if iat is not None:
                iat_dt = (
                    iat.replace(tzinfo=UTC)
                    if isinstance(iat, datetime) and iat.tzinfo is None
                    else iat
                    if isinstance(iat, datetime)
                    else datetime.fromtimestamp(iat, tz=UTC)
                )
                if invalidated_at.tzinfo is None:
                    invalidated_at = invalidated_at.replace(tzinfo=UTC)
                if iat_dt <= invalidated_at:
                    raise HTTPException(
                        status_code=status.HTTP_401_UNAUTHORIZED,
                        detail="Session invalidated — please log in again",
                    )

    return UserInfo(
        user_id=user_id,
        username=payload["username"],
        role=payload["role"],
        full_name=payload.get("full_name"),
        assigned_partner_ids=payload.get("assigned_partner_ids", []),
    )


# ── Shared user fetch helper ──────────────────────────────────────────────────

def _fetch_user_for_token(user_id: int) -> dict:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, username, role, full_name, assigned_partner_ids "
                "FROM cvc.users WHERE id = %s AND is_active = TRUE",
                (user_id,),
            )
            row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return dict(row)


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/login")
def login(body: LoginRequest, request: Request):
    """Authenticate with username + password.

    Returns dual tokens (access + refresh) on success.
    Returns {mfa_required: true, mfa_token: ...} when the user has MFA enabled.
    """
    ip = _get_ip(request)
    ua = request.headers.get("User-Agent", "")

    if not _login_limiter.is_allowed(ip):
        _log_auth_event(
            "login_rate_limited",
            username=body.username.strip().lower(),
            ip_address=ip,
            user_agent=ua,
            success=False,
            detail="Rate limit exceeded",
        )
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many login attempts — try again in 15 minutes",
        )

    username = body.username.strip().lower()

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, username, password_hash, role, full_name, assigned_partner_ids,
                       mfa_enabled
                FROM cvc.users
                WHERE username = %s AND is_active = TRUE
                """,
                (username,),
            )
            user = cur.fetchone()

        if not user:
            _log_auth_event(
                "login_failure",
                username=username,
                ip_address=ip,
                user_agent=ua,
                success=False,
                detail="User not found",
            )
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid username or password",
            )

        user = dict(user)

        # Check account lockout before verifying password
        _check_lockout(user["id"], conn)

        if not bcrypt.checkpw(body.password.encode(), user["password_hash"].encode()):
            _record_failure(user["id"], conn)
            conn.commit()
            _log_auth_event(
                "login_failure",
                user_id=user["id"],
                username=username,
                ip_address=ip,
                user_agent=ua,
                success=False,
                detail="Wrong password",
            )
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid username or password",
            )

        # Successful password — clear lockout
        _clear_lockout(user["id"], conn)
        conn.commit()

    # Check MFA: role requires it but user hasn't enrolled
    if user["role"] in _MFA_REQUIRED_ROLES and not user["mfa_enabled"]:
        raise HTTPException(
            status_code=400,
            detail="MFA is required for your role. Set it up via POST /auth/mfa/setup before logging in.",
        )

    # MFA enrolled — issue challenge token instead of full auth
    if user["mfa_enabled"]:
        mfa_tok = _create_mfa_challenge_token(user)
        _log_auth_event(
            "mfa_challenge_issued",
            user_id=user["id"],
            username=username,
            ip_address=ip,
            user_agent=ua,
            success=True,
        )
        return {"mfa_required": True, "mfa_token": mfa_tok}

    # No MFA — return full token pair
    _login_limiter.reset(ip)
    _log_auth_event(
        "login_success",
        user_id=user["id"],
        username=username,
        ip_address=ip,
        user_agent=ua,
        success=True,
    )
    return {
        "access_token": _create_access_token(user),
        "refresh_token": _create_refresh_token(user),
        "token_type": "bearer",
        "username": user["username"],
        "role": user["role"],
        "full_name": user["full_name"],
    }


@router.post("/mfa/challenge")
def mfa_challenge(body: MFAChallengeRequest, request: Request):
    """Complete MFA step: validate challenge token + TOTP code → return full tokens."""
    try:
        payload = jwt.decode(body.mfa_token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired MFA token — restart login")

    if payload.get("typ") != "mfa_challenge":
        raise HTTPException(status_code=400, detail="Invalid token type")

    user_id = int(payload["sub"])
    ip = _get_ip(request)
    ua = request.headers.get("User-Agent", "")

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, username, role, full_name, assigned_partner_ids, mfa_enabled, mfa_secret_enc "
                "FROM cvc.users WHERE id = %s AND is_active = TRUE",
                (user_id,),
            )
            user = cur.fetchone()

    if not user or not user["mfa_enabled"] or not user["mfa_secret_enc"]:
        raise HTTPException(status_code=400, detail="MFA not configured for this account")

    try:
        import pyotp

        from api.routes.mfa import _decrypt_secret
        secret = _decrypt_secret(user["mfa_secret_enc"])
        if not pyotp.TOTP(secret).verify(body.totp_code.strip(), valid_window=1):
            _log_auth_event(
                "mfa_failure",
                user_id=user_id,
                username=user["username"],
                ip_address=ip,
                user_agent=ua,
                success=False,
                detail="Wrong TOTP code",
            )
            raise HTTPException(status_code=401, detail="Invalid MFA code")
    except ImportError:
        raise HTTPException(status_code=503, detail="MFA not available — pyotp not installed")

    _log_auth_event(
        "mfa_success",
        user_id=user_id,
        username=user["username"],
        ip_address=ip,
        user_agent=ua,
        success=True,
    )
    user = dict(user)
    return {
        "access_token": _create_access_token(user),
        "refresh_token": _create_refresh_token(user),
        "token_type": "bearer",
        "username": user["username"],
        "role": user["role"],
        "full_name": user["full_name"],
    }


@router.post("/refresh")
def refresh_token(body: RefreshRequest, request: Request):
    """Exchange a valid refresh token for a new access + refresh token pair."""
    try:
        payload = jwt.decode(body.refresh_token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired refresh token")

    if payload.get("typ") != "refresh":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token type")

    user = _fetch_user_for_token(int(payload["sub"]))

    _log_auth_event(
        "token_refresh",
        user_id=user["id"],
        username=user["username"],
        ip_address=_get_ip(request),
        success=True,
    )
    return {
        "access_token": _create_access_token(user),
        "refresh_token": _create_refresh_token(user),
        "token_type": "bearer",
        "username": user["username"],
        "role": user["role"],
        "full_name": user["full_name"],
    }


@router.get("/me", response_model=UserInfo)
def get_me(user: UserInfo = Depends(require_jwt)):
    return user


_ADMIN_ROLES = {"GP", "Principal", "Director"}

PLATFORM_PERMISSIONS = [
    {"key": "partner_servicing",  "label": "Partner Servicing",  "desc": "PSM workflows — partner health, intros, partner requests"},
    {"key": "ventures_pipeline",  "label": "Ventures Pipeline",  "desc": "Company pipeline, DD evaluations, venture assignments"},
    {"key": "admin_panel",        "label": "Admin Panel",        "desc": "Admin command center and user management"},
    {"key": "data_explorer",      "label": "Data Explorer",      "desc": "Raw data browsing"},
    {"key": "requests_mgmt",      "label": "Requests",           "desc": "Create and manage partner/team requests"},
]

ROLE_DEFAULTS: dict[str, list[str]] = {
    "GP":         ["partner_servicing", "ventures_pipeline", "admin_panel", "data_explorer", "requests_mgmt"],
    "Principal":  ["partner_servicing", "ventures_pipeline", "admin_panel", "data_explorer", "requests_mgmt"],
    "Director":   ["partner_servicing", "ventures_pipeline", "admin_panel", "data_explorer", "requests_mgmt"],
    "Ventures":   ["ventures_pipeline", "requests_mgmt"],
    "Senior PSM": ["partner_servicing", "requests_mgmt", "data_explorer"],
    "PSM":        ["partner_servicing", "requests_mgmt"],
}


def _get_custom_grants(cur, user_id: int) -> list[str]:
    """Return per-user custom permission grants from cvc.user_permissions."""
    cur.execute("SELECT permission FROM cvc.user_permissions WHERE user_id = %s ORDER BY granted_at", (user_id,))
    return [r["permission"] for r in cur.fetchall()]


@router.get("/users")
def list_users(caller: UserInfo = Depends(require_jwt)):
    if caller.role not in _ADMIN_ROLES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, username, role, full_name, email, assigned_partner_ids, is_active, "
                "mfa_enabled, created_at FROM cvc.users ORDER BY role, username"
            )
            rows = cur.fetchall()
            result = []
            for r in rows:
                row = dict(r)
                row["custom_permissions"] = _get_custom_grants(cur, row["id"])
                result.append(row)
    return {"users": result}


class CreateUserRequest(BaseModel):
    username: str
    password: str
    role: str
    full_name: str = ""
    email: str = ""


@router.post("/users", status_code=201)
def create_user(body: CreateUserRequest, request: Request, caller: UserInfo = Depends(require_jwt)):
    if caller.role not in _ADMIN_ROLES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")

    if not _create_limiter.is_allowed(f"create:{caller.user_id}"):
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Too many user creation requests")

    valid_roles = {"GP", "Principal", "Director", "Ventures", "PSM", "Senior PSM"}
    if body.role not in valid_roles:
        raise HTTPException(status_code=400, detail=f"Invalid role. Must be one of: {', '.join(sorted(valid_roles))}")

    username = body.username.strip().lower()
    if not username:
        raise HTTPException(status_code=400, detail="username is required")

    # Phase 2: full password policy
    _check_password_policy(body.password)
    hibp_msg = _check_hibp(body.password)
    if hibp_msg:
        raise HTTPException(status_code=400, detail=hibp_msg)

    pw_hash = bcrypt.hashpw(body.password.encode(), bcrypt.gensalt()).decode()

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM cvc.users WHERE username = %s", (username,))
            if cur.fetchone():
                raise HTTPException(status_code=409, detail=f"Username '{username}' already exists")
            cur.execute(
                "INSERT INTO cvc.users (username, password_hash, role, full_name, email) "
                "VALUES (%s, %s, %s, %s, %s) RETURNING id, username, role, full_name, email, is_active, created_at",
                (username, pw_hash, body.role, body.full_name.strip(), body.email.strip()),
            )
            row = dict(cur.fetchone())
            _record_pw_history(row["id"], pw_hash, conn)
        conn.commit()

    _log_auth_event(
        "user_created",
        user_id=row["id"],
        username=username,
        ip_address=_get_ip(request),
        success=True,
        detail=f"Created by {caller.username} (role={body.role})",
    )
    return row


@router.delete("/users/{user_id}", status_code=200)
def deactivate_user(user_id: int, request: Request, caller: UserInfo = Depends(require_jwt)):
    if caller.role != "GP":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only GP can deactivate users")
    if caller.user_id == user_id:
        raise HTTPException(status_code=400, detail="Cannot deactivate your own account")
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE cvc.users SET is_active = FALSE, token_invalidated_at = NOW(), updated_at = NOW() "
                "WHERE id = %s RETURNING id, username",
                (user_id,),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="User not found")
        conn.commit()

    _log_auth_event(
        "user_deactivated",
        user_id=row["id"],
        username=row["username"],
        ip_address=_get_ip(request),
        success=True,
        detail=f"Deactivated by {caller.username}",
    )
    return {"deactivated": True, "user_id": row["id"], "username": row["username"]}


@router.post("/users/{user_id}/reset-password", status_code=200)
def reset_password(user_id: int, body: dict, request: Request, caller: UserInfo = Depends(require_jwt)):
    """Reset password — enforces policy + history + revokes all existing tokens."""
    is_self = caller.user_id == user_id
    if not is_self and caller.role not in _ADMIN_ROLES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")

    new_password = (body.get("password") or "").strip()

    # Phase 2: full password policy
    _check_password_policy(new_password)
    hibp_msg = _check_hibp(new_password)
    if hibp_msg:
        raise HTTPException(status_code=400, detail=hibp_msg)

    pw_hash = bcrypt.hashpw(new_password.encode(), bcrypt.gensalt()).decode()

    with get_connection() as conn:
        # History check requires existing hashes
        _check_pw_history(user_id, new_password, conn)
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE cvc.users SET password_hash = %s, token_invalidated_at = NOW(), updated_at = NOW() "
                "WHERE id = %s RETURNING id, username",
                (pw_hash, user_id),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="User not found")
        _record_pw_history(user_id, pw_hash, conn)
        conn.commit()

    _log_auth_event(
        "password_reset",
        user_id=row["id"],
        username=row["username"],
        ip_address=_get_ip(request),
        success=True,
        detail="self" if is_self else f"Reset by {caller.username}",
    )
    return {"updated": True}


@router.delete("/users/{user_id}/lockout", status_code=200)
def unlock_user(user_id: int, request: Request, caller: UserInfo = Depends(require_jwt)):
    """Manually unlock a locked account. GP only."""
    if caller.role != "GP":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only GP can unlock accounts")
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT username FROM cvc.users WHERE id = %s", (user_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="User not found")
        _clear_lockout(user_id, conn)
        conn.commit()
    _log_auth_event(
        "account_unlocked",
        user_id=user_id,
        username=row["username"],
        ip_address=_get_ip(request),
        success=True,
        detail=f"Unlocked by {caller.username}",
    )
    return {"unlocked": True, "user_id": user_id}


@router.get("/team")
def list_team(caller: UserInfo = Depends(require_jwt)):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT username, full_name, role FROM cvc.users WHERE is_active = TRUE ORDER BY username"
            )
            rows = cur.fetchall()
    return {"team": [{"username": r["username"], "full_name": r["full_name"], "role": r["role"]} for r in rows]}


@router.patch("/users/{user_id}")
def update_user(user_id: int, body: dict, request: Request, caller: UserInfo = Depends(require_jwt)):
    """Update role, assigned_partner_ids, full_name, or is_active. Admin only."""
    if caller.role not in _ADMIN_ROLES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")

    allowed = {"role", "full_name", "assigned_partner_ids", "is_active"}
    updates = {k: v for k, v in body.items() if k in allowed}
    if not updates:
        raise HTTPException(status_code=400, detail="No valid fields to update")

    set_parts = []
    values = []
    if updates.get("is_active") is False:
        set_parts.append("token_invalidated_at = NOW()")
    for k, v in updates.items():
        set_parts.append(f"{k} = %s")
        values.append(v)

    values.append(user_id)
    set_clause = ", ".join(set_parts)

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"UPDATE cvc.users SET {set_clause}, updated_at = NOW() WHERE id = %s "
                f"RETURNING id, username, role, full_name, email, assigned_partner_ids, is_active",
                values,
            )
            row = cur.fetchone()
            conn.commit()

    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    return dict(row)


@router.post("/avatar", status_code=200)
async def upload_avatar(file: UploadFile = File(...), user: UserInfo = Depends(require_jwt)):
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in _ALLOWED_EXTS:
        raise HTTPException(400, "File must be jpg, jpeg, png, webp, or gif")
    for old in AVATARS_DIR.glob(f"{user.username}.*"):
        old.unlink(missing_ok=True)
    dest = AVATARS_DIR / f"{user.username}{suffix}"
    with dest.open("wb") as f:
        shutil.copyfileobj(file.file, f)
    return {"url": f"/static/avatars/{user.username}{suffix}"}



@router.post("/refresh", response_model=TokenResponse)
def refresh_token_jwt(user: UserInfo = Depends(require_jwt)):
    """Issue a fresh token for the current authenticated user."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, username, role, full_name, assigned_partner_ids FROM cvc.users WHERE id = %s AND is_active = TRUE",
                (user.user_id,),
            )
            db_user = cur.fetchone()

    if not db_user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    token = _create_token(dict(db_user))

    return TokenResponse(
        access_token=token,
        username=db_user["username"],
        role=db_user["role"],
        full_name=db_user["full_name"],
    )


# ── Google OAuth ──────────────────────────────────────────────────────────────

_GOOGLE_AUTH_URL     = "https://accounts.google.com/o/oauth2/v2/auth"
_GOOGLE_TOKEN_URL    = "https://oauth2.googleapis.com/token"
_GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"


@router.get("/google")
def google_login():
    """Redirect browser to Google's OAuth consent screen."""
    client_id  = os.environ.get("GOOGLE_CLIENT_ID", "")
    base_url   = os.environ.get("APP_BASE_URL", "http://localhost:8002").rstrip("/")
    if not client_id:
        raise HTTPException(status_code=501, detail="Google OAuth not configured")
    params = urlencode({
        "client_id":     client_id,
        "redirect_uri":  f"{base_url}/auth/google/callback",
        "response_type": "code",
        "scope":         "openid email profile",
        "access_type":   "offline",
        "prompt":        "select_account",
    })
    return RedirectResponse(f"{_GOOGLE_AUTH_URL}?{params}")


@router.get("/google/callback")
def google_callback(code: str = None, error: str = None):
    """Handle Google OAuth callback — exchange code, match user, issue JWT."""
    base_url = os.environ.get("APP_BASE_URL", "http://localhost:8002").rstrip("/")
    app_login = f"{base_url}/app/login"

    if error or not code:
        return RedirectResponse(f"{app_login}?error=google_denied")

    # Exchange code for tokens
    token_resp = http.post(_GOOGLE_TOKEN_URL, data={
        "code":          code,
        "client_id":     os.environ.get("GOOGLE_CLIENT_ID", ""),
        "client_secret": os.environ.get("GOOGLE_CLIENT_SECRET", ""),
        "redirect_uri":  f"{base_url}/auth/google/callback",
        "grant_type":    "authorization_code",
    }, timeout=10)
    if not token_resp.ok:
        return RedirectResponse(f"{app_login}?error=google_token_failed")

    access_token = token_resp.json().get("access_token")

    # Fetch user info from Google
    info_resp = http.get(_GOOGLE_USERINFO_URL, headers={"Authorization": f"Bearer {access_token}"}, timeout=10)
    if not info_resp.ok:
        return RedirectResponse(f"{app_login}?error=google_userinfo_failed")

    info        = info_resp.json()
    google_sub  = str(info.get("id", ""))
    email       = info.get("email", "")

    # Optional domain restriction
    allowed_domain = os.environ.get("GOOGLE_ALLOWED_DOMAIN", "")
    if allowed_domain and not email.lower().endswith(f"@{allowed_domain.lower()}"):
        return RedirectResponse(f"{app_login}?error=domain_not_allowed")

    # Match user in DB
    with get_connection() as conn:
        with conn.cursor() as cur:
            # 1. Match by google_sub (returning visitors)
            cur.execute(
                "SELECT id, username, role, full_name, assigned_partner_ids, is_active FROM cvc.users WHERE google_sub = %s",
                [google_sub],
            )
            user = cur.fetchone()

            if not user:
                # 2. Match by email (first Google login — link the account)
                cur.execute(
                    "SELECT id, username, role, full_name, assigned_partner_ids, is_active FROM cvc.users WHERE email = %s",
                    [email],
                )
                user = cur.fetchone()
                if user:
                    cur.execute("UPDATE cvc.users SET google_sub = %s WHERE id = %s", [google_sub, user["id"]])
                    conn.commit()

            if not user or not user["is_active"]:
                return RedirectResponse(f"{app_login}?error=no_account")

    token = _create_token(dict(user))
    return RedirectResponse(f"{app_login}?token={token}")


# ── User Permissions ──────────────────────────────────────────────────────────

@router.get("/users/{user_id}/permissions")
def get_user_permissions(user_id: int, caller: UserInfo = Depends(require_jwt)):
    """Return role defaults + custom grants for a user."""
    if caller.role not in _ADMIN_ROLES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT role FROM cvc.users WHERE id = %s AND is_active = TRUE", (user_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="User not found")
            role = row["role"]
            custom_grants = _get_custom_grants(cur, user_id)
    defaults = ROLE_DEFAULTS.get(role, [])
    return {
        "role":             role,
        "role_defaults":    defaults,
        "custom_grants":    custom_grants,
        "effective":        list(dict.fromkeys(defaults + custom_grants)),
        "all_permissions":  PLATFORM_PERMISSIONS,
    }


class GrantPermissionRequest(BaseModel):
    permission: str


@router.post("/users/{user_id}/permissions", status_code=201)
def grant_permission(user_id: int, body: GrantPermissionRequest, caller: UserInfo = Depends(require_jwt)):
    """Grant a custom permission to a user."""
    if caller.role not in _ADMIN_ROLES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
    valid_keys = {p["key"] for p in PLATFORM_PERMISSIONS}
    if body.permission not in valid_keys:
        raise HTTPException(status_code=400, detail=f"Unknown permission '{body.permission}'")
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM cvc.users WHERE id = %s AND is_active = TRUE", (user_id,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="User not found")
            cur.execute(
                "INSERT INTO cvc.user_permissions (user_id, permission, granted_by) VALUES (%s, %s, %s) ON CONFLICT DO NOTHING",
                (user_id, body.permission, caller.username),
            )
            conn.commit()
            custom_grants = _get_custom_grants(cur, user_id)
    return {"user_id": user_id, "custom_grants": custom_grants}


@router.delete("/users/{user_id}/permissions/{permission}", status_code=200)
def revoke_permission(user_id: int, permission: str, caller: UserInfo = Depends(require_jwt)):
    """Revoke a custom permission from a user."""
    if caller.role not in _ADMIN_ROLES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM cvc.user_permissions WHERE user_id = %s AND permission = %s",
                (user_id, permission),
            )
            conn.commit()
            custom_grants = _get_custom_grants(cur, user_id)
    return {"user_id": user_id, "custom_grants": custom_grants}
