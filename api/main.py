"""
CVC Intelligence Platform API
"""
from starlette.middleware.base import BaseHTTPMiddleware
from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, RedirectResponse
import os

from api.routes.companies import router as companies_router
from api.routes.trends import router as trends_router
from api.routes.sourcing import router as sourcing_router
from api.routes.shortlists import router as shortlists_router
from api.routes.enrichment import router as enrichment_router
from api.routes.tasks import router as tasks_router
from api.routes.dealflow import router as dealflow_router
from api.routes.intelligence import router as intelligence_router
from api.routes.partners import router as partners_router
from api.routes.lp import router as lp_router
from api.routes.industrial import router as industrial_router
from api.routes.portfolio import router as portfolio_router
from api.routes.home import router as home_router
from api.routes.admin import router as admin_router
from api.routes.review import router as review_router
from api.routes.notifications import router as notifications_router
from api.routes.brambles import router as brambles_router
from api.routes.assignments import router as assignments_router
from api.routes.sector_eval import router as sector_eval_router
from api.routes.requests import router as requests_router
from api.routes.sales import router as sales_router
from api.routes.news import router as news_router
from api.routes.meeting_notes import router as meeting_notes_router
from api.routes.trend_reports import router as trend_reports_router
from api.routes.explorer import router as explorer_router
from api.routes.auth import router as auth_router
from api.auth import require_auth

import threading
from contextlib import asynccontextmanager

def _brambles_startup_recovery():
    """On startup: reset stuck 'running' analyses and re-trigger any finalized companies missing a memo."""
    try:
        from core.db.connection import get_connection
        from api.routes.brambles import _generate_review_memo_bg
        with get_connection() as conn:
            with conn.cursor() as cur:
                # Reset analyses stuck in 'running' (killed by prior API restart)
                cur.execute("""
                    UPDATE cvc.brambles_pipeline
                    SET status = 'error', updated_at = NOW()
                    WHERE status = 'running'
                """)
                stuck = cur.rowcount
                # Find finalized reviews with no memo (background task was killed)
                cur.execute("""
                    SELECT id FROM cvc.brambles_pipeline
                    WHERE review_status = 'finalized'
                      AND review_memo_json IS NULL
                """)
                pending_memos = [r['id'] for r in cur.fetchall()]
            conn.commit()
        import logging
        log = logging.getLogger(__name__)
        if stuck:
            log.info(f"Brambles startup: reset {stuck} stuck 'running' records to 'error'")
        for company_id in pending_memos:
            log.info(f"Brambles startup: re-triggering memo for company {company_id}")
            threading.Thread(target=_generate_review_memo_bg, args=(company_id,), daemon=True).start()
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning(f"Brambles startup recovery failed: {e}")

@asynccontextmanager
async def lifespan(app):
    threading.Thread(target=_brambles_startup_recovery, daemon=True).start()
    yield

app = FastAPI(
    title="CVC Intelligence Platform",
    description="Web platform for CVC ventures team",
    version="0.1.0",
    lifespan=lifespan,
)


def _csv_env(name: str) -> list[str]:
    return [item.strip() for item in os.environ.get(name, "").split(",") if item.strip()]


