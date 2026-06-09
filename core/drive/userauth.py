"""
core/drive/userauth.py — Per-user Google Drive OAuth.

Each platform user connects their OWN Google account. Tokens are stored per
user_id in cvc.user_drive_tokens. The OAuth callback is shared (one registered
redirect URI), so we route it back to the right user via a server-side `state`
nonce that maps to (user_id, return_to).

Credentials file (the OAuth client) is shared and configured via
GDRIVE_CREDS_PATH (default ~/producer/gdrive_credentials.json). The per-user
*token* is what makes each connection individual.
"""

import os
import secrets
import time
from pathlib import Path

from core.db.connection import get_connection

# Shared OAuth client (the app's Google Cloud credentials), not per-user.
CREDS_PATH = Path(os.environ.get("GDRIVE_CREDS_PATH", str(Path.home() / "producer" / "gdrive_credentials.json")))
BASE_URL   = os.environ.get("PLATFORM_BASE_URL", "http://localhost:8002").rstrip("/")

# Full drive scope — matches the already-registered OAuth consent + lets us read
# everything in the user's Drive for ingestion.
SCOPES = ["https://www.googleapis.com/auth/drive"]

# The callback path is already registered in the Google Cloud console, so we
# reuse it for the per-user flow rather than registering a new redirect URI.
REDIRECT_URI = f"{BASE_URL}/drive/callback"

# CSRF/routing state: nonce -> {"user_id", "return_to", "ts"}. 10-min TTL.
_states: dict[str, dict] = {}
_STATE_TTL = 600


def _purge_states() -> None:
    now = time.time()
    for k in [k for k, v in _states.items() if now - v["ts"] > _STATE_TTL]:
        _states.pop(k, None)


def create_auth_url(user_id: int, return_to: str = "terminal") -> str:
    """Build a Google consent URL for this specific user. Raises if the OAuth
    client credentials file is missing."""
    if not CREDS_PATH.exists():
        raise FileNotFoundError(
            f"OAuth client credentials not found at {CREDS_PATH}. "
            "Set GDRIVE_CREDS_PATH to your Google client_secret.json."
        )
    from google_auth_oauthlib.flow import Flow

    _purge_states()
    state = secrets.token_urlsafe(32)
    _states[state] = {"user_id": user_id, "return_to": return_to, "ts": time.time()}

    flow = Flow.from_client_secrets_file(str(CREDS_PATH), scopes=SCOPES, redirect_uri=REDIRECT_URI)
    auth_url, _ = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        prompt="consent",
        state=state,
    )
    return auth_url


def consume_state(state: str | None) -> dict | None:
    """Pop and validate a state nonce. Returns {user_id, return_to} or None."""
    if not state:
        return None
    entry = _states.pop(state, None)
    if entry is None or (time.time() - entry["ts"]) > _STATE_TTL:
        return None
    return {"user_id": entry["user_id"], "return_to": entry["return_to"]}


def exchange_and_save(user_id: int, code: str) -> str:
    """Exchange an auth code for tokens, persist them for the user, return the
    connected Google email."""
    from google_auth_oauthlib.flow import Flow

    flow = Flow.from_client_secrets_file(str(CREDS_PATH), scopes=SCOPES, redirect_uri=REDIRECT_URI)
    flow.fetch_token(code=code)
    creds = flow.credentials

    email = _lookup_email(creds)
    _save_token(user_id, creds.to_json(), email)
    return email or ""


def _lookup_email(creds) -> str | None:
    try:
        from googleapiclient.discovery import build
        svc = build("drive", "v3", credentials=creds)
        about = svc.about().get(fields="user(emailAddress)").execute()
        return (about.get("user") or {}).get("emailAddress")
    except Exception:
        return None


def _save_token(user_id: int, token_json: str, email: str | None) -> None:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO cvc.user_drive_tokens (user_id, token_json, google_email, updated_at)
                VALUES (%s, %s, %s, NOW())
                ON CONFLICT (user_id) DO UPDATE
                  SET token_json = EXCLUDED.token_json,
                      google_email = COALESCE(EXCLUDED.google_email, cvc.user_drive_tokens.google_email),
                      updated_at = NOW()
                """,
                (user_id, token_json, email),
            )


def _load_token_row(user_id: int):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT token_json, google_email FROM cvc.user_drive_tokens WHERE user_id = %s",
                (user_id,),
            )
            return cur.fetchone()


def load_creds(user_id: int):
    """Return valid Credentials for the user, refreshing+persisting if needed.
    Returns None if the user hasn't connected or the token can't be refreshed."""
    row = _load_token_row(user_id)
    if not row:
        return None

    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials

    creds = Credentials.from_authorized_user_info(_json_loads(row["token_json"]), SCOPES)
    if creds.valid:
        return creds
    if creds.expired and creds.refresh_token:
        try:
            creds.refresh(Request())
            _save_token(user_id, creds.to_json(), row.get("google_email"))
            return creds
        except Exception:
            return None
    return None


def _json_loads(s: str) -> dict:
    import json
    return json.loads(s)


def build_service(user_id: int):
    """Return an authenticated Drive service for the user, or raise ValueError
    if they aren't connected."""
    creds = load_creds(user_id)
    if creds is None:
        raise ValueError("Google Drive not connected for this user.")
    from googleapiclient.discovery import build
    return build("drive", "v3", credentials=creds)


def get_status(user_id: int) -> dict:
    """Return {connected, google_email}. Does not refresh on its own."""
    row = _load_token_row(user_id)
    if not row:
        return {"connected": False}
    creds = load_creds(user_id)
    return {"connected": creds is not None, "google_email": row.get("google_email")}


def disconnect(user_id: int) -> None:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM cvc.user_drive_tokens WHERE user_id = %s", (user_id,))
