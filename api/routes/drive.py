"""
drive.py — Google Drive browse + ingest endpoints (per-user).

Each user connects their OWN Google Drive. Tokens are stored per user_id (see
core/drive/userauth.py). Browse/ingest are scoped to the calling user.

Protected routes (require JWT) are on `router`.
Public routes (the OAuth callback — Google redirects here without a JWT) are on
`public_router`; the callback routes back to the right user via the `state`
nonce created when the auth URL was minted.
"""

import shutil
import urllib.parse
from pathlib import Path
from datetime import datetime

from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from api.routes.auth import require_jwt, UserInfo
from core.drive import userauth
from core.drive.browse import build_tree
from core.drive.pipeline import ingest_file, _DD_PATH

router = APIRouter()
public_router = APIRouter()  # OAuth callback must be reachable without JWT

_WORKDIR = _DD_PATH / "workdir"


def _service(user_id: int):
    """Return an authenticated Drive service for the user or raise 503."""
    try:
        return userauth.build_service(user_id)
    except ValueError:
        raise HTTPException(
            status_code=503,
            detail="Google Drive not connected. Use the 'Connect Drive' button to authenticate.",
        )


def _user_workdir(user_id: int) -> Path:
    return _WORKDIR / f"user_{user_id}"


# ── OAuth ──────────────────────────────────────────────────────────────────────

@router.get("/auth-status")
def auth_status(user: UserInfo = Depends(require_jwt)):
    """Return whether this user's Drive is connected. Called by the UI on load."""
    st = userauth.get_status(user.user_id)
    if st.get("connected"):
        return {"authenticated": True, "google_email": st.get("google_email")}
    return {"authenticated": False, "reason": "not_connected"}


@router.get("/auth-url")
def auth_url(return_to: str = "ingest", user: UserInfo = Depends(require_jwt)):
    """Return the Google consent URL for this user. The frontend navigates to it
    (browser navigation can't carry the JWT, so we mint the URL here instead)."""
    try:
        return {"url": userauth.create_auth_url(user.user_id, return_to=return_to)}
    except FileNotFoundError as e:
        raise HTTPException(status_code=503, detail=str(e))


@public_router.get("/callback")
def drive_callback(code: str = None, state: str = None, error: str = None):
    """Google OAuth callback. Saves the token for the user encoded in `state`,
    then redirects back to the page they started from. Must be public."""
    entry = userauth.consume_state(state)
    return_to = (entry or {}).get("return_to", "ingest")

    if error:
        return RedirectResponse(url=f"/app/{return_to}?drive_error={error}")
    if entry is None:
        raise HTTPException(status_code=400, detail="Invalid or expired OAuth state. Please try again.")

    try:
        userauth.exchange_and_save(entry["user_id"], code)
    except Exception as e:
        return RedirectResponse(url=f"/app/{return_to}?drive_error={urllib.parse.quote(str(e))}")

    return RedirectResponse(url=f"/app/{return_to}?drive_connected=1")


@router.post("/disconnect")
def disconnect(user: UserInfo = Depends(require_jwt)):
    userauth.disconnect(user.user_id)
    return {"disconnected": True}


# ── Drive browse & ingest ──────────────────────────────────────────────────────

@router.get("/browse")
def browse_drive(user: UserInfo = Depends(require_jwt)):
    """Return the user's Drive tree (up to 3 folders deep)."""
    svc = _service(user.user_id)
    try:
        return build_tree(svc, "root")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Drive error: {e}")


class IngestRequest(BaseModel):
    company: str
    file_ids: list[str]


@router.get("/ingested")
def list_ingested(user: UserInfo = Depends(require_jwt)):
    """Return company names this user has ingested (one workdir folder each)."""
    base = _user_workdir(user.user_id)
    if not base.exists():
        return []
    return sorted(d.name for d in base.iterdir() if d.is_dir() and not d.name.startswith("."))


@router.delete("/ingested/{company}")
def deingest(company: str, user: UserInfo = Depends(require_jwt)):
    """Delete all ingested data for a company in this user's workspace."""
    base = _user_workdir(user.user_id)
    safe = urllib.parse.unquote(company)
    target = base / safe
    if not target.exists():
        raise HTTPException(status_code=404, detail=f"No ingested data for '{safe}'")
    if not str(target.resolve()).startswith(str(base.resolve())):
        raise HTTPException(status_code=400, detail="Invalid company name")
    shutil.rmtree(target)
    return {"deleted": safe}


@router.post("/ingest")
def ingest_files(req: IngestRequest, user: UserInfo = Depends(require_jwt)):
    """Download selected Drive files, convert to text, tag by document type."""
    if not req.company.strip():
        raise HTTPException(status_code=400, detail="Company name required")
    if not req.file_ids:
        raise HTTPException(status_code=400, detail="No files selected")

    svc = _service(user.user_id)

    safe = req.company.strip().replace(" ", "_").replace("/", "-")
    dest_dir = _user_workdir(user.user_id) / safe

    documents = []
    for fid in req.file_ids:
        try:
            doc = ingest_file(svc, fid, dest_dir)
        except Exception as e:
            doc = {"filename": f"file_{fid}", "doc_type": "unknown", "chars": 0,
                   "conversion": "failed", "error": str(e)}
        documents.append(doc)

    return {
        "company": req.company.strip(),
        "date": datetime.now().strftime("%Y-%m-%d"),
        "summary": {
            "total": len(documents),
            "converted": sum(1 for d in documents if d["conversion"] in ("ok", "truncated")),
            "skipped": sum(1 for d in documents if d["conversion"] == "skipped"),
            "failed": sum(1 for d in documents if d["conversion"] in ("failed", "download_failed")),
        },
        "documents": [
            {
                "filename": d["filename"],
                "doc_type": d.get("doc_type", "unknown"),
                "chars": d.get("chars", 0),
                "conversion": d.get("conversion", "unknown"),
            }
            for d in documents
        ],
    }