_allowed_origins = _csv_env("CVC_ALLOWED_ORIGINS") or [
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
    allow_credentials=os.environ.get("CVC_ALLOW_CREDENTIALS", "false").lower() == "true",
    allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

# Protected routes — require auth
app.include_router(companies_router, prefix="/companies", tags=["companies"],
                   dependencies=[Depends(require_auth)])
app.include_router(trends_router, prefix="/trends", tags=["trends"],
                   dependencies=[Depends(require_auth)])
app.include_router(sourcing_router, prefix="/sourcing", tags=["sourcing"],
                   dependencies=[Depends(require_auth)])
app.include_router(shortlists_router, prefix="/shortlists", tags=["shortlists"],
                   dependencies=[Depends(require_auth)])
app.include_router(enrichment_router, prefix="/admin", tags=["admin"],
                   dependencies=[Depends(require_auth)])
app.include_router(tasks_router, prefix="/tasks", tags=["tasks"],
                   dependencies=[Depends(require_auth)])
app.include_router(dealflow_router, prefix="/dealflow", tags=["dealflow"],
                   dependencies=[Depends(require_auth)])
app.include_router(intelligence_router, prefix="/intelligence", tags=["intelligence"],
                   dependencies=[Depends(require_auth)])
app.include_router(partners_router, prefix="/partners",
                   dependencies=[Depends(require_auth)])
app.include_router(lp_router, prefix="/lp",
                   dependencies=[Depends(require_auth)])
app.include_router(industrial_router, prefix="/industrial", tags=["industrial"],
                   dependencies=[Depends(require_auth)])
app.include_router(portfolio_router, prefix="/portfolio", tags=["portfolio"],
                   dependencies=[Depends(require_auth)])
app.include_router(home_router, prefix="/home", tags=["home"],
                   dependencies=[Depends(require_auth)])
app.include_router(admin_router, prefix="/admin", tags=["admin"],
                   dependencies=[Depends(require_auth)])
app.include_router(review_router, prefix="/review", tags=["review"],
                   dependencies=[Depends(require_auth)])
app.include_router(notifications_router, prefix="/notifications", tags=["notifications"],
                   dependencies=[Depends(require_auth)])
app.include_router(brambles_router, prefix="/brambles", tags=["brambles"],
                   dependencies=[Depends(require_auth)])
app.include_router(assignments_router, prefix="/ventures", tags=["ventures"],
                   dependencies=[Depends(require_auth)])
app.include_router(sector_eval_router, prefix="/ventures/sector-eval", tags=["ventures"],
                   dependencies=[Depends(require_auth)])
app.include_router(requests_router, prefix="/requests", tags=["requests"],
                   dependencies=[Depends(require_auth)])
app.include_router(sales_router, prefix="/sales", tags=["sales"],
                   dependencies=[Depends(require_auth)])
app.include_router(news_router, prefix="/news", tags=["news"],
                   dependencies=[Depends(require_auth)])
app.include_router(meeting_notes_router, prefix="/notes", tags=["notes"],
                   dependencies=[Depends(require_auth)])
app.include_router(explorer_router, prefix="/explorer", tags=["explorer"],
                   dependencies=[Depends(require_auth)])
app.include_router(trend_reports_router, prefix="/reports", tags=["reports"],
                   dependencies=[Depends(require_auth)])

# Auth routes — public (no require_auth — login endpoint must be reachable unauthenticated)
app.include_router(auth_router, prefix="/auth", tags=["auth"])


# ── Public news dashboard (no auth — local dev convenience) ──────────────────
@app.get("/news/dashboard", include_in_schema=False)
async def news_dashboard():
    """Render a self-contained QQQ news dashboard. No auth required for local viewing."""
    import json as _json
    from core.db.connection import get_connection as _gc
    stats = []
    articles = []
    try:
        with _gc() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT COALESCE(activity_type, 'general') as activity_type,
                           COUNT(*) as article_count,
                           COUNT(DISTINCT company_name) as company_count,
                           MAX(published_at)::text as latest_article
                    FROM cvc.category_news GROUP BY activity_type ORDER BY article_count DESC
                """)
                stats = [dict(r) for r in cur.fetchall()]
                cur.execute("""
                    SELECT id, link, company_name, title, activity_type,
                           published_at::text as published_at, formatted_date
                    FROM cvc.category_news ORDER BY published_at DESC LIMIT 500
                """)
                articles = [dict(r) for r in cur.fetchall()]
    except Exception:
        pass
    stats_json = _json.dumps(stats)
    articles_json = _json.dumps(articles)
    _ACT_PILLS = (
        '<button class="pill a" data-c="">All</button>'
        '<button class="pill" data-c="venture">\U0001f680 Venture</button>'
        '<button class="pill" data-c="ma">\U0001f91d M&amp;A</button>'
        '<button class="pill" data-c="lawsuit">\u2696\ufe0f Lawsuits</button>'
        '<button class="pill" data-c="budget">\U0001f4b0 Budget</button>'
        '<button class="pill" data-c="partnership">\U0001f517 Partnerships</button>'
    )
    html = f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>QQQ Market Intelligence</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
*{{margin:0;padding:0;box-sizing:border-box}}
body{{font-family:'Inter',sans-serif;background:#FAF9F6;color:#1E293B;min-height:100vh}}
.nav{{background:#151411;padding:16px 32px;display:flex;align-items:center;gap:12px}}
.nav h1{{color:#F59E0B;font-size:18px;font-weight:700}}.nav span{{color:#94a3b8;font-size:13px}}
.wrap{{max-width:1200px;margin:0 auto;padding:24px}}
.sr{{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:24px}}
.sc{{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px;box-shadow:0 1px 2px 0 rgb(0 0 0/.04),0 4px 16px 0 rgb(0 0 0/.06)}}
.sl{{font-family:monospace;font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:#94a3b8;font-weight:700}}
.sv{{font-size:32px;font-weight:800;margin-top:4px;letter-spacing:-1px}}
.ss{{font-size:12px;color:#64748b;margin-top:2px}}
.ctl{{display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap;align-items:center}}
.pill{{padding:8px 18px;border-radius:20px;border:1px solid #e2e8f0;background:#fff;cursor:pointer;font-size:13px;font-weight:600;transition:all .2s}}
.pill:hover{{background:#FAF9F6;border-color:#1E293B}}.pill.a{{background:#1E293B;color:#F59E0B;border-color:#1E293B}}
.sb{{padding:8px 16px;border-radius:10px;border:1px solid #94a3b8;background:#ede8d7;font-size:13px;width:260px;font-family:inherit}}
.sb:focus{{outline:none}}
.nl{{display:flex;flex-direction:column;gap:10px}}
.nc{{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px 20px;box-shadow:0 1px 2px 0 rgb(0 0 0/.04),0 4px 16px 0 rgb(0 0 0/.06);transition:all .2s;display:grid;grid-template-columns:1fr auto;gap:12px;align-items:start}}
.nc:hover{{box-shadow:0 2px 4px 0 rgb(0 0 0/.06),0 8px 24px 0 rgb(0 0 0/.08);transform:translateY(-1px)}}
.nt{{font-size:14px;font-weight:600;line-height:1.5}}.nt a{{color:#1E293B;text-decoration:none}}.nt a:hover{{color:#6366F1;text-decoration:underline}}
.nm{{display:flex;gap:8px;margin-top:6px;flex-wrap:wrap}}
.bd{{font-family:monospace;font-size:10px;text-transform:uppercase;letter-spacing:1px;padding:3px 10px;border-radius:20px;font-weight:700}}
.bc{{background:#EEF2FF;color:#6366F1}}
.bv{{background:#f0fdf4;color:#166534}}.bm{{background:#fff7ed;color:#9a3412}}.bl{{background:#fef2f2;color:#991b1b}}.bb{{background:#eff6ff;color:#1e40af}}.bp{{background:#faf5ff;color:#6b21a8}}.bg{{background:#FFFBEB;color:#92400e}}
.nd{{font-size:12px;color:#64748b;white-space:nowrap;text-align:right;min-width:100px}}
.cb{{font-size:13px;color:#64748b;margin-bottom:14px}}
.em{{text-align:center;padding:60px;color:#94a3b8}}.em h3{{color:#475569;margin-bottom:8px}}
</style></head><body>
<div class="nav"><h1>📊 QQQ Market Intelligence</h1><span>— CVC Intelligence</span></div>
<div class="wrap">
<div class="sr" id="st"></div>
<div class="ctl">
{_ACT_PILLS}
<input class="sb" id="q" placeholder="Search company or headline..." />
</div>
<div class="cb" id="cb"></div>
<div class="nl" id="nl"></div>
</div>
<script>
const S={stats_json};
const A={articles_json};
let cat='',q='';
const TC={{'venture':'bv','ma':'bm','lawsuit':'bl','budget':'bb','partnership':'bp','general':'bg'}};
function esc(s){{const d=document.createElement('div');d.textContent=s;return d.innerHTML}}
function render(){{
  const el=document.getElementById('st');
  const total=S.reduce((a,d)=>a+d.article_count,0);
  const cos=S.reduce((a,d)=>a+d.company_count,0);
  let h='<div class="sc"><div class="sl">Total Articles</div><div class="sv">'+total.toLocaleString()+'</div><div class="ss">'+cos+' companies tracked</div></div>';
  S.forEach(d=>{{h+='<div class="sc"><div class="sl">'+esc(d.activity_type)+'</div><div class="sv">'+d.article_count+'</div><div class="ss">'+d.company_count+' companies</div></div>'}});
  el.innerHTML=h;
  let arts=A;
  if(cat)arts=arts.filter(a=>(a.activity_type||'general')===cat);
  if(q){{const ql=q.toLowerCase();arts=arts.filter(a=>a.title.toLowerCase().includes(ql)||a.company_name.toLowerCase().includes(ql))}}
  document.getElementById('cb').textContent='Showing '+arts.length+' of '+A.length+' articles';
  if(!arts.length){{document.getElementById('nl').innerHTML='<div class="em"><h3>No articles found</h3><p>Try a different filter.</p></div>';return}}
  document.getElementById('nl').innerHTML=arts.map(a=>{{const t=a.activity_type||'general';return '<div class="nc"><div><div class="nt"><a href="'+esc(a.link)+'" target="_blank">'+esc(a.title)+'</a></div><div class="nm"><span class="bd bc">'+esc(a.company_name)+'</span><span class="bd '+(TC[t]||'bg')+'">'+esc(t)+'</span></div></div><div class="nd">'+(a.formatted_date||a.published_at||'')+'</div></div>'}}).join('');
}}
document.querySelectorAll('.pill').forEach(b=>b.addEventListener('click',()=>{{document.querySelectorAll('.pill').forEach(p=>p.classList.remove('a'));b.classList.add('a');cat=b.dataset.c;render()}}));
document.getElementById('q').addEventListener('input',e=>{{q=e.target.value;render()}});
render();
</script></body></html>"""
    from fastapi.responses import HTMLResponse
    return HTMLResponse(html)

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
    port = int(os.environ.get("PORT", 8001))
    uvicorn.run(app, host="0.0.0.0", port=port)
