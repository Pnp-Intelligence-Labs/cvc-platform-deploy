"""
api/routes/auth.py — JWT authentication for CVC Intelligence Platform.

All authentication is JWT. Basic Auth has been fully removed.

Endpoints (prefix /auth set in main.py):
    POST /auth/login       — username + password → JWT token
    GET  /auth/me          — token → current user + role
    POST /auth/refresh     — extend session (returns new token)
    GET  /auth/users       — list all users (GP/Principal/Director only)
    POST /auth/users       — create a new user (GP/Principal/Director only)
    PATCH /auth/users/{id} — update user role/partner assignments
    DELETE /auth/users/{id} — deactivate user (GP only)
"""

import os
import shutil
from pathlib import Path
from urllib.parse import urlencode
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, HTTPException, status, Depends, UploadFile, File
from fastapi.responses import RedirectResponse
from fastapi.security import HTTPBearer
from pydantic import BaseModel
from jose import JWTError, jwt
import bcrypt
import requests as _http
from core.db.connection import get_connection

AVATARS_DIR = Path(__file__).parent.parent / "static" / "avatars"
AVATARS_DIR.mkdir(parents=True, exist_ok=True)
_ALLOWED_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}

router = APIRouter()

JWT_SECRET = os.environ.get("JWT_SECRET")
if not JWT_SECRET:
    raise RuntimeError("JWT_SECRET is required. Set it in the environment or local .env file.")
JWT_ALGORITHM = "HS256"
JWT_EXPIRY_HOURS = 168  # 7 days

_bearer = HTTPBearer(auto_error=False)


# --- Models ---

class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    username: str
    role: str
    full_name: str | None


class UserInfo(BaseModel):
    user_id: int
    username: str
    role: str
    full_name: str | None
    assigned_partner_ids: list[int]


# --- Helpers ---

def _create_token(user: dict) -> str:
    payload = {
        "sub": str(user["id"]),
        "username": user["username"],
        "role": user["role"],
        "full_name": user["full_name"],
        "assigned_partner_ids": user["assigned_partner_ids"] or [],
        "exp": datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRY_HOURS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def _decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )


# --- Dependency: require JWT auth ---

def require_jwt(credentials=Depends(_bearer)) -> UserInfo:
    """FastAPI dependency — returns current user from JWT. Raises 401 if invalid."""
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
        )
    payload = _decode_token(credentials.credentials)
    return UserInfo(
        user_id=int(payload["sub"]),
        username=payload["username"],
        role=payload["role"],
        full_name=payload.get("full_name"),
        assigned_partner_ids=payload.get("assigned_partner_ids", []),
    )


# --- Endpoints ---

@router.post("/login", response_model=TokenResponse)
def login(body: LoginRequest):
    """Authenticate with username + password. Returns JWT token."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, username, password_hash, role, full_name, assigned_partner_ids
                FROM cvc.users
                WHERE username = %s AND is_active = TRUE
                """,
                (body.username.strip().lower(),),
            )
            user = cur.fetchone()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
        )

    if not bcrypt.checkpw(body.password.encode(), user["password_hash"].encode()):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
        )

    token = _create_token(dict(user))

    return TokenResponse(
        access_token=token,
        username=user["username"],
        role=user["role"],
        full_name=user["full_name"],
    )


@router.get("/me", response_model=UserInfo)
def get_me(user: UserInfo = Depends(require_jwt)):
    """Return current user info from JWT token."""
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
    """List all users. Restricted to GP/Principal/Director."""
    if caller.role not in _ADMIN_ROLES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, username, role, full_name, email, assigned_partner_ids, is_active, created_at FROM cvc.users ORDER BY role, username"
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
def create_user(body: CreateUserRequest, caller: UserInfo = Depends(require_jwt)):
    """Create a new platform user. Restricted to GP/Principal/Director."""
    if caller.role not in _ADMIN_ROLES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")

    valid_roles = {"GP", "Principal", "Director", "Ventures", "PSM", "Senior PSM"}
    if body.role not in valid_roles:
        raise HTTPException(status_code=400, detail=f"Invalid role. Must be one of: {', '.join(sorted(valid_roles))}")

    username = body.username.strip().lower()
    if not username:
        raise HTTPException(status_code=400, detail="username is required")
    if len(body.password) < 8:
        raise HTTPException(status_code=400, detail="password must be at least 8 characters")

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
        conn.commit()

    return row


