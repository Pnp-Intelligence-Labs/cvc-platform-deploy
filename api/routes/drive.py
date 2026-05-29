"""
drive.py — Google Drive browse + ingest endpoints.

Protected routes (require JWT) are on `router`.
Public routes (OAuth callback — Google redirects here without JWT) are on `public_router`.
"""

import os
import sys
import secrets
import time
from pathlib import Path
from fastapi import APIRouter, HTTPException
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

router = APIRouter()
public_router = APIRouter()  # OAuth callback must be reachable without JWT

_DD_PATH = Path(__file__).parent.parent.parent / "plugins" / "_staging" / "workers" / "dd"

# Configurable via env — default to ~/producer/ for backward compat with producer setup
_CREDS    = Path(os.environ.get("GDRIVE_CREDS_PATH",  str(Path.home() / "producer" / "gdrive_credentials.json")))
_TOKEN    = Path(os.environ.get("GDRIVE_TOKEN_PATH",   str(Path.home() / "producer" / "gdrive_token.json")))
_BASE_URL = os.environ.get("PLATFORM_BASE_URL", "http://localhost:8002").rstrip("/")
_SCOPES   = ["https://www.googleapis.com/auth/drive"]

# CSRF state store for OAuth (single-instance; 10-min TTL)
_oauth_states: dict[str, float] = {}

_EXPORT_MIME = {
    "application/vnd.google-apps.document":     ("application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".docx"),
    "application/vnd.google-apps.spreadsheet":  ("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",      ".xlsx"),
    "application/vnd.google-apps.presentation": ("application/vnd.openxmlformats-officedocument.presentationml.presentation", ".pptx"),
}


def _service():
    """Return an authenticated Drive service or raise 503."""
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request
    from googleapiclient.discovery import build

    if not _TOKEN.exists():
        raise HTTPException(
            status_code=503,
            detail="Google Drive not authenticated. Use the 'Connect Drive' button to authenticate.",
        )

    creds = Credentials.from_authorized_user_file(str(_TOKEN), _SCOPES)
    if not creds.valid:
        if creds.expired and creds.refresh_token:
            creds.refresh(Request())
            _TOKEN.write_text(creds.to_json())  # persist refreshed token back to disk
        else:
            raise HTTPException(
                status_code=503,
                detail="Drive token expired and cannot refresh. Use 'Connect Drive' to re-authenticate.",
            )

    return build("drive", "v3", credentials=creds)


def _build_tree(svc, folder_id: str, depth: int = 0, max_depth: int = 3) -> dict:
    """Recursively list a folder. Returns {folders: [...], files: [...]}."""
    if depth > max_depth:
        return {"folders": [], "files": [], "truncated": True}

    folders, files = [], []
    page_token = None

    while True:
        resp = svc.files().list(
            q=f"'{folder_id}' in parents and trashed=false",
            fields="nextPageToken, files(id, name, mimeType, size, modifiedTime)",
            orderBy="name",
            pageSize=200,
            pageToken=page_token,
        ).execute()

        for item in resp.get("files", []):
            if item["mimeType"] == "application/vnd.google-apps.folder":
                folders.append({
                    "id":       item["id"],
                    "name":     item["name"],
                    "children": _build_tree(svc, item["id"], depth + 1, max_depth),
                })
            else:
                files.append({
                    "id":           item["id"],
                    "name":         item["name"],
                    "mimeType":     item["mimeType"],
                    "size":         item.get("size"),
                    "modifiedTime": item.get("modifiedTime"),
                })

        page_token = resp.get("nextPageToken")
        if not page_token:
            break

    return {"folders": folders, "files": files}


# ── OAuth ──────────────────────────────────────────────────────────────────────

@router.get("/auth-status")
async def auth_status():
    """Return whether Drive is authenticated. Called by the UI on page load."""
    if not _TOKEN.exists():
        return {"authenticated": False, "reason": "no_token"}
    try:
        from google.oauth2.credentials import Credentials
        creds = Credentials.from_authorized_user_file(str(_TOKEN), _SCOPES)
        if creds.valid:
            return {"authenticated": True}
        if creds.expired and creds.refresh_token:
            # Token can be refreshed on first real request — report as ok
            return {"authenticated": True, "note": "will_refresh"}
        return {"authenticated": False, "reason": "token_expired_no_refresh"}
    except Exception as e:
        return {"authenticated": False, "reason": str(e)}


@public_router.get("/auth")
async def start_drive_auth():
    """
    Start the Google OAuth flow. Redirects to Google consent screen.
    Public so the browser can navigate here directly (no JWT header on navigation).
    """
    if not _CREDS.exists():
        raise HTTPException(
            status_code=503,
            detail=f"OAuth credentials file not found at {_CREDS}. "
                   "Place your Google Cloud client_secret.json there and set GDRIVE_CREDS_PATH.",
        )
    from google_auth_oauthlib.flow import Flow

    state = secrets.token_urlsafe(32)
    _oauth_states[state] = time.time()

    # Purge states older than 10 minutes
    now = time.time()
    stale = [k for k, v in _oauth_states.items() if now - v > 600]
    for k in stale:
        _oauth_states.pop(k, None)

    flow = Flow.from_client_secrets_file(
        str(_CREDS),
        scopes=_SCOPES,
        redirect_uri=f"{_BASE_URL}/drive/callback",
    )
    auth_url, _ = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        prompt="consent",
        state=state,
    )
    return RedirectResponse(url=auth_url)


