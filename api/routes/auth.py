"""
api/routes/auth.py — JWT authentication for CVC Intelligence Platform.

All authentication is JWT. Basic Auth has been fully removed.

Endpoints (prefix /auth set in main.py):
    POST /auth/login    — username + password → JWT token
    GET  /auth/me       — token → current user + role
    POST /auth/refresh  — extend session (returns new token)
    GET  /auth/users    — list all users (GP/Principal/Director only)
    PATCH /auth/users/{id} — update user role/partner assignments
"""

import os
import shutil
from pathlib import Path
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, HTTPException, status, Depends, UploadFile, File
from fastapi.security import HTTPBearer
from pydantic import BaseModel
from jose import JWTError, jwt
import bcrypt
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
    return {"users": [dict(r) for r in rows]}


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
