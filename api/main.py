"""
Platform API
"""
from starlette.middleware.base import BaseHTTPMiddleware
from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, RedirectResponse
import os

from api.routes.companies import router as companies_router
from api.routes.sourcing import router as sourcing_router
from api.routes.shortlists import router as shortlists_router
from api.routes.dealflow import router as dealflow_router
from api.routes.partners import router as partners_router
from api.routes.portfolio import router as portfolio_router
from api.routes.home import router as home_router
from api.routes.admin import router as admin_router
from api.routes.notifications import router as notifications_router
from api.routes.assignments import router as assignments_router
from api.routes.requests import router as requests_router
from api.routes.sales import router as sales_router
from api.routes.meeting_notes import router as meeting_notes_router
from api.routes.auth import router as auth_router
from api.routes.config import router as config_router
from api.routes.recommendations import router as recommendations_router
from api.routes.drive import router as drive_router, public_router as drive_public_router
from api.routes.terminal import router as terminal_router
from api.auth import require_auth
from api.plugin_loader import load_plugins, get_loaded_plugins


app = FastAPI(
    title="Platform API",
    description="Ventures platform API",
    version="0.1.0",
)


def _csv_env(name: str) -> list[str]:
    return [item.strip() for item in os.environ.get(name, "").split(",") if item.strip()]


_allowed_origins = _csv_env("ALLOWED_ORIGINS") or [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]


class LimitUploadSize(BaseHTTPMiddleware):
    def __init__(self, app, max_upload_mb=50):
        super().__init__(app)
        self.max_upload = max_upload_mb * 1024 * 1024

    async def dispatch(self, request, call_next):
        if request.method in ('POST', 'PUT', 'PATCH'):
            content_length = request.headers.get('content-length')
            if content_length and int(content_length) > self.max_upload:
                from fastapi.responses import JSONResponse
                return JSONResponse({'detail': f'File too large. Max {self.max_upload // (1024*1024)}MB.'}, status_code=413)
        return await call_next(request)


app.add_middleware(LimitUploadSize, max_upload_mb=150)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=os.environ.get("ALLOW_CREDENTIALS", "false").lower() == "true",
    allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

# Protected routes — require auth
app.include_router(companies_router, prefix="/companies", tags=["companies"],
                   dependencies=[Depends(require_auth)])
app.include_router(sourcing_router, prefix="/sourcing", tags=["sourcing"],
                   dependencies=[Depends(require_auth)])
app.include_router(shortlists_router, prefix="/shortlists", tags=["shortlists"],
                   dependencies=[Depends(require_auth)])
app.include_router(dealflow_router, prefix="/dealflow", tags=["dealflow"],
                   dependencies=[Depends(require_auth)])
app.include_router(partners_router, prefix="/partners",
                   dependencies=[Depends(require_auth)])
app.include_router(portfolio_router, prefix="/portfolio", tags=["portfolio"],
                   dependencies=[Depends(require_auth)])
app.include_router(home_router, prefix="/home", tags=["home"],
                   dependencies=[Depends(require_auth)])
app.include_router(admin_router, prefix="/admin", tags=["admin"],
                   dependencies=[Depends(require_auth)])
app.include_router(notifications_router, prefix="/notifications", tags=["notifications"],
                   dependencies=[Depends(require_auth)])
app.include_router(assignments_router, prefix="/ventures", tags=["ventures"],
                   dependencies=[Depends(require_auth)])
app.include_router(requests_router, prefix="/requests", tags=["requests"],
                   dependencies=[Depends(require_auth)])
app.include_router(sales_router, prefix="/sales", tags=["sales"],
                   dependencies=[Depends(require_auth)])
app.include_router(meeting_notes_router, prefix="/notes", tags=["notes"],
                   dependencies=[Depends(require_auth)])
app.include_router(recommendations_router, prefix="/recommendations", tags=["recommendations"],
                   dependencies=[Depends(require_auth)])
app.include_router(drive_router, prefix="/drive", tags=["drive"],
                   dependencies=[Depends(require_auth)])
# OAuth auth + callback must be public — browser navigates here without JWT
app.include_router(drive_public_router, prefix="/drive", tags=["drive"])
# Per-user "My Terminal" — Drive-powered personal workspace (routes self-protect via JWT)
app.include_router(terminal_router, prefix="/terminal", tags=["terminal"])

# Auth routes — public
app.include_router(auth_router, prefix="/auth", tags=["auth"])
app.include_router(config_router, prefix="/config", tags=["config"])

# Plugins — discovered from plugins/installed/ at startup
load_plugins(app, require_auth)


@app.get("/config/plugins", tags=["config"])
async def list_plugins():
    """Return installed plugin manifests (slug, name, version, nav declaration).
    Used by the frontend to conditionally render plugin nav items and routes.
    No auth required — same access level as /config.
    """
    return {"plugins": get_loaded_plugins()}

# Static files
static_dir = os.path.join(os.path.dirname(__file__), "static")
app.mount("/static", StaticFiles(directory=static_dir), name="static")


@app.get("/")
async def root(user=Depends(require_auth)):
    return RedirectResponse(url="/app")


@app.get("/health")
async def health_check():
    """Public — no auth required"""
    return {"status": "ok"}


# ── React app ────────────────────────────────────────────────────────────────
_react_dist = os.path.join(os.path.dirname(__file__), "static", "app")

if os.path.isdir(_react_dist):
    app.mount("/app/assets", StaticFiles(directory=os.path.join(_react_dist, "assets")), name="react-assets")

    @app.get("/app", include_in_schema=False)
    @app.get("/app/{path:path}", include_in_schema=False)
    async def react_app(path: str = ""):
        return FileResponse(
            os.path.join(_react_dist, "index.html"),
            headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
        )


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8002))
    uvicorn.run(app, host="0.0.0.0", port=port)