@public_router.get("/callback")
async def drive_callback(code: str = None, state: str = None, error: str = None):
    """
    Google OAuth callback. Saves token and redirects back to the ingest page.
    Must be public — Google redirects here without a JWT.
    """
    if error:
        return RedirectResponse(url=f"/app/ingest?drive_error={error}")

    stored_at = _oauth_states.pop(state or "", None)
    if stored_at is None or (time.time() - stored_at) > 600:
        raise HTTPException(status_code=400, detail="Invalid or expired OAuth state. Please try again.")

    from google_auth_oauthlib.flow import Flow

    flow = Flow.from_client_secrets_file(
        str(_CREDS),
        scopes=_SCOPES,
        redirect_uri=f"{_BASE_URL}/drive/callback",
        state=state,
    )
    flow.fetch_token(code=code)

    _TOKEN.parent.mkdir(parents=True, exist_ok=True)
    _TOKEN.write_text(flow.credentials.to_json())

    return RedirectResponse(url="/app/ingest?drive_connected=1")


# ── Drive browse & ingest ──────────────────────────────────────────────────────

@router.get("/browse")
async def browse_drive():
    """Return the full Drive tree (up to 3 folders deep)."""
    try:
        svc = _service()
        return _build_tree(svc, "root")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Drive error: {e}")


_WORKDIR = Path(__file__).parent.parent.parent / "plugins" / "_staging" / "workers" / "dd" / "workdir"


class IngestRequest(BaseModel):
    company: str
    file_ids: list[str]


@router.get("/ingested")
async def list_ingested():
    """Return list of company names that have been ingested (have a workdir folder)."""
    if not _WORKDIR.exists():
        return []
    return sorted(
        d.name for d in _WORKDIR.iterdir()
        if d.is_dir() and not d.name.startswith(".")
    )


@router.delete("/ingested/{company}")
async def deingest(company: str):
    """Delete all ingested data for a company."""
    import shutil
    import urllib.parse
    safe = urllib.parse.unquote(company)
    target = _WORKDIR / safe
    if not target.exists():
        raise HTTPException(status_code=404, detail=f"No ingested data for '{safe}'")
    if not str(target.resolve()).startswith(str(_WORKDIR.resolve())):
        raise HTTPException(status_code=400, detail="Invalid company name")
    shutil.rmtree(target)
    return {"deleted": safe}


@router.post("/ingest")
async def ingest_files(req: IngestRequest):
    """Download selected Drive files, convert to text, tag by document type."""
    if not req.company.strip():
        raise HTTPException(status_code=400, detail="Company name required")
    if not req.file_ids:
        raise HTTPException(status_code=400, detail="No files selected")

    try:
        svc = _service()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Drive error: {e}")

    dd_path = str(_DD_PATH)
    if dd_path not in sys.path:
        sys.path.insert(0, dd_path)

    try:
        from ingestion.drive import download_file
        from ingestion.converter import convert_all
        from ingestion.tagger import tag_all
        from config.settings import WORKDIR
    except ImportError as e:
        raise HTTPException(status_code=503, detail=f"DD plugin not available: {e}")

    from datetime import datetime

    safe      = req.company.strip().replace(" ", "_").replace("/", "-")
    raw_dir   = WORKDIR / safe / "raw"
    conv_dir  = WORKDIR / safe / "converted"
    raw_dir.mkdir(parents=True, exist_ok=True)

    downloaded = []
    for fid in req.file_ids:
        try:
            meta = svc.files().get(fileId=fid, fields="id,name,mimeType,size").execute()
            name, mime = meta["name"], meta["mimeType"]

            if mime in _EXPORT_MIME:
                _, ext = _EXPORT_MIME[mime]
                dest = raw_dir / (Path(name).stem + ext)
            else:
                dest = raw_dir / name

            ok = download_file(svc, fid, mime, dest)
            downloaded.append({
                "filename":   dest.name,
                "rel_path":   dest.name,
                "local_path": str(dest),
                "mime_type":  mime,
                "success":    ok,
            })
        except Exception as e:
            downloaded.append({
                "filename":   f"file_{fid}",
                "rel_path":   f"file_{fid}",
                "local_path": "",
                "mime_type":  "",
                "success":    False,
                "error":      str(e),
            })

    documents = tag_all(convert_all(downloaded, conv_dir))

    return {
        "company": req.company.strip(),
        "date":    datetime.now().strftime("%Y-%m-%d"),
        "summary": {
            "total":     len(documents),
            "converted": sum(1 for d in documents if d["conversion"] in ("ok", "truncated")),
            "skipped":   sum(1 for d in documents if d["conversion"] == "skipped"),
            "failed":    sum(1 for d in documents if d["conversion"] in ("failed", "download_failed")),
        },
        "documents": [
            {
                "filename":   d["filename"],
                "doc_type":   d.get("doc_type", "unknown"),
                "chars":      d.get("chars", 0),
                "conversion": d.get("conversion", "unknown"),
            }
            for d in documents
        ],
    }