@router.delete("/users/{user_id}", status_code=200)
def deactivate_user(user_id: int, caller: UserInfo = Depends(require_jwt)):
    """Deactivate a user (soft delete). Restricted to GP only."""
    if caller.role != "GP":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only GP can deactivate users")
    if caller.user_id == user_id:
        raise HTTPException(status_code=400, detail="Cannot deactivate your own account")
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE cvc.users SET is_active = FALSE, updated_at = NOW() WHERE id = %s RETURNING id, username",
                (user_id,),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="User not found")
        conn.commit()
    return {"deactivated": True, "user_id": row["id"], "username": row["username"]}


@router.post("/users/{user_id}/reset-password", status_code=200)
def reset_password(user_id: int, body: dict, caller: UserInfo = Depends(require_jwt)):
    """Set a new password for a user. GP/Principal/Director, or the user resetting their own."""
    is_self = caller.user_id == user_id
    if not is_self and caller.role not in _ADMIN_ROLES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
    new_password = (body.get("password") or "").strip()
    if len(new_password) < 8:
        raise HTTPException(status_code=400, detail="password must be at least 8 characters")
    pw_hash = bcrypt.hashpw(new_password.encode(), bcrypt.gensalt()).decode()
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE cvc.users SET password_hash = %s, updated_at = NOW() WHERE id = %s RETURNING id",
                (pw_hash, user_id),
            )
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="User not found")
        conn.commit()
    return {"updated": True}


@router.get("/team")
def list_team(caller: UserInfo = Depends(require_jwt)):
    """Return active team member usernames. Available to all authenticated users."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT username, full_name, role FROM cvc.users WHERE is_active = TRUE ORDER BY username"
            )
            rows = cur.fetchall()
    return {"team": [{"username": r["username"], "full_name": r["full_name"], "role": r["role"]} for r in rows]}


@router.patch("/users/{user_id}")
def update_user(user_id: int, body: dict, caller: UserInfo = Depends(require_jwt)):
    """Update a user's role, assigned_partner_ids, full_name, or is_active.
    Restricted to GP/Principal/Director.
    """
    if caller.role not in _ADMIN_ROLES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")

    allowed = {"role", "full_name", "assigned_partner_ids", "is_active"}
    updates = {k: v for k, v in body.items() if k in allowed}
    if not updates:
        raise HTTPException(status_code=400, detail="No valid fields to update")

    set_clause = ", ".join(f"{k} = %s" for k in updates)
    values = list(updates.values()) + [user_id]

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"UPDATE cvc.users SET {set_clause}, updated_at = NOW() WHERE id = %s RETURNING id, username, role, full_name, email, assigned_partner_ids, is_active",
                values,
            )
            row = cur.fetchone()
            conn.commit()

    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    return dict(row)


@router.post("/avatar", status_code=200)
async def upload_avatar(
    file: UploadFile = File(...),
    user: UserInfo = Depends(require_jwt),
):
    """Upload a profile picture for the current user. Saved as /static/avatars/{username}.{ext}."""
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in _ALLOWED_EXTS:
        raise HTTPException(400, "File must be jpg, jpeg, png, webp, or gif")
    # Remove any previous avatar for this user
    for old in AVATARS_DIR.glob(f"{user.username}.*"):
        old.unlink(missing_ok=True)
    dest = AVATARS_DIR / f"{user.username}{suffix}"
    with dest.open("wb") as f:
        shutil.copyfileobj(file.file, f)
    return {"url": f"/static/avatars/{user.username}{suffix}"}


@router.post("/refresh", response_model=TokenResponse)
def refresh_token(user: UserInfo = Depends(require_jwt)):
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
    token_resp = _http.post(_GOOGLE_TOKEN_URL, data={
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
    info_resp = _http.get(_GOOGLE_USERINFO_URL, headers={"Authorization": f"Bearer {access_token}"}, timeout=10)
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
