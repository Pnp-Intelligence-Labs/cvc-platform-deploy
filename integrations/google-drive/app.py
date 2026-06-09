import asyncio
import uuid
from pathlib import Path

from fastapi import BackgroundTasks, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.middleware.sessions import SessionMiddleware

from config import (
    BASE_DIR,
    DOWNLOAD_DIR,
    GOOGLE_CLIENT_SECRETS,
    GOOGLE_REDIRECT_URI,
    SESSION_SECRET,
)
from drive_client import (
    create_oauth_flow,
    get_service,
    ingest_drive_source,
    list_drive_files,
    load_credentials,
    save_credentials,
)

app = FastAPI(title="Google Drive Ingestion Engine", version="0.1.0")
app.add_middleware(SessionMiddleware, secret_key=SESSION_SECRET, https_only=False)

STATIC_DIR = BASE_DIR / "static"
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

# In-memory job state — keyed by job_id, persists for the lifetime of the process.
_jobs: dict[str, dict] = {}


class IngestRequest(BaseModel):
    drive_url: str = Field(min_length=5)
    job_name: str = Field(default="ingest", min_length=1, max_length=80)


class PreviewRequest(BaseModel):
    drive_url: str = Field(min_length=5)


def current_user_id(request: Request) -> str | None:
    return request.session.get("user_id")


def require_user_id(request: Request) -> str:
    user_id = current_user_id(request)
    if not user_id:
        raise HTTPException(status_code=401, detail="Sign in with Google first")
    if not load_credentials(user_id):
        raise HTTPException(status_code=401, detail="Google Drive session expired")
    return user_id


@app.get("/", response_class=HTMLResponse)
def index():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/health")
def health():
    return {
        "status": "ok",
        "client_secrets_configured": GOOGLE_CLIENT_SECRETS.exists(),
        "redirect_uri": GOOGLE_REDIRECT_URI,
    }


@app.get("/api/session")
def session_status(request: Request):
    user_id = current_user_id(request)
    if not user_id:
        return {"authenticated": False}
    creds = load_credentials(user_id)
    return {
        "authenticated": bool(creds),
        "email": request.session.get("email"),
        "user_id": user_id,
    }


@app.get("/auth/login")
def auth_login(request: Request):
    if not GOOGLE_CLIENT_SECRETS.exists():
        raise HTTPException(
            status_code=500,
            detail=f"Missing Google OAuth client secrets at {GOOGLE_CLIENT_SECRETS}",
        )

    flow = create_oauth_flow()
    authorization_url, state = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        prompt="consent",
    )
    request.session["oauth_state"] = state
    return RedirectResponse(authorization_url)


@app.get("/oauth2callback")
def oauth_callback(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
):
    if error:
        return RedirectResponse(
            f"/static/error.html?message=Google+sign-in+was+blocked&detail={error}"
        )
    expected_state = request.session.get("oauth_state")
    if not code or not state or state != expected_state:
        return RedirectResponse(
            "/static/error.html?message=Invalid+OAuth+callback&detail=State+mismatch+or+missing+code"
        )

    try:
        flow = create_oauth_flow()
        flow.fetch_token(code=code)
        creds = flow.credentials

        service = _build_service(creds)
        about = service.about().get(fields="user(emailAddress, displayName)").execute()
        user = about.get("user", {})
        email = user.get("emailAddress") or "unknown@user"
        user_id = email.lower()
    except Exception as exc:
        return RedirectResponse(
            f"/static/error.html?message=Sign-in+failed&detail={str(exc)[:120]}"
        )

    save_credentials(user_id, creds)
    request.session["user_id"] = user_id
    request.session["email"] = email
    request.session.pop("oauth_state", None)

    return RedirectResponse("/?connected=1")


def _build_service(creds):
    from googleapiclient.discovery import build

    return build("drive", "v3", credentials=creds)


@app.post("/auth/logout")
def auth_logout(request: Request):
    request.session.clear()
    return {"ok": True}


@app.post("/api/preview")
def preview_files(payload: PreviewRequest, request: Request):
    user_id = require_user_id(request)
    service = get_service(user_id)
    files = list_drive_files(service, payload.drive_url)
    return {
        "count": len(files),
        "files": [
            {
                "id": item["id"],
                "name": item["name"],
                "rel_path": item.get("rel_path", item["name"]),
                "mime_type": item["mimeType"],
                "size": item.get("size"),
            }
            for item in files
        ],
    }


@app.post("/api/ingest")
def ingest_files(payload: IngestRequest, background_tasks: BackgroundTasks, request: Request):
    user_id = require_user_id(request)

    safe_name = "".join(
        char if char.isalnum() or char in ("-", "_") else "_"
        for char in payload.job_name.strip()
    )
    dest_dir = DOWNLOAD_DIR / user_id / safe_name
    job_id = uuid.uuid4().hex[:8]

    _jobs[job_id] = {
        "status": "running",
        "job_name": safe_name,
        "destination": str(dest_dir),
    }
    background_tasks.add_task(_run_ingest_bg, job_id, user_id, payload.drive_url, dest_dir)

    return {
        "job_id": job_id,
        "job_name": safe_name,
        "status": "running",
        "destination": str(dest_dir),
    }


async def _run_ingest_bg(job_id: str, user_id: str, drive_url: str, dest_dir: Path) -> None:
    def _work():
        return ingest_drive_source(get_service(user_id), drive_url, dest_dir)

    try:
        results = await asyncio.to_thread(_work)
        succeeded = sum(1 for r in results if r["success"])
        _jobs[job_id].update(
            {
                "status": "done",
                "total": len(results),
                "succeeded": succeeded,
                "failed": len(results) - succeeded,
                "files": results,
            }
        )
    except Exception as exc:
        _jobs[job_id].update({"status": "error", "error": str(exc)})


@app.get("/api/jobs/{job_id}/status")
def job_status(job_id: str, request: Request):
    require_user_id(request)
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@app.get("/api/jobs")
def list_jobs(request: Request):
    user_id = require_user_id(request)
    user_dir = DOWNLOAD_DIR / user_id
    if not user_dir.exists():
        return {"jobs": []}

    jobs = []
    for job_dir in sorted(user_dir.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
        if not job_dir.is_dir():
            continue
        file_count = sum(1 for p in job_dir.rglob("*") if p.is_file())
        jobs.append({"name": job_dir.name, "path": str(job_dir), "file_count": file_count})
    return {"jobs": jobs}
