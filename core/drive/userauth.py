"""
core/drive/userauth.py — Per-user Google Drive OAuth.

Each platform user connects their OWN Google account. Tokens are stored per
user_id in cvc.user_drive_tokens. The OAuth callback is shared (one registered
redirect URI), so we route it back to the right user via a server-side `state`
nonce that maps to (user_id, return_to).

The OAuth client (the app owner's key) comes from GOOGLE_CLIENT_ID +
GOOGLE_CLIENT_SECRET env vars — same client as the Google login flow — with
GDRIVE_CREDS_PATH (a client_secret.json file) as a local-dev fallback. The
per-user *token* is what makes each connection individual.
"""

import os
import secrets
from pathlib import Path

# Google returns a *superset* of the requested scope when the user is already
# signed in via Google login (which holds openid/email/profile) and the auth URL
# sets include_granted_scopes. oauthlib's Flow.fetch_token treats any scope
# difference as fatal ("Scope has changed…") and refuses to save the token.
# Relax that check — the token is valid and still grants the drive scope.
os.environ.setdefault("OAUTHLIB_RELAX_TOKEN_SCOPE", "1")

from core.db.connection import get_connection

# Shared OAuth client (the app's Google Cloud credentials), not per-user.
CREDS_PATH = Path(os.environ.get("GDRIVE_CREDS_PATH", str(Path.home() / "producer" / "gdrive_credentials.json")))
BASE_URL   = (os.environ.get("APP_BASE_URL") or os.environ.get("PLATFORM_BASE_URL") or "http://localhost:8002").rstrip("/")

# Full drive scope — matches the already-registered OAuth consent + lets us read
# everything in the user's Drive for ingestion.
SCOPES = ["https://www.googleapis.com/auth/drive"]

# The callback path is already registered in the Google Cloud console, so we
# reuse it for the per-user flow rather than registering a new redirect URI.
REDIRECT_URI = f"{BASE_URL}/drive/callback"

def _purge_states() -> None:
    """Delete expired state nonces from DB. Non-fatal — never blocks auth-url."""
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "DELETE FROM cvc.drive_oauth_states "
                    "WHERE created_at < NOW() - INTERVAL '10 minutes'"
                )
    except Exception:
        pass


def _build_flow():
    """Build an OAuth Flow from env vars (GOOGLE_CLIENT_ID/SECRET — the app
    owner's key) or, failing that, the GDRIVE_CREDS_PATH client_secret.json.
    Raises FileNotFoundError if neither is configured."""
    from google_auth_oauthlib.flow import Flow

    client_id = os.environ.get("GOOGLE_CLIENT_ID", "")
    client_secret = os.environ.get("GOOGLE_CLIENT_SECRET", "")
    if client_id and client_secret:
        client_config = {
            "web": {
                "client_id": client_id,
                "client_secret": client_secret,
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
                "redirect_uris": [REDIRECT_URI],
            }
        }
        return Flow.from_client_config(client_config, scopes=SCOPES, redirect_uri=REDIRECT_URI)

    if not CREDS_PATH.exists():
        raise FileNotFoundError(
            "Google OAuth client not configured. Set GOOGLE_CLIENT_ID + "
            f"GOOGLE_CLIENT_SECRET, or GDRIVE_CREDS_PATH to a client_secret.json (looked at {CREDS_PATH})."
        )
    return Flow.from_client_secrets_file(str(CREDS_PATH), scopes=SCOPES, redirect_uri=REDIRECT_URI)


def create_auth_url(user_id: int, return_to: str = "terminal") -> str:
    """Build a Google consent URL for this specific user. Raises if the OAuth
    client is not configured."""
    _purge_states()
    state = secrets.token_urlsafe(32)
    flow = _build_flow()
    auth_url, _ = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        prompt="consent",
        state=state,
    )
    # authorization_url() autogenerates a PKCE code_verifier; the callback runs
    # in a separate request, so persist it with the state or the exchange fails.
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO cvc.drive_oauth_states (state, user_id, return_to, code_verifier) "
                "VALUES (%s, %s, %s, %s)",
                (state, user_id, return_to, getattr(flow, "code_verifier", None)),
            )
    return auth_url


def consume_state(state: str | None) -> dict | None:
    """Pop and validate a state nonce from DB. Returns
    {user_id, return_to, code_verifier} or None."""
    if not state:
        return None
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM cvc.drive_oauth_states "
                "WHERE state = %s "
                "  AND created_at >= NOW() - INTERVAL '10 minutes' "
                "RETURNING user_id, return_to, code_verifier",
                (state,),
            )
            row = cur.fetchone()
    if not row:
        return None
    return {"user_id": row["user_id"], "return_to": row["return_to"],
            "code_verifier": row.get("code_verifier")}


def exchange_and_save(user_id: int, code: str, code_verifier: str | None = None) -> str:
    """Exchange an auth code for tokens, persist them for the user, return the
    connected Google email. `code_verifier` is the PKCE verifier minted at
    auth-url time (a fresh Flow has none, and Google requires it to match)."""
    flow = _build_flow()
    if code_verifier:
        flow.code_verifier = code_verifier
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
